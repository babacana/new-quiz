import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryCloudGateway } from '../../adapters/inMemoryCloudGateway';
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
    return `55555555-0000-4000-8000-0000000000${String(this.counter).padStart(2, '0')}`;
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

describe('Issue #13 — Aparência do Totem e Banco de Questões Central', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.location.hash = '';
  });

  it('exibe sub-seções, alternância Editar/Pré-visualizar mobile e sticky action bar ligada ao dirty check na Aparência do Totem', async () => {
    const { controller } = createHarness();
    const user = userEvent.setup();
    window.location.hash = '#admin';
    render(<AdminApp controller={controller} />);

    await signInAdmin(user);
    const desktopNav = await screen.findByRole('navigation', { name: 'Navegação administrativa' });
    await user.click(within(desktopNav).getByRole('button', { name: 'Personalização Visual' }));
    expect(window.location.hash).toBe('#admin/aparencia');

    expect(
      await screen.findByRole('heading', { name: 'Personalização Visual do Evento' }),
    ).toBeInTheDocument();

    // Alternância Editar / Pré-visualizar no mobile
    const mobileToggle = screen.getByTestId('customization-mobile-toggle');
    expect(within(mobileToggle).getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(
      within(mobileToggle).getByRole('button', { name: 'Pré-visualizar' }),
    ).toBeInTheDocument();

    await user.click(within(mobileToggle).getByRole('button', { name: 'Pré-visualizar' }));
    expect(screen.getByTestId('customization-preview-pane')).toHaveAttribute(
      'data-mobile-visible',
      'true',
    );
    await user.click(within(mobileToggle).getByRole('button', { name: 'Editar' }));
    expect(screen.getByTestId('customization-editor-pane')).toHaveAttribute(
      'data-mobile-visible',
      'true',
    );

    // Sticky bar oculta inicialmente
    expect(screen.queryByTestId('customization-sticky-action-bar')).not.toBeInTheDocument();

    // Aplicar tema exibe sticky bar e Descartar reverte
    await user.click(screen.getByRole('button', { name: 'Escuro Elegante' }));
    const stickyBar = await screen.findByTestId('customization-sticky-action-bar');
    expect(within(stickyBar).getByText(/alterações não salvas/i)).toBeInTheDocument();

    await user.click(within(stickyBar).getByRole('button', { name: /Descartar/i }));
    expect(screen.queryByTestId('customization-sticky-action-bar')).not.toBeInTheDocument();

    // Altera novamente e salva pela sticky bar
    await user.click(screen.getByRole('button', { name: 'Escuro Elegante' }));
    const stickyBarAfterEdit = await screen.findByTestId('customization-sticky-action-bar');
    await user.click(
      within(stickyBarAfterEdit).getByRole('button', { name: /Salvar Personalização/i }),
    );
    expect(await screen.findByText(/Personalização visual salva/i)).toBeInTheDocument();
    expect(screen.queryByTestId('customization-sticky-action-bar')).not.toBeInTheDocument();
  });

  it('exibe Banco de Questões em tabela desktop e cards mobile, cria questão e exporta CSV/JSON', async () => {
    const { controller } = createHarness();
    const user = userEvent.setup({ delay: null });
    window.location.hash = '#admin';
    render(<AdminApp controller={controller} />);

    await signInAdmin(user);
    const desktopNav = await screen.findByRole('navigation', { name: 'Navegação administrativa' });
    await user.click(within(desktopNav).getByRole('button', { name: 'Banco de Questões' }));
    expect(window.location.hash).toBe('#admin/questoes');

    const desktopTable = await screen.findByTestId('questions-desktop-table');
    const mobileCards = screen.getByTestId('questions-mobile-cards');
    expect(within(desktopTable).getByRole('table')).toBeInTheDocument();
    expect(within(mobileCards).getAllByText(/#\d+/).length).toBeGreaterThan(0);

    // Criar nova questão
    await user.click(screen.getByRole('button', { name: /Nova Questão/i }));
    fireEvent.change(await screen.findByLabelText('Enunciado da Questão'), {
      target: { value: 'Qual a importância do tratamento de esgoto?' },
    });
    fireEvent.change(screen.getByLabelText('Alternativa A'), {
      target: { value: 'Preservar os rios' },
    });
    fireEvent.change(screen.getByLabelText('Alternativa B'), {
      target: { value: 'Nenhuma' },
    });
    fireEvent.change(screen.getByLabelText('Alternativa C'), {
      target: { value: 'Aumentar poluição' },
    });
    fireEvent.change(screen.getByLabelText('Alternativa D'), {
      target: { value: 'Desperdiçar água' },
    });
    await user.click(screen.getByRole('button', { name: 'Salvar Questão' }));

    expect(await screen.findByText(/adicionada ao Banco de Questões/i)).toBeInTheDocument();

    // Exportar CSV e JSON
    await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    expect(await screen.findByText(/Exportação CSV concluída/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Exportar JSON' }));
    expect(await screen.findByText(/Exportação JSON concluída/i)).toBeInTheDocument();
  }, 15000);
});
