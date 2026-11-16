import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DexieLocalStore } from '../adapters/dexieLocalStore';
import { CryptoRandomSource, SystemClock } from '../adapters/systemAdapters';
import { EventAdminController } from '../domain/eventAdminController';
import { TotemSessionEngine } from '../domain/totemSessionEngine';
import { AdminApp } from './AdminApp';
import { TotemApp } from './TotemApp';
import { createDefaultCloudGateway } from './cloudFactory';

export type AppRouteMode = 'totem' | 'admin' | 'operator';

export interface ExternalRouteNavigationRequest {
  targetRoute: AppRouteMode;
  targetHash: string;
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

function getHashForRoute(mode: AppRouteMode): string {
  if (mode === 'admin') {
    return '#admin';
  }
  if (mode === 'operator') {
    return '#operador';
  }
  return '';
}

// Roteador raiz que separa Totem público, Painel do Administrador (#admin) e Painel do Operador (#operador).
export function AppRouter() {
  const [routeMode, setRouteMode] = useState<AppRouteMode>(() => resolveRouteFromLocation());
  const routeModeRef = useRef<AppRouteMode>(routeMode);
  const [externalNavRequest, setExternalNavRequest] =
    useState<ExternalRouteNavigationRequest | null>(null);
  const ignoringHashChangeRef = useRef(false);

  const sharedServices = useMemo(() => {
    const cloudGateway = createDefaultCloudGateway();
    const clock = new SystemClock();
    const random = new CryptoRandomSource();
    const localStore = new DexieLocalStore();

    return {
      totemEngine: new TotemSessionEngine({ localStore, cloudGateway, clock, random }),
      adminController: new EventAdminController({ cloudGateway, clock, random }),
    };
  }, []);

  useEffect(() => {
    routeModeRef.current = routeMode;
  }, [routeMode]);

  useEffect(() => {
    const handleHashChange = () => {
      if (ignoringHashChangeRef.current) {
        ignoringHashChangeRef.current = false;
        return;
      }

      const nextRoute = resolveRouteFromLocation();
      const currentRoute = routeModeRef.current;
      if (nextRoute === currentRoute) {
        return;
      }

      if (
        (currentRoute === 'admin' || currentRoute === 'operator') &&
        !sharedServices.adminController.checkUnsavedNavigation().canProceedImmediately
      ) {
        // Mantém a rota atual no navegador até o usuário resolver o alerta de alterações não salvas.
        const targetHash = window.location.hash;
        ignoringHashChangeRef.current = true;
        window.location.hash = getHashForRoute(currentRoute);
        setExternalNavRequest({
          targetRoute: nextRoute,
          targetHash,
          nonce: Date.now(),
        });
        return;
      }

      setRouteMode(nextRoute);
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [sharedServices]);

  const navigateToRoute = useCallback((nextRoute: AppRouteMode, explicitHash?: string) => {
    const desiredHash = explicitHash ?? getHashForRoute(nextRoute);
    if (window.location.hash !== desiredHash) {
      ignoringHashChangeRef.current = true;
      window.location.hash = desiredHash;
    }
    setExternalNavRequest(null);
    setRouteMode(nextRoute);
  }, []);

  if (routeMode === 'admin' || routeMode === 'operator') {
    return (
      <AdminApp
        controller={sharedServices.adminController}
        routeMode={routeMode}
        onOpenTotem={() => navigateToRoute('totem', '')}
        onSwitchPanelRoute={(nextPanel) => navigateToRoute(nextPanel)}
        externalRouteRequest={externalNavRequest}
        onResolveExternalRoute={(confirm, req) => {
          setExternalNavRequest(null);
          if (confirm) {
            navigateToRoute(req.targetRoute, req.targetHash);
          }
        }}
      />
    );
  }

  return <TotemApp engine={sharedServices.totemEngine} />;
}
