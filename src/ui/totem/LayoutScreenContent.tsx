import type { CSSProperties, ReactNode } from 'react';
import {
  LAYOUT_ZONES,
  getScreenDefinition,
  resolveScreenLayout,
  type LayoutElementSettings,
  type ResolvedScreenLayout,
} from '../../domain/screenLayout';

export interface LayoutScreenContentProps {
  screenId: ResolvedScreenLayout['screenId'];
  /** Layout já resolvido; sem ele usa a distribuição padrão da tela. */
  layout?: ResolvedScreenLayout;
  /** Conteúdo de cada elemento (`null` quando o elemento não deve aparecer agora). */
  elements: Record<string, ReactNode>;
  /** Elemento destacado no editor de layout do ADM. */
  highlightedElementId?: string | null;
  className?: string;
}

const ALIGN_TO_FLEX = { start: 'flex-start', center: 'center', end: 'flex-end' } as const;

function buildItemStyle(settings: LayoutElementSettings, elementId: string): CSSProperties {
  const style: Record<string, string | number> = {
    '--layout-scale': settings.scalePercent / 100,
    alignItems: ALIGN_TO_FLEX[settings.align],
    textAlign: settings.align === 'start' ? 'left' : settings.align === 'end' ? 'right' : 'center',
  };
  if (settings.spaceBeforeEm > 0) {
    style.paddingTop = `${settings.spaceBeforeEm}em`;
  }
  if (settings.spaceAfterEm > 0) {
    style.paddingBottom = `${settings.spaceAfterEm}em`;
  }
  if (settings.textColor) {
    style.color = settings.textColor;
    style['--quiz-main-text-color'] = settings.textColor;
    style['--quiz-highlight-color'] = settings.textColor;
  }
  if (settings.offsetXPercent !== 0 || settings.offsetYPercent !== 0) {
    // Relativo ao palco (cqw/cqh): o deslocamento acompanha qualquer resolução.
    style.transform = `translate(${settings.offsetXPercent}cqw, ${settings.offsetYPercent}cqh)`;
  }
  // A chamada da Tela de Descanso aplica a escala no próprio tamanho de fonte (ver totem.css).
  if (settings.scalePercent !== 100 && elementId !== 'callToAction') {
    style.fontSize = `${settings.scalePercent}%`;
  }
  return style as CSSProperties;
}

// Distribui os elementos de uma tela do Totem em três zonas (topo, centro e base) conforme o layout do Evento.
export function LayoutScreenContent({
  screenId,
  layout,
  elements,
  highlightedElementId,
  className,
}: LayoutScreenContentProps) {
  const resolved = layout ?? resolveScreenLayout(undefined, screenId);
  const floatingIds = new Set(
    getScreenDefinition(screenId)
      .elements.filter((element) => element.floating)
      .map((element) => element.id),
  );

  return (
    <div className={`screen-content layout-zones ${className ?? ''}`.trim()} data-layout-screen={screenId}>
      {LAYOUT_ZONES.map((zone) => (
        <div key={zone} className={`layout-zone layout-zone-${zone}`} data-layout-zone={zone}>
          {resolved.zones[zone].map((elementId) => {
            const content = elements[elementId];
            if (content === null || content === undefined || content === false) {
              return null;
            }
            const settings = resolved.elements[elementId]!;
            return (
              <div
                key={elementId}
                className={[
                  'layout-item',
                  floatingIds.has(elementId) ? 'layout-item-floating' : '',
                  highlightedElementId === elementId ? 'is-highlighted' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-layout-element={elementId}
                style={buildItemStyle(settings, elementId)}
              >
                {content}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
