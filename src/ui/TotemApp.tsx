import { useEffect, useMemo, useRef, useState } from 'react';
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
import { DIFFICULTY_LABELS, formatTimeMMSS } from './formatters';
import './styles.css';

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
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [showIncorrectModal, setShowIncorrectModal] = useState(false);
  const [isAdvancing, setIsAdvancing] = useState(false);

  const [elapsedMatchSeconds, setElapsedMatchSeconds] = useState(0);
  const [questionRemainingMs, setQuestionRemainingMs] = useState(
    () => snapshot.event.settings.timePerQuestion * 1000,
  );
  const [flashActive, setFlashActive] = useState(false);

  const questionStartMsRef = useRef<number>(engine.getNowMs());
  const timeoutHandledForIndexRef = useRef<number | null>(null);

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

  const handleStartQuiz = async () => {
    const result = await engine.startMatch(nameInput, phoneInput);
    setSnapshot(result.snapshot);
    if (!result.started && result.errorMessage) {
      setAlertMessage(result.errorMessage);
    } else {
      setElapsedMatchSeconds(0);
    }
  };

  const handleSelectOption = (optionIndex: number) => {
    const outcome = engine.submitAnswer(optionIndex);
    setSnapshot(outcome.snapshot);
  };

  const handleAdvanceQuestion = async () => {
    if (isAdvancing) {
      return;
    }
    setIsAdvancing(true);
    try {
      const nextSnapshot = await engine.advanceAfterAnswer();
      setSnapshot(nextSnapshot);
    } finally {
      setIsAdvancing(false);
    }
  };

  const handlePlayAgain = () => {
    const nextSnapshot = engine.resetToInitialScreen();
    setNameInput('');
    setPhoneInput('');
    setShowIncorrectModal(false);
    setSnapshot(nextSnapshot);
  };

  const containerClasses = ['quiz-container'];
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

  return (
    <div className={containerClasses.join(' ')}>
      <section
        id="initial-screen"
        className={`screen ${snapshot.screen === 'initial-screen' ? 'active' : ''}`}
        aria-hidden={snapshot.screen !== 'initial-screen'}
      >
        <div className="screen-content">
          <img src={logoSrc} alt="Logo do Evento" className="event-logo" />
          <h2>{texts.initialScreenTitle}</h2>
          <p className="slogan">{texts.initialScreenSlogan}</p>
          <p>Preencha seus dados para começar:</p>

          <div className="form-group">
            <label htmlFor="nome">Nome</label>
            <input
              id="nome"
              name="nome"
              type="text"
              autoComplete="off"
              placeholder={texts.inputNamePlaceholder}
              value={nameInput}
              onChange={(event) => setNameInput(normalizeParticipantName(event.target.value))}
            />
          </div>

          <div className="form-group">
            <label htmlFor="telefone">Telefone</label>
            <input
              id="telefone"
              name="telefone"
              type="tel"
              autoComplete="off"
              placeholder={texts.inputPhonePlaceholder}
              value={phoneInput}
              onChange={(event) => setPhoneInput(formatPhoneMask(event.target.value))}
            />
          </div>

          <button id="start-quiz-btn" type="button" className="btn" onClick={handleStartQuiz}>
            {texts.initialScreenStartButton}
          </button>
        </div>
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
                onClick={() => setShowIncorrectModal(true)}
              >
                Onde Eu Errei?
              </button>
            )}

            <button id="restart-quiz-btn" type="button" className="btn" onClick={handlePlayAgain}>
              {texts.resultScreenPlayAgainButton}
            </button>
          </div>
        )}
      </section>

      {alertMessage && (
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
              {alertMessage}
            </p>
            <button
              id="alert-ok-btn"
              type="button"
              className="btn modal-close-btn"
              onClick={() => setAlertMessage(null)}
            >
              OK
            </button>
          </div>
        </div>
      )}

      {showIncorrectModal && snapshot.lastResult && (
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
              onClick={() => setShowIncorrectModal(false)}
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
