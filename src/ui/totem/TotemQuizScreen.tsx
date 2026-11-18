import type { TotemSessionEngine } from '../../domain/totemSessionEngine';
import type { ActiveQuestionState } from '../../domain/types';
import { EventLogoImage } from '../EventLogoImage';
import { DIFFICULTY_LABELS, formatTimeMMSS } from '../formatters';
import { QuestionTimerBar, type TimeAlertVisualUpdate } from './QuestionTimerBar';

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;

export interface TotemQuizScreenProps {
  active: boolean;
  engine: TotemSessionEngine;
  logoSrc: string;
  currentQuestion: ActiveQuestionState | null;
  matchStartedAtMs: number | null;
  elapsedMatchSeconds: number;
  totalQuestionMs: number;
  isSoundEnabled: boolean;
  isAdvancing: boolean;
  autoAdvanceRemaining: number | null;
  onSelectOption: (optionIndex: number) => void;
  onAdvanceQuestion: () => void;
  onRequestGiveUp: () => void;
  onElapsedMatchSecondsChange: (elapsed: number) => void;
  onTimeAlertVisualChange: (visual: TimeAlertVisualUpdate) => void;
  onQuestionTimeout: () => void;
}

// Tela principal do Quiz com dificuldade, progresso, cronômetro total da Partida, alternativas e barra regressiva.
export function TotemQuizScreen({
  active,
  engine,
  logoSrc,
  currentQuestion,
  matchStartedAtMs,
  elapsedMatchSeconds,
  totalQuestionMs,
  isSoundEnabled,
  isAdvancing,
  autoAdvanceRemaining,
  onSelectOption,
  onAdvanceQuestion,
  onRequestGiveUp,
  onElapsedMatchSecondsChange,
  onTimeAlertVisualChange,
  onQuestionTimeout,
}: TotemQuizScreenProps) {
  return (
    <section
      id="quiz-screen"
      className={`screen ${active ? 'active' : ''}`}
      aria-hidden={!active}
    >
      <EventLogoImage src={logoSrc} />

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
                    const isRevealedCorrect = currentQuestion.revealedCorrectOptionIndex === idx;

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
                      onClick={() => onSelectOption(idx)}
                    >
                      <span className="option-letter" aria-hidden="true">
                        {OPTION_LETTERS[idx] ?? idx + 1}
                      </span>
                      <span className="option-label">{option.text}</span>
                    </button>
                  );
                })}
              </div>

              <QuestionTimerBar
                engine={engine}
                isQuizActive={active}
                matchStartedAtMs={matchStartedAtMs}
                questionIndex={currentQuestion.index}
                hasAnswered={currentQuestion.hasAnswered}
                totalQuestionMs={totalQuestionMs}
                isSoundEnabled={isSoundEnabled}
                onElapsedMatchSecondsChange={onElapsedMatchSecondsChange}
                onTimeAlertVisualChange={onTimeAlertVisualChange}
                onTimeout={onQuestionTimeout}
              />

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
                    onClick={onAdvanceQuestion}
                  >
                    {autoAdvanceRemaining !== null
                      ? `${currentQuestion.advanceButtonLabel} (${autoAdvanceRemaining}s)`
                      : currentQuestion.advanceButtonLabel}
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
                  onClick={onRequestGiveUp}
                >
                  &times;
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
