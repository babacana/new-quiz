import type {
  AuthSession,
  CreateStaffAccountInput,
  EventConfig,
  GiveUpLockoutRecord,
  MatchRecord,
  PrizeClaimRecord,
  Question,
  SyncQueueItem,
  TotemConfigSnapshot,
  UserProfile,
} from './types';

// Fonte determinística de tempo para permitir testes sem dependência de timers reais.
export interface Clock {
  now(): number;
  toISOString(ms?: number): string;
}

// Fonte de aleatoriedade para sorteio e embaralhamento determinísticos em testes.
export interface RandomSource {
  next(): number;
  shuffle<T>(items: readonly T[]): T[];
  uuid(): string;
}

// Abstração de persistência local no Totem (IndexedDB via Dexie em produção, memória em testes).
export interface LocalStore {
  getTotemConfig(): Promise<TotemConfigSnapshot | null>;
  saveTotemConfig(config: TotemConfigSnapshot): Promise<void>;
  getQuestions(eventId: string): Promise<Question[]>;
  saveQuestions(eventId: string, questions: Question[]): Promise<void>;
  getMatches(eventId: string): Promise<MatchRecord[]>;
  saveMatch(match: MatchRecord): Promise<void>;
  getPrizeClaims(eventId: string): Promise<PrizeClaimRecord[]>;
  savePrizeClaim(claim: PrizeClaimRecord): Promise<void>;
  getLockouts(eventId: string): Promise<GiveUpLockoutRecord[]>;
  saveLockout(lockout: GiveUpLockoutRecord): Promise<void>;
  getSyncQueue(): Promise<SyncQueueItem[]>;
  enqueueSyncItem(item: SyncQueueItem): Promise<void>;
  markSyncItemCompleted(idempotencyKey: string): Promise<void>;
  incrementSyncRetry(idempotencyKey: string, errorMessage?: string): Promise<void>;
}

// Resultado do download inicial ou atualização de pacote de Evento vindo da nuvem.
export interface CloudEventSnapshot {
  event: EventConfig;
  questions: Question[];
  matches?: MatchRecord[];
  prizeClaims?: PrizeClaimRecord[];
  lockouts?: GiveUpLockoutRecord[];
}

// Resultado retornado pela nuvem ao sincronizar uma Partida e seu possível Brinde.
export interface PushMatchResponse {
  syncedAt: string;
  resolvedPrizeClaim?: PrizeClaimRecord | null;
  prizeStockRemaining?: number | null;
}

// Abstração de comunicação com a nuvem (Supabase em produção, InMemoryCloudGateway em testes).
export interface CloudGateway {
  isOnline(): boolean;
  pullEventSnapshot(eventId: string): Promise<CloudEventSnapshot | null>;
  pushMatch(payload: {
    idempotencyKey: string;
    match: MatchRecord;
    prizeClaim?: PrizeClaimRecord | null;
  }): Promise<PushMatchResponse>;
  pushGiveUpLockout(payload: {
    idempotencyKey: string;
    lockout: GiveUpLockoutRecord;
  }): Promise<{ syncedAt: string }>;

  // Autenticação e gestão da Equipe do Estande (Administrador e Operador)
  authenticate(email: string, password: string): Promise<AuthSession>;
  signOut(): Promise<void>;
  getCurrentSession(): Promise<AuthSession | null>;
  listStaffProfiles(): Promise<UserProfile[]>;
  createStaffProfile(input: CreateStaffAccountInput): Promise<UserProfile>;
  updateStaffProfileRole(profileId: string, role: UserProfile['role']): Promise<UserProfile>;
  deleteStaffProfile(profileId: string): Promise<void>;

  // Gestão Multi-Evento e vínculos com o Banco de Questões Central
  listEvents(): Promise<EventConfig[]>;
  saveEvent(event: EventConfig): Promise<EventConfig>;
  getEventQuestionIds(eventId: string): Promise<number[]>;
  setEventQuestions(eventId: string, questionIds: number[]): Promise<void>;

  // Operações no Banco de Questões Central
  listAllQuestions(): Promise<Question[]>;
  saveQuestion(question: Question): Promise<Question>;
  deleteQuestions(ids: number[]): Promise<number>;
  setQuestionsDisabled(ids: number[], isDisabled: boolean): Promise<number>;
  replaceAllQuestions(questions: Question[]): Promise<Question[]>;
}
