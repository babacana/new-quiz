import { useEffect, useRef, useState } from 'react';
import { translate, type Language } from '../i18n';
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
  onClose?: () => void;
  /** Idioma do teclado de nome (EN sem Ç, ES com Ñ e acentos por toque longo). */
  language?: Language;
}

interface KeyboardKeyDescriptor {
  key: string;
  label: string;
  className?: string;
  gridColumn?: string;
  /** Variantes acentuadas oferecidas no toque longo. */
  accents?: readonly string[];
}

const ES_ACCENTS: Record<string, readonly string[]> = {
  A: ['Á'],
  E: ['É'],
  I: ['Í'],
  O: ['Ó'],
  U: ['Ú', 'Ü'],
};
const LONG_PRESS_MS = 450;

function letterKeys(letters: string[], extra?: (letter: string) => Partial<KeyboardKeyDescriptor>) {
  return letters.map((letter) => ({ key: letter, label: letter, ...extra?.(letter) }));
}

function buildNameKeys(language: Language): readonly KeyboardKeyDescriptor[] {
  const row1 = 'QWERTYUIOP'.split('');
  const row2 = 'ASDFGHJKL'.split('');
  const row3 = 'ZXCVBNM'.split('');
  const accents = language === 'es' ? (l: string) => ({ accents: ES_ACCENTS[l] }) : undefined;
  const lastOfRow2 =
    language === 'pt'
      ? { key: 'Ç', label: 'Ç' }
      : language === 'es'
        ? { key: 'Ñ', label: 'Ñ' }
        : null;
  return [
    ...letterKeys(row1, accents),
    ...letterKeys(row2, (l) => ({
      ...accents?.(l),
      // Sem tecla extra (inglês), o L ocupa a coluna restante para manter a grade alinhada.
      ...(l === 'L' && !lastOfRow2 ? { gridColumn: 'span 2' } : {}),
    })),
    ...(lastOfRow2 ? [lastOfRow2] : []),
    ...letterKeys(row3),
    { key: 'Backspace', label: 'keyboard.backspace', className: 'key-backspace', gridColumn: 'span 3' },
    { key: 'Space', label: 'keyboard.space', className: 'key-space', gridColumn: 'span 7' },
    { key: 'NEXT', label: 'keyboard.next', className: 'ok-key-highlight', gridColumn: 'span 3' },
  ];
}

const NAME_KEYS_BY_LANGUAGE: Record<Language, readonly KeyboardKeyDescriptor[]> = {
  pt: buildNameKeys('pt'),
  en: buildNameKeys('en'),
  es: buildNameKeys('es'),
};

const PHONE_KEYS: readonly KeyboardKeyDescriptor[] = [
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => ({
    key: digit,
    label: digit,
  })),
  { key: 'Backspace', label: 'keyboard.backspace', className: 'key-backspace' },
  { key: '0', label: '0' },
  { key: 'SUBMIT', label: 'keyboard.play', className: 'ok-key-highlight' },
];

const LAYOUT_CONFIG: Record<VirtualKeyboardField, { gridTemplateColumns: string }> = {
  nome: { gridTemplateColumns: 'repeat(10, 1fr)' },
  telefone: { gridTemplateColumns: 'repeat(3, 1fr)' },
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
  onClose,
  language = 'pt',
}: VirtualKeyboardProps) {
  const [accentPopupFor, setAccentPopupFor] = useState<string | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);
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

  // Fecha as variantes acentuadas ao tocar fora delas ou quando o teclado some / o idioma muda.
  useEffect(() => {
    if (accentPopupFor === null) {
      return;
    }
    const close = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.virtual-key-accents')) {
        return;
      }
      setAccentPopupFor(null);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [accentPopupFor]);

  useEffect(() => {
    setAccentPopupFor(null);
  }, [language, activeField, enabled]);

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

  // Fecha o teclado ao tocar fora dele e fora dos campos de texto.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isVisible || !onCloseRef.current) {
      return;
    }
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target.closest('#virtual-keyboard, #virtual-keyboard-close, input, textarea')) {
        return;
      }
      onCloseRef.current?.();
    };
    document.addEventListener('pointerdown', handleOutsidePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown);
    };
  }, [isVisible]);

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

  const layout = {
    ...LAYOUT_CONFIG[activeField],
    keys: activeField === 'nome' ? NAME_KEYS_BY_LANGUAGE[language] : PHONE_KEYS,
  };
  const t = (key: string) => translate(language, key as Parameters<typeof translate>[1]);

  const cancelLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  return (
    <>
    {onClose ? (
      <button
        id="virtual-keyboard-close"
        type="button"
        className="virtual-keyboard-close"
        style={{ bottom: `${clampedHeightVh}vh` }}
        aria-label={t('keyboard.close')}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClose}
      >
        {t('keyboard.closeButton')}
      </button>
    ) : null}
    <div
      id="virtual-keyboard"
      className={isResizing ? 'virtual-keyboard resizing' : 'virtual-keyboard'}
      style={{
        height: `${clampedHeightVh}vh`,
        gridTemplateColumns: layout.gridTemplateColumns,
      }}
      aria-label={t('keyboard.aria')}
    >
      <div
        id="keyboard-resize-handle"
        ref={handleRef}
        className={isResizing ? 'resizing' : undefined}
        aria-label={t('keyboard.resize')}
      />
      {layout.keys.map((descriptor) => {
        const label = descriptor.label.startsWith('keyboard.') ? t(descriptor.label) : descriptor.label;
        const className = descriptor.className ? `virtual-key ${descriptor.className}` : 'virtual-key';
        const style = descriptor.gridColumn ? { gridColumn: descriptor.gridColumn } : undefined;

        if (descriptor.accents) {
          const accents = descriptor.accents;
          // Toque curto digita a vogal; toque longo abre as variantes acentuadas.
          return (
            <div key={descriptor.key} className="virtual-key-wrapper" style={style}>
              <button
                type="button"
                className={className}
                onMouseDown={(event) => event.preventDefault()}
                onPointerDown={() => {
                  longPressFiredRef.current = false;
                  cancelLongPress();
                  longPressTimerRef.current = window.setTimeout(() => {
                    longPressFiredRef.current = true;
                    setAccentPopupFor(descriptor.key);
                  }, LONG_PRESS_MS);
                }}
                onPointerUp={cancelLongPress}
                onPointerLeave={cancelLongPress}
                onPointerCancel={cancelLongPress}
                onContextMenu={(event) => event.preventDefault()}
                onClick={() => {
                  if (longPressFiredRef.current) {
                    longPressFiredRef.current = false;
                    return;
                  }
                  onKeyPress(descriptor.key);
                }}
              >
                {label}
              </button>
              {accentPopupFor === descriptor.key && (
                <div className="virtual-key-accents" role="group">
                  {[descriptor.key, ...accents].map((variant) => (
                    <button
                      key={variant}
                      type="button"
                      className="virtual-key"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setAccentPopupFor(null);
                        onKeyPress(variant);
                      }}
                    >
                      {variant}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        }

        return (
          <button
            key={descriptor.key}
            type="button"
            className={className}
            style={style}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onKeyPress(descriptor.key)}
          >
            {label}
          </button>
        );
      })}
    </div>
    </>
  );
}
