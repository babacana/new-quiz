import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DexieLocalStore } from '../adapters/dexieLocalStore';
import { CryptoRandomSource, SystemClock } from '../adapters/systemAdapters';
import { EventAdminController } from '../domain/eventAdminController';
import type { CloudGateway } from '../domain/ports';
import { TotemSessionEngine } from '../domain/totemSessionEngine';
import { TotemApp } from './TotemApp';

const AdminApp = lazy(() => import('./AdminApp').then((mod) => ({ default: mod.AdminApp })));
import {
  getHashForAdminTab,
  resolveAdminTabFromHash,
  type AdminTabId,
} from './adminRoutes';
import { createDefaultCloudGateway } from './cloudFactory';

export type AppRouteMode = 'totem' | 'admin' | 'operator';

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

  const sharedServices = useMemo(() => {
    const cloudGateway = injectedCloudGateway ?? createDefaultCloudGateway();
    const clock = new SystemClock();
    const random = new CryptoRandomSource();
    const localStore = new DexieLocalStore();

    return {
      totemEngine: new TotemSessionEngine({
        localStore,
        cloudGateway,
        clock,
        random,
        requirePairing: true,
      }),
      adminController: new EventAdminController({ cloudGateway, clock, random }),
    };
  }, [injectedCloudGateway]);

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
        !sharedServices.adminController.checkUnsavedNavigation().canProceedImmediately
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
  }, [sharedServices]);

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
          controller={sharedServices.adminController}
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

  return <TotemApp engine={sharedServices.totemEngine} />;
}
