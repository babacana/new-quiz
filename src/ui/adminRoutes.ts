export type AdminTabId =
  | 'overview'
  | 'settings'
  | 'customization'
  | 'reports'
  | 'analytics'
  | 'question-stats'
  | 'events'
  | 'questions'
  | 'totems'
  | 'backup'
  | 'staff';

export type AdminNavGroup = 'event' | 'global';

export interface AdminRouteMeta {
  id: AdminTabId;
  slug: string;
  label: string;
  group: AdminNavGroup;
}

export const ADMIN_ROUTES: readonly AdminRouteMeta[] = [
  {
    id: 'overview',
    slug: 'visao-geral',
    label: 'Visão Geral',
    group: 'event',
  },
  {
    id: 'settings',
    slug: 'configuracoes',
    label: 'Regras & Configurações',
    group: 'event',
  },
  {
    id: 'customization',
    slug: 'aparencia',
    label: 'Personalização Visual',
    group: 'event',
  },
  {
    id: 'reports',
    slug: 'relatorios',
    label: 'Relatórios e Participantes',
    group: 'event',
  },
  {
    id: 'analytics',
    slug: 'analises',
    label: 'Dashboard Analítico',
    group: 'event',
  },
  {
    id: 'question-stats',
    slug: 'estatisticas-questoes',
    label: 'Estatísticas de Questões',
    group: 'event',
  },
  {
    id: 'events',
    slug: 'eventos',
    label: 'Eventos',
    group: 'global',
  },
  {
    id: 'questions',
    slug: 'questoes',
    label: 'Banco de Questões',
    group: 'global',
  },
  {
    id: 'totems',
    slug: 'totens',
    label: 'Totens e Pareamento',
    group: 'global',
  },
  {
    id: 'backup',
    slug: 'backup',
    label: 'Backup e Migração',
    group: 'global',
  },
  {
    id: 'staff',
    slug: 'equipe',
    label: 'Equipe do Estande',
    group: 'global',
  },
] as const;

export const DEFAULT_ADMIN_TAB: AdminTabId = 'overview';

export function getHashForAdminTab(tab: AdminTabId): string {
  const found = ADMIN_ROUTES.find((route) => route.id === tab);
  return `#admin/${found ? found.slug : 'visao-geral'}`;
}

export function resolveAdminTabFromHash(hash: string): AdminTabId {
  const normalized = hash.trim().toLowerCase();
  if (!normalized.startsWith('#admin/')) {
    return DEFAULT_ADMIN_TAB;
  }
  const slug = normalized.slice('#admin/'.length).split(/[?#]/)[0]?.replace(/\/+$/, '') ?? '';
  const match = ADMIN_ROUTES.find((route) => route.slug === slug);
  return match ? match.id : DEFAULT_ADMIN_TAB;
}

export function resolveInitialAdminTab(): AdminTabId {
  if (typeof window === 'undefined') {
    return DEFAULT_ADMIN_TAB;
  }
  return window.location.hash.toLowerCase().startsWith('#admin/')
    ? resolveAdminTabFromHash(window.location.hash)
    : DEFAULT_ADMIN_TAB;
}
