import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_EVENT_CONFIG, DEFAULT_EVENT_ID } from '../../domain/defaults';
import { hashEventPhone } from '../../domain/phoneHash';
import type { GiveUpLockoutRecord, MatchRecord, PrizeClaimRecord } from '../../domain/types';
import { InMemoryCloudGateway } from '../inMemoryCloudGateway';
import { SupabaseAdminGateway } from '../supabaseAdminGateway';
import { SupabaseTotemGateway } from '../supabaseTotemGateway';

describe('Adaptadores Cloud e Gateways Supabase', () => {
  it('SupabaseTotemGateway invoca RPCs autenticadas por deviceToken e mapeia snapshot LGPD sem telefones', async () => {
    const httpSend = vi.fn().mockResolvedValue('ok');
    const removeChannel = vi.fn().mockResolvedValue('ok');

    const rpc = vi.fn((fnName: string) => {
      if (fnName === 'quiz_totem_pull_event_snapshot') {
        return {
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              event: {
                id: DEFAULT_EVENT_ID,
                name: 'Evento Supabase Mock',
                slug: 'evento-mock',
                start_time: null,
                end_time: null,
                enable_out_of_period_message: false,
                is_active: true,
                settings: DEFAULT_EVENT_CONFIG.settings,
                prize_stock_remaining: 15,
                customizations: DEFAULT_EVENT_CONFIG.customizations,
                config_version: 2,
              },
              questions: [
                {
                  id: 1,
                  text: 'Questão 1?',
                  options: ['A', 'B', 'C', 'D'],
                  correct_index: 0,
                  difficulty: 'facil',
                  tags: ['agua'],
                  is_disabled: false,
                },
              ],
              rankingMatches: [
                {
                  id: 'match-r1',
                  event_id: DEFAULT_EVENT_ID,
                  totem_id: 'totem-1',
                  participant_name: 'ANA',
                  score: 5,
                  total_questions: 5,
                  time_seconds: 14,
                  played_at: '2026-11-18T12:00:00.000Z',
                  synced_at: '2026-11-18T12:00:02.000Z',
                },
              ],
              prizeLocks: [
                {
                  id: 'claim-1',
                  event_id: DEFAULT_EVENT_ID,
                  match_id: 'match-r1',
                  phone_hash: hashEventPhone(DEFAULT_EVENT_ID, '61999990001'),
                  status: 'delivered',
                  awarded_at: '2026-11-18T12:00:02.000Z',
                  delivered_at: '2026-11-18T12:00:02.000Z',
                },
              ],
              lockouts: [
                {
                  id: 'lockout-1',
                  event_id: DEFAULT_EVENT_ID,
                  phone_hash: hashEventPhone(DEFAULT_EVENT_ID, '61988880002'),
                  locked_at: '2026-11-18T12:01:00.000Z',
                  expires_at: '2026-11-18T12:11:00.000Z',
                },
              ],
              pendingCommands: [
                {
                  id: 'cmd-1',
                  type: 'FORCE_SYNC',
                  target_totem_id: 'totem-1',
                  target_event_id: DEFAULT_EVENT_ID,
                  event_id: null,
                  target_screen: null,
                  issued_at: '2026-11-18T12:02:00.000Z',
                },
              ],
            },
            error: null,
          }),
        };
      }

      if (fnName === 'quiz_totem_push_match') {
        return {
          single: vi.fn().mockResolvedValue({
            data: {
              syncedAt: '2026-11-18T12:03:00.000Z',
              prizeStockRemaining: 14,
              resolvedPrizeClaim: {
                id: 'claim-push-1',
                event_id: DEFAULT_EVENT_ID,
                match_id: 'match-push-1',
                phone_hash: hashEventPhone(DEFAULT_EVENT_ID, '61977770003'),
                status: 'delivered',
                awarded_at: '2026-11-18T12:03:00.000Z',
                delivered_at: '2026-11-18T12:03:00.000Z',
              },
            },
            error: null,
          }),
        };
      }

      if (fnName === 'quiz_totem_push_give_up_lockout') {
        return {
          single: vi.fn().mockResolvedValue({
            data: { syncedAt: '2026-11-18T12:04:00.000Z' },
            error: null,
          }),
        };
      }

      throw new Error(`RPC inesperada: ${fnName}`);
    });

    const mockClient = {
      rpc,
      channel: vi.fn(() => ({ httpSend })),
      removeChannel,
    } as unknown as SupabaseClient;

    const gateway = new SupabaseTotemGateway('https://example.supabase.co', 'anon-key', mockClient);
    const snapshot = await gateway.pullEventSnapshot(DEFAULT_EVENT_ID, {
      totemId: 'totem-1',
      deviceToken: 'secret-token-1',
      commandsSince: '2026-11-18T11:55:00.000Z',
    });

    expect(rpc).toHaveBeenCalledWith('quiz_totem_pull_event_snapshot', {
      p_totem_id: 'totem-1',
      p_device_token: 'secret-token-1',
      p_event_id: DEFAULT_EVENT_ID,
      p_commands_since: '2026-11-18T11:55:00.000Z',
    });
    expect(snapshot?.event.name).toBe('Evento Supabase Mock');
    expect(snapshot?.rankingMatches).toHaveLength(1);
    expect(snapshot?.prizeLocks?.[0]?.phoneHash).toBe(hashEventPhone(DEFAULT_EVENT_ID, '61999990001'));
    expect(snapshot?.hashedLockouts?.[0]?.phoneHash).toBe(
      hashEventPhone(DEFAULT_EVENT_ID, '61988880002'),
    );
    expect(snapshot?.pendingCommands?.map((c) => c.id)).toEqual(['cmd-1']);

    const matchPayload: MatchRecord = {
      id: 'match-push-1',
      eventId: DEFAULT_EVENT_ID,
      totemId: 'totem-1',
      participantName: 'BRUNO',
      participantPhone: '(61) 97777-0003',
      score: 1,
      totalQuestions: 1,
      timeSeconds: 8,
      answers: [],
      playedAt: '2026-11-18T12:03:00.000Z',
      syncedAt: null,
    };
    const claimPayload: PrizeClaimRecord = {
      id: 'claim-push-1',
      eventId: DEFAULT_EVENT_ID,
      matchId: 'match-push-1',
      totemId: 'totem-1',
      participantName: 'BRUNO',
      participantPhone: '(61) 97777-0003',
      status: 'delivered',
      awardedAt: matchPayload.playedAt,
      deliveredAt: matchPayload.playedAt,
    };

    const pushed = await gateway.pushMatch({
      idempotencyKey: 'match-push-1',
      match: matchPayload,
      prizeClaim: claimPayload,
      auth: { totemId: 'totem-1', deviceToken: 'secret-token-1' },
    });

    expect(rpc).toHaveBeenCalledWith('quiz_totem_push_match', {
      p_totem_id: 'totem-1',
      p_device_token: 'secret-token-1',
      p_match: matchPayload,
      p_prize_claim: claimPayload,
    });
    expect(pushed.prizeStockRemaining).toBe(14);
    expect(pushed.resolvedPrizeClaim?.status).toBe('delivered');
    expect(httpSend).toHaveBeenCalledWith('OPERATIONAL_DATA_UPDATED', {
      type: 'OPERATIONAL_DATA_UPDATED',
      eventId: DEFAULT_EVENT_ID,
    });

    const lockoutPayload: GiveUpLockoutRecord = {
      id: 'lock-push-1',
      eventId: DEFAULT_EVENT_ID,
      totemId: 'totem-1',
      participantPhone: '(61) 96666-0004',
      lockedAt: '2026-11-18T12:04:00.000Z',
      expiresAt: '2026-11-18T12:14:00.000Z',
    };
    const lockoutRes = await gateway.pushGiveUpLockout({
      idempotencyKey: 'lock-push-1',
      lockout: lockoutPayload,
      auth: { totemId: 'totem-1', deviceToken: 'secret-token-1' },
    });

    expect(rpc).toHaveBeenCalledWith('quiz_totem_push_give_up_lockout', {
      p_totem_id: 'totem-1',
      p_device_token: 'secret-token-1',
      p_lockout: lockoutPayload,
    });
    expect(lockoutRes.syncedAt).toBe('2026-11-18T12:04:00.000Z');
  });

  it('SupabaseAdminGateway pagina via .range() além de 1.000 linhas e usa projeção enxuta sem answers', async () => {
    const selectedColumns: string[] = [];
    const requestedRanges: Array<[number, number]> = [];

    const totalRows = 1250;
    const allRows = Array.from({ length: totalRows }, (_, index) => ({
      id: `match-${index + 1}`,
      event_id: DEFAULT_EVENT_ID,
      totem_id: 'totem-1',
      participant_name: `PARTICIPANTE ${index + 1}`,
      participant_phone: '(61) 99999-0000',
      score: 4,
      total_questions: 5,
      time_seconds: 20,
      played_at: '2026-11-18T10:00:00.000Z',
      synced_at: '2026-11-18T10:00:05.000Z',
    }));

    const mockClient = {
      from: vi.fn(() => {
        const builder = {
          select: vi.fn((cols: string) => {
            selectedColumns.push(cols);
            return builder;
          }),
          order: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          range: vi.fn(async (from: number, to: number) => {
            requestedRanges.push([from, to]);
            return {
              data: allRows.slice(from, to + 1),
              error: null,
            };
          }),
        };
        return builder;
      }),
    } as unknown as SupabaseClient;

    const adminGateway = new SupabaseAdminGateway('https://example.supabase.co', 'anon-key', mockClient);
    const matches = await adminGateway.listMatches(DEFAULT_EVENT_ID, { includeAnswers: false });

    expect(matches).toHaveLength(1250);
    expect(requestedRanges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(selectedColumns[0]).not.toContain('answers');
    expect(matches[0].answers).toEqual([]);
  });

  it('InMemoryCloudGateway remove pairingCode ao excluir Totem e valida deviceToken em RPCs pareadas', async () => {
    const gateway = new InMemoryCloudGateway();
    const totem = await gateway.authorizeTotemPairing({
      id: 'totem-mem-1',
      pairingCode: 'MEM001',
      deviceToken: 'tok-mem-001',
      name: 'Totem Teste',
      pinCode: '1234',
      eventId: DEFAULT_EVENT_ID,
    });

    await expect(
      gateway.pullEventSnapshot(DEFAULT_EVENT_ID, {
        totemId: totem.id,
        deviceToken: 'token-invalido',
      }),
    ).rejects.toThrow(/device_token|autorizado|credenciais/i);

    const validSnap = await gateway.pullEventSnapshot(DEFAULT_EVENT_ID, {
      totemId: totem.id,
      deviceToken: totem.deviceToken,
    });
    expect(validSnap?.event.id).toBe(DEFAULT_EVENT_ID);

    // Excluir o Totem deve limpar também o índice por código de pareamento sem vazar entradas antigas.
    await gateway.deleteTotems([totem.id]);
    await expect(gateway.claimTotemPairing(totem.pairingCode)).resolves.toBeNull();
  });

  it('SupabaseAdminGateway lista ativos visuais de múltiplos Eventos no Storage e exclui pelo storagePath', async () => {
    const removedPaths: string[][] = [];

    const mockBucket = {
      list: vi.fn(async (folder: string) => {
        if (folder === '') {
          return {
            data: [
              { id: null, name: 'evt-1' },
              { id: null, name: 'evt-2' },
              { id: 'placeholder-id', name: '.emptyFolderPlaceholder' },
            ],
            error: null,
          };
        }
        if (folder === 'evt-1') {
          return {
            data: [
              {
                id: 'obj-1',
                name: 'logo-1790000001-logo-caesb.png',
                created_at: '2026-11-18T10:00:00.000Z',
                metadata: { size: 42000 },
              },
              {
                id: 'obj-2',
                name: 'background-1790000002-fundo-azul.png',
                created_at: '2026-11-18T11:00:00.000Z',
                metadata: { size: 312000 },
              },
            ],
            error: null,
          };
        }
        if (folder === 'evt-2') {
          return {
            data: [
              {
                id: 'obj-3',
                name: 'logo-1790000003-logo-feira.png',
                created_at: '2026-11-18T12:00:00.000Z',
                metadata: { size: 51000 },
              },
            ],
            error: null,
          };
        }
        return { data: [], error: null };
      }),
      getPublicUrl: vi.fn((storagePath: string) => ({
        data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/quiz_event_assets/${storagePath}` },
      })),
      remove: vi.fn(async (paths: string[]) => {
        removedPaths.push(paths);
        return { data: [], error: null };
      }),
    };

    const mockClient = {
      storage: {
        from: vi.fn(() => mockBucket),
      },
    } as unknown as SupabaseClient;

    const adminGateway = new SupabaseAdminGateway('https://example.supabase.co', 'anon-key', mockClient);

    const allAssets = await adminGateway.listEventVisualAssets();
    expect(allAssets).toHaveLength(3);
    // Ordenados do mais recente para o mais antigo
    expect(allAssets.map((a) => a.fileName)).toEqual([
      'logo-feira.png',
      'fundo-azul.png',
      'logo-caesb.png',
    ]);
    expect(allAssets[0].eventId).toBe('evt-2');
    expect(allAssets[0].kind).toBe('logo');
    expect(allAssets[0].sizeBytes).toBe(51000);

    // Filtra apenas logos do evt-1
    const evt1Logos = await adminGateway.listEventVisualAssets({ eventId: 'evt-1', kind: 'logo' });
    expect(evt1Logos).toHaveLength(1);
    expect(evt1Logos[0].fileName).toBe('logo-caesb.png');

    await adminGateway.deleteEventVisualAsset('evt-1/logo-1790000001-logo-caesb.png');
    expect(removedPaths).toEqual([['evt-1/logo-1790000001-logo-caesb.png']]);
  });
});
