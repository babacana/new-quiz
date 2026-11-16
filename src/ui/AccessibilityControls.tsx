import { useEffect, useState } from 'react';
import { DEFAULT_FONT_STEP_INDEX, FONT_SIZES_PX } from './accessibilityConstants';

export { DEFAULT_FONT_STEP_INDEX, FONT_SIZES_PX };

export interface AccessibilityControlsProps {
  hiddenOnIdle: boolean;
  onInteraction?: () => void;
}

// Controles flutuantes de acessibilidade para ajustar o tamanho base da fonte entre 10px e 30px.
export function AccessibilityControls({
  hiddenOnIdle,
  onInteraction,
}: AccessibilityControlsProps) {
  const [fontStepIndex, setFontStepIndex] = useState<number>(DEFAULT_FONT_STEP_INDEX);

  // Sincroniza o tamanho de fonte selecionado no elemento raiz do documento.
  useEffect(() => {
    const targetFontSizePx = FONT_SIZES_PX[fontStepIndex] ?? FONT_SIZES_PX[DEFAULT_FONT_STEP_INDEX];
    document.documentElement.style.fontSize = `${targetFontSizePx}px`;
  }, [fontStepIndex]);

  const handleDecreaseFont = () => {
    setFontStepIndex((currentIndex) => (currentIndex > 0 ? currentIndex - 1 : currentIndex));
    onInteraction?.();
  };

  const handleIncreaseFont = () => {
    setFontStepIndex((currentIndex) =>
      currentIndex < FONT_SIZES_PX.length - 1 ? currentIndex + 1 : currentIndex,
    );
    onInteraction?.();
  };

  return (
    <div
      id="accessibility-controls"
      className={
        hiddenOnIdle
          ? 'accessibility-controls-container hidden-on-idle'
          : 'accessibility-controls-container'
      }
    >
      <button
        id="decrease-font"
        type="button"
        title="Diminuir fonte"
        aria-label="Diminuir tamanho da fonte"
        disabled={fontStepIndex === 0}
        onClick={handleDecreaseFont}
      >
        A-
      </button>
      <button
        id="increase-font"
        type="button"
        title="Aumentar fonte"
        aria-label="Aumentar tamanho da fonte"
        disabled={fontStepIndex === FONT_SIZES_PX.length - 1}
        onClick={handleIncreaseFont}
      >
        A+
      </button>
    </div>
  );
}
