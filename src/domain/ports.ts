import type {
  AuthSession,
  CachedVisualAsset,
  CreateStaffAccountInput,
  EventConfig,
  EventVisualAssetUploadInput,
  GiveUpLockoutRecord,
  MatchRecord,
  PrizeClaimRecord,
  Question,
  RemoteCommandPayload,
  SyncQueueItem,
  TotemChannelEvent,
  TotemConfigSnapshot,
  TotemHeartbeatPayload,
  TotemPairingAuthorizationPayload,
  TotemPairingRequestInput,
  TotemRecord,
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
  deleteMatch(matchId: string): Promise<void>;
  getPrizeClaims(eventId: string): Promise<PrizeClaimRecord[]>;
  savePrizeClaim(claim: PrizeClaimRecord): Promise<void>;
  deletePrizeClaim(claimId: string): Promise<void>;
  getLockouts(eventId: string): Promise<GiveUpLockoutRecord[]>;
  saveLockout(lockout: GiveUpLockoutRecord): Promise<void>;
  getSyncQueue(): Promise<SyncQueueItem[]>;
  enqueueSyncItem(item: SyncQueueItem): Promise<void>;
  markSyncItemCompleted(idempotencyKey: string): Promise<void>;
  incrementSyncRetry(idempotencyKey: string, errorMessage?: string): Promise<void>;
  getVisualAsset(url: string): Promise<CachedVisualAsset | null>;
  saveVisualAsset(asset: CachedVisualAsset): Promise<void>;
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

  // Pareamento de Totem, Monitoramento ao Vivo e Comandos Remotos (T5)
  requestTotemPairing(input: TotemPairingRequestInput): Promise<TotemRecord>;
  authorizeTotemPairing(input: TotemPairingAuthorizationPayload): Promise<TotemRecord>;
  claimTotemPairing(pairingCode: string): Promise<TotemRecord | null>;
  listTotems(): Promise<TotemRecord[]>;
  deleteTotems(totemIds: string[]): Promise<string[]>;
  publishTotemHeartbeat(payload: TotemHeartbeatPayload): Promise<TotemRecord | null>;
  dispatchRemoteCommand(command: RemoteCommandPayload): Promise<RemoteCommandPayload>;
  subscribeTotemChannel(
    listener: (event: TotemChannelEvent) => void | Promise<void>,
  ): () => void;

  // Relatórios operacionais, Brindes e Bloqueios na nuvem (T6)
  listMatches(eventId?: string): Promise<MatchRecord[]>;
  listPrizeClaims(eventId?: string): Promise<PrizeClaimRecord[]>;
  listGiveUpLockouts(eventId?: string): Promise<GiveUpLockoutRecord[]>;
  updatePrizeClaimsStatus(
    claimIds: string[],
    status: 'delivered' | 'revoked',
    deliveredAt?: string | null,
  ): Promise<PrizeClaimRecord[]>;
  expireGiveUpLockouts(eventId: string, participantPhones: string[]): Promise<number>;
  deleteMatches(matchIds: string[]): Promise<string[]>;

  // Armazenamento de ativos visuais (logotipo e plano de fundo por Evento - T7)
  uploadEventVisualAsset(
    input: EventVisualAssetUploadInput,
  ): Promise<{ url: string; fileName: string }>;
  downloadVisualAsset(url: string): Promise<{ dataUrl: string; mimeType: string }>;

  // Importação direta de registros históricos/backup sem acionar débito de estoque (T8)
  importOperationalRecords(payload: {
    matches: MatchRecord[];
    prizeClaims: PrizeClaimRecord[];
    lockouts: GiveUpLockoutRecord[];
    replaceEventIds?: string[];
  }): Promise<void>;
}
