import {
  DEFAULT_CUSTOMIZATIONS,
  DEFAULT_EVENT_CONFIG,
  DEFAULT_QUIZ_QUESTIONS,
  DEFAULT_SETTINGS,
  TIMEOUT_OPTION_TEXT,
} from './defaults';
import { isActivePrizeClaim } from './operationalRules';
import {
  buildTotemActivationLink,
  extractPairingCodeFromInput,
  generateShortPairingCode,
} from './pairingUtils';
import { hashEventPhone } from './phoneHash';
import type {
  Clock,
  CloudEventSnapshot,
  LocalStore,
  RandomSource,
  TotemCloudPort,
} from './ports';
import { TotemNotRecognizedError } from './ports';
import { TotemSyncManager } from './totemSyncManager';
import type {
  ActiveQuestionState,
  AnswerOutcome,
  BorderPulseState,
  DifficultyLevel,
  DifficultyPercentages,
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
import { resolveVisualAssetPaths } from './visualAssetUtils';

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

export interface TotemSessionEngineDependencies {
  localStore: LocalStore;
  cloudGateway: TotemCloudPort;
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
  private readonly cloudGateway: TotemCloudPort;
  private readonly clock: Clock;
  private readonly random: RandomSource;
  private readonly requirePairing: boolean;
  private readonly syncManager: TotemSyncManager;

  private initialized = false;
  private disposed = false;
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
  private totalMatchesCount = 0;
  private backgroundSyncNotice: string | null = null;
  private alreadyWonModal: { participantPhone: string; awardedAt: string } | null = null;
  private pendingSyncCount = 0;
  private lastValidationError: string | null = null;
  private backgroundSyncPromise: Promise<void> | null = null;
  private pairingStatus: TotemPairingStatus = 'unpaired';
  private deviceOnlineOverride: boolean | null = null;
  private deferredCommands: RemoteCommandPayload[] = [];
  private stagedSnapshotsByEventId = new Map<string, CloudEventSnapshot>();
  private readonly processedCommandIds = new Set<string>();
  private lastHeartbeatAt: string | null = null;
  private cachedLogoDataUrl: string | null = null;
  private cachedBackgroundDataUrl: string | null = null;
  private readonly snapshotListeners = new Set<(snapshot: TotemSessionSnapshot) => void>();
  private readonly channelUnsubscribe: () => void;

  constructor(deps: TotemSessionEngineDependencies) {
    this.localStore = deps.localStore;
    this.cloudGateway = deps.cloudGateway;
    this.clock = deps.clock;
    this.random = deps.random;
    this.requirePairing = deps.requirePairing ?? false;
    this.syncManager = new TotemSyncManager({
      localStore: deps.localStore,
      cloudGateway: deps.cloudGateway,
      clock: deps.clock,
    });
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
    this.disposed = true;
    this.channelUnsubscribe();
    this.snapshotListeners.clear();
  }

  /** Aguarda tarefas assíncronas de sincronização em segundo plano (útil em testes). */
  async waitForBackgroundSync(): Promise<void> {
    if (this.backgroundSyncPromise) {
      await this.backgroundSyncPromise;
    }
  }

  private notifySubscribers(): void {
    if (this.disposed || this.snapshotListeners.size === 0) {
      return;
    }
    const snap = this.getSnapshot();
    const listenerCount = this.snapshotListeners.size;
    let index = 0;
    for (const listener of this.snapshotListeners) {
      index += 1;
      // Passa a própria cópia recém-construída para o último assinante evitando structuredClone duplicado.
      listener(index === listenerCount ? snap : structuredClone(snap));
    }
  }

  private get eventSettings(): EventSettings {
    return this.totemConfig.event.settings;
  }

  private get customizationTexts(): EventCustomizationTexts {
    return this.totemConfig.event.customizations.texts;
  }

  // Leitores leves para o hot path de UI evitando clonar o snapshot completo em eventos frequentes.
  getScreen(): TotemScreenId {
    return this.screen;
  }

  getPairingStatus(): TotemPairingStatus {
    return this.pairingStatus;
  }

  hasActiveMatch(): boolean {
    return this.activeMatch !== null;
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

    const eventName = event.name.trim() || 'especial';

    if (!event.isActive) {
      return {
        status: 'after',
        isBlocked: true,
        idleCallToActionTitle: 'QUIZ ENCERRADO',
        idleCallToActionSubtitle: 'Obrigado por participar!',
        initialScreenMessage: `O quiz "${eventName}" foi encerrado. Obrigado pela participação!`,
      };
    }

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

  // Inicializações concorrentes (ex.: efeitos duplicados do React) compartilham a mesma execução,
  // evitando registrar dois Totens "Aguardando Pareamento" para o mesmo aparelho.
  private initializePromise: Promise<TotemSessionSnapshot> | null = null;

  initialize(options?: {
    activationCode?: string;
    requirePairing?: boolean;
  }): Promise<TotemSessionSnapshot> {
    if (!this.initializePromise) {
      this.initializePromise = this.runInitialize(options).finally(() => {
        this.initializePromise = null;
      });
    }
    return this.initializePromise;
  }

  private async runInitialize(options?: {
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
    const assets = await this.syncManager.resolveAndCacheVisualAssets(this.totemConfig.event, () =>
      this.isEffectiveOnline(),
    );
    this.cachedLogoDataUrl = assets.logoDataUrl ?? this.cachedLogoDataUrl;
    this.cachedBackgroundDataUrl = assets.backgroundDataUrl;
    await this.refreshRankingCache();
    this.syncManager.advanceCommandCursor(this.clock.toISOString());

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
    if (online && this.activeMatch === null && this.pairingStatus === 'paired') {
      await this.pullAndMergeCloudSnapshot();
      await this.refreshRankingCache();
    }
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
    } catch (error) {
      if (error instanceof TotemNotRecognizedError && effectiveOnline && this.activeMatch === null) {
        await this.resetRevokedPairing();
        return this.getSnapshot();
      }
      // Falha ao enviar telemetria não interrompe o funcionamento local do Totem.
    }

    return this.getSnapshot();
  }

  // O Totem foi excluído ou despareado no painel: descarta a identidade local e volta à tela de Pareamento.
  // A fila de sincronização é preservada para não perder Partidas ainda não enviadas.
  private async resetRevokedPairing(): Promise<void> {
    this.totemConfig = {
      ...this.totemConfig,
      totemId: null,
      totemName: null,
      pairingCode: null,
      deviceToken: null,
    };
    this.pairingStatus = 'unpaired';
    this.screen = 'initial-screen';
    await this.requestPairing();
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
    this.syncManager.advanceCommandCursor(this.clock.toISOString());
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
        error instanceof Error ? error.message : 'Erro ao ativar Pareamento do Totem.';
      this.notifySubscribers();
      return this.getSnapshot();
    }
  }

  private async handleChannelEvent(event: TotemChannelEvent): Promise<void> {
    if (this.disposed) {
      return;
    }

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

  private markCommandProcessed(command: RemoteCommandPayload): boolean {
    if (this.processedCommandIds.has(command.id)) {
      return false;
    }
    this.processedCommandIds.add(command.id);
    if (this.processedCommandIds.size > 200) {
      const oldest = this.processedCommandIds.values().next().value;
      if (oldest) {
        this.processedCommandIds.delete(oldest);
      }
    }
    this.syncManager.advanceCommandCursor(command.issuedAt);
    return true;
  }

  async receiveRemoteCommand(command: RemoteCommandPayload): Promise<TotemSessionSnapshot> {
    if (!this.commandAppliesToThisTotem(command)) {
      return this.getSnapshot();
    }
    if (!this.markCommandProcessed(command)) {
      return this.getSnapshot();
    }

    if (this.activeMatch !== null) {
      if (command.type === 'CONFIG_UPDATED' || command.type === 'SWITCH_EVENT') {
        const targetEventId =
          command.type === 'SWITCH_EVENT' ? command.eventId : this.totemConfig.event.id;
        if (targetEventId && this.isEffectiveOnline()) {
          try {
            const downloaded = await this.cloudGateway.pullEventSnapshot(
              targetEventId,
              this.syncManager.buildAuthContext(this.totemConfig),
            );
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
    const outcome = await this.syncManager.pullAndApplySnapshot(
      this.totemConfig,
      () => this.isEffectiveOnline(),
      cloudSnapshot,
    );
    if (!outcome) {
      return;
    }
    this.applyOutcomeState(outcome);
    await this.processPendingCommandsFromPull(outcome.pendingCommands, cloudSnapshot.event.id);
  }

  private applyOutcomeState(outcome: {
    totemConfig: TotemConfigSnapshot;
    questions: Question[];
    logoDataUrl: string | null;
    backgroundDataUrl: string | null;
  }): void {
    this.totemConfig = outcome.totemConfig;
    this.questions = outcome.questions;
    this.cachedLogoDataUrl = outcome.logoDataUrl;
    this.cachedBackgroundDataUrl = outcome.backgroundDataUrl;
  }

  private async processPendingCommandsFromPull(
    pendingCommands: RemoteCommandPayload[],
    justPulledEventId: string,
  ): Promise<void> {
    for (const cmd of pendingCommands) {
      if (!this.commandAppliesToThisTotem(cmd) || !this.markCommandProcessed(cmd)) {
        continue;
      }
      // Snapshot recém-baixado do mesmo Evento já traz a versão atualizada de configuração.
      if (cmd.type === 'CONFIG_UPDATED' && cmd.targetEventId === justPulledEventId) {
        continue;
      }
      if (this.activeMatch !== null) {
        this.deferredCommands = [
          ...this.deferredCommands.filter((existing) => existing.type !== cmd.type),
          structuredClone(cmd),
        ];
      } else {
        await this.executeRemoteCommandNow(cmd);
      }
    }
  }

  private async pullAndMergeCloudSnapshot(): Promise<void> {
    if (!this.isEffectiveOnline()) {
      return;
    }
    try {
      const outcome = await this.syncManager.pullAndApplySnapshot(this.totemConfig, () =>
        this.isEffectiveOnline(),
      );
      if (!outcome) {
        return;
      }
      this.applyOutcomeState(outcome);
      await this.processPendingCommandsFromPull(outcome.pendingCommands, this.totemConfig.event.id);
    } catch {
      // Falha transitória de rede não impede operação offline usando o cache local.
    }
  }

  private async refreshRankingCache(): Promise<RankingEntry[]> {
    const { fullRanking, visibleRanking, totalMatchesCount } =
      await this.syncManager.loadRankingProjection(
        this.totemConfig.event.id,
        this.eventSettings.rankingDisplayCount,
      );
    this.rankingCache = visibleRanking;
    this.totalMatchesCount = totalMatchesCount;
    return fullRanking;
  }

  // Abre a tela de Ranking exibindo dados locais de forma imediata e conciliando com a nuvem em segundo plano.
  async openRankingScreen(): Promise<TotemSessionSnapshot> {
    await this.refreshRankingCache();
    this.transitionWithCleanState('ranking-screen');

    if (this.isEffectiveOnline()) {
      this.enqueueBackgroundTask(async () => {
        await this.syncPendingQueue();
        if (this.disposed) {
          return;
        }
        await this.pullAndMergeCloudSnapshot();
        if (this.disposed) {
          return;
        }
        await this.refreshRankingCache();
        await this.sendHeartbeat();
        this.notifySubscribers();
      });
    } else {
      await this.sendHeartbeat();
    }

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
      const existingWinner = await this.syncManager.findPrizeLockByPhone(
        this.totemConfig.event.id,
        formattedPhone,
      );
      if (existingWinner) {
        this.alreadyWonModal = {
          participantPhone: formattedPhone,
          awardedAt: existingWinner.awardedAt,
        };
        this.lastValidationError = null;
        this.notifySubscribers();
        return {
          started: false,
          alreadyWonPrizeAt: existingWinner.awardedAt,
          snapshot: this.getSnapshot(),
        };
      }
    }

    if (this.eventSettings.giveUpLockoutMinutes > 0) {
      const nowMs = this.clock.now();
      const latestExpiresAtMs = await this.syncManager.findActiveLockoutExpiryMs(
        this.totemConfig.event.id,
        formattedPhone,
        nowMs,
      );

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
    this.backgroundSyncNotice = null;
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
    this.backgroundSyncNotice = null;
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

  enterIdleScreen(): TotemSessionSnapshot {
    return this.transitionWithCleanState('idle-screen');
  }

  wakeFromIdleScreen(): TotemSessionSnapshot {
    if (this.screen !== 'idle-screen') {
      return this.getSnapshot();
    }
    return this.transitionWithCleanState('initial-screen');
  }

  // Abandona a Partida atual sem salvá-la e aplica Bloqueio por Desistência via SHA-256 local + fila.
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
      const phoneHash = hashEventPhone(this.totemConfig.event.id, participantPhone);
      const lockout: GiveUpLockoutRecord = {
        id: this.random.uuid(),
        eventId: this.totemConfig.event.id,
        totemId: this.totemConfig.totemId,
        participantPhone,
        phoneHash,
        lockedAt: this.clock.toISOString(lockedAtMs),
        expiresAt: this.clock.toISOString(expiresAtMs),
      };

      await this.localStore.saveLockout(this.syncManager.sanitizeLockoutForLocalCache(lockout));
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
    const outcome = await this.syncManager.syncPendingQueue(this.totemConfig, () =>
      this.isEffectiveOnline(),
    );

    if (outcome.latestPrizeStockRemaining !== undefined) {
      this.totemConfig.event.prizeStockRemaining = outcome.latestPrizeStockRemaining;
      await this.localStore.saveTotemConfig(this.totemConfig);
    }

    for (const [matchId, claim] of outcome.reconciledClaimsByMatchId.entries()) {
      if (this.lastResult && this.lastResult.matchId === matchId) {
        this.lastResult.prizeStatus = claim.status;
        this.lastResult.wonPrize = isActivePrizeClaim(claim);
      }
    }

    if (outcome.shouldRefreshSnapshot) {
      await this.pullAndMergeCloudSnapshot();
      await this.refreshRankingCache();
    }

    this.pendingSyncCount = outcome.pending;
    return {
      synced: outcome.synced,
      failed: outcome.failed,
      pending: outcome.pending,
    };
  }

  private enqueueBackgroundTask(task: () => Promise<void>): void {
    const previous = this.backgroundSyncPromise ?? Promise.resolve();
    const run = previous
      .then(async () => {
        if (this.disposed) {
          return;
        }
        await task();
      })
      .catch(() => undefined);
    this.backgroundSyncPromise = run;
    void run.finally(() => {
      if (this.backgroundSyncPromise === run) {
        this.backgroundSyncPromise = null;
      }
    });
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
    const phoneHash = hashEventPhone(matchRecord.eventId, match.participantPhone);

    if (wonPrize) {
      prizeStatus = this.eventSettings.requireManualPrizeConfirmation
        ? 'awaiting_pickup'
        : 'delivered';
      prizeClaim = {
        id: this.random.uuid(),
        eventId: matchRecord.eventId,
        matchId,
        totemId: this.totemConfig.totemId,
        participantName: match.participantName,
        participantPhone: match.participantPhone,
        phoneHash,
        status: prizeStatus,
        awardedAt: playedAt,
        deliveredAt: prizeStatus === 'delivered' ? playedAt : null,
      };
      if (currentStock !== null) {
        this.totemConfig.event.prizeStockRemaining = currentStock - 1;
      }
    }

    const sanitizedMatch = this.syncManager.sanitizeMatchForLocalCache(matchRecord);
    const sanitizedPrizeClaim = prizeClaim
      ? this.syncManager.sanitizePrizeLockForLocalCache(prizeClaim)
      : null;

    // 1 única transação atômica local: exibe result-screen em <30ms sem travar aguardando rede.
    await this.localStore.commitMatchLocally({
      sanitizedMatch,
      sanitizedPrizeClaim,
      updatedTotemConfig:
        wonPrize && currentStock !== null ? this.totemConfig : undefined,
      syncItem: {
        idempotencyKey: matchId,
        type: 'match_completed',
        eventId: matchRecord.eventId,
        payload: matchRecord,
        prizeClaim,
        createdAt: playedAt,
        retryCount: 0,
      },
    });

    const queueAfterCommit = await this.localStore.getSyncQueue();
    this.pendingSyncCount = queueAfterCommit.length;

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
    this.backgroundSyncNotice = null;
    this.screen = 'result-screen';
    this.notifySubscribers();

    const optimisticPosition = rankingPosition;
    const optimisticPrizeStatus = prizeStatus;
    if (this.isEffectiveOnline()) {
      this.enqueueBackgroundTask(async () => {
        await this.runPostMatchBackgroundSync(
          matchId,
          matchRecord.eventId,
          optimisticPosition,
          optimisticPrizeStatus,
        );
      });
    } else {
      await this.flushDeferredCommands();
      await this.sendHeartbeat();
      this.notifySubscribers();
    }
  }

  private async runPostMatchBackgroundSync(
    matchId: string,
    eventId: string,
    optimisticPosition: number,
    optimisticPrizeStatus: PrizeClaimStatus | null,
  ): Promise<void> {
    if (this.disposed) {
      return;
    }

    await this.syncPendingQueue();
    if (this.disposed) {
      return;
    }

    if (this.isEffectiveOnline()) {
      await this.pullAndMergeCloudSnapshot();
      if (this.disposed) {
        return;
      }
      this.stagedSnapshotsByEventId.delete(eventId);
      const cloudRanking = await this.refreshRankingCache();
      const updatedPosition =
        cloudRanking.find((entry) => entry.matchId === matchId)?.position ?? optimisticPosition;

      if (this.lastResult && this.lastResult.matchId === matchId) {
        const prevStatus = this.lastResult.prizeStatus;
        this.lastResult.rankingPosition = updatedPosition;
        this.lastResult.isTop3 = updatedPosition > 0 && updatedPosition <= 3;

        if (prevStatus === 'offline_duplicate_conflict') {
          this.backgroundSyncNotice =
            'Trava de Brinde aplicada na nuvem: este telefone já conquistou Brinde neste Evento.';
        } else if (optimisticPrizeStatus !== null && prevStatus === 'revoked') {
          this.backgroundSyncNotice =
            'Estoque de Brindes do Evento esgotado durante a sincronização.';
        } else if (updatedPosition !== optimisticPosition && updatedPosition > 0) {
          this.backgroundSyncNotice = `Ranking consolidado com outros Totens: posição atual ${updatedPosition}º lugar.`;
        }
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
      totalMatchesCount: this.totalMatchesCount,
      backgroundSyncNotice: this.backgroundSyncNotice,
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
      resolvedAssets: this.buildResolvedVisualAssets(),
    };
  }

  private buildResolvedVisualAssets(): { logoSrc: string; backgroundSrc: string | null } {
    return resolveVisualAssetPaths(this.totemConfig.event.customizations.visualIdentity, {
      logoDataUrl: this.cachedLogoDataUrl,
      backgroundDataUrl: this.cachedBackgroundDataUrl,
    });
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
