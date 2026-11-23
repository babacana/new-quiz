import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePairingCode } from '../domain/pairingUtils';
import type {
  CloudEventSnapshot,
  PushMatchResponse,
  TotemAuthContext,
  TotemCloudPort,
} from '../domain/ports';
import type {
  GiveUpLockoutRecord,
  MatchRecord,
  PrizeClaimRecord,
  PrizeClaimStatus,
  RemoteCommandPayload,
  TotemChannelEvent,
  TotemHeartbeatPayload,
  TotemLockoutRecord,
  TotemPairingRequestInput,
  TotemPrizeLockRecord,
  TotemRankingMatch,
  TotemRecord,
} from '../domain/types';
import { bytesToDataUrl } from '../domain/visualAssetUtils';
import {
  getSharedSupabaseClient,
  isBrowserNavigatorOnline,
  mapCommandRow,
  mapEventRow,
  mapQuestionRow,
  mapTotemRow,
  SupabaseRealtimeHub,
  type SupabaseEventRow,
  type SupabaseQuestionRow,
  type SupabaseTotemCommandRow,
  type SupabaseTotemRow,
} from './supabaseClient';

interface RpcRankingMatchRow {
  id: string;
  event_id: string;
  totem_id: string | null;
  participant_name: string;
  score: number;
  total_questions: number;
  time_seconds: number;
  played_at: string;
  synced_at: string | null;
}

interface RpcPrizeLockRow {
  id: string;
  event_id: string;
  match_id: string;
  totem_id?: string | null;
  phone_hash: string;
  status: PrizeClaimStatus;
  awarded_at: string;
  delivered_at: string | null;
}

interface RpcLockoutRow {
  id: string;
  event_id: string;
  phone_hash: string;
  locked_at: string;
  expires_at: string;
}

interface RpcPullSnapshotPayload {
  event: SupabaseEventRow;
  questions: SupabaseQuestionRow[];
  rankingMatches: RpcRankingMatchRow[];
  prizeLocks: RpcPrizeLockRow[];
  lockouts: RpcLockoutRow[];
  pendingCommands: SupabaseTotemCommandRow[];
}

interface RpcPushMatchPayload {
  syncedAt: string;
  resolvedPrizeClaim: RpcPrizeLockRow | null;
  prizeStockRemaining: number | null;
}

// Adaptador enxuto do Totem público via borda RPC autenticada por (totem_id, device_token).
export class SupabaseTotemGateway implements TotemCloudPort {
  private readonly client: SupabaseClient;
  private readonly realtimeHub: SupabaseRealtimeHub;

  constructor(supabaseUrl: string, supabaseAnonKey: string, client?: SupabaseClient) {
    this.client = client ?? getSharedSupabaseClient(supabaseUrl, supabaseAnonKey);
    this.realtimeHub = new SupabaseRealtimeHub(this.client, false);
  }

  isOnline(): boolean {
    return isBrowserNavigatorOnline();
  }

  private resolveAuthCredentials(
    explicit?: TotemAuthContext,
    fallbackTotemId?: string | null,
  ): { totemId: string; deviceToken: string } | null {
    const totemId = explicit?.totemId ?? fallbackTotemId ?? null;
    const deviceToken = explicit?.deviceToken ?? null;
    if (!totemId || !deviceToken) {
      return null;
    }
    return { totemId, deviceToken };
  }

  async pullEventSnapshot(
    eventId: string,
    auth?: TotemAuthContext,
  ): Promise<CloudEventSnapshot | null> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade.');
    }

    const credentials = this.resolveAuthCredentials(auth);
    if (!credentials) {
      // Sem Pareamento concluído não há credenciais para a borda RPC; o Banco de Questões não é público.
      return null;
    }

    const { data, error } = await this.client
      .rpc('quiz_totem_pull_event_snapshot', {
        p_totem_id: credentials.totemId,
        p_device_token: credentials.deviceToken,
        p_event_id: eventId,
        p_commands_since: auth?.commandsSince ?? null,
      })
      .maybeSingle<RpcPullSnapshotPayload>();

    if (error) {
      throw new Error(`Erro ao baixar snapshot do Evento no Supabase: ${error.message}`);
    }
    if (!data || !data.event) {
      return null;
    }

    const rankingMatches: TotemRankingMatch[] = (data.rankingMatches ?? []).map((row) => ({
      id: row.id,
      eventId: row.event_id,
      totemId: row.totem_id,
      participantName: row.participant_name,
      score: row.score,
      totalQuestions: row.total_questions,
      timeSeconds: row.time_seconds,
      playedAt: row.played_at,
      syncedAt: row.synced_at,
    }));

    const prizeLocks: TotemPrizeLockRecord[] = (data.prizeLocks ?? []).map((row) => ({
      id: row.id,
      eventId: row.event_id,
      matchId: row.match_id,
      phoneHash: row.phone_hash,
      status: row.status,
      awardedAt: row.awarded_at,
      deliveredAt: row.delivered_at,
    }));

    const hashedLockouts: TotemLockoutRecord[] = (data.lockouts ?? []).map((row) => ({
      id: row.id,
      eventId: row.event_id,
      phoneHash: row.phone_hash,
      lockedAt: row.locked_at,
      expiresAt: row.expires_at,
    }));

    const pendingCommands: RemoteCommandPayload[] = (data.pendingCommands ?? []).map(mapCommandRow);

    return {
      event: mapEventRow(data.event),
      questions: (data.questions ?? []).map(mapQuestionRow),
      rankingMatches,
      prizeLocks,
      hashedLockouts,
      pendingCommands,
    };
  }

  async pushMatch(payload: {
    idempotencyKey: string;
    match: MatchRecord;
    prizeClaim?: PrizeClaimRecord | null;
    auth?: TotemAuthContext;
  }): Promise<PushMatchResponse> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para sincronizar Partida.');
    }

    const credentials = this.resolveAuthCredentials(payload.auth, payload.match.totemId);
    if (!credentials) {
      throw new Error('Totem sem credenciais de Pareamento para sincronizar Partida.');
    }

    const { data, error } = await this.client
      .rpc('quiz_totem_push_match', {
        p_totem_id: credentials.totemId,
        p_device_token: credentials.deviceToken,
        p_match: payload.match,
        p_prize_claim: payload.prizeClaim ?? null,
      })
      .single<RpcPushMatchPayload>();

    if (error || !data) {
      throw new Error(
        `Erro ao sincronizar Partida no Supabase: ${error?.message ?? 'sem retorno.'}`,
      );
    }

    await this.realtimeHub.broadcast({
      type: 'OPERATIONAL_DATA_UPDATED',
      eventId: payload.match.eventId,
    });

    const resolvedPrizeClaim: TotemPrizeLockRecord | null = data.resolvedPrizeClaim
      ? {
          id: data.resolvedPrizeClaim.id,
          eventId: data.resolvedPrizeClaim.event_id,
          matchId: data.resolvedPrizeClaim.match_id,
          phoneHash: data.resolvedPrizeClaim.phone_hash,
          status: data.resolvedPrizeClaim.status,
          awardedAt: data.resolvedPrizeClaim.awarded_at,
          deliveredAt: data.resolvedPrizeClaim.delivered_at,
        }
      : null;

    return {
      syncedAt: data.syncedAt,
      resolvedPrizeClaim,
      prizeStockRemaining: data.prizeStockRemaining,
    };
  }

  async pushGiveUpLockout(payload: {
    idempotencyKey: string;
    lockout: GiveUpLockoutRecord;
    auth?: TotemAuthContext;
  }): Promise<{ syncedAt: string }> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para sincronizar Bloqueio por Desistência.');
    }

    const credentials = this.resolveAuthCredentials(payload.auth, payload.lockout.totemId);
    if (!credentials) {
      throw new Error('Totem sem credenciais de Pareamento para sincronizar Bloqueio.');
    }

    const { data, error } = await this.client
      .rpc('quiz_totem_push_give_up_lockout', {
        p_totem_id: credentials.totemId,
        p_device_token: credentials.deviceToken,
        p_lockout: payload.lockout,
      })
      .single<{ syncedAt: string }>();

    if (error || !data) {
      throw new Error(
        `Erro ao sincronizar Bloqueio por Desistência: ${error?.message ?? 'sem retorno.'}`,
      );
    }

    await this.realtimeHub.broadcast({
      type: 'OPERATIONAL_DATA_UPDATED',
      eventId: payload.lockout.eventId,
    });

    return { syncedAt: data.syncedAt };
  }

  async requestTotemPairing(input: TotemPairingRequestInput): Promise<TotemRecord> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para solicitar Pareamento.');
    }

    const { data, error } = await this.client
      .rpc('quiz_request_totem_pairing', {
        p_id: input.id,
        p_pairing_code: normalizePairingCode(input.pairingCode),
        p_current_screen: input.currentScreen,
        p_config_version: input.configVersion,
        p_pending_sync_count: input.pendingSyncCount,
      })
      .single<SupabaseTotemRow>();

    if (error || !data) {
      throw new Error(
        `Erro ao solicitar Pareamento no Supabase: ${error?.message ?? 'sem retorno.'}`,
      );
    }

    const record = mapTotemRow(data);
    await this.realtimeHub.broadcast({ type: 'TELEMETRY_UPDATED', totem: record });
    return record;
  }

  async claimTotemPairing(pairingCode: string): Promise<TotemRecord | null> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para ativar Pareamento.');
    }

    const { data, error } = await this.client
      .rpc('quiz_claim_totem_pairing', {
        p_pairing_code: normalizePairingCode(pairingCode),
      })
      .maybeSingle<SupabaseTotemRow>();

    if (error) {
      throw new Error(`Erro ao validar código de ativação: ${error.message}`);
    }
    if (!data) {
      return null;
    }

    const record = mapTotemRow(data);
    await this.realtimeHub.broadcast({ type: 'TELEMETRY_UPDATED', totem: record });
    return record;
  }

  async publishTotemHeartbeat(payload: TotemHeartbeatPayload): Promise<TotemRecord | null> {
    if (!this.isOnline()) {
      return null;
    }

    const { data, error } = await this.client
      .rpc('quiz_publish_totem_heartbeat', {
        p_totem_id: payload.totemId,
        p_device_token: payload.deviceToken ?? '',
        p_online_status: payload.onlineStatus,
        p_current_screen: payload.currentScreen,
        p_config_version: payload.configVersion,
        p_pending_sync_count: payload.pendingSyncCount,
        p_seen_at: payload.seenAt ?? new Date().toISOString(),
      })
      .maybeSingle<SupabaseTotemRow>();

    if (error || !data) {
      return null;
    }

    const record = mapTotemRow(data);
    await this.realtimeHub.broadcast({ type: 'TELEMETRY_UPDATED', totem: record });
    return record;
  }

  subscribeTotemChannel(
    listener: (event: TotemChannelEvent) => void | Promise<void>,
  ): () => void {
    return this.realtimeHub.subscribe(listener);
  }

  async downloadVisualAsset(url: string): Promise<{ dataUrl: string; mimeType: string }> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para baixar imagem do Evento.');
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Falha ao baixar ativo visual (${response.status}).`);
    }

    const mimeType = response.headers.get('content-type') || 'image/png';
    const buffer = await response.arrayBuffer();
    return {
      dataUrl: bytesToDataUrl(new Uint8Array(buffer), mimeType),
      mimeType,
    };
  }
}
