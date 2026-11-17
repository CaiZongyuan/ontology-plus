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

export type NavGroupId = 'OVERVIEW' | 'APPLICATION' | 'CAPABILITY' | 'ANALYTICS' | 'PLATFORM';

export interface NavGroupSpec {
  id: NavGroupId;
  labelZh: string;
  labelEn: string;
}

export interface NavItemSpec {
  id: NavViewId;
  group: NavGroupId;
  labelZh: string;
  labelEn: string;
  badge?: string;
}

export const DEFAULT_NAV_VIEW: NavViewId = 'app-ontology';

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

const NAV_ITEM_BY_ID = new Map<NavViewId, NavItemSpec>(NAV_ITEMS.map((item) => [item.id, item]));
const NAV_GROUP_BY_ID = new Map<NavGroupId, NavGroupSpec>(NAV_GROUPS.map((grp) => [grp.id, grp]));

export function isNavViewId(value: string | null | undefined): value is NavViewId {
  return Boolean(value && NAV_ITEM_BY_ID.has(value as NavViewId));
}

export function resolveNavViewId(candidate: string | null | undefined): NavViewId {
  return isNavViewId(candidate) ? candidate : DEFAULT_NAV_VIEW;
}

export function getNavItemSpec(view: NavViewId): NavItemSpec | undefined {
  return NAV_ITEM_BY_ID.get(view);
}

export function getNavGroupSpec(group: NavGroupId): NavGroupSpec | undefined {
  return NAV_GROUP_BY_ID.get(group);
}

export function getNavItemsByGroup(group: NavGroupId): NavItemSpec[] {
  return NAV_ITEMS.filter((item) => item.group === group);
}

export function isFlushNavView(view: NavViewId): boolean {
  return view === 'app-ontology';
}
