import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyPendingServiceWorkerUpdate,
  registerServiceWorker,
  resetServiceWorkerStateForTests,
  subscribeServiceWorkerUpdateReady,
  type ServiceWorkerContainerLike,
  type ServiceWorkerLike,
  type ServiceWorkerRegistrationLike,
} from '../registerServiceWorker';

describe('registerServiceWorker', () => {
  afterEach(() => {
    resetServiceWorkerStateForTests();
  });

  it('notifica atualização pronta quando Service Worker em espera é detectado e envia SKIP_WAITING sob demanda', async () => {
    const postMessage = vi.fn();
    const reloadSpy = vi.fn();

    let regListeners: Record<string, Array<() => void>> = {};
    let containerListeners: Record<string, Array<() => void>> = {};
    let installingListeners: Array<() => void> = [];

    const waitingWorker: ServiceWorkerLike = {
      state: 'installed',
      postMessage,
    };

    let installingState: ServiceWorkerState = 'installing';
    const installingWorker: ServiceWorkerLike = {
      get state() {
        return installingState;
      },
      postMessage: vi.fn(),
      addEventListener: ((_type: string, listener: EventListenerOrEventListenerObject) => {
        installingListeners.push(listener as () => void);
      }) as ServiceWorker['addEventListener'],
    };

    const registration: ServiceWorkerRegistrationLike = {
      scope: '/',
      waiting: null,
      installing: null,
      addEventListener: ((type: string, listener: EventListenerOrEventListenerObject) => {
        regListeners[type] = regListeners[type] ?? [];
        regListeners[type].push(listener as () => void);
      }) as ServiceWorkerRegistration['addEventListener'],
    };

    const container: ServiceWorkerContainerLike = {
      controller: { state: 'activated', postMessage: vi.fn() },
      register: vi.fn().mockResolvedValue(registration),
      addEventListener: ((type: string, listener: EventListenerOrEventListenerObject) => {
        containerListeners[type] = containerListeners[type] ?? [];
        containerListeners[type].push(listener as () => void);
      }) as ServiceWorkerContainer['addEventListener'],
      removeEventListener: vi.fn(),
    };

    const readyListener = vi.fn();
    const unsubscribe = subscribeServiceWorkerUpdateReady(readyListener);
    expect(readyListener).toHaveBeenLastCalledWith(false);

    await registerServiceWorker({ serviceWorker: container }, reloadSpy);
    expect(container.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });

    // Simula download de novo Service Worker em segundo plano até estado installed.
    registration.installing = installingWorker;
    registration.waiting = waitingWorker;
    for (const cb of regListeners['updatefound'] ?? []) {
      cb();
    }
    installingState = 'installed';
    for (const cb of installingListeners) {
      cb();
    }

    expect(readyListener).toHaveBeenLastCalledWith(true);

    // Aplica atualização somente quando acionado (ex: Totem ocioso e sem pendências).
    expect(applyPendingServiceWorkerUpdate()).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(readyListener).toHaveBeenLastCalledWith(false);
    // Segunda chamada não reenvia comando sem novo worker em espera.
    expect(applyPendingServiceWorkerUpdate()).toBe(false);

    // Dispara controllerchange duas vezes: reload deve ocorrer apenas uma vez.
    for (const cb of containerListeners['controllerchange'] ?? []) {
      cb();
      cb();
    }
    expect(reloadSpy).toHaveBeenCalledTimes(1);

    unsubscribe();
    regListeners = {};
    containerListeners = {};
    installingListeners = [];
  });

  it('reconhece Service Worker já em waiting imediatamente após o registro', async () => {
    const postMessage = vi.fn();
    const registration: ServiceWorkerRegistrationLike = {
      scope: '/',
      waiting: { state: 'installed', postMessage },
    };

    const container: ServiceWorkerContainerLike = {
      controller: { state: 'activated', postMessage: vi.fn() },
      register: vi.fn().mockResolvedValue(registration),
    };

    const states: boolean[] = [];
    const unsubscribe = subscribeServiceWorkerUpdateReady((ready) => states.push(ready));
    await registerServiceWorker({ serviceWorker: container });

    expect(states[states.length - 1]).toBe(true);
    expect(applyPendingServiceWorkerUpdate()).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    unsubscribe();
  });
});
