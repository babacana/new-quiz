import Dexie, { type Table } from 'dexie';
import type { LocalStore } from '../domain/ports';
import type {
  GiveUpLockoutRecord,
  MatchRecord,
  PrizeClaimRecord,
  Question,
  SyncQueueItem,
  TotemConfigSnapshot,
} from '../domain/types';

export interface StoredTotemConfigRow {
  key: string;
  config: TotemConfigSnapshot;
}

export interface StoredQuestionRow {
  eventId: string;
  id: number;
  question: Question;
}

export interface StoredMatchRow {
  id: string;
  eventId: string;
  playedAt: string;
  match: MatchRecord;
}

export interface StoredPrizeWinnerRow {
  id: string;
  eventId: string;
  participantPhone: string;
  awardedAt: string;
  claim: PrizeClaimRecord;
}

export interface StoredLockoutRow {
  id: string;
  eventId: string;
  participantPhone: string;
  expiresAt: string;
  lockout: GiveUpLockoutRecord;
}

// Banco local IndexedDB via Dexie seguindo a estrutura definida em docs/spec.md.
export class TotemLocalDB extends Dexie {
  totemConfig!: Table<StoredTotemConfigRow, string>;
  localQuestions!: Table<StoredQuestionRow, [string, number]>;
  localMatches!: Table<StoredMatchRow, string>;
  localPrizeWinners!: Table<StoredPrizeWinnerRow, string>;
  localLockouts!: Table<StoredLockoutRow, string>;
  syncQueue!: Table<SyncQueueItem, string>;

  constructor(dbName = 'TotemLocalDB') {
    super(dbName);
    this.version(1).stores({
      totemConfig: 'key',
      localQuestions: '[eventId+id], eventId',
      localMatches: 'id, eventId, playedAt',
      localPrizeWinners: 'id, [eventId+participantPhone], eventId',
      localLockouts: 'id, [eventId+participantPhone], eventId, expiresAt',
      syncQueue: 'idempotencyKey, createdAt, eventId',
    });
  }
}

// Adaptador de persistência local do Totem apoiado pelo IndexedDB/Dexie.
export class DexieLocalStore implements LocalStore {
  private readonly db: TotemLocalDB;

  constructor(dbName = 'TotemLocalDB') {
    this.db = new TotemLocalDB(dbName);
  }

  async getTotemConfig(): Promise<TotemConfigSnapshot | null> {
    const row = await this.db.totemConfig.get('active');
    return row ? structuredClone(row.config) : null;
  }

  async saveTotemConfig(config: TotemConfigSnapshot): Promise<void> {
    await this.db.totemConfig.put({
      key: 'active',
      config: structuredClone(config),
    });
  }

  async getQuestions(eventId: string): Promise<Question[]> {
    const rows = await this.db.localQuestions.where('eventId').equals(eventId).toArray();
    return rows.map((row) => structuredClone(row.question));
  }

  async saveQuestions(eventId: string, questions: Question[]): Promise<void> {
    await this.db.transaction('rw', this.db.localQuestions, async () => {
      await this.db.localQuestions.where('eventId').equals(eventId).delete();
      if (questions.length > 0) {
        const rows: StoredQuestionRow[] = questions.map((question) => ({
          eventId,
          id: question.id,
          question: structuredClone(question),
        }));
        await this.db.localQuestions.bulkPut(rows);
      }
    });
  }

  async getMatches(eventId: string): Promise<MatchRecord[]> {
    const rows = await this.db.localMatches.where('eventId').equals(eventId).toArray();
    return rows.map((row) => structuredClone(row.match));
  }

  async saveMatch(match: MatchRecord): Promise<void> {
    await this.db.localMatches.put({
      id: match.id,
      eventId: match.eventId,
      playedAt: match.playedAt,
      match: structuredClone(match),
    });
  }

  async getPrizeClaims(eventId: string): Promise<PrizeClaimRecord[]> {
    const rows = await this.db.localPrizeWinners.where('eventId').equals(eventId).toArray();
    return rows.map((row) => structuredClone(row.claim));
  }

  async savePrizeClaim(claim: PrizeClaimRecord): Promise<void> {
    await this.db.localPrizeWinners.put({
      id: claim.id,
      eventId: claim.eventId,
      participantPhone: claim.participantPhone,
      awardedAt: claim.awardedAt,
      claim: structuredClone(claim),
    });
  }

  async getLockouts(eventId: string): Promise<GiveUpLockoutRecord[]> {
    const rows = await this.db.localLockouts.where('eventId').equals(eventId).toArray();
    return rows.map((row) => structuredClone(row.lockout));
  }

  async saveLockout(lockout: GiveUpLockoutRecord): Promise<void> {
    await this.db.localLockouts.put({
      id: lockout.id,
      eventId: lockout.eventId,
      participantPhone: lockout.participantPhone,
      expiresAt: lockout.expiresAt,
      lockout: structuredClone(lockout),
    });
  }

  async getSyncQueue(): Promise<SyncQueueItem[]> {
    return this.db.syncQueue.orderBy('createdAt').toArray();
  }

  async enqueueSyncItem(item: SyncQueueItem): Promise<void> {
    const existing = await this.db.syncQueue.get(item.idempotencyKey);
    if (!existing) {
      await this.db.syncQueue.put(structuredClone(item));
    }
  }

  async markSyncItemCompleted(idempotencyKey: string): Promise<void> {
    await this.db.syncQueue.delete(idempotencyKey);
  }

  async incrementSyncRetry(idempotencyKey: string, errorMessage?: string): Promise<void> {
    const existing = await this.db.syncQueue.get(idempotencyKey);
    if (!existing) return;
    await this.db.syncQueue.put({
      ...existing,
      retryCount: existing.retryCount + 1,
      lastError: errorMessage,
    });
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
