import React, { useId, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  Check,
  ChevronRight,
  Code2,
  Copy,
  Cpu,
  Crosshair,
  Database,
  FileCode2,
  FileText,
  GitBranch,
  LayoutTemplate,
  ListTree,
  Loader2,
  Search,
  Sparkles,
  Trash2,
  Workflow,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { ModelCode } from '../../../packages/ontology-core/index.js';
import type { AgentToolCallTrace } from '../../../packages/workspace-store/index.js';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';

export interface ToolChipsProps {
  traces: AgentToolCallTrace[];
  testId?: string;
  onJumpToOntology?: (modelCode: ModelCode, elementId?: string) => void;
  className?: string;
}

interface ToolMeta {
  zh: string;
  en: string;
  icon: LucideIcon;
}

const TOOL_CATALOG: Record<string, ToolMeta> = {
  record_requirement_insights: {
    zh: '沉淀需求洞察',
    en: 'Record Insights',
    icon: FileText,
  },
  inspect_ontology_model: {
    zh: '检视本体模型',
    en: 'Inspect Ontology',
    icon: Search,
  },
  ask_user: {
    zh: '征询业务决策',
    en: 'Ask User Decision',
    icon: Sparkles,
  },
  compile_dev_package: {
    zh: '编译四层研发包',
    en: 'Compile Dev Package',
    icon: FileCode2,
  },
  invoke_mcp_tool: {
    zh: '调用 MCP 工具',
    en: 'Invoke MCP Tool',
    icon: Cpu,
  },
  run_readonly_sql: {
    zh: '只读 SQL 穿透查询',
    en: 'Read-Only SQL Query',
    icon: Database,
  },
  propose_policy_writeback: {
    zh: '生成策略回写方案',
    en: 'Propose Writeback',
    icon: Workflow,
  },
  upsert_aggregate: {
    zh: '维护领域聚合根',
    en: 'Upsert Aggregate',
    icon: Boxes,
  },
  upsert_behavior: {
    zh: '维护领域行为',
    en: 'Upsert Behavior',
    icon: Workflow,
  },
  upsert_rule: {
    zh: '维护业务规则',
    en: 'Upsert Business Rule',
    icon: GitBranch,
  },
  upsert_event: {
    zh: '维护领域事件',
    en: 'Upsert Domain Event',
    icon: Sparkles,
  },
  upsert_scenario: {
    zh: '维护跨聚合场景',
    en: 'Upsert Scenario',
    icon: GitBranch,
  },
  upsert_actor_role: {
    zh: '维护参与者与角色',
    en: 'Upsert Actor & Role',
    icon: Boxes,
  },
  upsert_flow: {
    zh: '维护业务流程',
    en: 'Upsert Flow',
    icon: GitBranch,
  },
  upsert_query_report: {
    zh: '维护查询与报表',
    en: 'Upsert Query/Report',
    icon: Database,
  },
  upsert_screen: {
    zh: '维护界面屏幕',
    en: 'Upsert UI Screen',
    icon: LayoutTemplate,
  },
  upsert_mapping: {
    zh: '维护持久化映射',
    en: 'Upsert DB Mapping',
    icon: Database,
  },
  upsert_interface: {
    zh: '维护服务接口',
    en: 'Upsert Interface',
    icon: Cpu,
  },
  delete_element: {
    zh: '移除本体要素',
    en: 'Delete Element',
    icon: Trash2,
  },
};

const ARG_LABELS: Record<string, { zh: string; en: string }> = {
  discoveredAggregates: { zh: '识别领域聚合', en: 'Discovered Aggregates' },
  discoveredRules: { zh: '沉淀候选规则', en: 'Candidate Rules' },
  resolvedDecisions: { zh: '分级确认与补全决策', en: 'Resolved Decisions' },
  openQuestions: { zh: '待确认业务问题', en: 'Open Questions' },
  modelCode: { zh: '目标模型', en: 'Model Code' },
  elementId: { zh: '要素标识', en: 'Element ID' },
  id: { zh: '要素 ID', en: 'ID' },
  name: { zh: '英文标识', en: 'Identifier' },
  alias: { zh: '业务名称', en: 'Business Alias' },
  label: { zh: '显示名称', en: 'Label' },
  description: { zh: '业务说明', en: 'Description' },
  ruleType: { zh: '规则类型', en: 'Rule Type' },
  scope: { zh: '作用范围', en: 'Scope' },
  referencedObjects: { zh: '关联领域对象', en: 'Referenced Objects' },
  expression: { zh: '规则表达式', en: 'Rule Expression' },
  violationMessage: { zh: '违例拦截提示', en: 'Violation Message' },
  attributes: { zh: '聚合属性清单', en: 'Attributes' },
  lifecycle: { zh: '生命周期状态', en: 'Lifecycle States' },
  ownerEntity: { zh: '归属聚合根', en: 'Owner Aggregate' },
  behaviorType: { zh: '行为类型', en: 'Behavior Type' },
  triggerType: { zh: '触发方式', en: 'Trigger Type' },
  invokedRules: { zh: '调用规则', en: 'Invoked Rules' },
  queryReportRef: { zh: '关联查询规格', en: 'Query Spec Ref' },
  sourceAggregate: { zh: '来源聚合根', en: 'Source Aggregate' },
  triggerEventRef: { zh: '触发事件引用', en: 'Trigger Event' },
  involvedAggregates: { zh: '协同聚合列表', en: 'Involved Aggregates' },
  flowType: { zh: '流程类型', en: 'Flow Type' },
  primaryAggregate: { zh: '主领域对象', en: 'Primary Aggregate' },
  screenId: { zh: '屏幕标识', en: 'Screen ID' },
  screenType: { zh: '屏幕类型', en: 'Screen Type' },
  route: { zh: '路由路径', en: 'Route' },
  objectName: { zh: '领域对象名', en: 'Object Name' },
  tableName: { zh: '物理数据表', en: 'Physical Table' },
  mappingNote: { zh: '映射说明', en: 'Mapping Note' },
  interfaceId: { zh: '接口标识', en: 'Interface ID' },
  direction: { zh: '接口方向', en: 'Direction' },
  interfaceCategory: { zh: '接口类别', en: 'Category' },
  protocol: { zh: '通信协议', en: 'Protocol' },
  sql: { zh: 'SQL 查询语句', en: 'SQL Query' },
  applicationId: { zh: '装配应用 ID', en: 'Application ID' },
  toolName: { zh: '目标工具名', en: 'Target Tool' },
  arguments: { zh: '工具入参', en: 'Tool Arguments' },
  writebackInterfaceId: { zh: '回写接口 ID', en: 'Writeback Interface' },
  actionTitle: { zh: '策略动作标题', en: 'Policy Action' },
  targetObject: { zh: '作用对象', en: 'Target Object' },
  expectedImpact: { zh: '预期业务影响', en: 'Expected Impact' },
  header: { zh: '分类标签', en: 'Header Badge' },
  question: { zh: '追问问题', en: 'Question' },
  options: { zh: '可选方案', en: 'Options' },
  multiSelect: { zh: '允许复选', en: 'Multi-Select' },
  allowFreeform: { zh: '允许自由补充', en: 'Allow Freeform' },
};

function resolveToolMeta(name: string): ToolMeta {
  const direct = TOOL_CATALOG[name];
  if (direct) return direct;
  if (name.includes('sql') || name.includes('db') || name.includes('query')) {
    return { zh: '数据查询工具', en: 'Data Query Tool', icon: Database };
  }
  if (name.includes('rule') || name.includes('scenario') || name.includes('element')) {
    return { zh: '本体建模工具', en: 'Ontology Tool', icon: GitBranch };
  }
  if (name.includes('compile') || name.includes('package') || name.includes('skill')) {
    return { zh: '工程编译工具', en: 'Compiler Tool', icon: FileCode2 };
  }
  return { zh: '调用领域工具', en: 'Domain Tool', icon: Wrench };
}

function formatDuration(ms: number | undefined): string | null {
  if (typeof ms !== 'number' || Number.isNaN(ms)) return null;
  if (ms <= 0) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)}s`;
}

function isEmptyValue(val: unknown): boolean {
  if (val === undefined || val === null || val === '') return true;
  if (Array.isArray(val)) return val.length === 0;
  if (typeof val === 'object') return Object.keys(val as Record<string, unknown>).length === 0;
  return false;
}

const CODE_FIELD_KEYS = new Set(['sql', 'expression']);

function isCompactScalar(key: string, val: unknown): boolean {
  if (CODE_FIELD_KEYS.has(key)) return false;
  if (typeof val === 'boolean' || typeof val === 'number') return true;
  if (typeof val === 'string') {
    return val.length <= 44 && !val.includes('\n');
  }
  return false;
}

function isShortTokenArray(items: unknown[]): items is (string | number)[] {
  if (items.length === 0 || items.length > 8) return false;
  return items.every(
    (item) =>
      (typeof item === 'string' &&
        item.length > 0 &&
        item.length <= 28 &&
        !item.includes('\n') &&
        !item.startsWith('[')) ||
      typeof item === 'number',
  );
}

interface ParsedTaggedText {
  tag?: string;
  tagTone?: 'accent' | 'warn' | 'ok' | 'neutral';
  codePrefix?: string;
  body: string;
}

function parseTaggedListItem(raw: string): ParsedTaggedText {
  const trimmed = raw.trim();
  const bracketMatch = /^\[([^\]]{1,24})\]\s*(.*)$/s.exec(trimmed);
  if (bracketMatch) {
    const tag = bracketMatch[1]!;
    const tagLower = tag.toLowerCase();
    const rest = bracketMatch[2] || '';
    const tagTone: ParsedTaggedText['tagTone'] =
      tag.includes('待确认') ||
      tag.includes('风险') ||
      tag.includes('拦截') ||
      tagLower.includes('pending') ||
      tagLower.includes('open') ||
      tagLower.includes('risk') ||
      tagLower.includes('block')
        ? 'warn'
        : tag.includes('已确认') ||
            tag.includes('通过') ||
            tagLower.includes('confirmed') ||
            tagLower.includes('passed')
          ? 'ok'
          : tag.includes('AI') ||
              tag.includes('自动') ||
              tag.includes('补全') ||
              tagLower.includes('auto')
            ? 'accent'
            : 'neutral';
    return { tag, tagTone, body: rest || trimmed };
  }

  const rulePrefixMatch = /^([A-Z]+-[A-Z0-9-]+)\s*[:：]\s*(.*)$/s.exec(trimmed);
  if (rulePrefixMatch) {
    return {
      codePrefix: rulePrefixMatch[1]!,
      body: rulePrefixMatch[2] || trimmed,
    };
  }

  return { body: trimmed };
}

const JSON_TOKEN_RE =
  /("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function highlightJsonText(json: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of json.matchAll(JSON_TOKEN_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) {
      nodes.push(json.slice(last, idx));
    }
    const [full, keyToken, strToken, boolToken, numToken] = m;
    if (keyToken) {
      const colonSuffix = full.slice(keyToken.length);
      nodes.push(
        <span key={k++} className="font-medium text-ink">
          {keyToken}
        </span>,
      );
      if (colonSuffix) nodes.push(colonSuffix);
    } else if (strToken) {
      nodes.push(
        <span key={k++} className="text-green">
          {strToken}
        </span>,
      );
    } else if (boolToken) {
      nodes.push(
        <span key={k++} className="text-accent">
          {boolToken}
        </span>,
      );
    } else if (numToken) {
      nodes.push(
        <span key={k++} className="text-orange">
          {numToken}
        </span>,
      );
    } else {
      nodes.push(full);
    }
    last = idx + full.length;
  }
  if (last < json.length) {
    nodes.push(json.slice(last));
  }
  return nodes;
}

export function ToolChips({
  traces,
  testId,
  onJumpToOntology,
  className,
}: ToolChipsProps) {
  const { t } = usePreferences();
  const baseId = useId();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'structured' | 'json'>('structured');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const active = useMemo(
    () => (expandedId ? traces.find((item) => item.id === expandedId) ?? null : null),
    [expandedId, traces],
  );

  if (!traces || traces.length === 0) {
    return null;
  }

  const panelId = `${baseId}-tool-inspector`;
  const singleDoneTrace =
    traces.length === 1 &&
    !expandedId &&
    !traces[0]!.isError &&
    Boolean(traces[0]!.output)
      ? traces[0]!
      : null;

  const handleCopyJson = (trace: AgentToolCallTrace) => {
    const payload = JSON.stringify(
      {
        tool: trace.toolName,
        arguments: trace.arguments ?? {},
        output: trace.output,
        ...(trace.targetModelCode ? { targetModelCode: trace.targetModelCode } : {}),
        ...(trace.targetElementId ? { targetElementId: trace.targetElementId } : {}),
      },
      null,
      2,
    );
    navigator.clipboard?.writeText(payload).catch(() => {});
    setCopiedId(trace.id);
    window.setTimeout(() => {
      setCopiedId((cur) => (cur === trace.id ? null : cur));
    }, 1500);
  };

  return (
    <div className={cn('tool-trace-root w-full space-y-2', className)} data-testid={testId}>
      {/* ─── Compact Interactive Tool Trigger Strip ─── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {traces.map((trace, index) => {
          const meta = resolveToolMeta(trace.toolName);
          const Icon = meta.icon;
          const running = trace.durationMs === undefined && !trace.output;
          const isError = Boolean(trace.isError);
          const isExpanded = expandedId === trace.id;
          const durationLabel = !running ? formatDuration(trace.durationMs) : null;

          return (
            <button
              key={trace.id}
              type="button"
              aria-expanded={isExpanded}
              aria-controls={isExpanded ? panelId : undefined}
              onClick={() => setExpandedId(isExpanded ? null : trace.id)}
              className={cn(
                'group/chip inline-flex min-h-[28px] max-w-full cursor-pointer items-center gap-1.5 rounded-control border px-2 py-1 text-left text-[12px]',
                'transition-[background-color,border-color,color,box-shadow] duration-150 ease-out-strong',
                running && 'border-accent/40 bg-accent-tint/55 text-accent',
                isError && !isExpanded && 'border-red/35 bg-red-tint/45 text-red hover:border-red/55',
                isError && isExpanded && 'border-red/60 bg-red-tint/60 text-red shadow-xs',
                !running &&
                  !isError &&
                  !isExpanded &&
                  'border-line bg-surface text-ink-2 shadow-2xs hover:border-line-strong hover:bg-hover hover:text-ink',
                !running &&
                  !isError &&
                  isExpanded &&
                  'border-accent/55 bg-accent-tint/35 text-ink shadow-xs',
              )}
            >
              {traces.length > 1 && (
                <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[4px] bg-inset px-1 font-mono text-[10px] font-semibold text-ink-3 tabular-nums">
                  {index + 1}
                </span>
              )}

              <span
                className={cn(
                  'inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]',
                  running && 'bg-accent-tint text-accent',
                  isError && 'bg-red-tint text-red',
                  !running && !isError && 'bg-inset text-accent group-hover/chip:bg-accent-tint/70',
                )}
              >
                {running ? (
                  <Loader2 size={11} strokeWidth={2} className="animate-[spin_0.9s_linear_infinite]" />
                ) : isError ? (
                  <AlertTriangle size={11} strokeWidth={2} />
                ) : (
                  <Icon size={11} strokeWidth={1.85} />
                )}
              </span>

              <span className="truncate font-medium text-ink">
                {t(meta.zh, meta.en)}
              </span>

              <span className="max-w-[180px] truncate rounded bg-inset/85 px-1.5 py-0.2 font-mono text-[10.5px] text-ink-3">
                {trace.toolName}
              </span>

              {trace.targetModelCode && (
                <span className="shrink-0 rounded bg-accent-tint px-1.5 py-0.2 font-mono text-[10.5px] font-medium text-accent">
                  {trace.targetModelCode}
                  {trace.targetElementId ? `:${trace.targetElementId}` : ''}
                </span>
              )}

              {trace.validatorRepair && (
                <span className="shrink-0 rounded bg-orange-tint px-1.5 py-0.2 font-mono text-[10.5px] font-medium text-orange">
                  Auto-Repair
                </span>
              )}

              {durationLabel && (
                <span className="shrink-0 font-mono text-[10.5px] text-ink-3 tabular-nums">
                  {durationLabel}
                </span>
              )}

              {!running && !isError && (
                <Check
                  size={11}
                  strokeWidth={2.5}
                  className="shrink-0 text-green animate-[pop-in_180ms_var(--ease-out-strong)_both]"
                />
              )}

              <ChevronRight
                size={11.5}
                className={cn(
                  'shrink-0 text-ink-3 transition-transform duration-150 ease-out-strong',
                  isExpanded && 'rotate-90 text-accent',
                )}
              />
            </button>
          );
        })}

        {singleDoneTrace && (
          <span className="tool-chip-inline-summary min-w-0 flex-1 truncate text-[11.5px] text-ink-3">
            {singleDoneTrace.output}
          </span>
        )}
      </div>

      {/* ─── Expanded Structured Tool Inspector Panel ─── */}
      {active && (() => {
        const meta = resolveToolMeta(active.toolName);
        const ActiveIcon = meta.icon;
        const running = active.durationMs === undefined && !active.output;
        const isError = Boolean(active.isError);
        const durationLabel = !running ? formatDuration(active.durationMs) : null;
        const isCopied = copiedId === active.id;

        return (
          <div
            id={panelId}
            role="region"
            aria-label={`${active.toolName} details`}
            className="overflow-hidden rounded-card border border-line bg-inset/45 text-[12px] shadow-xs animate-[fade-up_160ms_var(--ease-out-strong)_both]"
          >
            {/* Top Inspector Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface/85 px-3 py-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <ActiveIcon
                  size={13}
                  strokeWidth={1.85}
                  className={cn('shrink-0', isError ? 'text-red' : 'text-accent')}
                />
                <span className="font-semibold text-ink">{t(meta.zh, meta.en)}</span>
                <code className="rounded border border-line bg-inset px-1.5 py-0.2 font-mono text-[11px] text-ink-2">
                  {active.toolName}
                </code>

                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-[10.5px] font-medium',
                    isError
                      ? 'bg-red-tint text-red'
                      : active.validatorRepair
                        ? 'bg-orange-tint text-orange'
                        : running
                          ? 'bg-accent-tint text-accent'
                          : 'bg-green-tint text-green',
                  )}
                >
                  {isError
                    ? t('门禁拦截 · ERROR', 'Blocked · ERROR')
                    : active.validatorRepair
                      ? t('自修复落库 · REPAIRED', 'Auto-Repaired')
                      : running
                        ? t('执行中 · RUNNING', 'Running')
                        : t('已完成 · DONE', 'Completed · DONE')}
                </span>

                {durationLabel && (
                  <span className="font-mono text-[10.5px] text-ink-3 tabular-nums">
                    {durationLabel}
                  </span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {active.targetModelCode && onJumpToOntology && (
                  <button
                    type="button"
                    onClick={() =>
                      onJumpToOntology(
                        active.targetModelCode as ModelCode,
                        active.targetElementId,
                      )
                    }
                    className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-chip border border-accent/30 bg-accent-tint px-2 text-[11px] font-medium text-accent transition-opacity hover:opacity-85"
                  >
                    <Crosshair size={11.5} aria-hidden="true" className="shrink-0" />
                    {t('定位', 'Locate')} {active.targetModelCode}
                    {active.targetElementId ? ` · ${active.targetElementId}` : ''}
                  </button>
                )}

                {/* Segmented Structured / Raw JSON Switch */}
                <div
                  className="inline-flex h-6 items-center rounded-chip border border-line bg-inset p-0.5"
                  role="group"
                  aria-label={t('参数视图模式', 'Arguments view mode')}
                >
                  <button
                    type="button"
                    onClick={() => setViewMode('structured')}
                    className={cn(
                      'inline-flex h-[18px] cursor-pointer items-center gap-1 rounded-[4px] px-1.5 text-[10.5px] font-medium transition-colors',
                      viewMode === 'structured'
                        ? 'bg-surface text-ink shadow-2xs'
                        : 'text-ink-3 hover:text-ink-2',
                    )}
                  >
                    <ListTree size={10.5} />
                    {t('结构化', 'Structured')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('json')}
                    className={cn(
                      'inline-flex h-[18px] cursor-pointer items-center gap-1 rounded-[4px] px-1.5 font-mono text-[10.5px] font-medium transition-colors',
                      viewMode === 'json'
                        ? 'bg-surface text-ink shadow-2xs'
                        : 'text-ink-3 hover:text-ink-2',
                    )}
                  >
                    <Code2 size={10.5} />
                    JSON
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => handleCopyJson(active)}
                  title={t('复制工具调用详情 (JSON)', 'Copy tool call JSON')}
                  aria-label={t('复制工具调用详情', 'Copy tool call JSON')}
                  className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-chip border border-line bg-surface text-ink-3 transition-colors hover:bg-hover hover:text-ink"
                >
                  {isCopied ? (
                    <Check size={11.5} strokeWidth={2.3} className="text-green" />
                  ) : (
                    <Copy size={11.5} strokeWidth={1.8} />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-2.5 p-3">
              {/* Full-Width Result / Validator Feedback Strip */}
              <div
                className={cn(
                  'flex items-start gap-2 rounded-control border px-2.5 py-2 text-[12px] leading-relaxed',
                  isError
                    ? 'border-red/35 bg-red-tint/35 text-ink'
                    : running
                      ? 'border-accent/30 bg-accent-tint/25 text-ink-2'
                      : 'border-line bg-surface text-ink',
                )}
              >
                <span
                  className={cn(
                    'mt-[2px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
                    isError
                      ? 'bg-red-tint text-red'
                      : running
                        ? 'bg-accent-tint text-accent'
                        : 'bg-green-tint text-green',
                  )}
                >
                  {isError ? (
                    <AlertTriangle size={10.5} strokeWidth={2.2} />
                  ) : running ? (
                    <Loader2 size={10.5} className="animate-[spin_0.9s_linear_infinite]" />
                  ) : (
                    <Check size={10.5} strokeWidth={2.5} />
                  )}
                </span>
                <div className="min-w-0 flex-1 break-words">
                  <span className="mr-1.5 text-[11px] font-semibold text-ink-3">
                    {t('执行结果 / 门禁反馈：', 'Result / Validator Feedback:')}
                  </span>
                  <span className="whitespace-pre-wrap text-ink">
                    {active.output || t('正在执行并校验 11 模型约束…', 'Executing & validating…')}
                  </span>
                </div>
              </div>

              {/* Input Arguments Section */}
              {viewMode === 'structured' ? (
                <StructuredArgumentsView args={active.arguments ?? {}} />
              ) : (
                <div className="space-y-1">
                  <div className="text-[10.5px] font-medium text-ink-3">
                    {t('原始调用入参 (JSON)', 'Raw Arguments (JSON)')}
                  </div>
                  <pre className="bui-scroller m-0 max-h-72 overflow-y-auto overflow-x-hidden rounded-control border border-line bg-surface p-2.5 font-mono text-[11.5px] leading-[1.6] whitespace-pre-wrap break-words text-ink-2">
                    {highlightJsonText(JSON.stringify(active.arguments ?? {}, null, 2))}
                  </pre>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function StructuredArgumentsView({ args }: { args: Record<string, unknown> }) {
  const { t } = usePreferences();

  const entries = Object.entries(args);
  const nonEmpty = entries.filter(([, v]) => !isEmptyValue(v));
  const emptyKeys = entries.filter(([, v]) => isEmptyValue(v)).map(([k]) => k);

  if (entries.length === 0) {
    return (
      <div className="rounded-control border border-line bg-surface px-2.5 py-1.5 text-[11.5px] text-ink-3">
        {t('无显式传入参数（使用当前会话默认上下文）', 'No explicit arguments (using session context)')}
      </div>
    );
  }

  const scalarEntries = nonEmpty.filter(([k, v]) => isCompactScalar(k, v));
  const blockEntries = nonEmpty.filter(([k, v]) => !isCompactScalar(k, v));

  const renderFieldHeader = (key: string, count?: number) => {
    const labelSpec = ARG_LABELS[key];
    return (
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-ink-2">
            {labelSpec ? t(labelSpec.zh, labelSpec.en) : key}
          </span>
          {labelSpec && (
            <span className="font-mono text-[10px] text-ink-3">{key}</span>
          )}
        </div>
        {typeof count === 'number' && (
          <span className="rounded-full bg-inset px-1.5 py-0.1 font-mono text-[10px] text-ink-3 tabular-nums">
            {count}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {/* Compact Scalar Key-Value Grid */}
      {scalarEntries.length > 0 && (
        <div className="tool-scalar-grid">
          {scalarEntries.map(([key, val]) => {
            const labelSpec = ARG_LABELS[key];
            return (
              <div
                key={key}
                className="flex flex-col gap-0.5 rounded-control border border-line bg-surface px-2.5 py-1.5"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-[10.5px] font-medium text-ink-3">
                    {labelSpec ? t(labelSpec.zh, labelSpec.en) : key}
                  </span>
                  {labelSpec && (
                    <span className="shrink-0 font-mono text-[9.5px] text-ink-3/80">{key}</span>
                  )}
                </div>
                <div className="min-w-0 break-words font-mono text-[12px] font-medium text-ink">
                  {typeof val === 'boolean' ? (
                    <span
                      className={cn(
                        'inline-block rounded px-1.5 py-0.1 text-[10.5px]',
                        val ? 'bg-accent-tint text-accent' : 'bg-inset text-ink-3',
                      )}
                    >
                      {val ? 'true' : 'false'}
                    </span>
                  ) : (
                    String(val)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Rich Block Fields (Arrays, Code/SQL, Nested Objects, Long Text) */}
      {blockEntries.map(([key, val]) => {
        // 1. Code / SQL / Rule Expressions
        if (typeof val === 'string' && CODE_FIELD_KEYS.has(key)) {
          return (
            <div key={key} className="space-y-1">
              {renderFieldHeader(key)}
              <pre className="bui-scroller m-0 max-h-56 overflow-y-auto overflow-x-hidden rounded-control border border-line bg-surface px-2.5 py-2 font-mono text-[11.5px] leading-[1.6] whitespace-pre-wrap break-words text-ink">
                {val}
              </pre>
            </div>
          );
        }

        // 2. Long / Multiline Strings
        if (typeof val === 'string') {
          const parsed = parseTaggedListItem(val);
          return (
            <div key={key} className="space-y-1">
              {renderFieldHeader(key)}
              <div className="rounded-control border border-line bg-surface px-2.5 py-2 text-[12.5px] leading-[1.6] whitespace-pre-wrap break-words text-ink">
                <TaggedInlineContent parsed={parsed} />
              </div>
            </div>
          );
        }

        // 3. Arrays (Strings, Short Tokens, or Objects)
        if (Array.isArray(val)) {
          if (isShortTokenArray(val)) {
            return (
              <div key={key} className="space-y-1">
                {renderFieldHeader(key, val.length)}
                <div className="flex flex-wrap gap-1.5 rounded-control border border-line bg-surface px-2.5 py-2">
                  {val.map((token, idx) => (
                    <span
                      key={`${String(token)}-${idx}`}
                      className="rounded border border-line bg-inset px-2 py-0.5 font-mono text-[11px] font-medium text-ink-2"
                    >
                      {String(token)}
                    </span>
                  ))}
                </div>
              </div>
            );
          }

          const allPrimitives = val.every(
            (item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean',
          );

          if (allPrimitives) {
            return (
              <div key={key} className="space-y-1">
                {renderFieldHeader(key, val.length)}
                <ul className="bui-scroller m-0 max-h-64 divide-y divide-line overflow-y-auto overflow-x-hidden rounded-control border border-line bg-surface p-0 list-none">
                  {val.map((item, idx) => {
                    const parsed = parseTaggedListItem(String(item));
                    return (
                      <li
                        key={idx}
                        className="flex items-start gap-2 px-2.5 py-2 text-[12.5px] leading-[1.58] text-ink"
                      >
                        <span className="mt-[2px] inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded bg-inset px-1 font-mono text-[10px] font-medium text-ink-3 tabular-nums">
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1 break-words">
                          <TaggedInlineContent parsed={parsed} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          }

          // Array of Objects (e.g., attributes in upsert_aggregate)
          return (
            <div key={key} className="space-y-1">
              {renderFieldHeader(key, val.length)}
              <div className="bui-scroller max-h-64 divide-y divide-line overflow-y-auto overflow-x-hidden rounded-control border border-line bg-surface">
                {val.map((obj, idx) => {
                  if (!obj || typeof obj !== 'object') {
                    return (
                      <div key={idx} className="px-2.5 py-1.5 font-mono text-[11.5px] text-ink-2 break-words">
                        {String(obj)}
                      </div>
                    );
                  }
                  const rec = obj as Record<string, unknown>;
                  const entriesOfObj = Object.entries(rec).filter(([, v]) => !isEmptyValue(v));
                  return (
                    <div key={idx} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-2.5 py-2 text-[11.5px]">
                      <span className="font-mono text-[10px] text-ink-3 tabular-nums">#{idx + 1}</span>
                      {entriesOfObj.map(([subK, subV]) => (
                        <span key={subK} className="inline-flex max-w-full items-baseline gap-1 break-words">
                          <span className="font-mono text-[10.5px] text-ink-3">{subK}:</span>
                          <span className="font-medium text-ink">
                            {typeof subV === 'object' ? JSON.stringify(subV) : String(subV)}
                          </span>
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }

        // 4. Nested Plain Object (e.g. arguments inside invoke_mcp_tool)
        if (val && typeof val === 'object') {
          const subEntries = Object.entries(val as Record<string, unknown>).filter(
            ([, subV]) => !isEmptyValue(subV),
          );
          return (
            <div key={key} className="space-y-1">
              {renderFieldHeader(key, subEntries.length)}
              <div className="divide-y divide-line rounded-control border border-line bg-surface">
                {subEntries.map(([subK, subV]) => (
                  <div
                    key={subK}
                    className="flex flex-wrap items-baseline justify-between gap-2 px-2.5 py-1.5 text-[11.5px]"
                  >
                    <span className="font-mono text-ink-3">{subK}</span>
                    <span className="min-w-0 break-words font-mono text-ink">
                      {typeof subV === 'object' ? JSON.stringify(subV) : String(subV)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        return null;
      })}

      {/* Quiet Footer for Empty Optional Fields */}
      {emptyKeys.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 pt-0.5 text-[10.5px] text-ink-3">
          <span>{t('未传入可选字段：', 'Empty optional fields:')}</span>
          {emptyKeys.map((k) => (
            <code
              key={k}
              className="rounded bg-surface/80 px-1.5 py-0.1 font-mono text-[10px] text-ink-3 shadow-hairline"
            >
              {k}
            </code>
          ))}
        </div>
      )}
    </div>
  );
}

function TaggedInlineContent({ parsed }: { parsed: ParsedTaggedText }) {
  return (
    <>
      {parsed.tag && (
        <span
          className={cn(
            'mr-1.5 inline-flex items-center rounded px-1.5 py-0.2 align-[1px] text-[10.5px] font-semibold leading-tight',
            parsed.tagTone === 'accent' && 'bg-accent-tint text-accent',
            parsed.tagTone === 'warn' && 'bg-orange-tint text-orange',
            parsed.tagTone === 'ok' && 'bg-green-tint text-green',
            parsed.tagTone === 'neutral' && 'bg-inset text-ink-2',
          )}
        >
          {parsed.tag}
        </span>
      )}
      {parsed.codePrefix && (
        <code className="mr-1.5 rounded bg-accent-tint px-1.5 py-0.2 font-mono text-[10.5px] font-semibold text-accent">
          {parsed.codePrefix}
        </code>
      )}
      <span>{parsed.body}</span>
    </>
  );
}
