import { useCallback, useMemo, type ReactNode } from 'react';
import { LanguageContext, buildValue, type EventTextSource } from './context';
import type { Language } from './core';

export function LanguageProvider({
  language,
  onLanguageChange,
  eventTexts,
  children,
}: {
  language: Language;
  onLanguageChange: (language: Language) => void;
  eventTexts?: EventTextSource;
  children: ReactNode;
}) {
  const setLanguage = useCallback(onLanguageChange, [onLanguageChange]);
  const value = useMemo(() => buildValue(language, setLanguage, eventTexts), [language, setLanguage, eventTexts]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
