import {
  convertLegacyBackupToDomain,
  isLegacyQuizOfflineBackup,
  isPlatformBackupPayload,
} from '../backupMigration';
import type { BackupRestoreResult, EventConfig, PlatformBackupPayload } from '../types';
import type { AdminDomainContext } from './adminContext';
import type { EventCatalogModule } from './eventCatalogModule';

// Módulo de domínio para exportação integral e restauração/migração de backups (v1 e quiz-offline legado).
export class BackupModule {
  private readonly ctx: AdminDomainContext;
  private readonly catalog: EventCatalogModule;

  constructor(ctx: AdminDomainContext, catalog: EventCatalogModule) {
    this.ctx = ctx;
    this.catalog = catalog;
  }

  async exportFullBackup(): Promise<string> {
    this.ctx.auth.requireAdmin();
    const [events, questions, matches, prizeClaims, lockouts] = await Promise.all([
      this.ctx.cloudGateway.listEvents(),
      this.ctx.cloudGateway.listAllQuestions(),
      this.ctx.cloudGateway.listMatches(undefined, { includeAnswers: true }),
      this.ctx.cloudGateway.listPrizeClaims(),
      this.ctx.cloudGateway.listGiveUpLockouts(),
    ]);

    const eventQuestionLinksEntries = await Promise.all(
      events.map(async (event) => [
        event.id,
        await this.ctx.cloudGateway.getEventQuestionIds(event.id),
      ] as const),
    );
    const eventQuestionLinks = Object.fromEntries(eventQuestionLinksEntries);

    const payload: PlatformBackupPayload = {
      formatVersion: 1,
      exportedAt: this.ctx.nowIso(),
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
    this.ctx.auth.requireAdmin();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      throw new Error('Arquivo JSON de backup inválido ou malformado.');
    }

    if (isPlatformBackupPayload(parsed)) {
      const savedQuestions = await this.ctx.cloudGateway.replaceAllQuestions(parsed.questions);
      const savedEventIds: string[] = [];
      for (const ev of parsed.events) {
        const bumped: EventConfig = {
          ...structuredClone(ev),
          configVersion: ev.configVersion + 1,
        };
        const saved = await this.ctx.cloudGateway.saveEvent(bumped);
        savedEventIds.push(saved.id);
        const linkedIds = parsed.eventQuestionLinks?.[ev.id];
        if (Array.isArray(linkedIds) && linkedIds.length > 0) {
          await this.ctx.cloudGateway.setEventQuestions(saved.id, linkedIds);
        }
      }

      await this.ctx.cloudGateway.importOperationalRecords({
        matches: parsed.matches ?? [],
        prizeClaims: parsed.prizeClaims ?? [],
        lockouts: parsed.lockouts ?? [],
        replaceEventIds: savedEventIds,
      });

      await Promise.all(
        savedEventIds.map((eventId) => this.catalog.notifyOperationalEventUpdate(eventId)),
      );

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
      const existingEvents = await this.ctx.cloudGateway.listEvents();
      let targetEvent = options.targetEventId
        ? existingEvents.find((ev) => ev.id === options.targetEventId)
        : (existingEvents.find((ev) => ev.isActive) ?? existingEvents[0]);

      if (!targetEvent) {
        targetEvent = await this.catalog.createEvent({
          name: parsed.quizCurrentEvent?.eventName?.trim() || 'Evento Migrado (quiz-offline)',
          isActive: true,
        });
      }

      const migrated = convertLegacyBackupToDomain({
        legacy: parsed,
        targetEvent,
        random: this.ctx.random,
        nowIso: this.ctx.nowIso(),
      });

      const existingQuestions = await this.ctx.cloudGateway.listAllQuestions();
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
          const savedQuestion = await this.ctx.cloudGateway.saveQuestion({
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

      await this.ctx.cloudGateway.saveEvent(migrated.updatedEvent);
      await this.ctx.cloudGateway.setEventQuestions(
        migrated.updatedEvent.id,
        Array.from(new Set(linkedQuestionIds)),
      );

      await this.ctx.cloudGateway.importOperationalRecords({
        matches: remappedMatches,
        prizeClaims: migrated.prizeClaims,
        lockouts: migrated.lockouts,
        replaceEventIds: [migrated.updatedEvent.id],
      });

      await this.catalog.dispatchConfigUpdatedForEvent(
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
