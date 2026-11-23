import { describe, expect, it } from 'vitest';
import { InMemoryCloudGateway } from '../../adapters/inMemoryCloudGateway';
import { InMemoryLocalStore } from '../../adapters/inMemoryLocalStore';
import { DEFAULT_EVENT_ID } from '../defaults';
import {
  PREDEFINED_THEMES,
  applyPredefinedTheme,
  restoreDefaultCustomizations,
} from '../customizationThemes';
import { EventAdminController } from '../eventAdminController';
import type { Clock, RandomSource } from '../ports';
import { TotemSessionEngine } from '../totemSessionEngine';

class FakeClock implements Clock {
  private currentMs: number;

  constructor(initialIso = '2026-11-16T10:00:00.000Z') {
    this.currentMs = new Date(initialIso).getTime();
  }

  now(): number {
    return this.currentMs;
  }

  advanceMs(deltaMs: number): void {
    this.currentMs += deltaMs;
  }

  toISOString(ms?: number): string {
    return new Date(ms ?? this.currentMs).toISOString();
  }
}

class DeterministicRandomSource implements RandomSource {
  private state = 17;
  private uuidCounter = 0;

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
    return `11111111-0000-4000-8000-0000000000${String(this.uuidCounter).padStart(2, '0')}`;
  }
}

function createAdminHarness() {
  const clock = new FakeClock();
  const random = new DeterministicRandomSource();
  const cloudGateway = new InMemoryCloudGateway({
    online: true,
    seedDefaultEvent: true,
    nowIso: () => clock.toISOString(),
  });
  const controller = new EventAdminController({
    cloudGateway,
    clock,
    random,
  });

  return { clock, random, cloudGateway, controller };
}

describe('EventAdminController (T4 - Autenticação, Multi-Evento e Banco de Questões)', () => {
  describe('Autenticação e Controle de Acesso por Papel (Administrador vs Operador)', () => {
    it('autentica Administrador e Operador e diferencia permissões nas operações', async () => {
      const { controller } = createAdminHarness();

      expect(controller.canAccessAdminPanel()).toBe(false);
      expect(controller.canAccessOperatorPanel()).toBe(false);

      const adminSession = await controller.login('admin@caesb.df.gov.br', 'CAESB2025!');
      expect(adminSession.user.role).toBe('admin');
      expect(controller.canAccessAdminPanel()).toBe(true);
      expect(controller.canAccessOperatorPanel()).toBe(true);

      const createdStaff = await controller.createStaffAccount({
        name: 'Operadora Ana',
        email: 'ana.operadora@caesb.df.gov.br',
        password: 'SENHA_FORTE_123',
        role: 'operator',
      });
      expect(createdStaff.role).toBe('operator');

      const staffList = await controller.listStaffAccounts();
      expect(staffList.some((member) => member.email === 'ana.operadora@caesb.df.gov.br')).toBe(
        true,
      );

      // Promove para Administrador e depois retorna para Operador, impedindo alterar/revogar a própria conta.
      const promoted = await controller.updateStaffRole(createdStaff.id, 'admin');
      expect(promoted.role).toBe('admin');
      const demoted = await controller.updateStaffRole(createdStaff.id, 'operator');
      expect(demoted.role).toBe('operator');

      await expect(controller.updateStaffRole(adminSession.user.id, 'operator')).rejects.toThrow(
        /próprio perfil/i,
      );
      await expect(controller.removeStaffAccount(adminSession.user.id)).rejects.toThrow(
        /próprio acesso/i,
      );

      // Cria e revoga outra conta de Operador.
      const tempStaff = await controller.createStaffAccount({
        name: 'Operador Temporário',
        email: 'temp@caesb.df.gov.br',
        password: 'TEMP_PASSWORD_1',
        role: 'operator',
      });
      await controller.removeStaffAccount(tempStaff.id);
      const afterRemove = await controller.listStaffAccounts();
      expect(afterRemove.some((member) => member.id === tempStaff.id)).toBe(false);

      await controller.logout();
      expect(controller.getSession()).toBeNull();

      // Operador consegue autenticar e ler Eventos, mas é bloqueado em mutações administrativas e no Banco de Questões.
      const opSession = await controller.login('ana.operadora@caesb.df.gov.br', 'SENHA_FORTE_123');
      expect(opSession.user.role).toBe('operator');
      expect(controller.canAccessAdminPanel()).toBe(false);
      expect(controller.canAccessOperatorPanel()).toBe(true);

      const events = await controller.listEvents();
      expect(events.length).toBeGreaterThanOrEqual(1);

      await expect(controller.queryQuestions()).rejects.toThrow(/Administrador/i);
      await expect(controller.exportQuestionsJson()).rejects.toThrow(/Administrador/i);
      await expect(controller.exportQuestionsCsv()).rejects.toThrow(/Administrador/i);

      await expect(
        controller.createEvent({ name: 'Evento Não Autorizado' }),
      ).rejects.toThrow(/Administrador/i);

      await expect(
        controller.createQuestion({
          text: 'Pergunta não autorizada',
          options: ['A', 'B', 'C', 'D'],
          correctIndex: 0,
          difficulty: 'facil',
        }),
      ).rejects.toThrow(/Administrador/i);
    });

    it('rejeita credenciais inválidas ou cadastro com dados inconsistentes', async () => {
      const { controller } = createAdminHarness();

      await expect(
        controller.login('admin@caesb.df.gov.br', 'SENHA_ERRADA'),
      ).rejects.toThrow(/inválid/i);

      await controller.login('admin@caesb.df.gov.br', 'CAESB2025!');
      await expect(
        controller.createStaffAccount({
          name: 'Sem E-mail',
          email: 'email-invalido',
          password: '123',
          role: 'operator',
        }),
      ).rejects.toThrow();
    });
  });

  describe('Gestão Multi-Evento, Validações e Clonagem', () => {
    it('cria múltiplos Eventos independentes, valida soma de percentuais 100% e permite clonar Evento com questões vinculadas', async () => {
      const { controller, cloudGateway, clock, random } = createAdminHarness();
      await controller.login('admin@caesb.df.gov.br', 'CAESB2025!');

      // Rejeita percentuais de dificuldade cuja soma não é 100%.
      await expect(
        controller.createEvent({
          name: 'Feira Inválida',
          settings: {
            difficultyPercentages: { facil: 50, moderado: 40, dificil: 20 },
          },
        }),
      ).rejects.toThrow(/100%/);

      // Rejeita minScoreForPrize maior que numberOfQuestions.
      await expect(
        controller.createEvent({
          name: 'Pontuação Inválida',
          settings: {
            numberOfQuestions: 5,
            minScoreForPrize: 6,
          },
        }),
      ).rejects.toThrow(/pontuação mínima/i);

      // Rejeita fadeOutLeadTimeSeconds >= idleTimeoutSeconds.
      await expect(
        controller.createEvent({
          name: 'FadeOut Inválido',
          settings: {
            idleTimeoutSeconds: 20,
            fadeOutLeadTimeSeconds: 20,
          },
        }),
      ).rejects.toThrow(/fade-out/i);

      // Rejeita data/hora de término menor ou igual ao início e tempo fora de 5..120s.
      await expect(
        controller.createEvent({
          name: 'Janela Inválida',
          startTime: '2026-11-16T18:00:00.000Z',
          endTime: '2026-11-16T12:00:00.000Z',
        }),
      ).rejects.toThrow(/término/i);

      await expect(
        controller.createEvent({
          name: 'Tempo Inválido',
          settings: { timePerQuestion: 4 },
        }),
      ).rejects.toThrow(/5 e 120/);

      // Cria Evento válido com regras e personalizações customizadas e questões vinculadas.
      const sourceEvent = await controller.createEvent({
        name: 'Congresso de Saneamento 2026',
        startTime: '2026-11-16T08:00:00.000Z',
        endTime: '2026-11-16T18:00:00.000Z',
        enableOutOfPeriodMessage: true,
        settings: {
          numberOfQuestions: 2,
          timePerQuestion: 45,
          idleTimeoutSeconds: 90,
          fadeOutLeadTimeSeconds: 10,
          difficultyPercentages: { facil: 50, moderado: 50, dificil: 0 },
          minScoreForPrize: 1,
          requireManualPrizeConfirmation: true,
          prizeStockLimit: 25,
          enablePrizeLock: true,
          giveUpLockoutMinutes: 5,
          virtualKeyboardHeight: 35,
          enableVirtualKeyboard: true,
          enableTimeAlertBorderPulse: true,
          enableTimeAlertFlash: false,
        },
        customizations: {
          texts: {
            initialScreenTitle: 'Bem-vindo ao Congresso!',
          },
          colors: {
            quizMainBackground: '#001122',
          },
        },
        linkedQuestionIds: [1, 2],
      });

      expect(sourceEvent.slug).toBe('congresso-de-saneamento-2026');
      expect(sourceEvent.configVersion).toBe(1);
      expect(sourceEvent.prizeStockRemaining).toBe(25);
      expect(sourceEvent.customizations.texts.initialScreenTitle).toBe('Bem-vindo ao Congresso!');

      // Atualiza evento e verifica incremento de configVersion.
      const updated = await controller.updateEvent(sourceEvent.id, {
        settings: { timePerQuestion: 40 },
      });
      expect(updated.configVersion).toBe(2);
      expect(updated.settings.timePerQuestion).toBe(40);

      // Clona o Evento preservando configurações, personalizações e vínculos de questões.
      const clonedEvent = await controller.cloneEvent(sourceEvent.id, {
        name: 'Expo Água Taguatinga',
        startTime: '2026-11-16T09:00:00.000Z',
        endTime: '2026-11-16T20:00:00.000Z',
      });

      expect(clonedEvent.id).not.toBe(sourceEvent.id);
      expect(clonedEvent.slug).toBe('expo-agua-taguatinga');
      expect(clonedEvent.configVersion).toBe(1);
      expect(clonedEvent.settings.timePerQuestion).toBe(40);
      expect(clonedEvent.settings.requireManualPrizeConfirmation).toBe(true);
      expect(clonedEvent.prizeStockRemaining).toBe(25);
      expect(clonedEvent.customizations.texts.initialScreenTitle).toBe('Bem-vindo ao Congresso!');
      expect(clonedEvent.customizations.colors.quizMainBackground).toBe('#001122');

      const clonedQuestionIds = await controller.getEventQuestionIds(clonedEvent.id);
      expect(clonedQuestionIds).toEqual([1, 2]);

      // Encerra o Evento original sem afetar o Evento clonado.
      const closedSource = await controller.setEventActive(sourceEvent.id, false);
      expect(closedSource.isActive).toBe(false);
      expect((await controller.listEvents()).find((e) => e.id === clonedEvent.id)?.isActive).toBe(
        true,
      );

      // Integração na costura com TotemSessionEngine: Totem pareado ao Evento clonado recebe apenas as 2 questões vinculadas.
      const totemStore = new InMemoryLocalStore();
      await totemStore.saveTotemConfig({
        totemId: 'totem-admin-check',
        deviceToken: 'token-admin-check',
        pinCode: '0000',
        event: clonedEvent,
      });
      const totemEngine = new TotemSessionEngine({
        localStore: totemStore,
        cloudGateway,
        clock,
        random,
      });
      const totemSnapshot = await totemEngine.initialize();
      expect(totemSnapshot.event.id).toBe(clonedEvent.id);
      expect(totemSnapshot.availableQuestionsCount).toBe(2);
    });
  });

  describe('Banco de Questões Central (CRUD, Filtros, Lote, Tags e Pré-visualização)', () => {
    it('cria, edita, filtra por texto/ID/dificuldade/status, pagina, pré-visualiza e executa ações em lote', async () => {
      const { controller } = createAdminHarness();
      await controller.login('admin@caesb.df.gov.br', 'CAESB2025!');

      const qNew = await controller.createQuestion({
        text: 'Qual é o índice de perdas na rede de distribuição monitorado na Estação?',
        options: ['18%', '45%', '72%', '95%'],
        correctIndex: 0,
        difficulty: 'dificil',
        tags: ['operacao', 'saneamento'],
      });
      expect(qNew.id).toBeGreaterThan(0);

      // Edita texto e marca com tag especial.
      const qEdited = await controller.updateQuestion(qNew.id, {
        text: 'Qual é o índice de perdas monitorado pela CAESB no DF?',
        options: ['Menos de 25%', '50%', '70%', '90%'],
        correctIndex: 0,
        difficulty: 'dificil',
        tags: ['operacao', 'df'],
      });
      expect(qEdited.text).toContain('DF');

      // Pesquisa por ID numérico exato.
      const byId = await controller.queryQuestions({ search: String(qNew.id) });
      expect(byId.items.some((q) => q.id === qNew.id)).toBe(true);

      // Pré-visualização no formato do Quiz deve embaralhar alternativas preservando resposta correta.
      const preview = controller.previewQuestion(qEdited);
      expect(preview.shuffledOptions).toHaveLength(4);
      expect(preview.shuffledOptions.filter((opt) => opt.isCorrect)).toHaveLength(1);
      expect(preview.shuffledOptions.find((opt) => opt.isCorrect)?.text).toBe('Menos de 25%');

      // Ação em lote: desabilitar [1, qNew.id] (somando com a questão 13 padrão que já inicia desabilitada = 3).
      const disabledCount = await controller.setQuestionsDisabled([1, qNew.id], true);
      expect(disabledCount).toBe(2);

      const onlyDisabled = await controller.queryQuestions({
        status: 'disabled',
        difficulties: ['dificil'],
      });
      expect(onlyDisabled.items.map((q) => q.id)).toEqual([qNew.id]);

      // Paginação e ordenação.
      const page1 = await controller.queryQuestions({
        sortBy: 'text',
        sortDirection: 'asc',
        page: 1,
        pageSize: 3,
      });
      expect(page1.items).toHaveLength(3);
      expect(page1.totalPages).toBeGreaterThan(1);
      expect(page1.counts.disabled).toBe(3);

      // Reabilita a questão #1 em lote.
      await controller.setQuestionsDisabled([1], false);
      const afterReenable = await controller.queryQuestions({ page: 1, pageSize: 5 });
      expect(afterReenable.counts.disabled).toBe(2);

      // Vincula questões ao Evento padrão por tags e rejeita tag sem correspondência.
      const linkedIds = await controller.setEventQuestionsByTags(DEFAULT_EVENT_ID, ['df']);
      expect(linkedIds).toEqual([qNew.id]);
      await expect(
        controller.setEventQuestionsByTags(DEFAULT_EVENT_ID, ['tag-inexistente']),
      ).rejects.toThrow(/Nenhuma questão encontrada/i);

      // Exclusão em lote.
      const deletedCount = await controller.deleteQuestions([qNew.id]);
      expect(deletedCount).toBe(1);
      const afterDelete = await controller.queryQuestions({ search: 'monitorado pela CAESB' });
      expect(afterDelete.items).toHaveLength(0);
    });
  });

  describe('Importação e Exportação do Banco de Questões (JSON e CSV)', () => {
    it('exporta e importa JSON e CSV escolhendo entre adicionar/mesclar ou substituir tudo', async () => {
      const { controller } = createAdminHarness();
      await controller.login('admin@caesb.df.gov.br', 'CAESB2025!');

      const initialJson = await controller.exportQuestionsJson();
      const parsedInitial = JSON.parse(initialJson) as Array<{ id: number; text: string }>;
      expect(parsedInitial.length).toBeGreaterThanOrEqual(10);

      const initialCsv = await controller.exportQuestionsCsv();
      expect(initialCsv.startsWith('\uFEFF')).toBe(true);
      expect(initialCsv).toContain('id,text,optionA,optionB,optionC,optionD,correctIndex,difficulty,tags,isDisabled');

      // Importação JSON no modo merge aceitando campo legado "correct" e dificuldade acentuada ("Fácil").
      const legacyJsonPayload = JSON.stringify({
        questions: [
          {
            id: 'legacy-1',
            text: 'Qual bacia abastece o sistema Descoberto?',
            options: ['Bacia do Rio Descoberto', 'Bacia Amazônica', 'Bacia do Prata', 'Bacia Atlântica'],
            correct: 0,
            difficulty: 'Fácil',
            tags: ['mananciais'],
          },
        ],
      });

      const mergeResult = await controller.importQuestionsJson(legacyJsonPayload, 'merge');
      expect(mergeResult.importedCount).toBe(1);
      expect(mergeResult.totalAfterImport).toBe(parsedInitial.length + 1);
      const importedLegacy = await controller.queryQuestions({ search: 'sistema Descoberto' });
      expect(importedLegacy.items[0].difficulty).toBe('facil');

      // Importação CSV no modo replace substitui integralmente o Banco de Questões e normaliza "Difícil".
      const csvPayload = [
        'id,text,optionA,optionB,optionC,optionD,correctIndex,difficulty,tags,isDisabled',
        '1,"Água tratada tem ""cloro"" residual?",Sim,Não,Nunca,Apenas aos domingos,0,Difícil,"tratamento;agua",false',
        '2,"Qual órgão regula o saneamento no DF?",ADASA,IBGE,INSS,ANATEL,0,moderado,regulacao,false',
      ].join('\n');

      const replaceResult = await controller.importQuestionsCsv(csvPayload, 'replace');
      expect(replaceResult.importedCount).toBe(2);
      expect(replaceResult.totalAfterImport).toBe(2);

      const allAfterReplace = await controller.queryQuestions({ pageSize: 50 });
      expect(allAfterReplace.items).toHaveLength(2);
      expect(allAfterReplace.items[0].text).toBe('Água tratada tem "cloro" residual?');
      expect(allAfterReplace.items[0].difficulty).toBe('dificil');
      expect(allAfterReplace.items[0].tags).toEqual(['tratamento', 'agua']);

      // Rejeita JSON e CSV inválidos, incluindo dificuldade desconhecida e correctIndex vazio no CSV.
      await expect(controller.importQuestionsJson('{json-quebrado', 'merge')).rejects.toThrow(
        /JSON inválido/i,
      );
      await expect(
        controller.importQuestionsJson(
          JSON.stringify([
            {
              text: 'Dificuldade inválida?',
              options: ['A', 'B', 'C', 'D'],
              correctIndex: 0,
              difficulty: 'impossivel',
            },
          ]),
          'merge',
        ),
      ).rejects.toThrow(/Dificuldade inválida/i);
      await expect(
        controller.importQuestionsCsv(
          'text,optionA,optionB,optionC,optionD,correctIndex,difficulty\nPergunta?,A,B,C,D,,facil',
          'merge',
        ),
      ).rejects.toThrow(/alternativa correta/i);
      await expect(
        controller.importQuestionsCsv('col1,col2\n1,2', 'merge'),
      ).rejects.toThrow(/Cabeçalho CSV inválido/i);
    });
  });

  describe('T5 - Pareamento de Totens pelo Administrador', () => {
    it('autoriza Pareamento por código curto ou link de ativação, valida PIN e restringe a Administradores', async () => {
      const { controller, cloudGateway, clock, random } = createAdminHarness();

      // Operador não tem permissão para autorizar pareamento ou listar totens para comando remoto.
      await controller.login('operador@caesb.df.gov.br', 'OPERADOR2025!');
      await expect(
        controller.authorizeTotemPairing({
          name: 'Totem Bloqueado',
          pinCode: '1234',
          eventId: DEFAULT_EVENT_ID,
        }),
      ).rejects.toThrow(/Administrador/i);
      await expect(controller.listTotems()).rejects.toThrow(/Administrador/i);
      await controller.logout();

      // Administrador faz login e autoriza dois Totens (um pendente por código e outro por link pré-gerado).
      await controller.login('admin@caesb.df.gov.br', 'CAESB2025!');

      await expect(
        controller.authorizeTotemPairing({
          name: 'Totem PIN Inválido',
          pinCode: 'ab12',
          eventId: DEFAULT_EVENT_ID,
        }),
      ).rejects.toThrow(/PIN/i);

      const totemEngine = new TotemSessionEngine({
        localStore: new InMemoryLocalStore(),
        cloudGateway,
        clock,
        random,
        requirePairing: true,
      });

      const pendingSnap = await totemEngine.initialize();
      const shortCode = pendingSnap.pairing.pairingCode!;

      const authorized = await controller.authorizeTotemPairing({
        pairingCode: shortCode,
        name: 'Totem Estande Central',
        pinCode: '4321',
        eventId: DEFAULT_EVENT_ID,
      });

      expect(authorized.isPaired).toBe(true);
      expect(authorized.name).toBe('Totem Estande Central');
      expect(totemEngine.getSnapshot().pairing.isPaired).toBe(true);
      expect(totemEngine.getSnapshot().pairing.totemName).toBe('Totem Estande Central');

      // Gera link de ativação pré-autorizado
      const preAuthorized = await controller.authorizeTotemPairing({
        name: 'Totem Auditório',
        pinCode: '5678',
        eventId: DEFAULT_EVENT_ID,
      });
      const link = controller.buildTotemActivationLink(
        preAuthorized.pairingCode,
        'https://quiz.caesb.df.gov.br',
      );
      expect(link).toBe(`https://quiz.caesb.df.gov.br/?pairingCode=${preAuthorized.pairingCode}`);

      const totems = await controller.listTotems();
      expect(totems).toHaveLength(2);
    });

    it('monitora telemetria ao vivo do Totem (Online/Offline, último ping, tela atual, versão e fila syncQueue)', async () => {
      const { controller, cloudGateway, clock, random } = createAdminHarness();
      await controller.login('admin@caesb.df.gov.br', 'CAESB2025!');

      const updatedEvent = await controller.updateEvent(DEFAULT_EVENT_ID, {
        settings: { numberOfQuestions: 1, minScoreForPrize: 1 },
      });

      const localStore = new InMemoryLocalStore();
      const totemEngine = new TotemSessionEngine({
        localStore,
        cloudGateway,
        clock,
        random,
        requirePairing: true,
      });

      const pendingSnap = await totemEngine.initialize();
      await controller.authorizeTotemPairing({
        pairingCode: pendingSnap.pairing.pairingCode!,
        name: 'Totem Telemetria 01',
        pinCode: '1122',
        eventId: updatedEvent.id,
      });

      let [telemetry] = await controller.listTotems();
      expect(telemetry.onlineStatus).toBe('online');
      expect(telemetry.currentScreen).toBe('initial-screen');
      expect(telemetry.configVersion).toBe(updatedEvent.configVersion);
      expect(telemetry.pendingSyncCount).toBe(0);
      expect(telemetry.lastSeenAt).toBe(clock.toISOString());

      // Avança para tela de descanso e volta para tela inicial
      totemEngine.enterIdleScreen();
      await totemEngine.sendHeartbeat();
      [telemetry] = await controller.listTotems();
      expect(telemetry.currentScreen).toBe('idle-screen');

      totemEngine.wakeFromIdleScreen();
      await totemEngine.startMatch('LUCIANA', '(61) 99123-4567');
      [telemetry] = await controller.listTotems();
      expect(telemetry.currentScreen).toBe('quiz-screen');

      // Totem fica offline no estande e finaliza Partida localmente -> fila syncQueue = 1
      const lastOnlinePing = telemetry.lastSeenAt;
      await totemEngine.setDeviceOnline(false);

      const q = totemEngine.getSnapshot().activeMatch!.currentQuestion!;
      totemEngine.submitAnswer(q.question.shuffledOptions.findIndex((o) => o.isCorrect));
      await totemEngine.advanceAfterAnswer();

      [telemetry] = await controller.listTotems();
      expect(telemetry.onlineStatus).toBe('offline');
      expect(telemetry.currentScreen).toBe('result-screen');
      expect(telemetry.pendingSyncCount).toBe(1);
      expect(telemetry.lastSeenAt).toBe(lastOnlinePing);

      // Totem abre Ranking e depois volta a ficar online e sincroniza
      await totemEngine.openRankingScreen();
      [telemetry] = await controller.listTotems();
      expect(telemetry.currentScreen).toBe('ranking-screen');

      await totemEngine.setDeviceOnline(true);
      await totemEngine.syncPendingQueue();
      await totemEngine.sendHeartbeat();

      [telemetry] = await controller.listTotems();
      expect(telemetry.onlineStatus).toBe('online');
      expect(telemetry.pendingSyncCount).toBe(0);
    });

    it('executa comandos remotos imediatamente quando o Totem está ocioso (FORCE_SYNC, RELOAD_SCREEN, SWITCH_EVENT, CONFIG_UPDATED)', async () => {
      const { controller, cloudGateway, clock, random } = createAdminHarness();
      await controller.login('admin@caesb.df.gov.br', 'CAESB2025!');

      const eventB = await controller.createEvent({
        name: 'Evento B Remoto',
        settings: { numberOfQuestions: 1, minScoreForPrize: 1, timePerQuestion: 45 },
      });

      const totemEngine = new TotemSessionEngine({
        localStore: new InMemoryLocalStore(),
        cloudGateway,
        clock,
        random,
        requirePairing: true,
      });

      const pending = await totemEngine.initialize();
      const totem = await controller.authorizeTotemPairing({
        pairingCode: pending.pairing.pairingCode!,
        name: 'Totem Comando Imediato',
        pinCode: '3344',
        eventId: DEFAULT_EVENT_ID,
      });

      // Abre ranking e recebe RELOAD_SCREEN -> volta imediatamente para idle-screen
      await totemEngine.openRankingScreen();
      expect(totemEngine.getSnapshot().screen).toBe('ranking-screen');
      await controller.reloadTotemScreen({ totemId: totem.id }, 'idle-screen');
      expect(totemEngine.getSnapshot().screen).toBe('idle-screen');

      // Troca para Evento B via SWITCH_EVENT
      await controller.switchTotemEvent({ totemId: totem.id }, eventB.id);
      expect(totemEngine.getSnapshot().event.id).toBe(eventB.id);
      expect(totemEngine.getSnapshot().event.name).toBe('Evento B Remoto');
      expect(totemEngine.getSnapshot().screen).toBe('initial-screen');

      // Atualiza configuração do Evento B -> CONFIG_UPDATED aplicado imediatamente
      await controller.updateEvent(eventB.id, {
        customizations: { texts: { initialScreenTitle: 'Título Atualizado Remotamente!' } },
      });
      expect(totemEngine.getSnapshot().event.customizations.texts.initialScreenTitle).toBe(
        'Título Atualizado Remotamente!',
      );
      expect(totemEngine.getSnapshot().event.configVersion).toBe(2);

      // Joga offline, reconecta e recebe FORCE_SYNC
      await totemEngine.setDeviceOnline(false);
      await totemEngine.startMatch('GUSTAVO', '(61) 98888-1122');
      const q = totemEngine.getSnapshot().activeMatch!.currentQuestion!;
      totemEngine.submitAnswer(q.question.shuffledOptions.findIndex((o) => o.isCorrect));
      await totemEngine.advanceAfterAnswer();
      expect(totemEngine.getSnapshot().pendingSyncCount).toBe(1);

      await totemEngine.setDeviceOnline(true);
      await controller.forceSyncTotems({ totemId: totem.id });
      expect(totemEngine.getSnapshot().pendingSyncCount).toBe(0);
      expect(cloudGateway.getSyncedMatches(eventB.id)).toHaveLength(1);
    });

    it('difere CONFIG_UPDATED e SWITCH_EVENT durante Partida em andamento e aplica ao finalizar sem interromper o Participante', async () => {
      const { controller, cloudGateway, clock, random } = createAdminHarness();
      await controller.login('admin@caesb.df.gov.br', 'CAESB2025!');

      const eventA = await controller.updateEvent(DEFAULT_EVENT_ID, {
        settings: { numberOfQuestions: 2, minScoreForPrize: 1, timePerQuestion: 30 },
      });
      const eventB = await controller.createEvent({
        name: 'Evento Destino Pós-Partida',
        settings: { numberOfQuestions: 1, minScoreForPrize: 1 },
      });

      const totemEngine = new TotemSessionEngine({
        localStore: new InMemoryLocalStore(),
        cloudGateway,
        clock,
        random,
        requirePairing: true,
      });

      const pending = await totemEngine.initialize();
      const totem = await controller.authorizeTotemPairing({
        pairingCode: pending.pairing.pairingCode!,
        name: 'Totem Em Partida',
        pinCode: '5566',
        eventId: eventA.id,
      });

      // Participante inicia Partida de 2 questões
      await totemEngine.startMatch('MARIANA', '(61) 97777-2233');
      expect(totemEngine.getSnapshot().screen).toBe('quiz-screen');
      const versionAtMatchStart = totemEngine.getSnapshot().event.configVersion;

      // Administrador atualiza texto/configuração do Evento A enquanto a Partida está ativa
      await controller.updateEvent(eventA.id, {
        customizations: { texts: { initialScreenTitle: 'Nova Configuração v3' } },
      });

      // A Partida não é interrompida e a nova versão aguarda o fim da Partida
      let midMatchSnap = totemEngine.getSnapshot();
      expect(midMatchSnap.screen).toBe('quiz-screen');
      expect(midMatchSnap.activeMatch).not.toBeNull();
      expect(midMatchSnap.event.configVersion).toBe(versionAtMatchStart);
      expect(midMatchSnap.deferredCommands.some((c) => c.type === 'CONFIG_UPDATED')).toBe(true);

      // Responde Q1 e Q2 normalmente até concluir a Partida
      let q = totemEngine.getSnapshot().activeMatch!.currentQuestion!;
      totemEngine.submitAnswer(q.question.shuffledOptions.findIndex((o) => o.isCorrect));
      await totemEngine.advanceAfterAnswer();

      q = totemEngine.getSnapshot().activeMatch!.currentQuestion!;
      totemEngine.submitAnswer(q.question.shuffledOptions.findIndex((o) => o.isCorrect));
      await totemEngine.advanceAfterAnswer();
      await totemEngine.waitForBackgroundSync();
      const finishedSnap = totemEngine.getSnapshot();

      // Partida concluiu exibindo resultado e aplicou a configuração baixada
      expect(finishedSnap.screen).toBe('result-screen');
      expect(finishedSnap.lastResult?.score).toBe(2);
      expect(finishedSnap.deferredCommands).toHaveLength(0);
      expect(finishedSnap.event.customizations.texts.initialScreenTitle).toBe('Nova Configuração v3');
      expect(finishedSnap.event.configVersion).toBe(versionAtMatchStart + 1);

      // Também difere SWITCH_EVENT enviado no meio de uma nova Partida
      totemEngine.resetToInitialScreen();
      await totemEngine.startMatch('PAULO', '(61) 96666-4455');
      await controller.switchTotemEvent({ totemId: totem.id }, eventB.id);

      midMatchSnap = totemEngine.getSnapshot();
      expect(midMatchSnap.screen).toBe('quiz-screen');
      expect(midMatchSnap.event.id).toBe(eventA.id);
      expect(midMatchSnap.deferredCommands.some((c) => c.type === 'SWITCH_EVENT')).toBe(true);

      q = totemEngine.getSnapshot().activeMatch!.currentQuestion!;
      totemEngine.submitAnswer(q.question.shuffledOptions.findIndex((o) => o.isCorrect));
      await totemEngine.advanceAfterAnswer();
      q = totemEngine.getSnapshot().activeMatch!.currentQuestion!;
      totemEngine.submitAnswer(q.question.shuffledOptions.findIndex((o) => o.isCorrect));
      await totemEngine.advanceAfterAnswer();
      await totemEngine.waitForBackgroundSync();
      const switchedAfterFinish = totemEngine.getSnapshot();

      expect(switchedAfterFinish.event.id).toBe(eventB.id);
      expect(switchedAfterFinish.screen).toBe('initial-screen');
      expect(switchedAfterFinish.deferredCommands).toHaveLength(0);
    });

    it('envia comandos remotos em lote para todos os Totens de um Evento e preserva bloqueio de desistência ao diferir troca', async () => {
      const { controller, cloudGateway, clock, random } = createAdminHarness();
      await controller.login('admin@caesb.df.gov.br', 'CAESB2025!');

      const eventA = await controller.updateEvent(DEFAULT_EVENT_ID, {
        settings: { numberOfQuestions: 2, minScoreForPrize: 1, giveUpLockoutMinutes: 5 },
      });
      const eventB = await controller.createEvent({
        name: 'Evento Lote Destino',
        settings: { numberOfQuestions: 1, minScoreForPrize: 1 },
      });
      const eventOther = await controller.createEvent({
        name: 'Evento Isolado',
        settings: { numberOfQuestions: 1, minScoreForPrize: 1 },
      });

      const makeTotem = () =>
        new TotemSessionEngine({
          localStore: new InMemoryLocalStore(),
          cloudGateway,
          clock,
          random,
          requirePairing: true,
        });

      const totem1 = makeTotem();
      const totem2 = makeTotem();
      const totemOther = makeTotem();

      const p1 = await totem1.initialize();
      const p2 = await totem2.initialize();
      const pOther = await totemOther.initialize();

      await controller.authorizeTotemPairing({
        pairingCode: p1.pairing.pairingCode!,
        name: 'Totem Lote 1',
        pinCode: '1111',
        eventId: eventA.id,
      });
      await controller.authorizeTotemPairing({
        pairingCode: p2.pairing.pairingCode!,
        name: 'Totem Lote 2',
        pinCode: '2222',
        eventId: eventA.id,
      });
      await controller.authorizeTotemPairing({
        pairingCode: pOther.pairing.pairingCode!,
        name: 'Totem Outro Evento',
        pinCode: '3333',
        eventId: eventOther.id,
      });

      // Comando RELOAD_SCREEN em lote para Evento A afeta apenas totem1 e totem2
      await totem1.openRankingScreen();
      await totem2.openRankingScreen();
      await totemOther.openRankingScreen();
      await controller.reloadTotemScreen({ eventId: eventA.id }, 'idle-screen');
      expect(totem1.getSnapshot().screen).toBe('idle-screen');
      expect(totem2.getSnapshot().screen).toBe('idle-screen');
      expect(totemOther.getSnapshot().screen).toBe('ranking-screen');

      // Comando SWITCH_EVENT em lote: totem1 está em Partida e desiste -> lockout deve ficar em eventA antes da troca para eventB
      totem1.wakeFromIdleScreen();
      await totem1.startMatch('CARLA', '(61) 95555-8899');
      await controller.switchTotemEvent({ eventId: eventA.id }, eventB.id);

      expect(totem2.getSnapshot().event.id).toBe(eventB.id);
      expect(totem1.getSnapshot().event.id).toBe(eventA.id);
      expect(totemOther.getSnapshot().event.id).toBe(eventOther.id);

      await totem1.giveUpMatch();
      expect(totem1.getSnapshot().event.id).toBe(eventB.id);
      const lockoutsEventA = cloudGateway.getLockouts(eventA.id);
      const lockoutsEventB = cloudGateway.getLockouts(eventB.id);
      expect(lockoutsEventA.some((l) => l.participantPhone === '(61) 95555-8899')).toBe(true);
      expect(lockoutsEventB).toHaveLength(0);
    });

    it('permite ao Administrador excluir um Totem preservando Partidas já sincronizadas e bloqueia Operador', async () => {
      const { controller, cloudGateway, clock, random } = createAdminHarness();
      await controller.login('admin@caesb.df.gov.br', 'CAESB2025!');

      const event = await controller.updateEvent(DEFAULT_EVENT_ID, {
        settings: { numberOfQuestions: 1, minScoreForPrize: 1 },
      });

      const totemEngine = new TotemSessionEngine({
        localStore: new InMemoryLocalStore(),
        cloudGateway,
        clock,
        random,
        requirePairing: true,
      });
      const pending = await totemEngine.initialize();
      const totem = await controller.authorizeTotemPairing({
        pairingCode: pending.pairing.pairingCode!,
        name: 'Totem Descartável 01',
        pinCode: '1234',
        eventId: event.id,
      });

      // Registra uma Partida no Totem antes de excluí-lo
      await totemEngine.startMatch('CARLOS', '(61) 99999-0001');
      const q = totemEngine.getSnapshot().activeMatch!.currentQuestion!;
      totemEngine.submitAnswer(q.question.shuffledOptions.findIndex((o) => o.isCorrect));
      await totemEngine.advanceAfterAnswer();

      // Operador não tem permissão para excluir Totem
      await controller.logout();
      await controller.login('operador@caesb.df.gov.br', 'OPERADOR2025!');
      await expect(controller.deleteTotem(totem.id)).rejects.toThrow();

      // Administrador exclui o Totem e preserva a Partida registrada
      await controller.logout();
      await controller.login('admin@caesb.df.gov.br', 'CAESB2025!');
      await controller.deleteTotem(totem.id);

      const remainingTotems = await controller.listTotems();
      expect(remainingTotems.some((t) => t.id === totem.id)).toBe(false);
      expect(cloudGateway.getSyncedMatches(DEFAULT_EVENT_ID)).toHaveLength(1);
    });

    it('permite ao Administrador excluir múltiplos Totens em lote e valida lista vazia', async () => {
      const { controller } = createAdminHarness();
      await controller.login('admin@caesb.df.gov.br', 'CAESB2025!');

      const t1 = await controller.authorizeTotemPairing({
        pairingCode: 'PAIRB1',
        name: 'Totem Lote 01',
        pinCode: '1111',
        eventId: DEFAULT_EVENT_ID,
      });
      const t2 = await controller.authorizeTotemPairing({
        pairingCode: 'PAIRB2',
        name: 'Totem Lote 02',
        pinCode: '2222',
        eventId: DEFAULT_EVENT_ID,
      });
      const t3 = await controller.authorizeTotemPairing({
        pairingCode: 'PAIRB3',
        name: 'Totem Lote 03',
        pinCode: '3333',
        eventId: DEFAULT_EVENT_ID,
      });

      await expect(controller.deleteTotemsInBatch([])).rejects.toThrow();

      const deletedIds = await controller.deleteTotemsInBatch([t1.id, t3.id]);
      expect(deletedIds).toEqual(expect.arrayContaining([t1.id, t3.id]));
      expect(deletedIds).toHaveLength(2);

      const remaining = await controller.listTotems();
      expect(remaining.map((t) => t.id)).toEqual([t2.id]);
    });
  });

  describe('T6 - Slice 1: Operador de Estande, Entregas, Conflitos Offline, Despremiar, Destravar e Excluir', () => {
    async function completeMatchOnTotem(
      totem: TotemSessionEngine,
      name: string,
      phone: string,
      options: { allCorrect?: boolean } = {},
    ): Promise<void> {
      const allCorrect = options.allCorrect ?? true;
      totem.wakeFromIdleScreen();
      const started = await totem.startMatch(name, phone);
      expect(started.started).toBe(true);

      while (totem.getSnapshot().screen === 'quiz-screen') {
        const current = totem.getSnapshot().activeMatch?.currentQuestion;
        if (!current) {
          break;
        }
        const optionIndex = allCorrect
          ? current.question.shuffledOptions.findIndex((option) => option.isCorrect)
          : current.question.shuffledOptions.findIndex((option) => !option.isCorrect);
        totem.submitAnswer(optionIndex >= 0 ? optionIndex : 0);
        await totem.advanceAfterAnswer();
      }
      await totem.waitForBackgroundSync();
    }

    it('permite ao Operador confirmar entrega, detectar Conflito Offline entregando apenas 1 Brinde, despremiar e destravar com reflexo imediato nos Totens', async () => {
      const clock = new FakeClock('2026-11-16T10:00:00.000Z');
      const random = new DeterministicRandomSource();
      const cloudGateway = new InMemoryCloudGateway({ nowIso: () => clock.toISOString() });

      const adminController = new EventAdminController({ cloudGateway, clock, random });
      await adminController.login('admin@caesb.df.gov.br', 'CAESB2025!');

      const event = await adminController.createEvent({
        name: 'Evento Operacional T6',
        isActive: true,
        settings: {
          numberOfQuestions: 2,
          minScoreForPrize: 1,
          prizeStockLimit: 5,
          enablePrizeLock: true,
          requireManualPrizeConfirmation: true,
          giveUpLockoutMinutes: 10,
        },
      });

      const createPairedTotem = async (name: string) => {
        const totem = new TotemSessionEngine({
          localStore: new InMemoryLocalStore(),
          cloudGateway,
          clock,
          random,
          requirePairing: true,
        });
        const init = await totem.initialize();
        await adminController.authorizeTotemPairing({
          pairingCode: init.pairing.pairingCode!,
          name,
          pinCode: '1234',
          eventId: event.id,
        });
        totem.wakeFromIdleScreen();
        return totem;
      };

      const totem1 = await createPairedTotem('Totem Estande 1');
      const totem2 = await createPairedTotem('Totem Estande 2');

      // Ambos os Totens operam offline e premiam o mesmo telefone (Conflito de Premiação Offline).
      cloudGateway.setOnline(false);
      await completeMatchOnTotem(totem1, 'MARIA CONFLITO', '(61) 99111-2222', { allCorrect: true });
      await completeMatchOnTotem(totem2, 'MARIA CONFLITO', '(61) 99111-2222', { allCorrect: true });

      // Totem 1 também registra uma desistência offline para outro telefone e uma Partida perdedora.
      totem1.wakeFromIdleScreen();
      await totem1.startMatch('JOAO DESISTENTE', '(61) 98888-3333');
      await totem1.giveUpMatch();
      await completeMatchOnTotem(totem1, 'PEDRO SEM BRINDE', '(61) 97777-4444', {
        allCorrect: false,
      });

      // Volta conectividade e sincroniza ambos os Totens em ordem.
      cloudGateway.setOnline(true);
      await totem1.syncPendingQueue();
      await totem2.syncPendingQueue();

      // Operador assume o painel móvel e valida suas permissões + fila Aguardando Retirada + Conflito.
      const operatorController = new EventAdminController({ cloudGateway, clock, random });
      await operatorController.login('operador@caesb.df.gov.br', 'OPERADOR2025!');

      const dashboard = await operatorController.getOperatorDashboard(event.id);
      expect(dashboard.event.id).toBe(event.id);
      expect(dashboard.event.prizeStockRemaining).toBe(4);
      expect(dashboard.awaitingPickupQueue).toHaveLength(1);
      expect(dashboard.awaitingPickupQueue[0]?.participantPhone).toBe('(61) 99111-2222');
      expect(dashboard.offlineConflicts).toHaveLength(1);
      expect(dashboard.offlineConflicts[0]?.participantPhone).toBe('(61) 99111-2222');
      expect(dashboard.offlineConflicts[0]?.conflictClaims).toHaveLength(1);
      expect(dashboard.activeLockouts).toHaveLength(1);
      expect(dashboard.ranking).toHaveLength(3);

      // Tentativa de entrega passando tanto o claim ativo quanto o claim de conflito entrega APENAS 1 Brinde.
      const primaryClaimId = dashboard.offlineConflicts[0]!.activeClaimId!;
      const conflictClaimId = dashboard.offlineConflicts[0]!.conflictClaims[0]!.claimId;
      const delivered = await operatorController.confirmPrizeDeliveries([
        primaryClaimId,
        conflictClaimId,
      ]);
      expect(delivered).toHaveLength(1);
      expect(delivered[0]?.id).toBe(primaryClaimId);
      expect(delivered[0]?.status).toBe('delivered');

      const claimsAfterDelivery = await cloudGateway.listPrizeClaims(event.id);
      expect(claimsAfterDelivery.filter((claim) => claim.status === 'delivered')).toHaveLength(1);
      expect(
        claimsAfterDelivery.find((claim) => claim.id === conflictClaimId)?.status,
      ).toBe('offline_duplicate_conflict');

      // Operador destrava o telefone bloqueado por desistência -> Totem 1 volta a permitir Partida imediatamente.
      const unlocked = await operatorController.unlockParticipantPhones(event.id, ['(61) 98888-3333']);
      expect(unlocked).toBe(1);
      await completeMatchOnTotem(totem1, 'JOAO DESISTENTE', '(61) 98888-3333', {
        allCorrect: false,
      });

      // Operador despremia MARIA CONFLITO -> Totem 2 recebe CONFIG_UPDATED e libera a Trava de Brinde.
      const revoked = await operatorController.revokePhonePrizeInEvent(event.id, '(61) 99111-2222');
      expect(revoked.length).toBeGreaterThanOrEqual(1);
      expect(revoked.every((claim) => claim.status === 'revoked' && claim.deliveredAt === null)).toBe(
        true,
      );

      await completeMatchOnTotem(totem2, 'MARIA CONFLITO', '(61) 99111-2222', {
        allCorrect: false,
      });

      // Operador NÃO pode excluir Partidas (exclusivo do Administrador).
      const pedroMatchId = dashboard.recentParticipants.find(
        (item) => item.participantPhone === '(61) 97777-4444',
      )!.matchId;
      await expect(operatorController.deleteParticipantMatches([pedroMatchId])).rejects.toThrow(
        /Administrador/i,
      );
    });

    it('permite apenas ao Administrador excluir Partidas, removendo-as do Ranking e liberando Trava de Brinde (inclusive com conflito offline)', async () => {
      const clock = new FakeClock('2026-11-16T11:00:00.000Z');
      const random = new DeterministicRandomSource();
      const cloudGateway = new InMemoryCloudGateway({ nowIso: () => clock.toISOString() });

      const adminController = new EventAdminController({ cloudGateway, clock, random });
      await adminController.login('admin@caesb.df.gov.br', 'CAESB2025!');

      const event = await adminController.createEvent({
        name: 'Evento Exclusão Admin',
        isActive: true,
        settings: {
          numberOfQuestions: 2,
          minScoreForPrize: 1,
          enablePrizeLock: true,
        },
      });

      const createTotem = async (name: string) => {
        const instance = new TotemSessionEngine({
          localStore: new InMemoryLocalStore(),
          cloudGateway,
          clock,
          random,
          requirePairing: true,
        });
        const init = await instance.initialize();
        await adminController.authorizeTotemPairing({
          pairingCode: init.pairing.pairingCode!,
          name,
          pinCode: '9999',
          eventId: event.id,
        });
        return instance;
      };

      const totem1 = await createTotem('Totem Ranking 1');
      const totem2 = await createTotem('Totem Ranking 2');

      cloudGateway.setOnline(false);
      await completeMatchOnTotem(totem1, 'CAMPEA EXCLUIDA', '(61) 96666-1111', {
        allCorrect: true,
      });
      await completeMatchOnTotem(totem2, 'CAMPEA EXCLUIDA', '(61) 96666-1111', {
        allCorrect: true,
      });

      cloudGateway.setOnline(true);
      await totem1.syncPendingQueue();
      await totem2.syncPendingQueue();
      expect(totem2.getSnapshot().ranking).toHaveLength(2);

      const claims = await cloudGateway.listPrizeClaims(event.id);
      const primaryMatchId = claims.find((c) => c.status !== 'offline_duplicate_conflict')!.matchId;
      const deletedIds = await adminController.deleteParticipantMatches([primaryMatchId]);
      expect(deletedIds).toEqual([primaryMatchId]);

      // Ranking local foi atualizado e o conflito offline órfão também foi limpo, liberando o telefone.
      expect(totem2.getSnapshot().ranking).toHaveLength(1);
      totem2.wakeFromIdleScreen();
      const canPlayAgain = await totem2.startMatch('CAMPEA EXCLUIDA', '(61) 96666-1111');
      expect(canPlayAgain.started).toBe(true);
    });
  });

  describe('T6 - Slice 2: Relatórios de Participantes, Filtros Combinados, Detalhes da Partida e Exportação CSV/JSON', () => {
    it('filtra por Evento, busca, intervalo de datas, status do Brinde, bloqueio, pontuação exata, ordena e pagina dinamicamente', async () => {
      const clock = new FakeClock('2026-11-16T12:00:00.000Z');
      const random = new DeterministicRandomSource();
      const cloudGateway = new InMemoryCloudGateway({ nowIso: () => clock.toISOString() });

      const adminController = new EventAdminController({ cloudGateway, clock, random });
      await adminController.login('admin@caesb.df.gov.br', 'CAESB2025!');

      const eventA = await adminController.createEvent({
        name: 'Evento Relatório A',
        isActive: true,
        settings: { numberOfQuestions: 3, minScoreForPrize: 2 },
      });
      const eventB = await adminController.createEvent({
        name: 'Evento Relatório B',
        isActive: false,
        settings: { numberOfQuestions: 3, minScoreForPrize: 2 },
      });

      const baseAnswers = [
        {
          questionId: 1,
          questionText: 'Qual é o papel da CAESB no DF?',
          options: ['Saneamento', 'Energia', 'Transporte', 'Correios'] as [
            string,
            string,
            string,
            string,
          ],
          selectedOptionText: 'Saneamento',
          correctOptionIndex: 0,
          correctOptionText: 'Saneamento',
          isCorrect: true,
        },
        {
          questionId: 2,
          questionText: 'Como evitar desperdício de água?',
          options: ['Banhos curtos', 'Torneira aberta', 'Lavar calçada', 'Nenhuma'] as [
            string,
            string,
            string,
            string,
          ],
          selectedOptionText: 'Torneira aberta',
          correctOptionIndex: 0,
          correctOptionText: 'Banhos curtos',
          isCorrect: false,
        },
      ];

      await cloudGateway.pushMatch({
        idempotencyKey: 'm-1',
        match: {
          id: 'match-1',
          eventId: eventA.id,
          totemId: 'totem-1',
          participantName: 'ANA GANHADORA',
          participantPhone: '(61) 99000-0001',
          score: 3,
          totalQuestions: 3,
          timeSeconds: 18,
          answers: baseAnswers,
          playedAt: '2026-11-15T14:00:00.000Z',
        },
        prizeClaim: {
          id: 'claim-1',
          eventId: eventA.id,
          matchId: 'match-1',
          totemId: 'totem-1',
          participantName: 'ANA GANHADORA',
          participantPhone: '(61) 99000-0001',
          status: 'delivered',
          awardedAt: '2026-11-15T14:00:00.000Z',
          deliveredAt: '2026-11-15T14:05:00.000Z',
        },
      });

      await cloudGateway.pushMatch({
        idempotencyKey: 'm-2',
        match: {
          id: 'match-2',
          eventId: eventA.id,
          totemId: 'totem-1',
          participantName: 'BRUNO AGUARDANDO',
          participantPhone: '(61) 99000-0002',
          score: 2,
          totalQuestions: 3,
          timeSeconds: 25,
          answers: baseAnswers,
          playedAt: '2026-11-16T10:00:00.000Z',
        },
        prizeClaim: {
          id: 'claim-2',
          eventId: eventA.id,
          matchId: 'match-2',
          totemId: 'totem-1',
          participantName: 'BRUNO AGUARDANDO',
          participantPhone: '(61) 99000-0002',
          status: 'awaiting_pickup',
          awardedAt: '2026-11-16T10:00:00.000Z',
          deliveredAt: null,
        },
      });

      await cloudGateway.pushMatch({
        idempotencyKey: 'm-3',
        match: {
          id: 'match-3',
          eventId: eventA.id,
          totemId: 'totem-2',
          participantName: 'BRUNO CONFLITO OFFLINE',
          participantPhone: '(61) 99000-0002',
          score: 2,
          totalQuestions: 3,
          timeSeconds: 20,
          answers: baseAnswers,
          playedAt: '2026-11-16T11:00:00.000Z',
        },
        prizeClaim: {
          id: 'claim-3',
          eventId: eventA.id,
          matchId: 'match-3',
          totemId: 'totem-2',
          participantName: 'BRUNO CONFLITO OFFLINE',
          participantPhone: '(61) 99000-0002',
          status: 'awaiting_pickup',
          awardedAt: '2026-11-16T11:00:00.000Z',
          deliveredAt: null,
        },
      });

      await cloudGateway.pushMatch({
        idempotencyKey: 'm-4',
        match: {
          id: 'match-4',
          eventId: eventA.id,
          totemId: 'totem-1',
          participantName: 'CARLOS BLOQUEADO',
          participantPhone: '(61) 99000-0003',
          score: 1,
          totalQuestions: 3,
          timeSeconds: 40,
          answers: baseAnswers,
          playedAt: '2026-11-16T11:30:00.000Z',
        },
        prizeClaim: null,
      });

      await cloudGateway.pushGiveUpLockout({
        idempotencyKey: 'lock-carlos',
        lockout: {
          id: 'lockout-4',
          eventId: eventA.id,
          totemId: 'totem-1',
          participantPhone: '(61) 99000-0003',
          lockedAt: '2026-11-16T11:55:00.000Z',
          expiresAt: '2026-11-16T12:15:00.000Z',
        },
      });

      await cloudGateway.pushMatch({
        idempotencyKey: 'm-5',
        match: {
          id: 'match-5',
          eventId: eventB.id,
          totemId: 'totem-9',
          participantName: 'DANIELA OUTRO EVENTO',
          participantPhone: '(61) 99000-0004',
          score: 3,
          totalQuestions: 3,
          timeSeconds: 15,
          answers: baseAnswers,
          playedAt: '2026-11-17T09:00:00.000Z',
        },
        prizeClaim: null,
      });

      // Paginação e ordenação em Event A
      const page1 = await adminController.queryParticipantReports({
        eventId: eventA.id,
        sortBy: 'score',
        sortDirection: 'desc',
        page: 1,
        pageSize: 2,
      });
      expect(page1.totalItems).toBe(4);
      expect(page1.totalPages).toBe(2);
      expect(page1.items.map((item) => item.matchId)).toEqual(['match-1', 'match-3']);
      expect(page1.offlineConflicts).toHaveLength(1);

      const page2 = await adminController.queryParticipantReports({
        eventId: eventA.id,
        sortBy: 'score',
        sortDirection: 'desc',
        page: 2,
        pageSize: 2,
      });
      expect(page2.items.map((item) => item.matchId)).toEqual(['match-2', 'match-4']);

      // Filtro por período específico + busca por dígitos do telefone + pontuação exata
      const filtered = await adminController.queryParticipantReports({
        eventId: eventA.id,
        search: '990000002',
        startDate: '2026-11-16',
        endDate: '2026-11-16',
        exactScore: 2,
        prizeFilter: 'offline_conflict',
      });
      expect(filtered.items.map((item) => item.matchId).sort()).toEqual(['match-2', 'match-3']);

      // Filtro por status: entregues, não ganhadores e bloqueados por desistência
      const deliveredOnly = await adminController.queryParticipantReports({
        prizeFilter: 'delivered',
      });
      expect(deliveredOnly.items.map((item) => item.matchId)).toEqual(['match-1']);

      const nonWinners = await adminController.queryParticipantReports({
        eventId: eventA.id,
        prizeFilter: 'non_winners',
      });
      expect(nonWinners.items.map((item) => item.matchId)).toEqual(['match-4']);

      const lockedOnly = await adminController.queryParticipantReports({
        onlyLockedOut: true,
      });
      expect(lockedOnly.items.map((item) => item.matchId)).toEqual(['match-4']);
      expect(lockedOnly.activeLockouts.map((lock) => lock.participantPhone)).toEqual([
        '(61) 99000-0003',
      ]);

      // Despremiar em lote apenas o claim principal também revoga conflito órfão do mesmo telefone no Evento.
      const batchRevoked = await adminController.revokePrizeClaims(['claim-2']);
      expect(batchRevoked.map((claim) => claim.id).sort()).toEqual(['claim-2', 'claim-3']);

      // Detalhes da Partida (posição no Ranking na ocasião, Partidas do telefone no Evento e Respostas)
      await cloudGateway.pushMatch({
        idempotencyKey: 'm-later-top',
        match: {
          id: 'match-later-top',
          eventId: eventA.id,
          totemId: 'totem-1',
          participantName: 'ELENA RECORDE POSTERIOR',
          participantPhone: '(61) 99000-0099',
          score: 3,
          totalQuestions: 3,
          timeSeconds: 10,
          answers: baseAnswers,
          playedAt: '2026-11-16T12:30:00.000Z',
        },
        prizeClaim: null,
      });
      const detailsFirstPlaceThen = await adminController.getParticipantMatchDetails('match-1');
      expect(detailsFirstPlaceThen.rankingPosition).toBe(1);

      const details = await adminController.getParticipantMatchDetails('match-3');
      expect(details.participantPhone).toBe('(61) 99000-0002');
      expect(details.totalMatchesByPhoneInEvent).toBe(2);
      expect(details.rankingPosition).toBe(2);
      expect(details.answers).toHaveLength(2);
      expect(details.answers[1]?.correctOptionText).toBe('Banhos curtos');
      expect(details.answers[1]?.isCorrect).toBe(false);

      // Exportação CSV e JSON dos registros filtrados (ignorando paginação)
      const csv = await adminController.exportParticipantsCsv({ eventId: eventA.id, pageSize: 1 });
      const csvLines = csv.trim().split('\n');
      expect(csvLines).toHaveLength(6);
      expect(csv).toContain('ANA GANHADORA');
      expect(csv).toContain('CARLOS BLOQUEADO');
      expect(csv).not.toContain('DANIELA OUTRO EVENTO');

      const jsonText = await adminController.exportParticipantsJson({
        eventId: eventB.id,
        pageSize: 1,
      });
      const parsedJson = JSON.parse(jsonText) as Array<{ participantName: string }>;
      expect(parsedJson).toHaveLength(1);
      expect(parsedJson[0]?.participantName).toBe('DANIELA OUTRO EVENTO');
    });
  });

  describe('T7 - Slice 1: Galeria de Temas, Mesclagem, Restauração Parcial/Total e Upload de Imagens', () => {
    it('aplica temas pré-definidos preservando textos customizados e restaura padrões por seção ou globalmente', () => {
      expect(PREDEFINED_THEMES.map((theme) => theme.name)).toEqual([
        'Padrão CAESB',
        'Claro Moderno',
        'Escuro Elegante',
      ]);

      const customBase = applyPredefinedTheme(undefined, 'caesbDefault');
      customBase.texts.initialScreenTitle = 'Semana da Água';
      customBase.visualIdentity.logoUrl = 'https://storage.local/event-assets/ev/logo-custom.png';

      // Aplica Escuro Elegante mantendo os textos personalizados e o logotipo já vinculado.
      const darkApplied = applyPredefinedTheme(customBase, 'darkElegant');
      expect(darkApplied.colors.quizMainBackground).toBe('#1a1a2e');
      expect(darkApplied.colors.quizPrimaryButtonBg).toBe('#e94560');
      expect(darkApplied.fontSizes.mainFontFamily).toContain('Verdana');
      expect(darkApplied.texts.initialScreenTitle).toBe('Semana da Água');
      expect(darkApplied.visualIdentity.logoUrl).toBe(
        'https://storage.local/event-assets/ev/logo-custom.png',
      );
      expect(darkApplied.visualIdentity.customBackgroundOpacity).toBe(0.3);

      // Restauração parcial: apenas textos -> cores e fontes do Escuro Elegante permanecem.
      const textsRestored = restoreDefaultCustomizations(darkApplied, 'texts');
      expect(textsRestored.texts.initialScreenTitle).toBe('Bem-vindo ao Quiz!');
      expect(textsRestored.colors.quizMainBackground).toBe('#1a1a2e');

      // Restauração parcial: apenas aparência -> volta cores/fontes padrão, mantendo visualIdentity.
      const appearanceRestored = restoreDefaultCustomizations(darkApplied, 'appearance');
      expect(appearanceRestored.colors.quizMainBackground).toBe('#002244');
      expect(appearanceRestored.visualIdentity.logoUrl).toBe(
        'https://storage.local/event-assets/ev/logo-custom.png',
      );

      // Restauração global: volta tudo ao padrão CAESB.
      const allRestored = restoreDefaultCustomizations(darkApplied, 'all');
      expect(allRestored.texts.initialScreenTitle).toBe('Bem-vindo ao Quiz!');
      expect(allRestored.colors.quizMainBackground).toBe('#002244');
      expect(allRestored.visualIdentity.logoUrl ?? null).toBeNull();
    });

    it('permite ao Administrador fazer upload de logotipo/fundo na nuvem e salvar personalizações com notificação aos Totens', async () => {
      const clock = new FakeClock('2026-11-16T13:00:00.000Z');
      const random = new DeterministicRandomSource();
      const cloudGateway = new InMemoryCloudGateway({ nowIso: () => clock.toISOString() });

      const adminController = new EventAdminController({ cloudGateway, clock, random });
      await adminController.login('admin@caesb.df.gov.br', 'CAESB2025!');

      const logoBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      const uploadedLogo = await adminController.uploadEventVisualAsset({
        eventId: DEFAULT_EVENT_ID,
        kind: 'logo',
        fileName: 'logo-evento.png',
        mimeType: 'image/png',
        bytes: logoBytes,
      });
      expect(uploadedLogo.url).toContain('event-assets');

      const [currentEvent] = await adminController.listEvents();
      const lightTheme = applyPredefinedTheme(currentEvent!.customizations, 'lightModern');
      lightTheme.visualIdentity.logoFileName = uploadedLogo.fileName;
      lightTheme.visualIdentity.logoUrl = uploadedLogo.url;
      lightTheme.visualIdentity.enableCustomBackground = true;
      lightTheme.visualIdentity.customBackgroundOpacity = 0.45;

      const saved = await adminController.saveEventCustomizations(DEFAULT_EVENT_ID, lightTheme);
      expect(saved.customizations.colors.quizMainBackground).toBe('#f0f4f8');
      expect(saved.customizations.visualIdentity.logoUrl).toBe(uploadedLogo.url);
      expect(saved.customizations.visualIdentity.customBackgroundOpacity).toBe(0.45);
      expect(saved.configVersion).toBe(currentEvent!.configVersion + 1);

      // Operador não pode enviar imagens nem salvar personalizações.
      const opController = new EventAdminController({ cloudGateway, clock, random });
      await opController.login('operador@caesb.df.gov.br', 'OPERADOR2025!');
      await expect(
        opController.uploadEventVisualAsset({
          eventId: DEFAULT_EVENT_ID,
          kind: 'logo',
          fileName: 'x.png',
          mimeType: 'image/png',
          bytes: logoBytes,
        }),
      ).rejects.toThrow(/Administrador/i);
      await expect(opController.listEventVisualAssets()).rejects.toThrow(/Administrador/i);
      await expect(
        opController.deleteEventVisualAsset('any/path.png'),
      ).rejects.toThrow(/Administrador/i);
    });

    it('lista biblioteca de imagens de todos os Eventos, permite reaproveitamento e impede exclusão de imagem em uso', async () => {
      const clock = new FakeClock('2026-11-16T14:00:00.000Z');
      const random = new DeterministicRandomSource();
      const cloudGateway = new InMemoryCloudGateway({ nowIso: () => clock.toISOString() });

      const adminController = new EventAdminController({ cloudGateway, clock, random });
      await adminController.login('admin@caesb.df.gov.br', 'CAESB2025!');

      const secondEvent = await adminController.createEvent({
        name: 'Congresso de Saneamento',
        isActive: true,
      });

      const sampleBytes = new Uint8Array([137, 80, 78, 71]);
      const logo1 = await adminController.uploadEventVisualAsset({
        eventId: DEFAULT_EVENT_ID,
        kind: 'logo',
        fileName: 'logo-v1.png',
        mimeType: 'image/png',
        bytes: sampleBytes,
      });
      clock.advanceMs(1000);
      const logo2 = await adminController.uploadEventVisualAsset({
        eventId: secondEvent.id,
        kind: 'logo',
        fileName: 'logo-congresso.png',
        mimeType: 'image/png',
        bytes: sampleBytes,
      });

      const allAssets = await adminController.listEventVisualAssets();
      expect(allAssets).toHaveLength(2);
      expect(allAssets.map((a) => a.fileName)).toEqual(['logo-congresso.png', 'logo-v1.png']);

      // Reaproveita logo2 (enviado no secondEvent) no Evento padrão (DEFAULT_EVENT_ID)
      const [defaultEv] = await adminController.listEvents();
      const custom = structuredClone(defaultEv!.customizations);
      custom.visualIdentity.logoFileName = logo2.fileName;
      custom.visualIdentity.logoUrl = logo2.url;
      await adminController.saveEventCustomizations(DEFAULT_EVENT_ID, custom);

      const logo2Record = allAssets.find((a) => a.url === logo2.url)!;
      const logo1Record = allAssets.find((a) => a.url === logo1.url)!;

      // Impede exclusão de logo2 enquanto está em uso no Evento salvo
      await expect(
        adminController.deleteEventVisualAsset(logo2Record.storagePath),
      ).rejects.toThrow(/em uso no\(s\) Evento\(s\)/i);

      // Permite excluir logo1 que não está vinculada a nenhum Evento salvo
      await adminController.deleteEventVisualAsset(logo1Record.storagePath);
      const remaining = await adminController.listEventVisualAssets();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].url).toBe(logo2.url);
    });
  });

  describe('T8 - Slice 1: Dashboard Analítico e Estatísticas por Questão', () => {
    it('calcula KPIs, agregações por dia/pontuação/hora, filtros de período e estatísticas por questão', async () => {
      const clock = new FakeClock('2026-11-16T15:00:00.000Z');
      const random = new DeterministicRandomSource();
      const cloudGateway = new InMemoryCloudGateway({ nowIso: () => clock.toISOString() });

      const adminController = new EventAdminController({ cloudGateway, clock, random });
      await adminController.login('admin@caesb.df.gov.br', 'CAESB2025!');

      const event = await adminController.createEvent({
        name: 'Evento Analítico T8',
        isActive: true,
        settings: { numberOfQuestions: 3, minScoreForPrize: 2 },
      });

      const makeAnswer = (questionId: number, isCorrect: boolean) => ({
        questionId,
        questionText: `Questão ${questionId}`,
        options: ['A', 'B', 'C', 'D'] as [string, string, string, string],
        selectedOptionText: isCorrect ? 'A' : 'B',
        correctOptionIndex: 0,
        correctOptionText: 'A',
        isCorrect,
      });

      // Hoje (2026-11-16): 2 Partidas -> 1 atingiu minScoreForPrize (3 pts, 20s) e 1 não atingiu (1 pt, 40s)
      await cloudGateway.pushMatch({
        idempotencyKey: 'an-1',
        match: {
          id: 'an-match-1',
          eventId: event.id,
          totemId: 'totem-1',
          participantName: 'ANA ANALITICA',
          participantPhone: '(61) 99001-0001',
          score: 3,
          totalQuestions: 3,
          timeSeconds: 20,
          answers: [makeAnswer(1, true), makeAnswer(2, true), makeAnswer(3, true)],
          playedAt: '2026-11-16T10:00:00.000Z',
        },
        prizeClaim: null,
      });

      await cloudGateway.pushMatch({
        idempotencyKey: 'an-2',
        match: {
          id: 'an-match-2',
          eventId: event.id,
          totemId: 'totem-1',
          participantName: 'BRUNO ANALITICO',
          participantPhone: '(61) 99001-0002',
          score: 1,
          totalQuestions: 3,
          timeSeconds: 40,
          answers: [makeAnswer(1, true), makeAnswer(2, false), makeAnswer(3, false)],
          playedAt: '2026-11-16T10:30:00.000Z',
        },
        prizeClaim: null,
      });

      // 5 dias atrás (2026-11-11): 1 Partida com 2 pts, 30s
      await cloudGateway.pushMatch({
        idempotencyKey: 'an-3',
        match: {
          id: 'an-match-3',
          eventId: event.id,
          totemId: 'totem-1',
          participantName: 'CARLA ANTIGA',
          participantPhone: '(61) 99001-0003',
          score: 2,
          totalQuestions: 3,
          timeSeconds: 30,
          answers: [makeAnswer(1, false), makeAnswer(2, true)],
          playedAt: '2026-11-11T14:00:00.000Z',
        },
        prizeClaim: null,
      });

      // Filtro 'today' considera apenas as 2 Partidas de 2026-11-16
      const todayDashboard = await adminController.queryAnalyticsDashboard({
        eventId: event.id,
        period: 'today',
        questionMetric: 'difficulty',
      });
      expect(todayDashboard.kpis.totalParticipations).toBe(2);
      expect(todayDashboard.kpis.averageScore).toBe(2);
      expect(todayDashboard.kpis.averageTimeSeconds).toBe(30);
      expect(todayDashboard.kpis.successRatePercent).toBe(50);

      // Filtro 'last_7_days' inclui todas as 3 Partidas
      const weekDashboard = await adminController.queryAnalyticsDashboard({
        eventId: event.id,
        period: 'last_7_days',
        questionMetric: 'difficulty',
      });
      expect(weekDashboard.kpis.totalParticipations).toBe(3);
      expect(weekDashboard.kpis.averageScore).toBe(2);
      expect(weekDashboard.kpis.averageTimeSeconds).toBe(30);
      expect(weekDashboard.kpis.successRatePercent).toBeCloseTo(66.67, 1);

      expect(weekDashboard.participationsOverTime).toEqual([
        { date: '2026-11-11', count: 1 },
        { date: '2026-11-16', count: 2 },
      ]);
      expect(weekDashboard.scoreDistribution.find((b) => b.score === 3)?.count).toBe(1);
      expect(weekDashboard.scoreDistribution.find((b) => b.score === 2)?.count).toBe(1);
      expect(weekDashboard.scoreDistribution.find((b) => b.score === 1)?.count).toBe(1);
      expect(weekDashboard.hourlyEngagement).toHaveLength(24);
      expect(
        weekDashboard.hourlyEngagement.reduce((sum, bucket) => sum + bucket.count, 0),
      ).toBe(3);

      // Questão 3 teve 1 acerto de 2 respostas (50%) -> mais difícil entre respondidas
      expect(weekDashboard.questionAnalysis.items[0]?.questionId).toBe(3);
      expect(weekDashboard.questionAnalysis.items[0]?.accuracyPercent).toBe(50);

      // Estatísticas de Questões
      const stats = await adminController.queryQuestionStats({
        eventId: event.id,
        sortBy: 'totalAnswers',
        sortDirection: 'desc',
        page: 1,
        pageSize: 5,
      });
      expect(stats.totalParticipations).toBe(3);
      expect(stats.overallAverageScore).toBe(2);
      expect(stats.items[0]?.totalAnswers).toBe(3);
      expect(stats.items[0]?.correctAnswers).toBe(2);
      expect(stats.items[0]?.incorrectAnswers).toBe(1);
    });
  });

  describe('T8 - Slice 2: Backup Completo e Migração de Backups Legados (quiz-offline)', () => {
    it('exporta backup completo da plataforma e restaura integralmente em outro ambiente', async () => {
      const clock = new FakeClock('2026-11-16T16:00:00.000Z');
      const random = new DeterministicRandomSource();
      const sourceGateway = new InMemoryCloudGateway({ nowIso: () => clock.toISOString() });
      const sourceController = new EventAdminController({
        cloudGateway: sourceGateway,
        clock,
        random,
      });
      await sourceController.login('admin@caesb.df.gov.br', 'CAESB2025!');

      const customEvent = await sourceController.createEvent({
        name: 'Evento Backup Origem',
        isActive: true,
        settings: { numberOfQuestions: 2, minScoreForPrize: 1 },
      });
      await sourceGateway.pushMatch({
        idempotencyKey: 'bk-1',
        match: {
          id: 'bk-match-1',
          eventId: customEvent.id,
          totemId: 'totem-1',
          participantName: 'MARIANA BACKUP',
          participantPhone: '(61) 99123-0001',
          score: 2,
          totalQuestions: 2,
          timeSeconds: 14,
          answers: [],
          playedAt: '2026-11-16T15:30:00.000Z',
        },
        prizeClaim: {
          id: 'bk-claim-1',
          eventId: customEvent.id,
          matchId: 'bk-match-1',
          totemId: 'totem-1',
          participantName: 'MARIANA BACKUP',
          participantPhone: '(61) 99123-0001',
          status: 'delivered',
          awardedAt: '2026-11-16T15:30:00.000Z',
          deliveredAt: '2026-11-16T15:31:00.000Z',
        },
      });

      const backupJson = await sourceController.exportFullBackup();

      // Restaura em um gateway limpo
      const targetGateway = new InMemoryCloudGateway({
        seedDefaultEvent: false,
        nowIso: () => clock.toISOString(),
      });
      const targetController = new EventAdminController({
        cloudGateway: targetGateway,
        clock,
        random,
      });
      await targetController.login('admin@caesb.df.gov.br', 'CAESB2025!');

      const restoreResult = await targetController.restoreBackup(backupJson);
      expect(restoreResult.sourceFormat).toBe('platform');
      expect(restoreResult.importedMatchesCount).toBe(1);
      expect(restoreResult.importedPrizeClaimsCount).toBe(1);

      const restoredReports = await targetController.queryParticipantReports({
        eventId: customEvent.id,
      });
      expect(restoredReports.items.map((item) => item.participantName)).toEqual(['MARIANA BACKUP']);
    });

    it('importa backup legado do quiz-offline (FITABES 2025), remapeando IDs de questões e Respostas e vinculando ao Evento destino', async () => {
      const clock = new FakeClock('2026-11-16T16:30:00.000Z');
      const random = new DeterministicRandomSource();
      const cloudGateway = new InMemoryCloudGateway({ nowIso: () => clock.toISOString() });
      const adminController = new EventAdminController({ cloudGateway, clock, random });
      await adminController.login('admin@caesb.df.gov.br', 'CAESB2025!');
      const initialQuestionsCount = (await adminController.listAllQuestions()).length;

      const targetEvent = await adminController.createEvent({
        name: 'FITABES 2025 Migrado',
        isActive: true,
      });

      const legacyFitabesPayload = {
        quizQuestions: [
          {
            id: 'q1',
            text: 'O que significa a sigla Caesb?',
            options: [
              'Companhia de Águas e Esgotos de Brasília',
              'Companhia de Saneamento Ambiental do Distrito Federal',
              'Companhia de Abastecimento e Saneamento de Brasília',
              'Centro de Águas e Saneamento Básico',
            ],
            correct: 1,
            isDisabled: false,
            difficulty: 'facil',
          },
          {
            id: 'q_imported_1748196578081_4',
            text: 'Como é carinhosamente apelidado o Lago Paranoá?',
            options: [
              'Mar de Brasília',
              'Piscinão do Cerrado',
              'Lagoa dos Candangos',
              'Praia do Planalto',
            ],
            correct: 0,
            isDisabled: false,
            difficulty: 'moderado',
          },
        ],
        quizParticipants: [
          {
            name: 'ANDRE LEGADO',
            phone: '(61) 98339-1090',
            score: 2,
            time: 42,
            timestamp: '2025-05-25T22:07:29.009Z',
            playerAttempts: [
              {
                questionId: 'q1',
                questionText: 'O que significa a sigla Caesb?',
                options: [
                  'Companhia de Águas e Esgotos de Brasília',
                  'Companhia de Saneamento Ambiental do Distrito Federal',
                  'Companhia de Abastecimento e Saneamento de Brasília',
                  'Centro de Águas e Saneamento Básico',
                ],
                selectedOptionText: 'Companhia de Saneamento Ambiental do Distrito Federal',
                correctOptionIndex: 1,
                correctOptionText: 'Companhia de Saneamento Ambiental do Distrito Federal',
                isCorrect: true,
              },
              {
                questionId: 'q_imported_1748196578081_4',
                questionText: 'Como é carinhosamente apelidado o Lago Paranoá?',
                options: [
                  'Mar de Brasília',
                  'Piscinão do Cerrado',
                  'Lagoa dos Candangos',
                  'Praia do Planalto',
                ],
                selectedOptionText: 'Mar de Brasília',
                correctOptionIndex: 0,
                correctOptionText: 'Mar de Brasília',
                isCorrect: true,
              },
            ],
          },
        ],
        quizSettings: {
          numberOfQuestions: 2,
          minScoreForPrize: 2,
          enablePrizeLock: true,
        },
        quizCurrentEvent: {
          eventName: 'FITABES 2025 - Dia 3 (Tarde)',
          startTime: '2025-05-29T14:30',
          endTime: '2025-05-29T18:00',
          enableOutOfPeriodMessage: false,
        },
        quizPrizeWinnersData: [
          { phone: '(61) 98339-1090', timestamp: '2025-05-25T22:07:29.009Z' },
        ],
        quizGiveUpLockoutData: [
          {
            phone: '(61) 98111-2222',
            lockedAt: '2025-05-25T22:10:00.000Z',
            expiresAt: '2025-05-25T22:20:00.000Z',
          },
        ],
        quizThemeCustomizations: {
          colors: { quizMainBackground: '#001122' },
        },
      };

      const result = await adminController.restoreBackup(JSON.stringify(legacyFitabesPayload), {
        targetEventId: targetEvent.id,
      });

      expect(result.sourceFormat).toBe('legacy_quiz_offline');
      expect(result.targetEventId).toBe(targetEvent.id);
      expect(result.importedQuestionsCount).toBe(2);
      expect(result.remappedAnswersCount).toBe(2);
      expect(result.importedMatchesCount).toBe(1);
      expect(result.importedPrizeClaimsCount).toBe(1);
      expect(result.importedLockoutsCount).toBe(1);

      const questions = await adminController.listAllQuestions();
      // Preserva as questões originais do Banco Central e adiciona apenas a questão nova.
      const expectedNewId = initialQuestionsCount + 1;
      expect(questions).toHaveLength(expectedNewId);
      const linkedIds = await cloudGateway.getEventQuestionIds(targetEvent.id);
      expect(linkedIds).toEqual([1, expectedNewId]);

      const matches = await cloudGateway.listMatches(targetEvent.id);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.answers.map((a) => a.questionId)).toEqual([1, expectedNewId]);

      const analytics = await adminController.queryAnalyticsDashboard({ eventId: targetEvent.id });
      expect(analytics.kpis.totalParticipations).toBe(1);
      expect(analytics.kpis.successRatePercent).toBe(100);
    });
  });
});
