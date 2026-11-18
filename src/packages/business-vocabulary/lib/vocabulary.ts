import type { ModelCode } from '../../ontology-core/index.js';

export type BusinessLocale = 'zh-CN' | 'en-US';

export interface BilingualText {
  readonly zh: string;
  readonly en: string;
}

export interface ModelBusinessTerm extends BilingualText {
  readonly key: ModelCode;
  readonly modelCode: ModelCode;
  readonly glossaryTermEn: string;
  readonly glossaryTermZh: string;
  readonly shownAsInGlossary: true;
  readonly singularZh: string;
  readonly singularEn: string;
}

export type WorkspaceConceptKey =
  | 'ONTOLOGY_PROJECT'
  | 'ONTOLOGY_SUITE'
  | 'CONSISTENCY_ERROR'
  | 'STAGE_WARNING'
  | 'CONFIRMED_REVISION'
  | 'ONTOLOGY_SYNTHESIS'
  | 'AI_ASSISTANT'
  | 'PROJECT_STEP'
  | 'STEP_HANDOFF'
  | 'STEP_CONFIRMATION'
  | 'OUTDATED'
  | 'CHANGE_SUMMARY'
  | 'BUSINESS_VIEW'
  | 'TECHNICAL_DETAILS'
  | 'CONTEXT_INSPECTOR';

export type BusinessConceptKey = ModelCode | WorkspaceConceptKey;

export interface BusinessVocabularyEntry extends BilingualText {
  readonly key: BusinessConceptKey;
  readonly glossaryTermEn: string;
  readonly glossaryTermZh: string;
  readonly shownAsInGlossary: boolean;
  readonly singularZh: string;
  readonly singularEn: string;
}

export const MODEL_BUSINESS_NAMES: Readonly<Record<ModelCode, ModelBusinessTerm>> = {
  M1: {
    key: 'M1',
    modelCode: 'M1',
    glossaryTermEn: 'Object Model',
    glossaryTermZh: '对象模型',
    shownAsInGlossary: true,
    zh: '业务对象',
    en: 'Business Objects',
    singularZh: '业务对象',
    singularEn: 'Business Object',
  },
  M2: {
    key: 'M2',
    modelCode: 'M2',
    glossaryTermEn: 'Behavior Model',
    glossaryTermZh: '行为模型',
    shownAsInGlossary: true,
    zh: '业务操作',
    en: 'Actions',
    singularZh: '业务操作',
    singularEn: 'Action',
  },
  M3: {
    key: 'M3',
    modelCode: 'M3',
    glossaryTermEn: 'Rule Model',
    glossaryTermZh: '规则模型',
    shownAsInGlossary: true,
    zh: '业务规则',
    en: 'Business Rules',
    singularZh: '业务规则',
    singularEn: 'Business Rule',
  },
  ME: {
    key: 'ME',
    modelCode: 'ME',
    glossaryTermEn: 'Event Model',
    glossaryTermZh: '事件模型',
    shownAsInGlossary: true,
    zh: '业务事件',
    en: 'Business Events',
    singularZh: '业务事件',
    singularEn: 'Business Event',
  },
  M4: {
    key: 'M4',
    modelCode: 'M4',
    glossaryTermEn: 'Scenario Model',
    glossaryTermZh: '场景模型',
    shownAsInGlossary: true,
    zh: '自动联动',
    en: 'Automations',
    singularZh: '自动联动',
    singularEn: 'Automation',
  },
  M5: {
    key: 'M5',
    modelCode: 'M5',
    glossaryTermEn: 'Actor Model',
    glossaryTermZh: '主体模型',
    shownAsInGlossary: true,
    zh: '角色与权限',
    en: 'Roles & Permissions',
    singularZh: '角色与权限',
    singularEn: 'Role & Permission',
  },
  M6: {
    key: 'M6',
    modelCode: 'M6',
    glossaryTermEn: 'Flow Model',
    glossaryTermZh: '流程模型',
    shownAsInGlossary: true,
    zh: '流程与审批',
    en: 'Flows & Approvals',
    singularZh: '流程与审批',
    singularEn: 'Flow',
  },
  M7: {
    key: 'M7',
    modelCode: 'M7',
    glossaryTermEn: 'Query & Report Model',
    glossaryTermZh: '查询统计与报表模型',
    shownAsInGlossary: true,
    zh: '查询与报表',
    en: 'Queries & Reports',
    singularZh: '查询与报表',
    singularEn: 'Query / Report',
  },
  MU: {
    key: 'MU',
    modelCode: 'MU',
    glossaryTermEn: 'UI Model',
    glossaryTermZh: 'UI 模型',
    shownAsInGlossary: true,
    zh: '界面',
    en: 'Screens',
    singularZh: '界面',
    singularEn: 'Screen',
  },
  MM: {
    key: 'MM',
    modelCode: 'MM',
    glossaryTermEn: 'Mapping Model',
    glossaryTermZh: '对象-数据表映射模型',
    shownAsInGlossary: true,
    zh: '数据存储',
    en: 'Data Storage',
    singularZh: '数据存储',
    singularEn: 'Data Storage',
  },
  MI: {
    key: 'MI',
    modelCode: 'MI',
    glossaryTermEn: 'Interface Model',
    glossaryTermZh: '接口模型',
    shownAsInGlossary: true,
    zh: '对外接口',
    en: 'Integrations',
    singularZh: '对外接口',
    singularEn: 'Integration',
  },
};

export const BUSINESS_VOCABULARY: Readonly<Record<BusinessConceptKey, BusinessVocabularyEntry>> = {
  ...MODEL_BUSINESS_NAMES,
  ONTOLOGY_PROJECT: {
    key: 'ONTOLOGY_PROJECT',
    glossaryTermEn: 'Ontology Project',
    glossaryTermZh: '本体工程',
    shownAsInGlossary: true,
    zh: '项目',
    en: 'Project',
    singularZh: '项目',
    singularEn: 'Project',
  },
  ONTOLOGY_SUITE: {
    key: 'ONTOLOGY_SUITE',
    glossaryTermEn: 'Ontology Suite',
    glossaryTermZh: '本体套件',
    shownAsInGlossary: true,
    zh: '业务模型',
    en: 'Business Model',
    singularZh: '业务模型',
    singularEn: 'Business Model',
  },
  CONSISTENCY_ERROR: {
    key: 'CONSISTENCY_ERROR',
    glossaryTermEn: 'Consistency Error',
    glossaryTermZh: '一致性错误',
    shownAsInGlossary: true,
    zh: '需要修正的问题',
    en: 'Problems to fix',
    singularZh: '需要修正的问题',
    singularEn: 'Problem to fix',
  },
  STAGE_WARNING: {
    key: 'STAGE_WARNING',
    glossaryTermEn: 'Stage Warning',
    glossaryTermZh: '阶段缺失警告',
    shownAsInGlossary: true,
    zh: '尚未完成的部分',
    en: 'Not yet completed',
    singularZh: '尚未完成的部分',
    singularEn: 'Not yet completed',
  },
  CONFIRMED_REVISION: {
    key: 'CONFIRMED_REVISION',
    glossaryTermEn: 'Confirmed Revision',
    glossaryTermZh: '已确认修订',
    shownAsInGlossary: true,
    zh: '已确认的原型',
    en: 'Confirmed prototype',
    singularZh: '已确认的原型',
    singularEn: 'Confirmed prototype',
  },
  ONTOLOGY_SYNTHESIS: {
    key: 'ONTOLOGY_SYNTHESIS',
    glossaryTermEn: 'Ontology Synthesis',
    glossaryTermZh: '本体合成',
    shownAsInGlossary: true,
    zh: '生成业务模型',
    en: 'Generate business model',
    singularZh: '生成业务模型',
    singularEn: 'Generate business model',
  },
  AI_ASSISTANT: {
    key: 'AI_ASSISTANT',
    glossaryTermEn: 'AI Assistant',
    glossaryTermZh: 'AI 助手',
    shownAsInGlossary: false,
    zh: 'AI 助手',
    en: 'AI Assistant',
    singularZh: 'AI 助手',
    singularEn: 'AI Assistant',
  },
  PROJECT_STEP: {
    key: 'PROJECT_STEP',
    glossaryTermEn: 'Project Step',
    glossaryTermZh: '步骤',
    shownAsInGlossary: false,
    zh: '步骤',
    en: 'Project Step',
    singularZh: '步骤',
    singularEn: 'Project Step',
  },
  STEP_HANDOFF: {
    key: 'STEP_HANDOFF',
    glossaryTermEn: 'Step Hand-off',
    glossaryTermZh: '步骤转交',
    shownAsInGlossary: false,
    zh: '步骤转交',
    en: 'Step Hand-off',
    singularZh: '步骤转交',
    singularEn: 'Step Hand-off',
  },
  STEP_CONFIRMATION: {
    key: 'STEP_CONFIRMATION',
    glossaryTermEn: 'Step Confirmation',
    glossaryTermZh: '步骤确认',
    shownAsInGlossary: false,
    zh: '步骤确认',
    en: 'Step Confirmation',
    singularZh: '步骤确认',
    singularEn: 'Step Confirmation',
  },
  OUTDATED: {
    key: 'OUTDATED',
    glossaryTermEn: 'Outdated',
    glossaryTermZh: '待更新',
    shownAsInGlossary: false,
    zh: '待更新',
    en: 'Outdated',
    singularZh: '待更新',
    singularEn: 'Outdated',
  },
  CHANGE_SUMMARY: {
    key: 'CHANGE_SUMMARY',
    glossaryTermEn: 'Change Summary',
    glossaryTermZh: '变更说明',
    shownAsInGlossary: false,
    zh: '变更说明',
    en: 'Change Summary',
    singularZh: '变更说明',
    singularEn: 'Change Summary',
  },
  BUSINESS_VIEW: {
    key: 'BUSINESS_VIEW',
    glossaryTermEn: 'Business View',
    glossaryTermZh: '业务视图',
    shownAsInGlossary: false,
    zh: '业务视图',
    en: 'Business View',
    singularZh: '业务视图',
    singularEn: 'Business View',
  },
  TECHNICAL_DETAILS: {
    key: 'TECHNICAL_DETAILS',
    glossaryTermEn: 'Technical Details',
    glossaryTermZh: '技术细节',
    shownAsInGlossary: false,
    zh: '技术细节',
    en: 'Technical Details',
    singularZh: '技术细节',
    singularEn: 'Technical Details',
  },
  CONTEXT_INSPECTOR: {
    key: 'CONTEXT_INSPECTOR',
    glossaryTermEn: 'Context Inspector',
    glossaryTermZh: '上下文查看器',
    shownAsInGlossary: true,
    zh: '对话记忆',
    en: 'Conversation memory',
    singularZh: '对话记忆',
    singularEn: 'Conversation memory',
  },
};

export type ProjectStepId = 'REQUIREMENTS' | 'PROTOTYPE' | 'BUSINESS_MODEL' | 'DELIVERY';

export const PROJECT_STEP_IDS: readonly ProjectStepId[] = [
  'REQUIREMENTS',
  'PROTOTYPE',
  'BUSINESS_MODEL',
  'DELIVERY',
] as const;

export const PROJECT_STEP_NAMES: Readonly<Record<ProjectStepId, BilingualText>> = {
  REQUIREMENTS: { zh: '需求', en: 'Requirements' },
  PROTOTYPE: { zh: '原型', en: 'Prototype' },
  BUSINESS_MODEL: {
    zh: BUSINESS_VOCABULARY.ONTOLOGY_SUITE.zh,
    en: BUSINESS_VOCABULARY.ONTOLOGY_SUITE.en,
  },
  DELIVERY: { zh: '交付', en: 'Delivery' },
};

export type ProjectStepStateId =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'UNCONFIRMED_CHANGES'
  | 'CONFIRMED'
  | 'OUTDATED';

export const PROJECT_STEP_STATE_IDS: readonly ProjectStepStateId[] = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'UNCONFIRMED_CHANGES',
  'CONFIRMED',
  'OUTDATED',
] as const;

export const PROJECT_STEP_STATE_NAMES: Readonly<Record<ProjectStepStateId, BilingualText>> = {
  NOT_STARTED: { zh: '未开始', en: 'Not started' },
  IN_PROGRESS: { zh: '进行中', en: 'In progress' },
  UNCONFIRMED_CHANGES: { zh: '有未确认的修改', en: 'Unconfirmed changes' },
  CONFIRMED: { zh: '已确认', en: 'Confirmed' },
  OUTDATED: {
    zh: BUSINESS_VOCABULARY.OUTDATED.zh,
    en: BUSINESS_VOCABULARY.OUTDATED.en,
  },
};

export function pickBusinessText(text: BilingualText, locale: BusinessLocale = 'zh-CN'): string {
  return locale === 'en-US' ? text.en : text.zh;
}

export function getModelBusinessName(
  modelCode: ModelCode,
  locale: BusinessLocale = 'zh-CN',
  options?: { singular?: boolean },
): string {
  const term = MODEL_BUSINESS_NAMES[modelCode];
  if (options?.singular) {
    return locale === 'en-US' ? term.singularEn : term.singularZh;
  }
  return pickBusinessText(term, locale);
}
