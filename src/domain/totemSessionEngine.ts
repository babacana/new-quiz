import {
  DEFAULT_CUSTOMIZATIONS,
  DEFAULT_EVENT_CONFIG,
  DEFAULT_QUIZ_QUESTIONS,
  DEFAULT_SETTINGS,
  TIMEOUT_OPTION_TEXT,
} from './defaults';
import {
  buildTotemActivationLink,
  extractPairingCodeFromInput,
  generateShortPairingCode,
} from './pairingUtils';
import type { Clock, CloudEventSnapshot, CloudGateway, LocalStore, RandomSource } from './ports';
import type {
  ActiveQuestionState,
  AnswerOutcome,
  BorderPulseState,
  DifficultyLevel,
  DifficultyPercentages,
  EventConfig,
  EventCustomizationTexts,
  EventSettings,
  EventWindowState,
  EventWindowStatus,
  GiveUpLockoutRecord,
  IdleTimingConfig,
  IncorrectAnswerReviewItem,
  MatchAnswer,
  MatchRecord,
  MatchResultSummary,
  PreparedQuestion,
  PrizeClaimRecord,
  PrizeClaimStatus,
  Question,
  QuestionTimeVisualState,
  RankingEntry,
  RemoteCommandPayload,
  StartMatchResult,
  TimeBarPhase,
  TotemChannelEvent,
  TotemConfigSnapshot,
  TotemLocalDiagnostics,
  TotemPairingStatus,
  TotemRecord,
  TotemScreenId,
  TotemSessionSnapshot,
} from './types';

const BRAZIL_PHONE_REGEX = /^\(\d{2}\)\s\d{4,5}-\d{4}$/;
const MIN_IDLE_TIMEOUT_SECONDS = 15;
const MIN_FADE_OUT_LEAD_SECONDS = 3;

// Normaliza o nome do Participante mantendo apenas letras Latin-1, acentos e espaços em maiúsculas.
export function normalizeParticipantName(rawName: string): string {
  return rawName.replace(/[^a-zA-Z\sÀ-ÖØ-öø-ÿ]/g, '').toUpperCase();
}

// Formata dígitos numéricos para a máscara brasileira (XX) XXXXX-XXXX ou (XX) XXXX-XXXX.
export function formatPhoneMask(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '').slice(0, 11);
  if (digits.length === 0) {
    return '';
  }

  let formatted = `(${digits.slice(0, 2)}`;
  if (digits.length <= 2) {
    return formatted;
  }

  if (digits.length <= 6) {
    formatted += `) ${digits.slice(2)}`;
    return formatted;
  }

  const firstBlockEnd = digits.length > 10 ? 7 : 6;
  formatted += `) ${digits.slice(2, firstBlockEnd)}-${digits.slice(firstBlockEnd)}`;
  return formatted;
}

export function isValidBrazilPhone(phone: string): boolean {
  return BRAZIL_PHONE_REGEX.test(phone.trim());
}

function isActivePrizeClaim(claim: PrizeClaimRecord): boolean {
  return claim.status === 'delivered' || claim.status === 'awaiting_pickup';
}

export interface TotemSessionEngineDependencies {
  localStore: LocalStore;
  cloudGateway: CloudGateway;
  clock: Clock;
  random: RandomSource;
  requirePairing?: boolean;
}

interface ActiveMatchInternal {
  participantName: string;
  participantPhone: string;
  startedAtMs: number;
  questions: PreparedQuestion[];
  answers: MatchAnswer[];
  currentIndex: number;
  score: number;
  hasAnswered: boolean;
  isTimedOut: boolean;
  selectedOptionIndex: number | null;
  revealedCorrectOptionIndex: number | null;
}

// Motor de sessão Offline-First do Totem, desacoplado da camada visual e de infraestrutura.
export class TotemSessionEngine {
  private readonly localStore: LocalStore;
  private readonly cloudGateway: CloudGateway;
  private readonly clock: Clock;
  private readonly random: RandomSource;
  private readonly requirePairing: boolean;

  private initialized = false;
  private screen: TotemScreenId = 'initial-screen';
  private totemConfig: TotemConfigSnapshot = {
    totemId: null,
    totemName: null,
    pairingCode: null,
    deviceToken: null,
    pinCode: '0000',
    event: structuredClone(DEFAULT_EVENT_CONFIG),
  };
  private questions: Question[] = structuredClone(DEFAULT_QUIZ_QUESTIONS);
  private activeMatch: ActiveMatchInternal | null = null;
  private lastResult: MatchResultSummary | null = null;
  private rankingCache: RankingEntry[] = [];
  private alreadyWonModal: { participantPhone: string; awardedAt: string } | null = null;
  private pendingSyncCount = 0;
  private lastValidationError: string | null = null;
  private syncInFlight: Promise<{ synced: number; failed: number; pending: number }> | null = null;
  private pairingStatus: TotemPairingStatus = 'unpaired';
  private deviceOnlineOverride: boolean | null = null;
  private deferredCommands: RemoteCommandPayload[] = [];
  private stagedSnapshotsByEventId = new Map<string, CloudEventSnapshot>();
  private readonly processedCommandIds = new Set<string>();
  private lastHeartbeatAt: string | null = null;
  private readonly snapshotListeners = new Set<(snapshot: TotemSessionSnapshot) => void>();
  private readonly channelUnsubscribe: () => void;

  constructor(deps: TotemSessionEngineDependencies) {
    this.localStore = deps.localStore;
    this.cloudGateway = deps.cloudGateway;
    this.clock = deps.clock;
    this.random = deps.random;
    this.requirePairing = deps.requirePairing ?? false;
    this.channelUnsubscribe = this.cloudGateway.subscribeTotemChannel((event) =>
      this.handleChannelEvent(event),
    );
  }

  subscribe(listener: (snapshot: TotemSessionSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  dispose(): void {
    this.channelUnsubscribe();
    this.snapshotListeners.clear();
  }

  private notifySubscribers(): void {
    if (this.snapshotListeners.size === 0) {
      return;
    }
    const snap = this.getSnapshot();
    for (const listener of this.snapshotListeners) {
      listener(structuredClone(snap));
    }
  }

  private get eventSettings(): EventSettings {
    return this.totemConfig.event.settings;
  }

  private get customizationTexts(): EventCustomizationTexts {
    return this.totemConfig.event.customizations.texts;
  }

  getNowMs(): number {
    return this.clock.now();
  }

  getElapsedMatchSeconds(): number {
    if (!this.activeMatch) {
      return 0;
    }
    return Math.max(0, Math.floor((this.clock.now() - this.activeMatch.startedAtMs) / 1000));
  }

  private formatEventDateTimePtBr(timestampMs: number): string {
    return new Date(timestampMs).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // Avalia a janela temporal do Evento em relação ao relógio do Totem.
  getEventWindowState(): EventWindowState {
    const event = this.totemConfig.event;
    const defaultCallToAction =
      this.customizationTexts.idleScreenCallToAction ||
      DEFAULT_CUSTOMIZATIONS.texts.idleScreenCallToAction;

    let status: EventWindowStatus = 'no_event';
    let startMs = Number.NaN;
    let endMs = Number.NaN;

    if (event.startTime && event.endTime) {
      startMs = new Date(event.startTime).getTime();
      endMs = new Date(event.endTime).getTime();
      if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
        const nowMs = this.clock.now();
        if (nowMs < startMs) {
          status = 'before';
        } else if (nowMs > endMs) {
          status = 'after';
        } else {
          status = 'during';
        }
      }
    }

    const eventName = event.name.trim() || 'especial';

    if (event.enableOutOfPeriodMessage && status === 'before') {
      const formattedStart = this.formatEventDateTimePtBr(startMs);
      return {
        status,
        isBlocked: true,
        idleCallToActionTitle: 'QUIZ EM BREVE!',
        idleCallToActionSubtitle: 'Toque para mais informações',
        initialScreenMessage: `O quiz "${eventName}" ainda não começou! Prepare-se, a diversão começa em ${formattedStart}.`,
      };
    }

    if (event.enableOutOfPeriodMessage && status === 'after') {
      const formattedEnd = this.formatEventDateTimePtBr(endMs);
      return {
        status,
        isBlocked: true,
        idleCallToActionTitle: 'QUIZ ENCERRADO',
        idleCallToActionSubtitle: 'Obrigado por participar!',
        initialScreenMessage: `O quiz "${eventName}" foi encerrado em ${formattedEnd}. Obrigado pela participação!`,
      };
    }

    return {
      status,
      isBlocked: false,
      idleCallToActionTitle: defaultCallToAction,
      idleCallToActionSubtitle: null,
      initialScreenMessage: null,
    };
  }

  // Valida e converte para milissegundos os tempos de inatividade e esmaecimento prévio.
  getIdleTimingConfig(): IdleTimingConfig {
    const defaultIdle = DEFAULT_SETTINGS.idleTimeoutSeconds;
    const defaultFade = DEFAULT_SETTINGS.fadeOutLeadTimeSeconds;

    const rawIdle = this.eventSettings.idleTimeoutSeconds;
    const idleTimeoutSeconds =
      Number.isFinite(rawIdle) && rawIdle >= MIN_IDLE_TIMEOUT_SECONDS ? rawIdle : defaultIdle;

    const rawFade = this.eventSettings.fadeOutLeadTimeSeconds;
    let fadeOutLeadSeconds =
      Number.isFinite(rawFade) && rawFade >= MIN_FADE_OUT_LEAD_SECONDS ? rawFade : defaultFade;

    if (fadeOutLeadSeconds >= idleTimeoutSeconds && idleTimeoutSeconds > defaultFade) {
      fadeOutLeadSeconds = defaultFade;
    } else if (fadeOutLeadSeconds >= idleTimeoutSeconds) {
      fadeOutLeadSeconds = Math.max(1, Math.floor(idleTimeoutSeconds / 2));
    }

    const idleTimeoutMs = idleTimeoutSeconds * 1000;
    const fadeOutLeadMs = fadeOutLeadSeconds * 1000;
    const fadeOutStartMs = Math.max(0, idleTimeoutMs - fadeOutLeadMs);

    return {
      idleTimeoutMs,
      fadeOutLeadMs,
      fadeOutStartMs,
    };
  }

  async initialize(options?: {
    activationCode?: string;
    requirePairing?: boolean;
  }): Promise<TotemSessionSnapshot> {
    const storedConfig = await this.localStore.getTotemConfig();
    if (storedConfig) {
      this.totemConfig = storedConfig;
      if (storedConfig.totemId && storedConfig.deviceToken) {
        this.pairingStatus = 'paired';
      } else if (storedConfig.totemId && storedConfig.pairingCode) {
        this.pairingStatus = 'awaiting_authorization';
      }
    }

    const storedQuestions = await this.localStore.getQuestions(this.totemConfig.event.id);
    if (storedQuestions.length > 0) {
      this.questions = storedQuestions;
    }

    if (!storedConfig) {
      await this.localStore.saveTotemConfig(this.totemConfig);
    }
    if (storedQuestions.length === 0) {
      await this.localStore.saveQuestions(this.totemConfig.event.id, this.questions);
    }

    let preservedError: string | null = null;
    if (options?.activationCode) {
      await this.activateWithCode(options.activationCode);
      preservedError = this.lastValidationError;
      if (this.pairingStatus !== 'paired') {
        await this.refreshPairingRegistration();
      }
    } else if (this.pairingStatus === 'awaiting_authorization') {
      await this.refreshPairingRegistration();
    } else if ((options?.requirePairing ?? this.requirePairing) && this.pairingStatus !== 'paired') {
      await this.requestPairing();
    }

    await this.syncPendingQueue();
    await this.pullAndMergeCloudSnapshot();
    await this.refreshRankingCache();
    this.initialized = true;
    this.screen = 'initial-screen';
    this.lastValidationError = preservedError;
    if (this.totemConfig.totemId && this.pairingStatus === 'paired') {
      await this.sendHeartbeat();
    }

    return this.getSnapshot();
  }

  private isEffectiveOnline(): boolean {
    return (this.deviceOnlineOverride ?? true) && this.cloudGateway.isOnline();
  }

  async setDeviceOnline(online: boolean): Promise<TotemSessionSnapshot> {
    this.deviceOnlineOverride = online;
    await this.sendHeartbeat();
    this.notifySubscribers();
    return this.getSnapshot();
  }

  async sendHeartbeat(allowReconcile = true): Promise<TotemSessionSnapshot> {
    const queue = await this.localStore.getSyncQueue();
    this.pendingSyncCount = queue.length;

    if (!this.totemConfig.totemId) {
      return this.getSnapshot();
    }

    const effectiveOnline = this.isEffectiveOnline();
    const seenAt = this.clock.toISOString();

    try {
      const updated = await this.cloudGateway.publishTotemHeartbeat({
        totemId: this.totemConfig.totemId,
        deviceToken: this.totemConfig.deviceToken,
        eventId: this.totemConfig.event.id,
        onlineStatus: effectiveOnline ? 'online' : 'offline',
        currentScreen: this.screen,
        configVersion: this.totemConfig.event.configVersion,
        pendingSyncCount: this.pendingSyncCount,
        seenAt,
      });
      if (effectiveOnline) {
        this.lastHeartbeatAt = updated?.lastSeenAt ?? seenAt;
        if (
          allowReconcile &&
          updated?.isPaired &&
          updated.eventId &&
          updated.eventId !== this.totemConfig.event.id
        ) {
          const alreadyDeferred = this.deferredCommands.some(
            (cmd) => cmd.type === 'SWITCH_EVENT' && cmd.eventId === updated.eventId,
          );
          if (!alreadyDeferred) {
            const missedSwitch: RemoteCommandPayload = {
              id: this.random.uuid(),
              type: 'SWITCH_EVENT',
              targetTotemId: updated.id,
              targetEventId: this.totemConfig.event.id,
              eventId: updated.eventId,
              targetScreen: 'initial-screen',
              issuedAt: seenAt,
            };
            if (this.activeMatch !== null) {
              await this.receiveRemoteCommand(missedSwitch);
            } else {
              await this.executeRemoteCommandNow(missedSwitch);
              await this.sendHeartbeat(false);
              this.notifySubscribers();
            }
          }
        }
      } else if (updated?.lastSeenAt) {
        this.lastHeartbeatAt = updated.lastSeenAt;
      }
    } catch {
      // Falha ao enviar telemetria não interrompe o funcionamento local do Totem.
    }

    return this.getSnapshot();
  }

  async requestPairing(): Promise<TotemSessionSnapshot> {
    const pairingCode = generateShortPairingCode(this.random, 6);
    const totemId = this.totemConfig.totemId ?? this.random.uuid();

    this.totemConfig = {
      ...this.totemConfig,
      totemId,
      pairingCode,
      deviceToken: null,
    };
    this.pairingStatus = 'awaiting_authorization';
    this.lastValidationError = null;
    await this.localStore.saveTotemConfig(this.totemConfig);

    if (this.isEffectiveOnline()) {
      try {
        await this.cloudGateway.requestTotemPairing({
          id: totemId,
          pairingCode,
          currentScreen: this.screen,
          configVersion: this.totemConfig.event.configVersion,
          pendingSyncCount: this.pendingSyncCount,
        });
      } catch {
        // Permite aguardar reconexão sem quebrar inicialização local.
      }
    }

    this.notifySubscribers();
    return this.getSnapshot();
  }

  private async applyAuthorizedPairing(totem: TotemRecord): Promise<void> {
    if (!totem.eventId) {
      return;
    }

    this.totemConfig = {
      totemId: totem.id,
      totemName: totem.name,
      pairingCode: totem.pairingCode,
      deviceToken: totem.deviceToken,
      pinCode: totem.pinCode || '0000',
      event: {
        ...structuredClone(this.totemConfig.event),
        id: totem.eventId,
      },
    };
    this.pairingStatus = 'paired';
    this.lastValidationError = null;
    await this.localStore.saveTotemConfig(this.totemConfig);

    await this.pullAndMergeCloudSnapshot();
    await this.refreshRankingCache();
    this.screen = 'initial-screen';
    await this.sendHeartbeat();
    this.notifySubscribers();
  }

  async activateWithCode(codeOrLink: string): Promise<TotemSessionSnapshot> {
    if (!this.isEffectiveOnline()) {
      this.lastValidationError = 'Sem conectividade com a nuvem para ativar Pareamento.';
      this.notifySubscribers();
      return this.getSnapshot();
    }
    const code = extractPairingCodeFromInput(codeOrLink);
    if (!code) {
      this.lastValidationError =
        'Código ou link de ativação inválido ou ainda não autorizado pelo Administrador.';
      this.notifySubscribers();
      return this.getSnapshot();
    }

    try {
      const claimed = await this.cloudGateway.claimTotemPairing(code);
      if (!claimed) {
        this.lastValidationError =
          'Código ou link de ativação inválido ou ainda não autorizado pelo Administrador.';
        this.notifySubscribers();
        return this.getSnapshot();
      }
      await this.applyAuthorizedPairing(claimed);
      return this.getSnapshot();
    } catch (error) {
      this.lastValidationError =
        error instanceof Error
          ? error.message
          : 'Erro ao ativar Pareamento do Totem.';
      this.notifySubscribers();
      return this.getSnapshot();
    }
  }

  private async handleChannelEvent(event: TotemChannelEvent): Promise<void> {
    if (event.type === 'PAIRING_AUTHORIZED') {
      const matchesCode = Boolean(
        this.totemConfig.pairingCode && event.totem.pairingCode === this.totemConfig.pairingCode,
      );
      const matchesId = Boolean(
        this.totemConfig.totemId && event.totem.id === this.totemConfig.totemId,
      );
      if (this.pairingStatus === 'awaiting_authorization' && (matchesCode || matchesId)) {
        await this.applyAuthorizedPairing(event.totem);
      }
      return;
    }

    if (event.type === 'REMOTE_COMMAND' && this.isEffectiveOnline()) {
      await this.receiveRemoteCommand(event.command);
    }
  }

  private commandAppliesToThisTotem(command: RemoteCommandPayload): boolean {
    if (command.targetTotemId) {
      return this.totemConfig.totemId === command.targetTotemId;
    }
    if (command.targetEventId) {
      return this.totemConfig.event.id === command.targetEventId;
    }
    return false;
  }

  async refreshPairingRegistration(): Promise<TotemSessionSnapshot> {
    if (this.pairingStatus === 'paired') {
      return this.getSnapshot();
    }

    if (!this.totemConfig.totemId || !this.totemConfig.pairingCode) {
      return this.requestPairing();
    }

    if (this.isEffectiveOnline()) {
      try {
        const claimed = await this.cloudGateway.claimTotemPairing(this.totemConfig.pairingCode);
        if (claimed) {
          await this.applyAuthorizedPairing(claimed);
          return this.getSnapshot();
        }
        await this.cloudGateway.requestTotemPairing({
          id: this.totemConfig.totemId,
          pairingCode: this.totemConfig.pairingCode,
          currentScreen: this.screen,
          configVersion: this.totemConfig.event.configVersion,
          pendingSyncCount: this.pendingSyncCount,
        });
      } catch {
        // Aguarda próxima reconexão sem perder o código curto já exibido localmente.
      }
    }

    this.pairingStatus = 'awaiting_authorization';
    this.notifySubscribers();
    return this.getSnapshot();
  }

  async receiveRemoteCommand(command: RemoteCommandPayload): Promise<TotemSessionSnapshot> {
    if (!this.commandAppliesToThisTotem(command)) {
      return this.getSnapshot();
    }
    if (this.processedCommandIds.has(command.id)) {
      return this.getSnapshot();
    }
    this.processedCommandIds.add(command.id);
    if (this.processedCommandIds.size > 200) {
      const oldest = this.processedCommandIds.values().next().value;
      if (oldest) {
        this.processedCommandIds.delete(oldest);
      }
    }

    if (this.activeMatch !== null) {
      if (command.type === 'CONFIG_UPDATED' || command.type === 'SWITCH_EVENT') {
        const targetEventId =
          command.type === 'SWITCH_EVENT' ? command.eventId : this.totemConfig.event.id;
        if (targetEventId && this.isEffectiveOnline()) {
          try {
            const downloaded = await this.cloudGateway.pullEventSnapshot(targetEventId);
            if (downloaded) {
              this.stagedSnapshotsByEventId.set(targetEventId, downloaded);
            }
          } catch {
            // Falha transitória será repetida ao finalizar a Partida.
          }
        }
      }

      this.deferredCommands = [
        ...this.deferredCommands.filter((existing) => existing.type !== command.type),
        structuredClone(command),
      ];
      this.notifySubscribers();
      return this.getSnapshot();
    }

    await this.executeRemoteCommandNow(command);
    await this.sendHeartbeat();
    this.notifySubscribers();
    return this.getSnapshot();
  }

  private async applyStagedOrPullSnapshot(eventId: string): Promise<void> {
    const staged = this.stagedSnapshotsByEventId.get(eventId);
    if (staged) {
      this.stagedSnapshotsByEventId.delete(eventId);
      await this.applyCloudSnapshotData(staged);
    } else {
      await this.pullAndMergeCloudSnapshot();
    }
    await this.refreshRankingCache();
  }

  private async executeRemoteCommandNow(command: RemoteCommandPayload): Promise<void> {
    if (command.type === 'FORCE_SYNC') {
      await this.syncPendingQueue();
      await this.pullAndMergeCloudSnapshot();
      await this.refreshRankingCache();
      return;
    }

    if (command.type === 'RELOAD_SCREEN') {
      this.transitionWithCleanState(command.targetScreen ?? 'initial-screen');
      return;
    }

    if (command.type === 'CONFIG_UPDATED') {
      await this.applyStagedOrPullSnapshot(this.totemConfig.event.id);
      return;
    }

    if (command.type === 'SWITCH_EVENT') {
      const nextEventId = command.eventId;
      if (!nextEventId) {
        return;
      }
      this.totemConfig = {
        ...this.totemConfig,
        event: {
          ...structuredClone(this.totemConfig.event),
          id: nextEventId,
        },
      };
      await this.localStore.saveTotemConfig(this.totemConfig);

      await this.applyStagedOrPullSnapshot(nextEventId);
      this.transitionWithCleanState(command.targetScreen ?? 'initial-screen');
    }
  }

  private async flushDeferredCommands(): Promise<void> {
    if (this.deferredCommands.length === 0) {
      return;
    }
    const queue = [...this.deferredCommands];
    this.deferredCommands = [];
    for (const command of queue) {
      await this.executeRemoteCommandNow(command);
    }
  }

  private async applyCloudSnapshotData(cloudSnapshot: CloudEventSnapshot): Promise<void> {
    // Preserva débitos de estoque pendentes na fila local caso algum item ainda aguarde envio.
    const pendingQueue = await this.localStore.getSyncQueue();
    const pendingPrizesCount = pendingQueue.filter(
      (item) =>
        item.type === 'match_completed' &&
        item.eventId === cloudSnapshot.event.id &&
        item.prizeClaim !== undefined &&
        item.prizeClaim !== null,
    ).length;

    const mergedEvent: EventConfig = {
      ...cloudSnapshot.event,
      prizeStockRemaining:
        cloudSnapshot.event.prizeStockRemaining !== null
          ? Math.max(0, cloudSnapshot.event.prizeStockRemaining - pendingPrizesCount)
          : null,
    };

    this.totemConfig = {
      ...this.totemConfig,
      event: mergedEvent,
    };
    this.questions = cloudSnapshot.questions;
    await this.localStore.saveTotemConfig(this.totemConfig);
    await this.localStore.saveQuestions(this.totemConfig.event.id, this.questions);

    if (cloudSnapshot.matches !== undefined) {
      const cloudMatchIds = new Set(cloudSnapshot.matches.map((match) => match.id));
      const localMatches = await this.localStore.getMatches(this.totemConfig.event.id);
      const deletedMatchIds = new Set<string>();

      for (const localMatch of localMatches) {
        if (Boolean(localMatch.syncedAt) && !cloudMatchIds.has(localMatch.id)) {
          deletedMatchIds.add(localMatch.id);
          await this.localStore.deleteMatch(localMatch.id);
        }
      }

      if (deletedMatchIds.size > 0) {
        const localClaims = await this.localStore.getPrizeClaims(this.totemConfig.event.id);
        for (const claim of localClaims) {
          if (deletedMatchIds.has(claim.matchId)) {
            await this.localStore.deletePrizeClaim(claim.id);
          }
        }
      }

      for (const cloudMatch of cloudSnapshot.matches) {
        await this.localStore.saveMatch(cloudMatch);
      }
    }
    for (const cloudClaim of cloudSnapshot.prizeClaims ?? []) {
      await this.localStore.savePrizeClaim(cloudClaim);
    }
    for (const cloudLockout of cloudSnapshot.lockouts ?? []) {
      await this.localStore.saveLockout(cloudLockout);
    }
  }

  private async pullAndMergeCloudSnapshot(): Promise<void> {
    if (!this.isEffectiveOnline()) {
      return;
    }
    try {
      const cloudSnapshot = await this.cloudGateway.pullEventSnapshot(this.totemConfig.event.id);
      if (!cloudSnapshot) {
        return;
      }
      await this.applyCloudSnapshotData(cloudSnapshot);
    } catch {
      // Falha transitória de rede não impede operação offline usando o cache local.
    }
  }

  private computeSortedRanking(matches: MatchRecord[]): RankingEntry[] {
    const sorted = [...matches].sort(
      (a, b) =>
        b.score - a.score ||
        a.timeSeconds - b.timeSeconds ||
        a.playedAt.localeCompare(b.playedAt),
    );

    return sorted.map((match, index) => ({
      position: index + 1,
      matchId: match.id,
      participantName: match.participantName,
      participantPhone: match.participantPhone,
      score: match.score,
      totalQuestions: match.totalQuestions,
      timeSeconds: match.timeSeconds,
      playedAt: match.playedAt,
    }));
  }

  private async refreshRankingCache(): Promise<RankingEntry[]> {
    const matches = await this.localStore.getMatches(this.totemConfig.event.id);
    const fullRanking = this.computeSortedRanking(matches);
    const limit =
      this.eventSettings.rankingDisplayCount > 0
        ? this.eventSettings.rankingDisplayCount
        : DEFAULT_SETTINGS.rankingDisplayCount;
    this.rankingCache = fullRanking.slice(0, limit);
    return fullRanking;
  }

  // Abre a tela de Ranking Geral do Evento ordenando por maior pontuação e menor tempo.
  async openRankingScreen(): Promise<TotemSessionSnapshot> {
    await this.syncPendingQueue();
    await this.pullAndMergeCloudSnapshot();
    await this.refreshRankingCache();
    this.transitionWithCleanState('ranking-screen');
    await this.sendHeartbeat();
    return this.getSnapshot();
  }

  async startMatch(rawName: string, rawPhone: string): Promise<StartMatchResult> {
    const eventWindow = this.getEventWindowState();
    if (eventWindow.isBlocked) {
      return this.recordValidationFailure(
        eventWindow.initialScreenMessage ??
          'O Evento está fora do período de funcionamento configurado.',
      );
    }

    const normalizedName = normalizeParticipantName(rawName).trim();
    const formattedPhone = rawPhone.trim();

    if (!normalizedName) {
      return this.recordValidationFailure('Preencha o nome.');
    }

    if (!isValidBrazilPhone(formattedPhone)) {
      return this.recordValidationFailure(
        'Telefone inválido. Formato esperado: (XX) XXXXX-XXXX ou (XX) XXXX-XXXX.',
      );
    }

    if (this.eventSettings.enablePrizeLock) {
      const prizeClaims = await this.localStore.getPrizeClaims(this.totemConfig.event.id);
      const existingWinner = prizeClaims.find(
        (claim) =>
          claim.participantPhone === formattedPhone &&
          (isActivePrizeClaim(claim) || claim.status === 'offline_duplicate_conflict'),
      );
      if (existingWinner) {
        this.alreadyWonModal = {
          participantPhone: formattedPhone,
          awardedAt: existingWinner.awardedAt,
        };
        this.lastValidationError = null;
        return {
          started: false,
          alreadyWonPrizeAt: existingWinner.awardedAt,
          snapshot: this.getSnapshot(),
        };
      }
    }

    if (this.eventSettings.giveUpLockoutMinutes > 0) {
      const lockouts = await this.localStore.getLockouts(this.totemConfig.event.id);
      const nowMs = this.clock.now();
      const latestExpiresAtMs = lockouts
        .filter((lockout) => lockout.participantPhone === formattedPhone)
        .map((lockout) => new Date(lockout.expiresAt).getTime())
        .filter((expiresMs) => Number.isFinite(expiresMs) && expiresMs > nowMs)
        .sort((a, b) => b - a)[0];

      if (latestExpiresAtMs !== undefined) {
        const remainingMinutes = Math.ceil((latestExpiresAtMs - nowMs) / (1000 * 60));
        const message = `Você desistiu recentemente do quiz e está bloqueado por ${remainingMinutes} minuto(s). Por favor, aguarde para jogar novamente.`;
        this.lastValidationError = message;
        return {
          started: false,
          errorMessage: message,
          lockoutRemainingMinutes: remainingMinutes,
          snapshot: this.getSnapshot(),
        };
      }
    }

    const enabledQuestions = this.questions.filter((q) => !q.isDisabled);
    if (enabledQuestions.length === 0) {
      return this.recordValidationFailure(
        'Sem questões habilitadas para jogar. Verifique o Banco de Questões do Evento.',
      );
    }

    const requestedCount =
      this.eventSettings.numberOfQuestions || DEFAULT_SETTINGS.numberOfQuestions;
    const selected = this.selectQuestionsForMatch(
      enabledQuestions,
      requestedCount,
      this.eventSettings.difficultyPercentages ?? DEFAULT_SETTINGS.difficultyPercentages,
    );

    const preparedQuestions = selected.map((question) => this.prepareQuestion(question));

    this.activeMatch = {
      participantName: normalizedName,
      participantPhone: formattedPhone,
      startedAtMs: this.clock.now(),
      questions: preparedQuestions,
      answers: [],
      currentIndex: 0,
      score: 0,
      hasAnswered: false,
      isTimedOut: false,
      selectedOptionIndex: null,
      revealedCorrectOptionIndex: null,
    };
    this.screen = 'quiz-screen';
    this.lastResult = null;
    this.alreadyWonModal = null;
    this.lastValidationError = null;
    await this.sendHeartbeat();

    return {
      started: true,
      snapshot: this.getSnapshot(),
    };
  }

  dismissAlreadyWonModal(): TotemSessionSnapshot {
    this.alreadyWonModal = null;
    return this.getSnapshot();
  }

  private transitionWithCleanState(
    targetScreen: TotemScreenId,
    shouldFlushDeferred = true,
  ): TotemSessionSnapshot {
    this.activeMatch = null;
    this.lastResult = null;
    this.alreadyWonModal = null;
    this.lastValidationError = null;
    this.screen = targetScreen;
    if (shouldFlushDeferred && this.deferredCommands.length > 0) {
      void this.flushDeferredCommands().then(() => {
        void this.sendHeartbeat();
        this.notifySubscribers();
      });
    } else if (shouldFlushDeferred) {
      void this.sendHeartbeat();
    }
    return this.getSnapshot();
  }

  resetToInitialScreen(): TotemSessionSnapshot {
    return this.transitionWithCleanState('initial-screen');
  }

  // Entra na Tela de Descanso descartando qualquer Partida não finalizada e estado transitório.
  enterIdleScreen(): TotemSessionSnapshot {
    return this.transitionWithCleanState('idle-screen');
  }

  // Desperta da Tela de Descanso para a tela inicial com estado limpo.
  wakeFromIdleScreen(): TotemSessionSnapshot {
    if (this.screen !== 'idle-screen') {
      return this.getSnapshot();
    }
    return this.transitionWithCleanState('initial-screen');
  }

  // Abandona a Partida atual sem salvá-la e aplica Bloqueio por Desistência se configurado no Evento.
  async giveUpMatch(): Promise<TotemSessionSnapshot> {
    if (!this.activeMatch) {
      return this.getSnapshot();
    }

    const participantPhone = this.activeMatch.participantPhone;
    const lockoutMinutes = this.eventSettings.giveUpLockoutMinutes;
    this.transitionWithCleanState('initial-screen', false);

    if (lockoutMinutes > 0) {
      const lockedAtMs = this.clock.now();
      const expiresAtMs = lockedAtMs + lockoutMinutes * 60 * 1000;
      const lockout: GiveUpLockoutRecord = {
        id: this.random.uuid(),
        eventId: this.totemConfig.event.id,
        totemId: this.totemConfig.totemId,
        participantPhone,
        lockedAt: this.clock.toISOString(lockedAtMs),
        expiresAt: this.clock.toISOString(expiresAtMs),
      };

      await this.localStore.saveLockout(lockout);
      await this.localStore.enqueueSyncItem({
        idempotencyKey: lockout.id,
        type: 'give_up_lockout_added',
        eventId: lockout.eventId,
        payload: lockout,
        createdAt: lockout.lockedAt,
        retryCount: 0,
      });
      await this.syncPendingQueue();
    }

    await this.flushDeferredCommands();
    await this.sendHeartbeat();
    this.notifySubscribers();
    return this.getSnapshot();
  }

  getPreparedQuestions(): PreparedQuestion[] {
    if (!this.activeMatch) {
      return [];
    }
    return structuredClone(this.activeMatch.questions);
  }

  getActiveAnswers(): MatchAnswer[] {
    if (!this.activeMatch) {
      return [];
    }
    return structuredClone(this.activeMatch.answers);
  }

  submitAnswer(shuffledOptionIndex: number): AnswerOutcome {
    if (!this.activeMatch || this.activeMatch.hasAnswered) {
      return this.rejectedAnswerOutcome();
    }

    const question = this.activeMatch.questions[this.activeMatch.currentIndex];
    if (
      !question ||
      shuffledOptionIndex < 0 ||
      shuffledOptionIndex >= question.shuffledOptions.length
    ) {
      return this.rejectedAnswerOutcome();
    }

    const chosenOption = question.shuffledOptions[shuffledOptionIndex];
    return this.recordQuestionOutcome({
      question,
      selectedOptionIndex: shuffledOptionIndex,
      selectedOptionText: chosenOption.text,
      isCorrect: chosenOption.isCorrect,
      isTimedOut: false,
    });
  }

  handleQuestionTimeout(): AnswerOutcome {
    if (!this.activeMatch || this.activeMatch.hasAnswered) {
      return this.rejectedAnswerOutcome();
    }

    const question = this.activeMatch.questions[this.activeMatch.currentIndex];
    if (!question) {
      return this.rejectedAnswerOutcome();
    }

    return this.recordQuestionOutcome({
      question,
      selectedOptionIndex: null,
      selectedOptionText: TIMEOUT_OPTION_TEXT,
      isCorrect: false,
      isTimedOut: true,
    });
  }

  async advanceAfterAnswer(): Promise<TotemSessionSnapshot> {
    if (!this.activeMatch || !this.activeMatch.hasAnswered) {
      return this.getSnapshot();
    }

    if (this.activeMatch.currentIndex < this.activeMatch.questions.length - 1) {
      this.activeMatch.currentIndex += 1;
      this.activeMatch.hasAnswered = false;
      this.activeMatch.isTimedOut = false;
      this.activeMatch.selectedOptionIndex = null;
      this.activeMatch.revealedCorrectOptionIndex = null;
      return this.getSnapshot();
    }

    await this.finalizeMatch();
    return this.getSnapshot();
  }

  async syncPendingQueue(): Promise<{ synced: number; failed: number; pending: number }> {
    // Evita envios concorrentes quando múltiplos gatilhos (fim da Partida, evento online, timer) disparam juntos.
    if (this.syncInFlight) {
      return this.syncInFlight;
    }

    this.syncInFlight = this.runSyncPendingQueue();
    try {
      return await this.syncInFlight;
    } finally {
      this.syncInFlight = null;
    }
  }

  private async runSyncPendingQueue(): Promise<{
    synced: number;
    failed: number;
    pending: number;
  }> {
    const queue = await this.localStore.getSyncQueue();
    if (!this.isEffectiveOnline()) {
      this.pendingSyncCount = queue.length;
      return { synced: 0, failed: 0, pending: queue.length };
    }

    let synced = 0;
    let failed = 0;
    let shouldRefreshFromCloud = false;

    for (const item of queue) {
      try {
        if (item.type === 'match_completed') {
          const { syncedAt, resolvedPrizeClaim, prizeStockRemaining } =
            await this.cloudGateway.pushMatch({
              idempotencyKey: item.idempotencyKey,
              match: item.payload,
              prizeClaim: item.prizeClaim,
            });
          await this.localStore.saveMatch({
            ...item.payload,
            syncedAt,
          });
          if (resolvedPrizeClaim) {
            await this.localStore.savePrizeClaim(resolvedPrizeClaim);
            if (resolvedPrizeClaim.status === 'offline_duplicate_conflict') {
              shouldRefreshFromCloud = true;
            }
            if (this.lastResult && this.lastResult.matchId === resolvedPrizeClaim.matchId) {
              this.lastResult.prizeStatus = resolvedPrizeClaim.status;
              this.lastResult.wonPrize = isActivePrizeClaim(resolvedPrizeClaim);
            }
          }
          if (prizeStockRemaining !== undefined) {
            this.totemConfig.event.prizeStockRemaining = prizeStockRemaining;
            await this.localStore.saveTotemConfig(this.totemConfig);
          }
        } else {
          await this.cloudGateway.pushGiveUpLockout({
            idempotencyKey: item.idempotencyKey,
            lockout: item.payload,
          });
        }
        await this.localStore.markSyncItemCompleted(item.idempotencyKey);
        synced += 1;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
        await this.localStore.incrementSyncRetry(item.idempotencyKey, errorMessage);
        failed += 1;
      }
    }

    if (shouldRefreshFromCloud) {
      await this.pullAndMergeCloudSnapshot();
      await this.refreshRankingCache();
    }

    const remainingQueue = await this.localStore.getSyncQueue();
    this.pendingSyncCount = remainingQueue.length;
    return { synced, failed, pending: this.pendingSyncCount };
  }

  private async finalizeMatch(): Promise<void> {
    const match = this.activeMatch;
    if (!match) return;

    // Limpa a Partida ativa antes dos awaits para impedir finalização duplicada por duplo toque.
    this.activeMatch = null;

    const totalQuestions = match.questions.length;
    const timeSeconds = Math.max(0, Math.floor((this.clock.now() - match.startedAtMs) / 1000));
    const matchId = this.random.uuid();
    const playedAt = this.clock.toISOString();

    const matchRecord: MatchRecord = {
      id: matchId,
      eventId: this.totemConfig.event.id,
      totemId: this.totemConfig.totemId,
      participantName: match.participantName,
      participantPhone: match.participantPhone,
      score: match.score,
      totalQuestions,
      timeSeconds,
      answers: structuredClone(match.answers),
      playedAt,
      syncedAt: null,
    };

    const incorrectAnswers: IncorrectAnswerReviewItem[] = match.answers
      .filter((answer) => !answer.isCorrect)
      .map((answer) => ({
        questionId: answer.questionId,
        questionText: answer.questionText,
        selectedOptionText: answer.selectedOptionText,
        correctOptionText: answer.correctOptionText,
      }));

    const currentStock = this.totemConfig.event.prizeStockRemaining;
    const eligibleByScore = match.score >= this.eventSettings.minScoreForPrize;
    const hasStock = currentStock === null || currentStock > 0;

    let prizeClaim: PrizeClaimRecord | null = null;
    let prizeStatus: PrizeClaimStatus | null = null;
    const wonPrize = eligibleByScore && hasStock;

    if (wonPrize) {
      prizeStatus = this.eventSettings.requireManualPrizeConfirmation
        ? 'awaiting_pickup'
        : 'delivered';
      prizeClaim = {
        id: this.random.uuid(),
        eventId: this.totemConfig.event.id,
        matchId,
        totemId: this.totemConfig.totemId,
        participantName: match.participantName,
        participantPhone: match.participantPhone,
        status: prizeStatus,
        awardedAt: playedAt,
        deliveredAt: prizeStatus === 'delivered' ? playedAt : null,
      };
      if (currentStock !== null) {
        this.totemConfig.event.prizeStockRemaining = currentStock - 1;
        await this.localStore.saveTotemConfig(this.totemConfig);
      }
      await this.localStore.savePrizeClaim(prizeClaim);
    }

    await this.localStore.saveMatch(matchRecord);
    const fullRanking = await this.refreshRankingCache();
    const rankingPosition =
      fullRanking.find((entry) => entry.matchId === matchId)?.position ?? 0;
    const isTop3 = rankingPosition > 0 && rankingPosition <= 3;

    this.lastResult = {
      matchId,
      participantName: match.participantName,
      participantPhone: match.participantPhone,
      score: match.score,
      totalQuestions,
      timeSeconds,
      wonPrize,
      prizeStatus,
      rankingPosition,
      isTop3,
      isPerfectScore: incorrectAnswers.length === 0,
      canShowIncorrectAnswers: incorrectAnswers.length > 0,
      incorrectAnswers,
    };
    this.screen = 'result-screen';

    await this.localStore.enqueueSyncItem({
      idempotencyKey: matchId,
      type: 'match_completed',
      eventId: matchRecord.eventId,
      payload: matchRecord,
      prizeClaim,
      createdAt: playedAt,
      retryCount: 0,
    });

    await this.syncPendingQueue();

    // Quando online, consolida Ranking com Partidas de outros Totens após sincronizar a Partida atual.
    if (this.isEffectiveOnline()) {
      await this.pullAndMergeCloudSnapshot();
      // Evita que CONFIG_UPDATED diferido sobrescreva o snapshot pós-Partida com cache antigo.
      this.stagedSnapshotsByEventId.delete(matchRecord.eventId);
      const cloudRanking = await this.refreshRankingCache();
      const updatedPosition =
        cloudRanking.find((entry) => entry.matchId === matchId)?.position ?? rankingPosition;
      if (this.lastResult && this.lastResult.matchId === matchId) {
        this.lastResult.rankingPosition = updatedPosition;
        this.lastResult.isTop3 = updatedPosition > 0 && updatedPosition <= 3;
      }
    }

    await this.flushDeferredCommands();
    await this.sendHeartbeat();
    this.notifySubscribers();
  }

  private recordQuestionOutcome(params: {
    question: PreparedQuestion;
    selectedOptionIndex: number | null;
    selectedOptionText: string;
    isCorrect: boolean;
    isTimedOut: boolean;
  }): AnswerOutcome {
    const match = this.activeMatch!;
    const { question, selectedOptionIndex, selectedOptionText, isCorrect, isTimedOut } = params;

    if (isCorrect) {
      match.score += 1;
    }

    const correctShuffledIndex = question.shuffledOptions.findIndex((opt) => opt.isCorrect);
    const shouldRevealCorrect = isCorrect || this.eventSettings.showCorrectAnswerOnWrong;
    const revealedCorrectOptionIndex =
      shouldRevealCorrect && correctShuffledIndex >= 0 ? correctShuffledIndex : null;

    match.answers.push({
      questionId: question.id,
      questionText: question.text,
      options: [...question.originalOptions],
      selectedOptionText,
      correctOptionIndex: question.originalCorrectIndex,
      correctOptionText: question.originalOptions[question.originalCorrectIndex],
      isCorrect,
    });

    match.hasAnswered = true;
    match.isTimedOut = isTimedOut;
    match.selectedOptionIndex = selectedOptionIndex;
    match.revealedCorrectOptionIndex = revealedCorrectOptionIndex;

    const advanceButtonLabel = this.getAdvanceButtonLabel(
      match.currentIndex,
      match.questions.length,
    );

    return {
      accepted: true,
      isCorrect,
      isTimedOut,
      revealedCorrectOptionIndex,
      advanceButtonLabel,
      snapshot: this.getSnapshot(),
    };
  }

  private rejectedAnswerOutcome(): AnswerOutcome {
    const match = this.activeMatch;
    const advanceButtonLabel = match
      ? this.getAdvanceButtonLabel(match.currentIndex, match.questions.length)
      : this.customizationTexts.quizScreenNextButton;

    return {
      accepted: false,
      isCorrect: false,
      isTimedOut: false,
      revealedCorrectOptionIndex: null,
      advanceButtonLabel,
      snapshot: this.getSnapshot(),
    };
  }

  private getAdvanceButtonLabel(currentIndex: number, totalQuestions: number): string {
    return currentIndex >= totalQuestions - 1
      ? this.customizationTexts.quizScreenFinalizeButton
      : this.customizationTexts.quizScreenNextButton;
  }

  getQuestionTimeVisualState(remainingMs: number): QuestionTimeVisualState {
    const settings = this.eventSettings;
    const totalMs = (settings.timePerQuestion || DEFAULT_SETTINGS.timePerQuestion) * 1000;
    const clampedRemainingMs = Math.max(0, Math.min(totalMs, remainingMs));
    const percentageRemaining = totalMs > 0 ? (clampedRemainingMs / totalMs) * 100 : 0;
    const remainingSeconds = clampedRemainingMs / 1000;

    const warningThresholdSeconds = 10;
    const criticalThresholdSeconds = 5;

    let hue = 120;
    let phase: TimeBarPhase = 'normal';
    let borderPulseState: BorderPulseState = 'none';

    if (remainingSeconds <= criticalThresholdSeconds) {
      hue = 0;
      phase = 'critical';
      borderPulseState = settings.enableTimeAlertBorderPulse ? 'critical' : 'none';
    } else if (remainingSeconds <= warningThresholdSeconds) {
      const progressToYellow =
        (remainingSeconds - criticalThresholdSeconds) /
        (warningThresholdSeconds - criticalThresholdSeconds);
      hue = Math.max(0, Math.min(120, Math.round(progressToYellow * 60)));
      phase = 'warning';
      borderPulseState = settings.enableTimeAlertBorderPulse ? 'warning' : 'none';
    }

    const isFlashing = Boolean(
      settings.enableTimeAlertFlash &&
        clampedRemainingMs > 0 &&
        remainingSeconds <= criticalThresholdSeconds,
    );

    return {
      remainingMs: clampedRemainingMs,
      totalMs,
      percentageRemaining,
      barColor: `hsl(${hue}, 80%, 50%)`,
      phase,
      borderPulseState,
      isFlashing,
    };
  }

  private selectQuestionsForMatch(
    enabledQuestions: Question[],
    requestedCount: number,
    percentages: DifficultyPercentages,
  ): Question[] {
    const targetCount = Math.min(requestedCount, enabledQuestions.length);
    const groups: Record<DifficultyLevel, Question[]> = {
      facil: this.random.shuffle(enabledQuestions.filter((q) => q.difficulty === 'facil')),
      moderado: this.random.shuffle(enabledQuestions.filter((q) => q.difficulty === 'moderado')),
      dificil: this.random.shuffle(enabledQuestions.filter((q) => q.difficulty === 'dificil')),
    };

    const quotas: Record<DifficultyLevel, number> = {
      facil: Math.round(targetCount * (percentages.facil / 100)),
      moderado: Math.round(targetCount * (percentages.moderado / 100)),
      dificil: Math.round(targetCount * (percentages.dificil / 100)),
    };

    const difficultiesByPriority: DifficultyLevel[] = (
      ['facil', 'moderado', 'dificil'] as DifficultyLevel[]
    ).sort((a, b) => percentages[b] - percentages[a]);

    let quotaTotal = quotas.facil + quotas.moderado + quotas.dificil;
    while (quotaTotal !== targetCount) {
      if (quotaTotal < targetCount) {
        const target = difficultiesByPriority.find((d) => groups[d].length > quotas[d]);
        if (!target) break;
        quotas[target] += 1;
      } else {
        const target = [...difficultiesByPriority].reverse().find((d) => quotas[d] > 0);
        if (!target) break;
        quotas[target] -= 1;
      }
      quotaTotal = quotas.facil + quotas.moderado + quotas.dificil;
    }

    const picked: Question[] = [
      ...groups.facil.slice(0, quotas.facil),
      ...groups.moderado.slice(0, quotas.moderado),
      ...groups.dificil.slice(0, quotas.dificil),
    ];

    const remainingNeeded = targetCount - picked.length;
    if (remainingNeeded > 0) {
      const pickedIds = new Set(picked.map((q) => q.id));
      const remainingPool = this.random.shuffle(
        enabledQuestions.filter((q) => !pickedIds.has(q.id)),
      );
      picked.push(...remainingPool.slice(0, remainingNeeded));
    }

    return this.random.shuffle(picked.slice(0, targetCount));
  }

  private prepareQuestion(question: Question): PreparedQuestion {
    const options = question.options.map((text, index) => ({
      text,
      isCorrect: index === question.correctIndex,
      originalIndex: index,
    }));

    return {
      id: question.id,
      text: question.text,
      difficulty: question.difficulty,
      originalOptions: [...question.options],
      originalCorrectIndex: question.correctIndex,
      shuffledOptions: this.random.shuffle(options),
    };
  }

  private recordValidationFailure(errorMessage: string): StartMatchResult {
    this.lastValidationError = errorMessage;
    return {
      started: false,
      errorMessage,
      snapshot: this.getSnapshot(),
    };
  }

  private buildCurrentQuestionState(): ActiveQuestionState | null {
    if (!this.activeMatch) {
      return null;
    }
    const { questions, currentIndex } = this.activeMatch;
    if (currentIndex >= questions.length) {
      return null;
    }

    return {
      index: currentIndex,
      total: questions.length,
      question: structuredClone(questions[currentIndex]),
      hasAnswered: this.activeMatch.hasAnswered,
      isTimedOut: this.activeMatch.isTimedOut,
      selectedOptionIndex: this.activeMatch.selectedOptionIndex,
      revealedCorrectOptionIndex: this.activeMatch.revealedCorrectOptionIndex,
      advanceButtonLabel: this.getAdvanceButtonLabel(currentIndex, questions.length),
    };
  }

  getSnapshot(): TotemSessionSnapshot {
    const activeQuestionsCount = this.questions.filter((q) => !q.isDisabled).length;
    return {
      initialized: this.initialized,
      screen: this.screen,
      event: structuredClone(this.totemConfig.event),
      eventWindow: this.getEventWindowState(),
      availableQuestionsCount: activeQuestionsCount,
      activeMatch: this.activeMatch
        ? {
            participantName: this.activeMatch.participantName,
            participantPhone: this.activeMatch.participantPhone,
            startedAtMs: this.activeMatch.startedAtMs,
            score: this.activeMatch.score,
            currentQuestion: this.buildCurrentQuestionState(),
          }
        : null,
      lastResult: this.lastResult ? structuredClone(this.lastResult) : null,
      ranking: structuredClone(this.rankingCache),
      alreadyWonModal: this.alreadyWonModal ? structuredClone(this.alreadyWonModal) : null,
      pendingSyncCount: this.pendingSyncCount,
      isOnline: this.isEffectiveOnline(),
      lastValidationError: this.lastValidationError,
      pairing: {
        isPaired: this.pairingStatus === 'paired',
        status: this.pairingStatus,
        pairingCode: this.totemConfig.pairingCode ?? null,
        totemId: this.totemConfig.totemId,
        totemName: this.totemConfig.totemName ?? null,
        activationLink: this.totemConfig.pairingCode
          ? buildTotemActivationLink(this.totemConfig.pairingCode)
          : null,
      },
      deferredCommands: structuredClone(this.deferredCommands),
      lastHeartbeatAt: this.lastHeartbeatAt,
    };
  }

  verifyDiagnosticPin(pinInput: string): boolean {
    const expectedPin = (this.totemConfig.pinCode || '0000').trim();
    return pinInput.trim() === expectedPin;
  }

  getLocalDiagnostics(): TotemLocalDiagnostics {
    return {
      isOnline: this.isEffectiveOnline(),
      totemId: this.totemConfig.totemId,
      totemName: this.totemConfig.totemName ?? null,
      pairingCode: this.totemConfig.pairingCode ?? null,
      isPaired: this.pairingStatus === 'paired',
      eventId: this.totemConfig.event.id,
      eventName: this.totemConfig.event.name,
      configVersion: this.totemConfig.event.configVersion,
      currentScreen: this.screen,
      pendingSyncCount: this.pendingSyncCount,
      lastHeartbeatAt: this.lastHeartbeatAt,
      deferredCommandsCount: this.deferredCommands.length,
    };
  }

  async forceSync(): Promise<{
    synced: number;
    failed: number;
    pending: number;
    snapshot: TotemSessionSnapshot;
  }> {
    const syncResult = await this.syncPendingQueue();
    if (this.activeMatch === null) {
      await this.pullAndMergeCloudSnapshot();
      await this.refreshRankingCache();
    }
    await this.sendHeartbeat();
    this.notifySubscribers();
    return {
      ...syncResult,
      snapshot: this.getSnapshot(),
    };
  }
}
