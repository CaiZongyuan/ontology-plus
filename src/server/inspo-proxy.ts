import {
  DEFAULT_INSPO_FILTERS,
  VALID_INSPO_INDUSTRIES,
  VALID_INSPO_MACROSTRUCTURES,
  VALID_INSPO_STYLES,
  VALID_INSPO_VIBES,
  buildSanitizedRecommendBrief,
  desensitizeRecommendBriefWithAgent,
  type InspoIndustry,
  type InspoMacrostructure,
  type InspoStyle,
  type InspoVibe,
  type SanitizedIndustryCategory,
  type SanitizedMoodKeyword,
  type SanitizedRecommendBrief,
  type SanitizedRecommendInput,
} from '../packages/agent-runtime/index.js';
import {
  CURATED_INSPO_CATALOG,
  normalizeVisualReferenceItem,
  type InspoRecommendPick,
  type RawVisualReferenceInput,
  type VisualReferenceItem,
  type WorkspaceStore,
} from '../packages/workspace-store/index.js';

export {
  DEFAULT_INSPO_FILTERS,
  VALID_INSPO_INDUSTRIES,
  VALID_INSPO_MACROSTRUCTURES,
  VALID_INSPO_STYLES,
  VALID_INSPO_VIBES,
  buildSanitizedRecommendBrief,
  desensitizeRecommendBriefWithAgent,
  type InspoIndustry,
  type InspoMacrostructure,
  type InspoStyle,
  type InspoVibe,
  type SanitizedIndustryCategory,
  type SanitizedMoodKeyword,
  type SanitizedRecommendBrief,
  type SanitizedRecommendInput,
};

export const INSPO_MCP_ENDPOINT = 'https://inspomcp.dev/api/mcp';
export const INSPO_MCP_TIMEOUT_MS = 6000;
/** Upstream `search_screens` caps `limit` at 20; we ask for all of it and keep one screen per site. */
export const INSPO_SEARCH_LIMIT = 20;
/** Curated picks returned when the live archive is unreachable. */
export const INSPO_CURATED_FALLBACK_LIMIT = 24;

export type SupportedInspoAction = 'search' | 'recommend' | 'design_system' | 'filters';

function isAllowedEnum<T extends string>(list: readonly T[], val: unknown): val is T {
  return typeof val === 'string' && (list as readonly string[]).includes(val.trim().toLowerCase());
}

export interface InspoProxyRequestBody {
  action?: SupportedInspoAction | string;
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

function dedupeAndNormalizeScreens(
  rows: RawVisualReferenceInput[],
  limit = INSPO_SEARCH_LIMIT,
): VisualReferenceItem[] {
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
  return scored.slice(0, INSPO_CURATED_FALLBACK_LIMIT).map((entry) => entry.item);
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
  if (rawBody.action === 'similar') {
    const err = new Error('Unsupported Inspo action: similar') as Error & {
      code?: string;
      status?: number;
    };
    err.code = 'UNSUPPORTED_INSPO_ACTION';
    err.status = 400;
    throw err;
  }

  const action: SupportedInspoAction =
    rawBody.action === 'recommend' ||
    rawBody.action === 'design_system' ||
    rawBody.action === 'filters'
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
    let serverProjectName = rawBody.projectName;
    let serverProjectCode = rawBody.projectCode;
    if (rawBody.projectId) {
      const proj = store.getProject(rawBody.projectId);
      if (proj) {
        if (!serverDomain) serverDomain = proj.domain;
        if (!serverProjectName) serverProjectName = proj.name;
        if (!serverProjectCode) serverProjectCode = proj.code;
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

    const recommendInput: SanitizedRecommendInput & { projectId?: string } = {
      ...(rawBody.projectId ? { projectId: rawBody.projectId } : {}),
      ...(serverDomain ? { domain: serverDomain } : {}),
      ...(serverSrsText ? { srsText: serverSrsText } : {}),
      ...(serverProjectName ? { projectName: serverProjectName } : {}),
      ...(serverProjectCode ? { projectCode: serverProjectCode } : {}),
      ...(rawBody.brief ? { brief: rawBody.brief } : {}),
      ...(rawBody.industry ? { industry: rawBody.industry } : {}),
      ...(rawBody.vibe ? { vibe: rawBody.vibe } : {}),
      ...(rawBody.style ? { style: rawBody.style } : {}),
      ...(rawBody.mode ? { mode: rawBody.mode } : {}),
      ...(rawBody.moodKeywords ? { moodKeywords: rawBody.moodKeywords } : {}),
    };

    const baseline = buildSanitizedRecommendBrief(recommendInput);
    const cacheKey = `inspo:recommend:${baseline.industry}:${baseline.mode}:${baseline.vibe}:${baseline.style ?? ''}:${baseline.keywords.join(',')}`;
    const cached = store.getInspoCache(cacheKey);
    if (cached?.items && cached.items.length > 0) {
      return {
        ok: true,
        source: 'cache',
        attributedTo: 'Inspo',
        items: cached.items,
        ...(cached.pick ? { pick: cached.pick } : {}),
        sanitizedBrief: {
          industry: baseline.industry,
          vibe: baseline.vibe,
          mode: baseline.mode,
          keywords: baseline.keywords,
        },
      };
    }

    const sanitized = await desensitizeRecommendBriefWithAgent(store, recommendInput);

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
      const items = dedupeAndNormalizeScreens(exemplarRows);
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

  const cacheKey = `inspo:search:v2:${JSON.stringify({
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
    limit: INSPO_SEARCH_LIMIT,
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
    const items = dedupeAndNormalizeScreens(parsed.results ?? parsed.exemplars ?? []);
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
