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
  /** Only for slugs whose hyphens hide a subdomain, which the slug alone cannot tell apart. */
  sourceUrl?: string;
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
  const { sourceUrl: explicitSourceUrl, ...rest } = seed;
  const { sourceDomain, sourceUrl } = deriveSourceSiteFromSlug(seed.slug, explicitSourceUrl);
  return {
    ...rest,
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
  // Second shelf: real sites from the Inspo archive, with palettes as extracted
  // there and surface colours measured from each capture's first fold.
  buildCuratedItem({
    slug: 'workspace-google-com',
    title: 'Google Workspace',
    sourceUrl: 'https://workspace.google.com',
    vibeGroup: 'clean-saas',
    plainLabelZh: '通透白底 · 办公套件蓝',
    plainLabelEn: 'Airy White · Suite Blue',
    plainDescZh: '纯白画布配标志性蓝色主按钮与柔和灰蓝辅助色，留白宽裕，适合多模块协同办公门户',
    plainDescEn: 'Pure white canvas with signature blue CTAs and soft blue-greys; generous spacing for suite-style portals',
    northstar: 'Cool, airy digital expanse: soft blues and greys, clean sans-serifs, generous white space.',
    palette: ['#1c74ec', '#0a397a', '#74a8f2', '#ac74ac', '#97ccb4'],
    surfaceHex: '#ffffff',
    fonts: ['Google Sans', 'Roboto', 'Arial'],
    mode: 'light',
    macro: 'split-studio',
    radiusPx: 12,
    tags: 'minimalism, swiss, monochrome, saas, calm, technical, soft',
  }),
  buildCuratedItem({
    slug: 'calendly-com',
    title: 'Calendly',
    vibeGroup: 'clean-saas',
    plainLabelZh: '利落白底 · 高饱和蓝强调',
    plainLabelEn: 'Crisp White · Saturated Blue',
    plainDescZh: '干净白底上用一支高饱和蓝统领按钮与重点，线条利落，适合预约、排程与流程类界面',
    plainDescEn: 'Clean white with one saturated blue leading buttons and emphasis; suits scheduling and workflow screens',
    northstar: 'Deep, cool tech clarity: clean lines, stark blues, and precise sans-serif precision.',
    palette: ['#0444fc', '#11385e', '#446bfc', '#506e8a', '#97b2d0'],
    surfaceHex: '#ffffff',
    fonts: ['gilroy'],
    mode: 'light',
    macro: 'feature-stack',
    radiusPx: 8,
    tags: 'minimalism, swiss, brutalism, saas, calm, technical, cold',
  }),
  buildCuratedItem({
    slug: 'todoist-com',
    title: 'Todoist',
    vibeGroup: 'clean-saas',
    plainLabelZh: '暖白底 · 任务清单红点缀',
    plainLabelEn: 'Warm White · Task Red Accent',
    plainDescZh: '略带暖调的白底配克制的红色强调，列表层级清楚，适合待办、任务与审批清单',
    plainDescEn: 'Slightly warm white with a restrained red accent and clear list hierarchy; ideal for task and approval lists',
    northstar: 'Cool, quiet digital workspace: crisp sans-serif, deep indigo, and subtle, glowing accents.',
    palette: ['#e44434', '#75180f', '#fce29f', '#8a6f67', '#acd4b4'],
    surfaceHex: '#fffdfc',
    fonts: ['Graphik', 'Inter'],
    mode: 'light',
    macro: 'feature-stack',
    radiusPx: 10,
    tags: 'minimalism, swiss, saas, calm, technical, cold',
  }),
  buildCuratedItem({
    slug: 'trello-com',
    title: 'Trello',
    vibeGroup: 'clean-saas',
    plainLabelZh: '浅灰蓝底 · 看板协作风',
    plainLabelEn: 'Pale Blue-Grey · Kanban',
    plainDescZh: '浅灰蓝背景上铺开卡片与泳道，蓝色主调配暖色点缀，适合看板式流程跟踪',
    plainDescEn: 'Cards and lanes on a pale blue-grey ground, blue-led with warm accents; fits kanban-style tracking',
    northstar: 'Cool, spacious digital canvas: clean sans-serif, muted blues and warm accents.',
    palette: ['#fa9c11', '#174cac', '#f4cc6c', '#4b638d', '#bfc8d5'],
    surfaceHex: '#f3f5f7',
    fonts: ['Charlie Display', 'Charlie Text'],
    mode: 'light',
    macro: 'feature-stack',
    radiusPx: 8,
    tags: 'minimalism, swiss, brutalism, saas, calm, technical, cold',
  }),
  buildCuratedItem({
    slug: 'bear-app',
    title: 'Bear',
    vibeGroup: 'clean-saas',
    plainLabelZh: '纯净白底 · 安静书写感',
    plainLabelEn: 'Pure White · Quiet Writing',
    plainDescZh: '大面积纯白配低饱和青灰与一点红色品牌色，版面安静克制，适合笔记与知识录入',
    plainDescEn: 'Expansive white with muted teal-greys and a touch of brand red; calm layout for notes and knowledge entry',
    northstar: 'Cool, crisp digital expanse - clean sans-serif geometry on a muted, calming teal and gray.',
    palette: ['#30c444', '#1a6a24', '#df5f5c', '#85a061', '#c4d4ac'],
    surfaceHex: '#ffffff',
    fonts: ['bearsansheadline', 'bearsans'],
    mode: 'light',
    macro: 'feature-stack',
    radiusPx: 10,
    tags: 'minimalism, swiss, monochrome, saas, calm, technical, soft',
  }),
  buildCuratedItem({
    slug: 'flomoapp-com',
    title: 'flomo',
    vibeGroup: 'clean-saas',
    plainLabelZh: '浅灰底 · 轻量卡片笔记',
    plainLabelEn: 'Light Grey · Lightweight Cards',
    plainDescZh: '浅灰底色配柔和绿色强调与圆润卡片，轻量不打扰，适合随手记录与信息流',
    plainDescEn: 'Light grey ground, soft green emphasis and rounded cards; lightweight feel for quick capture and feeds',
    northstar: 'Soft, pastel gradients flow over clean, geometric typography, fostering a serene, tech-forward clarity.',
    palette: ['#2ccc74', '#176d3e', '#f4dca4', '#747c84', '#cfbe9a'],
    surfaceHex: '#f2f2f2',
    fonts: ['Barlow-Regular'],
    mode: 'light',
    macro: 'ecosystem-index',
    radiusPx: 12,
    tags: 'minimalism, editorial, swiss, saas, calm, soft, technical',
  }),
  buildCuratedItem({
    slug: 'coda-io',
    title: 'Coda',
    vibeGroup: 'warm-paper',
    plainLabelZh: '暖杏底 · 文档即应用',
    plainLabelEn: 'Warm Apricot · Doc-as-App',
    plainDescZh: '温暖的杏色底配深炭灰文字与赤陶橙强调，像一份会动的文档，适合知识库与方案协作',
    plainDescEn: 'Warm apricot ground with charcoal type and terracotta accents, like a living document; great for wikis and plans',
    northstar: 'Warm, muted terracotta and deep charcoal, clean sans-serif, spacious, technically grounded.',
    palette: ['#f1a651', '#7a4509', '#fcd47c', '#9f5556', '#c5b4a0'],
    surfaceHex: '#ffe6c8',
    fonts: ['Calibre-R', 'Inter'],
    mode: 'light',
    macro: 'ecosystem-index',
    radiusPx: 12,
    tags: 'minimalism, swiss, brutalism, saas, calm, technical, serious',
  }),
  buildCuratedItem({
    slug: 'ecologi-com',
    title: 'Ecologi',
    vibeGroup: 'warm-paper',
    plainLabelZh: '米白纸底 · 森林绿沉稳',
    plainLabelEn: 'Cream Paper · Forest Green',
    plainDescZh: '米白纸感底色配鼠尾草绿与森林绿，留白充足、语气沉稳，适合报告与公示类页面',
    plainDescEn: 'Cream paper tone with sage and forest greens, ample whitespace and a steady voice; suits reports and disclosures',
    northstar: 'Soft, muted sage and forest, clean sans serif, ample whitespace breathes quiet confidence.',
    palette: ['#dd6062', '#611c20', '#7cacf4', '#9b8f64', '#cfc399'],
    surfaceHex: '#fcf9f1',
    fonts: ['PP Museum Medium', 'sans-serif'],
    mode: 'light',
    macro: 'ecosystem-index',
    radiusPx: 10,
    tags: 'minimalism, editorial, swiss, saas, non-profit, calm, warm, soft',
  }),
  buildCuratedItem({
    slug: 'lookback-com',
    title: 'Lookback',
    vibeGroup: 'warm-paper',
    plainLabelZh: '暖白底 · 柔和粉彩圆润',
    plainLabelEn: 'Warm White · Soft Pastels',
    plainDescZh: '暖白底上漂着柔和粉彩色块，配圆润友好的字形，适合访谈、调研与反馈类工具',
    plainDescEn: 'Soft pastel shapes on warm white with friendly rounded type; fits research and feedback tools',
    northstar: 'Soft, warm pastels drift across a spacious canvas, anchored by friendly, rounded type.',
    palette: ['#1c83eb', '#1a549c', '#fbdb6d', '#589c86', '#a5d0cd'],
    surfaceHex: '#faf8f6',
    fonts: ['Newzald', 'Inter'],
    mode: 'light',
    macro: 'feature-stack',
    radiusPx: 14,
    tags: 'minimalism, playful, editorial, saas, calm, soft, warm',
  }),
  buildCuratedItem({
    slug: 'babbel-com',
    title: 'Babbel',
    vibeGroup: 'warm-paper',
    plainLabelZh: '浅米底 · 柑橘暖色活力',
    plainLabelEn: 'Light Beige · Citrus Warmth',
    plainDescZh: '浅米色底配柑橘橙等暖色强调，字距开阔、亲和易读，适合培训与学习类应用',
    plainDescEn: 'Light beige with citrus-warm accents and open, approachable type; good for training and learning apps',
    northstar: 'Warm, inviting citrus hues meet open, airy typography for a globally curious feel.',
    palette: ['#f94c05', '#84210c', '#fcdc65', '#628a9c', '#c7abad'],
    surfaceHex: '#f6f4f0',
    fonts: ['Feature Text LC', 'Times', 'Graphik Babbel LCG'],
    mode: 'light',
    macro: 'feature-stack',
    radiusPx: 12,
    tags: 'minimalism, editorial, playful, education, warm, soft, calm',
  }),
  buildCuratedItem({
    slug: 'functionhealth-com--about',
    title: 'Function Health',
    vibeGroup: 'warm-paper',
    plainLabelZh: '奶油底 · 赭石质感专业',
    plainLabelEn: 'Cream · Ochre Professional',
    plainDescZh: '奶油色底配赭石与赤陶色，几何无衬线干净通透，适合健康档案与专业服务说明',
    plainDescEn: 'Cream ground with ochre and terracotta, clean geometric sans; suits health records and professional services',
    northstar: 'Warm ochre and muted terracotta, clean sans-serif geometry, spacious, airy depth.',
    palette: ['#b45c34', '#5c3c0c', '#cc9a81', '#886f5a', '#c4bdb4'],
    surfaceHex: '#fef9ef',
    fonts: ['Financier Display', 'FT Base'],
    mode: 'light',
    macro: 'feature-stack',
    radiusPx: 10,
    tags: 'minimalism, editorial, swiss, health, calm, technical, warm',
  }),
  buildCuratedItem({
    slug: 'confluent-io',
    title: 'Confluent',
    vibeGroup: 'dark-tech',
    plainLabelZh: '纯黑底 · 数据流结构感',
    plainLabelEn: 'Pure Black · Data Streams',
    plainDescZh: '纯黑背景上以靛蓝与清晰无衬线组织信息，结构感强，适合数据管道与实时监控',
    plainDescEn: 'Pure black with indigo structure and crisp sans; strong data-driven hierarchy for pipelines and monitoring',
    northstar: 'Deep indigo expanse, crisp sans-serif, and a structured, data-driven clarity.',
    palette: ['#0756fb', '#042c86', '#68bcf4', '#556fa1', '#9badc5'],
    surfaceHex: '#000000',
    fonts: ['Poppins'],
    mode: 'dark',
    macro: 'feature-stack',
    radiusPx: 8,
    tags: 'minimalism, brutalism, swiss, dark-mode, developer-tools, technical, cold, serious',
  }),
  buildCuratedItem({
    slug: 'buildkite-com',
    title: 'Buildkite',
    vibeGroup: 'dark-tech',
    plainLabelZh: '深海军蓝 · 流水线工程风',
    plainLabelEn: 'Deep Navy · Pipeline Engineering',
    plainDescZh: '近黑的深海军蓝底配冷调高亮，几何字形硬朗，适合 CI/CD、作业调度与运维台',
    plainDescEn: 'Near-black navy with cool highlights and firm geometric type; fits CI/CD, job scheduling and ops consoles',
    northstar: 'Deep indigo expanse, stark sans-serif geometry, and precise, cool digital clarity.',
    palette: ['#7a21ed', '#1c044c', '#8c44e4', '#5c9f8d', '#bbbac6'],
    surfaceHex: '#020617',
    fonts: ['Aeonik', 'ui-sans-serif'],
    mode: 'dark',
    macro: 'ecosystem-index',
    radiusPx: 8,
    tags: 'minimalism, monochrome, brutalism, swiss, dark-mode, developer-tools, technical, cold, serious',
  }),
  buildCuratedItem({
    slug: 'unkey-com',
    title: 'Unkey',
    vibeGroup: 'dark-tech',
    plainLabelZh: '炭黑底 · 等宽字荧光绿',
    plainLabelEn: 'Charcoal · Mono with Lime',
    plainDescZh: '炭黑底配等宽字体与荧光青柠强调色，终端气质浓，适合 API 网关与开发者控制台',
    plainDescEn: 'Charcoal ground, monospace type and lime accents with a terminal feel; ideal for API gateways and dev consoles',
    northstar: 'Deep charcoal expanse, crisp monospace geometry, glowing lime-green accents pulse forward.',
    palette: ['#c9e735', '#dff088', '#68781d', '#838c7c', '#c9c9ca'],
    surfaceHex: '#0a0c0d',
    fonts: ['articulat-cf', 'Inter'],
    mode: 'dark',
    macro: 'map-diagram',
    radiusPx: 6,
    tags: 'minimalism, futurist, monochrome, brutalism, dark-mode, developer-tools, technical, cold, serious',
  }),
  buildCuratedItem({
    slug: 'bun-com',
    title: 'Bun',
    vibeGroup: 'dark-tech',
    plainLabelZh: '深炭底 · 洋红数据脉冲',
    plainLabelEn: 'Dark Charcoal · Magenta Pulse',
    plainDescZh: '深炭色底配锐利几何字形与洋红点缀，节奏紧凑，适合性能指标与基准对比看板',
    plainDescEn: 'Dark charcoal, sharp geometric type and magenta flickers; compact rhythm for performance and benchmark boards',
    northstar: 'Deep charcoal expanse, sharp geometric type, flickering magenta accents pulse with data.',
    palette: ['#ba6091', '#5c2c44', '#f373b4', '#a46c6c', '#d9b3c6'],
    surfaceHex: '#19161b',
    fonts: ['system-ui'],
    mode: 'dark',
    macro: 'feature-stack',
    radiusPx: 8,
    tags: 'minimalism, monochrome, futurist, brutalism, dark-mode, developer-tools, technical, cold, serious',
  }),
  buildCuratedItem({
    slug: 'codepen-io',
    title: 'CodePen',
    vibeGroup: 'dark-tech',
    plainLabelZh: '石墨黑底 · 代码工作台',
    plainLabelEn: 'Graphite · Code Workbench',
    plainDescZh: '石墨黑底配冷灰层次与清晰无衬线，面板分区明确，适合编辑器式多面板工作台',
    plainDescEn: 'Graphite black with cool grey layers and clear sans; well-zoned panels for editor-style workbenches',
    northstar: 'Deep charcoal geometry, crisp sans-serif lines, a cold, digital expanse.',
    palette: ['#fad44d', '#24719d', '#e4b478', '#a86ea6', '#c597a7'],
    surfaceHex: '#121416',
    fonts: ['Telefon Black', 'SFMono-Regular', 'Lato'],
    mode: 'dark',
    macro: 'feature-stack',
    radiusPx: 6,
    tags: 'minimalism, brutalism, monochrome, playful, futurist, dark-mode, developer-tools, technical, cold, serious',
  }),
  buildCuratedItem({
    slug: 'razorpay-com',
    title: 'Razorpay',
    vibeGroup: 'fintech',
    plainLabelZh: '白底 · 靛蓝青色支付风',
    plainLabelEn: 'White · Indigo & Cyan Payments',
    plainDescZh: '大面积白底配靛蓝与青色，卡片分区精确，适合收付款、对账与商户后台',
    plainDescEn: 'Vast white with indigo and cyan and precise card zoning; suits payments, reconciliation and merchant consoles',
    northstar: 'Cool, geometric indigo and cyan - precise sans-serif, vast white expanse, confident clarity.',
    palette: ['#043cfc', '#97b1f2', '#744c34', '#ac745c', '#e2cac2'],
    surfaceHex: '#ffffff',
    fonts: ['TASA Orbiter Display SemiBold', 'sans-serif'],
    mode: 'light',
    macro: 'bento-grid',
    radiusPx: 10,
    tags: 'minimalism, swiss, brutalism, fintech, technical, cold, serious',
  }),
  buildCuratedItem({
    slug: 'stripe-com',
    title: 'Stripe',
    vibeGroup: 'fintech',
    plainLabelZh: '白底 · 紫靛渐变金融感',
    plainLabelEn: 'White · Indigo-Violet Finance',
    plainDescZh: '白底上以紫靛为主、杏橙点亮，字形精致克制，适合账单、订阅与资金流水',
    plainDescEn: 'Indigo-violet led on white with apricot highlights and refined type; fits billing, subscriptions and ledgers',
    northstar: 'Cool, deep indigo space with crisp, geometric sans-serifs and luminous apricot accents.',
    palette: ['#fb9318', '#8c4230', '#fc84e2', '#5962a6', '#8e8ccd'],
    surfaceHex: '#ffffff',
    fonts: ['sohne-var'],
    mode: 'light',
    macro: 'feature-stack',
    radiusPx: 8,
    tags: 'minimalism, swiss, brutalism, fintech, developer-tools, serious, technical, cold',
  }),
  buildCuratedItem({
    slug: 'coinbase-com',
    title: 'Coinbase',
    vibeGroup: 'fintech',
    plainLabelZh: '白底 · 标准蓝资产台账',
    plainLabelEn: 'White · Standard Blue Assets',
    plainDescZh: '纯白底配一支标准蓝与清晰几何字形，数字优先、层级分明，适合资产与交易明细',
    plainDescEn: 'Pure white with one standard blue and clear geometric type; number-first hierarchy for assets and transactions',
    northstar: 'Deep indigo expanse, crisp geometric sans-serif, digital clarity and precise spatial layering.',
    palette: ['#0949f1', '#041c7f', '#81a5e9', '#6180ba', '#a7b1bd'],
    surfaceHex: '#ffffff',
    fonts: ['CoinbaseDisplay', 'CoinbaseSans'],
    mode: 'light',
    macro: 'feature-stack',
    radiusPx: 8,
    tags: 'minimalism, brutalism, monochrome, futurist, crypto, fintech, cold, technical, serious',
  }),
  buildCuratedItem({
    slug: 'public-com',
    title: 'Public',
    vibeGroup: 'fintech',
    plainLabelZh: '白底 · 深靛结构化行情',
    plainLabelEn: 'White · Deep Indigo Structure',
    plainDescZh: '白底配深靛蓝与规整栅格，信息结构开放清楚，适合投资组合与行情概览',
    plainDescEn: 'White with deep indigo and an orderly grid; open, structured clarity for portfolios and market overviews',
    northstar: 'Cool, deep indigo expanse; crisp, geometric sans-serif; open, structured clarity.',
    palette: ['#ee6040', '#15245a', '#819ade', '#44599e', '#cad3b7'],
    surfaceHex: '#ffffff',
    fonts: ['Denton', 'Inter', 'Invest Pro'],
    mode: 'light',
    macro: 'specimen',
    radiusPx: 10,
    tags: 'minimalism, swiss, monochrome, fintech, calm, serious, technical',
  }),
  buildCuratedItem({
    slug: 'elastic-co',
    title: 'Elastic',
    vibeGroup: 'bento',
    plainLabelZh: '白底 · 蓝绿数据卡片',
    plainLabelEn: 'White · Blue-Green Data Cards',
    plainDescZh: '白底便当格配几何蓝绿色块，卡片承载指标与图表，适合搜索、日志与可观测看板',
    plainDescEn: 'White bento grid with geometric blues and greens; cards carry metrics and charts for search and observability',
    northstar: 'Cool, geometric blues and greens; stark, clean sans-serifs; spacious, data-driven clarity.',
    palette: ['#0c63db', '#07bdb5', '#87f3e1', '#69aab1', '#c5d0db'],
    surfaceHex: '#ffffff',
    fonts: ['MierB', 'Inter'],
    mode: 'light',
    macro: 'bento-grid',
    radiusPx: 10,
    tags: 'minimalism, swiss, brutalism, developer-tools, saas, technical, cold, serious',
  }),
  buildCuratedItem({
    slug: 'prisma-io',
    title: 'Prisma',
    vibeGroup: 'bento',
    plainLabelZh: '白底 · 青灰模块分区',
    plainLabelEn: 'White · Teal-Grey Modules',
    plainDescZh: '白底上以低饱和青色与炭灰划分模块，冷静克制，适合数据模型与配置总览',
    plainDescEn: 'Muted teal and charcoal modules on white; calm and restrained for data-model and configuration overviews',
    northstar: 'Cool, stark geometry - muted teal and charcoal, precise sans-serifs, expansive digital stillness.',
    palette: ['#18bba5', '#14645c', '#96dcd5', '#7c7c84', '#9ccccc'],
    surfaceHex: '#ffffff',
    fonts: ['Mona Sans', 'Inter'],
    mode: 'light',
    macro: 'bento-grid',
    radiusPx: 10,
    tags: 'minimalism, swiss, brutalism, developer-tools, technical, cold, calm',
  }),
  buildCuratedItem({
    slug: 'svix-com',
    title: 'Svix',
    vibeGroup: 'bento',
    plainLabelZh: '深靛底 · 图标卡片群',
    plainLabelEn: 'Deep Indigo · Icon Card Clusters',
    plainDescZh: '深靛蓝底上的便当卡片配成组图标，轻快有序，适合集成、Webhook 与事件总览',
    plainDescEn: 'Bento cards with icon clusters on deep indigo; light yet orderly for integrations, webhooks and events',
    northstar: 'Deep indigo expanse, clean sans-serif geometry, playful icon clusters floating weightlessly.',
    palette: ['#2d6ff4', '#1c1c43', '#8cb4fc', '#4e9aa6', '#c0c2cd'],
    surfaceHex: '#1c1c46',
    fonts: ['grotesk', 'Times'],
    mode: 'dark',
    macro: 'bento-grid',
    radiusPx: 12,
    tags: 'minimalism, swiss, monochrome, brutalism, playful, futurist, editorial, dark-mode, developer-tools, technical, cold, serious',
  }),
  buildCuratedItem({
    slug: 'copilot-money',
    title: 'Copilot Money',
    vibeGroup: 'bento',
    plainLabelZh: '午夜蓝底 · 圆润理财卡片',
    plainLabelEn: 'Midnight Blue · Rounded Money Cards',
    plainDescZh: '午夜蓝底配圆润字形与柔光渐变卡片，把余额、预算和趋势分块呈现，适合个人或部门账务',
    plainDescEn: 'Midnight blue with rounded type and softly glowing cards; balances, budgets and trends in tidy blocks',
    northstar: 'Deep indigo expanse with playful, rounded typography floating on soft, glowing gradients.',
    palette: ['#1c6bfb', '#0e2d66', '#6a9dfc', '#7157a1', '#bcc3d1'],
    surfaceHex: '#020d1d',
    fonts: ['Jokker Semibold', 'Jokker Medium', 'sans-serif'],
    mode: 'dark',
    macro: 'bento-grid',
    radiusPx: 16,
    tags: 'playful, minimalism, dark-mode, fintech, calm, soft',
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
