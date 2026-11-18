// Constantes e funções puras compartilhadas entre teclado virtual e controles de acessibilidade.

export const MIN_KEYBOARD_HEIGHT_VH = 20;
export const MAX_KEYBOARD_HEIGHT_VH = 60;
export const DEFAULT_KEYBOARD_HEIGHT_VH = 30;

const MIN_KEY_FONT_SIZE_PX = 14;
const MAX_KEY_FONT_SIZE_PX = 32;
const KEY_FONT_HEIGHT_RATIO = 0.08;

// Multiplicadores relativos aplicados sobre o palco proporcional 9:16 via --totem-a11y-scale.
export const FONT_SCALE_STEPS: readonly number[] = [
  0.75, 0.82, 0.88, 0.94, 1.0, 1.08, 1.15, 1.22, 1.3, 1.38, 1.45,
];
export const DEFAULT_FONT_STEP_INDEX = 4;

// Limita a altura do teclado virtual ao intervalo permitido de 20vh a 60vh.
export function clampKeyboardHeightVh(heightVh: number): number {
  if (!Number.isFinite(heightVh)) {
    return DEFAULT_KEYBOARD_HEIGHT_VH;
  }
  return Math.max(MIN_KEYBOARD_HEIGHT_VH, Math.min(MAX_KEYBOARD_HEIGHT_VH, heightVh));
}

// Calcula o tamanho da fonte das teclas proporcional à altura do teclado e limitado entre 14px e 32px.
export function computeKeyboardKeyFontSizePx(heightVh: number, viewportHeightPx: number): number {
  const clampedVh = clampKeyboardHeightVh(heightVh);
  const safeViewportHeightPx =
    Number.isFinite(viewportHeightPx) && viewportHeightPx > 0 ? viewportHeightPx : 0;
  const rawFontSizePx = (clampedVh / 100) * safeViewportHeightPx * KEY_FONT_HEIGHT_RATIO;
  return Math.max(MIN_KEY_FONT_SIZE_PX, Math.min(MAX_KEY_FONT_SIZE_PX, rawFontSizePx));
}
