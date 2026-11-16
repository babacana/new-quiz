import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCloudGateway } from '../../adapters/inMemoryCloudGateway';
import { DEFAULT_EVENT_ID } from '../../domain/defaults';
import { EventAdminController } from '../../domain/eventAdminController';
import type { Clock, RandomSource } from '../../domain/ports';
import { AdminApp } from '../AdminApp';

class FixedClock implements Clock {
  private readonly baseMs = new Date('2026-11-16T12:00:00.000Z').getTime();
  now(): number {
    return this.baseMs;
  }
  toISOString(ms?: number): string {
    return new Date(ms ?? this.baseMs).toISOString();
  }
}

class SequentialRandom implements RandomSource {
  private counter = 0;
  next(): number {
    return 0.5;
  }
  shuffle<T>(items: readonly T[]): T[] {
    return [...items];
  }
  uuid(): string {
    this.counter += 1;
    return `66666666-0000-4000-8000-0000000000${String(this.counter).padStart(2, '0')}`;
  }
}

function createHarness() {
  const clock = new FixedClock();
  const random = new SequentialRandom();
  const cloudGateway = new InMemoryCloudGateway({
    online: true,
    seedDefaultEvent: true,
    nowIso: () => clock.toISOString(),
  });
  const controller = new EventAdminController({ cloudGateway, clock, random });
  return { cloudGateway, controller };
}

async function signInAdmin(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('E-mail'), 'admin@caesb.df.gov.br');
  await user.type(screen.getByLabelText('Senha'), 'CAESB2025!');
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
}

describe('Issue #14 — Participantes & Ranking e Análises & Questões', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.location.hash = '';
  });

  it('exibe Participantes & Ranking em tabela desktop e cards mobile com filtros, gabarito, ações em lote e exportação', async () => {
    const { cloudGateway, controller } = createHarness();
    await cloudGateway.pushMatch({
      idempotencyKey: 'idem-rep-1',
      match: {
        id: 'match-rep-1',
        eventId: DEFAULT_EVENT_ID,
        totemId: 'totem-1',
        participantName: 'ANA PAULA',
        participantPhone: '(61) 99111-2222',
        score: 9,
        totalQuestions: 10,
        timeSeconds: 35,
        answers: [
          {
            questionId: 1,
            questionText: 'Qual a sigla da companhia?',
            options: ['CAESB', 'SABESP', 'COPASA', 'SANEPAR'],
            selectedOptionText: 'CAESB',
            correctOptionIndex: 0,
            correctOptionText: 'CAESB',
            isCorrect: true,
          },
        ],
        playedAt: '2026-11-16T11:20:00.000Z',
        syncedAt: '2026-11-16T11:20:05.000Z',
      },
      prizeClaim: {
        id: 'claim-rep-1',
        eventId: DEFAULT_EVENT_ID,
        matchId: 'match-rep-1',
        totemId: 'totem-1',
        participantName: 'ANA PAULA',
        participantPhone: '(61) 99111-2222',
        status: 'awaiting_pickup',
        awardedAt: '2026-11-16T11:20:00.000Z',
        deliveredAt: null,
      },
    });

    const csvSpy = vi.spyOn(controller, 'exportParticipantsCsv');
    const jsonSpy = vi.spyOn(controller, 'exportParticipantsJson');

    const user = userEvent.setup({ delay: null });
    window.location.hash = '#admin';
    render(<AdminApp controller={controller} />);

    await signInAdmin(user);
    const desktopNav = await screen.findByRole('navigation', { name: 'Navegação administrativa' });
    await user.click(within(desktopNav).getByRole('button', { name: 'Participantes & Ranking' }));
    expect(window.location.hash).toBe('#admin/relatorios');

    const desktopTable = await screen.findByTestId('reports-desktop-table');
    const mobileCards = screen.getByTestId('reports-mobile-cards');
    expect(within(desktopTable).getByText('ANA PAULA')).toBeInTheDocument();
    expect(within(mobileCards).getByText('ANA PAULA')).toBeInTheDocument();

    // Gabarito em modal
    await user.click(within(desktopTable).getByRole('button', { name: 'Ver Detalhes' }));
    const modal = await screen.findByRole('dialog');
    expect(within(modal).getByText(/Detalhes da Partida · ANA PAULA/i)).toBeInTheDocument();
    expect(within(modal).getByText(/Alternativa correta: CAESB/i)).toBeInTheDocument();
    await user.click(within(modal).getByRole('button', { name: 'Fechar' }));

    // Ação em lote: Confirmar Entrega
    await user.click(within(desktopTable).getByLabelText('Selecionar Partida de ANA PAULA'));
    await user.click(screen.getByRole('button', { name: 'Confirmar Entrega' }));
    expect(await screen.findByText(/1 entrega\(s\) de Brinde confirmada\(s\)/i)).toBeInTheDocument();

    // Exportar CSV e JSON
    await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    expect(csvSpy).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Exportar JSON' }));
    expect(jsonSpy).toHaveBeenCalled();
  }, 15000);

  it('exibe Análises & Questões unificado com KPIs, gráficos responsivos com tooltip e toggle rápido de questão', async () => {
    const { cloudGateway, controller } = createHarness();
    await cloudGateway.pushMatch({
      idempotencyKey: 'idem-ana-1',
      match: {
        id: 'match-ana-1',
        eventId: DEFAULT_EVENT_ID,
        totemId: 'totem-1',
        participantName: 'CARLOS ANALISE',
        participantPhone: '(61) 99222-3333',
        score: 7,
        totalQuestions: 10,
        timeSeconds: 40,
        answers: [
          {
            questionId: 1,
            questionText: 'O que significa a sigla Caesb?',
            options: ['Companhia de Saneamento Ambiental do DF', 'B', 'C', 'D'],
            selectedOptionText: 'Companhia de Saneamento Ambiental do DF',
            correctOptionIndex: 0,
            correctOptionText: 'Companhia de Saneamento Ambiental do DF',
            isCorrect: true,
          },
        ],
        playedAt: '2026-11-16T11:15:00.000Z',
        syncedAt: '2026-11-16T11:15:05.000Z',
      },
      prizeClaim: null,
    });

    const user = userEvent.setup({ delay: null });
    window.location.hash = '#admin';
    render(<AdminApp controller={controller} />);

    await signInAdmin(user);
    const desktopNav = await screen.findByRole('navigation', { name: 'Navegação administrativa' });
    await user.click(within(desktopNav).getByRole('button', { name: 'Análises & Questões' }));
    expect(window.location.hash).toBe('#admin/analises');

    expect(
      await screen.findByRole('heading', { name: 'Análises & Questões' }),
    ).toBeInTheDocument();

    // KPIs e gráficos responsivos
    expect(screen.getByTestId('analytics-kpis')).toBeInTheDocument();
    expect(screen.getByText('Participações ao Longo do Tempo')).toBeInTheDocument();
    expect(screen.getByText('Distribuição de Pontuações')).toBeInTheDocument();
    expect(screen.getByText('Engajamento por Hora do Dia')).toBeInTheDocument();

    // Interação com barra do gráfico exibe tooltip
    const chartBars = await screen.findAllByTestId('analytics-chart-bar');
    await user.hover(chartBars[0]!);
    expect(await screen.findByTestId('chart-tooltip')).toBeInTheDocument();

    // Seção unificada de acurácia por questão (tabela desktop + cards mobile) e toggle rápido
    const desktopQuestions = await screen.findByTestId('analytics-questions-desktop-table');
    const mobileQuestions = screen.getByTestId('analytics-questions-mobile-cards');
    expect(within(desktopQuestions).getByText(/O que significa a sigla Caesb\?/i)).toBeInTheDocument();
    expect(within(mobileQuestions).getByText(/O que significa a sigla Caesb\?/i)).toBeInTheDocument();

    const disableButtons = within(desktopQuestions).getAllByRole('button', { name: 'Desabilitar' });
    await user.click(disableButtons[0]!);
    expect(await screen.findByText(/Questão #\d+ desabilitada\./i)).toBeInTheDocument();
  }, 15000);
});
