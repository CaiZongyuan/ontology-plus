import React, { useEffect, useMemo, useState } from 'react';
import { Check, Code2, Play, RotateCcw, Sparkles } from 'lucide-react';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import {
  ALL_MOTION_SCHEMATICS,
  APPROVAL_FEEDBACK_OPTIONS,
  DEFAULT_DOMAIN_NOUNS,
  DEFAULT_MOTION_SELECTION,
  DETAIL_OPEN_OPTIONS,
  EMPTY_LOADING_OPTIONS,
  FORM_VALIDATION_SAVE_OPTIONS,
  INFORMATION_DENSITY_OPTIONS,
  MOTION_SCHEMATICS_BY_ID,
  MOTION_SCHEMATIC_GROUPS,
  NAVIGATION_STRUCTURE_OPTIONS,
  TABLE_ROW_ACTION_OPTIONS,
  extractDomainNounsFromSrs,
  formatMotionSpecsForAgentPrompt,
  getMotionSchematicById,
  inferDefaultMotionSelectionFromSrs,
  resolveMotionSelection,
  type ApprovalFeedbackSchematicId,
  type BilingualText,
  type DetailOpenSchematicId,
  type EmptyLoadingSchematicId,
  type FormValidationSaveSchematicId,
  type InformationDensitySchematicId,
  type LegacyAlignmentCompatInput,
  type MotionDomainNouns,
  type MotionSchematicDefinition,
  type MotionSchematicGroup,
  type MotionSchematicGroupKey,
  type MotionSchematicId,
  type MotionSchematicSelection,
  type MotionSpec,
  type MotionSrsProjectContext,
  type NavigationStructureSchematicId,
  type TableRowActionSchematicId,
} from './motionSchematicSpecs.js';

export {
  ALL_MOTION_SCHEMATICS,
  APPROVAL_FEEDBACK_OPTIONS,
  DEFAULT_DOMAIN_NOUNS,
  DEFAULT_MOTION_SELECTION,
  DETAIL_OPEN_OPTIONS,
  EMPTY_LOADING_OPTIONS,
  FORM_VALIDATION_SAVE_OPTIONS,
  INFORMATION_DENSITY_OPTIONS,
  MOTION_SCHEMATICS_BY_ID,
  MOTION_SCHEMATIC_GROUPS,
  NAVIGATION_STRUCTURE_OPTIONS,
  TABLE_ROW_ACTION_OPTIONS,
  extractDomainNounsFromSrs,
  formatMotionSpecsForAgentPrompt,
  getMotionSchematicById,
  inferDefaultMotionSelectionFromSrs,
  resolveMotionSelection,
  type ApprovalFeedbackSchematicId,
  type BilingualText,
  type DetailOpenSchematicId,
  type EmptyLoadingSchematicId,
  type FormValidationSaveSchematicId,
  type InformationDensitySchematicId,
  type LegacyAlignmentCompatInput,
  type MotionDomainNouns,
  type MotionSchematicDefinition,
  type MotionSchematicGroup,
  type MotionSchematicGroupKey,
  type MotionSchematicId,
  type MotionSchematicSelection,
  type MotionSpec,
  type MotionSrsProjectContext,
  type NavigationStructureSchematicId,
  type TableRowActionSchematicId,
};

// ─── Legacy Compatibility Types & Constants ─────────────────────────────────

export type EntrySchematicId = DetailOpenSchematicId;
export type DensitySchematicId = 'COMPACT_LEDGER' | 'MODULAR_CARDS';
export type InteractivePartId =
  | 'KPI_COUNT_UP'
  | 'FILTER_CHIPS'
  | 'ACCORDION'
  | 'STEP_INDICATOR';
export type FeedbackMotionId = 'TOAST' | 'SKELETON' | 'SUBTLE_MOTION';

export type SchematicSceneId =
  | MotionSchematicId
  | InteractivePartId
  | FeedbackMotionId;

export interface RequirementAlignmentState extends Partial<MotionSchematicSelection> {
  entryPattern: EntrySchematicId;
  layoutDensity: DensitySchematicId;
  interactiveParts: InteractivePartId[];
  feedbackMotions: FeedbackMotionId[];
  customNotes: string[];
}

export const DEFAULT_ALIGNMENT_STATE: RequirementAlignmentState = {
  entryPattern: DEFAULT_MOTION_SELECTION.detailOpen,
  layoutDensity: 'COMPACT_LEDGER',
  navigationStructure: DEFAULT_MOTION_SELECTION.navigationStructure,
  tableRowActions: DEFAULT_MOTION_SELECTION.tableRowActions,
  formValidationSave: DEFAULT_MOTION_SELECTION.formValidationSave,
  emptyAndLoading: DEFAULT_MOTION_SELECTION.emptyAndLoading,
  approvalAndFeedback: DEFAULT_MOTION_SELECTION.approvalAndFeedback,
  interactiveParts: ['KPI_COUNT_UP', 'FILTER_CHIPS', 'STEP_INDICATOR'],
  feedbackMotions: ['TOAST', 'SUBTLE_MOTION'],
  customNotes: [],
};

export function inferDefaultAlignmentFromSrs(
  srsMarkdown?: string,
  project?: MotionSrsProjectContext | null,
): RequirementAlignmentState {
  const selection = inferDefaultMotionSelectionFromSrs(srsMarkdown, project);
  return syncAlignmentWithSelection(DEFAULT_ALIGNMENT_STATE, selection);
}

export function syncAlignmentWithSelection(
  prev: RequirementAlignmentState,
  selection: MotionSchematicSelection,
): RequirementAlignmentState {
  const layoutDensity: DensitySchematicId =
    selection.informationDensity === 'MODULAR_CARDS' ? 'MODULAR_CARDS' : 'COMPACT_LEDGER';
  const feedbackSet = new Set<FeedbackMotionId>(prev.feedbackMotions);
  if (selection.emptyAndLoading === 'SKELETON_SHIMMER') {
    feedbackSet.add('SKELETON');
  }
  if (selection.approvalAndFeedback === 'STEPPER_CORNER_TOAST') {
    feedbackSet.add('TOAST');
  }
  return {
    ...prev,
    ...selection,
    entryPattern: selection.detailOpen,
    layoutDensity,
    feedbackMotions: Array.from(feedbackSet),
  };
}

interface LegacySchematicCardMeta<T extends string> {
  id: T;
  refCode: string;
  plainTitleZh: string;
  plainTitleEn: string;
  plainDescZh: string;
  plainDescEn: string;
  agentSpecZh: string;
  agentSpecEn: string;
}

export const ENTRY_SCHEMATICS: LegacySchematicCardMeta<EntrySchematicId>[] =
  DETAIL_OPEN_OPTIONS.map((o) => ({
    id: o.id,
    refCode: o.refCode,
    plainTitleZh: o.plainTitle.zh,
    plainTitleEn: o.plainTitle.en,
    plainDescZh: o.plainDesc.zh,
    plainDescEn: o.plainDesc.en,
    agentSpecZh: o.agentSummary.zh,
    agentSpecEn: o.agentSummary.en,
  }));

export const DENSITY_SCHEMATICS: LegacySchematicCardMeta<DensitySchematicId>[] =
  INFORMATION_DENSITY_OPTIONS.filter(
    (o): o is MotionSchematicDefinition<DensitySchematicId, 'informationDensity'> =>
      o.id === 'COMPACT_LEDGER' || o.id === 'MODULAR_CARDS',
  ).map((o) => ({
    id: o.id,
    refCode: o.refCode,
    plainTitleZh: o.plainTitle.zh,
    plainTitleEn: o.plainTitle.en,
    plainDescZh: o.plainDesc.zh,
    plainDescEn: o.plainDesc.en,
    agentSpecZh: o.agentSummary.zh,
    agentSpecEn: o.agentSummary.en,
  }));

export const INTERACTIVE_PART_SCHEMATICS: LegacySchematicCardMeta<InteractivePartId>[] = [
  {
    id: 'KPI_COUNT_UP',
    refCode: '#007 Count-up',
    plainTitleZh: '顶部放一排关键数字总览卡',
    plainTitleEn: 'Top Metric Summary Strip',
    plainDescZh: '一进页面顶部就看到「今日总量、待处理数、完成率」，数字滚动跳出。',
    plainDescEn: 'Shows key summary numbers at the top that count up into place when opened.',
    agentSpecZh: '页面顶部配置核心经营 KPI 指标卡片条（含数字滚动跳动 Count-up 效果与待办高亮统计）。',
    agentSpecEn: 'Include a top KPI summary card strip with animated count-up metric numbers.',
  },
  {
    id: 'FILTER_CHIPS',
    refCode: '#061 Chips',
    plainTitleZh: '点一下胶囊小标签就能快速筛选',
    plainTitleEn: 'One-Click Filter Pills',
    plainDescZh: '直接点「待审批」「高金额」胶囊按钮就筛出对应记录。',
    plainDescEn: 'Click pill chips directly to filter matching rows with a checkmark toggle.',
    agentSpecZh: '列表工具栏提供可点选胶囊快筛标签（Filter Chips，点选打勾变主题色并实时过滤列表行）。',
    agentSpecEn: 'Provide clickable filter pill chips above the list that highlight with a check and filter rows live.',
  },
  {
    id: 'ACCORDION',
    refCode: '#052 Accordion',
    plainTitleZh: '次要详情先收起，点一下再展开',
    plainTitleEn: 'Expandable Detail Rows',
    plainDescZh: '把长备注、规则明细或操作历史折叠收好，需要看哪条点哪条展开。',
    plainDescEn: 'Keeps secondary details tucked away; clicking a row smoothly expands its hidden breakdown.',
    agentSpecZh: '单据附加明细与规则说明支持手风琴折叠展开（Accordion，点击平滑展开补充字段与审计轨迹）。',
    agentSpecEn: 'Support expandable accordion sections/rows to reveal secondary details and rule audit logs on click.',
  },
  {
    id: 'STEP_INDICATOR',
    refCode: '#068 Stepper',
    plainTitleZh: '清晰的「第1步→第2步→审批」进度条',
    plainTitleEn: 'Step-by-Step Flow & Approval',
    plainDescZh: '把业务进展画成连线圆圈进度条，走到哪一步就打勾推进。',
    plainDescEn: 'Visualizes lifecycle stages as connected step circles that check off as items are approved.',
    agentSpecZh: '内置可视化流程步进条与主管待办审批流转屏幕（Step Indicator + Approval Screen）。',
    agentSpecEn: 'Include a connected step-progress indicator bar and a dedicated approval workflow screen.',
  },
];

export const FEEDBACK_MOTION_SCHEMATICS: LegacySchematicCardMeta<FeedbackMotionId>[] = [
  {
    id: 'TOAST',
    refCode: '#056 Toast',
    plainTitleZh: '角落滑出不挡路的操作提示条',
    plainTitleEn: 'Non-Blocking Corner Notice',
    plainDescZh: '右下角滑出带倒计时进度的小提示，自动收起，绝不弹窗卡人。',
    plainDescEn: 'Slides a sleek notice with a timer bar into the corner on save or validation.',
    agentSpecZh: '操作成功与规则拦截采用角落滑入轻提示（Toast Notification，零阻塞弹窗）。',
    agentSpecEn: 'Show non-blocking slide-in corner toast notifications with an auto-dismiss countdown bar.',
  },
  {
    id: 'SKELETON',
    refCode: '#069 Skeleton',
    plainTitleZh: '刷新数据时显示柔和流光占位条',
    plainTitleEn: 'Shimmer Loading Placeholders',
    plainDescZh: '点查询或刷新列表时，先闪过柔和流光条，再平滑浮现真实数据。',
    plainDescEn: 'Sweeps a gentle light shine across placeholder blocks during refresh before revealing data.',
    agentSpecZh: '点击检索/刷新时提供流光骨架屏过渡（Skeleton Shimmer）。',
    agentSpecEn: 'Display a brief skeleton shimmer placeholder sweep when refreshing or querying records.',
  },
  {
    id: 'SUBTLE_MOTION',
    refCode: '#002 Stagger',
    plainTitleZh: '模块依次轻柔浮现的顺滑感',
    plainTitleEn: 'Gentle Staggered Entrance',
    plainDescZh: '切换页面时卡片依次轻轻浮起，尊重减少动态效果设置。',
    plainDescEn: 'Cards and rows glide upward into place with smooth easing.',
    agentSpecZh: '屏幕切换与卡片入场采用轻柔错峰渐入动效（Staggered Fade-up，尊重 prefers-reduced-motion）。',
    agentSpecEn: 'Apply subtle staggered fade-up transitions on screen switch and cards, honoring prefers-reduced-motion.',
  },
];

export function describeAlignmentForAgent(
  alignment: RequirementAlignmentState,
  locale: 'zh-CN' | 'en-US' = 'zh-CN',
): string[] {
  const resolved = resolveMotionSelection(alignment);
  const lines: string[] = MOTION_SCHEMATIC_GROUPS.map((group) => {
    const item = MOTION_SCHEMATICS_BY_ID[resolved[group.key]];
    const spec = item.motionSpec;
    if (locale === 'en-US') {
      return `[${group.title.en}] ${item.agentSummary.en} | [MUST SATISFY] Trigger: ${spec.trigger.en}; Target: ${spec.target.en}; Duration: ${spec.durationMs}ms; Easing: ${spec.easing}`;
    }
    return `【${group.title.zh}】${item.agentSummary.zh}｜[硬性约束] 触发：${spec.trigger.zh}；对象：${spec.target.zh}；时长：${spec.durationMs}ms；缓动：${spec.easing}`;
  });

  for (const note of alignment.customNotes ?? []) {
    if (note.trim()) {
      lines.push(
        locale === 'en-US'
          ? `Domain & Custom Alignment Note: ${note.trim()}`
          : `用户补充业务与交互要求：${note.trim()}`,
      );
    }
  }
  return lines;
}

// ─── Palette, Reduced Motion & Stage Step State ─────────────────────────────

export interface MotionPaletteTokens {
  accentColor: string;
  surfaceColor: string;
  inkColor: string;
  radiusPx: number;
}

export const DEFAULT_MOTION_PALETTE: MotionPaletteTokens = {
  accentColor: '#2563eb',
  surfaceColor: '#f9f8f5',
  inkColor: '#1e1d1b',
  radiusPx: 8,
};

export function resolveMotionPalette(
  palette?: Partial<MotionPaletteTokens>,
  overrides?: Partial<MotionPaletteTokens>,
): MotionPaletteTokens {
  return {
    accentColor:
      overrides?.accentColor ||
      palette?.accentColor ||
      DEFAULT_MOTION_PALETTE.accentColor,
    surfaceColor:
      overrides?.surfaceColor ||
      palette?.surfaceColor ||
      DEFAULT_MOTION_PALETTE.surfaceColor,
    inkColor:
      overrides?.inkColor || palette?.inkColor || DEFAULT_MOTION_PALETTE.inkColor,
    radiusPx:
      typeof overrides?.radiusPx === 'number'
        ? overrides.radiusPx
        : typeof palette?.radiusPx === 'number'
          ? palette.radiusPx
          : DEFAULT_MOTION_PALETTE.radiusPx,
  };
}

function readableButtonInk(hex: string): string {
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) return '#ffffff';
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 165 ? '#111827' : '#ffffff';
}

export function detectPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return Boolean(window.matchMedia('(prefers-reduced-motion: reduce)')?.matches);
  } catch {
    return false;
  }
}

export function usePrefersReducedMotion(explicitOverride?: boolean): boolean {
  const [systemReduced, setSystemReduced] = useState<boolean>(() =>
    detectPrefersReducedMotion(),
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setSystemReduced(Boolean(mql.matches));
    const listener = (event: MediaQueryListEvent) => {
      setSystemReduced(Boolean(event.matches));
    };
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', listener);
      return () => mql.removeEventListener('change', listener);
    }
    return undefined;
  }, []);

  return explicitOverride ?? systemReduced;
}

export type MotionStageStepMap = Partial<Record<MotionSchematicId, number>>;

export function triggerMotionSchematic(
  current: MotionStageStepMap,
  id: MotionSchematicId,
): MotionStageStepMap {
  const prevStep = current[id] ?? 0;
  const nextStep = prevStep === 0 ? 1 : 0;
  return {
    ...current,
    [id]: nextStep,
  };
}

function coerceToMotionSchematicId(scene: SchematicSceneId): MotionSchematicId {
  if (scene in MOTION_SCHEMATICS_BY_ID) {
    return scene as MotionSchematicId;
  }
  switch (scene) {
    case 'KPI_COUNT_UP':
      return 'BALANCED_WORKSPACE';
    case 'FILTER_CHIPS':
      return 'FILTER_ZERO_RECOVERY';
    case 'ACCORDION':
      return 'INLINE_BANNER_TIMELINE';
    case 'STEP_INDICATOR':
    case 'TOAST':
      return 'STEPPER_CORNER_TOAST';
    case 'SKELETON':
      return 'SKELETON_SHIMMER';
    case 'SUBTLE_MOTION':
      return 'MODULAR_CARDS';
    default:
      return 'DRAWER';
  }
}

// ─── Stateless Playable Mini-Stage (Pure JSX for Direct & Browser Clicks) ───

export interface InteractiveMiniStageProps {
  id: MotionSchematicId;
  step: number;
  onTrigger: () => void;
  palette: MotionPaletteTokens;
  domainNouns: MotionDomainNouns;
  locale: 'zh-CN' | 'en-US';
  reducedMotion: boolean;
  compact?: boolean;
}

function triggerButtonLabel(
  id: MotionSchematicId,
  isActive: boolean,
  nouns: MotionDomainNouns,
  locale: 'zh-CN' | 'en-US',
): string {
  const pick = (zh: string, en: string) => (locale === 'en-US' ? en : zh);
  if (isActive) {
    return pick('重置示意', 'Reset Stage');
  }
  switch (id) {
    case 'DRAWER':
    case 'MODAL':
    case 'DEDICATED_TAB':
      return pick(nouns.createAction.zh, nouns.createAction.en);
    case 'INLINE_SPLIT':
      return pick(`切换${nouns.primaryEntity.zh}行`, `Switch ${nouns.primaryEntity.en}`);
    case 'COMPACT_LEDGER':
      return pick(`扫描${nouns.primaryEntity.zh}行`, `Scan ${nouns.primaryEntity.en} Row`);
    case 'BALANCED_WORKSPACE':
      return pick('筛选待办指标', 'Filter Pending KPI');
    case 'MODULAR_CARDS':
      return pick(`聚焦${nouns.primaryEntity.zh}卡`, `Focus ${nouns.primaryEntity.en} Card`);
    case 'COLLAPSIBLE_RAIL':
      return pick('收起/展开侧栏', 'Collapse Sidebar');
    case 'TOP_SEGMENTED_HUB':
      return pick(`切至${nouns.secondaryEntity.zh}`, `Go to ${nouns.secondaryEntity.en}`);
    case 'DUAL_RAIL_SWITCHER':
      return pick('切换业务中心', 'Switch Domain Hub');
    case 'HOVER_ACTION_BAR':
      return pick('唤出行尾操作', 'Reveal Row Actions');
    case 'INLINE_QUICK_EDIT':
      return pick(`原地改${nouns.primaryField.zh}`, `Edit ${nouns.primaryField.en}`);
    case 'BATCH_FLOATING_BAR':
      return pick('勾选 2 条批处理', 'Select 2 Rows');
    case 'REALTIME_STICKY_SAVE':
      return pick('触发校验并保存', 'Validate & Save');
    case 'AUTOSAVE_DRAFT_BADGE':
      return pick('录入并自动暂存', 'Edit & Auto-Save');
    case 'STEP_SECTION_PRECHECK':
      return pick('预检进入下一节', 'Pre-Check Next Step');
    case 'SKELETON_SHIMMER':
      return pick(`刷新${nouns.primaryEntity.zh}`, `Refresh ${nouns.primaryEntity.en}`);
    case 'GUIDED_EMPTY_CARD':
      return pick(`创建首份${nouns.primaryEntity.zh}`, `First ${nouns.primaryEntity.en}`);
    case 'FILTER_ZERO_RECOVERY':
      return pick('一键清空筛选', 'Reset Filters');
    case 'STEPPER_CORNER_TOAST':
    case 'INLINE_BANNER_TIMELINE':
    case 'DUAL_SIGNOFF_PULSE':
      return pick(nouns.approveAction.zh, nouns.approveAction.en);
  }
}

export function InteractiveMiniStage({
  id,
  step,
  onTrigger,
  palette,
  domainNouns,
  locale,
  reducedMotion,
  compact = false,
}: InteractiveMiniStageProps): React.ReactElement {
  const def = MOTION_SCHEMATICS_BY_ID[id];
  const isActive = step % 2 === 1;
  const pick = (zh: string, en: string) => (locale === 'en-US' ? en : zh);

  const durationCss = reducedMotion ? '0ms' : `${def.motionSpec.durationMs}ms`;
  const easingCss = def.motionSpec.easing;
  const cardRadius = `${Math.max(4, Math.min(18, palette.radiusPx))}px`;
  const controlRadius = `${Math.max(4, Math.min(12, palette.radiusPx - 2))}px`;
  const btnInk = readableButtonInk(palette.accentColor);

  const primaryLabel = pick(domainNouns.primaryEntity.zh, domainNouns.primaryEntity.en);
  const secondaryLabel = pick(
    domainNouns.secondaryEntity.zh,
    domainNouns.secondaryEntity.en,
  );
  const fieldLabel = pick(domainNouns.primaryField.zh, domainNouns.primaryField.en);
  const actionLabel = triggerButtonLabel(id, isActive, domainNouns, locale);

  const motionStyle: React.CSSProperties = {
    transitionProperty: reducedMotion
      ? 'none'
      : 'transform, opacity, background-color, border-color, width',
    transitionDuration: durationCss,
    transitionTimingFunction: easingCss,
  };

  return (
    <div
      data-testid={`motion-stage-${id}`}
      data-stage-step={String(step)}
      data-stage-phase={isActive ? 'active' : 'idle'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      className={cn(
        'mp-interactive-stage mp-anim relative flex flex-col justify-between overflow-hidden border-b border-line select-none',
        compact ? 'min-h-[118px] p-2' : 'min-h-[148px] p-2.5',
      )}
      style={{
        backgroundColor: palette.surfaceColor,
        color: palette.inkColor,
        borderTopLeftRadius: cardRadius,
        borderTopRightRadius: cardRadius,
        ['--mp-accent' as string]: palette.accentColor,
        ['--mp-surface' as string]: palette.surfaceColor,
        ['--mp-ink' as string]: palette.inkColor,
        ['--mp-radius' as string]: cardRadius,
      }}
    >
      {/* Stage Top Bar: Domain Label + Playable Action Trigger */}
      <div className="z-10 flex items-center justify-between gap-1.5 pb-1.5">
        <span
          className="truncate font-mono text-[10.5px] font-semibold opacity-85"
          style={{ color: palette.inkColor }}
        >
          {primaryLabel} · {domainNouns.sampleRecordCode}
        </span>

        <button
          type="button"
          data-testid={`motion-trigger-${id}`}
          aria-pressed={isActive}
          onClick={(e) => {
            e.stopPropagation();
            onTrigger();
          }}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 px-2 py-0.5 text-[10.5px] font-semibold shadow-2xs focus-visible:outline-2"
          style={{
            backgroundColor: palette.accentColor,
            color: btnInk,
            borderRadius: controlRadius,
            transitionDuration: durationCss,
          }}
        >
          {isActive ? <RotateCcw size={10} /> : <Play size={10} />}
          <span>{actionLabel}</span>
        </button>
      </div>

      {/* Stage Live Miniature Viewport */}
      <div
        className="relative flex flex-1 flex-col justify-center overflow-hidden border px-2 py-1.5 text-[10.5px]"
        style={{
          borderRadius: controlRadius,
          borderColor: `color-mix(in srgb, ${palette.inkColor} 14%, transparent)`,
          backgroundColor: `color-mix(in srgb, ${palette.inkColor} 4%, ${palette.surfaceColor})`,
        }}
      >
        {/* 1. DETAIL OPEN GROUP */}
        {id === 'DRAWER' && (
          <div className="relative flex h-[86px] items-stretch justify-between">
            <div className="flex flex-1 flex-col gap-1 pr-2 opacity-85">
              <div className="truncate text-[10px] font-medium">
                {primaryLabel} · ¥128,000
              </div>
              <div className="truncate text-[10px] opacity-70">
                {secondaryLabel} · ¥45,000
              </div>
              <div className="mt-auto text-[9.5px] opacity-65">
                {isActive
                  ? pick('背景台账保持可见可核对', 'Background list stays visible')
                  : pick('点击右上按钮滑出抽屉', 'Click button to slide drawer')}
              </div>
            </div>
            <div
              data-testid="stage-drawer-panel"
              className="flex w-[56%] flex-col justify-between border-l p-1.5 shadow-xs"
              style={{
                ...motionStyle,
                backgroundColor: palette.surfaceColor,
                borderColor: palette.accentColor,
                borderRadius: controlRadius,
                transform: reducedMotion
                  ? 'none'
                  : isActive
                    ? 'translateX(0)'
                    : 'translateX(108%)',
                opacity: isActive ? 1 : 0.15,
              }}
            >
              <div className="truncate font-semibold" style={{ color: palette.accentColor }}>
                {isActive
                  ? pick(`抽屉已展开：${primaryLabel}`, `Drawer Open: ${primaryLabel}`)
                  : pick('右侧抽屉待命', 'Drawer Ready')}
              </div>
              <div className="rounded border border-current/15 px-1.5 py-0.5 text-[9.5px]">
                {fieldLabel}: ¥128,000
              </div>
              <div className="text-[9.5px] font-medium" style={{ color: palette.accentColor }}>
                ✓ {secondaryLabel}
              </div>
            </div>
          </div>
        )}

        {id === 'MODAL' && (
          <div className="relative flex h-[86px] items-center justify-center">
            <div
              className="absolute inset-0 flex flex-col gap-1 p-1.5"
              style={{ opacity: isActive ? 0.25 : 0.85, ...motionStyle }}
            >
              <div className="text-[10px]">{primaryLabel} #01</div>
              <div className="text-[10px]">{secondaryLabel} #02</div>
            </div>
            <div
              className="z-10 flex w-[84%] flex-col gap-1 border p-2 shadow-sm"
              style={{
                ...motionStyle,
                backgroundColor: palette.surfaceColor,
                borderColor: palette.accentColor,
                borderRadius: cardRadius,
                transform: reducedMotion
                  ? 'none'
                  : isActive
                    ? 'scale(1)'
                    : 'scale(0.92)',
                opacity: isActive ? 1 : 0,
                pointerEvents: isActive ? 'auto' : 'none',
              }}
            >
              <div className="font-semibold">
                {isActive
                  ? pick(`居中弹窗：${domainNouns.createAction.zh}`, `Modal: ${domainNouns.createAction.en}`)
                  : ''}
              </div>
              <div className="text-[9.5px] opacity-80">
                {fieldLabel} · {secondaryLabel}
              </div>
            </div>
            {!isActive && (
              <span className="z-10 rounded px-2 py-0.5 text-[9.5px] opacity-75">
                {pick('待弹出居中模态窗', 'Modal idle — click above to open')}
              </span>
            )}
          </div>
        )}

        {id === 'INLINE_SPLIT' && (
          <div className="grid h-[86px] grid-cols-2 gap-1.5">
            <div className="flex flex-col gap-1 border-r border-current/15 pr-1.5">
              <div
                className="rounded px-1.5 py-0.5 text-[9.5px] font-medium"
                style={{
                  ...motionStyle,
                  backgroundColor: !isActive ? `${palette.accentColor}22` : 'transparent',
                  borderLeft: !isActive ? `2px solid ${palette.accentColor}` : '2px solid transparent',
                }}
              >
                #01 {primaryLabel} A
              </div>
              <div
                className="rounded px-1.5 py-0.5 text-[9.5px] font-medium"
                style={{
                  ...motionStyle,
                  backgroundColor: isActive ? `${palette.accentColor}26` : 'transparent',
                  borderLeft: isActive ? `2px solid ${palette.accentColor}` : '2px solid transparent',
                }}
              >
                #02 {secondaryLabel} B
              </div>
            </div>
            <div
              className="flex flex-col justify-between rounded border border-current/15 p-1.5"
              style={{ ...motionStyle, backgroundColor: palette.surfaceColor }}
            >
              <div className="font-semibold" style={{ color: palette.accentColor }}>
                {isActive
                  ? pick(`联动详情：${secondaryLabel} B`, `Synced: ${secondaryLabel} B`)
                  : pick(`联动详情：${primaryLabel} A`, `Synced: ${primaryLabel} A`)}
              </div>
              <div className="text-[9.5px] opacity-80">
                {fieldLabel}: {isActive ? '¥260,000' : '¥98,000'}
              </div>
            </div>
          </div>
        )}

        {id === 'DEDICATED_TAB' && (
          <div className="flex h-[86px] flex-col gap-1.5">
            <div className="flex gap-1 border-b border-current/15 pb-1 text-[9.5px]">
              <span
                className="rounded px-1.5 py-0.5 font-medium"
                style={{
                  backgroundColor: !isActive ? palette.accentColor : 'transparent',
                  color: !isActive ? btnInk : palette.inkColor,
                  ...motionStyle,
                }}
              >
                1. {primaryLabel}
              </span>
              <span
                className="rounded px-1.5 py-0.5 font-medium"
                style={{
                  backgroundColor: isActive ? palette.accentColor : 'transparent',
                  color: isActive ? btnInk : palette.inkColor,
                  ...motionStyle,
                }}
              >
                2. {pick(`宽幅${secondaryLabel}页`, `Full ${secondaryLabel} Tab`)}
              </span>
            </div>
            {isActive ? (
              <div className="grid grid-cols-2 gap-1 pt-0.5 text-[9.5px]">
                <div className="rounded border border-current/20 px-1.5 py-1">
                  {primaryLabel} · {fieldLabel}
                </div>
                <div className="rounded border border-current/20 px-1.5 py-1">
                  {secondaryLabel} · 100%
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1 text-[9.5px] opacity-85">
                <div>{domainNouns.sampleRecordCode} · {primaryLabel}</div>
                <div>{secondaryLabel} · ¥180,000</div>
              </div>
            )}
          </div>
        )}

        {/* 2. INFORMATION DENSITY GROUP */}
        {id === 'COMPACT_LEDGER' && (
          <div className="flex h-[86px] flex-col justify-between font-mono text-[9.5px]">
            {[
              { code: '01', label: primaryLabel, amt: '¥128,400', hit: !isActive },
              { code: '02', label: secondaryLabel, amt: '¥64,200', hit: isActive },
              { code: '03', label: primaryLabel, amt: '¥310,000', hit: isActive },
            ].map((r) => (
              <div
                key={r.code}
                className="flex items-center justify-between border-b border-current/10 px-1.5 py-0.5"
                style={{
                  ...motionStyle,
                  backgroundColor: r.hit ? `${palette.accentColor}22` : 'transparent',
                }}
              >
                <span className="truncate">
                  #{r.code} {r.label}
                </span>
                <span>{r.amt}</span>
              </div>
            ))}
            <div className="text-[9px] opacity-75">
              {isActive
                ? pick('已高亮聚焦多条紧凑台账行', 'Focused compact ledger rows')
                : pick('高密等宽对齐 · 细分割线', 'High-density tabular rows')}
            </div>
          </div>
        )}

        {id === 'BALANCED_WORKSPACE' && (
          <div className="flex h-[86px] flex-col justify-between gap-1">
            <div className="grid grid-cols-2 gap-1.5">
              <div
                className="rounded border px-1.5 py-1 text-[9.5px]"
                style={{
                  ...motionStyle,
                  borderColor: isActive ? palette.accentColor : 'rgba(128,128,128,0.25)',
                  backgroundColor: palette.surfaceColor,
                }}
              >
                <div className="opacity-70">{primaryLabel}</div>
                <strong style={{ color: palette.accentColor }}>
                  {isActive ? '12 待办 / Filtered' : '48 总计 / Total'}
                </strong>
              </div>
              <div
                className="rounded border border-current/15 px-1.5 py-1 text-[9.5px]"
                style={{ backgroundColor: palette.surfaceColor }}
              >
                <div className="opacity-70">{secondaryLabel}</div>
                <strong>96.4%</strong>
              </div>
            </div>
            <div className="rounded border border-current/15 px-2 py-1 text-[9.5px]">
              {isActive
                ? pick(`已按指标筛出 12 条待处理${primaryLabel}`, `Filtered 12 pending ${primaryLabel}`)
                : pick(`标准行高展示全部${primaryLabel}`, `Balanced rows for ${primaryLabel}`)}
            </div>
          </div>
        )}

        {id === 'MODULAR_CARDS' && (
          <div className="grid h-[86px] grid-cols-2 gap-2 p-0.5">
            <div
              className="flex flex-col justify-between border p-2"
              style={{
                ...motionStyle,
                borderRadius: cardRadius,
                backgroundColor: palette.surfaceColor,
                borderColor: isActive ? palette.accentColor : 'rgba(128,128,128,0.25)',
                transform: reducedMotion
                  ? 'none'
                  : isActive
                    ? 'translateY(-2px)'
                    : 'translateY(0)',
              }}
            >
              <strong className="truncate text-[10px]">{primaryLabel}</strong>
              <span className="text-[9.5px]" style={{ color: palette.accentColor }}>
                {isActive ? pick('✓ 已浮起聚焦', '✓ Focused Card') : '¥128,000'}
              </span>
            </div>
            <div
              className="flex flex-col justify-between border border-current/15 p-2 opacity-85"
              style={{ borderRadius: cardRadius, backgroundColor: palette.surfaceColor }}
            >
              <strong className="truncate text-[10px]">{secondaryLabel}</strong>
              <span className="text-[9.5px] opacity-75">¥52,000</span>
            </div>
          </div>
        )}

        {/* 3. NAVIGATION STRUCTURE GROUP */}
        {id === 'COLLAPSIBLE_RAIL' && (
          <div className="flex h-[86px] items-stretch gap-1.5">
            <div
              className="flex flex-col justify-between border-r border-current/15 pr-1.5 text-[9.5px]"
              style={{
                ...motionStyle,
                width: isActive ? '34px' : '84px',
              }}
            >
              <div
                className="truncate rounded px-1 py-0.5 font-semibold"
                style={{ backgroundColor: `${palette.accentColor}22`, color: palette.accentColor }}
              >
                {isActive ? '▣' : `▣ ${primaryLabel}`}
              </div>
              <div className="truncate px-1 opacity-75">
                {isActive ? '▤' : `▤ ${secondaryLabel}`}
              </div>
            </div>
            <div className="flex flex-1 flex-col justify-between py-0.5">
              <div className="truncate text-[9.5px] opacity-75">
                {pick('首页', 'Home')} / <strong>{primaryLabel}</strong>
              </div>
              <div className="rounded border border-current/15 p-1.5 text-[9.5px]">
                {isActive
                  ? pick('侧栏已收窄为图标轨，主表画布拓宽', 'Rail collapsed — wide table canvas')
                  : pick('标准展开侧栏 + 顶栏面包屑', 'Expanded sidebar + breadcrumb')}
              </div>
            </div>
          </div>
        )}

        {id === 'TOP_SEGMENTED_HUB' && (
          <div className="flex h-[86px] flex-col justify-between">
            <div className="mx-auto inline-flex gap-1 rounded-full border border-current/15 p-0.5 text-[9.5px]">
              <span
                className="rounded-full px-2 py-0.5 font-medium"
                style={{
                  ...motionStyle,
                  backgroundColor: !isActive ? palette.accentColor : 'transparent',
                  color: !isActive ? btnInk : palette.inkColor,
                }}
              >
                {primaryLabel}
              </span>
              <span
                className="rounded-full px-2 py-0.5 font-medium"
                style={{
                  ...motionStyle,
                  backgroundColor: isActive ? palette.accentColor : 'transparent',
                  color: isActive ? btnInk : palette.inkColor,
                }}
              >
                {secondaryLabel}
              </span>
            </div>
            <div className="rounded border border-current/15 px-2 py-1.5 text-center text-[9.5px]">
              {isActive
                ? pick(`全宽主视图：${secondaryLabel}`, `Full-width Hub: ${secondaryLabel}`)
                : pick(`全宽主视图：${primaryLabel}`, `Full-width Hub: ${primaryLabel}`)}
            </div>
          </div>
        )}

        {id === 'DUAL_RAIL_SWITCHER' && (
          <div className="flex h-[86px] items-stretch gap-1.5 text-[9.5px]">
            <div className="flex w-[24px] flex-col items-center gap-1 border-r border-current/15 pr-1">
              <span
                className="inline-flex h-5 w-5 items-center justify-center rounded font-bold"
                style={{
                  backgroundColor: !isActive ? palette.accentColor : 'transparent',
                  color: !isActive ? btnInk : palette.inkColor,
                }}
              >
                A
              </span>
              <span
                className="inline-flex h-5 w-5 items-center justify-center rounded font-bold"
                style={{
                  backgroundColor: isActive ? palette.accentColor : 'transparent',
                  color: isActive ? btnInk : palette.inkColor,
                }}
              >
                B
              </span>
            </div>
            <div className="flex w-[74px] flex-col gap-1 border-r border-current/15 pr-1.5">
              <strong className="truncate" style={{ color: palette.accentColor }}>
                {isActive
                  ? pick('结算风控域', 'Settlement Hub')
                  : pick('业务履约域', 'Fulfillment Hub')}
              </strong>
              <span className="truncate opacity-80">
                {isActive ? secondaryLabel : primaryLabel}
              </span>
            </div>
            <div className="flex flex-1 items-center px-1">
              {isActive
                ? pick(`已切至二级子菜单：${secondaryLabel}`, `Switched domain: ${secondaryLabel}`)
                : pick(`当前一级域菜单：${primaryLabel}`, `Active domain: ${primaryLabel}`)}
            </div>
          </div>
        )}

        {/* 4. TABLE ROW ACTIONS GROUP */}
        {id === 'HOVER_ACTION_BAR' && (
          <div className="flex h-[86px] flex-col justify-center gap-1.5">
            <div
              className="flex items-center justify-between rounded border px-2 py-1.5"
              style={{
                ...motionStyle,
                borderColor: isActive ? palette.accentColor : 'rgba(128,128,128,0.25)',
                backgroundColor: palette.surfaceColor,
              }}
            >
              <span className="truncate font-medium">{primaryLabel} #18</span>
              <div
                className="flex items-center gap-1"
                style={{
                  ...motionStyle,
                  opacity: isActive ? 1 : 0.2,
                }}
              >
                <span
                  className="rounded px-1.5 py-0.5 text-[9px] font-semibold"
                  style={{ backgroundColor: palette.accentColor, color: btnInk }}
                >
                  {isActive
                    ? pick('编辑 · 审批 · 更多', 'Edit · Approve · More')
                    : '···'}
                </span>
              </div>
            </div>
            <div className="text-[9.5px] opacity-75">
              {isActive
                ? pick('行尾快捷操作组已浮现', 'Quick-action pill bar revealed')
                : pick('默认隐藏不杂乱，悬停/聚焦即现', 'Clean row until hovered or focused')}
            </div>
          </div>
        )}

        {id === 'INLINE_QUICK_EDIT' && (
          <div className="flex h-[86px] flex-col justify-center gap-1.5">
            <div
              className="flex items-center justify-between rounded border px-2 py-1.5"
              style={{
                ...motionStyle,
                borderColor: isActive ? palette.accentColor : 'rgba(128,128,128,0.25)',
                backgroundColor: isActive ? `${palette.accentColor}18` : palette.surfaceColor,
              }}
            >
              <span className="truncate">{primaryLabel}</span>
              <span className="font-mono font-semibold" style={{ color: palette.accentColor }}>
                {isActive
                  ? pick('✓ ¥156,000（已原地保存）', '✓ ¥156,000 (Saved Inline)')
                  : '✎ ¥120,000'}
              </span>
            </div>
            <div className="text-[9.5px] opacity-75">
              {fieldLabel} · {secondaryLabel}
            </div>
          </div>
        )}

        {id === 'BATCH_FLOATING_BAR' && (
          <div className="relative flex h-[86px] flex-col justify-between">
            <div className="flex flex-col gap-1 text-[9.5px]">
              <div>
                {isActive ? '☑' : '☐'} {primaryLabel} #01
              </div>
              <div>
                {isActive ? '☑' : '☐'} {secondaryLabel} #02
              </div>
            </div>
            <div
              className="flex items-center justify-between px-2 py-1 text-[9.5px] font-semibold shadow-xs"
              style={{
                ...motionStyle,
                borderRadius: controlRadius,
                backgroundColor: palette.accentColor,
                color: btnInk,
                transform: reducedMotion
                  ? 'none'
                  : isActive
                    ? 'translateY(0)'
                    : 'translateY(14px)',
                opacity: isActive ? 1 : 0.18,
              }}
            >
              <span>
                {isActive
                  ? pick(`已选 2 项 · 批量${domainNouns.approveAction.zh}`, `2 Selected · Bulk ${domainNouns.approveAction.en}`)
                  : pick('勾选行后升起批量栏', 'Select rows for batch bar')}
              </span>
            </div>
          </div>
        )}

        {/* 5. FORM VALIDATION & SAVE GROUP */}
        {id === 'REALTIME_STICKY_SAVE' && (
          <div className="flex h-[86px] flex-col justify-between">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between rounded border border-current/25 px-1.5 py-0.5 text-[9.5px]">
                <span>{fieldLabel}</span>
                <span className="font-mono">{isActive ? '¥128,000 ✓' : '¥0'}</span>
              </div>
              <div className="text-[9px]" style={{ color: palette.accentColor }}>
                {isActive
                  ? pick(`✓ 规则通过：${primaryLabel}已经由吸底栏保存`, `✓ Rule valid: ${primaryLabel} saved via sticky bar`)
                  : pick(`提示：${fieldLabel}须大于 0（失焦即时校验）`, `Rule hint: ${fieldLabel} must be > 0`)}
              </div>
            </div>
            <div
              className="flex items-center justify-between border-t border-current/15 pt-1 text-[9.5px] font-semibold"
            >
              <span className="opacity-70">{pick('常驻吸底栏', 'Sticky Footer')}</span>
              <span style={{ color: palette.accentColor }}>
                {isActive ? pick('✓ 已保存', '✓ Saved') : pick('保存单据', 'Save')}
              </span>
            </div>
          </div>
        )}

        {id === 'AUTOSAVE_DRAFT_BADGE' && (
          <div className="flex h-[86px] flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="font-medium">{primaryLabel}</span>
              <span
                className="rounded-full border px-2 py-0.5 text-[9px] font-semibold"
                style={{
                  ...motionStyle,
                  borderColor: palette.accentColor,
                  backgroundColor: isActive ? `${palette.accentColor}20` : 'transparent',
                  color: palette.accentColor,
                }}
              >
                {isActive
                  ? pick('✓ 草稿已自动保存 14:32', '✓ Draft Auto-Saved 14:32')
                  : pick('● 有未保存改动', '● Unsaved Changes')}
              </span>
            </div>
            <div className="rounded border border-current/15 px-2 py-1 text-[9.5px] opacity-85">
              {secondaryLabel} · {fieldLabel}
            </div>
          </div>
        )}

        {id === 'STEP_SECTION_PRECHECK' && (
          <div className="flex h-[86px] flex-col justify-between">
            <div className="flex items-center gap-1.5 text-[9.5px] font-semibold">
              <span style={{ color: palette.accentColor }}>
                ✓ 1.{primaryLabel}
              </span>
              <span>→</span>
              <span
                style={{
                  color: isActive ? palette.accentColor : palette.inkColor,
                  opacity: isActive ? 1 : 0.6,
                }}
              >
                {isActive ? `✓ 2.${secondaryLabel}` : `2.${secondaryLabel}`}
              </span>
            </div>
            <div
              className="rounded border px-2 py-1.5 text-[9.5px]"
              style={{
                ...motionStyle,
                borderColor: isActive ? palette.accentColor : 'rgba(128,128,128,0.25)',
                backgroundColor: palette.surfaceColor,
              }}
            >
              {isActive
                ? pick(`第 1 节预检通过，已展开「${secondaryLabel}」分段`, `Section 1 valid — advanced to ${secondaryLabel}`)
                : pick(`当前填写第 1 节：${primaryLabel}基础信息`, `Step 1 active: ${primaryLabel} basics`)}
            </div>
          </div>
        )}

        {/* 6. EMPTY STATE & LOADING GROUP */}
        {id === 'SKELETON_SHIMMER' && (
          <div className="flex h-[86px] flex-col justify-center gap-1.5">
            {isActive ? (
              <div className="flex flex-col gap-1 text-[9.5px]">
                <div className="flex justify-between rounded border border-current/15 px-2 py-1 font-medium">
                  <span>✓ {primaryLabel} #01</span>
                  <span>¥128,000</span>
                </div>
                <div className="flex justify-between rounded border border-current/15 px-2 py-1 opacity-85">
                  <span>✓ {secondaryLabel} #02</span>
                  <span>¥42,000</span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div
                  className="h-4 w-3/4 rounded bg-current/15"
                  style={{ animation: reducedMotion ? 'none' : undefined }}
                />
                <div className="h-4 w-full rounded bg-current/10" />
                <span className="text-[9px] opacity-70">
                  {pick(`骨架占位准备就绪 — 点击加载${primaryLabel}`, `Skeleton ready — click to load ${primaryLabel}`)}
                </span>
              </div>
            )}
          </div>
        )}

        {id === 'GUIDED_EMPTY_CARD' && (
          <div className="flex h-[86px] flex-col items-center justify-center text-center">
            {isActive ? (
              <div
                className="w-full rounded border p-2 text-left text-[9.5px]"
                style={{ borderColor: palette.accentColor, backgroundColor: palette.surfaceColor }}
              >
                <strong style={{ color: palette.accentColor }}>
                  ✓ {pick(`首份${primaryLabel}已建立`, `First ${primaryLabel} Created`)}
                </strong>
                <div className="opacity-80">{domainNouns.sampleRecordCode} · {secondaryLabel}</div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1">
                <span className="font-semibold">
                  {pick(`暂无${primaryLabel}记录`, `No ${primaryLabel} Yet`)}
                </span>
                <span className="text-[9px] opacity-75">
                  {pick(`点击右上「创建首份${primaryLabel}」开始体验`, `Click above to create your first ${primaryLabel}`)}
                </span>
              </div>
            )}
          </div>
        )}

        {id === 'FILTER_ZERO_RECOVERY' && (
          <div className="flex h-[86px] flex-col justify-between">
            <div className="flex items-center gap-1 text-[9px]">
              <span
                className="rounded-full px-2 py-0.5"
                style={{
                  backgroundColor: isActive ? 'transparent' : `${palette.accentColor}22`,
                  border: '1px solid currentColor',
                  opacity: isActive ? 0.55 : 1,
                }}
              >
                {isActive
                  ? pick('全部筛选已清空', 'All Filters Cleared')
                  : pick(`筛选：超期${primaryLabel} (0 条)`, `Filter: Overdue ${primaryLabel} (0)`)}
              </span>
            </div>
            <div className="rounded border border-current/15 px-2 py-1.5 text-[9.5px]">
              {isActive
                ? pick(`✓ 已恢复显示 24 条${primaryLabel}记录`, `✓ Restored 24 ${primaryLabel} records`)
                : pick('命中 0 条结果 · 支持一键清空条件恢复', '0 matching rows · One-click reset ready')}
            </div>
          </div>
        )}

        {/* 7. APPROVAL, STATE FLOW & FEEDBACK GROUP */}
        {id === 'STEPPER_CORNER_TOAST' && (
          <div className="relative flex h-[86px] flex-col justify-between">
            <div className="flex items-center gap-1.5 text-[9.5px] font-semibold">
              <span style={{ color: palette.accentColor }}>● {pick('提交', 'Submit')}</span>
              <span className="h-[2px] flex-1 bg-current/20">
                <span
                  className="block h-full"
                  style={{
                    ...motionStyle,
                    backgroundColor: palette.accentColor,
                    width: isActive ? '100%' : '35%',
                  }}
                />
              </span>
              <span style={{ color: isActive ? palette.accentColor : palette.inkColor }}>
                {isActive ? `✓ ${pick('已放行', 'Approved')}` : `○ ${pick('待审', 'Review')}`}
              </span>
            </div>
            <div
              className="ml-auto rounded border px-2 py-1 text-[9.5px] font-medium shadow-2xs"
              style={{
                ...motionStyle,
                borderColor: palette.accentColor,
                backgroundColor: palette.surfaceColor,
                opacity: isActive ? 1 : 0.45,
                transform: reducedMotion
                  ? 'none'
                  : isActive
                    ? 'translateY(0)'
                    : 'translateY(6px)',
              }}
            >
              {isActive
                ? pick(`🎉 ${primaryLabel}已审批通过`, `🎉 ${primaryLabel} Approved`)
                : pick(`待执行：${domainNouns.approveAction.zh}`, `Pending: ${domainNouns.approveAction.en}`)}
            </div>
          </div>
        )}

        {id === 'INLINE_BANNER_TIMELINE' && (
          <div className="flex h-[86px] flex-col justify-between gap-1 text-[9.5px]">
            <div
              className="flex items-center justify-between rounded border px-2 py-1 font-semibold"
              style={{
                borderColor: palette.accentColor,
                backgroundColor: isActive ? `${palette.accentColor}20` : palette.surfaceColor,
              }}
            >
              <span>
                {isActive
                  ? pick(`✓ 横幅状态：${primaryLabel}已签批`, `✓ Banner: ${primaryLabel} Signed`)
                  : pick(`待签批横幅：${primaryLabel}`, `Pending Banner: ${primaryLabel}`)}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 pl-1.5 text-[9px] opacity-85">
              <div>• 09:30 {pick('发起提交', 'Submitted')}</div>
              {isActive && (
                <div className="font-semibold" style={{ color: palette.accentColor }}>
                  • 10:15 {pick(`审计留痕：已批准${secondaryLabel}`, `Audit Trail: Approved ${secondaryLabel}`)}
                </div>
              )}
            </div>
          </div>
        )}

        {id === 'DUAL_SIGNOFF_PULSE' && (
          <div className="flex h-[86px] flex-col justify-between text-[9.5px]">
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded border border-current/20 px-1.5 py-1">
                ✓ {pick('业务初审', 'Ops Lead')}
              </div>
              <div
                className="rounded border px-1.5 py-1 font-semibold"
                style={{
                  ...motionStyle,
                  borderColor: isActive ? palette.accentColor : 'rgba(128,128,128,0.25)',
                  color: isActive ? palette.accentColor : palette.inkColor,
                }}
              >
                {isActive
                  ? `✓ ${pick('财务会签', 'Finance Sign')}`
                  : `○ ${pick('待财务会签', 'Finance Pending')}`}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="truncate opacity-80">{primaryLabel}</span>
              <span
                className="rounded-full px-2 py-0.5 text-[9px] font-bold"
                style={{
                  ...motionStyle,
                  backgroundColor: isActive ? palette.accentColor : 'rgba(128,128,128,0.2)',
                  color: isActive ? btnInk : palette.inkColor,
                }}
              >
                {isActive ? 'APPROVED ✓' : 'COUNTERSIGNING'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Stateful Stage Wrapper ─────────────────────────────────────────────────

export interface MotionSchematicStageProps {
  scene?: SchematicSceneId;
  id?: MotionSchematicId;
  accentColor?: string;
  surfaceColor?: string;
  inkColor?: string;
  radiusPx?: number;
  palette?: Partial<MotionPaletteTokens>;
  domainNouns?: MotionDomainNouns;
  step?: number;
  onTrigger?: () => void;
  reducedMotion?: boolean;
  compact?: boolean;
}

export function MotionSchematicStage({
  scene,
  id,
  accentColor,
  surfaceColor,
  inkColor,
  radiusPx,
  palette,
  domainNouns,
  step,
  onTrigger,
  reducedMotion,
  compact = false,
}: MotionSchematicStageProps): React.ReactElement {
  const { locale } = usePreferences();
  const effectiveReducedMotion = usePrefersReducedMotion(reducedMotion);
  const resolvedId = id ?? coerceToMotionSchematicId(scene ?? 'DRAWER');
  const [internalStep, setInternalStep] = useState(0);

  const resolvedPalette = useMemo(
    () =>
      resolveMotionPalette(palette, {
        ...(accentColor ? { accentColor } : {}),
        ...(surfaceColor ? { surfaceColor } : {}),
        ...(inkColor ? { inkColor } : {}),
        ...(typeof radiusPx === 'number' ? { radiusPx } : {}),
      }),
    [palette, accentColor, surfaceColor, inkColor, radiusPx],
  );

  const effectiveStep = step ?? internalStep;
  const handleTrigger = () => {
    if (step === undefined) {
      setInternalStep((s) => (s === 0 ? 1 : 0));
    }
    onTrigger?.();
  };

  return (
    <InteractiveMiniStage
      id={resolvedId}
      step={effectiveStep}
      onTrigger={handleTrigger}
      palette={resolvedPalette}
      domainNouns={domainNouns ?? DEFAULT_DOMAIN_NOUNS}
      locale={locale}
      reducedMotion={effectiveReducedMotion}
      compact={compact}
    />
  );
}

// ─── Playable Selected Schematics Strip for Style Tile (Ticket 09) ──────────

export interface StyleTileMotionSampleStripProps {
  selection?: LegacyAlignmentCompatInput | MotionSchematicSelection;
  palette?: Partial<MotionPaletteTokens>;
  accentColor?: string;
  surfaceColor?: string;
  inkColor?: string;
  radiusPx?: number;
  domainNouns?: MotionDomainNouns;
  srsMarkdown?: string;
  project?: MotionSrsProjectContext | null;
  stageSteps?: MotionStageStepMap;
  onStageStepsChange?: (
    next: MotionStageStepMap,
    triggeredId: MotionSchematicId,
    nextStep: number,
  ) => void;
  onSelectGroup?: (groupKey: MotionSchematicGroupKey) => void;
  reducedMotion?: boolean;
  className?: string;
}

export function StyleTileMotionSampleStrip({
  selection,
  palette,
  accentColor,
  surfaceColor,
  inkColor,
  radiusPx,
  domainNouns,
  srsMarkdown,
  project,
  stageSteps,
  onStageStepsChange,
  onSelectGroup,
  reducedMotion,
  className,
}: StyleTileMotionSampleStripProps): React.ReactElement {
  const { locale, t } = usePreferences();
  const effectiveReducedMotion = usePrefersReducedMotion(reducedMotion);
  const [internalSteps, setInternalSteps] = useState<MotionStageStepMap>({});

  const resolvedSelection = useMemo(
    () =>
      selection
        ? resolveMotionSelection(selection)
        : inferDefaultMotionSelectionFromSrs(srsMarkdown, project),
    [selection, srsMarkdown, project],
  );

  const resolvedPalette = useMemo(
    () =>
      resolveMotionPalette(palette, {
        ...(accentColor ? { accentColor } : {}),
        ...(surfaceColor ? { surfaceColor } : {}),
        ...(inkColor ? { inkColor } : {}),
        ...(typeof radiusPx === 'number' ? { radiusPx } : {}),
      }),
    [palette, accentColor, surfaceColor, inkColor, radiusPx],
  );

  const resolvedNouns = useMemo(
    () => domainNouns ?? extractDomainNounsFromSrs(srsMarkdown, project),
    [domainNouns, srsMarkdown, project],
  );

  const activeSteps = stageSteps ?? internalSteps;

  const handleStageTrigger = (id: MotionSchematicId) => {
    const next = triggerMotionSchematic(activeSteps, id);
    if (stageSteps === undefined) {
      setInternalSteps(next);
    }
    onStageStepsChange?.(next, id, next[id] ?? 0);
  };

  return (
    <section
      data-testid="style-tile-motion-strip"
      data-reduced-motion={effectiveReducedMotion ? 'true' : 'false'}
      aria-label={t('已选动态示意样张（可点击试玩）', 'Selected Motion Schematics (Click to Play)')}
      className={cn('flex flex-col gap-2.5', className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
          <Sparkles size={13} className="text-accent" />
          <span>
            {t(
              '已选 7 组动态示意（点卡片右上按钮可亲手试玩交互）',
              '7 Selected Motion Schematics (Click each stage button to test live)',
            )}
          </span>
        </div>
        <span className="font-mono text-[11px] text-ink-3">
          {effectiveReducedMotion
            ? t('已启用减少动态效果 (0ms)', 'Reduced Motion Active (0ms)')
            : t('硬性动效规格已就绪', 'Hard Motion Specs Active')}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {MOTION_SCHEMATIC_GROUPS.map((group) => {
          const chosenId = resolvedSelection[group.key];
          const item = MOTION_SCHEMATICS_BY_ID[chosenId];
          return (
            <article
              key={group.key}
              data-testid={`style-tile-motion-sample-${group.key}`}
              data-schematic-id={item.id}
              className="flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-2xs"
            >
              <InteractiveMiniStage
                id={item.id}
                step={activeSteps[item.id] ?? 0}
                onTrigger={() => handleStageTrigger(item.id)}
                palette={resolvedPalette}
                domainNouns={resolvedNouns}
                locale={locale}
                reducedMotion={effectiveReducedMotion}
                compact
              />
              <div className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 text-[11.5px]">
                <div className="min-w-0">
                  <div className="text-[10.5px] text-ink-3">
                    {group.index}. {t(group.title.zh, group.title.en)}
                  </div>
                  <div className="truncate font-semibold text-ink">
                    {t(item.plainTitle.zh, item.plainTitle.en)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="rounded bg-inset px-1.5 py-0.5 font-mono text-[10px] text-ink-3">
                    {effectiveReducedMotion ? '0ms' : `${item.motionSpec.durationMs}ms`}
                  </span>
                  {onSelectGroup && (
                    <button
                      type="button"
                      data-testid={`style-tile-jump-${group.key}`}
                      onClick={() => onSelectGroup(group.key)}
                      className="cursor-pointer rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-medium text-ink-2 hover:border-accent hover:text-accent"
                    >
                      {t('调整', 'Change')}
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

// ─── Option Card (Non-Nested Controls + Collapsible MotionSpec) ─────────────

function SchematicOptionCard({
  item,
  selected,
  palette,
  domainNouns,
  locale,
  reducedMotion,
  stageStep,
  onTriggerStage,
  onSelect,
}: {
  item: MotionSchematicDefinition;
  selected: boolean;
  palette: MotionPaletteTokens;
  domainNouns: MotionDomainNouns;
  locale: 'zh-CN' | 'en-US';
  reducedMotion: boolean;
  stageStep: number;
  onTriggerStage: () => void;
  onSelect: () => void;
}): React.ReactElement {
  const pick = (zh: string, en: string) => (locale === 'en-US' ? en : zh);
  const spec = item.motionSpec;

  return (
    <article
      data-testid={`motion-card-${item.id}`}
      className={cn(
        'flex flex-col overflow-hidden rounded-card border bg-surface transition-colors',
        selected
          ? 'border-accent ring-2 ring-accent/25 shadow-xs'
          : 'border-line hover:border-accent/55',
      )}
    >
      {/* Interactive Playable Stage (has its own trigger <button>, never nested inside another <button>) */}
      <InteractiveMiniStage
        id={item.id}
        step={stageStep}
        onTrigger={onTriggerStage}
        palette={palette}
        domainNouns={domainNouns}
        locale={locale}
        reducedMotion={reducedMotion}
      />

      {/* Radio Selection Button for Choosing This Pattern */}
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        data-testid={`motion-select-${item.id}`}
        onClick={onSelect}
        className="flex flex-1 cursor-pointer flex-col justify-between gap-1.5 p-3 text-left focus-visible:outline-2 focus-visible:outline-accent"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="text-[13px] font-semibold leading-snug text-ink">
            {pick(item.plainTitle.zh, item.plainTitle.en)}
          </div>
          <span
            className={cn(
              'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors',
              selected
                ? 'border-accent bg-accent text-white'
                : 'border-line bg-inset text-transparent',
            )}
          >
            <Check size={11.5} strokeWidth={2.6} />
          </span>
        </div>

        <p className="m-0 text-[12px] leading-[1.5] text-ink-3">
          {pick(item.plainDesc.zh, item.plainDesc.en)}
        </p>

        <div className="mt-1 flex items-center justify-between gap-2 pt-0.5 font-mono text-[10.5px] text-ink-3">
          <span>{item.refCode}</span>
          <span>
            {reducedMotion ? '0ms (reduced)' : `${spec.durationMs}ms · ${spec.easing}`}
          </span>
        </div>
      </button>

      {/* Progressive Disclosure: Hard Motion Spec & Adaptable Example Code */}
      <details
        data-testid={`motion-spec-disclosure-${item.id}`}
        className="border-t border-line bg-inset/40 px-3 py-1.5 text-[11px]"
      >
        <summary className="flex cursor-pointer items-center gap-1.5 font-medium text-ink-2 select-none">
          <Code2 size={11.5} className="text-accent" />
          <span>{pick('查看动效硬规格与示例代码', 'Motion Spec & Example Code')}</span>
        </summary>
        <div className="mt-2 space-y-1.5 pb-1 text-ink-2">
          <div>
            <strong>{pick('触发：', 'Trigger: ')}</strong>
            {pick(spec.trigger.zh, spec.trigger.en)}
          </div>
          <div>
            <strong>{pick('对象：', 'Target: ')}</strong>
            {pick(spec.target.zh, spec.target.en)}
          </div>
          <div>
            <strong>{pick('时长 / 缓动：', 'Timing: ')}</strong>
            <code>
              {spec.durationMs}ms · {spec.easing}
            </code>
          </div>
          <div>
            <strong>{pick('减少动态效果：', 'Reduced Motion: ')}</strong>
            {pick(spec.reducedMotionFallback.zh, spec.reducedMotionFallback.en)}
          </div>
          <pre className="m-0 overflow-x-auto rounded border border-line bg-surface p-2 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-ink">
            {spec.exampleCode}
          </pre>
        </div>
      </details>
    </article>
  );
}

// ─── Complete 7-Group Motion Schematic Gallery ──────────────────────────────

export interface MotionSchematicGalleryProps {
  alignment?: RequirementAlignmentState;
  setAlignment?: React.Dispatch<React.SetStateAction<RequirementAlignmentState>>;
  selection?: MotionSchematicSelection;
  onSelectionChange?: (next: MotionSchematicSelection) => void;
  accentColor?: string;
  surfaceColor?: string;
  inkColor?: string;
  radiusPx?: number;
  palette?: Partial<MotionPaletteTokens>;
  domainNouns?: MotionDomainNouns;
  srsMarkdown?: string;
  project?: MotionSrsProjectContext | null;
  stageSteps?: MotionStageStepMap;
  onStageStepsChange?: (
    next: MotionStageStepMap,
    triggeredId: MotionSchematicId,
    nextStep: number,
  ) => void;
  reducedMotion?: boolean;
}

export function MotionSchematicGallery({
  alignment,
  setAlignment,
  selection,
  onSelectionChange,
  accentColor,
  surfaceColor,
  inkColor,
  radiusPx,
  palette,
  domainNouns,
  srsMarkdown,
  project,
  stageSteps,
  onStageStepsChange,
  reducedMotion,
}: MotionSchematicGalleryProps): React.ReactElement {
  const { locale, t } = usePreferences();
  const effectiveReducedMotion = usePrefersReducedMotion(reducedMotion);

  const inferredDefaults = useMemo(
    () => inferDefaultMotionSelectionFromSrs(srsMarkdown, project),
    [srsMarkdown, project],
  );

  const [uncontrolledSelection, setUncontrolledSelection] =
    useState<MotionSchematicSelection>(inferredDefaults);

  const [internalStageSteps, setInternalStageSteps] = useState<MotionStageStepMap>({});

  const resolvedSelection: MotionSchematicSelection = useMemo(() => {
    if (selection) return selection;
    if (alignment) {
      // Merge SRS defaults for any newly added 7-group keys not explicitly present on alignment
      return {
        detailOpen: alignment.detailOpen ?? alignment.entryPattern ?? inferredDefaults.detailOpen,
        informationDensity:
          alignment.informationDensity ??
          alignment.layoutDensity ??
          inferredDefaults.informationDensity,
        navigationStructure:
          alignment.navigationStructure ?? inferredDefaults.navigationStructure,
        tableRowActions: alignment.tableRowActions ?? inferredDefaults.tableRowActions,
        formValidationSave:
          alignment.formValidationSave ?? inferredDefaults.formValidationSave,
        emptyAndLoading: alignment.emptyAndLoading ?? inferredDefaults.emptyAndLoading,
        approvalAndFeedback:
          alignment.approvalAndFeedback ?? inferredDefaults.approvalAndFeedback,
      };
    }
    return uncontrolledSelection;
  }, [selection, alignment, inferredDefaults, uncontrolledSelection]);

  const resolvedPalette = useMemo(
    () =>
      resolveMotionPalette(palette, {
        ...(accentColor ? { accentColor } : {}),
        ...(surfaceColor ? { surfaceColor } : {}),
        ...(inkColor ? { inkColor } : {}),
        ...(typeof radiusPx === 'number' ? { radiusPx } : {}),
      }),
    [palette, accentColor, surfaceColor, inkColor, radiusPx],
  );

  const resolvedNouns = useMemo(
    () => domainNouns ?? extractDomainNounsFromSrs(srsMarkdown, project),
    [domainNouns, srsMarkdown, project],
  );

  const activeStageSteps = stageSteps ?? internalStageSteps;

  const handleSelectOption = <K extends MotionSchematicGroupKey>(
    groupKey: K,
    optionId: MotionSchematicSelection[K],
  ) => {
    const nextSelection: MotionSchematicSelection = {
      ...resolvedSelection,
      [groupKey]: optionId,
    };
    if (!selection && !alignment) {
      setUncontrolledSelection(nextSelection);
    }
    onSelectionChange?.(nextSelection);
    if (setAlignment) {
      setAlignment((prev) => syncAlignmentWithSelection(prev, nextSelection));
    }
  };

  const handleTriggerStage = (id: MotionSchematicId) => {
    const next = triggerMotionSchematic(activeStageSteps, id);
    if (stageSteps === undefined) {
      setInternalStageSteps(next);
    }
    onStageStepsChange?.(next, id, next[id] ?? 0);
  };

  return (
    <div
      data-testid="motion-schematic-gallery"
      data-reduced-motion={effectiveReducedMotion ? 'true' : 'false'}
      className="flex flex-col gap-5"
    >
      {/* Header Bar */}
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line pb-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge badge-accent">
              <Sparkles size={11.5} />
              {t('7 组动态示意选型', '7-Group Motion Schematics')}
            </span>
            <h3 className="m-0 font-serif text-[16.5px] font-semibold text-ink">
              {t(
                '亲手点一点试手感 — 已按需求规格书为您预选全套默认方案',
                'Click Any Mini Stage to Feel the Interaction — Pre-Selected from Your SRS',
              )}
            </h3>
          </div>
          <p className="m-0 mt-1 text-[12.5px] text-ink-3">
            {t(
              '每张示意已套用主参考配色与当前业务名词。点右上角按钮可实时触发交互；不改动也能直接继续，所选动效规格将作为硬性约束交给 Agent。',
              'Styled with your Primary Reference palette and SRS domain nouns. Click any stage button to trigger its live state transition, or proceed immediately with the SRS defaults.',
            )}
          </p>
        </div>

        <span
          data-testid="motion-gallery-preselect-badge"
          className="rounded-full border border-line bg-inset px-2.5 py-1 font-mono text-[11px] text-ink-2"
        >
          {effectiveReducedMotion
            ? t('减少动态效果已开启 · 0ms 瞬时切换', 'Reduced Motion · 0ms Instant')
            : t('已按 SRS 预选 7 / 7 组', '7 / 7 Pre-selected from SRS')}
        </span>
      </div>

      {/* All 7 Groups */}
      {MOTION_SCHEMATIC_GROUPS.map((group) => {
        const currentSelectedId = resolvedSelection[group.key];
        const currentSelectedDef = MOTION_SCHEMATICS_BY_ID[currentSelectedId];
        const gridCols =
          group.options.length === 4
            ? 'sm:grid-cols-2 xl:grid-cols-4'
            : 'sm:grid-cols-3';

        return (
          <section
            key={group.key}
            data-testid={`motion-group-${group.key}`}
            role="radiogroup"
            aria-label={`${group.index}. ${t(group.title.zh, group.title.en)}`}
            className="space-y-2.5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-[13.5px] font-semibold text-ink">
                {group.index}. {t(group.title.zh, group.title.en)}
                <span className="ml-2 font-normal text-[12.5px] text-ink-2">
                  — {t(group.promptQuestion.zh, group.promptQuestion.en)}
                </span>
              </div>
              <span className="font-mono text-[11.5px] text-ink-3">
                {t(
                  `已选：${currentSelectedDef.plainTitle.zh}`,
                  `Selected: ${currentSelectedDef.plainTitle.en}`,
                )}
              </span>
            </div>

            <div className={cn('grid grid-cols-1 gap-3', gridCols)}>
              {group.options.map((option) => (
                <SchematicOptionCard
                  key={option.id}
                  item={option}
                  selected={currentSelectedId === option.id}
                  palette={resolvedPalette}
                  domainNouns={resolvedNouns}
                  locale={locale}
                  reducedMotion={effectiveReducedMotion}
                  stageStep={activeStageSteps[option.id] ?? 0}
                  onTriggerStage={() => handleTriggerStage(option.id)}
                  onSelect={() =>
                    handleSelectOption(
                      group.key,
                      option.id as MotionSchematicSelection[typeof group.key],
                    )
                  }
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
