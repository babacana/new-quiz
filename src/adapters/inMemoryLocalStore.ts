import type { LocalStore } from '../domain/ports';
import type {
  MatchRecord,
  Question,
  SyncQueueItem,
  TotemConfigSnapshot,
} from '../domain/types';

// Armazenamento local em memória para testes rápidos e desacoplados de IndexedDB.
export class InMemoryLocalStore implements LocalStore {
  private totemConfig: TotemConfigSnapshot | null = null;
  private questionsByEvent = new Map<string, Question[]>();
  private matchesByEvent = new Map<string, MatchRecord[]>();
  private syncQueue = new Map<string, SyncQueueItem>();

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
    const current = this.matchesByEvent.get(match.eventId) ?? [];
    const index = current.findIndex((item) => item.id === match.id);
    if (index >= 0) {
      current[index] = structuredClone(match);
    } else {
      current.push(structuredClone(match));
    }
    this.matchesByEvent.set(match.eventId, current);
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
}
