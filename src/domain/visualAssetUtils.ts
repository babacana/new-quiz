import type { EventVisualIdentity, ResolvedVisualAssets, VisualAssetKind } from './types';

// Converte bytes binários em Data URL base64 de forma portátil entre navegador e Node/Vitest.
export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  const base64 = btoa(binary);
  return `data:${mimeType || 'application/octet-stream'};base64,${base64}`;
}

// Normaliza nome de arquivo para armazenamento seguro em nuvem.
export function sanitizeAssetFileName(fileName: string): string {
  const trimmed = fileName.trim();
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'asset.png';
}

// Extrai o tipo (logo ou background) e o nome legível a partir do nome do objeto salvo no Storage.
export function parseVisualAssetObjectName(
  objectName: string,
): { kind: VisualAssetKind; fileName: string } | null {
  const trimmed = objectName.trim();
  if (!trimmed || trimmed.startsWith('.')) {
    return null;
  }
  const match = /^(logo|background)-(?:(\d+)-)?(.+)$/.exec(trimmed);
  if (!match) {
    return null;
  }
  return {
    kind: match[1] as VisualAssetKind,
    fileName: match[3],
  };
}

// Resolve URLs finais de logotipo e fundo com fallback seguro para /assets/logo.png.
export function resolveVisualAssetPaths(
  visual: EventVisualIdentity,
  cached: { logoDataUrl?: string | null; backgroundDataUrl?: string | null } = {},
  options: { allowRemoteFallback?: boolean } = {},
): ResolvedVisualAssets {
  const defaultLocalLogo = `/assets/${visual.logoFileName || 'logo.png'}`;
  const fallbackLogo = visual.logoUrl
    ? options.allowRemoteFallback
      ? visual.logoUrl
      : '/assets/logo.png'
    : defaultLocalLogo;
  const logoSrc = cached.logoDataUrl ?? fallbackLogo;

  let backgroundSrc: string | null = null;
  if (visual.enableCustomBackground) {
    if (cached.backgroundDataUrl) {
      backgroundSrc = cached.backgroundDataUrl;
    } else if (visual.customBackgroundUrl && options.allowRemoteFallback) {
      backgroundSrc = visual.customBackgroundUrl;
    } else if (!visual.customBackgroundUrl && visual.customBackgroundFileName) {
      backgroundSrc = `/assets/${visual.customBackgroundFileName}`;
    }
  }

  return { logoSrc, backgroundSrc };
}
