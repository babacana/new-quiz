import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccessibilityControls,
  DEFAULT_FONT_STEP_INDEX,
  FONT_SIZES_PX,
} from '../AccessibilityControls';
import {
  DEFAULT_KEYBOARD_HEIGHT_VH,
  MAX_KEYBOARD_HEIGHT_VH,
  MIN_KEYBOARD_HEIGHT_VH,
  VirtualKeyboard,
} from '../VirtualKeyboard';
import {
  clampKeyboardHeightVh,
  computeKeyboardKeyFontSizePx,
} from '../accessibilityConstants';

// Wrapper controlado para validar a atualização visual da altura durante o arraste.
function ControlledVirtualKeyboardHarness({
  initialHeightVh = DEFAULT_KEYBOARD_HEIGHT_VH,
  onHeightSpy,
  onKeyPress = vi.fn(),
  onResizingChange = vi.fn(),
}: {
  initialHeightVh?: number;
  onHeightSpy?: (heightVh: number) => void;
  onKeyPress?: (key: string) => void;
  onResizingChange?: (isResizing: boolean) => void;
}) {
  const [heightVh, setHeightVh] = useState(initialHeightVh);

  return (
    <VirtualKeyboard
      activeField="nome"
      enabled={true}
      heightVh={heightVh}
      onHeightVhChange={(nextHeightVh) => {
        setHeightVh(nextHeightVh);
        onHeightSpy?.(nextHeightVh);
      }}
      onKeyPress={onKeyPress}
      onResizingChange={onResizingChange}
    />
  );
}

describe('VirtualKeyboard e helpers de dimensionamento', () => {
  const originalInnerHeight = window.innerHeight;

  beforeEach(() => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 1000,
    });
    document.documentElement.style.removeProperty('--virtual-keyboard-key-font-size');
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: originalInnerHeight,
    });
    document.documentElement.style.removeProperty('--virtual-keyboard-key-font-size');
  });

  it('expõe constantes e aplica clamp de altura entre 20vh e 60vh', () => {
    expect(MIN_KEYBOARD_HEIGHT_VH).toBe(20);
    expect(MAX_KEYBOARD_HEIGHT_VH).toBe(60);
    expect(DEFAULT_KEYBOARD_HEIGHT_VH).toBe(30);

    expect(clampKeyboardHeightVh(10)).toBe(20);
    expect(clampKeyboardHeightVh(35)).toBe(35);
    expect(clampKeyboardHeightVh(80)).toBe(60);
    expect(clampKeyboardHeightVh(Number.NaN)).toBe(30);
  });

  it('calcula o tamanho da fonte das teclas entre 14px e 32px usando altura limitada', () => {
    // (30 / 100) * 1000 * 0.08 = 24px
    expect(computeKeyboardKeyFontSizePx(30, 1000)).toBe(24);
    // Altura abaixo de 20vh é limitada a 20vh: (20 / 100) * 500 * 0.08 = 8 -> mínimo 14px
    expect(computeKeyboardKeyFontSizePx(10, 500)).toBe(14);
    // Altura acima de 60vh é limitada a 60vh: (60 / 100) * 1000 * 0.08 = 48 -> máximo 32px
    expect(computeKeyboardKeyFontSizePx(90, 1000)).toBe(32);
  });

  it('não renderiza #virtual-keyboard quando desabilitado ou sem campo ativo', () => {
    const { rerender } = render(
      <VirtualKeyboard
        activeField="nome"
        enabled={false}
        heightVh={30}
        onHeightVhChange={vi.fn()}
        onKeyPress={vi.fn()}
      />,
    );

    expect(document.getElementById('virtual-keyboard')).toBeNull();

    rerender(
      <VirtualKeyboard
        activeField={null}
        enabled={true}
        heightVh={30}
        onHeightVhChange={vi.fn()}
        onKeyPress={vi.fn()}
      />,
    );

    expect(document.getElementById('virtual-keyboard')).toBeNull();
  });

  it('renderiza layout QWERTY completo para nome e emite identificadores brutos das teclas', async () => {
    const user = userEvent.setup();
    const onKeyPress = vi.fn();

    render(
      <VirtualKeyboard
        activeField="nome"
        enabled={true}
        heightVh={32}
        onHeightVhChange={vi.fn()}
        onKeyPress={onKeyPress}
      />,
    );

    const keyboard = document.getElementById('virtual-keyboard');
    expect(keyboard).not.toBeNull();
    expect(keyboard?.style.height).toBe('32vh');
    expect(keyboard?.style.gridTemplateColumns).toBe('repeat(10, 1fr)');

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P',
      'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ç',
      'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'APAGAR',
      'ESPAÇO', 'OK',
    ]);

    const backspaceBtn = screen.getByRole('button', { name: 'APAGAR' });
    const spaceBtn = screen.getByRole('button', { name: 'ESPAÇO' });
    const okBtn = screen.getByRole('button', { name: 'OK' });

    expect(backspaceBtn.style.gridColumn).toBe('span 3');
    expect(spaceBtn.style.gridColumn).toBe('span 7');
    expect(okBtn.style.gridColumn).toBe('span 3');
    expect(okBtn).toHaveClass('ok-key-highlight');

    await user.click(screen.getByRole('button', { name: 'A' }));
    await user.click(screen.getByRole('button', { name: 'Ç' }));
    await user.click(backspaceBtn);
    await user.click(spaceBtn);
    await user.click(okBtn);

    expect(onKeyPress.mock.calls.map((call) => call[0])).toEqual([
      'A',
      'Ç',
      'Backspace',
      'Space',
      'OK',
    ]);
  });

  it('renderiza layout numérico para telefone e emite dígitos e ações', async () => {
    const user = userEvent.setup();
    const onKeyPress = vi.fn();

    render(
      <VirtualKeyboard
        activeField="telefone"
        enabled={true}
        heightVh={30}
        onHeightVhChange={vi.fn()}
        onKeyPress={onKeyPress}
      />,
    );

    const keyboard = document.getElementById('virtual-keyboard');
    expect(keyboard).not.toBeNull();
    expect(keyboard?.style.gridTemplateColumns).toBe('repeat(3, 1fr)');

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      '1', '2', '3',
      '4', '5', '6',
      '7', '8', '9',
      'APAGAR', '0', 'OK',
    ]);

    const okBtn = screen.getByRole('button', { name: 'OK' });
    expect(okBtn).toHaveClass('ok-key-highlight');

    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '0' }));
    await user.click(screen.getByRole('button', { name: 'APAGAR' }));
    await user.click(okBtn);

    expect(onKeyPress.mock.calls.map((call) => call[0])).toEqual([
      '1',
      '0',
      'Backspace',
      'OK',
    ]);
  });

  it('redimensiona via mouse entre 20vh e 60vh, ajusta fonte das teclas e notifica onResizingChange', () => {
    const onHeightSpy = vi.fn();
    const onResizingChange = vi.fn();

    render(
      <ControlledVirtualKeyboardHarness
        initialHeightVh={30}
        onHeightSpy={onHeightSpy}
        onResizingChange={onResizingChange}
      />,
    );

    const keyboard = document.getElementById('virtual-keyboard');
    const handle = document.getElementById('keyboard-resize-handle');
    expect(keyboard).not.toBeNull();
    expect(handle).not.toBeNull();

    // Fonte inicial para 30vh em viewport de 1000px = 24px
    expect(document.documentElement.style.getPropertyValue('--virtual-keyboard-key-font-size')).toBe(
      '24px',
    );

    // Inicia arraste com mouse em y = 700
    fireEvent.mouseDown(handle!, { clientY: 700 });
    expect(onResizingChange).toHaveBeenCalledWith(true);
    expect(keyboard).toHaveClass('resizing');

    // Arrasta 200px para cima -> +20vh -> 50vh (fonte 40 -> clamp 32px)
    fireEvent.mouseMove(document, { clientY: 500 });
    expect(onHeightSpy).toHaveBeenLastCalledWith(50);
    expect(keyboard?.style.height).toBe('50vh');
    expect(document.documentElement.style.getPropertyValue('--virtual-keyboard-key-font-size')).toBe(
      '32px',
    );

    // Arrasta muito para cima (y = 100) -> clamp máximo em 60vh
    fireEvent.mouseMove(document, { clientY: 100 });
    expect(onHeightSpy).toHaveBeenLastCalledWith(60);
    expect(keyboard?.style.height).toBe('60vh');

    // Arrasta muito para baixo (y = 950) -> clamp mínimo em 20vh (fonte 16px)
    fireEvent.mouseMove(document, { clientY: 950 });
    expect(onHeightSpy).toHaveBeenLastCalledWith(20);
    expect(keyboard?.style.height).toBe('20vh');
    expect(document.documentElement.style.getPropertyValue('--virtual-keyboard-key-font-size')).toBe(
      '16px',
    );

    // Solta o mouse
    fireEvent.mouseUp(document);
    expect(onResizingChange).toHaveBeenLastCalledWith(false);
    expect(keyboard).not.toHaveClass('resizing');
  });

  it('redimensiona via eventos touch e encerra estado ao finalizar toque', () => {
    const onHeightSpy = vi.fn();
    const onResizingChange = vi.fn();

    render(
      <ControlledVirtualKeyboardHarness
        initialHeightVh={30}
        onHeightSpy={onHeightSpy}
        onResizingChange={onResizingChange}
      />,
    );

    const keyboard = document.getElementById('virtual-keyboard');
    const handle = document.getElementById('keyboard-resize-handle');
    expect(handle).not.toBeNull();

    fireEvent.touchStart(handle!, { touches: [{ clientY: 700 }] });
    expect(onResizingChange).toHaveBeenCalledWith(true);

    // Arrasta 100px para cima -> 40vh (fonte 32px)
    fireEvent.touchMove(document, { touches: [{ clientY: 600 }] });
    expect(onHeightSpy).toHaveBeenLastCalledWith(40);
    expect(keyboard?.style.height).toBe('40vh');
    expect(document.documentElement.style.getPropertyValue('--virtual-keyboard-key-font-size')).toBe(
      '32px',
    );

    fireEvent.touchEnd(document);
    expect(onResizingChange).toHaveBeenLastCalledWith(false);
  });

  it('encerra redimensionamento e limpa listeners se o teclado for ocultado durante o arraste', () => {
    const onHeightVhChange = vi.fn();
    const onResizingChange = vi.fn();

    const { rerender } = render(
      <VirtualKeyboard
        activeField="nome"
        enabled={true}
        heightVh={30}
        onHeightVhChange={onHeightVhChange}
        onKeyPress={vi.fn()}
        onResizingChange={onResizingChange}
      />,
    );

    const handle = document.getElementById('keyboard-resize-handle');
    fireEvent.mouseDown(handle!, { clientY: 700 });
    expect(onResizingChange).toHaveBeenLastCalledWith(true);

    rerender(
      <VirtualKeyboard
        activeField={null}
        enabled={true}
        heightVh={30}
        onHeightVhChange={onHeightVhChange}
        onKeyPress={vi.fn()}
        onResizingChange={onResizingChange}
      />,
    );

    expect(onResizingChange).toHaveBeenLastCalledWith(false);

    // Movimentos após ocultamento não devem disparar callbacks residuais.
    fireEvent.mouseMove(document, { clientY: 500 });
    expect(onHeightVhChange).not.toHaveBeenCalled();
  });
});

describe('AccessibilityControls', () => {
  beforeEach(() => {
    document.documentElement.style.fontSize = '';
  });

  afterEach(() => {
    document.documentElement.style.fontSize = '';
  });

  it('expõe escala de fontes de 10px a 30px com índice padrão 4 (18px)', () => {
    expect(FONT_SIZES_PX).toEqual([10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30]);
    expect(DEFAULT_FONT_STEP_INDEX).toBe(4);
    expect(FONT_SIZES_PX[DEFAULT_FONT_STEP_INDEX]).toBe(18);
  });

  it('aplica classe hidden-on-idle conforme prop hiddenOnIdle', () => {
    const { rerender } = render(<AccessibilityControls hiddenOnIdle={false} />);

    const container = document.getElementById('accessibility-controls');
    expect(container).not.toBeNull();
    expect(container).toHaveClass('accessibility-controls-container');
    expect(container).not.toHaveClass('hidden-on-idle');

    rerender(<AccessibilityControls hiddenOnIdle={true} />);
    expect(container).toHaveClass('accessibility-controls-container', 'hidden-on-idle');
  });

  it('ajusta tamanho da fonte entre 10px e 30px, desabilita nos extremos e dispara onInteraction', async () => {
    const user = userEvent.setup();
    const onInteraction = vi.fn();

    render(<AccessibilityControls hiddenOnIdle={false} onInteraction={onInteraction} />);

    const decreaseBtn = screen.getByRole('button', { name: 'Diminuir tamanho da fonte' });
    const increaseBtn = screen.getByRole('button', { name: 'Aumentar tamanho da fonte' });

    expect(decreaseBtn).toHaveAttribute('id', 'decrease-font');
    expect(decreaseBtn).toHaveTextContent('A-');
    expect(increaseBtn).toHaveAttribute('id', 'increase-font');
    expect(increaseBtn).toHaveTextContent('A+');

    // Estado inicial em 18px
    expect(document.documentElement.style.fontSize).toBe('18px');
    expect(decreaseBtn).toBeEnabled();
    expect(increaseBtn).toBeEnabled();

    // Aumenta até 30px (6 passos a partir do índice 4)
    for (const expectedPx of [20, 22, 24, 26, 28, 30]) {
      await user.click(increaseBtn);
      expect(document.documentElement.style.fontSize).toBe(`${expectedPx}px`);
    }

    expect(increaseBtn).toBeDisabled();
    expect(decreaseBtn).toBeEnabled();
    expect(onInteraction).toHaveBeenCalledTimes(6);

    // Diminui de 30px até 10px (10 passos)
    for (const expectedPx of [28, 26, 24, 22, 20, 18, 16, 14, 12, 10]) {
      await user.click(decreaseBtn);
      expect(document.documentElement.style.fontSize).toBe(`${expectedPx}px`);
    }

    expect(decreaseBtn).toBeDisabled();
    expect(increaseBtn).toBeEnabled();
    expect(onInteraction).toHaveBeenCalledTimes(16);
  });
});
