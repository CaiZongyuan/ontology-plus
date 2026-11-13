import React, { useState } from 'react';
import {
  Check,
  Edit3,
  Loader2,
  Palette,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import type {
  AgentImageAttachmentRef,
  AgentImageAttachmentRole,
  DesignBrief,
  DesignBriefBorrowedReference,
  DesignBriefItem,
  InteractivePrototype,
  ProjectDetail,
  RequirementDoc,
  VisualReferenceItem,
} from '../../../packages/workspace-store/index.js';
import type { TransientTurnImageInput } from '../../../packages/agent-runtime/index.js';
import { usePreferences } from '../../i18n.js';
import { loadLocalImage, resolveTurnImagesForRequest } from '../../lib/localImageStore.js';
import { LocalImageThumbnail, VisionCapabilityBanner } from '../agent/VisionAttachmentControls.js';
import { Button } from '../beautifui/index.js';
import {
  DEFAULT_ALIGNMENT_STATE,
  MOTION_SCHEMATICS_BY_ID,
  MOTION_SCHEMATIC_GROUPS,
  StyleTileMotionSampleStrip,
  extractDomainNounsFromSrs,
  formatMotionSpecsForAgentPrompt,
  inferDefaultAlignmentFromSrs,
  resolveMotionSelection,
  syncAlignmentWithSelection,
  type MotionSchematicId,
  type MotionSchematicSelection,
  type RequirementAlignmentState,
} from './MotionSchematicGallery.js';
import {
  CURATED_INSPO_CATALOG,
  LIKED_ASPECT_OPTIONS,
  createInitialVisualReferenceSelection,
  inspoFullUrl,
  inspoHeroUrl,
  recommendVisualReferences,
  upsertBorrowedReference,
  type LikedAspectKey,
  type VisualReferenceSelection,
} from './VisualReferencePicker.js';

export interface StyleTileTokens {
  mode: 'light' | 'dark';
  surfaceHex: string;
  cardHex: string;
  insetHex: string;
  accentHex: string;
  accentInkHex: string;
  secondaryAccentHex: string;
  borderHex: string;
  inkHex: string;
  mutedInkHex: string;
  semanticOkHex: string;
  semanticWarnHex: string;
  semanticDangerHex: string;
  fontFamily: string;
  fontDisplayLabel: string;
  radiusPx: number;
  isCompact: boolean;
}

function isLightHexColor(hex: string): boolean {
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) return true;
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return (r * 299 + g * 587 + b * 114) / 1000 >= 140;
}

function pickReadableInkForAccent(hex: string): string {
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) return '#ffffff';
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 165 ? '#111827' : '#ffffff';
}

export function deriveStyleTileTokens(
  selection: VisualReferenceSelection,
  alignment: RequirementAlignmentState = DEFAULT_ALIGNMENT_STATE,
  userFeelNote = '',
): StyleTileTokens {
  const bgDonor =
    selection.borrowed.find((b) => b.aspect === 'bgColor')?.item ?? selection.primary;
  const accentDonor =
    selection.borrowed.find((b) => b.aspect === 'accentColor')?.item ?? selection.primary;
  const borderDonor =
    selection.borrowed.find((b) => b.aspect === 'cardBorder')?.item ?? selection.primary;
  const typoDonor =
    selection.borrowed.find((b) => b.aspect === 'typography')?.item ?? selection.primary;
  const spacingBorrowed = selection.borrowed.some((b) => b.aspect === 'spacing');
  const clarityBorrowed = selection.borrowed.some((b) => b.aspect === 'dataClarity');

  const feelLower = userFeelNote.toLowerCase();
  const explicitDarkCue =
    /深色|暗黑|暗色|黑底|夜间|dark\s*mode|dark\s*theme|dark\s*cockpit/.test(feelLower) &&
    !/浅色|白底|纸感|light\s*mode/.test(feelLower);
  const explicitLightCue =
    /浅色|白底|暖白|纸感|light\s*mode|warm\s*paper/.test(feelLower) && !explicitDarkCue;

  let surfaceHex = bgDonor.surfaceHex || '#f8fafc';
  if (explicitDarkCue && isLightHexColor(surfaceHex)) {
    surfaceHex = '#0f172a';
  } else if (explicitLightCue && !isLightHexColor(surfaceHex)) {
    surfaceHex = '#f8f5ef';
  }

  const isDark =
    explicitDarkCue || (!explicitLightCue && (!isLightHexColor(surfaceHex) || bgDonor.mode === 'dark'));
  const isWarmPaper = !isDark && bgDonor.vibeGroup === 'warm-paper';

  const cardHex = isDark ? '#162033' : isWarmPaper ? '#fffdf9' : '#ffffff';
  const insetHex = isDark ? '#1e293b' : isWarmPaper ? '#f2ece1' : '#f1f5f9';
  const borderHex = isDark ? '#334155' : isWarmPaper ? '#dfd6c7' : '#e2e8f0';
  const inkHex = isDark ? '#f1f5f9' : isWarmPaper ? '#1f1d1a' : '#0f172a';
  const mutedInkHex = isDark ? '#94a3b8' : isWarmPaper ? '#6b6459' : '#64748b';

  const accentHex = accentDonor.palette[0] || '#2563eb';
  const secondaryAccentHex =
    accentDonor.palette[1] || selection.primary.palette[1] || accentHex;
  const accentInkHex = pickReadableInkForAccent(accentHex);

  const semanticOkHex = isDark ? '#34d399' : '#15803d';
  const semanticWarnHex = isDark ? '#fbbf24' : '#b45309';
  const semanticDangerHex = isDark ? '#f87171' : '#dc2626';

  const fontDisplayLabel = typoDonor.fonts[0] || 'Inter';
  const fontFamily =
    typoDonor.vibeGroup === 'warm-paper'
      ? `'Georgia', 'Noto Serif SC', -apple-system, sans-serif`
      : `'${fontDisplayLabel}', -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif`;

  const resolvedMotion = resolveMotionSelection(alignment);
  const compactCue =
    /紧凑|高密度|台账|交易|compact|dense|ledger|trading/.test(feelLower) &&
    !/宽松|呼吸|大留白|airy|spacious/.test(feelLower);
  const airyCue = /宽松|呼吸|大留白|airy|spacious/.test(feelLower);

  const isCompact = airyCue
    ? false
    : compactCue ||
      clarityBorrowed ||
      (!spacingBorrowed && resolvedMotion.informationDensity === 'COMPACT_LEDGER');

  return {
    mode: isDark ? 'dark' : 'light',
    surfaceHex,
    cardHex,
    insetHex,
    accentHex,
    accentInkHex,
    secondaryAccentHex,
    borderHex,
    inkHex,
    mutedInkHex,
    semanticOkHex,
    semanticWarnHex,
    semanticDangerHex,
    fontFamily,
    fontDisplayLabel,
    radiusPx: borderDonor.radiusPx,
    isCompact,
  };
}

export interface SynthesizeDesignBriefParams {
  project: ProjectDetail;
  doc?: RequirementDoc;
  referenceSelection: VisualReferenceSelection;
  alignment: RequirementAlignmentState;
  userFeelNote?: string;
  localAttachmentCount?: number;
  locale?: 'zh-CN' | 'en-US';
}

export function collectSelectedMotionSchematicIds(
  alignment: RequirementAlignmentState,
): MotionSchematicId[] {
  const resolved = resolveMotionSelection(alignment);
  return MOTION_SCHEMATIC_GROUPS.map((g) => resolved[g.key]);
}

export function synthesizeDesignBriefItems({
  project,
  doc,
  referenceSelection,
  alignment,
  userFeelNote = '',
  localAttachmentCount = 0,
  locale = 'zh-CN',
}: SynthesizeDesignBriefParams): DesignBriefItem[] {
  const tokens = deriveStyleTileTokens(referenceSelection, alignment, userFeelNote);
  const resolvedMotion = resolveMotionSelection(alignment);
  const nouns = extractDomainNounsFromSrs(doc?.content, project);
  const trimmedFeel = userFeelNote.trim();

  const borrowedParts = referenceSelection.borrowed.map((b) => {
    const meta = LIKED_ASPECT_OPTIONS.find((o) => o.key === b.aspect);
    const aspectName =
      locale === 'en-US' ? (meta?.labelEn ?? b.aspect) : (meta?.labelZh ?? b.aspect);
    const noteSuffix = b.reasonNote?.trim()
      ? locale === 'en-US'
        ? ` ("${b.reasonNote.trim()}")`
        : `（「${b.reasonNote.trim()}」）`
      : '';
    return locale === 'en-US'
      ? `${b.item.title} [${aspectName}]${noteSuffix}`
      : `${b.item.title}【借鉴：${aspectName}】${noteSuffix}`;
  });

  const motionSummaries = MOTION_SCHEMATIC_GROUPS.map((group) => {
    const id = resolvedMotion[group.key];
    const spec = MOTION_SCHEMATICS_BY_ID[id];
    return locale === 'en-US' ? spec.plainTitle.en : spec.plainTitle.zh;
  });

  const customNoteSuffix =
    alignment.customNotes.length > 0
      ? locale === 'en-US'
        ? ` Extra notes: ${alignment.customNotes.join('; ')}.`
        : ` 补充交互细节：${alignment.customNotes.join('；')}。`
      : '';

  if (locale === 'en-US') {
    const items: DesignBriefItem[] = [
      {
        id: 'brief-tone',
        category: 'tone_palette',
        statement: `Visual Tone & Palette: Primary reference "${referenceSelection.primary.title}" (${tokens.mode} mode, canvas ${tokens.surfaceHex}, card ${tokens.cardHex}, primary accent ${tokens.accentHex})${borrowedParts.length > 0 ? `; borrowed traits from ${borrowedParts.join(', ')}` : ''}${referenceSelection.primaryNote?.trim() ? `. Primary note: "${referenceSelection.primaryNote.trim()}"` : ''}.`,
      },
      {
        id: 'brief-typography',
        category: 'typography',
        statement: `Typography & Data Hierarchy: "${tokens.fontDisplayLabel}" font stack with clear section hierarchy, crisp hairline borders (${tokens.radiusPx}px radius), and right-aligned tabular-nums for all financial/metric figures.`,
      },
      {
        id: 'brief-density',
        category: 'density_layout',
        statement: `Density & Responsive Layout: ${tokens.isCompact ? 'High-density compact ledger rhythm for rapid multi-row scanning' : 'Balanced modular card spacing with clear visual breathing room'}, responsive across Desktop (1440px), Tablet (768px), and Mobile (390px).`,
      },
      {
        id: 'brief-motion',
        category: 'motion_interaction',
        statement: `7 Interactive Motion Behaviors: ${motionSummaries.join(' · ')}.${customNoteSuffix}`,
      },
    ];

    if (trimmedFeel || localAttachmentCount > 0) {
      items.push({
        id: 'brief-user-feel',
        category: 'user_feel',
        statement: `User Feel & Visual Notes: ${trimmedFeel ? `"${trimmedFeel}"` : 'Follow uploaded visual reference screenshots'}${localAttachmentCount > 0 ? ` (${localAttachmentCount} browser-local reference image(s) attached)` : ''}.`,
      });
    }

    items.push({
      id: 'brief-scope',
      category: 'screen_scope',
      statement: `Business Screen Scope (${doc ? doc.title : project.name}): Cover core workflows for "${nouns.primaryEntity.en}" and "${nouns.secondaryEntity.en}" with full MU semantic anchors (SCR / EL / data-binding / UIE) and zero blocking browser dialogs.`,
    });

    return items;
  }

  const items: DesignBriefItem[] = [
    {
      id: 'brief-tone',
      category: 'tone_palette',
      statement: `整体色调与参考基调：以「${referenceSelection.primary.title}」为主参考（${tokens.mode === 'dark' ? '深色模式' : '浅色模式'}，画布底色 ${tokens.surfaceHex}，卡片底色 ${tokens.cardHex}，主强调色 ${tokens.accentHex}）${borrowedParts.length > 0 ? `；局部融合 ${borrowedParts.join('、')}` : ''}${referenceSelection.primaryNote?.trim() ? `。主参考备注：「${referenceSelection.primaryNote.trim()}」` : ''}。`,
    },
    {
      id: 'brief-typography',
      category: 'typography',
      statement: `字体层级与数字排版：采用 ${tokens.fontDisplayLabel} 字体体系，圆角 ${tokens.radiusPx}px，所有金额、数量与比率指标启用等宽数字（tabular-nums）对齐，层级干净利落。`,
    },
    {
      id: 'brief-density',
      category: 'density_layout',
      statement: `信息密度与多端适配：采用${tokens.isCompact ? '紧凑台账高密度排布，一屏高效浏览更多业务行与状态' : '舒展模块化卡片排布，兼顾阅读呼吸感与重点聚焦'}；原生适配桌面端 (1440px)、平板端 (768px) 与手机端 (390px)。`,
    },
    {
      id: 'brief-motion',
      category: 'motion_interaction',
      statement: `核心交互与动效体验（7 组选定方案）：${motionSummaries.join(' · ')}。${customNoteSuffix}`,
    },
  ];

  if (trimmedFeel || localAttachmentCount > 0) {
    items.push({
      id: 'brief-user-feel',
      category: 'user_feel',
      statement: `用户直白感受与参考图说明：${trimmedFeel ? `「${trimmedFeel}」` : '请结合本机上传的参考截图把握界面气质'}${localAttachmentCount > 0 ? `（已附带 ${localAttachmentCount} 张本机参考图）` : ''}。`,
    });
  }

  items.push({
    id: 'brief-scope',
    category: 'screen_scope',
    statement: `业务画面覆盖范围（${doc ? `《${doc.title}》` : project.name}）：围绕「${nouns.primaryEntity.zh}」与「${nouns.secondaryEntity.zh}」构建可交互列表、录入/详情与审批流转画面，内置完整 MU 语义锚点且零阻塞弹窗。`,
  });

  return items;
}

export function buildDesignBriefFromState(
  params: SynthesizeDesignBriefParams & {
    existingItems?: DesignBriefItem[];
    userImageRefs?: AgentImageAttachmentRef[];
    approved?: boolean;
  },
): DesignBrief {
  const now = new Date().toISOString();
  const items = params.existingItems ?? synthesizeDesignBriefItems(params);
  const borrowedReferences: DesignBriefBorrowedReference[] =
    params.referenceSelection.borrowed.map((b) => ({
      referenceId: b.item.slug,
      aspect: b.aspect,
      title: b.item.title,
      sourceUrl: b.item.sourceUrl,
    }));

  return {
    items,
    ...(params.userFeelNote?.trim() ? { userFeelNote: params.userFeelNote.trim() } : {}),
    primaryReferenceId: params.referenceSelection.primary.slug,
    primaryReferenceTitle: params.referenceSelection.primary.title,
    primaryReferenceSourceUrl: params.referenceSelection.primary.sourceUrl,
    ...(borrowedReferences.length > 0 ? { borrowedReferences } : {}),
    ...(params.userImageRefs && params.userImageRefs.length > 0
      ? { userImageRefs: params.userImageRefs.map((r) => ({ ...r })) }
      : {}),
    motionSchematicIds: collectSelectedMotionSchematicIds(params.alignment),
    ...(params.approved ? { approvedAt: now } : {}),
    updatedAt: now,
  };
}

export function updateDesignBriefItem(
  brief: DesignBrief,
  itemId: string,
  nextStatement: string,
): DesignBrief {
  const trimmed = nextStatement.trim();
  if (!trimmed) return brief;
  return {
    ...brief,
    items: brief.items.map((item) =>
      item.id === itemId ? { ...item, statement: trimmed } : item,
    ),
    updatedAt: new Date().toISOString(),
  };
}

export function addDesignBriefItem(
  brief: DesignBrief,
  statement: string,
  category = 'custom',
): DesignBrief {
  const trimmed = statement.trim();
  if (!trimmed) return brief;
  const newItem: DesignBriefItem = {
    id: `brief-custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    category,
    statement: trimmed,
  };
  return {
    ...brief,
    items: [...brief.items, newItem],
    updatedAt: new Date().toISOString(),
  };
}

export function removeDesignBriefItem(brief: DesignBrief, itemId: string): DesignBrief {
  return {
    ...brief,
    items: brief.items.filter((item) => item.id !== itemId),
    updatedAt: new Date().toISOString(),
  };
}

export function rewriteDesignBriefWithInstruction(params: {
  brief: DesignBrief;
  instruction: string;
  referenceSelection: VisualReferenceSelection;
  alignment: RequirementAlignmentState;
  project?: ProjectDetail;
  doc?: RequirementDoc;
  catalog?: VisualReferenceItem[];
  locale?: 'zh-CN' | 'en-US';
}): {
  brief: DesignBrief;
  nextReferenceSelection: VisualReferenceSelection;
  nextAlignment: RequirementAlignmentState;
  nextUserFeelNote: string;
} {
  const cleanInst = params.instruction.trim();
  if (!cleanInst) {
    return {
      brief: params.brief,
      nextReferenceSelection: params.referenceSelection,
      nextAlignment: params.alignment,
      nextUserFeelNote: params.brief.userFeelNote ?? '',
    };
  }

  const locale = params.locale ?? 'zh-CN';
  const catalog = params.catalog && params.catalog.length > 0 ? params.catalog : CURATED_INSPO_CATALOG;
  const lower = cleanInst.toLowerCase();

  let nextPrimary = params.referenceSelection.primary;
  const wantsDark =
    /深色|暗色|暗黑|夜间|驾驶舱|交易风|dark|cockpit|trading/.test(lower) &&
    !/浅色|白底|纸感|light/.test(lower);
  const wantsWarmPaper = /纸感|暖白|文档风|温润|warm|paper|serif/.test(lower);
  const wantsLight =
    !wantsDark && (wantsWarmPaper || /浅色|清爽|白底|极简|light|clean/.test(lower));

  if (wantsDark && nextPrimary.mode !== 'dark') {
    nextPrimary =
      catalog.find((c) => c.mode === 'dark' && c.vibeGroup === 'fintech') ??
      catalog.find((c) => c.mode === 'dark') ??
      nextPrimary;
  } else if (wantsWarmPaper && nextPrimary.vibeGroup !== 'warm-paper') {
    nextPrimary = catalog.find((c) => c.vibeGroup === 'warm-paper') ?? nextPrimary;
  } else if (wantsLight && nextPrimary.mode !== 'light') {
    nextPrimary = catalog.find((c) => c.mode === 'light') ?? nextPrimary;
  }

  const nextReferenceSelection: VisualReferenceSelection = {
    ...params.referenceSelection,
    primary: nextPrimary,
    borrowed: params.referenceSelection.borrowed.filter(
      (b) => b.item.slug !== nextPrimary.slug,
    ),
  };

  const currentMotion = resolveMotionSelection(params.alignment);
  const nextMotion: MotionSchematicSelection = {
    ...currentMotion,
    ...(/高密度|紧凑|台账|交易|compact|dense|ledger|trading/.test(lower)
      ? { informationDensity: 'COMPACT_LEDGER' as const }
      : /宽松|卡片|留白|呼吸|airy|card|bento/.test(lower)
        ? { informationDensity: 'MODULAR_CARDS' as const }
        : {}),
    ...(/分栏|同屏|split/.test(lower)
      ? { detailOpen: 'INLINE_SPLIT' as const }
      : /弹窗|模态|modal/.test(lower)
        ? { detailOpen: 'MODAL' as const }
        : /抽屉|滑出|drawer/.test(lower)
          ? { detailOpen: 'DRAWER' as const }
          : {}),
  };
  const nextAlignment = syncAlignmentWithSelection(params.alignment, nextMotion);

  const nextUserFeelNote = params.brief.userFeelNote
    ? `${params.brief.userFeelNote}；${cleanInst}`
    : cleanInst;

  const fallbackProj: ProjectDetail = params.project ?? {
    id: 'proj-rewrite',
    name: locale === 'en-US' ? 'Business Workbench' : '业务工作台',
    code: 'PROJ',
    center: 'APPLICATION',
    domain: '',
    description: '',
    currentStage: 3,
    createdAt: '',
    updatedAt: '',
    suite: {},
    validation: {
      valid: true,
      errorCount: 0,
      warningCount: 0,
      diagnostics: [],
      presentModels: [],
      missingModels: [],
    },
    knowledgeGraph: { nodes: [], edges: [] },
    changelog: '',
  };

  const baseItems = synthesizeDesignBriefItems({
    project: fallbackProj,
    ...(params.doc ? { doc: params.doc } : {}),
    referenceSelection: nextReferenceSelection,
    alignment: nextAlignment,
    userFeelNote: nextUserFeelNote,
    locale,
  });

  const directiveItem: DesignBriefItem = {
    id: 'brief-rewrite-directive',
    category: 'agent_rewrite',
    statement:
      locale === 'en-US'
        ? `One-Sentence Style Override: ${cleanInst} (applied to ${nextPrimary.title}, ${nextMotion.informationDensity}).`
        : `一句话风格重塑要求：「${cleanInst}」（已联动切换至 ${nextPrimary.title} · ${nextMotion.informationDensity === 'COMPACT_LEDGER' ? '高密度紧凑台账' : '模块化卡片排布'}）。`,
  };

  const preservedCustom = params.brief.items.filter((i) => i.category === 'custom');
  const nextBrief = buildDesignBriefFromState({
    project: fallbackProj,
    ...(params.doc ? { doc: params.doc } : {}),
    referenceSelection: nextReferenceSelection,
    alignment: nextAlignment,
    userFeelNote: nextUserFeelNote,
    ...(params.brief.userImageRefs ? { userImageRefs: params.brief.userImageRefs } : {}),
    existingItems: [directiveItem, ...baseItems, ...preservedCustom],
    locale,
  });

  return {
    brief: nextBrief,
    nextReferenceSelection,
    nextAlignment,
    nextUserFeelNote,
  };
}

function pickLocalDomainReference(
  project: ProjectDetail,
  doc: RequirementDoc | undefined,
  catalog: VisualReferenceItem[],
): VisualReferenceItem {
  const signalText = `${project.name} ${project.domain} ${doc?.title ?? ''} ${doc?.content ?? ''}`.toLowerCase();
  if (/监控|运维|告警|大盘|驾驶舱|实时流|telemetry|cockpit|ops|monitor/.test(signalText)) {
    return (
      catalog.find((c) => c.vibeGroup === 'dark-tech') ??
      catalog.find((c) => c.mode === 'dark') ??
      catalog[0]!
    );
  }
  if (/合同|财务|资金|结算|银行|审计|台账|税|发票|contract|billing|ledger|fintech|audit/.test(signalText)) {
    return (
      catalog.find((c) => c.vibeGroup === 'fintech') ??
      catalog.find((c) => c.vibeGroup === 'clean-saas') ??
      catalog[0]!
    );
  }
  if (/知识|文档|法规|研究|教务|wiki|doc|editorial/.test(signalText)) {
    return catalog.find((c) => c.vibeGroup === 'warm-paper') ?? catalog[0]!;
  }
  return catalog[0]!;
}

export async function decideDesignBriefForMe(params: {
  project: ProjectDetail;
  doc?: RequirementDoc;
  catalog?: VisualReferenceItem[];
  userFeelNote?: string;
  localAttachmentCount?: number;
  locale?: 'zh-CN' | 'en-US';
  fetchFn?: typeof fetch;
}): Promise<{
  referenceSelection: VisualReferenceSelection;
  alignment: RequirementAlignmentState;
  brief: DesignBrief;
  recommendedCatalog: VisualReferenceItem[];
  source: 'live' | 'cache' | 'curated';
}> {
  const catalog =
    params.catalog && params.catalog.length > 0 ? params.catalog : CURATED_INSPO_CATALOG;
  const rec = await recommendVisualReferences(
    {
      projectId: params.project.id,
      ...(params.doc ? { docId: params.doc.id } : {}),
    },
    params.fetchFn,
  );

  const mergedCatalog = rec.items.length > 0 ? rec.items : catalog;
  const chosenPrimary =
    rec.pick ??
    (rec.fallback
      ? pickLocalDomainReference(params.project, params.doc, mergedCatalog)
      : mergedCatalog[0]!) ??
    CURATED_INSPO_CATALOG[0]!;

  const referenceSelection = createInitialVisualReferenceSelection(chosenPrimary);
  const alignment = inferDefaultAlignmentFromSrs(params.doc?.content, params.project);
  const brief = buildDesignBriefFromState({
    project: params.project,
    ...(params.doc ? { doc: params.doc } : {}),
    referenceSelection,
    alignment,
    ...(params.userFeelNote ? { userFeelNote: params.userFeelNote } : {}),
    ...(params.localAttachmentCount !== undefined
      ? { localAttachmentCount: params.localAttachmentCount }
      : {}),
    locale: params.locale ?? 'zh-CN',
  });

  return {
    referenceSelection,
    alignment,
    brief,
    recommendedCatalog: mergedCatalog,
    source: rec.source,
  };
}

export interface DesignBriefAssistFields {
  positioning: string;
  colorMood: string;
  typography: string;
  layoutDensity: string;
  keyScreenStructure: string;
  componentTone: string;
  constraints: string;
  openNotes?: string;
}

export function mapAssistBriefFieldsToItems(
  fields: DesignBriefAssistFields,
  preservedCustom: DesignBriefItem[] = [],
): DesignBriefItem[] {
  const items: DesignBriefItem[] = [];
  const pushIfPresent = (id: string, category: string, val: string | undefined) => {
    const clean = val?.trim();
    if (clean) items.push({ id, category, statement: clean });
  };
  pushIfPresent('brief-positioning', 'positioning', fields.positioning);
  pushIfPresent('brief-tone', 'tone_palette', fields.colorMood);
  pushIfPresent('brief-typography', 'typography', fields.typography);
  pushIfPresent('brief-density', 'density_layout', fields.layoutDensity);
  pushIfPresent('brief-scope', 'screen_scope', fields.keyScreenStructure);
  pushIfPresent('brief-motion', 'motion_interaction', fields.componentTone);
  pushIfPresent('brief-constraints', 'constraints', fields.constraints);
  pushIfPresent('brief-user-feel', 'user_feel', fields.openNotes);
  return [...items, ...preservedCustom];
}

export interface RequestDesignBriefAssistParams {
  projectId?: string;
  mode: 'synthesize' | 'rewrite' | 'decide';
  project?: ProjectDetail;
  doc?: RequirementDoc;
  currentBrief?: Partial<DesignBrief>;
  instruction?: string;
  referenceSelection?: VisualReferenceSelection;
  visionImages?: readonly AgentImageAttachmentRef[];
  fetchFn?: typeof fetch;
}

export async function requestDesignBriefAssist(
  params: RequestDesignBriefAssistParams,
): Promise<{
  items: DesignBriefItem[];
  brief: DesignBriefAssistFields;
  source: 'agent' | 'mock';
} | null> {
  const projectId = params.projectId?.trim();
  if (!projectId) return null;
  const fetchFn = params.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') return null;

  const images: Array<{
    imageId: string;
    role: AgentImageAttachmentRole;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    dataBase64: string;
    label?: string;
  }> = [];

  for (const att of params.visionImages ?? []) {
    if (att.source !== 'local') continue;
    const rec = await loadLocalImage(att.id);
    if (!rec || !rec.dataBase64) continue;
    const normalizedMime: 'image/png' | 'image/jpeg' | 'image/webp' =
      rec.mimeType === 'image/png' || rec.mimeType === 'image/jpeg' || rec.mimeType === 'image/webp'
        ? rec.mimeType
        : 'image/webp';
    images.push({
      imageId: att.id,
      role: att.role ?? 'user_upload',
      mimeType: normalizedMime,
      dataBase64: rec.dataBase64,
      ...(att.name ? { label: att.name } : {}),
    });
  }

  const primary = params.referenceSelection?.primary;
  const borrowedReferences: DesignBriefBorrowedReference[] | undefined =
    params.referenceSelection && params.referenceSelection.borrowed.length > 0
      ? params.referenceSelection.borrowed.map((b) => ({
          referenceId: b.item.slug,
          aspect: b.aspect,
          title: b.item.title,
          sourceUrl: b.item.sourceUrl,
        }))
      : params.currentBrief?.borrowedReferences;

  const payload = {
    mode: params.mode,
    ...(params.doc?.content?.trim()
      ? { srsSummary: params.doc.content.trim().slice(0, 3200) }
      : {}),
    ...(params.project?.name ? { projectName: params.project.name } : {}),
    ...(params.currentBrief ? { currentBrief: params.currentBrief } : {}),
    ...(params.instruction?.trim() ? { instruction: params.instruction.trim() } : {}),
    ...(primary
      ? {
          primaryReference: {
            slug: primary.slug,
            title: primary.title,
            colors: [primary.surfaceHex, ...primary.palette],
            fonts: primary.fonts,
            styleTags: [
              primary.vibeGroup,
              primary.mode,
              ...(primary.tags ? [primary.tags] : []),
            ],
            industry: primary.vibeGroup,
          },
        }
      : {}),
    ...(borrowedReferences && borrowedReferences.length > 0 ? { borrowedReferences } : {}),
    ...(images.length > 0 ? { images } : {}),
  };

  try {
    const res = await fetchFn(
      `/api/projects/${encodeURIComponent(projectId)}/design-brief-assist`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      ok?: boolean;
      brief?: Partial<DesignBriefAssistFields>;
      source?: 'agent' | 'mock';
    };
    if (!json?.ok || !json.brief || typeof json.brief.positioning !== 'string') {
      return null;
    }
    const briefFields: DesignBriefAssistFields = {
      positioning: json.brief.positioning,
      colorMood: json.brief.colorMood ?? '',
      typography: json.brief.typography ?? '',
      layoutDensity: json.brief.layoutDensity ?? '',
      keyScreenStructure: json.brief.keyScreenStructure ?? '',
      componentTone: json.brief.componentTone ?? '',
      constraints: json.brief.constraints ?? '',
      ...(json.brief.openNotes ? { openNotes: json.brief.openNotes } : {}),
    };
    const preservedCustom = (params.currentBrief?.items ?? []).filter(
      (i) => i.category === 'custom',
    );
    const items = mapAssistBriefFieldsToItems(briefFields, preservedCustom);
    if (items.length === 0) return null;
    return {
      items,
      brief: briefFields,
      source: json.source ?? 'mock',
    };
  } catch {
    return null;
  }
}

export function hydrateBriefingStateFromDesignBrief(
  designBrief: DesignBrief,
  catalog: VisualReferenceItem[] = CURATED_INSPO_CATALOG,
  baseAlignment: RequirementAlignmentState = DEFAULT_ALIGNMENT_STATE,
): {
  referenceSelection: VisualReferenceSelection;
  alignment: RequirementAlignmentState;
  userFeelNote: string;
  userImageRefs: AgentImageAttachmentRef[];
  items: DesignBriefItem[];
} {
  const primary =
    (designBrief.primaryReferenceId
      ? catalog.find((c) => c.slug === designBrief.primaryReferenceId)
      : undefined) ?? catalog[0]!;

  let referenceSelection = createInitialVisualReferenceSelection(primary);
  for (const b of designBrief.borrowedReferences ?? []) {
    const item = catalog.find((c) => c.slug === b.referenceId);
    const validAspect = LIKED_ASPECT_OPTIONS.some((o) => o.key === b.aspect)
      ? (b.aspect as LikedAspectKey)
      : 'accentColor';
    if (item) {
      referenceSelection = upsertBorrowedReference(referenceSelection, item, validAspect);
    }
  }

  const currentMotion = resolveMotionSelection(baseAlignment);
  const patchedMotion: MotionSchematicSelection = { ...currentMotion };
  for (const rawId of designBrief.motionSchematicIds ?? []) {
    const def = (MOTION_SCHEMATICS_BY_ID as Record<string, (typeof MOTION_SCHEMATICS_BY_ID)[MotionSchematicId] | undefined>)[rawId];
    if (def) {
      (patchedMotion as unknown as Record<string, string>)[def.groupKey] = def.id;
    }
  }
  const alignment = syncAlignmentWithSelection(baseAlignment, patchedMotion);

  return {
    referenceSelection,
    alignment,
    userFeelNote: designBrief.userFeelNote ?? '',
    userImageRefs: designBrief.userImageRefs
      ? designBrief.userImageRefs.map((r) => ({ ...r }))
      : [],
    items: designBrief.items.map((item) => ({ ...item })),
  };
}

export async function gatherBriefingTurnImages(params: {
  referenceSelection: VisualReferenceSelection;
  localAttachments: readonly AgentImageAttachmentRef[];
  locale?: 'zh-CN' | 'en-US';
}): Promise<TransientTurnImageInput[]> {
  const locale = params.locale ?? 'zh-CN';
  const primary = params.referenceSelection.primary;
  const url =
    primary.fullPageUrl ||
    inspoFullUrl(primary.slug) ||
    primary.heroUrl ||
    inspoHeroUrl(primary.slug);
  const refs: AgentImageAttachmentRef[] = [
    {
      id: `inspo-primary-${primary.slug}`,
      name: `${primary.title} (${primary.sourceDomain})`,
      mimeType: 'image/webp',
      source: 'remote',
      remoteUrl: url,
      role: 'primary_ref',
    },
  ];
  const fallbackNotesById: Record<string, string | undefined> = {
    [`inspo-primary-${primary.slug}`]:
      locale === 'en-US'
        ? `Primary Reference "${primary.title}" (${primary.mode} mode, surface ${primary.surfaceHex}, palette ${primary.palette.join(', ')}, font ${primary.fonts[0] || 'Inter'}, radius ${primary.radiusPx}px)`
        : `主参考「${primary.title}」（${primary.mode === 'dark' ? '深色模式' : '浅色模式'}，画布底色 ${primary.surfaceHex}，调色盘 ${primary.palette.join(', ')}，字体 ${primary.fonts[0] || 'Inter'}，圆角 ${primary.radiusPx}px）`,
  };

  for (const borrowed of params.referenceSelection.borrowed) {
    const id = `inspo-borrowed-${borrowed.item.slug}`;
    const aspectMeta = LIKED_ASPECT_OPTIONS.find((o) => o.key === borrowed.aspect);
    const aspectLabel =
      locale === 'en-US'
        ? (aspectMeta?.labelEn ?? borrowed.aspect)
        : (aspectMeta?.labelZh ?? borrowed.aspect);
    refs.push({
      id,
      name: `${borrowed.item.title} [${aspectLabel}]`,
      mimeType: 'image/webp',
      source: 'remote',
      remoteUrl: borrowed.item.heroUrl || inspoHeroUrl(borrowed.item.slug),
      role: 'borrowed_ref',
    });
    fallbackNotesById[id] =
      locale === 'en-US'
        ? `Borrowed Reference "${borrowed.item.title}" — borrow ONLY ${aspectLabel} (surface ${borrowed.item.surfaceHex}, palette ${borrowed.item.palette.join(', ')})`
        : `借鉴参考「${borrowed.item.title}」——仅借鉴其【${aspectLabel}】（底色 ${borrowed.item.surfaceHex}，调色盘 ${borrowed.item.palette.join(', ')}）`;
  }

  for (const att of params.localAttachments) {
    refs.push(att);
    fallbackNotesById[att.id] =
      locale === 'en-US'
        ? `User-uploaded local reference screenshot "${att.name}"`
        : `用户本机上传的参考截图「${att.name}」`;
  }

  return resolveTurnImagesForRequest(refs, fallbackNotesById);
}

export interface CompileDesignBriefPromptParams {
  project: ProjectDetail;
  doc?: RequirementDoc;
  brief: DesignBrief;
  referenceSelection: VisualReferenceSelection;
  alignment: RequirementAlignmentState;
  designSystemMarkdown?: string;
  locale?: 'zh-CN' | 'en-US';
}

export function compileDesignBriefGenerationPrompt({
  project,
  doc,
  brief,
  referenceSelection,
  alignment,
  designSystemMarkdown,
  locale = 'zh-CN',
}: CompileDesignBriefPromptParams): string {
  const tokens = deriveStyleTileTokens(
    referenceSelection,
    alignment,
    brief.userFeelNote ?? '',
  );
  const motionBlock = formatMotionSpecsForAgentPrompt(alignment, locale);
  const briefLines = brief.items.map((item, idx) => `${idx + 1}. ${item.statement}`);
  const srsSnippet = doc?.content?.trim() ? doc.content.trim().slice(0, 4800) : '';

  if (locale === 'en-US') {
    return [
      `=== CONFIRMED DESIGN BRIEF (Revision #1 Initial Prototype Generation) ===`,
      `Project: ${project.name} (${project.domain || project.code})`,
      doc ? `Linked SRS Document: ${doc.title} (${doc.version})` : '',
      `Style Tile Tokens: mode=${tokens.mode}, surface=${tokens.surfaceHex}, card=${tokens.cardHex}, accent=${tokens.accentHex}, border=${tokens.borderHex}, ink=${tokens.inkHex}, font=${tokens.fontFamily}, radius=${tokens.radiusPx}px`,
      '',
      `[Confirmed Design Brief Items]`,
      ...briefLines,
      ...(brief.userFeelNote?.trim()
        ? ['', `[User Plain-Language Feel Description]`, brief.userFeelNote.trim()]
        : []),
      ...(designSystemMarkdown?.trim()
        ? ['', `=== INSPO EXTRACTED DESIGN.md TOKENS ===`, designSystemMarkdown.trim().slice(0, 2400)]
        : []),
      '',
      motionBlock,
      ...(srsSnippet ? ['', `=== LINKED SRS SPECIFICATION ===`, srsSnippet] : []),
      '',
      `=== SEMANTIC ANCHOR & RESPONSIVE LAYOUT CONTRACT (MANDATORY) ===`,
      `1. Call \`rewrite_prototype_page\` with \`allowAnchorReset: true\` to deliver a single-file runnable HTML5 prototype.`,
      `2. Every business screen MUST declare \`data-screen-id\`, \`data-screen-name\`, and \`data-screen-type\`; every interactive <button>/<input>/<select>/<textarea> MUST declare unique \`data-element-id\` and \`data-element-type\`, plus domain \`data-binding\` and \`data-event-id\` anchors.`,
      `3. Responsive Viewport Requirement: MUST render cleanly without horizontal overflow across Desktop (1440px), Tablet (768px), and Mobile (390px) viewports.`,
      `4. Zero blocking browser dialogs: NEVER use window.alert, window.confirm, or window.prompt.`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    `【已确认设计简报 · 生成首版可交互原型 Revision #1】`,
    `工程名称：${project.name}（领域：${project.domain || project.code}）`,
    doc ? `关联需求规格说明书 (SRS)：《${doc.title}》(${doc.version})` : '',
    `风格样张核心令牌：mode=${tokens.mode}，画布底色 ${tokens.surfaceHex}，卡片底色 ${tokens.cardHex}，主强调色 ${tokens.accentHex}，边框色 ${tokens.borderHex}，正文色 ${tokens.inkHex}，字体 ${tokens.fontFamily}，圆角 ${tokens.radiusPx}px`,
    '',
    `【一、已确认的设计简报条目（Design Brief）】`,
    ...briefLines,
    ...(brief.userFeelNote?.trim()
      ? ['', `【用户直白感受说明】`, brief.userFeelNote.trim()]
      : []),
    ...(designSystemMarkdown?.trim()
      ? ['', `【二、Inspo 主参考站点设计令牌 (DESIGN.md)】`, designSystemMarkdown.trim().slice(0, 2400)]
      : []),
    '',
    motionBlock,
    ...(srsSnippet ? ['', `【四、关联需求规格说明书 (SRS) 核心内容】`, srsSnippet] : []),
    '',
    `【五、MU 语义锚点与三端响应式硬性契约】`,
    `1. 请调用 \`rewrite_prototype_page\`（传 \`allowAnchorReset: true\`）输出完整单文件可运行 HTML5 交互原型。`,
    `2. 必须严格挂载语义锚点：所有屏幕节点声明 \`data-screen-id\`、\`data-screen-name\`、\`data-screen-type\`；所有交互控件声明唯一 \`data-element-id\`、\`data-element-type\`，并合理绑定 \`data-binding\` 与 \`data-event-id\`。`,
    `3. 三端响应式硬性要求：页面布局必须在桌面端 (1440px)、平板端 (768px) 与手机端 (390px) 三种视口宽度下自适应排布整洁、零横向裁切溢出。`,
    `4. 严禁任何阻塞式浏览器原生弹窗（禁止 window.alert / window.confirm / window.prompt）。`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function compileDesignBriefRestylePrompt(
  params: CompileDesignBriefPromptParams,
): string {
  const base = compileDesignBriefGenerationPrompt(params);
  const tokens = deriveStyleTileTokens(
    params.referenceSelection,
    params.alignment,
    params.brief.userFeelNote ?? '',
  );
  if (params.locale === 'en-US') {
    return [
      `[PROTOTYPE_BRIEF_RESTYLE] Restyle from updated brief (canvas ${tokens.surfaceHex}, accent ${tokens.accentHex}, mode ${tokens.mode})`,
      `IMPORTANT: Inspect existing prototype anchors first and call \`rewrite_prototype_page\` (\`allowAnchorReset: false\`) to restyle the entire prototype according to the updated Design Brief while preserving 100% of existing \`data-screen-id\`, \`data-element-id\`, \`data-binding\`, and \`data-event-id\` anchors!`,
      '',
      base,
    ].join('\n');
  }
  return [
    `[PROTOTYPE_BRIEF_RESTYLE] 按新简报重做风格（画布 ${tokens.surfaceHex}，强调色 ${tokens.accentHex}，模式 ${tokens.mode}）`,
    `重要约束：请先盘点当前原型的既有锚点，再调用 \`rewrite_prototype_page\`（\`allowAnchorReset: false\`）按更新后的设计简报整页重做视觉风格与动效细节，同时 100% 保留现有的 \`data-screen-id\`、\`data-element-id\`、\`data-binding\` 与 \`data-event-id\` 语义锚点！`,
    '',
    base,
  ].join('\n');
}

// ─── Design Brief Card (Right Column #1) ─────────────────────────────────────

export interface DesignBriefCardProps {
  brief: DesignBrief;
  activePrototype?: InteractivePrototype;
  docs?: RequirementDoc[];
  selectedDocId?: string;
  onSelectDocId?: (docId: string) => void;
  onUpdateItem: (itemId: string, statement: string) => void;
  onAddItem: (statement: string) => void;
  onRemoveItem: (itemId: string) => void;
  onRemoveImageRef?: (imageId: string) => void;
  onResetAutoBrief?: () => Promise<void> | void;
  onOneSentenceRewrite: (instruction: string) => Promise<void> | void;
  onDecideForMe: () => Promise<void> | void;
  onConfirmGenerate: () => Promise<void> | void;
  onConfirmRestyle?: () => Promise<void> | void;
  decidingForMe?: boolean;
  assistingBrief?: boolean;
  isBusy: boolean;
  visionSupported?: boolean;
  visionProviderLabel?: string;
  onOpenLlmCenter?: () => void;
}

export function DesignBriefCard({
  brief,
  activePrototype,
  docs = [],
  selectedDocId = '',
  onSelectDocId,
  onUpdateItem,
  onAddItem,
  onRemoveItem,
  onRemoveImageRef,
  onResetAutoBrief,
  onOneSentenceRewrite,
  onDecideForMe,
  onConfirmGenerate,
  onConfirmRestyle,
  decidingForMe = false,
  assistingBrief = false,
  isBusy,
  visionSupported = true,
  visionProviderLabel,
  onOpenLlmCenter,
}: DesignBriefCardProps) {
  const { t } = usePreferences();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [newItemDraft, setNewItemDraft] = useState('');
  const [rewriteDraft, setRewriteDraft] = useState('');

  const isRestyleMode = Boolean(activePrototype);

  const categoryBadgeLabel = (category: string): string => {
    switch (category) {
      case 'positioning':
        return t('整体定位', 'Positioning');
      case 'tone_palette':
        return t('色调与参考', 'Tone & Palette');
      case 'typography':
        return t('字体与层级', 'Typography');
      case 'density_layout':
        return t('密度与响应式', 'Density & Layout');
      case 'motion_interaction':
        return t('交互与动效', 'Motion');
      case 'constraints':
        return t('体验约束', 'Constraints');
      case 'user_feel':
        return t('直白感受', 'User Feel');
      case 'screen_scope':
        return t('画面范围', 'Screen Scope');
      case 'agent_rewrite':
        return t('一句话重塑', 'Agent Rewrite');
      default:
        return t('补充要求', 'Custom');
    }
  };

  return (
    <section
      data-testid="design-brief-card"
      aria-label={t('设计简报', 'Design Brief')}
      className="card flex flex-col gap-3.5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line pb-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="m-0 font-serif text-[16px] font-semibold text-ink">
              {t('设计简报', 'Design Brief')}
            </h3>
            <span className="badge badge-accent font-mono text-[10.5px] tabular-nums">
              {brief.items.length} {t('条共识', 'items')}
            </span>
          </div>
          <p className="m-0 mt-0.5 text-[12px] text-ink-3">
            {isRestyleMode
              ? t(
                  `正在编辑「${activePrototype?.name ?? ''}」的设计简报，确认后将按新简报重做整页风格并生成新修订版本。`,
                  `Editing Design Brief for "${activePrototype?.name ?? ''}"; confirming restyles the prototype as a new revision.`,
                )
              : t(
                  '把参考图、直白感受与动效选择翻译成可读可改的设计共识，确认后交给原型共创智能体生成首版原型。',
                  'Plain-language design contract synthesized from your references, feel notes, and schematics.',
                )}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {onResetAutoBrief && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              data-testid="brief-resync-btn"
              disabled={assistingBrief || isBusy}
              onClick={() => void onResetAutoBrief()}
              title={t('根据左侧最新选择重新汇总简报', 'Re-sync brief from left-hand selections')}
            >
              {assistingBrief ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              {t('同步汇总', 'Re-sync')}
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            size="xs"
            data-testid="decide-for-me-btn"
            disabled={decidingForMe || assistingBrief || isBusy}
            onClick={() => void onDecideForMe()}
          >
            {decidingForMe ? (
              <Loader2 size={12.5} className="animate-spin" />
            ) : (
              <Wand2 size={12.5} className="text-accent" />
            )}
            {t('帮我定', 'Decide for me')}
          </Button>
        </div>
      </div>

      <VisionCapabilityBanner
        visionSupported={visionSupported}
        {...(visionProviderLabel ? { providerLabel: visionProviderLabel } : {})}
        {...(onOpenLlmCenter ? { onOpenLlmCenter } : {})}
      />

      {brief.userImageRefs && brief.userImageRefs.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-control border border-line bg-inset/40 p-2"
          data-testid="design-brief-image-refs"
        >
          {brief.userImageRefs.map((imgRef) => (
            <LocalImageThumbnail
              key={imgRef.id}
              attachment={imgRef}
              compact
              {...(onRemoveImageRef ? { onRemove: onRemoveImageRef } : {})}
            />
          ))}
        </div>
      )}

      {docs.length > 0 && onSelectDocId && (
        <div className="flex flex-col gap-1">
          <label className="text-[11.5px] font-medium text-ink-2">
            {t('关联需求规格说明书：', 'Linked SRS Specification:')}
          </label>
          <select
            className="input text-[12.5px]"
            data-testid="brief-srs-select"
            value={selectedDocId}
            onChange={(e) => onSelectDocId(e.target.value)}
          >
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title} ({d.version})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* One-sentence Agent rewrite input */}
      <form
        className="flex gap-1.5 rounded-control border border-line bg-inset/55 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!rewriteDraft.trim()) return;
          const next = rewriteDraft.trim();
          setRewriteDraft('');
          void onOneSentenceRewrite(next);
        }}
      >
        <input
          type="text"
          data-testid="brief-one-sentence-input"
          className="input h-8 flex-1 bg-surface text-[12.5px]"
          placeholder={t(
            '用一句话改写整份简报，如：改成深色高密度交易风…',
            'Rewrite brief in one sentence, e.g., Switch to dark high-density trading style…',
          )}
          value={rewriteDraft}
          onChange={(e) => setRewriteDraft(e.target.value)}
        />
        <Button
          type="submit"
          variant="secondary"
          size="xs"
          data-testid="brief-one-sentence-submit-btn"
          disabled={!rewriteDraft.trim() || assistingBrief || isBusy}
        >
          {assistingBrief ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Sparkles size={12} className="text-accent" />
          )}
          {t('一句话改写', 'Rewrite')}
        </Button>
      </form>

      {/* Editable Plain-Language Brief Items */}
      <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="design-brief-items-list">
        {brief.items.map((item) => {
          const isEditing = editingId === item.id;
          return (
            <li
              key={item.id}
              data-testid={`design-brief-item-${item.id}`}
              className="rounded-control border border-line bg-inset/35 px-3 py-2 text-[12.5px] leading-relaxed text-ink"
            >
              {isEditing ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    rows={2}
                    className="input w-full bg-surface text-[12.5px]"
                    value={editingDraft}
                    onChange={(e) => setEditingDraft(e.target.value)}
                  />
                  <div className="flex justify-end gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        setEditingId(null);
                        setEditingDraft('');
                      }}
                    >
                      <X size={12} />
                      {t('取消', 'Cancel')}
                    </Button>
                    <Button
                      type="button"
                      variant="accent"
                      size="xs"
                      onClick={() => {
                        if (editingDraft.trim()) {
                          onUpdateItem(item.id, editingDraft.trim());
                        }
                        setEditingId(null);
                        setEditingDraft('');
                      }}
                    >
                      <Check size={12} />
                      {t('保存条目', 'Save')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="mr-1.5 inline-block rounded bg-surface px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-ink-2">
                      {categoryBadgeLabel(item.category)}
                    </span>
                    <span>{item.statement}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label={t('编辑简报条目', 'Edit brief item')}
                      onClick={() => {
                        setEditingId(item.id);
                        setEditingDraft(item.statement);
                      }}
                      className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-ink-3 hover:bg-surface hover:text-ink"
                    >
                      <Edit3 size={12} />
                    </button>
                    <button
                      type="button"
                      aria-label={t('删除简报条目', 'Remove brief item')}
                      onClick={() => onRemoveItem(item.id)}
                      className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-ink-3 hover:bg-surface hover:text-red"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Add custom brief item inline */}
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newItemDraft.trim()) return;
          onAddItem(newItemDraft.trim());
          setNewItemDraft('');
        }}
      >
        <input
          type="text"
          data-testid="brief-add-item-input"
          className="input h-8 flex-1 text-[12px]"
          placeholder={t(
            '补充一条简报要求（如：审批金额列固定右对齐并醒目显示）…',
            'Add a brief item (e.g., Keep approval amounts pinned and right-aligned)…',
          )}
          value={newItemDraft}
          onChange={(e) => setNewItemDraft(e.target.value)}
        />
        <Button
          type="submit"
          variant="secondary"
          size="xs"
          data-testid="brief-add-item-btn"
          disabled={!newItemDraft.trim()}
        >
          <Plus size={12} />
          {t('添加条目', 'Add Item')}
        </Button>
      </form>

      {/* Primary Action Footer */}
      <div className="flex flex-col gap-2 border-t border-line pt-3">
        {isRestyleMode && onConfirmRestyle ? (
          <>
            <Button
              type="button"
              variant="accent"
              size="md"
              data-testid="confirm-brief-restyle-btn"
              disabled={isBusy}
              onClick={() => void onConfirmRestyle()}
            >
              {isBusy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
              {t('按新简报重做风格', 'Restyle from updated brief')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="confirm-brief-generate-btn"
              disabled={isBusy}
              onClick={() => void onConfirmGenerate()}
            >
              <Plus size={13} />
              {t('按此简报另建新原型', 'Generate as New Prototype (R1)')}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="accent"
            size="md"
            data-testid="confirm-brief-generate-btn"
            disabled={isBusy}
            onClick={() => void onConfirmGenerate()}
          >
            {isBusy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            {t('确认设计简报并生成原型', 'Confirm Brief & Generate Prototype')}
          </Button>
        )}
      </div>
    </section>
  );
}

// ─── Live Style Tile Card (Right Column #2) ──────────────────────────────────

export interface StyleTileCardProps {
  tokens: StyleTileTokens;
  referenceSelection: VisualReferenceSelection;
  alignment: RequirementAlignmentState;
  project?: ProjectDetail;
  srsMarkdown?: string;
}

export function StyleTileCard({
  tokens,
  referenceSelection,
  alignment,
  project,
  srsMarkdown,
}: StyleTileCardProps) {
  const { t } = usePreferences();
  const nouns = extractDomainNounsFromSrs(srsMarkdown, project);
  const primaryEntityLabel = t(nouns.primaryEntity.zh, nouns.primaryEntity.en);
  const secondaryEntityLabel = t(nouns.secondaryEntity.zh, nouns.secondaryEntity.en);
  const createActionLabel = t(nouns.createAction.zh, nouns.createAction.en);

  const swatches: { key: string; label: string; hex: string }[] = [
    { key: 'surface', label: t('画布底色', 'Canvas'), hex: tokens.surfaceHex },
    { key: 'card', label: t('卡片表面', 'Surface'), hex: tokens.cardHex },
    { key: 'accent', label: t('主强调色', 'Primary'), hex: tokens.accentHex },
    { key: 'ok', label: t('通过态', 'Success'), hex: tokens.semanticOkHex },
    { key: 'warn', label: t('预警态', 'Warning'), hex: tokens.semanticWarnHex },
    { key: 'danger', label: t('拦截态', 'Danger'), hex: tokens.semanticDangerHex },
    { key: 'border', label: t('分割边框', 'Border'), hex: tokens.borderHex },
    { key: 'ink', label: t('主文字', 'Ink'), hex: tokens.inkHex },
  ];

  const rowPad = tokens.isCompact ? '6px 8px' : '10px 10px';
  const radiusCss = `${tokens.radiusPx}px`;
  const btnRadiusCss = `${Math.max(4, Math.round(tokens.radiusPx * 0.75))}px`;

  return (
    <section
      data-testid="style-tile-card"
      aria-label={t('实时风格样张', 'Live Style Tile')}
      className="card flex flex-col gap-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
        <div className="flex items-center gap-2">
          <Palette size={15} className="text-accent" />
          <h3 className="m-0 font-serif text-[15.5px] font-semibold text-ink">
            {t('实时风格样张', 'Live Style Tile')}
          </h3>
        </div>
        <span className="badge font-mono text-[10.5px]">
          {tokens.mode === 'dark' ? t('深色样张', 'Dark Mode') : t('浅色样张', 'Light Mode')} ·{' '}
          {tokens.fontDisplayLabel} · {tokens.radiusPx}px
        </span>
      </div>

      {/* 1. Color Swatches */}
      <div data-testid="style-tile-swatches" className="grid grid-cols-4 gap-2">
        {swatches.map((sw) => (
          <div
            key={sw.key}
            className="flex items-center gap-2 rounded-control border border-line bg-inset/40 px-2 py-1.5"
          >
            <span
              className="h-5 w-5 shrink-0 rounded border border-black/15"
              style={{ background: sw.hex }}
            />
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[10.5px] font-medium text-ink-2">{sw.label}</div>
              <div className="truncate font-mono text-[10px] text-ink-3 uppercase">{sw.hex}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 2. Live Preview Surface: Typography + Buttons + Card + Table + Status Badges */}
      <div
        className="flex flex-col gap-3 border p-3.5 transition-colors"
        style={{
          background: tokens.surfaceHex,
          color: tokens.inkHex,
          borderColor: tokens.borderHex,
          borderRadius: radiusCss,
          fontFamily: tokens.fontFamily,
        }}
      >
        {/* Typography Specimen */}
        <div
          data-testid="style-tile-typography"
          className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2.5"
          style={{ borderColor: tokens.borderHex }}
        >
          <div>
            <div className="text-[15px] font-semibold tracking-tight">
              {primaryEntityLabel} · {referenceSelection.primary.title}
            </div>
            <div className="text-[11.5px]" style={{ color: tokens.mutedInkHex }}>
              {t(
                '正文层级与高对比辅助说明示例，兼顾长时间审阅舒适度',
                'Body copy & secondary caption hierarchy for sustained operational clarity',
              )}
            </div>
          </div>
          <div
            className="font-mono text-[17px] font-bold tabular-nums"
            style={{ fontVariantNumeric: 'tabular-nums', color: tokens.accentHex }}
          >
            ¥1,284,500.00
          </div>
        </div>

        {/* Representative Buttons + Status Badges */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div data-testid="style-tile-buttons" className="flex flex-wrap items-center gap-1.5">
            <span
              className="inline-flex items-center px-2.5 py-1 text-[11.5px] font-semibold"
              style={{
                background: tokens.accentHex,
                color: tokens.accentInkHex,
                borderRadius: btnRadiusCss,
              }}
            >
              + {createActionLabel}
            </span>
            <span
              className="inline-flex items-center border px-2.5 py-1 text-[11.5px] font-medium"
              style={{
                background: tokens.cardHex,
                color: tokens.inkHex,
                borderColor: tokens.borderHex,
                borderRadius: btnRadiusCss,
              }}
            >
              {t('批量筛选', 'Filter')}
            </span>
            <span
              className="inline-flex items-center px-2 py-1 text-[11.5px]"
              style={{
                color: tokens.mutedInkHex,
                borderRadius: btnRadiusCss,
              }}
            >
              {t('导出台账', 'Export')}
            </span>
          </div>

          <div data-testid="style-tile-badges" className="flex flex-wrap items-center gap-1">
            <span
              className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
              style={{
                background: `${tokens.semanticOkHex}22`,
                color: tokens.semanticOkHex,
              }}
            >
              {t('已生效', 'Approved')}
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
              style={{
                background: `${tokens.semanticWarnHex}22`,
                color: tokens.semanticWarnHex,
              }}
            >
              {t('待复核', 'Pending')}
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
              style={{
                background: `${tokens.semanticDangerHex}22`,
                color: tokens.semanticDangerHex,
              }}
            >
              {t('超阈值', 'Flagged')}
            </span>
          </div>
        </div>

        {/* Card + Business Table Micro-Specimen (2-3 SRS rows) */}
        <div
          data-testid="style-tile-card-specimen"
          className="overflow-hidden border"
          style={{
            background: tokens.cardHex,
            borderColor: tokens.borderHex,
            borderRadius: radiusCss,
          }}
        >
          <table
            data-testid="style-tile-table-specimen"
            className="w-full border-collapse text-[11.5px] tabular-nums"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            <thead>
              <tr
                style={{
                  background: tokens.insetHex,
                  color: tokens.mutedInkHex,
                  borderBottom: `1px solid ${tokens.borderHex}`,
                }}
              >
                <th className="text-left font-semibold" style={{ padding: rowPad }}>
                  {primaryEntityLabel}
                </th>
                <th className="text-left font-semibold" style={{ padding: rowPad }}>
                  {secondaryEntityLabel}
                </th>
                <th className="text-right font-semibold" style={{ padding: rowPad }}>
                  {t('金额', 'Amount')}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: `1px solid ${tokens.borderHex}` }}>
                <td className="font-medium" style={{ padding: rowPad }}>
                  {primaryEntityLabel} #01
                </td>
                <td style={{ padding: rowPad, color: tokens.mutedInkHex }}>
                  {secondaryEntityLabel} · A
                </td>
                <td className="text-right font-mono font-semibold" style={{ padding: rowPad }}>
                  ¥265,000
                </td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${tokens.borderHex}` }}>
                <td className="font-medium" style={{ padding: rowPad }}>
                  {primaryEntityLabel} #02
                </td>
                <td style={{ padding: rowPad, color: tokens.mutedInkHex }}>
                  {secondaryEntityLabel} · B
                </td>
                <td className="text-right font-mono font-semibold" style={{ padding: rowPad }}>
                  ¥98,400
                </td>
              </tr>
              <tr>
                <td className="font-medium" style={{ padding: rowPad }}>
                  {primaryEntityLabel} #03
                </td>
                <td style={{ padding: rowPad, color: tokens.mutedInkHex }}>
                  {secondaryEntityLabel} · C
                </td>
                <td
                  className="text-right font-mono font-semibold"
                  style={{ padding: rowPad, color: tokens.accentHex }}
                >
                  ¥512,000
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Playable Selected Motion Schematics Strip */}
      <StyleTileMotionSampleStrip
        selection={alignment}
        palette={{
          accentColor: tokens.accentHex,
          surfaceColor: tokens.surfaceHex,
          inkColor: tokens.inkHex,
          radiusPx: tokens.radiusPx,
        }}
        {...(srsMarkdown ? { srsMarkdown } : {})}
        {...(project ? { project } : {})}
      />
    </section>
  );
}
