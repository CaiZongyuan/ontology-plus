import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import type { AgentSession, WorkspaceStore } from '../../workspace-store/index.js';
import { LlmGatewayError, isMockLlmActive } from './gateway-boundary.js';
import { type AgentLocale, pickLocaleText, resolveEffectiveLocale } from './locale.js';
import { buildPiModelsForStore } from './pi-session-engine.js';

// ─── Inspo Allowed Taxonomy & Deterministic Desensitizer ─────────────────────

export const VALID_INSPO_STYLES = [
  'minimalism',
  'editorial',
  'brutalism',
  'glassmorphism',
  'swiss',
  'maximalism',
  'playful',
  'dark-mode',
  'monochrome',
  'vintage',
  'futurist',
] as const;
export type InspoStyle = (typeof VALID_INSPO_STYLES)[number];

export const VALID_INSPO_INDUSTRIES = [
  'agency',
  'ai',
  'architecture',
  'automotive',
  'consumer-tech',
  'creator',
  'crypto',
  'culture',
  'developer-tools',
  'ecommerce',
  'education',
  'fashion',
  'fintech',
  'food-beverage',
  'furniture',
  'gaming',
  'health',
  'media',
  'music',
  'non-profit',
  'portfolio',
  'saas',
  'travel',
  'type-foundry',
] as const;
export type InspoIndustry = (typeof VALID_INSPO_INDUSTRIES)[number];

export const VALID_INSPO_MACROSTRUCTURES = [
  'bento-grid',
  'long-document',
  'marquee-hero',
  'stat-led',
  'conversational-faq',
  'manifesto',
  'photographic',
  'specimen',
  'catalogue',
  'letter',
  'index-first',
  'narrative-workflow',
  'split-studio',
  'feature-stack',
  'type-specimen',
  'portfolio-grid',
  'map-diagram',
  'ecosystem-index',
  'component-playground',
] as const;
export type InspoMacrostructure = (typeof VALID_INSPO_MACROSTRUCTURES)[number];

export const VALID_INSPO_VIBES = [
  'calm',
  'loud',
  'playful',
  'serious',
  'luxe',
  'raw',
  'soft',
  'technical',
  'warm',
  'cold',
] as const;
export type InspoVibe = (typeof VALID_INSPO_VIBES)[number];

export type SanitizedIndustryCategory = InspoIndustry | 'logistics';

const ALLOWED_MOOD_KEYWORDS = [
  'calm',
  'serious',
  'technical',
  'warm',
  'clean',
  'high-density',
  'tabular',
  'minimal',
  'modular',
  'editorial',
] as const;
export type SanitizedMoodKeyword = (typeof ALLOWED_MOOD_KEYWORDS)[number];

export const DEFAULT_INSPO_FILTERS = {
  modes: ['light', 'dark'],
  styles: [...VALID_INSPO_STYLES],
  industries: [...VALID_INSPO_INDUSTRIES],
  macrostructures: [...VALID_INSPO_MACROSTRUCTURES],
  vibes: [...VALID_INSPO_VIBES],
};

export interface SanitizedRecommendInput {
  srsText?: string;
  domain?: string;
  projectName?: string;
  projectCode?: string;
  brief?: string;
  industry?: string;
  vibe?: string;
  style?: string;
  mode?: string;
  moodKeywords?: string[];
}

export interface SanitizedRecommendBrief {
  brief: string;
  industry: SanitizedIndustryCategory;
  mcpIndustry: InspoIndustry;
  vibe: InspoVibe;
  style?: InspoStyle;
  mode: 'light' | 'dark';
  keywords: SanitizedMoodKeyword[];
}

function isAllowedEnum<T extends string>(list: readonly T[], val: unknown): val is T {
  return typeof val === 'string' && (list as readonly string[]).includes(val.trim().toLowerCase());
}

/**
 * Deterministic privacy-safe desensitizer for Inspo `recommend(brief)`.
 */
export function buildSanitizedRecommendBrief(
  input: SanitizedRecommendInput = {},
): SanitizedRecommendBrief {
  const signalText = [input.domain ?? '', input.srsText ?? '', input.brief ?? ''].join('\n');
  const normalizedIndustryInput = (input.industry ?? '').trim().toLowerCase();

  let industry: SanitizedIndustryCategory = 'saas';
  let mcpIndustry: InspoIndustry = 'saas';

  if (normalizedIndustryInput === 'logistics') {
    industry = 'logistics';
    mcpIndustry = 'saas';
  } else if (isAllowedEnum(VALID_INSPO_INDUSTRIES, normalizedIndustryInput)) {
    industry = normalizedIndustryInput;
    mcpIndustry = normalizedIndustryInput;
  } else if (
    /金融|银行|财务|结算|清结算|账务|费控|合同|信贷|风控|税|发票|资金|对账|fintech|bank|billing|ledger|payment|finance|settlement|contract|treasury/i.test(
      signalText,
    )
  ) {
    industry = 'fintech';
    mcpIndustry = 'fintech';
  } else if (
    /电商|零售|商城|商品|订单|购物车|门店|库存|ecommerce|retail|shop|catalog|merchandise/i.test(
      signalText,
    )
  ) {
    industry = 'ecommerce';
    mcpIndustry = 'ecommerce';
  } else if (
    /研发|开发|运维|监控|网关|集群|传输|接口|代码|数据中台|mft|devops|developer|api|infra|cloud|telemetry|observability/i.test(
      signalText,
    )
  ) {
    industry = 'developer-tools';
    mcpIndustry = 'developer-tools';
  } else if (/医疗|医院|健康|临床|患者|药|health|medical|clinic|patient|pharma/i.test(signalText)) {
    industry = 'health';
    mcpIndustry = 'health';
  } else if (/教育|培训|课程|学校|考试|教务|education|course|learning|campus/i.test(signalText)) {
    industry = 'education';
    mcpIndustry = 'education';
  } else if (
    /物流|仓储|供应链|调度|运输|货运|港口|logistics|supply\s*chain|warehouse|fleet|shipping/i.test(
      signalText,
    )
  ) {
    industry = 'logistics';
    mcpIndustry = 'saas';
  } else if (/智能体|大模型|知识库|推理|ai|agent|llm|copilot/i.test(signalText)) {
    industry = 'ai';
    mcpIndustry = 'ai';
  }

  const normalizedMode = (input.mode ?? '').trim().toLowerCase();
  const mode: 'light' | 'dark' =
    normalizedMode === 'dark' || normalizedMode === 'light'
      ? normalizedMode
      : /深色|暗色|暗黑|夜航|监控大屏|指挥舱|驾驶舱|dark\s*mode|dark\s*cockpit/i.test(signalText)
        ? 'dark'
        : 'light';

  const keywordSet = new Set<SanitizedMoodKeyword>();
  let defaultVibe: InspoVibe = 'calm';

  switch (industry) {
    case 'fintech':
      defaultVibe = 'serious';
      keywordSet.add('serious');
      keywordSet.add('clean');
      keywordSet.add('high-density');
      keywordSet.add('tabular');
      break;
    case 'developer-tools':
      defaultVibe = 'technical';
      keywordSet.add('technical');
      keywordSet.add('clean');
      keywordSet.add('high-density');
      keywordSet.add('tabular');
      break;
    case 'logistics':
      defaultVibe = 'technical';
      keywordSet.add('technical');
      keywordSet.add('high-density');
      keywordSet.add('tabular');
      keywordSet.add('clean');
      break;
    case 'health':
      defaultVibe = 'calm';
      keywordSet.add('calm');
      keywordSet.add('clean');
      keywordSet.add('warm');
      break;
    case 'education':
      defaultVibe = 'warm';
      keywordSet.add('warm');
      keywordSet.add('calm');
      keywordSet.add('clean');
      break;
    case 'ecommerce':
      defaultVibe = 'calm';
      keywordSet.add('clean');
      keywordSet.add('modular');
      break;
    case 'ai':
      defaultVibe = 'technical';
      keywordSet.add('clean');
      keywordSet.add('technical');
      keywordSet.add('calm');
      break;
    default:
      defaultVibe = 'calm';
      keywordSet.add('clean');
      keywordSet.add('calm');
      keywordSet.add('modular');
      break;
  }

  let inferredStyle: InspoStyle | undefined;
  if (/台账|表格|明细|报表|对账|审批|高密度|ledger|table|audit|report/i.test(signalText)) {
    keywordSet.add('tabular');
    keywordSet.add('high-density');
  }
  if (/文档|条款|知识|阅读|审阅|暖纸|杂志|editorial|document|paper/i.test(signalText)) {
    keywordSet.add('warm');
    keywordSet.add('editorial');
    inferredStyle = 'editorial';
  }
  if (/极简|清爽|简洁|留白|minimal/i.test(signalText)) {
    keywordSet.add('clean');
    keywordSet.add('minimal');
    inferredStyle ??= 'minimalism';
  }
  if (/看板|卡片|工作台|bento|dashboard/i.test(signalText)) {
    keywordSet.add('modular');
  }

  if (Array.isArray(input.moodKeywords)) {
    for (const kw of input.moodKeywords) {
      if (isAllowedEnum(ALLOWED_MOOD_KEYWORDS, kw)) {
        keywordSet.add(kw.trim().toLowerCase() as SanitizedMoodKeyword);
      }
    }
  }

  const normalizedVibe = (input.vibe ?? '').trim().toLowerCase();
  const vibe: InspoVibe = isAllowedEnum(VALID_INSPO_VIBES, normalizedVibe)
    ? normalizedVibe
    : defaultVibe;

  const normalizedStyle = (input.style ?? '').trim().toLowerCase();
  const style: InspoStyle | undefined = isAllowedEnum(VALID_INSPO_STYLES, normalizedStyle)
    ? normalizedStyle
    : inferredStyle;

  const keywords = [...keywordSet];
  const brief = `${industry} ${mode} product interface, ${keywords.join(', ')} visual language`;

  return {
    brief,
    industry,
    mcpIndustry,
    vibe,
    ...(style ? { style } : {}),
    mode,
    keywords,
  };
}

const SAFE_DESIGN_VOCABULARY = new Set<string>([
  ...VALID_INSPO_STYLES,
  ...VALID_INSPO_INDUSTRIES,
  ...VALID_INSPO_MACROSTRUCTURES,
  ...VALID_INSPO_VIBES,
  ...ALLOWED_MOOD_KEYWORDS,
  'a',
  'an',
  'and',
  'with',
  'for',
  'in',
  'of',
  'on',
  'to',
  'or',
  'logistics',
  'enterprise',
  'modern',
  'product',
  'interface',
  'visual',
  'language',
  'workspace',
  'dashboard',
  'console',
  'portal',
  'studio',
  'workbench',
  'ledger',
  'table',
  'tables',
  'list',
  'detail',
  'drawer',
  'modal',
  'form',
  'forms',
  'inspector',
  'analytics',
  'telemetry',
  'monitoring',
  'workflow',
  'approval',
  'review',
  'audit',
  'catalog',
  'catalogue',
  'inventory',
  'order',
  'orders',
  'billing',
  'settlement',
  'payment',
  'banking',
  'finance',
  'operations',
  'management',
  'admin',
  'navigation',
  'sidebar',
  'rail',
  'header',
  'toolbar',
  'panel',
  'panels',
  'card',
  'cards',
  'bento',
  'grid',
  'split',
  'canvas',
  'view',
  'views',
  'screen',
  'screens',
  'page',
  'pages',
  'archetype',
  'archetypes',
  'layout',
  'density',
  'compact',
  'spacious',
  'balanced',
  'comfortable',
  'airy',
  'crisp',
  'structured',
  'neutral',
  'paper',
  'surface',
  'surfaces',
  'light',
  'dark',
  'mode',
  'tone',
  'typography',
  'monospace',
  'serif',
  'sans',
  'hierarchy',
  'contrast',
  'subtle',
  'border',
  'borders',
  'web',
  'app',
  'application',
  'software',
  'platform',
  'tool',
  'tools',
  'developer',
  'consumer',
  'tech',
  'food',
  'beverage',
  'high',
  'low',
  'medium',
  'data',
  'dense',
  'chart',
  'charts',
  'metric',
  'metrics',
  'timeline',
  'kanban',
]);

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeAgentGeneratedInspoQuery(
  rawQuery: string,
  input: SanitizedRecommendInput,
  fallbackBrief: string,
): string {
  let text = rawQuery
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/www\.\S+/gi, ' ')
    .replace(/\S+@\S+\.\S+/g, ' ');

  for (const literal of [input.projectName, input.projectCode]) {
    const trimmed = literal?.trim();
    if (trimmed && trimmed.length >= 2) {
      text = text.replace(new RegExp(escapeRegExp(trimmed), 'gi'), ' ');
    }
  }

  // Strip numbers, CJK, and any non-ASCII characters
  text = text
    .replace(/\d+/g, ' ')
    .replace(/[^\x20-\x7E]+/g, ' ')
    .replace(/["'`*_#<>[\]{}()\\/|;:!?+=~@$%^&]+/g, ' ');

  const forbiddenTokens = new Set<string>();
  for (const src of [input.projectName ?? '', input.projectCode ?? '']) {
    for (const part of src.split(/[^A-Za-z]+/)) {
      const lower = part.trim().toLowerCase();
      if (lower.length >= 2 && !SAFE_DESIGN_VOCABULARY.has(lower)) {
        forbiddenTokens.add(lower);
      }
    }
  }

  // Also block proper-noun / uppercase / hyphenated secret identifiers from SRS or brief
  const privateCorpus = [input.srsText ?? '', input.brief ?? ''].join('\n');
  const identifierMatches =
    privateCorpus.match(/\b(?:[A-Z][A-Za-z0-9_-]{1,}|[A-Za-z]+-[A-Za-z0-9_-]+)\b/g) ?? [];
  for (const ident of identifierMatches) {
    for (const sub of ident.split(/[^A-Za-z]+/)) {
      const lower = sub.trim().toLowerCase();
      if (lower.length >= 2 && !SAFE_DESIGN_VOCABULARY.has(lower)) {
        forbiddenTokens.add(lower);
      }
    }
  }

  // Keep only safe vocabulary words or safe hyphenated compounds so zero private SRS text leaks
  const rawTokens = text.split(/\s+/).filter(Boolean);
  const keptTokens: string[] = [];
  for (const tok of rawTokens) {
    const trailingComma = tok.endsWith(',');
    const core = tok.replace(/^[-,.\s]+|[-,.\s]+$/g, '').toLowerCase();
    if (!core || forbiddenTokens.has(core)) continue;
    const subParts = core.split('-').filter(Boolean);
    if (subParts.length === 0) continue;
    const allSafe =
      SAFE_DESIGN_VOCABULARY.has(core) ||
      subParts.every((p) => SAFE_DESIGN_VOCABULARY.has(p) && !forbiddenTokens.has(p));
    if (!allSafe) continue;
    keptTokens.push(trailingComma ? `${core},` : core);
  }

  const joined = keptTokens
    .join(' ')
    .replace(/\s+,/g, ',')
    .replace(/,+/g, ',')
    .replace(/^,\s*|\s*,$/g, '')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 200)
    .trim()
    .replace(/,\s*$/, '');

  if (joined.length < 12) {
    return fallbackBrief.slice(0, 200);
  }
  return joined;
}

function makeTransientSessionForProject(store: WorkspaceStore, projectId: string): AgentSession {
  const fallbackProjectId =
    store.getProject(projectId)?.id ?? store.listProjects()[0]?.id ?? projectId;
  const now = new Date().toISOString();
  return {
    id: `transient-brief-${Date.now().toString(36)}`,
    projectId: fallbackProjectId,
    agentKind: 'PROTOTYPE_CO_DESIGN',
    title: 'Design Brief Assist',
    status: 'IDLE',
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Agent-backed Inspo visual query desensitizer.
 *
 * When `isMockLlmActive(store)` is `false`, asks the configured LLM for a short
 * (`<= 200` chars) English visual/product-category search query and passes the
 * output through `sanitizeAgentGeneratedInspoQuery` so zero project names, codes,
 * numbers, URLs, emails, Chinese characters, or private SRS proper nouns ever
 * leave the server. Falls back to `buildSanitizedRecommendBrief` in mock mode or
 * if the LLM call throws.
 */
export async function desensitizeRecommendBriefWithAgent(
  store: WorkspaceStore,
  input: SanitizedRecommendInput & { projectId?: string } = {},
): Promise<SanitizedRecommendBrief> {
  const base = buildSanitizedRecommendBrief(input);
  if (isMockLlmActive(store)) {
    return base;
  }

  try {
    const transientSession = makeTransientSessionForProject(
      store,
      input.projectId || store.listProjects()[0]?.id || 'proj-contract',
    );
    const built = buildPiModelsForStore(store, transientSession, {
      mockMode: false,
      locale: 'en-US',
    });

    const contextSummary = [
      input.domain ? `Domain category hint: ${input.domain.slice(0, 240)}` : '',
      input.srsText ? `Requirements excerpt: ${input.srsText.slice(0, 1200)}` : '',
      input.brief ? `Design preference note: ${input.brief.slice(0, 400)}` : '',
      `Baseline category: industry=${base.industry}, mode=${base.mode}, vibe=${base.vibe}`,
    ]
      .filter(Boolean)
      .join('\n');

    const stream = built.models.streamSimple(
      built.selectedModel,
      {
        systemPrompt:
          'You generate a privacy-safe English visual design search query (max 180 characters) for UI inspiration discovery. Output ONLY a single plain-English phrase describing: industry category + page archetypes (e.g. ledger table, dashboard, detail workspace) + visual tone + layout density + light/dark mode. STRICTLY FORBIDDEN: any company/customer/project names, project codes, numbers, URLs, emails, or non-ASCII characters.',
        messages: [
          {
            role: 'user',
            content: contextSummary,
            timestamp: Date.now(),
          },
        ],
      },
      {
        timeoutMs: 15_000,
        temperature: 0.1,
        maxTokens: 120,
      },
    );

    let rawReply = '';
    for await (const ev of stream) {
      if (ev.type === 'text_delta') {
        rawReply += ev.delta;
      } else if (ev.type === 'error') {
        throw new Error(ev.error.errorMessage || `LLM stream error (${ev.reason})`);
      }
    }

    const sanitizedQuery = sanitizeAgentGeneratedInspoQuery(rawReply, input, base.brief);
    return {
      ...base,
      brief: sanitizedQuery,
    };
  } catch {
    return base;
  }
}

// ─── Agent-Backed Project Design Brief Assist ────────────────────────────────

export type DesignBriefAssistMode = 'synthesize' | 'rewrite' | 'decide';

export interface DesignBriefAssistImageInput {
  imageId: string;
  role: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  dataBase64: string;
  label?: string;
}

export interface StructuredAssistedDesignBrief {
  positioning: string;
  colorMood: string;
  typography: string;
  layoutDensity: string;
  keyScreenStructure: string;
  componentTone: string;
  constraints: string;
  openNotes: string;
}

export interface AssistProjectDesignBriefInput {
  mode: DesignBriefAssistMode;
  projectId: string;
  srsSummary?: string;
  projectName?: string;
  currentBrief?: Partial<StructuredAssistedDesignBrief> | Record<string, unknown>;
  instruction?: string;
  primaryReference?: Record<string, unknown> | null;
  borrowedReferences?: Array<Record<string, unknown>>;
  images?: DesignBriefAssistImageInput[];
  locale?: string;
  mockMode?: boolean;
}

export interface AssistProjectDesignBriefResult {
  brief: StructuredAssistedDesignBrief;
  source: 'llm' | 'mock';
  visionFallbackUsed?: boolean;
}

const BRIEF_KEYS: readonly (keyof StructuredAssistedDesignBrief)[] = [
  'positioning',
  'colorMood',
  'typography',
  'layoutDensity',
  'keyScreenStructure',
  'componentTone',
  'constraints',
  'openNotes',
];

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? raw.trim();
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;
  try {
    const parsed = JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readStringField(
  obj: Record<string, unknown> | undefined,
  key: keyof StructuredAssistedDesignBrief,
): string {
  const val = obj?.[key];
  if (typeof val === 'string') return val.trim();
  if (Array.isArray(val)) {
    return val
      .map((item) => (typeof item === 'string' ? item.trim() : JSON.stringify(item)))
      .filter(Boolean)
      .join('; ');
  }
  return '';
}

function buildDeterministicMockDesignBrief(
  input: AssistProjectDesignBriefInput,
  projectDomain: string,
  effectiveProjectName: string,
  effectiveSrsSummary: string,
  locale: AgentLocale,
): StructuredAssistedDesignBrief {
  const cur = (input.currentBrief ?? {}) as Record<string, unknown>;
  const primaryTitle =
    typeof input.primaryReference?.title === 'string' && input.primaryReference.title.trim()
      ? input.primaryReference.title.trim()
      : '';
  const primarySurface =
    typeof input.primaryReference?.surfaceHex === 'string' &&
    input.primaryReference.surfaceHex.trim()
      ? input.primaryReference.surfaceHex.trim()
      : '';
  const primaryMode =
    typeof input.primaryReference?.mode === 'string' && input.primaryReference.mode.trim()
      ? input.primaryReference.mode.trim()
      : '';
  const borrowedSummary = (input.borrowedReferences ?? [])
    .map((ref) => {
      const title = typeof ref.title === 'string' ? ref.title.trim() : '';
      const aspect = typeof ref.aspect === 'string' ? ref.aspect.trim() : '';
      return [title, aspect].filter(Boolean).join(': ');
    })
    .filter(Boolean)
    .join(' / ');

  const signal = `${projectDomain}\n${effectiveSrsSummary}\n${input.instruction ?? ''}\n${primaryMode}`;
  const wantsDark = /深色|暗色|dark|监控|指挥|交易/i.test(signal);
  const isFintechOrLedger = /金融|财务|清结算|合同|台账|对账|fintech|ledger|contract|billing/i.test(
    signal,
  );

  const base: StructuredAssistedDesignBrief = {
    positioning: pickLocaleText(
      locale,
      `面向「${effectiveProjectName}」（${projectDomain || '企业业务系统'}）的专业级业务工作台，聚焦核心单据流转、状态可追溯与高效闭环操作。`,
      `Enterprise operational workbench for "${effectiveProjectName}" (${projectDomain || 'core business domain'}), centered on traceable record workflows and fast task completion.`,
    ),
    colorMood: pickLocaleText(
      locale,
      wantsDark
        ? `深色冷静技术界面（基底 ${primarySurface || '#0F172A'}），低饱和高对比层级与克制语义状态色${primaryTitle ? `，主参考基调对齐 ${primaryTitle}` : ''}。`
        : `暖白/中性浅色纸感表面（基底 ${primarySurface || '#F8F5EF'}），清晰墨色正文与克制品牌强调色${primaryTitle ? `，主参考基调对齐 ${primaryTitle}` : ''}。`,
      wantsDark
        ? `Calm dark technical surface (${primarySurface || '#0F172A'}) with crisp contrast hierarchy and restrained semantic status accents${primaryTitle ? `, anchored to ${primaryTitle}` : ''}.`
        : `Warm-neutral light surface (${primarySurface || '#F8F5EF'}) with high-legibility ink hierarchy and restrained semantic accents${primaryTitle ? `, anchored to ${primaryTitle}` : ''}.`,
    ),
    typography: pickLocaleText(
      locale,
      '无衬线几何界面字体搭配等宽数字/编号对齐（tabular-nums），明确区分页面主标题、分组小标题与表格正文层级。',
      'Clean geometric sans-serif UI typography paired with tabular-nums monospace for IDs, amounts, and timestamps across three clear hierarchy tiers.',
    ),
    layoutDensity: pickLocaleText(
      locale,
      isFintechOrLedger
        ? '中高信息密度（紧凑台账行高、固定筛选栏与右侧详情审阅抽屉），单屏承载关键状态与金额指标。'
        : '均衡工作台密度（清晰留白节律、分组卡片与结构化筛选列表），兼顾首屏概览与表单操作效率。',
      isFintechOrLedger
        ? 'Medium-high operational density with compact ledger rows, sticky filter bar, and right-hand inspection drawer.'
        : 'Balanced workspace density combining structured summary cards, scannable filterable lists, and focused action forms.',
    ),
    keyScreenStructure: pickLocaleText(
      locale,
      `左侧/顶部主导航 + 核心业务列表与指标概览页 + 结构化详情审阅与状态流转页 + 新建/编辑表单抽屉${borrowedSummary ? `（局部借鉴：${borrowedSummary}）` : ''}。`,
      `Primary navigation shell + KPI & filterable master list + structured detail/approval workspace + creation/edit drawer${borrowedSummary ? ` (borrowing: ${borrowedSummary})` : ''}.`,
    ),
    componentTone: pickLocaleText(
      locale,
      '细边框低阴影卡片（6px–8px 圆角）、语义明确的状态徽章、内联校验表单与零阻塞确认交互。',
      'Crisp 1px hairline borders, subtle 6px–8px corner radius, semantic status badges, inline validation forms, and zero blocking browser dialogs.',
    ),
    constraints: pickLocaleText(
      locale,
      '全部关键屏必须输出完整语义锚点（data-screen-id、data-element-id、data-binding、data-event-id），严禁使用 window.alert/confirm/prompt，严格对齐 SRS 领域术语。',
      'Every screen must carry semantic MU anchors (data-screen-id, data-element-id, data-binding, data-event-id), zero window.alert/confirm/prompt dialogs, and exact SRS domain terminology.',
    ),
    openNotes: pickLocaleText(
      locale,
      '默认采用桌面宽屏优先并兼容窄屏自适应；如后续补充品牌主色或专属图表组件可在画布阶段局部微调。',
      'Defaults to desktop-first responsive layout; custom brand hex overrides or specialized chart widgets can be refined on the Canvas stage.',
    ),
  };

  if (input.mode === 'rewrite') {
    const instruction = input.instruction?.trim() ?? '';
    const merged: StructuredAssistedDesignBrief = {
      positioning: readStringField(cur, 'positioning') || base.positioning,
      colorMood: readStringField(cur, 'colorMood') || base.colorMood,
      typography: readStringField(cur, 'typography') || base.typography,
      layoutDensity: readStringField(cur, 'layoutDensity') || base.layoutDensity,
      keyScreenStructure: readStringField(cur, 'keyScreenStructure') || base.keyScreenStructure,
      componentTone: readStringField(cur, 'componentTone') || base.componentTone,
      constraints: readStringField(cur, 'constraints') || base.constraints,
      openNotes: readStringField(cur, 'openNotes') || base.openNotes,
    };
    if (instruction) {
      const suffix = pickLocaleText(
        locale,
        `（已按指令调整：${instruction}）`,
        ` (Updated per instruction: ${instruction})`,
      );
      merged.colorMood = `${merged.colorMood}${suffix}`;
      if (/密度|紧凑|留白|density|compact|spacious/i.test(instruction)) {
        merged.layoutDensity = `${merged.layoutDensity}${suffix}`;
      }
      if (/字体|字号|typography|font|mono|serif/i.test(instruction)) {
        merged.typography = `${merged.typography}${suffix}`;
      }
      if (/布局|导航|结构|分栏|layout|nav|screen|split|drawer/i.test(instruction)) {
        merged.keyScreenStructure = `${merged.keyScreenStructure}${suffix}`;
      }
    }
    return merged;
  }

  if (input.mode === 'decide') {
    return {
      positioning: readStringField(cur, 'positioning') || base.positioning,
      colorMood: readStringField(cur, 'colorMood') || base.colorMood,
      typography: readStringField(cur, 'typography') || base.typography,
      layoutDensity: readStringField(cur, 'layoutDensity') || base.layoutDensity,
      keyScreenStructure: readStringField(cur, 'keyScreenStructure') || base.keyScreenStructure,
      componentTone: readStringField(cur, 'componentTone') || base.componentTone,
      constraints: readStringField(cur, 'constraints') || base.constraints,
      openNotes: pickLocaleText(
        locale,
        '已收敛全部待决设计分歧：锁定桌面双栏主从工作台、6px 圆角细边框控件、等宽数字对齐及非阻塞抽屉确认交互，可直接生成首版原型。',
        'All open design questions resolved with opinionated defaults: locked master-detail desktop shell, 6px hairline controls, tabular-nums alignment, and non-blocking drawer confirmations.',
      ),
    };
  }

  return base;
}

export async function assistProjectDesignBrief(
  store: WorkspaceStore,
  input: AssistProjectDesignBriefInput,
): Promise<AssistProjectDesignBriefResult> {
  const project = store.getProject(input.projectId);
  const effectiveProjectName =
    input.projectName?.trim() || project?.name || input.projectId || 'Project';
  const effectiveDomain = project?.domain ?? '';
  const effectiveSrsSummary =
    input.srsSummary?.trim() ||
    store.listRequirementDocs(input.projectId)[0]?.content?.slice(0, 3000) ||
    '';

  const sampleText = [input.instruction, input.srsSummary, effectiveProjectName]
    .filter(Boolean)
    .join('\n');
  const locale = resolveEffectiveLocale(store, input.locale, sampleText);

  if (isMockLlmActive(store, input.mockMode)) {
    return {
      brief: buildDeterministicMockDesignBrief(
        input,
        effectiveDomain,
        effectiveProjectName,
        effectiveSrsSummary,
        locale,
      ),
      source: 'mock',
    };
  }

  const transientSession = makeTransientSessionForProject(store, input.projectId);
  const built = buildPiModelsForStore(store, transientSession, {
    mockMode: false,
    locale,
  });

  const images = Array.isArray(input.images) ? input.images : [];
  let visionFallbackUsed = false;
  const imageBlocks: ImageContent[] = [];
  const imageNotes: string[] = [];

  for (const img of images) {
    const cleanBase64 = img.dataBase64.replace(/^data:[^;]+;base64,/, '').trim();
    const metaDesc = `[Image id=${img.imageId} role=${img.role}${img.label ? ` label="${img.label}"` : ''}]`;
    if (built.visionSupported && cleanBase64) {
      imageBlocks.push({
        type: 'image',
        data: cleanBase64,
        mimeType: img.mimeType,
      });
      imageNotes.push(metaDesc);
    } else {
      visionFallbackUsed = true;
      imageNotes.push(
        `${metaDesc} (Active model does not support vision; rely on text metadata and references)`,
      );
    }
  }

  const modeDirective =
    input.mode === 'rewrite'
      ? `Rewrite and refine the current Design Brief according to user instruction: "${input.instruction ?? ''}". Preserve unchanged strengths while applying the requested visual/structural adjustments.`
      : input.mode === 'decide'
        ? 'Resolve any ambiguities or open questions in the current Design Brief by choosing decisive, opinionated, production-grade UI/UX defaults suitable for the domain, and state the locked decisions clearly in openNotes.'
        : 'Synthesize a complete, concrete, domain-tailored UI/UX Design Brief from the SRS summary and selected visual references.';

  const promptLines = [
    `Mode: ${input.mode}`,
    `Task: ${modeDirective}`,
    `Output Language: ${locale === 'en-US' ? 'English (en-US)' : 'Simplified Chinese (zh-CN)'}`,
    `Project Name: ${effectiveProjectName}`,
    effectiveDomain ? `Domain: ${effectiveDomain}` : '',
    effectiveSrsSummary ? `SRS Summary:\n${effectiveSrsSummary.slice(0, 4000)}` : '',
    input.primaryReference
      ? `Primary Visual Reference:\n${JSON.stringify(input.primaryReference)}`
      : '',
    input.borrowedReferences && input.borrowedReferences.length > 0
      ? `Borrowed Visual References:\n${JSON.stringify(input.borrowedReferences)}`
      : '',
    input.currentBrief ? `Current Design Brief:\n${JSON.stringify(input.currentBrief)}` : '',
    input.instruction ? `User Instruction:\n${input.instruction}` : '',
    imageNotes.length > 0 ? `Attached Reference Images:\n${imageNotes.join('\n')}` : '',
    '',
    'Return ONLY a valid JSON object with these exact 8 string keys (no markdown commentary outside JSON):',
    '{"positioning":"...","colorMood":"...","typography":"...","layoutDensity":"...","keyScreenStructure":"...","componentTone":"...","constraints":"...","openNotes":"..."}',
  ]
    .filter(Boolean)
    .join('\n\n');

  const userContent: string | Array<TextContent | ImageContent> =
    imageBlocks.length > 0
      ? [{ type: 'text', text: promptLines }, ...imageBlocks]
      : promptLines;

  const stream = built.models.streamSimple(
    built.selectedModel,
    {
      systemPrompt:
        'You are the Principal Product Designer for Ontology Plus. Produce a structured UI Design Brief JSON object with exact keys: positioning, colorMood, typography, layoutDensity, keyScreenStructure, componentTone, constraints, openNotes. Every field must be a concise, actionable string grounded in the domain SRS and visual references.',
      messages: [
        {
          role: 'user',
          content: userContent,
          timestamp: Date.now(),
        },
      ],
    },
    {
      timeoutMs: 60_000,
      temperature: 0.2,
      maxTokens: 2048,
    },
  );

  let rawText = '';
  for await (const ev of stream) {
    if (ev.type === 'text_delta') {
      rawText += ev.delta;
    } else if (ev.type === 'error') {
      throw new LlmGatewayError({
        providerName: built.providerLabel,
        baseUrl: built.selectedModel.baseUrl ?? '',
        model: built.selectedModel.id,
        locale,
        message:
          ev.error.errorMessage ||
          pickLocaleText(
            locale,
            `设计简报生成请求失败 (${ev.reason})`,
            `Design brief assist request failed (${ev.reason})`,
          ),
        remediation: pickLocaleText(
          locale,
          '请在大模型中心检查网关地址、API Key 与模型可用性后重试。',
          'Verify gateway URL, API key, and model availability in LLM Center, then retry.',
        ),
      });
    }
  }

  const parsed = extractJsonObject(rawText);
  if (!parsed) {
    throw new LlmGatewayError({
      providerName: built.providerLabel,
      baseUrl: built.selectedModel.baseUrl ?? '',
      model: built.selectedModel.id,
      locale,
      message: pickLocaleText(
        locale,
        '大模型未返回有效的设计简报 JSON 结构。',
        'The LLM did not return a valid structured Design Brief JSON object.',
      ),
      remediation: pickLocaleText(
        locale,
        '请点击重试，或切换支持结构化 JSON 输出的模型。',
        'Retry or switch to a model that reliably produces structured JSON.',
      ),
    });
  }

  const fallbackCur = (input.currentBrief ?? {}) as Record<string, unknown>;
  const brief = {} as StructuredAssistedDesignBrief;
  const missingKeys: string[] = [];

  for (const key of BRIEF_KEYS) {
    const val = readStringField(parsed, key) || readStringField(fallbackCur, key);
    if (!val && key !== 'openNotes') {
      missingKeys.push(key);
    }
    brief[key] = val;
  }

  if (missingKeys.length > 0) {
    throw new LlmGatewayError({
      providerName: built.providerLabel,
      baseUrl: built.selectedModel.baseUrl ?? '',
      model: built.selectedModel.id,
      locale,
      message: pickLocaleText(
        locale,
        `设计简报 JSON 缺少必填字段：${missingKeys.join(', ')}`,
        `Design Brief JSON is missing required fields: ${missingKeys.join(', ')}`,
      ),
      remediation: pickLocaleText(
        locale,
        '请重试以重新生成完整的设计简报结构。',
        'Retry to regenerate all required Design Brief fields.',
      ),
    });
  }

  return {
    brief,
    source: 'llm',
    ...(visionFallbackUsed ? { visionFallbackUsed: true } : {}),
  };
}
