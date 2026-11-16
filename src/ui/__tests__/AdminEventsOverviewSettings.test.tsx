import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryCloudGateway } from '../../adapters/inMemoryCloudGateway';
import { DEFAULT_EVENT_ID } from '../../domain/defaults';
import { EventAdminController } from '../../domain/eventAdminController';
import type { Clock, RandomSource } from '../../domain/ports';
import { AdminApp } from '../AdminApp';

class Issue12Clock implements Clock {
  private readonly baseMs = new Date('2026-11-16T12:00:00.000Z').getTime();
  now(): number {
    return this.baseMs;
  }
  toISOString(ms?: number): string {
    return new Date(ms ?? this.baseMs).toISOString();
  }
}

class Issue12Random implements RandomSource {
  private counter = 0;
  next(): number {
    return 0.5;
  }
  shuffle<T>(items: readonly T[]): T[] {
    return [...items];
  }
  uuid(): string {
    this.counter += 1;
    return `44444444-0000-4000-8000-0000000000${String(this.counter).padStart(2, '0')}`;
  }
}

function createHarness() {
  const clock = new Issue12Clock();
  const random = new Issue12Random();
  const cloudGateway = new InMemoryCloudGateway({
    online: true,
    seedDefaultEvent: true,
    nowIso: () => clock.toISOString(),
  });
  const controller = new EventAdminController({ cloudGateway, clock, random });
  return { cloudGateway, controller, clock, random };
}

async function signInAdmin(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('E-mail'), 'admin@caesb.df.gov.br');
  await user.type(screen.getByLabelText('Senha'), 'CAESB2025!');
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
}

describe('Issue #12 — Gestão de Eventos, Visão Geral e Regras & Configurações', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.location.hash = '';
  });

  it('lista Eventos em tabela desktop e cards mobile, cria, clona e ativa/desativa Eventos', async () => {
    const { controller } = createHarness();
    const user = userEvent.setup();
    window.location.hash = '#admin';
    render(<AdminApp controller={controller} />);

    await signInAdmin(user);
    await user.click(await screen.findByRole('button', { name: 'Eventos' }));
    expect(window.location.hash).toBe('#admin/eventos');

    const desktopTable = await screen.findByTestId('events-desktop-table');
    const mobileCards = screen.getByTestId('events-mobile-cards');

    expect(within(desktopTable).getByRole('table')).toBeInTheDocument();
    expect(within(desktopTable).getByText('Quiz Interativo CAESB')).toBeInTheDocument();
    expect(within(mobileCards).getByText('Quiz Interativo CAESB')).toBeInTheDocument();

    // Criar novo Evento
    await user.click(screen.getByRole('button', { name: /Novo Evento/i }));
    const createDialog = await screen.findByRole('dialog', { name: /Novo Evento/i });
    await user.type(within(createDialog).getByLabelText('Nome do Evento'), 'Feira das Águas 2026');
    await user.click(within(createDialog).getByRole('button', { name: 'Criar Evento' }));

    expect(await within(desktopTable).findByText('Feira das Águas 2026')).toBeInTheDocument();
    expect(within(mobileCards).getByText('Feira das Águas 2026')).toBeInTheDocument();

    // Clonar Evento existente
    const cloneButtons = within(desktopTable).getAllByRole('button', { name: /Clonar/i });
    await user.click(cloneButtons[0]);
    const cloneDialog = await screen.findByRole('dialog', { name: /Clonar Evento/i });
    const cloneNameInput = within(cloneDialog).getByLabelText('Nome do Novo Evento');
    await user.clear(cloneNameInput);
    await user.type(cloneNameInput, 'Feira Sustentável 2026');
    await user.click(within(cloneDialog).getByRole('button', { name: 'Confirmar Clonagem' }));

    expect(await within(desktopTable).findByText('Feira Sustentável 2026')).toBeInTheDocument();

    // Desativar e reativar Evento
    const deactivateButtons = within(desktopTable).getAllByRole('button', { name: /Encerrar/i });
    await user.click(deactivateButtons[0]);
    expect(await within(desktopTable).findByText('Encerrado')).toBeInTheDocument();

    const activateButton = within(desktopTable).getByRole('button', { name: /Ativar/i });
    await user.click(activateButton);
    expect(within(desktopTable).queryByText('Encerrado')).not.toBeInTheDocument();
  });

  it('exibe KPIs, status dos Totens, fila de Brindes Aguardando Retirada e resolve Conflito de Premiação Offline na Visão Geral', async () => {
    const { cloudGateway, controller, clock } = createHarness();

    // Pareia um Totem vinculado ao evento padrão
    await controller.login('admin@caesb.df.gov.br', 'CAESB2025!');
    const totem = await controller.authorizeTotemPairing({
      name: 'Totem Hall Principal',
      pinCode: '1234',
      eventId: DEFAULT_EVENT_ID,
    });
    await controller.logout();

    // Atualiza telemetria para online
    await cloudGateway.publishTotemHeartbeat({
      totemId: totem.id,
      deviceToken: totem.deviceToken,
      eventId: DEFAULT_EVENT_ID,
      onlineStatus: 'online',
      currentScreen: 'initial-screen',
      configVersion: 1,
      pendingSyncCount: 0,
      seenAt: clock.toISOString(),
    });

    // Semeia partida com Brinde Aguardando Retirada (Maria Silva)
    await cloudGateway.pushMatch({
      idempotencyKey: 'idem-maria-1',
      match: {
        id: 'match-maria-1',
        eventId: DEFAULT_EVENT_ID,
        totemId: totem.id,
        participantName: 'MARIA SILVA',
        participantPhone: '(61) 99999-1111',
        score: 8,
        totalQuestions: 10,
        timeSeconds: 42,
        answers: [],
        playedAt: '2026-11-16T11:30:00.000Z',
        syncedAt: '2026-11-16T11:30:05.000Z',
      },
      prizeClaim: {
        id: 'claim-maria-1',
        eventId: DEFAULT_EVENT_ID,
        matchId: 'match-maria-1',
        totemId: totem.id,
        participantName: 'MARIA SILVA',
        participantPhone: '(61) 99999-1111',
        status: 'awaiting_pickup',
        awardedAt: '2026-11-16T11:30:00.000Z',
        deliveredAt: null,
      },
    });

    // Semeia Conflito de Premiação Offline (João Conflito)
    await cloudGateway.pushMatch({
      idempotencyKey: 'idem-joao-1',
      match: {
        id: 'match-joao-1',
        eventId: DEFAULT_EVENT_ID,
        totemId: totem.id,
        participantName: 'JOÃO CONFLITO',
        participantPhone: '(61) 98888-2222',
        score: 9,
        totalQuestions: 10,
        timeSeconds: 39,
        answers: [],
        playedAt: '2026-11-16T11:40:00.000Z',
        syncedAt: '2026-11-16T11:40:05.000Z',
      },
      prizeClaim: {
        id: 'claim-joao-1',
        eventId: DEFAULT_EVENT_ID,
        matchId: 'match-joao-1',
        totemId: totem.id,
        participantName: 'JOÃO CONFLITO',
        participantPhone: '(61) 98888-2222',
        status: 'delivered',
        awardedAt: '2026-11-16T11:40:00.000Z',
        deliveredAt: '2026-11-16T11:40:00.000Z',
      },
    });

    await cloudGateway.pushMatch({
      idempotencyKey: 'idem-joao-2',
      match: {
        id: 'match-joao-2',
        eventId: DEFAULT_EVENT_ID,
        totemId: 'totem-secundario',
        participantName: 'JOÃO CONFLITO',
        participantPhone: '(61) 98888-2222',
        score: 8,
        totalQuestions: 10,
        timeSeconds: 45,
        answers: [],
        playedAt: '2026-11-16T11:41:00.000Z',
        syncedAt: '2026-11-16T11:41:05.000Z',
      },
      prizeClaim: {
        id: 'claim-joao-2',
        eventId: DEFAULT_EVENT_ID,
        matchId: 'match-joao-2',
        totemId: 'totem-secundario',
        participantName: 'JOÃO CONFLITO',
        participantPhone: '(61) 98888-2222',
        status: 'offline_duplicate_conflict',
        awardedAt: '2026-11-16T11:41:00.000Z',
        deliveredAt: null,
      },
    });

    const user = userEvent.setup();
    window.location.hash = '#admin';
    render(<AdminApp controller={controller} />);

    await signInAdmin(user);

    // Visão Geral é a tela inicial do Evento selecionado
    expect(await screen.findByRole('heading', { name: 'Visão Geral' })).toBeInTheDocument();
    expect(await screen.findByText('Totem Hall Principal')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();

    // KPIs básicos
    const kpiSection = screen.getByTestId('overview-kpis');
    expect(within(kpiSection).getByText('3')).toBeInTheDocument(); // 3 partidas

    // Fila de Brindes Aguardando Retirada + confirmação rápida
    const pickupSection = screen.getByTestId('overview-awaiting-pickup');
    expect(within(pickupSection).getByText('MARIA SILVA')).toBeInTheDocument();
    await user.click(within(pickupSection).getByRole('button', { name: /Confirmar Entrega/i }));
    expect(await screen.findByText(/Brinde entregue para "MARIA SILVA"/i)).toBeInTheDocument();

    // Alerta de Conflito de Premiação Offline + resolução rápida
    const conflictSection = screen.getByTestId('overview-offline-conflicts');
    expect(within(conflictSection).getByText(/JOÃO CONFLITO/)).toBeInTheDocument();
    await user.click(
      within(conflictSection).getByRole('button', { name: /Despremiar Telefone/i }),
    );
    expect(
      await screen.findByText(/Brinde despremiado para "JOÃO CONFLITO"/i),
    ).toBeInTheDocument();
  });

  it('organiza Regras & Configurações em 4 sub-seções, exibe sticky action bar no dirty state e valida soma 100%', async () => {
    const { controller } = createHarness();
    const user = userEvent.setup();
    window.location.hash = '#admin';
    render(<AdminApp controller={controller} />);

    await signInAdmin(user);
    const desktopNav = await screen.findByRole('navigation', { name: 'Navegação administrativa' });
    await user.click(within(desktopNav).getByRole('button', { name: 'Regras & Configurações' }));
    expect(window.location.hash).toBe('#admin/configuracoes');

    // Sub-seções claras
    expect(await screen.findByRole('heading', { name: 'Geral & Período' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Regras do Quiz' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Brindes & Estoque' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Seleção de Questões' })).toBeInTheDocument();

    // Sticky bar oculta inicialmente
    expect(screen.queryByTestId('settings-sticky-action-bar')).not.toBeInTheDocument();

    // Alteração exibe sticky bar e Descartar reverte
    const facilInput = screen.getByLabelText('Fácil (%)');
    fireEvent.change(facilInput, { target: { value: '30' } });
    expect(screen.getByText(/Soma atual: 90%/i)).toBeInTheDocument();

    const stickyBar = await screen.findByTestId('settings-sticky-action-bar');
    expect(within(stickyBar).getByText(/alterações não salvas/i)).toBeInTheDocument();

    await user.click(within(stickyBar).getByRole('button', { name: /Descartar/i }));
    expect(screen.queryByTestId('settings-sticky-action-bar')).not.toBeInTheDocument();
    expect(screen.getByText(/Soma atual: 100%/i)).toBeInTheDocument();

    // Validação de soma 100% ao salvar pela sticky bar
    fireEvent.change(facilInput, { target: { value: '30' } });
    await user.click(screen.getByRole('button', { name: /Salvar Configurações/i }));
    expect(
      await screen.findByText(/soma dos percentuais de dificuldade deve ser exatamente 100%/i),
    ).toBeInTheDocument();

    // Corrige para 40% e salva com sucesso
    fireEvent.change(facilInput, { target: { value: '40' } });
    await user.click(screen.getByRole('button', { name: /Salvar Configurações/i }));
    expect(await screen.findByText(/salvo \(v2\)/i)).toBeInTheDocument();
    expect(screen.queryByTestId('settings-sticky-action-bar')).not.toBeInTheDocument();
  });
});
