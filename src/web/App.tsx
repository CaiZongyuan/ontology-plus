import React, { useEffect, useState } from 'react';
import {
  Activity,
  Blocks,
  BookOpen,
  Bot,
  Boxes,
  Cpu,
  Database,
  FileCode2,
  FileText,
  FolderKanban,
  GitBranch,
  Globe,
  Layers,
  LayoutTemplate,
  MessageSquare,
  Network,
  PackageCheck,
  Rocket,
  Send,
  Settings,
  Sparkles,
  Sun,
  Moon,
  Workflow,
  BarChart3,
} from 'lucide-react';
import { useWorkbenchStore } from './api.js';
import {
  NAV_GROUPS,
  NAV_ITEMS,
  PreferencesProvider,
  usePreferences,
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

const NAV_ICONS: Record<NavViewId, React.ReactNode> = {
  overview: <FolderKanban size={14} />,
  'app-req-explore': <MessageSquare size={14} />,
  'app-req-docs': <FileText size={14} />,
  'app-prototype': <LayoutTemplate size={14} />,
  'app-ontology': <Boxes size={14} />,
  'app-model-files': <FileCode2 size={14} />,
  'app-knowledge-graph': <Network size={14} />,
  'app-four-layer-assets': <Layers size={14} />,
  'app-assembly-dev': <PackageCheck size={14} />,
  'app-skills': <Blocks size={14} />,
  'app-publish': <Rocket size={14} />,
  'cap-systems': <Cpu size={14} />,
  'cap-extraction': <GitBranch size={14} />,
  'cap-mcp': <Activity size={14} />,
  'cap-agents': <Bot size={14} />,
  'cap-cross-flows': <Workflow size={14} />,
  'cap-knowledge': <BookOpen size={14} />,
  'data-resources': <Database size={14} />,
  'data-mappings': <Layers size={14} />,
  'data-metrics-reports': <BarChart3 size={14} />,
  'data-reasoning': <Sparkles size={14} />,
  'data-writeback': <Send size={14} />,
  'llm-center': <Cpu size={14} />,
  'system-settings': <Settings size={14} />,
};

function readHashView(): NavViewId {
  if (typeof window === 'undefined') return 'app-ontology';
  const raw = window.location.hash.replace(/^#\/?/, '').trim() as NavViewId;
  return NAV_ITEMS.some((i) => i.id === raw) ? raw : 'app-ontology';
}

function ShellInner() {
  const { locale, toggleLocale, theme, toggleTheme, t } = usePreferences();
  const { data, loading, toast, bootstrap, switchProject } = useWorkbenchStore();
  const [activeView, setActiveViewState] = useState<NavViewId>(readHashView);
  const [collapsed, setCollapsed] = useState(false);

  const setActiveView = (view: NavViewId) => {
    setActiveViewState(view);
    if (typeof window !== 'undefined') {
      const targetHash = `#/${view}`;
      if (window.location.hash !== targetHash) {
        window.history.replaceState(null, '', targetHash);
      }
    }
  };

  useEffect(() => {
    bootstrap();
    const onHashChange = () => setActiveViewState(readHashView());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [bootstrap]);

  const activeNavSpec = NAV_ITEMS.find((i) => i.id === activeView);

  return (
    <div className={`platform-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      {/* ─── Left Sidebar ─── */}
      <aside className="platform-sidebar">
        <div className="sidebar-brand">
          <div className="brand-title">
            <span className="brand-mark">O+</span>
            {!collapsed && <span>Ontology Plus</span>}
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setCollapsed((v) => !v)}
            title={t('折叠/展开侧边栏', 'Toggle Sidebar')}
          >
            {collapsed ? '»' : '«'}
          </button>
        </div>

        <div className="sidebar-scroll">
          {NAV_GROUPS.map((grp) => {
            const items = NAV_ITEMS.filter((i) => i.group === grp.id);
            return (
              <div key={grp.id} className="nav-group">
                {!collapsed && (
                  <div className="nav-group-label">{t(grp.labelZh, grp.labelEn)}</div>
                )}
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`nav-${item.id}`}
                    className={`nav-item ${activeView === item.id ? 'active' : ''}`}
                    onClick={() => setActiveView(item.id)}
                    title={t(item.labelZh, item.labelEn)}
                  >
                    <span className="nav-item-left">
                      <span style={{ display: 'inline-flex', opacity: 0.82 }}>
                        {NAV_ICONS[item.id]}
                      </span>
                      {!collapsed && <span>{t(item.labelZh, item.labelEn)}</span>}
                    </span>
                    {!collapsed && item.badge && (
                      <span className="nav-badge">{item.badge}</span>
                    )}
                  </button>
                ))}
              </div>
            );
          })}
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-footer-row">
            <button
              type="button"
              className="btn btn-sm"
              data-testid="theme-toggle-btn"
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={toggleTheme}
            >
              {theme === 'light' ? (
                <>
                  <Sun size={13} /> {!collapsed && 'Light'}
                </>
              ) : (
                <>
                  <Moon size={13} /> {!collapsed && 'Dark'}
                </>
              )}
            </button>
            {!collapsed && (
              <button
                type="button"
                className="btn btn-sm"
                data-testid="locale-toggle-btn"
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={toggleLocale}
              >
                <Globe size={13} />
                {locale === 'zh-CN' ? '中文 / EN' : 'EN / 中文'}
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* ─── Main Workbench Area ─── */}
      <main className="platform-main">
        <header className="platform-topbar">
          <div className="topbar-left">
            <strong style={{ fontFamily: 'var(--serif)', fontSize: 15 }}>
              {activeNavSpec ? t(activeNavSpec.labelZh, activeNavSpec.labelEn) : 'Ontology Plus'}
            </strong>
            {data && (
              <select
                className="project-selector"
                data-testid="project-selector"
                value={data.activeProject.id}
                onChange={(e) => switchProject(e.target.value)}
              >
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="topbar-right">
            {data && (
              <>
                <span className="badge badge-accent">
                  {t('领域', 'Domain')}: {data.activeProject.domain}
                </span>
                <span
                  className={`badge ${data.activeProject.validation.errorCount === 0 ? 'badge-ok' : 'badge-bad'}`}
                >
                  {data.activeProject.validation.presentModels.length}/11 Models ·{' '}
                  {data.activeProject.validation.errorCount} Errors
                </span>
              </>
            )}
          </div>
        </header>

        <div className={`platform-content ${activeView === 'app-ontology' ? 'flush' : ''}`}>
          {loading || !data ? (
            <div style={{ padding: 24, color: 'var(--muted)' }}>
              {t('正在加载本体工作台与 11 元模型 AST...', 'Loading Ontology Plus Workbench...')}
            </div>
          ) : (
            <>
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
              {activeView === 'app-ontology' && <OntologyWorkbenchView />}
              {activeView === 'app-model-files' && <ModelFilesView />}
              {activeView === 'app-knowledge-graph' && (
                <div className="card">
                  <div className="card-header">
                    <h3 className="card-title">
                      {t('11 元模型全域业务本体知识图谱', '11-Model Business Ontology Knowledge Graph')}
                    </h3>
                  </div>
                  <KnowledgeGraphCanvas
                    graph={data.activeProject.knowledgeGraph}
                    height={560}
                  />
                </div>
              )}
              {activeView === 'app-four-layer-assets' && <FourLayerAssetsView />}
              {activeView === 'app-assembly-dev' && <ApplicationAssemblyDevView />}
              {activeView === 'app-skills' && <OntologySkillsView />}
              {activeView === 'app-publish' && <AppPublishView />}

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
            </>
          )}
        </div>
      </main>

      {toast && (
        <div className="toast-banner" data-testid="toast-banner">
          {toast}
        </div>
      )}
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
