import {
  DEFAULT_CUSTOMIZATIONS,
  DEFAULT_EVENT_CONFIG,
  DEFAULT_QUIZ_QUESTIONS,
  DEFAULT_SETTINGS,
  TIMEOUT_OPTION_TEXT,
} from './defaults';
import type { Clock, CloudGateway, LocalStore, RandomSource } from './ports';
import type {
  ActiveQuestionState,
  AnswerOutcome,
  BorderPulseState,
  DifficultyLevel,
  DifficultyPercentages,
  EventCustomizationTexts,
  EventSettings,
  EventWindowState,
  EventWindowStatus,
  IdleTimingConfig,
  IncorrectAnswerReviewItem,
  MatchAnswer,
  MatchRecord,
  MatchResultSummary,
  PreparedQuestion,
  Question,
  QuestionTimeVisualState,
  StartMatchResult,
  TimeBarPhase,
  TotemConfigSnapshot,
  TotemScreenId,
  TotemSessionSnapshot,
} from './types';

const BRAZIL_PHONE_REGEX = /^\(\d{2}\)\s\d{4,5}-\d{4}$/;
const MIN_IDLE_TIMEOUT_SECONDS = 15;
const MIN_FADE_OUT_LEAD_SECONDS = 3;

// Normaliza o nome do Participante mantendo apenas letras Latin-1, acentos e espaços em maiúsculas.
export function normalizeParticipantName(rawName: string): string {
  return rawName.replace(/[^a-zA-Z\sÀ-ÖØ-öø-ÿ]/g, '').toUpperCase();
}

// Formata dígitos numéricos para a máscara brasileira (XX) XXXXX-XXXX ou (XX) XXXX-XXXX.
export function formatPhoneMask(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '').slice(0, 11);
  if (digits.length === 0) {
    return '';
  }

  let formatted = `(${digits.slice(0, 2)}`;
  if (digits.length <= 2) {
    return formatted;
  }

  if (digits.length <= 6) {
    formatted += `) ${digits.slice(2)}`;
    return formatted;
  }

  const firstBlockEnd = digits.length > 10 ? 7 : 6;
  formatted += `) ${digits.slice(2, firstBlockEnd)}-${digits.slice(firstBlockEnd)}`;
  return formatted;
}

export function isValidBrazilPhone(phone: string): boolean {
  return BRAZIL_PHONE_REGEX.test(phone.trim());
}

export interface TotemSessionEngineDependencies {
  localStore: LocalStore;
  cloudGateway: CloudGateway;
  clock: Clock;
  random: RandomSource;
}

interface ActiveMatchInternal {
  participantName: string;
  participantPhone: string;
  startedAtMs: number;
  questions: PreparedQuestion[];
  answers: MatchAnswer[];
  currentIndex: number;
  score: number;
  hasAnswered: boolean;
  isTimedOut: boolean;
  selectedOptionIndex: number | null;
  revealedCorrectOptionIndex: number | null;
}

// Motor de sessão Offline-First do Totem, desacoplado da camada visual e de infraestrutura.
export class TotemSessionEngine {
  private readonly localStore: LocalStore;
  private readonly cloudGateway: CloudGateway;
  private readonly clock: Clock;
  private readonly random: RandomSource;

  private initialized = false;
  private screen: TotemScreenId = 'initial-screen';
  private totemConfig: TotemConfigSnapshot = {
    totemId: null,
    deviceToken: null,
    pinCode: '0000',
    event: structuredClone(DEFAULT_EVENT_CONFIG),
  };
  private questions: Question[] = structuredClone(DEFAULT_QUIZ_QUESTIONS);
  private activeMatch: ActiveMatchInternal | null = null;
  private lastResult: MatchResultSummary | null = null;
  private pendingSyncCount = 0;
  private lastValidationError: string | null = null;
  private syncInFlight: Promise<{ synced: number; failed: number; pending: number }> | null = null;

  constructor(deps: TotemSessionEngineDependencies) {
    this.localStore = deps.localStore;
    this.cloudGateway = deps.cloudGateway;
    this.clock = deps.clock;
    this.random = deps.random;
  }

  private get eventSettings(): EventSettings {
    return this.totemConfig.event.settings;
  }

  private get customizationTexts(): EventCustomizationTexts {
    return this.totemConfig.event.customizations.texts;
  }

  getNowMs(): number {
    return this.clock.now();
  }

  getElapsedMatchSeconds(): number {
    if (!this.activeMatch) {
      return 0;
    }
    return Math.max(0, Math.floor((this.clock.now() - this.activeMatch.startedAtMs) / 1000));
  }

  private formatEventDateTimePtBr(timestampMs: number): string {
    return new Date(timestampMs).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // Avalia a janela temporal do Evento em relação ao relógio do Totem.
  getEventWindowState(): EventWindowState {
    const event = this.totemConfig.event;
    const defaultCallToAction =
      this.customizationTexts.idleScreenCallToAction ||
      DEFAULT_CUSTOMIZATIONS.texts.idleScreenCallToAction;

    let status: EventWindowStatus = 'no_event';
    let startMs = Number.NaN;
    let endMs = Number.NaN;

    if (event.startTime && event.endTime) {
      startMs = new Date(event.startTime).getTime();
      endMs = new Date(event.endTime).getTime();
      if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
        const nowMs = this.clock.now();
        if (nowMs < startMs) {
          status = 'before';
        } else if (nowMs > endMs) {
          status = 'after';
        } else {
          status = 'during';
        }
      }
    }

    const eventName = event.name.trim() || 'especial';

    if (event.enableOutOfPeriodMessage && status === 'before') {
      const formattedStart = this.formatEventDateTimePtBr(startMs);
      return {
        status,
        isBlocked: true,
        idleCallToActionTitle: 'QUIZ EM BREVE!',
        idleCallToActionSubtitle: 'Toque para mais informações',
        initialScreenMessage: `O quiz "${eventName}" ainda não começou! Prepare-se, a diversão começa em ${formattedStart}.`,
      };
    }

    if (event.enableOutOfPeriodMessage && status === 'after') {
      const formattedEnd = this.formatEventDateTimePtBr(endMs);
      return {
        status,
        isBlocked: true,
        idleCallToActionTitle: 'QUIZ ENCERRADO',
        idleCallToActionSubtitle: 'Obrigado por participar!',
        initialScreenMessage: `O quiz "${eventName}" foi encerrado em ${formattedEnd}. Obrigado pela participação!`,
      };
    }

    return {
      status,
      isBlocked: false,
      idleCallToActionTitle: defaultCallToAction,
      idleCallToActionSubtitle: null,
      initialScreenMessage: null,
    };
  }

  // Valida e converte para milissegundos os tempos de inatividade e esmaecimento prévio.
  getIdleTimingConfig(): IdleTimingConfig {
    const defaultIdle = DEFAULT_SETTINGS.idleTimeoutSeconds;
    const defaultFade = DEFAULT_SETTINGS.fadeOutLeadTimeSeconds;

    const rawIdle = this.eventSettings.idleTimeoutSeconds;
    const idleTimeoutSeconds =
      Number.isFinite(rawIdle) && rawIdle >= MIN_IDLE_TIMEOUT_SECONDS ? rawIdle : defaultIdle;

    const rawFade = this.eventSettings.fadeOutLeadTimeSeconds;
    let fadeOutLeadSeconds =
      Number.isFinite(rawFade) && rawFade >= MIN_FADE_OUT_LEAD_SECONDS ? rawFade : defaultFade;

    if (fadeOutLeadSeconds >= idleTimeoutSeconds && idleTimeoutSeconds > defaultFade) {
      fadeOutLeadSeconds = defaultFade;
    } else if (fadeOutLeadSeconds >= idleTimeoutSeconds) {
      fadeOutLeadSeconds = Math.max(1, Math.floor(idleTimeoutSeconds / 2));
    }

    const idleTimeoutMs = idleTimeoutSeconds * 1000;
    const fadeOutLeadMs = fadeOutLeadSeconds * 1000;
    const fadeOutStartMs = Math.max(0, idleTimeoutMs - fadeOutLeadMs);

    return {
      idleTimeoutMs,
      fadeOutLeadMs,
      fadeOutStartMs,
    };
  }

  async initialize(): Promise<TotemSessionSnapshot> {
    const storedConfig = await this.localStore.getTotemConfig();
    if (storedConfig) {
      this.totemConfig = storedConfig;
    }

    const storedQuestions = await this.localStore.getQuestions(this.totemConfig.event.id);
    if (storedQuestions.length > 0) {
      this.questions = storedQuestions;
    }

    if (this.cloudGateway.isOnline()) {
      try {
        const cloudSnapshot = await this.cloudGateway.pullEventSnapshot(
          this.totemConfig.event.id,
        );
        if (cloudSnapshot) {
          this.totemConfig = {
            ...this.totemConfig,
            event: cloudSnapshot.event,
          };
          this.questions = cloudSnapshot.questions;
          await this.localStore.saveTotemConfig(this.totemConfig);
          await this.localStore.saveQuestions(this.totemConfig.event.id, this.questions);
        }
      } catch {
        // Falha transitória de rede não impede operação offline usando o cache local.
      }
    }

    if (!storedConfig) {
      await this.localStore.saveTotemConfig(this.totemConfig);
    }
    if (storedQuestions.length === 0) {
      await this.localStore.saveQuestions(this.totemConfig.event.id, this.questions);
    }

    await this.syncPendingQueue();
    this.initialized = true;
    this.screen = 'initial-screen';
    this.lastValidationError = null;

    return this.getSnapshot();
  }

  async startMatch(rawName: string, rawPhone: string): Promise<StartMatchResult> {
    const eventWindow = this.getEventWindowState();
    if (eventWindow.isBlocked) {
      return this.recordValidationFailure(
        eventWindow.initialScreenMessage ??
          'O Evento está fora do período de funcionamento configurado.',
      );
    }

    const normalizedName = normalizeParticipantName(rawName).trim();
    const formattedPhone = rawPhone.trim();

    if (!normalizedName) {
      return this.recordValidationFailure('Preencha o nome.');
    }

    if (!isValidBrazilPhone(formattedPhone)) {
      return this.recordValidationFailure(
        'Telefone inválido. Formato esperado: (XX) XXXXX-XXXX ou (XX) XXXX-XXXX.',
      );
    }

    const enabledQuestions = this.questions.filter((q) => !q.isDisabled);
    if (enabledQuestions.length === 0) {
      return this.recordValidationFailure(
        'Sem questões habilitadas para jogar. Verifique o Banco de Questões do Evento.',
      );
    }

    const requestedCount =
      this.eventSettings.numberOfQuestions || DEFAULT_SETTINGS.numberOfQuestions;
    const selected = this.selectQuestionsForMatch(
      enabledQuestions,
      requestedCount,
      this.eventSettings.difficultyPercentages ?? DEFAULT_SETTINGS.difficultyPercentages,
    );

    const preparedQuestions = selected.map((question) => this.prepareQuestion(question));

    this.activeMatch = {
      participantName: normalizedName,
      participantPhone: formattedPhone,
      startedAtMs: this.clock.now(),
      questions: preparedQuestions,
      answers: [],
      currentIndex: 0,
      score: 0,
      hasAnswered: false,
      isTimedOut: false,
      selectedOptionIndex: null,
      revealedCorrectOptionIndex: null,
    };
    this.screen = 'quiz-screen';
    this.lastResult = null;
    this.lastValidationError = null;

    return {
      started: true,
      snapshot: this.getSnapshot(),
    };
  }

  private transitionWithCleanState(targetScreen: TotemScreenId): TotemSessionSnapshot {
    this.activeMatch = null;
    this.lastResult = null;
    this.lastValidationError = null;
    this.screen = targetScreen;
    return this.getSnapshot();
  }

  resetToInitialScreen(): TotemSessionSnapshot {
    return this.transitionWithCleanState('initial-screen');
  }

  // Entra na Tela de Descanso descartando qualquer Partida não finalizada e estado transitório.
  enterIdleScreen(): TotemSessionSnapshot {
    return this.transitionWithCleanState('idle-screen');
  }

  // Desperta da Tela de Descanso para a tela inicial com estado limpo.
  wakeFromIdleScreen(): TotemSessionSnapshot {
    if (this.screen !== 'idle-screen') {
      return this.getSnapshot();
    }
    return this.transitionWithCleanState('initial-screen');
  }

  getPreparedQuestions(): PreparedQuestion[] {
    if (!this.activeMatch) {
      return [];
    }
    return structuredClone(this.activeMatch.questions);
  }

  getActiveAnswers(): MatchAnswer[] {
    if (!this.activeMatch) {
      return [];
    }
    return structuredClone(this.activeMatch.answers);
  }

  submitAnswer(shuffledOptionIndex: number): AnswerOutcome {
    if (!this.activeMatch || this.activeMatch.hasAnswered) {
      return this.rejectedAnswerOutcome();
    }

    const question = this.activeMatch.questions[this.activeMatch.currentIndex];
    if (
      !question ||
      shuffledOptionIndex < 0 ||
      shuffledOptionIndex >= question.shuffledOptions.length
    ) {
      return this.rejectedAnswerOutcome();
    }

    const chosenOption = question.shuffledOptions[shuffledOptionIndex];
    return this.recordQuestionOutcome({
      question,
      selectedOptionIndex: shuffledOptionIndex,
      selectedOptionText: chosenOption.text,
      isCorrect: chosenOption.isCorrect,
      isTimedOut: false,
    });
  }

  handleQuestionTimeout(): AnswerOutcome {
    if (!this.activeMatch || this.activeMatch.hasAnswered) {
      return this.rejectedAnswerOutcome();
    }

    const question = this.activeMatch.questions[this.activeMatch.currentIndex];
    if (!question) {
      return this.rejectedAnswerOutcome();
    }

    return this.recordQuestionOutcome({
      question,
      selectedOptionIndex: null,
      selectedOptionText: TIMEOUT_OPTION_TEXT,
      isCorrect: false,
      isTimedOut: true,
    });
  }

  async advanceAfterAnswer(): Promise<TotemSessionSnapshot> {
    if (!this.activeMatch || !this.activeMatch.hasAnswered) {
      return this.getSnapshot();
    }

    if (this.activeMatch.currentIndex < this.activeMatch.questions.length - 1) {
      this.activeMatch.currentIndex += 1;
      this.activeMatch.hasAnswered = false;
      this.activeMatch.isTimedOut = false;
      this.activeMatch.selectedOptionIndex = null;
      this.activeMatch.revealedCorrectOptionIndex = null;
      return this.getSnapshot();
    }

    await this.finalizeMatch();
    return this.getSnapshot();
  }

  async syncPendingQueue(): Promise<{ synced: number; failed: number; pending: number }> {
    // Evita envios concorrentes quando múltiplos gatilhos (fim da Partida, evento online, timer) disparam juntos.
    if (this.syncInFlight) {
      return this.syncInFlight;
    }

    this.syncInFlight = this.runSyncPendingQueue();
    try {
      return await this.syncInFlight;
    } finally {
      this.syncInFlight = null;
    }
  }

  private async runSyncPendingQueue(): Promise<{
    synced: number;
    failed: number;
    pending: number;
  }> {
    const queue = await this.localStore.getSyncQueue();
    if (!this.cloudGateway.isOnline()) {
      this.pendingSyncCount = queue.length;
      return { synced: 0, failed: 0, pending: queue.length };
    }

    let synced = 0;
    let failed = 0;

    for (const item of queue) {
      try {
        const { syncedAt } = await this.cloudGateway.pushMatch({
          idempotencyKey: item.idempotencyKey,
          match: item.payload,
        });
        await this.localStore.saveMatch({
          ...item.payload,
          syncedAt,
        });
        await this.localStore.markSyncItemCompleted(item.idempotencyKey);
        synced += 1;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
        await this.localStore.incrementSyncRetry(item.idempotencyKey, errorMessage);
        failed += 1;
      }
    }

    const remainingQueue = await this.localStore.getSyncQueue();
    this.pendingSyncCount = remainingQueue.length;
    return { synced, failed, pending: this.pendingSyncCount };
  }

  private async finalizeMatch(): Promise<void> {
    const match = this.activeMatch;
    if (!match) return;

    // Limpa a Partida ativa antes dos awaits para impedir finalização duplicada por duplo toque.
    this.activeMatch = null;

    const totalQuestions = match.questions.length;
    const timeSeconds = Math.max(0, Math.floor((this.clock.now() - match.startedAtMs) / 1000));
    const matchId = this.random.uuid();
    const playedAt = this.clock.toISOString();

    const matchRecord: MatchRecord = {
      id: matchId,
      eventId: this.totemConfig.event.id,
      totemId: this.totemConfig.totemId,
      participantName: match.participantName,
      participantPhone: match.participantPhone,
      score: match.score,
      totalQuestions,
      timeSeconds,
      answers: structuredClone(match.answers),
      playedAt,
      syncedAt: null,
    };

    const incorrectAnswers: IncorrectAnswerReviewItem[] = match.answers
      .filter((answer) => !answer.isCorrect)
      .map((answer) => ({
        questionId: answer.questionId,
        questionText: answer.questionText,
        selectedOptionText: answer.selectedOptionText,
        correctOptionText: answer.correctOptionText,
      }));

    this.lastResult = {
      matchId,
      participantName: match.participantName,
      participantPhone: match.participantPhone,
      score: match.score,
      totalQuestions,
      timeSeconds,
      wonPrize: match.score >= this.eventSettings.minScoreForPrize,
      isPerfectScore: incorrectAnswers.length === 0,
      canShowIncorrectAnswers: incorrectAnswers.length > 0,
      incorrectAnswers,
    };
    this.screen = 'result-screen';

    await this.localStore.saveMatch(matchRecord);
    await this.localStore.enqueueSyncItem({
      idempotencyKey: matchId,
      type: 'match_completed',
      eventId: matchRecord.eventId,
      payload: matchRecord,
      createdAt: playedAt,
      retryCount: 0,
    });

    await this.syncPendingQueue();
  }

  private recordQuestionOutcome(params: {
    question: PreparedQuestion;
    selectedOptionIndex: number | null;
    selectedOptionText: string;
    isCorrect: boolean;
    isTimedOut: boolean;
  }): AnswerOutcome {
    const match = this.activeMatch!;
    const { question, selectedOptionIndex, selectedOptionText, isCorrect, isTimedOut } = params;

    if (isCorrect) {
      match.score += 1;
    }

    const correctShuffledIndex = question.shuffledOptions.findIndex((opt) => opt.isCorrect);
    const shouldRevealCorrect = isCorrect || this.eventSettings.showCorrectAnswerOnWrong;
    const revealedCorrectOptionIndex =
      shouldRevealCorrect && correctShuffledIndex >= 0 ? correctShuffledIndex : null;

    match.answers.push({
      questionId: question.id,
      questionText: question.text,
      options: [...question.originalOptions],
      selectedOptionText,
      correctOptionIndex: question.originalCorrectIndex,
      correctOptionText: question.originalOptions[question.originalCorrectIndex],
      isCorrect,
    });

    match.hasAnswered = true;
    match.isTimedOut = isTimedOut;
    match.selectedOptionIndex = selectedOptionIndex;
    match.revealedCorrectOptionIndex = revealedCorrectOptionIndex;

    const advanceButtonLabel = this.getAdvanceButtonLabel(
      match.currentIndex,
      match.questions.length,
    );

    return {
      accepted: true,
      isCorrect,
      isTimedOut,
      revealedCorrectOptionIndex,
      advanceButtonLabel,
      snapshot: this.getSnapshot(),
    };
  }

  private rejectedAnswerOutcome(): AnswerOutcome {
    const match = this.activeMatch;
    const advanceButtonLabel = match
      ? this.getAdvanceButtonLabel(match.currentIndex, match.questions.length)
      : this.customizationTexts.quizScreenNextButton;

    return {
      accepted: false,
      isCorrect: false,
      isTimedOut: false,
      revealedCorrectOptionIndex: null,
      advanceButtonLabel,
      snapshot: this.getSnapshot(),
    };
  }

  private getAdvanceButtonLabel(currentIndex: number, totalQuestions: number): string {
    return currentIndex >= totalQuestions - 1
      ? this.customizationTexts.quizScreenFinalizeButton
      : this.customizationTexts.quizScreenNextButton;
  }

  getQuestionTimeVisualState(remainingMs: number): QuestionTimeVisualState {
    const settings = this.eventSettings;
    const totalMs = (settings.timePerQuestion || DEFAULT_SETTINGS.timePerQuestion) * 1000;
    const clampedRemainingMs = Math.max(0, Math.min(totalMs, remainingMs));
    const percentageRemaining = totalMs > 0 ? (clampedRemainingMs / totalMs) * 100 : 0;
    const remainingSeconds = clampedRemainingMs / 1000;

    const warningThresholdSeconds = 10;
    const criticalThresholdSeconds = 5;

    let hue = 120;
    let phase: TimeBarPhase = 'normal';
    let borderPulseState: BorderPulseState = 'none';

    if (remainingSeconds <= criticalThresholdSeconds) {
      hue = 0;
      phase = 'critical';
      borderPulseState = settings.enableTimeAlertBorderPulse ? 'critical' : 'none';
    } else if (remainingSeconds <= warningThresholdSeconds) {
      const progressToYellow =
        (remainingSeconds - criticalThresholdSeconds) /
        (warningThresholdSeconds - criticalThresholdSeconds);
      hue = Math.max(0, Math.min(120, Math.round(progressToYellow * 60)));
      phase = 'warning';
      borderPulseState = settings.enableTimeAlertBorderPulse ? 'warning' : 'none';
    }

    const isFlashing = Boolean(
      settings.enableTimeAlertFlash &&
        clampedRemainingMs > 0 &&
        remainingSeconds <= criticalThresholdSeconds,
    );

    return {
      remainingMs: clampedRemainingMs,
      totalMs,
      percentageRemaining,
      barColor: `hsl(${hue}, 80%, 50%)`,
      phase,
      borderPulseState,
      isFlashing,
    };
  }

  private selectQuestionsForMatch(
    enabledQuestions: Question[],
    requestedCount: number,
    percentages: DifficultyPercentages,
  ): Question[] {
    const targetCount = Math.min(requestedCount, enabledQuestions.length);
    const groups: Record<DifficultyLevel, Question[]> = {
      facil: this.random.shuffle(enabledQuestions.filter((q) => q.difficulty === 'facil')),
      moderado: this.random.shuffle(enabledQuestions.filter((q) => q.difficulty === 'moderado')),
      dificil: this.random.shuffle(enabledQuestions.filter((q) => q.difficulty === 'dificil')),
    };

    const quotas: Record<DifficultyLevel, number> = {
      facil: Math.round(targetCount * (percentages.facil / 100)),
      moderado: Math.round(targetCount * (percentages.moderado / 100)),
      dificil: Math.round(targetCount * (percentages.dificil / 100)),
    };

    const difficultiesByPriority: DifficultyLevel[] = (
      ['facil', 'moderado', 'dificil'] as DifficultyLevel[]
    ).sort((a, b) => percentages[b] - percentages[a]);

    let quotaTotal = quotas.facil + quotas.moderado + quotas.dificil;
    while (quotaTotal !== targetCount) {
      if (quotaTotal < targetCount) {
        const target = difficultiesByPriority.find((d) => groups[d].length > quotas[d]);
        if (!target) break;
        quotas[target] += 1;
      } else {
        const target = [...difficultiesByPriority].reverse().find((d) => quotas[d] > 0);
        if (!target) break;
        quotas[target] -= 1;
      }
      quotaTotal = quotas.facil + quotas.moderado + quotas.dificil;
    }

    const picked: Question[] = [
      ...groups.facil.slice(0, quotas.facil),
      ...groups.moderado.slice(0, quotas.moderado),
      ...groups.dificil.slice(0, quotas.dificil),
    ];

    const remainingNeeded = targetCount - picked.length;
    if (remainingNeeded > 0) {
      const pickedIds = new Set(picked.map((q) => q.id));
      const remainingPool = this.random.shuffle(
        enabledQuestions.filter((q) => !pickedIds.has(q.id)),
      );
      picked.push(...remainingPool.slice(0, remainingNeeded));
    }

    return this.random.shuffle(picked.slice(0, targetCount));
  }

  private prepareQuestion(question: Question): PreparedQuestion {
    const options = question.options.map((text, index) => ({
      text,
      isCorrect: index === question.correctIndex,
      originalIndex: index,
    }));

    return {
      id: question.id,
      text: question.text,
      difficulty: question.difficulty,
      originalOptions: [...question.options],
      originalCorrectIndex: question.correctIndex,
      shuffledOptions: this.random.shuffle(options),
    };
  }

  private recordValidationFailure(errorMessage: string): StartMatchResult {
    this.lastValidationError = errorMessage;
    return {
      started: false,
      errorMessage,
      snapshot: this.getSnapshot(),
    };
  }

  private buildCurrentQuestionState(): ActiveQuestionState | null {
    if (!this.activeMatch) {
      return null;
    }
    const { questions, currentIndex } = this.activeMatch;
    if (currentIndex >= questions.length) {
      return null;
    }

    return {
      index: currentIndex,
      total: questions.length,
      question: structuredClone(questions[currentIndex]),
      hasAnswered: this.activeMatch.hasAnswered,
      isTimedOut: this.activeMatch.isTimedOut,
      selectedOptionIndex: this.activeMatch.selectedOptionIndex,
      revealedCorrectOptionIndex: this.activeMatch.revealedCorrectOptionIndex,
      advanceButtonLabel: this.getAdvanceButtonLabel(currentIndex, questions.length),
    };
  }

  getSnapshot(): TotemSessionSnapshot {
    const activeQuestionsCount = this.questions.filter((q) => !q.isDisabled).length;
    return {
      initialized: this.initialized,
      screen: this.screen,
      event: structuredClone(this.totemConfig.event),
      eventWindow: this.getEventWindowState(),
      availableQuestionsCount: activeQuestionsCount,
      activeMatch: this.activeMatch
        ? {
            participantName: this.activeMatch.participantName,
            participantPhone: this.activeMatch.participantPhone,
            startedAtMs: this.activeMatch.startedAtMs,
            score: this.activeMatch.score,
            currentQuestion: this.buildCurrentQuestionState(),
          }
        : null,
      lastResult: this.lastResult ? structuredClone(this.lastResult) : null,
      pendingSyncCount: this.pendingSyncCount,
      isOnline: this.cloudGateway.isOnline(),
      lastValidationError: this.lastValidationError,
    };
  }
}
