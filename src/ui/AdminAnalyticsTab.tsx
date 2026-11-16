import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  Clock,
  Pencil,
  RefreshCw,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { EventAdminController } from '../domain/eventAdminController';
import type {
  AnalyticsDashboardResult,
  AnalyticsPeriodPreset,
  AnalyticsQuestionStatItem,
  EventConfig,
  Question,
  QuestionAnalysisMetric,
} from '../domain/types';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
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
import { DIFFICULTY_LABELS, formatTimeMMSS } from './formatters';
import { cn } from './lib/utils';

export interface AdminAnalyticsTabProps {
  controller: EventAdminController;
  events: EventConfig[];
  selectedEventId?: string | null;
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

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function ResponsiveBarChart({
  title,
  bars,
  barColorClass,
}: {
  title: string;
  bars: Array<{ label: string; count: number }>;
  barColorClass: string;
}) {
  const [activeBarIndex, setActiveBarIndex] = useState<number | null>(null);
  const maxVal = Math.max(1, ...bars.map((b) => b.count));
  const activeBar = activeBarIndex !== null ? bars[activeBarIndex] ?? null : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            {title}
          </CardTitle>
          {activeBar && (
            <span
              data-testid="chart-tooltip"
              role="status"
              className="rounded-md bg-popover px-2 py-0.5 text-xs font-medium text-popover-foreground shadow-sm ring-1 ring-border"
            >
              {activeBar.label}: {activeBar.count} participação(ões)
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {bars.every((b) => b.count === 0) ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sem dados para exibir neste filtro.
          </p>
        ) : (
          <div
            role="img"
            aria-label={title}
            className="flex h-44 w-full items-end gap-1.5 overflow-x-auto pt-4"
            onMouseLeave={() => setActiveBarIndex(null)}
          >
            {bars.map((bar, idx) => {
              const heightPercent = Math.max(4, Math.round((bar.count / maxVal) * 100));
              const isActive = activeBarIndex === idx;
              return (
                <button
                  key={bar.label}
                  data-testid="analytics-chart-bar"
                  type="button"
                  aria-label={`${bar.label}: ${bar.count}`}
                  onMouseEnter={() => setActiveBarIndex(idx)}
                  onFocus={() => setActiveBarIndex(idx)}
                  onClick={() => setActiveBarIndex((prev) => (prev === idx ? null : idx))}
                  className="group flex h-full min-w-[20px] flex-1 cursor-pointer flex-col items-center justify-end gap-1 focus:outline-none"
                >
                  <div className="flex w-full flex-1 items-end">
                    <div
                      style={{ height: `${heightPercent}%` }}
                      className={cn(
                        'w-full rounded-t-sm transition-all',
                        barColorClass,
                        isActive ? 'opacity-100 ring-2 ring-ring' : 'opacity-85 hover:opacity-100',
                      )}
                    />
                  </div>
                  {(bars.length <= 12 || idx % 3 === 0) && (
                    <span className="max-w-full truncate text-[10px] text-muted-foreground">
                      {bar.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Aba unificada de Análises & Questões: KPIs, gráficos responsivos com tooltip e acurácia por questão com toggle rápido.
export function AdminAnalyticsTab({
  controller,
  events,
  selectedEventId,
  allQuestions,
  onQuestionsChanged,
  onStatusMessage,
}: AdminAnalyticsTabProps) {
  const [eventId, setEventId] = useState(() => selectedEventId ?? 'all');

  useEffect(() => {
    if (selectedEventId) {
      setEventId(selectedEventId);
      setQuestionPage(1);
    }
  }, [selectedEventId]);
  const [period, setPeriod] = useState<AnalyticsPeriodPreset>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [questionMetric, setQuestionMetric] = useState<QuestionAnalysisMetric>('difficulty');
  const [questionPage, setQuestionPage] = useState(1);
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
        error instanceof Error ? error.message : 'Erro ao carregar Análises & Questões.',
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

  const renderQuestionStatusBadge = (isDisabled: boolean) => (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        isDisabled
          ? 'bg-muted text-muted-foreground'
          : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
      )}
    >
      {isDisabled ? 'Desabilitada' : 'Ativa'}
    </span>
  );

  return (
    <div id="admin-analytics-tab" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Análises &amp; Questões</h1>
          <p className="text-sm text-muted-foreground">
            Indicadores de desempenho, engajamento por horário e acurácia por questão com controle
            rápido.
          </p>
        </div>

        <Button type="button" variant="outline" size="sm" onClick={() => void loadAnalytics()}>
          <RefreshCw className="h-4 w-4" />
          Atualizar Dados
        </Button>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="analytics-event-filter">Evento</Label>
              <select
                id="analytics-event-filter"
                className={SELECT_CLASS}
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

            <div className="space-y-1.5">
              <Label htmlFor="analytics-period-filter">Período</Label>
              <select
                id="analytics-period-filter"
                className={SELECT_CLASS}
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
                <div className="space-y-1.5">
                  <Label htmlFor="analytics-start-date">Data Inicial</Label>
                  <Input
                    id="analytics-start-date"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="analytics-end-date">Data Final</Label>
                  <Input
                    id="analytics-end-date"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="analytics-question-metric">Ranking de Questões</Label>
              <select
                id="analytics-question-metric"
                className={SELECT_CLASS}
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
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div data-testid="analytics-kpis" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">
              Total de Participações
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard.kpis.totalParticipations}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">
              Média de Pontos
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard.kpis.averageScore}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">
              Tempo Médio
            </CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatTimeMMSS(dashboard.kpis.averageTimeSeconds)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">
              Taxa de Acerto
            </CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard.kpis.successRatePercent}%</div>
          </CardContent>
        </Card>
      </div>

      {/* Gráficos Responsivos */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ResponsiveBarChart
          title="Participações ao Longo do Tempo"
          bars={dashboard.participationsOverTime.map((p) => ({
            label: p.date.slice(5),
            count: p.count,
          }))}
          barColorClass="bg-sky-500"
        />

        <ResponsiveBarChart
          title="Distribuição de Pontuações"
          bars={dashboard.scoreDistribution.map((s) => ({
            label: `${s.score} pts`,
            count: s.count,
          }))}
          barColorClass="bg-emerald-500"
        />

        <div className="lg:col-span-2">
          <ResponsiveBarChart
            title="Engajamento por Hora do Dia"
            bars={dashboard.hourlyEngagement.map((h) => ({
              label: `${String(h.hour).padStart(2, '0')}h`,
              count: h.count,
            }))}
            barColorClass="bg-amber-500"
          />
        </div>
      </div>

      {/* Seção Unificada de Acurácia por Questão */}
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">
            Acurácia e Desempenho por Questão ({dashboard.questionAnalysis.totalItems})
          </h2>
          <p className="text-sm text-muted-foreground">
            Clique em uma questão para inspecionar e editar ou use o toggle rápido para
            habilitar/desabilitar.
          </p>
        </div>

        {/* Tabela Desktop (md+) */}
        <Card data-testid="analytics-questions-desktop-table" className="hidden md:block">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground uppercase">
                    <th className="px-4 py-3">Questão</th>
                    <th className="px-4 py-3">Dificuldade</th>
                    <th className="px-4 py-3">Respostas</th>
                    <th className="px-4 py-3">Taxa de Acerto</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {dashboard.questionAnalysis.items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        Nenhuma questão analisada para os filtros atuais.
                      </td>
                    </tr>
                  ) : (
                    dashboard.questionAnalysis.items.map((item) => (
                      <tr key={item.questionId} className="transition-colors hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            className="cursor-pointer text-left font-medium hover:underline"
                            onClick={() => {
                              setSelectedQuestionStat(item);
                              setEditingQuestion(null);
                            }}
                          >
                            <span className="mr-1 text-muted-foreground">#{item.questionId}</span>
                            {item.text}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-xs">{DIFFICULTY_LABELS[item.difficulty]}</td>
                        <td className="px-4 py-3">{item.totalAnswers}</td>
                        <td className="px-4 py-3 font-medium">{item.accuracyPercent}%</td>
                        <td className="px-4 py-3">{renderQuestionStatusBadge(item.isDisabled)}</td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            type="button"
                            variant={item.isDisabled ? 'default' : 'outline'}
                            size="sm"
                            onClick={() =>
                              void handleToggleQuestionDisabled(item.questionId, item.isDisabled)
                            }
                          >
                            {item.isDisabled ? 'Habilitar' : 'Desabilitar'}
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

        {/* Cards Mobile (< md) */}
        <div data-testid="analytics-questions-mobile-cards" className="space-y-3 md:hidden">
          {dashboard.questionAnalysis.items.map((item) => (
            <Card key={item.questionId}>
              <CardContent className="space-y-2.5 pt-4">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    className="cursor-pointer text-left text-sm font-medium hover:underline"
                    onClick={() => {
                      setSelectedQuestionStat(item);
                      setEditingQuestion(null);
                    }}
                  >
                    #{item.questionId} {item.text}
                  </button>
                  {renderQuestionStatusBadge(item.isDisabled)}
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {DIFFICULTY_LABELS[item.difficulty]} · {item.totalAnswers} resp. ·{' '}
                    <strong>{item.accuracyPercent}%</strong> acerto
                  </span>
                  <Button
                    type="button"
                    variant={item.isDisabled ? 'default' : 'outline'}
                    size="sm"
                    onClick={() =>
                      void handleToggleQuestionDisabled(item.questionId, item.isDisabled)
                    }
                  >
                    {item.isDisabled ? 'Habilitar' : 'Desabilitar'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Paginação */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={dashboard.questionAnalysis.page <= 1}
            onClick={() => setQuestionPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </Button>
          <span className="text-xs text-muted-foreground">
            Página {dashboard.questionAnalysis.page} de {dashboard.questionAnalysis.totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={dashboard.questionAnalysis.page >= dashboard.questionAnalysis.totalPages}
            onClick={() =>
              setQuestionPage((p) => Math.min(dashboard.questionAnalysis.totalPages, p + 1))
            }
          >
            Próxima
          </Button>
        </div>
      </div>

      {/* Modal de Detalhes / Edição Rápida da Questão */}
      <Dialog
        open={Boolean(selectedQuestionStat)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedQuestionStat(null);
            setEditingQuestion(null);
          }
        }}
      >
        <DialogContent id="analytics-question-modal">
          <DialogHeader>
            <DialogTitle>Detalhes da Questão #{selectedQuestionStat?.questionId}</DialogTitle>
            <DialogDescription>
              Taxa de acerto: {selectedQuestionStat?.accuracyPercent}% (
              {selectedQuestionStat?.correctAnswers}/{selectedQuestionStat?.totalAnswers})
            </DialogDescription>
          </DialogHeader>

          {selectedQuestionStat && (
            <div className="space-y-4">
              {!editingQuestion ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium">{selectedQuestionStat.text}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedFullQuestion && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingQuestion(structuredClone(selectedFullQuestion))}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Editar Questão
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void handleToggleQuestionDisabled(
                          selectedQuestionStat.questionId,
                          selectedQuestionStat.isDisabled,
                        )
                      }
                    >
                      {selectedQuestionStat.isDisabled ? 'Habilitar' : 'Desabilitar'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="analytics-edit-question-text">Enunciado</Label>
                    <Input
                      id="analytics-edit-question-text"
                      type="text"
                      value={editingQuestion.text}
                      onChange={(e) =>
                        setEditingQuestion((prev) =>
                          prev ? { ...prev, text: e.target.value } : null,
                        )
                      }
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" size="sm" onClick={() => void handleSaveInlineQuestionEdit()}>
                      Salvar Edição
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingQuestion(null)}
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                setSelectedQuestionStat(null);
                setEditingQuestion(null);
              }}
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
