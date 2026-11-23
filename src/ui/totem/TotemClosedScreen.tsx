import type { ResolvedScreenLayout } from '../../domain/screenLayout';
import type { EventCustomizationTexts, EventWindowState } from '../../domain/types';
import { EventLogoImage } from '../EventLogoImage';
import { LayoutScreenContent } from './LayoutScreenContent';

export interface TotemClosedScreenProps {
  active: boolean;
  logoSrc: string;
  texts: EventCustomizationTexts;
  eventWindow: EventWindowState;
  onOpenRanking: () => void;
  /** Layout resolvido do Evento; sem ele usa a distribuição padrão. */
  layout?: ResolvedScreenLayout;
  /** Elemento destacado no editor de layout do ADM. */
  highlightedElementId?: string | null;
}

// Tela exibida no lugar da Tela Inicial quando o Evento está fechado (ainda não começou ou já terminou):
// sem cadastro nem botão de iniciar, apenas a mensagem e o acesso ao Ranking.
export function TotemClosedScreen({
  active,
  logoSrc,
  texts,
  eventWindow,
  onOpenRanking,
  layout,
  highlightedElementId,
}: TotemClosedScreenProps) {
  return (
    <section
      id="closed-screen"
      className={`screen ${active ? 'active' : ''}`}
      aria-hidden={!active}
    >
      <LayoutScreenContent
        screenId="closed"
        layout={layout}
        highlightedElementId={highlightedElementId}
        elements={{
          logo: <EventLogoImage src={logoSrc} />,
          slogan: <p className="slogan">{texts.initialScreenSlogan}</p>,
          statusMessage: eventWindow.initialScreenMessage ? (
            <p id="closed-status-message" className="event-status-message">
              {eventWindow.initialScreenMessage}
            </p>
          ) : null,
          rankingButton: (
            <button
              id="view-ranking-closed-btn"
              type="button"
              className="btn-secondary"
              onClick={onOpenRanking}
            >
              {texts.initialScreenRankingButton}
            </button>
          ),
        }}
      />
    </section>
  );
}
