import { useCallback, useEffect, useState } from 'react';
import type { EventAdminController } from '../domain/eventAdminController';
import type { EventConfig, TotemRecord } from '../domain/types';
import {
  TOTEM_ONLINE_STATUS_LABELS,
  TOTEM_SCREEN_LABELS,
  formatLastSeenPtBr,
} from './formatters';

export interface AdminTotemsTabProps {
  controller: EventAdminController;
  events: EventConfig[];
  onStatusMessage: (type: 'success' | 'error', message: string) => void;
}

type ReloadTargetScreen = 'initial-screen' | 'idle-screen';

function resolveValidEventId(currentId: string, events: EventConfig[]): string {
  return currentId && events.some((e) => e.id === currentId) ? currentId : (events[0]?.id ?? '');
}

// Aba administrativa de Pareamento de Totens, Monitoramento ao Vivo e Comandos Remotos.
export function AdminTotemsTab({
  controller,
  events,
  onStatusMessage,
}: AdminTotemsTabProps) {
  const [totems, setTotems] = useState<TotemRecord[]>([]);
  const [pairingCodeInput, setPairingCodeInput] = useState('');
  const [totemNameInput, setTotemNameInput] = useState('');
  const [pinCodeInput, setPinCodeInput] = useState('1234');
  const [selectedEventId, setSelectedEventId] = useState<string>(() => events[0]?.id ?? '');
  const [generatedActivationLink, setGeneratedActivationLink] = useState<string | null>(null);

  const [batchTargetEventId, setBatchTargetEventId] = useState<string>(() => events[0]?.id ?? '');
  const [batchSwitchEventId, setBatchSwitchEventId] = useState<string>(() => events[0]?.id ?? '');
  const [batchReloadScreen, setBatchReloadScreen] =
    useState<ReloadTargetScreen>('initial-screen');
  const [rowEventSelection, setRowEventSelection] = useState<Record<string, string>>({});
  const [rowReloadSelection, setRowReloadSelection] = useState<
    Record<string, ReloadTargetScreen>
  >({});

  useEffect(() => {
    if (events.length === 0) {
      return;
    }
    setSelectedEventId((prev) => resolveValidEventId(prev, events));
    setBatchTargetEventId((prev) => resolveValidEventId(prev, events));
    setBatchSwitchEventId((prev) => resolveValidEventId(prev, events));
  }, [events]);

  const refreshTotems = useCallback(async () => {
    try {
      const list = await controller.listTotems();
      setTotems(list);
      setRowEventSelection((prev) => {
        const next: Record<string, string> = { ...prev };
        for (const totem of list) {
          if (!next[totem.id]) {
            next[totem.id] = totem.eventId ?? events[0]?.id ?? '';
          }
        }
        return next;
      });
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao listar Totens pareados.',
      );
    }
  }, [controller, events, onStatusMessage]);

  useEffect(() => {
    void refreshTotems();
    const unsubscribe = controller.subscribeTotemUpdates(() => {
      void refreshTotems();
    });
    const refreshInterval = window.setInterval(() => {
      void refreshTotems();
    }, 30_000);
    return () => {
      unsubscribe();
      window.clearInterval(refreshInterval);
    };
  }, [controller, refreshTotems]);

  const handleAuthorizePairing = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const authorized = await controller.authorizeTotemPairing({
        pairingCode: pairingCodeInput.trim() || undefined,
        name: totemNameInput,
        pinCode: pinCodeInput,
        eventId: selectedEventId,
      });
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const link = controller.buildTotemActivationLink(authorized.pairingCode, origin);
      setGeneratedActivationLink(link);
      setPairingCodeInput('');
      setTotemNameInput('');
      await refreshTotems();
      onStatusMessage(
        'success',
        `Totem "${authorized.name}" pareado com código ${authorized.pairingCode}.`,
      );
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao autorizar Pareamento do Totem.',
      );
    }
  };

  const handleRunCommand = async (action: () => Promise<unknown>, successMessage: string) => {
    try {
      await action();
      await refreshTotems();
      onStatusMessage('success', successMessage);
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao enviar comando remoto.',
      );
    }
  };

  const eventNameById = new Map(events.map((ev) => [ev.id, ev.name]));

  return (
    <div id="admin-totems-tab" className="admin-tab-layout">
      <form className="admin-panel-card" onSubmit={(e) => void handleAuthorizePairing(e)}>
        <h3>Autorizar Pareamento de Totem</h3>
        <p className="admin-subtitle">
          Informe o código exibido no Totem ou deixe em branco para gerar um link de ativação.
        </p>

        <div className="admin-form-grid">
          <div className="admin-field">
            <label htmlFor="totem-pairing-code-input">Código de Pareamento</label>
            <input
              id="totem-pairing-code-input"
              type="text"
              value={pairingCodeInput}
              onChange={(e) => setPairingCodeInput(e.target.value.toUpperCase())}
              placeholder="Opcional (ex.: ABC123)"
            />
          </div>

          <div className="admin-field">
            <label htmlFor="totem-name-input">Nome do Totem</label>
            <input
              id="totem-name-input"
              type="text"
              value={totemNameInput}
              onChange={(e) => setTotemNameInput(e.target.value)}
              placeholder="Ex.: Totem Estande 01"
              required
            />
          </div>

          <div className="admin-field">
            <label htmlFor="totem-pin-code-input">PIN Local</label>
            <input
              id="totem-pin-code-input"
              type="text"
              inputMode="numeric"
              value={pinCodeInput}
              onChange={(e) => setPinCodeInput(e.target.value)}
              required
            />
          </div>

          <div className="admin-field">
            <label htmlFor="totem-event-select">Evento Vinculado</label>
            <select
              id="totem-event-select"
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
              required
            >
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="admin-form-footer">
          <button
            id="authorize-totem-btn"
            type="submit"
            className="admin-btn admin-btn-primary"
            disabled={events.length === 0}
          >
            Autorizar Pareamento
          </button>
        </div>

        {generatedActivationLink && (
          <div className="admin-alert admin-alert-success">
            Link de ativação gerado:{' '}
            <code id="generated-activation-link">{generatedActivationLink}</code>
          </div>
        )}
      </form>

      <div className="admin-panel-card">
        <h3>Comandos Remotos em Lote por Evento</h3>
        <div className="admin-form-grid">
          <div className="admin-field">
            <label htmlFor="batch-target-event-select">Evento Alvo do Comando</label>
            <select
              id="batch-target-event-select"
              value={batchTargetEventId}
              onChange={(e) => setBatchTargetEventId(e.target.value)}
            >
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                </option>
              ))}
            </select>
          </div>

          <div className="admin-field">
            <label htmlFor="batch-switch-event-select">Novo Evento em Lote</label>
            <select
              id="batch-switch-event-select"
              value={batchSwitchEventId}
              onChange={(e) => setBatchSwitchEventId(e.target.value)}
            >
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                </option>
              ))}
            </select>
          </div>

          <div className="admin-field">
            <label htmlFor="batch-reload-screen-select">Tela de Destino em Lote</label>
            <select
              id="batch-reload-screen-select"
              value={batchReloadScreen}
              onChange={(e) => setBatchReloadScreen(e.target.value as ReloadTargetScreen)}
            >
              <option value="initial-screen">Tela Inicial</option>
              <option value="idle-screen">Tela de Descanso</option>
            </select>
          </div>
        </div>

        <div className="admin-row-actions">
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            disabled={!batchTargetEventId || !batchSwitchEventId}
            onClick={() =>
              void handleRunCommand(
                () =>
                  controller.switchTotemEvent(
                    { eventId: batchTargetEventId },
                    batchSwitchEventId,
                  ),
                'Comando SWITCH_EVENT enviado para os Totens do Evento.',
              )
            }
          >
            Trocar Evento de Todos os Totens
          </button>
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            disabled={!batchTargetEventId}
            onClick={() =>
              void handleRunCommand(
                () => controller.forceSyncTotems({ eventId: batchTargetEventId }),
                'Comando FORCE_SYNC enviado para os Totens do Evento.',
              )
            }
          >
            Forçar Sincronização do Evento
          </button>
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            disabled={!batchTargetEventId}
            onClick={() =>
              void handleRunCommand(
                () =>
                  controller.reloadTotemScreen(
                    { eventId: batchTargetEventId },
                    batchReloadScreen,
                  ),
                'Comando RELOAD_SCREEN enviado para os Totens do Evento.',
              )
            }
          >
            Reiniciar Tela do Evento
          </button>
        </div>
      </div>

      <div className="admin-panel-card">
        <div className="admin-section-header">
          <h3>Monitoramento ao Vivo dos Totens ({totems.length})</h3>
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            onClick={() => void refreshTotems()}
          >
            Atualizar Lista
          </button>
        </div>

        {totems.length === 0 ? (
          <p className="admin-subtitle">Nenhum Totem cadastrado ou aguardando Pareamento.</p>
        ) : (
          <div className="admin-events-list">
            {totems.map((totem) => {
              const targetEventId =
                rowEventSelection[totem.id] ?? totem.eventId ?? events[0]?.id ?? '';
              const targetReloadScreen = rowReloadSelection[totem.id] ?? 'initial-screen';
              return (
                <div key={totem.id} className="admin-event-row admin-totem-row">
                  <div className="admin-event-info">
                    <div className="admin-event-title">
                      <strong>{totem.name}</strong>
                      <code>{totem.pairingCode}</code>
                      <span
                        className={`admin-badge ${
                          totem.onlineStatus === 'online' ? 'active' : 'closed'
                        }`}
                      >
                        {TOTEM_ONLINE_STATUS_LABELS[totem.onlineStatus]}
                      </span>
                      <span className="admin-badge">
                        {totem.isPaired ? 'Pareado' : 'Aguardando Autorização'}
                      </span>
                      <span className="admin-badge">
                        Tela: {TOTEM_SCREEN_LABELS[totem.currentScreen]}
                      </span>
                      <span className="admin-badge version">v{totem.configVersion}</span>
                    </div>
                    <small>
                      Evento:{' '}
                      {totem.eventId
                        ? (eventNameById.get(totem.eventId) ?? totem.eventId)
                        : 'Não vinculado'}{' '}
                      · Último ping: {formatLastSeenPtBr(totem.lastSeenAt)} · Fila local:{' '}
                      {totem.pendingSyncCount} item(ns)
                    </small>
                  </div>

                  {totem.isPaired && (
                    <div className="admin-row-actions">
                      <select
                        aria-label={`Trocar Evento de ${totem.name}`}
                        value={targetEventId}
                        onChange={(e) =>
                          setRowEventSelection((prev) => ({
                            ...prev,
                            [totem.id]: e.target.value,
                          }))
                        }
                      >
                        {events.map((ev) => (
                          <option key={ev.id} value={ev.id}>
                            {ev.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="admin-btn admin-btn-secondary"
                        disabled={!targetEventId}
                        onClick={() =>
                          void handleRunCommand(
                            () =>
                              controller.switchTotemEvent(
                                { totemId: totem.id },
                                targetEventId,
                              ),
                            `Comando Trocar Evento enviado para "${totem.name}".`,
                          )
                        }
                      >
                        Trocar Evento
                      </button>
                      <button
                        type="button"
                        className="admin-btn admin-btn-secondary"
                        onClick={() =>
                          void handleRunCommand(
                            () => controller.forceSyncTotems({ totemId: totem.id }),
                            `Comando Forçar Sincronização enviado para "${totem.name}".`,
                          )
                        }
                      >
                        Forçar Sincronização
                      </button>
                      <select
                        aria-label={`Tela de reinício de ${totem.name}`}
                        value={targetReloadScreen}
                        onChange={(e) =>
                          setRowReloadSelection((prev) => ({
                            ...prev,
                            [totem.id]: e.target.value as ReloadTargetScreen,
                          }))
                        }
                      >
                        <option value="initial-screen">Tela Inicial</option>
                        <option value="idle-screen">Tela de Descanso</option>
                      </select>
                      <button
                        type="button"
                        className="admin-btn admin-btn-secondary"
                        onClick={() =>
                          void handleRunCommand(
                            () =>
                              controller.reloadTotemScreen(
                                { totemId: totem.id },
                                targetReloadScreen,
                              ),
                            `Comando Reiniciar Tela enviado para "${totem.name}".`,
                          )
                        }
                      >
                        Reiniciar Tela
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
