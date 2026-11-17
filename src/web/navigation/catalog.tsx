import React from 'react';
import {
  Activity,
  BarChart3,
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
  Layers,
  LayoutTemplate,
  MessageSquare,
  Network,
  PackageCheck,
  Rocket,
  Send,
  Settings,
  Sparkles,
  Workflow,
} from 'lucide-react';
import type { BilingualText, ProjectStepId } from '../../packages/business-vocabulary/index.js';

export type CanonicalNavViewId =
  | 'overview'
  // Application Center (应用中心)
  | 'app-requirements'
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

export type LegacyNavViewAlias = 'app-req-explore' | 'app-req-docs';

export type NavViewId = CanonicalNavViewId | LegacyNavViewAlias;

export type NavGroupId = 'OVERVIEW' | 'APPLICATION' | 'CAPABILITY' | 'ANALYTICS' | 'PLATFORM';

export interface NavGroupSpec {
  id: NavGroupId;
  labelZh: string;
  labelEn: string;
}

export interface NavItemSpec {
  id: CanonicalNavViewId;
  group: NavGroupId;
  labelZh: string;
  labelEn: string;
  badge?: string;
}

export const DEFAULT_NAV_VIEW: CanonicalNavViewId = 'app-ontology';

export const LEGACY_NAV_VIEW_ALIASES: Readonly<Record<LegacyNavViewAlias, CanonicalNavViewId>> = {
  'app-req-explore': 'app-requirements',
  'app-req-docs': 'app-requirements',
};

export function normalizeNavViewAlias(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (Object.prototype.hasOwnProperty.call(LEGACY_NAV_VIEW_ALIASES, trimmed)) {
    return LEGACY_NAV_VIEW_ALIASES[trimmed as LegacyNavViewAlias];
  }
  if (trimmed === 'prototype' || trimmed === 'ui-prototype') {
    return 'app-prototype';
  }
  return trimmed;
}

export const NAV_GROUPS: NavGroupSpec[] = [
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
    id: 'app-requirements',
    group: 'APPLICATION',
    labelZh: '需求',
    labelEn: 'Requirements',
  },
  {
    id: 'app-prototype',
    group: 'APPLICATION',
    labelZh: '原型',
    labelEn: 'Prototype',
  },
  {
    id: 'app-ontology',
    group: 'APPLICATION',
    labelZh: '业务模型',
    labelEn: 'Business Model',
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

export const NAV_ICONS: Record<NavViewId, React.ReactNode> = {
  overview: <FolderKanban size={16} />,
  'app-requirements': <FileText size={16} />,
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

const NAV_ITEM_BY_ID = new Map<CanonicalNavViewId, NavItemSpec>(
  NAV_ITEMS.map((item) => [item.id, item]),
);
const NAV_GROUP_BY_ID = new Map<NavGroupId, NavGroupSpec>(NAV_GROUPS.map((grp) => [grp.id, grp]));

export function isNavViewId(value: string | null | undefined): value is CanonicalNavViewId {
  return Boolean(value && NAV_ITEM_BY_ID.has(value as CanonicalNavViewId));
}

export function resolveNavViewId(candidate: string | null | undefined): CanonicalNavViewId {
  const normalized = normalizeNavViewAlias(candidate);
  return isNavViewId(normalized) ? normalized : DEFAULT_NAV_VIEW;
}

export function getNavItemSpec(view: NavViewId): NavItemSpec | undefined {
  const normalized = normalizeNavViewAlias(view);
  return normalized ? NAV_ITEM_BY_ID.get(normalized as CanonicalNavViewId) : undefined;
}

export function getNavGroupSpec(group: NavGroupId): NavGroupSpec | undefined {
  return NAV_GROUP_BY_ID.get(group);
}

export function getNavItemsByGroup(group: NavGroupId): NavItemSpec[] {
  return NAV_ITEMS.filter((item) => item.group === group);
}

export type BusinessModelTechTab = 'editor' | 'files' | 'graph';

const RETIRED_STEP_NAV_ENTRIES = new Set<NavViewId>([
  'app-prototype',
  'app-ontology',
  'app-model-files',
  'app-knowledge-graph',
]);

export function isRetiredNavEntry(view: NavViewId): boolean {
  return RETIRED_STEP_NAV_ENTRIES.has(view);
}

export function resolveLegacyBusinessModelTechTab(
  rawNav: string | null | undefined,
): BusinessModelTechTab | null {
  if (rawNav === 'app-model-files') return 'files';
  if (rawNav === 'app-knowledge-graph') return 'graph';
  return null;
}

export function isFlushNavView(view: NavViewId): boolean {
  const resolved = resolveNavViewId(view);
  return (
    resolved === 'app-ontology' ||
    resolved === 'app-model-files' ||
    resolved === 'app-knowledge-graph'
  );
}

export interface ProjectStepViewSpec {
  readonly defaultView: CanonicalNavViewId;
  readonly views: readonly CanonicalNavViewId[];
}

export const PROJECT_STEP_VIEWS: Readonly<Record<ProjectStepId, ProjectStepViewSpec>> = {
  REQUIREMENTS: {
    defaultView: 'app-requirements',
    views: ['app-requirements'],
  },
  PROTOTYPE: {
    defaultView: 'app-prototype',
    views: ['app-prototype'],
  },
  BUSINESS_MODEL: {
    defaultView: 'app-ontology',
    views: ['app-ontology'],
  },
  DELIVERY: {
    defaultView: 'app-assembly-dev',
    views: ['app-four-layer-assets', 'app-assembly-dev', 'app-skills', 'app-publish'],
  },
};

export type SecondaryAreaId = 'CAPABILITY' | 'ANALYTICS' | 'GOVERNANCE';

export interface SecondaryAreaSpec {
  readonly id: SecondaryAreaId;
  readonly label: BilingualText;
  readonly hint: BilingualText;
  readonly defaultView: CanonicalNavViewId;
  readonly views: readonly CanonicalNavViewId[];
}

export const SECONDARY_AREAS: readonly SecondaryAreaSpec[] = [
  {
    id: 'CAPABILITY',
    label: { zh: '能力中心', en: 'Capability Center' },
    hint: { zh: '把已有系统的能力整理成技能', en: 'Turn existing system capabilities into skills' },
    defaultView: 'cap-systems',
    views: ['cap-systems', 'cap-extraction', 'cap-mcp', 'cap-agents', 'cap-cross-flows', 'cap-knowledge'],
  },
  {
    id: 'ANALYTICS',
    label: { zh: '数据分析中心', en: 'Data Analytics Center' },
    hint: { zh: '用业务模型分析数据', en: 'Analyze data with your business model' },
    defaultView: 'data-resources',
    views: ['data-resources', 'data-mappings', 'data-metrics-reports', 'data-reasoning', 'data-writeback'],
  },
  {
    id: 'GOVERNANCE',
    label: { zh: '平台治理', en: 'Platform Governance' },
    hint: { zh: 'AI 服务与工作台设置', en: 'AI services and workbench settings' },
    defaultView: 'llm-center',
    views: ['llm-center', 'system-settings'],
  },
];

const VIEW_TO_STEP = new Map<CanonicalNavViewId, ProjectStepId>();
for (const [stepId, spec] of Object.entries(PROJECT_STEP_VIEWS) as [ProjectStepId, ProjectStepViewSpec][]) {
  for (const viewId of spec.views) {
    VIEW_TO_STEP.set(viewId, stepId);
  }
}
// Legacy Business Model deep-link views stay URL-compatible and route into BUSINESS_MODEL (#68).
VIEW_TO_STEP.set('app-model-files', 'BUSINESS_MODEL');
VIEW_TO_STEP.set('app-knowledge-graph', 'BUSINESS_MODEL');

const VIEW_TO_SECONDARY_AREA = new Map<CanonicalNavViewId, SecondaryAreaSpec>();
for (const area of SECONDARY_AREAS) {
  for (const viewId of area.views) {
    VIEW_TO_SECONDARY_AREA.set(viewId, area);
  }
}

export type ShellRouteContext =
  | { readonly kind: 'home'; readonly view: 'overview' }
  | {
      readonly kind: 'project';
      readonly step: ProjectStepId;
      readonly view: CanonicalNavViewId;
      readonly stepViews: readonly CanonicalNavViewId[];
    }
  | {
      readonly kind: 'secondary';
      readonly area: SecondaryAreaId;
      readonly view: CanonicalNavViewId;
      readonly areaSpec: SecondaryAreaSpec;
    };

export function getProjectStepForView(view: NavViewId): ProjectStepId | null {
  const normalized = normalizeNavViewAlias(view);
  if (!isNavViewId(normalized)) return null;
  return VIEW_TO_STEP.get(normalized) ?? null;
}

export function getDefaultViewForStep(step: ProjectStepId): CanonicalNavViewId {
  return PROJECT_STEP_VIEWS[step].defaultView;
}

export function getSecondaryAreaForView(view: NavViewId): SecondaryAreaSpec | null {
  const normalized = normalizeNavViewAlias(view);
  if (!isNavViewId(normalized)) return null;
  return VIEW_TO_SECONDARY_AREA.get(normalized) ?? null;
}

export function resolveShellRouteContext(view: NavViewId): ShellRouteContext {
  const canonical = resolveNavViewId(view);
  if (canonical === 'overview') {
    return { kind: 'home', view: 'overview' };
  }
  const step = getProjectStepForView(canonical);
  if (step) {
    return {
      kind: 'project',
      step,
      view: canonical,
      stepViews: PROJECT_STEP_VIEWS[step].views,
    };
  }
  const areaSpec = getSecondaryAreaForView(canonical) ?? SECONDARY_AREAS[0]!;
  return {
    kind: 'secondary',
    area: areaSpec.id,
    view: canonical,
    areaSpec,
  };
}

export function resolveStepParamToId(raw: string | null | undefined): ProjectStepId | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase().replace(/-/g, '_');
  switch (normalized) {
    case 'requirements':
    case 'requirement':
      return 'REQUIREMENTS';
    case 'prototype':
      return 'PROTOTYPE';
    case 'business_model':
    case 'model':
      return 'BUSINESS_MODEL';
    case 'delivery':
      return 'DELIVERY';
    default:
      return null;
  }
}

export function resolveAreaParamToView(raw: string | null | undefined): CanonicalNavViewId | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  switch (normalized) {
    case 'capability':
      return 'cap-systems';
    case 'analytics':
      return 'data-resources';
    case 'governance':
    case 'platform':
      return 'llm-center';
    case 'settings':
      return 'system-settings';
    case 'home':
      return 'overview';
    default:
      return null;
  }
}
