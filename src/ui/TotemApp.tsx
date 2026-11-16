import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DexieLocalStore } from '../adapters/dexieLocalStore';
import { InMemoryCloudGateway } from '../adapters/inMemoryCloudGateway';
import { SupabaseCloudGateway } from '../adapters/supabaseCloudGateway';
import { CryptoRandomSource, SystemClock } from '../adapters/systemAdapters';
import {
  TotemSessionEngine,
  formatPhoneMask,
  normalizeParticipantName,
} from '../domain/totemSessionEngine';
import type { TotemSessionSnapshot } from '../domain/types';
import { AccessibilityControls } from './AccessibilityControls';
import {
  DEFAULT_KEYBOARD_HEIGHT_VH,
  VirtualKeyboard,
  type VirtualKeyboardField,
} from './VirtualKeyboard';
import {
  DIFFICULTY_LABELS,
  PRIZE_STATUS_LABELS,
  formatAwardedAtPtBr,
  formatTimeMMSS,
} from './formatters';
import './styles.css';

type ActiveTotemModal =
  | { type: 'alert'; message: string }
  | { type: 'incorrect' }
  | { type: 'top3' }
  | { type: 'give-up' }
  | null;

const INTERACTION_EVENTS = [
  'click',
  'keydown',
  'touchstart',
  'mousemove',
  'input',
  'scroll',
] as const;

export interface TotemAppProps {
  engine?: TotemSessionEngine;
}

function createDefaultEngine(): TotemSessionEngine {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const cloudGateway =
    supabaseUrl && supabaseKey
      ? new SupabaseCloudGateway(supabaseUrl, supabaseKey)
      : new InMemoryCloudGateway({ online: typeof navigator === 'undefined' ? true : navigator.onLine });

  return new TotemSessionEngine({
    localStore: new DexieLocalStore(),
    cloudGateway,
    clock: new SystemClock(),
    random: new CryptoRandomSource(),
  });
}

// Interface principal do Totem desacoplada da regra de negócio via TotemSessionEngine.
export function TotemApp({ engine: injectedEngine }: TotemAppProps) {
  const engine = useMemo(() => injectedEngine ?? createDefaultEngine(), [injectedEngine]);

  const [snapshot, setSnapshot] = useState<TotemSessionSnapshot>(() => engine.getSnapshot());
  const [nameInput, setNameInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [activeModal, setActiveModal] = useState<ActiveTotemModal>(null);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [isFadingToIdle, setIsFadingToIdle] = useState(false);
  const [activeVirtualField, setActiveVirtualField] = useState<VirtualKeyboardField | null>(null);
  const [virtualKeyboardHeightVh, setVirtualKeyboardHeightVh] = useState(
    () => snapshot.event.settings.virtualKeyboardHeight || DEFAULT_KEYBOARD_HEIGHT_VH,
  );

  const [elapsedMatchSeconds, setElapsedMatchSeconds] = useState(0);
  const [questionRemainingMs, setQuestionRemainingMs] = useState(
    () => snapshot.event.settings.timePerQuestion * 1000,
  );
  const [flashActive, setFlashActive] = useState(false);

  const questionStartMsRef = useRef<number>(engine.getNowMs());
  const timeoutHandledForIndexRef = useRef<number | null>(null);
  const fadeOutTimerRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const isResizingKeyboardRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const phoneInputRef = useRef<HTMLInputElement | null>(null);

  const clearIdleTimers = useCallback(() => {
    if (fadeOutTimerRef.current !== null) {
      window.clearTimeout(fadeOutTimerRef.current);
      fadeOutTimerRef.current = null;
    }
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const resetTransientUiState = useCallback((clearFields: boolean) => {
    setActiveModal(null);
    setActiveVirtualField(null);
    setIsFadingToIdle(false);
    setIsAdvancing(false);
    if (clearFields) {
      setNameInput('');
      setPhoneInput('');
    }
  }, []);

  // Reinicia o temporizador de ociosidade respeitando a configuração do Evento e o arraste do teclado.
  const resetIdleTimer = useCallback(() => {
    if (isResizingKeyboardRef.current || engine.getSnapshot().screen === 'idle-screen') {
      return;
    }

    clearIdleTimers();
    setIsFadingToIdle(false);

    const { idleTimeoutMs, fadeOutStartMs } = engine.getIdleTimingConfig();

    if (fadeOutStartMs > 0 && idleTimeoutMs > fadeOutStartMs) {
      fadeOutTimerRef.current = window.setTimeout(() => {
        if (engine.getSnapshot().screen !== 'idle-screen') {
          setIsFadingToIdle(true);
        }
      }, fadeOutStartMs);
    } else if (idleTimeoutMs > 0) {
      setIsFadingToIdle(true);
    }

    if (idleTimeoutMs > 0) {
      idleTimerRef.current = window.setTimeout(() => {
        clearIdleTimers();
        setFlashActive(false);
        resetTransientUiState(false);
        nameInputRef.current?.blur();
        phoneInputRef.current?.blur();
        setSnapshot(engine.enterIdleScreen());
      }, idleTimeoutMs);
    }
  }, [clearIdleTimers, engine, resetTransientUiState]);

  const handleKeyboardResizingChange = useCallback((isResizing: boolean) => {
    isResizingKeyboardRef.current = isResizing;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void engine.initialize().then((initialSnap) => {
      if (!cancelled) {
        setSnapshot(initialSnap);
      }
    });

    const syncQueueAndRefresh = () => {
      void engine.syncPendingQueue().then(() => {
        if (!cancelled) {
          setSnapshot(engine.getSnapshot());
        }
      });
    };

    window.addEventListener('online', syncQueueAndRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener('online', syncQueueAndRefresh);
    };
  }, [engine]);

  // Retentativa periódica em segundo plano enquanto houver itens pendentes na fila local.
  useEffect(() => {
    if (snapshot.pendingSyncCount === 0) {
      return;
    }

    let cancelled = false;
    const retryInterval = window.setInterval(() => {
      void engine.syncPendingQueue().then(() => {
        if (!cancelled) {
          setSnapshot(engine.getSnapshot());
        }
      });
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(retryInterval);
    };
  }, [engine, snapshot.pendingSyncCount]);

  const activeMatch = snapshot.activeMatch;
  const matchStartedAtMs = activeMatch?.startedAtMs ?? null;
  const currentQuestion = activeMatch?.currentQuestion ?? null;
  const currentQuestionIndex = currentQuestion?.index ?? -1;
  const currentQuestionHasAnswered = currentQuestion?.hasAnswered ?? false;
  const totalQuestionMs = snapshot.event.settings.timePerQuestion * 1000;

  // Reinicia cronômetro da questão apenas quando uma nova questão ou Partida começa.
  useEffect(() => {
    if (snapshot.screen !== 'quiz-screen' || matchStartedAtMs === null || currentQuestionIndex < 0) {
      return;
    }
    questionStartMsRef.current = engine.getNowMs();
    timeoutHandledForIndexRef.current = null;
    setQuestionRemainingMs(totalQuestionMs);
    setFlashActive(false);
    setIsAdvancing(false);
  }, [engine, snapshot.screen, matchStartedAtMs, currentQuestionIndex, totalQuestionMs]);

  // Atualiza cronômetro total (via Clock do motor), barra regressiva e timeout da questão.
  useEffect(() => {
    if (
      snapshot.screen !== 'quiz-screen' ||
      matchStartedAtMs === null ||
      currentQuestionIndex < 0
    ) {
      setFlashActive(false);
      return;
    }

    const updateClockAndBar = () => {
      setElapsedMatchSeconds(engine.getElapsedMatchSeconds());

      if (currentQuestionHasAnswered) {
        return;
      }

      const remaining = Math.max(
        0,
        totalQuestionMs - (engine.getNowMs() - questionStartMsRef.current),
      );
      setQuestionRemainingMs(remaining);

      if (remaining <= 0 && timeoutHandledForIndexRef.current !== currentQuestionIndex) {
        timeoutHandledForIndexRef.current = currentQuestionIndex;
        const outcome = engine.handleQuestionTimeout();
        setSnapshot(outcome.snapshot);
      }
    };

    updateClockAndBar();
    const intervalId = window.setInterval(updateClockAndBar, 50);
    return () => window.clearInterval(intervalId);
  }, [
    engine,
    snapshot.screen,
    matchStartedAtMs,
    currentQuestionHasAnswered,
    currentQuestionIndex,
    totalQuestionMs,
  ]);

  const visualTimeState = engine.getQuestionTimeVisualState(questionRemainingMs);
  const showTimeAlerts =
    snapshot.screen === 'quiz-screen' && Boolean(currentQuestion && !currentQuestion.hasAnswered);

  // Controla o pulso intermitente de flash nos últimos 5 segundos quando habilitado.
  useEffect(() => {
    if (!showTimeAlerts || !visualTimeState.isFlashing) {
      setFlashActive(false);
      return;
    }

    let timeoutHide: number | undefined;
    const triggerPulse = () => {
      setFlashActive(true);
      timeoutHide = window.setTimeout(() => setFlashActive(false), 300);
    };

    triggerPulse();
    const flashTimer = window.setInterval(triggerPulse, 700);
    return () => {
      window.clearInterval(flashTimer);
      if (timeoutHide !== undefined) {
        window.clearTimeout(timeoutHide);
      }
    };
  }, [showTimeAlerts, visualTimeState.isFlashing]);

  // Sincroniza a altura padrão do teclado virtual ao carregar novas configurações do Evento.
  const configuredKeyboardHeight = snapshot.event.settings.virtualKeyboardHeight;
  useEffect(() => {
    setVirtualKeyboardHeightVh(configuredKeyboardHeight || DEFAULT_KEYBOARD_HEIGHT_VH);
  }, [configuredKeyboardHeight]);

  // Garante fechamento do teclado virtual sempre que o Totem sair da tela inicial.
  useEffect(() => {
    if (snapshot.screen !== 'initial-screen') {
      setActiveVirtualField(null);
    }
  }, [snapshot.screen]);

  // Gerencia temporizadores de esmaecimento e transição para a Tela de Descanso.
  const { idleTimeoutSeconds, fadeOutLeadTimeSeconds } = snapshot.event.settings;
  useEffect(() => {
    if (snapshot.screen === 'idle-screen') {
      clearIdleTimers();
      setIsFadingToIdle(false);
      return;
    }

    resetIdleTimer();
    return () => {
      clearIdleTimers();
    };
  }, [
    snapshot.initialized,
    snapshot.screen,
    idleTimeoutSeconds,
    fadeOutLeadTimeSeconds,
    resetIdleTimer,
    clearIdleTimers,
  ]);

  // Reinicia inatividade apenas em eventos confiáveis fora do arraste do teclado e bloqueia menu de contexto.
  useEffect(() => {
    const handleDocumentInteraction = (event: Event) => {
      if (event.isTrusted && !isResizingKeyboardRef.current) {
        resetIdleTimer();
      }
    };

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    for (const eventName of INTERACTION_EVENTS) {
      document.addEventListener(eventName, handleDocumentInteraction, { passive: true });
    }
    document.addEventListener('contextmenu', handleContextMenu);

    return () => {
      for (const eventName of INTERACTION_EVENTS) {
        document.removeEventListener(eventName, handleDocumentInteraction);
      }
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [resetIdleTimer]);

  const handleStartQuiz = async () => {
    setActiveVirtualField(null);
    resetIdleTimer();
    const result = await engine.startMatch(nameInput, phoneInput);
    setSnapshot(result.snapshot);
    if (!result.started && result.errorMessage) {
      setActiveModal({ type: 'alert', message: result.errorMessage });
    } else {
      setElapsedMatchSeconds(0);
    }
  };

  const handleSelectOption = (optionIndex: number) => {
    resetIdleTimer();
    const outcome = engine.submitAnswer(optionIndex);
    setSnapshot(outcome.snapshot);
  };

  const handleAdvanceQuestion = async () => {
    if (isAdvancing) {
      return;
    }
    resetIdleTimer();
    setIsAdvancing(true);
    try {
      const nextSnapshot = await engine.advanceAfterAnswer();
      setSnapshot(nextSnapshot);
      if (nextSnapshot.screen === 'result-screen' && nextSnapshot.lastResult?.isTop3) {
        setActiveModal({ type: 'top3' });
      }
    } finally {
      setIsAdvancing(false);
    }
  };

  const handleOpenRanking = async () => {
    resetTransientUiState(false);
    resetIdleTimer();
    const nextSnapshot = await engine.openRankingScreen();
    setSnapshot(nextSnapshot);
  };

  const handleConfirmGiveUp = async () => {
    resetTransientUiState(true);
    const nextSnapshot = await engine.giveUpMatch();
    setSnapshot(nextSnapshot);
    resetIdleTimer();
  };

  const handleDismissWinnerAlreadyModal = () => {
    const nextSnapshot = engine.dismissAlreadyWonModal();
    resetTransientUiState(true);
    setSnapshot(nextSnapshot);
    resetIdleTimer();
  };

  const handlePlayAgain = () => {
    const nextSnapshot = engine.resetToInitialScreen();
    resetTransientUiState(true);
    setSnapshot(nextSnapshot);
    resetIdleTimer();
  };

  // Desperta o Totem da Tela de Descanso limpando campos e estado transitório da tela inicial.
  const handleWakeFromIdle = () => {
    if (engine.getSnapshot().screen !== 'idle-screen') {
      return;
    }
    const nextSnapshot = engine.wakeFromIdleScreen();
    resetTransientUiState(true);
    setSnapshot(nextSnapshot);
  };

  const handleFieldFocus = (field: VirtualKeyboardField) => {
    if (snapshot.event.settings.enableVirtualKeyboard) {
      setActiveVirtualField(field);
    } else {
      setActiveVirtualField(null);
    }
    resetIdleTimer();
  };

  // Processa teclas do teclado virtual aplicando normalização de nome ou máscara de telefone.
  const handleVirtualKeyPress = (key: string) => {
    if (!activeVirtualField) {
      return;
    }

    resetIdleTimer();

    if (key === 'OK') {
      setActiveVirtualField(null);
      if (activeVirtualField === 'nome') {
        nameInputRef.current?.blur();
      } else {
        phoneInputRef.current?.blur();
      }
      return;
    }

    if (activeVirtualField === 'nome') {
      if (key === 'Backspace') {
        setNameInput((prev) => normalizeParticipantName(prev.slice(0, -1)));
      } else if (key === 'Space') {
        setNameInput((prev) => normalizeParticipantName(`${prev} `));
      } else {
        setNameInput((prev) => normalizeParticipantName(`${prev}${key}`));
      }
      return;
    }

    if (key === 'Backspace') {
      setPhoneInput((prev) => formatPhoneMask(prev.replace(/\D/g, '').slice(0, -1)));
    } else if (key !== 'Space') {
      setPhoneInput((prev) => formatPhoneMask(`${prev}${key}`));
    }
  };

  const containerClasses = ['quiz-container'];
  if (isFadingToIdle && snapshot.screen !== 'idle-screen') {
    containerClasses.push('fading-to-idle');
  }
  if (showTimeAlerts && visualTimeState.borderPulseState === 'warning') {
    containerClasses.push('time-alert-border-pulse-warning');
  } else if (showTimeAlerts && visualTimeState.borderPulseState === 'critical') {
    containerClasses.push('time-alert-border-pulse-critical');
  }
  if (showTimeAlerts && flashActive) {
    containerClasses.push('time-alert-flash-effect');
  }

  const texts = snapshot.event.customizations.texts;
  const logoSrc = `/assets/${snapshot.event.customizations.visualIdentity.logoFileName || 'logo.png'}`;
  const { eventWindow } = snapshot;
  const shouldHideStartButton = eventWindow.isBlocked && eventWindow.status === 'after';

  return (
    <div className={containerClasses.join(' ')}>
      <AccessibilityControls
        hiddenOnIdle={snapshot.screen === 'idle-screen'}
        onInteraction={resetIdleTimer}
      />

      <section
        id="initial-screen"
        className={`screen ${snapshot.screen === 'initial-screen' ? 'active' : ''}`}
        aria-hidden={snapshot.screen !== 'initial-screen'}
      >
        <div className="screen-content">
          <img src={logoSrc} alt="Logo do Evento" className="event-logo" />
          <h2>{texts.initialScreenTitle}</h2>
          <p className="slogan">{texts.initialScreenSlogan}</p>
          {eventWindow.initialScreenMessage !== null && (
            <p id="event-status-message">{eventWindow.initialScreenMessage}</p>
          )}
          <p>Preencha seus dados para começar:</p>

          <div className="form-group">
            <label htmlFor="nome">Nome</label>
            <input
              ref={nameInputRef}
              id="nome"
              name="nome"
              type="text"
              autoComplete="off"
              placeholder={texts.inputNamePlaceholder}
              value={nameInput}
              onFocus={() => handleFieldFocus('nome')}
              onChange={(event) => {
                setNameInput(normalizeParticipantName(event.target.value));
                resetIdleTimer();
              }}
            />
          </div>

          <div className="form-group">
            <label htmlFor="telefone">Telefone</label>
            <input
              ref={phoneInputRef}
              id="telefone"
              name="telefone"
              type="tel"
              autoComplete="off"
              placeholder={texts.inputPhonePlaceholder}
              value={phoneInput}
              onFocus={() => handleFieldFocus('telefone')}
              onChange={(event) => {
                setPhoneInput(formatPhoneMask(event.target.value));
                resetIdleTimer();
              }}
            />
          </div>

          <button
            id="start-quiz-btn"
            type="button"
            className={shouldHideStartButton ? 'btn hidden' : 'btn'}
            disabled={eventWindow.isBlocked}
            hidden={shouldHideStartButton}
            onClick={handleStartQuiz}
          >
            {texts.initialScreenStartButton}
          </button>

          <button
            id="view-ranking-initial-btn"
            type="button"
            className="btn-secondary"
            onClick={handleOpenRanking}
          >
            {texts.initialScreenRankingButton}
          </button>
        </div>

        <VirtualKeyboard
          activeField={snapshot.screen === 'initial-screen' ? activeVirtualField : null}
          enabled={snapshot.event.settings.enableVirtualKeyboard}
          heightVh={virtualKeyboardHeightVh}
          onHeightVhChange={setVirtualKeyboardHeightVh}
          onKeyPress={handleVirtualKeyPress}
          onResizingChange={handleKeyboardResizingChange}
        />
      </section>

      <section
        id="quiz-screen"
        className={`screen ${snapshot.screen === 'quiz-screen' ? 'active' : ''}`}
        aria-hidden={snapshot.screen !== 'quiz-screen'}
      >
        <img src={logoSrc} alt="Logo do Evento" className="event-logo" />

        {currentQuestion && (
          <>
            <div className="quiz-header-top">
              <div
                id="question-difficulty-tag"
                className={`question-difficulty-tag difficulty-${currentQuestion.question.difficulty}`}
              >
                {DIFFICULTY_LABELS[currentQuestion.question.difficulty]}
              </div>

              <span id="question-counter" className="quiz-counter">
                {currentQuestion.index + 1}/{currentQuestion.total}
              </span>

              <div id="progress-bar-container">
                <div
                  id="progress-bar-fill"
                  style={{
                    width: `${((currentQuestion.index + 1) / currentQuestion.total) * 100}%`,
                  }}
                />
              </div>

              <span id="timer" className="quiz-timer timer-normal">
                {formatTimeMMSS(elapsedMatchSeconds)}
              </span>
            </div>

            <div className="screen-content">
              <div id="question-area">
                <h3 id="question-text">{currentQuestion.question.text}</h3>

                <div
                  id="options-container"
                  className={currentQuestion.isTimedOut ? 'options-really-dimmed' : ''}
                >
                  {currentQuestion.question.shuffledOptions.map((option, idx) => {
                    const optionClasses = ['option'];
                    if (currentQuestion.hasAnswered) {
                      optionClasses.push('disabled');
                      const isChosen = currentQuestion.selectedOptionIndex === idx;
                      const isRevealedCorrect =
                        currentQuestion.revealedCorrectOptionIndex === idx;

                      if (isRevealedCorrect || (isChosen && option.isCorrect)) {
                        optionClasses.push('correct');
                      } else if (isChosen && !option.isCorrect) {
                        optionClasses.push('incorrect');
                      }
                    }

                    return (
                      <button
                        key={`${currentQuestion.question.id}-${idx}`}
                        type="button"
                        className={optionClasses.join(' ')}
                        disabled={currentQuestion.hasAnswered}
                        onClick={() => handleSelectOption(idx)}
                      >
                        {option.text}
                      </button>
                    );
                  })}
                </div>

                {!currentQuestion.hasAnswered && (
                  <div id="question-time-bar-container" aria-label="Tempo restante da questão">
                    <div
                      id="question-time-bar-fill"
                      style={{
                        width: `${visualTimeState.percentageRemaining}%`,
                        backgroundColor: visualTimeState.barColor,
                      }}
                    />
                  </div>
                )}

                {currentQuestion.hasAnswered && (
                  <div id="post-question-controls">
                    {currentQuestion.isTimedOut && (
                      <p id="timeout-message-text">Tempo Esgotado!</p>
                    )}
                    <button
                      id="next-question-btn"
                      type="button"
                      className="btn"
                      disabled={isAdvancing}
                      onClick={handleAdvanceQuestion}
                    >
                      {currentQuestion.advanceButtonLabel}
                    </button>
                  </div>
                )}

                {!currentQuestion.hasAnswered && (
                  <button
                    id="give-up-btn"
                    type="button"
                    className="btn-give-up"
                    title="Desistir do Quiz"
                    aria-label="Desistir do Quiz"
                    onClick={() => {
                      setActiveModal({ type: 'give-up' });
                      resetIdleTimer();
                    }}
                  >
                    &times;
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      <section
        id="result-screen"
        className={`screen ${snapshot.screen === 'result-screen' ? 'active' : ''}`}
        aria-hidden={snapshot.screen !== 'result-screen'}
      >
        {snapshot.lastResult && (
          <div className="screen-content">
            <img src={logoSrc} alt="Logo do Evento" className="event-logo" />

            <h2 id="result-participant-name-title">{snapshot.lastResult.participantName},</h2>

            <p
              id="result-prize-message"
              className={`result-message ${
                snapshot.lastResult.wonPrize ? 'prize-won' : 'prize-not-won'
              }`}
            >
              {snapshot.lastResult.wonPrize
                ? texts.resultScreenPrizeWon
                : texts.resultScreenPrizeNotWon}
              {snapshot.lastResult.wonPrize && snapshot.lastResult.prizeStatus && (
                <span className="prize-status-badge">
                  {PRIZE_STATUS_LABELS[snapshot.lastResult.prizeStatus]}
                </span>
              )}
            </p>

            <div id="result-summary-details">
              <p>
                Seu Desempenho:{' '}
                <strong>
                  {snapshot.lastResult.score}/{snapshot.lastResult.totalQuestions}
                </strong>{' '}
                acertos
              </p>
              <p>
                Tempo: <strong>{formatTimeMMSS(snapshot.lastResult.timeSeconds)}</strong>
              </p>
              <p>
                Ranking:{' '}
                <strong>
                  {snapshot.lastResult.rankingPosition > 0
                    ? `${snapshot.lastResult.rankingPosition}º lugar`
                    : 'N/A'}
                </strong>
              </p>
            </div>

            {snapshot.lastResult.isPerfectScore && (
              <p id="result-all-correct-message" className="result-message all-correct-message">
                {texts.resultScreenAllCorrect}
              </p>
            )}

            {snapshot.lastResult.canShowIncorrectAnswers && (
              <button
                id="show-incorrect-answers-btn"
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setActiveModal({ type: 'incorrect' });
                  resetIdleTimer();
                }}
              >
                Onde Eu Errei?
              </button>
            )}

            <button
              id="show-ranking-btn"
              type="button"
              className="btn-secondary"
              onClick={handleOpenRanking}
            >
              {texts.resultScreenRankingButton}
            </button>

            <button id="restart-quiz-btn" type="button" className="btn" onClick={handlePlayAgain}>
              {texts.resultScreenPlayAgainButton}
            </button>
          </div>
        )}
      </section>

      <section
        id="ranking-screen"
        className={`screen ${snapshot.screen === 'ranking-screen' ? 'active' : ''}`}
        aria-hidden={snapshot.screen !== 'ranking-screen'}
      >
        <div className="screen-content">
          <img src={logoSrc} alt="Logo do Evento" className="event-logo" />
          <h2>{texts.rankingScreenTitle}</h2>
          <ol id="ranking-list" className="ranking-list-shared-style">
            {snapshot.ranking.length === 0 ? (
              <li>Nenhum participante no ranking ainda.</li>
            ) : (
              snapshot.ranking.map((entry) => (
                <li key={entry.matchId}>
                  <span>
                    {entry.position}. <span className="rank-name">{entry.participantName}</span>
                  </span>
                  <span className="rank-score">{entry.score} Acertos</span>
                  <span className="rank-time">{formatTimeMMSS(entry.timeSeconds)}</span>
                </li>
              ))
            )}
          </ol>
          <button
            id="back-to-initial-btn"
            type="button"
            className="btn"
            onClick={handlePlayAgain}
          >
            {texts.rankingScreenBackButton}
          </button>
        </div>
      </section>

      <section
        id="idle-screen"
        className={`screen ${snapshot.screen === 'idle-screen' ? 'active' : ''}`}
        aria-hidden={snapshot.screen !== 'idle-screen'}
        onClick={handleWakeFromIdle}
        onTouchStart={handleWakeFromIdle}
      >
        <div className="screen-content">
          <img src={logoSrc} alt="Logo do Evento" className="event-logo" />
          <p className="slogan">{texts.initialScreenSlogan}</p>
          <h2 id="idle-call-to-action">
            {eventWindow.idleCallToActionTitle}
            {eventWindow.idleCallToActionSubtitle && (
              <small>{eventWindow.idleCallToActionSubtitle}</small>
            )}
          </h2>
        </div>
      </section>

      {activeModal?.type === 'alert' && (
        <div
          id="alert-modal"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="alert-modal-title"
        >
          <div className="modal-content">
            <h3 id="alert-modal-title" className="modal-title">
              Atenção
            </h3>
            <p id="alert-message" className="modal-text">
              {activeModal.message}
            </p>
            <button
              id="alert-ok-btn"
              type="button"
              className="btn modal-close-btn"
              onClick={() => {
                setActiveModal(null);
                resetIdleTimer();
              }}
            >
              OK
            </button>
          </div>
        </div>
      )}

      {activeModal?.type === 'incorrect' && snapshot.lastResult && (
        <div
          id="incorrect-answers-modal"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="incorrect-answers-modal-title"
        >
          <div className="modal-content">
            <h3 id="incorrect-answers-modal-title" className="modal-title">
              {texts.modalIncorrectAnswersTitle}
            </h3>
            <div id="incorrect-answers-list" className="modal-scrollable-content">
              {snapshot.lastResult.incorrectAnswers.map((item) => (
                <div key={item.questionId} className="question-review-item">
                  <h4>{item.questionText}</h4>
                  <p className="participant-answer">
                    <span className="review-label">Sua resposta: </span>
                    <span className="review-value-participant">{item.selectedOptionText}</span>
                  </p>
                  <p className="correct-answer-review">
                    <span className="review-label">Resposta correta: </span>
                    <span className="review-value-correct">{item.correctOptionText}</span>
                  </p>
                </div>
              ))}
            </div>
            <button
              id="close-incorrect-answers-modal-btn"
              type="button"
              className="btn modal-close-btn"
              onClick={() => {
                setActiveModal(null);
                resetIdleTimer();
              }}
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {snapshot.alreadyWonModal && (
        <div
          id="winner-already-modal"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="winner-already-modal-title"
        >
          <div className="modal-content">
            <h3 id="winner-already-modal-title" className="modal-title">
              {texts.modalAlreadyWonTitle}
            </h3>
            <p id="winner-already-main-message" className="modal-text">
              {texts.modalAlreadyWonMessage}
            </p>
            <p id="winner-already-timestamp" className="modal-timestamp">
              {formatAwardedAtPtBr(snapshot.alreadyWonModal.awardedAt)}
            </p>
            <button
              id="close-winner-already-modal-btn"
              type="button"
              className="btn modal-close-btn"
              onClick={handleDismissWinnerAlreadyModal}
            >
              Entendi!
            </button>
          </div>
        </div>
      )}

      {activeModal?.type === 'top3' && snapshot.lastResult && snapshot.lastResult.isTop3 && (
        <div
          id="top3-congrats-modal"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="top3-modal-title"
        >
          <div className="modal-content">
            <h3 id="top3-modal-title" className="modal-title">
              ✨ Resultado Espetacular! ✨
            </h3>
            <div id="top3-modal-message-content">
              <p>
                Parabéns, <strong>{snapshot.lastResult.participantName}</strong>!
              </p>
              <p>Você garantiu um lugar entre os melhores desempenhos do Evento!</p>
              <p>
                <span className="msg-rank-highlight">
                  TOP {snapshot.lastResult.rankingPosition}
                </span>
              </p>
            </div>
            <button
              id="close-top3-congrats-modal-btn"
              type="button"
              className="btn modal-close-btn"
              onClick={() => {
                setActiveModal(null);
                resetIdleTimer();
              }}
            >
              OK!
            </button>
          </div>
        </div>
      )}

      {activeModal?.type === 'give-up' && (
        <div
          id="confirm-modal"
          className="modal-overlay modal-type-danger"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
        >
          <div className="modal-content">
            <h3 id="confirm-modal-title" className="modal-title">
              Confirmação
            </h3>
            <p id="confirm-message" className="modal-text">
              Tem certeza que deseja desistir do quiz? Seu progresso atual não será salvo.
            </p>
            <div className="modal-actions">
              <button
                id="confirm-proceed-btn"
                type="button"
                className="btn btn-danger"
                onClick={handleConfirmGiveUp}
              >
                Sair
              </button>
              <button
                id="confirm-cancel-btn"
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setActiveModal(null);
                  resetIdleTimer();
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
