import { useEffect, useMemo, useState } from 'react';
import { InMemoryCloudGateway } from '../adapters/inMemoryCloudGateway';
import { InMemoryLocalStore } from '../adapters/inMemoryLocalStore';
import { DEFAULT_EVENT_CONFIG, DEFAULT_QUIZ_QUESTIONS } from '../domain/defaults';
import type { Clock, RandomSource } from '../domain/ports';
import { TotemSessionEngine } from '../domain/totemSessionEngine';
import type { EventConfig } from '../domain/types';
import { TotemApp } from './TotemApp';

export interface DevSimulatorModalProps {
  event: EventConfig | null;
  onClose: () => void;
}

class SimulatorClock implements Clock {
  now(): number {
    return Date.now();
  }
  toISOString(ms?: number): string {
    return new Date(ms ?? Date.now()).toISOString();
  }
}

class SimulatorRandom implements RandomSource {
  private counter = 0;
  next(): number {
    return 0.5;
  }
  shuffle<T>(items: readonly T[]): T[] {
    return [...items];
  }
  uuid(): string {
    this.counter += 1;
    return `99999999-0000-4000-8000-${String(this.counter).padStart(12, '0')}`;
  }
}

// Janela isolada de simulação do Totem para testar telas, modais e estados temporais sem afetar métricas reais.
export function DevSimulatorModal({ event, onClose }: DevSimulatorModalProps) {
  const [modalRequest, setModalRequest] = useState<{
    type: 'top3' | 'incorrect';
    nonce: number;
  } | null>(null);
  const [simStatus, setSimStatus] = useState('Simulador isolado pronto.');

  const simContext = useMemo(() => {
    const cloudGateway = new InMemoryCloudGateway({
      online: true,
      seedDefaultEvent: false,
    });
    const localStore = new InMemoryLocalStore();
    const clock = new SimulatorClock();
    const random = new SimulatorRandom();

    const baseEvent: EventConfig = structuredClone(event ?? DEFAULT_EVENT_CONFIG);
    baseEvent.settings = {
      ...baseEvent.settings,
      numberOfQuestions: 3,
      minScoreForPrize: 2,
      enablePrizeLock: true,
      showCorrectAnswerOnWrong: true,
    };
    cloudGateway.seedEvent(baseEvent, structuredClone(DEFAULT_QUIZ_QUESTIONS.slice(0, 5)));

    const engine = new TotemSessionEngine({
      localStore,
      cloudGateway,
      clock,
      random,
      requirePairing: false,
    });

    return { cloudGateway, localStore, engine, clock, baseEventId: baseEvent.id };
  }, [event]);

  useEffect(() => {
    void simContext.engine.initialize({ requirePairing: false });
    return () => {
      simContext.engine.dispose();
    };
  }, [simContext]);

  const clearSimulatedMatches = async () => {
    const existing = await simContext.cloudGateway.listMatches(simContext.baseEventId);
    if (existing.length > 0) {
      await simContext.cloudGateway.deleteMatches(existing.map((m) => m.id));
    }
    await simContext.engine.forceSync();
  };

  const resetSimulatedEvent = async (patch: Partial<EventConfig>) => {
    const [current] = await simContext.cloudGateway.listEvents();
    const updated: EventConfig = {
      ...current!,
      ...patch,
      configVersion: (current?.configVersion ?? 1) + 1,
    };
    await simContext.cloudGateway.saveEvent(updated);
    await simContext.engine.forceSync();
  };

  const simulateScreen = async (screen: 'initial' | 'quiz' | 'result' | 'ranking' | 'idle') => {
    const { engine } = simContext;
    if (screen === 'idle') {
      engine.enterIdleScreen();
      setSimStatus('Tela simulada: Descanso');
      return;
    }
    if (screen === 'ranking') {
      await engine.openRankingScreen();
      setSimStatus('Tela simulada: Ranking');
      return;
    }
    if (screen === 'initial') {
      engine.resetToInitialScreen();
      setSimStatus('Tela simulada: Inicial');
      return;
    }
    if (screen === 'quiz') {
      engine.wakeFromIdleScreen();
      await engine.startMatch('PARTICIPANTE SIMULADO', '(61) 99999-0000');
      setSimStatus('Tela simulada: Quiz');
      return;
    }
    await simulateResultScenario('winner_top1');
  };

  const simulateResultScenario = async (
    scenario: 'winner_top1' | 'winner_non_top3' | 'loser' | 'top3_modal' | 'incorrect_modal',
  ) => {
    const { engine, cloudGateway, clock, baseEventId } = simContext;
    await clearSimulatedMatches();

    if (scenario === 'winner_non_top3') {
      for (let i = 1; i <= 3; i += 1) {
        const matchId = `sim-top-${clock.now()}-${i}`;
        await cloudGateway.pushMatch({
          idempotencyKey: matchId,
          match: {
            id: matchId,
            eventId: baseEventId,
            totemId: 'sim-totem',
            participantName: `LÍDER ${i}`,
            participantPhone: `(61) 90000-000${i}`,
            score: 3,
            totalQuestions: 3,
            timeSeconds: 5 + i,
            answers: [],
            playedAt: clock.toISOString(),
          },
          prizeClaim: null,
        });
      }
      await engine.forceSync();
    }

    engine.wakeFromIdleScreen();
    const suffix = String(Math.floor(100 + (clock.now() % 900))).padStart(3, '0');
    const phone = `(61) 98${suffix}-9999`;
    await engine.startMatch('SIMULAÇÃO RESULTADO', phone);

    let step = 0;
    while (engine.getSnapshot().screen === 'quiz-screen') {
      const current = engine.getSnapshot().activeMatch?.currentQuestion;
      if (!current) break;
      const shouldPickCorrect =
        scenario === 'winner_top1' ||
        scenario === 'top3_modal' ||
        ((scenario === 'winner_non_top3' || scenario === 'incorrect_modal') && step < 2);
      const optionIdx = current.question.shuffledOptions.findIndex(
        (opt) => opt.isCorrect === shouldPickCorrect,
      );
      engine.submitAnswer(optionIdx >= 0 ? optionIdx : 0);
      await engine.advanceAfterAnswer();
      step += 1;
    }

    if (scenario === 'top3_modal') {
      setModalRequest({ type: 'top3', nonce: Date.now() });
    } else if (scenario === 'incorrect_modal') {
      setModalRequest({ type: 'incorrect', nonce: Date.now() });
    }
    setSimStatus(`Cenário simulado: ${scenario}`);
  };

  const simulateAlreadyWonModal = async () => {
    const { engine, localStore, baseEventId } = simContext;
    await localStore.savePrizeClaim({
      id: `sim-won-${Date.now()}`,
      eventId: baseEventId,
      matchId: `sim-match-${Date.now()}`,
      totemId: 'sim-totem',
      participantName: 'SIMULADO JÁ GANHOU',
      participantPhone: '(61) 99123-4567',
      status: 'delivered',
      awardedAt: new Date().toISOString(),
      deliveredAt: new Date().toISOString(),
    });
    engine.resetToInitialScreen();
    await engine.startMatch('SIMULADO JÁ GANHOU', '(61) 99123-4567');
    setSimStatus('Modal simulado: Já Ganhou Brinde');
  };

  const simulateTemporalState = async (
    state: 'before' | 'during' | 'after' | 'disabled',
  ) => {
    const now = Date.now();
    const hourMs = 3_600_000;
    if (state === 'before') {
      await resetSimulatedEvent({
        startTime: new Date(now + hourMs).toISOString(),
        endTime: new Date(now + 2 * hourMs).toISOString(),
        enableOutOfPeriodMessage: true,
      });
    } else if (state === 'during') {
      await resetSimulatedEvent({
        startTime: new Date(now - hourMs).toISOString(),
        endTime: new Date(now + hourMs).toISOString(),
        enableOutOfPeriodMessage: true,
      });
    } else if (state === 'after') {
      await resetSimulatedEvent({
        startTime: new Date(now - 2 * hourMs).toISOString(),
        endTime: new Date(now - hourMs).toISOString(),
        enableOutOfPeriodMessage: true,
      });
    } else {
      await resetSimulatedEvent({
        startTime: new Date(now + hourMs).toISOString(),
        endTime: new Date(now + 2 * hourMs).toISOString(),
        enableOutOfPeriodMessage: false,
      });
    }
    simContext.engine.resetToInitialScreen();
    setSimStatus(`Estado temporal simulado: ${state}`);
  };

  return (
    <div
      id="dev-simulator-window"
      className="modal-overlay dev-simulator-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dev-simulator-title"
    >
      <div className="modal-content admin-modal dev-simulator-shell">
        <div className="dev-simulator-header">
          <div>
            <h3 id="dev-simulator-title">Modo Desenvolvedor / Simulador Isolado</h3>
            <p className="admin-subtitle">
              Janela isolada em memória — nenhuma Partida ou Brinde simulado afeta métricas reais.
            </p>
          </div>
          <button type="button" className="admin-btn admin-btn-danger" onClick={onClose}>
            Fechar Simulador
          </button>
        </div>

        <div className="dev-simulator-controls">
          <div className="dev-sim-group">
            <strong>Telas:</strong>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => void simulateScreen('initial')}>
              Inicial
            </button>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => void simulateScreen('quiz')}>
              Quiz
            </button>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => void simulateScreen('result')}>
              Resultado
            </button>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => void simulateScreen('ranking')}>
              Ranking
            </button>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => void simulateScreen('idle')}>
              Descanso
            </button>
          </div>

          <div className="dev-sim-group">
            <strong>Modais e Cenários:</strong>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => void simulateAlreadyWonModal()}>
              Já Ganhou Brinde
            </button>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => void simulateResultScenario('top3_modal')}>
              Top 3
            </button>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => void simulateResultScenario('incorrect_modal')}>
              Gabarito de Erros
            </button>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => void simulateResultScenario('winner_top1')}>
              Ganhador #1
            </button>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => void simulateResultScenario('winner_non_top3')}>
              Ganhador Fora do Top 3
            </button>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => void simulateResultScenario('loser')}>
              Não Premiado
            </button>
          </div>

          <div className="dev-sim-group">
            <strong>Estados Temporais:</strong>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => void simulateTemporalState('before')}>
              Antes do Início
            </button>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => void simulateTemporalState('during')}>
              Durante
            </button>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => void simulateTemporalState('after')}>
              Após o Fim
            </button>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => void simulateTemporalState('disabled')}>
              Mensagens Desativadas
            </button>
          </div>
        </div>

        <small className="operator-card-meta">{simStatus}</small>

        <div className="dev-simulator-viewport">
          <TotemApp engine={simContext.engine} simulatorModalRequest={modalRequest} />
        </div>
      </div>
    </div>
  );
}
