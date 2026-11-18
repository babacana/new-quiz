import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gift, Search, ShieldAlert, Trophy, Unlock, Users } from 'lucide-react';
import type { EventAdminController } from '../domain/eventAdminController';
import { matchesParticipantSearch } from '../domain/operationalRules';
import type { EventConfig, OperatorEventSnapshot, ParticipantReportItem } from '../domain/types';
import { OfflineConflictBanner, ParticipantStatusBadges } from './OperationalBadges';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { formatDateTimePtBr, formatTimeMMSS } from './formatters';
import { cn } from './lib/utils';

export interface OperatorPanelProps {
  controller: EventAdminController;
  events: EventConfig[];
  isAdmin: boolean;
  onEventsChanged: () => Promise<void>;
  onStatusMessage: (type: 'success' | 'error', message: string) => void;
}

type OperatorTabId = 'prizes' | 'participants' | 'ranking';

const LIVE_POLL_INTERVAL_MS = 10_000;

// Painel móvel mobile-first do Operador de Estande com bottom navigation (Brindes, Participantes e Ranking).
export function OperatorPanel({
  controller,
  events,
  isAdmin,
  onEventsChanged,
  onStatusMessage,
}: OperatorPanelProps) {
  const [activeTab, setActiveTab] = useState<OperatorTabId>('prizes');
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dashboard, setDashboard] = useState<OperatorEventSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  const activeEvents = useMemo(() => events.filter((ev) => ev.isActive), [events]);
  const selectableEvents = isAdmin ? events : activeEvents;

  const defaultEvent = useMemo(
    () => activeEvents[0] ?? events[0] ?? null,
    [activeEvents, events],
  );

  const effectiveEventId = useMemo(() => {
    if (selectedEventId && selectableEvents.some((ev) => ev.id === selectedEventId)) {
      return selectedEventId;
    }
    return defaultEvent?.id ?? '';
  }, [defaultEvent, selectableEvents, selectedEventId]);

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
    let reloadTimer: number | null = null;
    const unsubscribe = controller.subscribeTotemUpdates((event) => {
      if (event.type !== 'OPERATIONAL_DATA_UPDATED') {
        return;
      }
      if (event.eventId && effectiveEventId && event.eventId !== effectiveEventId) {
        return;
      }
      if (reloadTimer !== null) {
        window.clearTimeout(reloadTimer);
      }
      reloadTimer = window.setTimeout(() => {
        reloadTimer = null;
        void loadDashboard();
      }, 300);
    });
    const timerId = window.setInterval(() => {
      void loadDashboard();
    }, LIVE_POLL_INTERVAL_MS);

    return () => {
      unsubscribe();
      if (reloadTimer !== null) {
        window.clearTimeout(reloadTimer);
      }
      window.clearInterval(timerId);
    };
  }, [controller, effectiveEventId, loadDashboard]);

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
    <Card key={item.matchId}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold text-foreground">{item.participantName}</p>
            <p className="text-xs text-muted-foreground">
              {item.participantPhone} · #{item.rankingPosition} ({item.score}/{item.totalQuestions}{' '}
              acertos · {formatTimeMMSS(item.timeSeconds)})
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            <ParticipantStatusBadges
              prizeStatus={item.prizeStatus}
              hasOfflineConflict={item.hasOfflineConflict}
              hasActiveGiveUpLockout={item.hasActiveGiveUpLockout}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {item.prizeClaimId && item.prizeStatus === 'awaiting_pickup' && (
            <Button
              type="button"
              className="min-h-10 flex-1"
              onClick={() => void handleConfirmDelivery(item.prizeClaimId!, item.participantName)}
            >
              Entregue
            </Button>
          )}
          {item.prizeClaimId && item.prizeStatus !== null && item.prizeStatus !== 'revoked' && (
            <Button
              type="button"
              variant="outline"
              className="min-h-10 flex-1"
              onClick={() =>
                void handleRevokePhone(item.eventId, item.participantPhone, item.participantName)
              }
            >
              Despremiar
            </Button>
          )}
          {item.hasActiveGiveUpLockout && (
            <Button
              type="button"
              variant="secondary"
              className="min-h-10 flex-1"
              onClick={() => void handleUnlockPhone(item.eventId, item.participantPhone)}
            >
              <Unlock className="h-4 w-4" />
              Destravar
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );

  const showEventSelector = isAdmin || activeEvents.length > 1;
  const prizesAlertCount =
    (dashboard?.awaitingPickupQueue.length ?? 0) + (dashboard?.offlineConflicts.length ?? 0);

  return (
    <section
      id="operator-restricted-view"
      className="mx-auto w-full max-w-2xl space-y-4 overflow-x-hidden pb-24"
    >
      {/* Cabeçalho enxuto com seletor de Evento ativo */}
      <Card>
        <CardHeader className="space-y-3 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-lg">Visão do Operador de Estande</CardTitle>
              <p className="text-xs text-muted-foreground">
                {isAdmin
                  ? 'Visualização mobile-first de operação de estande na rota #operador.'
                  : 'Atendimento ao vivo no estande para entrega de Brindes, desbloqueios e Ranking.'}
              </p>
            </div>
            {loading && (
              <span className="text-xs font-medium text-muted-foreground">Sincronizando...</span>
            )}
          </div>

          {showEventSelector ? (
            <div className="space-y-1">
              <Label htmlFor="operator-event-select" className="text-xs">
                Evento em Operação
              </Label>
              <select
                id="operator-event-select"
                aria-label="Evento em Operação"
                value={effectiveEventId}
                onChange={(e) => setSelectedEventId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {selectableEvents.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name} {ev.isActive ? '(Ativo)' : '(Encerrado)'}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            defaultEvent && (
              <div className="inline-flex w-fit items-center rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                Evento ativo: {defaultEvent.name}
              </div>
            )
          )}
        </CardHeader>
      </Card>

      {/* Indicadores rápidos */}
      {dashboard && (
        <div className="grid grid-cols-3 gap-2">
          <Card>
            <CardContent className="p-3 text-center">
              <span className="block text-[11px] font-medium text-muted-foreground">
                Saldo Brindes
              </span>
              <strong className="text-lg font-bold text-foreground">
                {dashboard.event.prizeStockRemaining === null
                  ? 'Ilimitado'
                  : dashboard.event.prizeStockRemaining}
              </strong>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <span className="block text-[11px] font-medium text-muted-foreground">
                Aguardando
              </span>
              <strong className="text-lg font-bold text-foreground">
                {dashboard.awaitingPickupQueue.length}
              </strong>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <span className="block text-[11px] font-medium text-muted-foreground">
                Bloqueios
              </span>
              <strong className="text-lg font-bold text-foreground">
                {dashboard.activeLockouts.length}
              </strong>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Aba 1: Brindes (fila Aguardando Retirada + Conflitos Offline) */}
      {dashboard && activeTab === 'prizes' && (
        <div className="space-y-4">
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

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">
              Fila Aguardando Retirada ({dashboard.awaitingPickupQueue.length})
            </h3>
            {dashboard.awaitingPickupQueue.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  Nenhum Participante aguardando retirada de Brinde.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2.5">
                {dashboard.awaitingPickupQueue.map((item) => (
                  <Card key={item.matchId}>
                    <CardContent className="space-y-3 p-4">
                      <div>
                        <p className="font-semibold text-foreground">{item.participantName}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.participantPhone} · #{item.rankingPosition} ·{' '}
                          {formatDateTimePtBr(item.awardedAt)}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {item.prizeClaimId && (
                          <Button
                            type="button"
                            className="min-h-11 flex-1"
                            onClick={() =>
                              void handleConfirmDelivery(item.prizeClaimId!, item.participantName)
                            }
                          >
                            <Gift className="h-4 w-4" />
                            Entregue
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-11"
                          onClick={() =>
                            void handleRevokePhone(
                              item.eventId,
                              item.participantPhone,
                              item.participantName,
                            )
                          }
                        >
                          Despremiar
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Aba 2: Participantes (Busca rápida, Bloqueios por Desistência e Ações) */}
      {dashboard && activeTab === 'participants' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-2 p-4">
              <Label htmlFor="operator-quick-search">Buscar por Nome ou Telefone</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="operator-quick-search"
                  type="search"
                  className="pl-9"
                  value={searchQuery}
                  placeholder="Digite nome ou telefone do Participante..."
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {filteredLockouts.length > 0 && (
            <div className="space-y-2.5">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <ShieldAlert className="h-4 w-4 text-amber-500" />
                Bloqueios por Desistência Ativos ({filteredLockouts.length})
              </h3>
              {filteredLockouts.map((lockout) => (
                <Card key={lockout.id}>
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">
                        {lockout.participantPhone}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Bloqueado até {formatDateTimePtBr(lockout.expiresAt)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-10 shrink-0"
                      onClick={() =>
                        void handleUnlockPhone(lockout.eventId, lockout.participantPhone)
                      }
                    >
                      <Unlock className="h-4 w-4" />
                      Destravar
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <div className="space-y-2.5">
            {filteredParticipants.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  Nenhum Participante encontrado para o filtro informado.
                </CardContent>
              </Card>
            ) : (
              filteredParticipants.map(renderParticipantQuickCard)
            )}
          </div>
        </div>
      )}

      {/* Aba 3: Ranking ao Vivo */}
      {dashboard && activeTab === 'ranking' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-4 w-4 text-amber-500" />
              Ranking ao Vivo ({dashboard.ranking.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {dashboard.ranking.length === 0 ? (
              <p className="px-4 pb-6 text-center text-sm text-muted-foreground">
                Nenhuma Partida concluída neste Evento ainda.
              </p>
            ) : (
              <ol className="divide-y divide-border">
                {dashboard.ranking.map((entry) => (
                  <li
                    key={entry.matchId}
                    className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={cn(
                          'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                          entry.position <= 3
                            ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        #{entry.position}
                      </span>
                      <span className="truncate font-medium text-foreground">
                        {entry.participantName}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">
                      {entry.score}/{entry.totalQuestions} · {formatTimeMMSS(entry.timeSeconds)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      )}

      {/* Barra de navegação inferior fixa (Bottom Navigation) */}
      <nav
        aria-label="Navegação do operador"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 backdrop-blur-xs"
      >
        <div className="mx-auto grid max-w-2xl grid-cols-3">
          <button
            type="button"
            aria-current={activeTab === 'prizes' ? 'page' : undefined}
            onClick={() => setActiveTab('prizes')}
            className={cn(
              'relative flex flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors cursor-pointer',
              activeTab === 'prizes'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Gift className="h-5 w-5" />
            <span>Brindes</span>
            {prizesAlertCount > 0 && (
              <span className="absolute top-1.5 right-[calc(50%-22px)] inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {prizesAlertCount}
              </span>
            )}
          </button>

          <button
            type="button"
            aria-current={activeTab === 'participants' ? 'page' : undefined}
            onClick={() => setActiveTab('participants')}
            className={cn(
              'relative flex flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors cursor-pointer',
              activeTab === 'participants'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Users className="h-5 w-5" />
            <span>Participantes</span>
            {dashboard && dashboard.activeLockouts.length > 0 && (
              <span className="absolute top-1.5 right-[calc(50%-28px)] inline-flex min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                {dashboard.activeLockouts.length}
              </span>
            )}
          </button>

          <button
            type="button"
            aria-current={activeTab === 'ranking' ? 'page' : undefined}
            onClick={() => setActiveTab('ranking')}
            className={cn(
              'flex flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors cursor-pointer',
              activeTab === 'ranking'
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Trophy className="h-5 w-5" />
            <span>Ranking</span>
          </button>
        </div>
      </nav>
    </section>
  );
}
