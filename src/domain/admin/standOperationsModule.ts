import { computeAnalyticsDashboard, computeQuestionStatsReport } from '../analyticsCalculator';
import {
  isActivePrizeClaim,
  matchesParticipantSearch,
  normalizePhoneDigits,
  paginateItems,
  parseDateBoundary,
  sortRankingMatches,
  toEventPhoneKey,
} from '../operationalRules';
import type {
  ActiveGiveUpLockoutItem,
  AnalyticsDashboardResult,
  AnalyticsQueryOptions,
  EventConfig,
  GiveUpLockoutRecord,
  MatchRecord,
  OfflinePrizeConflictAlert,
  OperatorEventSnapshot,
  PaginatedParticipantReportResult,
  ParticipantMatchDetails,
  ParticipantPrizeFilter,
  ParticipantReportFilterOptions,
  ParticipantReportItem,
  ParticipantSortField,
  PrizeClaimRecord,
  QuestionStatsQueryOptions,
  QuestionStatsResult,
  RankingEntry,
} from '../types';
import { type AdminDomainContext, escapeCsvField } from './adminContext';
import type { EventCatalogModule } from './eventCatalogModule';

function isLockoutActiveAt(lockout: GiveUpLockoutRecord, referenceNowMs: number): boolean {
  const expiresMs = Date.parse(lockout.expiresAt);
  const lockedMs = Date.parse(lockout.lockedAt);
  if (!Number.isFinite(expiresMs)) {
    return false;
  }
  if (Number.isFinite(lockedMs) && expiresMs <= lockedMs) {
    return false;
  }
  return expiresMs > referenceNowMs;
}

function computeEventRankings(matches: MatchRecord[]): {
  rankingByEvent: Map<string, RankingEntry[]>;
  rankByMatchId: Map<string, number>;
} {
  const byEvent = new Map<string, MatchRecord[]>();
  for (const match of matches) {
    const list = byEvent.get(match.eventId) ?? [];
    list.push(match);
    byEvent.set(match.eventId, list);
  }

  const rankingByEvent = new Map<string, RankingEntry[]>();
  const rankByMatchId = new Map<string, number>();

  for (const [eventId, eventMatches] of byEvent.entries()) {
    const sorted = sortRankingMatches(eventMatches);
    const entries: RankingEntry[] = sorted.map((match, index) => {
      const position = index + 1;
      rankByMatchId.set(match.id, position);
      return {
        position,
        matchId: match.id,
        participantName: match.participantName,
        participantPhone: match.participantPhone,
        score: match.score,
        totalQuestions: match.totalQuestions,
        timeSeconds: match.timeSeconds,
        playedAt: match.playedAt,
      };
    });
    rankingByEvent.set(eventId, entries);
  }

  return { rankingByEvent, rankByMatchId };
}

function buildOfflineConflicts(
  eventsById: Map<string, EventConfig>,
  matchesById: Map<string, MatchRecord>,
  claims: PrizeClaimRecord[],
): OfflinePrizeConflictAlert[] {
  const activeClaimByEventPhone = new Map<string, PrizeClaimRecord>();
  const conflictClaimsByEventPhone = new Map<string, PrizeClaimRecord[]>();

  for (const claim of claims) {
    const key = toEventPhoneKey(claim.eventId, claim.participantPhone);
    if (isActivePrizeClaim(claim)) {
      activeClaimByEventPhone.set(key, claim);
    } else if (claim.status === 'offline_duplicate_conflict') {
      const list = conflictClaimsByEventPhone.get(key) ?? [];
      list.push(claim);
      conflictClaimsByEventPhone.set(key, list);
    }
  }

  const alerts: OfflinePrizeConflictAlert[] = [];
  for (const [key, conflicts] of conflictClaimsByEventPhone.entries()) {
    const sample = conflicts[0]!;
    const activeClaim = activeClaimByEventPhone.get(key) ?? null;
    const event = eventsById.get(sample.eventId);

    alerts.push({
      eventId: sample.eventId,
      eventName: event?.name ?? sample.eventId,
      participantPhone: sample.participantPhone,
      participantName: activeClaim?.participantName ?? sample.participantName,
      activeClaimId: activeClaim?.id ?? null,
      activeMatchId: activeClaim?.matchId ?? null,
      activePrizeStatus: activeClaim?.status ?? null,
      conflictClaims: [...conflicts]
        .sort((a, b) => a.awardedAt.localeCompare(b.awardedAt))
        .map((conflict) => {
          const match = matchesById.get(conflict.matchId);
          return {
            claimId: conflict.id,
            matchId: conflict.matchId,
            totemId: conflict.totemId,
            awardedAt: conflict.awardedAt,
            playedAt: match?.playedAt ?? null,
            score: match?.score ?? null,
          };
        }),
    });
  }

  return alerts.sort((a, b) => {
    const latestA = a.conflictClaims[a.conflictClaims.length - 1]?.awardedAt ?? '';
    const latestB = b.conflictClaims[b.conflictClaims.length - 1]?.awardedAt ?? '';
    return latestB.localeCompare(latestA);
  });
}

function buildParticipantReportItems(params: {
  eventsById: Map<string, EventConfig>;
  matches: MatchRecord[];
  claims: PrizeClaimRecord[];
  lockouts: GiveUpLockoutRecord[];
  nowMs: number;
}): {
  items: ParticipantReportItem[];
  rankingByEvent: Map<string, RankingEntry[]>;
  offlineConflicts: OfflinePrizeConflictAlert[];
} {
  const { eventsById, matches, claims, lockouts, nowMs } = params;
  const matchesById = new Map(matches.map((match) => [match.id, match]));
  const claimsByMatchId = new Map(claims.map((claim) => [claim.matchId, claim]));
  const { rankingByEvent, rankByMatchId } = computeEventRankings(matches);
  const offlineConflicts = buildOfflineConflicts(eventsById, matchesById, claims);

  const conflictPhonesByEvent = new Set(
    offlineConflicts.map((alert) => toEventPhoneKey(alert.eventId, alert.participantPhone)),
  );

  const activeLockoutByEventPhone = new Map<string, GiveUpLockoutRecord>();
  for (const lockout of lockouts) {
    if (!isLockoutActiveAt(lockout, nowMs)) {
      continue;
    }
    const key = toEventPhoneKey(lockout.eventId, lockout.participantPhone);
    const existing = activeLockoutByEventPhone.get(key);
    if (!existing || lockout.expiresAt > existing.expiresAt) {
      activeLockoutByEventPhone.set(key, lockout);
    }
  }

  const items: ParticipantReportItem[] = matches.map((match) => {
    const claim = claimsByMatchId.get(match.id) ?? null;
    const event = eventsById.get(match.eventId);
    const key = toEventPhoneKey(match.eventId, match.participantPhone);
    const activeLockout = activeLockoutByEventPhone.get(key) ?? null;

    return {
      matchId: match.id,
      eventId: match.eventId,
      eventName: event?.name ?? match.eventId,
      totemId: match.totemId,
      participantName: match.participantName,
      participantPhone: match.participantPhone,
      score: match.score,
      totalQuestions: match.totalQuestions,
      timeSeconds: match.timeSeconds,
      playedAt: match.playedAt,
      prizeClaimId: claim?.id ?? null,
      prizeStatus: claim?.status ?? null,
      awardedAt: claim?.awardedAt ?? null,
      deliveredAt: claim?.deliveredAt ?? null,
      hasOfflineConflict:
        claim?.status === 'offline_duplicate_conflict' || conflictPhonesByEvent.has(key),
      hasActiveGiveUpLockout: activeLockout !== null,
      activeLockoutExpiresAt: activeLockout?.expiresAt ?? null,
      rankingPosition: rankByMatchId.get(match.id) ?? 0,
    };
  });

  return { items, rankingByEvent, offlineConflicts };
}

function matchesPrizeFilter(
  item: ParticipantReportItem,
  prizeFilter: ParticipantPrizeFilter,
): boolean {
  switch (prizeFilter) {
    case 'all':
      return true;
    case 'winners':
      return item.prizeStatus === 'awaiting_pickup' || item.prizeStatus === 'delivered';
    case 'non_winners':
      return item.prizeStatus === null || item.prizeStatus === 'revoked';
    case 'awaiting_pickup':
      return item.prizeStatus === 'awaiting_pickup';
    case 'delivered':
      return item.prizeStatus === 'delivered';
    case 'revoked':
      return item.prizeStatus === 'revoked';
    case 'offline_conflict':
      return item.hasOfflineConflict;
  }
}

function compareParticipantReportItems(
  a: ParticipantReportItem,
  b: ParticipantReportItem,
  sortBy: ParticipantSortField,
  sortDirection: 'asc' | 'desc',
): number {
  const dir = sortDirection === 'asc' ? 1 : -1;

  if (sortBy === 'score') {
    if (a.score !== b.score) {
      return (a.score - b.score) * dir;
    }
    return a.timeSeconds - b.timeSeconds || a.playedAt.localeCompare(b.playedAt);
  }

  let cmp = 0;
  switch (sortBy) {
    case 'eventName':
      cmp = a.eventName.localeCompare(b.eventName, 'pt-BR');
      break;
    case 'participantName':
      cmp = a.participantName.localeCompare(b.participantName, 'pt-BR');
      break;
    case 'participantPhone':
      cmp = a.participantPhone.localeCompare(b.participantPhone);
      break;
    case 'timeSeconds':
      cmp = a.timeSeconds - b.timeSeconds;
      break;
    case 'prizeStatus':
      cmp = (a.prizeStatus ?? '').localeCompare(b.prizeStatus ?? '');
      break;
    case 'playedAt':
    default:
      cmp = a.playedAt.localeCompare(b.playedAt);
      break;
  }

  if (cmp !== 0) {
    return cmp * dir;
  }
  return b.playedAt.localeCompare(a.playedAt);
}

// Módulo de domínio responsável pela operação do estande, Brindes, conflitos, relatórios e métricas.
export class StandOperationsModule {
  private readonly ctx: AdminDomainContext;
  private readonly catalog: EventCatalogModule;

  constructor(ctx: AdminDomainContext, catalog: EventCatalogModule) {
    this.ctx = ctx;
    this.catalog = catalog;
  }

  private async fetchOperationalCloudData(
    eventId?: string,
    includeAnswers = false,
  ): Promise<{
    events: EventConfig[];
    eventsById: Map<string, EventConfig>;
    matches: MatchRecord[];
    claims: PrizeClaimRecord[];
    lockouts: GiveUpLockoutRecord[];
  }> {
    const [events, matches, claims, lockouts] = await Promise.all([
      this.ctx.cloudGateway.listEvents(),
      this.ctx.cloudGateway.listMatches(eventId, { includeAnswers }),
      this.ctx.cloudGateway.listPrizeClaims(eventId),
      this.ctx.cloudGateway.listGiveUpLockouts(eventId),
    ]);

    return {
      events,
      eventsById: new Map(events.map((event) => [event.id, event])),
      matches,
      claims,
      lockouts,
    };
  }

  async getOperatorDashboard(eventId?: string): Promise<OperatorEventSnapshot> {
    this.ctx.auth.requireStaff();

    let resolvedEventId = eventId;
    let events: EventConfig[] | null = null;
    if (!resolvedEventId) {
      events = await this.ctx.cloudGateway.listEvents();
      resolvedEventId = (events.find((ev) => ev.isActive) ?? events[0])?.id;
      if (!resolvedEventId) {
        throw new Error('Nenhum Evento cadastrado para operar no estande.');
      }
    }

    const { events: loadedEvents, eventsById, matches, claims, lockouts } =
      await this.fetchOperationalCloudData(resolvedEventId, false);
    const effectiveEvents = events ?? loadedEvents;
    const targetEvent = effectiveEvents.find((event) => event.id === resolvedEventId);

    if (!targetEvent) {
      throw new Error(`Evento não encontrado (${resolvedEventId}).`);
    }

    const eventMatches = matches.filter((match) => match.eventId === targetEvent.id);
    const eventClaims = claims.filter((claim) => claim.eventId === targetEvent.id);
    const eventLockouts = lockouts.filter((lockout) => lockout.eventId === targetEvent.id);
    const nowMs = this.ctx.clock ? this.ctx.clock.now() : Date.now();

    const { items, rankingByEvent, offlineConflicts } = buildParticipantReportItems({
      eventsById,
      matches: eventMatches,
      claims: eventClaims,
      lockouts: eventLockouts,
      nowMs,
    });

    const awaitingPickupQueue = items
      .filter((item) => item.prizeStatus === 'awaiting_pickup')
      .sort((a, b) => (a.awardedAt ?? a.playedAt).localeCompare(b.awardedAt ?? b.playedAt));

    const recentParticipants = [...items].sort((a, b) => b.playedAt.localeCompare(a.playedAt));

    return {
      event: targetEvent,
      awaitingPickupQueue,
      recentParticipants,
      ranking: rankingByEvent.get(targetEvent.id) ?? [],
      activeLockouts: eventLockouts.filter((lockout) => isLockoutActiveAt(lockout, nowMs)),
      offlineConflicts,
    };
  }

  private async applyPrizeStatusAndNotify(
    claimIds: string[],
    status: 'delivered' | 'revoked',
    deliveredAt: string | null,
  ): Promise<PrizeClaimRecord[]> {
    const updated = await this.ctx.cloudGateway.updatePrizeClaimsStatus(
      claimIds,
      status,
      deliveredAt,
    );
    const affectedEventIds = Array.from(new Set(updated.map((claim) => claim.eventId)));
    await Promise.all(
      affectedEventIds.map((eventId) => this.catalog.notifyOperationalEventUpdate(eventId)),
    );
    return updated;
  }

  async confirmPrizeDeliveries(claimIds: string[]): Promise<PrizeClaimRecord[]> {
    this.ctx.auth.requireStaff();
    return this.applyPrizeStatusAndNotify(claimIds, 'delivered', this.ctx.nowIso());
  }

  async revokePrizeClaims(claimIds: string[]): Promise<PrizeClaimRecord[]> {
    this.ctx.auth.requireStaff();
    const requestedIds = Array.from(new Set(claimIds));
    if (requestedIds.length === 0) {
      return [];
    }

    // Consulta apenas os Eventos afetados pelos IDs solicitados em vez de varrer todos os Eventos.
    const targetClaims = await this.ctx.cloudGateway.listPrizeClaimsByIds(requestedIds);
    const affectedEventIds = Array.from(new Set(targetClaims.map((claim) => claim.eventId)));
    const claimsByEvent = await Promise.all(
      affectedEventIds.map((eventId) => this.ctx.cloudGateway.listPrizeClaims(eventId)),
    );
    const scopedClaims = claimsByEvent.flat();

    const requestedSet = new Set(requestedIds);
    const remainingActiveKeys = new Set(
      scopedClaims
        .filter((claim) => !requestedSet.has(claim.id) && isActivePrizeClaim(claim))
        .map((claim) => toEventPhoneKey(claim.eventId, claim.participantPhone)),
    );
    const revokedKeys = new Set(
      scopedClaims
        .filter((claim) => requestedSet.has(claim.id))
        .map((claim) => toEventPhoneKey(claim.eventId, claim.participantPhone)),
    );

    const expandedClaimIds = new Set(requestedSet);
    for (const claim of scopedClaims) {
      if (claim.status !== 'offline_duplicate_conflict') {
        continue;
      }
      const key = toEventPhoneKey(claim.eventId, claim.participantPhone);
      if (revokedKeys.has(key) && !remainingActiveKeys.has(key)) {
        expandedClaimIds.add(claim.id);
      }
    }

    return this.applyPrizeStatusAndNotify(Array.from(expandedClaimIds), 'revoked', null);
  }

  async revokePhonePrizeInEvent(
    eventId: string,
    participantPhone: string,
  ): Promise<PrizeClaimRecord[]> {
    this.ctx.auth.requireStaff();
    const normalizedTargetDigits = normalizePhoneDigits(participantPhone);
    const targetTrimmed = participantPhone.trim();
    const claims = await this.ctx.cloudGateway.listPrizeClaims(eventId);
    const targetClaimIds = claims
      .filter(
        (claim) =>
          claim.status !== 'revoked' &&
          (claim.participantPhone === targetTrimmed ||
            (normalizedTargetDigits.length > 0 &&
              normalizePhoneDigits(claim.participantPhone) === normalizedTargetDigits)),
      )
      .map((claim) => claim.id);

    if (targetClaimIds.length === 0) {
      return [];
    }

    return this.revokePrizeClaims(targetClaimIds);
  }

  async unlockParticipantPhones(eventId: string, participantPhones: string[]): Promise<number> {
    this.ctx.auth.requireStaff();
    const unlockedCount = await this.ctx.cloudGateway.expireGiveUpLockouts(
      eventId,
      participantPhones,
    );
    if (unlockedCount > 0) {
      await this.catalog.notifyOperationalEventUpdate(eventId);
    }
    return unlockedCount;
  }

  async deleteParticipantMatches(matchIds: string[]): Promise<string[]> {
    this.ctx.auth.requireAdmin();
    const uniqueIds = Array.from(new Set(matchIds));
    if (uniqueIds.length === 0) {
      return [];
    }

    // Consulta escopada apenas pelos IDs alvo antes de excluir Partidas.
    const targetMatches = await this.ctx.cloudGateway.listMatchesByIds(uniqueIds);
    const affectedEventIds = Array.from(new Set(targetMatches.map((match) => match.eventId)));
    const affectedEventPhones = new Set(
      targetMatches.map((match) => toEventPhoneKey(match.eventId, match.participantPhone)),
    );

    const deletedIds = await this.ctx.cloudGateway.deleteMatches(uniqueIds);
    if (deletedIds.length > 0) {
      for (const eventId of affectedEventIds) {
        const remainingClaims = await this.ctx.cloudGateway.listPrizeClaims(eventId);
        const remainingActiveKeys = new Set(
          remainingClaims
            .filter((c) => isActivePrizeClaim(c))
            .map((c) => toEventPhoneKey(c.eventId, c.participantPhone)),
        );
        const orphanConflictIds = remainingClaims
          .filter(
            (c) =>
              c.status === 'offline_duplicate_conflict' &&
              affectedEventPhones.has(toEventPhoneKey(c.eventId, c.participantPhone)) &&
              !remainingActiveKeys.has(toEventPhoneKey(c.eventId, c.participantPhone)),
          )
          .map((c) => c.id);

        if (orphanConflictIds.length > 0) {
          await this.ctx.cloudGateway.updatePrizeClaimsStatus(orphanConflictIds, 'revoked', null);
        }

        await this.catalog.bumpEventConfigVersion(eventId);
      }
    }

    return deletedIds;
  }

  private async buildFilteredParticipantItems(
    options: ParticipantReportFilterOptions = {},
  ): Promise<{
    items: ParticipantReportItem[];
    offlineConflicts: OfflinePrizeConflictAlert[];
    activeLockouts: ActiveGiveUpLockoutItem[];
  }> {
    const scopedEventId =
      options.eventId && options.eventId !== 'all' ? options.eventId : undefined;
    const { eventsById, matches, claims, lockouts } = await this.fetchOperationalCloudData(
      scopedEventId,
      false,
    );

    const nowMs = this.ctx.clock ? this.ctx.clock.now() : Date.now();
    const { items, offlineConflicts } = buildParticipantReportItems({
      eventsById,
      matches,
      claims,
      lockouts,
      nowMs,
    });

    const searchRaw = options.search?.trim() ?? '';
    const startMs = parseDateBoundary(options.startDate, 'start');
    const endMs = parseDateBoundary(options.endDate, 'end');
    const prizeFilter = options.prizeFilter ?? 'all';
    const exactScore =
      typeof options.exactScore === 'number' && Number.isFinite(options.exactScore)
        ? options.exactScore
        : null;

    const filtered = items.filter((item) => {
      if (
        searchRaw &&
        !matchesParticipantSearch(item.participantName, item.participantPhone, searchRaw)
      ) {
        return false;
      }

      const playedMs = Date.parse(item.playedAt);
      if (startMs !== null && Number.isFinite(startMs) && playedMs < startMs) {
        return false;
      }
      if (endMs !== null && Number.isFinite(endMs) && playedMs > endMs) {
        return false;
      }

      if (!matchesPrizeFilter(item, prizeFilter)) {
        return false;
      }

      if (options.onlyLockedOut && !item.hasActiveGiveUpLockout) {
        return false;
      }

      if (exactScore !== null && item.score !== exactScore) {
        return false;
      }

      return true;
    });

    const sortBy = options.sortBy ?? 'playedAt';
    const sortDirection = options.sortDirection ?? 'desc';
    const sorted = [...filtered].sort((a, b) =>
      compareParticipantReportItems(a, b, sortBy, sortDirection),
    );

    const activeLockouts: ActiveGiveUpLockoutItem[] = lockouts
      .filter((lockout) => {
        if (!isLockoutActiveAt(lockout, nowMs)) {
          return false;
        }
        if (searchRaw && !matchesParticipantSearch('', lockout.participantPhone, searchRaw)) {
          return false;
        }
        const lockedMs = Date.parse(lockout.lockedAt);
        if (startMs !== null && Number.isFinite(startMs) && lockedMs < startMs) {
          return false;
        }
        if (endMs !== null && Number.isFinite(endMs) && lockedMs > endMs) {
          return false;
        }
        return true;
      })
      .map((lockout) => ({
        ...lockout,
        eventName: eventsById.get(lockout.eventId)?.name ?? lockout.eventId,
      }));

    return { items: sorted, offlineConflicts, activeLockouts };
  }

  async queryParticipantReports(
    options: ParticipantReportFilterOptions = {},
  ): Promise<PaginatedParticipantReportResult> {
    this.ctx.auth.requireStaff();
    const { items, offlineConflicts, activeLockouts } =
      await this.buildFilteredParticipantItems(options);

    const paginated = paginateItems(items, options.page ?? 1, options.pageSize ?? 20);
    return {
      items: paginated.items,
      totalItems: paginated.totalItems,
      page: paginated.currentPage,
      pageSize: paginated.pageSize,
      totalPages: paginated.totalPages,
      offlineConflicts,
      activeLockouts,
    };
  }

  async getParticipantMatchDetails(matchId: string): Promise<ParticipantMatchDetails> {
    this.ctx.auth.requireStaff();
    const targetMatch = await this.ctx.cloudGateway.getMatchById(matchId);
    if (!targetMatch) {
      throw new Error(`Partida não encontrada (${matchId}).`);
    }

    const [events, eventMatches, eventClaims, eventLockouts] = await Promise.all([
      this.ctx.cloudGateway.listEvents(),
      this.ctx.cloudGateway.listMatches(targetMatch.eventId, { includeAnswers: false }),
      this.ctx.cloudGateway.listPrizeClaims(targetMatch.eventId),
      this.ctx.cloudGateway.listGiveUpLockouts(targetMatch.eventId),
    ]);

    const eventsById = new Map(events.map((event) => [event.id, event]));
    const nowMs = this.ctx.clock ? this.ctx.clock.now() : Date.now();

    const { items } = buildParticipantReportItems({
      eventsById,
      matches: eventMatches,
      claims: eventClaims,
      lockouts: eventLockouts,
      nowMs,
    });

    const targetItem = items.find((item) => item.matchId === matchId);
    if (!targetItem) {
      throw new Error(`Dados da Partida não encontrados (${matchId}).`);
    }

    const matchesAtOccasion = eventMatches.filter(
      (match) => match.playedAt <= targetMatch.playedAt,
    );
    const { rankByMatchId: occasionRanks } = computeEventRankings(matchesAtOccasion);
    const totalMatchesByPhoneInEvent = eventMatches.filter(
      (match) => match.participantPhone === targetMatch.participantPhone,
    ).length;

    return {
      ...targetItem,
      rankingPosition: occasionRanks.get(matchId) ?? targetItem.rankingPosition,
      totalMatchesByPhoneInEvent,
      answers: structuredClone(targetMatch.answers),
    };
  }

  async exportParticipantsCsv(options: ParticipantReportFilterOptions = {}): Promise<string> {
    this.ctx.auth.requireStaff();
    const { items } = await this.buildFilteredParticipantItems(options);
    const headers = [
      'matchId',
      'eventId',
      'eventName',
      'participantName',
      'participantPhone',
      'score',
      'totalQuestions',
      'timeSeconds',
      'rankingPosition',
      'playedAt',
      'prizeStatus',
      'deliveredAt',
      'hasOfflineConflict',
      'hasActiveGiveUpLockout',
    ];

    const lines = [
      headers.join(','),
      ...items.map((item) =>
        [
          item.matchId,
          item.eventId,
          item.eventName,
          item.participantName,
          item.participantPhone,
          item.score,
          item.totalQuestions,
          item.timeSeconds,
          item.rankingPosition,
          item.playedAt,
          item.prizeStatus ?? 'none',
          item.deliveredAt ?? '',
          item.hasOfflineConflict,
          item.hasActiveGiveUpLockout,
        ]
          .map((value) => escapeCsvField(value))
          .join(','),
      ),
    ];

    return lines.join('\n');
  }

  async exportParticipantsJson(options: ParticipantReportFilterOptions = {}): Promise<string> {
    this.ctx.auth.requireStaff();
    const { items } = await this.buildFilteredParticipantItems(options);
    return JSON.stringify(items, null, 2);
  }

  async queryAnalyticsDashboard(
    options: AnalyticsQueryOptions = {},
  ): Promise<AnalyticsDashboardResult> {
    this.ctx.auth.requireAdmin();
    const scopedEventId =
      options.eventId && options.eventId !== 'all' ? options.eventId : undefined;
    const [events, questions, matches] = await Promise.all([
      this.ctx.cloudGateway.listEvents(),
      this.ctx.cloudGateway.listAllQuestions(),
      this.ctx.cloudGateway.listMatches(scopedEventId, { includeAnswers: true }),
    ]);
    const nowMs = this.ctx.clock ? this.ctx.clock.now() : Date.now();
    return computeAnalyticsDashboard({ events, questions, matches, options, nowMs });
  }

  async queryQuestionStats(
    options: QuestionStatsQueryOptions = {},
  ): Promise<QuestionStatsResult> {
    this.ctx.auth.requireAdmin();
    const scopedEventId =
      options.eventId && options.eventId !== 'all' ? options.eventId : undefined;
    const [questions, matches] = await Promise.all([
      this.ctx.cloudGateway.listAllQuestions(),
      this.ctx.cloudGateway.listMatches(scopedEventId, { includeAnswers: true }),
    ]);
    return computeQuestionStatsReport({ questions, matches, options });
  }
}
