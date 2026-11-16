import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_CUSTOMIZATIONS, DEFAULT_SETTINGS } from '../domain/defaults';
import type { CloudEventSnapshot, CloudGateway, PushMatchResponse } from '../domain/ports';
import type {
  DifficultyLevel,
  EventConfig,
  EventCustomizations,
  EventSettings,
  GiveUpLockoutRecord,
  MatchAnswer,
  MatchRecord,
  PrizeClaimRecord,
  PrizeClaimStatus,
  Question,
} from '../domain/types';

interface SupabaseEventRow {
  id: string;
  name: string;
  slug: string;
  start_time: string | null;
  end_time: string | null;
  enable_out_of_period_message: boolean;
  is_active: boolean;
  settings: Partial<EventSettings> | null;
  prize_stock_remaining: number | null;
  customizations: Partial<EventCustomizations> | null;
  config_version: number;
}

interface SupabaseQuestionRow {
  id: number;
  text: string;
  options: [string, string, string, string];
  correct_index: number;
  difficulty: DifficultyLevel;
  tags: string[];
  is_disabled: boolean;
}

interface SupabaseMatchRow {
  id: string;
  event_id: string;
  totem_id: string | null;
  participant_name: string;
  participant_phone: string;
  score: number;
  total_questions: number;
  time_seconds: number;
  answers: MatchAnswer[];
  played_at: string;
  synced_at: string | null;
}

interface SupabasePrizeClaimRow {
  id: string;
  event_id: string;
  match_id: string;
  totem_id: string | null;
  participant_name: string;
  participant_phone: string;
  status: PrizeClaimStatus;
  delivered_at: string | null;
  created_at: string;
}

interface SupabaseLockoutRow {
  id: string;
  event_id: string;
  totem_id: string | null;
  participant_phone: string;
  locked_at: string;
  expires_at: string;
}

// Adaptador de nuvem apoiado no Supabase Postgres para sincronização do Totem.
export class SupabaseCloudGateway implements CloudGateway {
  private readonly client: SupabaseClient;

  constructor(supabaseUrl: string, supabaseAnonKey: string) {
    this.client = createClient(supabaseUrl, supabaseAnonKey);
  }

  isOnline(): boolean {
    if (typeof navigator === 'undefined') {
      return true;
    }
    return navigator.onLine;
  }

  async pullEventSnapshot(eventId: string): Promise<CloudEventSnapshot | null> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade.');
    }

    const { data: eventData, error: eventError } = await this.client
      .from('events')
      .select('*')
      .eq('id', eventId)
      .maybeSingle<SupabaseEventRow>();

    if (eventError) {
      throw new Error(`Erro ao buscar Evento no Supabase: ${eventError.message}`);
    }
    if (!eventData) {
      return null;
    }

    // Busca questões vinculadas ao Evento; se não houver vínculo explícito, usa o acervo central.
    const { data: linkedRows, error: linkError } = await this.client
      .from('event_questions')
      .select('question_id')
      .eq('event_id', eventId);

    if (linkError) {
      throw new Error(`Erro ao buscar vínculo de questões: ${linkError.message}`);
    }

    let query = this.client.from('questions').select('*').order('id', { ascending: true });
    if (linkedRows && linkedRows.length > 0) {
      const ids = linkedRows.map((row: { question_id: number }) => row.question_id);
      query = query.in('id', ids);
    }

    const { data: questionRows, error: questionsError } = await query;
    if (questionsError) {
      throw new Error(`Erro ao buscar Banco de Questões: ${questionsError.message}`);
    }

    const event = this.mapEventRow(eventData);
    const questions = ((questionRows ?? []) as SupabaseQuestionRow[]).map((row) =>
      this.mapQuestionRow(row),
    );

    const [matchesRes, claimsRes, lockoutsRes] = await Promise.all([
      this.client.from('matches').select('*').eq('event_id', eventId),
      this.client.from('prize_claims').select('*').eq('event_id', eventId),
      this.client.from('give_up_lockouts').select('*').eq('event_id', eventId),
    ]);

    if (matchesRes.error) {
      throw new Error(`Erro ao buscar Partidas do Evento: ${matchesRes.error.message}`);
    }
    if (claimsRes.error) {
      throw new Error(`Erro ao buscar Brindes do Evento: ${claimsRes.error.message}`);
    }
    if (lockoutsRes.error) {
      throw new Error(`Erro ao buscar Bloqueios do Evento: ${lockoutsRes.error.message}`);
    }

    const matches = ((matchesRes.data ?? []) as SupabaseMatchRow[]).map((row) => ({
      id: row.id,
      eventId: row.event_id,
      totemId: row.totem_id,
      participantName: row.participant_name,
      participantPhone: row.participant_phone,
      score: row.score,
      totalQuestions: row.total_questions,
      timeSeconds: row.time_seconds,
      answers: row.answers ?? [],
      playedAt: row.played_at,
      syncedAt: row.synced_at,
    }));

    const prizeClaims = ((claimsRes.data ?? []) as SupabasePrizeClaimRow[]).map((row) =>
      this.mapPrizeClaimRow(row),
    );

    const lockouts = ((lockoutsRes.data ?? []) as SupabaseLockoutRow[]).map((row) => ({
      id: row.id,
      eventId: row.event_id,
      totemId: row.totem_id,
      participantPhone: row.participant_phone,
      lockedAt: row.locked_at,
      expiresAt: row.expires_at,
    }));

    return { event, questions, matches, prizeClaims, lockouts };
  }

  async pushMatch(payload: {
    idempotencyKey: string;
    match: MatchRecord;
    prizeClaim?: PrizeClaimRecord | null;
  }): Promise<PushMatchResponse> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para sincronizar Partida.');
    }

    const syncedAt = new Date().toISOString();
    const { match, prizeClaim } = payload;

    // Upsert pela chave primária id (UUID gerado no Totem) garante idempotência na nuvem.
    const { error } = await this.client.from('matches').upsert(
      {
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
        synced_at: syncedAt,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );

    if (error) {
      throw new Error(`Erro ao sincronizar Partida no Supabase: ${error.message}`);
    }

    let resolvedPrizeClaim: PrizeClaimRecord | null = null;
    let prizeStockRemaining: number | null | undefined;

    if (prizeClaim) {
      // Verifica primeiro se já existe por id para não confundir retry idempotente com conflito.
      const { data: existingClaimRow, error: lookupError } = await this.client
        .from('prize_claims')
        .select('*')
        .eq('id', prizeClaim.id)
        .maybeSingle<SupabasePrizeClaimRow>();

      if (lookupError) {
        throw new Error(`Erro ao verificar idempotência de Brinde: ${lookupError.message}`);
      }

      if (existingClaimRow) {
        resolvedPrizeClaim = this.mapPrizeClaimRow(existingClaimRow);
      } else {
        const { error: claimError } = await this.client
          .from('prize_claims')
          .insert(this.mapPrizeClaimToInsertRow(prizeClaim));

        if (!claimError) {
          // Consome estoque atomicamente apenas quando o Brinde ativo foi aceito.
          const { data: stockData, error: stockError } = await this.client.rpc(
            'consume_event_prize_stock',
            { p_event_id: match.eventId },
          );
          if (stockError) {
            throw new Error(`Erro ao atualizar estoque de Brindes: ${stockError.message}`);
          }

          if (typeof stockData === 'number' && stockData < 0) {
            const revokedClaim: PrizeClaimRecord = {
              ...structuredClone(prizeClaim),
              status: 'revoked',
              deliveredAt: null,
            };
            await this.client
              .from('prize_claims')
              .update({ status: 'revoked', delivered_at: null })
              .eq('id', revokedClaim.id);
            resolvedPrizeClaim = revokedClaim;
            prizeStockRemaining = 0;
          } else {
            resolvedPrizeClaim = structuredClone(prizeClaim);
            prizeStockRemaining = typeof stockData === 'number' ? stockData : null;
          }
        } else if (claimError.code === '23505') {
          // Violação do índice único parcial (event_id, participant_phone): conflito offline.
          const conflictClaim: PrizeClaimRecord = {
            ...structuredClone(prizeClaim),
            status: 'offline_duplicate_conflict',
            deliveredAt: null,
          };
          const { error: conflictError } = await this.client
            .from('prize_claims')
            .upsert(this.mapPrizeClaimToInsertRow(conflictClaim), {
              onConflict: 'id',
              ignoreDuplicates: true,
            });
          if (conflictError) {
            throw new Error(`Erro ao registrar conflito de Brinde: ${conflictError.message}`);
          }
          resolvedPrizeClaim = conflictClaim;
        } else {
          throw new Error(`Erro ao registrar Brinde no Supabase: ${claimError.message}`);
        }
      }
    }

    return { syncedAt, resolvedPrizeClaim, prizeStockRemaining };
  }

  private mapPrizeClaimRow(row: SupabasePrizeClaimRow): PrizeClaimRecord {
    return {
      id: row.id,
      eventId: row.event_id,
      matchId: row.match_id,
      totemId: row.totem_id,
      participantName: row.participant_name,
      participantPhone: row.participant_phone,
      status: row.status,
      awardedAt: row.created_at,
      deliveredAt: row.delivered_at,
    };
  }

  private mapPrizeClaimToInsertRow(claim: PrizeClaimRecord) {
    return {
      id: claim.id,
      event_id: claim.eventId,
      match_id: claim.matchId,
      totem_id: claim.totemId,
      participant_name: claim.participantName,
      participant_phone: claim.participantPhone,
      status: claim.status,
      delivered_at: claim.deliveredAt,
      created_at: claim.awardedAt,
    };
  }

  async pushGiveUpLockout(payload: {
    idempotencyKey: string;
    lockout: GiveUpLockoutRecord;
  }): Promise<{ syncedAt: string }> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para sincronizar Bloqueio por Desistência.');
    }

    const { lockout } = payload;
    const { error } = await this.client.from('give_up_lockouts').upsert(
      {
        id: lockout.id,
        event_id: lockout.eventId,
        totem_id: lockout.totemId,
        participant_phone: lockout.participantPhone,
        locked_at: lockout.lockedAt,
        expires_at: lockout.expiresAt,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );

    if (error) {
      throw new Error(`Erro ao sincronizar Bloqueio por Desistência: ${error.message}`);
    }

    return { syncedAt: new Date().toISOString() };
  }

  private mapEventRow(row: SupabaseEventRow): EventConfig {
    const rawSettings = row.settings ?? {};
    const rawCustomizations = row.customizations ?? {};

    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      startTime: row.start_time,
      endTime: row.end_time,
      enableOutOfPeriodMessage: row.enable_out_of_period_message,
      isActive: row.is_active,
      settings: {
        ...DEFAULT_SETTINGS,
        ...rawSettings,
        difficultyPercentages: {
          ...DEFAULT_SETTINGS.difficultyPercentages,
          ...(rawSettings.difficultyPercentages ?? {}),
        },
      },
      prizeStockRemaining: row.prize_stock_remaining,
      customizations: {
        texts: { ...DEFAULT_CUSTOMIZATIONS.texts, ...(rawCustomizations.texts ?? {}) },
        colors: { ...DEFAULT_CUSTOMIZATIONS.colors, ...(rawCustomizations.colors ?? {}) },
        fontSizes: {
          ...DEFAULT_CUSTOMIZATIONS.fontSizes,
          ...(rawCustomizations.fontSizes ?? {}),
        },
        visualIdentity: {
          ...DEFAULT_CUSTOMIZATIONS.visualIdentity,
          ...(rawCustomizations.visualIdentity ?? {}),
        },
      },
      configVersion: row.config_version,
    };
  }

  private mapQuestionRow(row: SupabaseQuestionRow): Question {
    return {
      id: row.id,
      text: row.text,
      options: row.options,
      correctIndex: row.correct_index,
      difficulty: row.difficulty,
      tags: row.tags ?? [],
      isDisabled: row.is_disabled,
    };
  }
}
