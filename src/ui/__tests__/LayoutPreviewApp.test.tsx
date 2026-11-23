import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CUSTOMIZATIONS } from '../../domain/defaults';
import { updateLayoutElement, type LayoutScreenId } from '../../domain/screenLayout';
import type { EventLayout } from '../../domain/screenLayout';
import { LayoutPreviewApp } from '../LayoutPreviewApp';
import type { LayoutPreviewState } from '../layoutPreviewProtocol';

function sendState(partial: Partial<LayoutPreviewState> & { layout?: EventLayout }) {
  const { layout, ...rest } = partial;
  const state: LayoutPreviewState = {
    screenId: 'initial',
    customizations: { ...DEFAULT_CUSTOMIZATIONS, layout },
    lgpdNoticeText: '',
    quizAnswered: false,
    showConditional: false,
    highlightedElementId: null,
    ...rest,
  };
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'layout-editor', type: 'state', state },
        origin: window.location.origin,
        source: window,
      }),
    );
  });
}

const zone = (name: string) =>
  document.querySelector(`[data-testid="layout-preview-stage"] [data-layout-zone="${name}"]`)!;

describe('LayoutPreviewApp (Totem real dentro do iframe de prévia)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('não renderiza nada até receber o estado do editor e ignora mensagens de outra origem', () => {
    const { container } = render(<LayoutPreviewApp />);
    expect(container.firstChild).toBeNull();
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source: 'layout-editor', type: 'state', state: {} },
          origin: 'https://evil.example',
          source: window,
        }),
      );
    });
    expect(container.firstChild).toBeNull();
  });

  it('renderiza a Tela Inicial com o layout recebido, sem elementos condicionais por padrão', () => {
    render(<LayoutPreviewApp />);
    sendState({
      layout: updateLayoutElement(undefined, 'initial', 'startButton', { zone: 'bottom' }),
    });
    expect(zone('bottom').querySelector('#start-quiz-btn')).not.toBeNull();
    expect(document.getElementById('event-status-message')).toBeNull();
    expect(document.getElementById('lgpd-notice-text')).toBeNull();
    expect(document.documentElement.classList.contains('totem-fullscreen-mode')).toBe(true);
  });

  it('mostra aviso do Evento e LGPD quando pedido, e o aviso LGPD real do Evento', () => {
    render(<LayoutPreviewApp />);
    sendState({ showConditional: true });
    expect(document.getElementById('event-status-message')).not.toBeNull();
    expect(document.getElementById('lgpd-notice-text')).not.toBeNull();
    sendState({ showConditional: false, lgpdNoticeText: 'Aviso real do Evento' });
    expect(document.getElementById('lgpd-notice-text')?.textContent).toBe('Aviso real do Evento');
  });

  it.each<[LayoutScreenId, string]>([
    ['idle', '#idle-call-to-action'],
    ['quiz', '#options-container'],
    ['result', '#restart-quiz-btn'],
    ['ranking', '#ranking-list'],
  ])('renderiza a tela %s', (screenId, selector) => {
    render(<LayoutPreviewApp />);
    sendState({ screenId });
    expect(document.querySelector(selector)).not.toBeNull();
  });

  it('destaca o elemento selecionado e reflete o estado respondido do Quiz', () => {
    render(<LayoutPreviewApp />);
    sendState({ screenId: 'quiz', quizAnswered: true, highlightedElementId: 'question' });
    expect(document.querySelector('.layout-item.is-highlighted')?.getAttribute('data-layout-element')).toBe(
      'question',
    );
    expect(document.getElementById('next-question-btn')).not.toBeNull();
    expect(screen.queryByLabelText('Desistir do Quiz')).toBeNull();
  });
});
