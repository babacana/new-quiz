import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CryptoRandomSource, SystemClock } from '../adapters/systemAdapters';
import { EventAdminController } from '../domain/eventAdminController';
import type {
  AuthSession,
  EventConfig,
  Question,
  UnsavedChangesResolution,
  UnsavedNavigationPrompt,
} from '../domain/types';
import { AdminAnalyticsTab } from './AdminAnalyticsTab';
import { AdminBackupTab } from './AdminBackupTab';
import { AdminCustomizationTab } from './AdminCustomizationTab';
import { AdminEventsTab } from './AdminEventsTab';
import { AdminOverviewTab } from './AdminOverviewTab';
import { AdminSettingsTab } from './AdminSettingsTab';
import { AdminQuestionsTab } from './AdminQuestionsTab';
import { AdminReportsTab } from './AdminReportsTab';
import { AdminStaffTab } from './AdminStaffTab';
import { AdminTotemsTab } from './AdminTotemsTab';
import type { ExternalRouteNavigationRequest } from './AppRouter';
import { DevSimulatorModal } from './DevSimulatorModal';
import { OperatorPanel } from './OperatorPanel';
import {
  getHashForAdminTab,
  resolveInitialAdminTab,
  type AdminTabId,
} from './adminRoutes';
import { createDefaultCloudGateway } from './cloudFactory';
import { AdminLoginScreen } from './components/AdminLoginScreen';
import { AdminSaasShell } from './components/AdminSaasShell';
import { Button } from './components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog';
import { ToastViewport, type ToastMessage } from './components/ui/toast';
import { useSaasTheme } from './hooks/useSaasTheme';
import './saas.css';
import './styles.css';

type PendingNavigationAction =
  | { type: 'tab'; tab: AdminTabId }
  | { type: 'select-event'; eventId: string }
  | { type: 'callback'; run: () => void }
  | { type: 'logout' }
  | { type: 'totem' }
  | { type: 'switch-route'; targetRoute: 'admin' | 'operator' }
  | { type: 'external-route'; req: ExternalRouteNavigationRequest };

export interface AdminAppProps {
  controller?: EventAdminController;
  routeMode?: 'admin' | 'operator';
  activeTab?: AdminTabId;
  onAdminTabChange?: (tab: AdminTabId) => void;
  onOpenTotem?: () => void;
  onSwitchPanelRoute?: (route: 'admin' | 'operator') => void;
  externalRouteRequest?: ExternalRouteNavigationRequest | null;
  onResolveExternalRoute?: (confirm: boolean, req: ExternalRouteNavigationRequest) => void;
}

function createDefaultController(): EventAdminController {
  return new EventAdminController({
    cloudGateway: createDefaultCloudGateway(),
    clock: new SystemClock(),
    random: new CryptoRandomSource(),
  });
}

// Painel de Equipe do Estande (Administrador em #admin/* e Operador em #operador).
export function AdminApp({
  controller: injectedController,
  routeMode = 'admin',
  activeTab: controlledActiveTab,
  onAdminTabChange,
  onOpenTotem,
  onSwitchPanelRoute,
  externalRouteRequest,
  onResolveExternalRoute,
}: AdminAppProps) {
  const controller = useMemo(
    () => injectedController ?? createDefaultController(),
    [injectedController],
  );

  const { theme, toggleTheme } = useSaasTheme();

  const [session, setSession] = useState<AuthSession | null>(() => controller.getSession());
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [internalActiveTab, setInternalActiveTab] = useState<AdminTabId>(() =>
    resolveInitialAdminTab(),
  );
  const activeTab = controlledActiveTab ?? internalActiveTab;

  const [events, setEvents] = useState<EventConfig[]>([]);
  const [allQuestions, setAllQuestions] = useState<Question[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastCounterRef = useRef(0);
  const [unsavedPrompt, setUnsavedPrompt] = useState<UnsavedNavigationPrompt | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingNavigationAction | null>(null);
  const [isDevSimulatorOpen, setIsDevSimulatorOpen] = useState(false);

  const activeSaveHandlerRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    document.documentElement.classList.remove('totem-fullscreen-mode');
    document.body.classList.remove('totem-fullscreen-mode');
  }, []);

  const registerSaveHandler = useCallback((handler: (() => Promise<void>) | null) => {
    activeSaveHandlerRef.current = handler;
  }, []);

  const handleStatusMessage = useCallback((type: 'success' | 'error', message: string) => {
    toastCounterRef.current += 1;
    const id = toastCounterRef.current;
    setToasts((prev) => [...prev.slice(-3), { id, type, message }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const setActiveTab = useCallback(
    (nextTab: AdminTabId) => {
      if (onAdminTabChange) {
        onAdminTabChange(nextTab);
      } else {
        setInternalActiveTab(nextTab);
        if (typeof window !== 'undefined' && window.location.hash.toLowerCase().startsWith('#admin')) {
          window.location.hash = getHashForAdminTab(nextTab);
        }
      }
    },
    [onAdminTabChange],
  );

  const loadWorkspaceData = useCallback(
    async (preferredSelectedId?: string) => {
      if (!controller.getSession()) {
        return;
      }
      try {
        const fetchedEvents = await controller.listEvents();
        setEvents(fetchedEvents);
        setSelectedEventId((prevId) => {
          if (preferredSelectedId && fetchedEvents.some((e) => e.id === preferredSelectedId)) {
            return preferredSelectedId;
          }
          if (prevId && fetchedEvents.some((e) => e.id === prevId)) {
            return prevId;
          }
          return fetchedEvents[0]?.id ?? null;
        });

        if (controller.canAccessAdminPanel()) {
          const allQuestionsList = await controller.listAllQuestions();
          setAllQuestions(allQuestionsList);
        }
      } catch (error) {
        handleStatusMessage(
          'error',
          error instanceof Error ? error.message : 'Erro ao carregar dados do painel.',
        );
      }
    },
    [controller, handleStatusMessage],
  );

  useEffect(() => {
    let cancelled = false;
    if (controller.getSession()) {
      void loadWorkspaceData();
      return () => {
        cancelled = true;
      };
    }

    void controller.restoreSession().then((restored) => {
      if (!cancelled && restored) {
        setSession(restored);
        void loadWorkspaceData();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [controller, loadWorkspaceData]);

  useEffect(() => {
    if (!externalRouteRequest) {
      return;
    }
    const prompt = controller.checkUnsavedNavigation();
    if (prompt.canProceedImmediately) {
      onResolveExternalRoute?.(true, externalRouteRequest);
      return;
    }
    setPendingAction({ type: 'external-route', req: externalRouteRequest });
    setUnsavedPrompt(prompt);
  }, [controller, externalRouteRequest, onResolveExternalRoute]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      const authenticated = await controller.login(loginEmail, loginPassword);
      setSession(authenticated);
      setLoginPassword('');
      if (!controlledActiveTab) {
        setInternalActiveTab(resolveInitialAdminTab());
      }
      await loadWorkspaceData();
    } catch (error) {
      setLoginError(
        error instanceof Error ? error.message : 'Falha ao autenticar no painel.',
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  const executeNavigationAction = useCallback(
    async (action: PendingNavigationAction) => {
      if (action.type === 'tab') {
        setToasts([]);
        setActiveTab(action.tab);
        return;
      }
      if (action.type === 'select-event') {
        setToasts([]);
        setSelectedEventId(action.eventId);
        return;
      }
      if (action.type === 'callback') {
        action.run();
        return;
      }
      if (action.type === 'logout') {
        await controller.logout();
        setSession(null);
        setLoginEmail('');
        setLoginPassword('');
        setEvents([]);
        setAllQuestions([]);
        setToasts([]);
        return;
      }
      if (action.type === 'switch-route') {
        onSwitchPanelRoute?.(action.targetRoute);
        return;
      }
      if (action.type === 'external-route') {
        onResolveExternalRoute?.(true, action.req);
        return;
      }
      onOpenTotem?.();
    },
    [controller, onOpenTotem, onResolveExternalRoute, onSwitchPanelRoute, setActiveTab],
  );

  const requestGuardedAction = useCallback(
    (action: PendingNavigationAction) => {
      const prompt = controller.checkUnsavedNavigation();
      if (prompt.canProceedImmediately) {
        void executeNavigationAction(action);
        return;
      }
      setPendingAction(action);
      setUnsavedPrompt(prompt);
    },
    [controller, executeNavigationAction],
  );

  const requestGuardedCallback = useCallback(
    (proceed: () => void) => {
      requestGuardedAction({ type: 'callback', run: proceed });
    },
    [requestGuardedAction],
  );

  const handleUnsavedResolution = async (resolution: UnsavedChangesResolution) => {
    const actionToRun = pendingAction;
    try {
      const canProceed = await controller.resolveUnsavedNavigation(
        resolution,
        activeSaveHandlerRef.current ?? undefined,
      );
      setUnsavedPrompt(null);
      setPendingAction(null);
      if (canProceed && actionToRun) {
        await executeNavigationAction(actionToRun);
      } else if (!canProceed && actionToRun?.type === 'external-route') {
        onResolveExternalRoute?.(false, actionToRun.req);
      }
    } catch {
      if (actionToRun?.type === 'external-route') {
        onResolveExternalRoute?.(false, actionToRun.req);
      }
      setUnsavedPrompt(null);
      setPendingAction(null);
    }
  };

  if (!session) {
    return (
      <>
        <AdminLoginScreen
          routeMode={routeMode}
          theme={theme}
          onToggleTheme={toggleTheme}
          email={loginEmail}
          password={loginPassword}
          error={loginError}
          isSubmitting={isLoggingIn}
          onEmailChange={setLoginEmail}
          onPasswordChange={setLoginPassword}
          onSubmit={(e) => void handleLoginSubmit(e)}
          onOpenTotem={onOpenTotem}
        />
        <ToastViewport toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  const isAdmin = controller.canAccessAdminPanel();
  const showOperatorView = !isAdmin || routeMode === 'operator';

  return (
    <>
      <AdminSaasShell
        session={session}
        isAdmin={isAdmin}
        showOperatorView={showOperatorView}
        routeMode={routeMode}
        activeTab={activeTab}
        events={events}
        selectedEventId={selectedEventId}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSelectTab={(tab) => requestGuardedAction({ type: 'tab', tab })}
        onSelectEvent={(eventId) => requestGuardedAction({ type: 'select-event', eventId })}
        onSwitchPanelRoute={
          onSwitchPanelRoute
            ? (targetRoute) => requestGuardedAction({ type: 'switch-route', targetRoute })
            : undefined
        }
        onOpenDevSimulator={isAdmin ? () => setIsDevSimulatorOpen(true) : undefined}
        onOpenTotem={onOpenTotem ? () => requestGuardedAction({ type: 'totem' }) : undefined}
        onLogout={() => requestGuardedAction({ type: 'logout' })}
      >
        {showOperatorView ? (
          <OperatorPanel
            controller={controller}
            events={events}
            isAdmin={isAdmin}
            onEventsChanged={() => loadWorkspaceData()}
            onStatusMessage={handleStatusMessage}
          />
        ) : (
          <>
            {activeTab === 'overview' && (
              <AdminOverviewTab
                controller={controller}
                selectedEvent={events.find((ev) => ev.id === selectedEventId) ?? null}
                onNavigateTab={(tab) => requestGuardedAction({ type: 'tab', tab })}
                onEventsChanged={() => loadWorkspaceData()}
                onStatusMessage={handleStatusMessage}
              />
            )}

            {activeTab === 'settings' && (
              <AdminSettingsTab
                controller={controller}
                selectedEvent={events.find((ev) => ev.id === selectedEventId) ?? null}
                allQuestions={allQuestions}
                onEventsChanged={loadWorkspaceData}
                onRegisterSaveHandler={registerSaveHandler}
                onStatusMessage={handleStatusMessage}
              />
            )}

            {activeTab === 'events' && (
              <AdminEventsTab
                controller={controller}
                events={events}
                selectedEventId={selectedEventId}
                onSelectEventAndNavigate={(id, targetTab) => {
                  setSelectedEventId(id);
                  setActiveTab(targetTab);
                }}
                onEventsChanged={loadWorkspaceData}
                onStatusMessage={handleStatusMessage}
              />
            )}

            {activeTab === 'customization' && (
              <AdminCustomizationTab
                controller={controller}
                events={events}
                selectedEventId={selectedEventId}
                onSelectEvent={(id) => requestGuardedAction({ type: 'select-event', eventId: id })}
                onEventsChanged={loadWorkspaceData}
                onRegisterSaveHandler={registerSaveHandler}
                onStatusMessage={handleStatusMessage}
              />
            )}

            {activeTab === 'reports' && (
              <AdminReportsTab
                controller={controller}
                events={events}
                selectedEventId={selectedEventId}
                onEventsChanged={() => loadWorkspaceData()}
                onStatusMessage={handleStatusMessage}
              />
            )}

            {activeTab === 'analytics' && (
              <AdminAnalyticsTab
                controller={controller}
                events={events}
                selectedEventId={selectedEventId}
                allQuestions={allQuestions}
                onQuestionsChanged={() => loadWorkspaceData()}
                onStatusMessage={handleStatusMessage}
              />
            )}

            {activeTab === 'backup' && (
              <AdminBackupTab
                controller={controller}
                events={events}
                onWorkspaceRestored={() => loadWorkspaceData()}
                onStatusMessage={handleStatusMessage}
              />
            )}

            {activeTab === 'questions' && (
              <AdminQuestionsTab
                controller={controller}
                onRequestGuardedAction={requestGuardedCallback}
                onQuestionsChanged={() => loadWorkspaceData()}
                onRegisterSaveHandler={registerSaveHandler}
                onStatusMessage={handleStatusMessage}
              />
            )}

            {activeTab === 'totems' && (
              <AdminTotemsTab
                controller={controller}
                events={events}
                onStatusMessage={handleStatusMessage}
              />
            )}

            {activeTab === 'staff' && (
              <AdminStaffTab controller={controller} onStatusMessage={handleStatusMessage} />
            )}
          </>
        )}
      </AdminSaasShell>

      <ToastViewport toasts={toasts} onDismiss={dismissToast} />

      <Dialog
        open={Boolean(unsavedPrompt)}
        onOpenChange={(open) => {
          if (!open && unsavedPrompt) {
            void handleUnsavedResolution('cancel');
          }
        }}
      >
        <DialogContent id="unsaved-changes-modal" hideCloseButton>
          <DialogHeader>
            <DialogTitle id="unsaved-changes-title">Alterações Não Salvas</DialogTitle>
            <DialogDescription>{unsavedPrompt?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              id="unsaved-cancel-btn"
              type="button"
              variant="outline"
              onClick={() => void handleUnsavedResolution('cancel')}
            >
              Cancelar
            </Button>
            <Button
              id="unsaved-discard-leave-btn"
              type="button"
              variant="destructive"
              onClick={() => void handleUnsavedResolution('discard_and_leave')}
            >
              Sair sem Salvar
            </Button>
            <Button
              id="unsaved-save-leave-btn"
              type="button"
              onClick={() => void handleUnsavedResolution('save_and_leave')}
            >
              Salvar e Sair
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isDevSimulatorOpen && (
        <DevSimulatorModal
          event={events.find((ev) => ev.id === selectedEventId) ?? events[0] ?? null}
          onClose={() => setIsDevSimulatorOpen(false)}
        />
      )}
    </>
  );
}
