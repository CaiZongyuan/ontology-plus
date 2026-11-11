import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Code2,
  Copy,
  Eye,
  FileText,
  Loader2,
  RotateCcw,
  Settings2,
  Sparkles,
  Square,
  Terminal,
  X,
} from 'lucide-react';
import {
  type BackgroundPipelineTask,
  useWorkbenchStore,
} from '../../api.js';
import { usePreferences } from '../../i18n.js';
import { Button } from '../beautifui/index.js';
import { MarkdownRenderer } from '../markdown/index.js';
import { cn } from '../../lib/utils.js';

function formatElapsed(startedAt: number, completedAt?: number): string {
  const sec = Math.max(0, Math.floor(((completedAt ?? Date.now()) - startedAt) / 1000));
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function formatLogClock(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '--:--:--';
    return d.toTimeString().slice(0, 8);
  } catch {
    return '--:--:--';
  }
}

function stripThinkingCharCount(text: string): string {
  return text
    .replace(/[（(]已思考\s*[\d,]+\s*字[）)]/g, '')
    .replace(/\s*\((?:reasoning\s*)?[\d,]+\s*chars\)/gi, '');
}

export function computePipelineProgressPercent(task: BackgroundPipelineTask): number {
  if (task.status === 'COMPLETED') return 100;
  if (task.kind === 'SRS_SYNTHESIS') {
    if (task.step === 1) return 12;
    if (task.step === 2) return 24;
    if (task.step === 3) {
      if (task.completedChapters > 0) {
        return Math.min(92, 28 + Math.round((task.completedChapters / 9) * 62));
      }
      if (task.streamedChars > 0) {
        return Math.min(88, 28 + Math.round(Math.min(1, task.streamedChars / 4500) * 56));
      }
      if (task.thinkingChars > 0) {
        return Math.min(36, 24 + Math.round(Math.min(1, task.thinkingChars / 1500) * 12));
      }
      return 28;
    }
    return 95;
  }
  if (task.step === 1) return 18;
  if (task.step === 2) return 35;
  if (task.step === 3) {
    if (task.streamedChars > 0) {
      return Math.min(88, 40 + Math.round(Math.min(1, task.streamedChars / 5000) * 46));
    }
    return 45;
  }
  return 94;
}

function useTaskElapsedClock(task?: BackgroundPipelineTask): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!task || task.status !== 'RUNNING') return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [task?.id, task?.status]);
  if (!task) return '00:00';
  return formatElapsed(task.startedAt, task.completedAt);
}

/**
 * Inline pipeline status surface:
 * - `variant="compact"` (used on origin views such as 需求探索 -> 需求文档):
 *   renders a concise progress bar strip with a jump button to inspect full details & live stream on the destination view.
 * - `variant="full"` (used on destination views such as 需求文档 / 界面原型):
 *   renders the comprehensive 4-stage progress track and on-demand expandable live streaming drawer.
 */
export function PipelineInlinePanel({
  task,
  variant = 'full',
  defaultPreviewExpanded = false,
  onNavigateTarget,
  onNavigateLlmCenter,
}: {
  task: BackgroundPipelineTask;
  variant?: 'full' | 'compact';
  defaultPreviewExpanded?: boolean;
  onNavigateTarget?: () => void;
  onNavigateLlmCenter?: () => void;
}) {
  const { t } = usePreferences();
  const {
    expandedStreamTaskIds,
    setTaskStreamExpanded,
    cancelBackgroundTask,
    dismissBackgroundTask,
    retryBackgroundTask,
    openBackgroundTaskResult,
  } = useWorkbenchStore();

  const streamOpen = expandedStreamTaskIds[task.id] ?? defaultPreviewExpanded;
  const setStreamOpen = (next: boolean) => setTaskStreamExpanded(task.id, next);

  const handleJumpToDetails = () => {
    setTaskStreamExpanded(task.id, true);
    if (onNavigateTarget) {
      onNavigateTarget();
    } else {
      void openBackgroundTaskResult(task.id, { expandStream: true, keepCard: true });
    }
  };

  const isActivelyThinkingOnly =
    task.status === 'RUNNING' && task.thinkingChars > 0 && task.streamedChars === 0;
  const [thinkingManualOpen, setThinkingManualOpen] = useState<boolean | null>(null);
  const thinkingOpen = thinkingManualOpen ?? isActivelyThinkingOnly;

  const [renderMode, setRenderMode] = useState<'RAW' | 'MARKDOWN'>('RAW');
  const [autoFollow, setAutoFollow] = useState(true);
  const [copied, setCopied] = useState(false);

  const streamViewportRef = useRef<HTMLDivElement | null>(null);
  const thinkingViewportRef = useRef<HTMLPreElement | null>(null);

  const elapsed = useTaskElapsedClock(task);
  const percent = computePipelineProgressPercent(task);

  const isRunning = task.status === 'RUNNING';
  const isError = task.status === 'ERROR';
  const isCancelled = task.status === 'CANCELLED';
  const isCompleted = task.status === 'COMPLETED';

  const fullStreamText = task.streamedText || task.previewTail || '';
  const hasThinking = task.thinkingChars > 0 || Boolean(task.thinkingText);
  const canResumeCheckpoint =
    task.streamedChars >= 200 &&
    (task.kind === 'SRS_SYNTHESIS' || task.kind === 'PROTOTYPE_GEN');

  useEffect(() => {
    if (!streamOpen || !autoFollow) return;
    const el = streamViewportRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [streamOpen, autoFollow, fullStreamText, renderMode]);

  useEffect(() => {
    if (!streamOpen || !thinkingOpen || !isRunning) return;
    const el = thinkingViewportRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [streamOpen, thinkingOpen, isRunning, task.thinkingText]);

  const handleStreamScroll = () => {
    const el = streamViewportRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoFollow(distanceFromBottom <= 36);
  };

  const handleJumpToBottom = () => {
    setAutoFollow(true);
    const el = streamViewportRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  };

  const handleCopyStream = async () => {
    if (!fullStreamText) return;
    try {
      await navigator.clipboard.writeText(fullStreamText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  const stages =
    task.kind === 'SRS_SYNTHESIS'
      ? [
          {
            step: 1 as const,
            zh: '1. 会话与 A/B 决策聚合',
            en: '1. Aggregate Transcript & Decisions',
          },
          {
            step: 2 as const,
            zh: '2. 11 元模型结构对齐',
            en: '2. Align 11-Model Baseline',
          },
          {
            step: 3 as const,
            zh:
              task.completedChapters > 0
                ? `3. 9 章节流式撰写 (${task.completedChapters}/9)`
                : '3. 9 章节流式撰写',
            en:
              task.completedChapters > 0
                ? `3. Stream 9 Chapters (${task.completedChapters}/9)`
                : '3. Stream 9 Chapters',
          },
          {
            step: 4 as const,
            zh: '4. 门禁校验与归档',
            en: '4. Governance Check & Save',
          },
        ]
      : task.kind === 'PROTOTYPE_GEN'
        ? [
            { step: 1 as const, zh: '1. 读取规格与约束', en: '1. Load SRS & Bindings' },
            { step: 2 as const, zh: '2. 规划屏幕与锚点', en: '2. Plan Screens & Anchors' },
            { step: 3 as const, zh: '3. HTML5 流式编写', en: '3. Stream HTML5 Code' },
            { step: 4 as const, zh: '4. 提取 MU 并同步', en: '4. Extract & Sync MU' },
          ]
        : [
            { step: 1 as const, zh: '1. 解析原型与上下文', en: '1. Parse MU & Context' },
            { step: 2 as const, zh: '2. 跨模型关联推导', en: '2. Cross-Model Alignment' },
            { step: 3 as const, zh: '3. 11 模型流式合成', en: '3. Stream 11-Model Blueprint' },
            { step: 4 as const, zh: '4. 两级门禁落库', en: '4. Validate & Persist' },
          ];

  const displayMessage = stripThinkingCharCount(t(task.messageZh, task.messageEn));

  if (variant === 'compact') {
    const progressMetricLabel =
      isRunning && task.kind === 'SRS_SYNTHESIS' && task.completedChapters > 0
        ? t(`${task.completedChapters}/9 章`, `${task.completedChapters}/9 ch`)
        : isRunning
          ? `${percent}%`
          : isCompleted
            ? '100%'
            : isError
              ? t('异常', 'Failed')
              : t('已取消', 'Cancelled');

    const jumpDetailLabel =
      task.kind === 'SRS_SYNTHESIS'
        ? t('前往需求文档查看流式详情', 'View Live Stream in SRS Docs')
        : task.kind === 'PROTOTYPE_GEN'
          ? t('前往界面原型查看流式详情', 'View Live Stream in Prototype')
          : t('前往本体工作台查看详情', 'View Stream in Ontology Studio');

    return (
      <section
        aria-label={t(task.titleZh, task.titleEn)}
        data-testid={`pipeline-compact-${task.kind.toLowerCase()}`}
        className={cn(
          'pipeline-compact-card',
          isRunning && 'is-running',
          isError && 'is-error',
          isCompleted && 'is-completed',
          isCancelled && 'is-cancelled',
        )}
      >
        <div className="pipeline-compact-main">
          <span className="pipeline-status-icon" aria-hidden="true">
            {isRunning ? (
              <Loader2 size={14} className="pipeline-spin" />
            ) : isError ? (
              <AlertTriangle size={14} />
            ) : isCompleted ? (
              <CheckCircle2 size={14} />
            ) : (
              <Clock size={14} />
            )}
          </span>
          <span className="pipeline-compact-title">{t(task.titleZh, task.titleEn)}</span>
          <span className="pipeline-elapsed-pill" title={t('耗时', 'Elapsed time')}>
            <Clock size={11} aria-hidden="true" />
            {elapsed}
          </span>
          {(isRunning || isCompleted) && (
            <div className="pipeline-compact-progress-wrap">
              <progress
                className="pipeline-compact-progress"
                max={100}
                value={percent}
                aria-label={t(
                  `${task.titleZh} 进度 ${percent}%`,
                  `${task.titleEn} progress ${percent}%`,
                )}
              />
              <span className="pipeline-compact-metric">{progressMetricLabel}</span>
            </div>
          )}
          <span className="pipeline-compact-msg" title={displayMessage}>
            {displayMessage}
          </span>
        </div>

        <div className="pipeline-compact-actions">
          {isRunning && (
            <>
              <Button
                type="button"
                variant="secondary"
                size="xs"
                data-testid="pipeline-compact-jump-btn"
                onClick={handleJumpToDetails}
              >
                <Terminal size={11} aria-hidden="true" />
                {jumpDetailLabel}
                <ArrowRight size={12} aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="text-red"
                onClick={() => cancelBackgroundTask(task.id)}
              >
                <Square size={11} aria-hidden="true" />
                {t('取消', 'Cancel')}
              </Button>
            </>
          )}

          {isCompleted && (
            <>
              <Button
                type="button"
                variant="accent"
                size="xs"
                data-testid="pipeline-compact-jump-btn"
                onClick={() => void openBackgroundTaskResult(task.id, { keepCard: true })}
              >
                {task.kind === 'SRS_SYNTHESIS'
                  ? t('前往需求文档查看规格书', 'Open in SRS Docs')
                  : task.kind === 'PROTOTYPE_GEN'
                    ? t('前往界面原型查看结果', 'Open Prototype')
                    : t('查看 11 模型本体', 'Open Ontology')}
                <ArrowRight size={12} aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label={t('关闭进度条', 'Dismiss progress strip')}
                onClick={() => dismissBackgroundTask(task.id)}
              >
                <X size={13} aria-hidden="true" />
              </Button>
            </>
          )}

          {(isError || isCancelled) && (
            <>
              <Button
                type="button"
                variant="accent"
                size="xs"
                data-testid="pipeline-resume-btn"
                onClick={() => void retryBackgroundTask(task.id)}
              >
                <RotateCcw size={12} aria-hidden="true" />
                {canResumeCheckpoint
                  ? t(
                      `断点续写（接着 ${task.streamedChars.toLocaleString()} 字）`,
                      `Resume (${task.streamedChars.toLocaleString()} chars)`,
                    )
                  : t('重试', 'Retry')}
              </Button>
              {canResumeCheckpoint && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => void retryBackgroundTask(task.id, { fromScratch: true })}
                >
                  {t('从头重生', 'Restart')}
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                size="xs"
                data-testid="pipeline-compact-jump-btn"
                onClick={handleJumpToDetails}
              >
                {t('查看详情', 'View Details')}
                <ArrowRight size={12} aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label={t('关闭提示', 'Dismiss notice')}
                onClick={() => dismissBackgroundTask(task.id)}
              >
                <X size={13} aria-hidden="true" />
              </Button>
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label={t(task.titleZh, task.titleEn)}
      data-testid={`pipeline-inline-${task.kind.toLowerCase()}`}
      className={cn(
        'pipeline-inline-card',
        isRunning && 'is-running',
        isError && 'is-error',
        isCompleted && 'is-completed',
        isCancelled && 'is-cancelled',
      )}
    >
      <div className="pipeline-inline-head">
        <div className="pipeline-inline-title-wrap">
          <span className="pipeline-status-icon" aria-hidden="true">
            {isRunning ? (
              <Loader2 size={15} className="pipeline-spin" />
            ) : isError ? (
              <AlertTriangle size={15} />
            ) : isCompleted ? (
              <CheckCircle2 size={15} />
            ) : (
              <Clock size={15} />
            )}
          </span>
          <div className="min-w-0">
            <div className="pipeline-inline-title">
              <span>{t(task.titleZh, task.titleEn)}</span>
              <span className="pipeline-elapsed-pill" title={t('耗时', 'Elapsed time')}>
                <Clock size={11} aria-hidden="true" />
                {elapsed}
              </span>
              {task.providerModel && (
                <span className="pipeline-stat-pill" title={t('调用模型', 'Active Model')}>
                  {task.providerModel}
                </span>
              )}
              {isActivelyThinkingOnly && (
                <span className="pipeline-thinking-pill">
                  <BrainCircuit size={11} aria-hidden="true" />
                  {t('正在梳理结构', 'Structuring')}
                </span>
              )}
              {task.streamedChars > 0 && (
                <span className="pipeline-stat-pill">
                  {t(
                    `已输出 ${task.streamedChars.toLocaleString()} 字`,
                    `${task.streamedChars.toLocaleString()} chars`,
                  )}
                </span>
              )}
              {task.currentChapter && isRunning && (
                <span className="pipeline-chapter-pill">
                  <Sparkles size={11} aria-hidden="true" />
                  {task.currentChapter}
                </span>
              )}
            </div>
            <p className="pipeline-inline-msg">{displayMessage}</p>
          </div>
        </div>

        <div className="pipeline-inline-actions">
          {/* On-demand Expand / Collapse Live Stream Output — available across ALL steps & statuses */}
          <Button
            type="button"
            variant={streamOpen ? 'secondary' : 'ghost'}
            size="xs"
            data-testid="pipeline-toggle-stream"
            aria-expanded={streamOpen}
            onClick={() => setStreamOpen(!streamOpen)}
          >
            <Terminal size={12} aria-hidden="true" />
            {streamOpen
              ? t('收起流式输出', 'Hide Stream')
              : isRunning
                ? t('展开实时流式输出', 'Expand Live Stream')
                : t('查看生成过程与流式输出', 'Inspect Generation Stream')}
            {streamOpen ? (
              <ChevronUp size={12} aria-hidden="true" />
            ) : (
              <ChevronDown size={12} aria-hidden="true" />
            )}
          </Button>

          {isRunning && onNavigateTarget && (
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={handleJumpToDetails}
            >
              <FileText size={12} aria-hidden="true" />
              {task.kind === 'SRS_SYNTHESIS'
                ? t('前往规格书页查看', 'Watch in SRS View')
                : t('前往目标工作台', 'Watch in Workspace')}
              <ArrowRight size={12} aria-hidden="true" />
            </Button>
          )}

          {isRunning && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-red"
              onClick={() => cancelBackgroundTask(task.id)}
            >
              <Square size={11} aria-hidden="true" />
              {t('取消生成', 'Cancel')}
            </Button>
          )}

          {isCompleted && (
            <>
              <Button
                type="button"
                variant="accent"
                size="xs"
                onClick={() => void openBackgroundTaskResult(task.id, { keepCard: true })}
              >
                {task.kind === 'SRS_SYNTHESIS'
                  ? t('定位至规格书', 'Focus Document')
                  : task.kind === 'PROTOTYPE_GEN'
                    ? t('查看交互原型', 'Open Prototype')
                    : t('查看 11 模型本体', 'Open Ontology')}
                <ArrowRight size={12} aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label={t('关闭生成卡片', 'Dismiss generation card')}
                onClick={() => dismissBackgroundTask(task.id)}
              >
                <X size={13} aria-hidden="true" />
              </Button>
            </>
          )}

          {(isError || isCancelled) && (
            <>
              <Button
                type="button"
                variant="accent"
                size="xs"
                data-testid="pipeline-resume-btn"
                onClick={() => void retryBackgroundTask(task.id)}
              >
                <RotateCcw size={12} aria-hidden="true" />
                {canResumeCheckpoint
                  ? t(
                      `断点续写（接着 ${task.streamedChars.toLocaleString()} 字继续）`,
                      `Resume (${task.streamedChars.toLocaleString()} chars)`,
                    )
                  : t('重试合成', 'Retry')}
              </Button>
              {canResumeCheckpoint && (
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  onClick={() => void retryBackgroundTask(task.id, { fromScratch: true })}
                >
                  {t('从头重生', 'Restart from 0')}
                </Button>
              )}
              {isError && task.resultItemId && (
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  onClick={() => void openBackgroundTaskResult(task.id, { keepCard: true })}
                >
                  <FileText size={12} aria-hidden="true" />
                  {t('查看已存草稿', 'Open Saved Draft')}
                </Button>
              )}
              {isError && onNavigateLlmCenter && (
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  onClick={onNavigateLlmCenter}
                >
                  <Settings2 size={12} aria-hidden="true" />
                  {t('LLM 中心配置', 'LLM Center')}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label={t('关闭提示', 'Dismiss notice')}
                onClick={() => dismissBackgroundTask(task.id)}
              >
                <X size={13} aria-hidden="true" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Progress Track + 4-Step Stages */}
      {(isRunning || isCompleted) && (
        <div className="pipeline-stage-section">
          <progress
            className="pipeline-progress-bar"
            max={100}
            value={percent}
            aria-label={t(
              `${task.titleZh} 进度 ${percent}%`,
              `${task.titleEn} progress ${percent}%`,
            )}
          />
          <div className="pipeline-stage-grid">
            {stages.map((st) => {
              const done = isCompleted || task.step > st.step;
              const current = isRunning && task.step === st.step;
              return (
                <div
                  key={st.step}
                  className={cn(
                    'pipeline-stage-step',
                    done && 'is-done',
                    current && 'is-current',
                  )}
                >
                  <span className="pipeline-stage-dot" aria-hidden="true">
                    {done ? '✓' : st.step}
                  </span>
                  <span className="truncate">{t(st.zh, st.en)}</span>
                </div>
              );
            })}
          </div>
          {isRunning && (
            <div className="pipeline-safe-nav-hint">
              {t(
                '持久化保障已开启：刷新浏览器、关闭标签页或切换任意模块，服务端合成均不会中断，增量草稿将自动落库保存。',
                'Durable server execution active: refreshing, closing the tab, or switching views will not interrupt generation; incremental drafts are auto-saved.',
              )}
            </div>
          )}
        </div>
      )}

      {isError && task.errorDiagnostic?.remediation && (
        <div className="pipeline-error-remediation">
          {task.errorDiagnostic.code && (
            <code className="pipeline-error-code">{task.errorDiagnostic.code}</code>
          )}
          <span>{task.errorDiagnostic.remediation}</span>
        </div>
      )}

      {/* On-Demand Expandable Full Generation Process & Live Stream Drawer */}
      {streamOpen && (
        <div
          data-testid="pipeline-stream-drawer"
          className="pipeline-stream-drawer"
        >
          {/* 1. Stage Process Timeline */}
          {task.stageLogs && task.stageLogs.length > 0 && (
            <div className="pipeline-stage-logs">
              <div className="pipeline-drawer-subhead">
                <span className="inline-flex items-center gap-1.5">
                  <Clock size={12} aria-hidden="true" />
                  {t('全流程阶段轨迹', 'Generation Stage Timeline')}
                </span>
                <span className="font-mono text-[11px] text-ink-3">
                  {task.stageLogs.length} {t('条记录', 'events')}
                </span>
              </div>
              <ol className="pipeline-stage-log-list">
                {task.stageLogs.map((log, idx) => {
                  const isLatestRunning = isRunning && idx === task.stageLogs.length - 1;
                  return (
                    <li
                      key={log.id}
                      className={cn(
                        'pipeline-stage-log-item',
                        isLatestRunning && 'is-active',
                        log.phase === 'ERROR' && 'is-error',
                        log.phase === 'DONE' && 'is-done',
                      )}
                    >
                      <span className="pipeline-log-time">{formatLogClock(log.timestamp)}</span>
                      <span className="pipeline-log-step">S{log.step}</span>
                      <span className="pipeline-log-text">
                        {stripThinkingCharCount(t(log.messageZh, log.messageEn))}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {/* 2. Collapsible Model Reasoning / Thinking Stream */}
          {hasThinking && (
            <div className="pipeline-thinking-box">
              <button
                type="button"
                className="pipeline-thinking-toggle"
                aria-expanded={thinkingOpen}
                onClick={() => setThinkingManualOpen(!thinkingOpen)}
              >
                <span className="inline-flex items-center gap-1.5">
                  {thinkingOpen ? (
                    <ChevronDown size={13} aria-hidden="true" />
                  ) : (
                    <ChevronRight size={13} aria-hidden="true" />
                  )}
                  <BrainCircuit size={13} className="text-accent" aria-hidden="true" />
                  <span>{t('大模型深度思考流', 'Model Reasoning Stream')}</span>
                  {isActivelyThinkingOnly && (
                    <span className="pipeline-live-badge">
                      {t('思考中…', 'Reasoning…')}
                    </span>
                  )}
                </span>
                <span className="text-[11px] font-medium text-ink-3">
                  {thinkingOpen ? t('收起', 'Hide') : t('展开', 'Show')}
                </span>
              </button>
              {thinkingOpen && (
                <pre ref={thinkingViewportRef} className="pipeline-thinking-body">
                  {task.thinkingText}
                  {isActivelyThinkingOnly && <span className="pipeline-stream-cursor" aria-hidden="true">▍</span>}
                </pre>
              )}
            </div>
          )}

          {/* 3. Full Real-Time Content Stream (Raw Stream vs Rendered Markdown) */}
          <div className="pipeline-live-preview">
            <div className="pipeline-live-preview-head">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5">
                  <Terminal size={12} aria-hidden="true" />
                  {task.kind === 'SRS_SYNTHESIS'
                    ? t('实时流式规格书全文输出', 'Full Live SRS Stream')
                    : task.kind === 'PROTOTYPE_GEN'
                      ? t('实时流式 HTML5 原型源码输出', 'Full Live HTML5 Prototype Stream')
                      : t('实时流式 11 元模型蓝图输出', 'Full Live 11-Model Blueprint Stream')}
                </span>
                {isRunning && (
                  <span className="pipeline-live-badge">
                    {t('实时流式传输中', 'Streaming Live')}
                  </span>
                )}
                {task.kind === 'SRS_SYNTHESIS' && (
                  <span className="font-mono text-[11px] text-ink-3">
                    {task.completedChapters}/9 {t('章', 'chapters')}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {task.kind === 'SRS_SYNTHESIS' && fullStreamText.length > 0 && (
                  <div
                    role="group"
                    aria-label={t('流式输出视图模式', 'Stream display mode')}
                    className="pipeline-stream-mode-switch"
                  >
                    <button
                      type="button"
                      className={cn('pipeline-mode-btn', renderMode === 'RAW' && 'is-active')}
                      onClick={() => setRenderMode('RAW')}
                    >
                      <Code2 size={11} aria-hidden="true" />
                      {t('源码流', 'Raw')}
                    </button>
                    <button
                      type="button"
                      className={cn('pipeline-mode-btn', renderMode === 'MARKDOWN' && 'is-active')}
                      onClick={() => setRenderMode('MARKDOWN')}
                    >
                      <Eye size={11} aria-hidden="true" />
                      {t('排版预览', 'Preview')}
                    </button>
                  </div>
                )}

                {fullStreamText.length > 0 && (
                  <button
                    type="button"
                    className="pipeline-copy-btn"
                    onClick={() => void handleCopyStream()}
                    title={t('复制流式输出全文', 'Copy full streamed output')}
                  >
                    {copied ? (
                      <Check size={11} aria-hidden="true" />
                    ) : (
                      <Copy size={11} aria-hidden="true" />
                    )}
                    <span>{copied ? t('已复制', 'Copied') : t('复制', 'Copy')}</span>
                  </button>
                )}
              </div>
            </div>

            <div
              ref={streamViewportRef}
              onScroll={handleStreamScroll}
              className="pipeline-stream-viewport"
            >
              {fullStreamText.length === 0 ? (
                <div className="pipeline-stream-empty">
                  {isRunning ? (
                    <>
                      <Loader2 size={14} className="pipeline-spin text-accent" aria-hidden="true" />
                      <span>
                        {isActivelyThinkingOnly
                          ? t(
                              '大模型正在上方思考框内推演领域规则与章节结构，即将开始流式输出正文…',
                              'Model is reasoning on domain rules & structure above; main body tokens will stream shortly…',
                            )
                          : t(
                              '正在完成上下文聚合与提示词装配，等待大模型返回首个流式 Token…',
                              'Completing context assembly; awaiting first streaming token from model…',
                            )}
                      </span>
                      <span className="pipeline-stream-cursor" aria-hidden="true">▍</span>
                    </>
                  ) : (
                    <span>
                      {t('本次任务未产生正文流式片段。', 'No body stream tokens were recorded for this run.')}
                    </span>
                  )}
                </div>
              ) : renderMode === 'MARKDOWN' && task.kind === 'SRS_SYNTHESIS' ? (
                <div className="pipeline-stream-markdown">
                  <MarkdownRenderer content={fullStreamText} />
                  {isRunning && <span className="pipeline-stream-cursor" aria-hidden="true">▍</span>}
                </div>
              ) : (
                <pre className="pipeline-live-preview-body">
                  {fullStreamText}
                  {isRunning && <span className="pipeline-stream-cursor" aria-hidden="true">▍</span>}
                </pre>
              )}
            </div>

            {!autoFollow && fullStreamText.length > 0 && (
              <div className="pipeline-follow-bar">
                <button
                  type="button"
                  className="pipeline-follow-btn"
                  onClick={handleJumpToBottom}
                >
                  <ArrowDown size={11} aria-hidden="true" />
                  {isRunning
                    ? t('回到最新流式输出位置', 'Resume Auto-Follow')
                    : t('滚动至文末', 'Jump to Bottom')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function TrayTaskItem({ task }: { task: BackgroundPipelineTask }) {
  const { t } = usePreferences();
  const {
    setActiveNav,
    cancelBackgroundTask,
    dismissBackgroundTask,
    openBackgroundTaskResult,
    retryBackgroundTask,
  } = useWorkbenchStore();
  const elapsed = useTaskElapsedClock(task);
  const percent = computePipelineProgressPercent(task);
  const isRunning = task.status === 'RUNNING';
  const isCompleted = task.status === 'COMPLETED';
  const isError = task.status === 'ERROR';

  return (
    <div
      data-testid={`global-pipeline-card-${task.kind.toLowerCase()}`}
      className={cn(
        'pipeline-tray-card',
        isRunning && 'is-running',
        isCompleted && 'is-completed',
        isError && 'is-error',
      )}
    >
      <div className="pipeline-tray-top">
        <span className="pipeline-status-icon" aria-hidden="true">
          {isRunning ? (
            <Loader2 size={14} className="pipeline-spin" />
          ) : isCompleted ? (
            <CheckCircle2 size={14} />
          ) : (
            <AlertTriangle size={14} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="pipeline-tray-title-row">
            <span className="pipeline-tray-title truncate">
              {t(task.titleZh, task.titleEn)}
            </span>
            <span className="pipeline-elapsed-pill">{elapsed}</span>
          </div>
          <div className="pipeline-tray-sub">
            <span className="pipeline-tray-project">{task.projectName}</span>
            <span>·</span>
            <span>
              {isRunning && task.kind === 'SRS_SYNTHESIS' && task.completedChapters > 0
                ? t(`已完成 ${task.completedChapters}/9 章`, `${task.completedChapters}/9 ch`)
                : isRunning && task.thinkingChars > 0 && task.streamedChars === 0
                  ? t('正在梳理结构…', 'Structuring…')
                  : isRunning
                    ? t(`阶段 ${task.step}/${task.totalSteps}`, `Step ${task.step}/${task.totalSteps}`)
                    : isCompleted
                      ? t('后台已完成', 'Completed')
                      : isError
                        ? t('生成异常', 'Failed')
                        : t('已取消', 'Cancelled')}
            </span>
          </div>
        </div>
        {!isRunning && (
          <button
            type="button"
            className="pipeline-tray-close"
            aria-label={t('关闭后台任务通知', 'Dismiss background task notification')}
            onClick={() => dismissBackgroundTask(task.id)}
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      <p className="pipeline-tray-msg">
        {stripThinkingCharCount(t(task.messageZh, task.messageEn))}
      </p>

      {isRunning && (
        <progress
          className="pipeline-progress-bar"
          max={100}
          value={percent}
          aria-label={t(
            `${task.titleZh} 进度 ${percent}%`,
            `${task.titleEn} progress ${percent}%`,
          )}
        />
      )}

      <div className="pipeline-tray-actions">
        {isRunning && (
          <>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={() => void openBackgroundTaskResult(task.id, { expandStream: true })}
            >
              <Terminal size={11} aria-hidden="true" />
              {t('展开实时流式输出 →', 'Watch Live Stream →')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-red"
              onClick={() => cancelBackgroundTask(task.id)}
            >
              {t('取消', 'Cancel')}
            </Button>
          </>
        )}

        {isCompleted && (
          <>
            <Button
              type="button"
              variant="accent"
              size="xs"
              onClick={() => void openBackgroundTaskResult(task.id, { keepCard: true })}
            >
              {task.kind === 'SRS_SYNTHESIS'
                ? t('立即打开需求规格书 →', 'Open SRS Document →')
                : task.kind === 'PROTOTYPE_GEN'
                  ? t('立即打开交互原型 →', 'Open Prototype →')
                  : t('查看 11 模型本体 →', 'Open 11-Model Suite →')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() =>
                void openBackgroundTaskResult(task.id, { expandStream: true, keepCard: true })
              }
            >
              {t('生成回放', 'Stream Log')}
            </Button>
          </>
        )}

        {isError && (
          <>
            <Button
              type="button"
              variant="accent"
              size="xs"
              onClick={() => void retryBackgroundTask(task.id)}
            >
              <RotateCcw size={12} aria-hidden="true" />
              {task.streamedChars >= 200 &&
              (task.kind === 'SRS_SYNTHESIS' || task.kind === 'PROTOTYPE_GEN')
                ? t('断点续写', 'Resume')
                : t('重试', 'Retry')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={() => {
                setActiveNav('llm-center');
                dismissBackgroundTask(task.id);
              }}
            >
              {t('检查网关', 'LLM Center')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Persistent cross-page background task tray rendered in App.tsx.
 * Automatically hides tasks that are ALREADY displayed inline on the current view
 * unless there is an unread completion or the user switched to another page/project!
 */
export function GlobalPipelineTaskTray({ hasActiveToast }: { hasActiveToast?: boolean }) {
  const { t } = usePreferences();
  const { data, activeNav, backgroundTasks } = useWorkbenchStore();
  const activeProjectId = data?.activeProject.id;

  const visibleTrayTasks = backgroundTasks.filter((tk) => {
    if (tk.status === 'CANCELLED') return false;
    const onInlineSrsSurface =
      tk.kind === 'SRS_SYNTHESIS' &&
      tk.projectId === activeProjectId &&
      (activeNav === 'app-req-explore' || activeNav === 'app-req-docs');
    const onInlineProtoSurface =
      tk.kind === 'PROTOTYPE_GEN' &&
      tk.projectId === activeProjectId &&
      (activeNav === 'app-req-docs' || activeNav === 'app-prototype');
    const onInlineOntoSurface =
      tk.kind === 'ONTOLOGY_SYNTH' &&
      tk.projectId === activeProjectId &&
      activeNav === 'app-prototype';

    if (onInlineSrsSurface || onInlineProtoSurface || onInlineOntoSurface) {
      return tk.unreadCompletion;
    }
    return true;
  });

  if (visibleTrayTasks.length === 0) return null;

  return (
    <section
      role="region"
      aria-label={t('后台生成任务状态栏', 'Background Generation Tasks')}
      className={cn('pipeline-tray', hasActiveToast && 'with-toast-offset')}
    >
      {visibleTrayTasks.map((tk) => (
        <TrayTaskItem key={tk.id} task={tk} />
      ))}
    </section>
  );
}
