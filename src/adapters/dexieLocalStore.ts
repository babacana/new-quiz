import Dexie, { type Table } from 'dexie';
import { resolveLockoutPhoneHash, resolvePrizeClaimPhoneHash } from '../domain/phoneHash';
import type {
  ApplyCloudEventSnapshotInput,
  CommitMatchLocallyInput,
  LocalStore,
} from '../domain/ports';
import type {
  CachedVisualAsset,
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
  phoneHash: string;
  awardedAt: string;
  claim: PrizeClaimRecord;
}

export interface StoredLockoutRow {
  id: string;
  eventId: string;
  phoneHash: string;
  expiresAt: string;
  lockout: GiveUpLockoutRecord;
}

function toStoredPrizeRow(claim: PrizeClaimRecord): StoredPrizeWinnerRow {
  const phoneHash = resolvePrizeClaimPhoneHash(claim);
  return {
    id: claim.id,
    eventId: claim.eventId,
    phoneHash,
    awardedAt: claim.awardedAt,
    claim: {
      ...structuredClone(claim),
      phoneHash,
    },
  };
}

function toStoredLockoutRow(lockout: GiveUpLockoutRecord): StoredLockoutRow {
  const phoneHash = resolveLockoutPhoneHash(lockout);
  return {
    id: lockout.id,
    eventId: lockout.eventId,
    phoneHash,
    expiresAt: lockout.expiresAt,
    lockout: {
      ...structuredClone(lockout),
      phoneHash,
    },
  };
}

// Banco local IndexedDB via Dexie seguindo a estrutura definida em docs/spec.md e ADR-0007.
export class TotemLocalDB extends Dexie {
  totemConfig!: Table<StoredTotemConfigRow, string>;
  localQuestions!: Table<StoredQuestionRow, [string, number]>;
  localMatches!: Table<StoredMatchRow, string>;
  localPrizeWinners!: Table<StoredPrizeWinnerRow, string>;
  localLockouts!: Table<StoredLockoutRow, string>;
  syncQueue!: Table<SyncQueueItem, string>;
  visualAssets!: Table<CachedVisualAsset, string>;

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
    this.version(2).stores({
      visualAssets: 'url, eventId',
    });
    // Migra índices de Travas de Brinde e Bloqueios para phoneHash (SHA-256) removendo telefones em texto plano.
    this.version(3)
      .stores({
        localPrizeWinners: 'id, [eventId+phoneHash], eventId',
        localLockouts: 'id, [eventId+phoneHash], eventId, expiresAt',
      })
      .upgrade(async (tx) => {
        await tx
          .table('localPrizeWinners')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            const claim = (row.claim ?? {}) as PrizeClaimRecord;
            if (claim.eventId) {
              const phoneHash = resolvePrizeClaimPhoneHash(claim);
              row.phoneHash = phoneHash;
              row.claim = {
                ...claim,
                participantName: '',
                participantPhone: '',
                phoneHash,
              };
            }
          });
        await tx
          .table('localLockouts')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            const lockout = (row.lockout ?? {}) as GiveUpLockoutRecord;
            if (lockout.eventId) {
              const phoneHash = resolveLockoutPhoneHash(lockout);
              row.phoneHash = phoneHash;
              row.lockout = {
                ...lockout,
                participantPhone: '',
                phoneHash,
              };
            }
          });
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

  async deleteMatch(matchId: string): Promise<void> {
    await this.db.localMatches.delete(matchId);
  }

  async getPrizeClaims(eventId: string): Promise<PrizeClaimRecord[]> {
    const rows = await this.db.localPrizeWinners.where('eventId').equals(eventId).toArray();
    return rows.map((row) => structuredClone(row.claim));
  }

  async savePrizeClaim(claim: PrizeClaimRecord): Promise<void> {
    await this.db.localPrizeWinners.put(toStoredPrizeRow(claim));
  }

  async deletePrizeClaim(claimId: string): Promise<void> {
    await this.db.localPrizeWinners.delete(claimId);
  }

  async getLockouts(eventId: string): Promise<GiveUpLockoutRecord[]> {
    const rows = await this.db.localLockouts.where('eventId').equals(eventId).toArray();
    return rows.map((row) => structuredClone(row.lockout));
  }

  async saveLockout(lockout: GiveUpLockoutRecord): Promise<void> {
    await this.db.localLockouts.put(toStoredLockoutRow(lockout));
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

  async getVisualAsset(url: string): Promise<CachedVisualAsset | null> {
    const row = await this.db.visualAssets.get(url);
    return row ? structuredClone(row) : null;
  }

  async saveVisualAsset(asset: CachedVisualAsset): Promise<void> {
    await this.db.visualAssets.put(structuredClone(asset));
  }

  async commitMatchLocally(input: CommitMatchLocallyInput): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.totemConfig,
        this.db.localMatches,
        this.db.localPrizeWinners,
        this.db.syncQueue,
      ],
      async () => {
        if (input.updatedTotemConfig) {
          await this.db.totemConfig.put({
            key: 'active',
            config: structuredClone(input.updatedTotemConfig),
          });
        }
        await this.db.localMatches.put({
          id: input.sanitizedMatch.id,
          eventId: input.sanitizedMatch.eventId,
          playedAt: input.sanitizedMatch.playedAt,
          match: structuredClone(input.sanitizedMatch),
        });
        if (input.sanitizedPrizeClaim) {
          await this.db.localPrizeWinners.put(toStoredPrizeRow(input.sanitizedPrizeClaim));
        }
        const existingSync = await this.db.syncQueue.get(input.syncItem.idempotencyKey);
        if (!existingSync) {
          await this.db.syncQueue.put(structuredClone(input.syncItem));
        }
      },
    );
  }

  async applyCloudEventSnapshot(input: ApplyCloudEventSnapshotInput): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.totemConfig,
        this.db.localQuestions,
        this.db.localMatches,
        this.db.localPrizeWinners,
        this.db.localLockouts,
      ],
      async () => {
        await this.db.totemConfig.put({
          key: 'active',
          config: structuredClone(input.totemConfig),
        });

        await this.db.localQuestions.where('eventId').equals(input.eventId).delete();
        if (input.questions.length > 0) {
          await this.db.localQuestions.bulkPut(
            input.questions.map((question) => ({
              eventId: input.eventId,
              id: question.id,
              question: structuredClone(question),
            })),
          );
        }

        if (input.matchIdsToDelete && input.matchIdsToDelete.length > 0) {
          await this.db.localMatches.bulkDelete(input.matchIdsToDelete);
        }
        if (input.matchesToPut && input.matchesToPut.length > 0) {
          await this.db.localMatches.bulkPut(
            input.matchesToPut.map((match) => ({
              id: match.id,
              eventId: match.eventId,
              playedAt: match.playedAt,
              match: structuredClone(match),
            })),
          );
        }

        if (input.prizeClaimIdsToDelete && input.prizeClaimIdsToDelete.length > 0) {
          await this.db.localPrizeWinners.bulkDelete(input.prizeClaimIdsToDelete);
        }
        if (input.prizeClaimsToPut && input.prizeClaimsToPut.length > 0) {
          await this.db.localPrizeWinners.bulkPut(
            input.prizeClaimsToPut.map((claim) => toStoredPrizeRow(claim)),
          );
        }

        if (input.lockoutsToPut && input.lockoutsToPut.length > 0) {
          await this.db.localLockouts.bulkPut(
            input.lockoutsToPut.map((lockout) => toStoredLockoutRow(lockout)),
          );
        }
      },
    );
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
