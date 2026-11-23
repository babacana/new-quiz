import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DexieLocalStore } from '../adapters/dexieLocalStore';
import { CryptoRandomSource, SystemClock } from '../adapters/systemAdapters';
import { resolveScreenLayout } from '../domain/screenLayout';
import { extractPairingCodeFromInput } from '../domain/pairingUtils';
import {
  TotemSessionEngine,
  formatPhoneMask,
  normalizeParticipantName,
} from '../domain/totemSessionEngine';
import type { TotemSessionSnapshot } from '../domain/types';
import {
  applyPendingServiceWorkerUpdate,
  subscribeServiceWorkerUpdateReady,
} from '../pwa/registerServiceWorker';
import { AccessibilityControls } from './AccessibilityControls';
import {
  DEFAULT_KEYBOARD_HEIGHT_VH,
  type VirtualKeyboardField,
} from './VirtualKeyboard';
import { createTotemCloudPort } from './cloudFactory';
import { playTotemSound } from './soundEffects';
import { buildThemeCssVariables } from './themeCss';
import type { TimeAlertVisualUpdate } from './totem/QuestionTimerBar';
import { TotemIdleScreen } from './totem/TotemIdleScreen';
import { TotemInitialScreen } from './totem/TotemInitialScreen';
import { type ActiveTotemModal, TotemModals } from './totem/TotemModals';
import { TotemQuizScreen } from './totem/TotemQuizScreen';
import { TotemRankingScreen } from './totem/TotemRankingScreen';
import { TotemResultScreen } from './totem/TotemResultScreen';
import './totem.css';

const IDLE_SLIDE_INTERVAL_MS = 5_000;
const GHOST_TOUCH_GUARD_MS = 350;
const MOUSEMOVE_THROTTLE_MS = 500;

function extractInitialActivationCode(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const combined = `${window.location.search}${window.location.hash}`;
  if (!/(?:pairingCode|pairing|code)=/i.test(combined)) {
    return undefined;
  }
  const code = extractPairingCodeFromInput(combined);
  return code || undefined;
}

const INTERACTION_EVENTS = [
  'click',
  'keydown',
  'touchstart',
  'mousemove',
  'input',
  'scroll',
] as const;

export interface TotemAppProps {
  engine?: TotemSessionEngine;
  simulatorModalRequest?: { type: 'top3' | 'incorrect'; nonce: number } | null;
}

function createDefaultEngine(): TotemSessionEngine {
  return new TotemSessionEngine({
    localStore: new DexieLocalStore(),
    cloudGateway: createTotemCloudPort(),
    clock: new SystemClock(),
    random: new CryptoRandomSource(),
    requirePairing: true,
  });
}

// Interface principal do Totem com palco responsivo 9:16 desacoplada do EventAdminController.
export function TotemApp({ engine: injectedEngine, simulatorModalRequest }: TotemAppProps) {
  const isInSimulator = simulatorModalRequest !== undefined;
  const engine = useMemo(() => injectedEngine ?? createDefaultEngine(), [injectedEngine]);

  const [snapshot, setSnapshot] = useState<TotemSessionSnapshot>(() => engine.getSnapshot());
  const [nameInput, setNameInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [activeModal, setActiveModal] = useState<ActiveTotemModal>(null);

  useEffect(() => {
    if (!simulatorModalRequest) {
      return;
    }
    setActiveModal({ type: simulatorModalRequest.type });
  }, [simulatorModalRequest]);

  const [isAdvancing, setIsAdvancing] = useState(false);
  const [isFadingToIdle, setIsFadingToIdle] = useState(false);
  const [activeVirtualField, setActiveVirtualField] = useState<VirtualKeyboardField | null>(null);
  const [virtualKeyboardHeightVh, setVirtualKeyboardHeightVh] = useState(
    () => snapshot.event.settings.virtualKeyboardHeight || DEFAULT_KEYBOARD_HEIGHT_VH,
  );

  const [elapsedMatchSeconds, setElapsedMatchSeconds] = useState(0);
  const [alertVisual, setAlertVisual] = useState<TimeAlertVisualUpdate>({
    borderPulseState: 'none',
    isFlashing: false,
  });
  const [flashActive, setFlashActive] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [activationInput, setActivationInput] = useState('');
  const [diagnosticsSyncMessage, setDiagnosticsSyncMessage] = useState<string | null>(null);
  const [isForcingSync, setIsForcingSync] = useState(false);
  const [localSoundMuted, setLocalSoundMuted] = useState(false);
  const [idleSlideIndex, setIdleSlideIndex] = useState(0);
  const [autoAdvanceRemaining, setAutoAdvanceRemaining] = useState<number | null>(null);
  const [hasSwUpdateReady, setHasSwUpdateReady] = useState(false);

  const fadeOutTimerRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const ghostTouchUntilRef = useRef<number>(0);
  const isResizingKeyboardRef = useRef(false);
  const isFadingToIdleRef = useRef(false);
  const lastMouseMoveResetRef = useRef<number>(0);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const phoneInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    isFadingToIdleRef.current = isFadingToIdle;
  }, [isFadingToIdle]);

  const clearIdleTimers = useCallback(() => {
    if (fadeOutTimerRef.current !== null) {
      window.clearTimeout(fadeOutTimerRef.current);
      fadeOutTimerRef.current = null;
    }
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const resetTransientUiState = useCallback((clearFields: boolean) => {
    setActiveModal(null);
    setActiveVirtualField(null);
    setIsFadingToIdle(false);
    isFadingToIdleRef.current = false;
    setIsAdvancing(false);
    if (clearFields) {
      setNameInput('');
      setPhoneInput('');
    }
  }, []);

  // Reinicia o temporizador de ociosidade usando getters leves sem clonar o snapshot completo.
  const resetIdleTimer = useCallback(() => {
    if (
      isResizingKeyboardRef.current ||
      engine.getScreen() === 'idle-screen' ||
      engine.getPairingStatus() === 'awaiting_authorization'
    ) {
      return;
    }

    clearIdleTimers();
    isFadingToIdleRef.current = false;
    setIsFadingToIdle(false);

    const { idleTimeoutMs, fadeOutStartMs } = engine.getIdleTimingConfig();

    if (fadeOutStartMs > 0 && idleTimeoutMs > fadeOutStartMs) {
      fadeOutTimerRef.current = window.setTimeout(() => {
        if (engine.getScreen() !== 'idle-screen') {
          isFadingToIdleRef.current = true;
          setIsFadingToIdle(true);
        }
      }, fadeOutStartMs);
    } else if (idleTimeoutMs > 0) {
      isFadingToIdleRef.current = true;
      setIsFadingToIdle(true);
    }

    if (idleTimeoutMs > 0) {
      idleTimerRef.current = window.setTimeout(() => {
        clearIdleTimers();
        setFlashActive(false);
        resetTransientUiState(false);
        nameInputRef.current?.blur();
        phoneInputRef.current?.blur();
        setSnapshot(engine.enterIdleScreen());
      }, idleTimeoutMs);
    }
  }, [clearIdleTimers, engine, resetTransientUiState]);

  const handleKeyboardResizingChange = useCallback((isResizing: boolean) => {
    isResizingKeyboardRef.current = isResizing;
  }, []);

  useEffect(() => {
    if (isInSimulator) {
      return;
    }
    document.documentElement.classList.add('totem-fullscreen-mode');
    document.body.classList.add('totem-fullscreen-mode');
    return () => {
      document.documentElement.classList.remove('totem-fullscreen-mode');
      document.body.classList.remove('totem-fullscreen-mode');
    };
  }, [isInSimulator]);

  // Monitora atualizações em espera do Service Worker e aplica apenas em ociosidade com fila zerada.
  useEffect(() => subscribeServiceWorkerUpdateReady(setHasSwUpdateReady), []);

  useEffect(() => {
    if (hasSwUpdateReady && snapshot.screen === 'idle-screen' && snapshot.pendingSyncCount === 0) {
      applyPendingServiceWorkerUpdate();
    }
  }, [hasSwUpdateReady, snapshot.screen, snapshot.pendingSyncCount]);

  useEffect(() => {
    let cancelled = false;
    let lastObservedScreen = engine.getScreen();
    let lastObservedEventId = snapshot.event.id;

    const unsubscribe = engine.subscribe((nextSnap) => {
      if (!cancelled) {
        const screenOrEventReset =
          (nextSnap.event.id !== lastObservedEventId ||
            (nextSnap.screen !== lastObservedScreen &&
              (nextSnap.screen === 'initial-screen' || nextSnap.screen === 'idle-screen'))) &&
          nextSnap.activeMatch === null;

        lastObservedScreen = nextSnap.screen;
        lastObservedEventId = nextSnap.event.id;
        setSnapshot(nextSnap);

        if (screenOrEventReset) {
          setNameInput('');
          setPhoneInput('');
          setActiveVirtualField(null);
          setActiveModal((prev) =>
            prev?.type === 'diagnostics' || prev?.type === 'pin-prompt' ? prev : null,
          );
        } else if (nextSnap.pairing.status === 'paired') {
          setActiveModal((prev) => (prev?.type === 'pairing' ? null : prev));
        }
      }
    });

    const activationCode = extractInitialActivationCode();
    void engine
      .initialize(activationCode ? { activationCode } : undefined)
      .then((initialSnap) => {
        if (!cancelled) {
          lastObservedScreen = initialSnap.screen;
          lastObservedEventId = initialSnap.event.id;
          setSnapshot(initialSnap);
        }
      });

    const syncQueueAndRefresh = () => {
      const currentPairingStatus = engine.getPairingStatus();
      const pairingRefresh =
        currentPairingStatus === 'awaiting_authorization'
          ? engine.refreshPairingRegistration()
          : Promise.resolve(engine.getSnapshot());

      void pairingRefresh
        .then(() => engine.syncPendingQueue())
        .then(() => engine.sendHeartbeat())
        .then((nextSnap) => {
          if (!cancelled) {
            setSnapshot(nextSnap);
          }
        });
    };

    const handleOfflineStatus = () => {
      void engine.sendHeartbeat().then((nextSnap) => {
        if (!cancelled) {
          setSnapshot(nextSnap);
        }
      });
    };

    window.addEventListener('online', syncQueueAndRefresh);
    window.addEventListener('offline', handleOfflineStatus);
    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener('online', syncQueueAndRefresh);
      window.removeEventListener('offline', handleOfflineStatus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  // Publica heartbeat periódico em segundo plano para monitoramento ao vivo no painel administrativo.
  useEffect(() => {
    if (!snapshot.initialized || !snapshot.pairing.isPaired) {
      return;
    }

    let cancelled = false;
    const heartbeatInterval = window.setInterval(() => {
      void engine.sendHeartbeat().then((nextSnap) => {
        if (!cancelled) {
          setSnapshot(nextSnap);
        }
      });
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(heartbeatInterval);
    };
  }, [engine, snapshot.initialized, snapshot.pairing.isPaired]);

  // Retentativa periódica em segundo plano enquanto houver itens pendentes na fila local.
  useEffect(() => {
    if (snapshot.pendingSyncCount === 0) {
      return;
    }

    let cancelled = false;
    const retryInterval = window.setInterval(() => {
      void engine.syncPendingQueue().then(() => {
        if (!cancelled) {
          setSnapshot(engine.getSnapshot());
        }
      });
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(retryInterval);
    };
  }, [engine, snapshot.pendingSyncCount]);

  const activeMatch = snapshot.activeMatch;
  const matchStartedAtMs = activeMatch?.startedAtMs ?? null;
  const currentQuestion = activeMatch?.currentQuestion ?? null;
  const currentQuestionIndex = currentQuestion?.index ?? -1;
  const currentQuestionHasAnswered = currentQuestion?.hasAnswered ?? false;
  const totalQuestionMs = snapshot.event.settings.timePerQuestion * 1000;

  // Controla pulso intermitente de flash nos últimos 5s quando habilitado no Evento.
  useEffect(() => {
    if (
      snapshot.screen !== 'quiz-screen' ||
      currentQuestionHasAnswered ||
      !alertVisual.isFlashing
    ) {
      setFlashActive(false);
      return;
    }

    let timeoutHide: number | undefined;
    const triggerPulse = () => {
      setFlashActive(true);
      timeoutHide = window.setTimeout(() => setFlashActive(false), 300);
    };

    triggerPulse();
    const flashTimer = window.setInterval(triggerPulse, 700);
    return () => {
      window.clearInterval(flashTimer);
      if (timeoutHide !== undefined) {
        window.clearTimeout(timeoutHide);
      }
    };
  }, [snapshot.screen, currentQuestionHasAnswered, alertVisual.isFlashing]);

  // Sincroniza altura do teclado virtual e garante fechamento ao sair da tela inicial.
  const configuredKeyboardHeight = snapshot.event.settings.virtualKeyboardHeight;
  useEffect(() => {
    setVirtualKeyboardHeightVh(configuredKeyboardHeight || DEFAULT_KEYBOARD_HEIGHT_VH);
  }, [configuredKeyboardHeight]);

  useEffect(() => {
    if (snapshot.screen !== 'initial-screen') {
      setActiveVirtualField(null);
    }
  }, [snapshot.screen]);

  // Gerencia temporizadores de esmaecimento e transição para a Tela de Descanso.
  const { idleTimeoutSeconds, fadeOutLeadTimeSeconds } = snapshot.event.settings;
  useEffect(() => {
    if (snapshot.screen === 'idle-screen') {
      clearIdleTimers();
      isFadingToIdleRef.current = false;
      setIsFadingToIdle(false);
      return;
    }

    resetIdleTimer();
    return () => {
      clearIdleTimers();
    };
  }, [
    snapshot.initialized,
    snapshot.screen,
    idleTimeoutSeconds,
    fadeOutLeadTimeSeconds,
    resetIdleTimer,
    clearIdleTimers,
  ]);

  // Reinicia inatividade em eventos confiáveis fora do arraste do teclado com throttle de mousemove.
  useEffect(() => {
    const handleDocumentInteraction = (event: Event) => {
      if (!event.isTrusted || isResizingKeyboardRef.current) {
        return;
      }
      if (event.type === 'mousemove' && !isFadingToIdleRef.current) {
        const now = Date.now();
        if (now - lastMouseMoveResetRef.current < MOUSEMOVE_THROTTLE_MS) {
          return;
        }
        lastMouseMoveResetRef.current = now;
      }
      resetIdleTimer();
    };

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        event.preventDefault();
      }
    };

    const handleGestureStart = (event: Event) => {
      event.preventDefault();
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
      }
    };

    const handleZoomKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && ['+', '-', '=', '0'].includes(event.key)) {
        event.preventDefault();
      }
    };

    for (const eventName of INTERACTION_EVENTS) {
      document.addEventListener(eventName, handleDocumentInteraction, { passive: true });
    }
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('gesturestart', handleGestureStart);
    document.addEventListener('wheel', handleWheel, { passive: false });
    document.addEventListener('keydown', handleZoomKeyDown);

    return () => {
      for (const eventName of INTERACTION_EVENTS) {
        document.removeEventListener(eventName, handleDocumentInteraction);
      }
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('gesturestart', handleGestureStart);
      document.removeEventListener('wheel', handleWheel);
      document.removeEventListener('keydown', handleZoomKeyDown);
    };
  }, [resetIdleTimer]);

  const isSoundEnabled = (snapshot.event.settings.enableSoundEffects ?? true) && !localSoundMuted;
  const autoAdvanceSeconds = snapshot.event.settings.autoAdvanceSeconds ?? 0;

  // Alterna os destaques dinâmicos da Tela de Descanso enquanto o Evento estiver ativo.
  useEffect(() => {
    if (snapshot.screen !== 'idle-screen' || snapshot.eventWindow.isBlocked) {
      setIdleSlideIndex(0);
      return;
    }
    const timer = window.setInterval(() => {
      setIdleSlideIndex((prev) => (prev + 1) % 3);
    }, IDLE_SLIDE_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [snapshot.screen, snapshot.eventWindow.isBlocked]);

  const isGhostTouchActive = () => Date.now() < ghostTouchUntilRef.current;

  const handleStartQuiz = useCallback(async () => {
    if (isGhostTouchActive()) {
      return;
    }
    playTotemSound('click', isSoundEnabled);
    setActiveVirtualField(null);
    resetIdleTimer();
    const result = await engine.startMatch(nameInput, phoneInput);
    setSnapshot(result.snapshot);
    if (!result.started && result.errorMessage) {
      setActiveModal({ type: 'alert', message: result.errorMessage });
    } else {
      setElapsedMatchSeconds(0);
      setAlertVisual({ borderPulseState: 'none', isFlashing: false });
    }
  }, [engine, isSoundEnabled, nameInput, phoneInput, resetIdleTimer]);

  const handleSelectOption = useCallback(
    (optionIndex: number) => {
      resetIdleTimer();
      const outcome = engine.submitAnswer(optionIndex);
      setSnapshot(outcome.snapshot);
      const answered = outcome.snapshot.activeMatch?.currentQuestion;
      if (answered?.hasAnswered) {
        const chosen = answered.question.shuffledOptions[optionIndex];
        playTotemSound(chosen?.isCorrect ? 'correct' : 'incorrect', isSoundEnabled);
      }
    },
    [engine, isSoundEnabled, resetIdleTimer],
  );

  const handleQuestionTimeout = useCallback(() => {
    const outcome = engine.handleQuestionTimeout();
    setSnapshot(outcome.snapshot);
  }, [engine]);

  const handleAdvanceQuestion = useCallback(async () => {
    if (isAdvancing) {
      return;
    }
    playTotemSound('click', isSoundEnabled);
    setAutoAdvanceRemaining(null);
    resetIdleTimer();
    setIsAdvancing(true);
    try {
      const nextSnapshot = await engine.advanceAfterAnswer();
      setSnapshot(nextSnapshot);
      if (nextSnapshot.screen === 'result-screen') {
        if (nextSnapshot.lastResult?.wonPrize || nextSnapshot.lastResult?.isTop3) {
          playTotemSound('victory', isSoundEnabled);
        }
        if (nextSnapshot.lastResult?.isTop3) {
          setActiveModal({ type: 'top3' });
        }
      }
    } finally {
      setIsAdvancing(false);
    }
  }, [engine, isAdvancing, isSoundEnabled, resetIdleTimer]);

  // Avança automaticamente após responder/timeout usando apenas dependências primitivas (imune a heartbeats).
  useEffect(() => {
    if (
      snapshot.screen !== 'quiz-screen' ||
      currentQuestionIndex < 0 ||
      !currentQuestionHasAnswered ||
      autoAdvanceSeconds <= 0
    ) {
      setAutoAdvanceRemaining(null);
      return;
    }

    const totalSec = Math.max(1, Math.round(autoAdvanceSeconds));
    setAutoAdvanceRemaining(totalSec);

    const interval = window.setInterval(() => {
      setAutoAdvanceRemaining((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          window.clearInterval(interval);
          void handleAdvanceQuestion();
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [
    snapshot.screen,
    matchStartedAtMs,
    currentQuestionIndex,
    currentQuestionHasAnswered,
    autoAdvanceSeconds,
    handleAdvanceQuestion,
  ]);

  const handleOpenRanking = useCallback(async () => {
    resetTransientUiState(false);
    resetIdleTimer();
    const nextSnapshot = await engine.openRankingScreen();
    setSnapshot(nextSnapshot);
  }, [engine, resetIdleTimer, resetTransientUiState]);

  const handleConfirmGiveUp = async () => {
    resetTransientUiState(true);
    const nextSnapshot = await engine.giveUpMatch();
    setSnapshot(nextSnapshot);
    resetIdleTimer();
  };

  const handleDismissWinnerAlreadyModal = () => {
    const nextSnapshot = engine.dismissAlreadyWonModal();
    resetTransientUiState(true);
    setSnapshot(nextSnapshot);
    resetIdleTimer();
  };

  const handlePlayAgain = () => {
    const nextSnapshot = engine.resetToInitialScreen();
    resetTransientUiState(true);
    setSnapshot(nextSnapshot);
    resetIdleTimer();
  };

  const handleWakeFromIdle = () => {
    if (engine.getScreen() !== 'idle-screen') {
      return;
    }
    ghostTouchUntilRef.current = Date.now() + GHOST_TOUCH_GUARD_MS;
    playTotemSound('click', isSoundEnabled);
    const nextSnapshot = engine.wakeFromIdleScreen();
    resetTransientUiState(true);
    setSnapshot(nextSnapshot);
  };

  const handleFieldFocus = (field: VirtualKeyboardField) => {
    if (snapshot.event.settings.enableVirtualKeyboard) {
      setActiveVirtualField(field);
    } else {
      setActiveVirtualField(null);
    }
    resetIdleTimer();
  };

  // Teclado ágil no estande: PRÓXIMO avança para Telefone e JOGAR inicia a Partida diretamente.
  const handleVirtualKeyPress = (key: string) => {
    if (!activeVirtualField) {
      return;
    }

    resetIdleTimer();

    if (key === 'NEXT' || (key === 'OK' && activeVirtualField === 'nome')) {
      setActiveVirtualField('telefone');
      phoneInputRef.current?.focus();
      return;
    }

    if (key === 'SUBMIT' || (key === 'OK' && activeVirtualField === 'telefone')) {
      setActiveVirtualField(null);
      phoneInputRef.current?.blur();
      void handleStartQuiz();
      return;
    }

    if (activeVirtualField === 'nome') {
      if (key === 'Backspace') {
        setNameInput((prev) => normalizeParticipantName(prev.slice(0, -1)));
      } else if (key === 'Space') {
        setNameInput((prev) => normalizeParticipantName(`${prev} `));
      } else {
        setNameInput((prev) => normalizeParticipantName(`${prev}${key}`));
      }
      return;
    }

    if (key === 'Backspace') {
      setPhoneInput((prev) => formatPhoneMask(prev.replace(/\D/g, '').slice(0, -1)));
    } else if (key !== 'Space') {
      setPhoneInput((prev) => formatPhoneMask(`${prev}${key}`));
    }
  };

  const handleOpenDiagnosticsPrompt = () => {
    setPinInput('');
    setPinError(null);
    setDiagnosticsSyncMessage(null);
    setActiveModal({ type: 'pin-prompt' });
    resetIdleTimer();
  };

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    resetIdleTimer();
    if (engine.verifyDiagnosticPin(pinInput)) {
      setPinError(null);
      setPinInput('');
      setActiveModal({ type: 'diagnostics' });
    } else {
      setPinError('PIN inválido para este Totem.');
    }
  };

  const handleForceDiagnosticsSync = async () => {
    setIsForcingSync(true);
    resetIdleTimer();
    try {
      const result = await engine.forceSync();
      setSnapshot(result.snapshot);
      setDiagnosticsSyncMessage(
        `Sincronização concluída: ${result.synced} enviado(s), ${result.pending} pendente(s).`,
      );
    } catch (error) {
      setDiagnosticsSyncMessage(
        error instanceof Error ? error.message : 'Falha ao sincronizar fila local.',
      );
    } finally {
      setIsForcingSync(false);
    }
  };

  const handleActivateWithCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextSnap = await engine.activateWithCode(activationInput);
    setSnapshot(nextSnap);
    if (nextSnap.pairing.isPaired) {
      setActivationInput('');
      setActiveModal(null);
    }
  };

  const containerClasses = ['quiz-container'];
  if (isInSimulator) {
    containerClasses.push('in-simulator');
  }
  if (isFadingToIdle && snapshot.screen !== 'idle-screen') {
    containerClasses.push('fading-to-idle');
  }
  const showTimeAlerts =
    snapshot.screen === 'quiz-screen' &&
    Boolean(currentQuestion && !currentQuestion.hasAnswered);
  if (showTimeAlerts && alertVisual.borderPulseState === 'warning') {
    containerClasses.push('time-alert-border-pulse-warning');
  } else if (showTimeAlerts && alertVisual.borderPulseState === 'critical') {
    containerClasses.push('time-alert-border-pulse-critical');
  }
  if (showTimeAlerts && flashActive) {
    containerClasses.push('time-alert-flash-effect');
  }

  const texts = snapshot.event.customizations.texts;
  const logoSrc = snapshot.resolvedAssets.logoSrc;
  const backgroundSrc = snapshot.resolvedAssets.backgroundSrc;
  const themeStyle = buildThemeCssVariables(snapshot.event.customizations);
  const eventLayout = snapshot.event.customizations.layout;
  const initialLayout = useMemo(() => resolveScreenLayout(eventLayout, 'initial'), [eventLayout]);
  const idleLayout = useMemo(() => resolveScreenLayout(eventLayout, 'idle'), [eventLayout]);
  const quizLayout = useMemo(() => resolveScreenLayout(eventLayout, 'quiz'), [eventLayout]);
  const resultLayout = useMemo(() => resolveScreenLayout(eventLayout, 'result'), [eventLayout]);
  const rankingLayout = useMemo(() => resolveScreenLayout(eventLayout, 'ranking'), [eventLayout]);
  const { eventWindow } = snapshot;
  const shouldHideStartButton = eventWindow.isBlocked && eventWindow.status === 'after';
  const showPairingModal =
    snapshot.pairing.status === 'awaiting_authorization' || activeModal?.type === 'pairing';
  const diagnostics = activeModal?.type === 'diagnostics' ? engine.getLocalDiagnostics() : null;

  return (
    <div className={containerClasses.join(' ')} style={themeStyle}>
      <div className="totem-stage">
        {backgroundSrc && (
          <div
            className="quiz-custom-background-layer"
            style={{
              backgroundImage: `url(${backgroundSrc})`,
              opacity: snapshot.event.customizations.visualIdentity.customBackgroundOpacity,
            }}
            aria-hidden="true"
          />
        )}

        <AccessibilityControls
          hiddenOnIdle={snapshot.screen === 'idle-screen'}
          onInteraction={resetIdleTimer}
          onOpenDiagnostics={handleOpenDiagnosticsPrompt}
        />

        <TotemInitialScreen
          active={snapshot.screen === 'initial-screen'}
          layout={initialLayout}
          logoSrc={logoSrc}
          texts={texts}
          eventWindow={eventWindow}
          lgpdNoticeText={snapshot.event.settings.lgpdNoticeText}
          nameInput={nameInput}
          phoneInput={phoneInput}
          nameInputRef={nameInputRef}
          phoneInputRef={phoneInputRef}
          shouldHideStartButton={shouldHideStartButton}
          activeVirtualField={activeVirtualField}
          enableVirtualKeyboard={snapshot.event.settings.enableVirtualKeyboard}
          virtualKeyboardHeightVh={virtualKeyboardHeightVh}
          onNameChange={(val) => {
            setNameInput(val);
            resetIdleTimer();
          }}
          onPhoneChange={(val) => {
            setPhoneInput(val);
            resetIdleTimer();
          }}
          onFieldFocus={handleFieldFocus}
          onStartQuiz={() => void handleStartQuiz()}
          onOpenRanking={() => void handleOpenRanking()}
          onVirtualKeyboardHeightChange={setVirtualKeyboardHeightVh}
          onVirtualKeyPress={handleVirtualKeyPress}
          onVirtualKeyboardResizingChange={handleKeyboardResizingChange}
        />

        <TotemQuizScreen
          active={snapshot.screen === 'quiz-screen'}
          layout={quizLayout}
          engine={engine}
          logoSrc={logoSrc}
          currentQuestion={currentQuestion}
          matchStartedAtMs={matchStartedAtMs}
          elapsedMatchSeconds={elapsedMatchSeconds}
          totalQuestionMs={totalQuestionMs}
          isSoundEnabled={isSoundEnabled}
          isAdvancing={isAdvancing}
          autoAdvanceRemaining={autoAdvanceRemaining}
          onSelectOption={handleSelectOption}
          onAdvanceQuestion={() => void handleAdvanceQuestion()}
          onRequestGiveUp={() => {
            setActiveModal({ type: 'give-up' });
            resetIdleTimer();
          }}
          onElapsedMatchSecondsChange={setElapsedMatchSeconds}
          onTimeAlertVisualChange={setAlertVisual}
          onQuestionTimeout={handleQuestionTimeout}
        />

        <TotemResultScreen
          active={snapshot.screen === 'result-screen'}
          layout={resultLayout}
          logoSrc={logoSrc}
          texts={texts}
          lastResult={snapshot.lastResult}
          backgroundSyncNotice={snapshot.backgroundSyncNotice}
          onShowIncorrectAnswers={() => {
            setActiveModal({ type: 'incorrect' });
            resetIdleTimer();
          }}
          onOpenRanking={() => void handleOpenRanking()}
          onPlayAgain={handlePlayAgain}
        />

        <TotemRankingScreen
          active={snapshot.screen === 'ranking-screen'}
          layout={rankingLayout}
          logoSrc={logoSrc}
          texts={texts}
          ranking={snapshot.ranking}
          onBackToInitial={handlePlayAgain}
        />

        <TotemIdleScreen
          active={snapshot.screen === 'idle-screen'}
          layout={idleLayout}
          logoSrc={logoSrc}
          texts={texts}
          eventWindow={eventWindow}
          settings={snapshot.event.settings}
          ranking={snapshot.ranking}
          totalMatchesCount={snapshot.totalMatchesCount}
          idleSlideIndex={idleSlideIndex}
          onWake={handleWakeFromIdle}
        />

        <TotemModals
          activeModal={activeModal}
          snapshot={snapshot}
          showPairingModal={showPairingModal}
          diagnostics={diagnostics}
          activationInput={activationInput}
          pinInput={pinInput}
          pinError={pinError}
          diagnosticsSyncMessage={diagnosticsSyncMessage}
          isForcingSync={isForcingSync}
          localSoundMuted={localSoundMuted}
          onActivationInputChange={setActivationInput}
          onActivateWithCodeSubmit={(e) => void handleActivateWithCodeSubmit(e)}
          onPinInputChange={(value) => {
            setPinInput(value);
            setPinError(null);
          }}
          onPinSubmit={handlePinSubmit}
          onConfirmGiveUp={() => void handleConfirmGiveUp()}
          onDismissWinnerAlready={handleDismissWinnerAlreadyModal}
          onForceDiagnosticsSync={() => void handleForceDiagnosticsSync()}
          onToggleLocalSound={() => setLocalSoundMuted((prev) => !prev)}
          onCloseModal={() => {
            setActiveModal(null);
            setPinError(null);
            resetIdleTimer();
          }}
        />
      </div>
    </div>
  );
}
