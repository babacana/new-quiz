import { computeAnalyticsDashboard, computeQuestionStatsReport } from './analyticsCalculator';
import {
  convertLegacyBackupToDomain,
  isLegacyQuizOfflineBackup,
  isPlatformBackupPayload,
} from './backupMigration';
import { mergeEventCustomizations } from './customizationThemes';
import { DEFAULT_CUSTOMIZATIONS, DEFAULT_SETTINGS } from './defaults';
import {
  matchesParticipantSearch,
  normalizePhoneDigits,
  toEventPhoneKey,
} from './operationalRules';
import {
  buildTotemActivationLink,
  generateShortPairingCode,
  normalizePairingCode,
} from './pairingUtils';
import type { Clock, CloudGateway, RandomSource } from './ports';
import type {
  ActiveGiveUpLockoutItem,
  AnalyticsDashboardResult,
  AnalyticsQueryOptions,
  AuthSession,
  AuthorizeTotemPairingInput,
  BackupRestoreResult,
  CloneEventOverrides,
  CreateStaffAccountInput,
  DifficultyLevel,
  DirtySection,
  DispatchRemoteCommandInput,
  EventConfig,
  EventCustomizations,
  EventCustomizationsPatch,
  EventSettings,
  EventUpsertInput,
  EventVisualAssetUploadInput,
  GiveUpLockoutRecord,
  MatchRecord,
  OfflinePrizeConflictAlert,
  OperatorEventSnapshot,
  PaginatedParticipantReportResult,
  PaginatedQuestionsResult,
  ParticipantMatchDetails,
  ParticipantPrizeFilter,
  ParticipantReportFilterOptions,
  ParticipantReportItem,
  ParticipantSortField,
  PlatformBackupPayload,
  PreparedOption,
  PreparedQuestion,
  PrizeClaimRecord,
  Question,
  QuestionFilterOptions,
  QuestionStatsQueryOptions,
  QuestionStatsResult,
  QuestionUpsertInput,
  QuestionsImportMode,
  QuestionsImportResult,
  RankingEntry,
  RemoteCommandPayload,
  TotemChannelEvent,
  TotemRecord,
  UnsavedChangesResolution,
  UnsavedNavigationPrompt,
  UserProfile,
  UserRole,
} from './types';

export interface EventAdminControllerDependencies {
  cloudGateway: CloudGateway;
  clock?: Clock;
  random: RandomSource;
}

const VALID_DIFFICULTIES: readonly DifficultyLevel[] = ['facil', 'moderado', 'dificil'];
const TOTEM_HEARTBEAT_STALE_MS = 90_000;

const DIRTY_SECTION_LABELS: Record<DirtySection, string> = {
  event: 'Dados do Evento',
  settings: 'Configurações do Jogo',
  question: 'Questão',
  customization: 'Personalização Visual',
};

// Normaliza um nome para gerar slug URL-safe e consistente para Eventos.
export function generateEventSlug(name: string, existingSlugs?: Set<string>): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const candidate = base || 'evento';
  if (!existingSlugs || !existingSlugs.has(candidate)) {
    return candidate;
  }

  let suffix = 2;
  while (existingSlugs.has(`${candidate}-${suffix}`)) {
    suffix += 1;
  }
  return `${candidate}-${suffix}`;
}

// Valida integralmente as regras numéricas e percentuais das configurações de um Evento.
export function validateEventSettings(settings: EventSettings): void {
  if (!Number.isInteger(settings.numberOfQuestions) || settings.numberOfQuestions < 1) {
    throw new Error('O número de perguntas deve ser um inteiro maior ou igual a 1.');
  }

  if (
    !Number.isFinite(settings.timePerQuestion) ||
    settings.timePerQuestion < 5 ||
    settings.timePerQuestion > 120
  ) {
    throw new Error('O tempo por pergunta deve estar entre 5 e 120 segundos.');
  }

  if (
    !Number.isFinite(settings.idleTimeoutSeconds) ||
    settings.idleTimeoutSeconds < 15 ||
    settings.idleTimeoutSeconds > 600
  ) {
    throw new Error(
      'O tempo de inatividade para tela de descanso deve estar entre 15 e 600 segundos.',
    );
  }

  if (
    !Number.isFinite(settings.fadeOutLeadTimeSeconds) ||
    settings.fadeOutLeadTimeSeconds < 3 ||
    settings.fadeOutLeadTimeSeconds > 30 ||
    settings.fadeOutLeadTimeSeconds >= settings.idleTimeoutSeconds
  ) {
    throw new Error(
      'O tempo de aviso (fade-out) deve estar entre 3 e 30 segundos e ser menor que o tempo de inatividade.',
    );
  }

  const { facil, moderado, dificil } = settings.difficultyPercentages;
  const levels = [facil, moderado, dificil];
  if (levels.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
    throw new Error('Cada percentual de dificuldade deve estar entre 0% e 100%.');
  }

  if (Math.round((facil + moderado + dificil) * 100) / 100 !== 100) {
    throw new Error('A soma dos percentuais de dificuldade deve ser exatamente 100%.');
  }

  if (
    !Number.isInteger(settings.minScoreForPrize) ||
    settings.minScoreForPrize < 1 ||
    settings.minScoreForPrize > settings.numberOfQuestions
  ) {
    throw new Error(
      'A pontuação mínima para brinde deve ser entre 1 e o número total de perguntas.',
    );
  }

  if (!Number.isInteger(settings.rankingDisplayCount) || settings.rankingDisplayCount < 1) {
    throw new Error('A quantidade exibida no ranking deve ser pelo menos 1.');
  }

  if (!Number.isFinite(settings.giveUpLockoutMinutes) || settings.giveUpLockoutMinutes < 0) {
    throw new Error('O tempo de bloqueio por desistência não pode ser negativo.');
  }

  if (
    !Number.isFinite(settings.virtualKeyboardHeight) ||
    settings.virtualKeyboardHeight < 20 ||
    settings.virtualKeyboardHeight > 60
  ) {
    throw new Error('A altura do teclado virtual deve estar entre 20vh e 60vh.');
  }

  if (
    settings.prizeStockLimit !== null &&
    (!Number.isInteger(settings.prizeStockLimit) || settings.prizeStockLimit < 0)
  ) {
    throw new Error('O limite de estoque de brindes deve ser nulo ou inteiro não negativo.');
  }
}

export function validateEventWindow(startTime: string | null, endTime: string | null): void {
  if (startTime !== null && Number.isNaN(Date.parse(startTime))) {
    throw new Error('A data/hora de início do Evento é inválida.');
  }
  if (endTime !== null && Number.isNaN(Date.parse(endTime))) {
    throw new Error('A data/hora de término do Evento é inválida.');
  }
  if (startTime !== null && endTime !== null && Date.parse(endTime) <= Date.parse(startTime)) {
    throw new Error('A data/hora de término do Evento deve ser posterior à data/hora de início.');
  }
}

export function validateQuestionInput(input: QuestionUpsertInput): void {
  if (!input.text.trim()) {
    throw new Error('O enunciado da questão é obrigatório.');
  }

  if (!Array.isArray(input.options) || input.options.length !== 4) {
    throw new Error('A questão deve possuir exatamente 4 alternativas.');
  }

  if (input.options.some((option) => !String(option ?? '').trim())) {
    throw new Error('Todas as 4 alternativas da questão devem estar preenchidas.');
  }

  if (!Number.isInteger(input.correctIndex) || input.correctIndex < 0 || input.correctIndex > 3) {
    throw new Error('O índice da alternativa correta deve estar entre 0 e 3.');
  }

  if (!VALID_DIFFICULTIES.includes(input.difficulty)) {
    throw new Error('Dificuldade inválida. Use facil, moderado ou dificil.');
  }
}

function mergeEventSettings(
  base: EventSettings,
  patch?: Partial<EventSettings>,
): EventSettings {
  return {
    ...structuredClone(base),
    ...(patch ?? {}),
    difficultyPercentages: {
      ...base.difficultyPercentages,
      ...(patch?.difficultyPercentages ?? {}),
    },
  };
}

function normalizeQuestionOptions(
  options: [string, string, string, string],
): [string, string, string, string] {
  return [
    options[0].trim(),
    options[1].trim(),
    options[2].trim(),
    options[3].trim(),
  ];
}

function normalizeTags(tags?: string[]): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const tag of tags) {
    const clean = tag.trim().toLowerCase();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      normalized.push(clean);
    }
  }
  return normalized;
}

function escapeCsvField(value: string | number | boolean): string {
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function parseCsvRows(csvContent: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;

  const content = csvContent.replace(/^\uFEFF/, '');
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (insideQuotes) {
      if (char === '"' && nextChar === '"') {
        currentField += '"';
        i += 1;
      } else if (char === '"') {
        insideQuotes = false;
      } else {
        currentField += char;
      }
      continue;
    }

    if (char === '"') {
      insideQuotes = true;
    } else if (char === ',') {
      currentRow.push(currentField);
      currentField = '';
    } else if (char === '\r' && nextChar === '\n') {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
      i += 1;
    } else if (char === '\n' || char === '\r') {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  if (insideQuotes) {
    throw new Error('Arquivo CSV malformado: aspas não fechadas.');
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows.filter((row) => row.some((cell) => cell.trim() !== ''));
}

function buildQuestionEntity(id: number, input: QuestionUpsertInput): Question {
  return {
    id,
    text: input.text,
    options: input.options,
    correctIndex: input.correctIndex,
    difficulty: input.difficulty,
    tags: input.tags ?? [],
    isDisabled: input.isDisabled ?? false,
  };
}

function normalizeImportedQuestion(raw: Record<string, unknown>): QuestionUpsertInput {
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  const rawOptions = Array.isArray(raw.options) ? raw.options : [];
  if (rawOptions.length !== 4) {
    throw new Error(`Questão "${text || 'sem texto'}" não possui exatamente 4 alternativas.`);
  }
  const options: [string, string, string, string] = [
    String(rawOptions[0] ?? '').trim(),
    String(rawOptions[1] ?? '').trim(),
    String(rawOptions[2] ?? '').trim(),
    String(rawOptions[3] ?? '').trim(),
  ];

  // Suporta tanto o campo atual `correctIndex` quanto o legado `correct`, rejeitando valor vazio.
  const rawCorrect = raw.correctIndex !== undefined ? raw.correctIndex : raw.correct;
  const correctIndex =
    rawCorrect === undefined || rawCorrect === null || String(rawCorrect).trim() === ''
      ? Number.NaN
      : Number(rawCorrect);

  // Normaliza acentos ("Fácil" -> "facil", "Difícil" -> "dificil") mantendo valores inválidos para validação.
  const rawDifficulty =
    raw.difficulty === undefined || raw.difficulty === null || String(raw.difficulty).trim() === ''
      ? 'moderado'
      : String(raw.difficulty)
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim()
          .toLowerCase();

  let tags: string[] = [];
  if (Array.isArray(raw.tags)) {
    tags = normalizeTags(raw.tags.map((item) => String(item)));
  } else if (typeof raw.tags === 'string') {
    tags = normalizeTags(raw.tags.split(/[;|]/));
  }

  const isDisabled =
    raw.isDisabled === true || String(raw.isDisabled ?? '').trim().toLowerCase() === 'true';

  const parsed: QuestionUpsertInput = {
    text,
    options,
    correctIndex,
    difficulty: rawDifficulty as DifficultyLevel,
    tags,
    isDisabled,
  };

  validateQuestionInput(parsed);
  return parsed;
}

function isLockoutActiveAt(lockout: GiveUpLockoutRecord, referenceNowMs: number): boolean {
  const expiresMs = Date.parse(lockout.expiresAt);
  const lockedMs = Date.parse(lockout.lockedAt);
  if (!Number.isFinite(expiresMs)) {
    return false;
  }
  if (Number.isFinite(lockedMs) && expiresMs <= lockedMs) {
    return false;
  }
  return expiresMs > referenceNowMs;
}

function computeEventRankings(matches: MatchRecord[]): {
  rankingByEvent: Map<string, RankingEntry[]>;
  rankByMatchId: Map<string, number>;
} {
  const byEvent = new Map<string, MatchRecord[]>();
  for (const match of matches) {
    const list = byEvent.get(match.eventId) ?? [];
    list.push(match);
    byEvent.set(match.eventId, list);
  }

  const rankingByEvent = new Map<string, RankingEntry[]>();
  const rankByMatchId = new Map<string, number>();

  for (const [eventId, eventMatches] of byEvent.entries()) {
    const sorted = [...eventMatches].sort(
      (a, b) =>
        b.score - a.score ||
        a.timeSeconds - b.timeSeconds ||
        a.playedAt.localeCompare(b.playedAt),
    );
    const entries: RankingEntry[] = sorted.map((match, index) => {
      const position = index + 1;
      rankByMatchId.set(match.id, position);
      return {
        position,
        matchId: match.id,
        participantName: match.participantName,
        participantPhone: match.participantPhone,
        score: match.score,
        totalQuestions: match.totalQuestions,
        timeSeconds: match.timeSeconds,
        playedAt: match.playedAt,
      };
    });
    rankingByEvent.set(eventId, entries);
  }

  return { rankingByEvent, rankByMatchId };
}

function buildOfflineConflicts(
  eventsById: Map<string, EventConfig>,
  matchesById: Map<string, MatchRecord>,
  claims: PrizeClaimRecord[],
): OfflinePrizeConflictAlert[] {
  const activeClaimByEventPhone = new Map<string, PrizeClaimRecord>();
  const conflictClaimsByEventPhone = new Map<string, PrizeClaimRecord[]>();

  for (const claim of claims) {
    const key = toEventPhoneKey(claim.eventId, claim.participantPhone);
    if (claim.status === 'awaiting_pickup' || claim.status === 'delivered') {
      activeClaimByEventPhone.set(key, claim);
    } else if (claim.status === 'offline_duplicate_conflict') {
      const list = conflictClaimsByEventPhone.get(key) ?? [];
      list.push(claim);
      conflictClaimsByEventPhone.set(key, list);
    }
  }

  const alerts: OfflinePrizeConflictAlert[] = [];
  for (const [key, conflicts] of conflictClaimsByEventPhone.entries()) {
    const sample = conflicts[0]!;
    const activeClaim = activeClaimByEventPhone.get(key) ?? null;
    const event = eventsById.get(sample.eventId);

    alerts.push({
      eventId: sample.eventId,
      eventName: event?.name ?? sample.eventId,
      participantPhone: sample.participantPhone,
      participantName: activeClaim?.participantName ?? sample.participantName,
      activeClaimId: activeClaim?.id ?? null,
      activeMatchId: activeClaim?.matchId ?? null,
      activePrizeStatus: activeClaim?.status ?? null,
      conflictClaims: [...conflicts]
        .sort((a, b) => a.awardedAt.localeCompare(b.awardedAt))
        .map((conflict) => {
          const match = matchesById.get(conflict.matchId);
          return {
            claimId: conflict.id,
            matchId: conflict.matchId,
            totemId: conflict.totemId,
            awardedAt: conflict.awardedAt,
            playedAt: match?.playedAt ?? null,
            score: match?.score ?? null,
          };
        }),
    });
  }

  return alerts.sort((a, b) => {
    const latestA = a.conflictClaims[a.conflictClaims.length - 1]?.awardedAt ?? '';
    const latestB = b.conflictClaims[b.conflictClaims.length - 1]?.awardedAt ?? '';
    return latestB.localeCompare(latestA);
  });
}

function buildParticipantReportItems(params: {
  eventsById: Map<string, EventConfig>;
  matches: MatchRecord[];
  claims: PrizeClaimRecord[];
  lockouts: GiveUpLockoutRecord[];
  nowMs: number;
}): {
  items: ParticipantReportItem[];
  rankingByEvent: Map<string, RankingEntry[]>;
  offlineConflicts: OfflinePrizeConflictAlert[];
} {
  const { eventsById, matches, claims, lockouts, nowMs } = params;
  const matchesById = new Map(matches.map((match) => [match.id, match]));
  const claimsByMatchId = new Map(claims.map((claim) => [claim.matchId, claim]));
  const { rankingByEvent, rankByMatchId } = computeEventRankings(matches);
  const offlineConflicts = buildOfflineConflicts(eventsById, matchesById, claims);

  const conflictPhonesByEvent = new Set(
    offlineConflicts.map((alert) => toEventPhoneKey(alert.eventId, alert.participantPhone)),
  );

  const activeLockoutByEventPhone = new Map<string, GiveUpLockoutRecord>();
  for (const lockout of lockouts) {
    if (!isLockoutActiveAt(lockout, nowMs)) {
      continue;
    }
    const key = toEventPhoneKey(lockout.eventId, lockout.participantPhone);
    const existing = activeLockoutByEventPhone.get(key);
    if (!existing || lockout.expiresAt > existing.expiresAt) {
      activeLockoutByEventPhone.set(key, lockout);
    }
  }

  const items: ParticipantReportItem[] = matches.map((match) => {
    const claim = claimsByMatchId.get(match.id) ?? null;
    const event = eventsById.get(match.eventId);
    const key = toEventPhoneKey(match.eventId, match.participantPhone);
    const activeLockout = activeLockoutByEventPhone.get(key) ?? null;

    return {
      matchId: match.id,
      eventId: match.eventId,
      eventName: event?.name ?? match.eventId,
      totemId: match.totemId,
      participantName: match.participantName,
      participantPhone: match.participantPhone,
      score: match.score,
      totalQuestions: match.totalQuestions,
      timeSeconds: match.timeSeconds,
      playedAt: match.playedAt,
      prizeClaimId: claim?.id ?? null,
      prizeStatus: claim?.status ?? null,
      awardedAt: claim?.awardedAt ?? null,
      deliveredAt: claim?.deliveredAt ?? null,
      hasOfflineConflict:
        claim?.status === 'offline_duplicate_conflict' || conflictPhonesByEvent.has(key),
      hasActiveGiveUpLockout: activeLockout !== null,
      activeLockoutExpiresAt: activeLockout?.expiresAt ?? null,
      rankingPosition: rankByMatchId.get(match.id) ?? 0,
    };
  });

  return { items, rankingByEvent, offlineConflicts };
}

function matchesPrizeFilter(
  item: ParticipantReportItem,
  prizeFilter: ParticipantPrizeFilter,
): boolean {
  switch (prizeFilter) {
    case 'all':
      return true;
    case 'winners':
      return item.prizeStatus === 'awaiting_pickup' || item.prizeStatus === 'delivered';
    case 'non_winners':
      return item.prizeStatus === null || item.prizeStatus === 'revoked';
    case 'awaiting_pickup':
      return item.prizeStatus === 'awaiting_pickup';
    case 'delivered':
      return item.prizeStatus === 'delivered';
    case 'revoked':
      return item.prizeStatus === 'revoked';
    case 'offline_conflict':
      return item.hasOfflineConflict;
  }
}

function parseFilterDateBoundary(dateStr: string, bound: 'start' | 'end'): number | null {
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

function compareParticipantReportItems(
  a: ParticipantReportItem,
  b: ParticipantReportItem,
  sortBy: ParticipantSortField,
  sortDirection: 'asc' | 'desc',
): number {
  const dir = sortDirection === 'asc' ? 1 : -1;

  if (sortBy === 'score') {
    if (a.score !== b.score) {
      return (a.score - b.score) * dir;
    }
    return a.timeSeconds - b.timeSeconds || a.playedAt.localeCompare(b.playedAt);
  }

  let cmp = 0;
  switch (sortBy) {
    case 'eventName':
      cmp = a.eventName.localeCompare(b.eventName, 'pt-BR');
      break;
    case 'participantName':
      cmp = a.participantName.localeCompare(b.participantName, 'pt-BR');
      break;
    case 'participantPhone':
      cmp = a.participantPhone.localeCompare(b.participantPhone);
      break;
    case 'timeSeconds':
      cmp = a.timeSeconds - b.timeSeconds;
      break;
    case 'prizeStatus':
      cmp = (a.prizeStatus ?? '').localeCompare(b.prizeStatus ?? '');
      break;
    case 'playedAt':
    default:
      cmp = a.playedAt.localeCompare(b.playedAt);
      break;
  }

  if (cmp !== 0) {
    return cmp * dir;
  }
  return b.playedAt.localeCompare(a.playedAt);
}

export class EventAdminController {
  private readonly cloudGateway: CloudGateway;
  private readonly clock?: Clock;
  private readonly random: RandomSource;
  private session: AuthSession | null = null;
  private readonly dirtySections = new Set<DirtySection>();

  constructor(deps: EventAdminControllerDependencies) {
    this.cloudGateway = deps.cloudGateway;
    this.clock = deps.clock;
    this.random = deps.random;
  }

  private nowIso(): string {
    return this.clock ? this.clock.toISOString() : new Date().toISOString();
  }

  async login(email: string, password: string): Promise<AuthSession> {
    if (!email.trim() || !password) {
      throw new Error('Informe e-mail e senha para entrar.');
    }
    const session = await this.cloudGateway.authenticate(email, password);
    this.session = session;
    this.dirtySections.clear();
    return structuredClone(session);
  }

  async restoreSession(): Promise<AuthSession | null> {
    const existing = await this.cloudGateway.getCurrentSession();
    this.session = existing;
    return existing ? structuredClone(existing) : null;
  }

  async logout(): Promise<void> {
    await this.cloudGateway.signOut();
    this.session = null;
    this.dirtySections.clear();
  }

  getSession(): AuthSession | null {
    return this.session ? structuredClone(this.session) : null;
  }

  getCurrentRole(): UserRole | null {
    return this.session?.user.role ?? null;
  }

  canAccessAdminPanel(): boolean {
    return this.session?.user.role === 'admin';
  }

  canAccessOperatorPanel(): boolean {
    return this.session?.user.role === 'admin' || this.session?.user.role === 'operator';
  }

  private requireAuthenticated(): AuthSession {
    if (!this.session) {
      throw new Error('Sessão não autenticada. Faça login para continuar.');
    }
    return this.session;
  }

  private requireStaff(): AuthSession {
    const session = this.requireAuthenticated();
    if (session.user.role !== 'admin' && session.user.role !== 'operator') {
      throw new Error('Acesso negado: perfil sem permissão operacional.');
    }
    return session;
  }

  private requireAdmin(): AuthSession {
    const session = this.requireAuthenticated();
    if (session.user.role !== 'admin') {
      throw new Error(
        'Acesso negado: apenas o perfil Administrador pode realizar esta operação.',
      );
    }
    return session;
  }

  async listStaffAccounts(): Promise<UserProfile[]> {
    this.requireAdmin();
    return this.cloudGateway.listStaffProfiles();
  }

  async createStaffAccount(input: CreateStaffAccountInput): Promise<UserProfile> {
    this.requireAdmin();

    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    if (!name) {
      throw new Error('O nome do membro da Equipe do Estande é obrigatório.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Informe um e-mail válido.');
    }
    if (!input.password || input.password.length < 6) {
      throw new Error('A senha deve possuir no mínimo 6 caracteres.');
    }
    if (input.role !== 'admin' && input.role !== 'operator') {
      throw new Error('Perfil inválido. Utilize admin ou operator.');
    }

    return this.cloudGateway.createStaffProfile({
      name,
      email,
      password: input.password,
      role: input.role,
    });
  }

  async updateStaffRole(profileId: string, role: UserRole): Promise<UserProfile> {
    const session = this.requireAdmin();
    if (session.user.id === profileId) {
      throw new Error('Não é permitido alterar o próprio perfil enquanto autenticado.');
    }
    if (role !== 'admin' && role !== 'operator') {
      throw new Error('Perfil inválido. Utilize admin ou operator.');
    }
    return this.cloudGateway.updateStaffProfileRole(profileId, role);
  }

  async removeStaffAccount(profileId: string): Promise<void> {
    const session = this.requireAdmin();
    if (session.user.id === profileId) {
      throw new Error('Não é permitido revogar o próprio acesso da sessão atual.');
    }
    await this.cloudGateway.deleteStaffProfile(profileId);
  }

  async listEvents(): Promise<EventConfig[]> {
    this.requireAuthenticated();
    return this.cloudGateway.listEvents();
  }

  async getEventQuestionIds(eventId: string): Promise<number[]> {
    this.requireAuthenticated();
    return this.cloudGateway.getEventQuestionIds(eventId);
  }

  async createEvent(input: EventUpsertInput): Promise<EventConfig> {
    this.requireAdmin();

    const cleanName = input.name.trim();
    if (!cleanName) {
      throw new Error('O nome do Evento é obrigatório.');
    }

    const existingEvents = await this.cloudGateway.listEvents();
    const existingSlugs = new Set(existingEvents.map((ev) => ev.slug));
    const slug = input.slug?.trim()
      ? generateEventSlug(input.slug, existingSlugs)
      : generateEventSlug(cleanName, existingSlugs);

    const startTime = input.startTime ?? null;
    const endTime = input.endTime ?? null;
    validateEventWindow(startTime, endTime);

    const settings = mergeEventSettings(DEFAULT_SETTINGS, input.settings);
    validateEventSettings(settings);

    const customizations = mergeEventCustomizations(DEFAULT_CUSTOMIZATIONS, input.customizations);

    const event: EventConfig = {
      id: input.id ?? this.random.uuid(),
      name: cleanName,
      slug,
      startTime,
      endTime,
      enableOutOfPeriodMessage: input.enableOutOfPeriodMessage ?? false,
      isActive: input.isActive ?? true,
      settings,
      prizeStockRemaining:
        input.prizeStockRemaining !== undefined
          ? input.prizeStockRemaining
          : settings.prizeStockLimit,
      customizations,
      configVersion: 1,
    };

    const saved = await this.cloudGateway.saveEvent(event);
    if (input.linkedQuestionIds && input.linkedQuestionIds.length > 0) {
      await this.cloudGateway.setEventQuestions(saved.id, input.linkedQuestionIds);
    }

    this.clearDirty('event');
    this.clearDirty('settings');
    return saved;
  }

  async updateEvent(eventId: string, patch: Partial<EventUpsertInput>): Promise<EventConfig> {
    this.requireAdmin();

    const events = await this.cloudGateway.listEvents();
    const existing = events.find((ev) => ev.id === eventId);
    if (!existing) {
      throw new Error(`Evento não encontrado (${eventId}).`);
    }

    const nextName = patch.name !== undefined ? patch.name.trim() : existing.name;
    if (!nextName) {
      throw new Error('O nome do Evento não pode ficar vazio.');
    }

    let nextSlug = existing.slug;
    if (patch.slug !== undefined && patch.slug.trim() !== existing.slug) {
      const otherSlugs = new Set(events.filter((ev) => ev.id !== eventId).map((ev) => ev.slug));
      nextSlug = generateEventSlug(patch.slug, otherSlugs);
    }

    const startTime = patch.startTime !== undefined ? patch.startTime : existing.startTime;
    const endTime = patch.endTime !== undefined ? patch.endTime : existing.endTime;
    validateEventWindow(startTime, endTime);

    const nextSettings = mergeEventSettings(existing.settings, patch.settings);
    validateEventSettings(nextSettings);

    const nextCustomizations = mergeEventCustomizations(
      existing.customizations,
      patch.customizations,
    );

    const updated: EventConfig = {
      ...structuredClone(existing),
      name: nextName,
      slug: nextSlug,
      startTime,
      endTime,
      enableOutOfPeriodMessage:
        patch.enableOutOfPeriodMessage ?? existing.enableOutOfPeriodMessage,
      isActive: patch.isActive ?? existing.isActive,
      settings: nextSettings,
      prizeStockRemaining:
        patch.prizeStockRemaining !== undefined
          ? patch.prizeStockRemaining
          : existing.prizeStockRemaining,
      customizations: nextCustomizations,
      configVersion: existing.configVersion + 1,
    };

    const saved = await this.cloudGateway.saveEvent(updated);
    if (patch.linkedQuestionIds !== undefined) {
      await this.cloudGateway.setEventQuestions(saved.id, patch.linkedQuestionIds);
    }

    this.clearDirty('event');
    this.clearDirty('settings');
    await this.dispatchConfigUpdatedForEvent(saved.id, saved.configVersion);
    return saved;
  }

  async setEventActive(eventId: string, isActive: boolean): Promise<EventConfig> {
    return this.updateEvent(eventId, { isActive });
  }

  async cloneEvent(sourceEventId: string, overrides: CloneEventOverrides): Promise<EventConfig> {
    this.requireAdmin();

    const events = await this.cloudGateway.listEvents();
    const source = events.find((ev) => ev.id === sourceEventId);
    if (!source) {
      throw new Error(`Evento de origem não encontrado para clonagem (${sourceEventId}).`);
    }

    const linkedQuestionIds = await this.cloudGateway.getEventQuestionIds(sourceEventId);

    return this.createEvent({
      id: overrides.id,
      name: overrides.name,
      slug: overrides.slug,
      startTime: overrides.startTime !== undefined ? overrides.startTime : source.startTime,
      endTime: overrides.endTime !== undefined ? overrides.endTime : source.endTime,
      enableOutOfPeriodMessage: source.enableOutOfPeriodMessage,
      isActive: overrides.isActive ?? true,
      settings: structuredClone(source.settings),
      prizeStockRemaining: source.settings.prizeStockLimit,
      customizations: structuredClone(source.customizations),
      linkedQuestionIds,
    });
  }

  private async dispatchConfigUpdatedForEvent(
    eventId: string,
    configVersion: number,
  ): Promise<void> {
    await this.cloudGateway.dispatchRemoteCommand({
      id: this.random.uuid(),
      type: 'CONFIG_UPDATED',
      targetTotemId: null,
      targetEventId: eventId,
      configVersion,
      issuedAt: this.nowIso(),
    });
  }

  private async bumpAndNotifyEvent(event: EventConfig): Promise<void> {
    const nextVersion = event.configVersion + 1;
    await this.cloudGateway.saveEvent({
      ...structuredClone(event),
      configVersion: nextVersion,
    });
    await this.dispatchConfigUpdatedForEvent(event.id, nextVersion);
  }

  private async notifyActiveEventsQuestionsChanged(): Promise<void> {
    const events = await this.cloudGateway.listEvents();
    for (const ev of events) {
      await this.bumpAndNotifyEvent(ev);
    }
  }

  private async bumpEventConfigVersion(eventId: string): Promise<void> {
    const events = await this.cloudGateway.listEvents();
    const existing = events.find((ev) => ev.id === eventId);
    if (!existing) {
      throw new Error(`Evento não encontrado (${eventId}).`);
    }
    await this.bumpAndNotifyEvent(existing);
  }

  async setEventQuestions(eventId: string, questionIds: number[]): Promise<void> {
    this.requireAdmin();
    await this.cloudGateway.setEventQuestions(eventId, questionIds);
    await this.bumpEventConfigVersion(eventId);
  }

  async setEventQuestionsByTags(eventId: string, tags: string[]): Promise<number[]> {
    this.requireAdmin();
    const normalizedTargets = new Set(normalizeTags(tags));
    const allQuestions = await this.cloudGateway.listAllQuestions();
    const matchingIds = allQuestions
      .filter(
        (q) =>
          normalizedTargets.size === 0 ||
          q.tags.some((tag) => normalizedTargets.has(tag.toLowerCase())),
      )
      .map((q) => q.id);

    if (normalizedTargets.size > 0 && matchingIds.length === 0) {
      throw new Error('Nenhuma questão encontrada no Banco de Questões para as tags informadas.');
    }

    await this.cloudGateway.setEventQuestions(eventId, matchingIds);
    await this.bumpEventConfigVersion(eventId);
    return matchingIds;
  }

  async createQuestion(input: QuestionUpsertInput): Promise<Question> {
    this.requireAdmin();

    const normalized: QuestionUpsertInput = {
      ...input,
      text: input.text.trim(),
      options: normalizeQuestionOptions(input.options),
      tags: normalizeTags(input.tags),
      isDisabled: input.isDisabled ?? false,
    };
    validateQuestionInput(normalized);

    const existing = await this.cloudGateway.listAllQuestions();
    const maxId = existing.reduce((acc, q) => Math.max(acc, q.id), 0);
    const nextId = input.id ?? maxId + 1;

    const saved = await this.cloudGateway.saveQuestion(buildQuestionEntity(nextId, normalized));
    this.clearDirty('question');
    await this.notifyActiveEventsQuestionsChanged();
    return saved;
  }

  async updateQuestion(id: number, input: QuestionUpsertInput): Promise<Question> {
    this.requireAdmin();

    const existingList = await this.cloudGateway.listAllQuestions();
    const current = existingList.find((q) => q.id === id);
    if (!current) {
      throw new Error(`Questão #${id} não encontrada no Banco de Questões.`);
    }

    const normalized: QuestionUpsertInput = {
      ...input,
      id,
      text: input.text.trim(),
      options: normalizeQuestionOptions(input.options),
      tags: input.tags !== undefined ? normalizeTags(input.tags) : current.tags,
      isDisabled: input.isDisabled ?? current.isDisabled,
    };
    validateQuestionInput(normalized);

    const saved = await this.cloudGateway.saveQuestion(buildQuestionEntity(id, normalized));

    this.clearDirty('question');
    await this.notifyActiveEventsQuestionsChanged();
    return saved;
  }

  async deleteQuestions(ids: number[]): Promise<number> {
    this.requireAdmin();
    const count = await this.cloudGateway.deleteQuestions(ids);
    if (count > 0) {
      await this.notifyActiveEventsQuestionsChanged();
    }
    return count;
  }

  async setQuestionsDisabled(ids: number[], isDisabled: boolean): Promise<number> {
    this.requireAdmin();
    const count = await this.cloudGateway.setQuestionsDisabled(ids, isDisabled);
    if (count > 0) {
      await this.notifyActiveEventsQuestionsChanged();
    }
    return count;
  }

  async listAllQuestions(eventId?: string): Promise<Question[]> {
    this.requireAdmin();
    const questions = await this.cloudGateway.listAllQuestions();
    if (!eventId) {
      return questions;
    }
    const linkedIds = await this.cloudGateway.getEventQuestionIds(eventId);
    if (linkedIds.length === 0) {
      return questions;
    }
    const linkedSet = new Set(linkedIds);
    return questions.filter((q) => linkedSet.has(q.id));
  }

  async queryQuestions(filter: QuestionFilterOptions = {}): Promise<PaginatedQuestionsResult> {
    this.requireAdmin();

    const questions = await this.listAllQuestions(filter.eventId);

    const counts = {
      total: questions.length,
      active: questions.filter((q) => !q.isDisabled).length,
      disabled: questions.filter((q) => q.isDisabled).length,
      byDifficulty: {
        facil: questions.filter((q) => q.difficulty === 'facil').length,
        moderado: questions.filter((q) => q.difficulty === 'moderado').length,
        dificil: questions.filter((q) => q.difficulty === 'dificil').length,
      },
    };

    const searchTerm = filter.search?.trim().toLowerCase() ?? '';
    const difficultiesSet =
      filter.difficulties && filter.difficulties.length > 0 ? new Set(filter.difficulties) : null;
    const requiredTags = normalizeTags(filter.tags);
    const status = filter.status ?? 'all';

    const filtered = questions.filter((question) => {
      if (status === 'active' && question.isDisabled) {
        return false;
      }
      if (status === 'disabled' && !question.isDisabled) {
        return false;
      }
      if (difficultiesSet && !difficultiesSet.has(question.difficulty)) {
        return false;
      }
      if (
        requiredTags.length > 0 &&
        !requiredTags.every((tag) => question.tags.map((t) => t.toLowerCase()).includes(tag))
      ) {
        return false;
      }
      if (searchTerm) {
        const matchesId = String(question.id) === searchTerm;
        const matchesText = question.text.toLowerCase().includes(searchTerm);
        const matchesOption = question.options.some((opt) =>
          opt.toLowerCase().includes(searchTerm),
        );
        const matchesTag = question.tags.some((t) => t.toLowerCase().includes(searchTerm));
        if (!matchesId && !matchesText && !matchesOption && !matchesTag) {
          return false;
        }
      }
      return true;
    });

    const sortBy = filter.sortBy ?? 'id';
    const sortDir = filter.sortDirection === 'desc' ? -1 : 1;
    const difficultyRank: Record<DifficultyLevel, number> = {
      facil: 1,
      moderado: 2,
      dificil: 3,
    };

    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'id') {
        comparison = a.id - b.id;
      } else if (sortBy === 'text') {
        comparison = a.text.localeCompare(b.text, 'pt-BR');
      } else if (sortBy === 'difficulty') {
        comparison = difficultyRank[a.difficulty] - difficultyRank[b.difficulty];
      } else {
        comparison = Number(a.isDisabled) - Number(b.isDisabled);
      }
      return comparison !== 0 ? comparison * sortDir : a.id - b.id;
    });

    const pageSize = Math.max(1, filter.pageSize ?? 20);
    const totalItems = sorted.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const currentPage = Math.min(Math.max(1, filter.page ?? 1), totalPages);
    const startIndex = (currentPage - 1) * pageSize;

    return {
      items: sorted.slice(startIndex, startIndex + pageSize),
      totalItems,
      totalPages,
      currentPage,
      pageSize,
      counts,
    };
  }

  previewQuestion(question: Question | QuestionUpsertInput): PreparedQuestion {
    validateQuestionInput(question);
    const trimmedOptions = normalizeQuestionOptions(question.options);
    const preparedOptions: PreparedOption[] = trimmedOptions.map((text, idx) => ({
      text,
      isCorrect: idx === question.correctIndex,
      originalIndex: idx,
    }));

    return {
      id: 'id' in question && typeof question.id === 'number' ? question.id : 0,
      text: question.text.trim(),
      difficulty: question.difficulty,
      originalOptions: trimmedOptions,
      originalCorrectIndex: question.correctIndex,
      shuffledOptions: this.random.shuffle(preparedOptions),
    };
  }

  async exportQuestionsJson(eventId?: string): Promise<string> {
    const items = await this.listAllQuestions(eventId);
    return JSON.stringify(items, null, 2);
  }

  async exportQuestionsCsv(eventId?: string): Promise<string> {
    const items = await this.listAllQuestions(eventId);

    const header =
      'id,text,optionA,optionB,optionC,optionD,correctIndex,difficulty,tags,isDisabled';
    const lines = items.map((q) =>
      [
        escapeCsvField(q.id),
        escapeCsvField(q.text),
        escapeCsvField(q.options[0]),
        escapeCsvField(q.options[1]),
        escapeCsvField(q.options[2]),
        escapeCsvField(q.options[3]),
        escapeCsvField(q.correctIndex),
        escapeCsvField(q.difficulty),
        escapeCsvField(q.tags.join(';')),
        escapeCsvField(q.isDisabled),
      ].join(','),
    );

    return [header, ...lines].join('\n');
  }

  async importQuestionsJson(
    jsonContent: string,
    mode: QuestionsImportMode,
  ): Promise<QuestionsImportResult> {
    this.requireAdmin();

    let decoded: unknown;
    try {
      decoded = JSON.parse(jsonContent);
    } catch {
      throw new Error('Conteúdo JSON inválido para importação do Banco de Questões.');
    }

    const rawList = Array.isArray(decoded)
      ? decoded
      : typeof decoded === 'object' &&
          decoded !== null &&
          Array.isArray((decoded as { questions?: unknown[] }).questions)
        ? (decoded as { questions: unknown[] }).questions
        : null;

    if (!rawList) {
      throw new Error(
        'O arquivo JSON deve conter um array de questões ou um objeto com a chave "questions".',
      );
    }

    const parsedQuestions = rawList.map((entry) => {
      if (typeof entry !== 'object' || entry === null) {
        throw new Error('Cada item do JSON de questões deve ser um objeto.');
      }
      return normalizeImportedQuestion(entry as Record<string, unknown>);
    });

    return this.applyImportedQuestions(parsedQuestions, mode);
  }

  async importQuestionsCsv(
    csvContent: string,
    mode: QuestionsImportMode,
  ): Promise<QuestionsImportResult> {
    this.requireAdmin();

    const rows = parseCsvRows(csvContent);
    if (rows.length < 2) {
      throw new Error('O arquivo CSV deve conter cabeçalho e ao menos uma linha de questão.');
    }

    const headers = rows[0].map((col) => col.trim().toLowerCase());
    const findHeaderIndex = (names: string[]) =>
      headers.findIndex((header) => names.includes(header));

    const textCol = findHeaderIndex(['text', 'enunciado', 'question']);
    const optACol = findHeaderIndex(['optiona', 'a', 'opt0']);
    const optBCol = findHeaderIndex(['optionb', 'b', 'opt1']);
    const optCCol = findHeaderIndex(['optionc', 'c', 'opt2']);
    const optDCol = findHeaderIndex(['optiond', 'd', 'opt3']);
    const correctCol = findHeaderIndex(['correctindex', 'correct', 'correta']);
    const diffCol = findHeaderIndex(['difficulty', 'dificuldade']);
    const tagsCol = findHeaderIndex(['tags']);
    const disabledCol = findHeaderIndex(['isdisabled', 'disabled', 'desabilitada']);

    if (
      textCol < 0 ||
      optACol < 0 ||
      optBCol < 0 ||
      optCCol < 0 ||
      optDCol < 0 ||
      correctCol < 0
    ) {
      throw new Error(
        'Cabeçalho CSV inválido. Colunas obrigatórias: text, optionA, optionB, optionC, optionD, correctIndex.',
      );
    }

    const parsedQuestions = rows.slice(1).map((row) =>
      normalizeImportedQuestion({
        text: row[textCol] ?? '',
        options: [row[optACol] ?? '', row[optBCol] ?? '', row[optCCol] ?? '', row[optDCol] ?? ''],
        correctIndex: row[correctCol] ?? '',
        difficulty: diffCol >= 0 ? row[diffCol] : 'moderado',
        tags: tagsCol >= 0 ? row[tagsCol] : '',
        isDisabled: disabledCol >= 0 ? row[disabledCol] : false,
      }),
    );

    return this.applyImportedQuestions(parsedQuestions, mode);
  }

  private async applyImportedQuestions(
    parsedQuestions: QuestionUpsertInput[],
    mode: QuestionsImportMode,
  ): Promise<QuestionsImportResult> {
    if (mode === 'replace') {
      const normalized = parsedQuestions.map((item, idx) => buildQuestionEntity(idx + 1, item));
      const saved = await this.cloudGateway.replaceAllQuestions(normalized);
      await this.notifyActiveEventsQuestionsChanged();
      return {
        importedCount: saved.length,
        totalAfterImport: saved.length,
        mode,
      };
    }

    const existing = await this.cloudGateway.listAllQuestions();
    let nextId = existing.reduce((acc, q) => Math.max(acc, q.id), 0);
    const existingByText = new Map(existing.map((q) => [q.text.trim().toLowerCase(), q]));
    let importedCount = 0;

    for (const item of parsedQuestions) {
      const existingMatch = existingByText.get(item.text.trim().toLowerCase());
      if (existingMatch) {
        // No modo merge, atualiza questão existente com mesmo enunciado em vez de duplicar.
        await this.cloudGateway.saveQuestion(buildQuestionEntity(existingMatch.id, item));
      } else {
        nextId += 1;
        await this.cloudGateway.saveQuestion(buildQuestionEntity(nextId, item));
      }
      importedCount += 1;
    }

    if (importedCount > 0) {
      await this.notifyActiveEventsQuestionsChanged();
    }

    const finalList = await this.cloudGateway.listAllQuestions();
    return {
      importedCount,
      totalAfterImport: finalList.length,
      mode,
    };
  }

  markDirty(section: DirtySection, dirty = true): void {
    if (dirty) {
      this.dirtySections.add(section);
    } else {
      this.dirtySections.delete(section);
    }
  }

  clearDirty(section?: DirtySection): void {
    if (section) {
      this.dirtySections.delete(section);
      return;
    }
    this.dirtySections.clear();
  }

  isDirty(section?: DirtySection): boolean {
    if (section) {
      return this.dirtySections.has(section);
    }
    return this.dirtySections.size > 0;
  }

  getDirtySections(): DirtySection[] {
    return Array.from(this.dirtySections);
  }

  checkUnsavedNavigation(): UnsavedNavigationPrompt {
    const sections = this.getDirtySections();
    if (sections.length === 0) {
      return {
        canProceedImmediately: true,
        dirtySections: [],
        message: '',
        options: ['save_and_leave', 'discard_and_leave', 'cancel'],
      };
    }

    const labels = sections.map((sec) => DIRTY_SECTION_LABELS[sec]).join(', ');
    return {
      canProceedImmediately: false,
      dirtySections: sections,
      message: `Existem alterações não salvas em: ${labels}. Deseja salvar antes de sair?`,
      options: ['save_and_leave', 'discard_and_leave', 'cancel'],
    };
  }

  async resolveUnsavedNavigation(
    resolution: UnsavedChangesResolution,
    onSave?: () => Promise<void>,
  ): Promise<boolean> {
    if (resolution === 'cancel') {
      return false;
    }
    if (resolution === 'save_and_leave') {
      if (onSave) {
        await onSave();
      }
      this.dirtySections.clear();
      return true;
    }
    this.dirtySections.clear();
    return true;
  }

  async authorizeTotemPairing(input: AuthorizeTotemPairingInput): Promise<TotemRecord> {
    this.requireAdmin();

    const name = input.name.trim();
    if (!name) {
      throw new Error('O nome do Totem é obrigatório.');
    }

    const pinCode = input.pinCode.trim();
    if (!/^\d{4,8}$/.test(pinCode)) {
      throw new Error('O PIN local do Totem deve conter entre 4 e 8 dígitos numéricos.');
    }

    const events = await this.cloudGateway.listEvents();
    if (!events.some((ev) => ev.id === input.eventId)) {
      throw new Error('Evento selecionado para Pareamento não encontrado.');
    }

    const pairingCode = input.pairingCode?.trim()
      ? normalizePairingCode(input.pairingCode)
      : generateShortPairingCode(this.random, 6);
    if (!/^[A-Z0-9]{4,12}$/.test(pairingCode)) {
      throw new Error(
        'Código de Pareamento inválido. Utilize de 4 a 12 caracteres alfanuméricos.',
      );
    }

    return this.cloudGateway.authorizeTotemPairing({
      id: this.random.uuid(),
      pairingCode,
      deviceToken: this.random.uuid(),
      name,
      pinCode,
      eventId: input.eventId,
    });
  }

  buildTotemActivationLink(pairingCode: string, baseOrigin = ''): string {
    return buildTotemActivationLink(pairingCode, baseOrigin);
  }

  async listTotems(): Promise<TotemRecord[]> {
    this.requireAdmin();
    const totems = await this.cloudGateway.listTotems();
    const nowMs = this.clock ? this.clock.now() : Date.now();
    return totems.map((totem) => {
      if (totem.onlineStatus !== 'online' || !totem.lastSeenAt) {
        return totem;
      }
      const lastSeenMs = Date.parse(totem.lastSeenAt);
      if (Number.isFinite(lastSeenMs) && nowMs - lastSeenMs > TOTEM_HEARTBEAT_STALE_MS) {
        return {
          ...totem,
          onlineStatus: 'offline',
        };
      }
      return totem;
    });
  }

  subscribeTotemUpdates(listener: (event: TotemChannelEvent) => void): () => void {
    return this.cloudGateway.subscribeTotemChannel(listener);
  }

  async dispatchRemoteCommand(input: DispatchRemoteCommandInput): Promise<RemoteCommandPayload> {
    this.requireAdmin();

    if (!input.targetTotemId && !input.targetEventId) {
      throw new Error('Informe um Totem ou Evento de destino para o comando remoto.');
    }

    let targetConfigVersion: number | undefined;
    if (input.type === 'SWITCH_EVENT') {
      if (!input.eventId) {
        throw new Error('Informe o Evento de destino para trocar.');
      }
      const events = await this.cloudGateway.listEvents();
      const targetEvent = events.find((ev) => ev.id === input.eventId);
      if (!targetEvent) {
        throw new Error(`Evento de destino não encontrado (${input.eventId}).`);
      }
      targetConfigVersion = targetEvent.configVersion;
    }

    const command: RemoteCommandPayload = {
      id: this.random.uuid(),
      type: input.type,
      targetTotemId: input.targetTotemId ?? null,
      targetEventId: input.targetEventId ?? null,
      eventId: input.eventId,
      targetScreen: input.targetScreen,
      configVersion: targetConfigVersion,
      issuedAt: this.nowIso(),
    };

    return this.cloudGateway.dispatchRemoteCommand(command);
  }

  async switchTotemEvent(
    target: { totemId?: string; eventId?: string },
    newEventId: string,
  ): Promise<RemoteCommandPayload> {
    return this.dispatchRemoteCommand({
      type: 'SWITCH_EVENT',
      targetTotemId: target.totemId ?? null,
      targetEventId: target.eventId ?? null,
      eventId: newEventId,
      targetScreen: 'initial-screen',
    });
  }

  async forceSyncTotems(target: { totemId?: string; eventId?: string }): Promise<RemoteCommandPayload> {
    return this.dispatchRemoteCommand({
      type: 'FORCE_SYNC',
      targetTotemId: target.totemId ?? null,
      targetEventId: target.eventId ?? null,
    });
  }

  async reloadTotemScreen(
    target: { totemId?: string; eventId?: string },
    targetScreen: 'initial-screen' | 'idle-screen' = 'initial-screen',
  ): Promise<RemoteCommandPayload> {
    return this.dispatchRemoteCommand({
      type: 'RELOAD_SCREEN',
      targetTotemId: target.totemId ?? null,
      targetEventId: target.eventId ?? null,
      targetScreen,
    });
  }

  private async notifyOperationalEventUpdate(eventId: string): Promise<void> {
    const events = await this.cloudGateway.listEvents();
    const targetEvent = events.find((ev) => ev.id === eventId);
    if (!targetEvent) {
      return;
    }

    if (this.session?.user.role === 'admin') {
      await this.bumpAndNotifyEvent(targetEvent);
      return;
    }

    await this.dispatchConfigUpdatedForEvent(targetEvent.id, targetEvent.configVersion);
  }

  private async fetchOperationalCloudData(eventId?: string): Promise<{
    events: EventConfig[];
    eventsById: Map<string, EventConfig>;
    matches: MatchRecord[];
    claims: PrizeClaimRecord[];
    lockouts: GiveUpLockoutRecord[];
  }> {
    const [events, matches, claims, lockouts] = await Promise.all([
      this.cloudGateway.listEvents(),
      this.cloudGateway.listMatches(eventId),
      this.cloudGateway.listPrizeClaims(eventId),
      this.cloudGateway.listGiveUpLockouts(eventId),
    ]);

    return {
      events,
      eventsById: new Map(events.map((event) => [event.id, event])),
      matches,
      claims,
      lockouts,
    };
  }

  async getOperatorDashboard(eventId?: string): Promise<OperatorEventSnapshot> {
    this.requireStaff();
    const { events, eventsById, matches, claims, lockouts } =
      await this.fetchOperationalCloudData(eventId);

    const targetEvent = eventId
      ? events.find((event) => event.id === eventId)
      : (events.find((event) => event.isActive) ?? events[0]);

    if (!targetEvent) {
      throw new Error(
        eventId
          ? `Evento não encontrado (${eventId}).`
          : 'Nenhum Evento cadastrado para operar no estande.',
      );
    }

    const eventMatches = matches.filter((match) => match.eventId === targetEvent.id);
    const eventClaims = claims.filter((claim) => claim.eventId === targetEvent.id);
    const eventLockouts = lockouts.filter((lockout) => lockout.eventId === targetEvent.id);
    const nowMs = this.clock ? this.clock.now() : Date.now();

    const { items, rankingByEvent, offlineConflicts } = buildParticipantReportItems({
      eventsById,
      matches: eventMatches,
      claims: eventClaims,
      lockouts: eventLockouts,
      nowMs,
    });

    const awaitingPickupQueue = items
      .filter((item) => item.prizeStatus === 'awaiting_pickup')
      .sort((a, b) => (a.awardedAt ?? a.playedAt).localeCompare(b.awardedAt ?? b.playedAt));

    const recentParticipants = [...items].sort((a, b) => b.playedAt.localeCompare(a.playedAt));

    return {
      event: targetEvent,
      awaitingPickupQueue,
      recentParticipants,
      ranking: rankingByEvent.get(targetEvent.id) ?? [],
      activeLockouts: eventLockouts.filter((lockout) => isLockoutActiveAt(lockout, nowMs)),
      offlineConflicts,
    };
  }

  private async applyPrizeStatusAndNotify(
    claimIds: string[],
    status: 'delivered' | 'revoked',
    deliveredAt: string | null,
  ): Promise<PrizeClaimRecord[]> {
    const updated = await this.cloudGateway.updatePrizeClaimsStatus(claimIds, status, deliveredAt);
    const affectedEventIds = new Set(updated.map((claim) => claim.eventId));
    for (const eventId of affectedEventIds) {
      await this.notifyOperationalEventUpdate(eventId);
    }
    return updated;
  }

  async confirmPrizeDeliveries(claimIds: string[]): Promise<PrizeClaimRecord[]> {
    this.requireStaff();
    return this.applyPrizeStatusAndNotify(claimIds, 'delivered', this.nowIso());
  }

  async revokePrizeClaims(claimIds: string[]): Promise<PrizeClaimRecord[]> {
    this.requireStaff();
    const requestedSet = new Set(claimIds);
    if (requestedSet.size === 0) {
      return [];
    }

    const allClaims = await this.cloudGateway.listPrizeClaims();
    const remainingActiveKeys = new Set(
      allClaims
        .filter(
          (claim) =>
            !requestedSet.has(claim.id) &&
            (claim.status === 'awaiting_pickup' || claim.status === 'delivered'),
        )
        .map((claim) => toEventPhoneKey(claim.eventId, claim.participantPhone)),
    );
    const revokedKeys = new Set(
      allClaims
        .filter((claim) => requestedSet.has(claim.id))
        .map((claim) => toEventPhoneKey(claim.eventId, claim.participantPhone)),
    );

    // Se nenhuma premiação ativa restar ao telefone no Evento, revoga também conflitos offline órfãos.
    const expandedClaimIds = new Set(requestedSet);
    for (const claim of allClaims) {
      if (claim.status !== 'offline_duplicate_conflict') {
        continue;
      }
      const key = toEventPhoneKey(claim.eventId, claim.participantPhone);
      if (revokedKeys.has(key) && !remainingActiveKeys.has(key)) {
        expandedClaimIds.add(claim.id);
      }
    }

    return this.applyPrizeStatusAndNotify(Array.from(expandedClaimIds), 'revoked', null);
  }

  async revokePhonePrizeInEvent(
    eventId: string,
    participantPhone: string,
  ): Promise<PrizeClaimRecord[]> {
    this.requireStaff();
    const normalizedTargetDigits = normalizePhoneDigits(participantPhone);
    const targetTrimmed = participantPhone.trim();
    const claims = await this.cloudGateway.listPrizeClaims(eventId);
    const targetClaimIds = claims
      .filter(
        (claim) =>
          claim.status !== 'revoked' &&
          (claim.participantPhone === targetTrimmed ||
            (normalizedTargetDigits.length > 0 &&
              normalizePhoneDigits(claim.participantPhone) === normalizedTargetDigits)),
      )
      .map((claim) => claim.id);

    if (targetClaimIds.length === 0) {
      return [];
    }

    return this.revokePrizeClaims(targetClaimIds);
  }

  async unlockParticipantPhones(eventId: string, participantPhones: string[]): Promise<number> {
    this.requireStaff();
    const unlockedCount = await this.cloudGateway.expireGiveUpLockouts(eventId, participantPhones);
    if (unlockedCount > 0) {
      await this.notifyOperationalEventUpdate(eventId);
    }
    return unlockedCount;
  }

  async deleteParticipantMatches(matchIds: string[]): Promise<string[]> {
    this.requireAdmin();
    const uniqueIds = Array.from(new Set(matchIds));
    if (uniqueIds.length === 0) {
      return [];
    }

    const matches = await this.cloudGateway.listMatches();
    const uniqueSet = new Set(uniqueIds);
    const targetMatches = matches.filter((match) => uniqueSet.has(match.id));
    const affectedEventIds = new Set(targetMatches.map((match) => match.eventId));
    const affectedEventPhones = new Set(
      targetMatches.map((match) => toEventPhoneKey(match.eventId, match.participantPhone)),
    );

    const deletedIds = await this.cloudGateway.deleteMatches(uniqueIds);
    if (deletedIds.length > 0) {
      for (const eventId of affectedEventIds) {
        const remainingClaims = await this.cloudGateway.listPrizeClaims(eventId);
        const remainingActiveKeys = new Set(
          remainingClaims
            .filter((c) => c.status === 'awaiting_pickup' || c.status === 'delivered')
            .map((c) => toEventPhoneKey(c.eventId, c.participantPhone)),
        );
        const orphanConflictIds = remainingClaims
          .filter(
            (c) =>
              c.status === 'offline_duplicate_conflict' &&
              affectedEventPhones.has(toEventPhoneKey(c.eventId, c.participantPhone)) &&
              !remainingActiveKeys.has(toEventPhoneKey(c.eventId, c.participantPhone)),
          )
          .map((c) => c.id);

        if (orphanConflictIds.length > 0) {
          await this.cloudGateway.updatePrizeClaimsStatus(orphanConflictIds, 'revoked', null);
        }

        await this.bumpEventConfigVersion(eventId);
      }
    }

    return deletedIds;
  }

  private async buildFilteredParticipantItems(
    options: ParticipantReportFilterOptions = {},
  ): Promise<{
    items: ParticipantReportItem[];
    offlineConflicts: OfflinePrizeConflictAlert[];
    activeLockouts: ActiveGiveUpLockoutItem[];
  }> {
    const scopedEventId =
      options.eventId && options.eventId !== 'all' ? options.eventId : undefined;
    const { eventsById, matches, claims, lockouts } =
      await this.fetchOperationalCloudData(scopedEventId);

    const nowMs = this.clock ? this.clock.now() : Date.now();
    const { items, offlineConflicts } = buildParticipantReportItems({
      eventsById,
      matches,
      claims,
      lockouts,
      nowMs,
    });

    const searchRaw = options.search?.trim() ?? '';
    const startMs = options.startDate ? parseFilterDateBoundary(options.startDate, 'start') : null;
    const endMs = options.endDate ? parseFilterDateBoundary(options.endDate, 'end') : null;
    const prizeFilter = options.prizeFilter ?? 'all';
    const exactScore =
      typeof options.exactScore === 'number' && Number.isFinite(options.exactScore)
        ? options.exactScore
        : null;

    const filtered = items.filter((item) => {
      if (
        searchRaw &&
        !matchesParticipantSearch(item.participantName, item.participantPhone, searchRaw)
      ) {
        return false;
      }

      const playedMs = Date.parse(item.playedAt);
      if (startMs !== null && Number.isFinite(startMs) && playedMs < startMs) {
        return false;
      }
      if (endMs !== null && Number.isFinite(endMs) && playedMs > endMs) {
        return false;
      }

      if (!matchesPrizeFilter(item, prizeFilter)) {
        return false;
      }

      if (options.onlyLockedOut && !item.hasActiveGiveUpLockout) {
        return false;
      }

      if (exactScore !== null && item.score !== exactScore) {
        return false;
      }

      return true;
    });

    const sortBy = options.sortBy ?? 'playedAt';
    const sortDirection = options.sortDirection ?? 'desc';
    const sorted = [...filtered].sort((a, b) =>
      compareParticipantReportItems(a, b, sortBy, sortDirection),
    );

    const activeLockouts: ActiveGiveUpLockoutItem[] = lockouts
      .filter((lockout) => {
        if (!isLockoutActiveAt(lockout, nowMs)) {
          return false;
        }
        if (searchRaw && !matchesParticipantSearch('', lockout.participantPhone, searchRaw)) {
          return false;
        }
        const lockedMs = Date.parse(lockout.lockedAt);
        if (startMs !== null && Number.isFinite(startMs) && lockedMs < startMs) {
          return false;
        }
        if (endMs !== null && Number.isFinite(endMs) && lockedMs > endMs) {
          return false;
        }
        return true;
      })
      .map((lockout) => ({
        ...lockout,
        eventName: eventsById.get(lockout.eventId)?.name ?? lockout.eventId,
      }));

    return { items: sorted, offlineConflicts, activeLockouts };
  }

  async queryParticipantReports(
    options: ParticipantReportFilterOptions = {},
  ): Promise<PaginatedParticipantReportResult> {
    this.requireStaff();
    const { items, offlineConflicts, activeLockouts } =
      await this.buildFilteredParticipantItems(options);

    const pageSize = Math.max(1, Math.floor(options.pageSize ?? 20));
    const totalItems = items.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const page = Math.min(Math.max(1, Math.floor(options.page ?? 1)), totalPages);
    const startIndex = (page - 1) * pageSize;

    return {
      items: items.slice(startIndex, startIndex + pageSize),
      totalItems,
      page,
      pageSize,
      totalPages,
      offlineConflicts,
      activeLockouts,
    };
  }

  async getParticipantMatchDetails(matchId: string): Promise<ParticipantMatchDetails> {
    this.requireStaff();
    const allMatches = await this.cloudGateway.listMatches();
    const targetMatch = allMatches.find((match) => match.id === matchId);
    if (!targetMatch) {
      throw new Error(`Partida não encontrada (${matchId}).`);
    }

    const [events, eventClaims, eventLockouts] = await Promise.all([
      this.cloudGateway.listEvents(),
      this.cloudGateway.listPrizeClaims(targetMatch.eventId),
      this.cloudGateway.listGiveUpLockouts(targetMatch.eventId),
    ]);

    const eventsById = new Map(events.map((event) => [event.id, event]));
    const eventMatches = allMatches.filter((match) => match.eventId === targetMatch.eventId);
    const nowMs = this.clock ? this.clock.now() : Date.now();

    const { items } = buildParticipantReportItems({
      eventsById,
      matches: eventMatches,
      claims: eventClaims,
      lockouts: eventLockouts,
      nowMs,
    });

    const targetItem = items.find((item) => item.matchId === matchId);
    if (!targetItem) {
      throw new Error(`Dados da Partida não encontrados (${matchId}).`);
    }

    const matchesAtOccasion = eventMatches.filter(
      (match) => match.playedAt <= targetMatch.playedAt,
    );
    const { rankByMatchId: occasionRanks } = computeEventRankings(matchesAtOccasion);
    const totalMatchesByPhoneInEvent = eventMatches.filter(
      (match) => match.participantPhone === targetMatch.participantPhone,
    ).length;

    return {
      ...targetItem,
      rankingPosition: occasionRanks.get(matchId) ?? targetItem.rankingPosition,
      totalMatchesByPhoneInEvent,
      answers: structuredClone(targetMatch.answers),
    };
  }

  async exportParticipantsCsv(options: ParticipantReportFilterOptions = {}): Promise<string> {
    this.requireStaff();
    const { items } = await this.buildFilteredParticipantItems(options);
    const headers = [
      'matchId',
      'eventId',
      'eventName',
      'participantName',
      'participantPhone',
      'score',
      'totalQuestions',
      'timeSeconds',
      'rankingPosition',
      'playedAt',
      'prizeStatus',
      'deliveredAt',
      'hasOfflineConflict',
      'hasActiveGiveUpLockout',
    ];

    const lines = [
      headers.join(','),
      ...items.map((item) =>
        [
          item.matchId,
          item.eventId,
          item.eventName,
          item.participantName,
          item.participantPhone,
          item.score,
          item.totalQuestions,
          item.timeSeconds,
          item.rankingPosition,
          item.playedAt,
          item.prizeStatus ?? 'none',
          item.deliveredAt ?? '',
          item.hasOfflineConflict,
          item.hasActiveGiveUpLockout,
        ]
          .map((value) => escapeCsvField(value))
          .join(','),
      ),
    ];

    return lines.join('\n');
  }

  async exportParticipantsJson(options: ParticipantReportFilterOptions = {}): Promise<string> {
    this.requireStaff();
    const { items } = await this.buildFilteredParticipantItems(options);
    return JSON.stringify(items, null, 2);
  }

  async uploadEventVisualAsset(
    input: EventVisualAssetUploadInput,
  ): Promise<{ url: string; fileName: string }> {
    this.requireAdmin();
    if (!input.bytes || input.bytes.length === 0) {
      throw new Error('Selecione um arquivo de imagem válido para upload.');
    }
    return this.cloudGateway.uploadEventVisualAsset(input);
  }

  async saveEventCustomizations(
    eventId: string,
    customizations: EventCustomizationsPatch | EventCustomizations,
  ): Promise<EventConfig> {
    this.requireAdmin();
    const rawOpacity = customizations.visualIdentity?.customBackgroundOpacity;
    const normalizedPatch: EventCustomizationsPatch =
      rawOpacity !== undefined
        ? {
            ...customizations,
            visualIdentity: {
              ...customizations.visualIdentity,
              customBackgroundOpacity: Math.min(1, Math.max(0, rawOpacity)),
            },
          }
        : customizations;

    const updated = await this.updateEvent(eventId, { customizations: normalizedPatch });
    this.clearDirty('customization');
    return updated;
  }

  async queryAnalyticsDashboard(
    options: AnalyticsQueryOptions = {},
  ): Promise<AnalyticsDashboardResult> {
    this.requireAdmin();
    const scopedEventId =
      options.eventId && options.eventId !== 'all' ? options.eventId : undefined;
    const [events, questions, matches] = await Promise.all([
      this.cloudGateway.listEvents(),
      this.cloudGateway.listAllQuestions(),
      this.cloudGateway.listMatches(scopedEventId),
    ]);
    const nowMs = this.clock ? this.clock.now() : Date.now();
    return computeAnalyticsDashboard({ events, questions, matches, options, nowMs });
  }

  async queryQuestionStats(
    options: QuestionStatsQueryOptions = {},
  ): Promise<QuestionStatsResult> {
    this.requireAdmin();
    const scopedEventId =
      options.eventId && options.eventId !== 'all' ? options.eventId : undefined;
    const [questions, matches] = await Promise.all([
      this.cloudGateway.listAllQuestions(),
      this.cloudGateway.listMatches(scopedEventId),
    ]);
    return computeQuestionStatsReport({ questions, matches, options });
  }

  async exportFullBackup(): Promise<string> {
    this.requireAdmin();
    const [events, questions, matches, prizeClaims, lockouts] = await Promise.all([
      this.cloudGateway.listEvents(),
      this.cloudGateway.listAllQuestions(),
      this.cloudGateway.listMatches(),
      this.cloudGateway.listPrizeClaims(),
      this.cloudGateway.listGiveUpLockouts(),
    ]);

    const eventQuestionLinks: Record<string, number[]> = {};
    for (const event of events) {
      eventQuestionLinks[event.id] = await this.cloudGateway.getEventQuestionIds(event.id);
    }

    const payload: PlatformBackupPayload = {
      formatVersion: 1,
      exportedAt: this.nowIso(),
      events,
      eventQuestionLinks,
      questions,
      matches,
      prizeClaims,
      lockouts,
    };

    return JSON.stringify(payload, null, 2);
  }

  async restoreBackup(
    rawJson: string,
    options: { targetEventId?: string } = {},
  ): Promise<BackupRestoreResult> {
    this.requireAdmin();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      throw new Error('Arquivo JSON de backup inválido ou malformado.');
    }

    if (isPlatformBackupPayload(parsed)) {
      const savedQuestions = await this.cloudGateway.replaceAllQuestions(parsed.questions);
      const savedEventIds: string[] = [];
      for (const ev of parsed.events) {
        const bumped: EventConfig = {
          ...structuredClone(ev),
          configVersion: ev.configVersion + 1,
        };
        const saved = await this.cloudGateway.saveEvent(bumped);
        savedEventIds.push(saved.id);
        const linkedIds = parsed.eventQuestionLinks?.[ev.id];
        if (Array.isArray(linkedIds) && linkedIds.length > 0) {
          await this.cloudGateway.setEventQuestions(saved.id, linkedIds);
        }
      }

      await this.cloudGateway.importOperationalRecords({
        matches: parsed.matches ?? [],
        prizeClaims: parsed.prizeClaims ?? [],
        lockouts: parsed.lockouts ?? [],
        replaceEventIds: savedEventIds,
      });

      for (const eventId of savedEventIds) {
        await this.notifyOperationalEventUpdate(eventId);
      }

      return {
        sourceFormat: 'platform',
        targetEventId: savedEventIds[0] ?? '',
        importedQuestionsCount: savedQuestions.length,
        remappedAnswersCount: 0,
        importedEventsCount: savedEventIds.length,
        importedMatchesCount: parsed.matches?.length ?? 0,
        importedPrizeClaimsCount: parsed.prizeClaims?.length ?? 0,
        importedLockoutsCount: parsed.lockouts?.length ?? 0,
      };
    }

    if (isLegacyQuizOfflineBackup(parsed)) {
      const existingEvents = await this.cloudGateway.listEvents();
      let targetEvent = options.targetEventId
        ? existingEvents.find((ev) => ev.id === options.targetEventId)
        : (existingEvents.find((ev) => ev.isActive) ?? existingEvents[0]);

      if (!targetEvent) {
        targetEvent = await this.createEvent({
          name: parsed.quizCurrentEvent?.eventName?.trim() || 'Evento Migrado (quiz-offline)',
          isActive: true,
        });
      }

      const migrated = convertLegacyBackupToDomain({
        legacy: parsed,
        targetEvent,
        random: this.random,
        nowIso: this.nowIso(),
      });

      const existingQuestions = await this.cloudGateway.listAllQuestions();
      const existingByText = new Map(
        existingQuestions.map((question) => [question.text.trim().toLowerCase(), question]),
      );
      let nextCentralId = existingQuestions.reduce(
        (maxId, question) => Math.max(maxId, question.id),
        0,
      );

      const legacyToCentralId = new Map<number, number>();
      const linkedQuestionIds: number[] = [];

      for (const question of migrated.questions) {
        const existingMatch = existingByText.get(question.text.trim().toLowerCase());
        if (existingMatch) {
          legacyToCentralId.set(question.id, existingMatch.id);
          linkedQuestionIds.push(existingMatch.id);
        } else {
          nextCentralId += 1;
          const savedQuestion = await this.cloudGateway.saveQuestion({
            ...question,
            id: nextCentralId,
          });
          existingByText.set(savedQuestion.text.trim().toLowerCase(), savedQuestion);
          legacyToCentralId.set(question.id, savedQuestion.id);
          linkedQuestionIds.push(savedQuestion.id);
        }
      }

      const remappedMatches = migrated.matches.map((match) => ({
        ...match,
        answers: match.answers.map((answer) => ({
          ...answer,
          questionId: legacyToCentralId.get(answer.questionId) ?? answer.questionId,
        })),
      }));

      await this.cloudGateway.saveEvent(migrated.updatedEvent);
      await this.cloudGateway.setEventQuestions(
        migrated.updatedEvent.id,
        Array.from(new Set(linkedQuestionIds)),
      );

      await this.cloudGateway.importOperationalRecords({
        matches: remappedMatches,
        prizeClaims: migrated.prizeClaims,
        lockouts: migrated.lockouts,
        replaceEventIds: [migrated.updatedEvent.id],
      });

      await this.dispatchConfigUpdatedForEvent(
        migrated.updatedEvent.id,
        migrated.updatedEvent.configVersion,
      );

      return {
        sourceFormat: 'legacy_quiz_offline',
        targetEventId: migrated.updatedEvent.id,
        importedQuestionsCount: migrated.questions.length,
        remappedAnswersCount: migrated.remappedAnswersCount,
        importedEventsCount: 1,
        importedMatchesCount: migrated.matches.length,
        importedPrizeClaimsCount: migrated.prizeClaims.length,
        importedLockoutsCount: migrated.lockouts.length,
      };
    }

    throw new Error(
      'Formato de backup não reconhecido. Envie um JSON exportado por esta plataforma ou pelo quiz-offline.',
    );
  }
}
