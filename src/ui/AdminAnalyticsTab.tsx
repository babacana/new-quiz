import { useCallback, useEffect, useState } from 'react';
import type { EventAdminController } from '../domain/eventAdminController';
import type {
  AnalyticsDashboardResult,
  AnalyticsPeriodPreset,
  AnalyticsQuestionStatItem,
  EventConfig,
  Question,
  QuestionAnalysisMetric,
} from '../domain/types';
import { DIFFICULTY_LABELS, formatTimeMMSS } from './formatters';

export interface AdminAnalyticsTabProps {
  controller: EventAdminController;
  events: EventConfig[];
  allQuestions: Question[];
  onQuestionsChanged: () => Promise<void>;
  onStatusMessage: (type: 'success' | 'error', message: string) => void;
}

const PERIOD_OPTIONS: Array<{ value: AnalyticsPeriodPreset; label: string }> = [
  { value: 'all', label: 'Todo o período' },
  { value: 'today', label: 'Hoje' },
  { value: 'last_3_days', label: 'Últimos 3 dias' },
  { value: 'last_7_days', label: 'Últimos 7 dias' },
  { value: 'last_30_days', label: 'Últimos 30 dias' },
  { value: 'custom', label: 'Personalizado' },
];

const METRIC_OPTIONS: Array<{ value: QuestionAnalysisMetric; label: string }> = [
  { value: 'difficulty', label: 'Mais Difíceis' },
  { value: 'easiness', label: 'Mais Fáceis' },
  { value: 'most_answered', label: 'Mais Respondidas' },
  { value: 'least_answered', label: 'Menos Respondidas' },
];

function InteractiveBarChart({
  title,
  bars,
  color,
  onInspect,
}: {
  title: string;
  bars: Array<{ label: string; count: number }>;
  color: string;
  onInspect: (summary: string) => void;
}) {
  const maxVal = Math.max(1, ...bars.map((b) => b.count));
  const width = Math.max(320, bars.length * 24);
  const height = 140;
  const barWidth = Math.max(10, Math.floor((width - 20) / Math.max(1, bars.length)) - 4);

  return (
    <div className="analytics-chart-card">
      <h4>{title}</h4>
      {bars.every((b) => b.count === 0) ? (
        <p className="admin-empty-hint">Sem dados para exibir neste filtro.</p>
      ) : (
        <svg
          className="analytics-svg-chart"
          viewBox={`0 0 ${width} ${height + 24}`}
          role="img"
          aria-label={title}
        >
          {bars.map((bar, idx) => {
            const barHeight = Math.round((bar.count / maxVal) * (height - 16));
            const x = 10 + idx * (barWidth + 4);
            const y = height - barHeight;
            return (
              <g
                key={bar.label}
                className="analytics-chart-bar-group"
                onClick={() => onInspect(`${title}: ${bar.label} → ${bar.count} participação(ões)`)}
              >
                <title>{`${bar.label}: ${bar.count}`}</title>
                <rect x={x} y={y} width={barWidth} height={Math.max(2, barHeight)} fill={color} rx={3} />
                {(bars.length <= 12 || idx % 3 === 0) && (
                  <text x={x + barWidth / 2} y={height + 15} textAnchor="middle" fontSize="10" fill="#cbd5e1">
                    {bar.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

// Aba do Dashboard Analítico com KPIs, gráficos interativos e análise de questões.
export function AdminAnalyticsTab({
  controller,
  events,
  allQuestions,
  onQuestionsChanged,
  onStatusMessage,
}: AdminAnalyticsTabProps) {
  const [eventId, setEventId] = useState('all');
  const [period, setPeriod] = useState<AnalyticsPeriodPreset>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [questionMetric, setQuestionMetric] = useState<QuestionAnalysisMetric>('difficulty');
  const [questionPage, setQuestionPage] = useState(1);
  const [chartInspectText, setChartInspectText] = useState<string | null>(null);
  const [selectedQuestionStat, setSelectedQuestionStat] =
    useState<AnalyticsQuestionStatItem | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);

  const [dashboard, setDashboard] = useState<AnalyticsDashboardResult>({
    kpis: {
      totalParticipations: 0,
      averageScore: 0,
      averageTimeSeconds: 0,
      successRatePercent: 0,
    },
    participationsOverTime: [],
    scoreDistribution: [],
    hourlyEngagement: [],
    questionAnalysis: { items: [], totalItems: 0, page: 1, pageSize: 10, totalPages: 1 },
  });

  const loadAnalytics = useCallback(async () => {
    try {
      const next = await controller.queryAnalyticsDashboard({
        eventId: eventId === 'all' ? undefined : eventId,
        period,
        startDate: period === 'custom' ? startDate : undefined,
        endDate: period === 'custom' ? endDate : undefined,
        questionMetric,
        questionPage,
        questionPageSize: 10,
      });
      setDashboard(next);
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao carregar Dashboard Analítico.',
      );
    }
  }, [controller, eventId, period, startDate, endDate, questionMetric, questionPage, onStatusMessage]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const selectedFullQuestion = selectedQuestionStat
    ? allQuestions.find((q) => q.id === selectedQuestionStat.questionId) ?? null
    : null;

  const handleToggleQuestionDisabled = async (questionId: number, currentDisabled: boolean) => {
    try {
      await controller.setQuestionsDisabled([questionId], !currentDisabled);
      onStatusMessage(
        'success',
        `Questão #${questionId} ${!currentDisabled ? 'desabilitada' : 'habilitada'}.`,
      );
      await onQuestionsChanged();
      await loadAnalytics();
      setSelectedQuestionStat((prev) =>
        prev && prev.questionId === questionId ? { ...prev, isDisabled: !currentDisabled } : prev,
      );
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao atualizar status da questão.',
      );
    }
  };

  const handleSaveInlineQuestionEdit = async () => {
    if (!editingQuestion) {
      return;
    }
    try {
      const saved = await controller.updateQuestion(editingQuestion.id, editingQuestion);
      onStatusMessage('success', `Questão #${saved.id} atualizada com sucesso.`);
      setEditingQuestion(null);
      setSelectedQuestionStat((prev) =>
        prev && prev.questionId === saved.id
          ? {
              ...prev,
              text: saved.text,
              difficulty: saved.difficulty,
              isDisabled: saved.isDisabled,
            }
          : prev,
      );
      await onQuestionsChanged();
      await loadAnalytics();
    } catch (error) {
      onStatusMessage(
        'error',
        error instanceof Error ? error.message : 'Erro ao salvar edição da questão.',
      );
    }
  };

  return (
    <section id="admin-analytics-tab" className="admin-panel-card">
      <div className="admin-panel-header">
        <div>
          <h3>Dashboard Analítico</h3>
          <p className="admin-subtitle">
            Indicadores de desempenho, engajamento por horário e análise de dificuldade das questões.
          </p>
        </div>
        <button
          type="button"
          className="admin-btn admin-btn-secondary"
          onClick={() => void loadAnalytics()}
        >
          Atualizar Dados
        </button>
      </div>

      <div className="reports-filters-grid">
        <div className="form-group">
          <label htmlFor="analytics-event-filter">Evento</label>
          <select
            id="analytics-event-filter"
            value={eventId}
            onChange={(e) => {
              setEventId(e.target.value);
              setQuestionPage(1);
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
          <label htmlFor="analytics-period-filter">Período</label>
          <select
            id="analytics-period-filter"
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value as AnalyticsPeriodPreset);
              setQuestionPage(1);
            }}
          >
            {PERIOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {period === 'custom' && (
          <>
            <div className="form-group">
              <label htmlFor="analytics-start-date">Data Inicial</label>
              <input
                id="analytics-start-date"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setQuestionPage(1);
                }}
              />
            </div>
            <div className="form-group">
              <label htmlFor="analytics-end-date">Data Final</label>
              <input
                id="analytics-end-date"
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setQuestionPage(1);
                }}
              />
            </div>
          </>
        )}
      </div>

      <div className="analytics-kpi-grid">
        <div className="operator-metric-pill">
          <span>Total de Participações</span>
          <strong>{dashboard.kpis.totalParticipations}</strong>
        </div>
        <div className="operator-metric-pill">
          <span>Média de Pontuação</span>
          <strong>{dashboard.kpis.averageScore.toFixed(2)}</strong>
        </div>
        <div className="operator-metric-pill">
          <span>Tempo Médio</span>
          <strong>{formatTimeMMSS(Math.round(dashboard.kpis.averageTimeSeconds))}</strong>
        </div>
        <div className="operator-metric-pill">
          <span>Taxa de Sucesso (Brinde)</span>
          <strong>{dashboard.kpis.successRatePercent.toFixed(1)}%</strong>
        </div>
      </div>

      {chartInspectText && (
        <p className="admin-alert admin-alert-success" role="status">
          {chartInspectText}
        </p>
      )}

      <div className="analytics-charts-grid">
        <InteractiveBarChart
          title="Participações ao Longo do Tempo"
          bars={dashboard.participationsOverTime.map((item) => ({
            label: item.date.slice(5),
            count: item.count,
          }))}
          color="#38bdf8"
          onInspect={setChartInspectText}
        />

        <InteractiveBarChart
          title="Distribuição de Pontuações"
          bars={dashboard.scoreDistribution.map((item) => ({
            label: `${item.score}pt`,
            count: item.count,
          }))}
          color="#a78bfa"
          onInspect={setChartInspectText}
        />

        <InteractiveBarChart
          title="Engajamento por Hora do Dia"
          bars={dashboard.hourlyEngagement.map((item) => ({
            label: `${String(item.hour).padStart(2, '0')}h`,
            count: item.count,
          }))}
          color="#fb923c"
          onInspect={setChartInspectText}
        />
      </div>

      <div className="analytics-question-analysis-header">
        <h4>Análise de Questões</h4>
        <label className="operator-event-select-label">
          <span>Ordenar por</span>
          <select
            aria-label="Métrica de Análise de Questões"
            value={questionMetric}
            onChange={(e) => {
              setQuestionMetric(e.target.value as QuestionAnalysisMetric);
              setQuestionPage(1);
            }}
          >
            {METRIC_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="reports-table-wrapper">
        <table className="reports-table">
          <thead>
            <tr>
              <th>Questão</th>
              <th>Total Respostas</th>
              <th>Acertos</th>
              <th>% Acerto</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {dashboard.questionAnalysis.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="reports-empty-cell">
                  Sem questões cadastradas para analisar.
                </td>
              </tr>
            ) : (
              dashboard.questionAnalysis.items.map((item) => (
                <tr
                  key={item.questionId}
                  className="analytics-clickable-row"
                  onClick={() => {
                    setEditingQuestion(null);
                    setSelectedQuestionStat(item);
                  }}
                >
                  <td>
                    <strong>#{item.questionId}</strong> · {item.text}
                  </td>
                  <td>{item.totalAnswers}</td>
                  <td>{item.correctAnswers}</td>
                  <td>{item.accuracyPercent.toFixed(1)}%</td>
                  <td>
                    <span className={`admin-badge ${item.isDisabled ? 'closed' : 'active'}`}>
                      {item.isDisabled ? 'Desabilitada' : 'Ativa'}
                    </span>
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
          disabled={dashboard.questionAnalysis.page <= 1}
          onClick={() => setQuestionPage((p) => Math.max(1, p - 1))}
        >
          Anterior
        </button>
        <span>
          Página {dashboard.questionAnalysis.page} de {dashboard.questionAnalysis.totalPages} (
          {dashboard.questionAnalysis.totalItems} questões)
        </span>
        <button
          type="button"
          className="admin-btn admin-btn-secondary"
          disabled={dashboard.questionAnalysis.page >= dashboard.questionAnalysis.totalPages}
          onClick={() =>
            setQuestionPage((p) => Math.min(dashboard.questionAnalysis.totalPages, p + 1))
          }
        >
          Próxima
        </button>
      </div>

      {selectedQuestionStat && (
        <div
          id="analytics-question-modal"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="analytics-question-modal-title"
        >
          <div className="modal-content admin-modal">
            <h3 id="analytics-question-modal-title" className="modal-title">
              Detalhes da Questão #{selectedQuestionStat.questionId}
            </h3>
            {editingQuestion ? (
              <div className="analytics-inline-edit-form">
                <div className="form-group">
                  <label htmlFor="analytics-edit-q-text">Enunciado da Questão</label>
                  <input
                    id="analytics-edit-q-text"
                    type="text"
                    value={editingQuestion.text}
                    onChange={(e) =>
                      setEditingQuestion({ ...editingQuestion, text: e.target.value })
                    }
                  />
                </div>
                <div className="customization-fields-grid">
                  {editingQuestion.options.map((opt, idx) => (
                    <div key={idx} className="form-group">
                      <label htmlFor={`analytics-edit-opt-${idx}`}>
                        Alternativa {String.fromCharCode(65 + idx)}
                      </label>
                      <input
                        id={`analytics-edit-opt-${idx}`}
                        type="text"
                        value={opt}
                        onChange={(e) => {
                          const nextOptions: [string, string, string, string] = [
                            ...editingQuestion.options,
                          ];
                          nextOptions[idx] = e.target.value;
                          setEditingQuestion({ ...editingQuestion, options: nextOptions });
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className="customization-fields-grid">
                  <div className="form-group">
                    <label htmlFor="analytics-edit-correct">Alternativa Correta</label>
                    <select
                      id="analytics-edit-correct"
                      value={editingQuestion.correctIndex}
                      onChange={(e) =>
                        setEditingQuestion({
                          ...editingQuestion,
                          correctIndex: Number(e.target.value),
                        })
                      }
                    >
                      {[0, 1, 2, 3].map((idx) => (
                        <option key={idx} value={idx}>
                          {String.fromCharCode(65 + idx)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="analytics-edit-diff">Dificuldade</label>
                    <select
                      id="analytics-edit-diff"
                      value={editingQuestion.difficulty}
                      onChange={(e) =>
                        setEditingQuestion({
                          ...editingQuestion,
                          difficulty: e.target.value as Question['difficulty'],
                        })
                      }
                    >
                      <option value="facil">Fácil</option>
                      <option value="moderado">Moderado</option>
                      <option value="dificil">Difícil</option>
                    </select>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <p>{selectedQuestionStat.text}</p>
                <p className="operator-card-meta">
                  Dificuldade: {DIFFICULTY_LABELS[selectedQuestionStat.difficulty]} · Respostas:{' '}
                  {selectedQuestionStat.totalAnswers} · Acertos:{' '}
                  {selectedQuestionStat.correctAnswers} (
                  {selectedQuestionStat.accuracyPercent.toFixed(1)}%)
                </p>
                {selectedFullQuestion && (
                  <div className="admin-preview-options">
                    {selectedFullQuestion.options.map((opt, idx) => (
                      <div
                        key={opt}
                        className={`admin-preview-option ${
                          idx === selectedFullQuestion.correctIndex ? 'is-correct' : ''
                        }`}
                      >
                        <span>
                          {String.fromCharCode(65 + idx)}) {opt}
                        </span>
                        {idx === selectedFullQuestion.correctIndex && <strong>Correta</strong>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            <div className="modal-actions">
              {editingQuestion ? (
                <>
                  <button
                    type="button"
                    className="admin-btn admin-btn-primary"
                    onClick={() => void handleSaveInlineQuestionEdit()}
                  >
                    Salvar Edição
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn-secondary"
                    onClick={() => setEditingQuestion(null)}
                  >
                    Cancelar Edição
                  </button>
                </>
              ) : (
                <>
                  {selectedFullQuestion && (
                    <button
                      type="button"
                      className="admin-btn admin-btn-secondary"
                      onClick={() => setEditingQuestion(structuredClone(selectedFullQuestion))}
                    >
                      Editar Questão
                    </button>
                  )}
                  <button
                    type="button"
                    className="admin-btn admin-btn-secondary"
                    onClick={() =>
                      void handleToggleQuestionDisabled(
                        selectedQuestionStat.questionId,
                        selectedQuestionStat.isDisabled,
                      )
                    }
                  >
                    {selectedQuestionStat.isDisabled ? 'Habilitar Questão' : 'Desabilitar Questão'}
                  </button>
                </>
              )}
              <button
                type="button"
                className="admin-btn admin-btn-primary"
                onClick={() => {
                  setEditingQuestion(null);
                  setSelectedQuestionStat(null);
                }}
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
