import type {
  EventCustomizationTexts,
  EventSettings,
  EventWindowState,
  RankingEntry,
} from '../../domain/types';
import { EventLogoImage } from '../EventLogoImage';
import { formatTimeMMSS } from '../formatters';

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
}: TotemIdleScreenProps) {
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

      <div className="screen-content">
        <div className="idle-hero-header">
          <EventLogoImage src={logoSrc} />
          <p className="slogan">{texts.initialScreenSlogan}</p>
        </div>

        {!eventWindow.isBlocked && (
          <div className="idle-showcase-card" aria-live="off">
            {idleSlideIndex === 0 && (
              <div className="idle-showcase-slide" data-testid="idle-slide-podium">
                <span className="idle-showcase-kicker">Pódio ao Vivo · Top 3</span>
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
                    Ninguém no pódio ainda — seja o 1º a liderar o ranking! 🏆
                  </p>
                )}
              </div>
            )}

            {idleSlideIndex === 1 && (
              <div className="idle-showcase-slide" data-testid="idle-slide-challenge">
                <span className="idle-showcase-kicker">Desafio do Estande</span>
                <p className="idle-showcase-big-number">
                  {totalMatchesCount}{' '}
                  <span>
                    {totalMatchesCount === 1 ? 'participação' : 'participações'} no ranking
                  </span>
                </p>
                <p className="idle-showcase-sub">
                  Acerte a partir de {settings.minScoreForPrize} questões e conquiste seu brinde!
                </p>
              </div>
            )}

            {idleSlideIndex === 2 && (
              <div className="idle-showcase-slide" data-testid="idle-slide-stats">
                <span className="idle-showcase-kicker">Como Funciona</span>
                <div className="idle-stats-pills">
                  <span className="idle-stat-pill">
                    <strong>{settings.numberOfQuestions}</strong> perguntas
                  </span>
                  <span className="idle-stat-pill">
                    <strong>{settings.timePerQuestion}s</strong> por questão
                  </span>
                </div>
                <p className="idle-showcase-sub">
                  Quanto mais rápido e preciso, melhor sua posição no pódio!
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
        )}

        <h2
          id="idle-call-to-action"
          className={!eventWindow.isBlocked ? 'idle-cta-animated' : undefined}
        >
          {eventWindow.idleCallToActionTitle}
          {eventWindow.idleCallToActionSubtitle && (
            <small>{eventWindow.idleCallToActionSubtitle}</small>
          )}
        </h2>
      </div>
    </section>
  );
}
