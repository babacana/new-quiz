import { describe, expect, it } from 'vitest';
import { DexieLocalStore } from '../../adapters/dexieLocalStore';
import { InMemoryCloudGateway } from '../../adapters/inMemoryCloudGateway';
import { InMemoryLocalStore } from '../../adapters/inMemoryLocalStore';
import {
  DEFAULT_EVENT_CONFIG,
  DEFAULT_EVENT_ID,
  DEFAULT_QUIZ_QUESTIONS,
  TIMEOUT_OPTION_TEXT,
} from '../defaults';
import type { Clock, RandomSource } from '../ports';
import {
  TotemSessionEngine,
  formatPhoneMask,
  isValidBrazilPhone,
  normalizeParticipantName,
} from '../totemSessionEngine';
import type { DifficultyLevel, EventConfig, Question } from '../types';

class FakeClock implements Clock {
  private currentMs: number;

  constructor(initialIso = '2026-11-15T14:00:00.000Z') {
    this.currentMs = new Date(initialIso).getTime();
  }

  now(): number {
    return this.currentMs;
  }

  toISOString(ms?: number): string {
    return new Date(ms ?? this.currentMs).toISOString();
  }

  advanceMs(ms: number): void {
    this.currentMs += ms;
  }
}

class DeterministicRandomSource implements RandomSource {
  private state = 42;
  private uuidCounter = 0;
  private readonly prefix: string;

  constructor(prefix = '00000000') {
    this.prefix = prefix;
  }

  next(): number {
    this.state = (this.state * 1664525 + 1013904223) % 4294967296;
    return this.state / 4294967296;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const temp = copy[i];
      copy[i] = copy[j];
      copy[j] = temp;
    }
    return copy;
  }

  uuid(): string {
    this.uuidCounter += 1;
    return `${this.prefix}-0000-4000-8000-0000000000${String(this.uuidCounter).padStart(2, '0')}`;
  }
}

function createHarness(options?: {
  online?: boolean;
  event?: EventConfig;
  questions?: Question[];
}) {
  const clock = new FakeClock();
  const random = new DeterministicRandomSource();
  const localStore = new InMemoryLocalStore();
  const cloudGateway = new InMemoryCloudGateway({
    online: options?.online ?? true,
    seedDefaultEvent: false,
    nowIso: () => clock.toISOString(),
  });

  if (options?.event || options?.questions) {
    cloudGateway.seedEvent(
      options.event ?? DEFAULT_EVENT_CONFIG,
      options.questions ?? DEFAULT_QUIZ_QUESTIONS,
    );
  } else {
    cloudGateway.seedEvent(DEFAULT_EVENT_CONFIG, DEFAULT_QUIZ_QUESTIONS);
  }

  const engine = new TotemSessionEngine({
    localStore,
    cloudGateway,
    clock,
    random,
  });

  return { clock, random, localStore, cloudGateway, engine };
}

function buildQuestionPool(counts: {
  facil: number;
  moderado: number;
  dificil: number;
  disabledFacil?: number;
}): Question[] {
  const result: Question[] = [];
  let nextId = 1;

  const pushBatch = (difficulty: DifficultyLevel, qty: number, isDisabled = false) => {
    for (let i = 0; i < qty; i++) {
      const id = nextId++;
      result.push({
        id,
        text: `Pergunta ${difficulty} #${id}`,
        options: [`Opt A ${id}`, `Opt B ${id}`, `Opt C ${id}`, `Opt D ${id}`],
        correctIndex: id % 4,
        difficulty,
        tags: [difficulty],
        isDisabled,
      });
    }
  };

  pushBatch('facil', counts.facil);
  pushBatch('moderado', counts.moderado);
  pushBatch('dificil', counts.dificil);
  if (counts.disabledFacil) {
    pushBatch('facil', counts.disabledFacil, true);
  }
  return result;
}

describe('TotemSessionEngine', () => {
  describe('Fatia 1: Inicialização e hidratação Offline-First', () => {
    it('baixa Evento e Banco de Questões da nuvem quando online e salva no armazenamento local', async () => {
      const customEvent: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        name: 'FITABES 2026',
        configVersion: 3,
      };
      const { engine, localStore } = createHarness({
        online: true,
        event: customEvent,
      });

      const snapshot = await engine.initialize();

      expect(snapshot.initialized).toBe(true);
      expect(snapshot.screen).toBe('initial-screen');
      expect(snapshot.event.name).toBe('FITABES 2026');
      expect(snapshot.availableQuestionsCount).toBe(
        DEFAULT_QUIZ_QUESTIONS.filter((q) => !q.isDisabled).length,
      );

      const persistedConfig = await localStore.getTotemConfig();
      expect(persistedConfig?.event.name).toBe('FITABES 2026');
      const persistedQuestions = await localStore.getQuestions(DEFAULT_EVENT_ID);
      expect(persistedQuestions).toHaveLength(DEFAULT_QUIZ_QUESTIONS.length);
    });

    it('inicia normalmente usando snapshot local quando o Totem está offline', async () => {
      const { engine, localStore } = createHarness({ online: false });
      const offlineEvent: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        name: 'Evento em Cache Offline',
      };
      await localStore.saveTotemConfig({
        totemId: 'totem-1',
        deviceToken: 'tok-1',
        pinCode: '1234',
        event: offlineEvent,
      });
      await localStore.saveQuestions(DEFAULT_EVENT_ID, DEFAULT_QUIZ_QUESTIONS.slice(0, 4));

      const snapshot = await engine.initialize();

      expect(snapshot.initialized).toBe(true);
      expect(snapshot.isOnline).toBe(false);
      expect(snapshot.event.name).toBe('Evento em Cache Offline');
      expect(snapshot.availableQuestionsCount).toBe(4);
    });
  });

  describe('Fatia 2: Normalização de nome e validação/máscara de telefone', () => {
    it('normaliza o nome para letras maiúsculas removendo números e símbolos', () => {
      expect(normalizeParticipantName('joão da silva 123!@#')).toBe('JOÃO DA SILVA ');
      expect(normalizeParticipantName('Maria_Clara-99')).toBe('MARIACLARA');
      expect(normalizeParticipantName('Ana × Bruno ÷ Teste')).toBe('ANA  BRUNO  TESTE');
    });

    it('aplica máscara de telefone para celular (11 dígitos) e fixo (10 dígitos)', () => {
      expect(formatPhoneMask('61998765432')).toBe('(61) 99876-5432');
      expect(formatPhoneMask('6133224455')).toBe('(61) 3322-4455');
      expect(formatPhoneMask('619987')).toBe('(61) 9987');
      expect(formatPhoneMask('')).toBe('');
    });

    it('valida formato de telefone brasileiro com DDD', () => {
      expect(isValidBrazilPhone('(61) 99876-5432')).toBe(true);
      expect(isValidBrazilPhone('(61) 3322-4455')).toBe(true);
      expect(isValidBrazilPhone('61998765432')).toBe(false);
      expect(isValidBrazilPhone('(61) 9987-654')).toBe(false);
    });

    it('rejeita nome vazio ou telefone inválido ao tentar iniciar Partida', async () => {
      const { engine } = createHarness();
      await engine.initialize();

      const emptyNameResult = await engine.startMatch('   ', '(61) 99876-5432');
      expect(emptyNameResult.started).toBe(false);
      expect(emptyNameResult.errorMessage).toMatch(/nome/i);
      expect(emptyNameResult.snapshot.screen).toBe('initial-screen');

      const invalidPhoneResult = await engine.startMatch('ANA MARIA', '61998');
      expect(invalidPhoneResult.started).toBe(false);
      expect(invalidPhoneResult.errorMessage).toMatch(/telefone/i);
      expect(invalidPhoneResult.snapshot.screen).toBe('initial-screen');
    });
  });

  describe('Fatia 3: Sorteio proporcional por dificuldade, fallback e embaralhamento', () => {
    it('seleciona apenas questões ativas respeitando percentuais 40/40/20', async () => {
      const questions = buildQuestionPool({
        facil: 6,
        moderado: 6,
        dificil: 6,
        disabledFacil: 4,
      });
      const { engine } = createHarness({ questions });
      await engine.initialize();

      const startResult = await engine.startMatch('carlos souza', '(61) 99999-1234');
      expect(startResult.started).toBe(true);
      expect(startResult.snapshot.screen).toBe('quiz-screen');
      expect(startResult.snapshot.activeMatch?.participantName).toBe('CARLOS SOUZA');

      const prepared = engine.getPreparedQuestions();
      expect(prepared).toHaveLength(10);
      expect(prepared.every((q) => questions.find((orig) => orig.id === q.id && !orig.isDisabled))).toBe(true);

      const byDifficulty = prepared.reduce<Record<DifficultyLevel, number>>(
        (acc, q) => {
          acc[q.difficulty] += 1;
          return acc;
        },
        { facil: 0, moderado: 0, dificil: 0 },
      );
      expect(byDifficulty).toEqual({ facil: 4, moderado: 4, dificil: 2 });
    });

    it('completa com questões remanescentes quando falta estoque em uma faixa de dificuldade', async () => {
      const questions = buildQuestionPool({
        facil: 6,
        moderado: 6,
        dificil: 1,
      });
      const { engine } = createHarness({ questions });
      await engine.initialize();

      const startResult = await engine.startMatch('MARIA', '(61) 3333-4444');
      expect(startResult.started).toBe(true);

      const prepared = engine.getPreparedQuestions();
      expect(prepared).toHaveLength(10);
      expect(prepared.filter((q) => q.difficulty === 'dificil')).toHaveLength(1);
    });

    it('embaralha a ordem das questões e das 4 alternativas preservando o gabarito correto', async () => {
      const questions = buildQuestionPool({
        facil: 4,
        moderado: 4,
        dificil: 2,
      });
      const { engine } = createHarness({ questions });
      await engine.initialize();

      await engine.startMatch('JOÃO', '(61) 98888-7777');
      const prepared = engine.getPreparedQuestions();

      const originalOrder = questions.map((q) => q.id);
      const shuffledOrder = prepared.map((q) => q.id);
      expect(shuffledOrder).not.toEqual(originalOrder);

      let atLeastOneOptionOrderChanged = false;
      for (const pq of prepared) {
        const orig = questions.find((q) => q.id === pq.id)!;
        expect(pq.shuffledOptions).toHaveLength(4);
        const correctOptions = pq.shuffledOptions.filter((opt) => opt.isCorrect);
        expect(correctOptions).toHaveLength(1);
        expect(correctOptions[0].text).toBe(orig.options[orig.correctIndex]);

        const shuffledTexts = pq.shuffledOptions.map((o) => o.text);
        if (shuffledTexts.some((t, idx) => t !== orig.options[idx])) {
          atLeastOneOptionOrderChanged = true;
        }
      }
      expect(atLeastOneOptionOrderChanged).toBe(true);
    });

    it('recusa iniciar Partida quando não existem questões ativas no Evento', async () => {
      const disabledOnly = buildQuestionPool({
        facil: 0,
        moderado: 0,
        dificil: 0,
        disabledFacil: 3,
      });
      const { engine } = createHarness({ questions: disabledOnly });
      await engine.initialize();

      const result = await engine.startMatch('LUCAS', '(61) 98888-7777');
      expect(result.started).toBe(false);
      expect(result.errorMessage).toMatch(/questões/i);
      expect(result.snapshot.screen).toBe('initial-screen');
    });
  });

  describe('Fatia 4: Cronômetro regressivo, barra de tempo e alertas visuais', () => {
    it('calcula transição de cor verde -> amarelo aos 10s -> vermelho aos 5s e alertas configuráveis', async () => {
      const { engine } = createHarness();
      await engine.initialize();

      const state20s = engine.getQuestionTimeVisualState(20_000);
      expect(state20s.percentageRemaining).toBeCloseTo((20 / 30) * 100, 1);
      expect(state20s.barColor).toBe('hsl(120, 80%, 50%)');
      expect(state20s.phase).toBe('normal');
      expect(state20s.borderPulseState).toBe('none');
      expect(state20s.isFlashing).toBe(false);

      const state10s = engine.getQuestionTimeVisualState(10_000);
      expect(state10s.barColor).toBe('hsl(60, 80%, 50%)');
      expect(state10s.phase).toBe('warning');
      expect(state10s.borderPulseState).toBe('warning');
      expect(state10s.isFlashing).toBe(false);

      const state5s = engine.getQuestionTimeVisualState(5_000);
      expect(state5s.barColor).toBe('hsl(0, 80%, 50%)');
      expect(state5s.phase).toBe('critical');
      expect(state5s.borderPulseState).toBe('critical');
      expect(state5s.isFlashing).toBe(true);
    });

    it('respeita flags enableTimeAlertBorderPulse e enableTimeAlertFlash desabilitadas', async () => {
      const eventAlertsOff: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        settings: {
          ...DEFAULT_EVENT_CONFIG.settings,
          enableTimeAlertBorderPulse: false,
          enableTimeAlertFlash: false,
        },
      };
      const { engine } = createHarness({ event: eventAlertsOff });
      await engine.initialize();

      const state4s = engine.getQuestionTimeVisualState(4_000);
      expect(state4s.phase).toBe('critical');
      expect(state4s.barColor).toBe('hsl(0, 80%, 50%)');
      expect(state4s.borderPulseState).toBe('none');
      expect(state4s.isFlashing).toBe(false);
    });
  });

  describe('Fatia 5: Registro de Resposta, timeout, revelação condicional e avanço', () => {
    it('registra resposta correta, bloqueia nova seleção na mesma questão e avança com rótulo adequado', async () => {
      const event2Q: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        settings: { ...DEFAULT_EVENT_CONFIG.settings, numberOfQuestions: 2 },
      };
      const questions = buildQuestionPool({ facil: 2, moderado: 0, dificil: 0 });
      const { engine } = createHarness({ event: event2Q, questions });
      await engine.initialize();
      await engine.startMatch('MARIANA', '(61) 99123-4567');

      const firstQ = engine.getSnapshot().activeMatch!.currentQuestion!;
      const correctIdx = firstQ.question.shuffledOptions.findIndex((opt) => opt.isCorrect);

      const firstOutcome = engine.submitAnswer(correctIdx);
      expect(firstOutcome.accepted).toBe(true);
      expect(firstOutcome.isCorrect).toBe(true);
      expect(firstOutcome.isTimedOut).toBe(false);
      expect(firstOutcome.advanceButtonLabel).toBe('Próxima Pergunta');
      expect(firstOutcome.snapshot.activeMatch?.score).toBe(1);

      // Segunda seleção na mesma questão deve ser ignorada
      const duplicateAnswer = engine.submitAnswer((correctIdx + 1) % 4);
      expect(duplicateAnswer.accepted).toBe(false);
      expect(duplicateAnswer.snapshot.activeMatch?.score).toBe(1);

      // Avança para a 2ª (última) questão
      const afterAdvance = await engine.advanceAfterAnswer();
      expect(afterAdvance.activeMatch?.currentQuestion?.index).toBe(1);
      expect(afterAdvance.activeMatch?.currentQuestion?.advanceButtonLabel).toBe('Finalizar Quiz');
    });

    it('registra "Tempo esgotado" e revela gabarito somente quando showCorrectAnswerOnWrong está ativo', async () => {
      const eventHideAnswer: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        settings: {
          ...DEFAULT_EVENT_CONFIG.settings,
          numberOfQuestions: 2,
          showCorrectAnswerOnWrong: false,
        },
      };
      const questions = buildQuestionPool({ facil: 2, moderado: 0, dificil: 0 });

      const harnessShow = createHarness({
        event: {
          ...eventHideAnswer,
          settings: { ...eventHideAnswer.settings, showCorrectAnswerOnWrong: true },
        },
        questions,
      });
      await harnessShow.engine.initialize();
      await harnessShow.engine.startMatch('PAULO', '(61) 99123-4567');
      const timeoutShow = harnessShow.engine.handleQuestionTimeout();
      expect(timeoutShow.accepted).toBe(true);
      expect(timeoutShow.isTimedOut).toBe(true);
      expect(timeoutShow.isCorrect).toBe(false);
      expect(timeoutShow.revealedCorrectOptionIndex).not.toBeNull();
      expect(harnessShow.engine.getActiveAnswers()[0].selectedOptionText).toBe(
        TIMEOUT_OPTION_TEXT,
      );

      const harnessHide = createHarness({ event: eventHideAnswer, questions });
      await harnessHide.engine.initialize();
      await harnessHide.engine.startMatch('PAULO', '(61) 99123-4567');
      const firstQ = harnessHide.engine.getSnapshot().activeMatch!.currentQuestion!;
      const wrongIdx = firstQ.question.shuffledOptions.findIndex((opt) => !opt.isCorrect);
      const wrongOutcome = harnessHide.engine.submitAnswer(wrongIdx);
      expect(wrongOutcome.accepted).toBe(true);
      expect(wrongOutcome.isCorrect).toBe(false);
      expect(wrongOutcome.revealedCorrectOptionIndex).toBeNull();
    });
  });

  describe('Fatia 6: Tela de resultado, gabarito perfeito e "Onde Eu Errei?"', () => {
    it('finaliza Partida com 100% de acertos exibindo gabarito perfeito e ocultando "Onde Eu Errei?"', async () => {
      const event2Q: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        settings: {
          ...DEFAULT_EVENT_CONFIG.settings,
          numberOfQuestions: 2,
          minScoreForPrize: 2,
        },
      };
      const questions = buildQuestionPool({ facil: 2, moderado: 0, dificil: 0 });
      const { engine, clock } = createHarness({ event: event2Q, questions });
      await engine.initialize();
      await engine.startMatch('FERNANDA', '(61) 99988-7766');

      clock.advanceMs(12_000);
      const q1 = engine.getSnapshot().activeMatch!.currentQuestion!;
      engine.submitAnswer(q1.question.shuffledOptions.findIndex((o) => o.isCorrect));
      await engine.advanceAfterAnswer();

      clock.advanceMs(15_000);
      const q2 = engine.getSnapshot().activeMatch!.currentQuestion!;
      engine.submitAnswer(q2.question.shuffledOptions.findIndex((o) => o.isCorrect));
      const finalSnapshot = await engine.advanceAfterAnswer();

      expect(finalSnapshot.screen).toBe('result-screen');
      expect(finalSnapshot.activeMatch).toBeNull();
      expect(finalSnapshot.lastResult).not.toBeNull();
      expect(finalSnapshot.lastResult?.score).toBe(2);
      expect(finalSnapshot.lastResult?.totalQuestions).toBe(2);
      expect(finalSnapshot.lastResult?.timeSeconds).toBe(27);
      expect(finalSnapshot.lastResult?.wonPrize).toBe(true);
      expect(finalSnapshot.lastResult?.isPerfectScore).toBe(true);
      expect(finalSnapshot.lastResult?.canShowIncorrectAnswers).toBe(false);
      expect(finalSnapshot.lastResult?.incorrectAnswers).toEqual([]);

      const restarted = engine.resetToInitialScreen();
      expect(restarted.screen).toBe('initial-screen');
      expect(restarted.lastResult).toBeNull();
    });

    it('lista questões erradas e por timeout para o modal "Onde Eu Errei?"', async () => {
      const event3Q: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        settings: {
          ...DEFAULT_EVENT_CONFIG.settings,
          numberOfQuestions: 3,
          minScoreForPrize: 2,
        },
      };
      const questions = buildQuestionPool({ facil: 3, moderado: 0, dificil: 0 });
      const { engine, clock } = createHarness({ event: event3Q, questions });
      await engine.initialize();
      await engine.startMatch('RODRIGO', '(61) 98765-4321');

      // Q1: resposta errada
      clock.advanceMs(5_000);
      const q1 = engine.getSnapshot().activeMatch!.currentQuestion!;
      const wrongOption = q1.question.shuffledOptions.findIndex((o) => !o.isCorrect);
      const wrongText = q1.question.shuffledOptions[wrongOption].text;
      const correctTextQ1 = q1.question.shuffledOptions.find((o) => o.isCorrect)!.text;
      engine.submitAnswer(wrongOption);
      await engine.advanceAfterAnswer();

      // Q2: timeout
      clock.advanceMs(30_000);
      const q2 = engine.getSnapshot().activeMatch!.currentQuestion!;
      const correctTextQ2 = q2.question.shuffledOptions.find((o) => o.isCorrect)!.text;
      engine.handleQuestionTimeout();
      await engine.advanceAfterAnswer();

      // Q3: resposta correta
      clock.advanceMs(4_000);
      const q3 = engine.getSnapshot().activeMatch!.currentQuestion!;
      engine.submitAnswer(q3.question.shuffledOptions.findIndex((o) => o.isCorrect));
      const finalSnapshot = await engine.advanceAfterAnswer();

      expect(finalSnapshot.screen).toBe('result-screen');
      expect(finalSnapshot.lastResult?.score).toBe(1);
      expect(finalSnapshot.lastResult?.wonPrize).toBe(false);
      expect(finalSnapshot.lastResult?.isPerfectScore).toBe(false);
      expect(finalSnapshot.lastResult?.canShowIncorrectAnswers).toBe(true);
      expect(finalSnapshot.lastResult?.incorrectAnswers).toEqual([
        {
          questionId: q1.question.id,
          questionText: q1.question.text,
          selectedOptionText: wrongText,
          correctOptionText: correctTextQ1,
        },
        {
          questionId: q2.question.id,
          questionText: q2.question.text,
          selectedOptionText: TIMEOUT_OPTION_TEXT,
          correctOptionText: correctTextQ2,
        },
      ]);
    });
  });

  describe('Fatia 7: Operação Offline-First, syncQueue e sincronização idempotente', () => {
    it('grava Partida localmente na syncQueue quando offline e sincroniza ao reconectar sem duplicar', async () => {
      const event2Q: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        settings: { ...DEFAULT_EVENT_CONFIG.settings, numberOfQuestions: 2 },
      };
      const questions = buildQuestionPool({ facil: 2, moderado: 0, dificil: 0 });
      const { engine, localStore, cloudGateway, clock } = createHarness({
        online: true,
        event: event2Q,
        questions,
      });

      await engine.initialize();

      // Fica sem internet antes de iniciar e concluir a Partida
      cloudGateway.setOnline(false);
      await engine.startMatch('VISITANTE OFFLINE', '(61) 99999-0001');

      const q1 = engine.getSnapshot().activeMatch!.currentQuestion!;
      engine.submitAnswer(q1.question.shuffledOptions.findIndex((o) => o.isCorrect));
      await engine.advanceAfterAnswer();

      clock.advanceMs(10_000);
      const q2 = engine.getSnapshot().activeMatch!.currentQuestion!;
      engine.submitAnswer(q2.question.shuffledOptions.findIndex((o) => o.isCorrect));
      const offlineResultSnapshot = await engine.advanceAfterAnswer();

      expect(offlineResultSnapshot.screen).toBe('result-screen');
      expect(offlineResultSnapshot.isOnline).toBe(false);
      expect(offlineResultSnapshot.pendingSyncCount).toBe(1);

      const localMatches = await localStore.getMatches(DEFAULT_EVENT_ID);
      expect(localMatches).toHaveLength(1);

      const queueBeforeReconnect = await localStore.getSyncQueue();
      expect(queueBeforeReconnect).toHaveLength(1);
      const itemKey = queueBeforeReconnect[0].idempotencyKey;
      expect(itemKey).toBe(localMatches[0].id);
      expect(cloudGateway.getSyncedMatches(DEFAULT_EVENT_ID)).toHaveLength(0);

      // Reconecta e sincroniza
      cloudGateway.setOnline(true);
      const syncStats = await engine.syncPendingQueue();
      expect(syncStats).toEqual({ synced: 1, failed: 0, pending: 0 });
      expect(engine.getSnapshot().pendingSyncCount).toBe(0);
      expect(await localStore.getSyncQueue()).toHaveLength(0);
      expect(cloudGateway.getSyncedMatches(DEFAULT_EVENT_ID)).toHaveLength(1);

      // Reenvio com a mesma chave de idempotência não duplica a Partida na nuvem
      await cloudGateway.pushMatch({
        idempotencyKey: itemKey,
        match: localMatches[0],
      });
      expect(cloudGateway.getSyncedMatches(DEFAULT_EVENT_ID)).toHaveLength(1);
    });

    it('sincroniza automaticamente ao concluir uma Partida enquanto online', async () => {
      const event1Q: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        settings: { ...DEFAULT_EVENT_CONFIG.settings, numberOfQuestions: 1 },
      };
      const questions = buildQuestionPool({ facil: 1, moderado: 0, dificil: 0 });
      const { engine, cloudGateway, localStore } = createHarness({
        online: true,
        event: event1Q,
        questions,
      });

      await engine.initialize();
      await engine.startMatch('VISITANTE ONLINE', '(61) 98888-0002');
      const q1 = engine.getSnapshot().activeMatch!.currentQuestion!;
      engine.submitAnswer(q1.question.shuffledOptions.findIndex((o) => o.isCorrect));
      const snapshot = await engine.advanceAfterAnswer();

      expect(snapshot.pendingSyncCount).toBe(0);
      expect(await localStore.getSyncQueue()).toHaveLength(0);
      expect(cloudGateway.getSyncedMatches(DEFAULT_EVENT_ID)).toHaveLength(1);
    });

    it('drena fila persistida no DexieLocalStore ao reinicializar com conexão restaurada', async () => {
      const dbName = `TotemEngine_Dexie_${Date.now()}_${Math.random()}`;
      const dexieStore1 = new DexieLocalStore(dbName);
      const clock = new FakeClock();
      const random = new DeterministicRandomSource();
      const cloudGateway = new InMemoryCloudGateway({
        online: false,
        seedDefaultEvent: false,
        nowIso: () => clock.toISOString(),
      });
      const event1Q: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        settings: { ...DEFAULT_EVENT_CONFIG.settings, numberOfQuestions: 1 },
      };
      cloudGateway.seedEvent(event1Q, buildQuestionPool({ facil: 1, moderado: 0, dificil: 0 }));

      // Semeia no Dexie como se já tivesse feito cache antes da queda de rede
      await dexieStore1.saveTotemConfig({
        totemId: 'totem-dexie',
        deviceToken: null,
        pinCode: '0000',
        event: event1Q,
      });
      await dexieStore1.saveQuestions(
        event1Q.id,
        buildQuestionPool({ facil: 1, moderado: 0, dificil: 0 }),
      );

      const engine1 = new TotemSessionEngine({
        localStore: dexieStore1,
        cloudGateway,
        clock,
        random,
      });
      await engine1.initialize();
      await engine1.startMatch('PARTIDA OFFLINE', '(61) 99999-1111');
      const q1 = engine1.getSnapshot().activeMatch!.currentQuestion!;
      engine1.submitAnswer(q1.question.shuffledOptions.findIndex((o) => o.isCorrect));
      const snap1 = await engine1.advanceAfterAnswer();
      expect(snap1.pendingSyncCount).toBe(1);
      await dexieStore1.close();

      // Nova instância após reinicialização do navegador com internet restaurada
      cloudGateway.setOnline(true);
      const dexieStore2 = new DexieLocalStore(dbName);
      const engine2 = new TotemSessionEngine({
        localStore: dexieStore2,
        cloudGateway,
        clock,
        random,
      });
      const snap2 = await engine2.initialize();

      expect(snap2.pendingSyncCount).toBe(0);
      expect(cloudGateway.getSyncedMatches(event1Q.id)).toHaveLength(1);
      await dexieStore2.close();
    });

    it('impede duplicação de Partida quando advanceAfterAnswer é acionado duas vezes em paralelo', async () => {
      const event1Q: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        settings: { ...DEFAULT_EVENT_CONFIG.settings, numberOfQuestions: 1 },
      };
      const questions = buildQuestionPool({ facil: 1, moderado: 0, dificil: 0 });
      const { engine, cloudGateway, localStore } = createHarness({
        online: true,
        event: event1Q,
        questions,
      });

      await engine.initialize();
      await engine.startMatch('DUPLO TOQUE', '(61) 99999-3333');
      const q1 = engine.getSnapshot().activeMatch!.currentQuestion!;
      engine.submitAnswer(q1.question.shuffledOptions.findIndex((o) => o.isCorrect));

      await Promise.all([engine.advanceAfterAnswer(), engine.advanceAfterAnswer()]);

      expect(await localStore.getMatches(DEFAULT_EVENT_ID)).toHaveLength(1);
      expect(cloudGateway.getSyncedMatches(DEFAULT_EVENT_ID)).toHaveLength(1);
    });
  });

  describe('Fatia 8: Janela temporal do Evento e bloqueio fora do período', () => {
    it('retorna no_event quando datas do Evento estão ausentes ou inválidas e during dentro da janela', async () => {
      const noDatesHarness = createHarness();
      await noDatesHarness.engine.initialize();
      const noDatesWindow = noDatesHarness.engine.getEventWindowState();

      expect(noDatesWindow).toEqual({
        status: 'no_event',
        isBlocked: false,
        idleCallToActionTitle: 'TOQUE PARA COMEÇAR',
        idleCallToActionSubtitle: null,
        initialScreenMessage: null,
      });
      expect(noDatesHarness.engine.getSnapshot().eventWindow).toEqual(noDatesWindow);

      const invalidDateEvent: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        startTime: 'data-invalida',
        endTime: '2026-11-15T18:00:00.000Z',
        enableOutOfPeriodMessage: true,
      };
      const invalidHarness = createHarness({ event: invalidDateEvent });
      await invalidHarness.engine.initialize();
      expect(invalidHarness.engine.getEventWindowState().status).toBe('no_event');
      expect(invalidHarness.engine.getEventWindowState().isBlocked).toBe(false);

      const duringEvent: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        startTime: '2026-11-15T12:00:00.000Z',
        endTime: '2026-11-15T18:00:00.000Z',
        enableOutOfPeriodMessage: true,
      };
      const duringHarness = createHarness({ event: duringEvent });
      await duringHarness.engine.initialize();
      expect(duringHarness.engine.getEventWindowState()).toEqual({
        status: 'during',
        isBlocked: false,
        idleCallToActionTitle: 'TOQUE PARA COMEÇAR',
        idleCallToActionSubtitle: null,
        initialScreenMessage: null,
      });
    });

    it('mantém status before/after sem bloquear quando enableOutOfPeriodMessage está desabilitado', async () => {
      const beforeUnblockedEvent: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        startTime: '2026-11-15T16:00:00.000Z',
        endTime: '2026-11-15T18:00:00.000Z',
        enableOutOfPeriodMessage: false,
      };
      const { engine, clock } = createHarness({ event: beforeUnblockedEvent });
      await engine.initialize();

      expect(engine.getEventWindowState()).toEqual({
        status: 'before',
        isBlocked: false,
        idleCallToActionTitle: 'TOQUE PARA COMEÇAR',
        idleCallToActionSubtitle: null,
        initialScreenMessage: null,
      });

      clock.advanceMs(5 * 60 * 60 * 1000); // 19:00 UTC -> após endTime
      expect(engine.getEventWindowState()).toEqual({
        status: 'after',
        isBlocked: false,
        idleCallToActionTitle: 'TOQUE PARA COMEÇAR',
        idleCallToActionSubtitle: null,
        initialScreenMessage: null,
      });
    });

    it('bloqueia e fornece mensagens pt-BR na Tela de Descanso e tela inicial para before e after com aviso habilitado', async () => {
      const scheduledEvent: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        name: 'FITABES 2026',
        startTime: '2026-11-15T16:30:00',
        endTime: '2026-11-15T18:45:00',
        enableOutOfPeriodMessage: true,
      };
      const clock = new FakeClock('2026-11-15T15:00:00');
      const random = new DeterministicRandomSource();
      const localStore = new InMemoryLocalStore();
      const cloudGateway = new InMemoryCloudGateway({
        online: true,
        seedDefaultEvent: false,
        nowIso: () => clock.toISOString(),
      });
      cloudGateway.seedEvent(scheduledEvent, DEFAULT_QUIZ_QUESTIONS);

      const engine = new TotemSessionEngine({
        localStore,
        cloudGateway,
        clock,
        random,
      });
      await engine.initialize();

      const beforeState = engine.getEventWindowState();
      expect(beforeState).toEqual({
        status: 'before',
        isBlocked: true,
        idleCallToActionTitle: 'QUIZ EM BREVE!',
        idleCallToActionSubtitle: 'Toque para mais informações',
        initialScreenMessage:
          'O quiz "FITABES 2026" ainda não começou! Prepare-se, a diversão começa em 15/11/2026, 16:30.',
      });

      clock.advanceMs(4 * 60 * 60 * 1000); // 19:00 local -> após endTime
      const afterState = engine.getEventWindowState();
      expect(afterState).toEqual({
        status: 'after',
        isBlocked: true,
        idleCallToActionTitle: 'QUIZ ENCERRADO',
        idleCallToActionSubtitle: 'Obrigado por participar!',
        initialScreenMessage:
          'O quiz "FITABES 2026" foi encerrado em 15/11/2026, 18:45. Obrigado pela participação!',
      });
      expect(engine.getSnapshot().eventWindow).toEqual(afterState);
    });

    it('recusa iniciar Partida fora do período quando isBlocked é true e permite quando dentro ou desabilitado', async () => {
      const scheduledEvent: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        name: 'FITABES 2026',
        startTime: '2026-11-15T16:30:00',
        endTime: '2026-11-15T18:45:00',
        enableOutOfPeriodMessage: true,
      };
      const clock = new FakeClock('2026-11-15T15:00:00');
      const random = new DeterministicRandomSource();
      const localStore = new InMemoryLocalStore();
      const cloudGateway = new InMemoryCloudGateway({
        online: true,
        seedDefaultEvent: false,
        nowIso: () => clock.toISOString(),
      });
      cloudGateway.seedEvent(scheduledEvent, DEFAULT_QUIZ_QUESTIONS);

      const engine = new TotemSessionEngine({
        localStore,
        cloudGateway,
        clock,
        random,
      });
      await engine.initialize();

      const blockedBefore = await engine.startMatch('MARIA', '(61) 99876-5432');
      expect(blockedBefore.started).toBe(false);
      expect(blockedBefore.errorMessage).toBe(
        'O quiz "FITABES 2026" ainda não começou! Prepare-se, a diversão começa em 15/11/2026, 16:30.',
      );
      expect(blockedBefore.snapshot.lastValidationError).toBe(blockedBefore.errorMessage);
      expect(blockedBefore.snapshot.activeMatch).toBeNull();
      expect(blockedBefore.snapshot.screen).toBe('initial-screen');

      // Avança para após o término
      clock.advanceMs(4 * 60 * 60 * 1000);
      const blockedAfter = await engine.startMatch('JOÃO', '(61) 99876-5432');
      expect(blockedAfter.started).toBe(false);
      expect(blockedAfter.errorMessage).toBe(
        'O quiz "FITABES 2026" foi encerrado em 15/11/2026, 18:45. Obrigado pela participação!',
      );
      expect(blockedAfter.snapshot.lastValidationError).toBe(blockedAfter.errorMessage);

      // Com bloqueio desabilitado fora do período, a Partida é permitida
      const unblockedHarness = createHarness({
        event: { ...scheduledEvent, enableOutOfPeriodMessage: false },
      });
      await unblockedHarness.engine.initialize();
      const allowed = await unblockedHarness.engine.startMatch('LUCAS', '(61) 99876-5432');
      expect(allowed.started).toBe(true);
    });
  });

  describe('Fatia 9: Configuração de inatividade e transições da Tela de Descanso', () => {
    it('calcula tempos de inatividade e fade-out em ms aplicando validações e fallbacks', async () => {
      // Valores padrão (60s / 5s)
      const defaultHarness = createHarness();
      await defaultHarness.engine.initialize();
      expect(defaultHarness.engine.getIdleTimingConfig()).toEqual({
        idleTimeoutMs: 60_000,
        fadeOutLeadMs: 5_000,
        fadeOutStartMs: 55_000,
      });

      // Valores customizados válidos (20s / 3s)
      const validCustomHarness = createHarness({
        event: {
          ...DEFAULT_EVENT_CONFIG,
          settings: {
            ...DEFAULT_EVENT_CONFIG.settings,
            idleTimeoutSeconds: 20,
            fadeOutLeadTimeSeconds: 3,
          },
        },
      });
      await validCustomHarness.engine.initialize();
      expect(validCustomHarness.engine.getIdleTimingConfig()).toEqual({
        idleTimeoutMs: 20_000,
        fadeOutLeadMs: 3_000,
        fadeOutStartMs: 17_000,
      });

      // idleTimeoutSeconds < 15 cai no fallback 60s; fadeOutLeadTimeSeconds >= idle cai no default 5s
      const invalidHarness = createHarness({
        event: {
          ...DEFAULT_EVENT_CONFIG,
          settings: {
            ...DEFAULT_EVENT_CONFIG.settings,
            idleTimeoutSeconds: 10,
            fadeOutLeadTimeSeconds: 70,
          },
        },
      });
      await invalidHarness.engine.initialize();
      expect(invalidHarness.engine.getIdleTimingConfig()).toEqual({
        idleTimeoutMs: 60_000,
        fadeOutLeadMs: 5_000,
        fadeOutStartMs: 55_000,
      });

      // fadeOutLeadTimeSeconds >= idleTimeoutSeconds válido (20s / 25s) usa default 5s; < 3s também usa default 5s
      const highFadeHarness = createHarness({
        event: {
          ...DEFAULT_EVENT_CONFIG,
          settings: {
            ...DEFAULT_EVENT_CONFIG.settings,
            idleTimeoutSeconds: 20,
            fadeOutLeadTimeSeconds: 25,
          },
        },
      });
      await highFadeHarness.engine.initialize();
      expect(highFadeHarness.engine.getIdleTimingConfig()).toEqual({
        idleTimeoutMs: 20_000,
        fadeOutLeadMs: 5_000,
        fadeOutStartMs: 15_000,
      });

      const lowFadeHarness = createHarness({
        event: {
          ...DEFAULT_EVENT_CONFIG,
          settings: {
            ...DEFAULT_EVENT_CONFIG.settings,
            idleTimeoutSeconds: 18,
            fadeOutLeadTimeSeconds: 1,
          },
        },
      });
      await lowFadeHarness.engine.initialize();
      const lowFadeConfig = lowFadeHarness.engine.getIdleTimingConfig();
      expect(lowFadeConfig.idleTimeoutMs).toBe(18_000);
      expect(lowFadeConfig.fadeOutLeadMs).toBe(5_000);
      expect(lowFadeConfig.fadeOutStartMs).toBe(13_000);
    });

    it('enterIdleScreen cancela Partida em andamento sem persistir e limpa resultados/erros; wakeFromIdleScreen desperta para initial-screen', async () => {
      const event1Q: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        settings: { ...DEFAULT_EVENT_CONFIG.settings, numberOfQuestions: 1 },
      };
      const questions = buildQuestionPool({ facil: 1, moderado: 0, dificil: 0 });
      const { engine, localStore } = createHarness({ event: event1Q, questions });
      await engine.initialize();

      // Caso 1: Partida em andamento abandonada por inatividade
      await engine.startMatch('VISITANTE INATIVO', '(61) 99999-1234');
      expect(engine.getSnapshot().screen).toBe('quiz-screen');
      expect(engine.getSnapshot().activeMatch).not.toBeNull();

      // wakeFromIdleScreen fora da idle-screen não interrompe a Partida ativa
      const stillInQuiz = engine.wakeFromIdleScreen();
      expect(stillInQuiz.screen).toBe('quiz-screen');
      expect(stillInQuiz.activeMatch).not.toBeNull();

      const idleFromQuiz = engine.enterIdleScreen();
      expect(idleFromQuiz.screen).toBe('idle-screen');
      expect(idleFromQuiz.activeMatch).toBeNull();
      expect(idleFromQuiz.lastResult).toBeNull();
      expect(idleFromQuiz.lastValidationError).toBeNull();
      expect(engine.getPreparedQuestions()).toEqual([]);
      expect(engine.getActiveAnswers()).toEqual([]);
      expect(await localStore.getMatches(DEFAULT_EVENT_ID)).toHaveLength(0);
      expect(await localStore.getSyncQueue()).toHaveLength(0);

      // Despertar da Tela de Descanso leva à tela inicial com estado limpo
      const wokenFromQuiz = engine.wakeFromIdleScreen();
      expect(wokenFromQuiz.screen).toBe('initial-screen');
      expect(wokenFromQuiz.activeMatch).toBeNull();
      expect(wokenFromQuiz.lastResult).toBeNull();
      expect(wokenFromQuiz.lastValidationError).toBeNull();

      // Caso 2: Erro de validação na initial-screen é limpo ao entrar em idle-screen
      await engine.startMatch('', '(61) 99999-1234');
      expect(engine.getSnapshot().lastValidationError).not.toBeNull();
      const idleFromError = engine.enterIdleScreen();
      expect(idleFromError.screen).toBe('idle-screen');
      expect(idleFromError.lastValidationError).toBeNull();
      expect(engine.wakeFromIdleScreen().screen).toBe('initial-screen');

      // Caso 3: lastResult da result-screen é limpo ao entrar em idle-screen
      await engine.startMatch('MARINA', '(61) 98888-7777');
      const q1 = engine.getSnapshot().activeMatch!.currentQuestion!;
      engine.submitAnswer(q1.question.shuffledOptions.findIndex((o) => o.isCorrect));
      const resultSnap = await engine.advanceAfterAnswer();
      expect(resultSnap.screen).toBe('result-screen');
      expect(resultSnap.lastResult).not.toBeNull();

      const idleFromResult = engine.enterIdleScreen();
      expect(idleFromResult.screen).toBe('idle-screen');
      expect(idleFromResult.lastResult).toBeNull();
      expect(idleFromResult.activeMatch).toBeNull();
      expect(engine.wakeFromIdleScreen().screen).toBe('initial-screen');
    });
  });

  describe('Fatia 10: Elegibilidade ao Brinde (Entregue vs. Aguardando Retirada) e Estoque', () => {
    it('registra Brinde como delivered quando confirmação manual está desabilitada e decrementa estoque', async () => {
      const eventImmediate: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        prizeStockRemaining: 2,
        settings: {
          ...DEFAULT_EVENT_CONFIG.settings,
          numberOfQuestions: 1,
          minScoreForPrize: 1,
          requireManualPrizeConfirmation: false,
          prizeStockLimit: 2,
        },
      };
      const questions = buildQuestionPool({ facil: 1, moderado: 0, dificil: 0 });
      const { engine, localStore, cloudGateway } = createHarness({
        event: eventImmediate,
        questions,
      });

      await engine.initialize();
      await engine.startMatch('MARCOS', '(61) 99999-1000');
      const q1 = engine.getSnapshot().activeMatch!.currentQuestion!;
      engine.submitAnswer(q1.question.shuffledOptions.findIndex((o) => o.isCorrect));
      const snap = await engine.advanceAfterAnswer();

      expect(snap.lastResult?.wonPrize).toBe(true);
      expect(snap.lastResult?.prizeStatus).toBe('delivered');
      expect(snap.event.prizeStockRemaining).toBe(1);

      const localClaims = await localStore.getPrizeClaims(DEFAULT_EVENT_ID);
      expect(localClaims).toHaveLength(1);
      expect(localClaims[0].status).toBe('delivered');
      expect(localClaims[0].deliveredAt).not.toBeNull();
      expect(cloudGateway.getActivePrizeClaims(DEFAULT_EVENT_ID)).toHaveLength(1);
    });

    it('registra Brinde como awaiting_pickup quando confirmação manual está habilitada e bloqueia ao zerar estoque', async () => {
      const eventManual: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        prizeStockRemaining: 1,
        settings: {
          ...DEFAULT_EVENT_CONFIG.settings,
          numberOfQuestions: 1,
          minScoreForPrize: 1,
          requireManualPrizeConfirmation: true,
          prizeStockLimit: 1,
        },
      };
      const questions = buildQuestionPool({ facil: 1, moderado: 0, dificil: 0 });
      const { engine, localStore } = createHarness({
        event: eventManual,
        questions,
      });

      await engine.initialize();
      await engine.startMatch('JULIA', '(61) 99999-2001');
      const q1 = engine.getSnapshot().activeMatch!.currentQuestion!;
      engine.submitAnswer(q1.question.shuffledOptions.findIndex((o) => o.isCorrect));
      const firstWinner = await engine.advanceAfterAnswer();

      expect(firstWinner.lastResult?.wonPrize).toBe(true);
      expect(firstWinner.lastResult?.prizeStatus).toBe('awaiting_pickup');
      expect(firstWinner.event.prizeStockRemaining).toBe(0);
      const localClaims = await localStore.getPrizeClaims(DEFAULT_EVENT_ID);
      expect(localClaims[0].status).toBe('awaiting_pickup');
      expect(localClaims[0].deliveredAt).toBeNull();

      // Segundo visitante acerta com estoque esgotado -> não recebe Brinde
      engine.resetToInitialScreen();
      await engine.startMatch('BRUNO', '(61) 99999-2002');
      const q2 = engine.getSnapshot().activeMatch!.currentQuestion!;
      engine.submitAnswer(q2.question.shuffledOptions.findIndex((o) => o.isCorrect));
      const outOfStockSnap = await engine.advanceAfterAnswer();

      expect(outOfStockSnap.lastResult?.wonPrize).toBe(false);
      expect(outOfStockSnap.lastResult?.prizeStatus).toBeNull();
      expect(await localStore.getPrizeClaims(DEFAULT_EVENT_ID)).toHaveLength(1);
    });
  });

  describe('Fatia 11: Trava de Brinde por telefone no Evento', () => {
    it('bloqueia novo início quando telefone já conquistou Brinde no Evento e informa timestamp anterior', async () => {
      const eventLocked: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        settings: {
          ...DEFAULT_EVENT_CONFIG.settings,
          numberOfQuestions: 1,
          minScoreForPrize: 1,
          enablePrizeLock: true,
        },
      };
      const questions = buildQuestionPool({ facil: 1, moderado: 0, dificil: 0 });
      const { engine, clock } = createHarness({ event: eventLocked, questions });
      await engine.initialize();

      // 1ª Partida vencedora
      await engine.startMatch('CARLA', '(61) 99777-8888');
      const q1 = engine.getSnapshot().activeMatch!.currentQuestion!;
      engine.submitAnswer(q1.question.shuffledOptions.findIndex((o) => o.isCorrect));
      const firstResult = await engine.advanceAfterAnswer();
      expect(firstResult.lastResult?.wonPrize).toBe(true);
      const firstAwardedAt = clock.toISOString();

      // Tenta jogar novamente com o mesmo telefone
      clock.advanceMs(10 * 60 * 1000);
      engine.resetToInitialScreen();
      const blockedResult = await engine.startMatch('CARLA OUTRO NOME', '(61) 99777-8888');

      expect(blockedResult.started).toBe(false);
      expect(blockedResult.alreadyWonPrizeAt).toBe(firstAwardedAt);
      expect(blockedResult.snapshot.screen).toBe('initial-screen');
      expect(blockedResult.snapshot.alreadyWonModal).toEqual({
        participantPhone: '(61) 99777-8888',
        awardedAt: firstAwardedAt,
      });

      const dismissed = engine.dismissAlreadyWonModal();
      expect(dismissed.alreadyWonModal).toBeNull();
    });

    it('permite jogar novamente quando enablePrizeLock está desabilitada ou quando Brinde foi revogado', async () => {
      const eventUnlocked: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        settings: {
          ...DEFAULT_EVENT_CONFIG.settings,
          numberOfQuestions: 1,
          minScoreForPrize: 1,
          enablePrizeLock: false,
        },
      };
      const questions = buildQuestionPool({ facil: 1, moderado: 0, dificil: 0 });
      const { engine } = createHarness({ event: eventUnlocked, questions });
      await engine.initialize();

      await engine.startMatch('CARLA', '(61) 99777-8888');
      const q1 = engine.getSnapshot().activeMatch!.currentQuestion!;
      engine.submitAnswer(q1.question.shuffledOptions.findIndex((o) => o.isCorrect));
      await engine.advanceAfterAnswer();

      engine.resetToInitialScreen();
      const secondAttempt = await engine.startMatch('CARLA', '(61) 99777-8888');
      expect(secondAttempt.started).toBe(true);

      // Com trava habilitada mas Brinde revogado, também permite jogar novamente
      const revokedHarness = createHarness({
        event: {
          ...eventUnlocked,
          settings: { ...eventUnlocked.settings, enablePrizeLock: true },
        },
        questions,
      });
      await revokedHarness.localStore.savePrizeClaim({
        id: 'revoked-claim-1',
        eventId: DEFAULT_EVENT_ID,
        matchId: 'old-match-1',
        totemId: null,
        participantName: 'CARLA',
        participantPhone: '(61) 99777-8888',
        status: 'revoked',
        awardedAt: '2026-11-15T12:00:00.000Z',
        deliveredAt: null,
      });
      await revokedHarness.engine.initialize();
      const afterRevoke = await revokedHarness.engine.startMatch('CARLA', '(61) 99777-8888');
      expect(afterRevoke.started).toBe(true);
    });
  });

  describe('Fatia 12: Desistência (giveUpMatch) e Bloqueio por Desistência', () => {
    it('descarta Partida na desistência, cria bloqueio temporário sincronizável e libera após expirar', async () => {
      const eventWithLockout: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        settings: {
          ...DEFAULT_EVENT_CONFIG.settings,
          numberOfQuestions: 2,
          giveUpLockoutMinutes: 5,
        },
      };
      const questions = buildQuestionPool({ facil: 2, moderado: 0, dificil: 0 });
      const { engine, localStore, cloudGateway, clock } = createHarness({
        online: true,
        event: eventWithLockout,
        questions,
      });

      await engine.initialize();
      cloudGateway.setOnline(false);
      await engine.startMatch('GABRIEL', '(61) 99111-2222');
      const q1 = engine.getSnapshot().activeMatch!.currentQuestion!;
      engine.submitAnswer(q1.question.shuffledOptions.findIndex((o) => o.isCorrect));

      const afterGiveUp = await engine.giveUpMatch();
      expect(afterGiveUp.screen).toBe('initial-screen');
      expect(afterGiveUp.activeMatch).toBeNull();
      expect(await localStore.getMatches(DEFAULT_EVENT_ID)).toHaveLength(0);
      expect(await localStore.getLockouts(DEFAULT_EVENT_ID)).toHaveLength(1);
      expect(afterGiveUp.pendingSyncCount).toBe(1);

      // Tenta iniciar após 2 minutos -> ainda bloqueado com 3 minuto(s) restantes
      clock.advanceMs(2 * 60 * 1000);
      const blocked = await engine.startMatch('GABRIEL', '(61) 99111-2222');
      expect(blocked.started).toBe(false);
      expect(blocked.lockoutRemainingMinutes).toBe(3);
      expect(blocked.errorMessage).toContain('3 minuto(s)');

      // Reconecta e sincroniza o bloqueio para a nuvem
      cloudGateway.setOnline(true);
      await engine.syncPendingQueue();
      expect(cloudGateway.getLockouts(DEFAULT_EVENT_ID)).toHaveLength(1);

      // Avança mais 3 minutos e 1 segundo -> bloqueio expirado, pode jogar
      clock.advanceMs(3 * 60 * 1000 + 1000);
      const allowed = await engine.startMatch('GABRIEL', '(61) 99111-2222');
      expect(allowed.started).toBe(true);
    });

    it('descarta Partida sem criar bloqueio quando giveUpLockoutMinutes é zero', async () => {
      const eventNoLockout: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        settings: { ...DEFAULT_EVENT_CONFIG.settings, giveUpLockoutMinutes: 0 },
      };
      const { engine, localStore } = createHarness({ event: eventNoLockout });
      await engine.initialize();
      await engine.startMatch('LARISSA', '(61) 99222-3333');

      const snap = await engine.giveUpMatch();
      expect(snap.screen).toBe('initial-screen');
      expect(await localStore.getLockouts(DEFAULT_EVENT_ID)).toHaveLength(0);
      expect((await engine.startMatch('LARISSA', '(61) 99222-3333')).started).toBe(true);
    });
  });

  describe('Fatia 13: Ranking Geral do Evento e celebração Top 3', () => {
    it('ordena Ranking por maior pontuação, menor tempo e playedAt respeitando rankingDisplayCount e identificando Top 3', async () => {
      const eventRanking: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        settings: {
          ...DEFAULT_EVENT_CONFIG.settings,
          numberOfQuestions: 2,
          minScoreForPrize: 2,
          rankingDisplayCount: 3,
          enablePrizeLock: false,
        },
      };
      const questions = buildQuestionPool({ facil: 2, moderado: 0, dificil: 0 });
      const { engine, clock, localStore } = createHarness({
        event: eventRanking,
        questions,
      });

      // Semeia 3 Partidas anteriores no armazenamento local antes de inicializar
      await localStore.saveMatch({
        id: 'm-1',
        eventId: DEFAULT_EVENT_ID,
        totemId: null,
        participantName: 'ANA',
        participantPhone: '(61) 91111-1111',
        score: 2,
        totalQuestions: 2,
        timeSeconds: 20,
        answers: [],
        playedAt: '2026-11-15T10:00:00.000Z',
      });
      await localStore.saveMatch({
        id: 'm-2',
        eventId: DEFAULT_EVENT_ID,
        totemId: null,
        participantName: 'BRUNO',
        participantPhone: '(61) 92222-2222',
        score: 1,
        totalQuestions: 2,
        timeSeconds: 10,
        answers: [],
        playedAt: '2026-11-15T10:05:00.000Z',
      });
      await localStore.saveMatch({
        id: 'm-3',
        eventId: DEFAULT_EVENT_ID,
        totemId: null,
        participantName: 'CAIO',
        participantPhone: '(61) 93333-3333',
        score: 2,
        totalQuestions: 2,
        timeSeconds: 15,
        answers: [],
        playedAt: '2026-11-15T10:10:00.000Z',
      });

      await engine.initialize();

      // Novo participante joga e acerta 2 em 12s -> deve assumir 1º lugar (Top 1)
      await engine.startMatch('DANIELA', '(61) 94444-4444');
      clock.advanceMs(6_000);
      let q = engine.getSnapshot().activeMatch!.currentQuestion!;
      engine.submitAnswer(q.question.shuffledOptions.findIndex((o) => o.isCorrect));
      await engine.advanceAfterAnswer();

      clock.advanceMs(6_000);
      q = engine.getSnapshot().activeMatch!.currentQuestion!;
      engine.submitAnswer(q.question.shuffledOptions.findIndex((o) => o.isCorrect));
      const resultSnap = await engine.advanceAfterAnswer();

      expect(resultSnap.lastResult?.rankingPosition).toBe(1);
      expect(resultSnap.lastResult?.isTop3).toBe(true);

      // Abre tela de Ranking e valida limite rankingDisplayCount = 3 e ordem (DANIELA 12s, CAIO 15s, ANA 20s)
      const rankingSnap = await engine.openRankingScreen();
      expect(rankingSnap.screen).toBe('ranking-screen');
      expect(rankingSnap.ranking).toHaveLength(3);
      expect(rankingSnap.ranking.map((r) => `${r.position}:${r.participantName}:${r.score}:${r.timeSeconds}`)).toEqual([
        '1:DANIELA:2:12',
        '2:CAIO:2:15',
        '3:ANA:2:20',
      ]);

      // Novo participante acerta apenas 1 em 30s -> fica fora do Top 3 (5º lugar)
      engine.resetToInitialScreen();
      await engine.startMatch('EDUARDO', '(61) 95555-5555');
      clock.advanceMs(30_000);
      q = engine.getSnapshot().activeMatch!.currentQuestion!;
      engine.submitAnswer(q.question.shuffledOptions.findIndex((o) => o.isCorrect));
      await engine.advanceAfterAnswer();
      q = engine.getSnapshot().activeMatch!.currentQuestion!;
      engine.submitAnswer(q.question.shuffledOptions.findIndex((o) => !o.isCorrect));
      const fifthResult = await engine.advanceAfterAnswer();

      expect(fifthResult.lastResult?.rankingPosition).toBe(5);
      expect(fifthResult.lastResult?.isTop3).toBe(false);
    });
  });

  describe('Fatia 14: Conflito de Premiação Offline entre dois Totens', () => {
    it('preserva ambas as Partidas, mantém 1 Brinde ativo, não consome estoque dobrado e marca excedente como offline_duplicate_conflict', async () => {
      const eventMultiTotem: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        prizeStockRemaining: 5,
        settings: {
          ...DEFAULT_EVENT_CONFIG.settings,
          numberOfQuestions: 1,
          minScoreForPrize: 1,
          enablePrizeLock: true,
          requireManualPrizeConfirmation: false,
          prizeStockLimit: 5,
        },
      };
      const questions = buildQuestionPool({ facil: 1, moderado: 0, dificil: 0 });
      const clock = new FakeClock('2026-11-15T14:00:00.000Z');
      const cloudGateway = new InMemoryCloudGateway({
        online: true,
        seedDefaultEvent: false,
        nowIso: () => clock.toISOString(),
      });
      cloudGateway.seedEvent(eventMultiTotem, questions);

      const storeA = new InMemoryLocalStore();
      await storeA.saveTotemConfig({
        totemId: 'totem-a',
        deviceToken: 'tok-a',
        pinCode: '1111',
        event: eventMultiTotem,
      });
      const storeB = new InMemoryLocalStore();
      await storeB.saveTotemConfig({
        totemId: 'totem-b',
        deviceToken: 'tok-b',
        pinCode: '2222',
        event: eventMultiTotem,
      });

      const totemA = new TotemSessionEngine({
        localStore: storeA,
        cloudGateway,
        clock,
        random: new DeterministicRandomSource('aaaaaaaa'),
      });
      const totemB = new TotemSessionEngine({
        localStore: storeB,
        cloudGateway,
        clock,
        random: new DeterministicRandomSource('bbbbbbbb'),
      });

      await totemA.initialize();
      await totemB.initialize();

      // Ambos os Totens perdem conexão com a nuvem no pavilhão
      cloudGateway.setOnline(false);

      // Mesmo telefone joga e vence no Totem A
      await totemA.startMatch('FERNANDO', '(61) 99666-7777');
      clock.advanceMs(8_000);
      const qA = totemA.getSnapshot().activeMatch!.currentQuestion!;
      totemA.submitAnswer(qA.question.shuffledOptions.findIndex((o) => o.isCorrect));
      await totemA.advanceAfterAnswer();

      // Mesmo telefone joga e vence no Totem B enquanto offline
      await totemB.startMatch('FERNANDO', '(61) 99666-7777');
      clock.advanceMs(5_000);
      const qB = totemB.getSnapshot().activeMatch!.currentQuestion!;
      totemB.submitAnswer(qB.question.shuffledOptions.findIndex((o) => o.isCorrect));
      const resultB = await totemB.advanceAfterAnswer();
      expect(resultB.pendingSyncCount).toBe(1);

      // Conexão volta e ambos sincronizam
      cloudGateway.setOnline(true);
      await totemA.syncPendingQueue();
      await totemB.syncPendingQueue();

      expect(cloudGateway.getSyncedMatches(DEFAULT_EVENT_ID)).toHaveLength(2);
      expect(cloudGateway.getActivePrizeClaims(DEFAULT_EVENT_ID)).toHaveLength(1);
      expect(cloudGateway.getOfflineConflictClaims(DEFAULT_EVENT_ID)).toHaveLength(1);
      expect(cloudGateway.getOfflineConflictClaims(DEFAULT_EVENT_ID)[0].participantPhone).toBe(
        '(61) 99666-7777',
      );
      // Estoque foi decrementado apenas uma vez (5 -> 4)
      expect(totemB.getSnapshot().event.prizeStockRemaining).toBe(4);

      // Ranking unificado após consulta à nuvem preserva ambas as Partidas
      const rankingSnap = await totemB.openRankingScreen();
      expect(rankingSnap.ranking).toHaveLength(2);

      // Trava de Brinde continua bloqueando o mesmo telefone no Totem B após o conflito offline
      totemB.resetToInitialScreen();
      const blockedAfterConflict = await totemB.startMatch('FERNANDO', '(61) 99666-7777');
      expect(blockedAfterConflict.started).toBe(false);
      expect(blockedAfterConflict.alreadyWonPrizeAt).toBeDefined();
    });

    it('mantém estoque local decrementado ao abrir Ranking com fila offline pendente e sincroniza Ranking no Totem online', async () => {
      const eventShared: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        prizeStockRemaining: 5,
        settings: {
          ...DEFAULT_EVENT_CONFIG.settings,
          numberOfQuestions: 1,
          minScoreForPrize: 1,
          enablePrizeLock: false,
          prizeStockLimit: 5,
        },
      };
      const questions = buildQuestionPool({ facil: 1, moderado: 0, dificil: 0 });
      const clock = new FakeClock('2026-11-15T15:00:00.000Z');
      const cloudGateway = new InMemoryCloudGateway({
        online: true,
        seedDefaultEvent: false,
        nowIso: () => clock.toISOString(),
      });
      cloudGateway.seedEvent(eventShared, questions);

      const totemA = new TotemSessionEngine({
        localStore: new InMemoryLocalStore(),
        cloudGateway,
        clock,
        random: new DeterministicRandomSource('11111111'),
      });
      const totemB = new TotemSessionEngine({
        localStore: new InMemoryLocalStore(),
        cloudGateway,
        clock,
        random: new DeterministicRandomSource('22222222'),
      });

      await totemA.initialize();
      await totemB.initialize();

      // Totem A conclui Partida online rapidamente (5s) -> 1º lugar na nuvem, estoque 5 -> 4
      await totemA.startMatch('PRIMEIRA', '(61) 91111-0001');
      clock.advanceMs(5_000);
      totemA.submitAnswer(
        totemA.getSnapshot().activeMatch!.currentQuestion!.question.shuffledOptions.findIndex(
          (o) => o.isCorrect,
        ),
      );
      const snapA = await totemA.advanceAfterAnswer();
      expect(snapA.lastResult?.rankingPosition).toBe(1);

      // Totem B conclui Partida online mais lenta (12s) -> deve ver 2º lugar na nuvem (não 1º local!)
      await totemB.startMatch('SEGUNDA', '(61) 92222-0002');
      clock.advanceMs(12_000);
      totemB.submitAnswer(
        totemB.getSnapshot().activeMatch!.currentQuestion!.question.shuffledOptions.findIndex(
          (o) => o.isCorrect,
        ),
      );
      const snapB = await totemB.advanceAfterAnswer();
      expect(snapB.lastResult?.rankingPosition).toBe(2);
      expect(snapB.event.prizeStockRemaining).toBe(3);

      // Totem B perde rede, premia offline (estoque local 3 -> 2) e abre Ranking sem perder o débito
      cloudGateway.setOnline(false);
      totemB.resetToInitialScreen();
      await totemB.startMatch('TERCEIRA OFFLINE', '(61) 93333-0003');
      clock.advanceMs(20_000);
      totemB.submitAnswer(
        totemB.getSnapshot().activeMatch!.currentQuestion!.question.shuffledOptions.findIndex(
          (o) => o.isCorrect,
        ),
      );
      await totemB.advanceAfterAnswer();
      const rankingOfflineSnap = await totemB.openRankingScreen();
      expect(rankingOfflineSnap.event.prizeStockRemaining).toBe(2);
    });
  });

  describe('Fatia 15: Pareamento de Totem por código curto e link de ativação', () => {
    it('gera código curto quando requirePairing está ativo e conclui Pareamento ao receber autorização da nuvem', async () => {
      const customEvent: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        id: '00000000-0000-4000-8000-000000000222',
        name: 'Congresso Pareado 2026',
        slug: 'congresso-pareado-2026',
        configVersion: 4,
      };
      const questions = buildQuestionPool({ facil: 2, moderado: 1, dificil: 0 });
      const { engine, cloudGateway, localStore } = createHarness({ online: true });
      cloudGateway.seedEvent(customEvent, questions);

      const pairingEngine = new TotemSessionEngine({
        localStore,
        cloudGateway,
        clock: new FakeClock(),
        random: new DeterministicRandomSource('77777777'),
        requirePairing: true,
      });

      const observedStates: string[] = [];
      pairingEngine.subscribe((snap) => {
        observedStates.push(`${snap.pairing.status}:${snap.event.id}`);
      });

      const pendingSnap = await pairingEngine.initialize();
      expect(pendingSnap.pairing.isPaired).toBe(false);
      expect(pendingSnap.pairing.status).toBe('awaiting_authorization');
      expect(pendingSnap.pairing.pairingCode).toMatch(/^[A-Z0-9]{6}$/);

      // A nuvem recebe o pedido pendente de Pareamento com o código curto
      const registeredTotems = await cloudGateway.listTotems();
      expect(registeredTotems).toHaveLength(1);
      expect(registeredTotems[0].pairingCode).toBe(pendingSnap.pairing.pairingCode);
      expect(registeredTotems[0].isPaired).toBe(false);

      // Administrador autoriza o código sem que o Totem digite senha administrativa
      await cloudGateway.authorizeTotemPairing({
        id: registeredTotems[0].id,
        pairingCode: pendingSnap.pairing.pairingCode!,
        deviceToken: 'tok-pareado-1',
        name: 'Totem Hall Principal',
        pinCode: '2580',
        eventId: customEvent.id,
      });

      const pairedSnap = pairingEngine.getSnapshot();
      expect(pairedSnap.pairing.isPaired).toBe(true);
      expect(pairedSnap.pairing.status).toBe('paired');
      expect(pairedSnap.pairing.totemName).toBe('Totem Hall Principal');
      expect(pairedSnap.event.id).toBe(customEvent.id);
      expect(pairedSnap.event.name).toBe('Congresso Pareado 2026');
      expect(pairedSnap.availableQuestionsCount).toBe(3);
      expect(observedStates).toContain(`paired:${customEvent.id}`);

      const persistedConfig = await localStore.getTotemConfig();
      expect(persistedConfig?.pinCode).toBe('2580');
      expect(persistedConfig?.deviceToken).toBe('tok-pareado-1');
      expect(engine.getSnapshot().initialized).toBe(false);
    });

    it('ativa Pareamento por link de ativação ou código pré-autorizado e rejeita código inválido', async () => {
      const targetEvent: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        id: '00000000-0000-4000-8000-000000000333',
        name: 'Evento Ativado por Link',
        slug: 'evento-link',
      };
      const { cloudGateway, clock, random } = createHarness({ online: true });
      cloudGateway.seedEvent(targetEvent, buildQuestionPool({ facil: 3, moderado: 0, dificil: 0 }));

      await cloudGateway.authorizeTotemPairing({
        id: '00000000-0000-4000-8000-000000000888',
        pairingCode: 'LINK99',
        deviceToken: 'tok-link-99',
        name: 'Totem Entrada Sul',
        pinCode: '9090',
        eventId: targetEvent.id,
      });

      const localStore = new InMemoryLocalStore();
      const engine = new TotemSessionEngine({
        localStore,
        cloudGateway,
        clock,
        random,
        requirePairing: true,
      });

      await engine.initialize();
      const invalidAttempt = await engine.activateWithCode('CODIGO_INEXISTENTE');
      expect(invalidAttempt.pairing.isPaired).toBe(false);
      expect(invalidAttempt.lastValidationError).toMatch(/inválido|não autorizado/i);

      const activated = await engine.activateWithCode('https://quiz.caesb.df.gov.br/?pairingCode=link99');
      expect(activated.pairing.isPaired).toBe(true);
      expect(activated.pairing.totemName).toBe('Totem Entrada Sul');
      expect(activated.event.id).toBe(targetEvent.id);
      expect(activated.screen).toBe('initial-screen');
      expect(activated.lastValidationError).toBeNull();
    });
  });

  describe('Fatia 16: Diagnóstico local protegido por PIN rápido e sincronização manual', () => {
    it('valida PIN configurado no Pareamento, expõe diagnóstico local e executa forceSync manual', async () => {
      const event: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        id: '00000000-0000-4000-8000-000000000444',
        name: 'Evento Diagnóstico',
        slug: 'evento-diagnostico',
        configVersion: 5,
        settings: {
          ...DEFAULT_EVENT_CONFIG.settings,
          numberOfQuestions: 1,
          minScoreForPrize: 1,
        },
      };
      const { cloudGateway, clock, random } = createHarness({ online: true });
      cloudGateway.seedEvent(event, buildQuestionPool({ facil: 2, moderado: 0, dificil: 0 }));

      await cloudGateway.authorizeTotemPairing({
        id: '00000000-0000-4000-8000-000000000777',
        pairingCode: 'DIAG77',
        deviceToken: 'tok-diag-77',
        name: 'Totem Balcão B',
        pinCode: '7410',
        eventId: event.id,
      });

      const engine = new TotemSessionEngine({
        localStore: new InMemoryLocalStore(),
        cloudGateway,
        clock,
        random,
        requirePairing: true,
      });

      // Antes do pareamento usa PIN padrão 0000; após pareamento passa a exigir PIN 7410
      await engine.initialize();
      expect(engine.verifyDiagnosticPin('0000')).toBe(true);

      await engine.activateWithCode('DIAG77');
      expect(engine.verifyDiagnosticPin('0000')).toBe(false);
      expect(engine.verifyDiagnosticPin('7410')).toBe(true);

      // Fica offline e registra Partida pendente na syncQueue
      await engine.setDeviceOnline(false);
      await engine.startMatch('BRUNO', '(61) 99444-3322');
      const q = engine.getSnapshot().activeMatch!.currentQuestion!;
      engine.submitAnswer(q.question.shuffledOptions.findIndex((o) => o.isCorrect));
      await engine.advanceAfterAnswer();

      const offlineDiag = engine.getLocalDiagnostics();
      expect(offlineDiag.isOnline).toBe(false);
      expect(offlineDiag.isPaired).toBe(true);
      expect(offlineDiag.totemName).toBe('Totem Balcão B');
      expect(offlineDiag.pairingCode).toBe('DIAG77');
      expect(offlineDiag.eventId).toBe(event.id);
      expect(offlineDiag.eventName).toBe('Evento Diagnóstico');
      expect(offlineDiag.configVersion).toBe(5);
      expect(offlineDiag.pendingSyncCount).toBe(1);
      expect(offlineDiag.currentScreen).toBe('result-screen');

      // Reconecta e força sincronização manual a partir do diagnóstico
      await engine.setDeviceOnline(true);
      const syncResult = await engine.forceSync();
      expect(syncResult.synced).toBe(1);
      expect(syncResult.failed).toBe(0);
      expect(syncResult.pending).toBe(0);

      const onlineDiag = engine.getLocalDiagnostics();
      expect(onlineDiag.isOnline).toBe(true);
      expect(onlineDiag.pendingSyncCount).toBe(0);
    });

    it('reconcilia SWITCH_EVENT perdido enquanto offline ao reconectar e publicar heartbeat', async () => {
      const eventA: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        id: '00000000-0000-4000-8000-000000000511',
        name: 'Evento Origem Offline',
        slug: 'evento-origem-offline',
      };
      const eventB: EventConfig = {
        ...DEFAULT_EVENT_CONFIG,
        id: '00000000-0000-4000-8000-000000000512',
        name: 'Evento Destino Pós-Reconexão',
        slug: 'evento-destino-reconexao',
      };
      const { cloudGateway, clock, random } = createHarness({ online: true });
      cloudGateway.seedEvent(eventA, buildQuestionPool({ facil: 1, moderado: 0, dificil: 0 }));
      cloudGateway.seedEvent(eventB, buildQuestionPool({ facil: 2, moderado: 0, dificil: 0 }));

      const totem = await cloudGateway.authorizeTotemPairing({
        id: '00000000-0000-4000-8000-000000000599',
        pairingCode: 'REC599',
        deviceToken: 'tok-rec-599',
        name: 'Totem Offline Catchup',
        pinCode: '1234',
        eventId: eventA.id,
      });

      const engine = new TotemSessionEngine({
        localStore: new InMemoryLocalStore(),
        cloudGateway,
        clock,
        random,
        requirePairing: true,
      });
      await engine.initialize({ activationCode: 'REC599' });
      expect(engine.getSnapshot().event.id).toBe(eventA.id);

      // Totem desconecta e perde o broadcast do comando SWITCH_EVENT
      await engine.setDeviceOnline(false);
      await cloudGateway.dispatchRemoteCommand({
        id: '00000000-0000-4000-8000-000000000598',
        type: 'SWITCH_EVENT',
        targetTotemId: totem.id,
        targetEventId: eventA.id,
        eventId: eventB.id,
        targetScreen: 'initial-screen',
        issuedAt: clock.toISOString(),
      });
      expect(engine.getSnapshot().event.id).toBe(eventA.id);

      // Ao reconectar e enviar heartbeat, reconcilia automaticamente para o Evento B
      const reconnectedSnap = await engine.setDeviceOnline(true);
      expect(reconnectedSnap.event.id).toBe(eventB.id);
      expect(reconnectedSnap.event.name).toBe('Evento Destino Pós-Reconexão');
    });
  });
});
