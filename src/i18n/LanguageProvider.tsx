import { useCallback, useMemo, type ReactNode } from 'react';
import { LanguageContext, buildValue } from './context';
import type { Language } from './core';

export function LanguageProvider({
  language,
  onLanguageChange,
  children,
}: {
  language: Language;
  onLanguageChange: (language: Language) => void;
  children: ReactNode;
}) {
  const setLanguage = useCallback(onLanguageChange, [onLanguageChange]);
  const value = useMemo(() => buildValue(language, setLanguage), [language, setLanguage]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
