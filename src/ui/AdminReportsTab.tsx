import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  PRIZE_STATUS_LABELS,
  formatDateTimePtBr,
  formatTimeMMSS,
  triggerFileDownload,
} from './formatters';

export interface AdminReportsTabProps {
  controller: EventAdminController;
  events: EventConfig[];
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

// Aba de relatórios operacionais de Participantes, fila de Brindes, lote e exportação (Admin).
export function AdminReportsTab({
  controller,
  events,
  onEventsChanged,
  onStatusMessage,
}: AdminReportsTabProps) {
  const [eventIdFilter, setEventIdFilter] = useState<string>('all');
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
    <section id="admin-reports-tab" className="admin-panel-card">
      <div className="admin-panel-header">
        <div>
          <h3>Relatórios Operacionais e Participantes</h3>
          <p className="admin-subtitle">
            Consulte Partidas, filtre entregas de Brindes e conflitos offline, gerencie bloqueios em
            lote e exporte os dados filtrados.
          </p>
        </div>

        <div className="admin-panel-actions">
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            onClick={() => void handleExport('csv')}
          >
            Exportar CSV
          </button>
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            onClick={() => void handleExport('json')}
          >
            Exportar JSON
          </button>
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

      <div className="reports-filters-grid">
        <div className="form-group">
          <label htmlFor="report-filter-event">Evento</label>
          <select
            id="report-filter-event"
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

        <div className="form-group">
          <label htmlFor="report-filter-search">Busca (Nome ou Telefone)</label>
          <input
            id="report-filter-search"
            type="search"
            value={search}
            placeholder="Nome ou telefone..."
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <div className="form-group">
          <label htmlFor="report-filter-start-date">Data Inicial</label>
          <input
            id="report-filter-start-date"
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <div className="form-group">
          <label htmlFor="report-filter-end-date">Data Final</label>
          <input
            id="report-filter-end-date"
            type="date"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <div className="form-group">
          <label htmlFor="report-filter-prize">Status do Brinde</label>
          <select
            id="report-filter-prize"
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

        <div className="form-group">
          <label htmlFor="report-filter-score">Pontuação Exata</label>
          <input
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

        <div className="form-group">
          <label htmlFor="report-page-size">Itens por página</label>
          <select
            id="report-page-size"
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
            <option value={50}>50</option>
          </select>
        </div>

        <div className="reports-filter-checkbox-wrap">
          <label className="admin-checkbox-label">
            <input
              type="checkbox"
              checked={onlyLockedOut}
              onChange={(e) => {
                setOnlyLockedOut(e.target.checked);
                setPage(1);
              }}
            />
            Somente bloqueados por desistência
          </label>
          <button type="button" className="admin-btn admin-btn-secondary" onClick={resetFilters}>
            Limpar Filtros
          </button>
        </div>
      </div>

      {report.activeLockouts.length > 0 && (
        <div className="operator-lockouts-box" aria-label="Bloqueios por Desistência Ativos">
          <h4>Bloqueios por Desistência Ativos ({report.activeLockouts.length})</h4>
          <div className="operator-cards-list">
            {report.activeLockouts.map((lockout) => (
              <div key={lockout.id} className="operator-mobile-card">
                <div>
                  <strong>{lockout.participantPhone}</strong> · {lockout.eventName}
                  <div className="operator-card-meta">
                    Expira em {formatDateTimePtBr(lockout.expiresAt)}
                  </div>
                </div>
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={() =>
                    void handleUnlockSingleLockout(lockout.eventId, lockout.participantPhone)
                  }
                >
                  Destravar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedMatchIds.size > 0 && (
        <div className="admin-batch-toolbar" role="region" aria-label="Ações em lote nos relatórios">
          <span>
            <strong>{selectedMatchIds.size}</strong> Partida(s) selecionada(s)
          </span>
          <div className="admin-panel-actions">
            <button
              type="button"
              className="admin-btn admin-btn-primary"
              onClick={() => void handleConfirmBatchDelivery()}
            >
              Confirmar Entrega
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-secondary"
              onClick={() => void handleRevokeBatchPrizes()}
            >
              Despremiar
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-secondary"
              onClick={() => void handleUnlockBatchPhones()}
            >
              Destravar
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-danger"
              onClick={() => void handleDeleteBatchMatches()}
            >
              Excluir
            </button>
          </div>
        </div>
      )}

      <div className="reports-table-wrapper">
        <table className="reports-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Selecionar todas as Partidas visíveis"
                  checked={allVisibleSelected}
                  onChange={(e) => handleToggleSelectAll(e.target.checked)}
                />
              </th>
              <th>
                <button
                  type="button"
                  className="table-sort-btn"
                  onClick={() => toggleSort('participantName')}
                >
                  Participante{renderSortIndicator('participantName')}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="table-sort-btn"
                  onClick={() => toggleSort('participantPhone')}
                >
                  Telefone{renderSortIndicator('participantPhone')}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="table-sort-btn"
                  onClick={() => toggleSort('eventName')}
                >
                  Evento{renderSortIndicator('eventName')}
                </button>
              </th>
              <th>
                <button type="button" className="table-sort-btn" onClick={() => toggleSort('score')}>
                  Pontuação{renderSortIndicator('score')}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="table-sort-btn"
                  onClick={() => toggleSort('timeSeconds')}
                >
                  Tempo{renderSortIndicator('timeSeconds')}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="table-sort-btn"
                  onClick={() => toggleSort('playedAt')}
                >
                  Data/Hora{renderSortIndicator('playedAt')}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="table-sort-btn"
                  onClick={() => toggleSort('prizeStatus')}
                >
                  Brinde / Status{renderSortIndicator('prizeStatus')}
                </button>
              </th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {report.items.length === 0 ? (
              <tr>
                <td colSpan={9} className="reports-empty-cell">
                  {loading
                    ? 'Carregando Partidas...'
                    : 'Nenhuma Partida encontrada para os filtros selecionados.'}
                </td>
              </tr>
            ) : (
              report.items.map((item) => (
                <tr key={item.matchId}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Selecionar Partida de ${item.participantName}`}
                      checked={selectedMatchIds.has(item.matchId)}
                      onChange={(e) => handleToggleRow(item.matchId, e.target.checked)}
                    />
                  </td>
                  <td>
                    <strong>{item.participantName}</strong>
                    <div className="operator-card-meta">Ranking #{item.rankingPosition}</div>
                  </td>
                  <td>{item.participantPhone}</td>
                  <td>{item.eventName}</td>
                  <td>
                    {item.score}/{item.totalQuestions}
                  </td>
                  <td>{formatTimeMMSS(item.timeSeconds)}</td>
                  <td>{formatDateTimePtBr(item.playedAt)}</td>
                  <td>
                    <div className="reports-badges-cell">
                      <ParticipantStatusBadges
                        prizeStatus={item.prizeStatus}
                        hasOfflineConflict={item.hasOfflineConflict}
                        hasActiveGiveUpLockout={item.hasActiveGiveUpLockout}
                        showEmptyPrizeBadge
                      />
                    </div>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="admin-btn admin-btn-secondary"
                      onClick={() => void handleOpenDetails(item.matchId)}
                    >
                      Ver Detalhes
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="admin-pagination">
        <button
          type="button"
          className="admin-btn admin-btn-secondary"
          disabled={report.page <= 1}
          onClick={() => setPage((prev) => Math.max(1, prev - 1))}
        >
          Anterior
        </button>
        <span>
          Página {report.page} de {report.totalPages} ({report.totalItems} Partida(s))
        </span>
        <button
          type="button"
          className="admin-btn admin-btn-secondary"
          disabled={report.page >= report.totalPages}
          onClick={() => setPage((prev) => Math.min(report.totalPages, prev + 1))}
        >
          Próxima
        </button>
      </div>

      {detailsModal && (
        <div
          id="participant-details-modal"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="participant-details-title"
        >
          <div className="modal-content admin-modal participant-details-modal-content">
            <h3 id="participant-details-title" className="modal-title">
              Detalhes da Partida · {detailsModal.participantName}
            </h3>
            <dl className="totem-diagnostics-list">
              <div>
                <dt>Telefone</dt>
                <dd>{detailsModal.participantPhone}</dd>
              </div>
              <div>
                <dt>Evento</dt>
                <dd>{detailsModal.eventName}</dd>
              </div>
              <div>
                <dt>Data/Hora</dt>
                <dd>{formatDateTimePtBr(detailsModal.playedAt)}</dd>
              </div>
              <div>
                <dt>Pontuação</dt>
                <dd>
                  {detailsModal.score}/{detailsModal.totalQuestions}
                </dd>
              </div>
              <div>
                <dt>Tempo</dt>
                <dd>{formatTimeMMSS(detailsModal.timeSeconds)}</dd>
              </div>
              <div>
                <dt>Colocação no Ranking na ocasião</dt>
                <dd>#{detailsModal.rankingPosition}</dd>
              </div>
              <div>
                <dt>Partidas do telefone no Evento</dt>
                <dd>{detailsModal.totalMatchesByPhoneInEvent}</dd>
              </div>
              <div>
                <dt>Status do Brinde</dt>
                <dd>
                  {detailsModal.prizeStatus
                    ? PRIZE_STATUS_LABELS[detailsModal.prizeStatus]
                    : 'Sem Brinde'}
                </dd>
              </div>
            </dl>

            <h4>Respostas da Partida ({detailsModal.answers.length})</h4>
            <div className="participant-answers-list">
              {detailsModal.answers.map((answer, idx) => (
                <div
                  key={`${answer.questionId}-${idx}`}
                  className={`participant-answer-card ${answer.isCorrect ? 'is-correct' : 'is-wrong'}`}
                >
                  <div className="participant-answer-header">
                    <strong>
                      {idx + 1}. {answer.questionText}
                    </strong>
                    <span className={`admin-badge ${answer.isCorrect ? 'active' : 'closed'}`}>
                      {answer.isCorrect ? 'Correta' : 'Incorreta'}
                    </span>
                  </div>
                  <div className="operator-card-meta">
                    Resposta do Participante: {answer.selectedOptionText || 'Tempo esgotado'} ·
                    Alternativa correta: {answer.correctOptionText}
                  </div>
                </div>
              ))}
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="admin-btn admin-btn-primary"
                onClick={() => setDetailsModal(null)}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
