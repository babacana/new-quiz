import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_CUSTOMIZATIONS, DEFAULT_SETTINGS } from '../domain/defaults';
import type { CloudEventSnapshot, CloudGateway, PushMatchResponse } from '../domain/ports';
import type {
  AuthSession,
  CreateStaffAccountInput,
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
  UserProfile,
  UserRole,
} from '../domain/types';

interface SupabaseProfileRow {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  created_at: string;
}

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
  private readonly supabaseUrl: string;
  private readonly supabaseAnonKey: string;

  constructor(supabaseUrl: string, supabaseAnonKey: string) {
    this.supabaseUrl = supabaseUrl;
    this.supabaseAnonKey = supabaseAnonKey;
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
            await this.client.rpc('revoke_exhausted_prize_claim', {
              p_claim_id: revokedClaim.id,
            });
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

  private mapProfileRow(row: SupabaseProfileRow): UserProfile {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      createdAt: row.created_at,
    };
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
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .maybeSingle<SupabaseProfileRow>();

    if (profileError || !profileRow) {
      throw new Error(
        `Perfil da Equipe do Estande não encontrado: ${profileError?.message ?? 'sem registro em profiles.'}`,
      );
    }

    return {
      user: this.mapProfileRow(profileRow),
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
      .from('profiles')
      .select('*')
      .eq('id', data.session.user.id)
      .maybeSingle<SupabaseProfileRow>();

    if (!profileRow) {
      return null;
    }

    return {
      user: this.mapProfileRow(profileRow),
      accessToken: data.session.access_token,
      authenticatedAt: new Date().toISOString(),
    };
  }

  async listStaffProfiles(): Promise<UserProfile[]> {
    const { data, error } = await this.client
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Erro ao listar Equipe do Estande no Supabase: ${error.message}`);
    }

    return ((data ?? []) as SupabaseProfileRow[]).map((row) => this.mapProfileRow(row));
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
      .from('profiles')
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

    return this.mapProfileRow(insertedRow);
  }

  async updateStaffProfileRole(profileId: string, role: UserRole): Promise<UserProfile> {
    const { data, error } = await this.client
      .from('profiles')
      .update({ role })
      .eq('id', profileId)
      .select('*')
      .single<SupabaseProfileRow>();

    if (error || !data) {
      throw new Error(`Erro ao atualizar perfil no Supabase: ${error?.message ?? 'sem retorno.'}`);
    }

    return this.mapProfileRow(data);
  }

  async deleteStaffProfile(profileId: string): Promise<void> {
    const { error } = await this.client.from('profiles').delete().eq('id', profileId);
    if (error) {
      throw new Error(`Erro ao revogar acesso no Supabase: ${error.message}`);
    }
  }

  async listEvents(): Promise<EventConfig[]> {
    const { data, error } = await this.client
      .from('events')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Erro ao listar Eventos no Supabase: ${error.message}`);
    }

    return ((data ?? []) as SupabaseEventRow[]).map((row) => this.mapEventRow(row));
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
      .from('events')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single<SupabaseEventRow>();

    if (error || !data) {
      throw new Error(`Erro ao salvar Evento no Supabase: ${error?.message ?? 'sem retorno.'}`);
    }

    return this.mapEventRow(data);
  }

  async getEventQuestionIds(eventId: string): Promise<number[]> {
    const { data, error } = await this.client
      .from('event_questions')
      .select('question_id')
      .eq('event_id', eventId);

    if (error) {
      throw new Error(`Erro ao consultar questões vinculadas ao Evento: ${error.message}`);
    }

    return ((data ?? []) as Array<{ question_id: number }>).map((row) => row.question_id);
  }

  async setEventQuestions(eventId: string, questionIds: number[]): Promise<void> {
    const { error: deleteError } = await this.client
      .from('event_questions')
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
      .from('event_questions')
      .insert(uniqueIds.map((questionId) => ({ event_id: eventId, question_id: questionId })));

    if (insertError) {
      throw new Error(`Erro ao vincular questões ao Evento: ${insertError.message}`);
    }
  }

  async listAllQuestions(): Promise<Question[]> {
    const { data, error } = await this.client
      .from('questions')
      .select('*')
      .order('id', { ascending: true });

    if (error) {
      throw new Error(`Erro ao listar Banco de Questões no Supabase: ${error.message}`);
    }

    return ((data ?? []) as SupabaseQuestionRow[]).map((row) => this.mapQuestionRow(row));
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
      .from('questions')
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

    return this.mapQuestionRow(data);
  }

  async deleteQuestions(ids: number[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const { error } = await this.client.from('questions').delete().in('id', ids);
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
      .from('questions')
      .update({ is_disabled: isDisabled, updated_at: new Date().toISOString() })
      .in('id', ids);
    if (error) {
      throw new Error(`Erro ao atualizar status das questões no Supabase: ${error.message}`);
    }
    return ids.length;
  }

  async replaceAllQuestions(questions: Question[]): Promise<Question[]> {
    const { error: deleteError } = await this.client.from('questions').delete().gte('id', 0);
    if (deleteError) {
      throw new Error(`Erro ao limpar Banco de Questões no Supabase: ${deleteError.message}`);
    }

    if (questions.length === 0) {
      return [];
    }

    const { data, error: insertError } = await this.client
      .from('questions')
      .insert(questions.map((question) => this.mapQuestionToRow(question)))
      .select('*')
      .order('id', { ascending: true });

    if (insertError) {
      throw new Error(`Erro ao inserir questões substituídas no Supabase: ${insertError.message}`);
    }

    return ((data ?? []) as SupabaseQuestionRow[]).map((row) => this.mapQuestionRow(row));
  }
}
