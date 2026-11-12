export const INSPO_CDN_BASE =
  'https://0nme3pk5am3urwa9.public.blob.vercel-storage.com/captures';

export type VisualReferenceVibeGroup =
  | 'clean-saas'
  | 'warm-paper'
  | 'dark-tech'
  | 'fintech'
  | 'bento';

export interface VisualReferenceItem {
  slug: string;
  title: string;
  sourceDomain: string;
  sourceUrl: string;
  heroUrl: string;
  fullPageUrl: string;
  thumbUrl: string;
  mobileUrl: string;
  vibeGroup: VisualReferenceVibeGroup;
  plainLabelZh: string;
  plainLabelEn: string;
  plainDescZh: string;
  plainDescEn: string;
  northstar: string;
  palette: string[];
  surfaceHex: string;
  fonts: string[];
  mode: 'light' | 'dark';
  macro: string;
  radiusPx: number;
  tags?: string;
}

export type InspoCacheAction =
  | 'recommend'
  | 'search'
  | 'design_system'
  | 'filters'
  | 'similar';

export interface InspoRecommendPick {
  macrostructure?: {
    slug: string;
    label: string;
  };
  rationale?: string;
}

export interface InspoCacheEntry {
  cacheKey: string;
  action: InspoCacheAction;
  slug?: string;
  items?: VisualReferenceItem[];
  pick?: InspoRecommendPick;
  markdown?: string;
  filters?: Record<string, unknown>;
  updatedAt: string;
}

export type InspoCacheEntryInput = Omit<InspoCacheEntry, 'updatedAt'> & {
  updatedAt?: string;
};

export function inspoHeroUrl(slug: string): string {
  return `${INSPO_CDN_BASE}/${slug}/hero.1440.webp`;
}

export function inspoFullUrl(slug: string): string {
  return `${INSPO_CDN_BASE}/${slug}/full.1440.webp`;
}

export function inspoThumbUrl(slug: string): string {
  return `${INSPO_CDN_BASE}/${slug}/thumb.384.webp`;
}

export function inspoMobileUrl(slug: string): string {
  return `${INSPO_CDN_BASE}/${slug}/mobile.384.webp`;
}

const TWO_PART_TLD_SUFFIXES = [
  'co-uk',
  'org-uk',
  'com-au',
  'co-jp',
  'co-kr',
  'com-cn',
  'com-br',
  'co-nz',
  'co-in',
];

function isRemoteHttpUrl(candidate: unknown): candidate is string {
  if (typeof candidate !== 'string') return false;
  const trimmed = candidate.trim();
  if (!trimmed || /^data:/i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function deriveSourceSiteFromSlug(
  slug: string,
  explicitSourceUrl?: string,
): { sourceDomain: string; sourceUrl: string } {
  if (isRemoteHttpUrl(explicitSourceUrl)) {
    const parsed = new URL(explicitSourceUrl.trim());
    const sourceDomain = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    return {
      sourceDomain,
      sourceUrl: parsed.toString().replace(/\/$/, () => (parsed.pathname === '/' ? '' : '/')),
    };
  }

  const root = (slug.split('--')[0] || slug).trim().toLowerCase();
  let domain = root;

  const matchedTwoPart = TWO_PART_TLD_SUFFIXES.find((tld) => root.endsWith(`-${tld}`));
  if (matchedTwoPart) {
    const prefix = root.slice(0, root.length - matchedTwoPart.length - 1);
    if (prefix) {
      domain = `${prefix}.${matchedTwoPart.replace('-', '.')}`;
    }
  } else {
    const lastHyphen = root.lastIndexOf('-');
    if (lastHyphen > 0 && lastHyphen < root.length - 1) {
      domain = `${root.slice(0, lastHyphen)}.${root.slice(lastHyphen + 1)}`;
    } else if (root && !root.includes('.')) {
      domain = `${root}.com`;
    }
  }

  return {
    sourceDomain: domain,
    sourceUrl: `https://${domain}`,
  };
}

interface CuratedSeedItem {
  slug: string;
  title: string;
  vibeGroup: VisualReferenceVibeGroup;
  plainLabelZh: string;
  plainLabelEn: string;
  plainDescZh: string;
  plainDescEn: string;
  northstar: string;
  palette: string[];
  surfaceHex: string;
  fonts: string[];
  mode: 'light' | 'dark';
  macro: string;
  radiusPx: number;
  tags?: string;
}

function buildCuratedItem(seed: CuratedSeedItem): VisualReferenceItem {
  const { sourceDomain, sourceUrl } = deriveSourceSiteFromSlug(seed.slug);
  return {
    ...seed,
    sourceDomain,
    sourceUrl,
    heroUrl: inspoHeroUrl(seed.slug),
    fullPageUrl: inspoFullUrl(seed.slug),
    thumbUrl: inspoThumbUrl(seed.slug),
    mobileUrl: inspoMobileUrl(seed.slug),
  };
}

export const CURATED_INSPO_CATALOG: VisualReferenceItem[] = [
  buildCuratedItem({
    slug: 'amie-so',
    title: 'Amie',
    vibeGroup: 'clean-saas',
    plainLabelZh: '清爽白底 · 现代高效协同台',
    plainLabelEn: 'Crisp White · Modern Productivity',
    plainDescZh: '干净明亮的纯白底色搭配天蓝主按钮与暖黄标记，适合高频日常办公与台账管理',
    plainDescEn: 'Clean white canvas with sky-blue primary CTAs and warm highlight accents',
    northstar: 'Crisp sans-serif clarity, spacious and focused digital canvas.',
    palette: ['#14a4fc', '#d6950e', '#84d1fb', '#946c5c', '#cccee1'],
    surfaceHex: '#f7f9fc',
    fonts: ['Inter var', 'Inter'],
    mode: 'light',
    macro: 'feature-stack',
    radiusPx: 10,
    tags: 'saas, productivity, clean, light',
  }),
  buildCuratedItem({
    slug: 'cleanshot-com',
    title: 'CleanShot',
    vibeGroup: 'clean-saas',
    plainLabelZh: '极简留白 · 科技蓝工具感',
    plainLabelEn: 'Airy Minimal · Crisp Blue Utility',
    plainDescZh: '宽敞通透的浅灰白背景配高识别度科技蓝胶囊按钮，层级分明、零视觉杂乱',
    plainDescEn: 'Geometric sans-serif, pill lozenges, and generous breathing room',
    northstar: 'Crisp, cool tech - clean sans-serif, expansive white space.',
    palette: ['#0f71fa', '#1f7559', '#cddffb', '#4bad9e', '#e2e8f0'],
    surfaceHex: '#f5f8fc',
    fonts: ['Inter', 'system-ui'],
    mode: 'light',
    macro: 'split-studio',
    radiusPx: 12,
    tags: 'developer-tools, minimal, clean, light',
  }),
  buildCuratedItem({
    slug: 'capacities-io',
    title: 'Capacities',
    vibeGroup: 'clean-saas',
    plainLabelZh: '柔和薄荷 · 平静知识工作台',
    plainLabelEn: 'Calm Mint · Knowledge Studio',
    plainDescZh: '护眼微暖浅绿灰底色与低饱和薄荷绿点缀，长时间录入与审阅不易视觉疲劳',
    plainDescEn: 'Soft mint accents and calm structured cards for long review sessions',
    northstar: 'Calm structured studio with gentle emerald-mint accents.',
    palette: ['#22624d', '#6cccac', '#f9d274', '#a18085', '#e5ece9'],
    surfaceHex: '#f3f7f5',
    fonts: ['Inter', 'ui-sans-serif'],
    mode: 'light',
    macro: 'split-studio',
    radiusPx: 10,
    tags: 'saas, education, calm, warm, light',
  }),
  buildCuratedItem({
    slug: 'increase-com',
    title: 'Increase',
    vibeGroup: 'fintech',
    plainLabelZh: '严谨账务 · 银行级高密度台账',
    plainLabelEn: 'Enterprise Ledger · Banking Precision',
    plainDescZh: '克制的冷白底色配深海蓝与精细表格分割线，极适合合同、财务、清结算等严肃业务',
    plainDescEn: 'High-trust banking precision with crisp borders and tabular alignment',
    northstar: 'Enterprise-grade banking clarity and structured tabular hierarchy.',
    palette: ['#04b2f2', '#1d445a', '#34bcfc', '#646c7a', '#dbe4ec'],
    surfaceHex: '#f4f7fa',
    fonts: ['IBM Plex Sans', 'Inter'],
    mode: 'light',
    macro: 'index-first',
    radiusPx: 6,
    tags: 'fintech, serious, high-density, tabular, light',
  }),
  buildCuratedItem({
    slug: 'polar-sh',
    title: 'Polar',
    vibeGroup: 'fintech',
    plainLabelZh: '冷峻蓝灰 · 现代计费与结算风',
    plainLabelEn: 'Cool Slate · Modern Billing Ops',
    plainDescZh: '微冷冰蓝灰底色配深靛蓝墨色，兼顾现代科技感与企业级数据可信度',
    plainDescEn: 'Subtle ice-slate surfaces with calm indigo-slate accents',
    northstar: 'Billing platform clarity with refined slate-indigo contrast.',
    palette: ['#5170ad', '#151d2d', '#747484', '#9ab0d8', '#eef3f8'],
    surfaceHex: '#eef3f8',
    fonts: ['Inter', 'system-ui'],
    mode: 'light',
    macro: 'stat-led',
    radiusPx: 8,
    tags: 'fintech, developer-tools, billing, tabular, light',
  }),
  buildCuratedItem({
    slug: 'brex-com',
    title: 'Brex',
    vibeGroup: 'fintech',
    plainLabelZh: '活力橙点缀 · 企业审批与费控风',
    plainLabelEn: 'Executive Warmth · Spend & Approval',
    plainDescZh: '温润中性暖灰底色搭配醒目的橙色待办/审批主按钮，关键行动点一目了然',
    plainDescEn: 'Clean neutral enterprise tables anchored by decisive warm-orange CTAs',
    northstar: 'Decisive corporate finance workflow with high-visibility action cues.',
    palette: ['#fc5c04', '#663c2c', '#f89a64', '#7c7c84', '#ecebe8'],
    surfaceHex: '#f5f4f1',
    fonts: ['Inter', 'sans-serif'],
    mode: 'light',
    macro: 'feature-stack',
    radiusPx: 8,
    tags: 'fintech, saas, serious, warm, tabular, light',
  }),
  buildCuratedItem({
    slug: 'effectivealtruism-org',
    title: 'Effective Altruism',
    vibeGroup: 'warm-paper',
    plainLabelZh: '温润暖纸 · 书卷感文档审批台',
    plainLabelEn: 'Warm Paper · Editorial Document Desk',
    plainDescZh: '柔和米白纸张背景（#fcf8f4）配衬线标题与深青蓝墨色，适合重阅读、重条款审阅场景',
    plainDescEn: 'Warm cream paper surface (#fcf8f4) with editorial serif headings',
    northstar: 'Warm paper ground paired with deep Prussian blue and serif authority.',
    palette: ['#315e7b', '#13384d', '#ac9466', '#fcf8f4', '#e4ddd2'],
    surfaceHex: '#fcf8f4',
    fonts: ['Georgia', 'Noto Serif SC', 'Inter'],
    mode: 'light',
    macro: 'long-document',
    radiusPx: 6,
    tags: 'warm, editorial, calm, education, health, light',
  }),
  buildCuratedItem({
    slug: 'wallpaper-com',
    title: 'Wallpaper*',
    vibeGroup: 'warm-paper',
    plainLabelZh: '琥珀金棕 · 典雅杂志级排版',
    plainLabelEn: 'Editorial Amber · Magazine Grid',
    plainDescZh: '亚麻暖米色背景配利落线条网格与琥珀金强调色，让枯燥表单呈现出版物般质感',
    plainDescEn: 'Crisp hairline rules, serif headlines, and warm amber highlights',
    northstar: 'Editorial grid discipline with warm ochre-amber accents.',
    palette: ['#d29a1e', '#765a18', '#f7c97a', '#ae8860', '#efeae1'],
    surfaceHex: '#f6f2ea',
    fonts: ['Palatino', 'Noto Serif SC', 'sans-serif'],
    mode: 'light',
    macro: 'editorial',
    radiusPx: 4,
    tags: 'warm, editorial, ecommerce, media, light',
  }),
  buildCuratedItem({
    slug: 'tinybird-co',
    title: 'Tinybird',
    vibeGroup: 'dark-tech',
    plainLabelZh: '深邃黑绿 · 实时监控与风控大屏',
    plainLabelEn: 'Dark Emerald · Live Ops Cockpit',
    plainDescZh: '低眩光深灰黑背景配高对比荧光绿状态指示，适合高频数据监控、调度与预警大屏',
    plainDescEn: 'Low-glare dark console with high-contrast emerald status telemetry',
    northstar: 'Focused dark data cockpit with crisp emerald signal highlights.',
    palette: ['#24f494', '#1a6240', '#80f8c1', '#848484', '#141817'],
    surfaceHex: '#101514',
    fonts: ['IBM Plex Sans', 'Roboto'],
    mode: 'dark',
    macro: 'stat-led',
    radiusPx: 8,
    tags: 'developer-tools, logistics, technical, high-density, dark',
  }),
  buildCuratedItem({
    slug: 'digitalocean-com',
    title: 'DigitalOcean',
    vibeGroup: 'dark-tech',
    plainLabelZh: '深海夜航 · 沉稳运维与资源中台',
    plainLabelEn: 'Deep Navy · Cloud Ops Console',
    plainDescZh: '柔和深海藏蓝背景卡片配青蓝操作按钮，比纯黑更柔和耐看、层次清晰',
    plainDescEn: 'Layered deep-navy cards with calm cyan-blue operational controls',
    northstar: 'Deep ocean slate console with approachable cyan accents.',
    palette: ['#31bacd', '#144c54', '#b4d4dc', '#648c90', '#0f172a'],
    surfaceHex: '#0c1425',
    fonts: ['Plus Jakarta Sans', 'Inter'],
    mode: 'dark',
    macro: 'split-studio',
    radiusPx: 10,
    tags: 'developer-tools, technical, calm, dark',
  }),
  buildCuratedItem({
    slug: 'algolia-com',
    title: 'Algolia',
    vibeGroup: 'dark-tech',
    plainLabelZh: '靛蓝夜幕 · 高速检索与智能工作台',
    plainLabelEn: 'Indigo Night · Search & AI Console',
    plainDescZh: '深靛蓝夜幕背景搭配明亮宝蓝主按钮，科技感与专业度兼具',
    plainDescEn: 'Deep indigo architecture with electric royal-blue primary actions',
    northstar: 'Deep indigo expanse, clean sans-serif precision, focused digital architecture.',
    palette: ['#205df9', '#8eabfb', '#a9bbd6', '#99694d', '#090d24'],
    surfaceHex: '#090d24',
    fonts: ['Inter', 'system-ui'],
    mode: 'dark',
    macro: 'feature-stack',
    radiusPx: 10,
    tags: 'ai, developer-tools, technical, dark',
  }),
  buildCuratedItem({
    slug: 'daybridge-com',
    title: 'Daybridge',
    vibeGroup: 'bento',
    plainLabelZh: '模块化便当盒 · 多维看板分区风',
    plainLabelEn: 'Bento Cards · Modular Dashboard',
    plainDescZh: '柔和浅云灰背景配圆润分块卡片（Bento Grid），把指标、待办和明细分区收纳',
    plainDescEn: 'Modular bento-box cards organizing KPIs, queues, and tables cleanly',
    northstar: 'Friendly modular bento layout with sky-blue clarity.',
    palette: ['#3494f4', '#06427d', '#a9daf5', '#9d6c68', '#f1f5f9'],
    surfaceHex: '#f1f5f9',
    fonts: ['Inter', 'system-ui'],
    mode: 'light',
    macro: 'bento-grid',
    radiusPx: 14,
    tags: 'saas, ecommerce, health, modular, clean, light',
  }),
];

export interface RawVisualReferenceInput {
  slug: string;
  title?: string;
  sourceUrl?: string;
  sourceDomain?: string;
  heroUrl?: string;
  image?: string;
  fullPageUrl?: string;
  fullPage?: string;
  thumbUrl?: string;
  thumb?: string;
  mobileUrl?: string;
  mobile?: string;
  vibeGroup?: VisualReferenceVibeGroup;
  plainLabelZh?: string;
  plainLabelEn?: string;
  plainDescZh?: string;
  plainDescEn?: string;
  northstar?: string;
  palette?: string[];
  surfaceHex?: string;
  fonts?: string[];
  mode?: string;
  macro?: string;
  radiusPx?: number;
  tags?: string;
}

function inferVibeGroup(
  mode: 'light' | 'dark',
  macro: string,
  tags: string,
): VisualReferenceVibeGroup {
  if (mode === 'dark') return 'dark-tech';
  if (macro === 'bento-grid') return 'bento';
  if (/fintech|bank|billing|ledger|finance/i.test(tags) || macro === 'index-first') {
    return 'fintech';
  }
  if (/editorial|warm|paper|magazine/i.test(tags) || macro === 'long-document') {
    return 'warm-paper';
  }
  return 'clean-saas';
}

export function normalizeVisualReferenceItem(raw: RawVisualReferenceInput): VisualReferenceItem {
  const cleanSlug = String(raw.slug || '').trim();
  const curatedMatch = CURATED_INSPO_CATALOG.find((c) => c.slug === cleanSlug);
  const isDark = raw.mode === 'dark' || (raw.mode === undefined && curatedMatch?.mode === 'dark');
  const mode: 'light' | 'dark' = isDark ? 'dark' : 'light';
  const macro = String(raw.macro || curatedMatch?.macro || 'split-studio');
  const tags =
    typeof raw.tags === 'string' && raw.tags.trim()
      ? raw.tags.trim()
      : curatedMatch?.tags;

  const { sourceDomain: derivedDomain, sourceUrl: derivedUrl } = deriveSourceSiteFromSlug(
    cleanSlug,
    raw.sourceUrl,
  );
  const sourceDomain =
    typeof raw.sourceDomain === 'string' &&
    raw.sourceDomain.trim() &&
    !/[:/]/.test(raw.sourceDomain.trim())
      ? raw.sourceDomain.trim().toLowerCase()
      : derivedDomain;

  const heroCandidate = raw.heroUrl ?? raw.image;
  const fullCandidate = raw.fullPageUrl ?? raw.fullPage;
  const thumbCandidate = raw.thumbUrl ?? raw.thumb;
  const mobileCandidate = raw.mobileUrl ?? raw.mobile;

  const palette =
    Array.isArray(raw.palette) && raw.palette.length > 0
      ? raw.palette.filter((p): p is string => typeof p === 'string' && p.length <= 32).slice(0, 8)
      : curatedMatch?.palette ??
        (isDark
          ? ['#38bdf8', '#818cf8', '#94a3b8', '#1e293b', '#0f172a']
          : ['#2563eb', '#0f172a', '#64748b', '#cbd5e1', '#f8fafc']);

  const fonts =
    Array.isArray(raw.fonts) && raw.fonts.length > 0
      ? raw.fonts.filter((f): f is string => typeof f === 'string' && f.length <= 64).slice(0, 5)
      : curatedMatch?.fonts ?? ['Inter', 'system-ui'];

  const northstar =
    (typeof raw.northstar === 'string' && raw.northstar.trim()) ||
    curatedMatch?.northstar ||
    'Real-world production web reference';

  return {
    slug: cleanSlug,
    title: (typeof raw.title === 'string' && raw.title.trim()) || curatedMatch?.title || cleanSlug,
    sourceDomain,
    sourceUrl: derivedUrl,
    heroUrl: isRemoteHttpUrl(heroCandidate) ? heroCandidate.trim() : inspoHeroUrl(cleanSlug),
    fullPageUrl: isRemoteHttpUrl(fullCandidate) ? fullCandidate.trim() : inspoFullUrl(cleanSlug),
    thumbUrl: isRemoteHttpUrl(thumbCandidate) ? thumbCandidate.trim() : inspoThumbUrl(cleanSlug),
    mobileUrl: isRemoteHttpUrl(mobileCandidate) ? mobileCandidate.trim() : inspoMobileUrl(cleanSlug),
    vibeGroup: raw.vibeGroup ?? curatedMatch?.vibeGroup ?? inferVibeGroup(mode, macro, tags ?? ''),
    plainLabelZh:
      raw.plainLabelZh ??
      curatedMatch?.plainLabelZh ??
      (isDark ? '实时检索深色参考' : '实时检索浅色参考'),
    plainLabelEn:
      raw.plainLabelEn ??
      curatedMatch?.plainLabelEn ??
      (isDark ? 'Live Dark Reference' : 'Live Light Reference'),
    plainDescZh:
      raw.plainDescZh ??
      curatedMatch?.plainDescZh ??
      (raw.northstar || '来自真实线上产品的完整界面截图与自动提取色板'),
    plainDescEn:
      raw.plainDescEn ??
      curatedMatch?.plainDescEn ??
      (raw.northstar || 'Live production screenshot and extracted palette'),
    northstar,
    palette,
    surfaceHex:
      (typeof raw.surfaceHex === 'string' && raw.surfaceHex.trim()) ||
      curatedMatch?.surfaceHex ||
      (isDark ? '#0f172a' : '#f8fafc'),
    fonts,
    mode,
    macro,
    radiusPx:
      typeof raw.radiusPx === 'number' && Number.isFinite(raw.radiusPx)
        ? raw.radiusPx
        : (curatedMatch?.radiusPx ?? 10),
    ...(tags ? { tags } : {}),
  };
}

function stripEmbeddedDataUris(text: string): string {
  return text.replace(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, '[omitted-binary-uri]');
}

export function sanitizeInspoCacheEntry(
  input: InspoCacheEntryInput,
  nowIso: string = new Date().toISOString(),
): InspoCacheEntry {
  const sanitizedItems = input.items
    ? input.items
        .filter((it) => Boolean(it && typeof it.slug === 'string' && it.slug.trim()))
        .map((it) => normalizeVisualReferenceItem(it))
    : undefined;

  const sanitizedPick: InspoRecommendPick | undefined = input.pick
    ? {
        ...(input.pick.macrostructure
          ? {
              macrostructure: {
                slug: String(input.pick.macrostructure.slug || ''),
                label: String(input.pick.macrostructure.label || ''),
              },
            }
          : {}),
        ...(typeof input.pick.rationale === 'string'
          ? { rationale: stripEmbeddedDataUris(input.pick.rationale) }
          : {}),
      }
    : undefined;

  const sanitizedMarkdown =
    typeof input.markdown === 'string' ? stripEmbeddedDataUris(input.markdown) : undefined;

  let sanitizedFilters: Record<string, unknown> | undefined;
  if (input.filters && typeof input.filters === 'object') {
    const rawJson = stripEmbeddedDataUris(JSON.stringify(input.filters));
    sanitizedFilters = JSON.parse(rawJson) as Record<string, unknown>;
  }

  return {
    cacheKey: String(input.cacheKey).trim(),
    action: input.action,
    ...(typeof input.slug === 'string' && input.slug.trim() ? { slug: input.slug.trim() } : {}),
    ...(sanitizedItems ? { items: sanitizedItems } : {}),
    ...(sanitizedPick ? { pick: sanitizedPick } : {}),
    ...(sanitizedMarkdown !== undefined ? { markdown: sanitizedMarkdown } : {}),
    ...(sanitizedFilters ? { filters: sanitizedFilters } : {}),
    updatedAt: input.updatedAt ?? nowIso,
  };
}
