import type { TotemSessionEngine } from '../../domain/totemSessionEngine';
import type { ActiveQuestionState } from '../../domain/types';
import type { ResolvedScreenLayout } from '../../domain/screenLayout';
import { useLanguage } from '../../i18n';
import { pickQuestionTranslation } from '../../domain/translations';
import { EventLogoImage } from '../EventLogoImage';
import { LayoutScreenContent } from './LayoutScreenContent';
import { formatTimeMMSS } from '../formatters';
import { QuestionTimerBar, type TimeAlertVisualUpdate } from './QuestionTimerBar';

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;

export interface TotemQuizScreenProps {
  active: boolean;
  /** Ausente na prévia do ADM: mostra uma barra de tempo estática. */
  engine: TotemSessionEngine | null;
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
  /** Layout resolvido do Evento; sem ele usa a distribuição padrão. */
  layout?: ResolvedScreenLayout;
  /** Elemento destacado no editor de layout do ADM. */
  highlightedElementId?: string | null;
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
  layout,
  highlightedElementId,
}: TotemQuizScreenProps) {
  const { t, td, language } = useLanguage();
  const translation = currentQuestion
    ? pickQuestionTranslation(currentQuestion.question.translations, language)
    : null;
  return (
    <section
      id="quiz-screen"
      className={`screen ${active ? 'active' : ''}`}
      aria-hidden={!active}
    >
      {currentQuestion && (
        <LayoutScreenContent
          screenId="quiz"
          layout={layout}
          highlightedElementId={highlightedElementId}
          elements={{
            logo: <EventLogoImage src={logoSrc} />,
            progress: (
              <div className="quiz-header-top">
                <div
                  id="question-difficulty-tag"
                  className={`question-difficulty-tag difficulty-${currentQuestion.question.difficulty}`}
                >
                  {t(`difficulty.${currentQuestion.question.difficulty}`)}
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
            ),
            question: <h3 id="question-text">{translation?.text ?? currentQuestion.question.text}</h3>,
            options: (
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
                      <span className="option-label">
                        {translation?.options[option.originalIndex] ?? option.text}
                      </span>
                    </button>
                  );
                })}
              </div>
            ),
            // Sempre montada enquanto há pergunta ativa: controla o tempo esgotado.
            timeBar: engine ? (
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
            ) : currentQuestion.hasAnswered ? null : (
              <div className="question-time-bar-row">
                <div id="question-time-bar-container" aria-label={t('quiz.timeRemaining')}>
                  <div id="question-time-bar-fill" style={{ width: '65%' }} />
                </div>
                <span id="question-time-countdown" className="question-time-countdown countdown-normal">
                  20s
                </span>
              </div>
            ),
            postControls: currentQuestion.hasAnswered ? (
              <div id="post-question-controls">
                {currentQuestion.isTimedOut && <p id="timeout-message-text">{t('quiz.timeUp')}</p>}
                <button
                  id="next-question-btn"
                  type="button"
                  className="btn"
                  disabled={isAdvancing}
                  onClick={onAdvanceQuestion}
                >
                  {autoAdvanceRemaining !== null
                    ? `${td(currentQuestion.advanceButtonLabel)} (${autoAdvanceRemaining}s)`
                    : td(currentQuestion.advanceButtonLabel)}
                </button>
              </div>
            ) : null,
            giveUp: currentQuestion.hasAnswered ? null : (
              <button
                id="give-up-btn"
                type="button"
                className="btn-give-up"
                title={t('quiz.giveUp')}
                aria-label={t('quiz.giveUp')}
                onClick={onRequestGiveUp}
              >
                &times;
              </button>
            ),
          }}
        />
      )}
    </section>
  );
}
