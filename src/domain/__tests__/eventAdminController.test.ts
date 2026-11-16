import { describe, expect, it } from 'vitest';
import { InMemoryCloudGateway } from '../../adapters/inMemoryCloudGateway';
import { InMemoryLocalStore } from '../../adapters/inMemoryLocalStore';
import { DEFAULT_EVENT_ID } from '../defaults';
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

  describe('Dirty Check (Alerta de Alterações Não Salvas)', () => {
    it('solicita confirmação com opções Salvar e Sair, Sair sem Salvar ou Cancelar quando há alterações pendentes', async () => {
      const { controller } = createAdminHarness();

      expect(controller.checkUnsavedNavigation().canProceedImmediately).toBe(true);

      controller.markDirty('event');
      controller.markDirty('settings');

      const prompt = controller.checkUnsavedNavigation();
      expect(prompt.canProceedImmediately).toBe(false);
      expect(prompt.dirtySections).toEqual(['event', 'settings']);
      expect(prompt.options).toEqual(['save_and_leave', 'discard_and_leave', 'cancel']);

      // Cancelar mantém o usuário na tela com alterações pendentes.
      const cancelled = await controller.resolveUnsavedNavigation('cancel');
      expect(cancelled).toBe(false);
      expect(controller.isDirty()).toBe(true);

      // Salvar e Sair executa callback de salvamento e limpa dirty.
      let saved = false;
      const savedAndLeft = await controller.resolveUnsavedNavigation('save_and_leave', async () => {
        saved = true;
      });
      expect(saved).toBe(true);
      expect(savedAndLeft).toBe(true);
      expect(controller.isDirty()).toBe(false);

      // Sair sem Salvar limpa dirty sem salvar.
      controller.markDirty('question');
      const discarded = await controller.resolveUnsavedNavigation('discard_and_leave');
      expect(discarded).toBe(true);
      expect(controller.isDirty()).toBe(false);
    });
  });
});
