import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_CUSTOMIZATIONS, DEFAULT_SETTINGS } from '../domain/defaults';
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
  RemoteCommandPayload,
  RemoteCommandType,
  TotemChannelEvent,
  TotemOnlineStatus,
  TotemRecord,
  TotemScreenId,
  UserProfile,
  UserRole,
} from '../domain/types';

export interface SupabaseProfileRow {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  created_at: string;
}

export interface SupabaseEventRow {
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

export interface SupabaseQuestionRow {
  id: number;
  text: string;
  options: [string, string, string, string];
  correct_index: number;
  difficulty: DifficultyLevel;
  tags: string[];
  is_disabled: boolean;
}

export interface SupabaseMatchRow {
  id: string;
  event_id: string;
  totem_id: string | null;
  participant_name: string;
  participant_phone: string;
  score: number;
  total_questions: number;
  time_seconds: number;
  answers?: MatchAnswer[] | null;
  played_at: string;
  synced_at: string | null;
}

export interface SupabasePrizeClaimRow {
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

export interface SupabaseLockoutRow {
  id: string;
  event_id: string;
  totem_id: string | null;
  participant_phone: string;
  locked_at: string;
  expires_at: string;
}

export interface SupabaseTotemRow {
  id: string;
  name: string;
  pairing_code: string;
  device_token: string | null;
  event_id: string | null;
  pin_code: string;
  is_paired: boolean;
  online_status: TotemOnlineStatus;
  last_seen_at: string | null;
  current_screen: TotemScreenId;
  config_version: number;
  pending_sync_count: number;
  created_at: string;
}

export interface SupabaseTotemCommandRow {
  id: string;
  type: RemoteCommandType;
  target_totem_id: string | null;
  target_event_id: string | null;
  event_id: string | null;
  target_screen: 'initial-screen' | 'idle-screen' | null;
  config_version: number | null;
  issued_at: string;
}

const DEFAULT_POSTGREST_PAGE_SIZE = 1000;
const cachedClients = new Map<string, SupabaseClient>();

/** Retorna instância única do SupabaseClient por par (url, anonKey) evitando múltiplos GoTrueClient. */
export function getSharedSupabaseClient(supabaseUrl: string, supabaseAnonKey: string): SupabaseClient {
  const cacheKey = `${supabaseUrl}::${supabaseAnonKey}`;
  const existing = cachedClients.get(cacheKey);
  if (existing) {
    return existing;
  }
  const client = createClient(supabaseUrl, supabaseAnonKey);
  cachedClients.set(cacheKey, client);
  return client;
}

/** Verifica conectividade do navegador de forma segura em ambiente DOM ou SSR/testes. */
export function isBrowserNavigatorOnline(): boolean {
  if (typeof navigator === 'undefined') {
    return true;
  }
  return navigator.onLine;
}

/**
 * Busca todas as páginas de uma consulta PostgREST usando `.range(from, to)`,
 * eliminando o teto silencioso de 1.000 linhas em Eventos grandes.
 */
export async function fetchAllPages<Row>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
  errorPrefix: string,
  pageSize = DEFAULT_POSTGREST_PAGE_SIZE,
): Promise<Row[]> {
  const results: Row[] = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) {
      throw new Error(`${errorPrefix}: ${error.message}`);
    }
    const batch = data ?? [];
    results.push(...batch);
    if (batch.length < pageSize) {
      break;
    }
    from += pageSize;
  }

  return results;
}

export function mapEventRow(row: SupabaseEventRow): EventConfig {
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

export function mapQuestionRow(row: SupabaseQuestionRow): Question {
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

export function mapMatchRow(row: SupabaseMatchRow): MatchRecord {
  return {
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
  };
}

export function mapPrizeClaimRow(row: SupabasePrizeClaimRow): PrizeClaimRecord {
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

export function mapPrizeClaimToInsertRow(claim: PrizeClaimRecord) {
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

export function mapLockoutRow(row: SupabaseLockoutRow): GiveUpLockoutRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    totemId: row.totem_id,
    participantPhone: row.participant_phone,
    lockedAt: row.locked_at,
    expiresAt: row.expires_at,
  };
}

export function mapTotemRow(row: SupabaseTotemRow): TotemRecord {
  return {
    id: row.id,
    name: row.name,
    pairingCode: row.pairing_code,
    deviceToken: row.device_token ?? '',
    eventId: row.event_id,
    pinCode: row.pin_code,
    isPaired: row.is_paired,
    onlineStatus: row.online_status,
    lastSeenAt: row.last_seen_at,
    currentScreen: row.current_screen,
    configVersion: row.config_version,
    pendingSyncCount: row.pending_sync_count,
    createdAt: row.created_at,
  };
}

export function mapCommandRow(row: SupabaseTotemCommandRow): RemoteCommandPayload {
  return {
    id: row.id,
    type: row.type,
    targetTotemId: row.target_totem_id,
    targetEventId: row.target_event_id,
    eventId: row.event_id ?? undefined,
    targetScreen: row.target_screen ?? undefined,
    configVersion: row.config_version ?? undefined,
    issuedAt: row.issued_at,
  };
}

export function mapProfileRow(row: SupabaseProfileRow): UserProfile {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
  };
}

/**
 * Gerenciador compartilhado do canal Realtime `totem:presence`.
 * Utiliza `httpSend` quando o canal não está ativamente subscrito para evitar o fallback deprecated.
 */
export class SupabaseRealtimeHub {
  private readonly client: SupabaseClient;
  private readonly listeners = new Set<(event: TotemChannelEvent) => void | Promise<void>>();
  private readonly includeStaffChanges: boolean;
  private channel: RealtimeChannel | null = null;
  private isSubscribed = false;

  constructor(client: SupabaseClient, includeStaffChanges: boolean) {
    this.client = client;
    this.includeStaffChanges = includeStaffChanges;
  }

  private dispatchLocal(event: TotemChannelEvent): void {
    for (const listener of this.listeners) {
      void listener(structuredClone(event));
    }
  }

  async broadcast(event: TotemChannelEvent): Promise<void> {
    if (this.channel && this.isSubscribed) {
      try {
        await this.channel.send({
          type: 'broadcast',
          event: event.type,
          payload: event,
        });
        return;
      } catch {
        // Fallback silencioso para httpSend abaixo caso o socket tenha caído.
      }
    }

    const tempChannel = this.client.channel('totem:presence', {
      config: { broadcast: { self: true } },
    });
    try {
      await tempChannel.httpSend(event.type, event);
    } catch {
      // Falha transitória de broadcast Realtime não impede a persistência no banco.
    } finally {
      if (this.channel !== tempChannel) {
        void this.client.removeChannel(tempChannel);
      }
    }
  }

  subscribe(listener: (event: TotemChannelEvent) => void | Promise<void>): () => void {
    this.listeners.add(listener);

    if (!this.channel) {
      let channel = this.client
        .channel('totem:presence', { config: { broadcast: { self: true } } })
        .on('broadcast', { event: 'PAIRING_AUTHORIZED' }, ({ payload }) => {
          this.dispatchLocal(payload as TotemChannelEvent);
        })
        .on('broadcast', { event: 'TELEMETRY_UPDATED' }, ({ payload }) => {
          this.dispatchLocal(payload as TotemChannelEvent);
        })
        .on('broadcast', { event: 'REMOTE_COMMAND' }, ({ payload }) => {
          this.dispatchLocal(payload as TotemChannelEvent);
        })
        .on('broadcast', { event: 'OPERATIONAL_DATA_UPDATED' }, ({ payload }) => {
          this.dispatchLocal(payload as TotemChannelEvent);
        });

      // Assina postgres_changes apenas na costura administrativa autenticada.
      if (this.includeStaffChanges) {
        channel = channel
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'quiz_totems' },
            (change) => {
              const row = (change.new ?? null) as SupabaseTotemRow | null;
              if (!row?.id) return;
              const totem = mapTotemRow(row);
              if (totem.isPaired) {
                this.dispatchLocal({ type: 'PAIRING_AUTHORIZED', totem });
              }
              this.dispatchLocal({ type: 'TELEMETRY_UPDATED', totem });
            },
          )
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'quiz_totem_commands' },
            (change) => {
              const row = (change.new ?? null) as SupabaseTotemCommandRow | null;
              if (!row?.id) return;
              this.dispatchLocal({
                type: 'REMOTE_COMMAND',
                command: mapCommandRow(row),
              });
            },
          )
          .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_matches' }, () => {
            this.dispatchLocal({ type: 'OPERATIONAL_DATA_UPDATED' });
          })
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'quiz_prize_claims' },
            () => {
              this.dispatchLocal({ type: 'OPERATIONAL_DATA_UPDATED' });
            },
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'quiz_give_up_lockouts' },
            () => {
              this.dispatchLocal({ type: 'OPERATIONAL_DATA_UPDATED' });
            },
          );
      }

      this.channel = channel.subscribe((status) => {
        this.isSubscribed = status === 'SUBSCRIBED';
      });
    }

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.channel) {
        const current = this.channel;
        this.channel = null;
        this.isSubscribed = false;
        void this.client.removeChannel(current);
      }
    };
  }
}
