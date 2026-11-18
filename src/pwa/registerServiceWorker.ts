export type ServiceWorkerLike = Pick<ServiceWorker, 'postMessage' | 'state'> &
  Partial<Pick<ServiceWorker, 'addEventListener' | 'removeEventListener'>>;

export type ServiceWorkerRegistrationLike = Pick<ServiceWorkerRegistration, 'scope'> & {
  waiting?: ServiceWorkerLike | null;
  installing?: ServiceWorkerLike | null;
  addEventListener?: ServiceWorkerRegistration['addEventListener'];
};

export type ServiceWorkerContainerLike = {
  register: (
    scriptURL: string,
    options?: RegistrationOptions,
  ) => Promise<ServiceWorkerRegistrationLike>;
  controller?: ServiceWorkerLike | null;
  addEventListener?: ServiceWorkerContainer['addEventListener'];
  removeEventListener?: ServiceWorkerContainer['removeEventListener'];
};

export type ServiceWorkerNavigatorLike = {
  serviceWorker?: ServiceWorkerContainerLike;
};

type UpdateListener = (ready: boolean) => void;

const updateListeners = new Set<UpdateListener>();
let updateReady = false;
let waitingWorker: ServiceWorkerLike | null = null;
let reloadTriggered = false;
let observedContainer: ServiceWorkerContainerLike | null = null;
let controllerChangeHandler: (() => void) | null = null;
let customReloadAction: (() => void) | null = null;

function notifyUpdateListeners(ready: boolean): void {
  updateReady = ready;
  for (const listener of updateListeners) {
    listener(ready);
  }
}

function setWaitingWorker(worker: ServiceWorkerLike | null): void {
  waitingWorker = worker;
  notifyUpdateListeners(worker !== null);
}

function defaultReloadPage(): void {
  if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
    window.location.reload();
  }
}

function attachControllerChangeListener(container: ServiceWorkerContainerLike): void {
  if (observedContainer === container || typeof container.addEventListener !== 'function') {
    return;
  }

  if (observedContainer && controllerChangeHandler && observedContainer.removeEventListener) {
    observedContainer.removeEventListener('controllerchange', controllerChangeHandler);
  }

  observedContainer = container;
  controllerChangeHandler = () => {
    if (reloadTriggered) {
      return;
    }
    reloadTriggered = true;
    const reloadFn = customReloadAction ?? defaultReloadPage;
    reloadFn();
  };

  container.addEventListener('controllerchange', controllerChangeHandler);
}

function observeRegistrationUpdates(
  registration: ServiceWorkerRegistrationLike,
  container: ServiceWorkerContainerLike,
): void {
  if (registration.waiting && container.controller) {
    setWaitingWorker(registration.waiting);
  }

  if (typeof registration.addEventListener !== 'function') {
    return;
  }

  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (!installing || typeof installing.addEventListener !== 'function') {
      return;
    }

    const handleStateChange = () => {
      if (installing.state !== 'installed') {
        return;
      }
      if (registration.waiting) {
        setWaitingWorker(registration.waiting);
      } else if (container.controller) {
        setWaitingWorker(installing);
      }
    };

    installing.addEventListener('statechange', handleStateChange);
  });
}

/**
 * Inscreve ouvintes para saber quando há uma nova versão do Service Worker aguardando ativação.
 */
export function subscribeServiceWorkerUpdateReady(listener: UpdateListener): () => void {
  updateListeners.add(listener);
  listener(updateReady);
  return () => {
    updateListeners.delete(listener);
  };
}

/**
 * Solicita ao Service Worker em espera que assuma o controle imediatamente (apenas em ociosidade).
 */
export function applyPendingServiceWorkerUpdate(): boolean {
  if (!waitingWorker) {
    return false;
  }
  const worker = waitingWorker;
  setWaitingWorker(null);
  worker.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

/**
 * Registra o Service Worker do app shell (/sw.js) e monitora atualizações em segundo plano.
 * Falhas de registro são ignoradas para não impedir a inicialização do Totem.
 */
export async function registerServiceWorker(
  nav: ServiceWorkerNavigatorLike | undefined = typeof navigator !== 'undefined'
    ? (navigator as ServiceWorkerNavigatorLike)
    : undefined,
  onControllerChangeReload?: () => void,
): Promise<ServiceWorkerRegistrationLike | null> {
  if (!nav?.serviceWorker) {
    return null;
  }

  if (onControllerChangeReload) {
    customReloadAction = onControllerChangeReload;
  }

  try {
    attachControllerChangeListener(nav.serviceWorker);
    const registration = await nav.serviceWorker.register('/sw.js', { scope: '/' });
    observeRegistrationUpdates(registration, nav.serviceWorker);
    return registration;
  } catch {
    return null;
  }
}

/**
 * Reinicia o estado interno do módulo PWA exclusivamente para isolamento de testes automatizados.
 */
export function resetServiceWorkerStateForTests(): void {
  if (observedContainer && controllerChangeHandler && observedContainer.removeEventListener) {
    observedContainer.removeEventListener('controllerchange', controllerChangeHandler);
  }
  updateListeners.clear();
  updateReady = false;
  waitingWorker = null;
  reloadTriggered = false;
  observedContainer = null;
  controllerChangeHandler = null;
  customReloadAction = null;
}
