import { DEFAULT_EVENT_CONFIG, DEFAULT_QUIZ_QUESTIONS } from '../domain/defaults';
import type { CloudEventSnapshot, CloudGateway } from '../domain/ports';
import type { EventConfig, MatchRecord, Question } from '../domain/types';

export interface InMemoryCloudGatewayOptions {
  online?: boolean;
  seedDefaultEvent?: boolean;
  nowIso?: () => string;
}

// Gateway em memória que simula a retaguarda em nuvem, queda de rede e idempotência.
export class InMemoryCloudGateway implements CloudGateway {
  private online: boolean;
  private readonly nowIso: () => string;
  private readonly events = new Map<string, EventConfig>();
  private readonly questionsByEvent = new Map<string, Question[]>();
  private readonly syncedMatchesByIdempotencyKey = new Map<string, MatchRecord>();

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
    };
  }

  async pushMatch(payload: {
    idempotencyKey: string;
    match: MatchRecord;
  }): Promise<{ syncedAt: string }> {
    if (!this.online) {
      throw new Error('Falha de rede ao sincronizar Partida com a nuvem.');
    }

    // Garante idempotência: reenvios da mesma chave retornam o registro original sem duplicar.
    const existing = this.syncedMatchesByIdempotencyKey.get(payload.idempotencyKey);
    if (existing) {
      return { syncedAt: existing.syncedAt ?? this.nowIso() };
    }

    const syncedAt = this.nowIso();
    const persistedMatch: MatchRecord = {
      ...structuredClone(payload.match),
      syncedAt,
    };
    this.syncedMatchesByIdempotencyKey.set(payload.idempotencyKey, persistedMatch);
    return { syncedAt };
  }

  getSyncedMatches(eventId?: string): MatchRecord[] {
    const all = Array.from(this.syncedMatchesByIdempotencyKey.values());
    const filtered = eventId ? all.filter((match) => match.eventId === eventId) : all;
    return filtered.map((match) => structuredClone(match));
  }
}
