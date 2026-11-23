import { useState } from 'react';
import { PREVIEW_RESOLUTIONS, clampPreviewDimension } from '../domain/screenLayout';

const RESOLUTION_STORAGE_KEY = 'new-quiz.layout-editor.resolution';
export interface ResolutionChoice {
  presetId: string;
  width: number;
  height: number;
}

function loadResolutionChoice(): ResolutionChoice {
  const fallback = PREVIEW_RESOLUTIONS[0]!;
  const defaults = {
    presetId: fallback.id,
    width: fallback.width,
    height: fallback.height,
  };
  try {
    const raw = window.localStorage.getItem(RESOLUTION_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as Partial<ResolutionChoice>;
    if (
      typeof parsed.width === 'number' &&
      typeof parsed.height === 'number' &&
      typeof parsed.presetId === 'string'
    ) {
      return {
        presetId: parsed.presetId,
        width: clampPreviewDimension(parsed.width),
        height: clampPreviewDimension(parsed.height),
      };
    }
  } catch {
    // Armazenamento indisponível: usa a resolução padrão do Totem.
  }
  return defaults;
}

// Resolução simulada da prévia, lembrada neste navegador e compartilhada entre as abas Layout e Aparência.
export function usePreviewResolution(): [ResolutionChoice, (next: ResolutionChoice) => void] {
  const [resolution, setResolution] = useState<ResolutionChoice>(loadResolutionChoice);
  const persist = (next: ResolutionChoice) => {
    setResolution(next);
    try {
      window.localStorage.setItem(RESOLUTION_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Preferência apenas de conveniência.
    }
  };
  return [resolution, persist];
}
