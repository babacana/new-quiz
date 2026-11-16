// Tipos de domínio utilizando o vocabulário ubíquo definido em CONTEXT.md.

export type DifficultyLevel = 'facil' | 'moderado' | 'dificil';

export interface DifficultyPercentages {
  facil: number;
  moderado: number;
  dificil: number;
}

export interface EventSettings {
  numberOfQuestions: number;
  timePerQuestion: number;
  idleTimeoutSeconds: number;
  fadeOutLeadTimeSeconds: number;
  difficultyPercentages: DifficultyPercentages;
  minScoreForPrize: number;
  showCorrectAnswerOnWrong: boolean;
  rankingDisplayCount: number;
  enablePrizeLock: boolean;
  giveUpLockoutMinutes: number;
  virtualKeyboardHeight: number;
  enableVirtualKeyboard: boolean;
  enableTimeAlertBorderPulse: boolean;
  enableTimeAlertFlash: boolean;
  requireManualPrizeConfirmation: boolean;
  prizeStockLimit: number | null;
}

export interface EventCustomizationTexts {
  initialScreenTitle: string;
  initialScreenSlogan: string;
  initialScreenStartButton: string;
  initialScreenRankingButton: string;
  quizScreenNextButton: string;
  quizScreenFinalizeButton: string;
  resultScreenPrizeWon: string;
  resultScreenPrizeNotWon: string;
  resultScreenAllCorrect: string;
  resultScreenRankingButton: string;
  resultScreenPlayAgainButton: string;
  rankingScreenTitle: string;
  rankingScreenBackButton: string;
  idleScreenCallToAction: string;
  modalAlreadyWonTitle: string;
  modalAlreadyWonMessage: string;
  modalIncorrectAnswersTitle: string;
  modalAllCorrectMessage: string;
  inputNamePlaceholder: string;
  inputPhonePlaceholder: string;
}

export interface EventCustomizationColors {
  quizMainBackground: string;
  quizPrimaryButtonBg: string;
  quizPrimaryButtonText: string;
  quizSecondaryButtonBg: string;
  quizSecondaryButtonBorder: string;
  quizSecondaryButtonText: string;
  quizMainTextColor: string;
  quizHighlightColor: string;
  quizOptionBg: string;
  quizOptionText: string;
  quizOptionCorrectBg: string;
  quizOptionIncorrectBg: string;
  quizInputBorder: string;
  quizInputPlaceholder: string;
}

export interface EventCustomizationFontSizes {
  initialSloganFontSize: string;
  idleCallToActionFontSize: string;
  mainButtonsFontSize: string;
  questionTextFontSize: string;
  mainFontFamily: string;
}

export interface EventVisualIdentity {
  logoFileName: string;
  customBackgroundFileName: string;
  enableCustomBackground: boolean;
  customBackgroundOpacity: number;
}

export interface EventCustomizations {
  texts: EventCustomizationTexts;
  colors: EventCustomizationColors;
  fontSizes: EventCustomizationFontSizes;
  visualIdentity: EventVisualIdentity;
}

export interface EventConfig {
  id: string;
  name: string;
  slug: string;
  startTime: string | null;
  endTime: string | null;
  enableOutOfPeriodMessage: boolean;
  isActive: boolean;
  settings: EventSettings;
  prizeStockRemaining: number | null;
  customizations: EventCustomizations;
  configVersion: number;
}

export interface Question {
  id: number;
  text: string;
  options: [string, string, string, string];
  correctIndex: number;
  difficulty: DifficultyLevel;
  tags: string[];
  isDisabled: boolean;
}

export interface PreparedOption {
  text: string;
  isCorrect: boolean;
  originalIndex: number;
}

export interface PreparedQuestion {
  id: number;
  text: string;
  difficulty: DifficultyLevel;
  originalOptions: [string, string, string, string];
  originalCorrectIndex: number;
  shuffledOptions: PreparedOption[];
}

export interface MatchAnswer {
  questionId: number;
  questionText: string;
  options: [string, string, string, string];
  selectedOptionText: string;
  correctOptionIndex: number;
  correctOptionText: string;
  isCorrect: boolean;
}

export interface MatchRecord {
  id: string;
  eventId: string;
  totemId: string | null;
  participantName: string;
  participantPhone: string;
  score: number;
  totalQuestions: number;
  timeSeconds: number;
  answers: MatchAnswer[];
  playedAt: string;
  syncedAt?: string | null;
}

export type PrizeClaimStatus =
  | 'awaiting_pickup'
  | 'delivered'
  | 'revoked'
  | 'offline_duplicate_conflict';

export interface PrizeClaimRecord {
  id: string;
  eventId: string;
  matchId: string;
  totemId: string | null;
  participantName: string;
  participantPhone: string;
  status: PrizeClaimStatus;
  awardedAt: string;
  deliveredAt: string | null;
}

export interface GiveUpLockoutRecord {
  id: string;
  eventId: string;
  totemId: string | null;
  participantPhone: string;
  lockedAt: string;
  expiresAt: string;
}

export interface RankingEntry {
  position: number;
  matchId: string;
  participantName: string;
  participantPhone: string;
  score: number;
  totalQuestions: number;
  timeSeconds: number;
  playedAt: string;
}

export interface SyncQueueMatchItem {
  idempotencyKey: string;
  type: 'match_completed';
  eventId: string;
  payload: MatchRecord;
  prizeClaim?: PrizeClaimRecord | null;
  createdAt: string;
  retryCount: number;
  lastError?: string;
}

export interface SyncQueueLockoutItem {
  idempotencyKey: string;
  type: 'give_up_lockout_added';
  eventId: string;
  payload: GiveUpLockoutRecord;
  createdAt: string;
  retryCount: number;
  lastError?: string;
}

export type SyncQueueItem = SyncQueueMatchItem | SyncQueueLockoutItem;

export interface TotemConfigSnapshot {
  totemId: string | null;
  totemName?: string | null;
  pairingCode?: string | null;
  deviceToken: string | null;
  pinCode: string;
  event: EventConfig;
}

export interface IncorrectAnswerReviewItem {
  questionId: number;
  questionText: string;
  selectedOptionText: string;
  correctOptionText: string;
}

export type TimeBarPhase = 'normal' | 'warning' | 'critical';
export type BorderPulseState = 'none' | 'warning' | 'critical';

export interface QuestionTimeVisualState {
  remainingMs: number;
  totalMs: number;
  percentageRemaining: number;
  barColor: string;
  phase: TimeBarPhase;
  borderPulseState: BorderPulseState;
  isFlashing: boolean;
}

export type TotemScreenId =
  | 'idle-screen'
  | 'initial-screen'
  | 'quiz-screen'
  | 'result-screen'
  | 'ranking-screen';

export type EventWindowStatus = 'before' | 'during' | 'after' | 'no_event';

export interface EventWindowState {
  status: EventWindowStatus;
  isBlocked: boolean;
  idleCallToActionTitle: string;
  idleCallToActionSubtitle: string | null;
  initialScreenMessage: string | null;
}

export interface IdleTimingConfig {
  idleTimeoutMs: number;
  fadeOutLeadMs: number;
  fadeOutStartMs: number;
}

export interface ActiveQuestionState {
  index: number;
  total: number;
  question: PreparedQuestion;
  hasAnswered: boolean;
  isTimedOut: boolean;
  selectedOptionIndex: number | null;
  revealedCorrectOptionIndex: number | null;
  advanceButtonLabel: string;
}

export interface MatchResultSummary {
  matchId: string;
  participantName: string;
  participantPhone: string;
  score: number;
  totalQuestions: number;
  timeSeconds: number;
  wonPrize: boolean;
  prizeStatus: PrizeClaimStatus | null;
  rankingPosition: number;
  isTop3: boolean;
  isPerfectScore: boolean;
  canShowIncorrectAnswers: boolean;
  incorrectAnswers: IncorrectAnswerReviewItem[];
}

export interface TotemSessionSnapshot {
  initialized: boolean;
  screen: TotemScreenId;
  event: EventConfig;
  eventWindow: EventWindowState;
  availableQuestionsCount: number;
  activeMatch: {
    participantName: string;
    participantPhone: string;
    startedAtMs: number;
    score: number;
    currentQuestion: ActiveQuestionState | null;
  } | null;
  lastResult: MatchResultSummary | null;
  ranking: RankingEntry[];
  alreadyWonModal: {
    participantPhone: string;
    awardedAt: string;
  } | null;
  pendingSyncCount: number;
  isOnline: boolean;
  lastValidationError: string | null;
  pairing: TotemPairingState;
  deferredCommands: RemoteCommandPayload[];
  lastHeartbeatAt: string | null;
}

export interface StartMatchResult {
  started: boolean;
  errorMessage?: string;
  alreadyWonPrizeAt?: string;
  lockoutRemainingMinutes?: number;
  snapshot: TotemSessionSnapshot;
}

export interface AnswerOutcome {
  accepted: boolean;
  isCorrect: boolean;
  isTimedOut: boolean;
  revealedCorrectOptionIndex: number | null;
  advanceButtonLabel: string;
  snapshot: TotemSessionSnapshot;
}

// Tipos de autenticação, controle de acesso (RBAC), Multi-Evento e Banco de Questões Central (T4).
export type UserRole = 'admin' | 'operator';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export interface AuthSession {
  user: UserProfile;
  accessToken: string;
  authenticatedAt: string;
}

export interface CreateStaffAccountInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

export interface EventCustomizationsPatch {
  texts?: Partial<EventCustomizationTexts>;
  colors?: Partial<EventCustomizationColors>;
  fontSizes?: Partial<EventCustomizationFontSizes>;
  visualIdentity?: Partial<EventVisualIdentity>;
}

export interface EventUpsertInput {
  id?: string;
  name: string;
  slug?: string;
  startTime?: string | null;
  endTime?: string | null;
  enableOutOfPeriodMessage?: boolean;
  isActive?: boolean;
  settings?: Partial<EventSettings>;
  prizeStockRemaining?: number | null;
  customizations?: EventCustomizationsPatch;
  linkedQuestionIds?: number[];
}

export interface CloneEventOverrides {
  id?: string;
  name: string;
  slug?: string;
  startTime?: string | null;
  endTime?: string | null;
  isActive?: boolean;
}

export interface QuestionUpsertInput {
  id?: number;
  text: string;
  options: [string, string, string, string];
  correctIndex: number;
  difficulty: DifficultyLevel;
  tags?: string[];
  isDisabled?: boolean;
}

export type QuestionStatusFilter = 'all' | 'active' | 'disabled';
export type QuestionSortField = 'id' | 'text' | 'difficulty' | 'status';
export type SortDirection = 'asc' | 'desc';

export interface QuestionFilterOptions {
  search?: string;
  difficulties?: DifficultyLevel[];
  status?: QuestionStatusFilter;
  tags?: string[];
  eventId?: string;
  sortBy?: QuestionSortField;
  sortDirection?: SortDirection;
  page?: number;
  pageSize?: number;
}

export interface PaginatedQuestionsResult {
  items: Question[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
  counts: {
    total: number;
    active: number;
    disabled: number;
    byDifficulty: Record<DifficultyLevel, number>;
  };
}

export type QuestionsImportMode = 'merge' | 'replace';

export interface QuestionsImportResult {
  importedCount: number;
  totalAfterImport: number;
  mode: QuestionsImportMode;
}

export type DirtySection = 'event' | 'settings' | 'question';
export type UnsavedChangesResolution = 'save_and_leave' | 'discard_and_leave' | 'cancel';

export interface UnsavedNavigationPrompt {
  canProceedImmediately: boolean;
  dirtySections: DirtySection[];
  message: string;
  options: readonly ['save_and_leave', 'discard_and_leave', 'cancel'];
}

// Tipos de Pareamento de Totem, Monitoramento ao Vivo, Comandos Remotos e Diagnóstico Local (T5).
export type TotemOnlineStatus = 'online' | 'offline';
export type TotemPairingStatus = 'unpaired' | 'awaiting_authorization' | 'paired';

export interface TotemPairingState {
  isPaired: boolean;
  status: TotemPairingStatus;
  pairingCode: string | null;
  totemId: string | null;
  totemName: string | null;
  activationLink: string | null;
}

export interface TotemRecord {
  id: string;
  name: string;
  pairingCode: string;
  deviceToken: string;
  eventId: string | null;
  pinCode: string;
  isPaired: boolean;
  onlineStatus: TotemOnlineStatus;
  lastSeenAt: string | null;
  currentScreen: TotemScreenId;
  configVersion: number;
  pendingSyncCount: number;
  createdAt: string;
}

export interface AuthorizeTotemPairingInput {
  pairingCode?: string;
  name: string;
  pinCode: string;
  eventId: string;
}

export interface TotemPairingRequestInput {
  id: string;
  pairingCode: string;
  currentScreen: TotemScreenId;
  configVersion: number;
  pendingSyncCount: number;
}

export interface TotemPairingAuthorizationPayload {
  id: string;
  pairingCode: string;
  deviceToken: string;
  name: string;
  pinCode: string;
  eventId: string;
}

export interface TotemHeartbeatPayload {
  totemId: string;
  deviceToken?: string | null;
  eventId?: string | null;
  onlineStatus: TotemOnlineStatus;
  currentScreen: TotemScreenId;
  configVersion: number;
  pendingSyncCount: number;
  seenAt?: string;
}

export type RemoteCommandType =
  | 'SWITCH_EVENT'
  | 'FORCE_SYNC'
  | 'RELOAD_SCREEN'
  | 'CONFIG_UPDATED';

export interface RemoteCommandPayload {
  id: string;
  type: RemoteCommandType;
  targetTotemId: string | null;
  targetEventId: string | null;
  eventId?: string;
  targetScreen?: 'initial-screen' | 'idle-screen';
  configVersion?: number;
  issuedAt: string;
}

export interface DispatchRemoteCommandInput {
  type: RemoteCommandType;
  targetTotemId?: string | null;
  targetEventId?: string | null;
  eventId?: string;
  targetScreen?: 'initial-screen' | 'idle-screen';
}

export type TotemChannelEvent =
  | { type: 'PAIRING_AUTHORIZED'; totem: TotemRecord }
  | { type: 'TELEMETRY_UPDATED'; totem: TotemRecord }
  | { type: 'REMOTE_COMMAND'; command: RemoteCommandPayload };

export interface TotemLocalDiagnostics {
  isOnline: boolean;
  totemId: string | null;
  totemName: string | null;
  pairingCode: string | null;
  isPaired: boolean;
  eventId: string;
  eventName: string;
  configVersion: number;
  currentScreen: TotemScreenId;
  pendingSyncCount: number;
  lastHeartbeatAt: string | null;
  deferredCommandsCount: number;
}
