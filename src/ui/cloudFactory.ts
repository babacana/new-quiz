import { SupabaseTotemGateway } from '../adapters/supabaseTotemGateway';
import type { CloudGateway, TotemCloudPort } from '../domain/ports';
import type { TotemChannelEvent } from '../domain/types';

let inMemoryFallbackPromise: Promise<CloudGateway> | null = null;

export function resolveSupabaseCredentials(): { supabaseUrl: string; supabaseKey: string } | null {
  if (import.meta.env.MODE === 'test') {
    return null;
  }
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !supabaseKey) {
    return null;
  }
  return { supabaseUrl, supabaseKey };
}

export const MISSING_SUPABASE_CONFIG_MESSAGE =
  'Configuração do Supabase ausente: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no build de produção.';

export function loadSharedInMemoryGateway(): Promise<CloudGateway> {
  // Em produção o gateway em memória (com contas de demonstração) nunca é usado nem incluído no bundle.
  if (import.meta.env.PROD) {
    return Promise.reject(new Error(MISSING_SUPABASE_CONFIG_MESSAGE));
  }
  if (!inMemoryFallbackPromise) {
    inMemoryFallbackPromise = import('../adapters/inMemoryCloudGateway').then(
      ({ InMemoryCloudGateway }) =>
        new InMemoryCloudGateway({
          online: typeof navigator === 'undefined' ? true : navigator.onLine,
        }),
    );
  }
  return inMemoryFallbackPromise;
}

// Proxy enxuto para adiar o carregamento de InMemoryCloudGateway somente em dev sem Supabase ou testes.
function createLazyInMemoryTotemProxy(): TotemCloudPort {
  const call = async <K extends keyof TotemCloudPort>(
    method: K,
    ...args: Parameters<Extract<TotemCloudPort[K], (...a: never[]) => unknown>>
  ) => {
    const gw = await loadSharedInMemoryGateway();
    const fn = gw[method] as (...a: unknown[]) => unknown;
    return fn.apply(gw, args);
  };

  return {
    isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
    pullEventSnapshot: (...args) =>
      call('pullEventSnapshot', ...args) as ReturnType<TotemCloudPort['pullEventSnapshot']>,
    pushMatch: (...args) =>
      call('pushMatch', ...args) as ReturnType<TotemCloudPort['pushMatch']>,
    pushGiveUpLockout: (...args) =>
      call('pushGiveUpLockout', ...args) as ReturnType<TotemCloudPort['pushGiveUpLockout']>,
    requestTotemPairing: (...args) =>
      call('requestTotemPairing', ...args) as ReturnType<TotemCloudPort['requestTotemPairing']>,
    claimTotemPairing: (...args) =>
      call('claimTotemPairing', ...args) as ReturnType<TotemCloudPort['claimTotemPairing']>,
    publishTotemHeartbeat: (...args) =>
      call('publishTotemHeartbeat', ...args) as ReturnType<TotemCloudPort['publishTotemHeartbeat']>,
    downloadVisualAsset: (...args) =>
      call('downloadVisualAsset', ...args) as ReturnType<TotemCloudPort['downloadVisualAsset']>,
    subscribeTotemChannel: (listener: (event: TotemChannelEvent) => void | Promise<void>) => {
      let active = true;
      let innerUnsubscribe: (() => void) | null = null;
      void loadSharedInMemoryGateway().then((gw) => {
        if (active) {
          innerUnsubscribe = gw.subscribeTotemChannel(listener);
        }
      });
      return () => {
        active = false;
        innerUnsubscribe?.();
      };
    },
  };
}

// Cria a costura pública do Totem sem incluir código administrativo nem gateway em memória estático.
export function createTotemCloudPort(): TotemCloudPort {
  const credentials = resolveSupabaseCredentials();
  if (credentials) {
    return new SupabaseTotemGateway(credentials.supabaseUrl, credentials.supabaseKey);
  }
  if (import.meta.env.PROD) {
    throw new Error(MISSING_SUPABASE_CONFIG_MESSAGE);
  }
  return createLazyInMemoryTotemProxy();
}
