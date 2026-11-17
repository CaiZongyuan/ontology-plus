import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderKanban,
  Globe,
  Loader2,
  Moon,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  Search,
  Sun,
} from 'lucide-react';
import { useWorkbenchStore } from './api.js';
import { PreferencesProvider, usePreferences } from './i18n.js';
import {
  NAV_GROUPS,
  NAV_ICONS,
  NAV_ITEMS,
  agentPanelSurfaceFor,
  getNavGroupSpec,
  getNavItemSpec,
  getNavItemsByGroup,
  getProjectLifecycleState,
  isFlushNavView,
  readHashView,
  readUrlNavState,
  resolveNavViewId,
  writeUrlNavState,
  type NavGroupId,
  type NavViewId,
} from './navigation/index.js';
import { WorkbenchViewHost } from './navigation/viewDispatch.js';
import { BUILT_IN_THEMES } from '../packages/workbench-theme/index.js';
import { Button } from './components/beautifui/index.js';
import {
  ShellAgentPanel,
  resolveActiveWorkspaceRuns,
  useAgentPanelOverlayMode,
} from './components/agent/ShellAgentPanel.js';
import {
  AGENT_PANEL_WIDE_CSS_WIDTH,
  parseAgentPanelPrefs,
  useAgentPanelStore,
} from './components/agent/agentPanelStore.js';

function readStoredJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage write errors in restricted contexts
  }
}

const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

/* ─── Command Palette (Ctrl/⌘ + K) ─── */
interface CommandEntry {
  key: string;
  section: string;
  label: string;
  meta?: string;
  icon: React.ReactNode;
  keywords: string;
  run: () => void;
}

function CommandPalette({
  open,
  onClose,
  entries,
}: {
  open: boolean;
  onClose: () => void;
  entries: CommandEntry[];
}) {
  const { t } = usePreferences();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      setQuery('');
      setCursor(0);
      dlg.showModal();
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    const terms = q.split(/\s+/);
    return entries.filter((e) => terms.every((term) => e.keywords.includes(term)));
  }, [entries, query]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-cmdk-index="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const runAt = (idx: number) => {
    const entry = filtered[idx];
    if (!entry) return;
    onClose();
    entry.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => (filtered.length ? (c + 1) % filtered.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => (filtered.length ? (c - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runAt(cursor);
    }
  };

  let lastSection = '';
  return (
    <dialog
      ref={dialogRef}
      className="cmdk"
      data-testid="command-palette"
      aria-label={t('命令面板', 'Command palette')}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="cmdk-input-row">
        <Search size={16} />
        <input
          ref={inputRef}
          className="cmdk-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('搜索页面、切换工程…', 'Search pages, switch projects…')}
          aria-label={t('搜索', 'Search')}
        />
        <span className="kbd">Esc</span>
      </div>
      <div className="cmdk-list" ref={listRef} role="listbox">
        {filtered.length === 0 && (
          <div className="cmdk-empty">{t('没有匹配的结果', 'No matching results')}</div>
        )}
        {filtered.map((entry, idx) => {
          const header = entry.section !== lastSection ? entry.section : null;
          lastSection = entry.section;
          return (
            <React.Fragment key={entry.key}>
              {header && <div className="cmdk-section">{header}</div>}
              <button
                type="button"
                role="option"
                aria-selected={idx === cursor}
                data-cmdk-index={idx}
                className={`cmdk-item ${idx === cursor ? 'selected' : ''}`}
                onMouseMove={() => setCursor(idx)}
                onClick={() => runAt(idx)}
              >
                <span className="cmdk-icon">{entry.icon}</span>
                <span>{entry.label}</span>
                {entry.meta && <span className="cmdk-meta">{entry.meta}</span>}
              </button>
            </React.Fragment>
          );
        })}
      </div>
      <div className="cmdk-footer">
        <span>
          <span className="kbd">↑</span>
          <span className="kbd">↓</span> {t('选择', 'Navigate')}
        </span>
        <span>
          <span className="kbd">↵</span> {t('打开', 'Open')}
        </span>
        <span>
          <span className="kbd">Esc</span> {t('关闭', 'Close')}
        </span>
      </div>
    </dialog>
  );
}

function LoadingState() {
  return (
    <div className="loading-state" aria-busy="true">
      <div className="loading-row">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-[96px]" />
        ))}
      </div>
      <div className="skeleton h-[140px]" />
      <div className="skeleton h-[260px]" />
    </div>
  );
}

function ShellInner() {
  const { locale, toggleLocale, theme, toggleTheme, workbenchTheme, setWorkbenchTheme, t } = usePreferences();
  const {
    data,
    loading,
    toast,
    activeNav,
    liveSessionDrafts,
    liveAnnouncement,
    setActiveNav,
    setActivePrototypeId,
    bootstrap,
    switchProject,
  } = useWorkbenchStore();
  const lifecycle = data ? getProjectLifecycleState(data) : null;
  const activeWorkspaceRuns = useMemo(
    () => resolveActiveWorkspaceRuns(data, liveSessionDrafts),
    [data, liveSessionDrafts],
  );
  const activeView: NavViewId = resolveNavViewId(activeNav);
  const [collapsed, setCollapsedState] = useState<boolean>(() =>
    readStoredJson('onto_sidebar_collapsed', false),
  );
  const [closedGroups, setClosedGroups] = useState<NavGroupId[]>(() =>
    readStoredJson<NavGroupId[]>('onto_nav_closed_groups', []),
  );
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Agent Panel (ADR 0009): a shell column on wide viewports, an overlay on narrow ones.
  const agentSurface = agentPanelSurfaceFor(activeView);
  const agentPanelOverlay = useAgentPanelOverlayMode();
  const agentPanelOpen = useAgentPanelStore((s) => s.open);
  const agentPanelOverlayOpen = useAgentPanelStore((s) => s.overlayOpen);
  const agentPanelWidth = useAgentPanelStore((s) => s.width);
  const agentPanelWideMode = useAgentPanelStore((s) => s.wideMode);
  const agentPanelVisible =
    Boolean(agentSurface) && (agentPanelOverlay ? agentPanelOverlayOpen : agentPanelOpen);
  const setAgentPanelVisible = (visible: boolean) => {
    const panel = useAgentPanelStore.getState();
    if (agentPanelOverlay) panel.setOverlayOpen(visible);
    else panel.setOpen(visible);
  };

  const prevViewRef = useRef<NavViewId | null>(null);
  useEffect(() => {
    const prevView = prevViewRef.current;
    prevViewRef.current = activeView;
    const prevSurface = prevView ? agentPanelSurfaceFor(prevView) : undefined;
    const nextSurface = agentPanelSurfaceFor(activeView);
    const panel = useAgentPanelStore.getState();
    if (nextSurface?.conversationPrimary) {
      panel.setWideMode(true, { commit: false });
    } else if (prevSurface?.conversationPrimary && !nextSurface?.conversationPrimary) {
      let persistedWide = false;
      try {
        persistedWide = parseAgentPanelPrefs(localStorage.getItem('onto_agent_panel')).wideMode;
      } catch {
        persistedWide = false;
      }
      if (!persistedWide) {
        panel.setWideMode(false, { commit: false });
      }
    }
  }, [activeView]);

  const handleJumpToActiveRun = async () => {
    const targetRun = activeWorkspaceRuns[0];
    if (!targetRun) return;
    if (data && data.activeProject.id !== targetRun.projectId) {
      await switchProject(targetRun.projectId);
    }
    if (targetRun.agentKind === 'PROTOTYPE_CO_DESIGN' && targetRun.targetId) {
      setActivePrototypeId(targetRun.projectId, targetRun.targetId);
    }
    setActiveNav(targetRun.targetNav, {
      itemId: targetRun.targetId ?? null,
      sessionId: targetRun.sessionId,
    });
    useAgentPanelStore.getState().revealPanel();
  };

  const toggleCollapsed = () => {
    setCollapsedState((prev) => {
      writeStoredJson('onto_sidebar_collapsed', !prev);
      return !prev;
    });
  };

  const toggleGroup = (id: NavGroupId) => {
    setClosedGroups((prev) => {
      const next = prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id];
      writeStoredJson('onto_nav_closed_groups', next);
      return next;
    });
  };

  const setActiveView = useCallback(
    (view: NavViewId) => {
      setActiveNav(view);
      writeUrlNavState({ nav: view });
    },
    [setActiveNav],
  );

  useEffect(() => {
    const initial = readUrlNavState();
    void bootstrap(initial.projectId);
    const syncFromLocation = () => {
      const next = readHashView();
      setActiveNav(next);
    };
    window.addEventListener('hashchange', syncFromLocation);
    window.addEventListener('popstate', syncFromLocation);
    return () => {
      window.removeEventListener('hashchange', syncFromLocation);
      window.removeEventListener('popstate', syncFromLocation);
    };
  }, [bootstrap, setActiveNav]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!agentSurface) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setAgentPanelVisible(!agentPanelVisible);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentSurface, agentPanelVisible, agentPanelOverlay]);

  const activeNavSpec = getNavItemSpec(activeView);
  const activeGroupSpec = activeNavSpec ? getNavGroupSpec(activeNavSpec.group) : undefined;
  const activeLabel = activeNavSpec ? t(activeNavSpec.labelZh, activeNavSpec.labelEn) : '';

  useEffect(() => {
    document.title = activeLabel ? `${activeLabel} · Ontology Plus` : 'Ontology Plus';
  }, [activeLabel]);

  const paletteEntries = useMemo<CommandEntry[]>(() => {
    const pageEntries: CommandEntry[] = NAV_ITEMS.map((item) => {
      const grp = getNavGroupSpec(item.group);
      return {
        key: `nav:${item.id}`,
        section: t('页面', 'Pages'),
        label: t(item.labelZh, item.labelEn),
        meta: grp ? t(grp.labelZh, grp.labelEn) : undefined,
        icon: NAV_ICONS[item.id],
        keywords: [item.labelZh, item.labelEn, item.id, grp?.labelZh, grp?.labelEn]
          .join(' ')
          .toLowerCase(),
        run: () => setActiveView(item.id),
      };
    });
    const projectEntries: CommandEntry[] = (data?.projects ?? []).map((p) => ({
      key: `project:${p.id}`,
      section: t('切换工程', 'Switch project'),
      label: p.name,
      meta: p.id === data?.activeProject.id ? t('当前', 'Current') : p.code,
      icon: <FolderKanban size={15} />,
      keywords: `${p.name} ${p.code} project 工程`.toLowerCase(),
      run: () => switchProject(p.id),
    }));
    const prefEntries: CommandEntry[] = [
      {
        key: 'pref:theme',
        section: t('偏好', 'Preferences'),
        label:
          theme === 'light'
            ? t('切换到深色主题', 'Switch to dark theme')
            : t('切换到浅色主题', 'Switch to light theme'),
        icon: theme === 'light' ? <Moon size={15} /> : <Sun size={15} />,
        keywords: 'theme dark light 主题 深色 浅色',
        run: toggleTheme,
      },
      ...BUILT_IN_THEMES.filter((option) => option.id !== workbenchTheme).map(
        (option): CommandEntry => ({
          key: `pref:workbench-theme:${option.id}`,
          section: t('偏好', 'Preferences'),
          label: t(`切换到工作台主题：${option.name.zh}`, `Switch to workbench theme: ${option.name.en}`),
          icon: <Palette size={15} />,
          keywords: `workbench theme 工作台主题 主题 ${option.id} ${option.name.zh} ${option.name.en}`.toLowerCase(),
          run: () => setWorkbenchTheme(option.id),
        }),
      ),
      {
        key: 'pref:locale',
        section: t('偏好', 'Preferences'),
        label: locale === 'zh-CN' ? 'Switch to English' : '切换为中文',
        icon: <Globe size={15} />,
        keywords: 'language locale english chinese 语言 中文 英文',
        run: toggleLocale,
      },
    ];
    return [...pageEntries, ...projectEntries, ...prefEntries];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, locale, theme, workbenchTheme]);

  const validation = data?.activeProject.validation;
  const hasErrors = (validation?.errorCount ?? 0) > 0;
  const collapseLabel = collapsed ? t('展开侧边栏', 'Expand sidebar') : t('折叠侧边栏', 'Collapse sidebar');

  return (
    <div
      className={`platform-shell ${collapsed ? 'sidebar-collapsed' : ''} ${
        agentPanelVisible && !agentPanelOverlay ? 'has-agent-panel' : ''
      }`}
      style={
        {
          '--agent-panel-w': agentPanelWideMode
            ? AGENT_PANEL_WIDE_CSS_WIDTH
            : `${agentPanelWidth}px`,
        } as React.CSSProperties
      }
    >
      {/* ─── Left Sidebar ─── */}
      <aside className="platform-sidebar" aria-label={t('主导航', 'Main navigation')}>
        <div className="sidebar-brand">
          {!collapsed && (
            <div className="brand-title">
              <span className="brand-mark">O+</span>
              <span>
                Ontology Plus
                <small>{t('本体驱动研发工作台', 'Ontology-driven workbench')}</small>
              </span>
            </div>
          )}
          <Button
            type="button"
            variant="secondary" size="md" className="icon-btn"
            onClick={toggleCollapsed}
            title={collapseLabel}
            aria-label={collapseLabel}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </Button>
        </div>

        <button
          type="button"
          className="sidebar-search"
          data-testid="open-command-palette-btn"
          onClick={() => setPaletteOpen(true)}
          title={t('搜索 / 跳转', 'Search / Jump to')}
        >
          <Search size={14} />
          {!collapsed && (
            <>
              <span>{t('搜索或跳转…', 'Search or jump to…')}</span>
              <span className="kbd">{IS_MAC ? '⌘' : 'Ctrl'} K</span>
            </>
          )}
        </button>

        <nav className="sidebar-scroll">
          {NAV_GROUPS.map((grp, gi) => {
            const items = getNavItemsByGroup(grp.id);
            const containsActive = items.some((i) => i.id === activeView);
            const isClosed = !collapsed && closedGroups.includes(grp.id) && !containsActive;
            const showHeader = !collapsed && grp.id !== 'OVERVIEW';
            return (
              <div key={grp.id} className={`nav-group ${isClosed ? 'closed' : ''}`}>
                {collapsed && gi > 0 && <div className="nav-group-divider" />}
                {showHeader && (
                  <button
                    type="button"
                    className="nav-group-label"
                    aria-expanded={!isClosed}
                    onClick={() => toggleGroup(grp.id)}
                  >
                    <span>{t(grp.labelZh, grp.labelEn)}</span>
                    <span className="nav-group-count">{items.length}</span>
                    <ChevronDown size={13} className="chev" />
                  </button>
                )}
                {!isClosed &&
                  items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      data-testid={`nav-${item.id}`}
                      className={`nav-item ${activeView === item.id ? 'active' : ''}`}
                      aria-current={activeView === item.id ? 'page' : undefined}
                      onClick={() => setActiveView(item.id)}
                      title={t(item.labelZh, item.labelEn)}
                    >
                      <span className="nav-item-left">
                        <span className="nav-icon">{NAV_ICONS[item.id]}</span>
                        {!collapsed && <span>{t(item.labelZh, item.labelEn)}</span>}
                      </span>
                      <span className="nav-item-right">
                        {activeWorkspaceRuns.some(
                          (r) =>
                            r.projectId === data?.activeProject.id &&
                            r.targetNav === item.id,
                        ) && (
                          <span
                            className="nav-task-dot is-running"
                            title={t('智能体正在运行', 'Agent run active')}
                            aria-hidden="true"
                          />
                        )}
                        {!collapsed &&
                          (item.id === 'app-ontology' && lifecycle ? (
                            <span
                              className={`nav-badge ${!lifecycle.hasOntology ? 'opacity-65' : ''}`}
                            >
                              {lifecycle.hasOntology
                                ? `${lifecycle.presentModelCount}/11`
                                : t('待生成', 'Pending')}
                            </span>
                          ) : (
                            item.badge && <span className="nav-badge">{item.badge}</span>
                          ))}
                      </span>
                    </button>
                  ))}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-footer-row">
            <Button
              variant="ghost"
              size="sm"
              className={collapsed ? 'w-8 px-0' : 'flex-1'}
              data-testid="theme-toggle-btn"
              onClick={toggleTheme}
              title={theme === 'light' ? t('切换到深色', 'Switch to dark') : t('切换到浅色', 'Switch to light')}
            >
              {theme === 'light' ? <Sun size={14} /> : <Moon size={14} />}
              {!collapsed && (theme === 'light' ? t('浅色', 'Light') : t('深色', 'Dark'))}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={collapsed ? 'w-8 px-0' : 'flex-1'}
              data-testid="locale-toggle-btn"
              onClick={toggleLocale}
              title={locale === 'zh-CN' ? 'Switch to English' : '切换为中文'}
            >
              <Globe size={14} />
              {!collapsed && (locale === 'zh-CN' ? '中文' : 'English')}
            </Button>
          </div>
        </div>
      </aside>

      {/* ─── Main Workbench Area ─── */}
      <main className="platform-main">
        <header className="platform-topbar">
          <div className="topbar-left">
            <div className="breadcrumb">
              {activeGroupSpec && activeGroupSpec.id !== 'OVERVIEW' && (
                <>
                  <span className="breadcrumb-group">
                    {t(activeGroupSpec.labelZh, activeGroupSpec.labelEn)}
                  </span>
                  <span className="breadcrumb-sep">
                    <ChevronRight size={14} />
                  </span>
                </>
              )}
              <h1 className="breadcrumb-page m-0">
                {activeLabel || 'Ontology Plus'}
              </h1>
            </div>
            {data && (
              <>
                <span className="topbar-divider" />
                <label className="project-switch" title={t('切换本体工程', 'Switch ontology project')}>
                  <span className="project-switch-icon">
                    <FolderKanban size={14} />
                  </span>
                  <select
                    className="project-selector"
                    data-testid="project-selector"
                    aria-label={t('当前本体工程', 'Active ontology project')}
                    value={data.activeProject.id}
                    onChange={(e) => switchProject(e.target.value)}
                  >
                    {data.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.code})
                      </option>
                    ))}
                  </select>
                  <span className="project-switch-chev">
                    <ChevronDown size={14} />
                  </span>
                </label>
              </>
            )}
          </div>

          <div className="topbar-right">
            {activeWorkspaceRuns.length > 0 && (
              <button
                type="button"
                className="status-pill pipeline-topbar-pill"
                data-testid="topbar-running-indicator"
                onClick={() => void handleJumpToActiveRun()}
                title={t(
                  `${activeWorkspaceRuns[0]!.title.zh} — 点击前往查看实时进展`,
                  `${activeWorkspaceRuns[0]!.title.en} — Click to jump to active run`,
                )}
              >
                <Loader2 size={12} className="pipeline-spin" aria-hidden="true" />
                <span>
                  {t(
                    `运行中 (${activeWorkspaceRuns.length})`,
                    `Running (${activeWorkspaceRuns.length})`,
                  )}
                </span>
              </button>
            )}
            {data?.systemSettings.mockLlmMode && (
              <button
                type="button"
                className="status-pill"
                style={{ cursor: 'pointer', color: 'var(--warning)', borderColor: 'var(--warning)' }}
                onClick={() => setActiveView('system-settings')}
                title={t('当前处于离线演示 Mock 模式，点击前往系统设置切换', 'Mock LLM Mode Active — Click to configure')}
              >
                ● {t('离线演示 Mock', 'Mock Mode')}
              </button>
            )}
            {data && validation && (
              <>
                {data.activeProject.domain && data.activeProject.domain !== data.activeProject.name && (
                  <span className="status-pill domain" title={t('业务领域', 'Business domain')}>
                    {t('领域', 'Domain')} · {data.activeProject.domain}
                  </span>
                )}
                <span
                  className={`status-pill ${hasErrors ? 'bad' : ''}`}
                  title={t('11 元模型一致性校验', '11-model consistency validation')}
                >
                  <span className="dot" />
                  {validation.presentModels.length === 0 ? (
                    <span>{t('本体待推导（前置阶段进行中）', 'Ontology Pending')}</span>
                  ) : (
                    <>
                      <strong>{validation.presentModels.length}/11</strong>
                      {t('模型', 'Models')}
                      <span className="text-border">|</span>
                      <strong>{validation.errorCount}</strong>
                      {t('错误', 'Errors')}
                    </>
                  )}
                </span>
              </>
            )}
            {agentSurface && !agentPanelVisible && (
              <button
                type="button"
                className="status-pill agent-panel-toggle"
                data-testid="agent-panel-toggle"
                aria-controls="agent-panel"
                aria-expanded={false}
                title={t('展开智能体面板 (Ctrl/⌘ + J)', 'Open Agent Panel (Ctrl/⌘ + J)')}
                onClick={() => setAgentPanelVisible(true)}
              >
                <PanelRightOpen size={13} aria-hidden="true" />
                <span>{t('智能体', 'Agent')}</span>
              </button>
            )}
          </div>
        </header>

        <div className={`platform-content ${isFlushNavView(activeView) ? 'flush' : ''}`}>
          {loading || !data ? (
            <LoadingState />
          ) : (
            <div className="view-frame" key={activeView}>
              <WorkbenchViewHost activeView={activeView} onNavigate={setActiveView} />
            </div>
          )}
        </div>
      </main>

      {agentSurface && agentPanelVisible && (
        <ShellAgentPanel
          surface={agentSurface}
          overlay={agentPanelOverlay}
          onClose={() => setAgentPanelVisible(false)}
          onNavigate={setActiveView}
        />
      )}

      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>

      {toast && (
        <div className="toast-banner" data-testid="toast-banner" role="status" aria-live="polite">
          <span className="toast-icon">
            <CheckCircle2 size={16} />
          </span>
          <span>{toast}</span>
        </div>
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        entries={paletteEntries}
      />
    </div>
  );
}

export function App() {
  return (
    <PreferencesProvider>
      <ShellInner />
    </PreferencesProvider>
  );
}
