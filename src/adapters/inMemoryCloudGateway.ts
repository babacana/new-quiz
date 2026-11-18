import { DEFAULT_EVENT_CONFIG, DEFAULT_QUIZ_QUESTIONS } from '../domain/defaults';
import {
  computeExpiredLockoutIso,
  isActivePrizeClaim,
  selectDeliverableClaimIds,
  toEventPhoneKey,
} from '../domain/operationalRules';
import { normalizePairingCode } from '../domain/pairingUtils';
import { hashEventPhone } from '../domain/phoneHash';
import type {
  CloudEventSnapshot,
  CloudGateway,
  ListMatchesQueryOptions,
  PushMatchResponse,
  TotemAuthContext,
} from '../domain/ports';
import type {
  AuthSession,
  CreateStaffAccountInput,
  EventConfig,
  EventVisualAssetUploadInput,
  GiveUpLockoutRecord,
  MatchRecord,
  PrizeClaimRecord,
  Question,
  RemoteCommandPayload,
  TotemChannelEvent,
  TotemHeartbeatPayload,
  TotemLockoutRecord,
  TotemPairingAuthorizationPayload,
  TotemPairingRequestInput,
  TotemPrizeLockRecord,
  TotemRankingMatch,
  TotemRecord,
  UserProfile,
} from '../domain/types';
import { bytesToDataUrl, sanitizeAssetFileName } from '../domain/visualAssetUtils';

export interface InMemoryCloudGatewayOptions {
  online?: boolean;
  seedDefaultEvent?: boolean;
  nowIso?: () => string;
}

interface StoredPushMatchResult {
  match: MatchRecord;
  resolvedPrizeClaim: PrizeClaimRecord | null;
  prizeStockRemaining: number | null;
}

interface StoredStaffCredential {
  profile: UserProfile;
  password: string;
}

// Gateway em memória compartilhado entre Totem e Painel de Gestão em testes integrados.
export class InMemoryCloudGateway implements CloudGateway {
  private online: boolean;
  private readonly nowIso: () => string;
  private readonly events = new Map<string, EventConfig>();
  private readonly centralQuestions = new Map<number, Question>();
  private readonly eventQuestionIds = new Map<string, number[]>();
  private readonly syncedMatchesByIdempotencyKey = new Map<string, StoredPushMatchResult>();
  private readonly prizeClaimsByEvent = new Map<string, PrizeClaimRecord[]>();
  private readonly lockoutsByIdempotencyKey = new Map<string, GiveUpLockoutRecord>();
  private readonly staffCredentials = new Map<string, StoredStaffCredential>();
  private readonly totemsById = new Map<string, TotemRecord>();
  private readonly totemIdByPairingCode = new Map<string, string>();
  private readonly remoteCommands: RemoteCommandPayload[] = [];
  private readonly channelListeners = new Set<(event: TotemChannelEvent) => void | Promise<void>>();
  private readonly visualAssetsByUrl = new Map<string, { dataUrl: string; mimeType: string }>();
  private currentSession: AuthSession | null = null;
  private staffSequence = 0;

  constructor(options: InMemoryCloudGatewayOptions = {}) {
    this.online = options.online ?? true;
    this.nowIso = options.nowIso ?? (() => new Date().toISOString());

    this.seedDefaultStaffAccounts();

    if (options.seedDefaultEvent ?? true) {
      this.events.set(DEFAULT_EVENT_CONFIG.id, structuredClone(DEFAULT_EVENT_CONFIG));
      for (const question of DEFAULT_QUIZ_QUESTIONS) {
        this.centralQuestions.set(question.id, structuredClone(question));
      }
    }
  }

  private seedDefaultStaffAccounts(): void {
    const createdAt = this.nowIso();
    const defaults: Array<{
      id: string;
      name: string;
      email: string;
      password: string;
      role: 'admin' | 'operator';
    }> = [
      {
        id: '00000000-0000-4000-8000-000000000011',
        name: 'Administrador CAESB',
        email: 'admin@caesb.df.gov.br',
        password: 'CAESB2025!',
        role: 'admin',
      },
      {
        id: '00000000-0000-4000-8000-000000000012',
        name: 'Operador de Estande',
        email: 'operador@caesb.df.gov.br',
        password: 'OPERADOR2025!',
        role: 'operator',
      },
    ];

    for (const item of defaults) {
      this.staffCredentials.set(item.email, {
        profile: {
          id: item.id,
          name: item.name,
          email: item.email,
          role: item.role,
          createdAt,
        },
        password: item.password,
      });
    }
  }

  isOnline(): boolean {
    return this.online;
  }

  setOnline(online: boolean): void {
    this.online = online;
  }

  seedEvent(event: EventConfig, questions: Question[]): void {
    this.events.set(event.id, structuredClone(event));
    for (const question of questions) {
      this.centralQuestions.set(question.id, structuredClone(question));
    }
    this.eventQuestionIds.set(
      event.id,
      questions.map((question) => question.id),
    );
  }

  private assertTotemTokenIfPaired(auth?: TotemAuthContext): void {
    if (!auth?.totemId) {
      return;
    }
    const existing = this.totemsById.get(auth.totemId);
    if (existing?.isPaired && existing.deviceToken && existing.deviceToken !== auth.deviceToken) {
      throw new Error('Totem não autorizado ou device_token inválido.');
    }
  }

  async pullEventSnapshot(
    eventId: string,
    auth?: TotemAuthContext,
  ): Promise<CloudEventSnapshot | null> {
    if (!this.online) {
      throw new Error('Totem sem conectividade com a nuvem.');
    }
    this.assertTotemTokenIfPaired(auth);

    const event = this.events.get(eventId);
    if (!event) {
      return null;
    }

    const linkedIds = this.eventQuestionIds.get(eventId);
    const questions =
      linkedIds && linkedIds.length > 0
        ? linkedIds
            .map((id) => this.centralQuestions.get(id))
            .filter((q): q is Question => Boolean(q))
        : Array.from(this.centralQuestions.values()).sort((a, b) => a.id - b.id);

    // Retorna projeção segura para LGPD no Totem: Ranking sem telefone/respostas e travas hasheadas.
    const rankingMatches: TotemRankingMatch[] = this.getSyncedMatches(eventId).map((match) => ({
      id: match.id,
      eventId: match.eventId,
      totemId: match.totemId,
      participantName: match.participantName,
      score: match.score,
      totalQuestions: match.totalQuestions,
      timeSeconds: match.timeSeconds,
      playedAt: match.playedAt,
      syncedAt: match.syncedAt,
    }));

    const prizeLocks: TotemPrizeLockRecord[] = this.getPrizeClaims(eventId).map((claim) => ({
      id: claim.id,
      eventId: claim.eventId,
      matchId: claim.matchId,
      phoneHash: hashEventPhone(claim.eventId, claim.participantPhone),
      status: claim.status,
      awardedAt: claim.awardedAt,
      deliveredAt: claim.deliveredAt,
    }));

    const hashedLockouts: TotemLockoutRecord[] = this.getLockouts(eventId).map((lockout) => ({
      id: lockout.id,
      eventId: lockout.eventId,
      phoneHash: hashEventPhone(lockout.eventId, lockout.participantPhone),
      lockedAt: lockout.lockedAt,
      expiresAt: lockout.expiresAt,
    }));

    const commandsSince = auth?.commandsSince;
    const pendingCommands = commandsSince
      ? this.remoteCommands
          .filter((cmd) => {
            if (cmd.issuedAt < commandsSince) {
              return false;
            }
            if (cmd.targetTotemId) {
              return auth?.totemId ? cmd.targetTotemId === auth.totemId : false;
            }
            return cmd.targetEventId === eventId;
          })
          .sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))
      : [];

    return {
      event: structuredClone(event),
      questions: structuredClone(questions),
      rankingMatches,
      prizeLocks,
      hashedLockouts,
      pendingCommands: structuredClone(pendingCommands),
    };
  }

  async authenticate(email: string, password: string): Promise<AuthSession> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para autenticar.');
    }
    const normalizedEmail = email.trim().toLowerCase();
    const entry = this.staffCredentials.get(normalizedEmail);
    if (!entry || entry.password !== password) {
      throw new Error('E-mail ou senha inválidos.');
    }

    this.staffSequence += 1;
    const session: AuthSession = {
      user: structuredClone(entry.profile),
      accessToken: `inmemory-token-${entry.profile.role}-${this.staffSequence}`,
      authenticatedAt: this.nowIso(),
    };
    this.currentSession = session;
    return structuredClone(session);
  }

  async signOut(): Promise<void> {
    this.currentSession = null;
  }

  async getCurrentSession(): Promise<AuthSession | null> {
    return this.currentSession ? structuredClone(this.currentSession) : null;
  }

  async listStaffProfiles(): Promise<UserProfile[]> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para listar Equipe do Estande.');
    }
    return Array.from(this.staffCredentials.values()).map((item) => structuredClone(item.profile));
  }

  async createStaffProfile(input: CreateStaffAccountInput): Promise<UserProfile> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para cadastrar membro da Equipe do Estande.');
    }
    const normalizedEmail = input.email.trim().toLowerCase();
    if (this.staffCredentials.has(normalizedEmail)) {
      throw new Error('Já existe um membro da Equipe do Estande cadastrado com este e-mail.');
    }

    this.staffSequence += 1;
    const profile: UserProfile = {
      id: `00000000-0000-4000-8000-${String(1000 + this.staffSequence).padStart(12, '0')}`,
      name: input.name.trim(),
      email: normalizedEmail,
      role: input.role,
      createdAt: this.nowIso(),
    };
    this.staffCredentials.set(normalizedEmail, {
      profile,
      password: input.password,
    });
    return structuredClone(profile);
  }

  async updateStaffProfileRole(profileId: string, role: UserProfile['role']): Promise<UserProfile> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para atualizar perfil da Equipe do Estande.');
    }
    for (const [emailKey, entry] of this.staffCredentials.entries()) {
      if (entry.profile.id === profileId) {
        const updated: UserProfile = { ...structuredClone(entry.profile), role };
        this.staffCredentials.set(emailKey, { ...entry, profile: updated });
        return structuredClone(updated);
      }
    }
    throw new Error('Membro da Equipe do Estande não encontrado.');
  }

  async deleteStaffProfile(profileId: string): Promise<void> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para revogar acesso da Equipe do Estande.');
    }
    for (const [emailKey, entry] of this.staffCredentials.entries()) {
      if (entry.profile.id === profileId) {
        this.staffCredentials.delete(emailKey);
        return;
      }
    }
    throw new Error('Membro da Equipe do Estande não encontrado.');
  }

  async listEvents(): Promise<EventConfig[]> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para listar Eventos.');
    }
    return Array.from(this.events.values()).map((event) => structuredClone(event));
  }

  async saveEvent(event: EventConfig): Promise<EventConfig> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para salvar Evento.');
    }
    const cloned = structuredClone(event);
    this.events.set(cloned.id, cloned);
    return structuredClone(cloned);
  }

  async getEventQuestionIds(eventId: string): Promise<number[]> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para consultar questões do Evento.');
    }
    return [...(this.eventQuestionIds.get(eventId) ?? [])];
  }

  async setEventQuestions(eventId: string, questionIds: number[]): Promise<void> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para vincular questões ao Evento.');
    }
    const uniqueValidIds = Array.from(new Set(questionIds)).filter((id) =>
      this.centralQuestions.has(id),
    );
    if (uniqueValidIds.length === 0) {
      this.eventQuestionIds.delete(eventId);
    } else {
      this.eventQuestionIds.set(eventId, uniqueValidIds);
    }
  }

  async listAllQuestions(): Promise<Question[]> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para listar Banco de Questões.');
    }
    return Array.from(this.centralQuestions.values())
      .sort((a, b) => a.id - b.id)
      .map((question) => structuredClone(question));
  }

  async saveQuestion(question: Question): Promise<Question> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para salvar questão.');
    }
    const cloned = structuredClone(question);
    this.centralQuestions.set(cloned.id, cloned);
    return structuredClone(cloned);
  }

  async deleteQuestions(ids: number[]): Promise<number> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para excluir questões.');
    }
    const idSet = new Set(ids);
    let deletedCount = 0;
    for (const id of idSet) {
      if (this.centralQuestions.delete(id)) {
        deletedCount += 1;
      }
    }
    for (const [eventId, linked] of this.eventQuestionIds.entries()) {
      const remaining = linked.filter((id) => !idSet.has(id));
      if (remaining.length === 0) {
        this.eventQuestionIds.delete(eventId);
      } else {
        this.eventQuestionIds.set(eventId, remaining);
      }
    }
    return deletedCount;
  }

  async setQuestionsDisabled(ids: number[], isDisabled: boolean): Promise<number> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para atualizar status de questões.');
    }
    let updatedCount = 0;
    for (const id of ids) {
      const existing = this.centralQuestions.get(id);
      if (existing) {
        this.centralQuestions.set(id, { ...structuredClone(existing), isDisabled });
        updatedCount += 1;
      }
    }
    return updatedCount;
  }

  async replaceAllQuestions(questions: Question[]): Promise<Question[]> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para substituir Banco de Questões.');
    }
    this.centralQuestions.clear();
    this.eventQuestionIds.clear();
    for (const question of questions) {
      this.centralQuestions.set(question.id, structuredClone(question));
    }
    return this.listAllQuestions();
  }

  async pushMatch(payload: {
    idempotencyKey: string;
    match: MatchRecord;
    prizeClaim?: PrizeClaimRecord | null;
    auth?: TotemAuthContext;
  }): Promise<PushMatchResponse> {
    if (!this.online) {
      throw new Error('Falha de rede ao sincronizar Partida com a nuvem.');
    }
    this.assertTotemTokenIfPaired(payload.auth);

    const existing = this.syncedMatchesByIdempotencyKey.get(payload.idempotencyKey);
    if (existing) {
      return {
        syncedAt: existing.match.syncedAt ?? this.nowIso(),
        resolvedPrizeClaim: structuredClone(existing.resolvedPrizeClaim),
        prizeStockRemaining: existing.prizeStockRemaining,
      };
    }

    const syncedAt = this.nowIso();
    const persistedMatch: MatchRecord = {
      ...structuredClone(payload.match),
      syncedAt,
    };

    const event = this.events.get(persistedMatch.eventId);
    let resolvedPrizeClaim: PrizeClaimRecord | null = null;

    if (payload.prizeClaim) {
      const eventClaims = this.prizeClaimsByEvent.get(persistedMatch.eventId) ?? [];
      const activeForPhone = eventClaims.find(
        (claim) =>
          claim.participantPhone === payload.prizeClaim!.participantPhone &&
          isActivePrizeClaim(claim),
      );
      const phoneHash = hashEventPhone(persistedMatch.eventId, payload.prizeClaim.participantPhone);

      if (activeForPhone) {
        resolvedPrizeClaim = {
          ...structuredClone(payload.prizeClaim),
          phoneHash,
          status: 'offline_duplicate_conflict',
          deliveredAt: null,
        };
      } else if (
        event &&
        event.prizeStockRemaining !== null &&
        event.prizeStockRemaining <= 0
      ) {
        resolvedPrizeClaim = {
          ...structuredClone(payload.prizeClaim),
          phoneHash,
          status: 'revoked',
          deliveredAt: null,
        };
      } else {
        resolvedPrizeClaim = {
          ...structuredClone(payload.prizeClaim),
          phoneHash,
        };
        if (event && event.prizeStockRemaining !== null && event.prizeStockRemaining > 0) {
          event.prizeStockRemaining -= 1;
        }
      }

      eventClaims.push(structuredClone(resolvedPrizeClaim));
      this.prizeClaimsByEvent.set(persistedMatch.eventId, eventClaims);
    }

    const prizeStockRemaining = event ? event.prizeStockRemaining : null;

    this.syncedMatchesByIdempotencyKey.set(payload.idempotencyKey, {
      match: persistedMatch,
      resolvedPrizeClaim,
      prizeStockRemaining,
    });

    await this.emitChannelEvent({
      type: 'OPERATIONAL_DATA_UPDATED',
      eventId: persistedMatch.eventId,
    });

    return {
      syncedAt,
      resolvedPrizeClaim: structuredClone(resolvedPrizeClaim),
      prizeStockRemaining,
    };
  }

  async pushGiveUpLockout(payload: {
    idempotencyKey: string;
    lockout: GiveUpLockoutRecord;
    auth?: TotemAuthContext;
  }): Promise<{ syncedAt: string }> {
    if (!this.online) {
      throw new Error('Falha de rede ao sincronizar Bloqueio por Desistência.');
    }
    this.assertTotemTokenIfPaired(payload.auth);

    if (!this.lockoutsByIdempotencyKey.has(payload.idempotencyKey)) {
      const enriched: GiveUpLockoutRecord = {
        ...structuredClone(payload.lockout),
        phoneHash: hashEventPhone(payload.lockout.eventId, payload.lockout.participantPhone),
      };
      this.lockoutsByIdempotencyKey.set(payload.idempotencyKey, enriched);
      await this.emitChannelEvent({
        type: 'OPERATIONAL_DATA_UPDATED',
        eventId: payload.lockout.eventId,
      });
    }

    return { syncedAt: this.nowIso() };
  }

  getSyncedMatches(eventId?: string): MatchRecord[] {
    const all = Array.from(this.syncedMatchesByIdempotencyKey.values()).map((entry) => entry.match);
    const filtered = eventId ? all.filter((match) => match.eventId === eventId) : all;
    return filtered.map((match) => structuredClone(match));
  }

  getPrizeClaims(eventId?: string): PrizeClaimRecord[] {
    if (eventId) {
      return structuredClone(this.prizeClaimsByEvent.get(eventId) ?? []);
    }
    return Array.from(this.prizeClaimsByEvent.values()).flatMap((claims) =>
      structuredClone(claims),
    );
  }

  getActivePrizeClaims(eventId?: string): PrizeClaimRecord[] {
    return this.getPrizeClaims(eventId).filter(isActivePrizeClaim);
  }

  getOfflineConflictClaims(eventId?: string): PrizeClaimRecord[] {
    return this.getPrizeClaims(eventId).filter(
      (claim) => claim.status === 'offline_duplicate_conflict',
    );
  }

  getLockouts(eventId?: string): GiveUpLockoutRecord[] {
    const all = Array.from(this.lockoutsByIdempotencyKey.values());
    const filtered = eventId ? all.filter((lockout) => lockout.eventId === eventId) : all;
    return filtered.map((lockout) => structuredClone(lockout));
  }

  private async emitChannelEvent(event: TotemChannelEvent): Promise<void> {
    await Promise.all(
      Array.from(this.channelListeners).map((listener) => listener(structuredClone(event))),
    );
  }

  async requestTotemPairing(input: TotemPairingRequestInput): Promise<TotemRecord> {
    const normalizedCode = normalizePairingCode(input.pairingCode);
    const existing = this.totemsById.get(input.id);
    if (existing && !existing.isPaired && existing.pairingCode === normalizedCode) {
      return structuredClone(existing);
    }

    if (existing && existing.pairingCode !== normalizedCode) {
      this.totemIdByPairingCode.delete(existing.pairingCode);
    }

    const now = this.nowIso();
    const record: TotemRecord = {
      id: input.id,
      name: existing?.name && existing.isPaired ? existing.name : 'Totem Aguardando Pareamento',
      pairingCode: normalizedCode,
      deviceToken: '',
      eventId: null,
      pinCode: existing?.pinCode ?? '0000',
      isPaired: false,
      onlineStatus: this.online ? 'online' : 'offline',
      lastSeenAt: this.online ? now : (existing?.lastSeenAt ?? null),
      currentScreen: input.currentScreen,
      configVersion: input.configVersion,
      pendingSyncCount: input.pendingSyncCount,
      createdAt: existing?.createdAt ?? now,
    };

    this.totemsById.set(record.id, record);
    this.totemIdByPairingCode.set(normalizedCode, record.id);
    await this.emitChannelEvent({ type: 'TELEMETRY_UPDATED', totem: record });
    return structuredClone(record);
  }

  async authorizeTotemPairing(input: TotemPairingAuthorizationPayload): Promise<TotemRecord> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para autorizar Pareamento.');
    }

    const normalizedCode = normalizePairingCode(input.pairingCode);
    const existingId = this.totemIdByPairingCode.get(normalizedCode);
    const existing = existingId ? this.totemsById.get(existingId) : undefined;
    const now = this.nowIso();
    const wasOnline = existing?.onlineStatus === 'online';
    const eventConfigVersion = this.events.get(input.eventId)?.configVersion ?? 1;

    const record: TotemRecord = {
      id: existing?.id ?? input.id,
      name: input.name.trim(),
      pairingCode: normalizedCode,
      deviceToken: input.deviceToken,
      eventId: input.eventId,
      pinCode: input.pinCode.trim(),
      isPaired: true,
      onlineStatus: wasOnline ? 'online' : 'offline',
      lastSeenAt: wasOnline ? now : (existing?.lastSeenAt ?? null),
      currentScreen: existing?.currentScreen ?? 'initial-screen',
      configVersion: existing?.configVersion ?? eventConfigVersion,
      pendingSyncCount: existing?.pendingSyncCount ?? 0,
      createdAt: existing?.createdAt ?? now,
    };

    this.totemsById.set(record.id, record);
    this.totemIdByPairingCode.set(normalizedCode, record.id);

    await this.emitChannelEvent({ type: 'PAIRING_AUTHORIZED', totem: record });
    await this.emitChannelEvent({ type: 'TELEMETRY_UPDATED', totem: record });
    return structuredClone(record);
  }

  async claimTotemPairing(pairingCode: string): Promise<TotemRecord | null> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para ativar Pareamento.');
    }

    const normalizedCode = normalizePairingCode(pairingCode);
    const totemId = this.totemIdByPairingCode.get(normalizedCode);
    const existing = totemId ? this.totemsById.get(totemId) : undefined;
    if (!existing || !existing.isPaired || !existing.eventId) {
      return null;
    }

    const updated: TotemRecord = {
      ...structuredClone(existing),
      onlineStatus: 'online',
      lastSeenAt: this.nowIso(),
    };
    this.totemsById.set(updated.id, updated);
    await this.emitChannelEvent({ type: 'TELEMETRY_UPDATED', totem: updated });
    return structuredClone(updated);
  }

  async listTotems(): Promise<TotemRecord[]> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para listar Totens.');
    }
    return Array.from(this.totemsById.values())
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((totem) => structuredClone(totem));
  }

  async deleteTotems(totemIds: string[]): Promise<string[]> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para excluir Totens.');
    }
    const deleted: string[] = [];
    for (const id of new Set(totemIds)) {
      const existing = this.totemsById.get(id);
      if (this.totemsById.delete(id)) {
        if (existing) {
          this.totemIdByPairingCode.delete(existing.pairingCode);
        }
        deleted.push(id);
      }
    }
    return deleted;
  }

  async publishTotemHeartbeat(payload: TotemHeartbeatPayload): Promise<TotemRecord | null> {
    if (payload.onlineStatus === 'online' && !this.online) {
      throw new Error('Sem conectividade com a nuvem para publicar telemetria.');
    }

    const existing = this.totemsById.get(payload.totemId);
    const now = payload.seenAt ?? this.nowIso();

    const updated: TotemRecord = existing
      ? {
          ...structuredClone(existing),
          onlineStatus: payload.onlineStatus,
          currentScreen: payload.currentScreen,
          configVersion: payload.configVersion,
          pendingSyncCount: payload.pendingSyncCount,
          lastSeenAt: payload.onlineStatus === 'online' ? now : existing.lastSeenAt,
        }
      : {
          id: payload.totemId,
          name: payload.totemId,
          pairingCode: payload.totemId.slice(0, 6).toUpperCase(),
          deviceToken: payload.deviceToken ?? '',
          eventId: payload.eventId ?? Array.from(this.events.keys())[0] ?? null,
          pinCode: '0000',
          isPaired: true,
          onlineStatus: payload.onlineStatus,
          lastSeenAt: payload.onlineStatus === 'online' ? now : null,
          currentScreen: payload.currentScreen,
          configVersion: payload.configVersion,
          pendingSyncCount: payload.pendingSyncCount,
          createdAt: now,
        };

    this.totemsById.set(updated.id, updated);
    if (!this.totemIdByPairingCode.has(updated.pairingCode)) {
      this.totemIdByPairingCode.set(updated.pairingCode, updated.id);
    }

    await this.emitChannelEvent({ type: 'TELEMETRY_UPDATED', totem: updated });
    return structuredClone(updated);
  }

  async dispatchRemoteCommand(command: RemoteCommandPayload): Promise<RemoteCommandPayload> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para enviar comando remoto.');
    }

    const cloned = structuredClone(command);
    if (cloned.type === 'SWITCH_EVENT' && cloned.eventId) {
      for (const [id, totem] of this.totemsById.entries()) {
        const matches = cloned.targetTotemId
          ? totem.id === cloned.targetTotemId
          : Boolean(cloned.targetEventId && totem.eventId === cloned.targetEventId);
        if (matches) {
          this.totemsById.set(id, {
            ...totem,
            eventId: cloned.eventId,
          });
        }
      }
    }

    this.remoteCommands.push(cloned);
    await this.emitChannelEvent({ type: 'REMOTE_COMMAND', command: cloned });
    return structuredClone(cloned);
  }

  subscribeTotemChannel(listener: (event: TotemChannelEvent) => void | Promise<void>): () => void {
    this.channelListeners.add(listener);
    return () => {
      this.channelListeners.delete(listener);
    };
  }

  async listMatches(
    eventId?: string,
    options: ListMatchesQueryOptions = {},
  ): Promise<MatchRecord[]> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para listar Partidas.');
    }
    const includeAnswers = options.includeAnswers ?? true;
    const matches = this.getSyncedMatches(eventId);
    if (includeAnswers) {
      return matches;
    }
    return matches.map((match) => ({ ...match, answers: [] }));
  }

  async getMatchById(matchId: string): Promise<MatchRecord | null> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para consultar Partida.');
    }
    const found = Array.from(this.syncedMatchesByIdempotencyKey.values()).find(
      (entry) => entry.match.id === matchId,
    );
    return found ? structuredClone(found.match) : null;
  }

  async listMatchesByIds(matchIds: string[]): Promise<MatchRecord[]> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para consultar Partidas.');
    }
    const idSet = new Set(matchIds);
    return Array.from(this.syncedMatchesByIdempotencyKey.values())
      .filter((entry) => idSet.has(entry.match.id))
      .map((entry) => ({ ...structuredClone(entry.match), answers: [] }));
  }

  async listPrizeClaims(eventId?: string): Promise<PrizeClaimRecord[]> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para listar Brindes.');
    }
    return this.getPrizeClaims(eventId);
  }

  async listPrizeClaimsByIds(claimIds: string[]): Promise<PrizeClaimRecord[]> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para consultar Brindes.');
    }
    const idSet = new Set(claimIds);
    return this.getPrizeClaims().filter((claim) => idSet.has(claim.id));
  }

  async listGiveUpLockouts(eventId?: string): Promise<GiveUpLockoutRecord[]> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para listar Bloqueios por Desistência.');
    }
    return this.getLockouts(eventId);
  }

  async updatePrizeClaimsStatus(
    claimIds: string[],
    status: 'delivered' | 'revoked',
    deliveredAt?: string | null,
  ): Promise<PrizeClaimRecord[]> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para atualizar status de Brinde.');
    }

    const targetIds = new Set(claimIds);
    if (targetIds.size === 0) {
      return [];
    }

    const effectiveDeliveredAt = status === 'delivered' ? (deliveredAt ?? this.nowIso()) : null;
    const updatedClaims: PrizeClaimRecord[] = [];

    for (const [eventId, claims] of this.prizeClaimsByEvent.entries()) {
      const alreadyDeliveredKeys = new Set(
        claims
          .filter((claim) => claim.status === 'delivered')
          .map((claim) => toEventPhoneKey(claim.eventId, claim.participantPhone)),
      );
      const deliverableIds =
        status === 'delivered'
          ? new Set(
              selectDeliverableClaimIds(
                claims.filter((claim) => targetIds.has(claim.id)),
                alreadyDeliveredKeys,
              ),
            )
          : null;

      let eventModified = false;
      const nextClaims = claims.map((claim) => {
        if (!targetIds.has(claim.id)) {
          return claim;
        }

        if (status === 'delivered') {
          if (!deliverableIds?.has(claim.id)) {
            return claim;
          }
          const updated: PrizeClaimRecord = {
            ...structuredClone(claim),
            status: 'delivered',
            deliveredAt: effectiveDeliveredAt,
          };
          updatedClaims.push(structuredClone(updated));
          eventModified = true;
          return updated;
        }

        if (claim.status === 'revoked') {
          return claim;
        }

        const updated: PrizeClaimRecord = {
          ...structuredClone(claim),
          status: 'revoked',
          deliveredAt: null,
        };
        updatedClaims.push(structuredClone(updated));
        eventModified = true;
        return updated;
      });

      if (eventModified) {
        this.prizeClaimsByEvent.set(eventId, nextClaims);
      }
    }

    if (updatedClaims.length > 0) {
      await this.emitChannelEvent({ type: 'OPERATIONAL_DATA_UPDATED' });
    }

    return updatedClaims;
  }

  async expireGiveUpLockouts(eventId: string, participantPhones: string[]): Promise<number> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para destravar Bloqueios por Desistência.');
    }

    const phoneSet = new Set(participantPhones.map((phone) => phone.trim()).filter(Boolean));
    if (phoneSet.size === 0) {
      return 0;
    }

    const nowMs = Date.parse(this.nowIso());
    let updatedCount = 0;

    for (const [key, lockout] of this.lockoutsByIdempotencyKey.entries()) {
      if (lockout.eventId !== eventId || !phoneSet.has(lockout.participantPhone)) {
        continue;
      }

      const nextExpiresIso = computeExpiredLockoutIso(lockout.lockedAt, lockout.expiresAt, nowMs);
      if (nextExpiresIso) {
        this.lockoutsByIdempotencyKey.set(key, {
          ...structuredClone(lockout),
          expiresAt: nextExpiresIso,
        });
        updatedCount += 1;
      }
    }

    if (updatedCount > 0) {
      await this.emitChannelEvent({ type: 'OPERATIONAL_DATA_UPDATED', eventId });
    }

    return updatedCount;
  }

  async deleteMatches(matchIds: string[]): Promise<string[]> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para excluir Partidas.');
    }

    const matchIdSet = new Set(matchIds);
    if (matchIdSet.size === 0) {
      return [];
    }

    const deletedIds: string[] = [];
    for (const [key, entry] of this.syncedMatchesByIdempotencyKey.entries()) {
      if (matchIdSet.has(entry.match.id)) {
        deletedIds.push(entry.match.id);
        this.syncedMatchesByIdempotencyKey.delete(key);
      }
    }

    if (deletedIds.length > 0) {
      const deletedSet = new Set(deletedIds);
      for (const [eventId, claims] of this.prizeClaimsByEvent.entries()) {
        const remaining = claims.filter((claim) => !deletedSet.has(claim.matchId));
        if (remaining.length !== claims.length) {
          this.prizeClaimsByEvent.set(eventId, remaining);
        }
      }
      await this.emitChannelEvent({ type: 'OPERATIONAL_DATA_UPDATED' });
    }

    return deletedIds;
  }

  async uploadEventVisualAsset(
    input: EventVisualAssetUploadInput,
  ): Promise<{ url: string; fileName: string }> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para enviar imagem do Evento.');
    }

    const safeFileName = sanitizeAssetFileName(input.fileName);
    const url = `https://storage.local/event-assets/${input.eventId}/${input.kind}-${safeFileName}`;
    const dataUrl = bytesToDataUrl(input.bytes, input.mimeType);
    this.visualAssetsByUrl.set(url, { dataUrl, mimeType: input.mimeType });
    return { url, fileName: safeFileName };
  }

  async downloadVisualAsset(url: string): Promise<{ dataUrl: string; mimeType: string }> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para baixar imagem do Evento.');
    }
    const stored = this.visualAssetsByUrl.get(url);
    if (!stored) {
      throw new Error(`Ativo visual não encontrado na nuvem (${url}).`);
    }
    return structuredClone(stored);
  }

  async importOperationalRecords(payload: {
    matches: MatchRecord[];
    prizeClaims: PrizeClaimRecord[];
    lockouts: GiveUpLockoutRecord[];
    replaceEventIds?: string[];
  }): Promise<void> {
    if (!this.online) {
      throw new Error('Sem conectividade com a nuvem para importar registros de backup.');
    }

    const replaceSet = new Set(payload.replaceEventIds ?? []);
    if (replaceSet.size > 0) {
      for (const [key, entry] of this.syncedMatchesByIdempotencyKey.entries()) {
        if (replaceSet.has(entry.match.eventId)) {
          this.syncedMatchesByIdempotencyKey.delete(key);
        }
      }
      for (const eventId of replaceSet) {
        this.prizeClaimsByEvent.delete(eventId);
      }
      for (const [key, lockout] of this.lockoutsByIdempotencyKey.entries()) {
        if (replaceSet.has(lockout.eventId)) {
          this.lockoutsByIdempotencyKey.delete(key);
        }
      }
    }

    const syncedAt = this.nowIso();
    for (const match of payload.matches) {
      const persisted: MatchRecord = {
        ...structuredClone(match),
        syncedAt: match.syncedAt ?? syncedAt,
      };
      this.syncedMatchesByIdempotencyKey.set(persisted.id, {
        match: persisted,
        resolvedPrizeClaim: null,
        prizeStockRemaining: null,
      });
    }

    for (const claim of payload.prizeClaims) {
      const list = this.prizeClaimsByEvent.get(claim.eventId) ?? [];
      const idx = list.findIndex((item) => item.id === claim.id);
      if (idx >= 0) {
        list[idx] = structuredClone(claim);
      } else {
        list.push(structuredClone(claim));
      }
      this.prizeClaimsByEvent.set(claim.eventId, list);
    }

    for (const lockout of payload.lockouts) {
      this.lockoutsByIdempotencyKey.set(lockout.id, structuredClone(lockout));
    }

    await this.emitChannelEvent({ type: 'OPERATIONAL_DATA_UPDATED' });
  }
}
