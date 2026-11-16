import type { LocalStore } from '../domain/ports';
import type {
  CachedVisualAsset,
  GiveUpLockoutRecord,
  MatchRecord,
  PrizeClaimRecord,
  Question,
  SyncQueueItem,
  TotemConfigSnapshot,
} from '../domain/types';

// Armazenamento local em memória para testes rápidos e desacoplados de IndexedDB.
export class InMemoryLocalStore implements LocalStore {
  private totemConfig: TotemConfigSnapshot | null = null;
  private questionsByEvent = new Map<string, Question[]>();
  private matchesByEvent = new Map<string, MatchRecord[]>();
  private prizeClaimsByEvent = new Map<string, PrizeClaimRecord[]>();
  private lockoutsByEvent = new Map<string, GiveUpLockoutRecord[]>();
  private syncQueue = new Map<string, SyncQueueItem>();
  private visualAssetsByUrl = new Map<string, CachedVisualAsset>();

  async getTotemConfig(): Promise<TotemConfigSnapshot | null> {
    return this.totemConfig ? structuredClone(this.totemConfig) : null;
  }

  async saveTotemConfig(config: TotemConfigSnapshot): Promise<void> {
    this.totemConfig = structuredClone(config);
  }

  async getQuestions(eventId: string): Promise<Question[]> {
    return structuredClone(this.questionsByEvent.get(eventId) ?? []);
  }

  async saveQuestions(eventId: string, questions: Question[]): Promise<void> {
    this.questionsByEvent.set(eventId, structuredClone(questions));
  }

  async getMatches(eventId: string): Promise<MatchRecord[]> {
    return structuredClone(this.matchesByEvent.get(eventId) ?? []);
  }

  async saveMatch(match: MatchRecord): Promise<void> {
    this.upsertRecord(this.matchesByEvent, match.eventId, match);
  }

  async deleteMatch(matchId: string): Promise<void> {
    this.deleteRecord(this.matchesByEvent, matchId);
  }

  async getPrizeClaims(eventId: string): Promise<PrizeClaimRecord[]> {
    return structuredClone(this.prizeClaimsByEvent.get(eventId) ?? []);
  }

  async savePrizeClaim(claim: PrizeClaimRecord): Promise<void> {
    this.upsertRecord(this.prizeClaimsByEvent, claim.eventId, claim);
  }

  async deletePrizeClaim(claimId: string): Promise<void> {
    this.deleteRecord(this.prizeClaimsByEvent, claimId);
  }

  async getLockouts(eventId: string): Promise<GiveUpLockoutRecord[]> {
    return structuredClone(this.lockoutsByEvent.get(eventId) ?? []);
  }

  async saveLockout(lockout: GiveUpLockoutRecord): Promise<void> {
    this.upsertRecord(this.lockoutsByEvent, lockout.eventId, lockout);
  }

  private upsertRecord<T extends { id: string }>(
    store: Map<string, T[]>,
    eventId: string,
    record: T,
  ): void {
    const current = store.get(eventId) ?? [];
    const index = current.findIndex((item) => item.id === record.id);
    if (index >= 0) {
      current[index] = structuredClone(record);
    } else {
      current.push(structuredClone(record));
    }
    store.set(eventId, current);
  }

  private deleteRecord<T extends { id: string }>(
    store: Map<string, T[]>,
    recordId: string,
  ): void {
    for (const [eventId, records] of store.entries()) {
      const remaining = records.filter((item) => item.id !== recordId);
      if (remaining.length !== records.length) {
        store.set(eventId, remaining);
      }
    }
  }

  async getSyncQueue(): Promise<SyncQueueItem[]> {
    return Array.from(this.syncQueue.values())
      .map((item) => structuredClone(item))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async enqueueSyncItem(item: SyncQueueItem): Promise<void> {
    if (!this.syncQueue.has(item.idempotencyKey)) {
      this.syncQueue.set(item.idempotencyKey, structuredClone(item));
    }
  }

  async markSyncItemCompleted(idempotencyKey: string): Promise<void> {
    this.syncQueue.delete(idempotencyKey);
  }

  async incrementSyncRetry(idempotencyKey: string, errorMessage?: string): Promise<void> {
    const existing = this.syncQueue.get(idempotencyKey);
    if (!existing) return;
    this.syncQueue.set(idempotencyKey, {
      ...existing,
      retryCount: existing.retryCount + 1,
      lastError: errorMessage,
    });
  }

  async getVisualAsset(url: string): Promise<CachedVisualAsset | null> {
    const found = this.visualAssetsByUrl.get(url);
    return found ? structuredClone(found) : null;
  }

  async saveVisualAsset(asset: CachedVisualAsset): Promise<void> {
    this.visualAssetsByUrl.set(asset.url, structuredClone(asset));
  }
}
