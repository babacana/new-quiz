import { useEffect, useRef, useState } from 'react';
import type { TotemSessionEngine } from '../../domain/totemSessionEngine';
import type { BorderPulseState, TimeBarPhase } from '../../domain/types';
import { playTotemSound } from '../soundEffects';

export interface TimeAlertVisualUpdate {
  borderPulseState: BorderPulseState;
  isFlashing: boolean;
}

export interface QuestionTimerBarProps {
  engine: TotemSessionEngine;
  isQuizActive: boolean;
  matchStartedAtMs: number | null;
  questionIndex: number;
  hasAnswered: boolean;
  totalQuestionMs: number;
  isSoundEnabled: boolean;
  onElapsedMatchSecondsChange: (elapsedSeconds: number) => void;
  onTimeAlertVisualChange: (visual: TimeAlertVisualUpdate) => void;
  onTimeout: () => void;
}

const SYNC_INTERVAL_MS = 250;

// Componente dedicado ao cronômetro total da Partida, barra regressiva em GPU (60fps) e contagem numérica.
// Isola atualizações frequentes de quadro para não re-renderizar a árvore completa do TotemApp.
export function QuestionTimerBar({
  engine,
  isQuizActive,
  matchStartedAtMs,
  questionIndex,
  hasAnswered,
  totalQuestionMs,
  isSoundEnabled,
  onElapsedMatchSecondsChange,
  onTimeAlertVisualChange,
  onTimeout,
}: QuestionTimerBarProps) {
  const initialSeconds = Math.max(0, Math.ceil(totalQuestionMs / 1000));
  const [remainingSeconds, setRemainingSeconds] = useState(initialSeconds);
  const [phase, setPhase] = useState<TimeBarPhase>('normal');

  const fillRef = useRef<HTMLDivElement | null>(null);
  const questionStartMsRef = useRef<number>(engine.getNowMs());
  const timeoutHandledForIndexRef = useRef<number | null>(null);
  const lastElapsedSecRef = useRef<number>(-1);
  const lastRemainingSecRef = useRef<number>(initialSeconds);
  const lastPhaseRef = useRef<TimeBarPhase>('normal');
  const lastTickSoundSecRef = useRef<number | null>(null);
  const lastAlertRef = useRef<TimeAlertVisualUpdate>({
    borderPulseState: 'none',
    isFlashing: false,
  });

  const callbacksRef = useRef({
    onElapsedMatchSecondsChange,
    onTimeAlertVisualChange,
    onTimeout,
  });
  callbacksRef.current = {
    onElapsedMatchSecondsChange,
    onTimeAlertVisualChange,
    onTimeout,
  };

  // Reinicia cronômetro e estado visual apenas ao iniciar uma nova questão ou Partida.
  useEffect(() => {
    if (!isQuizActive || matchStartedAtMs === null || questionIndex < 0) {
      return;
    }

    const fullSec = Math.max(0, Math.ceil(totalQuestionMs / 1000));
    questionStartMsRef.current = engine.getNowMs();
    timeoutHandledForIndexRef.current = null;
    lastRemainingSecRef.current = fullSec;
    lastPhaseRef.current = 'normal';
    lastTickSoundSecRef.current = null;

    setRemainingSeconds(fullSec);
    setPhase('normal');

    if (fillRef.current) {
      const initialState = engine.getQuestionTimeVisualState(totalQuestionMs);
      fillRef.current.style.transform = 'scaleX(1)';
      fillRef.current.style.backgroundColor = initialState.barColor;
    }
  }, [engine, isQuizActive, matchStartedAtMs, questionIndex, totalQuestionMs]);

  // Gerencia atualização por requestAnimationFrame (60fps na barra) + intervalo leve para tempo inteiro e fake timers.
  useEffect(() => {
    if (!isQuizActive || matchStartedAtMs === null || questionIndex < 0) {
      if (
        lastAlertRef.current.borderPulseState !== 'none' ||
        lastAlertRef.current.isFlashing
      ) {
        lastAlertRef.current = { borderPulseState: 'none', isFlashing: false };
        callbacksRef.current.onTimeAlertVisualChange(lastAlertRef.current);
      }
      return;
    }

    let rafId: number | null = null;
    let active = true;

    const evaluateTick = () => {
      const nextElapsed = engine.getElapsedMatchSeconds();
      if (nextElapsed !== lastElapsedSecRef.current) {
        lastElapsedSecRef.current = nextElapsed;
        callbacksRef.current.onElapsedMatchSecondsChange(nextElapsed);
      }

      if (hasAnswered) {
        if (
          lastAlertRef.current.borderPulseState !== 'none' ||
          lastAlertRef.current.isFlashing
        ) {
          lastAlertRef.current = { borderPulseState: 'none', isFlashing: false };
          callbacksRef.current.onTimeAlertVisualChange(lastAlertRef.current);
        }
        return;
      }

      const elapsedQuestionMs = engine.getNowMs() - questionStartMsRef.current;
      const remainingMs = Math.max(0, totalQuestionMs - elapsedQuestionMs);
      const visualState = engine.getQuestionTimeVisualState(remainingMs);

      if (fillRef.current) {
        const ratio = Math.max(0, Math.min(1, visualState.percentageRemaining / 100));
        fillRef.current.style.transform = `scaleX(${ratio})`;
        fillRef.current.style.backgroundColor = visualState.barColor;
      }

      const wholeSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
      if (wholeSeconds !== lastRemainingSecRef.current) {
        lastRemainingSecRef.current = wholeSeconds;
        setRemainingSeconds(wholeSeconds);
      }

      if (visualState.phase !== lastPhaseRef.current) {
        lastPhaseRef.current = visualState.phase;
        setPhase(visualState.phase);
      }

      if (
        visualState.borderPulseState !== lastAlertRef.current.borderPulseState ||
        visualState.isFlashing !== lastAlertRef.current.isFlashing
      ) {
        lastAlertRef.current = {
          borderPulseState: visualState.borderPulseState,
          isFlashing: visualState.isFlashing,
        };
        callbacksRef.current.onTimeAlertVisualChange(lastAlertRef.current);
      }

      if (
        wholeSeconds <= 5 &&
        wholeSeconds >= 1 &&
        lastTickSoundSecRef.current !== wholeSeconds
      ) {
        lastTickSoundSecRef.current = wholeSeconds;
        playTotemSound('tick', isSoundEnabled);
      }

      if (remainingMs <= 0 && timeoutHandledForIndexRef.current !== questionIndex) {
        timeoutHandledForIndexRef.current = questionIndex;
        callbacksRef.current.onTimeout();
      }
    };

    const runAnimationLoop = () => {
      if (!active || hasAnswered) {
        return;
      }
      if (fillRef.current) {
        const remainingMs = Math.max(
          0,
          totalQuestionMs - (engine.getNowMs() - questionStartMsRef.current),
        );
        const visualState = engine.getQuestionTimeVisualState(remainingMs);
        const ratio = Math.max(0, Math.min(1, visualState.percentageRemaining / 100));
        fillRef.current.style.transform = `scaleX(${ratio})`;
        fillRef.current.style.backgroundColor = visualState.barColor;
      }
      if (typeof window.requestAnimationFrame === 'function') {
        rafId = window.requestAnimationFrame(runAnimationLoop);
      }
    };

    evaluateTick();
    if (!hasAnswered && typeof window.requestAnimationFrame === 'function') {
      rafId = window.requestAnimationFrame(runAnimationLoop);
    }
    const intervalId = window.setInterval(evaluateTick, SYNC_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      if (rafId !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [engine, isQuizActive, matchStartedAtMs, questionIndex, hasAnswered, totalQuestionMs, isSoundEnabled]);

  if (!isQuizActive || hasAnswered) {
    return null;
  }

  return (
    <div className="question-time-bar-row">
      <div id="question-time-bar-container" aria-label="Tempo restante da questão">
        <div id="question-time-bar-fill" ref={fillRef} />
      </div>
      <span
        id="question-time-countdown"
        className={`question-time-countdown countdown-${phase}`}
        aria-live="off"
      >
        {remainingSeconds}s
      </span>
    </div>
  );
}
