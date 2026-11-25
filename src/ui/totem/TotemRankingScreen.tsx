import type { EventCustomizationTexts, RankingEntry } from '../../domain/types';
import type { ResolvedScreenLayout } from '../../domain/screenLayout';
import { useLanguage } from '../../i18n';
import { EventLogoImage } from '../EventLogoImage';
import { LayoutScreenContent } from './LayoutScreenContent';
import { formatTimeMMSS } from '../formatters';

export interface TotemRankingScreenProps {
  active: boolean;
  logoSrc: string;
  texts: EventCustomizationTexts;
  ranking: RankingEntry[];
  onBackToInitial: () => void;
  /** Layout resolvido do Evento; sem ele usa a distribuição padrão. */
  layout?: ResolvedScreenLayout;
  /** Elemento destacado no editor de layout do ADM. */
  highlightedElementId?: string | null;
}

// Tela de Ranking Geral do Evento ordenada por pontuação e menor tempo de resposta.
export function TotemRankingScreen({
  active,
  logoSrc,
  texts,
  ranking,
  onBackToInitial,
  layout,
  highlightedElementId,
}: TotemRankingScreenProps) {
  const { t, td } = useLanguage();
  return (
    <section
      id="ranking-screen"
      className={`screen ${active ? 'active' : ''}`}
      aria-hidden={!active}
    >
      <LayoutScreenContent
        screenId="ranking"
        layout={layout}
        highlightedElementId={highlightedElementId}
        elements={{
          logo: <EventLogoImage src={logoSrc} />,
          title: <h2>{td(texts.rankingScreenTitle)}</h2>,
          list: (
            <ol id="ranking-list" className="ranking-list-shared-style">
              {ranking.length === 0 ? (
                <li>{t('ranking.empty')}</li>
              ) : (
                ranking.map((entry) => (
                  <li key={entry.matchId}>
                    <span>
                      {entry.position}. <span className="rank-name">{entry.participantName}</span>
                    </span>
                    <span className="rank-score">{t('ranking.hits', { n: entry.score })}</span>
                    <span className="rank-time">{formatTimeMMSS(entry.timeSeconds)}</span>
                  </li>
                ))
              )}
            </ol>
          ),
          backButton: (
            <button id="back-to-initial-btn" type="button" className="btn" onClick={onBackToInitial}>
              {td(texts.rankingScreenBackButton)}
            </button>
          ),
        }}
      />
    </section>
  );
}
