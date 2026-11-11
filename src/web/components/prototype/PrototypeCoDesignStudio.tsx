import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Code2,
  Columns2,
  Copy,
  Crosshair,
  Download,
  Eye,
  FileText,
  Layers,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Monitor,
  Palette,
  RectangleHorizontal,
  Search,
  Send,
  Smartphone,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { extractMuFromPrototypeHtml } from '../../../packages/ontology-core/index.js';
import type {
  ProjectDetail,
  PrototypeArtifact,
  RequirementDoc,
} from '../../../packages/workspace-store/index.js';
import { Button } from '../beautifui/index.js';
import {
  DEFAULT_ALIGNMENT_STATE,
  MotionSchematicGallery,
  describeAlignmentForAgent,
  type RequirementAlignmentState,
} from './MotionSchematicGallery.js';
import {
  PrototypeVisualPreviewStage,
  type PrototypeSelectionTarget,
  type PrototypeVisualAnnotation,
} from './PrototypeVisualInspector.js';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';

const INSPO_CDN_BASE = 'https://0nme3pk5am3urwa9.public.blob.vercel-storage.com/captures';

export interface InspoReferenceItem {
  slug: string;
  title: string;
  vibeGroup: 'clean-saas' | 'warm-paper' | 'dark-tech' | 'fintech' | 'bento';
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
}

export type LikedAspectKey =
  | 'bgColor'
  | 'accentColor'
  | 'spacing'
  | 'cardBorder'
  | 'typography'
  | 'dataClarity';

export interface SelectedInspoPreference {
  item: InspoReferenceItem;
  likedAspects: LikedAspectKey[];
  likedSwatches: string[];
  reasonNote: string;
}

export const LIKED_ASPECT_OPTIONS: {
  key: LikedAspectKey;
  labelZh: string;
  labelEn: string;
  agentHintZh: string;
  agentHintEn: string;
}[] = [
  {
    key: 'bgColor',
    labelZh: '背景底色',
    labelEn: 'Background Color',
    agentHintZh: '重点借鉴此参考图的页面大背景与卡片底色层次',
    agentHintEn: 'Adopt the page canvas and surface background colors from this reference',
  },
  {
    key: 'accentColor',
    labelZh: '按钮与强调色',
    labelEn: 'Button & Accent Color',
    agentHintZh: '重点借鉴此参考图的主操作按钮色与状态高亮色',
    agentHintEn: 'Adopt the primary CTA button and highlight accent colors from this reference',
  },
  {
    key: 'spacing',
    labelZh: '留白与呼吸感',
    labelEn: 'Spacing & Airiness',
    agentHintZh: '重点借鉴此参考图的宽松留白比例与模块间距节奏',
    agentHintEn: 'Adopt the generous whitespace and section padding rhythm from this reference',
  },
  {
    key: 'cardBorder',
    labelZh: '卡片圆角与分割线',
    labelEn: 'Card Radius & Borders',
    agentHintZh: '重点借鉴此参考图的卡片圆角弧度与细腻边框质感',
    agentHintEn: 'Adopt the border-radius and crisp hairline border treatment from this reference',
  },
  {
    key: 'typography',
    labelZh: '字体与标题排版',
    labelEn: 'Typography & Hierarchy',
    agentHintZh: '重点借鉴此参考图的标题字重对比与阅读排版气质',
    agentHintEn: 'Adopt the heading font hierarchy and typographic contrast from this reference',
  },
  {
    key: 'dataClarity',
    labelZh: '表格/数据清晰度',
    labelEn: 'Table & Data Clarity',
    agentHintZh: '重点借鉴此参考图的数据对齐方式与状态标签样式',
    agentHintEn: 'Adopt the clean tabular alignment and status pill styling from this reference',
  },
];

export function inspoHeroUrl(slug: string): string {
  return `${INSPO_CDN_BASE}/${slug}/hero.1440.webp`;
}
export function inspoFullUrl(slug: string): string {
  return `${INSPO_CDN_BASE}/${slug}/full.1440.webp`;
}
export function inspoMobileUrl(slug: string): string {
  return `${INSPO_CDN_BASE}/${slug}/mobile.384.webp`;
}

export const CURATED_INSPO_CATALOG: InspoReferenceItem[] = [
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
];

const VIBE_FILTERS: {
  key: 'ALL' | InspoReferenceItem['vibeGroup'];
  labelZh: string;
  labelEn: string;
  emoji: string;
}[] = [
  { key: 'ALL', labelZh: '全部大图精选', labelEn: 'All Showcases', emoji: '✨' },
  { key: 'clean-saas', labelZh: '清爽白底办公', labelEn: 'Clean Light SaaS', emoji: '☀️' },
  { key: 'fintech', labelZh: '严谨台账/金融', labelEn: 'Crisp Ledger', emoji: '📊' },
  { key: 'warm-paper', labelZh: '温润纸感文档', labelEn: 'Warm Paper', emoji: '📜' },
  { key: 'dark-tech', labelZh: '深色监控驾驶舱', labelEn: 'Dark Cockpit', emoji: '🌙' },
  { key: 'bento', labelZh: '模块卡片看板', labelEn: 'Bento Cards', emoji: '🍱' },
];

function normalizeLiveInspoItem(raw: {
  slug: string;
  title?: string;
  northstar?: string;
  palette?: string[];
  fonts?: string[];
  mode?: string;
  macro?: string;
}): InspoReferenceItem {
  const existing = CURATED_INSPO_CATALOG.find((c) => c.slug === raw.slug);
  if (existing) return existing;
  const isDark = raw.mode === 'dark';
  const palette =
    raw.palette && raw.palette.length > 0
      ? raw.palette
      : isDark
        ? ['#38bdf8', '#818cf8', '#94a3b8', '#1e293b', '#0f172a']
        : ['#2563eb', '#0f172a', '#64748b', '#cbd5e1', '#f8fafc'];
  return {
    slug: raw.slug,
    title: raw.title || raw.slug,
    vibeGroup: isDark ? 'dark-tech' : 'clean-saas',
    plainLabelZh: isDark ? '实时检索深色参考' : '实时检索浅色参考',
    plainLabelEn: isDark ? 'Live Dark Reference' : 'Live Light Reference',
    plainDescZh: raw.northstar || '来自真实线上产品的完整界面截图与自动提取色板',
    plainDescEn: raw.northstar || 'Live production screenshot and extracted palette',
    northstar: raw.northstar || 'Real-world production web reference',
    palette,
    surfaceHex: isDark ? '#0f172a' : '#f8fafc',
    fonts: raw.fonts && raw.fonts.length > 0 ? raw.fonts : ['Inter', 'system-ui'],
    mode: isDark ? 'dark' : 'light',
    macro: raw.macro || 'split-studio',
    radiusPx: 10,
  };
}

function pickReadableButtonInk(hex: string): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '#ffffff';
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 165 ? '#111827' : '#ffffff';
}

function isLightHex(hex: string): boolean {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return true;
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return (r * 299 + g * 587 + b * 114) / 1000 >= 140;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Compiles all selected Inspo references, user liked reasons (aspects + pinned swatches + freeform notes),
 * and Motion-Prompt visual schematic choices into a comprehensive, unambiguous Agent prompt!
 */
export function buildAgentPrototypeContextPrompt(
  selectedPrefs: SelectedInspoPreference[],
  alignment: RequirementAlignmentState,
  locale: 'zh-CN' | 'en-US' = 'zh-CN',
): string {
  const refs =
    selectedPrefs.length > 0
      ? selectedPrefs
      : [
          {
            item: CURATED_INSPO_CATALOG[0]!,
            likedAspects: ['bgColor', 'accentColor'] as LikedAspectKey[],
            likedSwatches: [],
            reasonNote: '',
          },
        ];

  const bgDonor =
    refs.find((p) => p.likedAspects.includes('bgColor')) ?? refs[0]!;
  const accentDonor =
    refs.find((p) => p.likedAspects.includes('accentColor')) ?? refs[0]!;

  const refLines = refs.map((pref, idx) => {
    const aspectLabels = pref.likedAspects
      .map((k) => {
        const meta = LIKED_ASPECT_OPTIONS.find((o) => o.key === k);
        return locale === 'en-US' ? meta?.agentHintEn : meta?.agentHintZh;
      })
      .filter(Boolean)
      .join('；');
    const swatchNote =
      pref.likedSwatches.length > 0
        ? locale === 'en-US'
          ? ` | Pinned Favorite Colors: ${pref.likedSwatches.join(', ')}`
          : ` | 用户点选心仪色值：${pref.likedSwatches.join(', ')}`
        : '';
    const userReason = pref.reasonNote.trim()
      ? locale === 'en-US'
        ? ` | User's Specific Liked Reason: "${pref.reasonNote.trim()}"`
        : ` | 用户填写的喜欢原因：「${pref.reasonNote.trim()}」`
      : '';
    return `${idx + 1}. [${pref.item.title}] (${pref.item.mode} mode, canvas ${pref.item.surfaceHex}, palette ${pref.item.palette.join(', ')}, font ${pref.item.fonts[0]}, radius ${pref.item.radiusPx}px)${aspectLabels ? ` — ${aspectLabels}` : ''}${swatchNote}${userReason}`;
  });

  const schematicLines = describeAlignmentForAgent(alignment, locale).map(
    (line, i) => `${i + 1}. ${line}`,
  );

  if (locale === 'en-US') {
    return [
      '=== VISUAL REFERENCE DNA & USER LIKED REASONS ===',
      `Primary Background/Surface Token Source: ${bgDonor.item.title} (${bgDonor.item.mode} mode, canvas ${bgDonor.item.surfaceHex})`,
      `Primary CTA/Accent Token Source: ${accentDonor.item.title} (accent ${accentDonor.likedSwatches[0] || accentDonor.item.palette[0]})`,
      ...refLines,
      '',
      '=== INTERACTION & MOTION SCHEMATIC SPECIFICATIONS ===',
      ...schematicLines,
    ].join('\n');
  }

  return [
    '【一、用户挑选的视觉参考大图与喜欢原因（请严格落实配色、背景与排版质感）】',
    `- 页面大背景与明暗基调来源：${bgDonor.item.title}（${bgDonor.item.mode === 'dark' ? '深色模式' : '浅色模式'}，推荐画布背景色 ${bgDonor.item.surfaceHex}）`,
    `- 主按钮与强调色来源：${accentDonor.item.title}（推荐主色 ${accentDonor.likedSwatches[0] || accentDonor.item.palette[0]}，圆角 ${refs[0]!.item.radiusPx}px）`,
    ...refLines,
    '',
    '【二、用户通过动态示意图确认的交互结构与微动效规范】',
    ...schematicLines,
  ].join('\n');
}

/**
 * Generates a runnable, single-file semantic HTML5 prototype (`SCR-*`, `EL-*`, `data-binding`, `UIE-*`)
 * that responds LIVE to:
 * 1) Selected Inspo references + per-reference liked reasons (background donor, accent donor, pinned colors, notes)
 * 2) All 13 Motion-Prompt style schematic choices (Drawer / Modal / Split / Tabs, Density, KPI Count-up, Filter Chips, Accordion, Stepper+Approval, Corner Toast, Skeleton Shimmer, Stagger Motion)
 */
export function buildReferenceStyledPrototypeHtml(
  project: ProjectDetail,
  doc: RequirementDoc | undefined,
  selectedPrefs: SelectedInspoPreference[],
  alignment: RequirementAlignmentState,
): string {
  const prefs =
    selectedPrefs.length > 0
      ? selectedPrefs
      : [
          {
            item: CURATED_INSPO_CATALOG[0]!,
            likedAspects: ['bgColor', 'accentColor'] as LikedAspectKey[],
            likedSwatches: [],
            reasonNote: '',
          },
        ];

  const bgPref = prefs.find((p) => p.likedAspects.includes('bgColor')) ?? prefs[0]!;
  const accentPref = prefs.find((p) => p.likedAspects.includes('accentColor')) ?? prefs[0]!;
  const radiusPref = prefs.find((p) => p.likedAspects.includes('cardBorder')) ?? prefs[0]!;
  const fontPref = prefs.find((p) => p.likedAspects.includes('typography')) ?? prefs[0]!;

  // If user pinned a swatch on bgPref that matches its surfaceHex, use it; otherwise bgPref.item.surfaceHex
  const pinnedBgSwatch = bgPref.likedSwatches.find(
    (hex) => hex.toLowerCase() === bgPref.item.surfaceHex.toLowerCase(),
  );
  const bg = pinnedBgSwatch || bgPref.item.surfaceHex;
  const isDark = !isLightHex(bg) || bgPref.item.mode === 'dark';
  const isWarmPaper = bgPref.item.vibeGroup === 'warm-paper';

  const pinnedAccentSwatch = accentPref.likedSwatches.find(
    (hex) => hex.toLowerCase() !== bg.toLowerCase(),
  );
  const accent = pinnedAccentSwatch || accentPref.item.palette[0] || '#2563eb';
  const secondaryAccent =
    prefs[1]?.item.palette[0] || accentPref.item.palette[1] || accent;
  const accentInk = pickReadableButtonInk(accent);

  const surface = isDark ? '#151c2c' : isWarmPaper ? '#fffdf9' : '#ffffff';
  const surfaceSubtle = isDark ? '#1d263b' : isWarmPaper ? '#f2ece1' : '#edf2f7';
  const border = isDark ? 'rgba(255,255,255,0.13)' : isWarmPaper ? '#dfd6c7' : '#e2e8f0';
  const ink = isDark ? '#f1f5f9' : isWarmPaper ? '#1f1d1a' : '#0f172a';
  const inkMuted = isDark ? '#94a3b8' : isWarmPaper ? '#6b6459' : '#64748b';
  const fontStack =
    fontPref.item.vibeGroup === 'warm-paper'
      ? `'Georgia', 'Noto Serif SC', -apple-system, sans-serif`
      : `'${fontPref.item.fonts[0] || 'Inter'}', -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif`;
  const radius = `${radiusPref.item.radiusPx}px`;

  const hasKpi = alignment.interactiveParts.includes('KPI_COUNT_UP');
  const hasFilterChips = alignment.interactiveParts.includes('FILTER_CHIPS');
  const hasAccordion = alignment.interactiveParts.includes('ACCORDION');
  const hasStepApproval = alignment.interactiveParts.includes('STEP_INDICATOR');
  const hasToast = alignment.feedbackMotions.includes('TOAST');
  const hasSkeleton = alignment.feedbackMotions.includes('SKELETON');
  const hasSubtleMotion = alignment.feedbackMotions.includes('SUBTLE_MOTION');

  const isContractProject = /合同|contract|clm/i.test(`${project.name} ${project.domain}`);
  const hasStaleContractTemplate =
    !isContractProject &&
    Boolean(
      project.suite.M1?.aggregates.some(
        (a) => a.name === 'Contract' && a.uiBindings?.includes('SCR-CONTRACT-LIST'),
      ),
    );
  const firstAgg = hasStaleContractTemplate ? undefined : project.suite.M1?.aggregates?.[0];
  const aggName = firstAgg?.name || 'BusinessOrder';
  const aggLabel =
    firstAgg?.alias ||
    project.name.replace(/管理系统|平台|工作台|系统|工程/g, '').trim() ||
    '核心业务单据';
  const codeField = firstAgg?.attributes?.[0]?.name || 'orderCode';
  const titleField = firstAgg?.attributes?.[1]?.name || 'title';
  const amountField =
    firstAgg?.attributes?.find((a) => /amount|price|total|fee|count/i.test(a.name))?.name ||
    'totalAmount';
  const statusField =
    firstAgg?.attributes?.find((a) => /status|state/i.test(a.name))?.name || 'status';

  const likedSummaryParts = prefs
    .map((p) => {
      const tags = p.likedAspects
        .map((k) => LIKED_ASPECT_OPTIONS.find((o) => o.key === k)?.labelZh)
        .filter(Boolean);
      const pieces = [...tags, ...(p.reasonNote.trim() ? [p.reasonNote.trim()] : [])];
      return pieces.length > 0 ? `${p.item.title}(${pieces.join('·')})` : p.item.title;
    })
    .join(' + ');

  const extraNoteText =
    alignment.customNotes.length > 0
      ? alignment.customNotes[alignment.customNotes.length - 1]
      : doc
        ? `对齐《${doc.title}》`
        : `对齐「${project.domain || project.name}」`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(project.name)} · 交互原型</title>
  <style>
    :root {
      --bg: ${bg};
      --surface: ${surface};
      --surface-2: ${surfaceSubtle};
      --line: ${border};
      --ink: ${ink};
      --muted: ${inkMuted};
      --accent: ${accent};
      --accent-2: ${secondaryAccent};
      --accent-ink: ${accentInk};
      --radius: ${radius};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 18px 22px 68px;
      background: var(--bg);
      color: var(--ink);
      font-family: ${fontStack};
      font-size: 13.5px;
      line-height: 1.5;
    }
    .dna-banner {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 12px;
      margin-bottom: 14px;
      border-radius: var(--radius);
      background: var(--surface-2);
      border: 1px solid var(--line);
      font-size: 12px;
    }
    .swatch-dot {
      display: inline-block;
      width: 11px;
      height: 11px;
      border-radius: 999px;
      border: 1px solid rgba(128,128,128,0.35);
      vertical-align: middle;
      margin-right: 4px;
    }
    .topbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
    }
    .brand h1 { margin: 0; font-size: 19px; letter-spacing: -0.01em; }
    .brand p { margin: 2px 0 0; font-size: 12px; color: var(--muted); }
    .tabs {
      display: inline-flex;
      gap: 4px;
      padding: 4px;
      background: var(--surface-2);
      border: 1px solid var(--line);
      border-radius: calc(var(--radius) + 2px);
    }
    .tab-btn {
      border: 0;
      background: transparent;
      color: var(--muted);
      padding: 6px 12px;
      border-radius: var(--radius);
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.18s ease;
    }
    .tab-btn.active {
      background: var(--accent);
      color: var(--accent-ink);
      box-shadow: 0 1px 4px rgba(0,0,0,0.14);
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: ${alignment.layoutDensity === 'COMPACT_LEDGER' ? '12px 14px' : '16px 18px'};
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      ${hasSubtleMotion ? 'animation: protoFadeUp 0.28s ease-out both;' : ''}
    }
    ${
      alignment.layoutDensity === 'MODULAR_CARDS'
        ? `.card:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.07); }`
        : ''
    }
    @keyframes protoFadeUp {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .kpi-label { font-size: 11.5px; color: var(--muted); }
    .kpi-val { font-size: 23px; font-weight: 700; margin-top: 4px; font-variant-numeric: tabular-nums; }
    .stepper-strip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 14px;
      padding: 10px 14px;
      border-radius: var(--radius);
      background: var(--surface);
      border: 1px solid var(--line);
      font-size: 12px;
    }
    .step-node { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
    .step-dot {
      width: 20px; height: 20px; border-radius: 999px;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 11px; background: var(--surface-2); color: var(--muted); border: 1px solid var(--line);
    }
    .step-node.done .step-dot { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
    .step-line { flex: 1; height: 2px; background: var(--line); position: relative; overflow: hidden; }
    .step-line-fill { height: 100%; background: var(--accent); transition: width 0.3s ease; }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .chip-bar { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .filter-chip {
      border: 1px solid var(--line);
      background: var(--surface-2);
      color: var(--ink);
      border-radius: 999px;
      padding: 4px 11px;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.16s ease;
    }
    .filter-chip.active {
      background: var(--accent);
      color: var(--accent-ink);
      border-color: var(--accent);
      font-weight: 600;
    }
    input, select {
      background: var(--surface);
      color: var(--ink);
      border: 1px solid var(--line);
      border-radius: calc(var(--radius) * 0.75);
      padding: 7px 10px;
      font-size: 13px;
    }
    .btn {
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--ink);
      padding: 7px 13px;
      border-radius: calc(var(--radius) * 0.8);
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-primary {
      background: var(--accent);
      color: var(--accent-ink);
      border-color: var(--accent);
    }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td {
      text-align: left;
      padding: ${alignment.layoutDensity === 'COMPACT_LEDGER' ? '8px 10px' : '12px 12px'};
      border-bottom: 1px solid var(--line);
    }
    th { color: var(--muted); font-weight: 600; font-size: 11.5px; }
    tbody tr:hover { background: var(--surface-2); }
    .pill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: var(--surface-2);
      border: 1px solid var(--line);
    }
    .inline-banner {
      display: none;
      margin-bottom: 12px;
      padding: 9px 12px;
      border-radius: var(--radius);
      border-left: 4px solid var(--accent);
      background: var(--surface);
      font-size: 12.5px;
    }
    .corner-toast {
      display: none;
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 50;
      min-width: 260px;
      max-width: 380px;
      background: var(--surface);
      color: var(--ink);
      border: 1px solid var(--accent);
      border-radius: var(--radius);
      box-shadow: 0 10px 28px rgba(0,0,0,0.2);
      overflow: hidden;
      animation: toastSlideIn 0.22s ease-out;
    }
    @keyframes toastSlideIn {
      from { transform: translateY(16px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    .corner-toast-body { padding: 10px 13px; font-size: 12.5px; }
    .corner-toast-bar {
      height: 3px;
      background: var(--accent);
      transform-origin: left center;
      animation: toastCountdown 3.2s linear forwards;
    }
    @keyframes toastCountdown {
      from { transform: scaleX(1); }
      to { transform: scaleX(0); }
    }
    .skeleton-row {
      height: 14px;
      border-radius: 4px;
      background: linear-gradient(90deg, var(--surface-2) 25%, var(--line) 50%, var(--surface-2) 75%);
      background-size: 200% 100%;
      animation: skelSweep 0.9s linear infinite;
    }
    @keyframes skelSweep {
      from { background-position: 200% 0; }
      to { background-position: -200% 0; }
    }
    .split-grid {
      display: grid;
      grid-template-columns: ${alignment.entryPattern === 'INLINE_SPLIT' ? '1.35fr 0.95fr' : '1fr'};
      gap: 14px;
    }
    .overlay-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.45);
      z-index: 40;
      align-items: ${alignment.entryPattern === 'MODAL' ? 'center' : 'stretch'};
      justify-content: ${alignment.entryPattern === 'MODAL' ? 'center' : 'flex-end'};
    }
    .overlay-panel {
      width: ${alignment.entryPattern === 'MODAL' ? 'min(480px, 92vw)' : 'min(410px, 92vw)'};
      ${alignment.entryPattern === 'MODAL' ? 'border-radius: var(--radius); border: 1px solid var(--line);' : 'height: 100%; border-left: 1px solid var(--line);'}
      background: var(--surface);
      padding: 18px;
      overflow-y: auto;
      box-shadow: 0 16px 40px rgba(0,0,0,0.24);
    }
    .form-row { margin-bottom: 10px; display: flex; flex-direction: column; gap: 4px; }
    .form-row label { font-size: 12px; color: var(--muted); font-weight: 600; }
    .acc-detail {
      background: var(--surface-2);
      padding: 8px 12px;
      border-radius: calc(var(--radius) * 0.6);
      font-size: 12px;
      color: var(--muted);
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; transition: none !important; }
    }
  </style>
</head>
<body>
  <div class="dna-banner">
    <div>
      <span class="swatch-dot" style="background:${bg}"></span>
      <span class="swatch-dot" style="background:${accent}"></span>
      <strong>视觉参考与偏好：${escapeHtml(likedSummaryParts)}</strong>
    </div>
    <span style="color:var(--muted)">${escapeHtml(extraNoteText || '')}</span>
  </div>

  <div id="status-banner" class="inline-banner" role="status"></div>
  <div id="corner-toast" class="corner-toast" role="status">
    <div class="corner-toast-body" id="corner-toast-text"></div>
    <div class="corner-toast-bar" id="corner-toast-bar"></div>
  </div>

  <div class="topbar">
    <div class="brand">
      <h1>${escapeHtml(project.name)}</h1>
      <p>${escapeHtml(project.domain || aggLabel)} · MU 语义锚点就绪（SCR / EL / UIE）</p>
    </div>
    <div class="tabs">
      <button class="tab-btn active" onclick="showScreen('SCR-MAIN-LIST', this)">1. ${escapeHtml(aggLabel)}台账</button>
      ${
        alignment.entryPattern === 'DEDICATED_TAB'
          ? `<button class="tab-btn" onclick="showScreen('SCR-MAIN-FORM', this)">2. 新建${escapeHtml(aggLabel)}</button>`
          : ''
      }
      ${
        hasStepApproval
          ? `<button class="tab-btn" onclick="showScreen('SCR-APPROVAL-FLOW', this)">${alignment.entryPattern === 'DEDICATED_TAB' ? '3' : '2'}. 审批与流转</button>`
          : ''
      }
    </div>
  </div>

  ${
    hasKpi
      ? `<div class="kpi-grid">
          <div class="card">
            <div class="kpi-label">本月累计${escapeHtml(aggLabel)}</div>
            <div class="kpi-val" id="kpi-total" data-target="28">0</div>
          </div>
          <div class="card">
            <div class="kpi-label">待审批 / 规则复核</div>
            <div class="kpi-val" style="color:var(--accent)" id="kpi-pending">1</div>
          </div>
          <div class="card">
            <div class="kpi-label">准时办结率</div>
            <div class="kpi-val" style="color:var(--accent-2)">98.6%</div>
          </div>
        </div>`
      : ''
  }

  ${
    hasStepApproval
      ? `<div class="stepper-strip">
          <span class="step-node done"><span class="step-dot">✓</span>1. 单据起草</span>
          <div class="step-line"><div class="step-line-fill" id="step-fill-1" style="width:100%"></div></div>
          <span class="step-node done"><span class="step-dot">✓</span>2. M3 规则校验</span>
          <div class="step-line"><div class="step-line-fill" id="step-fill-2" style="width:60%"></div></div>
          <span class="step-node" id="step-node-3"><span class="step-dot" id="step-dot-3">3</span>3. 主管审批生效</span>
        </div>`
      : ''
  }

  <div class="split-grid">
    <!-- Screen 1: Ledger List -->
    <section
      id="SCR-MAIN-LIST"
      data-screen-id="SCR-MAIN-LIST"
      data-screen-name="${escapeHtml(aggLabel)}台账列表"
      data-screen-type="LIST"
      data-route="/${escapeHtml(aggName.toLowerCase())}/list"
      data-role-refs="ROLE-01"
      class="card"
    >
      <div class="toolbar">
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <input
            id="filter-kw"
            data-element-id="EL-SEARCH-KW"
            data-element-name="keywordFilter"
            data-element-label="关键词检索"
            data-element-type="INPUT"
            data-binding="${escapeHtml(aggName)}.${escapeHtml(titleField)}"
            placeholder="搜索编号或名称…"
            oninput="renderRows()"
          />
          <select
            id="filter-status"
            data-element-id="EL-FILTER-STATUS"
            data-element-name="statusFilter"
            data-element-label="状态筛选"
            data-element-type="SELECT"
            data-binding="${escapeHtml(aggName)}.${escapeHtml(statusField)}"
            onchange="setChipFilter(this.value)"
          >
            <option value="">全部状态</option>
            <option value="DRAFT">草稿 (DRAFT)</option>
            <option value="PENDING_APPROVAL">待审批 (PENDING)</option>
            <option value="APPROVED">已生效 (APPROVED)</option>
          </select>
          ${
            hasSkeleton
              ? `<button type="button" class="btn" onclick="triggerRefreshSkeleton()">↻ 刷新数据</button>`
              : ''
          }
        </div>
        <button
          type="button"
          class="btn btn-primary"
          data-element-id="EL-OPEN-CREATE"
          data-element-name="openCreateBtn"
          data-element-label="新建${escapeHtml(aggLabel)}"
          data-element-type="BUTTON"
          data-event-id="UIE-OPEN-CREATE"
          data-event-name="打开新建面板"
          data-behavior-ref="BHV-${escapeHtml(aggName.toUpperCase())}-PREPARE"
          data-navigate-to="SCR-MAIN-FORM"
          onclick="triggerCreateEntry()"
        >
          + 新建${escapeHtml(aggLabel)}
        </button>
      </div>

      ${
        hasFilterChips
          ? `<div class="chip-bar">
              <button type="button" class="filter-chip active" data-chip="" onclick="setChipFilter('')">✓ 全部单据</button>
              <button type="button" class="filter-chip" data-chip="PENDING_APPROVAL" onclick="setChipFilter('PENDING_APPROVAL')">待审批复核</button>
              <button type="button" class="filter-chip" data-chip="APPROVED" onclick="setChipFilter('APPROVED')">已审批生效</button>
              <button type="button" class="filter-chip" data-chip="DRAFT" onclick="setChipFilter('DRAFT')">草稿箱</button>
            </div>`
          : ''
      }

      <table
        data-element-id="EL-MAIN-TABLE"
        data-element-name="mainLedgerTable"
        data-element-label="${escapeHtml(aggLabel)}明细表"
        data-element-type="TABLE"
        data-binding="${escapeHtml(aggName)}"
      >
        <thead>
          <tr>
            <th>单据编号</th>
            <th>${escapeHtml(aggLabel)}名称</th>
            <th>金额 / 规模</th>
            <th>当前状态</th>
            <th>动作</th>
          </tr>
        </thead>
        <tbody id="ledger-tbody"></tbody>
      </table>
    </section>

    <!-- Screen 2: Creation Form -->
    <section
      id="SCR-MAIN-FORM"
      data-screen-id="SCR-MAIN-FORM"
      data-screen-name="新建${escapeHtml(aggLabel)}表单"
      data-screen-type="FORM"
      data-route="/${escapeHtml(aggName.toLowerCase())}/create"
      data-role-refs="ROLE-01"
      class="card"
      style="${alignment.entryPattern === 'INLINE_SPLIT' ? '' : 'display:none;'}"
    >
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <h3 style="margin:0; font-size:15px;">新建${escapeHtml(aggLabel)}（M1 绑定 + M3 校验）</h3>
        ${
          alignment.entryPattern === 'DRAWER' || alignment.entryPattern === 'MODAL'
            ? `<button type="button" class="btn" style="padding:3px 8px;" onclick="closeOverlay()">关闭 ×</button>`
            : ''
        }
      </div>
      <div class="form-row">
        <label>单据编码 (${escapeHtml(aggName)}.${escapeHtml(codeField)})</label>
        <input
          id="inp-code"
          data-element-id="EL-FORM-CODE"
          data-element-name="${escapeHtml(codeField)}"
          data-element-label="单据编码"
          data-element-type="INPUT"
          data-binding="${escapeHtml(aggName)}.${escapeHtml(codeField)}"
          value="DOC-2026-019"
        />
      </div>
      <div class="form-row">
        <label>业务事项名称 (${escapeHtml(aggName)}.${escapeHtml(titleField)})</label>
        <input
          id="inp-title"
          data-element-id="EL-FORM-TITLE"
          data-element-name="${escapeHtml(titleField)}"
          data-element-label="事项名称"
          data-element-type="INPUT"
          data-binding="${escapeHtml(aggName)}.${escapeHtml(titleField)}"
          placeholder="请输入${escapeHtml(aggLabel)}名称…"
        />
      </div>
      <div class="form-row">
        <label>业务金额 / 指标数值 (${escapeHtml(aggName)}.${escapeHtml(amountField)})</label>
        <input
          id="inp-amount"
          type="number"
          data-element-id="EL-FORM-AMOUNT"
          data-element-name="${escapeHtml(amountField)}"
          data-element-label="金额数值"
          data-element-type="NUMBER"
          data-binding="${escapeHtml(aggName)}.${escapeHtml(amountField)}"
          value="128000"
        />
      </div>
      <div style="display:flex; gap:8px; margin-top:14px;">
        <button
          type="button"
          class="btn btn-primary"
          data-element-id="EL-SUBMIT-CREATE"
          data-element-name="submitCreateBtn"
          data-element-label="提交并触发规则校验"
          data-element-type="BUTTON"
          data-event-id="UIE-SUBMIT-CREATE"
          data-event-name="提交创建${escapeHtml(aggLabel)}"
          data-behavior-ref="BHV-${escapeHtml(aggName.toUpperCase())}-CREATE"
          data-validate-ref="RULE-${escapeHtml(aggName.toUpperCase())}-THRESHOLD"
          onclick="submitCreateForm()"
        >
          提交保存
        </button>
      </div>
    </section>
  </div>

  <div id="overlay-host" class="overlay-backdrop" onclick="if(event.target===this) closeOverlay()">
    <div class="overlay-panel" id="overlay-mount"></div>
  </div>

  ${
    hasStepApproval
      ? `<section
          id="SCR-APPROVAL-FLOW"
          data-screen-id="SCR-APPROVAL-FLOW"
          data-screen-name="${escapeHtml(aggLabel)}审批看板"
          data-screen-type="APPROVAL"
          data-route="/${escapeHtml(aggName.toLowerCase())}/approval"
          data-role-refs="ROLE-02"
          class="card"
          style="display:none; margin-top:12px;"
        >
          <h3 style="margin-top:0; font-size:15px;">待办审批队列（主管复核放行）</h3>
          <p style="color:var(--muted); font-size:12.5px;">触发 M3 阈值规则的单据自动进入此队列，批准后进度条推进至完结。</p>
          <div id="approval-list" style="display:flex; flex-direction:column; gap:8px; margin-top:10px;"></div>
          <div style="margin-top:12px;">
            <button
              type="button"
              class="btn btn-primary"
              data-element-id="EL-BATCH-APPROVE"
              data-element-name="approveAllBtn"
              data-element-label="批准首条待审单据"
              data-element-type="BUTTON"
              data-event-id="UIE-APPROVE-ITEM"
              data-event-name="审批通过动作"
              data-behavior-ref="BHV-${escapeHtml(aggName.toUpperCase())}-APPROVE"
              onclick="approveNextPending()"
            >
              批准当前待审单据
            </button>
          </div>
        </section>`
      : ''
  }

  <script>
    const ENTRY_MODE = ${JSON.stringify(alignment.entryPattern)};
    const USE_TOAST = ${JSON.stringify(hasToast)};
    const USE_ACCORDION = ${JSON.stringify(hasAccordion)};
    let activeStatusChip = '';
    let expandedCode = '';
    let toastTimer = null;

    const rows = [
      { code: 'DOC-2026-016', title: '${escapeHtml(aggLabel)}年度重点协议 A', amount: 265000, status: 'PENDING_APPROVAL', note: '触发大额风控阈值 (>=10万)，等待部门主管二次复核签批。' },
      { code: 'DOC-2026-017', title: '常规标准执行批次单', amount: 42000, status: 'APPROVED', note: '已通过自动合规校验并同步下游台账。' },
      { code: 'DOC-2026-018', title: '季度补充履约申请单', amount: 98000, status: 'DRAFT', note: '经办人草拟中，待补充附件后提交。' },
    ];

    function notify(msg) {
      if (USE_TOAST) {
        const box = document.getElementById('corner-toast');
        const txt = document.getElementById('corner-toast-text');
        const bar = document.getElementById('corner-toast-bar');
        txt.textContent = msg;
        box.style.display = 'block';
        bar.style.animation = 'none';
        void bar.offsetWidth;
        bar.style.animation = 'toastCountdown 3.2s linear forwards';
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { box.style.display = 'none'; }, 3200);
      } else {
        const el = document.getElementById('status-banner');
        el.textContent = msg;
        el.style.display = 'block';
      }
    }

    function setChipFilter(st) {
      activeStatusChip = st;
      const sel = document.getElementById('filter-status');
      if (sel) sel.value = st;
      document.querySelectorAll('.filter-chip').forEach(btn => {
        const match = btn.getAttribute('data-chip') === st;
        btn.classList.toggle('active', match);
        const raw = btn.textContent.replace(/^✓\\s*/, '');
        btn.textContent = match ? ('✓ ' + raw) : raw;
      });
      renderRows();
    }

    function toggleRowAccordion(code) {
      expandedCode = expandedCode === code ? '' : code;
      renderRows();
    }

    function triggerRefreshSkeleton() {
      const tb = document.getElementById('ledger-tbody');
      tb.innerHTML = [1,2,3].map(() => '<tr><td colspan="5"><div class="skeleton-row"></div></td></tr>').join('');
      setTimeout(() => {
        renderRows();
        notify('✨ 列表数据已刷新同步');
      }, 460);
    }

    function showScreen(id, btn) {
      ['SCR-MAIN-LIST', 'SCR-MAIN-FORM', 'SCR-APPROVAL-FLOW'].forEach(sid => {
        const sec = document.getElementById(sid);
        if (!sec) return;
        if (ENTRY_MODE === 'INLINE_SPLIT' && (sid === 'SCR-MAIN-LIST' || sid === 'SCR-MAIN-FORM') && id === 'SCR-MAIN-LIST') {
          sec.style.display = '';
        } else {
          sec.style.display = sid === id ? '' : 'none';
        }
      });
      if (btn) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
      renderApprovalQueue();
    }

    function triggerCreateEntry() {
      if (ENTRY_MODE === 'DRAWER' || ENTRY_MODE === 'MODAL') {
        const formSec = document.getElementById('SCR-MAIN-FORM');
        const mount = document.getElementById('overlay-mount');
        if (formSec && mount && formSec.parentElement !== mount) {
          mount.appendChild(formSec);
        }
        if (formSec) formSec.style.display = '';
        document.getElementById('overlay-host').style.display = 'flex';
      } else if (ENTRY_MODE === 'DEDICATED_TAB') {
        showScreen('SCR-MAIN-FORM', document.querySelectorAll('.tab-btn')[1]);
      } else {
        document.getElementById('inp-title').focus();
        notify('右侧常驻表单已聚焦，可直接录入提交。');
      }
    }

    function closeOverlay() {
      document.getElementById('overlay-host').style.display = 'none';
    }

    function submitCreateForm() {
      const code = document.getElementById('inp-code').value.trim() || ('DOC-' + Math.floor(Math.random()*900+100));
      const title = document.getElementById('inp-title').value.trim() || '新建${escapeHtml(aggLabel)}事项';
      const amount = Number(document.getElementById('inp-amount').value || 0);
      if (amount <= 0) {
        notify('⚠️ [M3 规则拦截] 业务金额必须大于 0，当前值 ' + amount + ' 已拦截！');
        return;
      }
      const nextStatus = amount >= 100000 ? 'PENDING_APPROVAL' : 'APPROVED';
      rows.unshift({ code, title, amount, status: nextStatus, note: '新录入单据，已自动完成字段绑定与前置规则校验。' });
      closeOverlay();
      if (ENTRY_MODE === 'DEDICATED_TAB') {
        showScreen('SCR-MAIN-LIST', document.querySelectorAll('.tab-btn')[0]);
      }
      renderRows();
      notify(
        nextStatus === 'PENDING_APPROVAL'
          ? '✅ 已创建 ' + code + '（金额 >= 10万，自动进入待审批状态）'
          : '✅ 已创建 ' + code + '（已自动生效 APPROVED）'
      );
    }

    function approveNextPending() {
      const target = rows.find(r => r.status === 'PENDING_APPROVAL' || r.status === 'DRAFT');
      if (!target) {
        notify('当前所有单据均已审批完结（APPROVED）。');
        return;
      }
      target.status = 'APPROVED';
      renderRows();
      renderApprovalQueue();
      const fill2 = document.getElementById('step-fill-2');
      const node3 = document.getElementById('step-node-3');
      const dot3 = document.getElementById('step-dot-3');
      if (fill2) fill2.style.width = '100%';
      if (node3) node3.classList.add('done');
      if (dot3) dot3.textContent = '✓';
      notify('🎉 单据 ' + target.code + ' 已审批通过，流程推进至已生效！');
    }

    function renderApprovalQueue() {
      const box = document.getElementById('approval-list');
      if (!box) return;
      const pending = rows.filter(r => r.status === 'PENDING_APPROVAL');
      box.innerHTML = pending.length === 0
        ? '<div class="pill">暂无待审批单据</div>'
        : pending.map(r => '<div style="display:flex;justify-content:space-between;padding:8px 10px;border:1px solid var(--line);border-radius:6px;"><span><strong>' + r.code + '</strong> · ' + r.title + '</span><span>¥' + r.amount.toLocaleString() + ' · <span class="pill">PENDING_APPROVAL</span></span></div>').join('');
    }

    function renderRows() {
      const kw = (document.getElementById('filter-kw').value || '').toLowerCase();
      const st = activeStatusChip || document.getElementById('filter-status').value;
      const filtered = rows.filter(r => (!kw || r.code.toLowerCase().includes(kw) || r.title.toLowerCase().includes(kw)) && (!st || r.status === st));
      document.getElementById('ledger-tbody').innerHTML = filtered.map(r => {
        const mainRow =
          '<tr>' +
            '<td style="font-family:monospace;font-weight:600">' + r.code + '</td>' +
            '<td>' + r.title + '</td>' +
            '<td style="font-variant-numeric:tabular-nums">¥' + r.amount.toLocaleString() + '</td>' +
            '<td><span class="pill">' + r.status + '</span></td>' +
            '<td style="display:flex;gap:6px;">' +
              (USE_ACCORDION ? '<button class="btn" style="padding:3px 8px;font-size:11.5px" onclick="toggleRowAccordion(\\'' + r.code + '\\')">' + (expandedCode === r.code ? '收起明细 ▴' : '展开明细 ▾') + '</button>' : '') +
              '<button class="btn" style="padding:3px 8px;font-size:11.5px" onclick="approveNextPending()">推进状态</button>' +
            '</td>' +
          '</tr>';
        const accRow = (USE_ACCORDION && expandedCode === r.code)
          ? '<tr><td colspan="5"><div class="acc-detail">📋 审计与规则摘要：' + r.note + '</div></td></tr>'
          : '';
        return mainRow + accRow;
      }).join('');

      const kpiTotal = document.getElementById('kpi-total');
      const kpiPending = document.getElementById('kpi-pending');
      if (kpiTotal && kpiTotal.dataset.counted === '1') kpiTotal.textContent = String(25 + rows.length);
      if (kpiPending) kpiPending.textContent = String(rows.filter(r => r.status === 'PENDING_APPROVAL').length);
    }

    function animateKpiCountUp() {
      const el = document.getElementById('kpi-total');
      if (!el) return;
      const target = 25 + rows.length;
      let cur = 0;
      const timer = setInterval(() => {
        cur += 4;
        if (cur >= target) {
          el.textContent = String(target);
          el.dataset.counted = '1';
          clearInterval(timer);
        } else {
          el.textContent = String(cur);
        }
      }, 28);
    }

    renderRows();
    animateKpiCountUp();
  </script>
</body>
</html>`;
}

// ─── High-Res Screenshot Component with Offline Wireframe Fallback ───────────
function InspoShowcaseImage({
  item,
  variant = 'hero',
  className,
}: {
  item: InspoReferenceItem;
  variant?: 'hero' | 'full' | 'mobile';
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src =
    variant === 'full'
      ? inspoFullUrl(item.slug)
      : variant === 'mobile'
        ? inspoMobileUrl(item.slug)
        : inspoHeroUrl(item.slug);

  if (failed) {
    const bg = item.surfaceHex || (item.mode === 'dark' ? '#0f172a' : '#f8fafc');
    const fg = item.mode === 'dark' ? '#e2e8f0' : '#1e293b';
    const acc = item.palette[0] || '#4c50c4';
    return (
      <div
        className={cn('flex flex-col justify-between p-6', className)}
        style={{ background: bg, color: fg }}
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-[13px] font-semibold opacity-80">{item.title}</span>
          <span className="h-3 w-12 rounded-full" style={{ background: acc }} />
        </div>
        <div className="my-6 space-y-2.5">
          <div className="h-4 w-2/3 rounded opacity-80" style={{ background: fg }} />
          <div className="h-3 w-1/2 rounded opacity-35" style={{ background: fg }} />
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {item.palette.slice(0, 3).map((sw, idx) => (
            <div
              key={`${sw}-${idx}`}
              className="h-14 rounded-md border border-white/15"
              style={{ background: sw }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={`${item.title} large desktop interface reference`}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn('block w-full object-cover object-top', className)}
    />
  );
}

// ─── Reusable Per-Reference "Why I Like It" Reason Editor ───────────────────
function ReferenceLikedReasonsEditor({
  pref,
  onToggleAspect,
  onToggleSwatch,
  onChangeReasonNote,
  compact = false,
}: {
  pref: SelectedInspoPreference;
  onToggleAspect: (slug: string, aspect: LikedAspectKey) => void;
  onToggleSwatch: (slug: string, hex: string) => void;
  onChangeReasonNote: (slug: string, note: string) => void;
  compact?: boolean;
}) {
  const { t } = usePreferences();
  const noteId = useId();
  const item = pref.item;

  const candidateSwatches = useMemo(() => {
    const uniq = new Map<string, string>();
    uniq.set(item.surfaceHex.toLowerCase(), item.surfaceHex);
    for (const hex of item.palette) {
      if (!uniq.has(hex.toLowerCase())) {
        uniq.set(hex.toLowerCase(), hex);
      }
    }
    return [...uniq.values()].slice(0, 6);
  }, [item.surfaceHex, item.palette]);

  return (
    <div
      className={cn(
        'flex flex-col gap-2.5 rounded-control border border-accent/35 bg-accent-tint/35 p-3',
        compact && 'p-2.5',
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink">
          <MessageSquarePlus size={13} className="text-accent" />
          {t(
            `告诉 Agent 您喜欢「${item.title}」的哪些地方（可多选 + 写备注）：`,
            `What do you like about "${item.title}"? (Multi-select + note for Agent):`,
          )}
        </span>
      </div>

      {/* Aspect Quick Pills */}
      <div className="flex flex-wrap gap-1.5">
        {LIKED_ASPECT_OPTIONS.map((opt) => {
          const active = pref.likedAspects.includes(opt.key);
          const dotColor =
            opt.key === 'bgColor'
              ? item.surfaceHex
              : opt.key === 'accentColor'
                ? item.palette[0]
                : undefined;
          return (
            <button
              key={opt.key}
              type="button"
              aria-pressed={active}
              onClick={() => onToggleAspect(item.slug, opt.key)}
              className={cn(
                'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                active
                  ? 'border-accent bg-accent text-white shadow-2xs'
                  : 'border-line bg-surface text-ink-2 hover:border-accent/60 hover:text-ink',
              )}
            >
              {dotColor && (
                <span
                  className="inline-block h-3 w-3 rounded-full border border-black/25"
                  style={{ background: dotColor }}
                />
              )}
              {active && <Check size={11} strokeWidth={2.5} />}
              <span>{t(opt.labelZh, opt.labelEn)}</span>
            </button>
          );
        })}
      </div>

      {/* Specific Color Swatch Pinning */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
        <span className="text-ink-3">{t('点选指定喜欢的颜色：', 'Pin favorite colors:')}</span>
        {candidateSwatches.map((hex, i) => {
          const pinned = pref.likedSwatches.some((s) => s.toLowerCase() === hex.toLowerCase());
          const isBg = i === 0;
          return (
            <button
              key={hex}
              type="button"
              aria-pressed={pinned}
              onClick={() => onToggleSwatch(item.slug, hex)}
              title={hex}
              className={cn(
                'inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] transition-all',
                pinned
                  ? 'border-accent bg-surface font-semibold text-ink ring-2 ring-accent/35'
                  : 'border-line bg-surface/80 text-ink-3 hover:border-accent/60 hover:text-ink',
              )}
            >
              <span
                className="inline-block h-3 w-3 rounded-full border border-black/20"
                style={{ background: hex }}
              />
              <span>{isBg ? `${hex} (${t('底色', 'BG')})` : hex}</span>
              {pinned && <Check size={10.5} className="text-accent" />}
            </button>
          );
        })}
      </div>

      {/* Freeform Liked Reason Input */}
      <div className="flex flex-col gap-1">
        <label htmlFor={noteId} className="visually-hidden">
          {t('补充喜欢的原因', 'Why you like this reference')}
        </label>
        <input
          id={noteId}
          type="text"
          className="input bg-surface text-[12.5px]"
          placeholder={t(
            '补充具体喜欢的原因（例如：喜欢它柔和的米白背景颜色，但按钮想更大一点；喜欢顶部的清爽留白…）',
            'Add specific reason (e.g., love the soft warm background color and clean header spacing…)',
          )}
          value={pref.reasonNote}
          onChange={(e) => onChangeReasonNote(item.slug, e.target.value)}
        />
      </div>
    </div>
  );
}

// ─── Native <dialog closedby="any"> Full-Viewport Lightbox Modal ─────────────
function InspoPreviewDialog({
  item,
  selectedPref,
  onToggleSelect,
  onToggleAspect,
  onToggleSwatch,
  onChangeReasonNote,
  onFindSimilar,
  onClose,
}: {
  item: InspoReferenceItem | null;
  selectedPref: SelectedInspoPreference | undefined;
  onToggleSelect: (item: InspoReferenceItem) => void;
  onToggleAspect: (slug: string, aspect: LikedAspectKey) => void;
  onToggleSwatch: (slug: string, hex: string) => void;
  onChangeReasonNote: (slug: string, note: string) => void;
  onFindSimilar: (item: InspoReferenceItem) => void;
  onClose: () => void;
}) {
  const { t } = usePreferences();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const headingId = useId();
  const [tab, setTab] = useState<'HERO' | 'FULL' | 'MOBILE' | 'DESIGN_MD'>('HERO');
  const [designMd, setDesignMd] = useState<string>('');
  const [loadingMd, setLoadingMd] = useState(false);

  useEffect(() => {
    setTab('HERO');
    setDesignMd('');
  }, [item?.slug]);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (item) {
      if (!dlg.open) {
        dlg.showModal();
      }
    } else if (dlg.open) {
      dlg.close();
    }
  }, [item]);

  // Fallback light-dismiss for browsers where HTMLDialogElement.prototype.closedBy is absent (e.g., Safari)
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg || typeof HTMLDialogElement === 'undefined') return;
    if ('closedBy' in HTMLDialogElement.prototype) return;

    const isOutside = (e: PointerEvent) => {
      const r = dlg.getBoundingClientRect();
      return (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      );
    };
    let pressedOutside = false;
    const onDown = (e: PointerEvent) => {
      pressedOutside = e.target === dlg && isOutside(e);
    };
    const onUp = (e: PointerEvent) => {
      if (pressedOutside && e.target === dlg && isOutside(e)) {
        dlg.close();
      }
      pressedOutside = false;
    };
    dlg.addEventListener('pointerdown', onDown);
    dlg.addEventListener('pointerup', onUp);
    return () => {
      dlg.removeEventListener('pointerdown', onDown);
      dlg.removeEventListener('pointerup', onUp);
    };
  }, []);

  useEffect(() => {
    if (!item || tab !== 'DESIGN_MD' || designMd) return;
    let cancelled = false;
    setLoadingMd(true);
    fetch('/api/prototype-inspo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'design_system', slug: item.slug }),
    })
      .then((r) => r.json())
      .then((j: { ok?: boolean; markdown?: string }) => {
        if (cancelled) return;
        setDesignMd(
          j.markdown ||
            `# ${item.title} — Extracted Design System\n\n- **Mode**: ${item.mode}\n- **Surface**: ${item.surfaceHex}\n- **Macrostructure**: ${item.macro}\n- **Fonts**: ${item.fonts.join(', ')}\n- **Palette**: ${item.palette.join(', ')}\n- **Northstar**: ${item.northstar}`,
        );
      })
      .catch(() => {
        if (!cancelled) {
          setDesignMd(
            `# ${item.title} — Design DNA\n\n- Mode: ${item.mode}\n- Surface: ${item.surfaceHex}\n- Palette: ${item.palette.join(', ')}\n- Fonts: ${item.fonts.join(', ')}`,
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingMd(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item, tab, designMd]);

  const isSelected = Boolean(selectedPref);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      className="inspo-lightbox-dialog"
      onClose={(e) => {
        e.currentTarget.returnValue = '';
        onClose();
      }}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      {item && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 id={headingId} className="m-0 font-serif text-[18px] font-semibold text-ink">
                {item.title}
              </h2>
              <span className="badge badge-accent">{t(item.plainLabelZh, item.plainLabelEn)}</span>
              <div className="flex items-center gap-1">
                {[item.surfaceHex, ...item.palette.slice(0, 5)].map((hex, i) => (
                  <span
                    key={`${hex}-${i}`}
                    title={hex}
                    className="h-4 w-4 rounded-full border border-black/20"
                    style={{ background: hex }}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  onFindSimilar(item);
                  dialogRef.current?.close();
                }}
              >
                <Sparkles size={13} />
                {t('找相似风格大图', 'More Like This')}
              </Button>
              <Button
                type="button"
                variant={isSelected ? 'secondary' : 'accent'}
                size="sm"
                onClick={() => onToggleSelect(item)}
              >
                <Check size={13} />
                {isSelected
                  ? t('已选入参考篮（点击取消）', 'Selected')
                  : t('选为我的 UI 参考并写原因', 'Pick & Add Reason')}
              </Button>
              <button
                type="button"
                onClick={() => dialogRef.current?.close()}
                aria-label={t('关闭大图预览', 'Close preview')}
                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-control text-ink-3 hover:bg-inset hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {selectedPref && (
            <div className="border-b border-line bg-surface px-5 py-2.5">
              <ReferenceLikedReasonsEditor
                pref={selectedPref}
                onToggleAspect={onToggleAspect}
                onToggleSwatch={onToggleSwatch}
                onChangeReasonNote={onChangeReasonNote}
                compact
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-inset/50 px-5 py-2 text-[12px]">
            <Button
              type="button"
              variant="toggle"
              size="xs"
              aria-pressed={tab === 'HERO'}
              onClick={() => setTab('HERO')}
            >
              <Monitor size={12} />
              {t('1440p 桌面首屏高清大图', '1440p Desktop Hero')}
            </Button>
            <Button
              type="button"
              variant="toggle"
              size="xs"
              aria-pressed={tab === 'FULL'}
              onClick={() => setTab('FULL')}
            >
              <Layers size={12} />
              {t('整页长滚动完整实拍', 'Full-Page Capture')}
            </Button>
            <Button
              type="button"
              variant="toggle"
              size="xs"
              aria-pressed={tab === 'MOBILE'}
              onClick={() => setTab('MOBILE')}
            >
              <Smartphone size={12} />
              {t('手机端实拍', 'Mobile View')}
            </Button>
            <Button
              type="button"
              variant="toggle"
              size="xs"
              aria-pressed={tab === 'DESIGN_MD'}
              onClick={() => setTab('DESIGN_MD')}
            >
              <FileText size={12} />
              {t('自动提取的设计令牌 (DESIGN.md)', 'Extracted DESIGN.md')}
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto bg-inset p-5">
            {tab === 'DESIGN_MD' ? (
              loadingMd ? (
                <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-ink-3">
                  <Loader2 size={16} className="animate-spin" />
                  {t('正在拉取站点 DESIGN.md 令牌…', 'Fetching DESIGN.md tokens…')}
                </div>
              ) : (
                <pre className="overflow-x-auto rounded-card border border-line bg-surface p-4 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink">
                  {designMd}
                </pre>
              )
            ) : tab === 'MOBILE' ? (
              <div className="mx-auto max-w-[390px] overflow-hidden rounded-[22px] border-4 border-ink/20 bg-surface shadow-lg">
                <InspoShowcaseImage item={item} variant="mobile" className="h-auto" />
              </div>
            ) : (
              <div className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
                <InspoShowcaseImage
                  item={item}
                  variant={tab === 'FULL' ? 'full' : 'hero'}
                  className="h-auto"
                />
              </div>
            )}
          </div>
        </>
      )}
    </dialog>
  );
}

export interface PrototypeCoDesignStudioProps {
  project: ProjectDetail;
  docs: RequirementDoc[];
  selectedDocId: string;
  onSelectDocId: (docId: string) => void;
  prototypes: PrototypeArtifact[];
  selectedProtoId: string;
  onSelectProtoId: (id: string) => void;
  activeStep: 1 | 2 | 3;
  onStepChange: (step: 1 | 2 | 3) => void;
  previewSource: 'REFERENCE_DRAFT' | 'SAVED_PROTO';
  onPreviewSourceChange: (src: 'REFERENCE_DRAFT' | 'SAVED_PROTO') => void;
  savedHtmlContent: string;
  onSavedHtmlContentChange: (html: string) => void;
  onDraftHtmlChange: (html: string, refTitleSummary: string) => void;
  onSaveDraftAsPrototype: (html: string, refTitleSummary: string) => Promise<void>;
  onGenerateWithAi: (compiledPrompt: string, docId?: string) => Promise<void>;
  onCloneVersion: () => void;
  onDeleteProto: (proto: PrototypeArtifact) => void;
  onDownloadHtml: (html: string, name?: string) => void;
  inspectMode: boolean;
  onInspectModeChange: (next: boolean) => void;
  visualAnnotations: PrototypeVisualAnnotation[];
  onAddVisualAnnotation: (target: PrototypeSelectionTarget, note: string) => void;
  onRemoveVisualAnnotation: (id: string) => void;
  onClearVisualAnnotations: () => void;
  refineInstruction: string;
  onRefineInstructionChange: (val: string) => void;
  onApplyRefine: (
    activeHtml: string,
    immediateDraft?: { target: PrototypeSelectionTarget; note: string },
  ) => Promise<void>;
  isBusyProto: boolean;
}

export function PrototypeCoDesignStudio({
  project,
  docs,
  selectedDocId,
  onSelectDocId,
  prototypes,
  selectedProtoId,
  onSelectProtoId,
  activeStep,
  onStepChange,
  previewSource,
  onPreviewSourceChange,
  savedHtmlContent,
  onSavedHtmlContentChange,
  onDraftHtmlChange,
  onSaveDraftAsPrototype,
  onGenerateWithAi,
  onCloneVersion,
  onDeleteProto,
  onDownloadHtml,
  inspectMode,
  onInspectModeChange,
  visualAnnotations,
  onAddVisualAnnotation,
  onRemoveVisualAnnotation,
  onClearVisualAnnotations,
  refineInstruction,
  onRefineInstructionChange,
  onApplyRefine,
  isBusyProto,
}: PrototypeCoDesignStudioProps) {
  const { locale, t } = usePreferences();

  const [catalog, setCatalog] = useState<InspoReferenceItem[]>(CURATED_INSPO_CATALOG);
  const [searching, setSearching] = useState(false);
  const [vibe, setVibe] = useState<'ALL' | InspoReferenceItem['vibeGroup']>('ALL');
  const [searchInput, setSearchInput] = useState('');
  const [galleryColumns, setGalleryColumns] = useState<'2-UP' | '1-UP'>('2-UP');
  const [captureVariant, setCaptureVariant] = useState<'hero' | 'full'>('hero');
  const [inspectingItem, setInspectingItem] = useState<InspoReferenceItem | null>(null);

  const [selectedPrefs, setSelectedPrefs] = useState<SelectedInspoPreference[]>(() => [
    {
      item: CURATED_INSPO_CATALOG[0]!,
      likedAspects: ['bgColor', 'accentColor', 'spacing'],
      likedSwatches: [],
      reasonNote: '',
    },
  ]);

  const [alignment, setAlignment] =
    useState<RequirementAlignmentState>(DEFAULT_ALIGNMENT_STATE);
  const [customNoteDraft, setCustomNoteDraft] = useState('');
  const [studioViewMode, setStudioViewMode] = useState<'PREVIEW' | 'SPLIT' | 'HTML'>('PREVIEW');

  const activeDoc = docs.find((d) => d.id === selectedDocId) ?? docs[0];
  const currentSavedProto =
    prototypes.find((p) => p.id === selectedProtoId) ?? prototypes[0];

  const draftHtml = useMemo(
    () => buildReferenceStyledPrototypeHtml(project, activeDoc, selectedPrefs, alignment),
    [project, activeDoc, selectedPrefs, alignment],
  );

  const refTitleSummary = useMemo(
    () => selectedPrefs.map((p) => p.item.title).join(' + ') || 'Inspo',
    [selectedPrefs],
  );

  useEffect(() => {
    onDraftHtmlChange(draftHtml, refTitleSummary);
  }, [draftHtml, refTitleSummary]);

  const compiledAgentPrompt = useMemo(
    () => buildAgentPrototypeContextPrompt(selectedPrefs, alignment, locale),
    [selectedPrefs, alignment, locale],
  );

  const displayedHtml =
    previewSource === 'SAVED_PROTO' && currentSavedProto
      ? savedHtmlContent
      : draftHtml;

  const muCounts = useMemo(() => {
    if (!displayedHtml.trim()) {
      return { screens: 0, elements: 0, bindings: 0, events: 0 };
    }
    try {
      const mu = extractMuFromPrototypeHtml(displayedHtml, project.domain);
      let elements = 0;
      let bindings = 0;
      let events = 0;
      for (const s of mu.screens) {
        elements += s.elements.length;
        bindings += s.elements.filter((e) => Boolean(e.dataBinding)).length;
        events += s.events.length;
      }
      return { screens: mu.screens.length, elements, bindings, events };
    } catch {
      return { screens: 0, elements: 0, bindings: 0, events: 0 };
    }
  }, [displayedHtml, project.domain]);

  const visibleItems = useMemo(
    () => (vibe === 'ALL' ? catalog : catalog.filter((i) => i.vibeGroup === vibe)),
    [catalog, vibe],
  );

  const primaryAccent = useMemo(() => {
    const donor =
      selectedPrefs.find((p) => p.likedAspects.includes('accentColor')) ??
      selectedPrefs[0];
    return donor?.likedSwatches[0] || donor?.item.palette[0] || '#2563eb';
  }, [selectedPrefs]);

  const mergeLiveItems = (incoming: InspoReferenceItem[]) => {
    if (incoming.length === 0) return;
    setCatalog((prev) => {
      const bySlug = new Map<string, InspoReferenceItem>();
      for (const item of incoming) bySlug.set(item.slug, item);
      for (const item of prev) {
        if (!bySlug.has(item.slug)) bySlug.set(item.slug, item);
      }
      return [...bySlug.values()];
    });
  };

  const handleLiveSearch = async (query: string) => {
    setSearching(true);
    try {
      const res = await fetch('/api/prototype-inspo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'search', query }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        items?: Parameters<typeof normalizeLiveInspoItem>[0][];
      };
      if (json.ok && json.items && json.items.length > 0) {
        mergeLiveItems(json.items.map(normalizeLiveInspoItem));
        setVibe('ALL');
      }
    } catch {
      // Offline fallback to curated catalog
    } finally {
      setSearching(false);
    }
  };

  const handleFindSimilar = async (target: InspoReferenceItem) => {
    setSearching(true);
    try {
      const res = await fetch('/api/prototype-inspo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'similar', slug: target.slug }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        items?: Parameters<typeof normalizeLiveInspoItem>[0][];
      };
      if (json.ok && json.items && json.items.length > 0) {
        mergeLiveItems(json.items.map(normalizeLiveInspoItem));
        setVibe('ALL');
      }
    } catch {
      // Offline fallback
    } finally {
      setSearching(false);
    }
  };

  const handleToggleRef = (item: InspoReferenceItem) => {
    setSelectedPrefs((prev) => {
      const exists = prev.some((p) => p.item.slug === item.slug);
      if (exists) {
        return prev.length > 1 ? prev.filter((p) => p.item.slug !== item.slug) : prev;
      }
      const nextPref: SelectedInspoPreference = {
        item,
        likedAspects: prev.length === 0 ? ['bgColor', 'accentColor'] : ['bgColor'],
        likedSwatches: [],
        reasonNote: '',
      };
      return [...prev, nextPref].slice(-3);
    });
  };

  const handleToggleAspect = (slug: string, aspect: LikedAspectKey) => {
    setSelectedPrefs((prev) =>
      prev.map((p) => {
        if (p.item.slug !== slug) return p;
        const has = p.likedAspects.includes(aspect);
        return {
          ...p,
          likedAspects: has
            ? p.likedAspects.filter((k) => k !== aspect)
            : [...p.likedAspects, aspect],
        };
      }),
    );
  };

  const handleToggleSwatch = (slug: string, hex: string) => {
    setSelectedPrefs((prev) =>
      prev.map((p) => {
        if (p.item.slug !== slug) return p;
        const has = p.likedSwatches.some((s) => s.toLowerCase() === hex.toLowerCase());
        return {
          ...p,
          likedSwatches: has
            ? p.likedSwatches.filter((s) => s.toLowerCase() !== hex.toLowerCase())
            : [...p.likedSwatches, hex],
        };
      }),
    );
  };

  const handleChangeReasonNote = (slug: string, note: string) => {
    setSelectedPrefs((prev) =>
      prev.map((p) => (p.item.slug === slug ? { ...p, reasonNote: note } : p)),
    );
  };

  const totalReasonSignals = useMemo(
    () =>
      selectedPrefs.reduce(
        (acc, p) =>
          acc +
          p.likedAspects.length +
          p.likedSwatches.length +
          (p.reasonNote.trim() ? 1 : 0),
        0,
      ),
    [selectedPrefs],
  );

  return (
    <div className="flex flex-col gap-3.5">
      {/* ─── 3-Stage Stepper Header (Workflow A) ─── */}
      <div className="card flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {[
            {
              n: 1 as const,
              zh: '① 挑选参考大图与喜欢原因',
              en: '1. Pick Large References & Liked Reasons',
              sub: t(
                `已选 ${selectedPrefs.length} 张 · ${totalReasonSignals} 项偏好`,
                `${selectedPrefs.length} refs · ${totalReasonSignals} cues`,
              ),
            },
            {
              n: 2 as const,
              zh: '② 动态示意图交互对齐',
              en: '2. Visual Schematic Alignment',
              sub: t(
                `${1 + 1 + alignment.interactiveParts.length + alignment.feedbackMotions.length} 项图解`,
                `${2 + alignment.interactiveParts.length + alignment.feedbackMotions.length} specs`,
              ),
            },
            {
              n: 3 as const,
              zh: '③ 交互原型沙箱与精修',
              en: '3. Interactive Prototype Studio',
              sub:
                prototypes.length > 0
                  ? t(`已有 ${prototypes.length} 版 · MU 就绪`, `${prototypes.length} ver · MU`)
                  : 'Live HTML5',
            },
          ].map((s, idx) => (
            <React.Fragment key={s.n}>
              {idx > 0 && <ArrowRight size={13} className="text-ink-3" />}
              <button
                type="button"
                data-testid={`proto-step-${s.n}`}
                onClick={() => onStepChange(s.n)}
                className={cn(
                  'inline-flex cursor-pointer items-center gap-2 rounded-control border px-3 py-1.5 text-left text-[12.5px] transition-colors',
                  activeStep === s.n
                    ? 'border-accent bg-accent-tint font-semibold text-ink'
                    : 'border-line bg-surface text-ink-2 hover:border-accent/50',
                )}
              >
                <span>{t(s.zh, s.en)}</span>
                <span className="rounded-full bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-ink-3">
                  {s.sub}
                </span>
              </button>
            </React.Fragment>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeStep === 1 && (
            <Button
              type="button"
              variant="accent"
              size="sm"
              data-testid="proto-next-to-step-2"
              onClick={() => onStepChange(2)}
            >
              {t('选好了，下一步看动态示意图对齐交互', 'Next: Visual Schematic Alignment')}
              <ArrowRight size={13.5} />
            </Button>
          )}
          {activeStep === 2 && (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  onPreviewSourceChange('REFERENCE_DRAFT');
                  onStepChange(3);
                }}
              >
                <Eye size={13.5} />
                {t('先看实时合成原型', 'Instant Live Preview')}
              </Button>
              <Button
                type="button"
                variant="accent"
                size="sm"
                disabled={isBusyProto}
                onClick={() => {
                  onStepChange(3);
                  void onGenerateWithAi(compiledAgentPrompt, selectedDocId || undefined);
                }}
              >
                <Sparkles size={13.5} />
                {t('让 Agent 按全部上下文生成原型', 'Generate Prototype with Agent')}
              </Button>
            </>
          )}
          {activeStep === 3 && (
            <span className="badge badge-ok font-mono">
              MU: {muCounts.screens} Screens · {muCounts.elements} Elements · {muCounts.events} Events
            </span>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          STAGE 1: LARGE SHOWCASE GALLERY + PER-REFERENCE LIKED REASONS
         ═══════════════════════════════════════════════════════════════════════ */}
      {activeStep === 1 && (
        <div className="card flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3.5">
            <div className="max-w-[720px]">
              <h3 className="m-0 font-serif text-[18px] font-semibold text-ink">
                {t(
                  '第一步：从高清大图里挑 1～3 张喜欢的界面，并勾一下「喜欢它哪里」',
                  'Step 1: Pick 1–3 Full-Size Reference Captures & Note What You Like',
                )}
              </h3>
              <p className="m-0 mt-1 text-[13px] leading-relaxed text-ink-2">
                {t(
                  '全部采用 1440p 桌面高清实拍大图展示。选中任意参考图后，可以直接在图下方勾选或填写喜欢的原因（比如「喜欢它的暖米白背景颜色」「喜欢它的按钮配色」），后续 Agent 会把这些偏好精准融合进您的业务原型。',
                  'Shown as crisp 1440p desktop captures. After picking any card, tag or write why you like it (e.g., background color, button accent, airy spacing) so the Agent knows exactly what to borrow.',
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <form
                className="flex items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleLiveSearch(searchInput);
                }}
              >
                <input
                  className="input w-[220px]"
                  placeholder={t('搜风格：如 深色大屏 / 温暖纸感…', 'Search live gallery…')}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
                <Button type="submit" variant="secondary" size="sm" disabled={searching}>
                  {searching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                  {t('搜库', 'Search')}
                </Button>
              </form>
            </div>
          </div>

          {/* Filter Pills + Large Layout Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {VIBE_FILTERS.map((vf) => (
                <button
                  key={vf.key}
                  type="button"
                  onClick={() => setVibe(vf.key)}
                  className={cn(
                    'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
                    vibe === vf.key
                      ? 'border-accent bg-accent text-white'
                      : 'border-line bg-inset/60 text-ink-2 hover:border-accent/60 hover:text-ink',
                  )}
                >
                  <span>{vf.emoji}</span>
                  <span>{t(vf.labelZh, vf.labelEn)}</span>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <div className="inline-flex items-center rounded-control border border-line bg-inset p-0.5">
                <button
                  type="button"
                  onClick={() => setGalleryColumns('2-UP')}
                  className={cn(
                    'inline-flex cursor-pointer items-center gap-1 rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium',
                    galleryColumns === '2-UP'
                      ? 'bg-surface text-ink shadow-hairline'
                      : 'text-ink-3 hover:text-ink',
                  )}
                >
                  <Columns2 size={12} />
                  {t('大图双列', 'Large 2-Up')}
                </button>
                <button
                  type="button"
                  onClick={() => setGalleryColumns('1-UP')}
                  className={cn(
                    'inline-flex cursor-pointer items-center gap-1 rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium',
                    galleryColumns === '1-UP'
                      ? 'bg-surface text-ink shadow-hairline'
                      : 'text-ink-3 hover:text-ink',
                  )}
                >
                  <RectangleHorizontal size={12} />
                  {t('超宽巨幕单列', 'Cinema 1-Up')}
                </button>
              </div>

              <Button
                type="button"
                variant="toggle"
                size="xs"
                aria-pressed={captureVariant === 'full'}
                onClick={() => setCaptureVariant((v) => (v === 'hero' ? 'full' : 'hero'))}
              >
                <Layers size={12} />
                {captureVariant === 'full'
                  ? t('当前：整页长图局部', 'Showing: Full Page')
                  : t('切换整页长图预览', 'Preview Full Page')}
              </Button>
            </div>
          </div>

          {/* Large 16:10 Browser-Framed Showcase Grid */}
          <div
            className={cn(
              'grid gap-5',
              galleryColumns === '1-UP'
                ? 'grid-cols-1'
                : 'grid-cols-1 lg:grid-cols-2',
            )}
          >
            {visibleItems.map((item) => {
              const pref = selectedPrefs.find((p) => p.item.slug === item.slug);
              const selected = Boolean(pref);

              return (
                <article
                  key={item.slug}
                  className={cn(
                    'group flex flex-col overflow-hidden rounded-window border bg-surface transition-all',
                    selected
                      ? 'border-accent ring-2 ring-accent/30 shadow-sm'
                      : 'border-line hover:border-accent/55 hover:shadow-xs',
                  )}
                >
                  {/* Browser Chrome Header Bar */}
                  <div className="flex items-center justify-between gap-2 border-b border-line bg-inset/70 px-3.5 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="flex items-center gap-1" aria-hidden="true">
                        <span className="h-2.5 w-2.5 rounded-full bg-ink/18" />
                        <span className="h-2.5 w-2.5 rounded-full bg-ink/18" />
                        <span className="h-2.5 w-2.5 rounded-full bg-ink/18" />
                      </span>
                      <span className="truncate font-semibold text-[13.5px] text-ink">
                        {item.title}
                      </span>
                      <span className="badge badge-accent">
                        {t(item.plainLabelZh, item.plainLabelEn)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-ink-2">
                        {item.mode === 'dark'
                          ? t('🌙 深色底', 'Dark')
                          : t('☀️ 浅色底', 'Light')}
                      </span>
                      <button
                        type="button"
                        onClick={() => setInspectingItem(item)}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-control border border-line bg-surface px-2.5 py-1 text-[11.5px] font-medium text-ink-2 hover:border-accent hover:text-accent"
                      >
                        <Maximize2 size={11.5} />
                        {t('全屏看原图', 'Full Lightbox')}
                      </button>
                    </div>
                  </div>

                  {/* Large Crisp 1440p Screenshot Viewport */}
                  <div
                    onClick={() => handleToggleRef(item)}
                    className={cn(
                      'relative w-full cursor-pointer overflow-hidden bg-inset',
                      galleryColumns === '1-UP' ? 'aspect-[16/9]' : 'aspect-[16/10]',
                    )}
                  >
                    <InspoShowcaseImage
                      item={item}
                      variant={captureVariant}
                      className="h-full w-full transition-transform duration-300 group-hover:scale-[1.015]"
                    />
                    {selected && (
                      <div className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-[12px] font-semibold text-white shadow-md">
                        <Check size={13} strokeWidth={2.5} />
                        {t('已选入参考篮', 'Selected')}
                      </div>
                    )}
                  </div>

                  {/* Card Footer + Inline "Why I Like It" Reason Composer when Selected */}
                  <div className="flex flex-col gap-3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2.5">
                      <p className="m-0 flex-1 min-w-[200px] text-[12.5px] leading-relaxed text-ink-2">
                        {t(item.plainDescZh, item.plainDescEn)}
                      </p>

                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1" title={t('提取色板（首枚为背景底色）', 'Extracted surface & palette')}>
                          {[item.surfaceHex, ...item.palette.slice(0, 4)].map((hex, idx) => (
                            <span
                              key={`${hex}-${idx}`}
                              title={idx === 0 ? `${hex} (背景底色)` : hex}
                              className="h-4 w-4 rounded-full border border-black/20"
                              style={{ background: hex }}
                            />
                          ))}
                        </div>

                        <button
                          type="button"
                          onClick={() => void handleFindSimilar(item)}
                          className="cursor-pointer rounded-control px-2 py-1 text-[11.5px] text-ink-2 hover:bg-inset hover:text-accent"
                        >
                          {t('找相似', 'Similar')}
                        </button>

                        <Button
                          type="button"
                          variant={selected ? 'secondary' : 'accent'}
                          size="sm"
                          onClick={() => handleToggleRef(item)}
                        >
                          {selected ? (
                            <>
                              <Check size={13} />
                              {t('已选中', 'Picked')}
                            </>
                          ) : (
                            t('选这张参考', 'Pick This')
                          )}
                        </Button>
                      </div>
                    </div>

                    {pref && (
                      <ReferenceLikedReasonsEditor
                        pref={pref}
                        onToggleAspect={handleToggleAspect}
                        onToggleSwatch={handleToggleSwatch}
                        onChangeReasonNote={handleChangeReasonNote}
                      />
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          {/* Bottom Step Advancement Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-accent/35 bg-accent-tint/30 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <Palette size={15} className="text-accent" />
              <span>
                {t('当前已选参考：', 'Selected references: ')}
                <strong>{refTitleSummary}</strong>
              </span>
              <span className="text-ink-3">
                {t(
                  `（已记录 ${totalReasonSignals} 项颜色/背景/质感偏好，将在下一步与动态示意图一起交给 Agent）`,
                  `(${totalReasonSignals} style/color reasons recorded for the Agent)`,
                )}
              </span>
            </div>
            <Button
              type="button"
              variant="accent"
              size="md"
              onClick={() => onStepChange(2)}
            >
              {t('进入下一阶段：看动态示意图对齐交互 →', 'Next Stage: Visual Schematic Alignment →')}
            </Button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          STAGE 2: MOTION-PROMPT SCHEMATICS + AGENT CONTEXT BLUEPRINT
         ═══════════════════════════════════════════════════════════════════════ */}
      {activeStep === 2 && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.45fr_0.85fr]">
          {/* Left: Visual Motion Schematics + Extra Business Note */}
          <div className="card flex flex-col gap-4">
            <MotionSchematicGallery
              alignment={alignment}
              setAlignment={setAlignment}
              accentColor={primaryAccent}
            />

            {/* Freeform Domain Alignment Note */}
            <div className="rounded-card border border-line bg-inset/45 p-3.5">
              <div className="mb-2 text-[13px] font-semibold text-ink">
                5. {t('还有其他具体业务场景或页面细节想叮嘱 Agent 吗？（选填）', '5. Any extra business details for the Agent? (Optional)')}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!customNoteDraft.trim()) return;
                  setAlignment((prev) => ({
                    ...prev,
                    customNotes: [...prev.customNotes, customNoteDraft.trim()],
                  }));
                  setCustomNoteDraft('');
                }}
              >
                <input
                  className="input flex-1 bg-surface"
                  placeholder={t(
                    '例如：超过 10 万金额标红预警、列表增加「所属部门」筛选、字号稍微大一点方便财务人员核对…',
                    'e.g., Highlight amounts over 100k in red, add a Department filter…',
                  )}
                  value={customNoteDraft}
                  onChange={(e) => setCustomNoteDraft(e.target.value)}
                />
                <Button type="submit" variant="secondary" size="sm">
                  <Send size={13} />
                  {t('添加备注', 'Add Note')}
                </Button>
              </form>

              {alignment.customNotes.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {alignment.customNotes.map((n, idx) => (
                    <span
                      key={`${idx}-${n}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-0.5 text-[12px] text-ink"
                    >
                      <span>✓ {n}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setAlignment((prev) => ({
                            ...prev,
                            customNotes: prev.customNotes.filter((_, i) => i !== idx),
                          }))
                        }
                        className="cursor-pointer text-ink-3 hover:text-red"
                      >
                        <X size={11.5} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Complete Agent Context Summary + SRS Selector + Generation Actions */}
          <div className="card flex flex-col justify-between gap-4 self-start">
            <div className="flex flex-col gap-3.5">
              <div className="border-b border-line pb-2.5">
                <div className="text-[14.5px] font-semibold text-ink">
                  {t('即将交给原型 Agent 的完整设计上下文', 'Context Blueprint for Prototype Agent')}
                </div>
                <p className="m-0 mt-0.5 text-[12px] text-ink-3">
                  {t(
                    '包含您刚挑选的参考大图、喜欢原因（背景色/强调色等）、动态交互示意图以及工程需求文档。',
                    'Combines your chosen visual references, liked reasons, animated interaction specs, and SRS.',
                  )}
                </p>
              </div>

              {docs.length > 0 && (
                <div className="flex flex-col gap-1">
                  <label className="text-[12px] font-medium text-ink-2">
                    {t('关联需求规格说明书 (SRS)：', 'Linked SRS Specification:')}
                  </label>
                  <select
                    className="input text-[12.5px]"
                    value={selectedDocId}
                    onChange={(e) => onSelectDocId(e.target.value)}
                  >
                    {docs.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title} ({d.status})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Selected References + Editable Liked Reasons */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-[12px] font-semibold text-ink-2">
                  <span>{t('已选视觉参考与喜欢原因', 'Visual References & Liked Reasons')}</span>
                  <button
                    type="button"
                    onClick={() => onStepChange(1)}
                    className="cursor-pointer text-accent hover:underline"
                  >
                    {t('返回增减参考图', 'Edit Picks')}
                  </button>
                </div>

                {selectedPrefs.map((pref) => (
                  <div
                    key={pref.item.slug}
                    className="flex flex-col gap-2 rounded-card border border-line bg-inset/40 p-2.5"
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        onClick={() => setInspectingItem(pref.item)}
                        className="h-14 w-24 shrink-0 cursor-pointer overflow-hidden rounded border border-line bg-surface"
                      >
                        <InspoShowcaseImage item={pref.item} variant="hero" className="h-full w-full" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate font-semibold text-[13px] text-ink">
                            {pref.item.title}
                          </span>
                          <span className="font-mono text-[10.5px] text-ink-3">
                            {pref.item.surfaceHex}
                          </span>
                        </div>
                        <div className="text-[11.5px] text-ink-3">
                          {t(pref.item.plainLabelZh, pref.item.plainLabelEn)}
                        </div>
                      </div>
                    </div>

                    <ReferenceLikedReasonsEditor
                      pref={pref}
                      onToggleAspect={handleToggleAspect}
                      onToggleSwatch={handleToggleSwatch}
                      onChangeReasonNote={handleChangeReasonNote}
                      compact
                    />
                  </div>
                ))}
              </div>

              {/* Transparent Prompt Disclosure */}
              <details className="rounded-control border border-line bg-inset/50 px-3 py-2 text-[12px]">
                <summary className="cursor-pointer font-medium text-ink-2">
                  {t('展开查看将发送给 Agent 的完整提示词指令', 'View compiled Agent context prompt')}
                </summary>
                <pre className="mt-2 max-h-[200px] overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-2">
                  {compiledAgentPrompt}
                </pre>
              </details>
            </div>

            <div className="flex flex-col gap-2 border-t border-line pt-3">
              <Button
                type="button"
                variant="accent"
                size="md"
                disabled={isBusyProto}
                onClick={() => {
                  onStepChange(3);
                  void onGenerateWithAi(compiledAgentPrompt, selectedDocId || undefined);
                }}
              >
                <Wand2 size={14} />
                {t(
                  '✨ 让 AI Agent 按全部上下文流式生成业务原型 →',
                  '✨ Generate Custom Prototype with AI Agent →',
                )}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  onPreviewSourceChange('REFERENCE_DRAFT');
                  onStepChange(3);
                }}
              >
                <Eye size={13.5} />
                {t(
                  '⚡ 先打开毫秒级实时合成预览体验效果 →',
                  '⚡ Open Instant Reference-Styled Preview →',
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          STAGE 3: INTERACTIVE PROTOTYPE SANDBOX, VISUAL REFINE & MU STUDIO
         ═══════════════════════════════════════════════════════════════════════ */}
      {activeStep === 3 && (
        <div className="card flex flex-col gap-3">
          {/* Top Studio Toolbar: Version / Draft Switcher + View Mode + Visual Inspector */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" size="xs" onClick={() => onStepChange(1)}>
                ← {t('换参考大图/改原因', 'References')}
              </Button>
              <Button type="button" variant="secondary" size="xs" onClick={() => onStepChange(2)}>
                ← {t('调整动态示意图', 'Schematics')}
              </Button>

              {/* Source Switcher: Live Reference Draft vs Saved Prototype Versions */}
              <div className="inline-flex flex-wrap items-center gap-1 rounded-control border border-line bg-inset p-0.5">
                <button
                  type="button"
                  onClick={() => onPreviewSourceChange('REFERENCE_DRAFT')}
                  className={cn(
                    'inline-flex cursor-pointer items-center gap-1 rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium',
                    previewSource === 'REFERENCE_DRAFT' || !currentSavedProto
                      ? 'bg-surface text-ink shadow-hairline'
                      : 'text-ink-3 hover:text-ink',
                  )}
                >
                  <Palette size={11.5} className="text-accent" />
                  {t(`参考合成预览 (${refTitleSummary})`, `Reference Draft (${refTitleSummary})`)}
                </button>

                {prototypes.map((p) => {
                  const isCurrent =
                    previewSource === 'SAVED_PROTO' && currentSavedProto?.id === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        onSelectProtoId(p.id);
                        onPreviewSourceChange('SAVED_PROTO');
                      }}
                      className={cn(
                        'inline-flex cursor-pointer items-center gap-1 rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium',
                        isCurrent
                          ? 'bg-surface text-ink shadow-hairline'
                          : 'text-ink-3 hover:text-ink',
                      )}
                    >
                      <CheckCircle2 size={11.5} className="text-emerald-600" />
                      <span>
                        {p.version} · {p.name.slice(0, 18)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {previewSource === 'REFERENCE_DRAFT' && (
                <Button
                  type="button"
                  variant="accent"
                  size="xs"
                  disabled={isBusyProto}
                  onClick={() => void onSaveDraftAsPrototype(draftHtml, refTitleSummary)}
                >
                  <CheckCircle2 size={12} />
                  {t('将此参考原型落库并同步 MU', 'Save Draft to Project MU')}
                </Button>
              )}

              <Button
                type="button"
                variant="secondary"
                size="xs"
                data-testid="open-new-proto-modal-btn"
                disabled={isBusyProto}
                onClick={() => void onGenerateWithAi(compiledAgentPrompt, selectedDocId || undefined)}
              >
                <Sparkles size={12} />
                {t('AI 重新生成新版本', 'AI Regenerate')}
              </Button>

              {currentSavedProto && (
                <>
                  <Button type="button" variant="ghost" size="xs" onClick={onCloneVersion}>
                    <Copy size={12} />
                    {t('复制版本', 'Clone')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-red"
                    onClick={() => onDeleteProto(currentSavedProto)}
                  >
                    <Trash2 size={12} />
                  </Button>
                </>
              )}

              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() =>
                  onDownloadHtml(
                    displayedHtml,
                    currentSavedProto?.name ?? `${project.name}-${refTitleSummary}.html`,
                  )
                }
              >
                <Download size={12} />
                {t('下载 .html', 'Download')}
              </Button>

              <Button
                type="button"
                variant="toggle"
                size="xs"
                data-testid="toggle-visual-select-btn"
                aria-pressed={inspectMode}
                disabled={isBusyProto}
                onClick={() => {
                  if (studioViewMode === 'HTML') setStudioViewMode('PREVIEW');
                  onInspectModeChange(!inspectMode);
                }}
              >
                <Crosshair size={12} />
                {t('框选局部精修', 'Visual Select')}
                {visualAnnotations.length > 0 && (
                  <span className="rounded-full bg-accent px-1.5 font-mono text-[10px] text-accent-ink">
                    {visualAnnotations.length}
                  </span>
                )}
              </Button>

              <div className="inline-flex items-center rounded-control border border-line bg-inset p-0.5">
                {(
                  [
                    { k: 'PREVIEW', zh: '交互预览', en: 'Preview' },
                    { k: 'SPLIT', zh: '分屏源码', en: 'Split' },
                    { k: 'HTML', zh: 'HTML 源码', en: 'HTML' },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.k}
                    type="button"
                    onClick={() => {
                      if (m.k === 'HTML') onInspectModeChange(false);
                      setStudioViewMode(m.k);
                    }}
                    className={cn(
                      'cursor-pointer rounded-[5px] px-2 py-0.5 text-[11.5px] font-medium',
                      studioViewMode === m.k
                        ? 'bg-surface text-ink shadow-hairline'
                        : 'text-ink-3 hover:text-ink',
                    )}
                  >
                    {m.k === 'HTML' && <Code2 size={11} className="mr-1 inline" />}
                    {t(m.zh, m.en)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Targeted Visual Refinement Instruction Bar */}
          <form
            className="flex flex-col gap-2 rounded-control border border-line bg-inset/45 p-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              void onApplyRefine(displayedHtml);
            }}
          >
            {visualAnnotations.length > 0 && (
              <div
                data-testid="visual-annotations-strip"
                className="flex flex-wrap items-center gap-1.5"
              >
                {visualAnnotations.map((ann) => (
                  <span key={ann.id} className="proto-pin-chip">
                    <span className="proto-pin-num">#{ann.index}</span>
                    <span className="truncate max-w-[240px]">
                      {ann.target.label}
                      {ann.note ? `：${ann.note}` : ''}
                    </span>
                    <button
                      type="button"
                      className="proto-pin-remove"
                      onClick={() => onRemoveVisualAnnotation(ann.id)}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={onClearVisualAnnotations}
                  className="cursor-pointer text-[11.5px] text-ink-3 hover:text-ink"
                >
                  {t('清空框选批注', 'Clear pins')}
                </button>
              </div>
            )}

            <div className="flex gap-2">
              <input
                className="input flex-1 bg-surface"
                data-testid="refine-prototype-input"
                placeholder={t(
                  '输入自然语言指令让 AI 局部精修当前原型（也可点上方「框选局部精修」直接圈选页面元素修改）…',
                  'Type refinement instructions or use "Visual Select" to click/box-select elements…',
                )}
                value={refineInstruction}
                onChange={(e) => onRefineInstructionChange(e.target.value)}
              />
              <Button
                type="submit"
                variant="accent"
                size="sm"
                data-testid="refine-prototype-btn"
                disabled={
                  isBusyProto ||
                  (!refineInstruction.trim() && visualAnnotations.length === 0)
                }
              >
                {isBusyProto ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Wand2 size={13} />
                )}
                {t('AI 精修原型', 'AI Refine')}
              </Button>
            </div>
          </form>

          {/* Main Stage: Preview / Split / HTML Editor */}
          <div
            className={cn(
              'grid gap-3',
              studioViewMode === 'SPLIT'
                ? 'grid-cols-1 lg:grid-cols-[1.2fr_0.8fr]'
                : 'grid-cols-1',
            )}
          >
            {studioViewMode !== 'HTML' && (
              <div className="overflow-hidden rounded-control border border-line">
                <PrototypeVisualPreviewStage
                  htmlContent={displayedHtml}
                  inspectMode={inspectMode}
                  onInspectModeChange={onInspectModeChange}
                  annotations={visualAnnotations}
                  onAddAnnotation={onAddVisualAnnotation}
                  onApplyImmediate={(target, note) =>
                    void onApplyRefine(displayedHtml, { target, note })
                  }
                  busy={isBusyProto}
                />
              </div>
            )}

            {studioViewMode !== 'PREVIEW' && (
              <div className="flex flex-col overflow-hidden rounded-control border border-line bg-inset">
                <div className="flex items-center justify-between border-b border-line bg-surface px-3 py-1.5 text-[11.5px] text-ink-3">
                  <span>
                    {previewSource === 'SAVED_PROTO' && currentSavedProto
                      ? `${currentSavedProto.name} (${currentSavedProto.version})`
                      : t('当前参考合成 HTML5 源码（点击落库后可自由编辑）', 'Reference Draft HTML5 Source')}
                  </span>
                  <span className="font-mono">
                    {muCounts.bindings} data-binding
                  </span>
                </div>
                <textarea
                  className="min-h-[540px] w-full flex-1 resize-y border-0 bg-inset p-3 font-mono text-[12px] leading-relaxed text-ink focus:outline-none"
                  value={displayedHtml}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    onSavedHtmlContentChange(nextVal);
                    if (previewSource === 'REFERENCE_DRAFT' && currentSavedProto) {
                      onPreviewSourceChange('SAVED_PROTO');
                    }
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Full-Viewport Native <dialog> Lightbox */}
      <InspoPreviewDialog
        item={inspectingItem}
        selectedPref={
          inspectingItem
            ? selectedPrefs.find((p) => p.item.slug === inspectingItem.slug)
            : undefined
        }
        onToggleSelect={handleToggleRef}
        onToggleAspect={handleToggleAspect}
        onToggleSwatch={handleToggleSwatch}
        onChangeReasonNote={handleChangeReasonNote}
        onFindSimilar={(item) => void handleFindSimilar(item)}
        onClose={() => setInspectingItem(null)}
      />
    </div>
  );
}
