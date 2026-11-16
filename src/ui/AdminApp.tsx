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
import { AdminQuestionStatsTab } from './AdminQuestionStatsTab';
import { AdminQuestionsTab } from './AdminQuestionsTab';
import { AdminReportsTab } from './AdminReportsTab';
import { AdminStaffTab } from './AdminStaffTab';
import { AdminTotemsTab } from './AdminTotemsTab';
import type { ExternalRouteNavigationRequest } from './AppRouter';
import { DevSimulatorModal } from './DevSimulatorModal';
import { OperatorPanel } from './OperatorPanel';
import { createDefaultCloudGateway } from './cloudFactory';
import './styles.css';

type AdminTabId =
  | 'events'
  | 'customization'
  | 'reports'
  | 'analytics'
  | 'question-stats'
  | 'questions'
  | 'totems'
  | 'backup'
  | 'staff';

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

// Painel de Equipe do Estande (Administrador em #admin e Operador em #operador).
export function AdminApp({
  controller: injectedController,
  routeMode = 'admin',
  onOpenTotem,
  onSwitchPanelRoute,
  externalRouteRequest,
  onResolveExternalRoute,
}: AdminAppProps) {
  const controller = useMemo(
    () => injectedController ?? createDefaultController(),
    [injectedController],
  );

  const [session, setSession] = useState<AuthSession | null>(() => controller.getSession());
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [activeTab, setActiveTab] = useState<AdminTabId>('events');
  const [events, setEvents] = useState<EventConfig[]>([]);
  const [allQuestions, setAllQuestions] = useState<Question[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );
  const [unsavedPrompt, setUnsavedPrompt] = useState<UnsavedNavigationPrompt | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingNavigationAction | null>(null);
  const [isDevSimulatorOpen, setIsDevSimulatorOpen] = useState(false);

  const activeSaveHandlerRef = useRef<(() => Promise<void>) | null>(null);

  const registerSaveHandler = useCallback((handler: (() => Promise<void>) | null) => {
    activeSaveHandlerRef.current = handler;
  }, []);

  const handleStatusMessage = useCallback((type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
  }, []);

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
        setFeedback({
          type: 'error',
          message:
            error instanceof Error ? error.message : 'Erro ao carregar dados do painel.',
        });
      }
    },
    [controller],
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
      setActiveTab('events');
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
        setFeedback(null);
        setActiveTab(action.tab);
        return;
      }
      if (action.type === 'select-event') {
        setFeedback(null);
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
        setFeedback(null);
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
    [controller, onOpenTotem, onResolveExternalRoute, onSwitchPanelRoute],
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
      <div id="admin-login-screen" className="admin-shell">
        <div className="admin-login-card">
          <h1>
            {routeMode === 'operator'
              ? 'Operação do Estande'
              : 'Painel Administrativo do Quiz'}
          </h1>
          <p className="admin-subtitle">
            Acesso autenticado para a Equipe do Estande (Administrador e Operador).
          </p>

          <form onSubmit={(e) => void handleLoginSubmit(e)}>
            <div className="admin-field">
              <label htmlFor="admin-login-email">E-mail</label>
              <input
                id="admin-login-email"
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="admin@caesb.df.gov.br"
                required
              />
            </div>

            <div className="admin-field">
              <label htmlFor="admin-login-password">Senha</label>
              <input
                id="admin-login-password"
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
              />
            </div>

            {loginError && (
              <p className="admin-alert admin-alert-error" role="alert">
                {loginError}
              </p>
            )}

            <div className="admin-form-footer">
              <button
                id="admin-login-submit"
                type="submit"
                className="admin-btn admin-btn-primary"
                disabled={isLoggingIn}
              >
                {isLoggingIn ? 'Autenticando...' : 'Entrar'}
              </button>
              {onOpenTotem && (
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={onOpenTotem}
                >
                  Voltar ao Totem
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    );
  }

  const isAdmin = controller.canAccessAdminPanel();
  const showOperatorView = !isAdmin || routeMode === 'operator';

  return (
    <div id="admin-dashboard" className="admin-shell">
      <header className="admin-topbar">
        <div>
          <h2>
            {showOperatorView ? 'Operação do Estande' : 'Painel Administrativo do Quiz'}
          </h2>
          <small>
            Conectado como <strong>{session.user.name}</strong> (
            {isAdmin ? 'Administrador' : 'Operador'})
          </small>
        </div>

        <div className="admin-row-actions">
          {isAdmin && onSwitchPanelRoute && routeMode === 'operator' && (
            <button
              type="button"
              className="admin-btn admin-btn-secondary"
              onClick={() =>
                requestGuardedAction({ type: 'switch-route', targetRoute: 'admin' })
              }
            >
              Painel do Administrador
            </button>
          )}
          {isAdmin && onSwitchPanelRoute && routeMode === 'admin' && (
            <button
              type="button"
              className="admin-btn admin-btn-secondary"
              onClick={() =>
                requestGuardedAction({ type: 'switch-route', targetRoute: 'operator' })
              }
            >
              Visão de Operador
            </button>
          )}
          {isAdmin && (
            <button
              id="admin-dev-simulator-btn"
              type="button"
              className="admin-btn admin-btn-secondary"
              onClick={() => setIsDevSimulatorOpen(true)}
            >
              Modo Desenvolvedor / Simulador
            </button>
          )}
          {onOpenTotem && (
            <button
              id="admin-open-totem-btn"
              type="button"
              className="admin-btn admin-btn-secondary"
              onClick={() => requestGuardedAction({ type: 'totem' })}
            >
              Ir para Totem
            </button>
          )}
          <button
            id="admin-logout-btn"
            type="button"
            className="admin-btn admin-btn-danger"
            onClick={() => requestGuardedAction({ type: 'logout' })}
          >
            Sair
          </button>
        </div>
      </header>

      {feedback && (
        <div
          className={`admin-alert ${
            feedback.type === 'error' ? 'admin-alert-error' : 'admin-alert-success'
          }`}
          role="status"
        >
          {feedback.message}
        </div>
      )}

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
          <nav className="admin-tabs-nav" aria-label="Navegação administrativa">
            <button
              type="button"
              className={`admin-tab-btn ${activeTab === 'events' ? 'active' : ''}`}
              onClick={() => requestGuardedAction({ type: 'tab', tab: 'events' })}
            >
              Eventos e Configurações
            </button>
            <button
              type="button"
              className={`admin-tab-btn ${activeTab === 'customization' ? 'active' : ''}`}
              onClick={() => requestGuardedAction({ type: 'tab', tab: 'customization' })}
            >
              Personalização Visual
            </button>
            <button
              type="button"
              className={`admin-tab-btn ${activeTab === 'reports' ? 'active' : ''}`}
              onClick={() => requestGuardedAction({ type: 'tab', tab: 'reports' })}
            >
              Relatórios e Participantes
            </button>
            <button
              type="button"
              className={`admin-tab-btn ${activeTab === 'analytics' ? 'active' : ''}`}
              onClick={() => requestGuardedAction({ type: 'tab', tab: 'analytics' })}
            >
              Dashboard Analítico
            </button>
            <button
              type="button"
              className={`admin-tab-btn ${activeTab === 'question-stats' ? 'active' : ''}`}
              onClick={() => requestGuardedAction({ type: 'tab', tab: 'question-stats' })}
            >
              Estatísticas de Questões
            </button>
            <button
              type="button"
              className={`admin-tab-btn ${activeTab === 'questions' ? 'active' : ''}`}
              onClick={() => requestGuardedAction({ type: 'tab', tab: 'questions' })}
            >
              Banco de Questões
            </button>
            <button
              type="button"
              className={`admin-tab-btn ${activeTab === 'totems' ? 'active' : ''}`}
              onClick={() => requestGuardedAction({ type: 'tab', tab: 'totems' })}
            >
              Totens e Pareamento
            </button>
            <button
              type="button"
              className={`admin-tab-btn ${activeTab === 'backup' ? 'active' : ''}`}
              onClick={() => requestGuardedAction({ type: 'tab', tab: 'backup' })}
            >
              Backup e Migração
            </button>
            <button
              type="button"
              className={`admin-tab-btn ${activeTab === 'staff' ? 'active' : ''}`}
              onClick={() => requestGuardedAction({ type: 'tab', tab: 'staff' })}
            >
              Equipe do Estande
            </button>
          </nav>

          {activeTab === 'events' && (
            <AdminEventsTab
              controller={controller}
              events={events}
              allQuestions={allQuestions}
              selectedEventId={selectedEventId}
              onSelectEvent={(id) => requestGuardedAction({ type: 'select-event', eventId: id })}
              onRequestGuardedAction={requestGuardedCallback}
              onEventsChanged={loadWorkspaceData}
              onRegisterSaveHandler={registerSaveHandler}
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
              onEventsChanged={() => loadWorkspaceData()}
              onStatusMessage={handleStatusMessage}
            />
          )}

          {activeTab === 'analytics' && (
            <AdminAnalyticsTab
              controller={controller}
              events={events}
              allQuestions={allQuestions}
              onQuestionsChanged={() => loadWorkspaceData()}
              onStatusMessage={handleStatusMessage}
            />
          )}

          {activeTab === 'question-stats' && (
            <AdminQuestionStatsTab
              controller={controller}
              events={events}
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

      {unsavedPrompt && (
        <div
          id="unsaved-changes-modal"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="unsaved-changes-title"
        >
          <div className="modal-content admin-modal">
            <h3 id="unsaved-changes-title" className="modal-title">
              Alterações Não Salvas
            </h3>
            <p className="modal-text">{unsavedPrompt.message}</p>
            <div className="modal-actions">
              <button
                id="unsaved-save-leave-btn"
                type="button"
                className="admin-btn admin-btn-primary"
                onClick={() => void handleUnsavedResolution('save_and_leave')}
              >
                Salvar e Sair
              </button>
              <button
                id="unsaved-discard-leave-btn"
                type="button"
                className="admin-btn admin-btn-danger"
                onClick={() => void handleUnsavedResolution('discard_and_leave')}
              >
                Sair sem Salvar
              </button>
              <button
                id="unsaved-cancel-btn"
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => void handleUnsavedResolution('cancel')}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {isDevSimulatorOpen && (
        <DevSimulatorModal
          event={events.find((ev) => ev.id === selectedEventId) ?? events[0] ?? null}
          onClose={() => setIsDevSimulatorOpen(false)}
        />
      )}
    </div>
  );
}
