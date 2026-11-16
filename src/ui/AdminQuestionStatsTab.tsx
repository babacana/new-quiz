import { useCallback, useEffect, useState } from 'react';
import type { EventAdminController } from '../domain/eventAdminController';
import type {
  EventConfig,
  QuestionStatsResult,
  QuestionStatsSortField,
  SortDirection,
} from '../domain/types';

export interface AdminQuestionStatsTabProps {
  controller: EventAdminController;
  events: EventConfig[];
  onQuestionsChanged: () => Promise<void>;
  onStatusMessage: (type: 'success' | 'error', message: string) => void;
}

// Aba administrativa de Estatísticas de Questões com ordenação, paginação e controle rápido de ativação.
export function AdminQuestionStatsTab({
  controller,
  events,
  onQuestionsChanged,
  onStatusMessage,
}: AdminQuestionStatsTabProps) {
  const [eventId, setEventId] = useState('all');
  const [sortBy, setSortBy] = useState<QuestionStatsSortField>('text');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [page, setPage] = useState(1);

  const [stats, setStats] = useState<QuestionStatsResult>({
    overallAverageScore: 0,
    totalParticipations: 0,
    items: [],
    totalItems: 0,
    page: 1,
    pageSize: 10,
    totalPages: 1,
  });

  const loadStats = useCallback(async () => {
    try {
      const next = await controller.queryQuestionStats({
        eventId: eventId === 'all' ? undefined : eventId,
        sortBy,
        sortDirection,
        page,
        pageSize: 10,
      });
      setStats(next);
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao carregar estatísticas de questões.',
      );
    }
  }, [controller, eventId, sortBy, sortDirection, page, onStatusMessage]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const toggleSort = (field: QuestionStatsSortField) => {
    setPage(1);
    if (sortBy === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDirection(field === 'text' || field === 'id' ? 'asc' : 'desc');
    }
  };

  const renderSortArrow = (field: QuestionStatsSortField): string =>
    sortBy === field ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : '';

  const handleToggleDisabled = async (questionId: number, currentDisabled: boolean) => {
    try {
      await controller.setQuestionsDisabled([questionId], !currentDisabled);
      onStatusMessage(
        'success',
        `Questão #${questionId} ${!currentDisabled ? 'desabilitada' : 'habilitada'} com sucesso.`,
      );
      await onQuestionsChanged();
      await loadStats();
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao alterar status da questão.',
      );
    }
  };

  return (
    <section id="admin-question-stats-tab" className="admin-panel-card">
      <div className="admin-panel-header">
        <div>
          <h3>Estatísticas de Questões</h3>
          <p className="admin-subtitle">
            Desempenho consolidado por questão com habilitação e desabilitação direta.
          </p>
        </div>

        <label className="operator-event-select-label">
          <span>Filtrar por Evento</span>
          <select
            aria-label="Evento nas Estatísticas"
            value={eventId}
            onChange={(e) => {
              setEventId(e.target.value);
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
        </label>
      </div>

      <div className="operator-metrics-bar">
        <div className="operator-metric-pill">
          <span>Média Geral de Acertos</span>
          <strong>{stats.overallAverageScore.toFixed(2)}</strong>
        </div>
        <div className="operator-metric-pill">
          <span>Total de Participações</span>
          <strong>{stats.totalParticipations}</strong>
        </div>
      </div>

      <div className="reports-table-wrapper">
        <table className="reports-table">
          <thead>
            <tr>
              <th>
                <button type="button" className="table-sort-btn" onClick={() => toggleSort('id')}>
                  ID{renderSortArrow('id')}
                </button>
              </th>
              <th>
                <button type="button" className="table-sort-btn" onClick={() => toggleSort('text')}>
                  Questão{renderSortArrow('text')}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="table-sort-btn"
                  onClick={() => toggleSort('totalAnswers')}
                >
                  Total Respostas{renderSortArrow('totalAnswers')}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="table-sort-btn"
                  onClick={() => toggleSort('correctAnswers')}
                >
                  Acertos{renderSortArrow('correctAnswers')}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="table-sort-btn"
                  onClick={() => toggleSort('incorrectAnswers')}
                >
                  Erros{renderSortArrow('incorrectAnswers')}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="table-sort-btn"
                  onClick={() => toggleSort('accuracyPercent')}
                >
                  % Acerto{renderSortArrow('accuracyPercent')}
                </button>
              </th>
              <th>Status</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {stats.items.length === 0 ? (
              <tr>
                <td colSpan={8} className="reports-empty-cell">
                  Nenhuma questão cadastrada para exibir estatísticas.
                </td>
              </tr>
            ) : (
              stats.items.map((item) => (
                <tr key={item.questionId}>
                  <td>#{item.questionId}</td>
                  <td>{item.text}</td>
                  <td>{item.totalAnswers}</td>
                  <td>{item.correctAnswers}</td>
                  <td>{item.incorrectAnswers}</td>
                  <td>{item.accuracyPercent.toFixed(1)}%</td>
                  <td>
                    <span className={`admin-badge ${item.isDisabled ? 'closed' : 'active'}`}>
                      {item.isDisabled ? 'Desabilitada' : 'Ativa'}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="admin-btn admin-btn-secondary"
                      onClick={() => void handleToggleDisabled(item.questionId, item.isDisabled)}
                    >
                      {item.isDisabled ? 'Habilitar' : 'Desabilitar'}
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
          disabled={stats.page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Anterior
        </button>
        <span>
          Página {stats.page} de {stats.totalPages} ({stats.totalItems} questões)
        </span>
        <button
          type="button"
          className="admin-btn admin-btn-secondary"
          disabled={stats.page >= stats.totalPages}
          onClick={() => setPage((p) => Math.min(stats.totalPages, p + 1))}
        >
          Próxima
        </button>
      </div>
    </section>
  );
}
