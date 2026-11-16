import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Eye,
  RotateCcw,
  Search,
  ShieldOff,
  Trash2,
  Unlock,
} from 'lucide-react';
import type { EventAdminController } from '../domain/eventAdminController';
import type {
  EventConfig,
  PaginatedParticipantReportResult,
  ParticipantMatchDetails,
  ParticipantPrizeFilter,
  ParticipantReportFilterOptions,
  ParticipantSortField,
  SortDirection,
} from '../domain/types';
import { OfflineConflictBanner, ParticipantStatusBadges } from './OperationalBadges';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import {
  PRIZE_STATUS_LABELS,
  formatDateTimePtBr,
  formatTimeMMSS,
  triggerFileDownload,
} from './formatters';
import { cn } from './lib/utils';

export interface AdminReportsTabProps {
  controller: EventAdminController;
  events: EventConfig[];
  selectedEventId?: string | null;
  onEventsChanged: () => Promise<void>;
  onStatusMessage: (type: 'success' | 'error', message: string) => void;
}

const PRIZE_FILTER_OPTIONS: Array<{ value: ParticipantPrizeFilter; label: string }> = [
  { value: 'all', label: 'Todos os Status' },
  { value: 'winners', label: 'Ganhadores de Brinde' },
  { value: 'non_winners', label: 'Não Ganhadores' },
  { value: 'awaiting_pickup', label: 'Aguardando Retirada' },
  { value: 'delivered', label: 'Entregue' },
  { value: 'revoked', label: 'Revogado / Despremiado' },
  { value: 'offline_conflict', label: 'Conflito Offline' },
];

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function computeResponsivePageSize(): number {
  if (typeof window === 'undefined') {
    return 10;
  }
  if (window.innerWidth > 0 && window.innerWidth < 768) {
    return 5;
  }
  if (window.innerHeight > 0 && window.innerHeight < 760) {
    return 8;
  }
  return 10;
}

// Aba Participantes & Ranking: tabela desktop / cards mobile, filtros, gabarito em modal, ações em lote e exportação.
export function AdminReportsTab({
  controller,
  events,
  selectedEventId,
  onEventsChanged,
  onStatusMessage,
}: AdminReportsTabProps) {
  const [eventIdFilter, setEventIdFilter] = useState<string>(() => selectedEventId ?? 'all');

  useEffect(() => {
    if (selectedEventId) {
      setEventIdFilter(selectedEventId);
      setPage(1);
    }
  }, [selectedEventId]);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [prizeFilter, setPrizeFilter] = useState<ParticipantPrizeFilter>('all');
  const [onlyLockedOut, setOnlyLockedOut] = useState(false);
  const [exactScoreInput, setExactScoreInput] = useState('');
  const [sortBy, setSortBy] = useState<ParticipantSortField>('playedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [page, setPage] = useState(1);
  const [manualPageSize, setManualPageSize] = useState<number | null>(null);
  const [viewportPageSize, setViewportPageSize] = useState<number>(computeResponsivePageSize);
  const pageSize = manualPageSize ?? viewportPageSize;

  const [report, setReport] = useState<PaginatedParticipantReportResult>({
    items: [],
    totalItems: 0,
    page: 1,
    pageSize: 10,
    totalPages: 1,
    offlineConflicts: [],
    activeLockouts: [],
  });
  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<string>>(new Set());
  const [detailsModal, setDetailsModal] = useState<ParticipantMatchDetails | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setViewportPageSize(computeResponsivePageSize());
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const filterOptions = useMemo<ParticipantReportFilterOptions>(() => {
    const parsedScore = exactScoreInput.trim() !== '' ? Number(exactScoreInput.trim()) : null;
    return {
      eventId: eventIdFilter === 'all' ? undefined : eventIdFilter,
      search: search.trim() || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      prizeFilter,
      onlyLockedOut,
      exactScore: parsedScore !== null && Number.isFinite(parsedScore) ? parsedScore : null,
      sortBy,
      sortDirection,
      page,
      pageSize,
    };
  }, [
    eventIdFilter,
    search,
    startDate,
    endDate,
    prizeFilter,
    onlyLockedOut,
    exactScoreInput,
    sortBy,
    sortDirection,
    page,
    pageSize,
  ]);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const next = await controller.queryParticipantReports(filterOptions);
      setReport(next);
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao carregar relatórios de Participantes.',
      );
    } finally {
      setLoading(false);
    }
  }, [controller, filterOptions, onStatusMessage]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const visibleMatchIds = useMemo(
    () => report.items.map((item) => item.matchId),
    [report.items],
  );

  const allVisibleSelected =
    visibleMatchIds.length > 0 && visibleMatchIds.every((id) => selectedMatchIds.has(id));

  const toggleSort = (field: ParticipantSortField) => {
    setPage(1);
    if (sortBy === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDirection(field === 'score' || field === 'playedAt' ? 'desc' : 'asc');
    }
  };

  const renderSortIndicator = (field: ParticipantSortField): string => {
    if (sortBy !== field) {
      return '';
    }
    return sortDirection === 'asc' ? ' ↑' : ' ↓';
  };

  const handleToggleSelectAll = (checked: boolean) => {
    setSelectedMatchIds((prev) => {
      const next = new Set(prev);
      for (const id of visibleMatchIds) {
        if (checked) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return next;
    });
  };

  const handleToggleRow = (matchId: string, checked: boolean) => {
    setSelectedMatchIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(matchId);
      } else {
        next.delete(matchId);
      }
      return next;
    });
  };

  const selectedItems = useMemo(
    () => report.items.filter((item) => selectedMatchIds.has(item.matchId)),
    [report.items, selectedMatchIds],
  );

  const handleConfirmBatchDelivery = async () => {
    const claimIds = selectedItems
      .map((item) => item.prizeClaimId)
      .filter((id): id is string => Boolean(id));
    if (claimIds.length === 0) {
      onStatusMessage('error', 'Nenhuma Partida selecionada possui Brinde para confirmar entrega.');
      return;
    }
    try {
      const updated = await controller.confirmPrizeDeliveries(claimIds);
      setSelectedMatchIds(new Set());
      onStatusMessage(
        updated.length > 0 ? 'success' : 'error',
        updated.length > 0
          ? `${updated.length} entrega(s) de Brinde confirmada(s).`
          : 'Nenhum Brinde elegível (Aguardando Retirada) para entregar.',
      );
      await onEventsChanged();
      await loadReports();
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao confirmar entregas em lote.',
      );
    }
  };

  const handleConfirmSingleConflictDelivery = async (claimId: string, participantName: string) => {
    try {
      const updated = await controller.confirmPrizeDeliveries([claimId]);
      onStatusMessage(
        updated.length > 0 ? 'success' : 'error',
        updated.length > 0
          ? `Brinde único entregue para "${participantName}".`
          : 'Este telefone já recebeu seu Brinde neste Evento.',
      );
      await onEventsChanged();
      await loadReports();
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao confirmar entrega única.',
      );
    }
  };

  const handleRevokeBatchPrizes = async () => {
    const claimIds = selectedItems
      .map((item) => item.prizeClaimId)
      .filter((id): id is string => Boolean(id));
    if (claimIds.length === 0) {
      onStatusMessage('error', 'Nenhuma Partida selecionada possui Brinde vinculado.');
      return;
    }
    try {
      const updated = await controller.revokePrizeClaims(claimIds);
      setSelectedMatchIds(new Set());
      onStatusMessage('success', `${updated.length} Brinde(s) despremiado(s). Totens notificados.`);
      await onEventsChanged();
      await loadReports();
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao despremiar em lote.',
      );
    }
  };

  const handleUnlockBatchPhones = async () => {
    const phonesByEvent = new Map<string, Set<string>>();
    for (const item of selectedItems) {
      const phones = phonesByEvent.get(item.eventId) ?? new Set<string>();
      phones.add(item.participantPhone);
      phonesByEvent.set(item.eventId, phones);
    }

    if (phonesByEvent.size === 0) {
      return;
    }

    try {
      let totalUnlocked = 0;
      for (const [evId, phones] of phonesByEvent.entries()) {
        totalUnlocked += await controller.unlockParticipantPhones(evId, Array.from(phones));
      }
      setSelectedMatchIds(new Set());
      onStatusMessage(
        'success',
        totalUnlocked > 0
          ? `${totalUnlocked} bloqueio(s) por desistência destravado(s).`
          : 'Nenhum bloqueio ativo encontrado nos Participantes selecionados.',
      );
      await loadReports();
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao destravar Participantes.',
      );
    }
  };

  const handleUnlockSingleLockout = async (eventId: string, phone: string) => {
    try {
      const unlocked = await controller.unlockParticipantPhones(eventId, [phone]);
      onStatusMessage(
        'success',
        unlocked > 0
          ? `Telefone ${phone} destravado no Evento.`
          : `Nenhum bloqueio ativo para ${phone}.`,
      );
      await loadReports();
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao destravar telefone.',
      );
    }
  };

  const handleDeleteBatchMatches = async () => {
    const ids = Array.from(selectedMatchIds);
    if (ids.length === 0) {
      return;
    }
    try {
      const deleted = await controller.deleteParticipantMatches(ids);
      setSelectedMatchIds(new Set());
      onStatusMessage(
        'success',
        `${deleted.length} Partida(s) excluída(s) com atualização nos Totens.`,
      );
      await onEventsChanged();
      await loadReports();
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao excluir Partidas.',
      );
    }
  };

  const handleOpenDetails = async (matchId: string) => {
    try {
      const details = await controller.getParticipantMatchDetails(matchId);
      setDetailsModal(details);
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao carregar detalhes da Partida.',
      );
    }
  };

  const handleExport = async (format: 'csv' | 'json') => {
    try {
      const content =
        format === 'csv'
          ? await controller.exportParticipantsCsv(filterOptions)
          : await controller.exportParticipantsJson(filterOptions);
      triggerFileDownload(
        `participantes-relatorio.${format}`,
        content,
        format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
      );
      onStatusMessage('success', `Relatório exportado em formato ${format.toUpperCase()}.`);
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : `Erro ao exportar relatório ${format.toUpperCase()}.`,
      );
    }
  };

  const resetFilters = () => {
    setEventIdFilter('all');
    setSearch('');
    setStartDate('');
    setEndDate('');
    setPrizeFilter('all');
    setOnlyLockedOut(false);
    setExactScoreInput('');
    setPage(1);
  };

  return (
    <div id="admin-reports-tab" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Participantes &amp; Ranking</h1>
          <p className="text-sm text-muted-foreground">
            Consulte Partidas, filtre entregas de Brindes e conflitos offline, gerencie bloqueios em
            lote e exporte os dados filtrados.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void handleExport('csv')}>
            <Download className="h-4 w-4" />
            Exportar CSV
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void handleExport('json')}>
            <Download className="h-4 w-4" />
            Exportar JSON
          </Button>
        </div>
      </div>

      <OfflineConflictBanner
        conflicts={report.offlineConflicts}
        confirmButtonLabel="Confirmar Entrega Única"
        onConfirmDelivery={(claimId, participantName) =>
          void handleConfirmSingleConflictDelivery(claimId, participantName)
        }
        onFilterConflicts={() => {
          setPrizeFilter('offline_conflict');
          setPage(1);
        }}
      />

      {/* Filtros */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtros de Busca e Segmentação</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="report-filter-event">Evento</Label>
              <select
                id="report-filter-event"
                className={SELECT_CLASS}
                value={eventIdFilter}
                onChange={(e) => {
                  setEventIdFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">Todos os Eventos</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="report-filter-search">Busca (Nome ou Telefone)</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="report-filter-search"
                  type="search"
                  className="pl-8"
                  value={search}
                  placeholder="Nome ou telefone..."
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="report-filter-start-date">Data Inicial</Label>
              <Input
                id="report-filter-start-date"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setPage(1);
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="report-filter-end-date">Data Final</Label>
              <Input
                id="report-filter-end-date"
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setPage(1);
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="report-filter-prize">Status do Brinde</Label>
              <select
                id="report-filter-prize"
                className={SELECT_CLASS}
                value={prizeFilter}
                onChange={(e) => {
                  setPrizeFilter(e.target.value as ParticipantPrizeFilter);
                  setPage(1);
                }}
              >
                {PRIZE_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="report-filter-score">Pontuação Exata</Label>
              <Input
                id="report-filter-score"
                type="number"
                min={0}
                value={exactScoreInput}
                placeholder="Ex: 5"
                onChange={(e) => {
                  setExactScoreInput(e.target.value);
                  setPage(1);
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="report-page-size">Itens por página</Label>
              <select
                id="report-page-size"
                className={SELECT_CLASS}
                value={pageSize}
                onChange={(e) => {
                  setManualPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                <option value={5}>5</option>
                <option value={8}>8</option>
                <option value={10}>10</option>
                <option value={25}>25</option>
              </select>
            </div>

            <div className="flex items-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={resetFilters}>
                <RotateCcw className="h-3.5 w-3.5" />
                Limpar Filtros
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onlyLockedOut}
                onChange={(e) => {
                  setOnlyLockedOut(e.target.checked);
                  setPage(1);
                }}
                className="h-4 w-4 rounded border-input"
              />
              Somente com Bloqueio por Desistência ativo ({report.activeLockouts.length})
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {selectedMatchIds.size} selecionada(s)
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={selectedMatchIds.size === 0}
                onClick={() => void handleConfirmBatchDelivery()}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Confirmar Entrega
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={selectedMatchIds.size === 0}
                onClick={() => void handleRevokeBatchPrizes()}
              >
                <ShieldOff className="h-3.5 w-3.5" />
                Despremiar
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={selectedMatchIds.size === 0}
                onClick={() => void handleUnlockBatchPhones()}
              >
                <Unlock className="h-3.5 w-3.5" />
                Destravar Telefones
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={selectedMatchIds.size === 0}
                onClick={() => void handleDeleteBatchMatches()}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Excluir
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bloqueios ativos */}
      {report.activeLockouts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Bloqueios por Desistência Ativos ({report.activeLockouts.length})
            </CardTitle>
            <CardDescription>
              Libere o telefone manualmente caso o Participante precise tentar novamente.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {report.activeLockouts.map((lockout) => (
              <div
                key={lockout.id}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs"
              >
                <span className="font-medium">{lockout.participantPhone}</span>
                <span className="text-muted-foreground">
                  até {formatDateTimePtBr(lockout.expiresAt)}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void handleUnlockSingleLockout(lockout.eventId, lockout.participantPhone)
                  }
                >
                  Destravar
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Tabela desktop (md+) */}
      <Card data-testid="reports-desktop-table" className="hidden md:block">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground uppercase">
                  <th className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todas as Partidas visíveis"
                      checked={allVisibleSelected}
                      onChange={(e) => handleToggleSelectAll(e.target.checked)}
                      className="h-4 w-4 rounded border-input"
                    />
                  </th>
                  <th className="px-3 py-3">
                    <button
                      type="button"
                      className="cursor-pointer font-medium hover:text-foreground"
                      onClick={() => toggleSort('participantName')}
                    >
                      Participante{renderSortIndicator('participantName')}
                    </button>
                  </th>
                  <th className="px-3 py-3">Telefone</th>
                  <th className="px-3 py-3">Evento</th>
                  <th className="px-3 py-3">
                    <button
                      type="button"
                      className="cursor-pointer font-medium hover:text-foreground"
                      onClick={() => toggleSort('score')}
                    >
                      Pontuação{renderSortIndicator('score')}
                    </button>
                  </th>
                  <th className="px-3 py-3">Tempo</th>
                  <th className="px-3 py-3">
                    <button
                      type="button"
                      className="cursor-pointer font-medium hover:text-foreground"
                      onClick={() => toggleSort('playedAt')}
                    >
                      Data/Hora{renderSortIndicator('playedAt')}
                    </button>
                  </th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && report.items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                      Carregando Partidas...
                    </td>
                  </tr>
                ) : report.items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                      Nenhuma Partida encontrada para os filtros selecionados.
                    </td>
                  </tr>
                ) : (
                  report.items.map((item) => (
                    <tr key={item.matchId} className="transition-colors hover:bg-muted/30">
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Selecionar Partida de ${item.participantName}`}
                          checked={selectedMatchIds.has(item.matchId)}
                          onChange={(e) => handleToggleRow(item.matchId, e.target.checked)}
                          className="h-4 w-4 rounded border-input"
                        />
                      </td>
                      <td className="px-3 py-3 font-medium">
                        {item.participantName}
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          #{item.rankingPosition}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {item.participantPhone}
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">{item.eventName}</td>
                      <td className="px-3 py-3 font-medium">
                        {item.score}/{item.totalQuestions}
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {formatTimeMMSS(item.timeSeconds)}
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {formatDateTimePtBr(item.playedAt)}
                      </td>
                      <td className="px-3 py-3">
                        <ParticipantStatusBadges
                          prizeStatus={item.prizeStatus}
                          hasOfflineConflict={item.hasOfflineConflict}
                          hasActiveGiveUpLockout={item.hasActiveGiveUpLockout}
                          showEmptyPrizeBadge
                        />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void handleOpenDetails(item.matchId)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Ver Detalhes
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Cards empilhados para mobile (< md) */}
      <div data-testid="reports-mobile-cards" className="space-y-3 md:hidden">
        {report.items.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {loading
                ? 'Carregando Partidas...'
                : 'Nenhuma Partida encontrada para os filtros selecionados.'}
            </CardContent>
          </Card>
        ) : (
          report.items.map((item) => (
            <Card key={item.matchId}>
              <CardContent className="space-y-3 pt-4">
                <div className="flex items-start justify-between gap-2">
                  <label className="flex items-center gap-2 font-medium text-sm">
                    <input
                      type="checkbox"
                      aria-label={`Selecionar Partida de ${item.participantName}`}
                      checked={selectedMatchIds.has(item.matchId)}
                      onChange={(e) => handleToggleRow(item.matchId, e.target.checked)}
                      className="h-4 w-4 rounded border-input"
                    />
                    <span>
                      {item.participantName}{' '}
                      <span className="text-xs text-muted-foreground">#{item.rankingPosition}</span>
                    </span>
                  </label>
                  <span className="text-sm font-semibold">
                    {item.score}/{item.totalQuestions}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                  <div>{item.participantPhone}</div>
                  <div className="text-right">{formatTimeMMSS(item.timeSeconds)}</div>
                  <div>{item.eventName}</div>
                  <div className="text-right">{formatDateTimePtBr(item.playedAt)}</div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <ParticipantStatusBadges
                    prizeStatus={item.prizeStatus}
                    hasOfflineConflict={item.hasOfflineConflict}
                    hasActiveGiveUpLockout={item.hasActiveGiveUpLockout}
                    showEmptyPrizeBadge
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleOpenDetails(item.matchId)}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Ver Detalhes
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Paginação */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={report.page <= 1}
          onClick={() => setPage((prev) => Math.max(1, prev - 1))}
        >
          Anterior
        </Button>
        <span className="text-xs text-muted-foreground">
          Página {report.page} de {report.totalPages} ({report.totalItems} Partida(s))
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={report.page >= report.totalPages}
          onClick={() => setPage((prev) => Math.min(report.totalPages, prev + 1))}
        >
          Próxima
        </Button>
      </div>

      {/* Modal de Detalhes / Gabarito da Partida */}
      <Dialog
        open={Boolean(detailsModal)}
        onOpenChange={(open) => {
          if (!open) {
            setDetailsModal(null);
          }
        }}
      >
        <DialogContent id="participant-details-modal" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle id="participant-details-title">
              Detalhes da Partida · {detailsModal?.participantName}
            </DialogTitle>
            <DialogDescription>
              Resumo completo da execução e gabarito questão a questão.
            </DialogDescription>
          </DialogHeader>

          {detailsModal && (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/30 p-3 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">Telefone</dt>
                  <dd className="font-medium">{detailsModal.participantPhone}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Evento</dt>
                  <dd className="font-medium">{detailsModal.eventName}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Data/Hora</dt>
                  <dd className="font-medium">{formatDateTimePtBr(detailsModal.playedAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Pontuação</dt>
                  <dd className="font-medium">
                    {detailsModal.score}/{detailsModal.totalQuestions}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Tempo</dt>
                  <dd className="font-medium">{formatTimeMMSS(detailsModal.timeSeconds)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Colocação no Ranking</dt>
                  <dd className="font-medium">#{detailsModal.rankingPosition}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Partidas do telefone no Evento</dt>
                  <dd className="font-medium">{detailsModal.totalMatchesByPhoneInEvent}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Status do Brinde</dt>
                  <dd className="font-medium">
                    {detailsModal.prizeStatus
                      ? PRIZE_STATUS_LABELS[detailsModal.prizeStatus]
                      : 'Sem Brinde'}
                  </dd>
                </div>
              </dl>

              <div className="space-y-2">
                <h4 className="text-sm font-semibold">
                  Respostas da Partida ({detailsModal.answers.length})
                </h4>
                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {detailsModal.answers.map((answer, idx) => (
                    <div
                      key={`${answer.questionId}-${idx}`}
                      className={cn(
                        'rounded-md border p-2.5 text-xs',
                        answer.isCorrect
                          ? 'border-emerald-500/40 bg-emerald-500/5'
                          : 'border-destructive/40 bg-destructive/5',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2 font-medium">
                        <span>
                          {idx + 1}. {answer.questionText}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold',
                            answer.isCorrect
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : 'bg-destructive/15 text-destructive',
                          )}
                        >
                          {answer.isCorrect ? 'Correta' : 'Incorreta'}
                        </span>
                      </div>
                      <div className="mt-1 text-muted-foreground">
                        Resposta do Participante: {answer.selectedOptionText || 'Tempo esgotado'} ·
                        Alternativa correta: {answer.correctOptionText}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="flex-wrap justify-between gap-2 sm:justify-between">
            {detailsModal && (
              <div className="flex flex-wrap items-center gap-2">
                {detailsModal.prizeStatus === 'awaiting_pickup' && detailsModal.prizeClaimId && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void handleConfirmSingleConflictDelivery(
                        detailsModal.prizeClaimId!,
                        detailsModal.participantName,
                      ).then(() => setDetailsModal(null))
                    }
                  >
                    Confirmar Brinde
                  </Button>
                )}
                {(detailsModal.prizeStatus === 'awaiting_pickup' ||
                  detailsModal.prizeStatus === 'delivered') &&
                  detailsModal.prizeClaimId && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void controller
                          .revokePrizeClaims([detailsModal.prizeClaimId!])
                          .then(async () => {
                            onStatusMessage(
                              'success',
                              `Brinde despremiado para "${detailsModal.participantName}".`,
                            );
                            setDetailsModal(null);
                            await onEventsChanged();
                            await loadReports();
                          })
                      }
                    >
                      Despremiar
                    </Button>
                  )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void handleUnlockSingleLockout(
                      detailsModal.eventId,
                      detailsModal.participantPhone,
                    )
                  }
                >
                  Destravar Telefone
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() =>
                    void controller.deleteParticipantMatches([detailsModal.matchId]).then(async () => {
                      onStatusMessage('success', 'Partida excluída com atualização nos Totens.');
                      setDetailsModal(null);
                      await onEventsChanged();
                      await loadReports();
                    })
                  }
                >
                  Excluir Partida
                </Button>
              </div>
            )}
            <Button type="button" onClick={() => setDetailsModal(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
