import type {
  EventCustomizationTexts,
  EventSettings,
  EventWindowState,
  RankingEntry,
} from '../../domain/types';
import type { ResolvedScreenLayout } from '../../domain/screenLayout';
import { useLanguage } from '../../i18n';
import { EventLogoImage } from '../EventLogoImage';
import { formatTimeMMSS } from '../formatters';
import { StylizedLogoImage } from './StylizedLogoImage';
import { LayoutScreenContent } from './LayoutScreenContent';

export interface TotemIdleScreenProps {
  active: boolean;
  logoSrc: string;
  texts: EventCustomizationTexts;
  eventWindow: EventWindowState;
  settings: EventSettings;
  ranking: RankingEntry[];
  totalMatchesCount: number;
  idleSlideIndex: number;
  onWake: () => void;
  /** Layout resolvido do Evento; sem ele usa a distribuição padrão. */
  layout?: ResolvedScreenLayout;
  /** Elemento destacado no editor de layout do ADM. */
  highlightedElementId?: string | null;
}

// Tela de Descanso rotativa do Totem exibindo pódio ao vivo, total real de participações e chamada à ação.
export function TotemIdleScreen({
  active,
  logoSrc,
  texts,
  eventWindow,
  settings,
  ranking,
  totalMatchesCount,
  idleSlideIndex,
  onWake,
  layout,
  highlightedElementId,
}: TotemIdleScreenProps) {
  const { t, td } = useLanguage();
  return (
    <section
      id="idle-screen"
      className={`screen ${active ? 'active' : ''}`}
      aria-hidden={!active}
      onClick={onWake}
      onTouchStart={onWake}
    >
      {!eventWindow.isBlocked && (
        <div className="idle-ambient-bg" aria-hidden="true">
          <span className="idle-orb idle-orb-1" />
          <span className="idle-orb idle-orb-2" />
          <span className="idle-orb idle-orb-3" />
        </div>
      )}

      <LayoutScreenContent
        screenId="idle"
        layout={layout}
        highlightedElementId={highlightedElementId}
        elements={{
          logo: <EventLogoImage src={logoSrc} />,
          slogan: <p className="slogan">{td(texts.initialScreenSlogan)}</p>,
          showcase: eventWindow.isBlocked ? null : (
<div className="idle-showcase-card" aria-live="off">
            {idleSlideIndex === 0 && (
              <div className="idle-showcase-slide" data-testid="idle-slide-podium">
                <span className="idle-showcase-kicker">{t('idle.podiumKicker')}</span>
                {ranking.length > 0 ? (
                  <ol className="idle-podium-list">
                    {ranking.slice(0, 3).map((entry, idx) => (
                      <li key={entry.matchId} className={`idle-podium-item rank-${idx + 1}`}>
                        <span className="idle-podium-medal" aria-hidden="true">
                          {idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉'}
                        </span>
                        <span className="idle-podium-name">{entry.participantName}</span>
                        <span className="idle-podium-score">
                          {entry.score}/{entry.totalQuestions} · {formatTimeMMSS(entry.timeSeconds)}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="idle-showcase-highlight">
                    {t('idle.podiumEmpty')}
                  </p>
                )}
              </div>
            )}

            {idleSlideIndex === 1 && (
              <div className="idle-showcase-slide" data-testid="idle-slide-challenge">
                <span className="idle-showcase-kicker">{t('idle.challengeKicker')}</span>
                <p className="idle-showcase-big-number">
                  {totalMatchesCount}{' '}
                  <span>
                    {totalMatchesCount === 1 ? t('idle.participationOne') : t('idle.participationMany')}{' '}
                    {t('idle.inRanking')}
                  </span>
                </p>
                <p className="idle-showcase-sub">
                  {t('idle.challengeHint', { n: settings.minScoreForPrize })}
                </p>
              </div>
            )}

            {idleSlideIndex === 2 && (
              <div className="idle-showcase-slide" data-testid="idle-slide-stats">
                <span className="idle-showcase-kicker">{t('idle.howItWorksKicker')}</span>
                <div className="idle-stats-pills">
                  <span className="idle-stat-pill">
                    <strong>{settings.numberOfQuestions}</strong> {t('idle.questions')}
                  </span>
                  <span className="idle-stat-pill">
                    <strong>{settings.timePerQuestion}s</strong> {t('idle.perQuestion')}
                  </span>
                </div>
                <p className="idle-showcase-sub">
                  {t('idle.fasterHint')}
                </p>
              </div>
            )}

            <div className="idle-showcase-dots" aria-hidden="true">
              {[0, 1, 2].map((dot) => (
                <span
                  key={dot}
                  className={dot === idleSlideIndex ? 'idle-dot active' : 'idle-dot'}
                />
              ))}
            </div>
          </div>
          ),
          stylizedLogo: <StylizedLogoImage />,
          callToAction: (
        <h2
          id="idle-call-to-action"
          className={!eventWindow.isBlocked ? 'idle-cta-animated' : undefined}
        >
          {td(eventWindow.idleCallToActionTitle)}
          {eventWindow.idleCallToActionSubtitle && (
            <small>{td(eventWindow.idleCallToActionSubtitle)}</small>
          )}
        </h2>
          ),
        }}
      />
    </section>
  );
}
