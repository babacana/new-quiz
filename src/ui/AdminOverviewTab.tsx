import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Gift,
  Monitor,
  RefreshCw,
  SlidersHorizontal,
  Trophy,
  Users,
} from 'lucide-react';
import type { EventAdminController } from '../domain/eventAdminController';
import { normalizePhoneDigits } from '../domain/operationalRules';
import type { EventConfig, OperatorEventSnapshot, TotemRecord } from '../domain/types';
import type { AdminTabId } from './adminRoutes';
import { Button } from './components/ui/button';
import { EventStatusBadge } from './components/EventStatusBadge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import {
  TOTEM_ONLINE_STATUS_LABELS,
  TOTEM_SCREEN_LABELS,
  formatLastSeenPtBr,
} from './formatters';
import { cn } from './lib/utils';

export interface AdminOverviewTabProps {
  controller: EventAdminController;
  selectedEvent: EventConfig | null;
  onNavigateTab: (tab: AdminTabId) => void;
  onEventsChanged: () => Promise<void>;
  onStatusMessage: (type: 'success' | 'error', message: string) => void;
}

// Tela inicial do Evento selecionado: KPIs, status dos Totens, fila de Brindes e resolução de Conflitos Offline.
export function AdminOverviewTab({
  controller,
  selectedEvent,
  onNavigateTab,
  onEventsChanged,
  onStatusMessage,
}: AdminOverviewTabProps) {
  const [snapshot, setSnapshot] = useState<OperatorEventSnapshot | null>(null);
  const [linkedTotems, setLinkedTotems] = useState<TotemRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const loadOverviewData = useCallback(async () => {
    if (!selectedEvent) {
      setSnapshot(null);
      setLinkedTotems([]);
      return;
    }
    setLoading(true);
    try {
      const [dashboard, allTotems] = await Promise.all([
        controller.getOperatorDashboard(selectedEvent.id),
        controller.listTotems(),
      ]);
      setSnapshot(dashboard);
      setLinkedTotems(allTotems.filter((t) => t.eventId === selectedEvent.id));
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao carregar visão geral do Evento.',
      );
    } finally {
      setLoading(false);
    }
  }, [controller, onStatusMessage, selectedEvent]);

  const selectedEventId = selectedEvent?.id ?? null;

  useEffect(() => {
    void loadOverviewData();
    let reloadTimer: number | null = null;
    const unsubscribe = controller.subscribeTotemUpdates((event) => {
      if (event.type === 'TELEMETRY_UPDATED' || event.type === 'PAIRING_AUTHORIZED') {
        const updatedTotem = event.totem;
        setLinkedTotems((prev) => {
          const belongsToSelected = selectedEventId !== null && updatedTotem.eventId === selectedEventId;
          const withoutCurrent = prev.filter((item) => item.id !== updatedTotem.id);
          return belongsToSelected ? [...withoutCurrent, updatedTotem] : withoutCurrent;
        });
        return;
      }

      if (event.type === 'OPERATIONAL_DATA_UPDATED') {
        if (event.eventId && selectedEventId && event.eventId !== selectedEventId) {
          return;
        }
        if (reloadTimer !== null) {
          window.clearTimeout(reloadTimer);
        }
        reloadTimer = window.setTimeout(() => {
          reloadTimer = null;
          void loadOverviewData();
        }, 300);
      }
    });

    return () => {
      unsubscribe();
      if (reloadTimer !== null) {
        window.clearTimeout(reloadTimer);
      }
    };
  }, [controller, loadOverviewData, selectedEventId]);

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
      await loadOverviewData();
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao confirmar entrega do Brinde.',
      );
    }
  };

  const handleRevokeConflictPhone = async (phone: string, participantName: string) => {
    if (!selectedEvent) {
      return;
    }
    try {
      const revoked = await controller.revokePhonePrizeInEvent(selectedEvent.id, phone);
      onStatusMessage(
        'success',
        revoked.length > 0
          ? `Brinde despremiado para "${participantName}". Trava liberada nos Totens.`
          : 'Nenhum Brinde ativo encontrado para despremiar.',
      );
      await onEventsChanged();
      await loadOverviewData();
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao resolver conflito offline.',
      );
    }
  };

  if (!selectedEvent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Visão Geral</CardTitle>
          <CardDescription>
            Nenhum Evento selecionado. Crie ou selecione um Evento na aba &ldquo;Eventos&rdquo;.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" onClick={() => onNavigateTab('events')}>
            Ir para Eventos
          </Button>
        </CardContent>
      </Card>
    );
  }

  const recentParticipants = snapshot?.recentParticipants ?? [];
  const totalMatches = recentParticipants.length;
  const uniqueParticipantsCount = new Set(
    recentParticipants.map((p) => normalizePhoneDigits(p.participantPhone) || p.matchId),
  ).size;
  const deliveredPrizes =
    recentParticipants.filter((p) => p.prizeStatus === 'delivered').length;
  const awaitingCount = snapshot?.awaitingPickupQueue.length ?? 0;
  const onlineTotemsCount = linkedTotems.filter((t) => t.onlineStatus === 'online').length;
  const conflicts = snapshot?.offlineConflicts ?? [];

  return (
    <div id="admin-overview-tab" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Visão Geral</h1>
            <EventStatusBadge isActive={selectedEvent.isActive} />
          </div>
          <p className="text-sm text-muted-foreground">
            {selectedEvent.name} · Estoque:{' '}
            {selectedEvent.prizeStockRemaining === null
              ? 'Ilimitado'
              : `${selectedEvent.prizeStockRemaining} restante(s)`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadOverviewData()}
            disabled={loading}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            Atualizar
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onNavigateTab('settings')}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Regras &amp; Configurações
          </Button>
        </div>
      </div>

      {/* KPIs do Evento selecionado */}
      <div data-testid="overview-kpis" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">
              Partidas
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalMatches}</div>
            <p className="text-xs text-muted-foreground">
              {uniqueParticipantsCount} participante(s) único(s)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">
              Brindes Entregues
            </CardTitle>
            <Trophy className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{deliveredPrizes}</div>
            <p className="text-xs text-muted-foreground">
              Mínimo {selectedEvent.settings.minScoreForPrize} pts
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">
              Aguardando Retirada
            </CardTitle>
            <Gift className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{awaitingCount}</div>
            <p className="text-xs text-muted-foreground">
              {selectedEvent.settings.requireManualPrizeConfirmation
                ? 'Confirmação manual ativa'
                : 'Entrega automática'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">
              Totens Online
            </CardTitle>
            <Monitor className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {onlineTotemsCount}/{linkedTotems.length}
            </div>
            <p className="text-xs text-muted-foreground">
              {linkedTotems.length} vinculado(s) ao Evento
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Alertas de Conflito de Premiação Offline */}
      <Card
        data-testid="overview-offline-conflicts"
        className={cn(conflicts.length > 0 && 'border-amber-500/60 bg-amber-500/5')}
      >
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle
                className={cn(
                  'h-5 w-5',
                  conflicts.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
                )}
              />
              <div>
                <CardTitle className="text-base">
                  Conflitos de Premiação Offline ({conflicts.length})
                </CardTitle>
                <CardDescription>
                  O mesmo telefone conquistou Brinde em mais de um Totem sem conexão.
                </CardDescription>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onNavigateTab('reports')}
            >
              Abrir Relatórios
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {conflicts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum conflito de premiação offline detectado neste Evento.
            </p>
          ) : (
            <div className="space-y-3">
              {conflicts.map((conflict) => (
                <div
                  key={`${conflict.eventId}-${conflict.participantPhone}`}
                  className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1 text-sm">
                    <div className="font-semibold">
                      {conflict.participantName} · {conflict.participantPhone}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {conflict.conflictClaims.length} ocorrências registradas offline · Apenas 1
                      Brinde permanece válido.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() =>
                        void handleRevokeConflictPhone(
                          conflict.participantPhone,
                          conflict.participantName,
                        )
                      }
                    >
                      Despremiar Telefone
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Totens vinculados */}
        <Card data-testid="overview-totems">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
            <div>
              <CardTitle className="text-base">Totens Vinculados ({linkedTotems.length})</CardTitle>
              <CardDescription>Estado em tempo real dos Totens neste Evento.</CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onNavigateTab('totems')}
            >
              Gerenciar Totens
            </Button>
          </CardHeader>
          <CardContent>
            {linkedTotems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum Totem vinculado a este Evento ainda.
              </p>
            ) : (
              <div className="space-y-2.5">
                {linkedTotems.map((totem) => (
                  <div
                    key={totem.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm"
                  >
                    <div>
                      <div className="font-medium">{totem.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Tela: {TOTEM_SCREEN_LABELS[totem.currentScreen] ?? totem.currentScreen} ·
                        Visto: {formatLastSeenPtBr(totem.lastSeenAt)}
                      </div>
                    </div>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                        totem.onlineStatus === 'online'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {TOTEM_ONLINE_STATUS_LABELS[totem.onlineStatus] ?? totem.onlineStatus}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Fila de Brindes Aguardando Retirada */}
        <Card data-testid="overview-awaiting-pickup">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Brindes Aguardando Retirada ({awaitingCount})
            </CardTitle>
            <CardDescription>
              Confirme a entrega física diretamente pela Visão Geral.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {awaitingCount === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                Nenhum Brinde aguardando retirada no momento.
              </div>
            ) : (
              <div className="space-y-2.5">
                {snapshot?.awaitingPickupQueue.map((item) => (
                  <div
                    key={item.matchId}
                    className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="font-medium">{item.participantName}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.participantPhone} · {item.score} pts
                      </div>
                    </div>
                    {item.prizeClaimId && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          void handleConfirmDelivery(item.prizeClaimId!, item.participantName)
                        }
                      >
                        Confirmar Entrega
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
