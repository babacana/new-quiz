import type { ResolvedScreenLayout } from '../../domain/screenLayout';
import type { EventCustomizationTexts, EventWindowState } from '../../domain/types';
import { useLanguage, type Language } from '../../i18n';
import { EventLogoImage } from '../EventLogoImage';
import { StylizedLogoImage } from './StylizedLogoImage';
import { LayoutScreenContent } from './LayoutScreenContent';
import { LanguageSelector } from './LanguageSelector';

export interface TotemClosedScreenProps {
  active: boolean;
  logoSrc: string;
  texts: EventCustomizationTexts;
  eventWindow: EventWindowState;
  onOpenRanking: () => void;
  availableLanguages?: readonly Language[];
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
  availableLanguages,
}: TotemClosedScreenProps) {
  const { td } = useLanguage();
  return (
    <section
      id="closed-screen"
      className={`screen ${active ? 'active' : ''}`}
      aria-hidden={!active}
    >
      {active && <LanguageSelector languages={availableLanguages} />}
      <LayoutScreenContent
        screenId="closed"
        layout={layout}
        highlightedElementId={highlightedElementId}
        elements={{
          logo: <EventLogoImage src={logoSrc} />,
          stylizedLogo: <StylizedLogoImage />,
          slogan: <p className="slogan">{td(texts.initialScreenSlogan)}</p>,
          statusMessage: eventWindow.initialScreenMessage ? (
            <p id="closed-status-message" className="event-status-message">
              {td(eventWindow.initialScreenMessage)}
            </p>
          ) : null,
          rankingButton: (
            <button
              id="view-ranking-closed-btn"
              type="button"
              className="btn-secondary"
              onClick={onOpenRanking}
            >
              {td(texts.initialScreenRankingButton)}
            </button>
          ),
        }}
      />
    </section>
  );
}
