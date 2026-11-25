import { describe, expect, it, vi } from 'vitest';
import { performHardRefresh } from '../hardRefresh';

describe('performHardRefresh', () => {
  it('remove Service Workers e caches, revalida o index e navega com parâmetro novo', async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    const deleteCache = vi.fn().mockResolvedValue(true);
    const navigate = vi.fn();
    const fetchFresh = vi.fn().mockResolvedValue(undefined);

    await performHardRefresh({
      serviceWorker: { getRegistrations: async () => [{ unregister }] as never },
      caches: { keys: async () => ['new-quiz-shell-v1', 'outro'], delete: deleteCache },
      fetchFresh,
      navigate,
      currentUrl: () => 'https://quiz.example/?pairingCode=ABC123',
      nowMs: () => 1234,
    });

    expect(unregister).toHaveBeenCalledTimes(1);
    expect(deleteCache).toHaveBeenCalledTimes(2);
    expect(fetchFresh).toHaveBeenCalledWith('/index.html');
    expect(navigate).toHaveBeenCalledWith('https://quiz.example/?pairingCode=ABC123&_refresh=1234');
  });

  it('recarrega mesmo quando as etapas de limpeza falham', async () => {
    const navigate = vi.fn();
    await performHardRefresh({
      serviceWorker: { getRegistrations: async () => Promise.reject(new Error('x')) },
      caches: { keys: async () => Promise.reject(new Error('y')), delete: vi.fn() },
      fetchFresh: async () => Promise.reject(new Error('offline')),
      navigate,
      currentUrl: () => 'https://quiz.example/',
      nowMs: () => 9,
    });
    expect(navigate).toHaveBeenCalledWith('https://quiz.example/?_refresh=9');
  });
});
