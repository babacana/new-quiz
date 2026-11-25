import { CONTENT_LANGUAGE_LABELS, type TranslationSummary } from '../domain/translations';
import type { ContentLanguage } from '../domain/types';

export function describeSummary(
  language: ContentLanguage,
  summary: TranslationSummary,
  noun: string,
): string {
  return `${CONTENT_LANGUAGE_LABELS[language]}: ${summary.complete} de ${summary.total} ${noun}`;
}
