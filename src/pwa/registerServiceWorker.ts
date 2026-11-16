export type ServiceWorkerNavigatorLike = {
  serviceWorker?: Pick<ServiceWorkerContainer, 'register'>;
};

/**
 * Registra o Service Worker do app shell (/sw.js) para suporte PWA offline.
 * Falhas de registro sao ignoradas para nao impedir a inicializacao do Totem.
 */
export async function registerServiceWorker(
  nav: ServiceWorkerNavigatorLike | undefined = typeof navigator !== 'undefined' ? navigator : undefined,
): Promise<ServiceWorkerRegistration | null> {
  if (!nav?.serviceWorker) {
    return null;
  }

  try {
    return await nav.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}
