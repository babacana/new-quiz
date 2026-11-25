import { createContext, useContext } from 'react';
import { translateDefaultText } from './defaultTexts';
import { translateEngineMessage } from './engineMessages';
import type { EventTranslations } from '../domain/types';
import { DEFAULT_LANGUAGE, translate, type Language, type MessageKey, type Translate, type TranslateParams } from './core';

export interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translate;
  /** Traduz texto padrão do Evento (ainda não editado pelo ADM); texto personalizado fica igual. */
  td: (value: string) => string;
}

/** Textos do Evento (em português) e suas traduções importadas pelo ADM, para o `td` resolver. */
export interface EventTextSource {
  texts: Record<string, string | undefined>;
  translations?: EventTranslations;
}

const noop = () => undefined;

export function translateText(value: string, language: Language, source?: EventTextSource): string {
  if (language === 'pt' || !value) {
    return value;
  }
  // 1) Tradução importada pelo ADM para o texto (ainda igual ao atual em português) do Evento.
  const imported = source?.translations?.[language];
  if (imported && source) {
    for (const [key, portuguese] of Object.entries(source.texts)) {
      const candidate = (imported as Record<string, string | undefined>)[key]?.trim();
      if (candidate && portuguese === value) {
        return candidate;
      }
    }
  }
  // 2) Texto padrão do Evento (não editado) e mensagens do engine.
  const fromDefaults = translateDefaultText(value, language);
  return fromDefaults !== value ? fromDefaults : translateEngineMessage(value, language);
}

export function buildValue(
  language: Language,
  setLanguage: (language: Language) => void,
  source?: EventTextSource,
): LanguageContextValue {
  return {
    language,
    setLanguage,
    t: (key: MessageKey, params?: TranslateParams) => translate(language, key, params),
    td: (value: string) => translateText(value, language, source),
  };
}

// Sem provedor (ADM, prévia do layout, testes) tudo segue em português.
export const LanguageContext = createContext<LanguageContextValue>(buildValue(DEFAULT_LANGUAGE, noop));

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
