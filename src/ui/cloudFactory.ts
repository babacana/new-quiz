import { InMemoryCloudGateway } from '../adapters/inMemoryCloudGateway';
import { SupabaseCloudGateway } from '../adapters/supabaseCloudGateway';
import type { CloudGateway } from '../domain/ports';

// Cria o gateway padrão da nuvem (Supabase em produção ou memória em desenvolvimento/offline).
export function createDefaultCloudGateway(): CloudGateway {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  if (supabaseUrl && supabaseKey) {
    return new SupabaseCloudGateway(supabaseUrl, supabaseKey);
  }

  return new InMemoryCloudGateway({
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
  });
}
