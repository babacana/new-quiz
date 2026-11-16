import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_CUSTOMIZATIONS, DEFAULT_SETTINGS } from '../domain/defaults';
import type { CloudEventSnapshot, CloudGateway } from '../domain/ports';
import type {
  DifficultyLevel,
  EventConfig,
  EventCustomizations,
  EventSettings,
  MatchRecord,
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

    return { event, questions };
  }

  async pushMatch(payload: {
    idempotencyKey: string;
    match: MatchRecord;
  }): Promise<{ syncedAt: string }> {
    if (!this.isOnline()) {
      throw new Error('Navegador sem conectividade para sincronizar Partida.');
    }

    const syncedAt = new Date().toISOString();
    const { match } = payload;

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

    return { syncedAt };
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
