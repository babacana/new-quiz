import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  computeExpiredLockoutIso,
  selectDeliverableClaimIds,
  toEventPhoneKey,
} from '../domain/operationalRules';
import { normalizePairingCode } from '../domain/pairingUtils';
import type { AdminCloudPort, ListMatchesQueryOptions } from '../domain/ports';
import type {
  AuthSession,
  CreateStaffAccountInput,
  EventConfig,
  EventVisualAssetRecord,
  EventVisualAssetUploadInput,
  GiveUpLockoutRecord,
  MatchRecord,
  PrizeClaimRecord,
  Question,
  RemoteCommandPayload,
  TotemChannelEvent,
  TotemPairingAuthorizationPayload,
  TotemRecord,
  UserProfile,
  UserRole,
  VisualAssetKind,
} from '../domain/types';
import { parseVisualAssetObjectName, sanitizeAssetFileName } from '../domain/visualAssetUtils';
import {
  fetchAllPages,
  getSharedSupabaseClient,
  isBrowserNavigatorOnline,
  mapCommandRow,
  mapEventRow,
  mapLockoutRow,
  mapMatchRow,
  mapPrizeClaimRow,
  mapPrizeClaimToInsertRow,
  mapProfileRow,
  mapQuestionRow,
  mapTotemRow,
  SupabaseRealtimeHub,
  type SupabaseEventRow,
  type SupabaseLockoutRow,
  type SupabaseMatchRow,
  type SupabasePrizeClaimRow,
  type SupabaseProfileRow,
  type SupabaseQuestionRow,
  type SupabaseTotemCommandRow,
  type SupabaseTotemRow,
} from './supabaseClient';

const MATCH_LEAN_COLUMNS =
  'id, event_id, totem_id, participant_name, participant_phone, score, total_questions, time_seconds, played_at, synced_at';

// Adaptador administrativo e operacional no Supabase (carregado sob demanda em #admin e #operador).
export class SupabaseAdminGateway implements AdminCloudPort {
  private readonly client: SupabaseClient;
  private readonly supabaseUrl: string;
  private readonly supabaseAnonKey: string;
  private readonly realtimeHub: SupabaseRealtimeHub;

  constructor(supabaseUrl: string, supabaseAnonKey: string, client?: SupabaseClient) {
    this.supabaseUrl = supabaseUrl;
    this.supabaseAnonKey = supabaseAnonKey;
    this.client = client ?? getSharedSupabaseClient(supabaseUrl, supabaseAnonKey);
    this.realtimeHub = new SupabaseRealtimeHub(this.client, true);
  }

  isOnline(): boolean {
    return isBrowserNavigatorOnline();
  }

  private async getCurrentStaffUserId(): Promise<string | null> {
    const { data } = await this.client.auth.getSession();
    return data.session?.user?.id ?? null;
  }

  async authenticate(email: string, password: string): Promise<AuthSession> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para autenticar.');
    }

    const { data, error } = await this.client.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error || !data.user || !data.session) {
      throw new Error(`Falha na autenticação: ${error?.message ?? 'credenciais inválidas.'}`);
    }

    const { data: profileRow, error: profileError } = await this.client
      .from('quiz_profiles')
      .select('*')
      .eq('id', data.user.id)
      .maybeSingle<SupabaseProfileRow>();

    if (profileError || !profileRow) {
      throw new Error(
        `Perfil da Equipe do Estande não encontrado: ${profileError?.message ?? 'sem registro em profiles.'}`,
      );
    }

    return {
      user: mapProfileRow(profileRow),
      accessToken: data.session.access_token,
      authenticatedAt: new Date().toISOString(),
    };
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) {
      throw new Error(`Erro ao encerrar sessão no Supabase: ${error.message}`);
    }
  }

  async getCurrentSession(): Promise<AuthSession | null> {
    const { data, error } = await this.client.auth.getSession();
    if (error || !data.session?.user) {
      return null;
    }

    const { data: profileRow } = await this.client
      .from('quiz_profiles')
      .select('*')
      .eq('id', data.session.user.id)
      .maybeSingle<SupabaseProfileRow>();

    if (!profileRow) {
      return null;
    }

    return {
      user: mapProfileRow(profileRow),
      accessToken: data.session.access_token,
      authenticatedAt: new Date().toISOString(),
    };
  }

  async listStaffProfiles(): Promise<UserProfile[]> {
    const rows = await fetchAllPages<SupabaseProfileRow>(
      (from, to) =>
        this.client
          .from('quiz_profiles')
          .select('*')
          .order('created_at', { ascending: true })
          .range(from, to),
      'Erro ao listar Equipe do Estande no Supabase',
    );
    return rows.map(mapProfileRow);
  }

  async createStaffProfile(input: CreateStaffAccountInput): Promise<UserProfile> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para cadastrar membro da Equipe do Estande.');
    }

    // Usa cliente isolado sem persistência de sessão para não substituir a sessão do Administrador logado.
    const isolatedAuthClient = createClient(this.supabaseUrl, this.supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const { data, error } = await isolatedAuthClient.auth.signUp({
      email: input.email.trim().toLowerCase(),
      password: input.password,
      options: {
        data: { name: input.name.trim(), role: input.role },
      },
    });

    if (error || !data.user) {
      throw new Error(
        `Erro ao registrar credenciais no Supabase: ${error?.message ?? 'falha desconhecida.'}`,
      );
    }

    const { data: insertedRow, error: profileError } = await this.client
      .from('quiz_profiles')
      .upsert(
        {
          id: data.user.id,
          name: input.name.trim(),
          email: input.email.trim().toLowerCase(),
          role: input.role,
        },
        { onConflict: 'id' },
      )
      .select('*')
      .single<SupabaseProfileRow>();

    if (profileError || !insertedRow) {
      throw new Error(`Erro ao gravar perfil na tabela profiles: ${profileError?.message ?? ''}`);
    }

    return mapProfileRow(insertedRow);
  }

  async updateStaffProfileRole(profileId: string, role: UserRole): Promise<UserProfile> {
    const { data, error } = await this.client
      .from('quiz_profiles')
      .update({ role })
      .eq('id', profileId)
      .select('*')
      .single<SupabaseProfileRow>();

    if (error || !data) {
      throw new Error(`Erro ao atualizar perfil no Supabase: ${error?.message ?? 'sem retorno.'}`);
    }

    return mapProfileRow(data);
  }

  async deleteStaffProfile(profileId: string): Promise<void> {
    const { error } = await this.client.from('quiz_profiles').delete().eq('id', profileId);
    if (error) {
      throw new Error(`Erro ao revogar acesso no Supabase: ${error.message}`);
    }
  }

  async listEvents(): Promise<EventConfig[]> {
    const rows = await fetchAllPages<SupabaseEventRow>(
      (from, to) =>
        this.client
          .from('quiz_events')
          .select('*')
          .order('created_at', { ascending: false })
          .range(from, to),
      'Erro ao listar Eventos no Supabase',
    );
    return rows.map(mapEventRow);
  }

  async saveEvent(event: EventConfig): Promise<EventConfig> {
    const payload = {
      id: event.id,
      name: event.name,
      slug: event.slug,
      start_time: event.startTime,
      end_time: event.endTime,
      enable_out_of_period_message: event.enableOutOfPeriodMessage,
      is_active: event.isActive,
      settings: event.settings,
      prize_stock_remaining: event.prizeStockRemaining,
      customizations: event.customizations,
      config_version: event.configVersion,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.client
      .from('quiz_events')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single<SupabaseEventRow>();

    if (error || !data) {
      throw new Error(`Erro ao salvar Evento no Supabase: ${error?.message ?? 'sem retorno.'}`);
    }

    return mapEventRow(data);
  }

  async getEventQuestionIds(eventId: string): Promise<number[]> {
    const rows = await fetchAllPages<{ question_id: number }>(
      (from, to) =>
        this.client
          .from('quiz_event_questions')
          .select('question_id')
          .eq('event_id', eventId)
          .order('question_id', { ascending: true })
          .range(from, to),
      'Erro ao consultar questões vinculadas ao Evento',
    );
    return rows.map((row) => row.question_id);
  }

  async setEventQuestions(eventId: string, questionIds: number[]): Promise<void> {
    const { error: deleteError } = await this.client
      .from('quiz_event_questions')
      .delete()
      .eq('event_id', eventId);

    if (deleteError) {
      throw new Error(`Erro ao limpar vínculos antigos do Evento: ${deleteError.message}`);
    }

    const uniqueIds = Array.from(new Set(questionIds));
    if (uniqueIds.length === 0) {
      return;
    }

    const { error: insertError } = await this.client
      .from('quiz_event_questions')
      .insert(uniqueIds.map((questionId) => ({ event_id: eventId, question_id: questionId })));

    if (insertError) {
      throw new Error(`Erro ao vincular questões ao Evento: ${insertError.message}`);
    }
  }

  async listAllQuestions(): Promise<Question[]> {
    const rows = await fetchAllPages<SupabaseQuestionRow>(
      (from, to) =>
        this.client
          .from('quiz_questions')
          .select('*')
          .order('id', { ascending: true })
          .range(from, to),
      'Erro ao listar Banco de Questões no Supabase',
    );
    return rows.map(mapQuestionRow);
  }

  private mapQuestionToRow(question: Question) {
    return {
      id: question.id,
      text: question.text,
      options: question.options,
      correct_index: question.correctIndex,
      difficulty: question.difficulty,
      tags: question.tags,
      is_disabled: question.isDisabled,
    };
  }

  async saveQuestion(question: Question): Promise<Question> {
    const { data, error } = await this.client
      .from('quiz_questions')
      .upsert(
        {
          ...this.mapQuestionToRow(question),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      )
      .select('*')
      .single<SupabaseQuestionRow>();

    if (error || !data) {
      throw new Error(`Erro ao salvar questão no Supabase: ${error?.message ?? 'sem retorno.'}`);
    }

    return mapQuestionRow(data);
  }

  async deleteQuestions(ids: number[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const { error } = await this.client.from('quiz_questions').delete().in('id', ids);
    if (error) {
      throw new Error(`Erro ao excluir questões no Supabase: ${error.message}`);
    }
    return ids.length;
  }

  async setQuestionsDisabled(ids: number[], isDisabled: boolean): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const { error } = await this.client
      .from('quiz_questions')
      .update({ is_disabled: isDisabled, updated_at: new Date().toISOString() })
      .in('id', ids);
    if (error) {
      throw new Error(`Erro ao atualizar status das questões no Supabase: ${error.message}`);
    }
    return ids.length;
  }

  async replaceAllQuestions(questions: Question[]): Promise<Question[]> {
    // RPC transacional: preserva os vínculos Evento-Questão (por texto) e não deixa o banco vazio em caso de falha.
    const { data, error } = await this.client.rpc('quiz_replace_all_questions', {
      p_questions: questions.map((question) => this.mapQuestionToRow(question)),
    });

    if (error) {
      throw new Error(`Erro ao substituir Banco de Questões no Supabase: ${error.message}`);
    }

    return ((data ?? []) as SupabaseQuestionRow[]).map(mapQuestionRow);
  }

  async authorizeTotemPairing(input: TotemPairingAuthorizationPayload): Promise<TotemRecord> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para autorizar Pareamento.');
    }

    const normalizedCode = normalizePairingCode(input.pairingCode);
    const [{ data: existingRow, error: lookupError }, { data: eventRow }] = await Promise.all([
      this.client
        .from('quiz_totems')
        .select('*')
        .eq('pairing_code', normalizedCode)
        .maybeSingle<SupabaseTotemRow>(),
      this.client
        .from('quiz_events')
        .select('config_version')
        .eq('id', input.eventId)
        .maybeSingle<{ config_version: number }>(),
    ]);

    if (lookupError) {
      throw new Error(`Erro ao consultar código de Pareamento: ${lookupError.message}`);
    }

    const configVersion = existingRow?.config_version ?? eventRow?.config_version ?? 1;
    const deviceToken =
      existingRow?.is_paired && existingRow.device_token ? existingRow.device_token : input.deviceToken;
    const payload = {
      id: existingRow?.id ?? input.id,
      name: input.name.trim(),
      pairing_code: normalizedCode,
      device_token: deviceToken,
      event_id: input.eventId,
      pin_code: input.pinCode.trim(),
      is_paired: true,
      online_status: existingRow?.online_status ?? ('offline' as const),
      last_seen_at: existingRow?.last_seen_at ?? null,
      current_screen: existingRow?.current_screen ?? ('initial-screen' as const),
      config_version: configVersion,
      pending_sync_count: existingRow?.pending_sync_count ?? 0,
    };

    const { data, error } = await this.client
      .from('quiz_totems')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single<SupabaseTotemRow>();

    if (error || !data) {
      throw new Error(`Erro ao autorizar Pareamento no Supabase: ${error?.message ?? 'sem retorno.'}`);
    }

    const totem = mapTotemRow(data);
    await this.realtimeHub.broadcast({ type: 'PAIRING_AUTHORIZED', totem });
    await this.realtimeHub.broadcast({ type: 'TELEMETRY_UPDATED', totem });
    return totem;
  }

  async listTotems(): Promise<TotemRecord[]> {
    const rows = await fetchAllPages<SupabaseTotemRow>(
      (from, to) =>
        this.client
          .from('quiz_totems')
          .select('*')
          .order('created_at', { ascending: true })
          .range(from, to),
      'Erro ao listar Totens no Supabase',
    );
    return rows.map(mapTotemRow);
  }

  async deleteTotems(totemIds: string[]): Promise<string[]> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para excluir Totens.');
    }

    const uniqueIds = Array.from(new Set(totemIds));
    if (uniqueIds.length === 0) {
      return [];
    }

    const { data, error } = await this.client
      .from('quiz_totems')
      .delete()
      .in('id', uniqueIds)
      .select('id');

    if (error) {
      throw new Error(`Erro ao excluir Totens no Supabase: ${error.message}`);
    }

    return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
  }

  async dispatchRemoteCommand(command: RemoteCommandPayload): Promise<RemoteCommandPayload> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para enviar comando remoto.');
    }

    const { data, error } = await this.client
      .from('quiz_totem_commands')
      .insert({
        id: command.id,
        type: command.type,
        target_totem_id: command.targetTotemId,
        target_event_id: command.targetEventId,
        event_id: command.eventId ?? null,
        target_screen: command.targetScreen ?? null,
        config_version: command.configVersion ?? null,
        issued_at: command.issuedAt,
      })
      .select('*')
      .single<SupabaseTotemCommandRow>();

    if (error || !data) {
      throw new Error(`Erro ao registrar comando remoto no Supabase: ${error?.message ?? 'sem retorno.'}`);
    }

    if (command.type === 'SWITCH_EVENT' && command.eventId) {
      let updateQuery = this.client.from('quiz_totems').update({ event_id: command.eventId });
      if (command.targetTotemId) {
        updateQuery = updateQuery.eq('id', command.targetTotemId);
      } else if (command.targetEventId) {
        updateQuery = updateQuery.eq('event_id', command.targetEventId);
      }
      await updateQuery;
    }

    const mapped = mapCommandRow(data);
    await this.realtimeHub.broadcast({ type: 'REMOTE_COMMAND', command: mapped });
    return mapped;
  }

  subscribeTotemChannel(
    listener: (event: TotemChannelEvent) => void | Promise<void>,
  ): () => void {
    return this.realtimeHub.subscribe(listener);
  }

  async listMatches(
    eventId?: string,
    options: ListMatchesQueryOptions = {},
  ): Promise<MatchRecord[]> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para listar Partidas.');
    }

    const includeAnswers = options.includeAnswers ?? true;
    const columns = includeAnswers ? '*' : MATCH_LEAN_COLUMNS;

    const rows = await fetchAllPages<SupabaseMatchRow>(
      (from, to) => {
        let query = this.client
          .from('quiz_matches')
          .select(columns)
          .order('played_at', { ascending: false })
          .order('id', { ascending: true });
        if (eventId) {
          query = query.eq('event_id', eventId);
        }
        return query.range(from, to) as PromiseLike<{
          data: SupabaseMatchRow[] | null;
          error: { message: string } | null;
        }>;
      },
      'Erro ao listar Partidas no Supabase',
    );

    return rows.map(mapMatchRow);
  }

  async getMatchById(matchId: string): Promise<MatchRecord | null> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para consultar Partida.');
    }
    const { data, error } = await this.client
      .from('quiz_matches')
      .select('*')
      .eq('id', matchId)
      .maybeSingle<SupabaseMatchRow>();

    if (error) {
      throw new Error(`Erro ao buscar Partida no Supabase: ${error.message}`);
    }
    return data ? mapMatchRow(data) : null;
  }

  async listMatchesByIds(matchIds: string[]): Promise<MatchRecord[]> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para consultar Partidas.');
    }
    const uniqueIds = Array.from(new Set(matchIds));
    if (uniqueIds.length === 0) {
      return [];
    }

    const { data, error } = await this.client
      .from('quiz_matches')
      .select(MATCH_LEAN_COLUMNS)
      .in('id', uniqueIds);

    if (error) {
      throw new Error(`Erro ao buscar Partidas selecionadas no Supabase: ${error.message}`);
    }
    return ((data ?? []) as SupabaseMatchRow[]).map(mapMatchRow);
  }

  async listPrizeClaims(eventId?: string): Promise<PrizeClaimRecord[]> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para listar Brindes.');
    }

    const rows = await fetchAllPages<SupabasePrizeClaimRow>(
      (from, to) => {
        let query = this.client
          .from('quiz_prize_claims')
          .select('*')
          .order('created_at', { ascending: false })
          .order('id', { ascending: true });
        if (eventId) {
          query = query.eq('event_id', eventId);
        }
        return query.range(from, to);
      },
      'Erro ao listar Brindes no Supabase',
    );

    return rows.map(mapPrizeClaimRow);
  }

  async listPrizeClaimsByIds(claimIds: string[]): Promise<PrizeClaimRecord[]> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para consultar Brindes.');
    }
    const uniqueIds = Array.from(new Set(claimIds));
    if (uniqueIds.length === 0) {
      return [];
    }

    const { data, error } = await this.client
      .from('quiz_prize_claims')
      .select('*')
      .in('id', uniqueIds);

    if (error) {
      throw new Error(`Erro ao consultar Brindes selecionados no Supabase: ${error.message}`);
    }
    return ((data ?? []) as SupabasePrizeClaimRow[]).map(mapPrizeClaimRow);
  }

  async listGiveUpLockouts(eventId?: string): Promise<GiveUpLockoutRecord[]> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para listar Bloqueios por Desistência.');
    }

    const rows = await fetchAllPages<SupabaseLockoutRow>(
      (from, to) => {
        let query = this.client
          .from('quiz_give_up_lockouts')
          .select('*')
          .order('locked_at', { ascending: false })
          .order('id', { ascending: true });
        if (eventId) {
          query = query.eq('event_id', eventId);
        }
        return query.range(from, to);
      },
      'Erro ao listar Bloqueios no Supabase',
    );

    return rows.map(mapLockoutRow);
  }

  async updatePrizeClaimsStatus(
    claimIds: string[],
    status: 'delivered' | 'revoked',
    deliveredAt?: string | null,
  ): Promise<PrizeClaimRecord[]> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para atualizar status de Brinde.');
    }

    const uniqueIds = Array.from(new Set(claimIds));
    if (uniqueIds.length === 0) {
      return [];
    }

    if (status === 'revoked') {
      const { data, error } = await this.client
        .from('quiz_prize_claims')
        .update({ status: 'revoked', delivered_at: null })
        .in('id', uniqueIds)
        .in('status', ['awaiting_pickup', 'delivered', 'offline_duplicate_conflict'])
        .select('*');

      if (error) {
        throw new Error(`Erro ao despremiar Brindes no Supabase: ${error.message}`);
      }

      const mapped = ((data ?? []) as SupabasePrizeClaimRow[]).map(mapPrizeClaimRow);
      if (mapped.length > 0) {
        await this.realtimeHub.broadcast({ type: 'OPERATIONAL_DATA_UPDATED' });
      }
      return mapped;
    }

    const { data: candidates, error: fetchError } = await this.client
      .from('quiz_prize_claims')
      .select('*')
      .in('id', uniqueIds)
      .eq('status', 'awaiting_pickup');

    if (fetchError) {
      throw new Error(`Erro ao validar Brindes para entrega: ${fetchError.message}`);
    }

    const awaitingRows = (candidates ?? []) as SupabasePrizeClaimRow[];
    if (awaitingRows.length === 0) {
      return [];
    }

    // Garante no máximo 1 Brinde entregue por telefone em cada Evento mesmo com paginação > 1.000 linhas.
    const eventIds = Array.from(new Set(awaitingRows.map((row) => row.event_id)));
    const existingDelivered = await fetchAllPages<{ event_id: string; participant_phone: string }>(
      (from, to) =>
        this.client
          .from('quiz_prize_claims')
          .select('event_id, participant_phone')
          .in('event_id', eventIds)
          .eq('status', 'delivered')
          .range(from, to),
      'Erro ao verificar entregas existentes no Supabase',
    );

    const alreadyDeliveredKeys = new Set(
      existingDelivered.map((row) => toEventPhoneKey(row.event_id, row.participant_phone)),
    );

    const eligibleIds = selectDeliverableClaimIds(
      awaitingRows.map((row) => ({
        id: row.id,
        eventId: row.event_id,
        participantPhone: row.participant_phone,
        status: row.status,
      })),
      alreadyDeliveredKeys,
    );

    if (eligibleIds.length === 0) {
      return [];
    }

    const staffUserId = await this.getCurrentStaffUserId();
    const effectiveDeliveredAt = deliveredAt ?? new Date().toISOString();

    const { data: updatedRows, error: updateError } = await this.client
      .from('quiz_prize_claims')
      .update({
        status: 'delivered',
        delivered_at: effectiveDeliveredAt,
        ...(staffUserId ? { delivered_by: staffUserId } : {}),
      })
      .in('id', eligibleIds)
      .eq('status', 'awaiting_pickup')
      .select('*');

    if (updateError) {
      throw new Error(`Erro ao confirmar entrega de Brinde no Supabase: ${updateError.message}`);
    }

    const mapped = ((updatedRows ?? []) as SupabasePrizeClaimRow[]).map(mapPrizeClaimRow);
    if (mapped.length > 0) {
      await this.realtimeHub.broadcast({ type: 'OPERATIONAL_DATA_UPDATED' });
    }
    return mapped;
  }

  async expireGiveUpLockouts(eventId: string, participantPhones: string[]): Promise<number> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para destravar Bloqueios por Desistência.');
    }

    const phones = Array.from(new Set(participantPhones.map((phone) => phone.trim()).filter(Boolean)));
    if (phones.length === 0) {
      return 0;
    }

    const { data: rows, error: fetchError } = await this.client
      .from('quiz_give_up_lockouts')
      .select('*')
      .eq('event_id', eventId)
      .in('participant_phone', phones);

    if (fetchError) {
      throw new Error(`Erro ao consultar Bloqueios por Desistência: ${fetchError.message}`);
    }

    const nowMs = Date.now();
    const staffUserId = await this.getCurrentStaffUserId();
    let updatedCount = 0;

    for (const row of (rows ?? []) as SupabaseLockoutRow[]) {
      const nextExpiresIso = computeExpiredLockoutIso(row.locked_at, row.expires_at, nowMs);
      if (!nextExpiresIso) {
        continue;
      }

      const { error: updateError } = await this.client
        .from('quiz_give_up_lockouts')
        .update({
          expires_at: nextExpiresIso,
          ...(staffUserId ? { unlocked_by: staffUserId } : {}),
        })
        .eq('id', row.id);

      if (updateError) {
        throw new Error(`Erro ao destravar Bloqueio por Desistência: ${updateError.message}`);
      }
      updatedCount += 1;
    }

    if (updatedCount > 0) {
      await this.realtimeHub.broadcast({ type: 'OPERATIONAL_DATA_UPDATED', eventId });
    }

    return updatedCount;
  }

  async deleteMatches(matchIds: string[]): Promise<string[]> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para excluir Partidas.');
    }

    const uniqueIds = Array.from(new Set(matchIds));
    if (uniqueIds.length === 0) {
      return [];
    }

    const { data, error } = await this.client
      .from('quiz_matches')
      .delete()
      .in('id', uniqueIds)
      .select('id');

    if (error) {
      throw new Error(`Erro ao excluir Partidas no Supabase: ${error.message}`);
    }

    const deleted = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
    if (deleted.length > 0) {
      await this.realtimeHub.broadcast({ type: 'OPERATIONAL_DATA_UPDATED' });
    }
    return deleted;
  }

  async uploadEventVisualAsset(
    input: EventVisualAssetUploadInput,
  ): Promise<{ url: string; fileName: string }> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para enviar imagem do Evento.');
    }

    const safeFileName = sanitizeAssetFileName(input.fileName);
    const storagePath = `${input.eventId}/${input.kind}-${Date.now()}-${safeFileName}`;

    const { error: uploadError } = await this.client.storage
      .from('quiz_event_assets')
      .upload(storagePath, input.bytes, {
        contentType: input.mimeType || 'image/png',
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Erro ao enviar imagem para o Supabase Storage: ${uploadError.message}`);
    }

    const { data } = this.client.storage.from('quiz_event_assets').getPublicUrl(storagePath);
    return {
      url: data.publicUrl,
      fileName: safeFileName,
    };
  }

  async listEventVisualAssets(options?: {
    eventId?: string;
    kind?: VisualAssetKind;
  }): Promise<EventVisualAssetRecord[]> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para listar imagens do Evento.');
    }

    const bucket = this.client.storage.from('quiz_event_assets');
    let folderNames: string[] = [];

    if (options?.eventId?.trim()) {
      folderNames = [options.eventId.trim()];
    } else {
      const { data: rootEntries, error: rootError } = await bucket.list('', {
        limit: 1000,
      });
      if (rootError) {
        throw new Error(`Erro ao listar pastas de imagens no Storage: ${rootError.message}`);
      }
      folderNames = (rootEntries ?? [])
        .filter((entry) => entry.id === null && Boolean(entry.name) && !entry.name.startsWith('.'))
        .map((entry) => entry.name);
    }

    if (folderNames.length === 0) {
      return [];
    }

    const perFolderLists = await Promise.all(
      folderNames.map(async (folderName) => {
        const { data: files, error: listError } = await bucket.list(folderName, {
          limit: 1000,
          sortBy: { column: 'created_at', order: 'desc' },
        });
        if (listError) {
          throw new Error(
            `Erro ao listar imagens do Evento (${folderName}) no Storage: ${listError.message}`,
          );
        }

        const records: EventVisualAssetRecord[] = [];
        for (const item of files ?? []) {
          if (item.id === null || !item.name) {
            continue;
          }
          const parsed = parseVisualAssetObjectName(item.name);
          if (!parsed) {
            continue;
          }
          if (options?.kind && parsed.kind !== options.kind) {
            continue;
          }
          const storagePath = `${folderName}/${item.name}`;
          const { data: publicUrlData } = bucket.getPublicUrl(storagePath);
          const rawSize = (item.metadata as { size?: unknown } | null | undefined)?.size;
          const sizeBytes =
            typeof rawSize === 'number' && Number.isFinite(rawSize)
              ? rawSize
              : typeof rawSize === 'string' && rawSize.trim() !== '' && Number.isFinite(Number(rawSize))
                ? Number(rawSize)
                : null;

          records.push({
            storagePath,
            url: publicUrlData.publicUrl,
            eventId: folderName,
            kind: parsed.kind,
            fileName: parsed.fileName,
            createdAt: item.created_at ?? item.updated_at ?? '',
            sizeBytes,
          });
        }
        return records;
      }),
    );

    const allRecords = perFolderLists.flat();
    return allRecords.sort((a, b) => {
      const cmp = b.createdAt.localeCompare(a.createdAt);
      if (cmp !== 0) {
        return cmp;
      }
      return b.storagePath.localeCompare(a.storagePath);
    });
  }

  async deleteEventVisualAsset(storagePath: string): Promise<void> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para excluir imagem do Evento.');
    }
    const normalizedPath = storagePath.trim();
    if (!normalizedPath) {
      throw new Error('Caminho da imagem inválido para exclusão.');
    }

    const { error } = await this.client.storage
      .from('quiz_event_assets')
      .remove([normalizedPath]);
    if (error) {
      throw new Error(`Erro ao excluir imagem do Supabase Storage: ${error.message}`);
    }
  }

  async importOperationalRecords(payload: {
    matches: MatchRecord[];
    prizeClaims: PrizeClaimRecord[];
    lockouts: GiveUpLockoutRecord[];
    replaceEventIds?: string[];
  }): Promise<void> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para importar registros de backup.');
    }

    const replaceIds = Array.from(new Set(payload.replaceEventIds ?? []));
    if (replaceIds.length > 0) {
      const { error: delClaimsErr } = await this.client
        .from('quiz_prize_claims')
        .delete()
        .in('event_id', replaceIds);
      if (delClaimsErr) {
        throw new Error(`Erro ao limpar Brindes antes da restauração: ${delClaimsErr.message}`);
      }
      const { error: delMatchesErr } = await this.client
        .from('quiz_matches')
        .delete()
        .in('event_id', replaceIds);
      if (delMatchesErr) {
        throw new Error(`Erro ao limpar Partidas antes da restauração: ${delMatchesErr.message}`);
      }
      const { error: delLockoutsErr } = await this.client
        .from('quiz_give_up_lockouts')
        .delete()
        .in('event_id', replaceIds);
      if (delLockoutsErr) {
        throw new Error(
          `Erro ao limpar bloqueios antes da restauração: ${delLockoutsErr.message}`,
        );
      }
    }

    if (payload.matches.length > 0) {
      const syncedAt = new Date().toISOString();
      const matchRows = payload.matches.map((match) => ({
        id: match.id,
        event_id: match.eventId,
        totem_id: match.totemId,
        participant_name: match.participantName,
        participant_phone: match.participantPhone,
        score: match.score,
        total_questions: match.totalQuestions,
        time_seconds: match.timeSeconds,
        answers: match.answers,
        played_at: match.playedAt,
        synced_at: match.syncedAt ?? syncedAt,
      }));
      const { error } = await this.client.from('quiz_matches').upsert(matchRows, { onConflict: 'id' });
      if (error) {
        throw new Error(`Erro ao importar Partidas do backup: ${error.message}`);
      }
    }

    if (payload.prizeClaims.length > 0) {
      const claimRows = payload.prizeClaims.map((claim) => mapPrizeClaimToInsertRow(claim));
      const { error } = await this.client
        .from('quiz_prize_claims')
        .upsert(claimRows, { onConflict: 'id' });
      if (error) {
        throw new Error(`Erro ao importar Brindes do backup: ${error.message}`);
      }
    }

    if (payload.lockouts.length > 0) {
      const lockoutRows = payload.lockouts.map((lockout) => ({
        id: lockout.id,
        event_id: lockout.eventId,
        totem_id: lockout.totemId,
        participant_phone: lockout.participantPhone,
        locked_at: lockout.lockedAt,
        expires_at: lockout.expiresAt,
      }));
      const { error } = await this.client
        .from('quiz_give_up_lockouts')
        .upsert(lockoutRows, { onConflict: 'id' });
      if (error) {
        throw new Error(`Erro ao importar bloqueios do backup: ${error.message}`);
      }
    }

    await this.realtimeHub.broadcast({ type: 'OPERATIONAL_DATA_UPDATED' });
  }
}
