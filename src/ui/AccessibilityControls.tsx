import { useEffect, useState } from 'react';
import { DEFAULT_FONT_STEP_INDEX, FONT_SCALE_STEPS } from './accessibilityConstants';

export { DEFAULT_FONT_STEP_INDEX, FONT_SCALE_STEPS };

export interface AccessibilityControlsProps {
  hiddenOnIdle: boolean;
  onInteraction?: () => void;
  onOpenDiagnostics?: () => void;
}

// Controles flutuantes de acessibilidade (A-/A+ em escala relativa) e diagnóstico local (⚙️).
export function AccessibilityControls({
  hiddenOnIdle,
  onInteraction,
  onOpenDiagnostics,
}: AccessibilityControlsProps) {
  const [fontStepIndex, setFontStepIndex] = useState<number>(DEFAULT_FONT_STEP_INDEX);

  // Sincroniza o multiplicador proporcional --totem-a11y-scale no palco sem vazar para o Admin.
  useEffect(() => {
    const scale = FONT_SCALE_STEPS[fontStepIndex] ?? FONT_SCALE_STEPS[DEFAULT_FONT_STEP_INDEX];
    document.documentElement.style.setProperty('--totem-a11y-scale', String(scale));
    return () => {
      document.documentElement.style.removeProperty('--totem-a11y-scale');
    };
  }, [fontStepIndex]);

  const handleDecreaseFont = () => {
    setFontStepIndex((currentIndex) => (currentIndex > 0 ? currentIndex - 1 : currentIndex));
    onInteraction?.();
  };

  const handleIncreaseFont = () => {
    setFontStepIndex((currentIndex) =>
      currentIndex < FONT_SCALE_STEPS.length - 1 ? currentIndex + 1 : currentIndex,
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
        disabled={fontStepIndex === FONT_SCALE_STEPS.length - 1}
        onClick={handleIncreaseFont}
      >
        A+
      </button>
      {onOpenDiagnostics && (
        <button
          id="diagnostics-access-btn"
          type="button"
          title="Diagnóstico Local do Totem"
          aria-label="Diagnóstico local do Totem"
          onClick={() => {
            onOpenDiagnostics();
            onInteraction?.();
          }}
        >
          ⚙️
        </button>
      )}
    </div>
  );
}
