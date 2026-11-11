import React, { useState } from 'react';
import { Check, Pause, Play, Sparkles } from 'lucide-react';
import { Button } from '../beautifui/index.js';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';

export type EntrySchematicId = 'DRAWER' | 'MODAL' | 'INLINE_SPLIT' | 'DEDICATED_TAB';
export type DensitySchematicId = 'COMPACT_LEDGER' | 'MODULAR_CARDS';
export type InteractivePartId =
  | 'KPI_COUNT_UP'
  | 'FILTER_CHIPS'
  | 'ACCORDION'
  | 'STEP_INDICATOR';
export type FeedbackMotionId = 'TOAST' | 'SKELETON' | 'SUBTLE_MOTION';

export type SchematicSceneId =
  | EntrySchematicId
  | DensitySchematicId
  | InteractivePartId
  | FeedbackMotionId;

export interface RequirementAlignmentState {
  entryPattern: EntrySchematicId;
  layoutDensity: DensitySchematicId;
  interactiveParts: InteractivePartId[];
  feedbackMotions: FeedbackMotionId[];
  customNotes: string[];
}

export const DEFAULT_ALIGNMENT_STATE: RequirementAlignmentState = {
  entryPattern: 'DRAWER',
  layoutDensity: 'COMPACT_LEDGER',
  interactiveParts: ['KPI_COUNT_UP', 'FILTER_CHIPS', 'STEP_INDICATOR'],
  feedbackMotions: ['TOAST', 'SUBTLE_MOTION'],
  customNotes: [],
};

interface SchematicCardMeta<T extends SchematicSceneId> {
  id: T;
  refCode: string;
  plainTitleZh: string;
  plainTitleEn: string;
  plainDescZh: string;
  plainDescEn: string;
  agentSpecZh: string;
  agentSpecEn: string;
}

export const ENTRY_SCHEMATICS: SchematicCardMeta<EntrySchematicId>[] = [
  {
    id: 'DRAWER',
    refCode: '#050 Drawer',
    plainTitleZh: '从右侧滑出一层录入面板',
    plainTitleEn: 'Slide-in Side Panel',
    plainDescZh: '点「新建」后右侧滑出表单，背后的列表不消失，方便边对照旧数据边填写。',
    plainDescEn: 'Clicking "New" slides a panel in from the right while keeping the table visible behind.',
    agentSpecZh: '新建与编辑采用右侧滑出面板（Off-canvas Drawer，背景微暗保留列表上下文，支持点击遮罩收起）。',
    agentSpecEn: 'Open Create/Edit inside a right slide-over drawer keeping the background table in context.',
  },
  {
    id: 'MODAL',
    refCode: '#049 Modal',
    plainTitleZh: '屏幕正中间弹出专注小窗',
    plainTitleEn: 'Centered Focus Window',
    plainDescZh: '四周背景变暗，屏幕中央弹出小窗口，让人集中注意力把这一单填完再回来。',
    plainDescEn: 'Dims the page and scales up a centered window so the user focuses on completing one action.',
    agentSpecZh: '新建与关键确认采用屏幕居中模态弹窗（Modal Dialog，背景柔和变暗，微缩放弹入，支持关闭按钮与遮罩收起）。',
    agentSpecEn: 'Open Create/Confirm inside a centered modal window with dimmed backdrop and subtle scale-in.',
  },
  {
    id: 'INLINE_SPLIT',
    refCode: '#Split',
    plainTitleZh: '左边看表、右边常驻填单',
    plainTitleEn: 'Side-by-Side Table & Form',
    plainDescZh: '屏幕分成左右两半，左边点哪行右边就联动哪行，不用反复开关窗口，适合连续快速处理。',
    plainDescEn: 'Left list and right form stay side by side on one screen for rapid continuous entry.',
    agentSpecZh: '采用同屏左右双栏联办布局（Master-Detail Inline Split，左侧数据列表，右侧常驻新建/详情编辑面板实时联动）。',
    agentSpecEn: 'Use a persistent side-by-side master-detail split layout with table on the left and live form on the right.',
  },
  {
    id: 'DEDICATED_TAB',
    refCode: '#057 Tabs',
    plainTitleZh: '顶部平滑切换到整张新页面',
    plainTitleEn: 'Full-Width Switched Page',
    plainDescZh: '点顶部标签滑块直接切换到一整张宽敞的新页面，适合填写内容特别多的长表单。',
    plainDescEn: 'Glides a top highlight across to swap the whole area into a spacious multi-column form.',
    agentSpecZh: '采用顶部滑动指示器切换独立宽幅视图（Segmented/Underline Tabs，列表页与多列宽表单页整屏切换）。',
    agentSpecEn: 'Switch between full-width list and spacious multi-column form screens via sliding top tabs.',
  },
];

export const DENSITY_SCHEMATICS: SchematicCardMeta<DensitySchematicId>[] = [
  {
    id: 'COMPACT_LEDGER',
    refCode: '#Ledger',
    plainTitleZh: '像账单一样紧凑对齐的多行表',
    plainTitleEn: 'Crisp Multi-Row Ledger',
    plainDescZh: '细分割线对齐每一列，一屏能看十几条业务记录，鼠标移过哪行哪行亮起。',
    plainDescEn: 'Crisp row dividers and aligned columns fit many records per screen with clear row hover.',
    agentSpecZh: '数据区采用紧凑高密度台账表格（8px~10px 单元格内边距、精细分割线、数字等宽对齐、悬停高亮行）。',
    agentSpecEn: 'Use a high-density enterprise ledger table with tabular numbers, crisp hairlines, and row hover highlight.',
  },
  {
    id: 'MODULAR_CARDS',
    refCode: '#081 Hover Lift',
    plainTitleZh: '宽松留白的分块圆角卡片',
    plainTitleEn: 'Spacious Modular Cards',
    plainDescZh: '信息装进一个个宽松的圆角卡片里，鼠标移上去卡片轻轻浮起，重点一眼看清。',
    plainDescEn: 'Generous breathing room between rounded cards that lift softly under the pointer.',
    agentSpecZh: '数据与模块采用宽松分块圆角卡片布局（Bento/Modular Cards，充足留白间距，悬停轻微上浮 translateY(-3px) 与柔和阴影）。',
    agentSpecEn: 'Organize sections and records in spacious rounded modular cards with subtle hover lift and soft shadow.',
  },
];

export const INTERACTIVE_PART_SCHEMATICS: SchematicCardMeta<InteractivePartId>[] = [
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
    plainDescZh: '不用点开下拉框找半天，直接点「待审批」「高金额」胶囊按钮就筛出对应记录。',
    plainDescEn: 'Click pill chips directly to filter matching rows with a checkmark toggle.',
    agentSpecZh: '列表工具栏提供可多选/单选胶囊快筛标签（Filter Chips，点选打勾变主题色并实时过滤列表行）。',
    agentSpecEn: 'Provide clickable filter pill chips above the list that highlight with a check and filter rows live.',
  },
  {
    id: 'ACCORDION',
    refCode: '#052 Accordion',
    plainTitleZh: '次要详情先收起，点一下再展开',
    plainTitleEn: 'Expandable Detail Rows',
    plainDescZh: '把长备注、规则明细或操作历史折叠收好，页面干干净净，需要看哪条点哪条展开。',
    plainDescEn: 'Keeps secondary details tucked away; clicking a row smoothly expands its hidden breakdown.',
    agentSpecZh: '单据附加明细与规则说明支持手风琴折叠展开（Accordion，点击平滑展开补充字段与审计轨迹，再点收起）。',
    agentSpecEn: 'Support expandable accordion sections/rows to reveal secondary details and rule audit logs on click.',
  },
  {
    id: 'STEP_INDICATOR',
    refCode: '#068 Stepper',
    plainTitleZh: '清晰的「第1步→第2步→审批」进度条',
    plainTitleEn: 'Step-by-Step Flow & Approval',
    plainDescZh: '把业务进展画成连线圆圈进度条，走到哪一步就打勾推进，含主管审核放行页面。',
    plainDescEn: 'Visualizes lifecycle stages as connected step circles that check off as items are approved.',
    agentSpecZh: '内置可视化流程步进条与主管待办审批流转屏幕（Step Indicator + Approval Screen，点击推进圆圈打勾并延伸进度线）。',
    agentSpecEn: 'Include a connected step-progress indicator bar and a dedicated approval workflow screen.',
  },
];

export const FEEDBACK_MOTION_SCHEMATICS: SchematicCardMeta<FeedbackMotionId>[] = [
  {
    id: 'TOAST',
    refCode: '#056 Toast',
    plainTitleZh: '角落滑出不挡路的操作提示条',
    plainTitleEn: 'Non-Blocking Corner Notice',
    plainDescZh: '保存成功或金额填错时，右下角滑出一条带倒计时进度的小提示，几秒后自动收起，绝不弹窗卡人。',
    plainDescEn: 'Slides a sleek notice with a timer bar into the corner on save or validation, auto-dismissing.',
    agentSpecZh: '操作成功与规则拦截采用角落滑入轻提示（Toast Notification，带底部倒计时进度条自动消失，零阻塞弹窗）。',
    agentSpecEn: 'Show non-blocking slide-in corner toast notifications with an auto-dismiss countdown bar.',
  },
  {
    id: 'SKELETON',
    refCode: '#069 Skeleton',
    plainTitleZh: '刷新数据时显示柔和流光占位条',
    plainTitleEn: 'Shimmer Loading Placeholders',
    plainDescZh: '点查询或刷新列表时，先闪过一道柔和的流光灰色条，再平滑浮现真实数据，不生硬闪白。',
    plainDescEn: 'Sweeps a gentle light shine across placeholder blocks during refresh before revealing data.',
    agentSpecZh: '点击检索/刷新时提供流光骨架屏过渡（Skeleton Shimmer，短促光带扫过占位块后平滑呈现最新结果）。',
    agentSpecEn: 'Display a brief skeleton shimmer placeholder sweep when refreshing or querying records.',
  },
  {
    id: 'SUBTLE_MOTION',
    refCode: '#002 Stagger',
    plainTitleZh: '模块依次轻柔浮现的顺滑感',
    plainTitleEn: 'Gentle Staggered Entrance',
    plainDescZh: '切换页面时，卡片和表格行像呼吸一样从左到右依次轻轻浮起，让界面更有灵气。',
    plainDescEn: 'Cards and rows glide upward into place one right after another with smooth easing.',
    agentSpecZh: '屏幕切换与卡片入场采用轻柔错峰渐入动效（Staggered Fade-up 180ms~260ms ease-out，尊重 prefers-reduced-motion）。',
    agentSpecEn: 'Apply subtle staggered fade-up transitions on screen switch and cards, honoring prefers-reduced-motion.',
  },
];

export function describeAlignmentForAgent(
  alignment: RequirementAlignmentState,
  locale: 'zh-CN' | 'en-US' = 'zh-CN',
): string[] {
  const lines: string[] = [];
  const entry = ENTRY_SCHEMATICS.find((e) => e.id === alignment.entryPattern);
  const density = DENSITY_SCHEMATICS.find((d) => d.id === alignment.layoutDensity);
  if (entry) {
    lines.push(locale === 'en-US' ? entry.agentSpecEn : entry.agentSpecZh);
  }
  if (density) {
    lines.push(locale === 'en-US' ? density.agentSpecEn : density.agentSpecZh);
  }
  for (const pid of alignment.interactiveParts) {
    const found = INTERACTIVE_PART_SCHEMATICS.find((x) => x.id === pid);
    if (found) lines.push(locale === 'en-US' ? found.agentSpecEn : found.agentSpecZh);
  }
  for (const fid of alignment.feedbackMotions) {
    const found = FEEDBACK_MOTION_SCHEMATICS.find((x) => x.id === fid);
    if (found) lines.push(locale === 'en-US' ? found.agentSpecEn : found.agentSpecZh);
  }
  for (const note of alignment.customNotes) {
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

/**
 * Renders a self-explanatory looping miniature SVG schematic scene (220×138)
 * inspired by https://showheyohtaki.github.io/motion-prompt/.
 */
export function MotionSchematicStage({
  scene,
  accentColor = '#38bdf8',
}: {
  scene: SchematicSceneId;
  accentColor?: string;
}) {
  const accent = accentColor || '#38bdf8';

  return (
    <div className="mp-stage-frame" aria-hidden="true">
      <svg
        viewBox="0 0 220 138"
        className="mp-stage-svg"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Subtle blueprint frame background */}
        <rect x="12" y="10" width="196" height="118" rx="8" fill="#162240" stroke="#283a63" strokeWidth="1" />

        {scene === 'DRAWER' && (
          <>
            {/* Top header + New button */}
            <rect x="22" y="20" width="54" height="7" rx="3.5" fill="#94a3b8" opacity="0.7" />
            <rect x="160" y="18" width="38" height="12" rx="4" fill={accent} />
            {/* Underlying table rows */}
            {[40, 58, 76, 94].map((y, idx) => (
              <g key={y} opacity={0.65 - idx * 0.08}>
                <rect x="22" y={y} width="174" height="11" rx="3" fill="#1f3056" />
                <rect x="27" y={y + 3.5} width="36" height="4" rx="2" fill="#cbd5e1" />
                <rect x="74" y={y + 3.5} width="64" height="4" rx="2" fill="#64748b" />
              </g>
            ))}
            {/* Dimmed backdrop */}
            <rect
              x="12"
              y="10"
              width="196"
              height="118"
              rx="8"
              fill="#060b19"
              style={{ animation: 'mp-backdrop-dim 4.2s ease-in-out infinite' }}
            />
            {/* Sliding right drawer */}
            <g style={{ animation: 'mp-drawer-slide 4.2s cubic-bezier(0.22, 1, 0.36, 1) infinite' }}>
              <rect x="122" y="11" width="85" height="116" rx="7" fill="#f8fafc" stroke={accent} strokeWidth="1.5" />
              <rect x="131" y="21" width="44" height="6" rx="3" fill="#0f172a" />
              <rect x="131" y="36" width="66" height="13" rx="3" fill="#e2e8f0" />
              <rect x="131" y="55" width="66" height="13" rx="3" fill="#e2e8f0" />
              <rect x="131" y="74" width="46" height="13" rx="3" fill="#e2e8f0" />
              <rect x="131" y="102" width="66" height="14" rx="4" fill={accent} />
            </g>
            {/* Cursor dot */}
            <circle
              cx="179"
              cy="24"
              r="5"
              fill="#ffffff"
              stroke="#0f172a"
              strokeWidth="1.5"
              style={{ animation: 'mp-cursor-click 4.2s ease-in-out infinite' }}
            />
          </>
        )}

        {scene === 'MODAL' && (
          <>
            <rect x="22" y="20" width="60" height="7" rx="3.5" fill="#94a3b8" opacity="0.65" />
            <rect x="162" y="18" width="36" height="11" rx="4" fill={accent} opacity="0.85" />
            {[40, 58, 76, 94].map((y) => (
              <rect key={y} x="22" y={y} width="176" height="11" rx="3" fill="#1f3056" opacity="0.6" />
            ))}
            <rect
              x="12"
              y="10"
              width="196"
              height="118"
              rx="8"
              fill="#050914"
              style={{ animation: 'mp-backdrop-dim 4s ease-in-out infinite' }}
            />
            <g
              style={{
                transformOrigin: '110px 69px',
                animation: 'mp-modal-pop 4s cubic-bezier(0.22, 1, 0.36, 1) infinite',
              }}
            >
              <rect x="52" y="28" width="116" height="82" rx="8" fill="#f8fafc" stroke={accent} strokeWidth="1.5" />
              <rect x="64" y="39" width="56" height="6" rx="3" fill="#0f172a" />
              <circle cx="155" cy="42" r="4" fill="#cbd5e1" />
              <rect x="64" y="53" width="92" height="12" rx="3" fill="#e2e8f0" />
              <rect x="64" y="70" width="92" height="12" rx="3" fill="#e2e8f0" />
              <rect x="64" y="90" width="42" height="12" rx="4" fill="#cbd5e1" />
              <rect x="112" y="90" width="44" height="12" rx="4" fill={accent} />
            </g>
          </>
        )}

        {scene === 'INLINE_SPLIT' && (
          <>
            {/* Left Master Table */}
            <rect x="20" y="20" width="92" height="98" rx="6" fill="#1c2c50" stroke="#314776" />
            {/* Moving Active Row Indicator */}
            <rect
              x="25"
              y="34"
              width="82"
              height="15"
              rx="4"
              fill={accent}
              opacity="0.32"
              stroke={accent}
              style={{ animation: 'mp-split-row 4.5s ease-in-out infinite' }}
            />
            {[38, 58, 78].map((y) => (
              <g key={y}>
                <rect x="30" y={y} width="32" height="6" rx="3" fill="#e2e8f0" />
                <rect x="68" y={y} width="32" height="6" rx="3" fill="#94a3b8" opacity="0.65" />
              </g>
            ))}
            {/* Right Synchronized Form Pane */}
            <rect x="118" y="20" width="82" height="98" rx="6" fill="#f8fafc" />
            <g
              style={{
                transformOrigin: '126px 60px',
                animation: 'mp-split-detail 4.5s ease-in-out infinite',
              }}
            >
              <rect x="126" y="30" width="48" height="6" rx="3" fill="#0f172a" />
              <rect x="126" y="44" width="66" height="12" rx="3" fill="#e2e8f0" />
              <rect x="126" y="62" width="58" height="12" rx="3" fill="#e2e8f0" />
              <rect x="126" y="80" width="66" height="12" rx="3" fill="#e2e8f0" />
            </g>
            <rect x="126" y="99" width="66" height="12" rx="4" fill={accent} />
          </>
        )}

        {scene === 'DEDICATED_TAB' && (
          <>
            {/* Segmented Tab Bar */}
            <rect x="22" y="18" width="138" height="18" rx="6" fill="#1f3056" />
            <rect
              x="24"
              y="20"
              width="66"
              height="14"
              rx="4.5"
              fill={accent}
              style={{ animation: 'mp-tab-pill 4.4s cubic-bezier(0.22, 1, 0.36, 1) infinite' }}
            />
            <rect x="38" y="25" width="38" height="4" rx="2" fill="#ffffff" />
            <rect x="106" y="25" width="38" height="4" rx="2" fill="#cbd5e1" />

            {/* View A: Table */}
            <g style={{ animation: 'mp-tab-view-a 4.4s ease-in-out infinite' }}>
              {[46, 64, 82, 100].map((y) => (
                <rect key={y} x="22" y={y} width="176" height="12" rx="3" fill="#233660" />
              ))}
            </g>

            {/* View B: Spacious 2-Column Form */}
            <g style={{ animation: 'mp-tab-view-b 4.4s ease-in-out infinite' }}>
              <rect x="22" y="44" width="176" height="74" rx="6" fill="#f8fafc" />
              <rect x="32" y="54" width="74" height="13" rx="3" fill="#e2e8f0" />
              <rect x="114" y="54" width="74" height="13" rx="3" fill="#e2e8f0" />
              <rect x="32" y="73" width="74" height="13" rx="3" fill="#e2e8f0" />
              <rect x="114" y="73" width="74" height="13" rx="3" fill="#e2e8f0" />
              <rect x="132" y="96" width="56" height="13" rx="4" fill={accent} />
            </g>
          </>
        )}

        {scene === 'COMPACT_LEDGER' && (
          <>
            {/* Table Header */}
            <rect x="20" y="20" width="180" height="12" rx="3" fill="#243863" />
            {/* Scanning Hover Bar */}
            <rect
              x="20"
              y="36"
              width="180"
              height="13"
              rx="3"
              fill={accent}
              opacity="0.26"
              style={{ animation: 'mp-ledger-scan 4.8s ease-in-out infinite' }}
            />
            {[36, 51, 66, 81, 96].map((y, idx) => (
              <g key={y}>
                <line x1="20" y1={y + 13.5} x2="200" y2={y + 13.5} stroke="#2c4170" strokeWidth="1" />
                <rect x="26" y={y + 4} width="28" height="4.5" rx="2" fill="#e2e8f0" />
                <rect x="64" y={y + 4} width="62" height="4.5" rx="2" fill="#94a3b8" />
                <rect x="138" y={y + 4} width="26" height="4.5" rx="2" fill="#cbd5e1" />
                <rect
                  x="174"
                  y={y + 3}
                  width="20"
                  height="6.5"
                  rx="3"
                  fill={idx % 2 === 0 ? accent : '#38bdf8'}
                  opacity="0.85"
                />
              </g>
            ))}
          </>
        )}

        {scene === 'MODULAR_CARDS' && (
          <>
            {/* 2x2 Bento Modular Cards; Card #2 lifts on hover */}
            <g>
              <rect x="22" y="22" width="84" height="44" rx="7" fill="#1e3158" stroke="#334c7c" />
              <rect x="30" y="31" width="42" height="5" rx="2.5" fill="#e2e8f0" />
              <rect x="30" y="42" width="62" height="4" rx="2" fill="#94a3b8" />
              <rect x="30" y="52" width="26" height="6" rx="3" fill={accent} opacity="0.7" />
            </g>
            <g style={{ animation: 'mp-card-hover-lift 3.4s ease-in-out infinite' }}>
              <rect x="114" y="22" width="84" height="44" rx="7" fill="#f8fafc" stroke={accent} strokeWidth="1.6" />
              <rect x="122" y="31" width="46" height="5.5" rx="2.5" fill="#0f172a" />
              <rect x="122" y="42" width="60" height="4" rx="2" fill="#64748b" />
              <rect x="122" y="51" width="32" height="7" rx="3.5" fill={accent} />
            </g>
            <g>
              <rect x="22" y="74" width="84" height="44" rx="7" fill="#1e3158" stroke="#334c7c" />
              <rect x="30" y="83" width="48" height="5" rx="2.5" fill="#e2e8f0" />
              <rect x="30" y="94" width="56" height="4" rx="2" fill="#94a3b8" />
            </g>
            <g>
              <rect x="114" y="74" width="84" height="44" rx="7" fill="#1e3158" stroke="#334c7c" />
              <rect x="122" y="83" width="40" height="5" rx="2.5" fill="#e2e8f0" />
              <rect x="122" y="94" width="62" height="4" rx="2" fill="#94a3b8" />
            </g>
          </>
        )}

        {scene === 'KPI_COUNT_UP' && (
          <>
            {[0, 1, 2].map((idx) => {
              const x = 21 + idx * 61;
              return (
                <g key={idx}>
                  <rect x={x} y="22" width="56" height="44" rx="6" fill="#f8fafc" />
                  <rect x={x + 7} y="29" width="28" height="4" rx="2" fill="#64748b" />
                  <rect
                    x={x + 7}
                    y="39"
                    width={idx === 1 ? '36' : '28'}
                    height="10"
                    rx="3"
                    fill={idx === 1 ? accent : '#0f172a'}
                  />
                  {/* Rising mini sparkline bars */}
                  {[0, 1, 2].map((b) => (
                    <rect
                      key={b}
                      x={x + 36 + b * 5}
                      y={42 - b * 3}
                      width="3.5"
                      height={14 + b * 3}
                      rx="1.5"
                      fill={accent}
                      style={{
                        transformOrigin: `${x + 38}px 58px`,
                        animation: `mp-kpi-bar 3.2s ease-out ${idx * 0.16 + b * 0.08}s infinite`,
                      }}
                    />
                  ))}
                </g>
              );
            })}
            {/* Table placeholder below */}
            <rect x="21" y="76" width="178" height="12" rx="3" fill="#233660" />
            <rect x="21" y="93" width="178" height="12" rx="3" fill="#1e3056" />
          </>
        )}

        {scene === 'FILTER_CHIPS' && (
          <>
            {/* Filter Pills Row */}
            <rect x="22" y="21" width="38" height="14" rx="7" fill="#253965" />
            <rect x="29" y="26" width="24" height="4" rx="2" fill="#cbd5e1" />

            <g style={{ animation: 'mp-chip-active 3.8s ease-in-out infinite' }}>
              <rect x="66" y="21" width="48" height="14" rx="7" fill={accent} />
              <path d="M74 28 l3 3 l6 -6" stroke="#ffffff" strokeWidth="1.8" fill="none" strokeLinecap="round" />
              <rect x="86" y="26" width="20" height="4" rx="2" fill="#ffffff" />
            </g>

            <g style={{ animation: 'mp-chip-active 3.8s ease-in-out 0.15s infinite' }}>
              <rect x="120" y="21" width="46" height="14" rx="7" fill={accent} />
              <path d="M128 28 l3 3 l6 -6" stroke="#ffffff" strokeWidth="1.8" fill="none" strokeLinecap="round" />
              <rect x="140" y="26" width="18" height="4" rx="2" fill="#ffffff" />
            </g>

            {/* Filtered list rows: matching rows stay bright, non-matching fade out */}
            <rect x="22" y="45" width="176" height="14" rx="4" fill="#f8fafc" />
            <rect x="30" y="50" width="64" height="4.5" rx="2" fill="#0f172a" />
            <rect x="164" y="49" width="26" height="6" rx="3" fill={accent} />

            <g style={{ animation: 'mp-row-fade-out 3.8s ease-in-out infinite' }}>
              <rect x="22" y="64" width="176" height="13" rx="4" fill="#233660" />
              <rect x="30" y="69" width="54" height="4" rx="2" fill="#94a3b8" />
            </g>

            <rect x="22" y="82" width="176" height="14" rx="4" fill="#f8fafc" />
            <rect x="30" y="87" width="76" height="4.5" rx="2" fill="#0f172a" />
            <rect x="164" y="86" width="26" height="6" rx="3" fill={accent} />

            <g style={{ animation: 'mp-row-fade-out 3.8s ease-in-out infinite' }}>
              <rect x="22" y="101" width="176" height="13" rx="4" fill="#233660" />
              <rect x="30" y="106" width="48" height="4" rx="2" fill="#94a3b8" />
            </g>
          </>
        )}

        {scene === 'ACCORDION' && (
          <>
            {/* Row 1 Header */}
            <rect x="24" y="22" width="172" height="18" rx="4" fill="#f8fafc" />
            <rect x="34" y="29" width="76" height="5" rx="2.5" fill="#0f172a" />
            <circle cx="182" cy="31" r="5" fill={accent} />

            {/* Expandable Body */}
            <g
              style={{
                transformOrigin: '110px 42px',
                animation: 'mp-accordion-body 4.2s cubic-bezier(0.22, 1, 0.36, 1) infinite',
              }}
            >
              <rect x="24" y="42" width="172" height="25" rx="4" fill="#e2e8f0" stroke={accent} strokeWidth="1" />
              <rect x="34" y="49" width="118" height="4" rx="2" fill="#334155" />
              <rect x="34" y="57" width="88" height="4" rx="2" fill="#64748b" />
            </g>

            {/* Rows 2 & 3 pushed down smoothly */}
            <g style={{ animation: 'mp-accordion-push 4.2s cubic-bezier(0.22, 1, 0.36, 1) infinite' }}>
              <rect x="24" y="46" width="172" height="17" rx="4" fill="#233660" />
              <rect x="34" y="52.5" width="64" height="4.5" rx="2" fill="#cbd5e1" />
              <rect x="24" y="68" width="172" height="17" rx="4" fill="#233660" />
              <rect x="34" y="74.5" width="72" height="4.5" rx="2" fill="#cbd5e1" />
            </g>
          </>
        )}

        {scene === 'STEP_INDICATOR' && (
          <>
            {/* Track Line */}
            <rect x="40" y="38" width="140" height="4" rx="2" fill="#253965" />
            <rect
              x="40"
              y="38"
              width="140"
              height="4"
              rx="2"
              fill={accent}
              style={{
                transformOrigin: '40px 40px',
                animation: 'mp-step-line 4.4s ease-in-out infinite',
              }}
            />
            {[40, 86, 133, 180].map((cx, i) => (
              <g key={cx}>
                <circle
                  cx={cx}
                  cy="40"
                  r="10"
                  fill={i < 3 ? accent : '#1e3158'}
                  stroke={accent}
                  strokeWidth="2"
                />
                <path
                  d={`M${cx - 3.5} 40 l2.5 2.8 l5 -5.2`}
                  stroke="#ffffff"
                  strokeWidth="1.8"
                  fill="none"
                  strokeLinecap="round"
                />
              </g>
            ))}
            {/* Approval card below */}
            <rect x="30" y="64" width="160" height="48" rx="6" fill="#f8fafc" />
            <rect x="40" y="75" width="84" height="5" rx="2.5" fill="#0f172a" />
            <rect x="40" y="86" width="60" height="4" rx="2" fill="#64748b" />
            <rect x="136" y="88" width="44" height="14" rx="4" fill={accent} />
          </>
        )}

        {scene === 'TOAST' && (
          <>
            <rect x="24" y="22" width="90" height="12" rx="3" fill="#233660" />
            <rect x="24" y="40" width="172" height="46" rx="6" fill="#1e3056" />
            <rect x="34" y="52" width="84" height="6" rx="3" fill="#cbd5e1" opacity="0.7" />
            <rect x="34" y="65" width="52" height="12" rx="4" fill={accent} />

            {/* Sliding Bottom-Right Toast with Countdown Bar */}
            <g style={{ animation: 'mp-toast-pop 4s cubic-bezier(0.22, 1, 0.36, 1) infinite' }}>
              <rect x="92" y="92" width="108" height="28" rx="6" fill="#f8fafc" stroke={accent} strokeWidth="1.5" />
              <circle cx="104" cy="104" r="4.5" fill="#10b981" />
              <rect x="114" y="100" width="72" height="4.5" rx="2" fill="#0f172a" />
              <rect x="114" y="108" width="48" height="3.5" rx="1.5" fill="#64748b" />
              <rect
                x="94"
                y="116.5"
                width="104"
                height="2.5"
                rx="1.2"
                fill={accent}
                style={{
                  transformOrigin: '94px 117px',
                  animation: 'mp-toast-bar 4s linear infinite',
                }}
              />
            </g>
          </>
        )}

        {scene === 'SKELETON' && (
          <>
            <defs>
              <clipPath id="mp-skel-clip">
                <rect x="24" y="24" width="172" height="90" rx="6" />
              </clipPath>
              <linearGradient id="mp-skel-grad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
                <stop offset="50%" stopColor="#ffffff" stopOpacity="0.32" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* Base grey skeleton bars */}
            <g clipPath="url(#mp-skel-clip)">
              <rect x="24" y="24" width="172" height="90" rx="6" fill="#1e3056" />
              <rect x="34" y="35" width="76" height="8" rx="4" fill="#334c7c" />
              <rect x="34" y="51" width="150" height="12" rx="4" fill="#2b416c" />
              <rect x="34" y="69" width="150" height="12" rx="4" fill="#2b416c" />
              <rect x="34" y="87" width="114" height="12" rx="4" fill="#2b416c" />
              {/* Sweeping shimmer band */}
              <rect
                x="0"
                y="20"
                width="75"
                height="100"
                fill="url(#mp-skel-grad)"
                style={{ animation: 'mp-shimmer-wave 3.4s ease-in-out infinite' }}
              />
            </g>
            {/* Loaded crisp card cross-fading in */}
            <g style={{ animation: 'mp-skeleton-swap 3.4s ease-in-out infinite' }}>
              <rect x="24" y="24" width="172" height="90" rx="6" fill="#f8fafc" />
              <rect x="34" y="35" width="76" height="8" rx="4" fill="#0f172a" />
              <rect x="34" y="51" width="150" height="12" rx="4" fill="#e2e8f0" />
              <rect x="34" y="69" width="150" height="12" rx="4" fill="#e2e8f0" />
              <rect x="34" y="87" width="56" height="12" rx="4" fill={accent} />
            </g>
          </>
        )}

        {scene === 'SUBTLE_MOTION' && (
          <>
            {[0, 1, 2].map((i) => {
              const x = 22 + i * 60;
              return (
                <g
                  key={i}
                  style={{
                    animation: `mp-stagger-enter 3.6s cubic-bezier(0.22, 1, 0.36, 1) ${i * 0.18}s infinite`,
                  }}
                >
                  <rect x={x} y="26" width="54" height="86" rx="7" fill="#f8fafc" stroke={accent} strokeWidth="1.2" />
                  <rect x={x + 8} y="37" width="26" height="6" rx="3" fill={accent} />
                  <rect x={x + 8} y="50" width="38" height="4.5" rx="2" fill="#0f172a" />
                  <rect x={x + 8} y="60" width="32" height="4" rx="2" fill="#64748b" />
                  <rect x={x + 8} y="92" width="38" height="10" rx="3" fill="#e2e8f0" />
                </g>
              );
            })}
          </>
        )}
      </svg>
    </div>
  );
}

function SchematicOptionCard({
  scene,
  refCode,
  title,
  desc,
  selected,
  selectionMode,
  accentColor,
  onSelect,
}: {
  scene: SchematicSceneId;
  refCode: string;
  title: string;
  desc: string;
  selected: boolean;
  selectionMode: 'radio' | 'checkbox';
  accentColor: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role={selectionMode === 'radio' ? 'radio' : 'checkbox'}
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'group flex cursor-pointer flex-col overflow-hidden rounded-card border bg-surface text-left transition-all focus-visible:outline-2 focus-visible:outline-accent',
        selected
          ? 'border-accent ring-2 ring-accent/30 shadow-xs'
          : 'border-line hover:border-accent/55 hover:shadow-2xs',
      )}
    >
      <div className="relative w-full">
        <MotionSchematicStage scene={scene} accentColor={accentColor} />
        <span className="absolute top-2 left-2 rounded bg-black/65 px-1.5 py-0.5 font-mono text-[10px] text-white/90 backdrop-blur-xs">
          {refCode}
        </span>
        <span
          className={cn(
            'absolute top-2 right-2 inline-flex h-5 w-5 items-center justify-center rounded-full border transition-colors',
            selected
              ? 'border-accent bg-accent text-white shadow-xs'
              : 'border-white/40 bg-black/45 text-transparent group-hover:border-white/80',
          )}
        >
          <Check size={11.5} strokeWidth={2.6} />
        </span>
      </div>

      <div className="flex flex-1 flex-col justify-between gap-1.5 p-3">
        <div className="text-[13px] font-semibold leading-snug text-ink">{title}</div>
        <p className="m-0 text-[12px] leading-[1.5] text-ink-3">{desc}</p>
      </div>
    </button>
  );
}

export function MotionSchematicGallery({
  alignment,
  setAlignment,
  accentColor,
}: {
  alignment: RequirementAlignmentState;
  setAlignment: React.Dispatch<React.SetStateAction<RequirementAlignmentState>>;
  accentColor: string;
}) {
  const { t } = usePreferences();
  const [paused, setPaused] = useState(false);

  const togglePart = (id: InteractivePartId) => {
    setAlignment((prev) => {
      const exists = prev.interactiveParts.includes(id);
      return {
        ...prev,
        interactiveParts: exists
          ? prev.interactiveParts.filter((x) => x !== id)
          : [...prev.interactiveParts, id],
      };
    });
  };

  const toggleFeedback = (id: FeedbackMotionId) => {
    setAlignment((prev) => {
      const exists = prev.feedbackMotions.includes(id);
      return {
        ...prev,
        feedbackMotions: exists
          ? prev.feedbackMotions.filter((x) => x !== id)
          : [...prev.feedbackMotions, id],
      };
    });
  };

  return (
    <div className="flex flex-col gap-4" data-motion-paused={paused ? 'true' : 'false'}>
      {/* Header Bar with Play/Pause Schematic Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="badge badge-accent">
              <Sparkles size={11.5} />
              {t('动态示意图选型', 'Visual Motion Schematics')}
            </span>
            <h3 className="m-0 font-serif text-[16.5px] font-semibold text-ink">
              {t(
                '看动态小图选交互习惯 — 不用记任何 UI 专业术语',
                'Pick How Your App Moves & Behaves by Watching Live Mini Diagrams',
              )}
            </h3>
          </div>
          <p className="m-0 mt-1 text-[12.5px] text-ink-3">
            {t(
              '每张卡片都在循环演示真实的点击与出现效果（已同步您刚挑中的主强调色），看着顺眼就点选，Agent 会自动转换成专业前端交互代码。',
              'Each card loops a live miniature diagram tinted with your chosen reference palette. Just click what feels natural.',
            )}
          </p>
        </div>

        <Button
          type="button"
          variant="secondary"
          size="xs"
          aria-pressed={paused}
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? <Play size={12} /> : <Pause size={12} />}
          {paused ? t('播放示意图动效', 'Play Demos') : t('暂停示意图动效', 'Pause Demos')}
        </Button>
      </div>

      {/* Group 1: Opening & Layout */}
      <section className="space-y-2.5" role="radiogroup" aria-label={t('新建与详情打开方式', 'Opening & Layout')}>
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[13.5px] font-semibold text-ink">
            1. {t('点「新建 / 查看详情」时，页面怎么打开？（四选一）', '1. How should "Create / View Details" open? (Pick one)')}
          </div>
          <span className="text-[11.5px] text-ink-3">{t('单选', 'Single choice')}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {ENTRY_SCHEMATICS.map((item) => (
            <SchematicOptionCard
              key={item.id}
              scene={item.id}
              refCode={item.refCode}
              title={t(item.plainTitleZh, item.plainTitleEn)}
              desc={t(item.plainDescZh, item.plainDescEn)}
              selected={alignment.entryPattern === item.id}
              selectionMode="radio"
              accentColor={accentColor}
              onSelect={() => setAlignment((prev) => ({ ...prev, entryPattern: item.id }))}
            />
          ))}
        </div>
      </section>

      {/* Group 2: Density */}
      <section className="space-y-2.5" role="radiogroup" aria-label={t('数据排布疏密感', 'Layout Density')}>
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[13.5px] font-semibold text-ink">
            2. {t('页面上的数据列表想要紧凑一点，还是宽松分块？（二选一）', '2. How dense should tables & records look? (Pick one)')}
          </div>
          <span className="text-[11.5px] text-ink-3">{t('单选', 'Single choice')}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {DENSITY_SCHEMATICS.map((item) => (
            <SchematicOptionCard
              key={item.id}
              scene={item.id}
              refCode={item.refCode}
              title={t(item.plainTitleZh, item.plainTitleEn)}
              desc={t(item.plainDescZh, item.plainDescEn)}
              selected={alignment.layoutDensity === item.id}
              selectionMode="radio"
              accentColor={accentColor}
              onSelect={() => setAlignment((prev) => ({ ...prev, layoutDensity: item.id }))}
            />
          ))}
        </div>
      </section>

      {/* Group 3: Interactive Building Blocks */}
      <section className="space-y-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[13.5px] font-semibold text-ink">
            3. {t('页面里需要放哪些好用的小机关？（可多选）', '3. Which helpful interactive parts do you want? (Multi-select)')}
          </div>
          <span className="text-[11.5px] text-ink-3">
            {t(`已选 ${alignment.interactiveParts.length} 项`, `${alignment.interactiveParts.length} selected`)}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {INTERACTIVE_PART_SCHEMATICS.map((item) => (
            <SchematicOptionCard
              key={item.id}
              scene={item.id}
              refCode={item.refCode}
              title={t(item.plainTitleZh, item.plainTitleEn)}
              desc={t(item.plainDescZh, item.plainDescEn)}
              selected={alignment.interactiveParts.includes(item.id)}
              selectionMode="checkbox"
              accentColor={accentColor}
              onSelect={() => togglePart(item.id)}
            />
          ))}
        </div>
      </section>

      {/* Group 4: Feedback & Motion Polish */}
      <section className="space-y-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[13.5px] font-semibold text-ink">
            4. {t('保存反馈与页面过渡动效感觉（可多选）', '4. Action feedback & motion polish (Multi-select)')}
          </div>
          <span className="text-[11.5px] text-ink-3">
            {t(`已选 ${alignment.feedbackMotions.length} 项`, `${alignment.feedbackMotions.length} selected`)}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {FEEDBACK_MOTION_SCHEMATICS.map((item) => (
            <SchematicOptionCard
              key={item.id}
              scene={item.id}
              refCode={item.refCode}
              title={t(item.plainTitleZh, item.plainTitleEn)}
              desc={t(item.plainDescZh, item.plainDescEn)}
              selected={alignment.feedbackMotions.includes(item.id)}
              selectionMode="checkbox"
              accentColor={accentColor}
              onSelect={() => toggleFeedback(item.id)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

