import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DexieLocalStore } from '../adapters/dexieLocalStore';
import { CryptoRandomSource, SystemClock } from '../adapters/systemAdapters';
import {
  TotemSessionEngine,
  formatPhoneMask,
  normalizeParticipantName,
} from '../domain/totemSessionEngine';
import { extractPairingCodeFromInput } from '../domain/pairingUtils';
import type { TotemSessionSnapshot } from '../domain/types';
import { AccessibilityControls } from './AccessibilityControls';
import {
  DEFAULT_KEYBOARD_HEIGHT_VH,
  VirtualKeyboard,
  type VirtualKeyboardField,
} from './VirtualKeyboard';
import { createDefaultCloudGateway } from './cloudFactory';
import {
  DIFFICULTY_LABELS,
  PRIZE_STATUS_LABELS,
  TOTEM_ONLINE_STATUS_LABELS,
  formatAwardedAtPtBr,
  formatLastSeenPtBr,
  formatTimeMMSS,
} from './formatters';
import { EventLogoImage } from './EventLogoImage';
import { playTotemSound } from './soundEffects';
import { buildThemeCssVariables } from './themeCss';
import './styles.css';

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;
const IDLE_SLIDE_INTERVAL_MS = 5_000;
const GHOST_TOUCH_GUARD_MS = 350;

type ActiveTotemModal =
  | { type: 'alert'; message: string }
  | { type: 'incorrect' }
  | { type: 'top3' }
  | { type: 'give-up' }
  | { type: 'pin-prompt' }
  | { type: 'diagnostics' }
  | { type: 'pairing' }
  | null;

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
    cloudGateway: createDefaultCloudGateway(),
    clock: new SystemClock(),
    random: new CryptoRandomSource(),
    requirePairing: true,
  });
}

// Interface principal do Totem desacoplada da regra de negócio via TotemSessionEngine.
export function TotemApp({ engine: injectedEngine, simulatorModalRequest }: TotemAppProps) {
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
  const [questionRemainingMs, setQuestionRemainingMs] = useState(
    () => snapshot.event.settings.timePerQuestion * 1000,
  );
  const [flashActive, setFlashActive] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [activationInput, setActivationInput] = useState('');
  const [diagnosticsSyncMessage, setDiagnosticsSyncMessage] = useState<string | null>(null);
  const [isForcingSync, setIsForcingSync] = useState(false);
  const [localSoundMuted, setLocalSoundMuted] = useState(false);
  const [idleSlideIndex, setIdleSlideIndex] = useState(0);
  const [autoAdvanceRemaining, setAutoAdvanceRemaining] = useState<number | null>(null);

  const questionStartMsRef = useRef<number>(engine.getNowMs());
  const timeoutHandledForIndexRef = useRef<number | null>(null);
  const fadeOutTimerRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const lastTickSecondRef = useRef<number | null>(null);
  const ghostTouchUntilRef = useRef<number>(0);
  const isResizingKeyboardRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const phoneInputRef = useRef<HTMLInputElement | null>(null);

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
    setIsAdvancing(false);
    if (clearFields) {
      setNameInput('');
      setPhoneInput('');
    }
  }, []);

  // Reinicia o temporizador de ociosidade respeitando a configuração do Evento e o arraste do teclado.
  const resetIdleTimer = useCallback(() => {
    const currentSnap = engine.getSnapshot();
    if (
      isResizingKeyboardRef.current ||
      currentSnap.screen === 'idle-screen' ||
      currentSnap.pairing.status === 'awaiting_authorization'
    ) {
      return;
    }

    clearIdleTimers();
    setIsFadingToIdle(false);

    const { idleTimeoutMs, fadeOutStartMs } = engine.getIdleTimingConfig();

    if (fadeOutStartMs > 0 && idleTimeoutMs > fadeOutStartMs) {
      fadeOutTimerRef.current = window.setTimeout(() => {
        if (engine.getSnapshot().screen !== 'idle-screen') {
          setIsFadingToIdle(true);
        }
      }, fadeOutStartMs);
    } else if (idleTimeoutMs > 0) {
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
    document.documentElement.classList.add('totem-fullscreen-mode');
    document.body.classList.add('totem-fullscreen-mode');
    return () => {
      document.documentElement.classList.remove('totem-fullscreen-mode');
      document.body.classList.remove('totem-fullscreen-mode');
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let lastObservedScreen = engine.getSnapshot().screen;
    let lastObservedEventId = engine.getSnapshot().event.id;

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
      const currentPairingStatus = engine.getSnapshot().pairing.status;
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

  // Reinicia cronômetro da questão apenas quando uma nova questão ou Partida começa.
  useEffect(() => {
    if (snapshot.screen !== 'quiz-screen' || matchStartedAtMs === null || currentQuestionIndex < 0) {
      return;
    }
    questionStartMsRef.current = engine.getNowMs();
    timeoutHandledForIndexRef.current = null;
    setQuestionRemainingMs(totalQuestionMs);
    setFlashActive(false);
    setIsAdvancing(false);
  }, [engine, snapshot.screen, matchStartedAtMs, currentQuestionIndex, totalQuestionMs]);

  // Atualiza cronômetro total (via Clock do motor), barra regressiva e timeout da questão.
  useEffect(() => {
    if (
      snapshot.screen !== 'quiz-screen' ||
      matchStartedAtMs === null ||
      currentQuestionIndex < 0
    ) {
      setFlashActive(false);
      return;
    }

    const updateClockAndBar = () => {
      setElapsedMatchSeconds(engine.getElapsedMatchSeconds());

      if (currentQuestionHasAnswered) {
        return;
      }

      const remaining = Math.max(
        0,
        totalQuestionMs - (engine.getNowMs() - questionStartMsRef.current),
      );
      setQuestionRemainingMs(remaining);

      if (remaining <= 0 && timeoutHandledForIndexRef.current !== currentQuestionIndex) {
        timeoutHandledForIndexRef.current = currentQuestionIndex;
        const outcome = engine.handleQuestionTimeout();
        setSnapshot(outcome.snapshot);
      }
    };

    updateClockAndBar();
    const intervalId = window.setInterval(updateClockAndBar, 50);
    return () => window.clearInterval(intervalId);
  }, [
    engine,
    snapshot.screen,
    matchStartedAtMs,
    currentQuestionHasAnswered,
    currentQuestionIndex,
    totalQuestionMs,
  ]);

  const visualTimeState = engine.getQuestionTimeVisualState(questionRemainingMs);
  const showTimeAlerts =
    snapshot.screen === 'quiz-screen' && Boolean(currentQuestion && !currentQuestion.hasAnswered);

  // Controla o pulso intermitente de flash nos últimos 5 segundos quando habilitado.
  useEffect(() => {
    if (!showTimeAlerts || !visualTimeState.isFlashing) {
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
  }, [showTimeAlerts, visualTimeState.isFlashing]);

  // Sincroniza a altura padrão do teclado virtual ao carregar novas configurações do Evento.
  const configuredKeyboardHeight = snapshot.event.settings.virtualKeyboardHeight;
  useEffect(() => {
    setVirtualKeyboardHeightVh(configuredKeyboardHeight || DEFAULT_KEYBOARD_HEIGHT_VH);
  }, [configuredKeyboardHeight]);

  // Garante fechamento do teclado virtual sempre que o Totem sair da tela inicial.
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

  // Reinicia inatividade apenas em eventos confiáveis fora do arraste do teclado e bloqueia menu de contexto.
  useEffect(() => {
    const handleDocumentInteraction = (event: Event) => {
      if (event.isTrusted && !isResizingKeyboardRef.current) {
        resetIdleTimer();
      }
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

  // Toca tick sonoro discreto nos últimos 5 segundos de uma questão em aberto.
  useEffect(() => {
    const currentQ = snapshot.activeMatch?.currentQuestion;
    if (snapshot.screen !== 'quiz-screen' || !currentQ || currentQ.hasAnswered) {
      lastTickSecondRef.current = null;
      return;
    }
    const remainingSec = Math.ceil(questionRemainingMs / 1000);
    if (remainingSec <= 5 && remainingSec >= 1 && lastTickSecondRef.current !== remainingSec) {
      lastTickSecondRef.current = remainingSec;
      playTotemSound('tick', isSoundEnabled);
    }
  }, [snapshot.screen, snapshot.activeMatch?.currentQuestion, questionRemainingMs, isSoundEnabled]);

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

  const handleStartQuiz = async () => {
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
    }
  };

  const handleSelectOption = (optionIndex: number) => {
    resetIdleTimer();
    const outcome = engine.submitAnswer(optionIndex);
    setSnapshot(outcome.snapshot);
    const answered = outcome.snapshot.activeMatch?.currentQuestion;
    if (answered?.hasAnswered) {
      const chosen = answered.question.shuffledOptions[optionIndex];
      playTotemSound(chosen?.isCorrect ? 'correct' : 'incorrect', isSoundEnabled);
    }
  };

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

  // Avança automaticamente após responder/timeout quando autoAdvanceSeconds > 0.
  useEffect(() => {
    const currentQ = snapshot.activeMatch?.currentQuestion;
    if (
      snapshot.screen !== 'quiz-screen' ||
      !currentQ ||
      !currentQ.hasAnswered ||
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
    snapshot.activeMatch?.currentQuestion,
    autoAdvanceSeconds,
    handleAdvanceQuestion,
  ]);

  const handleOpenRanking = async () => {
    resetTransientUiState(false);
    resetIdleTimer();
    const nextSnapshot = await engine.openRankingScreen();
    setSnapshot(nextSnapshot);
  };

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

  // Desperta o Totem da Tela de Descanso limpando campos e estado transitório da tela inicial.
  const handleWakeFromIdle = () => {
    if (engine.getSnapshot().screen !== 'idle-screen') {
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

  // Processa teclas do teclado virtual aplicando normalização de nome ou máscara de telefone.
  const handleVirtualKeyPress = (key: string) => {
    if (!activeVirtualField) {
      return;
    }

    resetIdleTimer();

    if (key === 'OK') {
      setActiveVirtualField(null);
      if (activeVirtualField === 'nome') {
        nameInputRef.current?.blur();
      } else {
        phoneInputRef.current?.blur();
      }
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
  if (isFadingToIdle && snapshot.screen !== 'idle-screen') {
    containerClasses.push('fading-to-idle');
  }
  if (showTimeAlerts && visualTimeState.borderPulseState === 'warning') {
    containerClasses.push('time-alert-border-pulse-warning');
  } else if (showTimeAlerts && visualTimeState.borderPulseState === 'critical') {
    containerClasses.push('time-alert-border-pulse-critical');
  }
  if (showTimeAlerts && flashActive) {
    containerClasses.push('time-alert-flash-effect');
  }

  const texts = snapshot.event.customizations.texts;
  const logoSrc = snapshot.resolvedAssets.logoSrc;
  const backgroundSrc = snapshot.resolvedAssets.backgroundSrc;
  const themeStyle = buildThemeCssVariables(snapshot.event.customizations);
  const { eventWindow } = snapshot;
  const shouldHideStartButton = eventWindow.isBlocked && eventWindow.status === 'after';
  const showPairingModal =
    snapshot.pairing.status === 'awaiting_authorization' || activeModal?.type === 'pairing';
  const diagnostics = activeModal?.type === 'diagnostics' ? engine.getLocalDiagnostics() : null;

  return (
    <div className={containerClasses.join(' ')} style={themeStyle}>
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

      <section
        id="initial-screen"
        className={`screen ${snapshot.screen === 'initial-screen' ? 'active' : ''}`}
        aria-hidden={snapshot.screen !== 'initial-screen'}
      >
        <div className="screen-content">
          <EventLogoImage src={logoSrc} />
          <h2>{texts.initialScreenTitle}</h2>
          <p className="slogan">{texts.initialScreenSlogan}</p>
          {eventWindow.initialScreenMessage !== null && (
            <p id="event-status-message">{eventWindow.initialScreenMessage}</p>
          )}
          <p>Preencha seus dados para começar:</p>

          <div className="form-group">
            <label htmlFor="nome">Nome</label>
            <input
              ref={nameInputRef}
              id="nome"
              name="nome"
              type="text"
              autoComplete="off"
              placeholder={texts.inputNamePlaceholder}
              value={nameInput}
              onFocus={() => handleFieldFocus('nome')}
              onChange={(event) => {
                setNameInput(normalizeParticipantName(event.target.value));
                resetIdleTimer();
              }}
            />
          </div>

          <div className="form-group">
            <label htmlFor="telefone">Telefone</label>
            <input
              ref={phoneInputRef}
              id="telefone"
              name="telefone"
              type="tel"
              autoComplete="off"
              placeholder={texts.inputPhonePlaceholder}
              value={phoneInput}
              onFocus={() => handleFieldFocus('telefone')}
              onChange={(event) => {
                setPhoneInput(formatPhoneMask(event.target.value));
                resetIdleTimer();
              }}
            />
          </div>

          {snapshot.event.settings.lgpdNoticeText?.trim() && (
            <p id="lgpd-notice-text" className="lgpd-notice-text">
              {snapshot.event.settings.lgpdNoticeText.trim()}
            </p>
          )}

          <button
            id="start-quiz-btn"
            type="button"
            className={shouldHideStartButton ? 'btn hidden' : 'btn'}
            disabled={eventWindow.isBlocked}
            hidden={shouldHideStartButton}
            onClick={handleStartQuiz}
          >
            {texts.initialScreenStartButton}
          </button>

          <button
            id="view-ranking-initial-btn"
            type="button"
            className="btn-secondary"
            onClick={handleOpenRanking}
          >
            {texts.initialScreenRankingButton}
          </button>
        </div>

        <VirtualKeyboard
          activeField={snapshot.screen === 'initial-screen' ? activeVirtualField : null}
          enabled={snapshot.event.settings.enableVirtualKeyboard}
          heightVh={virtualKeyboardHeightVh}
          onHeightVhChange={setVirtualKeyboardHeightVh}
          onKeyPress={handleVirtualKeyPress}
          onResizingChange={handleKeyboardResizingChange}
        />
      </section>

      <section
        id="quiz-screen"
        className={`screen ${snapshot.screen === 'quiz-screen' ? 'active' : ''}`}
        aria-hidden={snapshot.screen !== 'quiz-screen'}
      >
        <EventLogoImage src={logoSrc} />

        {currentQuestion && (
          <>
            <div className="quiz-header-top">
              <div
                id="question-difficulty-tag"
                className={`question-difficulty-tag difficulty-${currentQuestion.question.difficulty}`}
              >
                {DIFFICULTY_LABELS[currentQuestion.question.difficulty]}
              </div>

              <span id="question-counter" className="quiz-counter">
                {currentQuestion.index + 1}/{currentQuestion.total}
              </span>

              <div id="progress-bar-container">
                <div
                  id="progress-bar-fill"
                  style={{
                    width: `${((currentQuestion.index + 1) / currentQuestion.total) * 100}%`,
                  }}
                />
              </div>

              <span id="timer" className="quiz-timer timer-normal">
                {formatTimeMMSS(elapsedMatchSeconds)}
              </span>
            </div>

            <div className="screen-content">
              <div id="question-area">
                <h3 id="question-text">{currentQuestion.question.text}</h3>

                <div
                  id="options-container"
                  className={currentQuestion.isTimedOut ? 'options-really-dimmed' : ''}
                >
                  {currentQuestion.question.shuffledOptions.map((option, idx) => {
                    const optionClasses = ['option'];
                    if (currentQuestion.hasAnswered) {
                      optionClasses.push('disabled');
                      const isChosen = currentQuestion.selectedOptionIndex === idx;
                      const isRevealedCorrect =
                        currentQuestion.revealedCorrectOptionIndex === idx;

                      if (isRevealedCorrect || (isChosen && option.isCorrect)) {
                        optionClasses.push('correct');
                      } else if (isChosen && !option.isCorrect) {
                        optionClasses.push('incorrect');
                      }
                    }

                    return (
                      <button
                        key={`${currentQuestion.question.id}-${idx}`}
                        type="button"
                        className={optionClasses.join(' ')}
                        disabled={currentQuestion.hasAnswered}
                        onClick={() => handleSelectOption(idx)}
                      >
                        <span className="option-letter" aria-hidden="true">
                          {OPTION_LETTERS[idx] ?? idx + 1}
                        </span>
                        <span className="option-label">{option.text}</span>
                      </button>
                    );
                  })}
                </div>

                {!currentQuestion.hasAnswered && (
                  <div id="question-time-bar-container" aria-label="Tempo restante da questão">
                    <div
                      id="question-time-bar-fill"
                      style={{
                        width: `${visualTimeState.percentageRemaining}%`,
                        backgroundColor: visualTimeState.barColor,
                      }}
                    />
                  </div>
                )}

                {currentQuestion.hasAnswered && (
                  <div id="post-question-controls">
                    {currentQuestion.isTimedOut && (
                      <p id="timeout-message-text">Tempo Esgotado!</p>
                    )}
                    <button
                      id="next-question-btn"
                      type="button"
                      className="btn"
                      disabled={isAdvancing}
                      onClick={() => void handleAdvanceQuestion()}
                    >
                      {autoAdvanceRemaining !== null
                        ? `${currentQuestion.advanceButtonLabel} (${autoAdvanceRemaining}s)`
                        : currentQuestion.advanceButtonLabel}
                    </button>
                  </div>
                )}

                {!currentQuestion.hasAnswered && (
                  <button
                    id="give-up-btn"
                    type="button"
                    className="btn-give-up"
                    title="Desistir do Quiz"
                    aria-label="Desistir do Quiz"
                    onClick={() => {
                      setActiveModal({ type: 'give-up' });
                      resetIdleTimer();
                    }}
                  >
                    &times;
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      <section
        id="result-screen"
        className={`screen ${snapshot.screen === 'result-screen' ? 'active' : ''}`}
        aria-hidden={snapshot.screen !== 'result-screen'}
      >
        {snapshot.lastResult && (
          <div className="screen-content">
            <EventLogoImage src={logoSrc} />

            <h2 id="result-participant-name-title">{snapshot.lastResult.participantName},</h2>

            <p
              id="result-prize-message"
              className={`result-message ${
                snapshot.lastResult.wonPrize ? 'prize-won' : 'prize-not-won'
              }`}
            >
              {snapshot.lastResult.wonPrize
                ? texts.resultScreenPrizeWon
                : texts.resultScreenPrizeNotWon}
              {snapshot.lastResult.wonPrize && snapshot.lastResult.prizeStatus && (
                <span className="prize-status-badge">
                  {PRIZE_STATUS_LABELS[snapshot.lastResult.prizeStatus]}
                </span>
              )}
            </p>

            <div id="result-summary-details">
              <p>
                Seu Desempenho:{' '}
                <strong>
                  {snapshot.lastResult.score}/{snapshot.lastResult.totalQuestions}
                </strong>{' '}
                acertos
              </p>
              <p>
                Tempo: <strong>{formatTimeMMSS(snapshot.lastResult.timeSeconds)}</strong>
              </p>
              <p>
                Ranking:{' '}
                <strong>
                  {snapshot.lastResult.rankingPosition > 0
                    ? `${snapshot.lastResult.rankingPosition}º lugar`
                    : 'N/A'}
                </strong>
              </p>
            </div>

            {snapshot.lastResult.isPerfectScore && (
              <p id="result-all-correct-message" className="result-message all-correct-message">
                {texts.resultScreenAllCorrect}
              </p>
            )}

            {snapshot.lastResult.canShowIncorrectAnswers && (
              <button
                id="show-incorrect-answers-btn"
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setActiveModal({ type: 'incorrect' });
                  resetIdleTimer();
                }}
              >
                Onde Eu Errei?
              </button>
            )}

            <button
              id="show-ranking-btn"
              type="button"
              className="btn-secondary"
              onClick={handleOpenRanking}
            >
              {texts.resultScreenRankingButton}
            </button>

            <button id="restart-quiz-btn" type="button" className="btn" onClick={handlePlayAgain}>
              {texts.resultScreenPlayAgainButton}
            </button>
          </div>
        )}
      </section>

      <section
        id="ranking-screen"
        className={`screen ${snapshot.screen === 'ranking-screen' ? 'active' : ''}`}
        aria-hidden={snapshot.screen !== 'ranking-screen'}
      >
        <div className="screen-content">
          <EventLogoImage src={logoSrc} />
          <h2>{texts.rankingScreenTitle}</h2>
          <ol id="ranking-list" className="ranking-list-shared-style">
            {snapshot.ranking.length === 0 ? (
              <li>Nenhum participante no ranking ainda.</li>
            ) : (
              snapshot.ranking.map((entry) => (
                <li key={entry.matchId}>
                  <span>
                    {entry.position}. <span className="rank-name">{entry.participantName}</span>
                  </span>
                  <span className="rank-score">{entry.score} Acertos</span>
                  <span className="rank-time">{formatTimeMMSS(entry.timeSeconds)}</span>
                </li>
              ))
            )}
          </ol>
          <button
            id="back-to-initial-btn"
            type="button"
            className="btn"
            onClick={handlePlayAgain}
          >
            {texts.rankingScreenBackButton}
          </button>
        </div>
      </section>

      <section
        id="idle-screen"
        className={`screen ${snapshot.screen === 'idle-screen' ? 'active' : ''}`}
        aria-hidden={snapshot.screen !== 'idle-screen'}
        onClick={handleWakeFromIdle}
        onTouchStart={handleWakeFromIdle}
      >
        {!eventWindow.isBlocked && (
          <div className="idle-ambient-bg" aria-hidden="true">
            <span className="idle-orb idle-orb-1" />
            <span className="idle-orb idle-orb-2" />
            <span className="idle-orb idle-orb-3" />
          </div>
        )}

        <div className="screen-content">
          <EventLogoImage src={logoSrc} />
          <p className="slogan">{texts.initialScreenSlogan}</p>

          {!eventWindow.isBlocked && (
            <div className="idle-showcase-card" aria-live="off">
              {idleSlideIndex === 0 && (
                <div className="idle-showcase-slide" data-testid="idle-slide-podium">
                  <span className="idle-showcase-kicker">Pódio ao Vivo · Top 3</span>
                  {snapshot.ranking.length > 0 ? (
                    <ol className="idle-podium-list">
                      {snapshot.ranking.slice(0, 3).map((entry, idx) => (
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
                    {snapshot.ranking.length}{' '}
                    <span>
                      {snapshot.ranking.length === 1 ? 'participação' : 'participações'} no ranking
                    </span>
                  </p>
                  <p className="idle-showcase-sub">
                    Acerte a partir de {snapshot.event.settings.minScoreForPrize} questões e conquiste seu brinde!
                  </p>
                </div>
              )}

              {idleSlideIndex === 2 && (
                <div className="idle-showcase-slide" data-testid="idle-slide-stats">
                  <span className="idle-showcase-kicker">Como Funciona</span>
                  <div className="idle-stats-pills">
                    <span className="idle-stat-pill">
                      <strong>{snapshot.event.settings.numberOfQuestions}</strong> perguntas
                    </span>
                    <span className="idle-stat-pill">
                      <strong>{snapshot.event.settings.timePerQuestion}s</strong> por questão
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

      {activeModal?.type === 'alert' && (
        <div
          id="alert-modal"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="alert-modal-title"
        >
          <div className="modal-content">
            <h3 id="alert-modal-title" className="modal-title">
              Atenção
            </h3>
            <p id="alert-message" className="modal-text">
              {activeModal.message}
            </p>
            <button
              id="alert-ok-btn"
              type="button"
              className="btn modal-close-btn"
              onClick={() => {
                setActiveModal(null);
                resetIdleTimer();
              }}
            >
              OK
            </button>
          </div>
        </div>
      )}

      {activeModal?.type === 'incorrect' && snapshot.lastResult && (
        <div
          id="incorrect-answers-modal"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="incorrect-answers-modal-title"
        >
          <div className="modal-content">
            <h3 id="incorrect-answers-modal-title" className="modal-title">
              {texts.modalIncorrectAnswersTitle}
            </h3>
            <div id="incorrect-answers-list" className="modal-scrollable-content">
              {snapshot.lastResult.incorrectAnswers.map((item) => (
                <div key={item.questionId} className="question-review-item">
                  <h4>{item.questionText}</h4>
                  <p className="participant-answer">
                    <span className="review-label">Sua resposta: </span>
                    <span className="review-value-participant">{item.selectedOptionText}</span>
                  </p>
                  <p className="correct-answer-review">
                    <span className="review-label">Resposta correta: </span>
                    <span className="review-value-correct">{item.correctOptionText}</span>
                  </p>
                </div>
              ))}
            </div>
            <button
              id="close-incorrect-answers-modal-btn"
              type="button"
              className="btn modal-close-btn"
              onClick={() => {
                setActiveModal(null);
                resetIdleTimer();
              }}
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {snapshot.alreadyWonModal && (
        <div
          id="winner-already-modal"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="winner-already-modal-title"
        >
          <div className="modal-content">
            <h3 id="winner-already-modal-title" className="modal-title">
              {texts.modalAlreadyWonTitle}
            </h3>
            <p id="winner-already-main-message" className="modal-text">
              {texts.modalAlreadyWonMessage}
            </p>
            <p id="winner-already-timestamp" className="modal-timestamp">
              {formatAwardedAtPtBr(snapshot.alreadyWonModal.awardedAt)}
            </p>
            <button
              id="close-winner-already-modal-btn"
              type="button"
              className="btn modal-close-btn"
              onClick={handleDismissWinnerAlreadyModal}
            >
              Entendi!
            </button>
          </div>
        </div>
      )}

      {activeModal?.type === 'top3' && snapshot.lastResult && snapshot.lastResult.isTop3 && (
        <div
          id="top3-congrats-modal"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="top3-modal-title"
        >
          <div className="modal-content">
            <h3 id="top3-modal-title" className="modal-title">
              ✨ Resultado Espetacular! ✨
            </h3>
            <div id="top3-modal-message-content">
              <p>
                Parabéns, <strong>{snapshot.lastResult.participantName}</strong>!
              </p>
              <p>Você garantiu um lugar entre os melhores desempenhos do Evento!</p>
              <p>
                <span className="msg-rank-highlight">
                  TOP {snapshot.lastResult.rankingPosition}
                </span>
              </p>
            </div>
            <button
              id="close-top3-congrats-modal-btn"
              type="button"
              className="btn modal-close-btn"
              onClick={() => {
                setActiveModal(null);
                resetIdleTimer();
              }}
            >
              OK!
            </button>
          </div>
        </div>
      )}

      {activeModal?.type === 'give-up' && (
        <div
          id="confirm-modal"
          className="modal-overlay modal-type-danger"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
        >
          <div className="modal-content">
            <h3 id="confirm-modal-title" className="modal-title">
              Confirmação
            </h3>
            <p id="confirm-message" className="modal-text">
              Tem certeza que deseja desistir do quiz? Seu progresso atual não será salvo.
            </p>
            <div className="modal-actions">
              <button
                id="confirm-proceed-btn"
                type="button"
                className="btn btn-danger"
                onClick={handleConfirmGiveUp}
              >
                Sair
              </button>
              <button
                id="confirm-cancel-btn"
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setActiveModal(null);
                  resetIdleTimer();
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {showPairingModal && (
        <div
          id="totem-pairing-modal"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="totem-pairing-title"
        >
          <div className="modal-content">
            <h3 id="totem-pairing-title" className="modal-title">
              Pareamento do Totem
            </h3>
            <p className="modal-text">
              Autorize este código no Painel Administrativo para vincular o Totem a um Evento:
            </p>
            <p className="totem-pairing-code-box">
              <strong id="totem-pairing-code">{snapshot.pairing.pairingCode ?? '------'}</strong>
            </p>

            <form
              className="totem-modal-form"
              onSubmit={(e) => void handleActivateWithCodeSubmit(e)}
            >
              <div className="form-group">
                <label htmlFor="totem-activation-input">Código ou Link de Ativação</label>
                <input
                  id="totem-activation-input"
                  type="text"
                  value={activationInput}
                  onChange={(e) => setActivationInput(e.target.value)}
                  placeholder="Ex.: ABC123 ou ?pairingCode=ABC123"
                />
              </div>

              {snapshot.lastValidationError && (
                <p className="totem-modal-error" role="alert">
                  {snapshot.lastValidationError}
                </p>
              )}

              <div className="modal-actions">
                <button id="totem-activate-code-btn" type="submit" className="btn">
                  Ativar com Código
                </button>
                {activeModal?.type === 'pairing' &&
                  snapshot.pairing.status !== 'awaiting_authorization' && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setActiveModal(null)}
                    >
                      Fechar
                    </button>
                  )}
              </div>
            </form>
          </div>
        </div>
      )}

      {activeModal?.type === 'pin-prompt' && (
        <div
          id="totem-pin-modal"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="totem-pin-title"
        >
          <div className="modal-content">
            <h3 id="totem-pin-title" className="modal-title">
              Acesso ao Diagnóstico Local
            </h3>
            <p className="modal-text">
              Informe o PIN numérico rápido configurado para este Totem:
            </p>
            <form className="totem-modal-form" onSubmit={handlePinSubmit}>
              <div className="form-group">
                <label htmlFor="totem-pin-input">PIN do Totem</label>
                <input
                  id="totem-pin-input"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={pinInput}
                  onChange={(e) => {
                    setPinInput(e.target.value);
                    setPinError(null);
                  }}
                />
              </div>

              {pinError && (
                <p id="totem-pin-error" className="totem-modal-error" role="alert">
                  {pinError}
                </p>
              )}

              <div className="modal-actions">
                <button id="totem-pin-submit-btn" type="submit" className="btn">
                  Acessar Diagnóstico
                </button>
                <button
                  id="totem-pin-cancel-btn"
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setActiveModal(null);
                    setPinError(null);
                    resetIdleTimer();
                  }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeModal?.type === 'diagnostics' && diagnostics && (
        <div
          id="totem-diagnostics-modal"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="totem-diagnostics-title"
        >
          <div className="modal-content">
            <h3 id="totem-diagnostics-title" className="modal-title">
              Diagnóstico Local do Totem
            </h3>

            <dl className="totem-diagnostics-list">
              <div>
                <dt>Status de Conexão</dt>
                <dd id="diagnostics-connection-status">
                  {TOTEM_ONLINE_STATUS_LABELS[diagnostics.isOnline ? 'online' : 'offline']}
                </dd>
              </div>
              <div>
                <dt>Evento Atual</dt>
                <dd id="diagnostics-event-name">
                  {diagnostics.eventName} (v{diagnostics.configVersion})
                </dd>
              </div>
              <div>
                <dt>Totem</dt>
                <dd id="diagnostics-totem-name">
                  {diagnostics.totemName ?? 'Não vinculado'}
                </dd>
              </div>
              <div>
                <dt>Código do Totem</dt>
                <dd id="diagnostics-totem-code">
                  {diagnostics.pairingCode ?? diagnostics.totemId ?? 'Não pareado'}
                </dd>
              </div>
              <div>
                <dt>Itens pendentes na syncQueue</dt>
                <dd id="diagnostics-pending-sync">{diagnostics.pendingSyncCount}</dd>
              </div>
              <div>
                <dt>Último Ping</dt>
                <dd id="diagnostics-last-ping">
                  {formatLastSeenPtBr(diagnostics.lastHeartbeatAt)}
                </dd>
              </div>
            </dl>

            {diagnosticsSyncMessage && (
              <p id="diagnostics-sync-status" className="modal-text" role="status">
                {diagnosticsSyncMessage}
              </p>
            )}

            <div className="modal-actions">
              <button
                id="diagnostics-toggle-sound-btn"
                type="button"
                className="btn-secondary"
                onClick={() => setLocalSoundMuted((prev) => !prev)}
              >
                {localSoundMuted ? 'Ativar Som Local' : 'Silenciar Som Local'}
              </button>
              <button
                id="diagnostics-force-sync-btn"
                type="button"
                className="btn"
                disabled={isForcingSync}
                onClick={() => void handleForceDiagnosticsSync()}
              >
                {isForcingSync ? 'Sincronizando...' : 'Forçar Sincronização'}
              </button>
              <button
                id="close-diagnostics-modal-btn"
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setActiveModal(null);
                  resetIdleTimer();
                }}
              >
                Fechar Diagnóstico
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
