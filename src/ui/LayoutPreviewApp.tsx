import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveScreenLayout, safeMarginCssVars } from '../domain/screenLayout';
import type {
  ActiveQuestionState,
  EventSettings,
  EventWindowState,
  MatchResultSummary,
  RankingEntry,
} from '../domain/types';
import { AccessibilityControls } from './AccessibilityControls';
import {
  isEditorToPreviewMessage,
  type LayoutPreviewState,
  type PreviewToEditorMessage,
} from './layoutPreviewProtocol';
import { buildThemeCssVariables, resolvePreviewVisualAssets } from './themeCss';
import { TotemClosedScreen } from './totem/TotemClosedScreen';
import { TotemIdleScreen } from './totem/TotemIdleScreen';
import { TotemInitialScreen } from './totem/TotemInitialScreen';
import { TotemQuizScreen } from './totem/TotemQuizScreen';
import { TotemRankingScreen } from './totem/TotemRankingScreen';
import { TotemResultScreen } from './totem/TotemResultScreen';
import './totem.css';

const NOOP = () => undefined;
const NOOP_REF = { current: null };

const SAMPLE_NAMES = [
  'ANA SOUZA',
  'BRUNO LIMA',
  'CARLA DIAS',
  'DIEGO ROCHA',
  'ELISA MOURA',
  'FABIO NUNES',
  'GISELE ALVES',
  'HUGO PAIVA',
  'IRIS COSTA',
  'JOAO REIS',
];

const SAMPLE_RANKING: RankingEntry[] = SAMPLE_NAMES.map((participantName, index) => ({
  position: index + 1,
  matchId: `sample-${index}`,
  participantName,
  participantPhone: '',
  score: 10 - Math.floor(index / 3),
  totalQuestions: 10,
  timeSeconds: 94 + index * 7,
  playedAt: '2026-01-01T12:00:00.000Z',
}));

function buildSampleResult(showConditional: boolean): MatchResultSummary {
  return {
    matchId: 'sample-result',
    participantName: 'MARIA CLARA',
    participantPhone: '',
    score: showConditional ? 10 : 8,
    totalQuestions: 10,
    timeSeconds: 96,
    wonPrize: true,
    prizeStatus: 'delivered',
    rankingPosition: 3,
    isTop3: true,
    isPerfectScore: showConditional,
    canShowIncorrectAnswers: true,
    incorrectAnswers: [],
  };
}

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
  };
}

function postToEditor(message: PreviewToEditorMessage) {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(message, window.location.origin);
  }
}

// Rota interna (#layout-preview) carregada em iframe pelo editor de layout do ADM: renderiza as telas do Totem
// com o mesmo CSS e a mesma estrutura do Totem real, sem nenhum estilo do painel administrativo.
export function LayoutPreviewApp() {
  const [state, setState] = useState<LayoutPreviewState | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<LayoutPreviewState | null>(null);
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    document.documentElement.classList.add('totem-fullscreen-mode');
    document.body.classList.add('totem-fullscreen-mode');
    return () => {
      document.documentElement.classList.remove('totem-fullscreen-mode');
      document.body.classList.remove('totem-fullscreen-mode');
    };
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) {
        return;
      }
      if (isEditorToPreviewMessage(event.data)) {
        setState(event.data.state);
      }
    };
    window.addEventListener('message', handleMessage);
    postToEditor({ source: 'layout-preview', type: 'ready' });
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const resolved = useMemo(
    () => (state ? resolveScreenLayout(state.customizations.layout, state.screenId) : null),
    [state],
  );

  if (!state || !resolved) {
    return null;
  }

  const { customizations, screenId, showConditional } = state;
  const { texts } = customizations;
  const themeStyle = buildThemeCssVariables(customizations);
  const safeMarginVars = safeMarginCssVars(customizations.layout?.safeMargin);
  const { logoSrc, backgroundSrc } = resolvePreviewVisualAssets(customizations);
  const lgpdNoticeText =
    state.lgpdNoticeText.trim() ||
    (showConditional ? 'Seus dados são usados apenas para o sorteio de brindes, conforme a LGPD.' : '');

  const eventWindow: EventWindowState = {
    status: 'during',
    isBlocked: false,
    // Com os exemplos condicionais ligados, a Tela de Descanso mostra o Evento ainda fechado.
    idleCallToActionTitle:
      screenId === 'idle' && showConditional
        ? texts.idleScreenBeforeTitle
        : texts.idleScreenCallToAction,
    idleCallToActionSubtitle:
      screenId === 'idle' && showConditional ? texts.idleScreenBeforeSubtitle : null,
    initialScreenMessage: showConditional ? 'Aviso de exemplo do Evento' : null,
  };
  const settings = {
    numberOfQuestions: 10,
    timePerQuestion: 30,
    minScoreForPrize: 7,
  } as EventSettings;

  const highlightedElementId = state.highlightedElementId;

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>('[data-layout-element]');
    const id = item?.dataset.layoutElement;
    if (!id) {
      return;
    }
    const current = resolved.elements[id];
    dragRef.current = {
      id,
      startX: event.clientX,
      startY: event.clientY,
      baseX: current?.offsetXPercent ?? 0,
      baseY: current?.offsetYPercent ?? 0,
    };
    postToEditor({ source: 'layout-preview', type: 'select', elementId: id });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const stage = stageRef.current;
    if (!drag || !stage) {
      return;
    }
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    postToEditor({
      source: 'layout-preview',
      type: 'move',
      elementId: drag.id,
      offsetXPercent: drag.baseX + ((event.clientX - drag.startX) / rect.width) * 100,
      offsetYPercent: drag.baseY + ((event.clientY - drag.startY) / rect.height) * 100,
    });
  };

  const screenProps = { active: true, layout: resolved, highlightedElementId, logoSrc };

  return (
    <div
      className={`quiz-container${Object.keys(safeMarginVars).length > 0 ? ' has-safe-margin' : ''}`}
      style={{ ...themeStyle, ...safeMarginVars, touchAction: 'none' }}
      data-testid="layout-preview-container"
      onMouseDownCapture={(event) => event.preventDefault()}
      onClickCapture={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDownCapture={state.interactive === false ? undefined : handlePointerDown}
      onPointerMove={state.interactive === false ? undefined : handlePointerMove}
      onPointerUp={() => {
        dragRef.current = null;
      }}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
    >
      <div className="totem-stage" ref={stageRef} data-testid="layout-preview-stage">
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

        <AccessibilityControls hiddenOnIdle={screenId === 'idle'} onOpenDiagnostics={NOOP} />

        {screenId === 'initial' && (
          <TotemInitialScreen
            {...screenProps}
            texts={texts}
            eventWindow={eventWindow}
            lgpdNoticeText={lgpdNoticeText}
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

        {screenId === 'closed' && (
          <TotemClosedScreen
            {...screenProps}
            texts={texts}
            eventWindow={{
              ...eventWindow,
              status: 'before',
              isBlocked: true,
              initialScreenMessage:
                'O quiz "Nome do Evento" ainda não começou! Prepare-se, a diversão começa em 24/11/2026, 10:00.',
            }}
            onOpenRanking={NOOP}
          />
        )}

        {screenId === 'idle' && (
          <TotemIdleScreen
            {...screenProps}
            texts={texts}
            eventWindow={eventWindow}
            settings={settings}
            ranking={SAMPLE_RANKING.slice(0, 3)}
            totalMatchesCount={SAMPLE_RANKING.length}
            idleSlideIndex={0}
            onWake={NOOP}
          />
        )}

        {screenId === 'quiz' && (
          <TotemQuizScreen
            {...screenProps}
            engine={null}
            currentQuestion={buildSampleQuestion(state.quizAnswered)}
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
            {...screenProps}
            texts={texts}
            lastResult={buildSampleResult(showConditional)}
            backgroundSyncNotice={
              showConditional ? 'Resultado salvo neste Totem; sincronizando em segundo plano.' : null
            }
            onShowIncorrectAnswers={NOOP}
            onOpenRanking={NOOP}
            onPlayAgain={NOOP}
          />
        )}

        {screenId === 'ranking' && (
          <TotemRankingScreen
            {...screenProps}
            texts={texts}
            ranking={SAMPLE_RANKING}
            onBackToInitial={NOOP}
          />
        )}
      </div>
    </div>
  );
}
