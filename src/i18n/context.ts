import { createContext, useContext } from 'react';
import { translateDefaultText } from './defaultTexts';
import { DEFAULT_LANGUAGE, translate, type Language, type MessageKey, type Translate, type TranslateParams } from './core';

export interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translate;
  /** Traduz texto padrão do Evento (ainda não editado pelo ADM); texto personalizado fica igual. */
  td: (value: string) => string;
}

const noop = () => undefined;

export function buildValue(language: Language, setLanguage: (language: Language) => void) {
  return {
    language,
    setLanguage,
    t: (key: MessageKey, params?: TranslateParams) => translate(language, key, params),
    td: (value: string) => translateDefaultText(value, language),
  };
}

// Sem provedor (ADM, prévia do layout, testes) tudo segue em português.
export const LanguageContext = createContext<LanguageContextValue>(buildValue(DEFAULT_LANGUAGE, noop));

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
