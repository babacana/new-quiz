// Sintetizador leve de efeitos sonoros via Web Audio API para operação 100% offline no Totem.

export type TotemSoundType = 'click' | 'correct' | 'incorrect' | 'tick' | 'victory';

let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    return null;
  }
  if (!sharedAudioContext) {
    sharedAudioContext = new AudioCtx();
  }
  if (sharedAudioContext.state === 'suspended') {
    void sharedAudioContext.resume().catch(() => {});
  }
  return sharedAudioContext;
}

function scheduleTone(
  ctx: AudioContext,
  frequency: number,
  startOffsetSec: number,
  durationSec: number,
  type: OscillatorType,
  gainPeak: number,
): void {
  const start = ctx.currentTime + startOffsetSec;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainPeak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + durationSec + 0.02);
}

/** Reproduz um efeito sonoro curto no Totem sem depender de arquivos externos. */
export function playTotemSound(sound: TotemSoundType, enabled = true): void {
  if (!enabled) {
    return;
  }
  try {
    const ctx = getAudioContext();
    if (!ctx) {
      return;
    }

    if (sound === 'click') {
      scheduleTone(ctx, 640, 0, 0.045, 'sine', 0.06);
      return;
    }

    if (sound === 'tick') {
      scheduleTone(ctx, 880, 0, 0.05, 'triangle', 0.05);
      return;
    }

    if (sound === 'correct') {
      scheduleTone(ctx, 523.25, 0, 0.12, 'sine', 0.12);
      scheduleTone(ctx, 659.25, 0.09, 0.18, 'sine', 0.14);
      return;
    }

    if (sound === 'incorrect') {
      scheduleTone(ctx, 300, 0, 0.14, 'sawtooth', 0.07);
      scheduleTone(ctx, 220, 0.12, 0.22, 'sawtooth', 0.07);
      return;
    }

    // Fanfarra curta de vitória / Top 3
    scheduleTone(ctx, 523.25, 0, 0.12, 'triangle', 0.12);
    scheduleTone(ctx, 659.25, 0.11, 0.12, 'triangle', 0.12);
    scheduleTone(ctx, 783.99, 0.22, 0.14, 'triangle', 0.13);
    scheduleTone(ctx, 1046.5, 0.34, 0.3, 'triangle', 0.15);
  } catch {
    // Ignora falhas de áudio caso o navegador bloqueie autoplay antes da interação.
  }
}
