import { afterEach, describe, expect, it } from 'vitest';
import { DexieLocalStore } from '../dexieLocalStore';
import { DEFAULT_EVENT_CONFIG, DEFAULT_EVENT_ID, DEFAULT_QUIZ_QUESTIONS } from '../../domain/defaults';
import { hashEventPhone } from '../../domain/phoneHash';
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

  it('executa commitMatchLocally e applyCloudEventSnapshot em transações atômicas preservando pendências locais', async () => {
    const dbName = `TotemLocalDB_Atomic_${Date.now()}_${Math.random()}`;
    const store = new DexieLocalStore(dbName);
    storesToClose.push(store);

    const pendingMatch: MatchRecord = {
      id: 'match-pending-1',
      eventId: DEFAULT_EVENT_ID,
      totemId: 'totem-dexie-2',
      participantName: 'CARLA',
      participantPhone: '(61) 98765-4321',
      score: 4,
      totalQuestions: 5,
      timeSeconds: 22,
      answers: [],
      playedAt: '2026-11-18T10:00:00.000Z',
      syncedAt: null,
    };

    const sanitizedMatch: MatchRecord = {
      ...pendingMatch,
      participantPhone: '',
      answers: [],
    };

    const pendingPhoneHash = hashEventPhone(DEFAULT_EVENT_ID, pendingMatch.participantPhone);
    const sanitizedClaim: PrizeClaimRecord = {
      id: 'claim-pending-1',
      eventId: DEFAULT_EVENT_ID,
      matchId: pendingMatch.id,
      totemId: 'totem-dexie-2',
      participantName: 'CARLA',
      participantPhone: '',
      phoneHash: pendingPhoneHash,
      status: 'delivered',
      awardedAt: pendingMatch.playedAt,
      deliveredAt: pendingMatch.playedAt,
    };

    await store.commitMatchLocally({
      sanitizedMatch,
      sanitizedPrizeClaim: sanitizedClaim,
      updatedTotemConfig: {
        totemId: 'totem-dexie-2',
        deviceToken: 'tok-2',
        pinCode: '1234',
        event: { ...DEFAULT_EVENT_CONFIG, prizeStockRemaining: 9 },
      },
      syncItem: {
        idempotencyKey: pendingMatch.id,
        type: 'match_completed',
        eventId: DEFAULT_EVENT_ID,
        payload: pendingMatch,
        prizeClaim: { ...sanitizedClaim, participantPhone: '(61) 98765-4321' },
        createdAt: pendingMatch.playedAt,
        retryCount: 0,
      },
    });

    expect((await store.getTotemConfig())?.event.prizeStockRemaining).toBe(9);
    expect(await store.getMatches(DEFAULT_EVENT_ID)).toHaveLength(1);
    expect(await store.getPrizeClaims(DEFAULT_EVENT_ID)).toHaveLength(1);
    expect(await store.getSyncQueue()).toHaveLength(1);

    // Prepara partida obsoleta local já sincronizada para testar limpeza no applyCloudEventSnapshot.
    await store.saveMatch({
      id: 'match-stale-synced',
      eventId: DEFAULT_EVENT_ID,
      totemId: 'totem-dexie-2',
      participantName: 'OBSOLETO',
      participantPhone: '',
      score: 1,
      totalQuestions: 5,
      timeSeconds: 50,
      answers: [],
      playedAt: '2026-11-18T09:00:00.000Z',
      syncedAt: '2026-11-18T09:00:05.000Z',
    });

    const cloudMatch: MatchRecord = {
      id: 'match-cloud-1',
      eventId: DEFAULT_EVENT_ID,
      totemId: 'totem-dexie-1',
      participantName: 'DANIEL',
      participantPhone: '',
      score: 5,
      totalQuestions: 5,
      timeSeconds: 15,
      answers: [],
      playedAt: '2026-11-18T10:05:00.000Z',
      syncedAt: '2026-11-18T10:05:01.000Z',
    };
    const cloudPhoneHash = hashEventPhone(DEFAULT_EVENT_ID, '(61) 91111-2222');
    const cloudClaim: PrizeClaimRecord = {
      id: 'claim-cloud-1',
      eventId: DEFAULT_EVENT_ID,
      matchId: cloudMatch.id,
      totemId: 'totem-dexie-1',
      participantName: '',
      participantPhone: '',
      phoneHash: cloudPhoneHash,
      status: 'delivered',
      awardedAt: cloudMatch.playedAt,
      deliveredAt: cloudMatch.playedAt,
    };

    await store.applyCloudEventSnapshot({
      eventId: DEFAULT_EVENT_ID,
      totemConfig: {
        totemId: 'totem-dexie-2',
        deviceToken: 'tok-2',
        pinCode: '1234',
        event: { ...DEFAULT_EVENT_CONFIG, configVersion: 3, prizeStockRemaining: 8 },
      },
      questions: DEFAULT_QUIZ_QUESTIONS.slice(0, 2),
      matchesToPut: [cloudMatch],
      matchIdsToDelete: ['match-stale-synced'],
      prizeClaimsToPut: [cloudClaim],
      lockoutsToPut: [
        {
          id: 'lockout-cloud-1',
          eventId: DEFAULT_EVENT_ID,
          totemId: null,
          participantPhone: '',
          phoneHash: cloudPhoneHash,
          lockedAt: '2026-11-18T10:01:00.000Z',
          expiresAt: '2026-11-18T10:11:00.000Z',
        },
      ],
    });

    const matchesAfter = await store.getMatches(DEFAULT_EVENT_ID);
    const matchIds = matchesAfter.map((m) => m.id).sort();
    expect(matchIds).toEqual(['match-cloud-1', 'match-pending-1']);
    expect((await store.getQuestions(DEFAULT_EVENT_ID))).toHaveLength(2);
    expect((await store.getPrizeClaims(DEFAULT_EVENT_ID)).map((c) => c.phoneHash)).toEqual(
      expect.arrayContaining([pendingPhoneHash, cloudPhoneHash]),
    );
    expect(await store.getLockouts(DEFAULT_EVENT_ID)).toHaveLength(1);
    expect((await store.getTotemConfig())?.event.configVersion).toBe(3);
  });
});
