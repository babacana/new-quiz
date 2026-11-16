import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCloudGateway } from '../../adapters/inMemoryCloudGateway';
import { InMemoryLocalStore } from '../../adapters/inMemoryLocalStore';
import { DEFAULT_EVENT_CONFIG } from '../../domain/defaults';
import type { Clock, RandomSource } from '../../domain/ports';
import { TotemSessionEngine } from '../../domain/totemSessionEngine';
import type { EventConfig, Question } from '../../domain/types';
import { TotemApp } from '../TotemApp';

class UiTestClock implements Clock {
  private readonly offsetMs: number;

  constructor(initialNowIso?: string) {
    this.offsetMs = initialNowIso ? new Date(initialNowIso).getTime() - Date.now() : 0;
  }

  now(): number {
    return Date.now() + this.offsetMs;
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

function createUiTestRig(options?: {
  online?: boolean;
  numberOfQuestions?: number;
  nowIso?: string;
  eventOverrides?: Partial<EventConfig>;
  settingsOverrides?: Partial<EventConfig['settings']>;
}) {
  const clock = new UiTestClock(options?.nowIso);
  const random = new UiTestRandom();
  const localStore = new InMemoryLocalStore();
  const cloudGateway = new InMemoryCloudGateway({
    online: options?.online ?? true,
    seedDefaultEvent: false,
    nowIso: () => clock.toISOString(),
  });

  const event: EventConfig = {
    ...DEFAULT_EVENT_CONFIG,
    ...options?.eventOverrides,
    settings: {
      ...DEFAULT_EVENT_CONFIG.settings,
      numberOfQuestions: options?.numberOfQuestions ?? 2,
      minScoreForPrize: 2,
      timePerQuestion: 30,
      ...options?.settingsOverrides,
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
  afterEach(() => {
    document.documentElement.style.fontSize = '';
    document.documentElement.style.removeProperty('--virtual-keyboard-key-font-size');
    vi.restoreAllMocks();
  });

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

  it('inicia fade-out, entra na Tela de Descanso limpando alertas e teclado, e desperta com campos limpos', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { engine } = createUiTestRig({
        settingsOverrides: {
          idleTimeoutSeconds: 15,
          fadeOutLeadTimeSeconds: 3,
        },
      });

      const { container } = render(<TotemApp engine={engine} />);

      await act(async () => {
        await Promise.resolve();
      });

      const nameField = screen.getByLabelText('Nome');
      fireEvent.focus(nameField);
      fireEvent.change(nameField, { target: { value: 'maria' } });
      expect(document.getElementById('virtual-keyboard')).not.toBeNull();

      // Força abertura do alerta de validação com telefone vazio.
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Iniciar Quiz' }));
      });
      expect(document.getElementById('alert-modal')).not.toBeNull();

      const quizContainer = container.querySelector('.quiz-container');
      const accessibilityControls = document.getElementById('accessibility-controls');
      expect(accessibilityControls).not.toHaveClass('hidden-on-idle');

      // Avança 12,1s -> inicia esmaecimento (15s - 3s = 12s).
      await act(async () => {
        vi.advanceTimersByTime(12_100);
      });
      expect(quizContainer).toHaveClass('fading-to-idle');
      expect(document.getElementById('idle-screen')).not.toHaveClass('active');

      // Avança mais 3s -> atinge 15s, entra em Tela de Descanso e limpa estado transitório.
      await act(async () => {
        vi.advanceTimersByTime(3_000);
      });
      expect(document.getElementById('idle-screen')).toHaveClass('active');
      expect(document.getElementById('idle-screen')).toHaveAttribute('aria-hidden', 'false');
      expect(quizContainer).not.toHaveClass('fading-to-idle');
      expect(document.getElementById('alert-modal')).toBeNull();
      expect(document.getElementById('virtual-keyboard')).toBeNull();
      expect(accessibilityControls).toHaveClass('hidden-on-idle');
      expect(document.getElementById('idle-call-to-action')).toHaveTextContent(
        'TOQUE PARA COMEÇAR',
      );

      // Tocar na Tela de Descanso desperta para tela inicial com campos limpos.
      await act(async () => {
        fireEvent.touchStart(document.getElementById('idle-screen')!);
      });
      expect(document.getElementById('initial-screen')).toHaveClass('active');
      expect(document.getElementById('idle-screen')).toHaveAttribute('aria-hidden', 'true');
      expect(screen.getByLabelText('Nome')).toHaveValue('');
      expect(screen.getByLabelText('Telefone')).toHaveValue('');
      expect(document.getElementById('virtual-keyboard')).toBeNull();
      expect(accessibilityControls).not.toHaveClass('hidden-on-idle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reinicia ociosidade em eventos confiáveis do document e bloqueia reinício durante resize do teclado', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const capturedDocListeners: Record<string, EventListener> = {};
      const originalAddListener = document.addEventListener.bind(document);
      vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
        if (
          ['click', 'keydown', 'touchstart', 'mousemove', 'input', 'scroll'].includes(type) &&
          typeof listener === 'function'
        ) {
          capturedDocListeners[type] = listener;
        }
        originalAddListener(type, listener, options);
      });

      const { engine } = createUiTestRig({
        settingsOverrides: {
          idleTimeoutSeconds: 15,
          fadeOutLeadTimeSeconds: 3,
        },
      });

      const { container } = render(<TotemApp engine={engine} />);

      await act(async () => {
        await Promise.resolve();
      });

      fireEvent.focus(screen.getByLabelText('Nome'));
      const resizeHandle = document.getElementById('keyboard-resize-handle');
      expect(resizeHandle).not.toBeNull();

      const quizContainer = container.querySelector('.quiz-container');

      // Avança até entrar em fade-out (12,1s).
      await act(async () => {
        vi.advanceTimersByTime(12_100);
      });
      expect(quizContainer).toHaveClass('fading-to-idle');

      // Evento sintético não confiável (isTrusted = false) não reinicia o temporizador.
      act(() => {
        fireEvent.mouseMove(document);
      });
      expect(quizContainer).toHaveClass('fading-to-idle');

      // Evento confiável (isTrusted = true) fora do resize cancela o fade-out e reinicia o timer.
      act(() => {
        capturedDocListeners.mousemove({ isTrusted: true } as Event);
      });
      expect(quizContainer).not.toHaveClass('fading-to-idle');

      // Avança 10s (ainda faltam 2s para o novo fade-out).
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      expect(quizContainer).not.toHaveClass('fading-to-idle');

      // Inicia redimensionamento do teclado e entra em fade-out após mais 2,1s.
      fireEvent.mouseDown(resizeHandle!, { clientY: 700 });
      await act(async () => {
        vi.advanceTimersByTime(2_100);
      });
      expect(quizContainer).toHaveClass('fading-to-idle');

      // Durante o arraste de redimensionamento, até eventos confiáveis são ignorados pelo idle timer.
      act(() => {
        capturedDocListeners.mousemove({ isTrusted: true } as Event);
        capturedDocListeners.touchstart({ isTrusted: true } as Event);
        capturedDocListeners.click({ isTrusted: true } as Event);
      });
      expect(quizContainer).toHaveClass('fading-to-idle');

      // Ao completar os 15s totais desde o último reset, entra em Tela de Descanso.
      await act(async () => {
        vi.advanceTimersByTime(3_000);
      });
      expect(document.getElementById('idle-screen')).toHaveClass('active');
      expect(document.getElementById('virtual-keyboard')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('descarta Partida em andamento sem gravar no armazenamento quando entra em inatividade', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { engine, localStore, event } = createUiTestRig({
        numberOfQuestions: 1,
        settingsOverrides: {
          idleTimeoutSeconds: 15,
          fadeOutLeadTimeSeconds: 3,
        },
      });

      render(<TotemApp engine={engine} />);

      await act(async () => {
        await Promise.resolve();
      });

      fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'bruna' } });
      fireEvent.change(screen.getByLabelText('Telefone'), { target: { value: '61998765432' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Iniciar Quiz' }));
      });

      expect(document.getElementById('quiz-screen')).toHaveClass('active');

      await act(async () => {
        vi.advanceTimersByTime(15_100);
      });

      expect(document.getElementById('idle-screen')).toHaveClass('active');
      expect(await localStore.getMatches(event.id)).toHaveLength(0);
      expect(await localStore.getSyncQueue()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('exibe avisos e bloqueia ou oculta início conforme janela do Evento (before, after e during)', async () => {
    const startIso = '2026-11-16T10:00:00-03:00';
    const endIso = '2026-11-16T18:00:00-03:00';

    // Caso before: botão visível porém desabilitado, mensagem de início futuro e CTA "QUIZ EM BREVE!".
    const beforeRig = createUiTestRig({
      nowIso: '2026-11-16T09:00:00-03:00',
      eventOverrides: {
        name: 'Feira das Águas',
        startTime: startIso,
        endTime: endIso,
        enableOutOfPeriodMessage: true,
      },
    });
    const beforeRender = render(<TotemApp engine={beforeRig.engine} />);
    await waitFor(() => {
      expect(document.getElementById('event-status-message')).not.toBeNull();
    });
    expect(document.getElementById('event-status-message')?.textContent).toContain(
      'O quiz "Feira das Águas" ainda não começou!',
    );
    const beforeBtn = document.getElementById('start-quiz-btn') as HTMLButtonElement;
    expect(beforeBtn).toBeDisabled();
    expect(beforeBtn).not.toHaveClass('hidden');
    expect(document.getElementById('idle-call-to-action')).toHaveTextContent(
      'QUIZ EM BREVE!Toque para mais informações',
    );
    beforeRender.unmount();

    // Caso after: botão desabilitado e oculto, mensagem de encerramento e CTA "QUIZ ENCERRADO".
    const afterRig = createUiTestRig({
      nowIso: '2026-11-16T19:00:00-03:00',
      eventOverrides: {
        name: 'Feira das Águas',
        startTime: startIso,
        endTime: endIso,
        enableOutOfPeriodMessage: true,
      },
    });
    const afterRender = render(<TotemApp engine={afterRig.engine} />);
    await waitFor(() => {
      expect(document.getElementById('event-status-message')).not.toBeNull();
    });
    expect(document.getElementById('event-status-message')?.textContent).toContain(
      'O quiz "Feira das Águas" foi encerrado em',
    );
    const afterBtn = document.getElementById('start-quiz-btn') as HTMLButtonElement;
    expect(afterBtn).toBeDisabled();
    expect(afterBtn).toHaveClass('hidden');
    expect(afterBtn).not.toBeVisible();
    expect(document.getElementById('idle-call-to-action')).toHaveTextContent(
      'QUIZ ENCERRADOObrigado por participar!',
    );
    afterRender.unmount();

    // Caso during: sem aviso de bloqueio e botão habilitado.
    const duringRig = createUiTestRig({
      nowIso: '2026-11-16T12:00:00-03:00',
      eventOverrides: {
        name: 'Feira das Águas',
        startTime: startIso,
        endTime: endIso,
        enableOutOfPeriodMessage: true,
      },
    });
    render(<TotemApp engine={duringRig.engine} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Iniciar Quiz' })).toBeEnabled();
    });
    expect(document.getElementById('event-status-message')).toBeNull();
    expect(document.getElementById('idle-call-to-action')).toHaveTextContent(
      'TOQUE PARA COMEÇAR',
    );
  });

  it('permite digitar Nome e Telefone pelo Teclado Virtual, fecha no OK e fecha ao iniciar Partida', async () => {
    const user = userEvent.setup();
    const { engine } = createUiTestRig({ numberOfQuestions: 1 });

    render(<TotemApp engine={engine} />);

    const nameField = await screen.findByLabelText('Nome');
    const phoneField = screen.getByLabelText('Telefone');

    // Focar Nome abre layout QWERTY.
    fireEvent.focus(nameField);
    expect(document.getElementById('virtual-keyboard')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'A' }));
    await user.click(screen.getByRole('button', { name: 'N' }));
    await user.click(screen.getByRole('button', { name: 'A' }));
    await user.click(screen.getByRole('button', { name: 'ESPAÇO' }));
    await user.click(screen.getByRole('button', { name: 'Ç' }));
    await user.click(screen.getByRole('button', { name: 'APAGAR' }));
    await user.click(screen.getByRole('button', { name: 'P' }));
    expect(nameField).toHaveValue('ANA P');

    // Focar Telefone alterna para layout numérico 3x4.
    fireEvent.focus(phoneField);
    for (const digit of ['6', '1', '9', '8', '7', '6', '5', '4', '3', '2', '1']) {
      await user.click(screen.getByRole('button', { name: digit }));
    }
    expect(phoneField).toHaveValue('(61) 98765-4321');
    await user.click(screen.getByRole('button', { name: 'APAGAR' }));
    expect(phoneField).toHaveValue('(61) 9876-5432');

    // Tecla OK fecha o teclado virtual.
    await user.click(screen.getByRole('button', { name: 'OK' }));
    expect(document.getElementById('virtual-keyboard')).toBeNull();

    // Reabre no foco e fecha automaticamente ao sair da initial-screen.
    fireEvent.focus(nameField);
    expect(document.getElementById('virtual-keyboard')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Iniciar Quiz' }));
    expect(await screen.findByText('Qual a sigla da companhia de saneamento do DF?')).toBeInTheDocument();
    expect(document.getElementById('virtual-keyboard')).toBeNull();
  });

  it('respeita enableVirtualKeyboard=false, integra controles A-/A+ e bloqueia menu de contexto', async () => {
    const user = userEvent.setup();
    const { engine } = createUiTestRig({
      settingsOverrides: {
        enableVirtualKeyboard: false,
      },
    });

    const { container } = render(<TotemApp engine={engine} />);
    const nameField = await screen.findByLabelText('Nome');

    fireEvent.focus(nameField);
    expect(document.getElementById('virtual-keyboard')).toBeNull();

    // Controles de acessibilidade integrados no Totem.
    expect(document.documentElement.style.fontSize).toBe('18px');
    await user.click(screen.getByRole('button', { name: 'Aumentar tamanho da fonte' }));
    expect(document.documentElement.style.fontSize).toBe('20px');
    await user.click(screen.getByRole('button', { name: 'Diminuir tamanho da fonte' }));
    expect(document.documentElement.style.fontSize).toBe('18px');

    // Bloqueio do menu de contexto nativo (clique direito / toque longo).
    const contextMenuEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
    });
    const dispatchResult = container.dispatchEvent(contextMenuEvent);
    expect(dispatchResult).toBe(false);
    expect(contextMenuEvent.defaultPrevented).toBe(true);
  });

  it('exibe celebração Top 3, status de Brinde (Aguardando Retirada) e tela de Ranking Geral ordenada', async () => {
    const user = userEvent.setup();
    const { engine } = createUiTestRig({
      numberOfQuestions: 1,
      settingsOverrides: {
        minScoreForPrize: 1,
        requireManualPrizeConfirmation: true,
        enablePrizeLock: false,
      },
    });

    render(<TotemApp engine={engine} />);

    // Ranking vazio a partir da tela inicial
    await user.click(await screen.findByRole('button', { name: 'Ver Ranking' }));
    expect(document.getElementById('ranking-screen')).toHaveClass('active');
    expect(screen.getByText('Nenhum participante no ranking ainda.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Voltar ao Início' }));

    // Joga e conquista 1º lugar (TOP 1) e Brinde Aguardando Retirada
    await user.type(screen.getByLabelText('Nome'), 'helena');
    await user.type(screen.getByLabelText('Telefone'), '61991110000');
    await user.click(screen.getByRole('button', { name: 'Iniciar Quiz' }));
    await user.click(await screen.findByRole('button', { name: 'CAESB' }));
    await user.click(screen.getByRole('button', { name: 'Finalizar Quiz' }));

    // Modal Top 3 abre automaticamente
    expect(await screen.findByText('TOP 1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'OK!' }));

    expect(screen.getByText('Aguardando Retirada')).toBeInTheDocument();
    expect(screen.getByText('1º lugar')).toBeInTheDocument();

    // Abre Ranking a partir da tela de resultado
    await user.click(screen.getByRole('button', { name: 'Ver Ranking' }));
    expect(document.getElementById('ranking-screen')).toHaveClass('active');
    expect(screen.getByText('HELENA')).toBeInTheDocument();
    expect(screen.getByText('1 Acertos')).toBeInTheDocument();
  });

  it('exibe modal da Trava de Brinde com data/hora quando telefone já premiado tenta jogar novamente', async () => {
    const user = userEvent.setup();
    const { engine } = createUiTestRig({
      nowIso: '2026-11-15T14:35:00-03:00',
      numberOfQuestions: 1,
      settingsOverrides: {
        minScoreForPrize: 1,
        enablePrizeLock: true,
      },
    });

    render(<TotemApp engine={engine} />);

    await user.type(await screen.findByLabelText('Nome'), 'tiago');
    await user.type(screen.getByLabelText('Telefone'), '61995551234');
    await user.click(screen.getByRole('button', { name: 'Iniciar Quiz' }));
    await user.click(await screen.findByRole('button', { name: 'CAESB' }));
    await user.click(screen.getByRole('button', { name: 'Finalizar Quiz' }));

    await user.click(await screen.findByRole('button', { name: 'OK!' }));
    await user.click(screen.getByRole('button', { name: 'Jogar Novamente' }));

    // Tenta iniciar novamente com o mesmo telefone
    await user.type(screen.getByLabelText('Nome'), 'tiago');
    await user.type(screen.getByLabelText('Telefone'), '61995551234');
    await user.click(screen.getByRole('button', { name: 'Iniciar Quiz' }));

    expect(await screen.findByText(/Segura a emoção, campeão/i)).toBeInTheDocument();
    expect(document.getElementById('winner-already-timestamp')?.textContent).toMatch(
      /Participação em: \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}/,
    );

    await user.click(screen.getByRole('button', { name: 'Entendi!' }));
    expect(document.getElementById('winner-already-modal')).toBeNull();
    expect(screen.getByLabelText('Nome')).toHaveValue('');
    expect(screen.getByLabelText('Telefone')).toHaveValue('');
  });

  it('permite desistir durante a Partida com confirmação e aplica Bloqueio por Desistência', async () => {
    const user = userEvent.setup();
    const { engine, localStore, event } = createUiTestRig({
      numberOfQuestions: 1,
      settingsOverrides: {
        giveUpLockoutMinutes: 4,
      },
    });

    render(<TotemApp engine={engine} />);

    await user.type(await screen.findByLabelText('Nome'), 'diego');
    await user.type(screen.getByLabelText('Telefone'), '61993334444');
    await user.click(screen.getByRole('button', { name: 'Iniciar Quiz' }));

    await user.click(await screen.findByRole('button', { name: 'Desistir do Quiz' }));
    expect(
      screen.getByText('Tem certeza que deseja desistir do quiz? Seu progresso atual não será salvo.'),
    ).toBeInTheDocument();

    // Cancela primeiro e garante permanência no quiz
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(document.getElementById('quiz-screen')).toHaveClass('active');

    // Agora confirma a desistência
    await user.click(screen.getByRole('button', { name: 'Desistir do Quiz' }));
    await user.click(screen.getByRole('button', { name: 'Sair' }));

    expect(document.getElementById('initial-screen')).toHaveClass('active');
    expect(await localStore.getMatches(event.id)).toHaveLength(0);

    // Tentar iniciar novamente com o mesmo telefone mostra alerta de bloqueio
    await user.type(screen.getByLabelText('Nome'), 'diego');
    await user.type(screen.getByLabelText('Telefone'), '61993334444');
    await user.click(screen.getByRole('button', { name: 'Iniciar Quiz' }));

    expect(
      await screen.findByText(/Você desistiu recentemente do quiz e está bloqueado por 4 minuto\(s\)/i),
    ).toBeInTheDocument();
  });
});
