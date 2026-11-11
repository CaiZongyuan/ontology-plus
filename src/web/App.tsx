import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Blocks,
  BookOpen,
  Bot,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cpu,
  Database,
  FileCode2,
  FileText,
  FolderKanban,
  GitBranch,
  Globe,
  Layers,
  LayoutTemplate,
  Loader2,
  MessageSquare,
  Network,
  PackageCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Rocket,
  Search,
  Send,
  Settings,
  Sparkles,
  Sun,
  Moon,
  Workflow,
  BarChart3,
} from 'lucide-react';
import {
  getProjectLifecycleState,
  readUrlNavState,
  useWorkbenchStore,
  writeUrlNavState,
} from './api.js';
import {
  NAV_GROUPS,
  NAV_ITEMS,
  PreferencesProvider,
  usePreferences,
  type NavItemSpec,
  type NavViewId,
} from './i18n.js';
import {
  AppPublishView,
  ApplicationAssemblyDevView,
  FourLayerAssetsView,
  ModelFilesView,
  OntologySkillsView,
  OverviewSessionsView,
  PrototypeStudioView,
  RequirementDocsView,
  RequirementExploreView,
} from './views/ApplicationCenterViews.js';
import {
  CapabilityAgentsView,
  CapabilityCrossFlowsView,
  CapabilityExtractionView,
  CapabilityMcpView,
  CapabilitySystemsView,
  DataMappingsView,
  DataMetricsReportsView,
  DataReasoningView,
  DataResourcesView,
  DataWritebackView,
  KnowledgeCenterView,
  LlmCenterView,
  SystemSettingsView,
} from './views/CapabilityAndDataViews.js';
import { KnowledgeGraphCanvas } from './views/KnowledgeGraphCanvas.js';
import { OntologyWorkbenchView } from './views/OntologyWorkbenchView.js';
import { Button } from './components/beautifui/index.js';
import { GlobalPipelineTaskTray } from './components/pipeline/PipelineTaskCard.js';

const NAV_ICONS: Record<NavViewId, React.ReactNode> = {
  overview: <FolderKanban size={16} />,
  'app-req-explore': <MessageSquare size={16} />,
  'app-req-docs': <FileText size={16} />,
  'app-prototype': <LayoutTemplate size={16} />,
  'app-ontology': <Boxes size={16} />,
  'app-model-files': <FileCode2 size={16} />,
  'app-knowledge-graph': <Network size={16} />,
  'app-four-layer-assets': <Layers size={16} />,
  'app-assembly-dev': <PackageCheck size={16} />,
  'app-skills': <Blocks size={16} />,
  'app-publish': <Rocket size={16} />,
  'cap-systems': <Cpu size={16} />,
  'cap-extraction': <GitBranch size={16} />,
  'cap-mcp': <Activity size={16} />,
  'cap-agents': <Bot size={16} />,
  'cap-cross-flows': <Workflow size={16} />,
  'cap-knowledge': <BookOpen size={16} />,
  'data-resources': <Database size={16} />,
  'data-mappings': <Layers size={16} />,
  'data-metrics-reports': <BarChart3 size={16} />,
  'data-reasoning': <Sparkles size={16} />,
  'data-writeback': <Send size={16} />,
  'llm-center': <Cpu size={16} />,
  'system-settings': <Settings size={16} />,
};

function readHashView(): NavViewId {
  if (typeof window === 'undefined') return 'app-ontology';
  const urlState = readUrlNavState();
  const candidate = (urlState.nav || '') as NavViewId;
  return NAV_ITEMS.some((i) => i.id === candidate) ? candidate : 'app-ontology';
}

type NavGroupId = NavItemSpec['group'];

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
  const { locale, toggleLocale, theme, toggleTheme, t } = usePreferences();
  const {
    data,
    loading,
    toast,
    activeNav,
    backgroundTasks,
    liveAnnouncement,
    setActiveNav,
    setSelectedModel,
    bootstrap,
    switchProject,
    saveSuiteWithUndo,
    showToast,
    openBackgroundTaskResult,
  } = useWorkbenchStore();
  const lifecycle = data ? getProjectLifecycleState(data) : null;
  const runningTopbarTask = backgroundTasks.find((tk) => tk.status === 'RUNNING');
  const activeView: NavViewId = NAV_ITEMS.some((i) => i.id === activeNav)
    ? (activeNav as NavViewId)
    : 'app-ontology';
  const [collapsed, setCollapsedState] = useState<boolean>(() =>
    readStoredJson('onto_sidebar_collapsed', false),
  );
  const [closedGroups, setClosedGroups] = useState<NavGroupId[]>(() =>
    readStoredJson<NavGroupId[]>('onto_nav_closed_groups', []),
  );
  const [paletteOpen, setPaletteOpen] = useState(false);

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

  const activeNavSpec = NAV_ITEMS.find((i) => i.id === activeView);
  const activeGroupSpec = NAV_GROUPS.find((g) => g.id === activeNavSpec?.group);
  const activeLabel = activeNavSpec ? t(activeNavSpec.labelZh, activeNavSpec.labelEn) : '';

  useEffect(() => {
    document.title = activeLabel ? `${activeLabel} · Ontology Plus` : 'Ontology Plus';
  }, [activeLabel]);

  const paletteEntries = useMemo<CommandEntry[]>(() => {
    const pageEntries: CommandEntry[] = NAV_ITEMS.map((item) => {
      const grp = NAV_GROUPS.find((g) => g.id === item.group);
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
  }, [data, locale, theme]);

  const validation = data?.activeProject.validation;
  const hasErrors = (validation?.errorCount ?? 0) > 0;
  const collapseLabel = collapsed ? t('展开侧边栏', 'Expand sidebar') : t('折叠侧边栏', 'Collapse sidebar');

  return (
    <div className={`platform-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
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
            const items = NAV_ITEMS.filter((i) => i.group === grp.id);
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
                        {backgroundTasks.some(
                          (tk) =>
                            tk.status === 'RUNNING' &&
                            tk.projectId === data?.activeProject.id &&
                            (tk.targetNav === item.id || tk.originNav === item.id),
                        ) && (
                          <span
                            className="nav-task-dot is-running"
                            title={t('后台任务正在运行', 'Background task running')}
                            aria-hidden="true"
                          />
                        )}
                        {backgroundTasks.some(
                          (tk) =>
                            tk.unreadCompletion &&
                            tk.projectId === data?.activeProject.id &&
                            tk.targetNav === item.id,
                        ) && (
                          <span
                            className="nav-task-dot is-done"
                            title={t('新成果已生成完成，点击查看', 'New artifact ready')}
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
            {runningTopbarTask && (
              <button
                type="button"
                className="status-pill pipeline-topbar-pill"
                data-testid="topbar-running-task-pill"
                onClick={() => void openBackgroundTaskResult(runningTopbarTask.id)}
                title={t(
                  `${runningTopbarTask.titleZh} — 点击前往查看实时进度`,
                  `${runningTopbarTask.titleEn} — Click to view live progress`,
                )}
              >
                <Loader2 size={12} className="pipeline-spin" aria-hidden="true" />
                <span>
                  {runningTopbarTask.kind === 'SRS_SYNTHESIS'
                    ? runningTopbarTask.completedChapters > 0
                      ? t(
                          `后台合成需求书 (${runningTopbarTask.completedChapters}/9 章)`,
                          `SRS Synthesis (${runningTopbarTask.completedChapters}/9)`,
                        )
                      : t('后台合成需求规格书…', 'Synthesizing SRS…')
                    : runningTopbarTask.kind === 'PROTOTYPE_GEN'
                      ? t('后台生成交互原型…', 'Generating Prototype…')
                      : t('后台合成 11 模型…', 'Synthesizing 11 Models…')}
                </span>
              </button>
            )}
            {data?.systemSettings.mockLlmMode && (
              <button
                type="button"
                className="status-pill"
                style={{ cursor: 'pointer', color: 'var(--warn)', borderColor: 'var(--warn)' }}
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
                      <span className="text-[var(--line)]">|</span>
                      <strong>{validation.errorCount}</strong>
                      {t('错误', 'Errors')}
                    </>
                  )}
                </span>
              </>
            )}
          </div>
        </header>

        <div className={`platform-content ${activeView === 'app-ontology' ? 'flush' : ''}`}>
          {loading || !data ? (
            <LoadingState />
          ) : (
            <div className="view-frame" key={activeView}>
              {activeView === 'overview' && (
                <OverviewSessionsView onNavigate={setActiveView} />
              )}
              {activeView === 'app-req-explore' && (
                <RequirementExploreView onNavigate={setActiveView} />
              )}
              {activeView === 'app-req-docs' && (
                <RequirementDocsView onNavigate={setActiveView} />
              )}
              {activeView === 'app-prototype' && (
                <PrototypeStudioView onNavigate={setActiveView} />
              )}
              {activeView === 'app-ontology' && (
                <OntologyWorkbenchView onNavigate={setActiveView} />
              )}
              {activeView === 'app-model-files' && (
                <ModelFilesView onNavigate={setActiveView} />
              )}
              {activeView === 'app-knowledge-graph' &&
                (!lifecycle?.hasOntology || data.activeProject.knowledgeGraph.nodes.length === 0 ? (
                  <div className="card py-12 px-6 flex flex-col items-center text-center gap-3 max-w-[680px] mx-auto my-6">
                    <div className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line bg-inset text-accent">
                      <Network size={20} />
                    </div>
                    <span className="badge badge-warn">
                      {t('尚未到达此阶段 · 暂无图谱节点', 'Stage Not Yet Reached · No Graph Nodes')}
                    </span>
                    <h3 className="font-serif text-[18px] font-semibold text-ink m-0">
                      {t(
                        `「${data.activeProject.name}」尚未生成业务本体`,
                        `"${data.activeProject.name}" has not synthesized its ontology yet`,
                      )}
                    </h3>
                    <p className="text-[13px] text-ink-3 max-w-[520px] leading-relaxed m-0">
                      {t(
                        '知识图谱会根据第 4 步「业务本体」中的对象、行为、规则、事件与界面引用关系自动绘制，无需手工连线。当前工程仍在推进前置阶段，保持空白可避免示例模板干扰。',
                        'The Knowledge Graph is automatically rendered from your project ontology once Step 4 (Business Ontology) is generated.',
                      )}
                    </p>
                    {lifecycle && (
                      <p className="text-[12.5px] text-ink-2 bg-inset border border-line rounded-[6px] px-3.5 py-2 m-0">
                        {t(lifecycle.nextStep.hintZh, lifecycle.nextStep.hintEn)}
                      </p>
                    )}
                    {lifecycle && (
                      <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                        <Button
                          type="button"
                          variant="accent"
                          size="md"
                          onClick={() => setActiveView(lifecycle.nextStep.targetView)}
                        >
                          {t(lifecycle.nextStep.labelZh, lifecycle.nextStep.labelEn)}
                          <ArrowRight size={14} />
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="md"
                          onClick={() => setActiveView('app-ontology')}
                        >
                          {t('进入业务本体手工建模', 'Manual Ontology Authoring')}
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {lifecycle?.hasForeignDemoTemplate && (
                      <div
                        className="card flex flex-wrap items-center justify-between gap-3"
                        style={{ borderColor: 'var(--warn)', background: 'var(--warn-soft, var(--inset))' }}
                      >
                        <div className="text-[12.5px] text-ink">
                          <strong>{t('提示：当前图谱来自创建工程时的示例模板', 'Notice: Graph shows preloaded demo template')}</strong>
                          {' — '}
                          {t(
                            `当前展示的是「${lifecycle.foreignTemplateNameZh}」演示数据，并非由「${data.activeProject.name}」推导生成。`,
                            `Showing "${lifecycle.foreignTemplateNameEn}" demo data rather than "${data.activeProject.name}".`,
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={async () => {
                            await saveSuiteWithUndo({}, 'Cleared preloaded demo template');
                            showToast(
                              t(
                                '已清空预置示例模板，完成前置界面原型后即可推导本工程专属本体',
                                'Cleared demo template; ready for clean synthesis from prototype',
                              ),
                            );
                          }}
                        >
                          {t('清空示例模板数据', 'Clear Demo Template')}
                        </Button>
                      </div>
                    )}
                    <div className="card">
                      <div className="card-header">
                        <h3 className="card-title">
                          {t('11 元模型全域业务本体知识图谱', '11-Model Business Ontology Knowledge Graph')}
                        </h3>
                      </div>
                      <KnowledgeGraphCanvas
                        graph={data.activeProject.knowledgeGraph}
                        preset="GLOBAL_SWIMLANE"
                        height={Math.max(600, (typeof window !== 'undefined' ? window.innerHeight : 900) - 250)}
                        onNavigateToElement={(model, elementId) => {
                          setSelectedModel(model, elementId);
                          setActiveView('app-ontology');
                        }}
                      />
                    </div>
                  </div>
                ))}
              {activeView === 'app-four-layer-assets' && <FourLayerAssetsView />}
              {activeView === 'app-assembly-dev' && (
                <ApplicationAssemblyDevView onNavigate={setActiveView} />
              )}
              {activeView === 'app-skills' && (
                <OntologySkillsView onNavigate={setActiveView} />
              )}
              {activeView === 'app-publish' && (
                <AppPublishView onNavigate={setActiveView} />
              )}

              {activeView === 'cap-systems' && <CapabilitySystemsView />}
              {activeView === 'cap-extraction' && <CapabilityExtractionView />}
              {activeView === 'cap-mcp' && <CapabilityMcpView />}
              {activeView === 'cap-agents' && <CapabilityAgentsView />}
              {activeView === 'cap-cross-flows' && <CapabilityCrossFlowsView />}
              {activeView === 'cap-knowledge' && <KnowledgeCenterView />}

              {activeView === 'data-resources' && (
                <DataResourcesView onNavigate={setActiveView} />
              )}
              {activeView === 'data-mappings' && <DataMappingsView />}
              {activeView === 'data-metrics-reports' && <DataMetricsReportsView />}
              {activeView === 'data-reasoning' && <DataReasoningView />}
              {activeView === 'data-writeback' && <DataWritebackView />}

              {activeView === 'llm-center' && <LlmCenterView />}
              {activeView === 'system-settings' && <SystemSettingsView />}
            </div>
          )}
        </div>
      </main>

      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>

      <GlobalPipelineTaskTray hasActiveToast={Boolean(toast)} />

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
