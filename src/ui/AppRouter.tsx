import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DexieLocalStore } from '../adapters/dexieLocalStore';
import { CryptoRandomSource, SystemClock } from '../adapters/systemAdapters';
import type { CloudGateway } from '../domain/ports';
import { TotemSessionEngine } from '../domain/totemSessionEngine';
import { TotemApp } from './TotemApp';
import {
  getHashForAdminTab,
  resolveAdminTabFromHash,
  type AdminTabId,
} from './adminRoutes';
import { createTotemCloudPort } from './cloudFactory';
import { LayoutPreviewApp } from './LayoutPreviewApp';
import { LAYOUT_PREVIEW_HASH } from './layoutPreviewProtocol';
import { UnsavedNavigationGuard } from './navigationGuard';

// O painel administrativo é carregado sob demanda para manter o bundle público do Totem enxuto.
const AdminApp = lazy(() => import('./AdminApp').then((mod) => ({ default: mod.AdminApp })));

export type AppRouteMode = 'totem' | 'admin' | 'operator' | 'layout-preview';

export interface ExternalRouteNavigationRequest {
  targetRoute: AppRouteMode;
  targetHash: string;
  targetAdminTab?: AdminTabId;
  nonce: number;
}

function resolveRouteFromLocation(): AppRouteMode {
  if (typeof window === 'undefined') {
    return 'totem';
  }
  const hash = window.location.hash.toLowerCase();
  const path = window.location.pathname.toLowerCase();
  if (hash === LAYOUT_PREVIEW_HASH) {
    return 'layout-preview';
  }
  if (hash === '#admin' || hash.startsWith('#admin/') || path === '/admin') {
    return 'admin';
  }
  if (
    hash === '#operador' ||
    hash.startsWith('#operador/') ||
    hash === '#operator' ||
    hash.startsWith('#operator/') ||
    path === '/operador' ||
    path === '/operator'
  ) {
    return 'operator';
  }
  return 'totem';
}

function getHashForRoute(mode: AppRouteMode, adminTab?: AdminTabId): string {
  if (mode === 'admin') {
    return getHashForAdminTab(adminTab ?? 'events');
  }
  if (mode === 'operator') {
    return '#operador';
  }
  return '';
}

export interface AppRouterProps {
  cloudGateway?: CloudGateway;
}

// Roteador raiz que separa Totem público, Painel do Administrador (#admin/*) e Painel do Operador (#operador).
export function AppRouter({ cloudGateway: injectedCloudGateway }: AppRouterProps = {}) {
  const [routeMode, setRouteMode] = useState<AppRouteMode>(() => resolveRouteFromLocation());
  const [adminTab, setAdminTab] = useState<AdminTabId>(() =>
    typeof window === 'undefined' ? 'events' : resolveAdminTabFromHash(window.location.hash),
  );
  const routeModeRef = useRef<AppRouteMode>(routeMode);
  const adminTabRef = useRef<AdminTabId>(adminTab);
  const [externalNavRequest, setExternalNavRequest] =
    useState<ExternalRouteNavigationRequest | null>(null);
  const ignoringHashChangeRef = useRef(false);

  const navigationGuard = useMemo(() => new UnsavedNavigationGuard(), []);

  // Motor do Totem só é instanciado quando a rota ativa é pública ('totem').
  const totemEngine = useMemo(() => {
    if (routeMode !== 'totem') {
      return null;
    }
    const cloudGateway = injectedCloudGateway ?? createTotemCloudPort();
    return new TotemSessionEngine({
      localStore: new DexieLocalStore(),
      cloudGateway,
      clock: new SystemClock(),
      random: new CryptoRandomSource(),
      requirePairing: true,
    });
  }, [injectedCloudGateway, routeMode]);

  useEffect(() => {
    return () => {
      totemEngine?.dispose();
    };
  }, [totemEngine]);

  useEffect(() => {
    routeModeRef.current = routeMode;
  }, [routeMode]);

  useEffect(() => {
    adminTabRef.current = adminTab;
  }, [adminTab]);

  useEffect(() => {
    const handleHashChange = () => {
      if (ignoringHashChangeRef.current) {
        ignoringHashChangeRef.current = false;
        return;
      }

      const nextRoute = resolveRouteFromLocation();
      const nextAdminTab = resolveAdminTabFromHash(window.location.hash);
      const currentRoute = routeModeRef.current;
      const currentAdminTab = adminTabRef.current;

      const isSameRouteAndTab =
        nextRoute === currentRoute &&
        (nextRoute !== 'admin' || nextAdminTab === currentAdminTab);

      if (isSameRouteAndTab) {
        return;
      }

      if (
        (currentRoute === 'admin' || currentRoute === 'operator') &&
        !navigationGuard.checkUnsavedNavigation().canProceedImmediately
      ) {
        // Mantém a rota atual no navegador até o usuário resolver o alerta de alterações não salvas.
        const targetHash = window.location.hash;
        ignoringHashChangeRef.current = true;
        window.location.hash = getHashForRoute(currentRoute, currentAdminTab);
        setExternalNavRequest({
          targetRoute: nextRoute,
          targetHash,
          targetAdminTab: nextRoute === 'admin' ? nextAdminTab : undefined,
          nonce: Date.now(),
        });
        return;
      }

      if (nextRoute === 'admin') {
        setAdminTab(nextAdminTab);
      }
      setRouteMode(nextRoute);
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [navigationGuard]);

  const navigateToRoute = useCallback(
    (nextRoute: AppRouteMode, explicitHash?: string, explicitAdminTab?: AdminTabId) => {
      const nextTab = explicitAdminTab ?? (nextRoute === 'admin' ? adminTabRef.current : undefined);
      const desiredHash = explicitHash ?? getHashForRoute(nextRoute, nextTab);
      if (window.location.hash !== desiredHash) {
        ignoringHashChangeRef.current = true;
        window.location.hash = desiredHash;
      }
      setExternalNavRequest(null);
      if (nextTab) {
        setAdminTab(nextTab);
      }
      setRouteMode(nextRoute);
    },
    [],
  );

  const handleAdminTabChange = useCallback((nextTab: AdminTabId) => {
    const desiredHash = getHashForAdminTab(nextTab);
    if (window.location.hash !== desiredHash) {
      ignoringHashChangeRef.current = true;
      window.location.hash = desiredHash;
    }
    setAdminTab(nextTab);
  }, []);

  if (routeMode === 'layout-preview') {
    return <LayoutPreviewApp />;
  }

  if (routeMode === 'admin' || routeMode === 'operator') {
    return (
      <Suspense
        fallback={
          <div
            style={{
              minHeight: '100dvh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            Carregando painel...
          </div>
        }
      >
        <AdminApp
          cloudGateway={injectedCloudGateway}
          navigationGuard={navigationGuard}
          routeMode={routeMode}
          activeTab={adminTab}
          onAdminTabChange={handleAdminTabChange}
          onOpenTotem={() => navigateToRoute('totem', '')}
          onSwitchPanelRoute={(nextPanel) => navigateToRoute(nextPanel)}
          externalRouteRequest={externalNavRequest}
          onResolveExternalRoute={(confirm, req) => {
            setExternalNavRequest(null);
            if (confirm) {
              navigateToRoute(req.targetRoute, req.targetHash, req.targetAdminTab);
            }
          }}
        />
      </Suspense>
    );
  }

  return <TotemApp engine={totemEngine ?? undefined} />;
}
