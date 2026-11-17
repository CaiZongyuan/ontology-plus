import { MODEL_CODES, type ModelCode } from '../../ontology-core/index.js';
import { isTechnicalIdentifierOrJargon } from './guard.js';
import {
  BUSINESS_VOCABULARY,
  MODEL_BUSINESS_NAMES,
  PROJECT_STEP_NAMES,
  pickBusinessText,
  type BilingualText,
  type BusinessLocale,
  type ProjectStepId,
} from './vocabulary.js';

export type ToolProgressIconKind =
  | 'object'
  | 'action'
  | 'rule'
  | 'event'
  | 'automation'
  | 'role'
  | 'flow'
  | 'report'
  | 'screen'
  | 'storage'
  | 'integration'
  | 'delete'
  | 'inspect'
  | 'question'
  | 'document'
  | 'package'
  | 'query'
  | 'capability'
  | 'handoff'
  | 'general';

export interface ToolProgressSpec {
  readonly toolName: string;
  readonly modelCode?: ModelCode;
  readonly iconKind: ToolProgressIconKind;
  readonly label: BilingualText;
  readonly activeLabel: BilingualText;
}

const VALID_MODEL_CODES = new Set<string>(MODEL_CODES);

function isModelCode(raw: unknown): raw is ModelCode {
  return typeof raw === 'string' && VALID_MODEL_CODES.has(raw);
}

function buildModelUpsertSpec(
  toolName: string,
  modelCode: ModelCode,
  iconKind: ToolProgressIconKind,
): ToolProgressSpec {
  const model = MODEL_BUSINESS_NAMES[modelCode];
  return {
    toolName,
    modelCode,
    iconKind,
    label: {
      zh: `更新${model.zh}`,
      en: `Update ${model.en}`,
    },
    activeLabel: {
      zh: `正在更新${model.zh}`,
      en: `Updating ${model.en}`,
    },
  };
}

const SUITE_NAME = BUSINESS_VOCABULARY.ONTOLOGY_SUITE;
const REQ_STEP = PROJECT_STEP_NAMES.REQUIREMENTS;
const PROTO_STEP = PROJECT_STEP_NAMES.PROTOTYPE;
const DELIVERY_STEP = PROJECT_STEP_NAMES.DELIVERY;
const SCREENS_NAME = MODEL_BUSINESS_NAMES.MU;

const CATALOG_ENTRIES: readonly ToolProgressSpec[] = [
  // 12 Ontology Suite mutation tools derived from MODEL_BUSINESS_NAMES & ONTOLOGY_SUITE
  buildModelUpsertSpec('upsert_aggregate', 'M1', 'object'),
  buildModelUpsertSpec('upsert_behavior', 'M2', 'action'),
  buildModelUpsertSpec('upsert_rule', 'M3', 'rule'),
  buildModelUpsertSpec('upsert_event', 'ME', 'event'),
  buildModelUpsertSpec('upsert_scenario', 'M4', 'automation'),
  buildModelUpsertSpec('upsert_actor_role', 'M5', 'role'),
  buildModelUpsertSpec('upsert_flow', 'M6', 'flow'),
  buildModelUpsertSpec('upsert_query_report', 'M7', 'report'),
  buildModelUpsertSpec('upsert_screen', 'MU', 'screen'),
  buildModelUpsertSpec('upsert_mapping', 'MM', 'storage'),
  buildModelUpsertSpec('upsert_interface', 'MI', 'integration'),
  {
    toolName: 'delete_element',
    iconKind: 'delete',
    label: {
      zh: `移除${SUITE_NAME.zh}内容`,
      en: `Remove from ${SUITE_NAME.en}`,
    },
    activeLabel: {
      zh: `正在移除${SUITE_NAME.zh}内容`,
      en: `Removing from ${SUITE_NAME.en}`,
    },
  },

  // Unified extra tools
  {
    toolName: 'inspect_ontology_model',
    iconKind: 'inspect',
    label: {
      zh: `检查${SUITE_NAME.zh}`,
      en: `Check ${SUITE_NAME.en}`,
    },
    activeLabel: {
      zh: `正在检查${SUITE_NAME.zh}`,
      en: `Checking ${SUITE_NAME.en}`,
    },
  },
  {
    toolName: 'ask_user',
    iconKind: 'question',
    label: {
      zh: '征询你的确认',
      en: 'Ask for your input',
    },
    activeLabel: {
      zh: '正在整理需要你确认的问题',
      en: 'Preparing a question for you',
    },
  },
  {
    toolName: 'record_requirement_insights',
    iconKind: 'document',
    label: {
      zh: `记录${REQ_STEP.zh}要点`,
      en: `Record ${REQ_STEP.en.toLowerCase()} points`,
    },
    activeLabel: {
      zh: `正在记录${REQ_STEP.zh}要点`,
      en: `Recording ${REQ_STEP.en.toLowerCase()} points`,
    },
  },
  {
    toolName: 'invoke_mcp_tool',
    iconKind: 'capability',
    label: {
      zh: '调用业务能力工具',
      en: 'Run business capability',
    },
    activeLabel: {
      zh: '正在调用业务能力工具',
      en: 'Running business capability',
    },
  },
  {
    toolName: 'run_readonly_sql',
    iconKind: 'query',
    label: {
      zh: '查询业务数据',
      en: 'Query business data',
    },
    activeLabel: {
      zh: '正在查询业务数据',
      en: 'Querying business data',
    },
  },
  {
    toolName: 'propose_policy_writeback',
    iconKind: 'action',
    label: {
      zh: '生成处理建议',
      en: 'Propose follow-up action',
    },
    activeLabel: {
      zh: '正在生成处理建议',
      en: 'Proposing follow-up action',
    },
  },

  // Prototype tools
  {
    toolName: 'list_prototype_anchors',
    iconKind: 'screen',
    label: {
      zh: `查看${PROTO_STEP.zh}${SCREENS_NAME.zh}结构`,
      en: `Check ${PROTO_STEP.en.toLowerCase()} ${SCREENS_NAME.en.toLowerCase()}`,
    },
    activeLabel: {
      zh: `正在查看${PROTO_STEP.zh}${SCREENS_NAME.zh}结构`,
      en: `Checking ${PROTO_STEP.en.toLowerCase()} ${SCREENS_NAME.en.toLowerCase()}`,
    },
  },
  {
    toolName: 'read_prototype_anchor',
    iconKind: 'inspect',
    label: {
      zh: `查看${PROTO_STEP.zh}局部内容`,
      en: `Read ${PROTO_STEP.en.toLowerCase()} section`,
    },
    activeLabel: {
      zh: `正在查看${PROTO_STEP.zh}局部内容`,
      en: `Reading ${PROTO_STEP.en.toLowerCase()} section`,
    },
  },
  {
    toolName: 'edit_prototype_anchor',
    iconKind: 'screen',
    label: {
      zh: `修改${PROTO_STEP.zh}局部内容`,
      en: `Update ${PROTO_STEP.en.toLowerCase()} section`,
    },
    activeLabel: {
      zh: `正在修改${PROTO_STEP.zh}局部内容`,
      en: `Updating ${PROTO_STEP.en.toLowerCase()} section`,
    },
  },
  {
    toolName: 'rewrite_prototype_page',
    iconKind: 'screen',
    label: {
      zh: `生成${PROTO_STEP.zh}页面`,
      en: `Generate ${PROTO_STEP.en.toLowerCase()} page`,
    },
    activeLabel: {
      zh: `正在生成${PROTO_STEP.zh}页面`,
      en: `Generating ${PROTO_STEP.en.toLowerCase()} page`,
    },
  },

  // Domain run tools
  {
    toolName: 'save_synthesized_srs_doc',
    iconKind: 'document',
    label: {
      zh: `保存${REQ_STEP.zh}文档`,
      en: `Save ${REQ_STEP.en.toLowerCase()} document`,
    },
    activeLabel: {
      zh: `正在保存${REQ_STEP.zh}文档`,
      en: `Saving ${REQ_STEP.en.toLowerCase()} document`,
    },
  },
  {
    toolName: 'synthesize_ontology_suite',
    iconKind: 'object',
    label: {
      zh: `生成${SUITE_NAME.zh}`,
      en: `Generate ${SUITE_NAME.en}`,
    },
    activeLabel: {
      zh: `正在生成${SUITE_NAME.zh}`,
      en: `Generating ${SUITE_NAME.en}`,
    },
  },
  {
    toolName: 'read_architecture_assets',
    iconKind: 'inspect',
    label: {
      zh: '查看技术标准',
      en: 'Check technical standards',
    },
    activeLabel: {
      zh: '正在查看技术标准',
      en: 'Checking technical standards',
    },
  },
  {
    toolName: 'save_architecture_asset',
    iconKind: 'document',
    label: {
      zh: '保存技术标准',
      en: 'Save technical standard',
    },
    activeLabel: {
      zh: '正在保存技术标准',
      en: 'Saving technical standard',
    },
  },
  {
    toolName: 'save_tech_architecture_spec',
    iconKind: 'document',
    label: {
      zh: '保存技术架构方案',
      en: 'Save technical architecture',
    },
    activeLabel: {
      zh: '正在保存技术架构方案',
      en: 'Saving technical architecture',
    },
  },
  {
    toolName: 'read_application_inputs',
    iconKind: 'inspect',
    label: {
      zh: `检查${DELIVERY_STEP.zh}输入`,
      en: `Check ${DELIVERY_STEP.en.toLowerCase()} inputs`,
    },
    activeLabel: {
      zh: `正在检查${DELIVERY_STEP.zh}输入`,
      en: `Checking ${DELIVERY_STEP.en.toLowerCase()} inputs`,
    },
  },
  {
    toolName: 'save_application_instructions',
    iconKind: 'document',
    label: {
      zh: '保存开发补充说明',
      en: 'Save development notes',
    },
    activeLabel: {
      zh: '正在保存开发补充说明',
      en: 'Saving development notes',
    },
  },
  {
    toolName: 'compile_dev_package',
    iconKind: 'package',
    label: {
      zh: '生成开发包',
      en: 'Generate development package',
    },
    activeLabel: {
      zh: '正在生成开发包',
      en: 'Generating development package',
    },
  },
  {
    toolName: 'run_ontology_extraction',
    iconKind: 'capability',
    label: {
      zh: `从现有系统提取${SUITE_NAME.zh}候选`,
      en: `Extract ${SUITE_NAME.en} candidates`,
    },
    activeLabel: {
      zh: `正在从现有系统提取${SUITE_NAME.zh}候选`,
      en: `Extracting ${SUITE_NAME.en} candidates`,
    },
  },
  {
    toolName: 'save_metric_insight',
    iconKind: 'report',
    label: {
      zh: '保存指标分析结论',
      en: 'Save metric analysis',
    },
    activeLabel: {
      zh: '正在保存指标分析结论',
      en: 'Saving metric analysis',
    },
  },
  {
    toolName: 'save_scenario_attribution_report',
    iconKind: 'report',
    label: {
      zh: '保存归因分析报告',
      en: 'Save attribution report',
    },
    activeLabel: {
      zh: '正在保存归因分析报告',
      en: 'Saving attribution report',
    },
  },
  {
    toolName: 'propose_step_handoff',
    iconKind: 'handoff',
    label: {
      zh: `提出${BUSINESS_VOCABULARY.STEP_HANDOFF.zh}`,
      en: `Offer ${BUSINESS_VOCABULARY.STEP_HANDOFF.en}`,
    },
    activeLabel: {
      zh: `正在准备${BUSINESS_VOCABULARY.STEP_HANDOFF.zh}`,
      en: `Preparing ${BUSINESS_VOCABULARY.STEP_HANDOFF.en}`,
    },
  },
];

export const TOOL_PROGRESS_CATALOG: Readonly<Record<string, ToolProgressSpec>> = Object.fromEntries(
  CATALOG_ENTRIES.map((spec) => [spec.toolName, spec]),
);

const LEGACY_TOOL_ALIASES: Readonly<Record<string, string>> = {
  extract_ontology_candidates: 'run_ontology_extraction',
  upsert_ui_screen: 'upsert_screen',
  upsert_command: 'upsert_behavior',
  upsert_process: 'upsert_flow',
  upsert_external_mapping: 'upsert_mapping',
  handoff_to_step: 'propose_step_handoff',
};

export function resolveToolProgressSpec(toolName: string): ToolProgressSpec {
  const canonicalName = LEGACY_TOOL_ALIASES[toolName] ?? toolName;
  const direct = TOOL_PROGRESS_CATALOG[canonicalName];
  if (direct) return direct;

  const lower = toolName.toLowerCase();
  if (lower.includes('sql') || lower.includes('db') || lower.includes('query')) {
    return {
      toolName,
      iconKind: 'query',
      label: { zh: '查询业务数据', en: 'Query business data' },
      activeLabel: { zh: '正在查询业务数据', en: 'Querying business data' },
    };
  }
  if (lower.includes('compile') || lower.includes('package') || lower.includes('skill')) {
    return {
      toolName,
      iconKind: 'package',
      label: { zh: '生成交付内容', en: 'Generate deliverable' },
      activeLabel: { zh: '正在生成交付内容', en: 'Generating deliverable' },
    };
  }
  if (lower.includes('rule') || lower.includes('scenario') || lower.includes('element')) {
    return {
      toolName,
      iconKind: 'rule',
      label: { zh: `更新${SUITE_NAME.zh}`, en: `Update ${SUITE_NAME.en}` },
      activeLabel: { zh: `正在更新${SUITE_NAME.zh}`, en: `Updating ${SUITE_NAME.en}` },
    };
  }
  return {
    toolName,
    iconKind: 'general',
    label: { zh: '处理业务请求', en: 'Process request' },
    activeLabel: { zh: '正在处理业务请求', en: 'Processing request' },
  };
}

const CJK_RE = /[\u3400-\u9fff]/;

function cleanCandidateString(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (!trimmed || trimmed.length > 48) return undefined;
  if (isTechnicalIdentifierOrJargon(trimmed)) return undefined;
  return trimmed;
}

function pickLocalizedTarget(
  args: Record<string, unknown>,
  zhKeys: readonly string[],
  enKeys: readonly string[],
): { zh?: string; en?: string } {
  let zhTarget: string | undefined;
  for (const key of zhKeys) {
    const clean = cleanCandidateString(args[key]);
    if (clean) {
      zhTarget = clean;
      break;
    }
  }

  let enTarget: string | undefined;
  for (const key of enKeys) {
    const clean = cleanCandidateString(args[key]);
    if (!clean) continue;
    // When choosing between a Chinese alias and an ASCII identifier/name for English copy, prefer ASCII first
    if (!CJK_RE.test(clean)) {
      enTarget = clean;
      break;
    }
    if (!enTarget) {
      enTarget = clean;
    }
  }

  return {
    ...(zhTarget ? { zh: zhTarget } : {}),
    ...(enTarget ? { en: enTarget } : {}),
  };
}

const STEP_ALIAS_MAP: Readonly<Record<string, ProjectStepId>> = {
  REQUIREMENTS: 'REQUIREMENTS',
  requirements: 'REQUIREMENTS',
  PROTOTYPE: 'PROTOTYPE',
  prototype: 'PROTOTYPE',
  BUSINESS_MODEL: 'BUSINESS_MODEL',
  model: 'BUSINESS_MODEL',
  DELIVERY: 'DELIVERY',
  delivery: 'DELIVERY',
};

export interface ToolProgressFormatOptions {
  readonly targetLabel?: string;
}

function formatToolTextPair(
  toolName: string,
  args: Record<string, unknown> | undefined,
  active: boolean,
  options?: ToolProgressFormatOptions,
): BilingualText {
  const spec = resolveToolProgressSpec(toolName);
  const base = active ? spec.activeLabel : spec.label;
  const hasArgs = Boolean(args && Object.keys(args).length > 0);
  if (!hasArgs && !options?.targetLabel) {
    return base;
  }
  const safeArgs = args ?? {};

  // 1. Model-specific upsert_* tools
  if (spec.modelCode) {
    const model = MODEL_BUSINESS_NAMES[spec.modelCode];
    const target = pickLocalizedTarget(
      safeArgs,
      ['alias', 'label', 'roleName', 'actorName', 'name', 'objectName'],
      ['name', 'objectName', 'alias', 'label', 'roleName', 'actorName'],
    );
    const zh = target.zh
      ? `${active ? '正在更新' : '更新'}${model.singularZh}「${target.zh}」`
      : base.zh;
    const en = target.en
      ? `${active ? 'Updating' : 'Update'} ${model.singularEn} '${target.en}'`
      : base.en;
    return { zh, en };
  }

  const canonical = LEGACY_TOOL_ALIASES[toolName] ?? toolName;

  // 2. delete_element (optional modelCode + optional clean business name)
  if (canonical === 'delete_element') {
    const target = pickLocalizedTarget(
      safeArgs,
      ['alias', 'label', 'name', 'elementId'],
      ['name', 'alias', 'label', 'elementId'],
    );
    if (isModelCode(safeArgs.modelCode)) {
      const model = MODEL_BUSINESS_NAMES[safeArgs.modelCode];
      const zhVerb = active ? '正在移除' : '移除';
      const enVerb = active ? 'Removing' : 'Remove';
      return {
        zh: target.zh ? `${zhVerb}${model.singularZh}「${target.zh}」` : `${zhVerb}${model.singularZh}`,
        en: target.en ? `${enVerb} ${model.singularEn} '${target.en}'` : `${enVerb} ${model.singularEn}`,
      };
    }
    if (target.zh || target.en) {
      return {
        zh: target.zh ? `${base.zh}「${target.zh}」` : base.zh,
        en: target.en ? `${base.en} '${target.en}'` : base.en,
      };
    }
    return base;
  }

  // 3. inspect_ontology_model (optional modelCode)
  if (canonical === 'inspect_ontology_model') {
    if (isModelCode(safeArgs.modelCode)) {
      const model = MODEL_BUSINESS_NAMES[safeArgs.modelCode];
      return {
        zh: `${active ? '正在检查' : '检查'}${model.zh}`,
        en: `${active ? 'Checking' : 'Check'} ${model.en}`,
      };
    }
    return base;
  }

  // 4. Prototype read/edit with clean human label
  if (canonical === 'read_prototype_anchor' || canonical === 'edit_prototype_anchor') {
    const isEdit = canonical === 'edit_prototype_anchor';
    const label = cleanCandidateString(
      options?.targetLabel ?? safeArgs.label ?? safeArgs.targetLabel,
    );
    if (label) {
      return {
        zh: `${active ? '正在' : ''}${isEdit ? '修改' : '查看'}${PROTO_STEP.zh}中的「${label}」`,
        en: `${active ? (isEdit ? 'Updating' : 'Reading') : isEdit ? 'Update' : 'Read'} '${label}' in ${PROTO_STEP.en.toLowerCase()}`,
      };
    }
    return base;
  }

  // 5. Step hand-off with targetStep
  if (canonical === 'propose_step_handoff') {
    const rawStep = typeof safeArgs.targetStep === 'string' ? safeArgs.targetStep : undefined;
    const stepId = rawStep ? STEP_ALIAS_MAP[rawStep] : undefined;
    if (stepId) {
      const stepName = PROJECT_STEP_NAMES[stepId];
      return {
        zh: `${active ? '正在准备转交到' : '转交到'}「${stepName.zh}」${BUSINESS_VOCABULARY.PROJECT_STEP.zh}`,
        en: `${active ? 'Preparing hand-off to' : 'Hand off to'} ${stepName.en}`,
      };
    }
    return base;
  }

  // 6. Named artifact / report / standard tools when title/name is clean business language
  if (
    canonical === 'save_synthesized_srs_doc' ||
    canonical === 'save_architecture_asset' ||
    canonical === 'save_tech_architecture_spec' ||
    canonical === 'run_ontology_extraction' ||
    canonical === 'save_scenario_attribution_report' ||
    canonical === 'propose_policy_writeback'
  ) {
    const target = cleanCandidateString(safeArgs.title ?? safeArgs.name ?? safeArgs.actionTitle);
    if (target) {
      return {
        zh: `${base.zh}「${target}」`,
        en: `${base.en} '${target}'`,
      };
    }
  }

  return base;
}

/** Concise bilingual step label derived from the Business Vocabulary. */
export function formatToolStepLabel(
  toolName: string,
  args?: Record<string, unknown>,
  options?: ToolProgressFormatOptions,
): BilingualText {
  return formatToolTextPair(toolName, args, false, options);
}

/** Progressive in-flight bilingual status derived from the Business Vocabulary. */
export function formatToolProgress(
  toolName: string,
  args?: Record<string, unknown>,
  options?: ToolProgressFormatOptions,
): BilingualText {
  return formatToolTextPair(toolName, args, true, options);
}

/** Single-locale progressive line for Business View run cards (no LLM free text). */
export function formatToolProgressLine(
  toolName: string,
  args?: Record<string, unknown>,
  locale: BusinessLocale = 'zh-CN',
  options?: ToolProgressFormatOptions,
): string {
  return pickBusinessText(formatToolProgress(toolName, args, options), locale);
}
