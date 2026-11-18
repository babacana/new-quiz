import { mergeEventCustomizations } from '../customizationThemes';
import { DEFAULT_CUSTOMIZATIONS, DEFAULT_SETTINGS } from '../defaults';
import type {
  CloneEventOverrides,
  EventConfig,
  EventCustomizations,
  EventCustomizationsPatch,
  EventSettings,
  EventUpsertInput,
  EventVisualAssetUploadInput,
} from '../types';
import type { AdminDomainContext } from './adminContext';

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

// Módulo de domínio para catálogo Multi-Evento, personalização visual, estoque e sincronismo de configVersion.
export class EventCatalogModule {
  private readonly ctx: AdminDomainContext;

  constructor(ctx: AdminDomainContext) {
    this.ctx = ctx;
  }

  async listEvents(): Promise<EventConfig[]> {
    this.ctx.auth.requireAuthenticated();
    return this.ctx.cloudGateway.listEvents();
  }

  async getEventQuestionIds(eventId: string): Promise<number[]> {
    this.ctx.auth.requireAuthenticated();
    return this.ctx.cloudGateway.getEventQuestionIds(eventId);
  }

  async createEvent(input: EventUpsertInput): Promise<EventConfig> {
    this.ctx.auth.requireAdmin();

    const cleanName = input.name.trim();
    if (!cleanName) {
      throw new Error('O nome do Evento é obrigatório.');
    }

    const existingEvents = await this.ctx.cloudGateway.listEvents();
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
      id: input.id ?? this.ctx.random.uuid(),
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

    const saved = await this.ctx.cloudGateway.saveEvent(event);
    if (input.linkedQuestionIds && input.linkedQuestionIds.length > 0) {
      await this.ctx.cloudGateway.setEventQuestions(saved.id, input.linkedQuestionIds);
    }

    return saved;
  }

  async updateEvent(eventId: string, patch: Partial<EventUpsertInput>): Promise<EventConfig> {
    this.ctx.auth.requireAdmin();

    const events = await this.ctx.cloudGateway.listEvents();
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

    const saved = await this.ctx.cloudGateway.saveEvent(updated);
    if (patch.linkedQuestionIds !== undefined) {
      await this.ctx.cloudGateway.setEventQuestions(saved.id, patch.linkedQuestionIds);
    }

    await this.dispatchConfigUpdatedForEvent(saved.id, saved.configVersion);
    return saved;
  }

  async setEventActive(eventId: string, isActive: boolean): Promise<EventConfig> {
    return this.updateEvent(eventId, { isActive });
  }

  async cloneEvent(sourceEventId: string, overrides: CloneEventOverrides): Promise<EventConfig> {
    this.ctx.auth.requireAdmin();

    const events = await this.ctx.cloudGateway.listEvents();
    const source = events.find((ev) => ev.id === sourceEventId);
    if (!source) {
      throw new Error(`Evento de origem não encontrado para clonagem (${sourceEventId}).`);
    }

    const linkedQuestionIds = await this.ctx.cloudGateway.getEventQuestionIds(sourceEventId);

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

  async dispatchConfigUpdatedForEvent(
    eventId: string,
    configVersion: number,
  ): Promise<void> {
    await this.ctx.cloudGateway.dispatchRemoteCommand({
      id: this.ctx.random.uuid(),
      type: 'CONFIG_UPDATED',
      targetTotemId: null,
      targetEventId: eventId,
      configVersion,
      issuedAt: this.ctx.nowIso(),
    });
  }

  async bumpAndNotifyEvent(event: EventConfig): Promise<void> {
    const nextVersion = event.configVersion + 1;
    await this.ctx.cloudGateway.saveEvent({
      ...structuredClone(event),
      configVersion: nextVersion,
    });
    await this.dispatchConfigUpdatedForEvent(event.id, nextVersion);
  }

  /**
   * Notifica apenas Eventos ativos efetivamente impactados pelas questões modificadas,
   * executando em paralelo em vez de varrer Eventos encerrados em loop sequencial.
   */
  async notifyActiveEventsQuestionsChanged(affectedQuestionIds?: number[]): Promise<void> {
    const events = await this.ctx.cloudGateway.listEvents();
    const activeEvents = events.filter((ev) => ev.isActive);
    if (activeEvents.length === 0) {
      return;
    }

    const affectedSet =
      affectedQuestionIds && affectedQuestionIds.length > 0
        ? new Set(affectedQuestionIds)
        : null;

    if (!affectedSet) {
      await Promise.all(activeEvents.map((ev) => this.bumpAndNotifyEvent(ev)));
      return;
    }

    const linksByEvent = await Promise.all(
      activeEvents.map(async (ev) => ({
        event: ev,
        linkedIds: await this.ctx.cloudGateway.getEventQuestionIds(ev.id),
      })),
    );

    const impactedEvents = linksByEvent
      .filter(
        ({ linkedIds }) =>
          linkedIds.length === 0 || linkedIds.some((id) => affectedSet.has(id)),
      )
      .map(({ event }) => event);

    await Promise.all(impactedEvents.map((ev) => this.bumpAndNotifyEvent(ev)));
  }

  async bumpEventConfigVersion(eventId: string): Promise<void> {
    const events = await this.ctx.cloudGateway.listEvents();
    const existing = events.find((ev) => ev.id === eventId);
    if (!existing) {
      throw new Error(`Evento não encontrado (${eventId}).`);
    }
    await this.bumpAndNotifyEvent(existing);
  }

  async notifyOperationalEventUpdate(eventId: string): Promise<void> {
    const events = await this.ctx.cloudGateway.listEvents();
    const targetEvent = events.find((ev) => ev.id === eventId);
    if (!targetEvent) {
      return;
    }

    if (this.ctx.auth.getSession()?.user.role === 'admin') {
      await this.bumpAndNotifyEvent(targetEvent);
      return;
    }

    await this.dispatchConfigUpdatedForEvent(targetEvent.id, targetEvent.configVersion);
  }

  async setEventQuestions(eventId: string, questionIds: number[]): Promise<void> {
    this.ctx.auth.requireAdmin();
    await this.ctx.cloudGateway.setEventQuestions(eventId, questionIds);
    await this.bumpEventConfigVersion(eventId);
  }

  async setEventQuestionsByTags(
    eventId: string,
    tags: string[],
    normalizeTagList: (raw?: string[]) => string[],
  ): Promise<number[]> {
    this.ctx.auth.requireAdmin();
    const normalizedTargets = new Set(normalizeTagList(tags));
    const allQuestions = await this.ctx.cloudGateway.listAllQuestions();
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

    await this.ctx.cloudGateway.setEventQuestions(eventId, matchingIds);
    await this.bumpEventConfigVersion(eventId);
    return matchingIds;
  }

  async uploadEventVisualAsset(
    input: EventVisualAssetUploadInput,
  ): Promise<{ url: string; fileName: string }> {
    this.ctx.auth.requireAdmin();
    if (!input.bytes || input.bytes.length === 0) {
      throw new Error('Selecione um arquivo de imagem válido para upload.');
    }
    return this.ctx.cloudGateway.uploadEventVisualAsset(input);
  }

  async saveEventCustomizations(
    eventId: string,
    customizations: EventCustomizationsPatch | EventCustomizations,
  ): Promise<EventConfig> {
    this.ctx.auth.requireAdmin();
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

    return this.updateEvent(eventId, { customizations: normalizedPatch });
  }
}
