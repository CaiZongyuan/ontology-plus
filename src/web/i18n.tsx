import React, { createContext, useContext, useEffect, useState } from 'react';

export type Locale = 'zh-CN' | 'en-US';
export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
export type ThemeMode = ThemePreference;

export type NavViewId =
  | 'overview'
  // Application Center (应用中心)
  | 'app-req-explore'
  | 'app-req-docs'
  | 'app-prototype'
  | 'app-ontology'
  | 'app-model-files'
  | 'app-knowledge-graph'
  | 'app-four-layer-assets'
  | 'app-assembly-dev'
  | 'app-skills'
  | 'app-publish'
  // Capability Center (能力中心 & 知识中心)
  | 'cap-systems'
  | 'cap-extraction'
  | 'cap-mcp'
  | 'cap-agents'
  | 'cap-cross-flows'
  | 'cap-knowledge'
  // Data Analytics Center (数据分析中心)
  | 'data-resources'
  | 'data-mappings'
  | 'data-metrics-reports'
  | 'data-reasoning'
  | 'data-writeback'
  // Platform Governance
  | 'llm-center'
  | 'system-settings';

export interface NavItemSpec {
  id: NavViewId;
  group: 'OVERVIEW' | 'APPLICATION' | 'CAPABILITY' | 'ANALYTICS' | 'PLATFORM';
  labelZh: string;
  labelEn: string;
  badge?: string;
}

export const NAV_GROUPS: {
  id: NavItemSpec['group'];
  labelZh: string;
  labelEn: string;
}[] = [
  { id: 'OVERVIEW', labelZh: '平台总览', labelEn: 'Workspace' },
  { id: 'APPLICATION', labelZh: '应用中心', labelEn: 'Application Center' },
  { id: 'CAPABILITY', labelZh: '能力中心', labelEn: 'Capability Center' },
  { id: 'ANALYTICS', labelZh: '数据分析中心', labelEn: 'Data Analytics Center' },
  { id: 'PLATFORM', labelZh: '平台治理', labelEn: 'Platform Governance' },
];

export const NAV_ITEMS: NavItemSpec[] = [
  {
    id: 'overview',
    group: 'OVERVIEW',
    labelZh: '项目会话管理',
    labelEn: 'Project Sessions',
  },
  // Application Center
  {
    id: 'app-req-explore',
    group: 'APPLICATION',
    labelZh: '需求探索',
    labelEn: 'Requirement Grilling',
  },
  {
    id: 'app-req-docs',
    group: 'APPLICATION',
    labelZh: '需求文档',
    labelEn: 'SRS Documents',
  },
  {
    id: 'app-prototype',
    group: 'APPLICATION',
    labelZh: '界面原型',
    labelEn: 'UI Prototype & MU',
  },
  {
    id: 'app-ontology',
    group: 'APPLICATION',
    labelZh: '业务本体',
    labelEn: '11-Model Ontology',
    badge: '11',
  },
  {
    id: 'app-model-files',
    group: 'APPLICATION',
    labelZh: '模型文件',
    labelEn: 'Model YAML & OWL',
  },
  {
    id: 'app-knowledge-graph',
    group: 'APPLICATION',
    labelZh: '知识图谱',
    labelEn: 'Knowledge Graph',
  },
  {
    id: 'app-four-layer-assets',
    group: 'APPLICATION',
    labelZh: '四层架构资产',
    labelEn: '4-Layer Assets',
  },
  {
    id: 'app-assembly-dev',
    group: 'APPLICATION',
    labelZh: '应用开发',
    labelEn: 'App Dev & Package',
  },
  {
    id: 'app-skills',
    group: 'APPLICATION',
    labelZh: 'Skills技能',
    labelEn: 'Ontology Skills',
  },
  {
    id: 'app-publish',
    group: 'APPLICATION',
    labelZh: '应用发布',
    labelEn: 'App Releases',
  },
  // Capability Center
  {
    id: 'cap-systems',
    group: 'CAPABILITY',
    labelZh: '系统配置',
    labelEn: 'System Config',
  },
  {
    id: 'cap-extraction',
    group: 'CAPABILITY',
    labelZh: '本体萃取',
    labelEn: 'Ontology Extraction',
  },
  {
    id: 'cap-mcp',
    group: 'CAPABILITY',
    labelZh: 'MCP 配置',
    labelEn: 'MCP Server Hub',
    badge: 'RPC',
  },
  {
    id: 'cap-agents',
    group: 'CAPABILITY',
    labelZh: '智能体与对话',
    labelEn: 'Agents & Smart Chat',
  },
  {
    id: 'cap-cross-flows',
    group: 'CAPABILITY',
    labelZh: '跨系统流程协同',
    labelEn: 'Cross-System Flows',
  },
  {
    id: 'cap-knowledge',
    group: 'CAPABILITY',
    labelZh: '知识中心',
    labelEn: 'Knowledge Center',
  },
  // Data Analytics Center
  {
    id: 'data-resources',
    group: 'ANALYTICS',
    labelZh: '数据资源与文档',
    labelEn: 'DB & Data Docs',
  },
  {
    id: 'data-mappings',
    group: 'ANALYTICS',
    labelZh: '数据本体与映射',
    labelEn: 'Data Ontology & MM',
  },
  {
    id: 'data-metrics-reports',
    group: 'ANALYTICS',
    labelZh: '指标、场景与报告',
    labelEn: 'Metrics, Scenarios & Reports',
  },
  {
    id: 'data-reasoning',
    group: 'ANALYTICS',
    labelZh: '本体推理 (问数/因/策)',
    labelEn: 'Ontology Reasoning',
    badge: 'AI',
  },
  {
    id: 'data-writeback',
    group: 'ANALYTICS',
    labelZh: '回写接口',
    labelEn: 'Write-Back APIs',
  },
  // Platform Governance
  {
    id: 'llm-center',
    group: 'PLATFORM',
    labelZh: '大模型中心',
    labelEn: 'LLM Center',
  },
  {
    id: 'system-settings',
    group: 'PLATFORM',
    labelZh: '系统设置',
    labelEn: 'System Settings',
  },
];

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
      const saved = localStorage.getItem('onto_theme');
      if (saved === 'light' || saved === 'dark') return saved;
      return 'system';
    } catch {
      return 'system';
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
      if (e.key === 'onto_theme') {
        setThemePreference(
          e.newValue === 'light' || e.newValue === 'dark' ? e.newValue : 'system',
        );
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
        localStorage.removeItem('onto_theme');
      } else {
        localStorage.setItem('onto_theme', themePreference);
      }
    } catch {
      // Ignore storage write errors in restricted contexts
    }
  }, [themePreference, resolvedTheme]);

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
