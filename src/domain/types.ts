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
  enableSoundEffects?: boolean;
  autoAdvanceSeconds?: number;
  lgpdNoticeText?: string;
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
  logoUrl?: string | null;
  customBackgroundFileName: string;
  customBackgroundUrl?: string | null;
  enableCustomBackground: boolean;
  customBackgroundOpacity: number;
}

export type PredefinedThemeId = 'caesbDefault' | 'lightModern' | 'darkElegant';
export type CustomizationSection = 'texts' | 'appearance' | 'visualIdentity';

export interface PredefinedThemeDefinition {
  id: PredefinedThemeId;
  name: string;
  customizations: EventCustomizations;
}

export type VisualAssetKind = 'logo' | 'background';

export interface CachedVisualAsset {
  url: string;
  eventId: string;
  kind: VisualAssetKind;
  dataUrl: string;
  mimeType: string;
  cachedAt: string;
}

export interface ResolvedVisualAssets {
  logoSrc: string;
  backgroundSrc: string | null;
}

export interface EventVisualAssetUploadInput {
  eventId: string;
  kind: VisualAssetKind;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
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
  resolvedAssets: ResolvedVisualAssets;
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

export type DirtySection = 'event' | 'settings' | 'question' | 'customization';
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
  | { type: 'REMOTE_COMMAND'; command: RemoteCommandPayload }
  | { type: 'OPERATIONAL_DATA_UPDATED'; eventId?: string };

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

export type ParticipantPrizeFilter =
  | 'all'
  | 'winners'
  | 'non_winners'
  | 'awaiting_pickup'
  | 'delivered'
  | 'revoked'
  | 'offline_conflict';

export type ParticipantSortField =
  | 'playedAt'
  | 'eventName'
  | 'participantName'
  | 'participantPhone'
  | 'score'
  | 'timeSeconds'
  | 'prizeStatus';

export interface ParticipantReportFilterOptions {
  eventId?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  prizeFilter?: ParticipantPrizeFilter;
  onlyLockedOut?: boolean;
  exactScore?: number | null;
  sortBy?: ParticipantSortField;
  sortDirection?: SortDirection;
  page?: number;
  pageSize?: number;
}

export interface ParticipantReportItem {
  matchId: string;
  eventId: string;
  eventName: string;
  totemId: string | null;
  participantName: string;
  participantPhone: string;
  score: number;
  totalQuestions: number;
  timeSeconds: number;
  playedAt: string;
  prizeClaimId: string | null;
  prizeStatus: PrizeClaimStatus | null;
  awardedAt: string | null;
  deliveredAt: string | null;
  hasOfflineConflict: boolean;
  hasActiveGiveUpLockout: boolean;
  activeLockoutExpiresAt: string | null;
  rankingPosition: number;
}

export interface ParticipantMatchDetails extends ParticipantReportItem {
  totalMatchesByPhoneInEvent: number;
  answers: MatchAnswer[];
}

export interface OfflinePrizeConflictAlert {
  eventId: string;
  eventName: string;
  participantPhone: string;
  participantName: string;
  activeClaimId: string | null;
  activeMatchId: string | null;
  activePrizeStatus: PrizeClaimStatus | null;
  conflictClaims: Array<{
    claimId: string;
    matchId: string;
    totemId: string | null;
    awardedAt: string;
    playedAt: string | null;
    score: number | null;
  }>;
}

export interface ActiveGiveUpLockoutItem extends GiveUpLockoutRecord {
  eventName: string;
}

export interface PaginatedParticipantReportResult {
  items: ParticipantReportItem[];
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
  offlineConflicts: OfflinePrizeConflictAlert[];
  activeLockouts: ActiveGiveUpLockoutItem[];
}

export interface OperatorEventSnapshot {
  event: EventConfig;
  awaitingPickupQueue: ParticipantReportItem[];
  recentParticipants: ParticipantReportItem[];
  ranking: RankingEntry[];
  activeLockouts: GiveUpLockoutRecord[];
  offlineConflicts: OfflinePrizeConflictAlert[];
}

// Tipos de Dashboard Analítico, Estatísticas de Questões e Backup/Migração Legada (T8)
export type AnalyticsPeriodPreset =
  | 'today'
  | 'last_3_days'
  | 'last_7_days'
  | 'last_30_days'
  | 'custom'
  | 'all';

export type QuestionAnalysisMetric =
  | 'difficulty'
  | 'easiness'
  | 'most_answered'
  | 'least_answered';

export interface AnalyticsQueryOptions {
  eventId?: string;
  period?: AnalyticsPeriodPreset;
  startDate?: string;
  endDate?: string;
  questionMetric?: QuestionAnalysisMetric;
  questionPage?: number;
  questionPageSize?: number;
}

export interface AnalyticsKpis {
  totalParticipations: number;
  averageScore: number;
  averageTimeSeconds: number;
  successRatePercent: number;
}

export interface AnalyticsDailySeriesItem {
  date: string;
  count: number;
}

export interface AnalyticsScoreBucket {
  score: number;
  count: number;
}

export interface AnalyticsHourlyBucket {
  hour: number;
  count: number;
}

export interface AnalyticsQuestionStatItem {
  questionId: number;
  text: string;
  difficulty: DifficultyLevel;
  isDisabled: boolean;
  totalAnswers: number;
  correctAnswers: number;
  incorrectAnswers: number;
  accuracyPercent: number;
}

export interface AnalyticsDashboardResult {
  kpis: AnalyticsKpis;
  participationsOverTime: AnalyticsDailySeriesItem[];
  scoreDistribution: AnalyticsScoreBucket[];
  hourlyEngagement: AnalyticsHourlyBucket[];
  questionAnalysis: {
    items: AnalyticsQuestionStatItem[];
    totalItems: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export type QuestionStatsSortField =
  | 'id'
  | 'text'
  | 'totalAnswers'
  | 'correctAnswers'
  | 'incorrectAnswers'
  | 'accuracyPercent';

export interface QuestionStatsQueryOptions {
  eventId?: string;
  sortBy?: QuestionStatsSortField;
  sortDirection?: SortDirection;
  page?: number;
  pageSize?: number;
}

export interface QuestionStatsResult {
  overallAverageScore: number;
  totalParticipations: number;
  items: AnalyticsQuestionStatItem[];
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PlatformBackupPayload {
  formatVersion: 1;
  exportedAt: string;
  events: EventConfig[];
  eventQuestionLinks: Record<string, number[]>;
  questions: Question[];
  matches: MatchRecord[];
  prizeClaims: PrizeClaimRecord[];
  lockouts: GiveUpLockoutRecord[];
}

export interface BackupRestoreResult {
  sourceFormat: 'platform' | 'legacy_quiz_offline';
  targetEventId: string;
  importedQuestionsCount: number;
  remappedAnswersCount: number;
  importedEventsCount: number;
  importedMatchesCount: number;
  importedPrizeClaimsCount: number;
  importedLockoutsCount: number;
}
