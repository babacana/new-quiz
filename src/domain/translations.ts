import { DEFAULT_CUSTOMIZATIONS } from './defaults';
import type {
  ContentLanguage,
  EventCustomizations,
  EventSettings,
  EventTextKey,
  EventTextTranslations,
  EventTranslations,
  Question,
  QuestionTranslation,
  QuestionTranslations,
} from './types';

export const CONTENT_LANGUAGES: readonly ContentLanguage[] = ['en', 'es'];

export const CONTENT_LANGUAGE_LABELS: Record<ContentLanguage, string> = {
  en: 'EN',
  es: 'ES',
};

export const EVENT_TEXT_KEYS: readonly EventTextKey[] = [
  ...(Object.keys(DEFAULT_CUSTOMIZATIONS.texts) as EventTextKey[]),
  'lgpdNoticeText',
];

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

// Normaliza traduções vindas do banco ou de arquivos: descarta idiomas/campos inválidos e aparas espaços.
export function sanitizeQuestionTranslations(raw: unknown): QuestionTranslations | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const result: QuestionTranslations = {};
  for (const language of CONTENT_LANGUAGES) {
    const entry = (raw as Record<string, unknown>)[language];
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const { text, options } = entry as { text?: unknown; options?: unknown };
    const normalizedOptions = [0, 1, 2, 3].map((index) =>
      asString(Array.isArray(options) ? options[index] : ''),
    ) as QuestionTranslation['options'];
    const normalizedText = asString(text);
    if (normalizedText || normalizedOptions.some(Boolean)) {
      result[language] = { text: normalizedText, options: normalizedOptions };
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function sanitizeEventTranslations(raw: unknown): EventTranslations | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const result: EventTranslations = {};
  for (const language of CONTENT_LANGUAGES) {
    const entry = (raw as Record<string, unknown>)[language];
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const texts: EventTextTranslations = {};
    for (const key of EVENT_TEXT_KEYS) {
      const value = asString((entry as Record<string, unknown>)[key]);
      if (value) {
        texts[key] = value;
      }
    }
    if (Object.keys(texts).length > 0) {
      result[language] = texts;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export type TranslationState = 'complete' | 'partial' | 'missing';

export function isQuestionTranslationComplete(translation: QuestionTranslation | undefined): boolean {
  return Boolean(translation?.text.trim() && translation.options.every((option) => option.trim()));
}

// Só usa a tradução quando está completa: misturar idiomas dentro de uma mesma pergunta confunde o Participante.
export function pickQuestionTranslation(
  translations: QuestionTranslations | undefined,
  language: string,
): QuestionTranslation | null {
  if (language !== 'en' && language !== 'es') {
    return null;
  }
  const translation = translations?.[language];
  return translation && isQuestionTranslationComplete(translation) ? translation : null;
}

export function getQuestionTranslationState(
  question: Pick<Question, 'translations'>,
  language: ContentLanguage,
): TranslationState {
  const translation = question.translations?.[language];
  if (!translation) {
    return 'missing';
  }
  if (isQuestionTranslationComplete(translation)) {
    return 'complete';
  }
  return translation.text.trim() || translation.options.some((option) => option.trim())
    ? 'partial'
    : 'missing';
}

/** Campos que ainda faltam traduzir (rótulos em português para o ADM). */
export function getQuestionMissingFields(
  question: Pick<Question, 'translations'>,
  language: ContentLanguage,
): string[] {
  const translation = question.translations?.[language];
  const missing: string[] = [];
  if (!translation?.text.trim()) {
    missing.push('Enunciado');
  }
  ['A', 'B', 'C', 'D'].forEach((letter, index) => {
    if (!translation?.options[index]?.trim()) {
      missing.push(`Alternativa ${letter}`);
    }
  });
  return missing;
}

export interface TranslationSummary {
  total: number;
  complete: number;
  partial: number;
  missing: number;
}

export function summarizeQuestionTranslations(
  questions: ReadonlyArray<Pick<Question, 'translations'>>,
  language: ContentLanguage,
): TranslationSummary {
  const summary: TranslationSummary = { total: questions.length, complete: 0, partial: 0, missing: 0 };
  for (const question of questions) {
    summary[getQuestionTranslationState(question, language)] += 1;
  }
  return summary;
}

function getEventTextPortuguese(
  key: EventTextKey,
  customizations: Pick<EventCustomizations, 'texts'>,
  settings: Pick<EventSettings, 'lgpdNoticeText'>,
): string {
  return key === 'lgpdNoticeText'
    ? (settings.lgpdNoticeText ?? '')
    : (customizations.texts[key] ?? '');
}

export interface EventTextStatus {
  key: EventTextKey;
  state: 'translated' | 'default' | 'missing';
}

// Um texto conta como traduzido se há tradução importada ou se é o texto padrão (que já vem traduzido no app).
export function getEventTextStatuses(
  customizations: Pick<EventCustomizations, 'texts' | 'translations'>,
  settings: Pick<EventSettings, 'lgpdNoticeText'>,
  language: ContentLanguage,
): EventTextStatus[] {
  const statuses: EventTextStatus[] = [];
  for (const key of EVENT_TEXT_KEYS) {
    const portuguese = getEventTextPortuguese(key, customizations, settings).trim();
    if (!portuguese) {
      continue;
    }
    if (customizations.translations?.[language]?.[key]?.trim()) {
      statuses.push({ key, state: 'translated' });
    } else if (key !== 'lgpdNoticeText' && portuguese === DEFAULT_CUSTOMIZATIONS.texts[key]) {
      statuses.push({ key, state: 'default' });
    } else {
      statuses.push({ key, state: 'missing' });
    }
  }
  return statuses;
}

export function summarizeEventTextTranslations(
  customizations: Pick<EventCustomizations, 'texts' | 'translations'>,
  settings: Pick<EventSettings, 'lgpdNoticeText'>,
  language: ContentLanguage,
): TranslationSummary {
  const statuses = getEventTextStatuses(customizations, settings, language);
  const missing = statuses.filter((status) => status.state === 'missing').length;
  return { total: statuses.length, complete: statuses.length - missing, partial: 0, missing };
}

export interface LanguageCompleteness {
  language: ContentLanguage;
  questions: TranslationSummary;
  texts: TranslationSummary;
  isComplete: boolean;
}

export function getLanguageCompleteness(
  questions: ReadonlyArray<Pick<Question, 'translations' | 'isDisabled'>>,
  customizations: Pick<EventCustomizations, 'texts' | 'translations'>,
  settings: Pick<EventSettings, 'lgpdNoticeText'>,
  language: ContentLanguage,
): LanguageCompleteness {
  const activeQuestions = questions.filter((question) => !question.isDisabled);
  const questionSummary = summarizeQuestionTranslations(activeQuestions, language);
  const textSummary = summarizeEventTextTranslations(customizations, settings, language);
  return {
    language,
    questions: questionSummary,
    texts: textSummary,
    isComplete: questionSummary.complete === questionSummary.total && textSummary.missing === 0,
  };
}
