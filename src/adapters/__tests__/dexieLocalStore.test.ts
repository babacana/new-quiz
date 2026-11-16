import { afterEach, describe, expect, it } from 'vitest';
import { DexieLocalStore } from '../dexieLocalStore';
import { DEFAULT_EVENT_CONFIG, DEFAULT_EVENT_ID, DEFAULT_QUIZ_QUESTIONS } from '../../domain/defaults';
import type { GiveUpLockoutRecord, MatchRecord, PrizeClaimRecord } from '../../domain/types';

describe('DexieLocalStore', () => {
  const storesToClose: DexieLocalStore[] = [];

  afterEach(async () => {
    while (storesToClose.length > 0) {
      const store = storesToClose.pop();
      await store?.close();
    }
  });

  it('persiste e recupera configuração do Totem, Banco de Questões, Partidas, Brindes, Bloqueios e syncQueue', async () => {
    const dbName = `TotemLocalDB_Test_${Date.now()}_${Math.random()}`;
    const store = new DexieLocalStore(dbName);
    storesToClose.push(store);

    await store.saveTotemConfig({
      totemId: 'totem-dexie-1',
      deviceToken: 'device-token-1',
      pinCode: '4321',
      event: DEFAULT_EVENT_CONFIG,
    });
    const config = await store.getTotemConfig();
    expect(config?.totemId).toBe('totem-dexie-1');
    expect(config?.event.name).toBe(DEFAULT_EVENT_CONFIG.name);

    await store.saveQuestions(DEFAULT_EVENT_ID, DEFAULT_QUIZ_QUESTIONS.slice(0, 3));
    const storedQuestions = await store.getQuestions(DEFAULT_EVENT_ID);
    expect(storedQuestions).toHaveLength(3);
    expect(storedQuestions[0].text).toBe(DEFAULT_QUIZ_QUESTIONS[0].text);

    const match: MatchRecord = {
      id: 'match-id-1',
      eventId: DEFAULT_EVENT_ID,
      totemId: 'totem-dexie-1',
      participantName: 'ALINE',
      participantPhone: '(61) 99999-8888',
      score: 3,
      totalQuestions: 3,
      timeSeconds: 18,
      answers: [],
      playedAt: '2026-11-15T15:00:00.000Z',
      syncedAt: null,
    };

    await store.saveMatch(match);
    const storedMatches = await store.getMatches(DEFAULT_EVENT_ID);
    expect(storedMatches).toHaveLength(1);
    expect(storedMatches[0].id).toBe('match-id-1');

    const prizeClaim: PrizeClaimRecord = {
      id: 'claim-id-1',
      eventId: DEFAULT_EVENT_ID,
      matchId: 'match-id-1',
      totemId: 'totem-dexie-1',
      participantName: 'ALINE',
      participantPhone: '(61) 99999-8888',
      status: 'delivered',
      awardedAt: match.playedAt,
      deliveredAt: match.playedAt,
    };
    await store.savePrizeClaim(prizeClaim);
    const storedClaims = await store.getPrizeClaims(DEFAULT_EVENT_ID);
    expect(storedClaims).toHaveLength(1);
    expect(storedClaims[0].status).toBe('delivered');

    const lockout: GiveUpLockoutRecord = {
      id: 'lockout-id-1',
      eventId: DEFAULT_EVENT_ID,
      totemId: 'totem-dexie-1',
      participantPhone: '(61) 98888-7777',
      lockedAt: '2026-11-15T15:00:00.000Z',
      expiresAt: '2026-11-15T15:10:00.000Z',
    };
    await store.saveLockout(lockout);
    const storedLockouts = await store.getLockouts(DEFAULT_EVENT_ID);
    expect(storedLockouts).toHaveLength(1);
    expect(storedLockouts[0].participantPhone).toBe('(61) 98888-7777');

    await store.enqueueSyncItem({
      idempotencyKey: 'match-id-1',
      type: 'match_completed',
      eventId: DEFAULT_EVENT_ID,
      payload: match,
      prizeClaim,
      createdAt: match.playedAt,
      retryCount: 0,
    });

    // Enfileirar novamente com a mesma idempotencyKey não duplica na fila
    await store.enqueueSyncItem({
      idempotencyKey: 'match-id-1',
      type: 'match_completed',
      eventId: DEFAULT_EVENT_ID,
      payload: match,
      prizeClaim,
      createdAt: match.playedAt,
      retryCount: 0,
    });

    let queue = await store.getSyncQueue();
    expect(queue).toHaveLength(1);

    await store.incrementSyncRetry('match-id-1', 'Sem rede');
    queue = await store.getSyncQueue();
    expect(queue[0].retryCount).toBe(1);
    expect(queue[0].lastError).toBe('Sem rede');

    await store.markSyncItemCompleted('match-id-1');
    expect(await store.getSyncQueue()).toHaveLength(0);
  });
});
