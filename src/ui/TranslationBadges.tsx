import {
  CONTENT_LANGUAGES,
  CONTENT_LANGUAGE_LABELS,
  getQuestionMissingFields,
  getQuestionTranslationState,
} from '../domain/translations';
import type { Question } from '../domain/types';
import { cn } from './lib/utils';

// Selos "EN ✓ / ES ⚠" por pergunta: ✓ traduzida por completo, ⚠ falta enunciado ou alternativa.
export function QuestionTranslationBadges({ question }: { question: Pick<Question, 'translations'> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-testid="translation-badges">
      {CONTENT_LANGUAGES.map((language) => {
        const state = getQuestionTranslationState(question, language);
        const missing = getQuestionMissingFields(question, language);
        const label = CONTENT_LANGUAGE_LABELS[language];
        return (
          <span
            key={language}
            data-language={language}
            data-state={state}
            title={
              state === 'complete'
                ? `${label}: traduzida`
                : `${label}: falta ${missing.join(', ')} (aparece em português)`
            }
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium',
              state === 'complete'
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                : 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
            )}
          >
            {label} {state === 'complete' ? '✓' : '⚠'}
          </span>
        );
      })}
    </span>
  );
}
