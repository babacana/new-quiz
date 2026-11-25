import {
  getLanguageCompleteness,
  CONTENT_LANGUAGES,
  type LanguageCompleteness,
} from '../translations';
import type {
  ContentLanguage,
  EventConfig,
  EventTextKey,
  EventTranslations,
  Question,
} from '../types';
import type { AdminDomainContext } from './adminContext';
import type { EventCatalogModule } from './eventCatalogModule';
import type { QuestionBankModule } from './questionBankModule';
import {
  readTranslationWorkbook,
  writeTranslationWorkbook,
  type ParsedTranslationWorkbook,
} from './translationWorkbook';

export interface TranslationImportPlan {
  questionsToUpdate: number;
  questionsUnchanged: number;
  /** IDs da planilha que não existem no Banco de Questões (ignorados). */
  unknownQuestionIds: number[];
  textsChanged: number;
  /** Situação por idioma depois de aplicar a planilha. */
  after: Record<ContentLanguage, LanguageCompleteness>;
}

export interface TranslationImportResult extends TranslationImportPlan {
  updatedQuestionIds: number[];
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function mergeEventTranslations(
  current: EventTranslations | undefined,
  incoming: EventTranslations | undefined,
  keysInFile: EventTextKey[],
): EventTranslations | undefined {
  const merged: EventTranslations = {};
  for (const language of CONTENT_LANGUAGES) {
    const texts = { ...(current?.[language] ?? {}) };
    for (const key of keysInFile) {
      const value = incoming?.[language]?.[key];
      if (value) {
        texts[key] = value;
      } else {
        delete texts[key];
      }
    }
    if (Object.keys(texts).length > 0) {
      merged[language] = texts;
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

// Exporta/importa as traduções EN/ES (planilha) das perguntas do Evento e dos textos da personalização.
export class TranslationModule {
  private readonly ctx: AdminDomainContext;
  private readonly catalog: EventCatalogModule;
  private readonly questionBank: QuestionBankModule;

  constructor(ctx: AdminDomainContext, catalog: EventCatalogModule, questionBank: QuestionBankModule) {
    this.ctx = ctx;
    this.catalog = catalog;
    this.questionBank = questionBank;
  }

  private async getEvent(eventId: string): Promise<EventConfig> {
    const event = (await this.catalog.listEvents()).find((candidate) => candidate.id === eventId);
    if (!event) {
      throw new Error('Evento não encontrado.');
    }
    return event;
  }

  async exportTranslationsXlsx(eventId: string): Promise<ArrayBuffer> {
    this.ctx.auth.requireAdmin();
    const event = await this.getEvent(eventId);
    const questions = await this.questionBank.listAllQuestions(eventId);
    return writeTranslationWorkbook({
      questions,
      eventTexts: { ...event.customizations.texts, lgpdNoticeText: event.settings.lgpdNoticeText },
      eventTranslations: event.customizations.translations,
    });
  }

  private async plan(
    file: ArrayBuffer,
    eventId: string,
  ): Promise<{
    event: EventConfig;
    parsed: ParsedTranslationWorkbook;
    toUpdate: Question[];
    plan: TranslationImportPlan;
    nextTranslations: EventTranslations | undefined;
  }> {
    this.ctx.auth.requireAdmin();
    const event = await this.getEvent(eventId);
    const parsed = await readTranslationWorkbook(file);
    const bank = new Map((await this.questionBank.listAllQuestions()).map((q) => [q.id, q]));
    const eventQuestions = await this.questionBank.listAllQuestions(eventId);

    const unknownQuestionIds: number[] = [];
    const toUpdate: Question[] = [];
    let unchanged = 0;
    for (const row of parsed.questions) {
      const current = bank.get(row.id);
      if (!current) {
        unknownQuestionIds.push(row.id);
      } else if (sameJson(current.translations, row.translations)) {
        unchanged += 1;
      } else {
        toUpdate.push({ ...current, translations: row.translations ?? {} });
      }
    }

    const nextTranslations = mergeEventTranslations(
      event.customizations.translations,
      parsed.eventTranslations,
      parsed.textKeysInFile,
    );
    const textsChanged = sameJson(nextTranslations, event.customizations.translations)
      ? 0
      : parsed.textKeysInFile.length;

    const afterQuestions = eventQuestions.map(
      (q) => toUpdate.find((updated) => updated.id === q.id) ?? q,
    );
    const afterCustomizations = { ...event.customizations, translations: nextTranslations };
    const after = Object.fromEntries(
      CONTENT_LANGUAGES.map((language) => [
        language,
        getLanguageCompleteness(afterQuestions, afterCustomizations, event.settings, language),
      ]),
    ) as Record<ContentLanguage, LanguageCompleteness>;

    return {
      event,
      parsed,
      toUpdate,
      nextTranslations,
      plan: {
        questionsToUpdate: toUpdate.length,
        questionsUnchanged: unchanged,
        unknownQuestionIds,
        textsChanged,
        after,
      },
    };
  }

  async previewTranslationsXlsx(file: ArrayBuffer, eventId: string): Promise<TranslationImportPlan> {
    return (await this.plan(file, eventId)).plan;
  }

  async importTranslationsXlsx(file: ArrayBuffer, eventId: string): Promise<TranslationImportResult> {
    const { toUpdate, plan, nextTranslations, event } = await this.plan(file, eventId);
    for (const question of toUpdate) {
      await this.questionBank.updateQuestion(question.id, {
        text: question.text,
        options: question.options,
        correctIndex: question.correctIndex,
        difficulty: question.difficulty,
        tags: question.tags,
        isDisabled: question.isDisabled,
        translations: question.translations,
      });
    }
    if (plan.textsChanged > 0) {
      await this.catalog.saveEventCustomizations(event.id, { translations: nextTranslations ?? {} });
    }
    return { ...plan, updatedQuestionIds: toUpdate.map((question) => question.id) };
  }
}
