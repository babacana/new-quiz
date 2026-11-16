import type {
  AnalyticsDashboardResult,
  AnalyticsPeriodPreset,
  AnalyticsQueryOptions,
  AnalyticsQuestionStatItem,
  EventConfig,
  MatchRecord,
  Question,
  QuestionAnalysisMetric,
  QuestionStatsQueryOptions,
  QuestionStatsResult,
  QuestionStatsSortField,
  SortDirection,
} from './types';

function paginateItems<T>(
  items: readonly T[],
  rawPage?: number,
  rawPageSize?: number,
): {
  items: T[];
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
} {
  const pageSize = Math.max(1, Math.floor(rawPageSize ?? 10));
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(Math.max(1, Math.floor(rawPage ?? 1)), totalPages);
  const startIdx = (page - 1) * pageSize;

  return {
    items: items.slice(startIdx, startIdx + pageSize),
    totalItems,
    page,
    pageSize,
    totalPages,
  };
}

function parseDateBoundary(dateStr: string, bound: 'start' | 'end'): number | null {
  if (dateStr.includes('T')) {
    const parsed = Date.parse(dateStr);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) {
    const fallback = Date.parse(dateStr);
    return Number.isFinite(fallback) ? fallback : null;
  }
  const [, year, month, day] = match;
  return bound === 'start'
    ? new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0).getTime()
    : new Date(Number(year), Number(month) - 1, Number(day), 23, 59, 59, 999).getTime();
}

function resolvePeriodBounds(
  period: AnalyticsPeriodPreset,
  nowMs: number,
  startDate?: string,
  endDate?: string,
): { startMs: number | null; endMs: number | null } {
  if (period === 'all') {
    return { startMs: null, endMs: null };
  }
  if (period === 'custom') {
    return {
      startMs: startDate ? parseDateBoundary(startDate, 'start') : null,
      endMs: endDate ? parseDateBoundary(endDate, 'end') : null,
    };
  }

  const ref = new Date(nowMs);
  const endOfTodayMs = new Date(
    ref.getFullYear(),
    ref.getMonth(),
    ref.getDate(),
    23,
    59,
    59,
    999,
  ).getTime();

  const daysBack =
    period === 'today' ? 0 : period === 'last_3_days' ? 2 : period === 'last_7_days' ? 6 : 29;
  const startOfRange = new Date(
    ref.getFullYear(),
    ref.getMonth(),
    ref.getDate() - daysBack,
    0,
    0,
    0,
    0,
  ).getTime();

  return { startMs: startOfRange, endMs: endOfTodayMs };
}

function formatLocalDateKey(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString.slice(0, 10);
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function buildQuestionPerformanceStats(
  questions: readonly Question[],
  matches: readonly MatchRecord[],
): AnalyticsQuestionStatItem[] {
  const statsById = new Map<number, AnalyticsQuestionStatItem>();
  for (const question of questions) {
    statsById.set(question.id, {
      questionId: question.id,
      text: question.text,
      difficulty: question.difficulty,
      isDisabled: question.isDisabled,
      totalAnswers: 0,
      correctAnswers: 0,
      incorrectAnswers: 0,
      accuracyPercent: 0,
    });
  }

  for (const match of matches) {
    for (const answer of match.answers) {
      const entry = statsById.get(answer.questionId);
      if (!entry) {
        continue;
      }
      entry.totalAnswers += 1;
      if (answer.isCorrect) {
        entry.correctAnswers += 1;
      } else {
        entry.incorrectAnswers += 1;
      }
    }
  }

  return Array.from(statsById.values()).map((entry) => ({
    ...entry,
    accuracyPercent:
      entry.totalAnswers > 0
        ? Math.round((entry.correctAnswers / entry.totalAnswers) * 1000) / 10
        : 0,
  }));
}

function sortByQuestionAnalysisMetric(
  items: AnalyticsQuestionStatItem[],
  metric: QuestionAnalysisMetric,
): AnalyticsQuestionStatItem[] {
  if (metric === 'most_answered') {
    return [...items].sort((a, b) => b.totalAnswers - a.totalAnswers || a.questionId - b.questionId);
  }
  if (metric === 'least_answered') {
    return [...items].sort((a, b) => a.totalAnswers - b.totalAnswers || a.questionId - b.questionId);
  }

  const answered = items.filter((item) => item.totalAnswers > 0);
  const unanswered = items.filter((item) => item.totalAnswers === 0);

  answered.sort((a, b) => {
    if (a.accuracyPercent !== b.accuracyPercent) {
      return metric === 'difficulty'
        ? a.accuracyPercent - b.accuracyPercent
        : b.accuracyPercent - a.accuracyPercent;
    }
    return b.totalAnswers - a.totalAnswers || a.questionId - b.questionId;
  });

  return [...answered, ...unanswered];
}

// Calcula KPIs, séries temporais, distribuições e análise de questões para o Dashboard Analítico.
export function computeAnalyticsDashboard(params: {
  events: readonly EventConfig[];
  questions: readonly Question[];
  matches: readonly MatchRecord[];
  options: AnalyticsQueryOptions;
  nowMs: number;
}): AnalyticsDashboardResult {
  const { events, questions, matches, options, nowMs } = params;
  const eventsById = new Map(events.map((ev) => [ev.id, ev]));
  const period = options.period ?? 'all';
  const { startMs, endMs } = resolvePeriodBounds(period, nowMs, options.startDate, options.endDate);

  const filteredMatches = matches.filter((match) => {
    if (options.eventId && options.eventId !== 'all' && match.eventId !== options.eventId) {
      return false;
    }
    const playedMs = Date.parse(match.playedAt);
    if (startMs !== null && Number.isFinite(startMs) && playedMs < startMs) {
      return false;
    }
    if (endMs !== null && Number.isFinite(endMs) && playedMs > endMs) {
      return false;
    }
    return true;
  });

  const totalParticipations = filteredMatches.length;
  let scoreSum = 0;
  let timeSum = 0;
  let successCount = 0;
  let maxScoreScale = 0;

  const dailyCounts = new Map<string, number>();
  const scoreCounts = new Map<number, number>();
  const hourlyCounts = Array.from({ length: 24 }, () => 0);

  for (const match of filteredMatches) {
    scoreSum += match.score;
    timeSum += match.timeSeconds;
    const minScore = eventsById.get(match.eventId)?.settings.minScoreForPrize ?? 1;
    if (match.score >= minScore) {
      successCount += 1;
    }

    maxScoreScale = Math.max(maxScoreScale, match.totalQuestions, match.score);
    const dayKey = formatLocalDateKey(match.playedAt);
    dailyCounts.set(dayKey, (dailyCounts.get(dayKey) ?? 0) + 1);
    scoreCounts.set(match.score, (scoreCounts.get(match.score) ?? 0) + 1);

    const playedDate = new Date(match.playedAt);
    if (!Number.isNaN(playedDate.getTime())) {
      hourlyCounts[playedDate.getHours()] += 1;
    }
  }

  const kpis = {
    totalParticipations,
    averageScore:
      totalParticipations > 0 ? Math.round((scoreSum / totalParticipations) * 100) / 100 : 0,
    averageTimeSeconds:
      totalParticipations > 0 ? Math.round((timeSum / totalParticipations) * 10) / 10 : 0,
    successRatePercent:
      totalParticipations > 0
        ? Math.round((successCount / totalParticipations) * 1000) / 10
        : 0,
  };

  const participationsOverTime = Array.from(dailyCounts.entries())
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([date, count]) => ({ date, count }));

  const scoreDistribution = Array.from({ length: maxScoreScale + 1 }, (_, score) => ({
    score,
    count: scoreCounts.get(score) ?? 0,
  }));

  const hourlyEngagement = hourlyCounts.map((count, hour) => ({ hour, count }));

  const perfItems = buildQuestionPerformanceStats(questions, filteredMatches);
  const sortedQuestions = sortByQuestionAnalysisMetric(
    perfItems,
    options.questionMetric ?? 'difficulty',
  );

  return {
    kpis,
    participationsOverTime,
    scoreDistribution,
    hourlyEngagement,
    questionAnalysis: paginateItems(
      sortedQuestions,
      options.questionPage,
      options.questionPageSize,
    ),
  };
}

function compareQuestionStats(
  a: AnalyticsQuestionStatItem,
  b: AnalyticsQuestionStatItem,
  sortBy: QuestionStatsSortField,
  sortDirection: SortDirection,
): number {
  const dir = sortDirection === 'asc' ? 1 : -1;
  switch (sortBy) {
    case 'id':
      return (a.questionId - b.questionId) * dir;
    case 'totalAnswers':
      return (a.totalAnswers - b.totalAnswers) * dir;
    case 'correctAnswers':
      return (a.correctAnswers - b.correctAnswers) * dir;
    case 'incorrectAnswers':
      return (a.incorrectAnswers - b.incorrectAnswers) * dir;
    case 'accuracyPercent':
      return (a.accuracyPercent - b.accuracyPercent) * dir;
    case 'text':
    default:
      return a.text.localeCompare(b.text, 'pt-BR') * dir;
  }
}

// Calcula a tabela paginada e ordenável de Estatísticas por Questão.
export function computeQuestionStatsReport(params: {
  questions: readonly Question[];
  matches: readonly MatchRecord[];
  options: QuestionStatsQueryOptions;
}): QuestionStatsResult {
  const { questions, matches, options } = params;
  const scopedMatches =
    options.eventId && options.eventId !== 'all'
      ? matches.filter((match) => match.eventId === options.eventId)
      : matches;

  const totalParticipations = scopedMatches.length;
  const overallAverageScore =
    totalParticipations > 0
      ? Math.round(
          (scopedMatches.reduce((sum, match) => sum + match.score, 0) / totalParticipations) * 100,
        ) / 100
      : 0;

  const stats = buildQuestionPerformanceStats(questions, scopedMatches);
  const sortBy = options.sortBy ?? 'text';
  const sortDirection = options.sortDirection ?? 'asc';
  const sorted = [...stats].sort((a, b) => compareQuestionStats(a, b, sortBy, sortDirection));

  return {
    overallAverageScore,
    totalParticipations,
    ...paginateItems(sorted, options.page, options.pageSize),
  };
}
