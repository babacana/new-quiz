import type {
  AuthSession,
  CachedVisualAsset,
  CreateStaffAccountInput,
  EventConfig,
  EventVisualAssetRecord,
  EventVisualAssetUploadInput,
  GiveUpLockoutRecord,
  MatchRecord,
  PrizeClaimRecord,
  Question,
  RemoteCommandPayload,
  SyncQueueItem,
  SyncQueueMatchItem,
  TotemChannelEvent,
  TotemConfigSnapshot,
  TotemHeartbeatPayload,
  TotemLockoutRecord,
  TotemPairingAuthorizationPayload,
  TotemPairingRequestInput,
  TotemPrizeLockRecord,
  TotemRankingMatch,
  TotemRecord,
  UserProfile,
  VisualAssetKind,
} from './types';

// Sinaliza que a nuvem respondeu normalmente, mas não reconhece este Totem (excluído ou despareado).
export class TotemNotRecognizedError extends Error {
  constructor() {
    super('Totem não reconhecido pela nuvem: Pareamento removido.');
    this.name = 'TotemNotRecognizedError';
  }
}

// Fonte determinística de tempo para permitir testes sem dependência de timers reais.
/** Recarrega a página do Totem descartando caches do navegador (equivale a Ctrl+Shift+R). */
export type HardRefreshAction = () => Promise<void> | void;

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

// Contexto de autenticação do Totem para borda RPC validada por (totemId, deviceToken).
export interface TotemAuthContext {
  totemId?: string | null;
  deviceToken?: string | null;
  commandsSince?: string | null;
}

// Dados consolidados para gravação atômica de Partida local no Totem.
export interface CommitMatchLocallyInput {
  sanitizedMatch: MatchRecord;
  sanitizedPrizeClaim?: PrizeClaimRecord | null;
  updatedTotemConfig?: TotemConfigSnapshot;
  syncItem: SyncQueueMatchItem;
}

// Dados consolidados para reconciliação atômica de snapshot da nuvem no cache local do Totem.
export interface ApplyCloudEventSnapshotInput {
  eventId: string;
  totemConfig: TotemConfigSnapshot;
  questions: Question[];
  matchesToPut?: MatchRecord[];
  matchIdsToDelete?: string[];
  prizeClaimsToPut?: PrizeClaimRecord[];
  prizeClaimIdsToDelete?: string[];
  lockoutsToPut?: GiveUpLockoutRecord[];
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

  // Operações profundas em transação única para evitar gargalos sequenciais em IndexedDB.
  commitMatchLocally(input: CommitMatchLocallyInput): Promise<void>;
  applyCloudEventSnapshot(input: ApplyCloudEventSnapshotInput): Promise<void>;
}

// Resultado do download inicial ou atualização de pacote de Evento vindo da nuvem.
export interface CloudEventSnapshot {
  event: EventConfig;
  questions: Question[];
  matches?: MatchRecord[];
  rankingMatches?: TotemRankingMatch[];
  prizeClaims?: PrizeClaimRecord[];
  prizeLocks?: TotemPrizeLockRecord[];
  lockouts?: GiveUpLockoutRecord[];
  hashedLockouts?: TotemLockoutRecord[];
  pendingCommands?: RemoteCommandPayload[];
}

// Resultado retornado pela nuvem ao sincronizar uma Partida e seu possível Brinde.
export interface PushMatchResponse {
  syncedAt: string;
  resolvedPrizeClaim?: (PrizeClaimRecord | TotemPrizeLockRecord) | null;
  prizeStockRemaining?: number | null;
}

export interface ListMatchesQueryOptions {
  includeAnswers?: boolean;
}

// Costura enxuta consumida pelo runtime público do Totem (sem código administrativo).
export interface TotemCloudPort {
  isOnline(): boolean;
  pullEventSnapshot(eventId: string, auth?: TotemAuthContext): Promise<CloudEventSnapshot | null>;
  pushMatch(payload: {
    idempotencyKey: string;
    match: MatchRecord;
    prizeClaim?: PrizeClaimRecord | null;
    auth?: TotemAuthContext;
  }): Promise<PushMatchResponse>;
  pushGiveUpLockout(payload: {
    idempotencyKey: string;
    lockout: GiveUpLockoutRecord;
    auth?: TotemAuthContext;
  }): Promise<{ syncedAt: string }>;

  requestTotemPairing(input: TotemPairingRequestInput): Promise<TotemRecord>;
  claimTotemPairing(pairingCode: string): Promise<TotemRecord | null>;
  publishTotemHeartbeat(payload: TotemHeartbeatPayload): Promise<TotemRecord | null>;
  subscribeTotemChannel(
    listener: (event: TotemChannelEvent) => void | Promise<void>,
  ): () => void;
  downloadVisualAsset(url: string): Promise<{ dataUrl: string; mimeType: string }>;
}

// Costura administrativa e operacional carregada sob demanda nas rotas autenticadas (#admin e #operador).
export interface AdminCloudPort {
  isOnline(): boolean;

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

  // Pareamento de Totem, Monitoramento ao Vivo e Comandos Remotos
  authorizeTotemPairing(input: TotemPairingAuthorizationPayload): Promise<TotemRecord>;
  listTotems(): Promise<TotemRecord[]>;
  deleteTotems(totemIds: string[]): Promise<string[]>;
  dispatchRemoteCommand(command: RemoteCommandPayload): Promise<RemoteCommandPayload>;
  subscribeTotemChannel(
    listener: (event: TotemChannelEvent) => void | Promise<void>,
  ): () => void;

  // Relatórios operacionais, Brindes e Bloqueios na nuvem
  listMatches(eventId?: string, options?: ListMatchesQueryOptions): Promise<MatchRecord[]>;
  getMatchById(matchId: string): Promise<MatchRecord | null>;
  listMatchesByIds(matchIds: string[]): Promise<MatchRecord[]>;
  listPrizeClaims(eventId?: string): Promise<PrizeClaimRecord[]>;
  listPrizeClaimsByIds(claimIds: string[]): Promise<PrizeClaimRecord[]>;
  listGiveUpLockouts(eventId?: string): Promise<GiveUpLockoutRecord[]>;
  updatePrizeClaimsStatus(
    claimIds: string[],
    status: 'delivered' | 'revoked',
    deliveredAt?: string | null,
  ): Promise<PrizeClaimRecord[]>;
  expireGiveUpLockouts(eventId: string, participantPhones: string[]): Promise<number>;
  deleteMatches(matchIds: string[]): Promise<string[]>;

  // Armazenamento de ativos visuais (logotipo e plano de fundo por Evento)
  uploadEventVisualAsset(
    input: EventVisualAssetUploadInput,
  ): Promise<{ url: string; fileName: string }>;
  listEventVisualAssets(options?: {
    eventId?: string;
    kind?: VisualAssetKind;
  }): Promise<EventVisualAssetRecord[]>;
  deleteEventVisualAsset(storagePath: string): Promise<void>;

  // Importação direta de registros históricos/backup sem acionar débito de estoque
  importOperationalRecords(payload: {
    matches: MatchRecord[];
    prizeClaims: PrizeClaimRecord[];
    lockouts: GiveUpLockoutRecord[];
    replaceEventIds?: string[];
  }): Promise<void>;
}

// União completa das duas costuras para adaptadores unificados em testes e compatibilidade.
export type CloudGateway = TotemCloudPort & AdminCloudPort;
