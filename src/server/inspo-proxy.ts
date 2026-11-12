import {
  CURATED_INSPO_CATALOG,
  normalizeVisualReferenceItem,
  type InspoCacheAction,
  type InspoRecommendPick,
  type RawVisualReferenceInput,
  type VisualReferenceItem,
  type WorkspaceStore,
} from '../packages/workspace-store/index.js';

export const INSPO_MCP_ENDPOINT = 'https://inspomcp.dev/api/mcp';
export const INSPO_MCP_TIMEOUT_MS = 6000;

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

export type SanitizedIndustryCategory =
  | InspoIndustry
  | 'logistics';

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
 * Privacy-safe desensitizer for Inspo `recommend(brief)`.
 *
 * Inspects optional SRS/domain hints ONLY via local pattern matching and emits
 * exclusively compile-time allowlisted English descriptors (industry category,
 * generic mood keywords, and light/dark mode). Raw SRS text, project names,
 * project codes, customer/company names, and business numbers can NEVER appear
 * in the returned object.
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

export interface InspoProxyRequestBody {
  action?: InspoCacheAction;
  query?: string;
  slug?: string;
  projectId?: string;
  docId?: string;
  domain?: string;
  srsText?: string;
  projectName?: string;
  projectCode?: string;
  brief?: string;
  mode?: 'light' | 'dark' | string;
  style?: string;
  industry?: string;
  macrostructure?: string;
  vibe?: string;
  moodKeywords?: string[];
}

export interface InspoProxyResponse {
  ok: boolean;
  source: 'live' | 'cache' | 'curated';
  fallback?: boolean;
  attributedTo: 'Inspo';
  items?: VisualReferenceItem[];
  pick?: InspoRecommendPick;
  slug?: string;
  markdown?: string;
  filters?: Record<string, unknown>;
  sanitizedBrief?: {
    industry: string;
    vibe: string;
    mode: 'light' | 'dark';
    keywords: string[];
  };
  warning?: string;
}

const ZH_SEARCH_HINTS: [RegExp, string][] = [
  [/清爽|简洁|极简|白底/, 'clean minimalist light workspace'],
  [/暖|纸|知识|文档|杂志/, 'warm paper editorial calm'],
  [/深色|暗黑|监控|大屏|科技/, 'dark developer analytics console'],
  [/金融|银行|台账|财务|合同|严谨/, 'enterprise fintech banking ledger serious'],
  [/卡片|模块|看板/, 'modular bento grid dashboard'],
  [/电商|零售|商品/, 'ecommerce catalogue clean'],
  [/医疗|健康/, 'health clean calm'],
  [/教育|课程|培训/, 'education calm warm'],
  [/物流|供应链|调度/, 'operations logistics dashboard tabular'],
];

function enrichSearchQuery(rawQuery: string): string {
  let enriched = rawQuery.trim().slice(0, 120);
  for (const [pattern, enWords] of ZH_SEARCH_HINTS) {
    if (pattern.test(enriched)) {
      enriched = `${enriched} ${enWords}`.trim();
    }
  }
  return enriched || 'clean modern SaaS product interface';
}

function dedupeAndNormalizeScreens(rows: RawVisualReferenceInput[], limit = 8): VisualReferenceItem[] {
  const seenRoots = new Set<string>();
  const normalized: VisualReferenceItem[] = [];
  for (const row of rows) {
    if (!row || typeof row.slug !== 'string' || !row.slug.trim()) continue;
    const root = row.slug.split('--')[0]!.toLowerCase();
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);
    normalized.push(normalizeVisualReferenceItem(row));
    if (normalized.length >= limit) break;
  }
  return normalized;
}

function selectCuratedFallbackItems(opts: {
  mode?: 'light' | 'dark';
  industry?: string;
  query?: string;
}): VisualReferenceItem[] {
  const q = `${opts.industry ?? ''} ${opts.query ?? ''}`.toLowerCase();
  const scored = CURATED_INSPO_CATALOG.map((item) => {
    let score = 0;
    if (opts.mode && item.mode === opts.mode) score += 3;
    if (opts.industry && item.tags?.toLowerCase().includes(opts.industry.toLowerCase())) score += 4;
    if (/fintech|金融|财务|合同|结算|台账/.test(q) && item.vibeGroup === 'fintech') score += 4;
    if (/warm|paper|暖|纸|文档/.test(q) && item.vibeGroup === 'warm-paper') score += 4;
    if (/dark|深色|监控|大屏/.test(q) && item.vibeGroup === 'dark-tech') score += 4;
    if (/bento|卡片|看板/.test(q) && item.vibeGroup === 'bento') score += 4;
    if (
      q.trim() &&
      `${item.title} ${item.plainLabelZh} ${item.plainLabelEn} ${item.tags ?? ''}`
        .toLowerCase()
        .includes(q.trim())
    ) {
      score += 5;
    }
    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 8).map((entry) => entry.item);
}

function buildCuratedDesignSystemMarkdown(slug: string): string {
  const item =
    CURATED_INSPO_CATALOG.find((c) => c.slug === slug) ??
    normalizeVisualReferenceItem({ slug });
  return [
    `# ${item.title} — Extracted Design System`,
    '',
    `- **Source**: ${item.sourceUrl}`,
    `- **Mode**: ${item.mode}`,
    `- **Surface**: \`${item.surfaceHex}\``,
    `- **Macrostructure**: \`${item.macro}\``,
    `- **Border Radius**: \`${item.radiusPx}px\``,
    `- **Fonts**: ${item.fonts.join(', ')}`,
    `- **Palette**: ${item.palette.map((p) => `\`${p}\``).join(', ')}`,
    `- **Northstar**: ${item.northstar}`,
  ].join('\n');
}

export async function handleInspoProxyRequest(
  store: WorkspaceStore,
  rawBody: InspoProxyRequestBody = {},
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<InspoProxyResponse> {
  const action: InspoCacheAction =
    rawBody.action === 'recommend' ||
    rawBody.action === 'design_system' ||
    rawBody.action === 'filters' ||
    rawBody.action === 'similar'
      ? rawBody.action
      : 'search';

  if (action === 'filters') {
    const cacheKey = 'inspo:filters:v1';
    const cached = store.getInspoCache(cacheKey);
    if (cached?.filters) {
      return {
        ok: true,
        source: 'cache',
        attributedTo: 'Inspo',
        filters: cached.filters,
      };
    }

    try {
      const rawText = await callInspoMcpTool(fetchFn, 'get_filters', {});
      const parsedFilters = JSON.parse(rawText) as Record<string, unknown>;
      const saved = store.saveInspoCache({
        cacheKey,
        action: 'filters',
        filters: parsedFilters,
      });
      return {
        ok: true,
        source: 'live',
        attributedTo: 'Inspo',
        filters: saved.filters ?? DEFAULT_INSPO_FILTERS,
      };
    } catch (err) {
      return {
        ok: true,
        fallback: true,
        source: 'curated',
        attributedTo: 'Inspo',
        filters: DEFAULT_INSPO_FILTERS,
        warning: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (action === 'design_system') {
    const slug = String(rawBody.slug || CURATED_INSPO_CATALOG[0]!.slug).trim();
    const cacheKey = `inspo:design_system:${slug}`;
    const cached = store.getInspoCache(cacheKey);
    if (cached?.markdown) {
      return {
        ok: true,
        source: 'cache',
        attributedTo: 'Inspo',
        slug,
        markdown: cached.markdown,
      };
    }

    try {
      const rawText = await callInspoMcpTool(fetchFn, 'get_design_system', {
        slug,
        live: false,
      });
      if (!rawText.trim()) {
        throw new Error('Empty DESIGN.md response from Inspo MCP');
      }
      const saved = store.saveInspoCache({
        cacheKey,
        action: 'design_system',
        slug,
        markdown: rawText,
      });
      return {
        ok: true,
        source: 'live',
        attributedTo: 'Inspo',
        slug,
        markdown: saved.markdown ?? rawText,
      };
    } catch (err) {
      return {
        ok: true,
        fallback: true,
        source: 'curated',
        attributedTo: 'Inspo',
        slug,
        markdown: buildCuratedDesignSystemMarkdown(slug),
        warning: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (action === 'recommend') {
    let serverDomain = rawBody.domain;
    let serverSrsText = rawBody.srsText;
    if (rawBody.projectId) {
      const proj = store.getProject(rawBody.projectId);
      if (proj && !serverDomain) {
        serverDomain = proj.domain;
      }
      if (!serverSrsText) {
        const docs = store.listRequirementDocs(rawBody.projectId);
        const targetDoc = rawBody.docId
          ? docs.find((d) => d.id === rawBody.docId) ?? docs[0]
          : docs[0];
        if (targetDoc) {
          serverSrsText = targetDoc.content;
        }
      }
    }

    const sanitized = buildSanitizedRecommendBrief({
      ...(serverDomain ? { domain: serverDomain } : {}),
      ...(serverSrsText ? { srsText: serverSrsText } : {}),
      ...(rawBody.brief ? { brief: rawBody.brief } : {}),
      ...(rawBody.industry ? { industry: rawBody.industry } : {}),
      ...(rawBody.vibe ? { vibe: rawBody.vibe } : {}),
      ...(rawBody.style ? { style: rawBody.style } : {}),
      ...(rawBody.mode ? { mode: rawBody.mode } : {}),
      ...(rawBody.moodKeywords ? { moodKeywords: rawBody.moodKeywords } : {}),
    });

    const cacheKey = `inspo:recommend:${sanitized.industry}:${sanitized.mode}:${sanitized.vibe}:${sanitized.style ?? ''}:${sanitized.keywords.join(',')}`;
    const cached = store.getInspoCache(cacheKey);
    if (cached?.items && cached.items.length > 0) {
      return {
        ok: true,
        source: 'cache',
        attributedTo: 'Inspo',
        items: cached.items,
        ...(cached.pick ? { pick: cached.pick } : {}),
        sanitizedBrief: {
          industry: sanitized.industry,
          vibe: sanitized.vibe,
          mode: sanitized.mode,
          keywords: sanitized.keywords,
        },
      };
    }

    const toolArgs: Record<string, unknown> = {
      brief: sanitized.brief,
      mode: sanitized.mode,
      industry: sanitized.mcpIndustry,
      vibe: sanitized.vibe,
      ...(sanitized.style ? { style: sanitized.style } : {}),
      limit: 8,
    };

    try {
      const rawText = await callInspoMcpTool(fetchFn, 'recommend', toolArgs);
      const parsed = JSON.parse(rawText) as {
        exemplars?: RawVisualReferenceInput[];
        shortlist?: { exemplars?: RawVisualReferenceInput[] }[];
        pick?: InspoRecommendPick;
      };
      const exemplarRows =
        Array.isArray(parsed.exemplars) && parsed.exemplars.length > 0
          ? parsed.exemplars
          : (parsed.shortlist ?? []).flatMap((s) => s.exemplars ?? []);
      const items = dedupeAndNormalizeScreens(exemplarRows, 8);
      if (items.length === 0) {
        throw new Error('No exemplars returned by Inspo recommend');
      }

      const saved = store.saveInspoCache({
        cacheKey,
        action: 'recommend',
        items,
        ...(parsed.pick ? { pick: parsed.pick } : {}),
      });

      return {
        ok: true,
        source: 'live',
        attributedTo: 'Inspo',
        items: saved.items ?? items,
        ...(saved.pick ? { pick: saved.pick } : {}),
        sanitizedBrief: {
          industry: sanitized.industry,
          vibe: sanitized.vibe,
          mode: sanitized.mode,
          keywords: sanitized.keywords,
        },
      };
    } catch (err) {
      return {
        ok: true,
        fallback: true,
        source: 'curated',
        attributedTo: 'Inspo',
        items: selectCuratedFallbackItems({
          mode: sanitized.mode,
          industry: sanitized.industry,
        }),
        sanitizedBrief: {
          industry: sanitized.industry,
          vibe: sanitized.vibe,
          mode: sanitized.mode,
          keywords: sanitized.keywords,
        },
        warning: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (action === 'similar') {
    const slug = String(rawBody.slug || CURATED_INSPO_CATALOG[0]!.slug).trim();
    const cacheKey = `inspo:similar:${slug}`;
    const cached = store.getInspoCache(cacheKey);
    if (cached?.items && cached.items.length > 0) {
      return {
        ok: true,
        source: 'cache',
        attributedTo: 'Inspo',
        items: cached.items,
      };
    }

    try {
      const rawText = await callInspoMcpTool(fetchFn, 'find_similar', { slug, limit: 6 });
      const parsed = JSON.parse(rawText) as {
        neighbours?: RawVisualReferenceInput[];
        results?: RawVisualReferenceInput[];
      };
      const items = dedupeAndNormalizeScreens(parsed.neighbours ?? parsed.results ?? [], 8);
      if (items.length === 0) {
        throw new Error('No similar references returned');
      }
      const saved = store.saveInspoCache({
        cacheKey,
        action: 'similar',
        slug,
        items,
      });
      return {
        ok: true,
        source: 'live',
        attributedTo: 'Inspo',
        items: saved.items ?? items,
      };
    } catch (err) {
      return {
        ok: true,
        fallback: true,
        source: 'curated',
        attributedTo: 'Inspo',
        items: selectCuratedFallbackItems({ query: slug }),
        warning: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Default action: 'search'
  const enrichedQuery = enrichSearchQuery(rawBody.query ?? '');
  const mode =
    rawBody.mode === 'light' || rawBody.mode === 'dark' ? rawBody.mode : undefined;
  const style = isAllowedEnum(VALID_INSPO_STYLES, rawBody.style)
    ? rawBody.style.trim().toLowerCase()
    : undefined;
  const industry = isAllowedEnum(VALID_INSPO_INDUSTRIES, rawBody.industry)
    ? rawBody.industry.trim().toLowerCase()
    : undefined;
  const macrostructure = isAllowedEnum(VALID_INSPO_MACROSTRUCTURES, rawBody.macrostructure)
    ? rawBody.macrostructure.trim().toLowerCase()
    : undefined;
  const vibe = isAllowedEnum(VALID_INSPO_VIBES, rawBody.vibe)
    ? rawBody.vibe.trim().toLowerCase()
    : undefined;

  const cacheKey = `inspo:search:${JSON.stringify({
    q: enrichedQuery,
    mode: mode ?? '',
    style: style ?? '',
    industry: industry ?? '',
    macrostructure: macrostructure ?? '',
    vibe: vibe ?? '',
  })}`;

  const cached = store.getInspoCache(cacheKey);
  if (cached?.items && cached.items.length > 0) {
    return {
      ok: true,
      source: 'cache',
      attributedTo: 'Inspo',
      items: cached.items,
    };
  }

  const toolArgs: Record<string, unknown> = {
    query: enrichedQuery,
    limit: 14,
    detail: 'concise',
    ...(mode ? { mode } : {}),
    ...(style ? { style } : {}),
    ...(industry ? { industry } : {}),
    ...(macrostructure ? { macrostructure } : {}),
    ...(vibe ? { vibe } : {}),
  };

  try {
    const rawText = await callInspoMcpTool(fetchFn, 'search_screens', toolArgs);
    const parsed = JSON.parse(rawText) as {
      results?: RawVisualReferenceInput[];
      exemplars?: RawVisualReferenceInput[];
    };
    const items = dedupeAndNormalizeScreens(parsed.results ?? parsed.exemplars ?? [], 8);
    if (items.length === 0) {
      return {
        ok: true,
        fallback: true,
        source: 'curated',
        attributedTo: 'Inspo',
        items: selectCuratedFallbackItems({
          ...(mode ? { mode } : {}),
          ...(industry ? { industry } : {}),
          ...(rawBody.query ? { query: rawBody.query } : {}),
        }),
      };
    }

    const saved = store.saveInspoCache({
      cacheKey,
      action: 'search',
      items,
    });
    return {
      ok: true,
      source: 'live',
      attributedTo: 'Inspo',
      items: saved.items ?? items,
    };
  } catch (err) {
    return {
      ok: true,
      fallback: true,
      source: 'curated',
      attributedTo: 'Inspo',
      items: selectCuratedFallbackItems({
        ...(mode ? { mode } : {}),
        ...(industry ? { industry } : {}),
        ...(rawBody.query ? { query: rawBody.query } : {}),
      }),
      warning: err instanceof Error ? err.message : String(err),
    };
  }
}

async function callInspoMcpTool(
  fetchFn: typeof fetch,
  toolName: string,
  toolArgs: Record<string, unknown>,
): Promise<string> {
  const upstream = await fetchFn(INSPO_MCP_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: toolName, arguments: toolArgs },
    }),
    signal: AbortSignal.timeout(INSPO_MCP_TIMEOUT_MS),
  });

  if (!upstream.ok) {
    throw new Error(`Inspo MCP HTTP ${upstream.status}`);
  }

  const rpc = (await upstream.json()) as {
    error?: { message?: string };
    result?: { content?: { type: string; text?: string }[] };
  };
  if (rpc.error?.message) {
    throw new Error(`Inspo MCP RPC error: ${rpc.error.message}`);
  }
  return rpc.result?.content?.[0]?.text ?? '';
}
