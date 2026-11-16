import { DEFAULT_EVENT_CONFIG, DEFAULT_QUIZ_QUESTIONS } from '../domain/defaults';
import type { CloudEventSnapshot, CloudGateway, PushMatchResponse } from '../domain/ports';
import type {
  EventConfig,
  GiveUpLockoutRecord,
  MatchRecord,
  PrizeClaimRecord,
  Question,
} from '../domain/types';

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

function isActivePrizeClaim(claim: PrizeClaimRecord): boolean {
  return claim.status === 'delivered' || claim.status === 'awaiting_pickup';
}

// Gateway em memória que simula a retaguarda em nuvem, queda de rede, idempotência e conflito offline.
export class InMemoryCloudGateway implements CloudGateway {
  private online: boolean;
  private readonly nowIso: () => string;
  private readonly events = new Map<string, EventConfig>();
  private readonly questionsByEvent = new Map<string, Question[]>();
  private readonly syncedMatchesByIdempotencyKey = new Map<string, StoredPushMatchResult>();
  private readonly prizeClaimsByEvent = new Map<string, PrizeClaimRecord[]>();
  private readonly lockoutsByIdempotencyKey = new Map<string, GiveUpLockoutRecord>();

  constructor(options: InMemoryCloudGatewayOptions = {}) {
    this.online = options.online ?? true;
    this.nowIso = options.nowIso ?? (() => new Date().toISOString());

    if (options.seedDefaultEvent ?? true) {
      this.seedEvent(DEFAULT_EVENT_CONFIG, DEFAULT_QUIZ_QUESTIONS);
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
    this.questionsByEvent.set(event.id, structuredClone(questions));
  }

  async pullEventSnapshot(eventId: string): Promise<CloudEventSnapshot | null> {
    if (!this.online) {
      throw new Error('Totem sem conectividade com a nuvem.');
    }
    const event = this.events.get(eventId);
    if (!event) {
      return null;
    }
    const questions = this.questionsByEvent.get(eventId) ?? [];
    return {
      event: structuredClone(event),
      questions: structuredClone(questions),
      matches: this.getSyncedMatches(eventId),
      prizeClaims: this.getPrizeClaims(eventId),
      lockouts: this.getLockouts(eventId),
    };
  }

  async pushMatch(payload: {
    idempotencyKey: string;
    match: MatchRecord;
    prizeClaim?: PrizeClaimRecord | null;
  }): Promise<PushMatchResponse> {
    if (!this.online) {
      throw new Error('Falha de rede ao sincronizar Partida com a nuvem.');
    }

    // Garante idempotência: reenvios da mesma chave retornam o resultado original sem duplicar.
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

      if (activeForPhone) {
        // Segundo Totem offline premiou o mesmo telefone: preserva Partida e sinaliza conflito.
        resolvedPrizeClaim = {
          ...structuredClone(payload.prizeClaim),
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
          status: 'revoked',
          deliveredAt: null,
        };
      } else {
        resolvedPrizeClaim = structuredClone(payload.prizeClaim);
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

    return {
      syncedAt,
      resolvedPrizeClaim: structuredClone(resolvedPrizeClaim),
      prizeStockRemaining,
    };
  }

  async pushGiveUpLockout(payload: {
    idempotencyKey: string;
    lockout: GiveUpLockoutRecord;
  }): Promise<{ syncedAt: string }> {
    if (!this.online) {
      throw new Error('Falha de rede ao sincronizar Bloqueio por Desistência.');
    }

    if (!this.lockoutsByIdempotencyKey.has(payload.idempotencyKey)) {
      this.lockoutsByIdempotencyKey.set(payload.idempotencyKey, structuredClone(payload.lockout));
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
}
