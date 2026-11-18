import { DEFAULT_SETTINGS } from './defaults';
import { isActivePrizeClaim, sortRankingMatches } from './operationalRules';
import {
  hashEventPhone,
  resolveLockoutPhoneHash,
  resolvePrizeClaimPhoneHash,
} from './phoneHash';
import type {
  Clock,
  CloudEventSnapshot,
  LocalStore,
  TotemAuthContext,
  TotemCloudPort,
} from './ports';
import type {
  EventConfig,
  GiveUpLockoutRecord,
  MatchRecord,
  PrizeClaimRecord,
  Question,
  RankingEntry,
  RemoteCommandPayload,
  TotemConfigSnapshot,
  TotemLockoutRecord,
  TotemPrizeLockRecord,
  TotemRankingMatch,
} from './types';

export interface TotemSyncManagerDependencies {
  localStore: LocalStore;
  cloudGateway: TotemCloudPort;
  clock: Clock;
}

export interface SyncQueueOutcome {
  synced: number;
  failed: number;
  pending: number;
  shouldRefreshSnapshot: boolean;
  reconciledClaimsByMatchId: Map<string, PrizeClaimRecord>;
  latestPrizeStockRemaining?: number | null;
}

export interface ApplySnapshotOutcome {
  totemConfig: TotemConfigSnapshot;
  questions: Question[];
  logoDataUrl: string | null;
  backgroundDataUrl: string | null;
  pendingCommands: RemoteCommandPayload[];
}

// Gerencia sincronização em nuvem, sanitização LGPD offline, cache de ativos visuais e reconciliação de snapshots.
export class TotemSyncManager {
  private readonly localStore: LocalStore;
  private readonly cloudGateway: TotemCloudPort;
  private readonly clock: Clock;
  private syncInFlight: Promise<SyncQueueOutcome> | null = null;
  private lastCommandCursor: string | null = null;

  constructor(deps: TotemSyncManagerDependencies) {
    this.localStore = deps.localStore;
    this.cloudGateway = deps.cloudGateway;
    this.clock = deps.clock;
  }

  getLastCommandCursor(): string | null {
    return this.lastCommandCursor;
  }

  advanceCommandCursor(issuedAt: string | null | undefined): void {
    if (!issuedAt) {
      return;
    }
    if (!this.lastCommandCursor || issuedAt > this.lastCommandCursor) {
      this.lastCommandCursor = issuedAt;
    }
  }

  buildAuthContext(config: TotemConfigSnapshot): TotemAuthContext {
    return {
      totemId: config.totemId,
      deviceToken: config.deviceToken,
      commandsSince: this.lastCommandCursor,
    };
  }

  /** Remove telefone e respostas detalhadas antes de gravar Partida no cache público do Totem. */
  sanitizeMatchForLocalCache(
    match: MatchRecord | TotemRankingMatch,
  ): MatchRecord {
    return {
      id: match.id,
      eventId: match.eventId,
      totemId: match.totemId,
      participantName: match.participantName,
      participantPhone: '',
      score: match.score,
      totalQuestions: match.totalQuestions,
      timeSeconds: match.timeSeconds,
      answers: [],
      playedAt: match.playedAt,
      syncedAt: match.syncedAt ?? null,
    };
  }

  /** Converte registro de Brinde em Trava anonimizada por SHA-256 sem telefone em texto plano. */
  sanitizePrizeLockForLocalCache(
    claim: PrizeClaimRecord | TotemPrizeLockRecord,
  ): PrizeClaimRecord {
    return {
      id: claim.id,
      eventId: claim.eventId,
      matchId: claim.matchId,
      totemId: 'totemId' in claim ? claim.totemId : null,
      participantName: '',
      participantPhone: '',
      phoneHash: resolvePrizeClaimPhoneHash(claim),
      status: claim.status,
      awardedAt: claim.awardedAt,
      deliveredAt: claim.deliveredAt,
    };
  }

  /** Converte registro de Desistência em bloqueio anonimizado por SHA-256. */
  sanitizeLockoutForLocalCache(
    lockout: GiveUpLockoutRecord | TotemLockoutRecord,
  ): GiveUpLockoutRecord {
    return {
      id: lockout.id,
      eventId: lockout.eventId,
      totemId: 'totemId' in lockout ? lockout.totemId : null,
      participantPhone: '',
      phoneHash: resolveLockoutPhoneHash(lockout),
      lockedAt: lockout.lockedAt,
      expiresAt: lockout.expiresAt,
    };
  }

  /** Calcula Ranking local e total de Partidas a partir do cache enxuto no IndexedDB. */
  async loadRankingProjection(
    eventId: string,
    displayCount: number,
  ): Promise<{
    fullRanking: RankingEntry[];
    visibleRanking: RankingEntry[];
    totalMatchesCount: number;
  }> {
    const matches = await this.localStore.getMatches(eventId);
    const sorted = sortRankingMatches(matches);
    const fullRanking: RankingEntry[] = sorted.map((match, index) => ({
      position: index + 1,
      matchId: match.id,
      participantName: match.participantName,
      participantPhone: '',
      score: match.score,
      totalQuestions: match.totalQuestions,
      timeSeconds: match.timeSeconds,
      playedAt: match.playedAt,
    }));

    const limit = displayCount > 0 ? displayCount : DEFAULT_SETTINGS.rankingDisplayCount;
    return {
      fullRanking,
      visibleRanking: fullRanking.slice(0, limit),
      totalMatchesCount: fullRanking.length,
    };
  }

  /** Verifica localmente (por SHA-256) se telefone já possui Brinde registrado no Evento. */
  async findPrizeLockByPhone(
    eventId: string,
    formattedPhone: string,
  ): Promise<PrizeClaimRecord | null> {
    const targetHash = hashEventPhone(eventId, formattedPhone);
    const claims = await this.localStore.getPrizeClaims(eventId);
    return (
      claims.find(
        (claim) =>
          resolvePrizeClaimPhoneHash(claim) === targetHash &&
          (isActivePrizeClaim(claim) || claim.status === 'offline_duplicate_conflict'),
      ) ?? null
    );
  }

  /** Retorna a expiração em ms do maior Bloqueio por Desistência ativo para o telefone (via hash). */
  async findActiveLockoutExpiryMs(
    eventId: string,
    formattedPhone: string,
    nowMs: number,
  ): Promise<number | undefined> {
    const targetHash = hashEventPhone(eventId, formattedPhone);
    const lockouts = await this.localStore.getLockouts(eventId);
    return lockouts
      .filter((lockout) => resolveLockoutPhoneHash(lockout) === targetHash)
      .map((lockout) => Date.parse(lockout.expiresAt))
      .filter((expiresMs) => Number.isFinite(expiresMs) && expiresMs > nowMs)
      .sort((a, b) => b - a)[0];
  }

  /** Persiste fila local e sincroniza com a nuvem garantindo execução única em voo. */
  async syncPendingQueue(
    totemConfig: TotemConfigSnapshot,
    isEffectiveOnline: () => boolean,
  ): Promise<SyncQueueOutcome> {
    if (this.syncInFlight) {
      return this.syncInFlight;
    }

    this.syncInFlight = this.runSyncPendingQueue(totemConfig, isEffectiveOnline);
    try {
      return await this.syncInFlight;
    } finally {
      this.syncInFlight = null;
    }
  }

  private async runSyncPendingQueue(
    totemConfig: TotemConfigSnapshot,
    isEffectiveOnline: () => boolean,
  ): Promise<SyncQueueOutcome> {
    const queue = await this.localStore.getSyncQueue();
    if (!isEffectiveOnline()) {
      return {
        synced: 0,
        failed: 0,
        pending: queue.length,
        shouldRefreshSnapshot: false,
        reconciledClaimsByMatchId: new Map(),
      };
    }

    const auth = this.buildAuthContext(totemConfig);
    let synced = 0;
    let failed = 0;
    let shouldRefreshSnapshot = false;
    let latestPrizeStockRemaining: number | null | undefined;
    const reconciledClaimsByMatchId = new Map<string, PrizeClaimRecord>();

    for (const item of queue) {
      try {
        if (item.type === 'match_completed') {
          const { syncedAt, resolvedPrizeClaim, prizeStockRemaining } =
            await this.cloudGateway.pushMatch({
              idempotencyKey: item.idempotencyKey,
              match: item.payload,
              prizeClaim: item.prizeClaim,
              auth,
            });

          await this.localStore.saveMatch(
            this.sanitizeMatchForLocalCache({
              ...item.payload,
              syncedAt,
            }),
          );

          if (resolvedPrizeClaim) {
            const sanitizedClaim = this.sanitizePrizeLockForLocalCache(resolvedPrizeClaim);
            await this.localStore.savePrizeClaim(sanitizedClaim);
            reconciledClaimsByMatchId.set(sanitizedClaim.matchId, sanitizedClaim);
            if (sanitizedClaim.status === 'offline_duplicate_conflict') {
              shouldRefreshSnapshot = true;
            }
          }

          if (prizeStockRemaining !== undefined) {
            latestPrizeStockRemaining = prizeStockRemaining;
          }
        } else {
          await this.cloudGateway.pushGiveUpLockout({
            idempotencyKey: item.idempotencyKey,
            lockout: item.payload,
            auth,
          });
        }

        await this.localStore.markSyncItemCompleted(item.idempotencyKey);
        synced += 1;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
        await this.localStore.incrementSyncRetry(item.idempotencyKey, errorMessage);
        failed += 1;
      }
    }

    const remainingQueue = await this.localStore.getSyncQueue();
    return {
      synced,
      failed,
      pending: remainingQueue.length,
      shouldRefreshSnapshot,
      reconciledClaimsByMatchId,
      latestPrizeStockRemaining,
    };
  }

  /** Baixa e aplica snapshot do Evento na nuvem em uma única transação IndexedDB. */
  async pullAndApplySnapshot(
    currentConfig: TotemConfigSnapshot,
    isEffectiveOnline: () => boolean,
    stagedSnapshot?: CloudEventSnapshot,
  ): Promise<ApplySnapshotOutcome | null> {
    let cloudSnapshot: CloudEventSnapshot | null = stagedSnapshot ?? null;
    if (!cloudSnapshot) {
      if (!isEffectiveOnline()) {
        return null;
      }
      cloudSnapshot = await this.cloudGateway.pullEventSnapshot(
        currentConfig.event.id,
        this.buildAuthContext(currentConfig),
      );
    }

    if (!cloudSnapshot) {
      return null;
    }

    const pendingQueue = await this.localStore.getSyncQueue();
    const pendingMatchKeys = new Set(
      pendingQueue
        .filter((item) => item.type === 'match_completed' && item.eventId === cloudSnapshot.event.id)
        .map((item) => item.payload.id),
    );
    const pendingPrizesCount = pendingQueue.filter(
      (item) =>
        item.type === 'match_completed' &&
        item.eventId === cloudSnapshot.event.id &&
        item.prizeClaim !== undefined &&
        item.prizeClaim !== null,
    ).length;

    const mergedEvent: EventConfig = {
      ...cloudSnapshot.event,
      prizeStockRemaining:
        cloudSnapshot.event.prizeStockRemaining !== null
          ? Math.max(0, cloudSnapshot.event.prizeStockRemaining - pendingPrizesCount)
          : null,
    };

    const nextConfig: TotemConfigSnapshot = {
      ...currentConfig,
      event: mergedEvent,
    };

    const rawMatches = cloudSnapshot.rankingMatches ?? cloudSnapshot.matches;
    const matchIdsToDelete: string[] = [];
    const matchesToPut: MatchRecord[] = [];
    const prizeClaimIdsToDelete: string[] = [];

    if (rawMatches !== undefined) {
      const cloudMatchIds = new Set(rawMatches.map((match) => match.id));
      const localMatches = await this.localStore.getMatches(cloudSnapshot.event.id);
      const deletedMatchSet = new Set<string>();

      for (const localMatch of localMatches) {
        if (Boolean(localMatch.syncedAt) && !cloudMatchIds.has(localMatch.id)) {
          deletedMatchSet.add(localMatch.id);
          matchIdsToDelete.push(localMatch.id);
        }
      }

      if (deletedMatchSet.size > 0) {
        const localClaims = await this.localStore.getPrizeClaims(cloudSnapshot.event.id);
        for (const claim of localClaims) {
          if (deletedMatchSet.has(claim.matchId) && !pendingMatchKeys.has(claim.matchId)) {
            prizeClaimIdsToDelete.push(claim.id);
          }
        }
      }

      for (const remoteMatch of rawMatches) {
        matchesToPut.push(this.sanitizeMatchForLocalCache(remoteMatch));
      }
    }

    const rawClaims = cloudSnapshot.prizeLocks ?? cloudSnapshot.prizeClaims ?? [];
    const prizeClaimsToPut = rawClaims.map((claim) => this.sanitizePrizeLockForLocalCache(claim));

    const rawLockouts = cloudSnapshot.hashedLockouts ?? cloudSnapshot.lockouts ?? [];
    const lockoutsToPut = rawLockouts.map((lockout) => this.sanitizeLockoutForLocalCache(lockout));

    await this.localStore.applyCloudEventSnapshot({
      eventId: cloudSnapshot.event.id,
      totemConfig: nextConfig,
      questions: cloudSnapshot.questions,
      matchesToPut,
      matchIdsToDelete,
      prizeClaimsToPut,
      prizeClaimIdsToDelete,
      lockoutsToPut,
    });

    const { logoDataUrl, backgroundDataUrl } = await this.resolveAndCacheVisualAssets(
      mergedEvent,
      isEffectiveOnline,
    );

    const pendingCommands = cloudSnapshot.pendingCommands ?? [];
    for (const cmd of pendingCommands) {
      this.advanceCommandCursor(cmd.issuedAt);
    }

    return {
      totemConfig: nextConfig,
      questions: cloudSnapshot.questions,
      logoDataUrl,
      backgroundDataUrl,
      pendingCommands,
    };
  }

  async resolveAndCacheVisualAssets(
    event: EventConfig,
    isEffectiveOnline: () => boolean,
  ): Promise<{ logoDataUrl: string | null; backgroundDataUrl: string | null }> {
    const visual = event.customizations.visualIdentity;
    const [logoDataUrl, backgroundDataUrl] = await Promise.all([
      this.loadOrCacheVisualAsset(event.id, visual.logoUrl, 'logo', isEffectiveOnline),
      visual.enableCustomBackground
        ? this.loadOrCacheVisualAsset(
            event.id,
            visual.customBackgroundUrl,
            'background',
            isEffectiveOnline,
          )
        : Promise.resolve(null),
    ]);
    return { logoDataUrl, backgroundDataUrl };
  }

  private async loadOrCacheVisualAsset(
    eventId: string,
    url: string | null | undefined,
    kind: 'logo' | 'background',
    isEffectiveOnline: () => boolean,
  ): Promise<string | null> {
    if (!url) {
      return null;
    }

    const cached = await this.localStore.getVisualAsset(url);
    if (cached) {
      return cached.dataUrl;
    }

    if (!isEffectiveOnline()) {
      return null;
    }

    try {
      const downloaded = await this.cloudGateway.downloadVisualAsset(url);
      await this.localStore.saveVisualAsset({
        url,
        eventId,
        kind,
        dataUrl: downloaded.dataUrl,
        mimeType: downloaded.mimeType,
        cachedAt: this.clock.toISOString(),
      });
      return downloaded.dataUrl;
    } catch {
      return null;
    }
  }
}
