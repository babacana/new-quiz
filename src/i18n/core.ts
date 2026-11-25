import { en } from './messages.en';
import { es } from './messages.es';
import { pt, type MessageKey, type Messages } from './messages.pt';

export type Language = 'pt' | 'en' | 'es';
export const DEFAULT_LANGUAGE: Language = 'pt';
export const LANGUAGES: readonly Language[] = ['pt', 'en', 'es'];
export type { MessageKey };

const CATALOGS: Record<Language, Messages> = { pt, en, es };

export const HTML_LANG: Record<Language, string> = { pt: 'pt-BR', en: 'en', es: 'es' };

export type TranslateParams = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: TranslateParams) => string;

export function translate(language: Language, key: MessageKey, params?: TranslateParams): string {
  const template = CATALOGS[language][key] ?? pt[key];
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

