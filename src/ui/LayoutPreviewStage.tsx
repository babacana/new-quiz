import { useEffect, useMemo, useRef, useState } from 'react';
import {
  computeStageSize,
  type LayoutScreenId,
  type ResolvedScreenLayout,
} from '../domain/screenLayout';
import type { EventCustomizations, EventWindowState, RankingEntry } from '../domain/types';
import { TotemIdleScreen } from './totem/TotemIdleScreen';
import { TotemInitialScreen } from './totem/TotemInitialScreen';
import { buildThemeCssVariables, resolvePreviewVisualAssets } from './themeCss';

export interface LayoutPreviewStageProps {
  screenId: LayoutScreenId;
  customizations: EventCustomizations;
  layout: ResolvedScreenLayout;
  width: number;
  height: number;
  highlightedElementId?: string | null;
  onSelectElement?: (elementId: string) => void;
}

const SAMPLE_RANKING: RankingEntry[] = [
  ['Ana Souza', 10, 94],
  ['Bruno Lima', 9, 101],
  ['Carla Dias', 9, 118],
].map(([participantName, score, timeSeconds], index) => ({
  position: index + 1,
  matchId: `sample-${index}`,
  participantName: participantName as string,
  participantPhone: '',
  score: score as number,
  totalQuestions: 10,
  timeSeconds: timeSeconds as number,
  playedAt: '2026-01-01T12:00:00.000Z',
}));

const NOOP = () => undefined;
const NOOP_REF = { current: null };

// Prévia fiel das telas do Totem: renderiza os componentes reais na resolução escolhida e reduz com `scale`.
export function LayoutPreviewStage({
  screenId,
  customizations,
  layout,
  width,
  height,
  highlightedElementId,
  onSelectElement,
}: LayoutPreviewStageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [hostWidth, setHostWidth] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }
    const update = () => setHostWidth(host.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const maxHeight = typeof window === 'undefined' ? 720 : Math.max(320, window.innerHeight * 0.72);
  const scale = Math.min(1, (hostWidth > 0 ? hostWidth : 280) / width, maxHeight / height);
  const stage = computeStageSize(width, height);

  const themeStyle = buildThemeCssVariables(customizations);
  const { logoSrc, backgroundSrc } = resolvePreviewVisualAssets(customizations);
  const { texts } = customizations;

  const eventWindow: EventWindowState = useMemo(
    () => ({
      status: 'during',
      isBlocked: false,
      idleCallToActionTitle: texts.idleScreenCallToAction,
      idleCallToActionSubtitle: null,
      initialScreenMessage: 'Aviso de exemplo do Evento',
    }),
    [texts.idleScreenCallToAction],
  );

  const settings = {
    numberOfQuestions: 10,
    timePerQuestion: 30,
    minScoreForPrize: 7,
  } as Parameters<typeof TotemIdleScreen>[0]['settings'];

  return (
    <div ref={hostRef} className="w-full">
      <div
        data-testid="layout-preview-frame"
        className="relative mx-auto overflow-hidden rounded-lg border border-border shadow-xs"
        style={{ width: Math.round(width * scale), height: Math.round(height * scale) }}
        onMouseDownCapture={(event) => event.preventDefault()}
        onClickCapture={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const item = (event.target as HTMLElement).closest<HTMLElement>('[data-layout-element]');
          if (item?.dataset.layoutElement) {
            onSelectElement?.(item.dataset.layoutElement);
          }
        }}
      >
        <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <div
            className="quiz-container in-simulator"
            style={{ ...themeStyle, width, height }}
            data-testid="layout-preview-container"
          >
            <div
              className="totem-stage"
              style={{ width: stage.width, height: stage.height }}
              data-testid="layout-preview-stage"
            >
              {backgroundSrc && (
                <div
                  className="quiz-custom-background-layer"
                  style={{
                    backgroundImage: `url(${backgroundSrc})`,
                    opacity: customizations.visualIdentity.customBackgroundOpacity,
                  }}
                  aria-hidden="true"
                />
              )}

              {screenId === 'initial' ? (
                <TotemInitialScreen
                  active
                  layout={layout}
                  highlightedElementId={highlightedElementId}
                  logoSrc={logoSrc}
                  texts={texts}
                  eventWindow={eventWindow}
                  lgpdNoticeText="Seus dados são usados apenas para o sorteio de brindes, conforme a LGPD."
                  nameInput=""
                  phoneInput=""
                  nameInputRef={NOOP_REF}
                  phoneInputRef={NOOP_REF}
                  shouldHideStartButton={false}
                  activeVirtualField={null}
                  enableVirtualKeyboard={false}
                  virtualKeyboardHeightVh={30}
                  onNameChange={NOOP}
                  onPhoneChange={NOOP}
                  onFieldFocus={NOOP}
                  onStartQuiz={NOOP}
                  onOpenRanking={NOOP}
                  onVirtualKeyboardHeightChange={NOOP}
                  onVirtualKeyPress={NOOP}
                  onVirtualKeyboardResizingChange={NOOP}
                />
              ) : (
                <TotemIdleScreen
                  active
                  layout={layout}
                  highlightedElementId={highlightedElementId}
                  logoSrc={logoSrc}
                  texts={texts}
                  eventWindow={eventWindow}
                  settings={settings}
                  ranking={SAMPLE_RANKING}
                  totalMatchesCount={SAMPLE_RANKING.length}
                  idleSlideIndex={0}
                  onWake={NOOP}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
