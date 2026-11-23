import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryCloudGateway } from '../../adapters/inMemoryCloudGateway';
import { InMemoryLocalStore } from '../../adapters/inMemoryLocalStore';
import { DEFAULT_EVENT_ID } from '../../domain/defaults';
import { EventAdminController } from '../../domain/eventAdminController';
import type { Clock, RandomSource } from '../../domain/ports';
import { TotemSessionEngine } from '../../domain/totemSessionEngine';
import { AdminApp } from '../AdminApp';
import { AppRouter } from '../AppRouter';

class AdminUiClock implements Clock {
  private readonly baseMs = new Date('2026-11-16T12:00:00.000Z').getTime();

  now(): number {
    return this.baseMs;
  }

  toISOString(ms?: number): string {
    return new Date(ms ?? this.baseMs).toISOString();
  }
}

class AdminUiRandom implements RandomSource {
  private counter = 0;

  next(): number {
    return 0.25;
  }

  shuffle<T>(items: readonly T[]): T[] {
    return [...items];
  }

  uuid(): string {
    this.counter += 1;
    return `22222222-0000-4000-8000-0000000000${String(this.counter).padStart(2, '0')}`;
  }
}

function createAdminUiHarness() {
  const clock = new AdminUiClock();
  const random = new AdminUiRandom();
  const cloudGateway = new InMemoryCloudGateway({
    online: true,
    seedDefaultEvent: true,
    nowIso: () => clock.toISOString(),
  });
  const controller = new EventAdminController({ cloudGateway, clock, random });
  return { cloudGateway, controller };
}

async function signInThroughUi(email: string, password: string) {
  const user = userEvent.setup();
  const emailInput = screen.getByLabelText('E-mail');
  const passwordInput = screen.getByLabelText('Senha');
  await user.clear(emailInput);
  await user.type(emailInput, email);
  await user.clear(passwordInput);
  await user.type(passwordInput, password);
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
  return user;
}

describe('AdminApp (T4 - Autenticação, Multi-Evento, Banco de Questões e Dirty Check)', () => {
  it('restringe Operador à visão de estande e libera painel completo para Administrador', async () => {
    const { controller } = createAdminUiHarness();
    const { rerender } = render(<AdminApp controller={controller} />);

    // Login como Operador
    const user = await signInThroughUi('operador@caesb.df.gov.br', 'OPERADOR2025!');

    expect(await screen.findByText(/Visão do Operador de Estande/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Banco de Questões' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Equipe do Estande' })).not.toBeInTheDocument();

    // Logout e login como Administrador
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument();

    rerender(<AdminApp controller={controller} />);
    await signInThroughUi('admin@caesb.df.gov.br', 'CAESB2025!');

    const desktopNav = await screen.findByRole('navigation', { name: 'Navegação administrativa' });
    expect(within(desktopNav).getByRole('button', { name: 'Visão Geral' })).toBeInTheDocument();
    expect(within(desktopNav).getByRole('button', { name: 'Regras & Configurações' })).toBeInTheDocument();
    expect(within(desktopNav).getByRole('button', { name: 'Eventos' })).toBeInTheDocument();
    expect(within(desktopNav).getByRole('button', { name: 'Banco de Questões' })).toBeInTheDocument();
    expect(within(desktopNav).getByRole('button', { name: 'Equipe do Estande' })).toBeInTheDocument();

    // Cadastra novo membro na aba Equipe do Estande, promove e revoga acesso
    await user.click(screen.getByRole('button', { name: 'Equipe do Estande' }));
    await user.type(screen.getByLabelText('Nome Completo'), 'Carlos Operador');
    await user.type(screen.getByLabelText('E-mail'), 'carlos@caesb.df.gov.br');
    await user.type(screen.getByLabelText('Senha (mín. 6 caracteres)'), 'CAESB_OP_26');
    await user.click(screen.getByRole('button', { name: 'Cadastrar Membro' }));

    const staffDesktop = await screen.findByTestId('staff-desktop-table');
    expect(await within(staffDesktop).findByText('carlos@caesb.df.gov.br')).toBeInTheDocument();
    await user.selectOptions(
      within(staffDesktop).getByLabelText('Perfil de carlos@caesb.df.gov.br'),
      'admin',
    );
    expect(await screen.findByText(/Perfil de "Carlos Operador" atualizado/i)).toBeInTheDocument();

    const revokeButtons = within(staffDesktop).getAllByRole('button', { name: 'Revogar Acesso' });
    await user.click(revokeButtons[revokeButtons.length - 1]);
    const revokeDialog = await screen.findByRole('dialog');
    await user.click(within(revokeDialog).getByRole('button', { name: 'Confirmar Revogação' }));
    expect(await screen.findByText(/Acesso de "Carlos Operador" revogado/i)).toBeInTheDocument();
  });

  it('valida soma de percentuais 100%, clona Evento existente e exibe alerta de alterações não salvas', async () => {
    const { controller } = createAdminUiHarness();
    render(<AdminApp controller={controller} />);

    const user = await signInThroughUi('admin@caesb.df.gov.br', 'CAESB2025!');
    const desktopNav = await screen.findByRole('navigation', { name: 'Navegação administrativa' });
    await user.click(within(desktopNav).getByRole('button', { name: 'Regras & Configurações' }));
    expect(await screen.findByDisplayValue('Quiz Interativo CAESB')).toBeInTheDocument();

    // Altera percentual Fácil para gerar soma inválida (90%) e valida mensagem de erro
    const facilInput = screen.getByLabelText('Fácil (%)');
    fireEvent.change(facilInput, { target: { value: '30' } });
    expect(screen.getByText(/Soma atual: 90%/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Salvar Configurações' }));
    expect(
      await screen.findByText(/soma dos percentuais de dificuldade deve ser exatamente 100%/i),
    ).toBeInTheDocument();

    // Corrige percentual e tenta navegar para outra aba sem salvar -> deve abrir modal Dirty Check
    fireEvent.change(facilInput, { target: { value: '40' } });
    expect(screen.getByText(/Soma atual: 100%/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Banco de Questões' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Alterações Não Salvas' })).toBeInTheDocument();

    // Clicar em "Cancelar" mantém na aba Regras & Configurações
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByDisplayValue('Quiz Interativo CAESB')).toBeInTheDocument();

    // Clicar novamente e escolher "Salvar e Sair" salva o Evento e navega para Banco de Questões
    await user.click(screen.getByRole('button', { name: 'Banco de Questões' }));
    await user.click(await screen.findByRole('button', { name: 'Salvar e Sair' }));
    expect(await screen.findByText('Banco de Questões Central')).toBeInTheDocument();

    // Vai para Eventos e clona o Evento existente
    await user.click(screen.getByRole('button', { name: 'Eventos' }));
    const cloneButtons = await screen.findAllByRole('button', { name: 'Clonar Evento' });
    await user.click(cloneButtons[0]);
    const cloneInput = await screen.findByLabelText('Nome do Novo Evento');
    await user.clear(cloneInput);
    await user.type(cloneInput, 'Feira Sustentável 2026');
    await user.click(screen.getByRole('button', { name: 'Confirmar Clonagem' }));

    expect((await screen.findAllByText('Feira Sustentável 2026')).length).toBeGreaterThan(0);
  });

  it('filtra, pré-visualiza, opera em lote e importa questões no Banco de Questões', async () => {
    const { controller } = createAdminUiHarness();
    render(<AdminApp controller={controller} />);

    const user = await signInThroughUi('admin@caesb.df.gov.br', 'CAESB2025!');
    await user.click(await screen.findByRole('button', { name: 'Banco de Questões' }));
    expect(await screen.findByText('Banco de Questões Central')).toBeInTheDocument();

    // Filtro por dificuldade difícil
    await user.selectOptions(screen.getByLabelText('Filtrar por dificuldade'), 'dificil');
    await waitFor(() => {
      expect(screen.getByText(/2 resultado\(s\)/i)).toBeInTheDocument();
    });

    // Busca por enunciado
    await user.selectOptions(screen.getByLabelText('Filtrar por dificuldade'), 'all');
    await user.type(screen.getByPlaceholderText(/Buscar por enunciado/i), 'lago artificial');
    await waitFor(() => {
      expect(screen.getByText(/1 resultado\(s\)/i)).toBeInTheDocument();
    });

    // Pré-visualização no formato do Quiz
    const desktopQuestionsTable = screen.getByTestId('questions-desktop-table');
    await user.click(within(desktopQuestionsTable).getByRole('button', { name: 'Pré-visualizar' }));
    expect(await screen.findByRole('dialog', { name: 'Pré-visualização no Quiz' })).toBeInTheDocument();
    expect(screen.getByText('Correta')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fechar Pré-visualização' }));

    // Seleciona a questão encontrada e executa ação em lote (Desabilitar Selecionadas)
    await user.click(within(desktopQuestionsTable).getByLabelText('Selecionar questão #3'));
    await user.click(screen.getByRole('button', { name: 'Desabilitar Selecionadas' }));
    expect(await screen.findByText(/1 questão\(ões\) desabilitada\(s\)/i)).toBeInTheDocument();

    // Testa proteção de Dirty Check ao editar questão e tentar fechar o editor sem salvar
    await user.click(within(desktopQuestionsTable).getByRole('button', { name: 'Editar' }));
    const textInput = await screen.findByLabelText('Enunciado da Questão');
    await user.type(textInput, ' (editada)');
    await user.click(screen.getByRole('button', { name: 'Fechar Editor' }));
    expect(screen.getByRole('heading', { name: 'Alterações Não Salvas' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sair sem Salvar' }));
    expect(screen.queryByLabelText('Enunciado da Questão')).not.toBeInTheDocument();

    // Exclui individualmente a questão #3 na linha da listagem
    await user.click(within(desktopQuestionsTable).getByRole('button', { name: 'Excluir questão #3' }));
    expect(await screen.findByText(/Questão #3 excluída\./i)).toBeInTheDocument();

    // Importa JSON no modo mesclar
    await user.click(screen.getByRole('button', { name: 'Importar JSON / CSV' }));
    const textarea = await screen.findByLabelText('Conteúdo JSON ou CSV');
    const jsonPayload = JSON.stringify([
      {
        text: 'Nova questão importada via UI?',
        options: ['Sim', 'Não', 'Talvez', 'Nenhuma'],
        correctIndex: 0,
        difficulty: 'Fácil',
        tags: ['ui'],
      },
    ]);
    fireEvent.change(textarea, { target: { value: jsonPayload } });
    await user.click(screen.getByRole('button', { name: 'Executar Importação' }));

    expect(await screen.findByText(/Importação concluída: 1 questão\(ões\) processadas/i)).toBeInTheDocument();
  });

  it('separa rotas do Totem público, #admin e #operador sem expor atalho administrativo no Totem', async () => {
    window.location.hash = '';
    const { unmount } = render(<AppRouter />);
    expect(screen.queryByRole('button', { name: /Painel Admin/i })).not.toBeInTheDocument();
    unmount();

    window.location.hash = '#operador';
    const { unmount: unmountOp } = render(<AppRouter />);
    expect(
      await screen.findByRole('heading', { name: 'Operação do Estande' }),
    ).toBeInTheDocument();
    unmountOp();

    window.location.hash = '#admin';
    render(<AppRouter />);
    expect(
      await screen.findByRole('heading', { name: 'Painel Administrativo do Quiz' }),
    ).toBeInTheDocument();
    window.location.hash = '';
  });

  it('autoriza Pareamento de Totem, monitora telemetria ao vivo e envia comandos remotos', async () => {
    const clock = new AdminUiClock();
    const random = new AdminUiRandom();
    const cloudGateway = new InMemoryCloudGateway({
      online: true,
      seedDefaultEvent: true,
      nowIso: () => clock.toISOString(),
    });
    const controller = new EventAdminController({ cloudGateway, clock, random });
    const totemEngine = new TotemSessionEngine({
      localStore: new InMemoryLocalStore(),
      cloudGateway,
      clock,
      random,
      requirePairing: true,
    });
    const pendingSnap = await totemEngine.initialize();

    render(<AdminApp controller={controller} />);
    const user = await signInThroughUi('admin@caesb.df.gov.br', 'CAESB2025!');

    // Cria um segundo Evento para validar comando SWITCH_EVENT
    await user.click(await screen.findByRole('button', { name: 'Eventos' }));
    await user.click(await screen.findByRole('button', { name: 'Novo Evento' }));
    const newEventDialog = await screen.findByRole('dialog', { name: 'Novo Evento' });
    await user.type(within(newEventDialog).getByLabelText('Nome do Evento'), 'Expo Água Secundária');
    await user.click(within(newEventDialog).getByRole('button', { name: 'Criar Evento' }));
    expect((await screen.findAllByText('Expo Água Secundária')).length).toBeGreaterThan(0);

    // Navega para aba Totens e Pareamento
    await user.click(screen.getByRole('button', { name: 'Totens e Pareamento' }));
    expect(await screen.findByRole('heading', { name: 'Autorizar Pareamento de Totem' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Código de Pareamento'), pendingSnap.pairing.pairingCode!);
    await user.type(screen.getByLabelText('Nome do Totem'), 'Totem Hall A');
    await user.clear(screen.getByLabelText('PIN Local'));
    await user.type(screen.getByLabelText('PIN Local'), '2468');
    await user.selectOptions(screen.getByLabelText('Evento Vinculado'), DEFAULT_EVENT_ID);
    await user.click(screen.getByRole('button', { name: 'Autorizar Pareamento' }));

    const totemsDesktop = await screen.findByTestId('totems-desktop-table');
    expect(await within(totemsDesktop).findByText('Totem Hall A')).toBeInTheDocument();
    expect(document.getElementById('generated-activation-link')?.textContent).toContain(
      `?pairingCode=${pendingSnap.pairing.pairingCode}`,
    );
    expect(within(totemsDesktop).getByText('Online')).toBeInTheDocument();
    expect(within(totemsDesktop).getByText('Tela: Inicial')).toBeInTheDocument();
    expect(within(totemsDesktop).getByText(/Fila local: 0 item\(ns\)/i)).toBeInTheDocument();

    // Totem inicia Partida -> monitoramento atualiza ao vivo para Em Partida
    await act(async () => {
      await totemEngine.startMatch('FELIPE', '(61) 98888-0001');
    });
    expect(await within(totemsDesktop).findByText('Tela: Em Partida')).toBeInTheDocument();

    // Encerra Partida via desistência e testa comandos remotos individuais
    await act(async () => {
      await totemEngine.giveUpMatch();
    });
    expect(await within(totemsDesktop).findByText('Tela: Inicial')).toBeInTheDocument();

    const rowSelect = screen.getByLabelText('Trocar Evento de Totem Hall A');
    const secondaryEventOption = Array.from(rowSelect.querySelectorAll('option')).find(
      (opt) => opt.textContent === 'Expo Água Secundária',
    );
    expect(secondaryEventOption).toBeDefined();
    await user.selectOptions(rowSelect, secondaryEventOption!.value);

    const rowButtons = screen.getAllByRole('button', { name: 'Trocar Evento' });
    await user.click(rowButtons[0]);
    expect(await screen.findByText(/Comando Trocar Evento enviado para "Totem Hall A"/i)).toBeInTheDocument();
    expect(totemEngine.getSnapshot().event.name).toBe('Expo Água Secundária');

    const syncButtons = screen.getAllByRole('button', { name: 'Forçar Sincronização' });
    await user.click(syncButtons[0]);
    expect(await screen.findByText(/Comando Forçar Sincronização enviado para "Totem Hall A"/i)).toBeInTheDocument();

    const reloadTargetSelect = screen.getByLabelText('Tela de reinício de Totem Hall A');
    await user.selectOptions(reloadTargetSelect, 'idle-screen');
    const reloadButtons = screen.getAllByRole('button', { name: 'Reiniciar Tela' });
    await user.click(reloadButtons[0]);
    expect(await screen.findByText(/Comando Reiniciar Tela enviado para "Totem Hall A"/i)).toBeInTheDocument();
    expect(totemEngine.getSnapshot().screen).toBe('idle-screen');
  });

  it('opera painel móvel do Operador (#operador) com fila de Brindes, Conflito Offline, Ranking, Despremiar e Destravar', async () => {
    const { cloudGateway, controller } = createAdminUiHarness();
    const [defaultEvent] = await cloudGateway.listEvents();
    await cloudGateway.saveEvent({
      ...defaultEvent!,
      prizeStockRemaining: 8,
    });

    await cloudGateway.pushMatch({
      idempotencyKey: 'op-m-1',
      match: {
        id: 'op-match-1',
        eventId: DEFAULT_EVENT_ID,
        totemId: 'totem-1',
        participantName: 'FERNANDA BRINDE',
        participantPhone: '(61) 99222-1111',
        score: 5,
        totalQuestions: 5,
        timeSeconds: 19,
        answers: [],
        playedAt: '2026-11-16T10:30:00.000Z',
      },
      prizeClaim: {
        id: 'op-claim-1',
        eventId: DEFAULT_EVENT_ID,
        matchId: 'op-match-1',
        totemId: 'totem-1',
        participantName: 'FERNANDA BRINDE',
        participantPhone: '(61) 99222-1111',
        status: 'awaiting_pickup',
        awardedAt: '2026-11-16T10:30:00.000Z',
        deliveredAt: null,
      },
    });

    await cloudGateway.pushMatch({
      idempotencyKey: 'op-m-2',
      match: {
        id: 'op-match-2',
        eventId: DEFAULT_EVENT_ID,
        totemId: 'totem-2',
        participantName: 'FERNANDA CONFLITO',
        participantPhone: '(61) 99222-1111',
        score: 4,
        totalQuestions: 5,
        timeSeconds: 22,
        answers: [],
        playedAt: '2026-11-16T10:40:00.000Z',
      },
      prizeClaim: {
        id: 'op-claim-2',
        eventId: DEFAULT_EVENT_ID,
        matchId: 'op-match-2',
        totemId: 'totem-2',
        participantName: 'FERNANDA CONFLITO',
        participantPhone: '(61) 99222-1111',
        status: 'awaiting_pickup',
        awardedAt: '2026-11-16T10:40:00.000Z',
        deliveredAt: null,
      },
    });

    await cloudGateway.pushGiveUpLockout({
      idempotencyKey: 'op-lock-1',
      lockout: {
        id: 'lockout-op-1',
        eventId: DEFAULT_EVENT_ID,
        totemId: 'totem-1',
        participantPhone: '(61) 98333-4444',
        lockedAt: '2026-11-16T11:50:00.000Z',
        expiresAt: '2026-11-16T12:20:00.000Z',
      },
    });

    render(<AdminApp controller={controller} routeMode="operator" />);
    const user = await signInThroughUi('operador@caesb.df.gov.br', 'OPERADOR2025!');

    const conflictAlert = await screen.findByRole('alert');
    expect(within(conflictAlert).getByText(/Conflito de Premiação Offline/i)).toBeInTheDocument();
    expect(screen.getByText(/Fila Aguardando Retirada \(1\)/i)).toBeInTheDocument();

    const operatorNav = screen.getByRole('navigation', { name: 'Navegação do operador' });

    // Confirma entrega única via botão Entregue no alerta de conflito
    await user.click(within(conflictAlert).getByRole('button', { name: 'Entregue' }));
    expect(await screen.findByText(/Brinde entregue para "FERNANDA BRINDE"/i)).toBeInTheDocument();

    const claimsAfterDelivery = await cloudGateway.listPrizeClaims(DEFAULT_EVENT_ID);
    expect(claimsAfterDelivery.filter((c) => c.status === 'delivered')).toHaveLength(1);
    expect(claimsAfterDelivery.filter((c) => c.status === 'offline_duplicate_conflict')).toHaveLength(1);

    // Nova Partida sincronizada após montagem atualiza Ranking ao Vivo automaticamente em tempo real
    await act(async () => {
      await cloudGateway.pushMatch({
        idempotencyKey: 'op-m-live',
        match: {
          id: 'op-match-live',
          eventId: DEFAULT_EVENT_ID,
          totemId: 'totem-1',
          participantName: 'LUCAS TEMPO REAL',
          participantPhone: '(61) 99444-7777',
          score: 3,
          totalQuestions: 5,
          timeSeconds: 25,
          answers: [],
          playedAt: '2026-11-16T12:01:00.000Z',
        },
        prizeClaim: null,
      });
    });
    await user.click(within(operatorNav).getByRole('button', { name: /Ranking/i }));
    expect(await screen.findByText(/Ranking ao Vivo \(3\)/i)).toBeInTheDocument();
    expect(screen.getAllByText('LUCAS TEMPO REAL').length).toBeGreaterThanOrEqual(1);

    // Alterna para aba Participantes, destrava telefone bloqueado por desistência e despremiar
    await user.click(within(operatorNav).getByRole('button', { name: /Participantes/i }));
    await user.click(await screen.findByRole('button', { name: 'Destravar' }));
    expect(
      await screen.findByText(/Telefone \(61\) 98333-4444 destravado no Evento/i),
    ).toBeInTheDocument();

    // Busca rápida e Despremiar
    await user.type(screen.getByLabelText('Buscar por Nome ou Telefone'), 'FERNANDA BRINDE');
    const revokeBtns = screen.getAllByRole('button', { name: 'Despremiar' });
    await user.click(revokeBtns[0]!);
    expect(await screen.findByText(/Brinde despremiado/i)).toBeInTheDocument();
  });

  it('filtra, ordena, abre detalhes da Partida, executa ações em lote e exporta CSV/JSON nos Relatórios do Admin', async () => {
    const { cloudGateway, controller } = createAdminUiHarness();

    await cloudGateway.pushMatch({
      idempotencyKey: 'rep-1',
      match: {
        id: 'rep-match-1',
        eventId: DEFAULT_EVENT_ID,
        totemId: 'totem-1',
        participantName: 'GUSTAVO RELATORIO',
        participantPhone: '(61) 99444-5555',
        score: 4,
        totalQuestions: 5,
        timeSeconds: 21,
        answers: [
          {
            questionId: 10,
            questionText: 'Qual o papel da CAESB?',
            options: ['Água e Esgoto', 'Energia', 'Gás', 'Telecom'],
            selectedOptionText: 'Água e Esgoto',
            correctOptionIndex: 0,
            correctOptionText: 'Água e Esgoto',
            isCorrect: true,
          },
          {
            questionId: 11,
            questionText: 'O que economiza água?',
            options: ['Fechar a torneira', 'Mangueira aberta', 'Vazamento', 'Nenhum'],
            selectedOptionText: 'Mangueira aberta',
            correctOptionIndex: 0,
            correctOptionText: 'Fechar a torneira',
            isCorrect: false,
          },
        ],
        playedAt: '2026-11-16T09:15:00.000Z',
      },
      prizeClaim: {
        id: 'rep-claim-1',
        eventId: DEFAULT_EVENT_ID,
        matchId: 'rep-match-1',
        totemId: 'totem-1',
        participantName: 'GUSTAVO RELATORIO',
        participantPhone: '(61) 99444-5555',
        status: 'awaiting_pickup',
        awardedAt: '2026-11-16T09:15:00.000Z',
        deliveredAt: null,
      },
    });

    await cloudGateway.pushMatch({
      idempotencyKey: 'rep-2',
      match: {
        id: 'rep-match-2',
        eventId: DEFAULT_EVENT_ID,
        totemId: 'totem-1',
        participantName: 'HELENA SEM BRINDE',
        participantPhone: '(61) 99555-6666',
        score: 1,
        totalQuestions: 5,
        timeSeconds: 30,
        answers: [],
        playedAt: '2026-11-15T14:00:00.000Z',
      },
      prizeClaim: null,
    });

    const csvSpy = vi.spyOn(controller, 'exportParticipantsCsv');
    const jsonSpy = vi.spyOn(controller, 'exportParticipantsJson');

    render(<AdminApp controller={controller} />);
    const user = await signInThroughUi('admin@caesb.df.gov.br', 'CAESB2025!');

    await user.click(await screen.findByRole('button', { name: 'Participantes & Ranking' }));
    expect(
      await screen.findByRole('heading', { name: 'Participantes & Ranking' }),
    ).toBeInTheDocument();

    const desktopReportsTable = await screen.findByTestId('reports-desktop-table');
    expect(within(desktopReportsTable).getByText('GUSTAVO RELATORIO')).toBeInTheDocument();
    expect(within(desktopReportsTable).getByText('HELENA SEM BRINDE')).toBeInTheDocument();

    // Abre modal de detalhes e verifica Respostas e contagem de Partidas
    const detailsBtns = within(desktopReportsTable).getAllByRole('button', { name: 'Ver Detalhes' });
    await user.click(detailsBtns[0]!);
    const modal = await screen.findByRole('dialog');
    expect(within(modal).getByText(/Detalhes da Partida · GUSTAVO RELATORIO/i)).toBeInTheDocument();
    expect(within(modal).getByText(/Partidas do telefone no Evento/i)).toBeInTheDocument();
    expect(within(modal).getByText(/Alternativa correta: Fechar a torneira/i)).toBeInTheDocument();
    await user.click(within(modal).getByRole('button', { name: 'Fechar' }));

    // Ação em lote: selecionar GUSTAVO e confirmar entrega
    await user.click(
      within(desktopReportsTable).getByLabelText('Selecionar Partida de GUSTAVO RELATORIO'),
    );
    await user.click(screen.getByRole('button', { name: 'Confirmar Entrega' }));
    expect(await screen.findByText(/1 entrega\(s\) de Brinde confirmada\(s\)/i)).toBeInTheDocument();

    // Exportar CSV e JSON com filtro aplicado
    await user.selectOptions(screen.getByLabelText('Status do Brinde'), 'non_winners');
    expect(within(desktopReportsTable).queryByText('GUSTAVO RELATORIO')).not.toBeInTheDocument();
    expect(within(desktopReportsTable).getByText('HELENA SEM BRINDE')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    expect(csvSpy).toHaveBeenCalled();
    expect(await screen.findByText(/Relatório exportado em formato CSV/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Exportar JSON' }));
    expect(jsonSpy).toHaveBeenCalled();
    expect(await screen.findByText(/Relatório exportado em formato JSON/i)).toBeInTheDocument();

    // Excluir Partida via ação em lote
    await user.click(
      within(desktopReportsTable).getByLabelText('Selecionar Partida de HELENA SEM BRINDE'),
    );
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(
      await screen.findByText(/1 Partida\(s\) excluída\(s\) com atualização nos Totens/i),
    ).toBeInTheDocument();
  });

  it('aplica tema da galeria, personaliza textos, faz upload com opacidade, restaura por seção e reflete na pré-visualização ao vivo (T7)', async () => {
    const { cloudGateway, controller } = createAdminUiHarness();
    render(<AdminApp controller={controller} />);
    const user = await signInThroughUi('admin@caesb.df.gov.br', 'CAESB2025!');

    await user.click(await screen.findByRole('button', { name: 'Personalização Visual' }));
    expect(
      await screen.findByRole('heading', { name: 'Personalização Visual do Evento' }),
    ).toBeInTheDocument();

    // Aplica tema Escuro Elegante e verifica reflexo imediato na pré-visualização ao vivo
    await user.click(screen.getByRole('button', { name: 'Escuro Elegante' }));
    const preview = document.getElementById('customization-live-preview')!;
    expect(preview.style.backgroundColor).toBe('rgb(26, 26, 46)');

    // Edita texto e alterna abas da pré-visualização (Inicial, Quiz, Resultado)
    const titleInput = screen.getByLabelText('Título da Tela Inicial');
    await user.clear(titleInput);
    await user.type(titleInput, 'Quiz Especial Águas');
    expect(within(preview).getByText('Quiz Especial Águas')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Tela de Quiz' }));
    expect(within(preview).getByText(/principal serviço prestado pela CAESB/i)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Tela de Resultado' }));
    expect(within(preview).getByText('MARIA CLARA,')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Tela Inicial' }));

    // Upload de logotipo e ajuste de opacidade do fundo
    const logoFile = new File([new Uint8Array([137, 80, 78, 71])], 'logo-evento.png', {
      type: 'image/png',
    });
    await user.upload(screen.getByLabelText('Upload de Logotipo'), logoFile);
    expect(await screen.findByText(/Logotipo enviado para a nuvem/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Opacidade do Plano de Fundo/i), {
      target: { value: '60' },
    });
    expect(screen.getByText(/Opacidade do Plano de Fundo \(60%\)/i)).toBeInTheDocument();

    // Restauração parcial de textos preserva o tema Escuro Elegante
    await user.click(screen.getByRole('button', { name: 'Restaurar Textos' }));
    expect(within(preview).getByText('Bem-vindo ao Quiz!')).toBeInTheDocument();
    expect(preview.style.backgroundColor).toBe('rgb(26, 26, 46)');

    // Salva personalização e valida persistência no Evento
    await user.click(screen.getByRole('button', { name: 'Salvar Personalização' }));
    expect(await screen.findByText(/Personalização visual salva/i)).toBeInTheDocument();

    const [savedEvent] = await cloudGateway.listEvents();
    expect(savedEvent?.customizations.colors.quizMainBackground).toBe('#1a1a2e');
    expect(savedEvent?.customizations.visualIdentity.logoUrl).toContain('logo-evento.png');
    expect(savedEvent?.customizations.visualIdentity.customBackgroundOpacity).toBe(0.6);
  });

  it('abre Modo Desenvolvedor / Simulador isolado e simula telas, modais e estados temporais sem afetar métricas reais (T7)', async () => {
    const { cloudGateway, controller } = createAdminUiHarness();
    render(<AdminApp controller={controller} />);
    const user = await signInThroughUi('admin@caesb.df.gov.br', 'CAESB2025!');

    await user.click(await screen.findByRole('button', { name: 'Modo Desenvolvedor / Simulador' }));
    const simDialog = await screen.findByRole('dialog');
    expect(
      within(simDialog).getByRole('heading', { name: 'Modo Desenvolvedor / Simulador Isolado' }),
    ).toBeInTheDocument();

    await user.click(within(simDialog).getByRole('button', { name: 'Antes do Início' }));
    expect(await within(simDialog).findByText(/Estado temporal simulado: before/i)).toBeInTheDocument();

    await user.click(within(simDialog).getByRole('button', { name: 'Durante' }));
    await user.click(within(simDialog).getByRole('button', { name: 'Já Ganhou Brinde' }));
    expect(await within(simDialog).findByText(/Modal simulado: Já Ganhou Brinde/i)).toBeInTheDocument();
    expect(await within(simDialog).findByText(/Segura a emoção, campeão\(ã\)!/i)).toBeInTheDocument();

    await user.click(within(simDialog).getByRole('button', { name: 'Ganhador #1' }));
    expect(await within(simDialog).findByText(/Cenário simulado: winner_top1/i)).toBeInTheDocument();

    // Nenhuma Partida simulada deve contaminar o CloudGateway real
    expect(await cloudGateway.listMatches()).toHaveLength(0);
    expect(await cloudGateway.listPrizeClaims()).toHaveLength(0);

    await user.click(within(simDialog).getByRole('button', { name: 'Fechar Simulador' }));
    expect(document.getElementById('dev-simulator-window')).not.toBeInTheDocument();
  });

  it('exibe Dashboard Analítico, Estatísticas de Questões e importa backup legado quiz-offline (T8)', async () => {
    const { cloudGateway, controller } = createAdminUiHarness();

    await cloudGateway.pushMatch({
      idempotencyKey: 't8-ui-1',
      match: {
        id: 't8-match-1',
        eventId: DEFAULT_EVENT_ID,
        totemId: 'totem-1',
        participantName: 'VICTOR ANALITICO',
        participantPhone: '(61) 99777-8888',
        score: 8,
        totalQuestions: 10,
        timeSeconds: 40,
        answers: [
          {
            questionId: 1,
            questionText: 'O que significa a sigla Caesb?',
            options: ['A', 'B', 'C', 'D'],
            selectedOptionText: 'B',
            correctOptionIndex: 1,
            correctOptionText: 'B',
            isCorrect: true,
          },
        ],
        playedAt: '2026-11-16T10:00:00.000Z',
      },
      prizeClaim: null,
    });

    render(<AdminApp controller={controller} />);
    const user = await signInThroughUi('admin@caesb.df.gov.br', 'CAESB2025!');

    // Análises & Questões (unificado)
    await user.click(await screen.findByRole('button', { name: 'Análises & Questões' }));
    expect(await screen.findByRole('heading', { name: 'Análises & Questões' })).toBeInTheDocument();
    expect(await screen.findByText('Participações ao Longo do Tempo')).toBeInTheDocument();
    expect(screen.getByText('Distribuição de Pontuações')).toBeInTheDocument();
    expect(screen.getByText('Engajamento por Hora do Dia')).toBeInTheDocument();

    // Clica na linha da questão para abrir detalhes, edita e fecha
    const desktopAnalyticsQuestions = await screen.findByTestId('analytics-questions-desktop-table');
    const q1Row = await within(desktopAnalyticsQuestions).findByText(/O que significa a sigla Caesb\?/i);
    await user.click(q1Row);
    const qModal = await screen.findByRole('dialog');
    expect(within(qModal).getByText(/Detalhes da Questão #1/i)).toBeInTheDocument();
    await user.click(within(qModal).getByRole('button', { name: 'Editar Questão' }));
    await user.click(within(qModal).getByRole('button', { name: 'Salvar Edição' }));
    expect(await screen.findByText(/Questão #1 atualizada com sucesso/i)).toBeInTheDocument();
    await user.click(within(qModal).getByRole('button', { name: 'Fechar' }));

    // Botão direto Desabilitar na visão unificada
    const disableBtns = await within(desktopAnalyticsQuestions).findAllByRole('button', {
      name: 'Desabilitar',
    });
    await user.click(disableBtns[0]!);
    expect(await screen.findByText(/Questão #\d+ desabilitada\./i)).toBeInTheDocument();

    // Backup e Migração Legada
    const exportSpy = vi.spyOn(controller, 'exportFullBackup');
    await user.click(screen.getByRole('button', { name: 'Backup e Migração' }));
    expect(
      await screen.findByRole('heading', {
        name: /Backup, Restauração e Migração Legada/i,
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Exportar Backup Completo (JSON)' }));
    expect(exportSpy).toHaveBeenCalled();
    expect(await screen.findByText(/Backup completo exportado em JSON/i)).toBeInTheDocument();

    const legacyJson = JSON.stringify({
      quizQuestions: [
        {
          id: 'q1',
          text: 'Questão Legada UI',
          options: ['A', 'B', 'C', 'D'],
          correct: 0,
          difficulty: 'facil',
        },
      ],
      quizParticipants: [
        {
          name: 'PAULO LEGADO UI',
          phone: '(61) 99666-0001',
          score: 1,
          time: 12,
          timestamp: '2025-05-25T15:00:00.000Z',
          playerAttempts: [
            {
              questionId: 'q1',
              selectedOptionText: 'A',
              isCorrect: true,
            },
          ],
        },
      ],
      quizSettings: { numberOfQuestions: 1, minScoreForPrize: 1 },
    });

    const backupFile = new File([legacyJson], 'fitabes-2025.json', {
      type: 'application/json',
    });
    await user.upload(screen.getByLabelText('Arquivo de Backup (JSON)'), backupFile);
    await user.click(screen.getByRole('button', { name: 'Restaurar Backup' }));

    const confirmModal = await screen.findByRole('dialog');
    await user.click(within(confirmModal).getByRole('button', { name: 'Confirmar Restauração' }));
    expect(await screen.findByText(/Backup legado migrado: 1 questão\(ões\)/i)).toBeInTheDocument();
  });

  it('exibe KPI correto de participantes únicos quando o mesmo telefone joga múltiplas Partidas na Visão Geral', async () => {
    const clock = new AdminUiClock();
    const cloudGateway = new InMemoryCloudGateway({
      online: true,
      seedDefaultEvent: true,
      nowIso: () => clock.toISOString(),
    });
    const controller = new EventAdminController({
      cloudGateway,
      clock,
      random: new AdminUiRandom(),
    });

    const [defaultEvent] = await cloudGateway.listEvents();
    await cloudGateway.pushMatch({
      idempotencyKey: 'kpi-match-1',
      match: {
        id: 'kpi-match-1',
        eventId: defaultEvent!.id,
        totemId: null,
        participantName: 'JOANA',
        participantPhone: '(61) 99999-8888',
        score: 2,
        totalQuestions: 5,
        timeSeconds: 30,
        answers: [],
        playedAt: '2026-11-16T11:50:00.000Z',
        syncedAt: '2026-11-16T11:50:02.000Z',
      },
    });
    await cloudGateway.pushMatch({
      idempotencyKey: 'kpi-match-2',
      match: {
        id: 'kpi-match-2',
        eventId: defaultEvent!.id,
        totemId: null,
        participantName: 'JOANA DUPLICADA',
        participantPhone: '(61) 99999-8888',
        score: 4,
        totalQuestions: 5,
        timeSeconds: 20,
        answers: [],
        playedAt: '2026-11-16T11:55:00.000Z',
        syncedAt: '2026-11-16T11:55:02.000Z',
      },
    });

    render(<AdminApp controller={controller} />);
    const user = await signInThroughUi('admin@caesb.df.gov.br', 'CAESB2025!');
    await user.click(await screen.findByRole('button', { name: 'Visão Geral' }));

    const kpis = await screen.findByTestId('overview-kpis');
    expect(within(kpis).getByText('2')).toBeInTheDocument();
    expect(within(kpis).getByText('1 participante(s) único(s)')).toBeInTheDocument();
  });
});

describe('AdminApp — Layout das Telas', () => {
  it('edita o layout da Tela Inicial e da Tela de Descanso, muda a resolução da prévia e salva no Evento', async () => {
    const { cloudGateway, controller } = createAdminUiHarness();
    render(<AdminApp controller={controller} />);
    const user = await signInThroughUi('admin@caesb.df.gov.br', 'CAESB2025!');

    await user.click(await screen.findByRole('button', { name: 'Layout das Telas' }));
    expect(
      await screen.findByRole('heading', { name: 'Layout das Telas do Totem' }),
    ).toBeInTheDocument();

    // Prévia usa a resolução do Totem por padrão e permite resolução personalizada
    const stage = screen.getByTestId('layout-preview-stage');
    expect(stage.style.width).toBe('1080px');
    expect(stage.style.height).toBe('1920px');
    await user.selectOptions(screen.getByLabelText('Resolução da prévia'), 'custom');
    fireEvent.change(screen.getByLabelText('Largura'), { target: { value: '1920' } });
    fireEvent.change(screen.getByLabelText('Altura'), { target: { value: '1080' } });
    expect(screen.getByTestId('layout-preview-stage').style.width).toBe('607.5px');

    // Move o botão Iniciar Quiz para a base: prévia reflete na zona correspondente
    const bottomZone = () =>
      document.querySelector('[data-testid="layout-preview-stage"] [data-layout-zone="bottom"]')!;
    expect(bottomZone().querySelector('#start-quiz-btn')).toBeNull();
    const startRow = screen.getByTestId('layout-element-startButton');
    await user.click(within(startRow).getByRole('button', { name: 'Base' }));
    expect(bottomZone().querySelector('#start-quiz-btn')).not.toBeNull();
    // Elementos obrigatórios não podem ser ocultados
    expect(
      within(startRow).getByRole('button', { name: 'Ocultar Botão Iniciar Quiz' }),
    ).toBeDisabled();

    // Tela de Descanso: oculta a vitrine e ajusta o tamanho do logotipo
    await user.click(screen.getByRole('tab', { name: 'Tela de Descanso' }));
    const showcaseRow = screen.getByTestId('layout-element-showcase');
    await user.click(within(showcaseRow).getByRole('button', { name: 'Ocultar Vitrine (pódio e estatísticas)' }));
    expect(document.querySelector('[data-testid="layout-preview-stage"] .idle-showcase-card')).toBeNull();
    await user.click(within(screen.getByTestId('layout-element-logo')).getByText('Logotipo'));
    fireEvent.change(screen.getByLabelText(/Tamanho \(100%\)/), { target: { value: '150' } });

    await user.click(screen.getByRole('button', { name: 'Salvar Layout' }));
    expect(await screen.findByText(/Layout das telas salvo/i)).toBeInTheDocument();

    const [savedEvent] = await cloudGateway.listEvents();
    expect(savedEvent?.customizations.layout?.screens.initial?.elements).toMatchObject({
      startButton: { zone: 'bottom' },
    });
    expect(savedEvent?.customizations.layout?.screens.idle?.elements).toMatchObject({
      showcase: { visible: false },
      logo: { scalePercent: 150 },
    });
    // Salvar o layout não altera a aparência
    expect(savedEvent?.customizations.colors.quizMainBackground).toBe('#002244');
  });
});
