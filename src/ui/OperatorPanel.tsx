import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EventAdminController } from '../domain/eventAdminController';
import { matchesParticipantSearch } from '../domain/operationalRules';
import type { EventConfig, OperatorEventSnapshot, ParticipantReportItem } from '../domain/types';
import { OfflineConflictBanner, ParticipantStatusBadges } from './OperationalBadges';
import { formatDateTimePtBr, formatTimeMMSS } from './formatters';

export interface OperatorPanelProps {
  controller: EventAdminController;
  events: EventConfig[];
  isAdmin: boolean;
  onEventsChanged: () => Promise<void>;
  onStatusMessage: (type: 'success' | 'error', message: string) => void;
}

const LIVE_POLL_INTERVAL_MS = 10_000;

// Painel móvel em tempo real do Operador de Estande focado no Evento ativo.
export function OperatorPanel({
  controller,
  events,
  isAdmin,
  onEventsChanged,
  onStatusMessage,
}: OperatorPanelProps) {
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dashboard, setDashboard] = useState<OperatorEventSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  const activeEvent = useMemo(
    () => events.find((ev) => ev.isActive) ?? events[0] ?? null,
    [events],
  );

  const effectiveEventId = isAdmin
    ? selectedEventId || (activeEvent?.id ?? '')
    : (activeEvent?.id ?? '');

  const loadDashboard = useCallback(async () => {
    if (!effectiveEventId) {
      setDashboard(null);
      return;
    }
    setLoading(true);
    try {
      const next = await controller.getOperatorDashboard(effectiveEventId);
      setDashboard(next);
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao carregar painel do estande.',
      );
    } finally {
      setLoading(false);
    }
  }, [controller, effectiveEventId, onStatusMessage]);

  useEffect(() => {
    void loadDashboard();
    const unsubscribe = controller.subscribeTotemUpdates(() => {
      void loadDashboard();
    });
    const timerId = window.setInterval(() => {
      void loadDashboard();
    }, LIVE_POLL_INTERVAL_MS);

    return () => {
      unsubscribe();
      window.clearInterval(timerId);
    };
  }, [controller, loadDashboard]);

  const handleConfirmDelivery = async (claimId: string, participantName: string) => {
    try {
      const updated = await controller.confirmPrizeDeliveries([claimId]);
      if (updated.length > 0) {
        onStatusMessage('success', `Brinde entregue para "${participantName}".`);
      } else {
        onStatusMessage(
          'error',
          'Não foi possível confirmar entrega: apenas 1 Brinde pode ser entregue por telefone.',
        );
      }
      await onEventsChanged();
      await loadDashboard();
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao confirmar entrega do Brinde.',
      );
    }
  };

  const handleRevokePhone = async (eventId: string, phone: string, label: string) => {
    try {
      const revoked = await controller.revokePhonePrizeInEvent(eventId, phone);
      onStatusMessage(
        'success',
        revoked.length > 0
          ? `Brinde despremiado para "${label}". Trava liberada nos Totens.`
          : 'Nenhum Brinde ativo encontrado para despremiar.',
      );
      await onEventsChanged();
      await loadDashboard();
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao despremiar Participante.',
      );
    }
  };

  const handleUnlockPhone = async (eventId: string, phone: string) => {
    try {
      const unlocked = await controller.unlockParticipantPhones(eventId, [phone]);
      onStatusMessage(
        'success',
        unlocked > 0
          ? `Telefone ${phone} destravado no Evento. Totens atualizados.`
          : `Nenhum bloqueio ativo encontrado para ${phone}.`,
      );
      await loadDashboard();
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao destravar telefone.',
      );
    }
  };

  const filteredParticipants = useMemo(() => {
    if (!dashboard) {
      return [];
    }
    return dashboard.recentParticipants.filter((item) =>
      matchesParticipantSearch(item.participantName, item.participantPhone, searchQuery),
    );
  }, [dashboard, searchQuery]);

  const filteredLockouts = useMemo(() => {
    if (!dashboard) {
      return [];
    }
    return dashboard.activeLockouts.filter((lockout) =>
      matchesParticipantSearch('', lockout.participantPhone, searchQuery),
    );
  }, [dashboard, searchQuery]);

  const renderParticipantQuickCard = (item: ParticipantReportItem) => (
    <div key={item.matchId} className="operator-mobile-card">
      <div className="operator-card-top">
        <div>
          <strong>{item.participantName}</strong>
          <div className="operator-card-meta">
            {item.participantPhone} · #{item.rankingPosition} ({item.score}/{item.totalQuestions}{' '}
            acertos · {formatTimeMMSS(item.timeSeconds)})
          </div>
        </div>
        <div className="operator-card-badges">
          <ParticipantStatusBadges
            prizeStatus={item.prizeStatus}
            hasOfflineConflict={item.hasOfflineConflict}
            hasActiveGiveUpLockout={item.hasActiveGiveUpLockout}
          />
        </div>
      </div>

      <div className="operator-card-actions">
        {item.prizeClaimId && item.prizeStatus === 'awaiting_pickup' && (
          <button
            type="button"
            className="admin-btn admin-btn-primary operator-tap-btn"
            onClick={() => void handleConfirmDelivery(item.prizeClaimId!, item.participantName)}
          >
            Entregue
          </button>
        )}
        {item.prizeClaimId && item.prizeStatus !== null && item.prizeStatus !== 'revoked' && (
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            onClick={() =>
              void handleRevokePhone(item.eventId, item.participantPhone, item.participantName)
            }
          >
            Despremiar
          </button>
        )}
        {item.hasActiveGiveUpLockout && (
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            onClick={() => void handleUnlockPhone(item.eventId, item.participantPhone)}
          >
            Destravar
          </button>
        )}
      </div>
    </div>
  );

  return (
    <section id="operator-restricted-view" className="admin-panel-card operator-mobile-panel">
      <div className="operator-panel-header">
        <div>
          <h3>Visão do Operador de Estande</h3>
          <p className="admin-subtitle">
            {isAdmin
              ? 'Visualização enxuta de operação de estande na rota #operador.'
              : 'Painel operacional do estande focado no Evento ativo para entregas de Brindes e desbloqueios ao vivo.'}
          </p>
        </div>

        <div className="operator-event-controls">
          {isAdmin ? (
            <label className="operator-event-select-label">
              <span>Evento em Operação</span>
              <select
                aria-label="Evento em Operação"
                value={effectiveEventId}
                onChange={(e) => setSelectedEventId(e.target.value)}
              >
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name} {ev.isActive ? '(Ativo)' : '(Encerrado)'}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            activeEvent && (
              <span className="admin-badge active">Evento ativo: {activeEvent.name}</span>
            )
          )}
          {loading && <small className="operator-card-meta">Sincronizando...</small>}
        </div>
      </div>

      {dashboard && (
        <div className="operator-metrics-bar">
          <div className="operator-metric-pill">
            <span>Saldo de Brindes</span>
            <strong>
              {dashboard.event.prizeStockRemaining === null
                ? 'Ilimitado'
                : dashboard.event.prizeStockRemaining}
            </strong>
          </div>
          <div className="operator-metric-pill">
            <span>Aguardando Retirada</span>
            <strong>{dashboard.awaitingPickupQueue.length}</strong>
          </div>
          <div className="operator-metric-pill">
            <span>Bloqueios Ativos</span>
            <strong>{dashboard.activeLockouts.length}</strong>
          </div>
        </div>
      )}

      {dashboard && (
        <OfflineConflictBanner
          conflicts={dashboard.offlineConflicts}
          confirmButtonLabel="Entregue"
          onConfirmDelivery={(claimId, participantName) =>
            void handleConfirmDelivery(claimId, participantName)
          }
          onRevokePhone={(eventId, phone, participantName) =>
            void handleRevokePhone(eventId, phone, participantName)
          }
        />
      )}

      {dashboard && (
        <div className="operator-sections-grid">
          <div className="operator-section-block">
            <h4>Fila Aguardando Retirada ({dashboard.awaitingPickupQueue.length})</h4>
            {dashboard.awaitingPickupQueue.length === 0 ? (
              <p className="admin-empty-hint">Nenhum Participante aguardando retirada de Brinde.</p>
            ) : (
              <div className="operator-cards-list">
                {dashboard.awaitingPickupQueue.map((item) => (
                  <div key={item.matchId} className="operator-mobile-card operator-queue-card">
                    <div>
                      <strong>{item.participantName}</strong>
                      <div className="operator-card-meta">
                        {item.participantPhone} · #{item.rankingPosition} ·{' '}
                        {formatDateTimePtBr(item.awardedAt)}
                      </div>
                    </div>
                    <div className="operator-card-actions">
                      {item.prizeClaimId && (
                        <button
                          type="button"
                          className="admin-btn admin-btn-primary operator-tap-btn"
                          onClick={() =>
                            void handleConfirmDelivery(item.prizeClaimId!, item.participantName)
                          }
                        >
                          Entregue
                        </button>
                      )}
                      <button
                        type="button"
                        className="admin-btn admin-btn-secondary"
                        onClick={() =>
                          void handleRevokePhone(
                            item.eventId,
                            item.participantPhone,
                            item.participantName,
                          )
                        }
                      >
                        Despremiar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="operator-section-block">
            <h4>Busca Rápida de Participante e Ações</h4>
            <div className="form-group">
              <label htmlFor="operator-quick-search">Buscar por Nome ou Telefone</label>
              <input
                id="operator-quick-search"
                type="search"
                value={searchQuery}
                placeholder="Digite nome ou telefone do Participante..."
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {filteredLockouts.length > 0 && (
              <div className="operator-lockouts-box">
                <h5>Bloqueios por Desistência Ativos ({filteredLockouts.length})</h5>
                <div className="operator-cards-list">
                  {filteredLockouts.map((lockout) => (
                    <div key={lockout.id} className="operator-mobile-card">
                      <div>
                        <strong>{lockout.participantPhone}</strong>
                        <div className="operator-card-meta">
                          Bloqueado até {formatDateTimePtBr(lockout.expiresAt)}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="admin-btn admin-btn-secondary"
                        onClick={() =>
                          void handleUnlockPhone(lockout.eventId, lockout.participantPhone)
                        }
                      >
                        Destravar
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="operator-cards-list">
              {filteredParticipants.length === 0 ? (
                <p className="admin-empty-hint">
                  Nenhum Participante encontrado para o filtro informado.
                </p>
              ) : (
                filteredParticipants.map(renderParticipantQuickCard)
              )}
            </div>
          </div>

          <div className="operator-section-block">
            <h4>Ranking ao Vivo ({dashboard.ranking.length})</h4>
            {dashboard.ranking.length === 0 ? (
              <p className="admin-empty-hint">Nenhuma Partida concluída neste Evento ainda.</p>
            ) : (
              <ol className="operator-ranking-list">
                {dashboard.ranking.map((entry) => (
                  <li key={entry.matchId} className="operator-ranking-row">
                    <span>
                      <strong>#{entry.position}</strong> {entry.participantName}
                    </span>
                    <span>
                      {entry.score}/{entry.totalQuestions} · {formatTimeMMSS(entry.timeSeconds)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
