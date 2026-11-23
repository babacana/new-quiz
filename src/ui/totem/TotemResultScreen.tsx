import type { EventCustomizationTexts, MatchResultSummary } from '../../domain/types';
import type { ResolvedScreenLayout } from '../../domain/screenLayout';
import { EventLogoImage } from '../EventLogoImage';
import { LayoutScreenContent } from './LayoutScreenContent';
import { PRIZE_STATUS_LABELS, formatTimeMMSS } from '../formatters';

export interface TotemResultScreenProps {
  active: boolean;
  logoSrc: string;
  texts: EventCustomizationTexts;
  lastResult: MatchResultSummary | null;
  backgroundSyncNotice: string | null;
  onShowIncorrectAnswers: () => void;
  onOpenRanking: () => void;
  onPlayAgain: () => void;
  /** Layout resolvido do Evento; sem ele usa a distribuição padrão. */
  layout?: ResolvedScreenLayout;
  /** Elemento destacado no editor de layout do ADM. */
  highlightedElementId?: string | null;
}

// Tela de Resultado imediato (otimista) com atualização reativa após reconciliação em nuvem.
export function TotemResultScreen({
  active,
  logoSrc,
  texts,
  lastResult,
  backgroundSyncNotice,
  onShowIncorrectAnswers,
  onOpenRanking,
  onPlayAgain,
  layout,
  highlightedElementId,
}: TotemResultScreenProps) {
  return (
    <section
      id="result-screen"
      className={`screen ${active ? 'active' : ''}`}
      aria-hidden={!active}
    >
      {lastResult && (
        <LayoutScreenContent
          screenId="result"
          layout={layout}
          highlightedElementId={highlightedElementId}
          elements={{
            logo: <EventLogoImage src={logoSrc} />,
            participantName: (
              <h2 id="result-participant-name-title">{lastResult.participantName},</h2>
            ),
            prizeMessage: (
              <p
                id="result-prize-message"
                className={`result-message ${lastResult.wonPrize ? 'prize-won' : 'prize-not-won'}`}
              >
                {lastResult.wonPrize ? texts.resultScreenPrizeWon : texts.resultScreenPrizeNotWon}
                {lastResult.wonPrize && lastResult.prizeStatus && (
                  <span className="prize-status-badge">
                    {PRIZE_STATUS_LABELS[lastResult.prizeStatus]}
                  </span>
                )}
              </p>
            ),
            syncNotice: backgroundSyncNotice ? (
              <p className="result-sync-notice" role="status">
                {backgroundSyncNotice}
              </p>
            ) : null,
            summary: (
              <div id="result-summary-details">
                <p>
                  Seu Desempenho:{' '}
                  <strong>
                    {lastResult.score}/{lastResult.totalQuestions}
                  </strong>{' '}
                  acertos
                </p>
                <p>
                  Tempo: <strong>{formatTimeMMSS(lastResult.timeSeconds)}</strong>
                </p>
                <p>
                  Ranking:{' '}
                  <strong>
                    {lastResult.rankingPosition > 0 ? `${lastResult.rankingPosition}º lugar` : 'N/A'}
                  </strong>
                </p>
              </div>
            ),
            allCorrect: lastResult.isPerfectScore ? (
              <p id="result-all-correct-message" className="result-message all-correct-message">
                {texts.resultScreenAllCorrect}
              </p>
            ) : null,
            incorrectButton: lastResult.canShowIncorrectAnswers ? (
              <button
                id="show-incorrect-answers-btn"
                type="button"
                className="btn-secondary"
                onClick={onShowIncorrectAnswers}
              >
                Onde Eu Errei?
              </button>
            ) : null,
            rankingButton: (
              <button
                id="show-ranking-btn"
                type="button"
                className="btn-secondary"
                onClick={onOpenRanking}
              >
                {texts.resultScreenRankingButton}
              </button>
            ),
            playAgainButton: (
              <button id="restart-quiz-btn" type="button" className="btn" onClick={onPlayAgain}>
                {texts.resultScreenPlayAgainButton}
              </button>
            ),
          }}
        />
      )}
    </section>
  );
}
