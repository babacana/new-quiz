import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryCloudGateway } from '../../adapters/inMemoryCloudGateway';
import { InMemoryLocalStore } from '../../adapters/inMemoryLocalStore';
import { DEFAULT_EVENT_CONFIG } from '../../domain/defaults';
import type { Clock, RandomSource } from '../../domain/ports';
import { TotemSessionEngine } from '../../domain/totemSessionEngine';
import type { EventConfig, Question } from '../../domain/types';
import { TotemApp } from '../TotemApp';

class UiTestClock implements Clock {
  now(): number {
    return Date.now();
  }

  toISOString(ms?: number): string {
    return new Date(ms ?? this.now()).toISOString();
  }
}

class UiTestRandom implements RandomSource {
  private counter = 0;

  next(): number {
    return 0.4;
  }

  shuffle<T>(items: readonly T[]): T[] {
    // Mantém cópia em ordem previsível para facilitar asserções claras na UI.
    return [...items];
  }

  uuid(): string {
    this.counter += 1;
    return `00000000-0000-4000-8000-0000000009${String(this.counter).padStart(2, '0')}`;
  }
}

function createUiTestRig(options?: { online?: boolean; numberOfQuestions?: number }) {
  const clock = new UiTestClock();
  const random = new UiTestRandom();
  const localStore = new InMemoryLocalStore();
  const cloudGateway = new InMemoryCloudGateway({
    online: options?.online ?? true,
    seedDefaultEvent: false,
    nowIso: () => clock.toISOString(),
  });

  const event: EventConfig = {
    ...DEFAULT_EVENT_CONFIG,
    settings: {
      ...DEFAULT_EVENT_CONFIG.settings,
      numberOfQuestions: options?.numberOfQuestions ?? 2,
      minScoreForPrize: 2,
      timePerQuestion: 30,
    },
  };

  const questions: Question[] = [
    {
      id: 101,
      text: 'Qual a sigla da companhia de saneamento do DF?',
      options: ['CAESB', 'SABESP', 'COPASA', 'SANEPAR'],
      correctIndex: 0,
      difficulty: 'facil',
      tags: ['caesb'],
      isDisabled: false,
    },
    {
      id: 102,
      text: 'Qual o telefone da Central de Atendimento da Caesb?',
      options: ['190', '115', '193', '100'],
      correctIndex: 1,
      difficulty: 'moderado',
      tags: ['atendimento'],
      isDisabled: false,
    },
  ];

  cloudGateway.seedEvent(event, questions);

  const engine = new TotemSessionEngine({
    localStore,
    cloudGateway,
    clock,
    random,
  });

  return { engine, cloudGateway, localStore, event };
}

describe('TotemApp (Interface do Totem)', () => {
  it('converte nome para maiúsculas, aplica máscara de telefone, percorre Partida e abre modal "Onde Eu Errei?"', async () => {
    const user = userEvent.setup();
    const { engine } = createUiTestRig({ numberOfQuestions: 2 });

    render(<TotemApp engine={engine} />);

    const nameField = await screen.findByLabelText('Nome');
    const phoneField = screen.getByLabelText('Telefone');

    await user.type(nameField, 'joana silva 123');
    expect(nameField).toHaveValue('JOANA SILVA ');

    await user.type(phoneField, '61998765432');
    expect(phoneField).toHaveValue('(61) 99876-5432');

    await user.click(screen.getByRole('button', { name: 'Iniciar Quiz' }));

    // Questão 1: responde errado (SABESP)
    expect(await screen.findByText('Qual a sigla da companhia de saneamento do DF?')).toBeInTheDocument();
    expect(screen.getByText('Fácil')).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'SABESP' }));
    const nextBtn = screen.getByRole('button', { name: 'Próxima Pergunta' });
    await user.click(nextBtn);

    // Questão 2: responde certo (115)
    expect(await screen.findByText('Qual o telefone da Central de Atendimento da Caesb?')).toBeInTheDocument();
    expect(screen.getByText('Moderado')).toBeInTheDocument();
    expect(screen.getByText('2/2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '115' }));
    await user.click(screen.getByRole('button', { name: 'Finalizar Quiz' }));

    // Tela de resultado
    expect(await screen.findByText('JOANA SILVA,')).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();

    const reviewBtn = screen.getByRole('button', { name: 'Onde Eu Errei?' });
    await user.click(reviewBtn);

    // Modal "Onde Eu Errei?"
    expect(screen.getByText('Gabarito das Questões Erradas')).toBeInTheDocument();
    expect(screen.getByText('SABESP')).toBeInTheDocument();
    expect(screen.getByText('CAESB')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    await user.click(screen.getByRole('button', { name: 'Jogar Novamente' }));

    expect(screen.getByLabelText('Nome')).toHaveValue('');
    expect(screen.getByLabelText('Telefone')).toHaveValue('');
  });

  it('exibe mensagem de gabarito perfeito e oculta "Onde Eu Errei?" quando acerta 100%', async () => {
    const user = userEvent.setup();
    const { engine } = createUiTestRig({ numberOfQuestions: 1 });

    render(<TotemApp engine={engine} />);

    await user.type(await screen.findByLabelText('Nome'), 'pedro');
    await user.type(screen.getByLabelText('Telefone'), '6133224455');
    await user.click(screen.getByRole('button', { name: 'Iniciar Quiz' }));

    await user.click(await screen.findByRole('button', { name: 'CAESB' }));
    await user.click(screen.getByRole('button', { name: 'Finalizar Quiz' }));

    expect(await screen.findByText(/Gabarito perfeito/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Onde Eu Errei?' })).not.toBeInTheDocument();
  });

  it('opera offline na UI e sincroniza automaticamente ao disparar evento online', async () => {
    const user = userEvent.setup();
    const { engine, cloudGateway, localStore, event } = createUiTestRig({
      online: true,
      numberOfQuestions: 1,
    });

    // Primeiro carrega e faz cache inicial enquanto online, depois desconecta
    await engine.initialize();
    cloudGateway.setOnline(false);

    render(<TotemApp engine={engine} />);

    await user.type(await screen.findByLabelText('Nome'), 'clara');
    await user.type(screen.getByLabelText('Telefone'), '61999990000');
    await user.click(screen.getByRole('button', { name: 'Iniciar Quiz' }));

    await user.click(await screen.findByRole('button', { name: 'CAESB' }));
    await user.click(screen.getByRole('button', { name: 'Finalizar Quiz' }));

    expect(await screen.findByText('CLARA,')).toBeInTheDocument();
    expect(await localStore.getSyncQueue()).toHaveLength(1);
    expect(cloudGateway.getSyncedMatches(event.id)).toHaveLength(0);

    // Conexão retorna
    cloudGateway.setOnline(true);
    await act(async () => {
      fireEvent(window, new Event('online'));
    });

    await waitFor(() => {
      expect(cloudGateway.getSyncedMatches(event.id)).toHaveLength(1);
    });
    expect(await localStore.getSyncQueue()).toHaveLength(0);
  });

  it('exibe alertas visuais nos segundos finais e registra Tempo Esgotado! na UI', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { engine } = createUiTestRig({ numberOfQuestions: 1 });
      const { container } = render(<TotemApp engine={engine} />);

      await act(async () => {
        await Promise.resolve();
      });

      fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'lucas' } });
      fireEvent.change(screen.getByLabelText('Telefone'), { target: { value: '61998765432' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Iniciar Quiz' }));
      });

      // Avança 21s (restam 9s -> fase warning / borda amarela)
      await act(async () => {
        vi.advanceTimersByTime(21_000);
      });
      expect(container.querySelector('.quiz-container')).toHaveClass(
        'time-alert-border-pulse-warning',
      );

      // Avança mais 5s (restam 4s -> fase critical / borda vermelha)
      await act(async () => {
        vi.advanceTimersByTime(5_000);
      });
      expect(container.querySelector('.quiz-container')).toHaveClass(
        'time-alert-border-pulse-critical',
      );

      // Avança até esgotar os 30s
      await act(async () => {
        vi.advanceTimersByTime(4_100);
      });
      expect(screen.getByText('Tempo Esgotado!')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'CAESB' })).toHaveClass('correct');
      expect(screen.getByRole('button', { name: 'Finalizar Quiz' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retenta sincronização em segundo plano mesmo sem evento online do navegador', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { engine, cloudGateway, localStore, event } = createUiTestRig({
        online: true,
        numberOfQuestions: 1,
      });

      await engine.initialize();
      cloudGateway.setOnline(false);

      render(<TotemApp engine={engine} />);

      await act(async () => {
        await Promise.resolve();
      });

      fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'rafael' } });
      fireEvent.change(screen.getByLabelText('Telefone'), { target: { value: '61998765432' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Iniciar Quiz' }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'CAESB' }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Finalizar Quiz' }));
      });

      expect(await localStore.getSyncQueue()).toHaveLength(1);

      // Conexão volta silenciosamente sem disparar evento 'online'
      cloudGateway.setOnline(true);
      await act(async () => {
        vi.advanceTimersByTime(10_100);
        await Promise.resolve();
      });

      expect(cloudGateway.getSyncedMatches(event.id)).toHaveLength(1);
      expect(await localStore.getSyncQueue()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
