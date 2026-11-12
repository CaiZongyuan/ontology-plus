import type { ProjectDetail } from '../../../packages/workspace-store/index.js';

export interface BilingualText {
  zh: string;
  en: string;
}

export type DetailOpenSchematicId = 'DRAWER' | 'MODAL' | 'INLINE_SPLIT' | 'DEDICATED_TAB';
export type EntrySchematicId = DetailOpenSchematicId;

export type InformationDensitySchematicId =
  | 'COMPACT_LEDGER'
  | 'BALANCED_WORKSPACE'
  | 'MODULAR_CARDS';

export type NavigationStructureSchematicId =
  | 'COLLAPSIBLE_RAIL'
  | 'TOP_SEGMENTED_HUB'
  | 'DUAL_RAIL_SWITCHER';

export type TableRowActionSchematicId =
  | 'HOVER_ACTION_BAR'
  | 'INLINE_QUICK_EDIT'
  | 'BATCH_FLOATING_BAR';

export type FormValidationSaveSchematicId =
  | 'REALTIME_STICKY_SAVE'
  | 'AUTOSAVE_DRAFT_BADGE'
  | 'STEP_SECTION_PRECHECK';

export type EmptyLoadingSchematicId =
  | 'SKELETON_SHIMMER'
  | 'GUIDED_EMPTY_CARD'
  | 'FILTER_ZERO_RECOVERY';

export type ApprovalFeedbackSchematicId =
  | 'STEPPER_CORNER_TOAST'
  | 'INLINE_BANNER_TIMELINE'
  | 'DUAL_SIGNOFF_PULSE';

export type MotionSchematicId =
  | DetailOpenSchematicId
  | InformationDensitySchematicId
  | NavigationStructureSchematicId
  | TableRowActionSchematicId
  | FormValidationSaveSchematicId
  | EmptyLoadingSchematicId
  | ApprovalFeedbackSchematicId;

export type MotionSchematicGroupKey =
  | 'detailOpen'
  | 'informationDensity'
  | 'navigationStructure'
  | 'tableRowActions'
  | 'formValidationSave'
  | 'emptyAndLoading'
  | 'approvalAndFeedback';

export interface MotionSpec {
  trigger: BilingualText;
  target: BilingualText;
  durationMs: number;
  easing: string;
  reducedMotionFallback: BilingualText;
  exampleCode: string;
}

export interface MotionSchematicDefinition<
  TId extends MotionSchematicId = MotionSchematicId,
  TGroup extends MotionSchematicGroupKey = MotionSchematicGroupKey,
> {
  id: TId;
  groupKey: TGroup;
  refCode: string;
  plainTitle: BilingualText;
  plainDesc: BilingualText;
  agentSummary: BilingualText;
  motionSpec: MotionSpec;
}

export interface MotionSchematicGroup<
  TGroup extends MotionSchematicGroupKey = MotionSchematicGroupKey,
  TId extends MotionSchematicId = MotionSchematicId,
> {
  key: TGroup;
  index: number;
  title: BilingualText;
  promptQuestion: BilingualText;
  options: readonly MotionSchematicDefinition<TId, TGroup>[];
}

export interface MotionSchematicSelection {
  detailOpen: DetailOpenSchematicId;
  informationDensity: InformationDensitySchematicId;
  navigationStructure: NavigationStructureSchematicId;
  tableRowActions: TableRowActionSchematicId;
  formValidationSave: FormValidationSaveSchematicId;
  emptyAndLoading: EmptyLoadingSchematicId;
  approvalAndFeedback: ApprovalFeedbackSchematicId;
}

export const DEFAULT_MOTION_SELECTION: MotionSchematicSelection = {
  detailOpen: 'DRAWER',
  informationDensity: 'BALANCED_WORKSPACE',
  navigationStructure: 'COLLAPSIBLE_RAIL',
  tableRowActions: 'HOVER_ACTION_BAR',
  formValidationSave: 'REALTIME_STICKY_SAVE',
  emptyAndLoading: 'SKELETON_SHIMMER',
  approvalAndFeedback: 'STEPPER_CORNER_TOAST',
};

export const DETAIL_OPEN_OPTIONS: readonly MotionSchematicDefinition<
  DetailOpenSchematicId,
  'detailOpen'
>[] = [
  {
    id: 'DRAWER',
    groupKey: 'detailOpen',
    refCode: '#050 Drawer',
    plainTitle: {
      zh: '从右侧滑出一层录入抽屉',
      en: 'Right Slide-over Drawer',
    },
    plainDesc: {
      zh: '点「新建」或点列表行时右侧滑出面板，背后的台账保留可见，方便边核对边录入。',
      en: 'Slides a detail/create drawer in from the right while keeping the underlying table visible.',
    },
    agentSummary: {
      zh: '新建与查看详情采用右侧滑出抽屉（Off-canvas Drawer，背景微暗保留列表上下文，支持遮罩与 Esc 收起）。',
      en: 'Open Create/Detail inside a right slide-over drawer while keeping the background table in context.',
    },
    motionSpec: {
      trigger: {
        zh: '点击主新建按钮 [data-event-id] 或表格详情触发行',
        en: 'Click primary create CTA [data-event-id] or table row detail trigger',
      },
      target: {
        zh: '右侧抽屉容器 .drawer-panel（translateX(100% -> 0)）与半透明遮罩 .drawer-scrim',
        en: 'Right drawer container .drawer-panel (translateX(100% -> 0)) and backdrop .drawer-scrim',
      },
      durationMs: 240,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      reducedMotionFallback: {
        zh: 'prefers-reduced-motion: reduce 时禁用水平位移，0ms 直接切换抽屉显隐状态',
        en: 'Disable horizontal slide and toggle drawer visibility in 0ms under prefers-reduced-motion: reduce',
      },
      exampleCode: `.drawer-panel {
  transform: translateX(100%);
  transition: transform 240ms cubic-bezier(0.16, 1, 0.3, 1);
}
.drawer-panel[data-open="true"] { transform: translateX(0); }
@media (prefers-reduced-motion: reduce) {
  .drawer-panel { transition-duration: 0ms; }
}`,
    },
  },
  {
    id: 'MODAL',
    groupKey: 'detailOpen',
    refCode: '#049 Modal',
    plainTitle: {
      zh: '屏幕正中间弹出专注小窗',
      en: 'Centered Modal Dialog',
    },
    plainDesc: {
      zh: '四周背景柔和变暗，正中间浮出窗口，让人集中注意力填完这一单再回列表。',
      en: 'Dims the page and scales in a centered dialog so the user focuses on completing one action.',
    },
    agentSummary: {
      zh: '新建与关键确认采用居中模态弹窗（Centered Modal Dialog，微缩放弹入，支持 Esc 与遮罩关闭）。',
      en: 'Open Create/Confirm inside a centered modal dialog with soft backdrop dim and subtle scale-in.',
    },
    motionSpec: {
      trigger: {
        zh: '点击新建或关键业务确认按钮 [data-element-type="BUTTON"]',
        en: 'Click create or primary confirmation button [data-element-type="BUTTON"]',
      },
      target: {
        zh: '模态对话框 dialog.modal-surface（scale(0.95 -> 1) + opacity）与遮罩 ::backdrop',
        en: 'Modal dialog.modal-surface (scale(0.95 -> 1) + opacity) and ::backdrop scrim',
      },
      durationMs: 200,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      reducedMotionFallback: {
        zh: 'prefers-reduced-motion: reduce 时移除缩放，0ms 直接呈现居中弹窗',
        en: 'Remove scale transform and show modal immediately in 0ms under prefers-reduced-motion: reduce',
      },
      exampleCode: `.modal-surface {
  opacity: 0;
  transform: scale(0.95) translateY(4px);
  transition: opacity 200ms cubic-bezier(0.16, 1, 0.3, 1), transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
}
.modal-surface[data-open="true"] { opacity: 1; transform: scale(1) translateY(0); }`,
    },
  },
  {
    id: 'INLINE_SPLIT',
    groupKey: 'detailOpen',
    refCode: '#Split',
    plainTitle: {
      zh: '左边看列表、右边常驻联动详情',
      en: 'Master-Detail Inline Split',
    },
    plainDesc: {
      zh: '同屏左右分栏，左边点哪条记录右边立刻同步展示详情与编辑表单，不用反复开关窗口。',
      en: 'Persistent left master list and right live detail/form pane for rapid continuous triage.',
    },
    agentSummary: {
      zh: '采用同屏左右主从分栏布局（Master-Detail Inline Split，左侧列表选中行与右侧详情面板实时联动）。',
      en: 'Use a persistent side-by-side master-detail split layout with live detail synchronization.',
    },
    motionSpec: {
      trigger: {
        zh: '点击左侧列表任意业务行 tr[data-record-id] 或新建切换按钮',
        en: 'Click any master list row tr[data-record-id] or create mode toggle',
      },
      target: {
        zh: '左侧行高亮条 .row-active-indicator 与右侧详情区 [data-screen-type="DETAIL"]',
        en: 'Master active row indicator .row-active-indicator and right pane [data-screen-type="DETAIL"]',
      },
      durationMs: 180,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      reducedMotionFallback: {
        zh: 'prefers-reduced-motion: reduce 时 0ms 切换选中行高亮与右侧表单内容',
        en: 'Swap active row highlight and detail pane content in 0ms under prefers-reduced-motion: reduce',
      },
      exampleCode: `.detail-pane-body {
  transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
tr[aria-selected="true"] { background: color-mix(in srgb, var(--accent) 12%, transparent); }`,
    },
  },
  {
    id: 'DEDICATED_TAB',
    groupKey: 'detailOpen',
    refCode: '#057 Tabs',
    plainTitle: {
      zh: '整屏平滑切换到宽敞独立页签',
      en: 'Full-Page Tab Switch',
    },
    plainDesc: {
      zh: '点顶部页签直接切换成整屏多栏大表单，视野最宽敞，适合字段多、带子表的大单据。',
      en: 'Switches the full workspace to a dedicated multi-column form screen via a sliding tab pill.',
    },
    agentSummary: {
      zh: '采用独立宽幅页签整屏切换（Full-Page Tab Switch，列表视图与多列宽表单视图通过滑动指示器切换）。',
      en: 'Switch between full-width list and spacious multi-column form screens via sliding top tabs.',
    },
    motionSpec: {
      trigger: {
        zh: '点击顶部视图页签 [role="tab"] 或「新建单据」主按钮',
        en: 'Click top workspace tab [role="tab"] or primary Create button',
      },
      target: {
        zh: '页签滑块 .tab-active-pill 与目标屏幕容器 section[data-screen-id]',
        en: 'Active tab pill .tab-active-pill and target screen section[data-screen-id]',
      },
      durationMs: 220,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      reducedMotionFallback: {
        zh: 'prefers-reduced-motion: reduce 时滑块与屏幕 0ms 瞬时切换，无平移动画',
        en: 'Switch active tab pill and screen container in 0ms without slide under prefers-reduced-motion: reduce',
      },
      exampleCode: `.tab-active-pill {
  transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
}
section[data-screen-id][data-active="true"] {
  animation: screenFadeIn 220ms cubic-bezier(0.16, 1, 0.3, 1);
}`,
    },
  },
];

export const INFORMATION_DENSITY_OPTIONS: readonly MotionSchematicDefinition<
  InformationDensitySchematicId,
  'informationDensity'
>[] = [
  {
    id: 'COMPACT_LEDGER',
    groupKey: 'informationDensity',
    refCode: '#Ledger',
    plainTitle: {
      zh: '紧凑对齐的高密度财务级台账',
      en: 'Compact Enterprise Ledger',
    },
    plainDesc: {
      zh: '细分割线 + 等宽数字右对齐，一屏能看十多条业务记录，鼠标移过哪行哪行清晰亮起。',
      en: 'Crisp hairlines and tabular numbers fit maximum rows per screen with instant row scan highlight.',
    },
    agentSummary: {
      zh: '采用紧凑高密度企业台账（34px~38px 行高、8px~10px 内边距、tabular-nums 等宽金额对齐、悬停高亮行）。',
      en: 'Use a compact high-density enterprise ledger with 36px row height, tabular numbers, and crisp row hover.',
    },
    motionSpec: {
      trigger: {
        zh: '指针悬停或键盘焦点扫过台账行 tbody tr / 切换紧凑视图',
        en: 'Pointer hover or keyboard focus across ledger rows tbody tr',
      },
      target: {
        zh: '表格数据行 tr.ledger-row 背景色与左侧主色指示边条',
        en: 'Table row tr.ledger-row background tint and inline-start accent bar',
      },
      durationMs: 140,
      easing: 'ease-out',
      reducedMotionFallback: {
        zh: 'prefers-reduced-motion: reduce 时 0ms 瞬时切换悬停行底色',
        en: 'Instant 0ms row background highlight swap under prefers-reduced-motion: reduce',
      },
      exampleCode: `.ledger-table td { padding: 8px 10px; font-variant-numeric: tabular-nums; }
.ledger-row { transition: background-color 140ms ease-out; }
.ledger-row:hover { background-color: color-mix(in srgb, var(--accent) 8%, var(--surface)); }`,
    },
  },
  {
    id: 'BALANCED_WORKSPACE',
    groupKey: 'informationDensity',
    refCode: '#Balanced',
    plainTitle: {
      zh: '疏密适中的标准业务工作台',
      en: 'Balanced Standard Workspace',
    },
    plainDesc: {
      zh: '上方一排关键指标摘要，下方舒适行高的业务表格，既不拥挤也不浪费屏幕空间。',
      en: 'Combines a crisp KPI summary strip with comfortably spaced table rows for everyday operations.',
    },
    agentSummary: {
      zh: '采用标准均衡工作台密度（顶部紧凑指标卡 + 44px 舒适表格行高 + 16px 模块间距）。',
      en: 'Use balanced workspace density with a top KPI summary strip, 44px table rows, and 16px section rhythm.',
    },
    motionSpec: {
      trigger: {
        zh: '点击顶部指标筛选卡 .kpi-filter-card 联动下方列表',
        en: 'Click top KPI summary filter card .kpi-filter-card to focus matching records',
      },
      target: {
        zh: '指标卡激活边框 .kpi-filter-card[aria-pressed="true"] 与列表过滤区',
        en: 'Active KPI card border .kpi-filter-card[aria-pressed="true"] and filtered table body',
      },
      durationMs: 180,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      reducedMotionFallback: {
        zh: 'prefers-reduced-motion: reduce 时 0ms 切换指标卡选中态与列表过滤结果',
        en: 'Toggle KPI card active state and filtered rows in 0ms under prefers-reduced-motion: reduce',
      },
      exampleCode: `.kpi-filter-card {
  padding: 12px 16px;
  transition: border-color 180ms cubic-bezier(0.22, 1, 0.36, 1), background-color 180ms ease;
}
.kpi-filter-card[aria-pressed="true"] { border-color: var(--accent); }`,
    },
  },
  {
    id: 'MODULAR_CARDS',
    groupKey: 'informationDensity',
    refCode: '#081 Bento',
    plainTitle: {
      zh: '宽松留白的分块圆角卡片',
      en: 'Spacious Modular Bento Cards',
    },
    plainDesc: {
      zh: '记录与模块装进呼吸感充足的圆角卡片里，点选或悬停时卡片轻柔微浮，重点一目了然。',
      en: 'Groups records into generous rounded cards that lift softly on hover or selection.',
    },
    agentSummary: {
      zh: '采用宽松分块圆角卡片布局（Modular Bento Cards，20px~24px 充足留白，交互时轻微上浮与柔和层次阴影）。',
      en: 'Organize records and modules into spacious modular cards with 20px+ padding and subtle hover lift.',
    },
    motionSpec: {
      trigger: {
        zh: '指针移入或点击业务卡片 .bento-record-card',
        en: 'Pointer hover or click on modular record card .bento-record-card',
      },
      target: {
        zh: '业务圆角卡片 .bento-record-card（translateY(-2px) + 边框强调色）',
        en: 'Modular card .bento-record-card (translateY(-2px) + accent border)',
      },
      durationMs: 200,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      reducedMotionFallback: {
        zh: 'prefers-reduced-motion: reduce 时取消上浮位移，0ms 仅切换边框高亮色',
        en: 'Omit vertical lift and highlight card border in 0ms under prefers-reduced-motion: reduce',
      },
      exampleCode: `.bento-record-card {
  padding: 20px;
  transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1), border-color 200ms ease;
}
.bento-record-card:hover { transform: translateY(-2px); border-color: var(--accent); }`,
    },
  },
];

export const NAVIGATION_STRUCTURE_OPTIONS: readonly MotionSchematicDefinition<
  NavigationStructureSchematicId,
  'navigationStructure'
>[] = [
  {
    id: 'COLLAPSIBLE_RAIL',
    groupKey: 'navigationStructure',
    refCode: '#Rail',
    plainTitle: {
      zh: '可收起左侧菜单栏 + 顶部面包屑',
      en: 'Collapsible Left Rail + Top Breadcrumb',
    },
    plainDesc: {
      zh: '最经典的后台导航，左边选业务模块、顶部看当前层级，还能一键把侧栏收窄腾出宽画布。',
      en: 'Classic left navigation rail with a top breadcrumb bar that collapses cleanly to maximize table width.',
    },
    agentSummary: {
      zh: '导航采用可折叠左侧栏 + 顶栏面包屑路径（Collapsible Left Sidebar + Breadcrumb Header，支持收窄为图标栏）。',
      en: 'Use a collapsible left navigation rail paired with a top breadcrumb bar and active module indicator.',
    },
    motionSpec: {
      trigger: {
        zh: '点击侧栏收起/展开按钮 [data-action="toggle-rail"] 或左侧菜单项',
        en: 'Click sidebar collapse button [data-action="toggle-rail"] or nav item',
      },
      target: {
        zh: '侧边导航栏 aside.nav-rail 宽度与主内容区面包屑路径 .breadcrumb-trail',
        en: 'Sidebar aside.nav-rail width and main header .breadcrumb-trail',
      },
      durationMs: 220,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      reducedMotionFallback: {
        zh: 'prefers-reduced-motion: reduce 时侧栏宽度与菜单激活态 0ms 瞬时切换',
        en: 'Toggle sidebar width and active nav state in 0ms under prefers-reduced-motion: reduce',
      },
      exampleCode: `.app-shell {
  grid-template-columns: var(--rail-w, 220px) minmax(0, 1fr);
  transition: grid-template-columns 220ms cubic-bezier(0.16, 1, 0.3, 1);
}
.app-shell[data-rail-collapsed="true"] { --rail-w: 60px; }`,
    },
  },
  {
    id: 'TOP_SEGMENTED_HUB',
    groupKey: 'navigationStructure',
    refCode: '#TopHub',
    plainTitle: {
      zh: '清爽无侧栏的顶部胶囊导航栏',
      en: 'Top Segmented Hub Bar',
    },
    plainDesc: {
      zh: '去掉左侧边栏，所有核心页面集中在顶部一排胶囊按钮里，下方整块屏幕全留给业务内容。',
      en: 'Removes the left sidebar in favor of a centered top segmented bar, giving 100% width to content.',
    },
    agentSummary: {
      zh: '导航采用无侧栏顶部胶囊中枢栏（Top Segmented Hub Bar，顶栏居中切换核心屏幕，画布横向全宽展开）。',
      en: 'Use a sidebar-free top segmented hub navigation bar with a sliding active capsule and full-width canvas.',
    },
    motionSpec: {
      trigger: {
        zh: '点击顶部中枢导航胶囊按钮 nav.top-hub [data-nav-target]',
        en: 'Click top hub navigation pill nav.top-hub [data-nav-target]',
      },
      target: {
        zh: '顶部激活胶囊滑块 .hub-active-capsule 与主屏幕区 main[data-screen-id]',
        en: 'Top active capsule .hub-active-capsule and main screen viewport main[data-screen-id]',
      },
      durationMs: 200,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      reducedMotionFallback: {
        zh: 'prefers-reduced-motion: reduce 时胶囊高亮与主视图 0ms 直接切换',
        en: 'Switch top hub capsule highlight and screen in 0ms under prefers-reduced-motion: reduce',
      },
      exampleCode: `.hub-nav-pill {
  transition: background-color 200ms cubic-bezier(0.16, 1, 0.3, 1), color 200ms ease;
}
.hub-nav-pill[aria-current="page"] { background: var(--accent); color: #fff; }`,
    },
  },
  {
    id: 'DUAL_RAIL_SWITCHER',
    groupKey: 'navigationStructure',
    refCode: '#DualRail',
    plainTitle: {
      zh: '最左切业务中心 + 次级模块双层栏',
      en: 'Dual-Rail Domain Switcher',
    },
    plainDesc: {
      zh: '最左侧窄图标条切换大业务域（如采购、风控、结算），紧挨着展开该域下的细分菜单，适合大系统。',
      en: 'Pairs a narrow primary domain icon rail with a contextual secondary menu column for multi-domain suites.',
    },
    agentSummary: {
      zh: '导航采用双层业务域侧栏（Dual-Rail Domain Switcher，一级窄图标轨切换业务中心，二级侧栏联动子模块列表）。',
      en: 'Use a dual-rail navigation layout with a primary domain icon rail and a contextual secondary menu rail.',
    },
    motionSpec: {
      trigger: {
        zh: '点击一级业务域图标轨按钮 .primary-rail-btn[data-domain]',
        en: 'Click primary domain rail icon button .primary-rail-btn[data-domain]',
      },
      target: {
        zh: '一级域激活指示条与二级子菜单分组面板 .secondary-rail-group',
        en: 'Primary domain active bar and secondary menu list .secondary-rail-group',
      },
      durationMs: 210,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      reducedMotionFallback: {
        zh: 'prefers-reduced-motion: reduce 时二级菜单内容 0ms 瞬时替换，无渐入位移',
        en: 'Swap secondary rail menu items in 0ms without fade-slide under prefers-reduced-motion: reduce',
      },
      exampleCode: `.secondary-rail-group {
  animation: railSubmenuSwap 210ms cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes railSubmenuSwap {
  from { opacity: 0; transform: translateX(-6px); }
  to { opacity: 1; transform: translateX(0); }
}`,
    },
  },
];

export const TABLE_ROW_ACTION_OPTIONS: readonly MotionSchematicDefinition<
  TableRowActionSchematicId,
  'tableRowActions'
>[] = [
  {
    id: 'HOVER_ACTION_BAR',
    groupKey: 'tableRowActions',
    refCode: '#RowBar',
    plainTitle: {
      zh: '指向哪行，右侧浮现快捷操作按钮',
      en: 'Hover Quick-Action Bar',
    },
    plainDesc: {
      zh: '平时表格干干净净不堆满按钮，鼠标移到某一行或聚焦时，行尾平滑浮出「编辑 · 审批 · 更多」。',
      en: 'Keeps rows clean until hovered or focused, revealing a crisp inline action pill bar at the row end.',
    },
    agentSummary: {
      zh: '表格行操作采用悬停/聚焦浮现快捷工具条（Hover/Focus Quick-Action Bar，触屏与键盘焦点同样可见可用）。',
      en: 'Reveal a quick-action button cluster at the trailing edge of table rows on hover and keyboard focus-within.',
    },
    motionSpec: {
      trigger: {
        zh: '表格行 tr:hover、tr:focus-within 或点击行操作触发器',
        en: 'Table row tr:hover, tr:focus-within, or row action toggle',
      },
      target: {
        zh: '行尾悬浮操作组 .row-quick-actions（opacity + translateX(4px -> 0)）',
        en: 'Trailing action cluster .row-quick-actions (opacity + translateX(4px -> 0))',
      },
      durationMs: 150,
      easing: 'ease-out',
      reducedMotionFallback: {
        zh: 'prefers-reduced-motion: reduce 时 0ms 直接显示行尾快捷操作组',
        en: 'Show trailing row actions in 0ms without horizontal slide under prefers-reduced-motion: reduce',
      },
      exampleCode: `.row-quick-actions {
  opacity: 0;
  transform: translateX(4px);
  transition: opacity 150ms ease-out, transform 150ms ease-out;
}
tr:hover .row-quick-actions, tr:focus-within .row-quick-actions {
  opacity: 1; transform: translateX(0);
}`,
    },
  },
  {
    id: 'INLINE_QUICK_EDIT',
    groupKey: 'tableRowActions',
    refCode: '#InlineEdit',
    plainTitle: {
      zh: '不用进详情，在表里点一下直接改值',
      en: 'Inline Quick-Edit & Status Pill',
    },
    plainDesc: {
      zh: '在表格里点一下金额或状态胶囊就能原地修改并打勾保存，改完闪烁一下确认绿光。',
      en: 'Click a cell or status pill right inside the table to edit in place and confirm with a subtle flash.',
    },
    agentSummary: {
      zh: '表格支持高频字段行内即点即改与状态胶囊直切（Inline Quick-Edit，原地保存后单元格轻闪确认）。',
      en: 'Support in-place cell editing and interactive status pills directly inside table rows with save confirmation.',
    },
    motionSpec: {
      trigger: {
        zh: '点击可编辑单元格 [data-inline-edit] 并确认保存',
        en: 'Click editable cell [data-inline-edit] and commit value',
      },
      target: {
        zh: '单元格编辑框 .inline-cell-editor 与保存高亮态 td[data-just-saved="true"]',
        en: 'Inline cell input .inline-cell-editor and saved highlight td[data-just-saved="true"]',
      },
      durationMs: 180,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      reducedMotionFallback: {
        zh: 'prefers-reduced-motion: reduce 时 0ms 切换编辑框与已保存勾号标记，无闪烁渐变',
        en: 'Swap inline input and saved checkmark badge in 0ms under prefers-reduced-motion: reduce',
      },
      exampleCode: `td[data-just-saved="true"] {
  background-color: color-mix(in srgb, var(--accent) 14%, transparent);
  transition: background-color 180ms cubic-bezier(0.22, 1, 0.36, 1);
}`,
    },
  },
  {
    id: 'BATCH_FLOATING_BAR',
    groupKey: 'tableRowActions',
    refCode: '#BatchBar',
    plainTitle: {
      zh: '勾选多行后，底部升起批量处理条',
      en: 'Multi-Select Floating Batch Bar',
    },
    plainDesc: {
      zh: '勾中两三条单据后，屏幕底部稳稳升起一条操作栏：「已选 3 项 · 批量审批 · 导出」。',
      en: 'Checking one or more rows elevates a floating action bar at the bottom for bulk approve or export.',
    },
    agentSummary: {
      zh: '表格支持多选勾选并联动底部悬浮批处理栏（Multi-Select Floating Batch Bar，显示已选计数与批量动作）。',
      en: 'Provide row checkboxes that summon a floating bottom batch-action toolbar with live selection count.',
    },
    motionSpec: {
      trigger: {
        zh: '勾选或取消勾选行复选框 input[type="checkbox"][data-row-select]',
        en: 'Check or uncheck row selection checkbox input[type="checkbox"][data-row-select]',
      },
      target: {
        zh: '底部悬浮批处理条 .batch-floating-bar（translateY(16px -> 0) + opacity）',
        en: 'Floating bottom toolbar .batch-floating-bar (translateY(16px -> 0) + opacity)',
      },
      durationMs: 220,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      reducedMotionFallback: {
        zh: 'prefers-reduced-motion: reduce 时 0ms 直接显隐底部批处理工具条',
        en: 'Toggle floating batch bar visibility in 0ms without slide under prefers-reduced-motion: reduce',
      },
      exampleCode: `.batch-floating-bar {
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 220ms cubic-bezier(0.16, 1, 0.3, 1), transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
}
.batch-floating-bar[data-visible="true"] { opacity: 1; transform: translateY(0); }`,
    },
  },
];

export const FORM_VALIDATION_SAVE_OPTIONS: readonly MotionSchematicDefinition<
  FormValidationSaveSchematicId,
  'formValidationSave'
>[] = [
  {
    id: 'REALTIME_STICKY_SAVE',
    groupKey: 'formValidationSave',
    refCode: '#StickySave',
    plainTitle: {
      zh: '填错当场红字提醒 + 底部常驻保存栏',
      en: 'Real-Time Field Rule Hint + Sticky Footer Save',
    },
    plainDesc: {
      zh: '离开输入框立刻提示规则（如金额须大于 0），底部固定一条保存栏，再长的表单也不用滚到底找按钮。',
      en: 'Validates fields inline on blur/submit with clear rule messages and keeps Save pinned in a sticky footer.',
    },
    agentSummary: {
      zh: '表单采用失焦即时规则提示 + 吸底常驻保存栏（Inline Field Validation + Sticky Action Footer，禁用阻塞式 alert）。',
      en: 'Validate fields inline with rule-specific hints and pin Save/Cancel inside a sticky form footer.',
    },
    motionSpec: {
      trigger: {
        zh: '必填/规则字段失焦 blur 或点击吸底保存按钮 [data-event-id]',
        en: 'Field blur or click on sticky footer Save button [data-event-id]',
      },
      target: {
        zh: '字段下方行内错误提示 .field-rule-hint 与保存按钮状态徽标',
        en: 'Inline field message .field-rule-hint and sticky footer Save state indicator',
      },
      durationMs: 180,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      reducedMotionFallback: {
        zh: 'prefers-reduced-motion: reduce 时 0ms 显示行内校验文字与边框色，禁用抖动与渐入',
        en: 'Display inline validation message and border color in 0ms under prefers-reduced-motion: reduce',
      },
      exampleCode: `.field-rule-hint {
  opacity: 0;
  transform: translateY(-3px);
  transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1), transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.field-group[data-invalid="true"] .field-rule-hint { opacity: 1; transform: translateY(0); }`,
    },
  },
  {
    id: 'AUTOSAVE_DRAFT_BADGE',
    groupKey: 'formValidationSave',
    refCode: '#AutoSave',
    plainTitle: {
      zh: '边填边自动存草稿，右上角显示「已保存」',
      en: 'Auto-Save Draft with Dirty Badge',
    },
    plainDesc: {
      zh: '一改内容就标出「未保存改动」，停手一秒自动暂存草稿并变成安心的「✓ 草稿已保存」。',
      en: 'Shows an "Unsaved edits" pill on input that smoothly settles into "Draft saved" before final submission.',
    },
    agentSummary: {
      zh: '表单配备脏数据徽标与自动草稿暂存反馈（Dirty State Badge + Auto-Save Draft Indicator，防意外关闭丢失）。',
      en: 'Track dirty form edits with a live header badge that transitions from Unsaved Changes to Draft Saved.',
    },
    motionSpec: {
      trigger: {
        zh: '表单输入变更 input/change 及防抖草稿暂存完成或点击暂存',
        en: 'Form input change followed by debounced draft save or manual save trigger',
      },
      target: {
        zh: '表单顶栏保存状态胶囊 .draft-status-pill',
        en: 'Form header status pill .draft-status-pill',
      },
      durationMs: 200,
      easing: 'ease-out',
      reducedMotionFallback: {
        zh: 'prefers-reduced-motion: reduce 时胶囊文案与底色 0ms 瞬时切换',
        en: 'Update draft status pill text and color in 0ms under prefers-reduced-motion: reduce',
      },
      exampleCode: `.draft-status-pill {
  transition: background-color 200ms ease-out, color 200ms ease-out, border-color 200ms ease-out;
}
.draft-status-pill[data-state="saved"] { color: var(--accent); }`,
    },
  },
  {
    id: 'STEP_SECTION_PRECHECK',
    groupKey: 'formValidationSave',
    refCode: '#StepCheck',
    plainTitle: {
      zh: '分步分段填写，每过一节先打勾预检',
      en: 'Step-by-Step Section Pre-Check',
    },
    plainDesc: {
      zh: '把复杂大表单拆成清晰的「基本信息 → 履约明细 → 提交复核」，填对一节亮一个绿勾再往下走。',
      en: 'Breaks complex forms into guided sections that pre-check rules step by step before final submission.',
    },
    agentSummary: {
      zh: '复杂表单采用分段分步前置预检（Step-by-Step Section Pre-Check，当前节校验通过后打勾并平滑展开下一节）。',
      en: 'Structure complex forms into sequential sections that validate and check off before advancing.',
    },
    motionSpec: {
      trigger: {
        zh: '点击当前表单分段「校验并下一步」按钮 [data-action="next-section"]',
        en: 'Click "Validate & Continue" button [data-action="next-section"] on active form step',
      },
      target: {
        zh: '分段步骤指示器 .form-step-badge 与下一分段面板 .form-section-panel',
        en: 'Step indicator .form-step-badge and next section panel .form-section-panel',
      },
      durationMs: 230,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      reducedMotionFallback: {
        zh: 'prefers-reduced-motion: reduce 时步骤完成态与下一分段面板 0ms 直接切换',
        en: 'Advance step check badge and active section in 0ms under prefers-reduced-motion: reduce',
      },
      exampleCode: `.form-section-panel[data-active="true"] {
  animation: sectionStepIn 230ms cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes sectionStepIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}`,
    },
  },
];

export const EMPTY_LOADING_OPTIONS: readonly MotionSchematicDefinition<
  EmptyLoadingSchematicId,
  'emptyAndLoading'
>[] = [
  {
    id: 'SKELETON_SHIMMER',
    groupKey: 'emptyAndLoading',
    refCode: '#069 Skeleton',
    plainTitle: {
      zh: '刷新查询时先闪过柔和流光占位条',
      en: 'Shimmer Skeleton Sweep',
    },
    plainDesc: {
      zh: '点查询或刚进页面加载时，先展示与表格同宽的柔和流光条，再平滑浮现真实数据，绝不生硬闪白。',
      en: 'Sweeps a gentle light band across layout-matched placeholder rows before cross-fading real data in.',
    },
    agentSummary: {
      zh: '数据加载与检索刷新采用同构骨架屏流光过渡（Shimmer Skeleton Sweep，加载完成后平滑淡入真实列表）。',
      en: 'Render layout-matched skeleton placeholder rows during load/refresh before fading in real records.',
    },
    motionSpec: {
      trigger: {
        zh: '点击检索/刷新按钮 [data-action="refresh"] 或首次异步拉取数据',
        en: 'Click search/refresh button [data-action="refresh"] or initial async query',
      },
      target: {
        zh: '骨架占位块 .skeleton-row 与加载完成的数据容器 .loaded-records',
        en: 'Skeleton placeholder rows .skeleton-row and loaded list container .loaded-records',
      },
      durationMs: 260,
      easing: 'ease-out',
      reducedMotionFallback: {
        zh: 'prefers-reduced-motion: reduce 时关闭流光扫掠动画，静态占位块 0ms 直接切换为真实数据',
        en: 'Disable shimmer sweep and swap static placeholder to data in 0ms under prefers-reduced-motion: reduce',
      },
      exampleCode: `.loaded-records { animation: recordsReveal 260ms ease-out; }
@media (prefers-reduced-motion: reduce) {
  .skeleton-row { animation: none; }
  .loaded-records { animation-duration: 0ms; }
}`,
    },
  },
  {
    id: 'GUIDED_EMPTY_CARD',
    groupKey: 'emptyAndLoading',
    refCode: '#EmptyGuide',
    plainTitle: {
      zh: '还没有数据时，放一张带创建按钮的引导卡',
      en: 'Guided First-Action Empty Card',
    },
    plainDesc: {
      zh: '新系统没数据时不留一片死白，而是温和说明「暂无记录」并递上一颗醒目的「立即创建首单」按钮。',
      en: 'Replaces blank tables with a welcoming empty card explaining the next step and offering a one-click Create CTA.',
    },
    agentSummary: {
      zh: '零数据状态采用首单引导卡片（Guided Empty State Card，说明业务用途并提供直达新建动作的主按钮）。',
      en: 'Show an actionable empty-state card with domain guidance and a direct primary Create CTA when zero records exist.',
    },
    motionSpec: {
      trigger: {
        zh: '列表为空时展示引导卡，点击卡内「创建首条」主按钮触发首单创建',
        en: 'Click primary Create First Record CTA inside .empty-guide-card',
      },
      target: {
        zh: '空状态引导卡 .empty-guide-card 退场与首条新建记录/面板入场',
        en: 'Empty state card .empty-guide-card exit and first record/drawer entrance',
      },
      durationMs: 220,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      reducedMotionFallback: {
        zh: 'prefers-reduced-motion: reduce 时空状态卡与新记录列表 0ms 直接替换',
        en: 'Replace empty guide card with record view in 0ms under prefers-reduced-motion: reduce',
      },
      exampleCode: `.empty-guide-card {
  transition: opacity 220ms cubic-bezier(0.16, 1, 0.3, 1), transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
}`,
    },
  },
  {
    id: 'FILTER_ZERO_RECOVERY',
    groupKey: 'emptyAndLoading',
    refCode: '#ZeroFilter',
    plainTitle: {
      zh: '筛选没结果时，一键清空条件立刻恢复列表',
      en: 'Progressive Filtered Zero-Result Recovery',
    },
    plainDesc: {
      zh: '条件选太严搜不到东西时，清楚列出当前卡住的筛选词，点「一键重置筛选」马上恢复全部业务数据。',
      en: 'Shows active filter chips when a query matches 0 rows and offers a one-click Reset Filters recovery.',
    },
    agentSummary: {
      zh: '筛选零结果提供渐进式条件回退卡片（Zero-Result Filter Recovery，展示当前筛选胶囊并提供一键重置恢复）。',
      en: 'Provide a filtered zero-result state displaying active filter pills and a one-click Reset Filters recovery button.',
    },
    motionSpec: {
      trigger: {
        zh: '组合筛选命中 0 条后，点击「一键清空筛选」按钮 [data-action="reset-filters"]',
        en: 'Click "Reset Filters" button [data-action="reset-filters"] from zero-result view',
      },
      target: {
        zh: '激活筛选胶囊组 .active-filter-chips 与恢复后的表格行列表 tbody',
        en: 'Active filter chip bar .active-filter-chips and restored table rows tbody',
      },
      durationMs: 200,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      reducedMotionFallback: {
        zh: 'prefers-reduced-motion: reduce 时 0ms 清除筛选标签并立即呈现完整列表',
        en: 'Clear filter chips and restore full table rows in 0ms under prefers-reduced-motion: reduce',
      },
      exampleCode: `.restored-row {
  animation: filterRecoverFade 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes filterRecoverFade { from { opacity: 0; } to { opacity: 1; } }`,
    },
  },
];

export const APPROVAL_FEEDBACK_OPTIONS: readonly MotionSchematicDefinition<
  ApprovalFeedbackSchematicId,
  'approvalAndFeedback'
>[] = [
  {
    id: 'STEPPER_CORNER_TOAST',
    groupKey: 'approvalAndFeedback',
    refCode: '#068+#056',
    plainTitle: {
      zh: '连线步进条打勾推进 + 右下角轻提示滑出',
      en: 'Connected Stepper + Non-Blocking Corner Toast',
    },
    plainDesc: {
      zh: '点「审批通过」后，上方进度圆圈顺滑连线打勾，同时右下角滑出一条不挡路的成功提示条自动收起。',
      en: 'Advances a connected lifecycle stepper checkmark and slides a non-blocking corner toast into view.',
    },
    agentSummary: {
      zh: '状态流转与操作反馈采用连线流程步进条 + 右下角轻提示（Connected Stepper + Non-Blocking Corner Toast，零阻塞弹窗）。',
      en: 'Combine a connected lifecycle stepper bar with non-blocking corner toast notifications on state transitions.',
    },
    motionSpec: {
      trigger: {
        zh: '点击审批通过或推进状态按钮 [data-event-id]',
        en: 'Click Approve or state-advance action button [data-event-id]',
      },
      target: {
        zh: '步进进度线 .stepper-progress-fill 与右下角轻提示 .corner-toast',
        en: 'Stepper progress line .stepper-progress-fill and corner notice .corner-toast',
      },
      durationMs: 240,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      reducedMotionFallback: {
        zh: 'prefers-reduced-motion: reduce 时进度节点与角落提示 0ms 直接更新，无滑入位移',
        en: 'Update stepper node and show corner toast in 0ms without slide under prefers-reduced-motion: reduce',
      },
      exampleCode: `.stepper-progress-fill {
  transition: transform 240ms cubic-bezier(0.16, 1, 0.3, 1);
  transform-origin: left center;
}
.corner-toast[data-open="true"] {
  animation: toastSlideUp 240ms cubic-bezier(0.16, 1, 0.3, 1);
}`,
    },
  },
  {
    id: 'INLINE_BANNER_TIMELINE',
    groupKey: 'approvalAndFeedback',
    refCode: '#Timeline',
    plainTitle: {
      zh: '单据顶栏审批横幅 + 审计时间轴留痕展开',
      en: 'Inline Approval Banner + Timeline Audit Trail',
    },
    plainDesc: {
      zh: '单据顶部直接醒目展示待审横幅与签批按钮，批完后自动在下方时间轴追加一条带人名与时间的留痕记录。',
      en: 'Places an inline decision banner at the top of the record and appends a timestamped entry to the audit timeline.',
    },
    agentSummary: {
      zh: '采用单据内嵌审批横幅 + 可追溯审计时间轴（Inline Decision Banner + Audit Trail Timeline，每次流转实时追加留痕）。',
      en: 'Render an inline approval decision banner paired with an append-live chronological audit trail timeline.',
    },
    motionSpec: {
      trigger: {
        zh: '点击内嵌横幅中的批准/驳回按钮 .approval-banner [data-event-id]',
        en: 'Click Approve/Reject inside .approval-banner [data-event-id]',
      },
      target: {
        zh: '顶部审批状态横幅 .approval-banner 与新增时间轴节点 li.timeline-entry-new',
        en: 'Decision banner .approval-banner and appended audit node li.timeline-entry-new',
      },
      durationMs: 220,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      reducedMotionFallback: {
        zh: 'prefers-reduced-motion: reduce 时横幅变色与审计记录追加 0ms 瞬时完成',
        en: 'Update banner status and append audit entry in 0ms under prefers-reduced-motion: reduce',
      },
      exampleCode: `.timeline-entry-new {
  animation: timelineAppend 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes timelineAppend {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}`,
    },
  },
  {
    id: 'DUAL_SIGNOFF_PULSE',
    groupKey: 'approvalAndFeedback',
    refCode: '#SignOff',
    plainTitle: {
      zh: '双人会签复核面板 + 状态标签柔和点亮',
      en: 'Dual-Sign-Off Drawer + Status Badge Pulse',
    },
    plainDesc: {
      zh: '针对风控/大额业务，清晰展示「业务初审 ✓ → 财务复核 ✓」双签进度，签完状态胶囊温和点亮为已生效。',
      en: 'Shows multi-role countersign slots (Primary + Risk/Finance) and illuminates the status badge upon final sign-off.',
    },
    agentSummary: {
      zh: '关键流转采用多角色会签复核面板 + 状态胶囊确认点亮（Dual Sign-Off Panel + Status Pill Confirmation）。',
      en: 'Provide a dual-role countersign panel with explicit sign-off slots and a status badge transition on completion.',
    },
    motionSpec: {
      trigger: {
        zh: '点击复核会签确认按钮 [data-action="confirm-signoff"]',
        en: 'Click countersign confirmation button [data-action="confirm-signoff"]',
      },
      target: {
        zh: '会签角色槽位 .signoff-slot[data-signed="true"] 与单据状态胶囊 .status-pill',
        en: 'Countersign role slot .signoff-slot[data-signed="true"] and record .status-pill',
      },
      durationMs: 250,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      reducedMotionFallback: {
        zh: 'prefers-reduced-motion: reduce 时禁用状态徽标光晕脉动，0ms 直接切换为已生效标签',
        en: 'Disable badge glow pulse and switch status pill to Approved in 0ms under prefers-reduced-motion: reduce',
      },
      exampleCode: `.status-pill[data-status="APPROVED"] {
  transition: background-color 250ms cubic-bezier(0.16, 1, 0.3, 1), color 250ms ease;
}`,
    },
  },
];

export const MOTION_SCHEMATIC_GROUPS: readonly MotionSchematicGroup[] = [
  {
    key: 'detailOpen',
    index: 1,
    title: {
      zh: '详情打开方式',
      en: 'Detail Open Mode',
    },
    promptQuestion: {
      zh: '点「新建 / 查看详情」时，页面怎么打开？',
      en: 'How should Create & Record Details open?',
    },
    options: DETAIL_OPEN_OPTIONS,
  },
  {
    key: 'informationDensity',
    index: 2,
    title: {
      zh: '信息密度',
      en: 'Information Density',
    },
    promptQuestion: {
      zh: '页面上的数据排布想要紧凑台账、标准均衡，还是宽松卡片？',
      en: 'How dense should tables, metrics, and cards feel?',
    },
    options: INFORMATION_DENSITY_OPTIONS,
  },
  {
    key: 'navigationStructure',
    index: 3,
    title: {
      zh: '导航结构',
      en: 'Navigation Structure',
    },
    promptQuestion: {
      zh: '用户在不同业务模块之间怎么切换导航？',
      en: 'How should users navigate across modules and screens?',
    },
    options: NAVIGATION_STRUCTURE_OPTIONS,
  },
  {
    key: 'tableRowActions',
    index: 4,
    title: {
      zh: '表格行操作',
      en: 'Table Row Actions',
    },
    promptQuestion: {
      zh: '在列表里处理单条或多条业务记录时怎么操作最顺手？',
      en: 'How should single-row and multi-row table actions work?',
    },
    options: TABLE_ROW_ACTION_OPTIONS,
  },
  {
    key: 'formValidationSave',
    index: 5,
    title: {
      zh: '表单校验与保存',
      en: 'Form Validation & Save',
    },
    promptQuestion: {
      zh: '填写业务表单时，规则校验和保存反馈怎么配合？',
      en: 'How should form rules validate and save progress?',
    },
    options: FORM_VALIDATION_SAVE_OPTIONS,
  },
  {
    key: 'emptyAndLoading',
    index: 6,
    title: {
      zh: '空状态与加载',
      en: 'Empty State & Loading',
    },
    promptQuestion: {
      zh: '数据加载中、暂无记录或筛选无结果时怎么过渡和引导？',
      en: 'How should loading states and empty results guide the user?',
    },
    options: EMPTY_LOADING_OPTIONS,
  },
  {
    key: 'approvalAndFeedback',
    index: 7,
    title: {
      zh: '审批与状态流转及反馈',
      en: 'Approval, State Flow & Feedback',
    },
    promptQuestion: {
      zh: '审批放行、状态推进与操作成功提示怎么呈现？',
      en: 'How should approvals, status transitions, and feedback appear?',
    },
    options: APPROVAL_FEEDBACK_OPTIONS,
  },
];

export const ALL_MOTION_SCHEMATICS: readonly MotionSchematicDefinition[] =
  MOTION_SCHEMATIC_GROUPS.flatMap((group) => group.options);

export const MOTION_SCHEMATICS_BY_ID: Readonly<
  Record<MotionSchematicId, MotionSchematicDefinition>
> = Object.fromEntries(
  ALL_MOTION_SCHEMATICS.map((item) => [item.id, item]),
) as Record<MotionSchematicId, MotionSchematicDefinition>;

export function getMotionSchematicById(id: MotionSchematicId): MotionSchematicDefinition {
  return MOTION_SCHEMATICS_BY_ID[id];
}

export interface MotionDomainNouns {
  primaryEntity: BilingualText;
  secondaryEntity: BilingualText;
  createAction: BilingualText;
  approveAction: BilingualText;
  primaryField: BilingualText;
  sampleRecordCode: string;
  departmentOrScope: BilingualText;
}

export const DEFAULT_DOMAIN_NOUNS: MotionDomainNouns = {
  primaryEntity: { zh: '业务单据', en: 'Business Record' },
  secondaryEntity: { zh: '执行明细', en: 'Line Item' },
  createAction: { zh: '新建业务单据', en: 'New Business Record' },
  approveAction: { zh: '审批业务单据', en: 'Approve Business Record' },
  primaryField: { zh: '业务金额', en: 'Amount' },
  sampleRecordCode: 'REC-2026-018',
  departmentOrScope: { zh: '业务运营中心', en: 'Operations Hub' },
};

export type MotionSrsProjectContext = Pick<ProjectDetail, 'name' | 'domain' | 'suite'>;

const KNOWN_ZH_TO_EN_NOUNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/采购合同/, 'Purchase Contract'],
  [/销售合同/, 'Sales Contract'],
  [/合同/, 'Contract'],
  [/付款里程碑/, 'Payment Milestone'],
  [/里程碑/, 'Milestone'],
  [/冷链运单/, 'Cold Chain Waybill'],
  [/运单/, 'Waybill'],
  [/采购订单/, 'Purchase Order'],
  [/销售订单/, 'Sales Order'],
  [/订单/, 'Order'],
  [/巡检工单|维修工单|服务工单|工单/, 'Work Order'],
  [/费用报销单|报销单/, 'Expense Claim'],
  [/对账结算单|结算单/, 'Settlement Sheet'],
  [/供应商/, 'Supplier'],
  [/客户线索|商机|线索/, 'Sales Lead'],
  [/出入库单|入库单|出库单/, 'Inventory Slip'],
  [/临床方案|试验方案/, 'Clinical Protocol'],
  [/设备资产|固定资产|资产/, 'Asset'],
];

function pascalToWords(raw: string): string {
  const cleaned = raw.trim();
  if (!cleaned) return '';
  if (/\s/.test(cleaned)) return cleaned;
  return cleaned
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function inferEnglishFromZh(zh: string): string {
  for (const [pattern, en] of KNOWN_ZH_TO_EN_NOUNS) {
    if (pattern.test(zh)) return en;
  }
  return 'Domain Record';
}

function inferRecordPrefix(enLabel: string): string {
  const words = enLabel
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'REC';
  const lastWord = words[words.length - 1]!;
  return lastWord.slice(0, 3).padEnd(3, 'X');
}

function cleanZhCandidate(raw: string): string {
  return raw
    .replace(/^[\s#*>-]+/, '')
    .replace(/^(核心业务|业务范围|核心对象|管理|支持|包含|新建|创建|维护|处理|审批|围绕)+/, '')
    .trim();
}

export function extractDomainNounsFromSrs(
  srsMarkdown?: string,
  project?: MotionSrsProjectContext | null,
): MotionDomainNouns {
  const text = (srsMarkdown ?? '').trim();
  const extractedPairs: BilingualText[] = [];
  const seenZh = new Set<string>();

  const pushPair = (zhRaw: string, enRaw?: string) => {
    const zh = cleanZhCandidate(zhRaw);
    if (!zh || zh.length < 2 || zh.length > 14 || seenZh.has(zh)) return;
    if (/^(系统|平台|模块|功能|页面|列表|用户|说明|范围|背景|目标|规则|流程)$/.test(zh)) {
      return;
    }
    seenZh.add(zh);
    const en = enRaw?.trim() ? pascalToWords(enRaw) : inferEnglishFromZh(zh);
    extractedPairs.push({ zh, en });
  };

  if (text) {
    // 1. Explicit bilingual pairs such as **采购合同**（Purchase Contract） or 采购合同 (Purchase Contract)
    const bilingualRegex =
      /(?:\*\*([^*（()\n]{2,14})\*\*|([\u4e00-\u9fa5]{2,12}))\s*[（(]\s*([A-Za-z][A-Za-z0-9\s_-]{2,36})\s*[)）]/g;
    for (const match of text.matchAll(bilingualRegex)) {
      const zh = match[1] || match[2] || '';
      const en = match[3] || '';
      pushPair(zh, en);
    }

    // 2. Bold Chinese domain nouns **采购合同**
    const boldZhRegex = /\*\*([\u4e00-\u9fa5]{2,12})\*\*/g;
    for (const match of text.matchAll(boldZhRegex)) {
      pushPair(match[1] || '');
    }

    // 3. Domain-suffixed Chinese nouns in prose
    const domainNounRegex =
      /([\u4e00-\u9fa5]{1,6}(?:合同|里程碑|运单|订单|工单|报销单|结算单|申请单|出入库单|入库单|出库单|供应商|商机|线索|台账|协议|档案|资产|批次))/g;
    for (const match of text.matchAll(domainNounRegex)) {
      pushPair(match[1] || '');
    }

    // 4. English-only SRS noun phrases (e.g. "Procurement Contract", "Payment Milestone")
    if (extractedPairs.length === 0) {
      const enDomainRegex =
        /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:Contract|Milestone|Order|Waybill|Claim|Invoice|Asset|Lead|Protocol|Ticket|Shipment))\b/g;
      for (const match of text.matchAll(enDomainRegex)) {
        const enPhrase = match[1]!.trim();
        if (!extractedPairs.some((p) => p.en.toLowerCase() === enPhrase.toLowerCase())) {
          extractedPairs.push({ zh: enPhrase, en: enPhrase });
        }
      }
    }
  }

  // 5. Fallback/enrichment from Ontology Project M1 aggregates & sub-entities
  const aggregates = project?.suite?.M1?.aggregates ?? [];
  for (const agg of aggregates) {
    const zh = agg.alias?.trim() || agg.name.trim();
    const en = pascalToWords(agg.name) || inferEnglishFromZh(zh);
    pushPair(zh, en);
    for (const ent of agg.entities ?? []) {
      const entZh = ent.alias?.trim() || ent.name.trim();
      const entEn = pascalToWords(ent.name) || inferEnglishFromZh(entZh);
      pushPair(entZh, entEn);
    }
  }

  // 6. Fallback from project name if non-generic
  if (extractedPairs.length === 0 && project?.name) {
    const projNounMatch = project.name.match(
      /([\u4e00-\u9fa5]{2,8}(?:合同|里程碑|运单|订单|工单|报销|结算|资产|线索))/,
    );
    if (projNounMatch?.[1]) {
      pushPair(projNounMatch[1]);
    }
  }

  const primary = extractedPairs[0] ?? DEFAULT_DOMAIN_NOUNS.primaryEntity;
  const secondary =
    extractedPairs[1] ??
    (extractedPairs.length > 0
      ? { zh: `${primary.zh}明细`, en: `${primary.en} Item` }
      : DEFAULT_DOMAIN_NOUNS.secondaryEntity);

  const prefix =
    extractedPairs.length > 0 ? inferRecordPrefix(primary.en) : 'REC';

  return {
    primaryEntity: primary,
    secondaryEntity: secondary,
    createAction: {
      zh: `新建${primary.zh}`,
      en: `New ${primary.en}`,
    },
    approveAction: {
      zh: `审批${primary.zh}`,
      en: `Approve ${primary.en}`,
    },
    primaryField:
      /合同|订单|结算|报销|付款|contract|order|payment|claim|invoice/i.test(
        `${primary.zh} ${primary.en}`,
      )
        ? { zh: '合同金额', en: 'Contract Amount' }
        : DEFAULT_DOMAIN_NOUNS.primaryField,
    sampleRecordCode: `${prefix}-2026-018`,
    departmentOrScope: project?.name?.trim()
      ? { zh: project.name.trim(), en: pascalToWords(project.domain || 'Operations Hub') }
      : DEFAULT_DOMAIN_NOUNS.departmentOrScope,
  };
}

export function inferDefaultMotionSelectionFromSrs(
  srsMarkdown?: string,
  project?: MotionSrsProjectContext | null,
): MotionSchematicSelection {
  const corpus = [
    srsMarkdown ?? '',
    project?.name ?? '',
    project?.domain ?? '',
    ...(project?.suite?.M1?.aggregates?.map((a) => `${a.name} ${a.alias ?? ''}`) ?? []),
  ]
    .join('\n')
    .trim();

  if (!corpus) {
    return { ...DEFAULT_MOTION_SELECTION };
  }

  const detailOpen: DetailOpenSchematicId =
    /长表单|多栏表单|整页编辑|独立页签|宽幅表单|full-page form|dedicated tab|multi-column form/i.test(
      corpus,
    )
      ? 'DEDICATED_TAB'
      : /左右分栏|同屏对照|主从联动|主从分栏|side-by-side|master-detail|split pane|inline split/i.test(
            corpus,
          )
        ? 'INLINE_SPLIT'
        : /模态弹窗|居中弹窗|快捷弹窗|modal dialog|quick modal|centered modal/i.test(corpus)
          ? 'MODAL'
          : 'DRAWER';

  const informationDensity: InformationDensitySchematicId =
    /卡片墙|画廊|分组卡片|创意展示|bento|card grid|visual showcase|modular card/i.test(corpus)
      ? 'MODULAR_CARDS'
      : /台账|对账|财务|清算|高频|核算|海量明细|ledger|reconciliation|high-volume|dense table/i.test(
            corpus,
          )
        ? 'COMPACT_LEDGER'
        : 'BALANCED_WORKSPACE';

  const navigationStructure: NavigationStructureSchematicId =
    /多中心|多业务域|子系统|集团|多空间切换|multi-domain|multi-workspace|dual-rail|dual rail/i.test(
      corpus,
    )
      ? 'DUAL_RAIL_SWITCHER'
      : /轻量门户|简洁门户|顶部导航|无侧栏|lightweight portal|top bar|segmented hub/i.test(corpus)
        ? 'TOP_SEGMENTED_HUB'
        : 'COLLAPSIBLE_RAIL';

  const tableRowActions: TableRowActionSchematicId =
    /批量审批|批量导出|批量派单|多选|批处理|batch|bulk action|multi-select/i.test(corpus)
      ? 'BATCH_FLOATING_BAR'
      : /行内编辑|即点即改|原地修改|单元格直接改|inline edit|in-place edit|quick status/i.test(
            corpus,
          )
        ? 'INLINE_QUICK_EDIT'
        : 'HOVER_ACTION_BAR';

  const formValidationSave: FormValidationSaveSchematicId =
    /分步|向导|分段校验|逐节预检|步骤一|wizard|multi-step|step-by-step/i.test(corpus)
      ? 'STEP_SECTION_PRECHECK'
      : /自动保存|草稿暂存|自动暂存|autosave|auto-save|draft/i.test(corpus)
        ? 'AUTOSAVE_DRAFT_BADGE'
        : 'REALTIME_STICKY_SAVE';

  const emptyAndLoading: EmptyLoadingSchematicId =
    /多维筛选|组合查询|高级检索|零结果恢复|faceted|complex filter|zero-result/i.test(corpus)
      ? 'FILTER_ZERO_RECOVERY'
      : /新手引导|首次创建|首单引导|零数据引导|onboarding|first-time|empty guide/i.test(corpus)
        ? 'GUIDED_EMPTY_CARD'
        : 'SKELETON_SHIMMER';

  const approvalAndFeedback: ApprovalFeedbackSchematicId =
    /会签|双人复核|二次签批|法务复核|风控复核|四眼原则|dual sign-off|countersign|four-eyes/i.test(
      corpus,
    )
      ? 'DUAL_SIGNOFF_PULSE'
      : /审计轨迹|留痕|变更历史|时间轴|audit trail|timeline|history log/i.test(corpus)
        ? 'INLINE_BANNER_TIMELINE'
        : 'STEPPER_CORNER_TOAST';

  return {
    detailOpen,
    informationDensity,
    navigationStructure,
    tableRowActions,
    formValidationSave,
    emptyAndLoading,
    approvalAndFeedback,
  };
}

export interface LegacyAlignmentCompatInput extends Partial<MotionSchematicSelection> {
  entryPattern?: DetailOpenSchematicId;
  layoutDensity?: 'COMPACT_LEDGER' | 'MODULAR_CARDS' | InformationDensitySchematicId;
}

export function resolveMotionSelection(
  input?: LegacyAlignmentCompatInput | null,
): MotionSchematicSelection {
  if (!input) {
    return { ...DEFAULT_MOTION_SELECTION };
  }
  return {
    detailOpen: input.detailOpen ?? input.entryPattern ?? DEFAULT_MOTION_SELECTION.detailOpen,
    informationDensity:
      input.informationDensity ??
      input.layoutDensity ??
      DEFAULT_MOTION_SELECTION.informationDensity,
    navigationStructure:
      input.navigationStructure ?? DEFAULT_MOTION_SELECTION.navigationStructure,
    tableRowActions: input.tableRowActions ?? DEFAULT_MOTION_SELECTION.tableRowActions,
    formValidationSave:
      input.formValidationSave ?? DEFAULT_MOTION_SELECTION.formValidationSave,
    emptyAndLoading: input.emptyAndLoading ?? DEFAULT_MOTION_SELECTION.emptyAndLoading,
    approvalAndFeedback:
      input.approvalAndFeedback ?? DEFAULT_MOTION_SELECTION.approvalAndFeedback,
  };
}

export function formatMotionSpecsForAgentPrompt(
  selectionInput: LegacyAlignmentCompatInput | MotionSchematicSelection,
  locale: 'zh-CN' | 'en-US' = 'zh-CN',
): string {
  const resolved = resolveMotionSelection(selectionInput);

  if (locale === 'en-US') {
    const blocks = MOTION_SCHEMATIC_GROUPS.map((group) => {
      const selectedId = resolved[group.key];
      const item = MOTION_SCHEMATICS_BY_ID[selectedId];
      const spec = item.motionSpec;
      return [
        `### ${group.index}. ${group.title.en}: ${item.plainTitle.en} (${item.refCode})`,
        `- Behavioral Intent: ${item.agentSummary.en}`,
        `- [MUST SATISFY / 硬性约束] Motion Spec:`,
        `  - Trigger: ${spec.trigger.en}`,
        `  - Target: ${spec.target.en}`,
        `  - Duration: ${spec.durationMs}ms`,
        `  - Easing: ${spec.easing}`,
        `  - Reduced-Motion Fallback (prefers-reduced-motion: reduce): ${spec.reducedMotionFallback.en}`,
        `- [ADAPTIVE EXAMPLE / 示例代码（可按页面结构改写）] Reference Code:`,
        '```css',
        spec.exampleCode.trim(),
        '```',
      ].join('\n');
    });

    return [
      '=== MOTION SCHEMATICS & INTERACTION SPECIFICATIONS (7 GROUPS) ===',
      'Contract: Every Motion Spec block below is a hard constraint that you MUST SATISFY (trigger, target, duration, easing, and reduced-motion fallback). Every code snippet is an ADAPTIVE EXAMPLE that you may adapt to fit the page DOM and semantic anchors.',
      '',
      ...blocks,
    ].join('\n\n');
  }

  const blocks = MOTION_SCHEMATIC_GROUPS.map((group) => {
    const selectedId = resolved[group.key];
    const item = MOTION_SCHEMATICS_BY_ID[selectedId];
    const spec = item.motionSpec;
    return [
      `### ${group.index}. ${group.title.zh}：${item.plainTitle.zh}（${item.refCode}）`,
      `- 交互语义：${item.agentSummary.zh}`,
      `- [硬性约束 / MUST SATISFY] 动效规格：`,
      `  - 触发（Trigger）：${spec.trigger.zh}`,
      `  - 对象（Target）：${spec.target.zh}`,
      `  - 时长（Duration）：${spec.durationMs}ms`,
      `  - 缓动（Easing）：${spec.easing}`,
      `  - 减少动态效果兜底（prefers-reduced-motion: reduce）：${spec.reducedMotionFallback.zh}`,
      `- [示例代码（可按页面结构改写） / ADAPTIVE EXAMPLE] 参考代码：`,
      '```css',
      spec.exampleCode.trim(),
      '```',
    ].join('\n');
  });

  return [
    '【动态示意与动效规格契约（共 7 组）】',
    '契约说明：下方每组的「动效规格」均为必须满足的硬性约束（触发、作用对象、时长、缓动及 prefers-reduced-motion 兜底）；每组附带的代码片段仅为示例代码，Agent 可结合实际页面 DOM 与语义锚点按需改写。',
    '',
    ...blocks,
  ].join('\n\n');
}


