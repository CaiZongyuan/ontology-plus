import React, { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Check,
  CheckCircle2,
  Clock,
  Code2,
  Columns2,
  Eye,
  GitCommitHorizontal,
  History,
  Layers,
  Pencil,
  RotateCcw,
  ShieldCheck,
  Star,
  X,
} from 'lucide-react';
import {
  BUSINESS_VOCABULARY,
  MODEL_BUSINESS_NAMES,
  checkBusinessViewMarkup,
} from '../../../packages/business-vocabulary/index.js';
import {
  computeMuDiff,
  extractMuFromPrototypeHtml,
  previewRevisionConfirmationMuDiff,
  type MUUiModel,
  type MuDiffStatus,
  type MuModelDiff,
  type OntologySuite,
} from '../../../packages/ontology-core/index.js';
import type {
  ConfirmedPrototypeRevision,
  InteractivePrototype,
  ProjectDetail,
  PrototypeRevision,
  PrototypeRevisionSource,
} from '../../../packages/workspace-store/index.js';
import {
  apiConfirmPrototypeRevision,
  apiRestorePrototypeRevision,
  apiUpdatePrototypeRevisionMeta,
} from '../../api.js';
import { usePreferences } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import type { StepViewMode } from '../../navigation/stepViewMode.js';
import { Button } from '../beautifui/index.js';
import { stripVisualInspectorFromHtml } from './PrototypeVisualInspector.js';
import './prototype-revision-history.css';

export function formatPrototypeLabelForBusinessView(
  raw: string | undefined,
  fallback = '',
): string {
  const source = (raw ?? '').trim();
  if (!source) return fallback;
  let cleaned = source
    .replace(
      /\s*[（(][^()（）]*\.(?:yaml|yml|json|owl|ddl|sql|md|html?|css|zip)[^()（）]*[)）]/gi,
      '',
    )
    .replace(/\.(?:yaml|yml|json|owl|ddl|sql|md|html?|css|zip)(?![A-Za-z0-9_])/gi, '')
    .replace(/(?<![A-Za-z0-9_])(?:M[1-7]|ME|MU|MM|MI|HTML5?|CSS|YAML|JSON|OWL|DDL|SQLite|SQL|Markdown)(?![A-Za-z0-9_])/gi, '')
    .replace(
      /(?<![A-Za-z0-9_-])(?:AGG|ENT|VO|DIC|DICT|ASSOC|BHV|BEH|RUL|RULE|EVT|SCN|ACT|ROL|ROLE|PERM|PGRP|FLW|FLOW|ACTV|QRY|RPT|SCR|EL|UIE|NAV|CC|MAP|INT|IF|MET|ASCN|WB)-[A-Z0-9]+(?:-[A-Z0-9]+)*(?![A-Za-z0-9_-])/g,
      '',
    )
    .replace(/\s*[()（）]\s*/g, (m) => m)
    .replace(/[（(]\s*[)）]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!cleaned || checkBusinessViewMarkup(cleaned, { plainText: true }).length > 0) {
    cleaned = fallback || '原型版本';
  }
  return cleaned;
}

export type PrototypeConfirmationViewState = 'CONFIRMED' | 'AHEAD' | 'UNCONFIRMED';

export interface PrototypeConfirmedStatusBadgeProps {
  prototype: InteractivePrototype;
  confirmedRevision?: ConfirmedPrototypeRevision | null;
  previewRevisionId?: string | null;
  onOpenConfirm?: (targetRevision: PrototypeRevision) => void;
  onOpenHistory?: () => void;
  className?: string;
}

export function resolveActivePrototypeRevision(
  prototype: InteractivePrototype,
  previewRevisionId?: string | null,
): PrototypeRevision {
  if (previewRevisionId) {
    const preview = prototype.revisions.find((r) => r.id === previewRevisionId);
    if (preview) return preview;
  }
  return (
    prototype.revisions.find((r) => r.id === prototype.currentRevisionId) ??
    prototype.revisions[prototype.revisions.length - 1]!
  );
}

export function resolveConfirmationViewState(
  prototype: InteractivePrototype,
  confirmedRevision?: ConfirmedPrototypeRevision | null,
  previewRevisionId?: string | null,
): {
  state: PrototypeConfirmationViewState;
  confirmedRevisionId?: string;
  aheadCount: number;
  activeRevision: PrototypeRevision;
  isActiveRevisionConfirmed: boolean;
} {
  const activeRevision = resolveActivePrototypeRevision(prototype, previewRevisionId);
  const confirmedRevId =
    confirmedRevision && confirmedRevision.prototypeId === prototype.id
      ? confirmedRevision.revisionId
      : prototype.isConfirmed
        ? prototype.confirmedRevisionId
        : undefined;

  const isActiveRevisionConfirmed = Boolean(confirmedRevId && activeRevision.id === confirmedRevId);

  if (!confirmedRevId) {
    return {
      state: 'UNCONFIRMED',
      aheadCount: 0,
      activeRevision,
      isActiveRevisionConfirmed: false,
    };
  }

  if (prototype.aheadOfConfirmedCount > 0 && !isActiveRevisionConfirmed) {
    return {
      state: 'AHEAD',
      confirmedRevisionId: confirmedRevId,
      aheadCount: prototype.aheadOfConfirmedCount,
      activeRevision,
      isActiveRevisionConfirmed: false,
    };
  }

  if (isActiveRevisionConfirmed && prototype.aheadOfConfirmedCount === 0) {
    return {
      state: 'CONFIRMED',
      confirmedRevisionId: confirmedRevId,
      aheadCount: 0,
      activeRevision,
      isActiveRevisionConfirmed: true,
    };
  }

  if (prototype.aheadOfConfirmedCount > 0) {
    return {
      state: 'AHEAD',
      confirmedRevisionId: confirmedRevId,
      aheadCount: prototype.aheadOfConfirmedCount,
      activeRevision,
      isActiveRevisionConfirmed,
    };
  }

  return {
    state: isActiveRevisionConfirmed ? 'CONFIRMED' : 'UNCONFIRMED',
    confirmedRevisionId: confirmedRevId,
    aheadCount: 0,
    activeRevision,
    isActiveRevisionConfirmed,
  };
}

export function PrototypeConfirmedStatusBadge({
  prototype,
  confirmedRevision,
  previewRevisionId,
  onOpenConfirm,
  onOpenHistory,
  className,
}: PrototypeConfirmedStatusBadgeProps) {
  const { t } = usePreferences();
  const {
    state,
    aheadCount,
    activeRevision,
    isActiveRevisionConfirmed,
  } = resolveConfirmationViewState(prototype, confirmedRevision, previewRevisionId);

  const confirmedRevObj = prototype.confirmedRevisionId
    ? prototype.revisions.find((r) => r.id === prototype.confirmedRevisionId)
    : undefined;

  return (
    <div
      className={cn('proto-rev-badge-bar', className)}
      data-testid="prototype-confirmed-status-badge"
      data-confirmation-state={state}
      data-ahead-count={aheadCount}
    >
      {state === 'CONFIRMED' && (
        <span className="proto-rev-status-pill is-confirmed">
          <CheckCircle2 size={12} aria-hidden="true" />
          <span>
            {t(
              `已确认修订 (#${activeRevision.revisionNumber})`,
              `Confirmed Revision (#${activeRevision.revisionNumber})`,
            )}
          </span>
        </span>
      )}

      {state === 'AHEAD' && (
        <span className="proto-rev-status-pill is-ahead">
          <GitCommitHorizontal size={12} aria-hidden="true" />
          <span>
            {t(
              `领先已确认 ${aheadCount} 条`,
              `${aheadCount} ahead of confirmed`,
            )}
            {confirmedRevObj ? ` (#${confirmedRevObj.revisionNumber})` : ''}
          </span>
        </span>
      )}

      {state === 'UNCONFIRMED' && (
        <span className="proto-rev-status-pill is-unconfirmed">
          <Clock size={12} aria-hidden="true" />
          <span>{t('未确认', 'Unconfirmed')}</span>
        </span>
      )}

      {onOpenHistory && (
        <Button
          variant="secondary"
          size="xs"
          onClick={onOpenHistory}
          data-testid="open-revision-history-btn"
        >
          <History size={12} aria-hidden="true" />
          <span>
            {t(
              `修订历史 (${prototype.revisions.length})`,
              `History (${prototype.revisions.length})`,
            )}
          </span>
        </Button>
      )}

      {onOpenConfirm && !isActiveRevisionConfirmed && (
        <Button
          variant="accent"
          size="xs"
          onClick={() => onOpenConfirm(activeRevision)}
          data-testid="confirm-this-revision-btn"
        >
          <CheckCircle2 size={12} aria-hidden="true" />
          <span>{t('确认此修订', 'Confirm This Revision')}</span>
        </Button>
      )}
    </div>
  );
}

// ─── Structured MU Diff Summary Panel ────────────────────────────────────────

export interface MuDiffSummaryPanelProps {
  diff: MuModelDiff;
  nextMu: MUUiModel;
  testId?: string;
  className?: string;
}

function diffStatusBadgeClass(status: MuDiffStatus): string {
  if (status === 'ADDED') return 'mu-diff-badge-added';
  if (status === 'REMOVED') return 'mu-diff-badge-removed';
  if (status === 'MODIFIED') return 'mu-diff-badge-modified';
  return 'filter-status-todo';
}

function formatDiffStatusLabel(
  status: MuDiffStatus,
  t: (zh: string, en: string) => string,
): string {
  switch (status) {
    case 'ADDED':
      return t('新增', 'Added');
    case 'REMOVED':
      return t('删除', 'Removed');
    case 'MODIFIED':
      return t('变更', 'Modified');
    case 'UNCHANGED':
    default:
      return t('未变', 'Unchanged');
  }
}

export function MuDiffSummaryPanel({
  diff,
  nextMu,
  testId = 'mu-diff-summary-panel',
  className,
}: MuDiffSummaryPanelProps) {
  const { t } = usePreferences();
  const { summary } = diff;
  const changedScreens = diff.screens.filter((sc) => sc.status !== 'UNCHANGED');

  return (
    <div className={cn('space-y-3', className)} data-testid={testId}>
      <div className="flex items-center flex-wrap gap-1.5 text-[11.5px]">
        <span className="px-2 py-0.5 rounded-full mu-diff-badge-added font-mono">
          +{summary.addedScreens} {t('屏幕', 'Screens')}
        </span>
        <span className="px-2 py-0.5 rounded-full mu-diff-badge-removed font-mono">
          -{summary.removedScreens} {t('屏幕', 'Screens')}
        </span>
        <span className="px-2 py-0.5 rounded-full mu-diff-badge-modified font-mono">
          ~{summary.modifiedScreens} {t('屏幕', 'Screens')}
        </span>
        <span className="text-faint-foreground">·</span>
        <span className="px-2 py-0.5 rounded-full bg-muted border border-border text-foreground-soft font-mono">
          +{summary.addedElements} / -{summary.removedElements} / ~{summary.modifiedElements}{' '}
          {t('元素', 'Elements')}
        </span>
        <span className="px-2 py-0.5 rounded-full bg-muted border border-border text-foreground-soft font-mono">
          +{summary.addedEvents} / -{summary.removedEvents} / ~{summary.modifiedEvents}{' '}
          {t('事件', 'Events')}
        </span>
      </div>

      {!summary.hasChanges ? (
        <div
          className="rounded-md border border-border bg-muted px-3.5 py-3 text-[12.5px] text-foreground-soft"
          data-testid="mu-diff-empty-state"
        >
          {nextMu.screens.length === 0
            ? t(
                '此修订未包含语义屏幕锚点（data-screen-id），确认后 MU 屏幕列表为空。',
                'No semantic screen anchors (data-screen-id) found in this revision; MU screens will be empty.',
              )
            : t(
                'MU 语义锚点无变化：屏幕、数据绑定元素与事件调用链与基准完全一致（仅视觉样式或静态文案调整）。',
                'No MU semantic changes: screens, data-bound elements, and UI event call chains are identical (visual or copy changes only).',
              )}
        </div>
      ) : (
        <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
          {changedScreens.map((sc) => {
            const changedElements = sc.elements.filter((e) => e.status !== 'UNCHANGED');
            const changedEvents = sc.events.filter((ev) => ev.status !== 'UNCHANGED');

            return (
              <div
                key={sc.screenId}
                className="rounded-md border border-border bg-card p-3 space-y-2"
                data-testid={`mu-diff-screen-${sc.screenId}`}
                data-diff-status={sc.status}
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center flex-wrap gap-1.5">
                    <span
                      className={cn(
                        'px-1.5 py-0.5 rounded text-[11px] font-medium',
                        diffStatusBadgeClass(sc.status),
                      )}
                    >
                      {formatDiffStatusLabel(sc.status, t)}
                    </span>
                    <span className="font-semibold text-[13px] text-foreground">{sc.name}</span>
                    <code className="font-mono text-[11.5px] text-faint-foreground">({sc.screenId})</code>
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted border border-border text-faint-foreground font-mono">
                      {sc.screenType}
                    </span>
                  </div>
                </div>

                {sc.changedFields.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 text-[11.5px] text-foreground-soft">
                    {sc.changedFields.map((chg) => (
                      <span
                        key={chg.field}
                        className="px-1.5 py-0.5 rounded bg-muted border border-border font-mono"
                      >
                        {chg.field}: {chg.before} → {chg.after}
                      </span>
                    ))}
                  </div>
                )}

                {changedElements.length > 0 && (
                  <div className="space-y-1 pt-1 border-t border-border/60">
                    <div className="text-[11px] font-medium text-faint-foreground">
                      {t('元素变更', 'Elements')} ({changedElements.length})
                    </div>
                    <ul className="list-none m-0 p-0 space-y-1">
                      {changedElements.map((el) => (
                        <li
                          key={el.elementId}
                          className="flex flex-col gap-0.5 rounded bg-muted/60 px-2 py-1 text-[12px]"
                          data-testid={`mu-diff-element-${el.elementId}`}
                          data-diff-status={el.status}
                        >
                          <div className="flex items-center flex-wrap gap-1.5">
                            <span
                              className={cn(
                                'px-1.5 py-0 rounded text-[10.5px] font-medium',
                                diffStatusBadgeClass(el.status),
                              )}
                            >
                              {formatDiffStatusLabel(el.status, t)}
                            </span>
                            <span className="font-medium text-foreground">{el.label}</span>
                            <code className="font-mono text-[11px] text-faint-foreground">
                              [{el.elementId}]
                            </code>
                            <span className="font-mono text-[11px] text-foreground-soft">
                              {el.elementType}
                            </span>
                            {el.dataBinding && (
                              <span className="font-mono text-[11px] text-primary">
                                ↳ {el.dataBinding}
                              </span>
                            )}
                          </div>
                          {el.changedFields.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 text-[11px] text-foreground-soft font-mono">
                              {el.changedFields.map((chg) => (
                                <span key={chg.field}>
                                  {chg.field}: {chg.before} → {chg.after}
                                </span>
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {changedEvents.length > 0 && (
                  <div className="space-y-1 pt-1 border-t border-border/60">
                    <div className="text-[11px] font-medium text-faint-foreground">
                      {t('UI 事件调用链变更', 'UI Events')} ({changedEvents.length})
                    </div>
                    <ul className="list-none m-0 p-0 space-y-1">
                      {changedEvents.map((ev) => (
                        <li
                          key={ev.eventId}
                          className="flex flex-col gap-0.5 rounded bg-muted/60 px-2 py-1 text-[11.5px]"
                          data-testid={`mu-diff-event-${ev.eventId}`}
                          data-diff-status={ev.status}
                        >
                          <div className="flex items-center flex-wrap gap-1.5">
                            <span
                              className={cn(
                                'px-1.5 py-0 rounded text-[10.5px] font-medium',
                                diffStatusBadgeClass(ev.status),
                              )}
                            >
                              {formatDiffStatusLabel(ev.status, t)}
                            </span>
                            <code className="font-mono font-medium text-foreground">{ev.eventId}</code>
                            <span className="text-foreground-soft">({ev.name})</span>
                          </div>
                          <div className="font-mono text-[11px] text-foreground-soft">
                            {ev.previousCallChainSummary
                              ? `${ev.previousCallChainSummary} → ${ev.callChainSummary}`
                              : ev.callChainSummary}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Side-by-Side Revision Compare View ──────────────────────────────────────

export interface PrototypeRevisionCompareViewProps {
  prototype: InteractivePrototype;
  leftRevisionId: string;
  rightRevisionId: string;
  confirmedRevisionId?: string;
  domain?: string;
  tab: CompareInspectorTab;
  onSelectLeft: (revisionId: string) => void;
  onSelectRight: (revisionId: string) => void;
  onSwap?: () => void;
  onTabChange: (tab: CompareInspectorTab) => void;
  onClose?: () => void;
  className?: string;
}

export function PrototypeRevisionCompareView({
  prototype,
  leftRevisionId,
  rightRevisionId,
  confirmedRevisionId,
  domain = 'OntologyDomain',
  tab,
  onSelectLeft,
  onSelectRight,
  onSwap,
  onTabChange,
  onClose,
  className,
}: PrototypeRevisionCompareViewProps) {
  const { t } = usePreferences();
  const orderedAsc = useMemo(
    () => [...prototype.revisions].sort((a, b) => a.revisionNumber - b.revisionNumber),
    [prototype.revisions],
  );

  const leftRev =
    orderedAsc.find((r) => r.id === leftRevisionId) ?? orderedAsc[0]!;
  const rightRev =
    orderedAsc.find((r) => r.id === rightRevisionId) ??
    orderedAsc[orderedAsc.length - 1]!;

  const { rightMu, pairDiff } = useMemo(() => {
    const lMu = extractMuFromPrototypeHtml(leftRev.htmlContent, domain);
    const rMu = extractMuFromPrototypeHtml(rightRev.htmlContent, domain);
    return {
      rightMu: rMu,
      pairDiff: computeMuDiff(lMu, rMu),
    };
  }, [leftRev.htmlContent, rightRev.htmlContent, domain]);

  const leftCleanHtml = useMemo(
    () => stripVisualInspectorFromHtml(leftRev.htmlContent),
    [leftRev.htmlContent],
  );
  const rightCleanHtml = useMemo(
    () => stripVisualInspectorFromHtml(rightRev.htmlContent),
    [rightRev.htmlContent],
  );

  const leftLines = useMemo(() => leftCleanHtml.split(/\r?\n/), [leftCleanHtml]);
  const rightLines = useMemo(() => rightCleanHtml.split(/\r?\n/), [rightCleanHtml]);

  return (
    <div
      className={cn('border-b border-border bg-muted/45 p-3.5 space-y-3', className)}
      data-testid="revision-side-by-side-compare"
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center flex-wrap gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-foreground-soft">
            <span>{t('基准修订', 'Left')}</span>
            <select
              value={leftRev.id}
              onChange={(e) => onSelectLeft(e.target.value)}
              className="h-7 px-2 rounded-sm border border-border bg-card text-[12px] text-foreground"
              data-testid="compare-left-revision-select"
            >
              {orderedAsc.map((rev) => (
                <option key={rev.id} value={rev.id}>
                  #{rev.revisionNumber} · {rev.title}
                  {confirmedRevisionId === rev.id
                    ? ` (${t('已确认', 'Confirmed')})`
                    : ''}
                </option>
              ))}
            </select>
          </label>

          {onSwap && (
            <Button
              variant="ghost"
              size="xs"
              onClick={onSwap}
              aria-label={t('交换左右对比修订', 'Swap compared revisions')}
              data-testid="compare-swap-revisions-btn"
            >
              <ArrowLeftRight size={12} aria-hidden="true" />
            </Button>
          )}

          <label className="flex items-center gap-1.5 text-[12px] text-foreground-soft">
            <span>{t('对比修订', 'Right')}</span>
            <select
              value={rightRev.id}
              onChange={(e) => onSelectRight(e.target.value)}
              className="h-7 px-2 rounded-sm border border-border bg-card text-[12px] text-foreground"
              data-testid="compare-right-revision-select"
            >
              {orderedAsc.map((rev) => (
                <option key={rev.id} value={rev.id}>
                  #{rev.revisionNumber} · {rev.title}
                  {confirmedRevisionId === rev.id
                    ? ` (${t('已确认', 'Confirmed')})`
                    : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="toggle"
            size="xs"
            aria-pressed={tab === 'VISUAL_AND_MU'}
            onClick={() => onTabChange('VISUAL_AND_MU')}
            data-testid="compare-tab-mu-btn"
          >
            <Layers size={12} aria-hidden="true" />
            <span>{t('画布与 MU 差异', 'Visual & MU Diff')}</span>
          </Button>
          <Button
            variant="toggle"
            size="xs"
            aria-pressed={tab === 'HTML'}
            onClick={() => onTabChange('HTML')}
            data-testid="compare-tab-html-btn"
          >
            <Code2 size={12} aria-hidden="true" />
            <span>{t('HTML 源码对比', 'HTML Source')}</span>
          </Button>
          {onClose && (
            <Button
              variant="ghost"
              size="xs"
              onClick={onClose}
              data-testid="compare-close-btn"
            >
              <X size={12} aria-hidden="true" />
              <span>{t('收起对比', 'Close Compare')}</span>
            </Button>
          )}
        </div>
      </div>

      <div className="proto-rev-compare-grid">
        <div className="proto-rev-compare-pane">
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border text-[12px]">
            <span className="font-medium text-foreground truncate">
              #{leftRev.revisionNumber} · {leftRev.title}
            </span>
            {confirmedRevisionId === leftRev.id && (
              <span className="proto-rev-status-pill is-confirmed">
                {t('已确认修订', 'Confirmed')}
              </span>
            )}
          </div>
          <iframe
            sandbox="allow-scripts"
            srcDoc={leftCleanHtml}
            title={t(
              `左栏修订 #${leftRev.revisionNumber} 预览`,
              `Left revision #${leftRev.revisionNumber} preview`,
            )}
            className="proto-rev-compare-iframe"
            data-testid="compare-left-iframe"
          />
        </div>

        <div className="proto-rev-compare-pane">
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border text-[12px]">
            <span className="font-medium text-foreground truncate">
              #{rightRev.revisionNumber} · {rightRev.title}
            </span>
            {confirmedRevisionId === rightRev.id && (
              <span className="proto-rev-status-pill is-confirmed">
                {t('已确认修订', 'Confirmed')}
              </span>
            )}
          </div>
          <iframe
            sandbox="allow-scripts"
            srcDoc={rightCleanHtml}
            title={t(
              `右栏修订 #${rightRev.revisionNumber} 预览`,
              `Right revision #${rightRev.revisionNumber} preview`,
            )}
            className="proto-rev-compare-iframe"
            data-testid="compare-right-iframe"
          />
        </div>
      </div>

      {tab === 'VISUAL_AND_MU' ? (
        <MuDiffSummaryPanel
          diff={pairDiff}
          nextMu={rightMu}
          testId="compare-mu-diff-section"
        />
      ) : (
        <div
          className="space-y-2"
          data-testid="compare-html-diff-section"
        >
          <div className="text-[11.5px] text-faint-foreground font-mono">
            {t(
              `左栏 #${leftRev.revisionNumber}：${leftLines.length} 行（${leftCleanHtml.length} 字符） · 右栏 #${rightRev.revisionNumber}：${rightLines.length} 行（${rightCleanHtml.length} 字符）`,
              `Left #${leftRev.revisionNumber}: ${leftLines.length} lines (${leftCleanHtml.length} chars) · Right #${rightRev.revisionNumber}: ${rightLines.length} lines (${rightCleanHtml.length} chars)`,
            )}
          </div>
          <div className="proto-rev-compare-grid">
            <pre className="m-0 max-h-[200px] overflow-auto rounded-sm border border-border bg-card p-2.5 font-mono text-[11px] text-foreground-soft">
              {leftCleanHtml}
            </pre>
            <pre className="m-0 max-h-[200px] overflow-auto rounded-sm border border-border bg-card p-2.5 font-mono text-[11px] text-foreground-soft">
              {rightCleanHtml}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Revision History View State & Reducer ───────────────────────────────────

export type CompareInspectorTab = 'VISUAL_AND_MU' | 'HTML';

export interface RevisionHistoryViewState {
  renamingRevisionId: string | null;
  renameDraft: string;
  starredOnly: boolean;
  compareOpen: boolean;
  leftRevisionId: string;
  rightRevisionId: string;
  compareTab: CompareInspectorTab;
  confirmTargetRevisionId: string | null;
}

export type RevisionHistoryViewAction =
  | { type: 'START_RENAME'; revisionId: string; currentTitle: string }
  | { type: 'CHANGE_RENAME_DRAFT'; draft: string }
  | { type: 'FINISH_RENAME' }
  | { type: 'CANCEL_RENAME' }
  | { type: 'TOGGLE_STARRED_FILTER' }
  | {
      type: 'OPEN_COMPARE';
      leftRevisionId?: string;
      rightRevisionId?: string;
    }
  | { type: 'CLOSE_COMPARE' }
  | { type: 'SET_COMPARE_LEFT'; revisionId: string }
  | { type: 'SET_COMPARE_RIGHT'; revisionId: string }
  | { type: 'SWAP_COMPARE_REVISIONS' }
  | { type: 'SET_COMPARE_TAB'; tab: CompareInspectorTab }
  | { type: 'OPEN_CONFIRM_MODAL'; revisionId: string }
  | { type: 'CLOSE_CONFIRM_MODAL' };

export function deriveDefaultComparePair(
  prototype: InteractivePrototype,
): { leftRevisionId: string; rightRevisionId: string } {
  const ordered = [...prototype.revisions].sort((a, b) => a.revisionNumber - b.revisionNumber);
  const right =
    ordered.find((r) => r.id === prototype.currentRevisionId) ??
    ordered[ordered.length - 1];
  const confirmed = prototype.confirmedRevisionId
    ? ordered.find((r) => r.id === prototype.confirmedRevisionId)
    : undefined;

  if (confirmed && right && confirmed.id !== right.id) {
    return { leftRevisionId: confirmed.id, rightRevisionId: right.id };
  }
  if (ordered.length >= 2) {
    return {
      leftRevisionId: ordered[ordered.length - 2]!.id,
      rightRevisionId: ordered[ordered.length - 1]!.id,
    };
  }
  const singleId = ordered[0]?.id ?? '';
  return { leftRevisionId: singleId, rightRevisionId: singleId };
}

export function createInitialRevisionHistoryViewState(
  prototype: InteractivePrototype,
  opts?: {
    starredOnly?: boolean;
    comparePair?: { leftRevisionId: string; rightRevisionId: string } | null;
  },
): RevisionHistoryViewState {
  const defaultPair = opts?.comparePair ?? deriveDefaultComparePair(prototype);
  return {
    renamingRevisionId: null,
    renameDraft: '',
    starredOnly: Boolean(opts?.starredOnly),
    compareOpen: Boolean(opts?.comparePair),
    leftRevisionId: defaultPair.leftRevisionId,
    rightRevisionId: defaultPair.rightRevisionId,
    compareTab: 'VISUAL_AND_MU',
    confirmTargetRevisionId: null,
  };
}

export function revisionHistoryViewReducer(
  state: RevisionHistoryViewState,
  action: RevisionHistoryViewAction,
): RevisionHistoryViewState {
  switch (action.type) {
    case 'START_RENAME':
      return {
        ...state,
        renamingRevisionId: action.revisionId,
        renameDraft: action.currentTitle,
      };
    case 'CHANGE_RENAME_DRAFT':
      return {
        ...state,
        renameDraft: action.draft,
      };
    case 'FINISH_RENAME':
    case 'CANCEL_RENAME':
      return {
        ...state,
        renamingRevisionId: null,
        renameDraft: '',
      };
    case 'TOGGLE_STARRED_FILTER':
      return {
        ...state,
        starredOnly: !state.starredOnly,
      };
    case 'OPEN_COMPARE':
      return {
        ...state,
        compareOpen: true,
        leftRevisionId: action.leftRevisionId ?? state.leftRevisionId,
        rightRevisionId: action.rightRevisionId ?? state.rightRevisionId,
      };
    case 'CLOSE_COMPARE':
      return {
        ...state,
        compareOpen: false,
      };
    case 'SET_COMPARE_LEFT':
      return {
        ...state,
        leftRevisionId: action.revisionId,
      };
    case 'SET_COMPARE_RIGHT':
      return {
        ...state,
        rightRevisionId: action.revisionId,
      };
    case 'SWAP_COMPARE_REVISIONS':
      return {
        ...state,
        leftRevisionId: state.rightRevisionId,
        rightRevisionId: state.leftRevisionId,
      };
    case 'SET_COMPARE_TAB':
      return {
        ...state,
        compareTab: action.tab,
      };
    case 'OPEN_CONFIRM_MODAL':
      return {
        ...state,
        confirmTargetRevisionId: action.revisionId,
      };
    case 'CLOSE_CONFIRM_MODAL':
      return {
        ...state,
        confirmTargetRevisionId: null,
      };
  }
}

function formatRevisionSourceBadge(
  source: PrototypeRevisionSource,
  t: (zh: string, en: string) => string,
): string {
  switch (source) {
    case 'GENERATED':
      return t('AI 生成', 'Generated');
    case 'AGENT_RUN':
      return t('AI 助手修改', 'AI Assistant');
    case 'REFINED':
      return t('AI 精修', 'Refined');
    case 'UPLOADED':
      return t('外部导入', 'Uploaded');
    case 'RESTORED':
      return t('历史恢复', 'Restored');
    case 'CLONED':
      return t('另存基线', 'Cloned');
    case 'MIGRATED':
      return t('迁移基线', 'Migrated');
    case 'MANUAL_SAVE':
    default:
      return t('手动保存', 'Manual Save');
  }
}

function formatRevisionTimestamp(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}`;
}

export interface PrototypeRevisionHistoryDrawerProps {
  open?: boolean;
  prototype: InteractivePrototype;
  confirmedRevision?: ConfirmedPrototypeRevision | null;
  currentMu?: MUUiModel;
  domain?: string;
  previewRevisionId?: string | null;
  busyRevisionId?: string | null;
  viewMode?: StepViewMode;
  viewState?: RevisionHistoryViewState;
  onViewStateChange?: (next: RevisionHistoryViewState) => void;
  onClose?: () => void;
  onSelectPreviewRevision: (revisionId: string | null) => void;
  onRestoreRevision: (revisionId: string) => void | Promise<void>;
  onRenameRevision: (revisionId: string, newTitle: string) => void | Promise<void>;
  onToggleStarRevision: (revisionId: string, nextStarred: boolean) => void | Promise<void>;
  onRequestConfirmRevision: (revision: PrototypeRevision) => void;
  className?: string;
}

export function PrototypeRevisionHistoryDrawer({
  open = true,
  prototype,
  confirmedRevision,
  domain,
  previewRevisionId = null,
  busyRevisionId = null,
  viewMode = 'technical',
  viewState: controlledViewState,
  onViewStateChange,
  onClose,
  onSelectPreviewRevision,
  onRestoreRevision,
  onRenameRevision,
  onToggleStarRevision,
  onRequestConfirmRevision,
  className,
}: PrototypeRevisionHistoryDrawerProps) {
  const { t } = usePreferences();
  const isBusinessView = viewMode === 'business';
  const [internalState, internalDispatch] = useReducer(
    revisionHistoryViewReducer,
    prototype,
    (proto) => createInitialRevisionHistoryViewState(proto),
  );

  const state = controlledViewState ?? internalState;
  const dispatch = (action: RevisionHistoryViewAction) => {
    if (controlledViewState && onViewStateChange) {
      onViewStateChange(revisionHistoryViewReducer(controlledViewState, action));
    } else {
      internalDispatch(action);
    }
  };

  if (!open) return null;

  const confirmedRevIdOnThisProto =
    confirmedRevision && confirmedRevision.prototypeId === prototype.id
      ? confirmedRevision.revisionId
      : prototype.isConfirmed
        ? prototype.confirmedRevisionId
        : undefined;

  const orderedDesc = [...prototype.revisions].sort(
    (a, b) => b.revisionNumber - a.revisionNumber,
  );
  const visibleRevisions = state.starredOnly
    ? orderedDesc.filter((r) => Boolean(r.starred))
    : orderedDesc;

  const previewingRevision = previewRevisionId
    ? prototype.revisions.find((r) => r.id === previewRevisionId)
    : undefined;

  const displayProtoName = isBusinessView
    ? formatPrototypeLabelForBusinessView(prototype.name, t('当前原型', 'Current prototype'))
    : prototype.name;

  return (
    <section
      className={cn('proto-rev-drawer', className)}
      data-testid="prototype-revision-history-drawer"
      aria-label={t(`修订历史 · ${displayProtoName}`, `Revision History · ${displayProtoName}`)}
    >
      <header className="proto-rev-drawer-header">
        <div className="flex items-center gap-2 min-w-0">
          <History size={15} className="text-primary shrink-0" aria-hidden="true" />
          <h3 className="m-0 text-[13.5px] font-semibold text-foreground truncate">
            {t('修订历史', 'Revision History')}
          </h3>
          <span className="text-[11.5px] text-faint-foreground font-mono">
            ({prototype.revisions.length})
          </span>
          {prototype.isConfirmed && prototype.aheadOfConfirmedCount > 0 && (
            <span
              className="proto-rev-status-pill is-ahead"
              data-testid="drawer-ahead-of-confirmed-badge"
            >
              {t(
                `领先已确认 ${prototype.aheadOfConfirmedCount} 条`,
                `${prototype.aheadOfConfirmedCount} ahead of confirmed`,
              )}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <Button
            variant="toggle"
            size="xs"
            aria-pressed={state.starredOnly}
            onClick={() => dispatch({ type: 'TOGGLE_STARRED_FILTER' })}
            data-testid="revision-filter-starred-btn"
          >
            <Star size={12} aria-hidden="true" />
            <span>{t('仅看标星', 'Starred')}</span>
          </Button>

          {prototype.revisions.length >= 2 && (
            <Button
              variant="toggle"
              size="xs"
              aria-pressed={state.compareOpen}
              onClick={() => {
                if (state.compareOpen) {
                  dispatch({ type: 'CLOSE_COMPARE' });
                } else {
                  const pair = deriveDefaultComparePair(prototype);
                  dispatch({
                    type: 'OPEN_COMPARE',
                    leftRevisionId: state.leftRevisionId || pair.leftRevisionId,
                    rightRevisionId: state.rightRevisionId || pair.rightRevisionId,
                  });
                }
              }}
              data-testid="revision-toggle-compare-btn"
            >
              <Columns2 size={12} aria-hidden="true" />
              <span>{t('并排对比', 'Compare Side by Side')}</span>
            </Button>
          )}

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t('关闭修订历史', 'Close revision history')}
              className="primitive-icon-button text-faint-foreground hover:bg-accent hover:text-foreground"
              data-testid="revision-drawer-close-btn"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </header>

      {previewingRevision && previewingRevision.id !== prototype.currentRevisionId && (
        <div
          className="flex items-center justify-between gap-2 border-b border-border bg-primary-soft px-3.5 py-2 text-[12px] text-foreground"
          role="status"
          data-testid="revision-preview-banner"
        >
          <span>
            {t(
              `正在预览历史修订 #${previewingRevision.revisionNumber}「${previewingRevision.title}」（未改写历史）`,
              `Previewing historical revision #${previewingRevision.revisionNumber} "${previewingRevision.title}" (history unchanged)`,
            )}
          </span>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => onSelectPreviewRevision(null)}
            data-testid="revision-exit-preview-btn"
          >
            {t('返回最新修订', 'Back to Latest')}
          </Button>
        </div>
      )}

      {confirmedRevision && confirmedRevision.prototypeId !== prototype.id && (
        <div
          className="border-b border-border bg-muted px-3.5 py-2 text-[11.5px] text-foreground-soft"
          data-testid="other-prototype-confirmed-banner"
        >
          {t(
            `当前工程已确认修订位于「${confirmedRevision.prototype.name}」#${confirmedRevision.revision.revisionNumber}`,
            `Project Confirmed Revision is on "${confirmedRevision.prototype.name}" #${confirmedRevision.revision.revisionNumber}`,
          )}
        </div>
      )}

      {state.compareOpen && prototype.revisions.length >= 2 && (
        <PrototypeRevisionCompareView
          prototype={prototype}
          leftRevisionId={state.leftRevisionId}
          rightRevisionId={state.rightRevisionId}
          confirmedRevisionId={confirmedRevIdOnThisProto}
          domain={domain}
          tab={state.compareTab}
          onSelectLeft={(revisionId) => dispatch({ type: 'SET_COMPARE_LEFT', revisionId })}
          onSelectRight={(revisionId) => dispatch({ type: 'SET_COMPARE_RIGHT', revisionId })}
          onSwap={() => dispatch({ type: 'SWAP_COMPARE_REVISIONS' })}
          onTabChange={(tab) => dispatch({ type: 'SET_COMPARE_TAB', tab })}
          onClose={() => dispatch({ type: 'CLOSE_COMPARE' })}
        />
      )}

      <ol className="proto-rev-timeline" data-testid="revision-timeline-list">
        {visibleRevisions.length === 0 ? (
          <li
            className="py-6 text-center text-[12.5px] text-faint-foreground"
            data-testid="revision-timeline-empty"
          >
            {state.starredOnly
              ? t('暂无已标星的原型修订。', 'No starred prototype revisions yet.')
              : t('暂无原型修订记录。', 'No prototype revisions yet.')}
          </li>
        ) : (
          visibleRevisions.map((rev) => {
            const isConfirmed = confirmedRevIdOnThisProto === rev.id;
            const isLatest = rev.id === prototype.currentRevisionId;
            const isPreviewing = previewRevisionId
              ? previewRevisionId === rev.id
              : isLatest;
            const isRenaming = state.renamingRevisionId === rev.id;
            const isBusy = busyRevisionId === rev.id;

            return (
              <li
                key={rev.id}
                className={cn(
                  'proto-rev-timeline-item',
                  isConfirmed && 'is-confirmed',
                  isPreviewing && 'is-previewing',
                )}
                data-testid={`revision-timeline-item-${rev.revisionNumber}`}
                data-revision-id={rev.id}
                data-revision-number={rev.revisionNumber}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center flex-wrap gap-1.5 min-w-0">
                    <span className="font-mono text-[11.5px] font-semibold text-foreground px-1.5 py-0.5 rounded bg-muted border border-border">
                      #{rev.revisionNumber}
                    </span>

                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-foreground-soft border border-border">
                      {formatRevisionSourceBadge(rev.source, t)}
                    </span>

                    {isLatest && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded filter-status-accent">
                        {t('当前最新', 'Latest')}
                      </span>
                    )}

                    {isConfirmed && (
                      <span
                        className="proto-rev-status-pill is-confirmed"
                        data-testid={`revision-confirmed-badge-${rev.revisionNumber}`}
                      >
                        <CheckCircle2 size={11} aria-hidden="true" />
                        <span>
                          {isBusinessView
                            ? t(
                                BUSINESS_VOCABULARY.CONFIRMED_REVISION.zh,
                                BUSINESS_VOCABULARY.CONFIRMED_REVISION.en,
                              )
                            : t('已确认修订', 'Confirmed Revision')}
                        </span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      aria-pressed={Boolean(rev.starred)}
                      aria-label={
                        rev.starred
                          ? t(`取消标星修订 #${rev.revisionNumber}`, `Unstar revision #${rev.revisionNumber}`)
                          : t(`标星修订 #${rev.revisionNumber}`, `Star revision #${rev.revisionNumber}`)
                      }
                      onClick={() => void onToggleStarRevision(rev.id, !rev.starred)}
                      disabled={isBusy}
                      className={cn(
                        'primitive-icon-button text-faint-foreground hover:bg-accent hover:text-foreground',
                        rev.starred && 'text-warning',
                      )}
                      data-testid={`revision-star-btn-${rev.revisionNumber}`}
                    >
                      <Star
                        size={13}
                        fill={rev.starred ? 'currentColor' : 'none'}
                        aria-hidden="true"
                      />
                    </button>

                    {!isRenaming && (
                      <button
                        type="button"
                        aria-label={t(`重命名修订 #${rev.revisionNumber}`, `Rename revision #${rev.revisionNumber}`)}
                        onClick={() =>
                          dispatch({
                            type: 'START_RENAME',
                            revisionId: rev.id,
                            currentTitle: rev.title,
                          })
                        }
                        disabled={isBusy}
                        className="primitive-icon-button text-faint-foreground hover:bg-accent hover:text-foreground"
                        data-testid={`revision-rename-btn-${rev.revisionNumber}`}
                      >
                        <Pencil size={12.5} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>

                {isRenaming ? (
                  <form
                    className="flex items-center gap-1.5 mt-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const trimmed = state.renameDraft.trim();
                      if (trimmed) {
                        void onRenameRevision(rev.id, trimmed);
                      }
                      dispatch({ type: 'FINISH_RENAME' });
                    }}
                    data-testid={`revision-rename-form-${rev.revisionNumber}`}
                  >
                    <input
                      type="text"
                      value={state.renameDraft}
                      onChange={(e) =>
                        dispatch({ type: 'CHANGE_RENAME_DRAFT', draft: e.target.value })
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          dispatch({ type: 'CANCEL_RENAME' });
                        }
                      }}
                      aria-label={t('修订名称', 'Revision title')}
                      className="flex-1 min-w-0 h-7 px-2 rounded-sm border border-border bg-muted text-[12.5px] text-foreground"
                      data-testid={`revision-rename-input-${rev.revisionNumber}`}
                    />
                    <Button
                      type="submit"
                      variant="accent"
                      size="xs"
                      disabled={!state.renameDraft.trim()}
                      data-testid={`revision-rename-save-btn-${rev.revisionNumber}`}
                    >
                      <Check size={12} aria-hidden="true" />
                      <span>{t('保存', 'Save')}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => dispatch({ type: 'CANCEL_RENAME' })}
                      data-testid={`revision-rename-cancel-btn-${rev.revisionNumber}`}
                    >
                      {t('取消', 'Cancel')}
                    </Button>
                  </form>
                ) : (
                  <div className="text-[13px] font-medium text-foreground leading-snug">
                    {isBusinessView
                      ? formatPrototypeLabelForBusinessView(
                          rev.title,
                          t(`第 ${rev.revisionNumber} 版`, `Revision #${rev.revisionNumber}`),
                        )
                      : rev.title}
                  </div>
                )}

                <div className="flex items-center justify-between flex-wrap gap-2 text-[12px] text-faint-foreground">
                  <div className="flex items-center gap-2">
                    <time dateTime={rev.createdAt}>{formatRevisionTimestamp(rev.createdAt)}</time>
                    <span>·</span>
                    <span>
                      {t(
                        `${rev.extractedScreenCount} 个${MODEL_BUSINESS_NAMES.MU.zh}`,
                        `${rev.extractedScreenCount} screens`,
                      )}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Button
                      variant={isPreviewing && !isLatest ? 'accent' : 'ghost'}
                      size="xs"
                      onClick={() => onSelectPreviewRevision(isLatest ? null : rev.id)}
                      disabled={isBusy}
                      data-testid={`revision-preview-btn-${rev.revisionNumber}`}
                    >
                      <Eye size={12} aria-hidden="true" />
                      <span>
                        {isPreviewing && !isLatest
                          ? t('预览中', 'Previewing')
                          : t('预览', 'Preview')}
                      </span>
                    </Button>

                    {prototype.revisions.length >= 2 && (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          const rightId =
                            rev.id === prototype.currentRevisionId
                              ? orderedDesc.find((r) => r.id !== rev.id)?.id ?? rev.id
                              : prototype.currentRevisionId;
                          dispatch({
                            type: 'OPEN_COMPARE',
                            leftRevisionId: rev.id,
                            rightRevisionId: rightId,
                          });
                        }}
                        disabled={isBusy}
                        data-testid={`revision-compare-with-latest-btn-${rev.revisionNumber}`}
                      >
                        <Columns2 size={12} aria-hidden="true" />
                        <span>{t('对比', 'Compare')}</span>
                      </Button>
                    )}

                    {!isLatest && (
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => void onRestoreRevision(rev.id)}
                        disabled={isBusy}
                        data-testid={`revision-restore-btn-${rev.revisionNumber}`}
                      >
                        <RotateCcw size={12} aria-hidden="true" />
                        <span>{t('恢复', 'Restore')}</span>
                      </Button>
                    )}

                    {!isConfirmed && (
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => onRequestConfirmRevision(rev)}
                        disabled={isBusy}
                        data-testid={`revision-confirm-btn-${rev.revisionNumber}`}
                      >
                        <CheckCircle2 size={12} aria-hidden="true" />
                        <span>{t('确认此修订', 'Confirm This Revision')}</span>
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })
        )}
      </ol>
    </section>
  );
}

// ─── Confirm Revision with MU Diff Modal & Safeguard Helpers ─────────────────

const NON_MU_MODEL_KEYS: (keyof OntologySuite)[] = [
  'M1',
  'M2',
  'M3',
  'ME',
  'M4',
  'M5',
  'M6',
  'M7',
  'MM',
  'MI',
];

export function hasNonMuOntologyModels(suite: OntologySuite | undefined): boolean {
  if (!suite) return false;
  return NON_MU_MODEL_KEYS.some((key) => Boolean(suite[key]));
}

// ─── Business-Language Screen Changes Panel (User Story 24) ──────────────────

function formatBusinessScreenType(
  screenType: string | undefined,
  t: (zh: string, en: string) => string,
): string {
  switch ((screenType ?? '').toUpperCase()) {
    case 'LIST':
      return t('列表页面', 'List screen');
    case 'FORM':
      return t('录入表单', 'Form screen');
    case 'DETAIL':
      return t('详情页面', 'Detail screen');
    case 'APPROVAL':
      return t('审批页面', 'Approval screen');
    case 'DASHBOARD':
      return t('总览看板', 'Dashboard');
    case 'MODAL':
      return t('弹窗页面', 'Dialog');
    case 'WORKSPACE':
      return t('工作台页面', 'Workspace');
    default:
      return t(MODEL_BUSINESS_NAMES.MU.singularZh, MODEL_BUSINESS_NAMES.MU.singularEn);
  }
}

function formatBusinessElementType(
  elementType: string | undefined,
  t: (zh: string, en: string) => string,
): string {
  switch ((elementType ?? '').toUpperCase()) {
    case 'BUTTON':
      return t('按钮', 'button');
    case 'INPUT':
    case 'TEXTAREA':
      return t('输入项', 'field');
    case 'SELECT':
      return t('下拉选项', 'selector');
    case 'TABLE':
      return t('表格', 'table');
    case 'FORM':
      return t('表单区', 'form');
    case 'CARD':
      return t('卡片区', 'card');
    default:
      return t('界面元素', 'item');
  }
}

export interface ScreenChangesBusinessPanelProps {
  diff: MuModelDiff;
  nextMu: MUUiModel;
  testId?: string;
  className?: string;
}

export function ScreenChangesBusinessPanel({
  diff,
  nextMu,
  testId = 'confirm-screen-changes-list',
  className,
}: ScreenChangesBusinessPanelProps) {
  const { locale, t } = usePreferences();
  const { summary } = diff;
  const changedScreens = diff.screens.filter((sc) => sc.status !== 'UNCHANGED');
  const quote = (label: string) => (locale === 'en-US' ? `"${label}"` : `「${label}」`);

  return (
    <div className={cn('space-y-2.5', className)} data-testid={testId}>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        {summary.addedScreens > 0 && (
          <span className="rounded-full px-2.5 py-0.5 font-medium mu-diff-badge-added">
            {t(
              `新增 ${summary.addedScreens} 个${MODEL_BUSINESS_NAMES.MU.zh}`,
              `${summary.addedScreens} ${summary.addedScreens === 1 ? 'screen' : 'screens'} added`,
            )}
          </span>
        )}
        {summary.modifiedScreens > 0 && (
          <span className="rounded-full px-2.5 py-0.5 font-medium mu-diff-badge-modified">
            {t(
              `调整 ${summary.modifiedScreens} 个${MODEL_BUSINESS_NAMES.MU.zh}`,
              `${summary.modifiedScreens} ${summary.modifiedScreens === 1 ? 'screen' : 'screens'} updated`,
            )}
          </span>
        )}
        {summary.removedScreens > 0 && (
          <span className="rounded-full px-2.5 py-0.5 font-medium mu-diff-badge-removed">
            {t(
              `移除 ${summary.removedScreens} 个${MODEL_BUSINESS_NAMES.MU.zh}`,
              `${summary.removedScreens} ${summary.removedScreens === 1 ? 'screen' : 'screens'} removed`,
            )}
          </span>
        )}
        {!summary.hasChanges && (
          <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-muted-foreground">
            {t('界面结构无变化', 'No screen structure changes')}
          </span>
        )}
      </div>

      {!summary.hasChanges ? (
        <div
          className="rounded-md border border-border bg-muted px-3.5 py-3 text-[13px] text-foreground-soft"
          data-testid="screen-changes-empty-state"
        >
          {nextMu.screens.length === 0
            ? t(
                '当前原型包含整体预览画面，确认后将记录为当前已确认的原型。',
                'Confirming records this prototype as the confirmed prototype for downstream steps.',
              )
            : t(
                '界面结构、字段和按钮与上次确认时一致（仅调整了视觉样式或说明文字）。',
                'Screens, fields, and actions match the last confirmed prototype (visual or copy refinements only).',
              )}
        </div>
      ) : (
        <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
          {changedScreens.map((sc) => {
            const screenTitle = formatPrototypeLabelForBusinessView(
              sc.name,
              t('未命名界面', 'Untitled screen'),
            );
            const changedElements = sc.elements.filter((e) => e.status !== 'UNCHANGED');
            const changedEvents = sc.events.filter((ev) => ev.status !== 'UNCHANGED');
            const itemLines: string[] = [];

            for (const el of changedElements) {
              const kindText = formatBusinessElementType(el.elementType, t);
              const elName = formatPrototypeLabelForBusinessView(
                el.label,
                t('未命名控件', 'Control'),
              );
              if (el.status === 'ADDED') {
                itemLines.push(t(`新增${kindText}${quote(elName)}`, `Added ${kindText} ${quote(elName)}`));
              } else if (el.status === 'REMOVED') {
                itemLines.push(t(`移除${kindText}${quote(elName)}`, `Removed ${kindText} ${quote(elName)}`));
              } else {
                itemLines.push(t(`调整${kindText}${quote(elName)}`, `Updated ${kindText} ${quote(elName)}`));
              }
            }

            for (const ev of changedEvents) {
              const evName = formatPrototypeLabelForBusinessView(ev.name, '');
              if (!evName) continue;
              if (ev.status === 'ADDED') {
                itemLines.push(t(`新增交互动作${quote(evName)}`, `Added interaction ${quote(evName)}`));
              } else if (ev.status === 'REMOVED') {
                itemLines.push(t(`移除交互动作${quote(evName)}`, `Removed interaction ${quote(evName)}`));
              } else {
                itemLines.push(t(`更新交互动作${quote(evName)}`, `Updated interaction ${quote(evName)}`));
              }
            }

            return (
              <div
                key={sc.screenId}
                className="space-y-1.5 rounded-md border border-border bg-card p-3"
                data-testid={`screen-change-${sc.screenId}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'rounded px-2 py-0.5 text-[12px] font-medium',
                      diffStatusBadgeClass(sc.status),
                    )}
                  >
                    {formatDiffStatusLabel(sc.status, t)}
                  </span>
                  <span className="text-[13px] font-semibold text-foreground">{screenTitle}</span>
                  <span className="rounded border border-border bg-muted px-2 py-0.5 text-[12px] text-muted-foreground">
                    {formatBusinessScreenType(sc.screenType, t)}
                  </span>
                </div>
                {itemLines.length > 0 && (
                  <ul className="m-0 list-disc space-y-1 pl-5 text-[12.5px] text-foreground-soft">
                    {itemLines.map((line, idx) => (
                      <li key={`${sc.screenId}-${idx}`}>{line}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface ConfirmRevisionMuDiffModalProps {
  open: boolean;
  revision: PrototypeRevision | null;
  prototypeName?: string;
  currentMu?: MUUiModel;
  suite?: OntologySuite;
  confirmedRevision?: ConfirmedPrototypeRevision | null;
  hasSynthesizedOntology?: boolean;
  domain: string;
  busy?: boolean;
  viewMode?: StepViewMode;
  onConfirm: (revisionId: string) => void | Promise<void>;
  onClose: () => void;
}

export function ConfirmRevisionMuDiffModal({
  open,
  revision,
  prototypeName,
  currentMu,
  suite,
  confirmedRevision,
  hasSynthesizedOntology,
  domain,
  busy = false,
  viewMode = 'business',
  onConfirm,
  onClose,
}: ConfirmRevisionMuDiffModalProps) {
  const { t } = usePreferences();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const isBusinessView = viewMode === 'business';

  const resolvedCurrentMu = currentMu ?? suite?.MU;
  const resolvedHasNonMu =
    hasSynthesizedOntology ?? hasNonMuOntologyModels(suite);

  const preview = useMemo(() => {
    if (!open || !revision) return null;
    return previewRevisionConfirmationMuDiff(
      resolvedCurrentMu,
      revision.htmlContent,
      domain || 'OntologyDomain',
    );
  }, [open, revision, resolvedCurrentMu, domain]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
    }
  }, [open, revision?.id]);

  if (!open || !revision || !preview) {
    return null;
  }

  const { nextMu, diff } = preview;
  const cleanProtoName = prototypeName
    ? formatPrototypeLabelForBusinessView(prototypeName, t('当前原型', 'Current prototype'))
    : '';
  const cleanRevTitle = formatPrototypeLabelForBusinessView(
    revision.title,
    t(`第 ${revision.revisionNumber} 版`, `Revision #${revision.revisionNumber}`),
  );

  return (
    <dialog
      ref={dialogRef}
      closedby="any"
      aria-labelledby={titleId}
      className="bui-dialog proto-rev-confirm-dialog"
      data-testid="confirm-revision-mu-diff-modal"
      onClose={onClose}
    >
      <div className="flex flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 size={16} className="text-primary shrink-0" aria-hidden="true" />
            <h3 id={titleId} className="m-0 text-[15px] font-semibold text-foreground truncate">
              {isBusinessView
                ? confirmedRevision
                  ? t('重新确认原型', 'Re-confirm prototype')
                  : t('确认原型', 'Confirm prototype')
                : t(
                    `确认原型修订 #${revision.revisionNumber} 并同步 MU 模型`,
                    `Confirm Revision #${revision.revisionNumber} & Sync MU Model`,
                  )}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t('关闭确认窗口', 'Close confirmation dialog')}
            className="primitive-icon-button text-faint-foreground hover:bg-accent hover:text-foreground"
            data-testid="confirm-revision-close-btn"
          >
            <X size={14} />
          </button>
        </div>

        <div className="space-y-3 px-4 py-3.5 text-[13px] leading-relaxed text-foreground-soft">
          {isBusinessView ? (
            <>
              <div
                className="rounded-md border border-border bg-muted/55 px-3 py-2.5 text-[13px]"
                data-testid="confirm-screen-changes-summary"
              >
                <div className="font-medium text-foreground">
                  {cleanProtoName ? `${cleanProtoName} · ` : ''}
                  {cleanRevTitle}
                </div>
                <p className="m-0 mt-1 text-[12.5px] text-muted-foreground">
                  {confirmedRevision
                    ? t(
                        '确认后，业务模型将标为待更新；以下是和上次确认的原型相比带来的界面变化。',
                        'Confirming will mark the Business Model as Outdated; below are the screen changes compared with your last confirmed prototype.',
                      )
                    : t(
                        `确认后，业务模型会依据这 ${nextMu.screens.length} 个界面来整理。`,
                        `Once confirmed, the Business Model will be organized from these ${nextMu.screens.length} screens.`,
                      )}
                </p>
              </div>

              {resolvedHasNonMu && (
                <div
                  className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary-soft px-3 py-2 text-[12.5px] text-foreground"
                  role="note"
                >
                  <ShieldCheck size={15} className="text-primary shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    {t(
                      '确认原型只会更新界面定义，不会覆盖已经整理好的业务对象、业务规则和角色权限。',
                      'Confirming updates screen definitions only and will not overwrite your existing business objects, rules, or permissions.',
                    )}
                  </span>
                </div>
              )}

              <ScreenChangesBusinessPanel diff={diff} nextMu={nextMu} />

              <details
                className="rounded-md border border-border bg-muted/35 px-3 py-2"
                data-testid="confirm-revision-technical-disclosure"
              >
                <summary className="cursor-pointer select-none text-[12px] font-medium text-muted-foreground hover:text-foreground">
                  {t('查看细节', 'View details')}
                </summary>
                <div className="mt-2.5 space-y-2.5 border-t border-border pt-2.5">
                  {resolvedHasNonMu && (
                    <div
                      className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary-soft px-3 py-2 text-[12px] text-foreground"
                      role="note"
                      data-testid="confirm-mu-only-safeguard"
                    >
                      <ShieldCheck size={15} className="text-primary shrink-0 mt-0.5" aria-hidden="true" />
                      <span>
                        {t(
                          '仅重新提取并更新 MU（UI 模型），不会重新合成或覆盖已有的 M1–M7、ME、MM、MI 业务本体模型。',
                          'Re-extracts and updates MU (UI Model) only — existing M1–M7, ME, MM, and MI ontology models will never be re-synthesized or overwritten.',
                        )}
                      </span>
                    </div>
                  )}
                  <MuDiffSummaryPanel
                    diff={diff}
                    nextMu={nextMu}
                    testId="confirm-modal-mu-diff"
                  />
                </div>
              </details>
            </>
          ) : (
            <>
              <div className="rounded-md border border-border bg-muted/55 px-3 py-2 text-[12.5px]">
                <div className="font-medium text-foreground">
                  {prototypeName ? `${prototypeName} · ` : ''}#{revision.revisionNumber}{' '}
                  {revision.title}
                </div>
                <div className="text-[12px] text-faint-foreground mt-0.5">
                  {confirmedRevision
                    ? t(
                        `当前已确认基准：${confirmedRevision.prototype.name} #${confirmedRevision.revision.revisionNumber}（${confirmedRevision.revision.title}）`,
                        `Current Confirmed Revision: ${confirmedRevision.prototype.name} #${confirmedRevision.revision.revisionNumber} (${confirmedRevision.revision.title})`,
                      )
                    : diff.isInitialExtraction
                      ? t(
                          '本工程尚未确认过原型修订；确认后将首次提取并建立 MU（UI 模型）。',
                          'No revision confirmed yet in this project; confirming will extract and initialize the MU (UI Model).',
                        )
                      : t(
                          '对比基准：当前工程已保存的 MU（UI 模型）。',
                          'Compared against this project’s current MU (UI Model).',
                        )}
                </div>
              </div>

              {resolvedHasNonMu && (
                <div
                  className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary-soft px-3 py-2 text-[12px] text-foreground"
                  role="note"
                  data-testid="confirm-mu-only-safeguard"
                >
                  <ShieldCheck size={15} className="text-primary shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    {t(
                      '仅重新提取并更新 MU（UI 模型），不会重新合成或覆盖已有的 M1–M7、ME、MM、MI 业务本体模型。',
                      'Re-extracts and updates MU (UI Model) only — existing M1–M7, ME, MM, and MI ontology models will never be re-synthesized or overwritten.',
                    )}
                  </span>
                </div>
              )}

              <MuDiffSummaryPanel
                diff={diff}
                nextMu={nextMu}
                testId="confirm-modal-mu-diff"
              />
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/45 px-4 py-2.5">
          <span className="text-[12px] text-muted-foreground">
            {t(
              `识别到 ${nextMu.screens.length} 个${MODEL_BUSINESS_NAMES.MU.zh}`,
              `${nextMu.screens.length} ${nextMu.screens.length === 1 ? 'screen' : 'screens'}`,
            )}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onClose}
              disabled={busy}
              data-testid="confirm-revision-cancel-btn"
            >
              {t('取消', 'Cancel')}
            </Button>
            <Button
              variant="accent"
              size="sm"
              onClick={() => void onConfirm(revision.id)}
              disabled={busy}
              data-testid="confirm-revision-approve-btn"
            >
              <CheckCircle2 size={13} aria-hidden="true" />
              <span>
                {isBusinessView
                  ? busy
                    ? t('正在确认原型…', 'Confirming…')
                    : confirmedRevision
                      ? t('重新确认原型', 'Re-confirm prototype')
                      : t('确认原型', 'Confirm prototype')
                  : busy
                    ? t('正在同步 MU…', 'Syncing MU…')
                    : t('确认并同步 MU', 'Confirm & Sync MU')}
              </span>
            </Button>
          </div>
        </div>
      </div>
    </dialog>
  );
}

// ─── Optional Connected API Actions Hook for Canvas Integration ──────────────

export interface UsePrototypeRevisionActionsOptions {
  projectId: string;
  prototypeId: string;
  onSyncWorkspace?: (payload: {
    prototype: InteractivePrototype;
    prototypes: InteractivePrototype[];
    confirmedRevision: ConfirmedPrototypeRevision | null;
    project?: ProjectDetail;
    restoredRevision?: PrototypeRevision;
  }) => void;
  onError?: (error: Error) => void;
}

export function usePrototypeRevisionActions({
  projectId,
  prototypeId,
  onSyncWorkspace,
  onError,
}: UsePrototypeRevisionActionsOptions) {
  const [busyRevisionId, setBusyRevisionId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const renameRevision = useCallback(
    async (revisionId: string, newTitle: string) => {
      setBusyRevisionId(revisionId);
      try {
        const res = await apiUpdatePrototypeRevisionMeta(prototypeId, revisionId, {
          title: newTitle,
        });
        onSyncWorkspace?.({
          prototype: res.prototype,
          prototypes: res.prototypes,
          confirmedRevision: res.confirmedRevision,
        });
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setBusyRevisionId(null);
      }
    },
    [prototypeId, onSyncWorkspace, onError],
  );

  const toggleStarRevision = useCallback(
    async (revisionId: string, nextStarred: boolean) => {
      setBusyRevisionId(revisionId);
      try {
        const res = await apiUpdatePrototypeRevisionMeta(prototypeId, revisionId, {
          starred: nextStarred,
        });
        onSyncWorkspace?.({
          prototype: res.prototype,
          prototypes: res.prototypes,
          confirmedRevision: res.confirmedRevision,
        });
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setBusyRevisionId(null);
      }
    },
    [prototypeId, onSyncWorkspace, onError],
  );

  const restoreRevision = useCallback(
    async (revisionId: string) => {
      setBusyRevisionId(revisionId);
      try {
        const res = await apiRestorePrototypeRevision(prototypeId, revisionId);
        onSyncWorkspace?.({
          prototype: res.prototype,
          prototypes: res.prototypes,
          confirmedRevision: res.confirmedRevision,
          restoredRevision: res.revision,
        });
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setBusyRevisionId(null);
      }
    },
    [prototypeId, onSyncWorkspace, onError],
  );

  const confirmRevision = useCallback(
    async (revisionId: string) => {
      setConfirming(true);
      try {
        const res = await apiConfirmPrototypeRevision(projectId, revisionId);
        onSyncWorkspace?.({
          prototype: res.prototype,
          prototypes: res.prototypes,
          confirmedRevision: res.confirmedRevision ?? res.confirmed,
          project: res.project,
        });
        return res;
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
        return null;
      } finally {
        setConfirming(false);
      }
    },
    [projectId, onSyncWorkspace, onError],
  );

  return {
    busyRevisionId,
    confirming,
    renameRevision,
    toggleStarRevision,
    restoreRevision,
    confirmRevision,
  };
}
