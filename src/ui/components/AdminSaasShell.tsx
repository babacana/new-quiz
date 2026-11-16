import { useState, type ReactNode } from 'react';
import {
  Archive,
  BarChart3,
  CalendarCog,
  Cpu,
  FileBarChart2,
  HelpCircle,
  LayoutDashboard,
  LineChart,
  LogOut,
  Menu,
  Monitor,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  SlidersHorizontal,
  Smartphone,
  Users,
} from 'lucide-react';
import type { AuthSession, EventConfig } from '../../domain/types';
import { ADMIN_ROUTES, type AdminRouteMeta, type AdminTabId } from '../adminRoutes';
import type { SaasTheme } from '../hooks/useSaasTheme';
import { cn } from '../lib/utils';
import { ThemeToggleButton } from './ThemeToggleButton';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

const TAB_ICONS: Record<AdminTabId, typeof CalendarCog> = {
  overview: LayoutDashboard,
  settings: SlidersHorizontal,
  customization: Palette,
  reports: FileBarChart2,
  analytics: LineChart,
  'question-stats': BarChart3,
  events: CalendarCog,
  questions: HelpCircle,
  totems: Monitor,
  backup: Archive,
  staff: Users,
};

export interface AdminSaasShellProps {
  session: AuthSession;
  isAdmin: boolean;
  showOperatorView: boolean;
  routeMode: 'admin' | 'operator';
  activeTab: AdminTabId;
  events: EventConfig[];
  selectedEventId: string | null;
  theme: SaasTheme;
  onToggleTheme: () => void;
  onSelectTab: (tab: AdminTabId) => void;
  onSelectEvent: (eventId: string) => void;
  onSwitchPanelRoute?: (route: 'admin' | 'operator') => void;
  onOpenDevSimulator?: () => void;
  onOpenTotem?: () => void;
  onLogout: () => void;
  children: ReactNode;
}

export function AdminSaasShell({
  session,
  isAdmin,
  showOperatorView,
  routeMode,
  activeTab,
  events,
  selectedEventId,
  theme,
  onToggleTheme,
  onSelectTab,
  onSelectEvent,
  onSwitchPanelRoute,
  onOpenDevSimulator,
  onOpenTotem,
  onLogout,
  children,
}: AdminSaasShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const eventRoutes = ADMIN_ROUTES.filter((r) => r.group === 'event');
  const globalRoutes = ADMIN_ROUTES.filter((r) => r.group === 'global');

  const renderRouteGroup = (
    title: string,
    routes: readonly AdminRouteMeta[],
    collapsed: boolean,
    onNavigate?: () => void,
  ) => (
    <div>
      {!collapsed && (
        <p className="mb-1.5 px-2.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          {title}
        </p>
      )}
      <div className="flex flex-col gap-1">
        {routes.map((route) => {
          const Icon = TAB_ICONS[route.id];
          const isActive = activeTab === route.id;
          return (
            <button
              key={route.id}
              type="button"
              aria-label={route.label}
              aria-current={isActive ? 'page' : undefined}
              title={collapsed ? route.label : undefined}
              onClick={() => {
                onSelectTab(route.id);
                onNavigate?.();
              }}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-medium transition-colors cursor-pointer',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                collapsed && 'justify-center px-2',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate">{route.label}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderNavGroups = (collapsed: boolean, onNavigate?: () => void) => (
    <div className="flex flex-col gap-5">
      {renderRouteGroup('Contexto do Evento', eventRoutes, collapsed, onNavigate)}
      {renderRouteGroup('Nível Global', globalRoutes, collapsed, onNavigate)}
    </div>
  );

  return (
    <div id="admin-dashboard" className="saas-shell flex min-h-dvh w-full bg-background text-foreground">
      {!showOperatorView && (
        <aside
          aria-label="Menu lateral administrativo"
          className={cn(
            'hidden shrink-0 flex-col border-r border-border bg-card transition-all duration-200 md:flex',
            sidebarCollapsed ? 'w-16' : 'w-64',
          )}
        >
          <div className="flex h-14 items-center justify-between border-b border-border px-3">
            {!sidebarCollapsed && (
              <span className="truncate text-sm font-semibold tracking-tight">Quiz Backoffice</span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={sidebarCollapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
              onClick={() => setSidebarCollapsed((prev) => !prev)}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </Button>
          </div>
          <nav aria-label="Navegação administrativa" className="flex-1 overflow-y-auto p-3">
            {renderNavGroups(sidebarCollapsed)}
          </nav>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/95 px-4 py-3 backdrop-blur-xs md:px-6">
          <div className="flex items-center gap-3">
            {!showOperatorView && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="md:hidden"
                aria-label="Abrir menu"
                onClick={() => setMobileDrawerOpen(true)}
              >
                <Menu className="h-4 w-4" />
              </Button>
            )}
            <div>
              <h2 className="text-base font-semibold leading-tight md:text-lg">
                {showOperatorView ? 'Operação do Estande' : 'Painel Administrativo do Quiz'}
              </h2>
              <p className="text-xs text-muted-foreground">
                Conectado como <strong>{session.user.name}</strong> (
                {isAdmin ? 'Administrador' : 'Operador'})
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!showOperatorView && events.length > 0 && (
              <div className="flex items-center gap-2">
                <label htmlFor="header-event-selector" className="sr-only">
                  Evento selecionado
                </label>
                <select
                  id="header-event-selector"
                  aria-label="Evento selecionado"
                  value={selectedEventId ?? ''}
                  onChange={(e) => onSelectEvent(e.target.value)}
                  className="h-9 max-w-[220px] rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name}
                      {ev.isActive ? ' (Ativo)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <ThemeToggleButton theme={theme} onToggleTheme={onToggleTheme} />

            {isAdmin && onSwitchPanelRoute && routeMode === 'operator' && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onSwitchPanelRoute('admin')}
              >
                <Settings2 className="h-4 w-4" />
                Painel do Administrador
              </Button>
            )}
            {isAdmin && onSwitchPanelRoute && routeMode === 'admin' && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onSwitchPanelRoute('operator')}
              >
                <Smartphone className="h-4 w-4" />
                Visão de Operador
              </Button>
            )}
            {isAdmin && onOpenDevSimulator && (
              <Button
                id="admin-dev-simulator-btn"
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenDevSimulator}
              >
                <Cpu className="h-4 w-4" />
                Modo Desenvolvedor / Simulador
              </Button>
            )}
            {onOpenTotem && (
              <Button
                id="admin-open-totem-btn"
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenTotem}
              >
                <Monitor className="h-4 w-4" />
                Ir para Totem
              </Button>
            )}
            <Button
              id="admin-logout-btn"
              type="button"
              variant="destructive"
              size="sm"
              onClick={onLogout}
            >
              <LogOut className="h-4 w-4" />
              Sair
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>

      {!showOperatorView && (
        <Dialog open={mobileDrawerOpen} onOpenChange={setMobileDrawerOpen}>
          <DialogContent className="top-0 left-0 h-dvh w-72 max-w-[85vw] translate-x-0 translate-y-0 rounded-none border-r p-4">
            <DialogHeader className="text-left">
              <DialogTitle>Quiz Backoffice</DialogTitle>
              <DialogDescription>Navegação do painel administrativo</DialogDescription>
            </DialogHeader>
            <nav aria-label="Navegação administrativa mobile" className="mt-4 overflow-y-auto">
              {renderNavGroups(false, () => setMobileDrawerOpen(false))}
            </nav>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
