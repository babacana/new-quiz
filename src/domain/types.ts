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

export interface SyncQueueItem {
  idempotencyKey: string;
  type: 'match_completed';
  eventId: string;
  payload: MatchRecord;
  createdAt: string;
  retryCount: number;
  lastError?: string;
}

export interface TotemConfigSnapshot {
  totemId: string | null;
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

export type TotemScreenId = 'initial-screen' | 'quiz-screen' | 'result-screen';

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
  isPerfectScore: boolean;
  canShowIncorrectAnswers: boolean;
  incorrectAnswers: IncorrectAnswerReviewItem[];
}

export interface TotemSessionSnapshot {
  initialized: boolean;
  screen: TotemScreenId;
  event: EventConfig;
  availableQuestionsCount: number;
  activeMatch: {
    participantName: string;
    participantPhone: string;
    startedAtMs: number;
    score: number;
    currentQuestion: ActiveQuestionState | null;
  } | null;
  lastResult: MatchResultSummary | null;
  pendingSyncCount: number;
  isOnline: boolean;
  lastValidationError: string | null;
}

export interface StartMatchResult {
  started: boolean;
  errorMessage?: string;
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
