import type { EventCustomizationTexts, RankingEntry } from '../../domain/types';
import { EventLogoImage } from '../EventLogoImage';
import { formatTimeMMSS } from '../formatters';

export interface TotemRankingScreenProps {
  active: boolean;
  logoSrc: string;
  texts: EventCustomizationTexts;
  ranking: RankingEntry[];
  onBackToInitial: () => void;
}

// Tela de Ranking Geral do Evento ordenada por pontuação e menor tempo de resposta.
export function TotemRankingScreen({
  active,
  logoSrc,
  texts,
  ranking,
  onBackToInitial,
}: TotemRankingScreenProps) {
  return (
    <section
      id="ranking-screen"
      className={`screen ${active ? 'active' : ''}`}
      aria-hidden={!active}
    >
      <div className="screen-content">
        <EventLogoImage src={logoSrc} />
        <h2>{texts.rankingScreenTitle}</h2>
        <ol id="ranking-list" className="ranking-list-shared-style">
          {ranking.length === 0 ? (
            <li>Nenhum participante no ranking ainda.</li>
          ) : (
            ranking.map((entry) => (
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
          onClick={onBackToInitial}
        >
          {texts.rankingScreenBackButton}
        </button>
      </div>
    </section>
  );
}
