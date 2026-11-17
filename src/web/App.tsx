import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  FolderKanban,
  Globe,
  House,
  Loader2,
  Moon,
  Palette,
  PanelRightOpen,
  Search,
  Sun,
} from 'lucide-react';
import {
  PROJECT_STEP_IDS,
  PROJECT_STEP_NAMES,
  type ProjectStepId,
} from '../packages/business-vocabulary/index.js';
import { BUILT_IN_THEMES } from '../packages/workbench-theme/index.js';
import { useWorkbenchStore } from './api.js';
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
import {
  SecondaryMoreMenu,
  StepCannotStartBanner,
  StepIndicatorBar,
} from './components/shell/index.js';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './components/ui/command.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog.js';
import { PreferencesProvider, usePreferences } from './i18n.js';
import {
  NAV_ICONS,
  NAV_ITEMS,
  SECONDARY_AREAS,
  agentPanelSurfaceFor,
  deriveProjectHealthSummary,
  getDefaultViewForStep,
  getNavGroupSpec,
  getNavItemSpec,
  getProjectStepForView,
  getProjectStepsFromBootstrap,
  isFlushNavView,
  readHashView,
  readUrlNavState,
  resolveNavViewId,
  resolveShellRouteContext,
  writeUrlNavState,
  type NavViewId,
  type SecondaryAreaId,
} from './navigation/index.js';
import { WorkbenchViewHost } from './navigation/viewDispatch.js';

export type WorkspacePane = 'conversation' | 'canvas';

export const WORKBENCH_COMPACT_QUERY = '(max-width: 1279px)';

const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

function useCompactWorkspaceMode(override?: boolean): boolean {
  const [matches, setMatches] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(WORKBENCH_COMPACT_QUERY).matches,
  );

  useEffect(() => {
    if (override !== undefined || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia(WORKBENCH_COMPACT_QUERY);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [override]);

  return override ?? matches;
}

/* ─── Command Palette (Ctrl/⌘ + K) ─── */
interface CommandEntry {
  key: string;
  section: string;
  label: string;
  meta?: string;
  icon: React.ReactNode;
  keywords: string[];
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
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const grouped = useMemo(() => {
    const map = new Map<string, CommandEntry[]>();
    for (const entry of entries) {
      const list = map.get(entry.section) ?? [];
      list.push(entry);
      map.set(entry.section, list);
    }
    return [...map.entries()];
  }, [entries]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        data-testid="command-palette"
        className="overflow-hidden p-0 sm:max-w-[540px]"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t('命令面板', 'Command palette')}</DialogTitle>
          <DialogDescription>
            {t('搜索项目、步骤或页面并立即跳转', 'Search projects, steps, or pages')}
          </DialogDescription>
        </DialogHeader>
        <Command search={query} onSearchChange={setQuery}>
          <CommandInput
            role="textbox"
            autoFocus
            placeholder={t('搜索项目、步骤或页面…', 'Search projects, steps, or pages…')}
            aria-label={t('搜索', 'Search')}
          />
          <CommandList className="max-h-80">
            <CommandEmpty>{t('没有匹配的结果', 'No matching results')}</CommandEmpty>
            {grouped.map(([section, sectionEntries]) => (
              <CommandGroup key={section} heading={section}>
                {sectionEntries.map((entry) => (
                  <CommandItem
                    key={entry.key}
                    value={`${entry.label} [${entry.key}]`}
                    keywords={entry.keywords}
                    onSelect={() => {
                      onClose();
                      entry.run();
                    }}
                  >
                    <span className="text-muted-foreground" aria-hidden="true">
                      {entry.icon}
                    </span>
                    <span className="truncate">{entry.label}</span>
                    {entry.meta && (
                      <span
                        className="ml-auto text-[12px] text-muted-foreground"
                        aria-hidden="true"
                      >
                        {entry.meta}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          <div className="wb-cmdk-footer" aria-hidden="true">
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
        </Command>
      </DialogContent>
    </Dialog>
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

function ProjectSwitcherSelect({
  projects,
  activeProjectId,
  onSelectProject,
}: {
  projects: readonly { id: string; name: string }[];
  activeProjectId: string;
  onSelectProject: (projectId: string) => void;
}) {
  const { t } = usePreferences();
  return (
    <label className="project-switch" title={t('切换项目', 'Switch project')}>
      <span className="project-switch-icon" aria-hidden="true">
        <FolderKanban size={14} />
      </span>
      <select
        className="project-selector"
        data-testid="project-selector"
        aria-label={t('当前项目', 'Current project')}
        value={activeProjectId}
        onChange={(e) => onSelectProject(e.target.value)}
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <span className="project-switch-chev" aria-hidden="true">
        <ChevronDown size={14} />
      </span>
    </label>
  );
}

export interface WorkbenchShellProps {
  /** Override `< 1280px` compact workspace detection (used by deterministic SSR/unit tests). */
  readonly compactWorkspaceOverride?: boolean;
  /** Initial active pane when in `< 1280px` compact mode. */
  readonly initialWorkspacePane?: WorkspacePane;
}

export function WorkbenchShell({
  compactWorkspaceOverride,
  initialWorkspacePane = 'canvas',
}: WorkbenchShellProps = {}) {
  const { locale, toggleLocale, theme, toggleTheme, workbenchTheme, setWorkbenchTheme, t } =
    usePreferences();
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

  const activeView: NavViewId = resolveNavViewId(activeNav);
  const routeContext = useMemo(() => resolveShellRouteContext(activeView), [activeView]);
  const projectSteps = useMemo(
    () => (data ? getProjectStepsFromBootstrap(data) : null),
    [data],
  );
  const activeStepStatus = useMemo(
    () =>
      routeContext.kind === 'project' && projectSteps
        ? projectSteps.find((s) => s.id === routeContext.step) ?? null
        : null,
    [routeContext, projectSteps],
  );
  const activeWorkspaceRuns = useMemo(
    () => resolveActiveWorkspaceRuns(data, liveSessionDrafts),
    [data, liveSessionDrafts],
  );

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [workspacePane, setWorkspacePane] = useState<WorkspacePane>(initialWorkspacePane);
  const isCompactWorkspace = useCompactWorkspaceMode(compactWorkspaceOverride);
  const lastProjectViewRef = useRef<NavViewId>('app-ontology');

  useEffect(() => {
    if (getProjectStepForView(activeView)) {
      lastProjectViewRef.current = activeView;
    }
  }, [activeView]);

  // Agent Panel integration:
  // - In Project Workspace (`>= 1280px`), ShellAgentPanel is permanently docked on the LEFT.
  // - In Secondary Areas (`cap-*`, `data-*`, `llm-center`, `system-settings`), it stays docked/overlay on the RIGHT.
  const agentSurface = agentPanelSurfaceFor(activeView);
  const secondaryAgentOverlay = useAgentPanelOverlayMode();
  const agentPanelOpen = useAgentPanelStore((s) => s.open);
  const agentPanelOverlayOpen = useAgentPanelStore((s) => s.overlayOpen);
  const agentPanelWidth = useAgentPanelStore((s) => s.width);
  const agentPanelWideMode = useAgentPanelStore((s) => s.wideMode);

  const secondaryAgentVisible =
    routeContext.kind === 'secondary' &&
    Boolean(agentSurface) &&
    (secondaryAgentOverlay ? agentPanelOverlayOpen : agentPanelOpen);

  const setSecondaryAgentVisible = (visible: boolean) => {
    const panel = useAgentPanelStore.getState();
    if (secondaryAgentOverlay) panel.setOverlayOpen(visible);
    else panel.setOpen(visible);
  };

  // When a canvas button triggers `revealPanel()` while in compact (<1280px) project workspace, switch to Conversation.
  useEffect(() => {
    if (routeContext.kind === 'project' && isCompactWorkspace && agentPanelOverlayOpen) {
      setWorkspacePane('conversation');
      useAgentPanelStore.getState().setOverlayOpen(false);
    }
  }, [routeContext.kind, isCompactWorkspace, agentPanelOverlayOpen]);

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

  const setActiveView = useCallback(
    (view: NavViewId) => {
      setActiveNav(view);
      writeUrlNavState({ nav: view });
    },
    [setActiveNav],
  );

  const handleSelectStep = useCallback(
    (step: ProjectStepId) => {
      setActiveView(getDefaultViewForStep(step));
    },
    [setActiveView],
  );

  const handleSelectSecondaryArea = useCallback(
    (areaId: SecondaryAreaId) => {
      const spec = SECONDARY_AREAS.find((a) => a.id === areaId);
      if (spec) setActiveView(spec.defaultView);
    },
    [setActiveView],
  );

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
    if (isCompactWorkspace && getProjectStepForView(targetRun.targetNav)) {
      setWorkspacePane('conversation');
    } else {
      useAgentPanelStore.getState().revealPanel();
    }
  };

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
        if (routeContext.kind === 'project') {
          if (isCompactWorkspace) {
            setWorkspacePane((prev) => (prev === 'conversation' ? 'canvas' : 'conversation'));
          }
        } else if (routeContext.kind === 'secondary') {
          setSecondaryAgentVisible(!secondaryAgentVisible);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    agentSurface,
    routeContext.kind,
    isCompactWorkspace,
    secondaryAgentVisible,
    secondaryAgentOverlay,
  ]);

  const activeNavSpec = getNavItemSpec(activeView);
  const activeLabel =
    routeContext.kind === 'project'
      ? t(PROJECT_STEP_NAMES[routeContext.step].zh, PROJECT_STEP_NAMES[routeContext.step].en)
      : activeNavSpec
        ? t(activeNavSpec.labelZh, activeNavSpec.labelEn)
        : '';

  useEffect(() => {
    document.title = activeLabel ? `${activeLabel} · Ontology Plus` : 'Ontology Plus';
  }, [activeLabel]);

  const paletteEntries = useMemo<CommandEntry[]>(() => {
    const stepEntries: CommandEntry[] = PROJECT_STEP_IDS.map((stepId, idx) => {
      const stepName = PROJECT_STEP_NAMES[stepId];
      const defaultView = getDefaultViewForStep(stepId);
      return {
        key: `step:${stepId}`,
        section: t('项目步骤', 'Project steps'),
        label: `${idx + 1}. ${t(stepName.zh, stepName.en)}`,
        meta: data?.activeProject.name,
        icon: NAV_ICONS[defaultView],
        keywords: [stepName.zh, stepName.en, stepId.toLowerCase(), '步骤', 'step'],
        run: () => handleSelectStep(stepId),
      };
    });

    const projectEntries: CommandEntry[] = [
      {
        key: 'home:overview',
        section: t('项目', 'Projects'),
        label: t('返回项目首页', 'Back to Projects Home'),
        icon: <House size={15} />,
        keywords: ['home', 'overview', '首页', '项目列表', 'projects'],
        run: () => setActiveView('overview'),
      },
      ...(data?.projects ?? []).map((p) => ({
        key: `project:${p.id}`,
        section: t('切换项目', 'Switch project'),
        label: p.name,
        meta: p.id === data?.activeProject.id ? t('当前', 'Current') : undefined,
        icon: <FolderKanban size={15} />,
        keywords: [p.name, p.code, 'project', '项目', '工程'],
        run: () => switchProject(p.id),
      })),
    ];

    const pageEntries: CommandEntry[] = NAV_ITEMS.filter((item) => item.id !== 'overview').map(
      (item) => {
        const grp = getNavGroupSpec(item.group);
        return {
          key: `nav:${item.id}`,
          section: t('全部页面', 'All pages'),
          label: t(item.labelZh, item.labelEn),
          meta: grp ? t(grp.labelZh, grp.labelEn) : undefined,
          icon: NAV_ICONS[item.id],
          keywords: [
            item.labelZh,
            item.labelEn,
            item.id,
            grp?.labelZh ?? '',
            grp?.labelEn ?? '',
          ],
          run: () => setActiveView(item.id),
        };
      },
    );

    const prefEntries: CommandEntry[] = [
      {
        key: 'pref:theme',
        section: t('偏好', 'Preferences'),
        label:
          theme === 'light'
            ? t('切换到深色主题', 'Switch to dark theme')
            : t('切换到浅色主题', 'Switch to light theme'),
        icon: theme === 'light' ? <Moon size={15} /> : <Sun size={15} />,
        keywords: ['theme', 'dark', 'light', '主题', '深色', '浅色'],
        run: toggleTheme,
      },
      ...BUILT_IN_THEMES.filter((option) => option.id !== workbenchTheme).map(
        (option): CommandEntry => ({
          key: `pref:workbench-theme:${option.id}`,
          section: t('偏好', 'Preferences'),
          label: t(
            `切换到工作台主题：${option.name.zh}`,
            `Switch to workbench theme: ${option.name.en}`,
          ),
          icon: <Palette size={15} />,
          keywords: [
            'workbench',
            'theme',
            '工作台主题',
            '主题',
            option.id,
            option.name.zh,
            option.name.en,
          ],
          run: () => setWorkbenchTheme(option.id),
        }),
      ),
      {
        key: 'pref:locale',
        section: t('偏好', 'Preferences'),
        label: locale === 'zh-CN' ? 'Switch to English' : '切换为中文',
        icon: <Globe size={15} />,
        keywords: ['language', 'locale', 'english', 'chinese', '语言', '中文', '英文'],
        run: toggleLocale,
      },
    ];

    return [...stepEntries, ...projectEntries, ...pageEntries, ...prefEntries];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, locale, theme, workbenchTheme]);

  const validation = data?.activeProject.validation;
  const healthSummary = useMemo(
    () => (validation ? deriveProjectHealthSummary(validation) : null),
    [validation],
  );

  const showStepSubbar =
    routeContext.kind === 'project' && routeContext.stepViews.length > 1;
  const showBlockedBanner = Boolean(
    routeContext.kind === 'project' &&
      activeStepStatus?.blocked &&
      !activeStepStatus.hasContent,
  );

  const agentPanelWidthVar = agentPanelWideMode
    ? AGENT_PANEL_WIDE_CSS_WIDTH
    : `${agentPanelWidth}px`;

  return (
    <div
      className={`wb-shell ${
        routeContext.kind === 'project' && !isCompactWorkspace ? 'has-left-chat' : ''
      } ${
        routeContext.kind === 'secondary' && secondaryAgentVisible && !secondaryAgentOverlay
          ? 'has-right-agent'
          : ''
      }`}
      style={{ '--agent-panel-w': agentPanelWidthVar } as React.CSSProperties}
    >
      {/* ─── Top Bar ─── */}
      <header className="wb-topbar" data-testid="workbench-topbar">
        <div className="wb-topbar-left">
          <a
            href="#/overview"
            className="wb-brand"
            data-testid="nav-overview"
            title={t('回到首页', 'Back to Home')}
            onClick={(e) => {
              e.preventDefault();
              setActiveView('overview');
            }}
          >
            <span className="wb-logo-mark" aria-hidden="true">
              O
            </span>
            <span className="wb-brand-name">Ontology Plus</span>
          </a>

          {routeContext.kind === 'home' && (
            <nav className="wb-crumbs" aria-label={t('当前位置', 'Breadcrumb')}>
              <span className="wb-crumb-sep" aria-hidden="true">
                /
              </span>
              <span className="wb-crumb-current">{t('项目', 'Projects')}</span>
              {data && (
                <>
                  <span className="wb-crumb-sep" aria-hidden="true">
                    /
                  </span>
                  <button
                    type="button"
                    className="wb-crumb-link"
                    data-testid="enter-active-project-btn"
                    onClick={() => setActiveView(lastProjectViewRef.current)}
                  >
                    {data.activeProject.name}
                  </button>
                </>
              )}
            </nav>
          )}

          {routeContext.kind === 'project' && data && (
            <nav className="wb-crumbs" aria-label={t('当前位置', 'Breadcrumb')}>
              <span className="wb-crumb-sep" aria-hidden="true">
                /
              </span>
              <button
                type="button"
                className="wb-crumb-link"
                onClick={() => setActiveView('overview')}
              >
                {t('项目', 'Projects')}
              </button>
              <span className="wb-crumb-sep" aria-hidden="true">
                /
              </span>
              <ProjectSwitcherSelect
                projects={data.projects}
                activeProjectId={data.activeProject.id}
                onSelectProject={switchProject}
              />
            </nav>
          )}

          {routeContext.kind === 'secondary' && (
            <nav className="wb-crumbs" aria-label={t('当前位置', 'Breadcrumb')}>
              <span className="wb-crumb-sep" aria-hidden="true">
                /
              </span>
              <span className="wb-crumb-muted">
                {t(routeContext.areaSpec.label.zh, routeContext.areaSpec.label.en)}
              </span>
              {activeNavSpec && (
                <>
                  <span className="wb-crumb-sep" aria-hidden="true">
                    /
                  </span>
                  <span className="wb-crumb-current">
                    {t(activeNavSpec.labelZh, activeNavSpec.labelEn)}
                  </span>
                </>
              )}
              {data && (
                <>
                  <span className="topbar-divider" aria-hidden="true" />
                  <ProjectSwitcherSelect
                    projects={data.projects}
                    activeProjectId={data.activeProject.id}
                    onSelectProject={switchProject}
                  />
                </>
              )}
            </nav>
          )}
        </div>

        <div className="wb-topbar-center">
          {routeContext.kind === 'project' && projectSteps && (
            <StepIndicatorBar
              steps={projectSteps}
              activeStep={routeContext.step}
              onSelectStep={handleSelectStep}
            />
          )}
        </div>

        <div className="wb-topbar-right">
          {activeWorkspaceRuns.length > 0 && (
            <button
              type="button"
              className="status-pill pipeline-topbar-pill"
              data-testid="topbar-running-indicator"
              onClick={() => void handleJumpToActiveRun()}
              title={t(
                `${activeWorkspaceRuns[0]!.title.zh} — 点击前往查看实时进展`,
                `${activeWorkspaceRuns[0]!.title.en} — Click to view live progress`,
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

          {routeContext.kind === 'project' && healthSummary && (
            <button
              type="button"
              className="wb-health-pill"
              data-testid="shell-health-status"
              data-tone={healthSummary.tone}
              title={t('查看业务模型状态', 'View business model status')}
              onClick={() => handleSelectStep('BUSINESS_MODEL')}
            >
              <span className="wb-health-dot" data-tone={healthSummary.tone} aria-hidden="true" />
              <span>{t(healthSummary.text.zh, healthSummary.text.en)}</span>
            </button>
          )}

          {routeContext.kind === 'secondary' && agentSurface && !secondaryAgentVisible && (
            <button
              type="button"
              className="wb-top-btn"
              data-testid="agent-panel-toggle"
              aria-controls="agent-panel"
              aria-expanded={false}
              title={t('展开 AI 助手', 'Open AI Assistant')}
              onClick={() => setSecondaryAgentVisible(true)}
            >
              <PanelRightOpen size={14} aria-hidden="true" />
              <span>{t('AI 助手', 'AI Assistant')}</span>
            </button>
          )}

          <button
            type="button"
            className="wb-top-btn wb-search-btn"
            data-testid="open-command-palette-btn"
            onClick={() => setPaletteOpen(true)}
            title={t('搜索或跳转', 'Search or jump to')}
            aria-label={t('搜索或跳转', 'Search or jump to')}
          >
            <Search size={14} aria-hidden="true" />
            <span className="kbd wb-search-kbd" aria-hidden="true">
              {IS_MAC ? '⌘K' : 'Ctrl K'}
            </span>
          </button>

          <button
            type="button"
            className="wb-icon-btn"
            data-testid="theme-toggle-btn"
            onClick={toggleTheme}
            title={
              theme === 'light'
                ? t('切换到深色', 'Switch to dark')
                : t('切换到浅色', 'Switch to light')
            }
            aria-label={
              theme === 'light'
                ? t('切换到深色', 'Switch to dark')
                : t('切换到浅色', 'Switch to light')
            }
          >
            {theme === 'light' ? (
              <Sun size={15} aria-hidden="true" />
            ) : (
              <Moon size={15} aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            className="wb-top-btn wb-locale-btn"
            data-testid="locale-toggle-btn"
            onClick={toggleLocale}
            title={locale === 'zh-CN' ? 'Switch to English' : '切换为中文'}
            aria-label={locale === 'zh-CN' ? 'Switch to English' : '切换为中文'}
          >
            <Globe size={14} aria-hidden="true" />
            <span>{locale === 'zh-CN' ? '中文' : 'EN'}</span>
          </button>

          <SecondaryMoreMenu
            activeArea={routeContext.kind === 'secondary' ? routeContext.area : null}
            activeView={activeView}
            onSelectArea={handleSelectSecondaryArea}
            onSelectSettings={() => setActiveView('system-settings')}
          />
        </div>
      </header>

      {/* ─── Shell Body ─── */}
      <div className="wb-body">
        {routeContext.kind === 'home' && (
          <main className="wb-home-main">
            <div className="platform-content">
              {loading || !data ? (
                <LoadingState />
              ) : (
                <div className="view-frame" key={activeView}>
                  <WorkbenchViewHost activeView={activeView} onNavigate={setActiveView} />
                </div>
              )}
            </div>
          </main>
        )}

        {routeContext.kind === 'project' && (
          <div
            className="wb-workspace-frame"
            data-testid="project-workspace"
            data-compact={isCompactWorkspace ? 'true' : 'false'}
            data-active-pane={isCompactWorkspace ? workspacePane : 'split'}
          >
            {isCompactWorkspace && (
              <div className="wb-compact-bar">
                <div
                  className="wb-pane-toggle"
                  data-testid="workspace-pane-toggle"
                  role="group"
                  aria-label={t('切换对话与画布', 'Switch conversation and canvas')}
                >
                  <button
                    type="button"
                    data-testid="workspace-pane-conversation"
                    aria-pressed={workspacePane === 'conversation'}
                    onClick={() => setWorkspacePane('conversation')}
                  >
                    {t('对话', 'Conversation')}
                  </button>
                  <button
                    type="button"
                    data-testid="workspace-pane-canvas"
                    aria-pressed={workspacePane === 'canvas'}
                    onClick={() => setWorkspacePane('canvas')}
                  >
                    {t('画布', 'Canvas')}
                  </button>
                </div>
              </div>
            )}

            <div className="wb-workspace">
              {(!isCompactWorkspace || workspacePane === 'conversation') && agentSurface && (
                <ShellAgentPanel
                  surface={agentSurface}
                  overlay={false}
                  side="left"
                  closable={false}
                  resizable={!isCompactWorkspace}
                  onClose={() => undefined}
                  onNavigate={setActiveView}
                />
              )}

              {(!isCompactWorkspace || workspacePane === 'canvas') && (
                <main
                  className="wb-canvas"
                  data-testid="workbench-canvas"
                  style={
                    {
                      '--subbar-h': `${(showStepSubbar ? 40 : 0) + (isCompactWorkspace ? 40 : 0)}px`,
                    } as React.CSSProperties
                  }
                >
                  {showStepSubbar && (
                    <nav
                      className="wb-subview-bar"
                      data-testid="step-subview-bar"
                      aria-label={t('步骤子视图', 'Step views')}
                    >
                      {routeContext.stepViews.map((viewId) => {
                        const spec = getNavItemSpec(viewId);
                        if (!spec) return null;
                        const isActive = activeView === viewId;
                        const hasRun = activeWorkspaceRuns.some(
                          (r) =>
                            r.projectId === data?.activeProject.id &&
                            r.targetNav === viewId,
                        );
                        return (
                          <button
                            key={viewId}
                            type="button"
                            data-testid={`nav-${viewId}`}
                            className={`wb-subview-tab ${isActive ? 'is-active' : ''}`}
                            aria-current={isActive ? 'page' : undefined}
                            onClick={() => setActiveView(viewId)}
                          >
                            <span className="wb-subview-icon" aria-hidden="true">
                              {NAV_ICONS[viewId]}
                            </span>
                            <span>{t(spec.labelZh, spec.labelEn)}</span>
                            {hasRun && (
                              <span
                                className="nav-task-dot is-running"
                                aria-hidden="true"
                              />
                            )}
                          </button>
                        );
                      })}
                    </nav>
                  )}

                  {showBlockedBanner && activeStepStatus && (
                    <StepCannotStartBanner
                      step={activeStepStatus}
                      onNavigateStep={handleSelectStep}
                      variant="banner"
                    />
                  )}

                  <div
                    className={`platform-content ${isFlushNavView(activeView) ? 'flush' : ''}`}
                  >
                    {loading || !data ? (
                      <LoadingState />
                    ) : (
                      <div className="view-frame" key={activeView}>
                        <WorkbenchViewHost activeView={activeView} onNavigate={setActiveView} />
                      </div>
                    )}
                  </div>
                </main>
              )}
            </div>
          </div>
        )}

        {routeContext.kind === 'secondary' && (
          <div className="wb-secondary-layout">
            <div className="wb-secondary-main">
              <nav
                className="wb-subview-bar wb-secondary-nav"
                data-testid="secondary-area-nav"
                aria-label={t(
                  routeContext.areaSpec.label.zh,
                  routeContext.areaSpec.label.en,
                )}
              >
                <div className="wb-subview-group">
                  {routeContext.areaSpec.views.map((viewId) => {
                    const spec = getNavItemSpec(viewId);
                    if (!spec) return null;
                    const isActive = activeView === viewId;
                    return (
                      <button
                        key={viewId}
                        type="button"
                        data-testid={`nav-${viewId}`}
                        className={`wb-subview-tab ${isActive ? 'is-active' : ''}`}
                        aria-current={isActive ? 'page' : undefined}
                        onClick={() => setActiveView(viewId)}
                      >
                        <span className="wb-subview-icon" aria-hidden="true">
                          {NAV_ICONS[viewId]}
                        </span>
                        <span>{t(spec.labelZh, spec.labelEn)}</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="wb-back-project-btn"
                  data-testid="back-to-project-btn"
                  onClick={() => setActiveView(lastProjectViewRef.current)}
                >
                  <ArrowLeft size={14} aria-hidden="true" />
                  <span>{t('返回项目', 'Back to project')}</span>
                </button>
              </nav>

              <div className={`platform-content ${isFlushNavView(activeView) ? 'flush' : ''}`}>
                {loading || !data ? (
                  <LoadingState />
                ) : (
                  <div className="view-frame" key={activeView}>
                    <WorkbenchViewHost activeView={activeView} onNavigate={setActiveView} />
                  </div>
                )}
              </div>
            </div>

            {agentSurface && secondaryAgentVisible && (
              <ShellAgentPanel
                surface={agentSurface}
                overlay={secondaryAgentOverlay}
                side="right"
                closable
                onClose={() => setSecondaryAgentVisible(false)}
                onNavigate={setActiveView}
              />
            )}
          </div>
        )}
      </div>

      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>

      {toast && (
        <div
          className="toast-banner"
          data-testid="toast-banner"
          role="status"
          aria-live="polite"
        >
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
      <WorkbenchShell />
    </PreferencesProvider>
  );
}
