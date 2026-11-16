import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryCloudGateway } from '../../adapters/inMemoryCloudGateway';
import { DEFAULT_EVENT_ID } from '../../domain/defaults';
import { EventAdminController } from '../../domain/eventAdminController';
import type { Clock, RandomSource } from '../../domain/ports';
import { AdminApp } from '../AdminApp';

class Issue16Clock implements Clock {
  private readonly baseMs = new Date('2026-11-16T12:00:00.000Z').getTime();
  now(): number {
    return this.baseMs;
  }
  toISOString(ms?: number): string {
    return new Date(ms ?? this.baseMs).toISOString();
  }
}

class Issue16Random implements RandomSource {
  private counter = 0;
  next(): number {
    return 0.5;
  }
  shuffle<T>(items: readonly T[]): T[] {
    return [...items];
  }
  uuid(): string {
    this.counter += 1;
    return `88888888-0000-4000-8000-0000000000${String(this.counter).padStart(2, '0')}`;
  }
}

function createHarness() {
  const clock = new Issue16Clock();
  const random = new Issue16Random();
  const cloudGateway = new InMemoryCloudGateway({
    online: true,
    seedDefaultEvent: true,
    nowIso: () => clock.toISOString(),
  });
  const controller = new EventAdminController({ cloudGateway, clock, random });
  return { cloudGateway, controller };
}

async function signInOperator(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('E-mail'), 'operador@caesb.df.gov.br');
  await user.type(screen.getByLabelText('Senha'), 'OPERADOR2025!');
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
}

describe('Issue #16 — Painel do Operador Mobile-First', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.location.hash = '';
  });

  it('restringe Operador à visão mobile-first sem menus admin e alterna entre Brindes, Participantes e Ranking pela bottom navigation', async () => {
    const { cloudGateway, controller } = createHarness();
    await controller.login('admin@caesb.df.gov.br', 'CAESB2025!');
    const secondActiveEvent = await controller.createEvent({
      name: 'Estande Anexo 2026',
      isActive: true,
    });
    await controller.logout();

    // Dados no evento padrão (conflito offline + bloqueio)
    await cloudGateway.pushMatch({
      idempotencyKey: 'i16-m-1',
      match: {
        id: 'i16-match-1',
        eventId: DEFAULT_EVENT_ID,
        totemId: 'totem-1',
        participantName: 'BRUNA CONFLITO',
        participantPhone: '(61) 99111-0001',
        score: 5,
        totalQuestions: 5,
        timeSeconds: 18,
        answers: [],
        playedAt: '2026-11-16T11:00:00.000Z',
      },
      prizeClaim: {
        id: 'i16-claim-1',
        eventId: DEFAULT_EVENT_ID,
        matchId: 'i16-match-1',
        totemId: 'totem-1',
        participantName: 'BRUNA CONFLITO',
        participantPhone: '(61) 99111-0001',
        status: 'awaiting_pickup',
        awardedAt: '2026-11-16T11:00:00.000Z',
        deliveredAt: null,
      },
    });
    await cloudGateway.pushMatch({
      idempotencyKey: 'i16-m-2',
      match: {
        id: 'i16-match-2',
        eventId: DEFAULT_EVENT_ID,
        totemId: 'totem-2',
        participantName: 'BRUNA DUPLICADA',
        participantPhone: '(61) 99111-0001',
        score: 4,
        totalQuestions: 5,
        timeSeconds: 22,
        answers: [],
        playedAt: '2026-11-16T11:05:00.000Z',
      },
      prizeClaim: {
        id: 'i16-claim-2',
        eventId: DEFAULT_EVENT_ID,
        matchId: 'i16-match-2',
        totemId: 'totem-2',
        participantName: 'BRUNA DUPLICADA',
        participantPhone: '(61) 99111-0001',
        status: 'awaiting_pickup',
        awardedAt: '2026-11-16T11:05:00.000Z',
        deliveredAt: null,
      },
    });
    await cloudGateway.pushGiveUpLockout({
      idempotencyKey: 'i16-lock-1',
      lockout: {
        id: 'i16-lockout-1',
        eventId: DEFAULT_EVENT_ID,
        totemId: 'totem-1',
        participantPhone: '(61) 98777-6666',
        lockedAt: '2026-11-16T11:50:00.000Z',
        expiresAt: '2026-11-16T12:20:00.000Z',
      },
    });

    // Dado no segundo evento ativo
    await cloudGateway.pushMatch({
      idempotencyKey: 'i16-m-sec',
      match: {
        id: 'i16-match-sec',
        eventId: secondActiveEvent.id,
        totemId: 'totem-3',
        participantName: 'TIAGO ANEXO',
        participantPhone: '(61) 99555-3333',
        score: 5,
        totalQuestions: 5,
        timeSeconds: 15,
        answers: [],
        playedAt: '2026-11-16T11:10:00.000Z',
      },
      prizeClaim: null,
    });

    const user = userEvent.setup({ delay: null });
    window.location.hash = '#admin/eventos';
    render(<AdminApp controller={controller} />);
    await signInOperator(user);

    // Visão restrita sem menus administrativos
    expect(await screen.findByText(/Visão do Operador de Estande/i)).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Navegação administrativa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eventos' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Banco de Questões' })).not.toBeInTheDocument();

    // Bottom navigation com 3 abas
    const operatorNav = screen.getByRole('navigation', { name: 'Navegação do operador' });
    const prizesBtn = within(operatorNav).getByRole('button', { name: /Brindes/i });
    const participantsBtn = within(operatorNav).getByRole('button', { name: /Participantes/i });
    const rankingBtn = within(operatorNav).getByRole('button', { name: /Ranking/i });
    expect(prizesBtn).toHaveAttribute('aria-current', 'page');

    // Aba Brindes: resolve Conflito de Premiação Offline com toast
    const conflictAlert = await screen.findByRole('alert');
    expect(within(conflictAlert).getByText(/Conflito de Premiação Offline/i)).toBeInTheDocument();
    await user.click(within(conflictAlert).getByRole('button', { name: 'Entregue' }));
    expect(await screen.findByText(/Brinde entregue para "BRUNA CONFLITO"/i)).toBeInTheDocument();

    // Aba Participantes: busca, destrava e despremiar
    await user.click(participantsBtn);
    expect(participantsBtn).toHaveAttribute('aria-current', 'page');
    await user.click(await screen.findByRole('button', { name: 'Destravar' }));
    expect(
      await screen.findByText(/Telefone \(61\) 98777-6666 destravado no Evento/i),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText('Buscar por Nome ou Telefone'), 'BRUNA CONFLITO');
    await user.click(screen.getByRole('button', { name: 'Despremiar' }));
    expect(await screen.findByText(/Brinde despremiado para "BRUNA CONFLITO"/i)).toBeInTheDocument();

    // Aba Ranking: exibe classificação ao vivo
    await user.click(rankingBtn);
    expect(rankingBtn).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByText(/Ranking ao Vivo \(2\)/i)).toBeInTheDocument();
    expect(screen.getByText('BRUNA CONFLITO')).toBeInTheDocument();

    // Seletor de Evento ativo no topo (quando há mais de um evento ativo)
    await user.selectOptions(screen.getByLabelText('Evento em Operação'), secondActiveEvent.id);
    expect(await screen.findByText('TIAGO ANEXO')).toBeInTheDocument();
  }, 15000);
});
