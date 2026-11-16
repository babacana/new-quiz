import { describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from '../registerServiceWorker';

describe('registerServiceWorker', () => {
  it('registra /sw.js no escopo raiz quando serviceWorker esta disponivel', async () => {
    const fakeRegistration = { scope: '/' } as ServiceWorkerRegistration;
    const register = vi.fn().mockResolvedValue(fakeRegistration);

    const result = await registerServiceWorker({
      serviceWorker: { register } as unknown as ServiceWorkerContainer,
    });

    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(result).toBe(fakeRegistration);
  });

  it('retorna null sem lancar erro quando serviceWorker nao e suportado ou falha ao registrar', async () => {
    await expect(registerServiceWorker({})).resolves.toBeNull();

    const register = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(
      registerServiceWorker({
        serviceWorker: { register } as unknown as ServiceWorkerContainer,
      }),
    ).resolves.toBeNull();
  });
});
