import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Send,
  Sparkles,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import type {
  ProjectDetail,
  PrototypeArtifact,
  RequirementDoc,
} from '../../../packages/workspace-store/index.js';
import { Button } from '../beautifui/index.js';
import {
  MotionSchematicGallery,
  StyleTileMotionSampleStrip,
  formatMotionSpecsForAgentPrompt,
  inferDefaultAlignmentFromSrs,
  type RequirementAlignmentState,
} from './MotionSchematicGallery.js';
import type {
  PrototypeSelectionTarget,
  PrototypeVisualAnnotation,
} from './PrototypeVisualInspector.js';
import {
  CURATED_INSPO_CATALOG,
  LIKED_ASPECT_OPTIONS,
  VisualReferenceImage,
  VisualReferencePicker,
  createInitialVisualReferenceSelection,
  inspoFullUrl,
  inspoHeroUrl,
  inspoMobileUrl,
  inspoThumbUrl,
  visualSelectionToLegacyPreferences,
  type BorrowedReferenceSelection,
  type LikedAspectKey,
  type SelectedInspoPreference,
  type VisualReferenceItem,
  type VisualReferenceSelection,
} from './VisualReferencePicker.js';
import { usePreferences } from '../../i18n.js';

export type InspoReferenceItem = VisualReferenceItem;

export {
  CURATED_INSPO_CATALOG,
  LIKED_ASPECT_OPTIONS,
  StyleTileMotionSampleStrip,
  VisualReferencePicker,
  inspoFullUrl,
  inspoHeroUrl,
  inspoMobileUrl,
  inspoThumbUrl,
  type BorrowedReferenceSelection,
  type LikedAspectKey,
  type SelectedInspoPreference,
  type VisualReferenceItem,
  type VisualReferenceSelection,
};

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

  const motionSpecsBlock = formatMotionSpecsForAgentPrompt(alignment, locale);
  const customNoteLines = (alignment.customNotes ?? [])
    .filter((n) => n.trim().length > 0)
    .map((note) =>
      locale === 'en-US'
        ? `- Domain & Custom Alignment Note: ${note.trim()}`
        : `- 用户补充业务与交互要求：${note.trim()}`,
    );

  if (locale === 'en-US') {
    return [
      '=== VISUAL REFERENCE DNA & USER LIKED REASONS ===',
      `Primary Background/Surface Token Source: ${bgDonor.item.title} (${bgDonor.item.mode} mode, canvas ${bgDonor.item.surfaceHex})`,
      `Primary CTA/Accent Token Source: ${accentDonor.item.title} (accent ${accentDonor.likedSwatches[0] || accentDonor.item.palette[0]})`,
      ...refLines,
      '',
      motionSpecsBlock,
      ...(customNoteLines.length > 0 ? ['', ...customNoteLines] : []),
    ].join('\n');
  }

  return [
    '【一、用户挑选的视觉参考大图与喜欢原因（请严格落实配色、背景与排版质感）】',
    `- 页面大背景与明暗基调来源：${bgDonor.item.title}（${bgDonor.item.mode === 'dark' ? '深色模式' : '浅色模式'}，推荐画布背景色 ${bgDonor.item.surfaceHex}）`,
    `- 主按钮与强调色来源：${accentDonor.item.title}（推荐主色 ${accentDonor.likedSwatches[0] || accentDonor.item.palette[0]}，圆角 ${refs[0]!.item.radiusPx}px）`,
    ...refLines,
    '',
    motionSpecsBlock,
    ...(customNoteLines.length > 0 ? ['', ...customNoteLines] : []),
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

export interface PrototypeCoDesignStudioProps {
  project: ProjectDetail;
  docs: RequirementDoc[];
  selectedDocId: string;
  onSelectDocId: (docId: string) => void;
  prototypes: PrototypeArtifact[];
  selectedProtoId?: string;
  onSelectProtoId?: (id: string) => void;
  activeStep?: 1 | 2 | 3;
  onStepChange?: (step: 1 | 2 | 3) => void;
  previewSource?: 'REFERENCE_DRAFT' | 'SAVED_PROTO';
  onPreviewSourceChange?: (src: 'REFERENCE_DRAFT' | 'SAVED_PROTO') => void;
  savedHtmlContent?: string;
  onSavedHtmlContentChange?: (html: string) => void;
  onDraftHtmlChange?: (html: string, refTitleSummary: string) => void;
  onSaveDraftAsPrototype?: (html: string, refTitleSummary: string) => Promise<void>;
  onGenerateWithAi: (compiledPrompt: string, docId?: string) => Promise<void>;
  onBackToCanvas?: () => void;
  onImportHtmlClick?: () => void;
  onCloneVersion?: () => void;
  onDeleteProto?: (proto: PrototypeArtifact) => void;
  onDownloadHtml?: (html: string, name?: string) => void;
  inspectMode?: boolean;
  onInspectModeChange?: (next: boolean) => void;
  visualAnnotations?: PrototypeVisualAnnotation[];
  onAddVisualAnnotation?: (target: PrototypeSelectionTarget, note: string) => void;
  onRemoveVisualAnnotation?: (id: string) => void;
  onClearVisualAnnotations?: () => void;
  refineInstruction?: string;
  onRefineInstructionChange?: (val: string) => void;
  onApplyRefine?: (
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
  onDraftHtmlChange,
  onGenerateWithAi,
  onBackToCanvas,
  onImportHtmlClick,
  isBusyProto,
}: PrototypeCoDesignStudioProps) {
  const { locale, t } = usePreferences();
  const referencesAnchorRef = useRef<HTMLDivElement | null>(null);
  const schematicsAnchorRef = useRef<HTMLDivElement | null>(null);

  const [referenceSelection, setReferenceSelection] = useState<VisualReferenceSelection>(() =>
    createInitialVisualReferenceSelection(CURATED_INSPO_CATALOG[0]!),
  );

  const selectedPrefs = useMemo(
    () => visualSelectionToLegacyPreferences(referenceSelection),
    [referenceSelection],
  );

  const activeDoc = docs.find((d) => d.id === selectedDocId) ?? docs[0];
  const [alignmentTouched, setAlignmentTouched] = useState(false);
  const [alignment, setAlignmentState] = useState<RequirementAlignmentState>(() =>
    inferDefaultAlignmentFromSrs(activeDoc?.content, project),
  );
  const setAlignment: React.Dispatch<React.SetStateAction<RequirementAlignmentState>> = (
    updater,
  ) => {
    setAlignmentTouched(true);
    setAlignmentState(updater);
  };
  useEffect(() => {
    if (!alignmentTouched) {
      setAlignmentState(inferDefaultAlignmentFromSrs(activeDoc?.content, project));
    }
  }, [activeDoc?.id, activeDoc?.content, project, alignmentTouched]);
  const [customNoteDraft, setCustomNoteDraft] = useState('');

  const draftHtml = useMemo(
    () => buildReferenceStyledPrototypeHtml(project, activeDoc, selectedPrefs, alignment),
    [project, activeDoc, selectedPrefs, alignment],
  );

  const refTitleSummary = useMemo(
    () => selectedPrefs.map((p) => p.item.title).join(' + ') || 'Reference',
    [selectedPrefs],
  );

  useEffect(() => {
    onDraftHtmlChange?.(draftHtml, refTitleSummary);
  }, [draftHtml, refTitleSummary]);

  const compiledAgentPrompt = useMemo(
    () => buildAgentPrototypeContextPrompt(selectedPrefs, alignment, locale),
    [selectedPrefs, alignment, locale],
  );

  const primaryAccent = useMemo(() => {
    const donor =
      selectedPrefs.find((p) => p.likedAspects.includes('accentColor')) ??
      selectedPrefs[0];
    return donor?.likedSwatches[0] || donor?.item.palette[0] || '#2563eb';
  }, [selectedPrefs]);

  return (
    <section
      data-testid="prototype-briefing-stage"
      aria-label={t('界面原型简报工作区', 'Prototype Design Brief Stage')}
      className="flex flex-col gap-3.5"
    >
      {/* ─── Briefing Stage Header (Single-Page Briefing, no 1 -> 2 -> 3 wizard) ─── */}
      <header
        data-testid="prototype-briefing-header"
        className="card flex flex-wrap items-center justify-between gap-3 py-3"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-[15px] font-semibold text-ink">
              {t('设计简报 · 视觉参考与交互对齐', 'Design Brief · References & Schematics')}
            </h2>
            <span className="badge font-mono text-[11px]">
              {t(
                `主参考 ${referenceSelection.primary.title}${referenceSelection.borrowed.length > 0 ? ` + ${referenceSelection.borrowed.length} 借鉴` : ''}`,
                `Primary: ${referenceSelection.primary.title}${referenceSelection.borrowed.length > 0 ? ` +${referenceSelection.borrowed.length}` : ''}`,
              )}
            </span>
          </div>
          <p className="m-0 mt-0.5 text-[12px] text-muted">
            {t(
              '挑选主参考与动态交互示意，确认方向后由 AI Agent 生成可交互原型并进入画布阶段。',
              'Pick your primary reference and interactive schematics, then generate a runnable prototype in Canvas Stage.',
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {prototypes.length > 0 && onBackToCanvas && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="prototype-back-to-canvas-btn"
              onClick={onBackToCanvas}
            >
              <ArrowLeft size={13.5} aria-hidden="true" />
              {t(
                `返回画布 (${prototypes.length})`,
                `Back to Canvas (${prototypes.length})`,
              )}
            </Button>
          )}
          {onImportHtmlClick && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="briefing-import-html-btn"
              onClick={onImportHtmlClick}
            >
              <Upload size={13.5} aria-hidden="true" />
              {t('导入 HTML', 'Import HTML')}
            </Button>
          )}
          <Button
            type="button"
            variant="accent"
            size="sm"
            data-testid="briefing-generate-prototype-btn"
            disabled={isBusyProto}
            onClick={() => void onGenerateWithAi(compiledAgentPrompt, selectedDocId || undefined)}
          >
            {isBusyProto ? (
              <Loader2 size={13.5} className="animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles size={13.5} aria-hidden="true" />
            )}
            {t('让 Agent 生成原型', 'Generate Prototype with Agent')}
          </Button>
        </div>
      </header>

      {/* ─── Visual Reference Picker ─── */}
      <div ref={referencesAnchorRef}>
        <VisualReferencePicker
          selection={referenceSelection}
          onSelectionChange={setReferenceSelection}
          projectId={project.id}
          {...(activeDoc ? { docId: activeDoc.id } : {})}
          onContinue={() => {
            schematicsAnchorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
          }}
          continueLabelZh="继续对齐下方动态交互示意 ↓"
          continueLabelEn="Continue to Interactive Schematics ↓"
        />
      </div>

      {/* ─── Motion Schematics + Agent Context Blueprint ─── */}
      <div
        ref={schematicsAnchorRef}
        className="grid grid-cols-1 gap-4 xl:grid-cols-[1.45fr_0.85fr]"
      >
        <div className="card flex flex-col gap-4">
          <MotionSchematicGallery
            alignment={alignment}
            setAlignment={setAlignment}
            accentColor={primaryAccent}
            palette={{
              accentColor: primaryAccent,
              surfaceColor: referenceSelection.primary.surfaceHex,
              inkColor: referenceSelection.primary.mode === 'dark' ? '#f1f5f9' : '#1e1d1b',
              radiusPx: referenceSelection.primary.radiusPx,
            }}
            {...(activeDoc ? { srsMarkdown: activeDoc.content } : {})}
            project={project}
          />

          <div className="rounded-card border border-line bg-inset/45 p-3.5">
            <div className="mb-2 text-[13px] font-semibold text-ink">
              {t(
                '补充业务场景或页面细节（选填）',
                'Extra business details for the Agent (Optional)',
              )}
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
                  '例如：超过 10 万金额标红预警、列表增加「所属部门」筛选…',
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

        <div className="card flex flex-col justify-between gap-4 self-start">
          <div className="flex flex-col gap-3.5">
            <div className="border-b border-line pb-2.5">
              <div className="text-[14.5px] font-semibold text-ink">
                {t('设计简报上下文汇总', 'Design Brief Context Summary')}
              </div>
              <p className="m-0 mt-0.5 text-[12px] text-ink-3">
                {t(
                  '包含您挑选的主参考、可选借鉴参考、动态交互示意图以及工程需求文档。',
                  'Combines your Primary Reference, Borrowed References, motion schematics, and SRS.',
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

            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-[12px] font-semibold text-ink-2">
                <span>{t('已选主参考与借鉴参考', 'Primary & Borrowed References')}</span>
                <button
                  type="button"
                  onClick={() =>
                    referencesAnchorRef.current?.scrollIntoView?.({
                      behavior: 'smooth',
                      block: 'start',
                    })
                  }
                  className="cursor-pointer text-accent hover:underline"
                >
                  {t('调整参考图 ↑', 'Edit References ↑')}
                </button>
              </div>

              <div className="flex items-center gap-2.5 rounded-card border border-accent/40 bg-accent-tint/25 p-2.5">
                <div className="h-14 w-24 shrink-0 overflow-hidden rounded border border-line bg-surface">
                  <VisualReferenceImage
                    item={referenceSelection.primary}
                    variant="hero"
                    className="h-full w-full"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="inline-flex items-center gap-1.5 truncate font-semibold text-[13px] text-ink">
                      <span className="badge badge-accent">{t('主参考', 'Primary')}</span>
                      <span>{referenceSelection.primary.title}</span>
                    </span>
                    <a
                      href={referenceSelection.primary.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 font-mono text-[10.5px] text-ink-3 hover:text-accent"
                    >
                      <span>{referenceSelection.primary.sourceDomain}</span>
                      <ExternalLink size={10} />
                    </a>
                  </div>
                  <div className="text-[11.5px] text-ink-3">
                    {t(
                      referenceSelection.primary.plainLabelZh,
                      referenceSelection.primary.plainLabelEn,
                    )}
                  </div>
                </div>
              </div>

              {referenceSelection.borrowed.map((borrowed) => {
                const aspectMeta = LIKED_ASPECT_OPTIONS.find((o) => o.key === borrowed.aspect);
                return (
                  <div
                    key={borrowed.item.slug}
                    className="flex items-center gap-2.5 rounded-card border border-line bg-inset/40 p-2.5"
                  >
                    <div className="h-12 w-20 shrink-0 overflow-hidden rounded border border-line bg-surface">
                      <VisualReferenceImage
                        item={borrowed.item}
                        variant="hero"
                        className="h-full w-full"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate font-semibold text-[12.5px] text-ink">
                          {borrowed.item.title}
                        </span>
                        <a
                          href={borrowed.item.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-0.5 font-mono text-[10.5px] text-ink-3 hover:text-accent"
                        >
                          <span>{borrowed.item.sourceDomain}</span>
                          <ExternalLink size={10} />
                        </a>
                      </div>
                      <div className="text-[11.5px] text-accent">
                        {t(
                          `借鉴参考 · ${aspectMeta?.labelZh ?? borrowed.aspect}`,
                          `Borrowed · ${aspectMeta?.labelEn ?? borrowed.aspect}`,
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <StyleTileMotionSampleStrip
              selection={alignment}
              palette={{
                accentColor: primaryAccent,
                surfaceColor: referenceSelection.primary.surfaceHex,
                inkColor: referenceSelection.primary.mode === 'dark' ? '#f1f5f9' : '#1e1d1b',
                radiusPx: referenceSelection.primary.radiusPx,
              }}
              {...(activeDoc ? { srsMarkdown: activeDoc.content } : {})}
              project={project}
            />

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
              onClick={() => void onGenerateWithAi(compiledAgentPrompt, selectedDocId || undefined)}
            >
              <Wand2 size={14} />
              {t(
                '✨ 让 AI Agent 按全部上下文生成业务原型 →',
                '✨ Generate Custom Prototype with AI Agent →',
              )}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
