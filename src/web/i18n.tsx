import React, { createContext, useContext, useEffect, useState } from 'react';
import { resolveThemeId } from '../packages/workbench-theme/index.js';

export {
  NAV_GROUPS,
  NAV_ITEMS,
  type NavGroupId,
  type NavGroupSpec,
  type NavItemSpec,
  type NavViewId,
} from './navigation/index.js';

/** This device's light/dark choice; absent when it follows the system. */
export const THEME_MODE_STORAGE_KEY = 'onto_theme';
/** This device's Workbench Theme choice (ADR 0015); never sent to the backend. */
export const WORKBENCH_THEME_STORAGE_KEY = 'onto_workbench_theme';

export type Locale = 'zh-CN' | 'en-US';
export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
export type ThemeMode = ThemePreference;

function getSystemColorScheme(): ResolvedTheme {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

interface PreferencesContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  toggleLocale: () => void;
  themePreference: ThemePreference;
  theme: ResolvedTheme;
  setTheme: (t: ThemePreference) => void;
  toggleTheme: () => void;
  /** The id of the active Workbench Theme, always a built-in one. */
  workbenchTheme: string;
  setWorkbenchTheme: (id: string) => void;
  t: (zh: string, en: string) => string;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    try {
      const saved = localStorage.getItem('onto_locale');
      return saved === 'en-US' ? 'en-US' : 'zh-CN';
    } catch {
      return 'zh-CN';
    }
  });

  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    try {
      const saved = localStorage.getItem(THEME_MODE_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
      return 'system';
    } catch {
      return 'system';
    }
  });

  const [workbenchTheme, setWorkbenchThemeState] = useState<string>(() => {
    try {
      return resolveThemeId(localStorage.getItem(WORKBENCH_THEME_STORAGE_KEY));
    } catch {
      return resolveThemeId(null);
    }
  });

  const [systemScheme, setSystemScheme] = useState<ResolvedTheme>(getSystemColorScheme);
  const resolvedTheme: ResolvedTheme =
    themePreference === 'system' ? systemScheme : themePreference;

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      setSystemScheme(e.matches ? 'dark' : 'light');
    };
    mql.addEventListener('change', onChange);
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_MODE_STORAGE_KEY) {
        setThemePreference(
          e.newValue === 'light' || e.newValue === 'dark' ? e.newValue : 'system',
        );
      } else if (e.key === WORKBENCH_THEME_STORAGE_KEY) {
        setWorkbenchThemeState(resolveThemeId(e.newValue));
      } else if (e.key === 'onto_locale' && (e.newValue === 'zh-CN' || e.newValue === 'en-US')) {
        setLocaleState(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      mql.removeEventListener('change', onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) {
      meta.setAttribute('content', themePreference === 'system' ? 'light dark' : themePreference);
    }
    try {
      if (themePreference === 'system') {
        localStorage.removeItem(THEME_MODE_STORAGE_KEY);
      } else {
        localStorage.setItem(THEME_MODE_STORAGE_KEY, themePreference);
      }
    } catch {
      // Ignore storage write errors in restricted contexts
    }
  }, [themePreference, resolvedTheme]);

  // Mark the root with the active Workbench Theme (ADR 0015).
  useEffect(() => {
    document.documentElement.dataset.workbenchTheme = workbenchTheme;
  }, [workbenchTheme]);

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem('onto_locale', locale);
    } catch {
      // Ignore storage write errors
    }
  }, [locale]);

  const setLocale = (l: Locale) => setLocaleState(l);
  const toggleLocale = () => setLocaleState((prev) => (prev === 'zh-CN' ? 'en-US' : 'zh-CN'));

  const setTheme = (next: ThemePreference) => setThemePreference(next);
  // A device that never chooses keeps nothing stored, so it follows whichever theme is the default.
  const setWorkbenchTheme = (id: string) => {
    const next = resolveThemeId(id);
    setWorkbenchThemeState(next);
    try {
      localStorage.setItem(WORKBENCH_THEME_STORAGE_KEY, next);
    } catch {
      // Ignore storage write errors in restricted contexts
    }
  };

  // Two-state chrome toggle per modern-web-guidance `dark-mode-toggle`:
  // selects the opposite of the currently rendered scheme; if that matches system default, clears override back to 'system'.
  const toggleTheme = () => {
    const target: ResolvedTheme = resolvedTheme === 'light' ? 'dark' : 'light';
    const currentSys = getSystemColorScheme();
    setThemePreference(target === currentSys ? 'system' : target);
  };

  const t = (zh: string, en: string) => (locale === 'zh-CN' ? zh : en);

  return (
    <PreferencesContext.Provider
      value={{
        locale,
        setLocale,
        toggleLocale,
        themePreference,
        theme: resolvedTheme,
        setTheme,
        toggleTheme,
        workbenchTheme,
        setWorkbenchTheme,
        t,
      }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used inside PreferencesProvider');
  return ctx;
}
