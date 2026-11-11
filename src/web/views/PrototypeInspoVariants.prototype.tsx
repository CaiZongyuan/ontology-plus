// PROTOTYPE: Three variants of the Inspo Visual Reference + Agent-Aligned Prototype Studio, switchable via ?variant=A|B|C, on the existing ?mode=app-prototype route.

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Code2,
  Crosshair,
  Eye,
  FileText,
  FlaskConical,
  Layers,
  Loader2,
  Maximize2,
  MessageSquare,
  Monitor,
  Palette,
  RefreshCw,
  Search,
  Send,
  Smartphone,
  Sparkles,
  ThumbsUp,
  Wand2,
  X,
} from 'lucide-react';
import { extractMuFromPrototypeHtml } from '../../packages/ontology-core/index.js';
import type { ProjectDetail, RequirementDoc } from '../../packages/workspace-store/index.js';
import { apiRefinePrototype, useWorkbenchStore } from '../api.js';
import { Button, PrototypeSwitcher, readVariantSearchParam } from '../components/beautifui/index.js';
import {
  PrototypeVisualPreviewStage,
  toRefinementSelections,
  type PrototypeSelectionTarget,
  type PrototypeVisualAnnotation,
} from '../components/prototype/PrototypeVisualInspector.js';
import { usePreferences, type NavViewId } from '../i18n.js';
import { cn } from '../lib/utils.js';

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
  fonts: string[];
  mode: 'light' | 'dark';
  macro: string;
  radiusPx: number;
}

export interface RequirementAlignmentState {
  entryPattern: 'DRAWER' | 'DEDICATED_TAB' | 'INLINE_SPLIT';
  layoutDensity: 'COMPACT_LEDGER' | 'MODULAR_CARDS';
  includeKpiStrip: boolean;
  includeApprovalFlow: boolean;
  includeGuidedWalkthrough: boolean;
  customNotes: string[];
}

export function inspoThumbUrl(slug: string): string {
  return `${INSPO_CDN_BASE}/${slug}/thumb.384.webp`;
}
export function inspoHeroUrl(slug: string): string {
  return `${INSPO_CDN_BASE}/${slug}/hero.1440.webp`;
}
export function inspoFullUrl(slug: string): string {
  return `${INSPO_CDN_BASE}/${slug}/full.1440.webp`;
}
export function inspoMobileUrl(slug: string): string {
  return `${INSPO_CDN_BASE}/${slug}/mobile.384.webp`;
}

// Curated real websites verified against https://inspomcp.dev/api/mcp for 0ms initial load + offline fallback
export const CURATED_INSPO_CATALOG: InspoReferenceItem[] = [
  {
    slug: 'amie-so',
    title: 'Amie',
    vibeGroup: 'clean-saas',
    plainLabelZh: '清爽白底 · 现代高效协同台',
    plainLabelEn: 'Crisp White · Modern Productivity',
    plainDescZh: '纯白干净底色配明快天蓝主按钮与暖黄重点标记，适合高频日常办公台账',
    plainDescEn: 'Clean white canvas with sky-blue primary CTAs and warm highlight accents',
    northstar: 'Crisp sans-serif clarity, spacious and focused digital canvas.',
    palette: ['#14a4fc', '#d6950e', '#84d1fb', '#946c5c', '#cccee1'],
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
    plainDescZh: '几何感无衬线字配高识别度科技蓝胶囊按钮，层级分明、零视觉噪音',
    plainDescEn: 'Geometric sans-serif, pill lozenges, and generous breathing room',
    northstar: 'Crisp, cool tech - clean sans-serif, expansive white space.',
    palette: ['#0f71fa', '#1f7559', '#cddffb', '#4bad9e', '#e2e8f0'],
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
    plainDescZh: '低饱和薄荷绿与柔和圆角卡片，长时间录入与审阅不易视觉疲劳',
    plainDescEn: 'Soft mint accents and calm structured cards for long review sessions',
    northstar: 'Calm structured studio with gentle emerald-mint accents.',
    palette: ['#22624d', '#6cccac', '#f9d274', '#a18085', '#e5ece9'],
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
    plainDescZh: '克制的深海蓝与精细表格分割线，极适合合同、财务、清结算等严肃业务',
    plainDescEn: 'High-trust banking precision with crisp borders and tabular alignment',
    northstar: 'Enterprise-grade banking clarity and structured tabular hierarchy.',
    palette: ['#04b2f2', '#1d445a', '#34bcfc', '#646c7a', '#dbe4ec'],
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
    plainDescZh: '微冷冰蓝底纹配深灰蓝墨色，兼顾现代感与企业级数据可信度',
    plainDescEn: 'Subtle ice-slate surfaces with calm indigo-slate accents',
    northstar: 'Billing platform clarity with refined slate-indigo contrast.',
    palette: ['#5170ad', '#151d2d', '#747484', '#9ab0d8', '#eef3f8'],
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
    plainDescZh: '中性浅灰卡片搭配醒目的橙色待办/审批主行动点，关键动作一目了然',
    plainDescEn: 'Clean neutral enterprise tables anchored by decisive warm-orange CTAs',
    northstar: 'Decisive corporate finance workflow with high-visibility action cues.',
    palette: ['#fc5c04', '#663c2c', '#f89a64', '#7c7c84', '#ecebe8'],
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
    plainDescZh: '米白纸张底色配衬线标题与深青蓝墨色，适合重阅读、重条款审阅场景',
    plainDescEn: 'Warm cream paper surface (`#fcf8f4`) with editorial serif headings',
    northstar: 'Warm paper ground paired with deep Prussian blue and serif authority.',
    palette: ['#315e7b', '#13384d', '#ac9466', '#fcf8f4', '#e4ddd2'],
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
    plainDescZh: '利落的线条网格与暖金琥珀强调色，让枯燥的业务表单呈现出版物般质感',
    plainDescEn: 'Crisp hairline rules, serif headlines, and warm amber highlights',
    northstar: 'Editorial grid discipline with warm ochre-amber accents.',
    palette: ['#d29a1e', '#765a18', '#f7c97a', '#ae8860', '#efeae1'],
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
    plainDescZh: '低眩光深灰黑底配高对比荧光绿状态指示，适合高频数据监控、调度与预警台',
    plainDescEn: 'Low-glare dark console with high-contrast emerald status telemetry',
    northstar: 'Focused dark data cockpit with crisp emerald signal highlights.',
    palette: ['#24f494', '#1a6240', '#80f8c1', '#848484', '#141817'],
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
    plainDescZh: '柔和深蓝灰层级卡片与青蓝操作按钮，比纯黑更柔和耐看',
    plainDescEn: 'Layered deep-navy cards with calm cyan-blue operational controls',
    northstar: 'Deep ocean slate console with approachable cyan accents.',
    palette: ['#31bacd', '#144c54', '#b4d4dc', '#648c90', '#0f172a'],
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
    plainDescZh: '深靛蓝底色搭配明亮宝蓝主按钮，科技感与专业度兼具',
    plainDescEn: 'Deep indigo architecture with electric royal-blue primary actions',
    northstar: 'Deep indigo expanse, clean sans-serif precision, focused digital architecture.',
    palette: ['#205df9', '#8eabfb', '#a9bbd6', '#99694d', '#090d24'],
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
    plainDescZh: '圆润分块卡片（Bento Grid）把指标、待办和明细分区收纳，适合管理层总览',
    plainDescEn: 'Modular bento-box cards organizing KPIs, queues, and tables cleanly',
    northstar: 'Friendly modular bento layout with sky-blue clarity.',
    palette: ['#3494f4', '#06427d', '#a9daf5', '#9d6c68', '#f1f5f9'],
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
  { key: 'ALL', labelZh: '全部精选实拍', labelEn: 'All Picks', emoji: '✨' },
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
  return {
    slug: raw.slug,
    title: raw.title || raw.slug,
    vibeGroup: isDark ? 'dark-tech' : 'clean-saas',
    plainLabelZh: isDark ? 'Inspo 实时深色参考' : 'Inspo 实时浅色参考',
    plainLabelEn: isDark ? 'Live Dark Reference' : 'Live Light Reference',
    plainDescZh: raw.northstar || '来自 inspomcp.dev 实时检索的真实线上产品截图与提取色板',
    plainDescEn: raw.northstar || 'Live production screenshot and extracted palette from inspomcp.dev',
    northstar: raw.northstar || 'Real-world production web reference',
    palette:
      raw.palette && raw.palette.length > 0
        ? raw.palette
        : isDark
          ? ['#38bdf8', '#818cf8', '#94a3b8', '#1e293b', '#0f172a']
          : ['#2563eb', '#0f172a', '#64748b', '#cbd5e1', '#f8fafc'],
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generates a runnable, single-file semantic HTML5 prototype (`SCR-*`, `EL-*`, `data-binding`, `UIE-*`)
 * whose visual tokens (surface, ink, accent, radius, typography) and layout structure respond LIVE
 * to the user's selected Inspo reference(s) and Agent alignment choices!
 */
export function buildReferenceStyledPrototypeHtml(
  project: ProjectDetail,
  doc: RequirementDoc | undefined,
  selectedRefs: InspoReferenceItem[],
  alignment: RequirementAlignmentState,
): string {
  const primaryRef = selectedRefs[0] ?? CURATED_INSPO_CATALOG[0]!;
  const secondaryRef = selectedRefs[1];

  const isDark = primaryRef.mode === 'dark';
  const accent = primaryRef.palette[0] || '#2563eb';
  const secondaryAccent = secondaryRef?.palette[0] || primaryRef.palette[1] || accent;
  const accentInk = pickReadableButtonInk(accent);

  const isWarmPaper = primaryRef.vibeGroup === 'warm-paper';
  const bg = isDark ? '#0c1017' : isWarmPaper ? '#f8f4ec' : '#f5f7fb';
  const surface = isDark ? '#151b26' : isWarmPaper ? '#fffdf9' : '#ffffff';
  const surfaceSubtle = isDark ? '#1c2433' : isWarmPaper ? '#f1ebe0' : '#eef2f7';
  const border = isDark ? 'rgba(255,255,255,0.12)' : isWarmPaper ? '#dfd6c7' : '#e2e8f0';
  const ink = isDark ? '#f1f5f9' : isWarmPaper ? '#1f1d1a' : '#0f172a';
  const inkMuted = isDark ? '#94a3b8' : isWarmPaper ? '#6b6459' : '#64748b';
  const fontStack =
    isWarmPaper
      ? `'Georgia', 'Noto Serif SC', -apple-system, sans-serif`
      : `'${primaryRef.fonts[0] || 'Inter'}', -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif`;
  const radius = `${primaryRef.radiusPx}px`;

  // Derive authentic domain aggregate & fields from active project
  const firstAgg = project.suite.M1?.aggregates?.[0];
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

  const customNoteSummary =
    alignment.customNotes.length > 0
      ? alignment.customNotes[alignment.customNotes.length - 1]
      : doc
        ? `已对齐《${doc.title}》`
        : `已对齐「${project.domain || project.name}」核心业务流`;

  const refSummaryBadge = selectedRefs.map((r) => r.title).join(' + ');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(project.name)} · 交互原型 (${escapeHtml(refSummaryBadge)})</title>
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
      padding: 18px 22px 64px;
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
    .brand h1 {
      margin: 0;
      font-size: 19px;
      letter-spacing: -0.01em;
    }
    .brand p {
      margin: 2px 0 0;
      font-size: 12px;
      color: var(--muted);
    }
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
    }
    .tab-btn.active {
      background: var(--surface);
      color: var(--ink);
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
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
    }
    .kpi-label { font-size: 11.5px; color: var(--muted); }
    .kpi-val { font-size: 22px; font-weight: 700; margin-top: 4px; }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
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
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      text-align: left;
      padding: ${alignment.layoutDensity === 'COMPACT_LEDGER' ? '8px 10px' : '12px 12px'};
      border-bottom: 1px solid var(--line);
    }
    th { color: var(--muted); font-weight: 600; font-size: 11.5px; }
    .pill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: var(--surface-2);
      border: 1px solid var(--line);
    }
    .toast-bar {
      display: none;
      margin-bottom: 12px;
      padding: 9px 12px;
      border-radius: var(--radius);
      border-left: 4px solid var(--accent);
      background: var(--surface);
      font-size: 12.5px;
    }
    .walkthrough-bar {
      margin-top: 14px;
      padding: 10px 12px;
      border-radius: var(--radius);
      background: var(--surface-2);
      border: 1px dashed var(--line);
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
    }
    .split-grid {
      display: grid;
      grid-template-columns: ${alignment.entryPattern === 'INLINE_SPLIT' ? '1.35fr 0.95fr' : '1fr'};
      gap: 14px;
    }
    .drawer-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.42);
      z-index: 30;
      justify-content: flex-end;
    }
    .drawer-panel {
      width: min(400px, 92vw);
      height: 100%;
      background: var(--surface);
      border-left: 1px solid var(--line);
      padding: 18px;
      overflow-y: auto;
    }
    .form-row { margin-bottom: 10px; display: flex; flex-direction: column; gap: 4px; }
    .form-row label { font-size: 12px; color: var(--muted); font-weight: 600; }
  </style>
</head>
<body>
  <div class="dna-banner">
    <div>
      <span class="swatch-dot" style="background:${accent}"></span>
      <span class="swatch-dot" style="background:${secondaryAccent}"></span>
      <strong>视觉参考基因：${escapeHtml(refSummaryBadge)}</strong>
      <span style="color:var(--muted); margin-left:6px;">(${primaryRef.mode === 'dark' ? '深色低眩光' : '浅色高清晰'} · 圆角 ${radius} · ${escapeHtml(alignment.entryPattern === 'DRAWER' ? '右侧抽屉录入' : alignment.entryPattern === 'INLINE_SPLIT' ? '同屏双栏联办' : '独立页签录入')})</span>
    </div>
    <span style="color:var(--muted)">${escapeHtml(customNoteSummary || '')}</span>
  </div>

  <div id="status-toast" class="toast-bar" role="status"></div>

  <div class="topbar">
    <div class="brand">
      <h1>${escapeHtml(project.name)}</h1>
      <p>${escapeHtml(project.domain || aggLabel)} · MU 语义锚点已就绪（SCR / EL / UIE）</p>
    </div>
    <div class="tabs">
      <button class="tab-btn active" onclick="showScreen('SCR-MAIN-LIST', this)">1. ${escapeHtml(aggLabel)}台账</button>
      ${
        alignment.entryPattern === 'DEDICATED_TAB'
          ? `<button class="tab-btn" onclick="showScreen('SCR-MAIN-FORM', this)">2. 新建${escapeHtml(aggLabel)}</button>`
          : ''
      }
      ${
        alignment.includeApprovalFlow
          ? `<button class="tab-btn" onclick="showScreen('SCR-APPROVAL-FLOW', this)">${alignment.entryPattern === 'DEDICATED_TAB' ? '3' : '2'}. 审批与状态流转</button>`
          : ''
      }
    </div>
  </div>

  ${
    alignment.includeKpiStrip
      ? `<div class="kpi-grid">
          <div class="card">
            <div class="kpi-label">本月活跃${escapeHtml(aggLabel)}</div>
            <div class="kpi-val" id="kpi-total">28</div>
          </div>
          <div class="card">
            <div class="kpi-label">待审批 / 规则复核</div>
            <div class="kpi-val" style="color:var(--accent)" id="kpi-pending">4</div>
          </div>
          <div class="card">
            <div class="kpi-label">合规准时率</div>
            <div class="kpi-val" style="color:var(--accent-2)">98.4%</div>
          </div>
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
            onchange="renderRows()"
          >
            <option value="">全部状态</option>
            <option value="DRAFT">草稿 (DRAFT)</option>
            <option value="PENDING_APPROVAL">待审批 (PENDING)</option>
            <option value="APPROVED">已生效 (APPROVED)</option>
          </select>
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

    <!-- Screen 2: Creation Form (Inline Split, Dedicated Tab, or Slide-over Drawer) -->
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
      <h3 style="margin-top:0; font-size:15px;">新建${escapeHtml(aggLabel)}（M1 双向绑定 + M3 校验）</h3>
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
        <label>业务金额 / 指标阈值 (${escapeHtml(aggName)}.${escapeHtml(amountField)})</label>
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

  <!-- Optional Drawer Host when entryPattern === DRAWER -->
  <div id="drawer-host" class="drawer-backdrop" onclick="if(event.target===this) closeDrawer()">
    <div class="drawer-panel" id="drawer-mount"></div>
  </div>

  ${
    alignment.includeApprovalFlow
      ? `<!-- Screen 3: Approval & State Transition -->
        <section
          id="SCR-APPROVAL-FLOW"
          data-screen-id="SCR-APPROVAL-FLOW"
          data-screen-name="${escapeHtml(aggLabel)}审批看板"
          data-screen-type="APPROVAL"
          data-route="/${escapeHtml(aggName.toLowerCase())}/approval"
          data-role-refs="ROLE-02"
          class="card"
          style="display:none; margin-top:12px;"
        >
          <h3 style="margin-top:0; font-size:15px;">待办审批队列（角色：风控/业务主管）</h3>
          <p style="color:var(--muted); font-size:12.5px;">大额或触发 M3 风控阈值的单据自动进入此队列，可一键批准或退回修订。</p>
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

  ${
    alignment.includeGuidedWalkthrough
      ? `<div class="walkthrough-bar">
          <div>
            <strong>🧪 业务状态走查剧本 (Logic Walkthrough)：</strong>
            <span id="state-readout" style="color:var(--muted)">点击右侧步骤按钮，免手填体验完整「提交 → 阈值拦截 → 审批生效」闭环</span>
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button type="button" class="btn" onclick="runStep1()">① 模拟新建超额单据</button>
            <button type="button" class="btn" onclick="runStep2()">② 触发 M3 负值校验拦截</button>
            <button type="button" class="btn btn-primary" onclick="approveNextPending()">③ 模拟主管审批生效</button>
          </div>
        </div>`
      : ''
  }

  <script>
    const ENTRY_MODE = ${JSON.stringify(alignment.entryPattern)};
    const rows = [
      { code: 'DOC-2026-016', title: '${escapeHtml(aggLabel)}年度框架协议 A', amount: 265000, status: 'PENDING_APPROVAL' },
      { code: 'DOC-2026-017', title: '常规标准采购批次单', amount: 42000, status: 'APPROVED' },
      { code: 'DOC-2026-018', title: '季度补充履约申请单', amount: 98000, status: 'DRAFT' },
    ];

    function notify(msg) {
      const el = document.getElementById('status-toast');
      el.textContent = msg;
      el.style.display = 'block';
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
      if (ENTRY_MODE === 'DRAWER') {
        const formSec = document.getElementById('SCR-MAIN-FORM');
        const mount = document.getElementById('drawer-mount');
        if (formSec && mount && formSec.parentElement !== mount) {
          mount.appendChild(formSec);
        }
        if (formSec) formSec.style.display = '';
        document.getElementById('drawer-host').style.display = 'flex';
      } else if (ENTRY_MODE === 'DEDICATED_TAB') {
        showScreen('SCR-MAIN-FORM', document.querySelectorAll('.tab-btn')[1]);
      } else {
        document.getElementById('inp-title').focus();
        notify('右侧分栏表单已就绪，可直接录入提交。');
      }
    }

    function closeDrawer() {
      document.getElementById('drawer-host').style.display = 'none';
    }

    function submitCreateForm() {
      const code = document.getElementById('inp-code').value.trim() || ('DOC-' + Math.floor(Math.random()*900+100));
      const title = document.getElementById('inp-title').value.trim() || '新建${escapeHtml(aggLabel)}事项';
      const amount = Number(document.getElementById('inp-amount').value || 0);
      if (amount <= 0) {
        notify('⚠️ [M3 规则拦截 RULE-THRESHOLD] 业务金额必须大于 0，当前输入 ' + amount + ' 已被拒绝入库！');
        return;
      }
      const nextStatus = amount >= 100000 ? 'PENDING_APPROVAL' : 'APPROVED';
      rows.unshift({ code, title, amount, status: nextStatus });
      closeDrawer();
      if (ENTRY_MODE === 'DEDICATED_TAB') {
        showScreen('SCR-MAIN-LIST', document.querySelectorAll('.tab-btn')[0]);
      }
      renderRows();
      notify(
        nextStatus === 'PENDING_APPROVAL'
          ? '✅ 已创建 ' + code + '（金额 ¥' + amount.toLocaleString() + ' >= 10万，自动转入「待审批」状态）'
          : '✅ 已创建 ' + code + '（常规额度自动生效 APPROVED）'
      );
    }

    function approveNextPending() {
      const target = rows.find(r => r.status === 'PENDING_APPROVAL' || r.status === 'DRAFT');
      if (!target) {
        notify('当前所有单据均已审批生效（APPROVED）。');
        return;
      }
      target.status = 'APPROVED';
      renderRows();
      renderApprovalQueue();
      notify('🎉 单据 ' + target.code + ' 已审批通过，状态流转为 APPROVED！');
    }

    function runStep1() {
      document.getElementById('inp-code').value = 'DOC-2026-099';
      document.getElementById('inp-title').value = '战略级重点客户增补单';
      document.getElementById('inp-amount').value = '350000';
      submitCreateForm();
    }

    function runStep2() {
      document.getElementById('inp-amount').value = '-500';
      submitCreateForm();
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
      const st = document.getElementById('filter-status').value;
      const filtered = rows.filter(r => (!kw || r.code.toLowerCase().includes(kw) || r.title.toLowerCase().includes(kw)) && (!st || r.status === st));
      document.getElementById('ledger-tbody').innerHTML = filtered.map(r =>
        '<tr>' +
          '<td style="font-family:monospace;font-weight:600">' + r.code + '</td>' +
          '<td>' + r.title + '</td>' +
          '<td>¥' + r.amount.toLocaleString() + '</td>' +
          '<td><span class="pill">' + r.status + '</span></td>' +
          '<td><button class="btn" style="padding:3px 8px;font-size:11.5px" onclick="approveNextPending()">推进状态</button></td>' +
        '</tr>'
      ).join('');
      const kpiTotal = document.getElementById('kpi-total');
      const kpiPending = document.getElementById('kpi-pending');
      if (kpiTotal) kpiTotal.textContent = String(25 + rows.length);
      if (kpiPending) kpiPending.textContent = String(rows.filter(r => r.status === 'PENDING_APPROVAL').length);
    }

    renderRows();
  </script>
</body>
</html>`;
}

// ─── Shared Visual Screenshot Image with Offline Wireframe Fallback ──────────
function InspoVisualImage({
  item,
  variant = 'thumb',
  className,
}: {
  item: InspoReferenceItem;
  variant?: 'thumb' | 'hero' | 'full' | 'mobile';
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src =
    variant === 'full'
      ? inspoFullUrl(item.slug)
      : variant === 'mobile'
        ? inspoMobileUrl(item.slug)
        : variant === 'hero'
          ? inspoHeroUrl(item.slug)
          : inspoThumbUrl(item.slug);

  if (failed) {
    const bg = item.mode === 'dark' ? '#0f172a' : '#f8fafc';
    const fg = item.mode === 'dark' ? '#e2e8f0' : '#1e293b';
    const acc = item.palette[0] || '#4c50c4';
    return (
      <div
        className={cn('flex flex-col justify-between p-4', className)}
        style={{ background: bg, color: fg }}
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] opacity-75">{item.title}</span>
          <span className="h-2.5 w-8 rounded-full" style={{ background: acc }} />
        </div>
        <div className="my-3 space-y-1.5">
          <div className="h-3 w-2/3 rounded opacity-80" style={{ background: fg }} />
          <div className="h-2 w-1/2 rounded opacity-35" style={{ background: fg }} />
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {item.palette.slice(0, 3).map((sw, idx) => (
            <div
              key={`${sw}-${idx}`}
              className="h-8 rounded border border-white/10"
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
      alt={`${item.title} UI reference screenshot`}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn('block w-full object-cover object-top', className)}
    />
  );
}

// ─── Lightbox Modal: Desktop / Full-Page Scroll / Mobile + DESIGN.md ─────────
function InspoPreviewModal({
  item,
  isSelected,
  onToggleSelect,
  onFindSimilar,
  onClose,
}: {
  item: InspoReferenceItem | null;
  isSelected: boolean;
  onToggleSelect: (item: InspoReferenceItem) => void;
  onFindSimilar: (item: InspoReferenceItem) => void;
  onClose: () => void;
}) {
  const { t } = usePreferences();
  const [tab, setTab] = useState<'HERO' | 'FULL' | 'MOBILE' | 'DESIGN_MD'>('HERO');
  const [designMd, setDesignMd] = useState<string>('');
  const [loadingMd, setLoadingMd] = useState(false);

  useEffect(() => {
    setTab('HERO');
    setDesignMd('');
  }, [item?.slug]);

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
            `# ${item.title} — Extracted Design System\n\n- **Mode**: ${item.mode}\n- **Macrostructure**: ${item.macro}\n- **Fonts**: ${item.fonts.join(', ')}\n- **Palette**: ${item.palette.join(', ')}\n- **Northstar**: ${item.northstar}`,
        );
      })
      .catch(() => {
        if (!cancelled) {
          setDesignMd(
            `# ${item.title} — Design DNA\n\n- Mode: ${item.mode}\n- Palette: ${item.palette.join(', ')}\n- Fonts: ${item.fonts.join(', ')}`,
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

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-[980px] flex-col overflow-hidden rounded-window border border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="font-serif text-[16px] font-semibold text-ink">{item.title}</span>
            <span className="badge badge-accent">{t(item.plainLabelZh, item.plainLabelEn)}</span>
            <div className="flex items-center gap-1">
              {item.palette.slice(0, 5).map((hex, i) => (
                <span
                  key={`${hex}-${i}`}
                  title={hex}
                  className="h-3.5 w-3.5 rounded-full border border-black/15"
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
                onClose();
              }}
            >
              <Sparkles size={12.5} />
              {t('找相似风格', 'More Like This')}
            </Button>
            <Button
              type="button"
              variant={isSelected ? 'secondary' : 'accent'}
              size="sm"
              onClick={() => onToggleSelect(item)}
            >
              <Check size={12.5} />
              {isSelected ? t('已加入参考篮', 'Selected') : t('选为我的 UI 参考', 'Use This Style')}
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-control text-ink-3 hover:bg-inset hover:text-ink"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 border-b border-line bg-inset/50 px-4 py-2 text-[12px]">
          <Button
            type="button"
            variant="toggle"
            size="xs"
            aria-pressed={tab === 'HERO'}
            onClick={() => setTab('HERO')}
          >
            <Monitor size={12} />
            {t('桌面首屏实拍', 'Desktop Hero')}
          </Button>
          <Button
            type="button"
            variant="toggle"
            size="xs"
            aria-pressed={tab === 'FULL'}
            onClick={() => setTab('FULL')}
          >
            <Layers size={12} />
            {t('整页长滚动实拍', 'Full-Page Capture')}
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
            {t('后台自动提取的 DESIGN.md', 'Extracted DESIGN.md')}
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto bg-inset p-4">
          {tab === 'DESIGN_MD' ? (
            loadingMd ? (
              <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-ink-3">
                <Loader2 size={16} className="animate-spin" />
                {t('正在从 inspomcp.dev 拉取站点 DESIGN.md 令牌…', 'Fetching DESIGN.md from inspomcp.dev…')}
              </div>
            ) : (
              <pre className="overflow-x-auto rounded-card border border-line bg-surface p-4 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink">
                {designMd}
              </pre>
            )
          ) : tab === 'MOBILE' ? (
            <div className="mx-auto max-w-[380px] overflow-hidden rounded-[20px] border-4 border-ink/20 bg-surface shadow-lg">
              <InspoVisualImage item={item} variant="mobile" className="h-auto" />
            </div>
          ) : (
            <div className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
              <InspoVisualImage
                item={item}
                variant={tab === 'FULL' ? 'full' : 'hero'}
                className="h-auto"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Rule 5 State Surface Strip (always shows what changed) ──────────────────
function PrototypeStateSurfaceBar({
  variantKey,
  variantTitle,
  selectedRefs,
  alignment,
  htmlContent,
  domain,
  onApplyToRealStudio,
}: {
  variantKey: string;
  variantTitle: string;
  selectedRefs: InspoReferenceItem[];
  alignment: RequirementAlignmentState;
  htmlContent: string;
  domain: string;
  onApplyToRealStudio: (html: string, refSummary: string) => void;
}) {
  const { t } = usePreferences();
  const muCounts = useMemo(() => {
    try {
      const mu = extractMuFromPrototypeHtml(htmlContent, domain);
      let elements = 0;
      let events = 0;
      for (const s of mu.screens) {
        elements += s.elements.length;
        events += s.events.length;
      }
      return { screens: mu.screens.length, elements, events };
    } catch {
      return { screens: 0, elements: 0, events: 0 };
    }
  }, [htmlContent, domain]);

  const primary = selectedRefs[0] ?? CURATED_INSPO_CATALOG[0]!;

  return (
    <div
      data-testid="prototype-state-surface"
      className="flex flex-wrap items-center justify-between gap-2 rounded-window border border-accent/30 bg-accent-tint/35 px-3.5 py-2 text-[12px]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge badge-accent font-mono">
          Variant {variantKey} · {variantTitle}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-0.5 text-ink">
          <Palette size={12} className="text-accent" />
          {t('视觉参考:', 'Ref:')}{' '}
          <strong>{selectedRefs.map((r) => r.title).join(' + ')}</strong>
          <span
            className="inline-block h-2.5 w-2.5 rounded-full border border-black/20"
            style={{ background: primary.palette[0] }}
          />
          <code className="font-mono text-[10.5px] text-ink-3">{primary.mode}</code>
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-0.5 font-mono text-[11px] text-ink-2">
          {alignment.entryPattern} · {alignment.layoutDensity}
          {alignment.includeApprovalFlow ? ' · +Approval' : ''}
        </span>
        <span className="badge badge-ok font-mono">
          MU: {muCounts.screens} Screens · {muCounts.elements} Elements · {muCounts.events} Events
        </span>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="xs"
        onClick={() =>
          onApplyToRealStudio(htmlContent, selectedRefs.map((r) => r.title).join(' + '))
        }
      >
        <CheckCircle2 size={12} />
        {t('将此小样写入本工程 MU 原型', 'Save Preview into Project MU')}
      </Button>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// VARIANT A: 视觉画廊导购式三步流 (Gallery Wall → Agent Alignment → Live Canvas)
// ═════════════════════════════════════════════════════════════════════════════
export function VariantA({
  project,
  doc,
  catalog,
  searching,
  onLiveSearch,
  onFindSimilar,
  selectedRefs,
  onToggleRef,
  alignment,
  setAlignment,
  onInspectItem,
  htmlContent,
  inspectMode,
  onInspectModeChange,
  annotations,
  onAddAnnotation,
  onApplyImmediate,
  refining,
}: SharedVariantProps) {
  const { t } = usePreferences();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [vibe, setVibe] = useState<'ALL' | InspoReferenceItem['vibeGroup']>('ALL');
  const [searchInput, setSearchInput] = useState('');
  const [chatNote, setChatNote] = useState('');
  const [showSource, setShowSource] = useState(false);

  const visibleItems = useMemo(
    () => (vibe === 'ALL' ? catalog : catalog.filter((i) => i.vibeGroup === vibe)),
    [catalog, vibe],
  );

  const toggleRef = (item: InspoReferenceItem) => {
    onToggleRef(item);
  };

  return (
    <div className="flex flex-col gap-3.5 pb-14">
      {/* 3-Step Visual Stepper Header */}
      <div className="card flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {[
            {
              n: 1 as const,
              zh: '① 看图选顺眼的 UI 参考',
              en: '1. Pick Visual Reference',
              sub: `${selectedRefs.length} ${t('张已选', 'picked')}`,
            },
            {
              n: 2 as const,
              zh: '② Agent 需求与交互对齐',
              en: '2. Align Requirements with Agent',
              sub: alignment.entryPattern,
            },
            {
              n: 3 as const,
              zh: '③ 体验同款皮肤交互原型',
              en: '3. Interactive MU Prototype',
              sub: 'Live HTML5',
            },
          ].map((s, idx) => (
            <React.Fragment key={s.n}>
              {idx > 0 && <ArrowRight size={13} className="text-ink-3" />}
              <button
                type="button"
                onClick={() => setStep(s.n)}
                className={cn(
                  'inline-flex cursor-pointer items-center gap-2 rounded-control border px-3 py-1.5 text-left text-[12.5px] transition-colors',
                  step === s.n
                    ? 'border-accent bg-accent-tint font-semibold text-ink'
                    : 'border-line bg-surface text-ink-2 hover:border-accent/50',
                )}
              >
                <span>{t(s.zh, s.en)}</span>
                <span className="rounded-full bg-surface px-1.5 py-0.2 font-mono text-[10.5px] text-ink-3">
                  {s.sub}
                </span>
              </button>
            </React.Fragment>
          ))}
        </div>

        {step === 1 && (
          <Button type="button" variant="accent" size="sm" onClick={() => setStep(2)}>
            {t('选好了，下一步与 Agent 对齐需求', 'Next: Align Requirements')}
            <ArrowRight size={13.5} />
          </Button>
        )}
        {step === 2 && (
          <Button type="button" variant="accent" size="sm" onClick={() => setStep(3)}>
            <Sparkles size={13.5} />
            {t('按此参考与对齐结果查看原型', 'Generate & Inspect Prototype')}
          </Button>
        )}
      </div>

      {step === 1 && (
        <div className="card flex flex-col gap-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div>
              <h3 className="m-0 font-serif text-[17px] font-semibold text-ink">
                {t(
                  '不用懂设计术语，直接点选您看着最舒服的界面实拍图（可多选 1～3 张融合）',
                  'No design jargon needed — simply click 1–3 real website screenshots whose look & feel you like',
                )}
              </h3>
              <p className="m-0 mt-0.5 text-[12.5px] text-ink-3">
                {t(
                  '图源直连 Nutlope/inspo 真实获奖产品库；点选后系统自动在后台提取色板、字阶、圆角与留白规范（DESIGN.md）',
                  'Powered live by Nutlope/inspo captures; color roles, fonts, and spacing tokens are extracted automatically behind the scenes.',
                )}
              </p>
            </div>

            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                onLiveSearch(searchInput);
              }}
            >
              <input
                className="input w-[230px]"
                placeholder={t('搜大白话：如 深色大屏 / 清爽医疗…', 'Search Inspo live…')}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              <Button type="submit" variant="secondary" size="sm" disabled={searching}>
                {searching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                {t('实时搜库', 'Live Search')}
              </Button>
            </form>
          </div>

          {/* Plain-language feeling pills */}
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

          {/* Visual Cards Grid */}
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {visibleItems.map((item) => {
              const selected = selectedRefs.some((r) => r.slug === item.slug);
              return (
                <div
                  key={item.slug}
                  className={cn(
                    'group flex flex-col overflow-hidden rounded-card border bg-surface transition-all',
                    selected
                      ? 'border-accent ring-2 ring-accent/30'
                      : 'border-line hover:border-accent/50',
                  )}
                >
                  <div
                    className="relative h-[176px] w-full cursor-pointer overflow-hidden bg-inset"
                    onClick={() => toggleRef(item)}
                  >
                    <InspoVisualImage
                      item={item}
                      variant="thumb"
                      className="h-full w-full transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                    <div className="absolute top-2 left-2 flex items-center gap-1">
                      <span className="rounded-full bg-black/70 px-2 py-0.5 text-[10.5px] font-medium text-white backdrop-blur-xs">
                        {item.mode === 'dark' ? '🌙 深色' : '☀️ 浅色'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onInspectItem(item);
                      }}
                      title={t('放大看整页长图与手机端', 'Inspect full page & mobile')}
                      className="absolute top-2 right-2 inline-flex h-7 cursor-pointer items-center gap-1 rounded-full bg-black/70 px-2.5 text-[11px] text-white opacity-90 backdrop-blur-xs hover:bg-black"
                    >
                      <Maximize2 size={11} />
                      {t('看大图', 'Zoom')}
                    </button>
                    {selected && (
                      <div className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-white shadow">
                        <Check size={11.5} />
                        {t('已选中', 'Picked')}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col justify-between gap-2 p-3">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-ink">{item.title}</span>
                        <span className="text-[11px] font-medium text-accent">
                          {t(item.plainLabelZh, item.plainLabelEn)}
                        </span>
                      </div>
                      <p className="m-0 mt-1 line-clamp-2 text-[12px] leading-[1.45] text-ink-3">
                        {t(item.plainDescZh, item.plainDescEn)}
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
                      <div className="flex items-center gap-1">
                        {item.palette.slice(0, 5).map((hex, idx) => (
                          <span
                            key={`${hex}-${idx}`}
                            title={hex}
                            className="h-3.5 w-3.5 rounded-full border border-black/15"
                            style={{ background: hex }}
                          />
                        ))}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onFindSimilar(item)}
                          className="cursor-pointer rounded px-2 py-0.5 text-[11px] text-ink-2 hover:bg-inset hover:text-accent"
                        >
                          {t('找相似', 'Similar')}
                        </button>
                        <Button
                          type="button"
                          variant={selected ? 'secondary' : 'accent'}
                          size="xs"
                          onClick={() => toggleRef(item)}
                        >
                          {selected ? t('取消选择', 'Picked') : t('选这款感觉', 'Pick')}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.15fr_0.85fr]">
          {/* Agent Requirement Alignment Interview */}
          <div className="card flex flex-col gap-3">
            <div className="flex items-center gap-2 border-b border-line pb-2.5">
              <span className="badge badge-accent">Prototype Alignment Agent</span>
              <span className="text-[13px] font-semibold text-ink">
                {t(
                  `已结合《${doc?.title || project.name}》与所选视觉参考生成 3 个对齐确认项`,
                  `3 quick requirement & UX alignment questions for "${project.name}"`,
                )}
              </span>
            </div>

            <div className="rounded-card border border-line bg-inset/50 p-3 text-[13px] leading-relaxed text-ink">
              👋 {t('太棒了！您挑中的 ', 'Great choice! Your selected reference ')}
              <strong>{selectedRefs.map((r) => r.title).join(' + ')}</strong>
              {t(
                ' 主打「' +
                  (selectedRefs[0]?.plainLabelZh ?? '') +
                  '」。在为您生成「' +
                  project.name +
                  '」的原型前，请点选确认下面 3 个业务操作习惯（不填也可以，我已按最佳实践预填）：',
                ' gives us a clear color & typography DNA. Confirm 3 interaction habits for your business screens below:',
              )}
            </div>

            {/* Scoped HITL Question 1 */}
            <div className="rounded-card border border-line bg-surface p-3">
              <div className="mb-2 text-[12.5px] font-semibold text-ink">
                1. {t('业务员点击「新建单据」时，您更习惯哪种交互方式？', 'How should creating a new record open?')}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(
                  [
                    {
                      v: 'DRAWER',
                      zh: '右侧滑出抽屉（推荐）',
                      desc: '不离开台账列表，边看边填',
                    },
                    {
                      v: 'INLINE_SPLIT',
                      zh: '同屏左右双栏常驻',
                      desc: '左表右单，适合高频连续录单',
                    },
                    {
                      v: 'DEDICATED_TAB',
                      zh: '切换独立新建页面',
                      desc: '空间最大，适合超长复杂表单',
                    },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setAlignment((prev) => ({ ...prev, entryPattern: opt.v }))}
                    className={cn(
                      'cursor-pointer rounded-control border p-2.5 text-left transition-colors',
                      alignment.entryPattern === opt.v
                        ? 'border-accent bg-accent-tint'
                        : 'border-line hover:border-accent/50',
                    )}
                  >
                    <div className="text-[12.5px] font-semibold text-ink">{opt.zh}</div>
                    <div className="mt-0.5 text-[11.5px] text-ink-3">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Scoped HITL Question 2 */}
            <div className="rounded-card border border-line bg-surface p-3">
              <div className="mb-2 text-[12.5px] font-semibold text-ink">
                2. {t('页面信息密度与辅助业务模块对齐：', 'Information density & business modules:')}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="toggle"
                  size="sm"
                  aria-pressed={alignment.layoutDensity === 'COMPACT_LEDGER'}
                  onClick={() =>
                    setAlignment((prev) => ({
                      ...prev,
                      layoutDensity:
                        prev.layoutDensity === 'COMPACT_LEDGER'
                          ? 'MODULAR_CARDS'
                          : 'COMPACT_LEDGER',
                    }))
                  }
                >
                  {alignment.layoutDensity === 'COMPACT_LEDGER'
                    ? '📏 紧凑高密度表格'
                    : '🪪 宽松呼吸感卡片'}
                </Button>
                <Button
                  type="button"
                  variant="toggle"
                  size="sm"
                  aria-pressed={alignment.includeKpiStrip}
                  onClick={() =>
                    setAlignment((prev) => ({ ...prev, includeKpiStrip: !prev.includeKpiStrip }))
                  }
                >
                  {alignment.includeKpiStrip ? '✅ 含顶部经营 KPI 卡片' : '➕ 添加顶部经营 KPI 卡片'}
                </Button>
                <Button
                  type="button"
                  variant="toggle"
                  size="sm"
                  aria-pressed={alignment.includeApprovalFlow}
                  onClick={() =>
                    setAlignment((prev) => ({
                      ...prev,
                      includeApprovalFlow: !prev.includeApprovalFlow,
                    }))
                  }
                >
                  {alignment.includeApprovalFlow ? '✅ 含主管待办审批屏幕' : '➕ 添加待办审批屏幕'}
                </Button>
              </div>
            </div>

            {/* Freeform Agent Alignment Input */}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!chatNote.trim()) return;
                setAlignment((prev) => ({
                  ...prev,
                  customNotes: [...prev.customNotes, chatNote.trim()],
                }));
                setChatNote('');
              }}
            >
              <input
                className="input flex-1"
                placeholder={t(
                  '补充额外业务诉求给 Agent（如：满 10 万必须走风控复核、增加供应商筛选…）',
                  'Tell the Agent any extra requirement details…',
                )}
                value={chatNote}
                onChange={(e) => setChatNote(e.target.value)}
              />
              <Button type="submit" variant="secondary" size="sm">
                <Send size={13} />
                {t('补充对齐', 'Add Note')}
              </Button>
            </form>
            {alignment.customNotes.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {alignment.customNotes.map((n, idx) => (
                  <span key={`${idx}-${n}`} className="badge badge-ok">
                    ✓ {n}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Right Summary Card: Selected Visual Basket + Auto-Extracted DNA */}
          <div className="card flex flex-col justify-between gap-3">
            <div className="space-y-3">
              <div className="text-[13.5px] font-semibold text-ink">
                {t('已选视觉参考基因篮（自动合成为 UI/UE 规范）', 'Selected Visual Reference DNA')}
              </div>
              {selectedRefs.map((ref) => (
                <div
                  key={ref.slug}
                  className="flex items-center gap-3 rounded-control border border-line bg-inset/45 p-2.5"
                >
                  <div className="h-14 w-24 shrink-0 overflow-hidden rounded border border-line">
                    <InspoVisualImage item={ref} variant="thumb" className="h-full w-full" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-ink">{ref.title}</div>
                    <div className="text-[11.5px] text-ink-3">{ref.plainLabelZh}</div>
                    <div className="mt-1 flex items-center gap-1">
                      {ref.palette.slice(0, 5).map((hex, i) => (
                        <span
                          key={`${hex}-${i}`}
                          className="h-3 w-3 rounded-full border border-black/15"
                          style={{ background: hex }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <Button type="button" variant="accent" size="md" onClick={() => setStep(3)}>
              <Wand2 size={14} />
              {t('立即生成并预览对齐后的交互原型 →', 'Open Live Reference-Styled Prototype →')}
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" size="xs" onClick={() => setStep(1)}>
                ← {t('换一套视觉参考图', 'Change Visual Reference')}
              </Button>
              <Button type="button" variant="secondary" size="xs" onClick={() => setStep(2)}>
                ← {t('调整 Agent 需求对齐项', 'Adjust Alignment')}
              </Button>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="toggle"
                size="xs"
                aria-pressed={inspectMode}
                disabled={refining}
                onClick={() => {
                  if (showSource) setShowSource(false);
                  onInspectModeChange(!inspectMode);
                }}
              >
                <Crosshair size={12.5} aria-hidden="true" />
                {t('框选精修', 'Visual Select')}
                {annotations.length > 0 && (
                  <span className="rounded-full bg-accent px-1.5 font-mono text-[10px] text-accent-ink tabular-nums">
                    {annotations.length}
                  </span>
                )}
              </Button>
              <Button
                type="button"
                variant="toggle"
                size="xs"
                aria-pressed={showSource}
                onClick={() => {
                  onInspectModeChange(false);
                  setShowSource((s) => !s);
                }}
              >
                <Code2 size={12.5} />
                {showSource ? t('返回交互沙箱预览', 'Back to Sandbox') : t('查看带 MU 锚点的 HTML 源码', 'View MU HTML Source')}
              </Button>
            </div>
          </div>

          {showSource ? (
            <pre className="max-h-[560px] overflow-auto rounded-control border border-line bg-inset p-3 font-mono text-[11.5px] text-ink">
              {htmlContent}
            </pre>
          ) : (
            <div className="overflow-hidden rounded-control border border-line">
              <PrototypeVisualPreviewStage
                htmlContent={htmlContent}
                inspectMode={inspectMode}
                onInspectModeChange={onInspectModeChange}
                annotations={annotations}
                onAddAnnotation={onAddAnnotation}
                onApplyImmediate={onApplyImmediate}
                busy={refining}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// VARIANT B: 对话内嵌情绪板双栏工作台 (Conversational Moodboard + Live Canvas)
// ═════════════════════════════════════════════════════════════════════════════
interface MoodboardChatTurn {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  visualSuggestions?: InspoReferenceItem[];
  showDecisionChips?: boolean;
}

export function VariantB({
  project,
  doc,
  catalog,
  searching,
  onLiveSearch,
  onFindSimilar,
  selectedRefs,
  onToggleRef,
  alignment,
  setAlignment,
  onInspectItem,
  htmlContent,
  inspectMode,
  onInspectModeChange,
  annotations,
  onAddAnnotation,
  onApplyImmediate,
  refining,
}: SharedVariantProps) {
  const { t } = usePreferences();
  const [rightTab, setRightTab] = useState<'PREVIEW' | 'HTML'>('PREVIEW');
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<MoodboardChatTurn[]>(() => [
    {
      id: 'welcome-turn',
      role: 'assistant',
      text: `我已经读取了「${project.name}」的业务上下文${doc ? `（《${doc.title}》）` : ''}。不用描述复杂的 UI 术语——我先从 Inspo 真实产品库里挑了 4 种截然不同的界面质感，直接在气泡里点选您最顺眼的一张，右侧画布会实时换肤并重组交互！`,
      visualSuggestions: [
        CURATED_INSPO_CATALOG[0]!, // Clean SaaS
        CURATED_INSPO_CATALOG[3]!, // Fintech Ledger
        CURATED_INSPO_CATALOG[6]!, // Warm Paper
        CURATED_INSPO_CATALOG[8]!, // Dark Cockpit
      ],
      showDecisionChips: true,
    },
  ]);

  const handleSendChat = async (rawText?: string) => {
    const msg = (rawText ?? input).trim();
    if (!msg) return;
    setInput('');
    const userTurn: MoodboardChatTurn = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: msg,
    };
    setTurns((prev) => [...prev, userTurn]);

    // Check if user is asking for visual style exploration vs requirement adjustment
    if (/深色|暗黑|监控|清爽|白底|纸|金融|卡片|换一批|风格|参考|similar|dark|light/i.test(msg)) {
      const freshItems = await onLiveSearch(msg);
      setTurns((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: `已按「${msg}」从 Inspo 检索到以下真实产品界面截图，点击任意卡片即可直接套用到右侧业务原型：`,
          visualSuggestions: freshItems.slice(0, 4),
        },
      ]);
      return;
    }

    // Apply natural language requirement alignment tweaks immediately
    const nextPatch: Partial<RequirementAlignmentState> = {};
    if (/双栏|同屏|分栏/.test(msg)) nextPatch.entryPattern = 'INLINE_SPLIT';
    else if (/独立页|新页面|页签/.test(msg)) nextPatch.entryPattern = 'DEDICATED_TAB';
    else if (/抽屉|侧滑/.test(msg)) nextPatch.entryPattern = 'DRAWER';
    if (/去掉指标|不要指标|隐藏KPI/i.test(msg)) nextPatch.includeKpiStrip = false;
    if (/紧凑|密集/.test(msg)) nextPatch.layoutDensity = 'COMPACT_LEDGER';
    if (/宽松|卡片/.test(msg)) nextPatch.layoutDensity = 'MODULAR_CARDS';

    setAlignment((prev) => ({
      ...prev,
      ...nextPatch,
      customNotes: [...prev.customNotes, msg],
    }));

    setTurns((prev) => [
      ...prev,
      {
        id: `a-${Date.now()}`,
        role: 'assistant',
        text: `已将需求对齐项「${msg}」同步至右侧交互原型，并保留全部 MU 语义锚点（SCR / EL / UIE）。您可以直接在右侧点击试用，或继续告诉我哪里需要调整。`,
      },
    ]);
  };

  return (
    <div className="grid grid-cols-1 gap-3.5 pb-14 lg:grid-cols-[0.92fr_1.28fr]">
      {/* Left Column: Conversational Agent with Embedded Visual Reference Strips */}
      <div className="card flex h-[640px] flex-col justify-between gap-2.5 p-3">
        <div className="flex items-center justify-between border-b border-line pb-2">
          <div className="flex items-center gap-2">
            <MessageSquare size={15} className="text-accent" />
            <span className="font-semibold text-ink">
              {t('原型对齐 Agent（对话内嵌选图）', 'Prototype Alignment Agent')}
            </span>
          </div>
          <span className="badge badge-accent">Live Co-Design</span>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          {turns.map((turn) => (
            <div
              key={turn.id}
              className={cn(
                'rounded-card border p-3 text-[12.5px] leading-relaxed',
                turn.role === 'user'
                  ? 'ml-8 border-accent/30 bg-accent-tint/50 text-ink'
                  : 'mr-2 border-line bg-inset/45 text-ink',
              )}
            >
              <div>{turn.text}</div>

              {/* Embedded Visual Screenshot Picker Strip inside Chat Bubble */}
              {turn.visualSuggestions && turn.visualSuggestions.length > 0 && (
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  {turn.visualSuggestions.map((item) => {
                    const active = selectedRefs.some((r) => r.slug === item.slug);
                    return (
                      <div
                        key={item.slug}
                        onClick={() => onToggleRef(item)}
                        className={cn(
                          'cursor-pointer overflow-hidden rounded-control border bg-surface transition-all',
                          active ? 'border-accent ring-2 ring-accent/30' : 'border-line hover:border-accent/60',
                        )}
                      >
                        <div className="relative h-[92px] w-full overflow-hidden bg-inset">
                          <InspoVisualImage item={item} variant="thumb" className="h-full w-full" />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onInspectItem(item);
                            }}
                            className="absolute top-1.5 right-1.5 cursor-pointer rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white"
                          >
                            {t('放大', 'Zoom')}
                          </button>
                        </div>
                        <div className="p-2">
                          <div className="flex items-center justify-between gap-1">
                            <span className="truncate text-[11.5px] font-semibold text-ink">
                              {item.title}
                            </span>
                            {active && <Check size={12} className="shrink-0 text-accent" />}
                          </div>
                          <div className="text-[10.5px] text-ink-3">{item.plainLabelZh}</div>
                          <div className="mt-1 flex items-center justify-between">
                            <div className="flex gap-0.5">
                              {item.palette.slice(0, 4).map((hex, i) => (
                                <span
                                  key={`${hex}-${i}`}
                                  className="h-2.5 w-2.5 rounded-full border border-black/15"
                                  style={{ background: hex }}
                                />
                              ))}
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void onFindSimilar(item).then((sim) => {
                                  if (sim.length > 0) {
                                    setTurns((prev) => [
                                      ...prev,
                                      {
                                        id: `sim-${Date.now()}`,
                                        role: 'assistant',
                                        text: `为您找到与「${item.title}」视觉基因最接近的相似参考：`,
                                        visualSuggestions: sim.slice(0, 4),
                                      },
                                    ]);
                                  }
                                });
                              }}
                              className="cursor-pointer text-[10.5px] text-accent hover:underline"
                            >
                              {t('找相似', 'Similar')}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Embedded Scoped HITL Alignment Chips inside Chat Bubble */}
              {turn.showDecisionChips && (
                <div className="mt-2.5 space-y-1.5 border-t border-line pt-2">
                  <div className="text-[11px] font-semibold text-ink-2">
                    {t('点选对齐核心交互结构（右侧实时生效）：', 'Quickly align screen interaction:')}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      type="button"
                      variant="toggle"
                      size="xs"
                      aria-pressed={alignment.entryPattern === 'DRAWER'}
                      onClick={() => setAlignment((p) => ({ ...p, entryPattern: 'DRAWER' }))}
                    >
                      右侧抽屉新建
                    </Button>
                    <Button
                      type="button"
                      variant="toggle"
                      size="xs"
                      aria-pressed={alignment.entryPattern === 'INLINE_SPLIT'}
                      onClick={() => setAlignment((p) => ({ ...p, entryPattern: 'INLINE_SPLIT' }))}
                    >
                      左表右单同屏
                    </Button>
                    <Button
                      type="button"
                      variant="toggle"
                      size="xs"
                      aria-pressed={alignment.entryPattern === 'DEDICATED_TAB'}
                      onClick={() => setAlignment((p) => ({ ...p, entryPattern: 'DEDICATED_TAB' }))}
                    >
                      独立页签新建
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {searching && (
            <div className="flex items-center gap-2 px-2 text-[12px] text-ink-3">
              <Loader2 size={13} className="animate-spin" />
              {t('Agent 正在从 inspomcp.dev 检索视觉参考截图…', 'Searching inspomcp.dev…')}
            </div>
          )}
        </div>

        <div className="space-y-1.5 border-t border-line pt-2">
          <div className="flex flex-wrap gap-1">
            {[
              '换一批深色科技监控风参考图',
              '换一批温润纸感文档风参考图',
              '改成左表右单同屏录入，方便高频录单',
            ].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => void handleSendChat(q)}
                className="cursor-pointer rounded-full border border-line bg-inset px-2 py-0.5 text-[11px] text-ink-2 hover:border-accent hover:text-accent"
              >
                {q}
              </button>
            ))}
          </div>
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSendChat();
            }}
          >
            <input
              className="input flex-1"
              placeholder={t(
                '跟 Agent 聊视觉感觉或补充业务字段需求…',
                'Ask for another vibe or align screen requirements…',
              )}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <Button type="submit" variant="accent" size="sm" disabled={searching}>
              <Send size={13} />
            </Button>
          </form>
        </div>
      </div>

      {/* Right Column: Live Morphing Prototype Sandbox */}
      <div className="card flex h-[640px] flex-col overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-line bg-inset/45 px-3.5 py-2">
          <div className="flex items-center gap-2 text-[12px]">
            <Eye size={14} className="text-accent" />
            <span className="font-semibold text-ink">
              {t('实时联动业务原型沙箱', 'Live Reference-Synced Prototype')}
            </span>
            <span className="text-ink-3">
              ({selectedRefs.map((r) => r.title).join(' + ')})
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="toggle"
              size="xs"
              aria-pressed={inspectMode}
              disabled={refining}
              onClick={() => {
                if (rightTab === 'HTML') setRightTab('PREVIEW');
                onInspectModeChange(!inspectMode);
              }}
            >
              <Crosshair size={12} aria-hidden="true" />
              {t('框选精修', 'Visual Select')}
              {annotations.length > 0 && (
                <span className="rounded-full bg-accent px-1.5 font-mono text-[10px] text-accent-ink tabular-nums">
                  {annotations.length}
                </span>
              )}
            </Button>
            <Button
              type="button"
              variant="toggle"
              size="xs"
              aria-pressed={rightTab === 'PREVIEW'}
              onClick={() => setRightTab('PREVIEW')}
            >
              {t('交互预览', 'Live Preview')}
            </Button>
            <Button
              type="button"
              variant="toggle"
              size="xs"
              aria-pressed={rightTab === 'HTML'}
              onClick={() => {
                onInspectModeChange(false);
                setRightTab('HTML');
              }}
            >
              {t('MU 源码', 'MU HTML')}
            </Button>
          </div>
        </div>
        {rightTab === 'PREVIEW' ? (
          <PrototypeVisualPreviewStage
            htmlContent={htmlContent}
            inspectMode={inspectMode}
            onInspectModeChange={onInspectModeChange}
            annotations={annotations}
            onAddAnnotation={onAddAnnotation}
            onApplyImmediate={onApplyImmediate}
            busy={refining}
          />
        ) : (
          <pre className="m-0 flex-1 overflow-auto p-3 font-mono text-[11.5px] text-ink">
            {htmlContent}
          </pre>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// VARIANT C: 15秒二选一直觉审美盲测器 ("This-or-That" Pairwise Visual Tuner)
// ═════════════════════════════════════════════════════════════════════════════
const PAIRWISE_ROUNDS: {
  dimensionZh: string;
  questionZh: string;
  leftSlug: string;
  rightSlug: string;
}[] = [
  {
    dimensionZh: '第 1/3 轮：底色明暗与空间感',
    questionZh: '凭第一眼直觉，下面哪张真实界面的明暗氛围更适合您的业务团队日常使用？',
    leftSlug: 'amie-so',
    rightSlug: 'digitalocean-com',
  },
  {
    dimensionZh: '第 2/3 轮：台账严谨度 vs 模块卡片感',
    questionZh: '面对大量业务数据时，您更喜欢「银行级紧凑分割线」还是「模块化圆润卡片」？',
    leftSlug: 'increase-com',
    rightSlug: 'daybridge-com',
  },
  {
    dimensionZh: '第 3/3 轮：纸张书卷暖调 vs 现代干练冷调',
    questionZh: '最后一题：在细节色调上，偏好「温润纸张阅读感」还是「醒目橙色审批行动点」？',
    leftSlug: 'effectivealtruism-org',
    rightSlug: 'brex-com',
  },
];

export function VariantC({
  project,
  catalog,
  selectedRefs,
  onSelectSingleRef,
  alignment,
  setAlignment,
  onInspectItem,
  htmlContent,
  inspectMode,
  onInspectModeChange,
  annotations,
  onAddAnnotation,
  onApplyImmediate,
  refining,
}: SharedVariantProps) {
  const { t } = usePreferences();
  const [roundIdx, setRoundIdx] = useState(0);
  const [completedTuner, setCompletedTuner] = useState(false);
  const [noteInput, setNoteInput] = useState('');

  const round = PAIRWISE_ROUNDS[roundIdx] ?? PAIRWISE_ROUNDS[0]!;
  const leftItem =
    catalog.find((c) => c.slug === round.leftSlug) ?? CURATED_INSPO_CATALOG[0]!;
  const rightItem =
    catalog.find((c) => c.slug === round.rightSlug) ?? CURATED_INSPO_CATALOG[8]!;

  const handlePickWinner = (winner: InspoReferenceItem) => {
    onSelectSingleRef(winner);
    if (winner.vibeGroup === 'fintech') {
      setAlignment((p) => ({ ...p, layoutDensity: 'COMPACT_LEDGER' }));
    } else if (winner.vibeGroup === 'bento') {
      setAlignment((p) => ({ ...p, layoutDensity: 'MODULAR_CARDS' }));
    }
    if (roundIdx < PAIRWISE_ROUNDS.length - 1) {
      setRoundIdx((r) => r + 1);
    } else {
      setCompletedTuner(true);
    }
  };

  return (
    <div className="flex flex-col gap-3.5 pb-14">
      {/* Top Stage: Binary Visual Taste Duel (Zero Choice Paralysis) */}
      <div className="card flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="badge badge-accent">
                {completedTuner ? t('✅ 审美基因已锁定', 'Taste Locked') : round.dimensionZh}
              </span>
              <span className="font-serif text-[16px] font-semibold text-ink">
                {completedTuner
                  ? t(
                      `已锁定「${selectedRefs[0]?.title}」视觉体系，下方原型已实时套用！`,
                      `Locked "${selectedRefs[0]?.title}" visual DNA!`,
                    )
                  : round.questionZh}
              </span>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              setRoundIdx(0);
              setCompletedTuner(false);
            }}
          >
            <RefreshCw size={12} />
            {t('重新做 3 步二选一盲测', 'Restart 3-Click Taste Test')}
          </Button>
        </div>

        {!completedTuner && (
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
            {[leftItem, rightItem].map((candidate, sideIdx) => (
              <div
                key={candidate.slug}
                onClick={() => handlePickWinner(candidate)}
                className="group flex cursor-pointer flex-col overflow-hidden rounded-card border-2 border-line bg-surface transition-all hover:border-accent hover:shadow-md"
              >
                <div className="relative h-[190px] w-full overflow-hidden bg-inset">
                  <InspoVisualImage
                    item={candidate}
                    variant="hero"
                    className="h-full w-full transition-transform duration-300 group-hover:scale-[1.02]"
                  />
                  <span className="absolute top-2.5 left-2.5 rounded-full bg-black/75 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-white">
                    {sideIdx === 0 ? '选项左 (Option 1)' : '选项右 (Option 2)'}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onInspectItem(candidate);
                    }}
                    className="absolute top-2.5 right-2.5 cursor-pointer rounded-full bg-black/70 px-2.5 py-0.5 text-[11px] text-white"
                  >
                    {t('放大细看', 'Zoom')}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2 p-3">
                  <div>
                    <div className="font-semibold text-ink">
                      {candidate.title} · {candidate.plainLabelZh}
                    </div>
                    <div className="text-[12px] text-ink-3">{candidate.plainDescZh}</div>
                  </div>
                  <Button type="button" variant="accent" size="sm">
                    <ThumbsUp size={13} />
                    {t('这张更顺眼', 'I Prefer This')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Stage: Requirement Alignment Checklist Matrix + Live Morphing Prototype */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[310px_1fr]">
        <div className="card flex flex-col justify-between gap-3">
          <div className="space-y-3">
            <div className="border-b border-line pb-2">
              <div className="text-[13.5px] font-semibold text-ink">
                {t('需求与业务规则对齐开关', 'SRS & Ontology Alignment')}
              </div>
              <div className="text-[11.5px] text-ink-3">
                {t('每次勾选右侧「' + project.name + '」立即重排', 'Toggles update the live prototype instantly')}
              </div>
            </div>

            <div className="space-y-1.5 text-[12.5px]">
              <div className="font-medium text-ink-2">{t('新建录入形态', 'Form Entry Mode')}</div>
              {(
                [
                  { k: 'DRAWER', label: '右侧抽屉滑出录入' },
                  { k: 'INLINE_SPLIT', label: '左表右单同屏联办' },
                  { k: 'DEDICATED_TAB', label: '独立页签切换录入' },
                ] as const
              ).map((m) => (
                <label
                  key={m.k}
                  className="flex cursor-pointer items-center gap-2 rounded-control border border-line px-2.5 py-1.5 hover:bg-inset"
                >
                  <input
                    type="radio"
                    name="vc-entry"
                    checked={alignment.entryPattern === m.k}
                    onChange={() => setAlignment((p) => ({ ...p, entryPattern: m.k }))}
                  />
                  <span>{m.label}</span>
                </label>
              ))}
            </div>

            <div className="space-y-1.5 text-[12.5px]">
              <div className="font-medium text-ink-2">{t('业务功能对齐', 'Screen Capabilities')}</div>
              <label className="flex cursor-pointer items-center gap-2 rounded-control border border-line px-2.5 py-1.5 hover:bg-inset">
                <input
                  type="checkbox"
                  checked={alignment.includeKpiStrip}
                  onChange={(e) =>
                    setAlignment((p) => ({ ...p, includeKpiStrip: e.target.checked }))
                  }
                />
                <span>顶部核心指标统计卡片 (M7)</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-control border border-line px-2.5 py-1.5 hover:bg-inset">
                <input
                  type="checkbox"
                  checked={alignment.includeApprovalFlow}
                  onChange={(e) =>
                    setAlignment((p) => ({ ...p, includeApprovalFlow: e.target.checked }))
                  }
                />
                <span>主管待办审批队列屏幕 (M6)</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-control border border-line px-2.5 py-1.5 hover:bg-inset">
                <input
                  type="checkbox"
                  checked={alignment.includeGuidedWalkthrough}
                  onChange={(e) =>
                    setAlignment((p) => ({ ...p, includeGuidedWalkthrough: e.target.checked }))
                  }
                />
                <span>底部状态流转走查剧本条 (M2/M3)</span>
              </label>
            </div>
          </div>

          <form
            className="flex flex-col gap-1.5 border-t border-line pt-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!noteInput.trim()) return;
              setAlignment((p) => ({ ...p, customNotes: [...p.customNotes, noteInput.trim()] }));
              setNoteInput('');
            }}
          >
            <input
              className="input"
              placeholder={t('一句话告诉 Agent 补充要求…', 'One-line Agent instruction…')}
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
            />
            <Button type="submit" variant="secondary" size="sm">
              <Sparkles size={12.5} />
              {t('对话微调对齐', 'Align with Agent')}
            </Button>
          </form>
        </div>

        <div className="card overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-line bg-inset/45 px-3 py-2">
            <span className="text-[12px] font-semibold text-ink">
              {t('实时联动业务原型沙箱', 'Live Prototype Sandbox')}
            </span>
            <Button
              type="button"
              variant="toggle"
              size="xs"
              aria-pressed={inspectMode}
              disabled={refining}
              onClick={() => onInspectModeChange(!inspectMode)}
            >
              <Crosshair size={12} aria-hidden="true" />
              {t('框选精修', 'Visual Select')}
              {annotations.length > 0 && (
                <span className="rounded-full bg-accent px-1.5 font-mono text-[10px] text-accent-ink tabular-nums">
                  {annotations.length}
                </span>
              )}
            </Button>
          </div>
          <PrototypeVisualPreviewStage
            htmlContent={htmlContent}
            inspectMode={inspectMode}
            onInspectModeChange={onInspectModeChange}
            annotations={annotations}
            onAddAnnotation={onAddAnnotation}
            onApplyImmediate={onApplyImmediate}
            busy={refining}
          />
        </div>
      </div>
    </div>
  );
}

interface SharedVariantProps {
  project: ProjectDetail;
  doc: RequirementDoc | undefined;
  catalog: InspoReferenceItem[];
  searching: boolean;
  onLiveSearch: (query: string) => Promise<InspoReferenceItem[]>;
  onFindSimilar: (item: InspoReferenceItem) => Promise<InspoReferenceItem[]>;
  selectedRefs: InspoReferenceItem[];
  onToggleRef: (item: InspoReferenceItem) => void;
  onSelectSingleRef: (item: InspoReferenceItem) => void;
  alignment: RequirementAlignmentState;
  setAlignment: React.Dispatch<React.SetStateAction<RequirementAlignmentState>>;
  onInspectItem: (item: InspoReferenceItem) => void;
  htmlContent: string;
  inspectMode: boolean;
  onInspectModeChange: (next: boolean) => void;
  annotations: PrototypeVisualAnnotation[];
  onAddAnnotation: (target: PrototypeSelectionTarget, note: string) => void;
  onApplyImmediate: (target: PrototypeSelectionTarget, note: string) => void;
  refining: boolean;
}

// ─── Route Switcher Host (mounted on existing ?mode=app-prototype route) ─────
export function PrototypeInspoRouteHost({
  onExitToBaseline,
}: {
  onNavigate?: (view: NavViewId) => void;
  onExitToBaseline?: () => void;
}) {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [variant, setVariant] = useState<string>(() => readVariantSearchParam('A'));
  const [catalog, setCatalog] = useState<InspoReferenceItem[]>(CURATED_INSPO_CATALOG);
  const [searching, setSearching] = useState(false);
  const [selectedRefs, setSelectedRefs] = useState<InspoReferenceItem[]>([
    CURATED_INSPO_CATALOG[0]!,
  ]);
  const [inspectingItem, setInspectingItem] = useState<InspoReferenceItem | null>(null);
  const [alignment, setAlignment] = useState<RequirementAlignmentState>({
    entryPattern: 'DRAWER',
    layoutDensity: 'COMPACT_LEDGER',
    includeKpiStrip: true,
    includeApprovalFlow: true,
    includeGuidedWalkthrough: true,
    customNotes: [],
  });
  const [inspectMode, setInspectMode] = useState(false);
  const [annotations, setAnnotations] = useState<PrototypeVisualAnnotation[]>([]);
  const [refining, setRefining] = useState(false);
  const [refinedHtmlOverride, setRefinedHtmlOverride] = useState<string | null>(null);

  useEffect(() => {
    setRefinedHtmlOverride(null);
    setAnnotations([]);
  }, [data?.activeProject.id, selectedRefs, alignment]);

  if (!data) return null;
  const project = data.activeProject;
  const doc = data.requirementDocs[0];

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

  const handleLiveSearch = async (query: string): Promise<InspoReferenceItem[]> => {
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
        const normalized = json.items.map(normalizeLiveInspoItem);
        mergeLiveItems(normalized);
        showToast(
          t(
            `已从 Nutlope/inspo 实时拉取 ${normalized.length} 张真实站点截图`,
            `Fetched ${normalized.length} live references from Inspo`,
          ),
        );
        return normalized;
      }
    } catch {
      // Fallback to local curated catalog in offline contexts
    } finally {
      setSearching(false);
    }
    return catalog;
  };

  const handleFindSimilar = async (target: InspoReferenceItem): Promise<InspoReferenceItem[]> => {
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
        const normalized = json.items.map(normalizeLiveInspoItem);
        mergeLiveItems(normalized);
        showToast(
          t(
            `已按「${target.title}」的视觉向量找到 ${normalized.length} 款相似界面`,
            `Found ${normalized.length} visually similar designs to "${target.title}"`,
          ),
        );
        return normalized;
      }
    } catch {
      // Offline fallback
    } finally {
      setSearching(false);
    }
    return catalog.filter((c) => c.vibeGroup === target.vibeGroup);
  };

  const handleToggleRef = (item: InspoReferenceItem) => {
    setSelectedRefs((prev) => {
      const exists = prev.some((r) => r.slug === item.slug);
      if (exists) {
        return prev.length > 1 ? prev.filter((r) => r.slug !== item.slug) : prev;
      }
      return [item, ...prev].slice(0, 3);
    });
  };

  const handleSelectSingleRef = (item: InspoReferenceItem) => {
    setSelectedRefs([item]);
  };

  const baseHtmlContent = useMemo(
    () => buildReferenceStyledPrototypeHtml(project, doc, selectedRefs, alignment),
    [project, doc, selectedRefs, alignment],
  );
  const htmlContent = refinedHtmlOverride ?? baseHtmlContent;

  const handleAddAnnotation = (target: PrototypeSelectionTarget, note: string) => {
    setAnnotations((prev) => {
      const nextIndex = prev.length + 1;
      return [...prev, { id: `inspo-ann-${Date.now()}-${nextIndex}`, index: nextIndex, target, note }];
    });
  };

  const handleApplyVisualRefine = async (target: PrototypeSelectionTarget, note: string) => {
    if (refining) return;
    const selections = toRefinementSelections(annotations, { target, note });
    setRefining(true);
    try {
      const refSummary = selectedRefs.map((r) => r.title).join(' + ') || 'Inspo';
      const hasDomainOntology = (project.suite.M1?.aggregates.length ?? 0) > 0;
      const saveRes = await fetch(`/api/projects/${project.id}/prototypes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${project.name} · ${refSummary} 参考原型.html`,
          version: 'v5.2-inspo',
          htmlContent,
          syncMu: hasDomainOntology,
        }),
      });
      const saveJson = await saveRes.json();
      const protoId = saveJson.prototype?.id as string | undefined;
      if (!protoId) return;

      const refined = await apiRefinePrototype(project.id, protoId, note, selections);
      setRefinedHtmlOverride(refined.prototype.htmlContent);
      patchData({
        activeProject: refined.project,
        prototypes: refined.prototypes,
      });
      setAnnotations([]);
      setInspectMode(false);
      showToast(
        t(
          `AI 已按框选区域完成局部精修并同步 ${refined.prototype.extractedScreenCount} 个 MU 屏幕`,
          `AI refined selected region & synced ${refined.prototype.extractedScreenCount} MU screens`,
        ),
      );
    } finally {
      setRefining(false);
    }
  };

  const handleApplyToRealStudio = async (html: string, refSummary: string) => {
    const res = await fetch(`/api/projects/${project.id}/prototypes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${project.name} · ${refSummary} 参考原型.html`,
        version: 'v5.2-inspo',
        htmlContent: html,
        syncMu: true,
      }),
    });
    const json = await res.json();
    patchData({
      activeProject: json.project,
      prototypes: json.prototypes,
    });
    showToast(
      t(
        `已将参考「${refSummary}」生成的原型落库并提取 ${json.prototype.extractedScreenCount} 个 MU 屏幕`,
        `Saved prototype styled after "${refSummary}" & synced MU`,
      ),
    );
    onExitToBaseline?.();
  };

  const variantOptions = [
    { key: 'A', label: t('视觉画廊三步导购', 'Gallery Wizard') },
    { key: 'B', label: t('对话内嵌情绪板', 'Chat Moodboard') },
    { key: 'C', label: t('15秒二选一审美快筛', 'This-or-That Tuner') },
  ];

  const activeVariantMeta =
    variantOptions.find((v) => v.key === variant) ?? variantOptions[0]!;

  const sharedProps: SharedVariantProps = {
    project,
    doc,
    catalog,
    searching,
    onLiveSearch: handleLiveSearch,
    onFindSimilar: handleFindSimilar,
    selectedRefs,
    onToggleRef: handleToggleRef,
    onSelectSingleRef: handleSelectSingleRef,
    alignment,
    setAlignment,
    onInspectItem: setInspectingItem,
    htmlContent,
    inspectMode,
    onInspectModeChange: setInspectMode,
    annotations,
    onAddAnnotation: handleAddAnnotation,
    onApplyImmediate: (target, note) => void handleApplyVisualRefine(target, note),
    refining,
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Prototype Notice + State Surface (Rule 1 & Rule 5 of .agents/skills/prototype) */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-window border border-line bg-surface px-3.5 py-2">
        <div className="flex items-center gap-2 text-[12.5px]">
          <FlaskConical size={14} className="text-accent" />
          <strong>
            {t(
              '交互方案对比小样（底部悬浮条或 ← / → 键可实时切换 A / B / C 三套结构方案）',
              'UI Prototype Exploration — use bottom bar or ← / → keys to compare Variants A, B, C',
            )}
          </strong>
        </div>
        {onExitToBaseline && (
          <Button type="button" variant="ghost" size="xs" onClick={onExitToBaseline}>
            {t('切换回原版界面原型工作台', 'View Existing Studio')}
          </Button>
        )}
      </div>

      <PrototypeStateSurfaceBar
        variantKey={activeVariantMeta.key}
        variantTitle={activeVariantMeta.label}
        selectedRefs={selectedRefs}
        alignment={alignment}
        htmlContent={htmlContent}
        domain={project.domain}
        onApplyToRealStudio={(html, summary) => void handleApplyToRealStudio(html, summary)}
      />

      {activeVariantMeta.key === 'A' && <VariantA {...sharedProps} />}
      {activeVariantMeta.key === 'B' && <VariantB {...sharedProps} />}
      {activeVariantMeta.key === 'C' && <VariantC {...sharedProps} />}

      <InspoPreviewModal
        item={inspectingItem}
        isSelected={Boolean(
          inspectingItem && selectedRefs.some((r) => r.slug === inspectingItem.slug),
        )}
        onToggleSelect={handleToggleRef}
        onFindSimilar={(item) => void handleFindSimilar(item)}
        onClose={() => setInspectingItem(null)}
      />

      <PrototypeSwitcher
        variants={variantOptions}
        current={activeVariantMeta.key}
        onChange={setVariant}
      />
    </div>
  );
}
