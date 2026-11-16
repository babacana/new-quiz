import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCloudGateway } from '../../adapters/inMemoryCloudGateway';
import { InMemoryLocalStore } from '../../adapters/inMemoryLocalStore';
import { DEFAULT_EVENT_ID } from '../../domain/defaults';
import { EventAdminController } from '../../domain/eventAdminController';
import type { Clock, RandomSource } from '../../domain/ports';
import { TotemSessionEngine } from '../../domain/totemSessionEngine';
import { AdminApp } from '../AdminApp';

class Issue15Clock implements Clock {
  private readonly baseMs = new Date('2026-11-16T12:00:00.000Z').getTime();
  now(): number {
    return this.baseMs;
  }
  toISOString(ms?: number): string {
    return new Date(ms ?? this.baseMs).toISOString();
  }
}

class Issue15Random implements RandomSource {
  private counter = 0;
  next(): number {
    return 0.5;
  }
  shuffle<T>(items: readonly T[]): T[] {
    return [...items];
  }
  uuid(): string {
    this.counter += 1;
    return `77777777-0000-4000-8000-0000000000${String(this.counter).padStart(2, '0')}`;
  }
}

function createHarness() {
  const clock = new Issue15Clock();
  const random = new Issue15Random();
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

describe('Issue #15 — Totens, Equipe & Sistema', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.location.hash = '';
  });

  it('exibe Totens em tabela desktop e cards mobile, gera pareamento, envia comando mobile via modal e comando em lote com confirmação', async () => {
    const { cloudGateway, controller, clock, random } = createHarness();
    await controller.login('admin@caesb.df.gov.br', 'CAESB2025!');
    const secondaryEvent = await controller.createEvent({ name: 'Expo Saneamento 2026' });
    await controller.logout();

    const totemEngine = new TotemSessionEngine({
      localStore: new InMemoryLocalStore(),
      cloudGateway,
      clock,
      random,
      requirePairing: true,
    });
    const pendingSnap = await totemEngine.initialize();

    const user = userEvent.setup({ delay: null });
    window.location.hash = '#admin/totens';
    render(<AdminApp controller={controller} />);
    await signInAdmin(user);

    expect(
      await screen.findByRole('heading', { name: 'Autorizar Pareamento de Totem' }),
    ).toBeInTheDocument();

    // Autoriza pareamento e gera link de ativação
    await user.type(screen.getByLabelText('Código de Pareamento'), pendingSnap.pairing.pairingCode!);
    await user.type(screen.getByLabelText('Nome do Totem'), 'Totem Entrada Principal');
    await user.clear(screen.getByLabelText('PIN Local'));
    await user.type(screen.getByLabelText('PIN Local'), '4321');
    await user.selectOptions(screen.getByLabelText('Evento Vinculado'), DEFAULT_EVENT_ID);
    await user.click(screen.getByRole('button', { name: 'Autorizar Pareamento' }));

    const desktopTable = await screen.findByTestId('totems-desktop-table');
    const mobileCards = screen.getByTestId('totems-mobile-cards');
    expect(within(desktopTable).getByText('Totem Entrada Principal')).toBeInTheDocument();
    expect(within(mobileCards).getByText('Totem Entrada Principal')).toBeInTheDocument();
    expect(document.getElementById('generated-activation-link')?.textContent).toContain(
      `?pairingCode=${pendingSnap.pairing.pairingCode}`,
    );

    // Envia comando remoto pelo modal mobile
    await user.click(within(mobileCards).getByRole('button', { name: 'Comandos Remotos' }));
    const mobileDialog = await screen.findByRole('dialog');
    expect(
      within(mobileDialog).getByRole('heading', { name: /Comandos Remotos · Totem Entrada Principal/i }),
    ).toBeInTheDocument();
    await user.selectOptions(
      within(mobileDialog).getByLabelText('Trocar Evento'),
      secondaryEvent.id,
    );
    await user.click(within(mobileDialog).getByRole('button', { name: 'Aplicar' }));
    expect(
      await screen.findByText(/Comando Trocar Evento enviado para "Totem Entrada Principal"/i),
    ).toBeInTheDocument();
    expect(totemEngine.getSnapshot().event.name).toBe('Expo Saneamento 2026');

    // Envia comando em lote com modal de confirmação
    await user.selectOptions(
      screen.getByLabelText('Evento Alvo do Comando'),
      secondaryEvent.id,
    );
    await user.click(screen.getByRole('button', { name: 'Forçar Sincronização do Evento' }));
    const batchDialog = await screen.findByRole('dialog');
    expect(
      within(batchDialog).getByRole('heading', { name: 'Confirmar Comando em Lote' }),
    ).toBeInTheDocument();
    await user.click(within(batchDialog).getByRole('button', { name: 'Confirmar Envio' }));
    expect(
      await screen.findByText(/Comando FORCE_SYNC enviado para os Totens do Evento/i),
    ).toBeInTheDocument();

    // Telemetria ao vivo atualiza quando Totem entra em Partida
    await act(async () => {
      await totemEngine.startMatch('MARINA', '(61) 99999-1111');
    });
    expect(await within(desktopTable).findByText('Tela: Em Partida')).toBeInTheDocument();
  }, 15000);

  it('gerencia Equipe do Estande, migra backup legado quiz-offline e abre Simulador de Totem responsivo', async () => {
    const { cloudGateway, controller } = createHarness();
    const exportSpy = vi.spyOn(controller, 'exportFullBackup');
    const user = userEvent.setup({ delay: null });

    window.location.hash = '#admin/equipe';
    render(<AdminApp controller={controller} />);
    await signInAdmin(user);

    // Equipe do Estande: listagem adaptativa, criação, edição de perfil e revogação com confirmação
    const staffDesktop = await screen.findByTestId('staff-desktop-table');
    const staffMobile = screen.getByTestId('staff-mobile-cards');
    expect(within(staffDesktop).getByText('admin@caesb.df.gov.br')).toBeInTheDocument();
    expect(within(staffMobile).getByText('admin@caesb.df.gov.br')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Nome Completo'), 'Lucas Operador');
    await user.type(screen.getByLabelText('E-mail'), 'lucas@caesb.df.gov.br');
    await user.type(screen.getByLabelText(/Senha/i), 'Senha123!');
    await user.selectOptions(screen.getByLabelText('Perfil de Acesso'), 'operator');
    await user.click(screen.getByRole('button', { name: 'Cadastrar Membro' }));

    expect(await within(staffDesktop).findByText('Lucas Operador')).toBeInTheDocument();
    expect(within(staffMobile).getByText('Lucas Operador')).toBeInTheDocument();

    await user.selectOptions(
      within(staffDesktop).getByLabelText('Perfil de lucas@caesb.df.gov.br'),
      'admin',
    );
    expect(
      await screen.findByText(/Perfil de "Lucas Operador" atualizado para Administrador/i),
    ).toBeInTheDocument();

    const revokeBtns = within(staffDesktop).getAllByRole('button', { name: 'Revogar Acesso' });
    await user.click(revokeBtns[revokeBtns.length - 1]!);
    const revokeDialog = await screen.findByRole('dialog');
    await user.click(within(revokeDialog).getByRole('button', { name: 'Confirmar Revogação' }));
    expect(
      await screen.findByText(/Acesso de "Lucas Operador" revogado com sucesso/i),
    ).toBeInTheDocument();

    // Backup e Migração Legada + Simulador de Totem
    const desktopNav = screen.getByRole('navigation', { name: 'Navegação administrativa' });
    await user.click(within(desktopNav).getByRole('button', { name: 'Backup e Migração' }));
    expect(
      await screen.findByRole('heading', { name: /Backup, Restauração e Migração Legada/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Exportar Backup Completo (JSON)' }));
    expect(exportSpy).toHaveBeenCalled();

    const legacyJson = JSON.stringify({
      quizQuestions: [
        {
          id: 'q-leg-1',
          text: 'Questão Legada #15',
          options: ['Correta', 'Errada 1', 'Errada 2', 'Errada 3'],
          correct: 0,
          difficulty: 'medio',
        },
      ],
      quizParticipants: [
        {
          name: 'JOANA LEGADA',
          phone: '(61) 98765-4321',
          score: 1,
          time: 10,
          timestamp: '2025-05-25T14:00:00.000Z',
          playerAttempts: [
            { questionId: 'q-leg-1', selectedOptionText: 'Correta', isCorrect: true },
          ],
        },
      ],
    });
    const file = new File([legacyJson], 'legacy-quiz-offline.json', { type: 'application/json' });
    await user.upload(screen.getByLabelText('Arquivo de Backup (JSON)'), file);
    expect(await screen.findByText(/Selecionado: legacy-quiz-offline\.json/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restaurar Backup' }));
    const restoreDialog = await screen.findByRole('dialog');
    await user.click(within(restoreDialog).getByRole('button', { name: 'Confirmar Restauração' }));
    expect(
      await screen.findByText(/Backup legado migrado: 1 questão\(ões\)/i),
    ).toBeInTheDocument();

    // Abertura do Simulador de Totem pelo card de Sistema
    await user.click(screen.getByRole('button', { name: 'Abrir Simulador de Totem' }));
    const simDialog = await screen.findByRole('dialog');
    expect(
      within(simDialog).getByRole('heading', { name: 'Modo Desenvolvedor / Simulador Isolado' }),
    ).toBeInTheDocument();
    await user.click(within(simDialog).getByRole('button', { name: 'Ranking' }));
    expect(await within(simDialog).findByText(/Tela simulada: Ranking/i)).toBeInTheDocument();
    expect(await cloudGateway.listMatches()).toHaveLength(1);
    await user.click(within(simDialog).getByRole('button', { name: 'Fechar Simulador' }));
    expect(document.getElementById('dev-simulator-window')).not.toBeInTheDocument();
  }, 15000);
});
