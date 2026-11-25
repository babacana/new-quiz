export interface HardRefreshEnvironment {
  serviceWorker?: Pick<ServiceWorkerContainer, 'getRegistrations'>;
  caches?: Pick<CacheStorage, 'keys' | 'delete'>;
  fetchFresh: (url: string) => Promise<unknown>;
  navigate: (url: string) => void;
  currentUrl: () => string;
  nowMs: () => number;
}

function browserEnvironment(): HardRefreshEnvironment {
  return {
    serviceWorker: typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined,
    caches: typeof caches !== 'undefined' ? caches : undefined,
    fetchFresh: (url) => fetch(url, { cache: 'reload' }),
    navigate: (url) => window.location.replace(url),
    currentUrl: () => window.location.href,
    nowMs: () => Date.now(),
  };
}

/**
 * Equivale a Ctrl+Shift+R no Totem: remove Service Workers e caches do app shell (não toca no
 * IndexedDB com fila de Partidas e configuração), revalida o index.html no servidor e recarrega.
 * Cada etapa é tolerante a falhas para o reload acontecer mesmo offline parcial.
 */
export async function performHardRefresh(
  env: HardRefreshEnvironment = browserEnvironment(),
): Promise<void> {
  try {
    const registrations = (await env.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch {
    // Segue para a limpeza de caches.
  }

  try {
    const keys = (await env.caches?.keys()) ?? [];
    await Promise.all(keys.map((key) => env.caches?.delete(key)));
  } catch {
    // Segue para o reload.
  }

  try {
    await env.fetchFresh('/index.html');
  } catch {
    // Offline: o reload usará o que o navegador tiver.
  }

  const url = new URL(env.currentUrl());
  url.searchParams.set('_refresh', String(env.nowMs()));
  env.navigate(url.toString());
}
