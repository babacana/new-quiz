import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryCloudGateway } from '../../adapters/inMemoryCloudGateway';
import { InMemoryLocalStore } from '../../adapters/inMemoryLocalStore';
import { EventAdminController } from '../../domain/eventAdminController';
import type { Clock, RandomSource } from '../../domain/ports';
import { TotemSessionEngine } from '../../domain/totemSessionEngine';
import { AdminApp } from '../AdminApp';
import { getHashForAdminTab, resolveAdminTabFromHash } from '../adminRoutes';
import { AppRouter } from '../AppRouter';
import { TotemApp } from '../TotemApp';

class ShellClock implements Clock {
  private readonly baseMs = new Date('2026-11-16T12:00:00.000Z').getTime();
  now(): number {
    return this.baseMs;
  }
  toISOString(ms?: number): string {
    return new Date(ms ?? this.baseMs).toISOString();
  }
}

class ShellRandom implements RandomSource {
  private counter = 0;
  next(): number {
    return 0.5;
  }
  shuffle<T>(items: readonly T[]): T[] {
    return [...items];
  }
  uuid(): string {
    this.counter += 1;
    return `33333333-0000-4000-8000-0000000000${String(this.counter).padStart(2, '0')}`;
  }
}

function createHarness() {
  const clock = new ShellClock();
  const random = new ShellRandom();
  const cloudGateway = new InMemoryCloudGateway({
    online: true,
    seedDefaultEvent: true,
    nowIso: () => clock.toISOString(),
  });
  const controller = new EventAdminController({ cloudGateway, clock, random });
  return { cloudGateway, controller, clock, random };
}

async function signInAdmin(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('E-mail'), 'admin@caesb.df.gov.br');
  await user.type(screen.getByLabelText('Senha'), 'CAESB2025!');
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
}

describe('SaasShell (Issue #11 - Fundação SaaS, Isolamento CSS e Roteamento)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.location.hash = '';
    document.documentElement.classList.remove('dark', 'totem-fullscreen-mode');
    document.body.classList.remove('totem-fullscreen-mode');
  });

  it('isola o modo tela cheia no Totem e alterna tema claro/escuro com persistência no Admin', async () => {
    const { cloudGateway, controller, clock, random } = createHarness();
    const totemEngine = new TotemSessionEngine({
      localStore: new InMemoryLocalStore(),
      cloudGateway,
      clock,
      random,
      requirePairing: false,
    });

    const { unmount: unmountTotem } = render(<TotemApp engine={totemEngine} />);
    expect(document.documentElement.classList.contains('totem-fullscreen-mode')).toBe(true);
    expect(document.body.classList.contains('totem-fullscreen-mode')).toBe(true);
    unmountTotem();
    expect(document.documentElement.classList.contains('totem-fullscreen-mode')).toBe(false);

    const user = userEvent.setup();
    const { unmount: unmountAdmin } = render(<AdminApp controller={controller} />);

    expect(document.documentElement.classList.contains('totem-fullscreen-mode')).toBe(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    const toggleBtn = screen.getByRole('button', { name: /Alternar tema/i });
    await user.click(toggleBtn);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(window.localStorage.getItem('new-quiz-saas-theme')).toBe('dark');

    unmountAdmin();
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    render(<AdminApp controller={controller} />);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('separa Contexto do Evento e Nível Global na sidebar, colapsa/abre drawer mobile e aciona dirty check no seletor de Evento', async () => {
    const { controller } = createHarness();
    await controller.login('admin@caesb.df.gov.br', 'CAESB2025!');
    await controller.createEvent({ name: 'Evento Secundário 2026' });
    await controller.logout();

    const user = userEvent.setup();
    window.location.hash = '#admin';
    render(<AdminApp controller={controller} />);

    await signInAdmin(user);
    expect(await screen.findByRole('heading', { name: /Visão Geral/i })).toBeInTheDocument();

    const desktopNav = screen.getByRole('navigation', { name: 'Navegação administrativa' });
    expect(within(desktopNav).getByText('Contexto do Evento')).toBeInTheDocument();
    expect(within(desktopNav).getByText('Nível Global')).toBeInTheDocument();
    expect(within(desktopNav).getByRole('button', { name: 'Visão Geral' })).toBeInTheDocument();
    expect(within(desktopNav).getByRole('button', { name: 'Regras & Configurações' })).toBeInTheDocument();
    expect(within(desktopNav).getByRole('button', { name: 'Eventos' })).toBeInTheDocument();

    // Colapsar e expandir sidebar desktop
    await user.click(screen.getByRole('button', { name: 'Recolher menu lateral' }));
    expect(screen.getByRole('button', { name: 'Expandir menu lateral' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expandir menu lateral' }));

    // Abrir drawer mobile e navegar
    await user.click(screen.getByRole('button', { name: 'Abrir menu' }));
    const mobileNav = await screen.findByRole('navigation', {
      name: 'Navegação administrativa mobile',
    });
    await user.click(within(mobileNav).getByRole('button', { name: 'Banco de Questões' }));
    expect(window.location.hash).toBe('#admin/questoes');

    // Vai para Regras & Configurações e altera campo para testar dirty check ao trocar Evento no cabeçalho
    await user.click(within(desktopNav).getByRole('button', { name: 'Regras & Configurações' }));
    expect(window.location.hash).toBe('#admin/configuracoes');

    const facilInput = await screen.findByLabelText('Fácil (%)');
    fireEvent.change(facilInput, { target: { value: '30' } });

    const headerEventSelect = screen.getByLabelText('Evento selecionado');
    const secondOption = within(headerEventSelect).getByRole('option', {
      name: /Evento Secundário 2026/,
    }) as HTMLOptionElement;

    await user.selectOptions(headerEventSelect, secondOption.value);
    expect(screen.getByRole('heading', { name: 'Alterações Não Salvas' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sair sem Salvar' }));
    expect(await screen.findByDisplayValue('Evento Secundário 2026')).toBeInTheDocument();
  });

  it('resolve sub-rotas de Visão Geral, Eventos e Regras & Configurações', () => {
    expect(resolveAdminTabFromHash('#admin')).toBe('overview');
    expect(resolveAdminTabFromHash('#admin/visao-geral')).toBe('overview');
    expect(resolveAdminTabFromHash('#admin/configuracoes')).toBe('settings');
    expect(resolveAdminTabFromHash('#admin/eventos')).toBe('events');
    expect(getHashForAdminTab('overview')).toBe('#admin/visao-geral');
    expect(getHashForAdminTab('settings')).toBe('#admin/configuracoes');
    expect(getHashForAdminTab('events')).toBe('#admin/eventos');
  });

  it('suporta sub-rotas diretas na URL, fallback a partir de #admin e dirty check em hashchange no AppRouter', async () => {
    const { cloudGateway } = createHarness();
    const user = userEvent.setup();
    window.location.hash = '#admin/questoes';

    render(<AppRouter cloudGateway={cloudGateway} />);
    await signInAdmin(user);

    expect(
      await screen.findByRole('heading', { name: /Banco de Questões Central/i }),
    ).toBeInTheDocument();

    // Navega para Regras & Configurações via sidebar e suja o formulário
    await user.click(screen.getByRole('button', { name: 'Regras & Configurações' }));
    expect(window.location.hash).toBe('#admin/configuracoes');

    const facilInput = await screen.findByLabelText('Fácil (%)');
    fireEvent.change(facilInput, { target: { value: '35' } });

    // Simula navegação pelo histórico/URL para outra sub-rota com alterações pendentes
    act(() => {
      window.location.hash = '#admin/totens';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(await screen.findByRole('heading', { name: 'Alterações Não Salvas' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#admin/configuracoes');

    await user.click(screen.getByRole('button', { name: 'Sair sem Salvar' }));
    expect(
      await screen.findByRole('heading', { name: 'Autorizar Pareamento de Totem' }),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe('#admin/totens');
  });
});
