import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_KEYBOARD_HEIGHT_VH,
  MAX_KEYBOARD_HEIGHT_VH,
  MIN_KEYBOARD_HEIGHT_VH,
  clampKeyboardHeightVh,
  computeKeyboardKeyFontSizePx,
} from './accessibilityConstants';

export {
  DEFAULT_KEYBOARD_HEIGHT_VH,
  MAX_KEYBOARD_HEIGHT_VH,
  MIN_KEYBOARD_HEIGHT_VH,
};

export type VirtualKeyboardField = 'nome' | 'telefone';

export interface VirtualKeyboardProps {
  activeField: VirtualKeyboardField | null;
  enabled: boolean;
  heightVh: number;
  onHeightVhChange: (heightVh: number) => void;
  onKeyPress: (key: string) => void;
  onResizingChange?: (isResizing: boolean) => void;
}

interface KeyboardKeyDescriptor {
  key: string;
  label: string;
  className?: string;
  gridColumn?: string;
}

const NAME_KEYS: readonly KeyboardKeyDescriptor[] = [
  ...['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'].map((letter) => ({
    key: letter,
    label: letter,
  })),
  ...['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ç'].map((letter) => ({
    key: letter,
    label: letter,
  })),
  ...['Z', 'X', 'C', 'V', 'B', 'N', 'M'].map((letter) => ({
    key: letter,
    label: letter,
  })),
  { key: 'Backspace', label: 'APAGAR', className: 'key-backspace', gridColumn: 'span 3' },
  { key: 'Space', label: 'ESPAÇO', className: 'key-space', gridColumn: 'span 7' },
  { key: 'NEXT', label: 'PRÓXIMO', className: 'ok-key-highlight', gridColumn: 'span 3' },
];

const PHONE_KEYS: readonly KeyboardKeyDescriptor[] = [
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => ({
    key: digit,
    label: digit,
  })),
  { key: 'Backspace', label: 'APAGAR', className: 'key-backspace' },
  { key: '0', label: '0' },
  { key: 'SUBMIT', label: 'JOGAR', className: 'ok-key-highlight' },
];

const LAYOUT_CONFIG: Record<
  VirtualKeyboardField,
  { gridTemplateColumns: string; keys: readonly KeyboardKeyDescriptor[] }
> = {
  nome: { gridTemplateColumns: 'repeat(10, 1fr)', keys: NAME_KEYS },
  telefone: { gridTemplateColumns: 'repeat(3, 1fr)', keys: PHONE_KEYS },
};

function applyKeyboardKeyFontVar(targetHeightVh: number): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }
  const fontSizePx = computeKeyboardKeyFontSizePx(targetHeightVh, window.innerHeight);
  document.documentElement.style.setProperty('--virtual-keyboard-key-font-size', `${fontSizePx}px`);
}

function extractTouchClientY(event: TouchEvent): number | null {
  const touch = event.touches[0] ?? event.changedTouches[0];
  return touch ? touch.clientY : null;
}

// Teclado virtual para telas de toque com layout alfabético (nome), numérico (telefone) e alça de redimensionamento.
export function VirtualKeyboard({
  activeField,
  enabled,
  heightVh,
  onHeightVhChange,
  onKeyPress,
  onResizingChange,
}: VirtualKeyboardProps) {
  const isVisible = enabled && activeField !== null;
  const clampedHeightVh = clampKeyboardHeightVh(heightVh);
  const [isResizing, setIsResizing] = useState(false);

  const handleRef = useRef<HTMLDivElement | null>(null);
  const isResizingRef = useRef(false);
  const startPointerYRef = useRef(0);
  const startHeightVhRef = useRef(clampedHeightVh);
  const clampedHeightVhRef = useRef(clampedHeightVh);
  const cleanupDragListenersRef = useRef<(() => void) | null>(null);

  const onHeightVhChangeRef = useRef(onHeightVhChange);
  const onResizingChangeRef = useRef(onResizingChange);

  useEffect(() => {
    onHeightVhChangeRef.current = onHeightVhChange;
    onResizingChangeRef.current = onResizingChange;
  }, [onHeightVhChange, onResizingChange]);

  useEffect(() => {
    clampedHeightVhRef.current = clampedHeightVh;
  }, [clampedHeightVh]);

  // Mantém a variável CSS do tamanho da fonte das teclas sincronizada com a altura e a janela.
  useEffect(() => {
    if (!isVisible) {
      return;
    }

    applyKeyboardKeyFontVar(clampedHeightVh);

    const handleWindowResize = () => {
      applyKeyboardKeyFontVar(clampedHeightVhRef.current);
    };

    window.addEventListener('resize', handleWindowResize);
    return () => {
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [isVisible, clampedHeightVh]);

  // Configura listener touchstart não passivo na alça e garante limpeza de listeners caso o teclado feche.
  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const handleElement = handleRef.current;
    if (!handleElement) {
      return;
    }

    const finishResizeSession = () => {
      if (!isResizingRef.current) {
        return;
      }
      isResizingRef.current = false;
      cleanupDragListenersRef.current?.();
      cleanupDragListenersRef.current = null;
      setIsResizing(false);
      onResizingChangeRef.current?.(false);
    };

    const startResizeSession = (initialY: number) => {
      if (isResizingRef.current) {
        return;
      }

      isResizingRef.current = true;
      startPointerYRef.current = initialY;
      startHeightVhRef.current = clampedHeightVhRef.current;
      setIsResizing(true);
      onResizingChangeRef.current?.(true);

      const updateHeightFromPointer = (currentY: number) => {
        if (!isResizingRef.current) {
          return;
        }
        const viewportHeight = window.innerHeight;
        if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
          return;
        }
        const deltaY = currentY - startPointerYRef.current;
        const deltaVh = (deltaY / viewportHeight) * 100;
        const nextHeightVh = clampKeyboardHeightVh(startHeightVhRef.current - deltaVh);
        applyKeyboardKeyFontVar(nextHeightVh);
        onHeightVhChangeRef.current(nextHeightVh);
      };

      const onMouseMove = (moveEvent: MouseEvent) => {
        updateHeightFromPointer(moveEvent.clientY);
      };

      const onTouchMove = (moveEvent: TouchEvent) => {
        if (moveEvent.cancelable) {
          moveEvent.preventDefault();
        }
        const touchY = extractTouchClientY(moveEvent);
        if (touchY !== null) {
          updateHeightFromPointer(touchY);
        }
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('mouseup', finishResizeSession);
      document.addEventListener('touchend', finishResizeSession);
      document.addEventListener('touchcancel', finishResizeSession);

      cleanupDragListenersRef.current = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('mouseup', finishResizeSession);
        document.removeEventListener('touchend', finishResizeSession);
        document.removeEventListener('touchcancel', finishResizeSession);
      };
    };

    const onMouseDown = (mouseEvent: MouseEvent) => {
      startResizeSession(mouseEvent.clientY);
    };

    const onTouchStart = (touchEvent: TouchEvent) => {
      if (touchEvent.cancelable) {
        touchEvent.preventDefault();
      }
      const touchY = extractTouchClientY(touchEvent);
      if (touchY !== null) {
        startResizeSession(touchY);
      }
    };

    handleElement.addEventListener('mousedown', onMouseDown);
    handleElement.addEventListener('touchstart', onTouchStart, { passive: false });

    return () => {
      handleElement.removeEventListener('mousedown', onMouseDown);
      handleElement.removeEventListener('touchstart', onTouchStart);
      finishResizeSession();
    };
  }, [isVisible]);

  if (!isVisible || activeField === null) {
    return null;
  }

  const layout = LAYOUT_CONFIG[activeField];

  return (
    <div
      id="virtual-keyboard"
      className={isResizing ? 'virtual-keyboard resizing' : 'virtual-keyboard'}
      style={{
        height: `${clampedHeightVh}vh`,
        gridTemplateColumns: layout.gridTemplateColumns,
      }}
      aria-label="Teclado virtual"
    >
      <div
        id="keyboard-resize-handle"
        ref={handleRef}
        className={isResizing ? 'resizing' : undefined}
        aria-label="Redimensionar teclado virtual"
      />
      {layout.keys.map((descriptor) => (
        <button
          key={descriptor.key}
          type="button"
          className={
            descriptor.className ? `virtual-key ${descriptor.className}` : 'virtual-key'
          }
          style={descriptor.gridColumn ? { gridColumn: descriptor.gridColumn } : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onKeyPress(descriptor.key)}
        >
          {descriptor.label}
        </button>
      ))}
    </div>
  );
}
