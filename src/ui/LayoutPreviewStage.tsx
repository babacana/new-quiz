import { useEffect, useMemo, useRef, useState } from 'react';
import {
  computeStageSize,
  type LayoutScreenId,
  type ResolvedScreenLayout,
} from '../domain/screenLayout';
import type {
  ActiveQuestionState,
  EventCustomizations,
  EventWindowState,
  MatchResultSummary,
  RankingEntry,
} from '../domain/types';
import { TotemIdleScreen } from './totem/TotemIdleScreen';
import { TotemInitialScreen } from './totem/TotemInitialScreen';
import { TotemQuizScreen } from './totem/TotemQuizScreen';
import { TotemRankingScreen } from './totem/TotemRankingScreen';
import { TotemResultScreen } from './totem/TotemResultScreen';
import { buildThemeCssVariables, resolvePreviewVisualAssets } from './themeCss';

export interface LayoutPreviewStageProps {
  screenId: LayoutScreenId;
  customizations: EventCustomizations;
  layout: ResolvedScreenLayout;
  width: number;
  height: number;
  highlightedElementId?: string | null;
  /** Tela de Quiz: mostra a pergunta já respondida (botão Próxima Pergunta). */
  quizAnswered?: boolean;
  onSelectElement?: (elementId: string) => void;
  /** Arraste na prévia: novo deslocamento (em % do palco) do elemento. */
  onMoveElement?: (elementId: string, offsetXPercent: number, offsetYPercent: number) => void;
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

const SAMPLE_RANKING_FULL: RankingEntry[] = Array.from({ length: 10 }, (_, index) => ({
  position: index + 1,
  matchId: `sample-full-${index}`,
  participantName: ['ANA SOUZA', 'BRUNO LIMA', 'CARLA DIAS', 'DIEGO ROCHA', 'ELISA MOURA', 'FABIO NUNES', 'GISELE ALVES', 'HUGO PAIVA', 'IRIS COSTA', 'JOAO REIS'][index]!,
  participantPhone: '',
  score: 10 - Math.floor(index / 3),
  totalQuestions: 10,
  timeSeconds: 94 + index * 7,
  playedAt: '2026-01-01T12:00:00.000Z',
}));

const SAMPLE_RESULT: MatchResultSummary = {
  matchId: 'sample-result',
  participantName: 'MARIA CLARA',
  participantPhone: '',
  score: 10,
  totalQuestions: 10,
  timeSeconds: 96,
  wonPrize: true,
  prizeStatus: 'delivered',
  rankingPosition: 1,
  isTop3: true,
  isPerfectScore: true,
  canShowIncorrectAnswers: true,
  incorrectAnswers: [],
};

function buildSampleQuestion(answered: boolean): ActiveQuestionState {
  const labels = [
    'Tratamento e distribuição de água potável',
    'Geração de energia elétrica',
    'Coleta de resíduos sólidos',
    'Transporte público urbano',
  ];
  return {
    index: 2,
    total: 10,
    question: {
      id: 1,
      text: 'Qual é o principal serviço prestado pela CAESB?',
      difficulty: 'moderado',
      originalOptions: labels as [string, string, string, string],
      originalCorrectIndex: 0,
      shuffledOptions: labels.map((text, idx) => ({ text, isCorrect: idx === 0, originalIndex: idx })),
    },
    hasAnswered: answered,
    isTimedOut: false,
    selectedOptionIndex: answered ? 0 : null,
    revealedCorrectOptionIndex: answered ? 0 : null,
    advanceButtonLabel: 'Próxima Pergunta',
  } as ActiveQuestionState;
}

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
  quizAnswered = false,
  onSelectElement,
  onMoveElement,
}: LayoutPreviewStageProps) {
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);
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
        className="relative mx-auto touch-none overflow-hidden rounded-lg border border-border shadow-xs"
        style={{ width: Math.round(width * scale), height: Math.round(height * scale) }}
        onMouseDownCapture={(event) => event.preventDefault()}
        onPointerDownCapture={(event) => {
          const item = (event.target as HTMLElement).closest<HTMLElement>('[data-layout-element]');
          const id = item?.dataset.layoutElement;
          if (!id || !onMoveElement) {
            return;
          }
          const current = layout.elements[id];
          dragRef.current = {
            id,
            startX: event.clientX,
            startY: event.clientY,
            baseX: current?.offsetXPercent ?? 0,
            baseY: current?.offsetYPercent ?? 0,
          };
          onSelectElement?.(id);
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || !onMoveElement || scale <= 0) {
            return;
          }
          const dx = ((event.clientX - drag.startX) / (scale * stage.width)) * 100;
          const dy = ((event.clientY - drag.startY) / (scale * stage.height)) * 100;
          onMoveElement(drag.id, drag.baseX + dx, drag.baseY + dy);
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
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

              {screenId === 'initial' && (
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
              )}

              {screenId === 'idle' && (
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

              {screenId === 'quiz' && (
                <TotemQuizScreen
                  active
                  layout={layout}
                  highlightedElementId={highlightedElementId}
                  engine={null}
                  logoSrc={logoSrc}
                  currentQuestion={buildSampleQuestion(quizAnswered)}
                  matchStartedAtMs={null}
                  elapsedMatchSeconds={47}
                  totalQuestionMs={30000}
                  isSoundEnabled={false}
                  isAdvancing={false}
                  autoAdvanceRemaining={null}
                  onSelectOption={NOOP}
                  onAdvanceQuestion={NOOP}
                  onRequestGiveUp={NOOP}
                  onElapsedMatchSecondsChange={NOOP}
                  onTimeAlertVisualChange={NOOP}
                  onQuestionTimeout={NOOP}
                />
              )}

              {screenId === 'result' && (
                <TotemResultScreen
                  active
                  layout={layout}
                  highlightedElementId={highlightedElementId}
                  logoSrc={logoSrc}
                  texts={texts}
                  lastResult={SAMPLE_RESULT}
                  backgroundSyncNotice="Resultado salvo neste Totem; sincronizando em segundo plano."
                  onShowIncorrectAnswers={NOOP}
                  onOpenRanking={NOOP}
                  onPlayAgain={NOOP}
                />
              )}

              {screenId === 'ranking' && (
                <TotemRankingScreen
                  active
                  layout={layout}
                  highlightedElementId={highlightedElementId}
                  logoSrc={logoSrc}
                  texts={texts}
                  ranking={SAMPLE_RANKING_FULL}
                  onBackToInitial={NOOP}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
