import { useCallback, useEffect, useState } from 'react';

export type SaasTheme = 'light' | 'dark';

const SAAS_THEME_STORAGE_KEY = 'new-quiz-saas-theme';

function readStoredTheme(): SaasTheme {
  if (typeof window === 'undefined') {
    return 'light';
  }
  try {
    const stored = window.localStorage.getItem(SAAS_THEME_STORAGE_KEY);
    return stored === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function useSaasTheme() {
  const [theme, setThemeState] = useState<SaasTheme>(() => readStoredTheme());

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      window.localStorage.setItem(SAAS_THEME_STORAGE_KEY, theme);
    } catch {
      // Ignora falha de armazenamento em ambientes restritos.
    }
    return () => {
      root.classList.remove('dark');
    };
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggleTheme };
}
