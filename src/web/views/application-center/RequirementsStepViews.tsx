import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Copy,
  Edit3,
  GitBranch,
  History,
  Info,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  BUSINESS_VOCABULARY,
  type BusinessLocale,
} from '../../../packages/business-vocabulary/index.js';
import {
  normalizeStepMarkdown,
  sanitizeBusinessViewCopy,
  type ArtifactHistoryEntryView,
  type ArtifactJumpTarget,
  type RequirementDoc,
} from '../../../packages/workspace-store/index.js';
import {
  apiDeleteResource,
  apiPostJson,
  useWorkbenchStore,
} from '../../api.js';
import {
  agentSessionScopeKey,
  useAgentPanelStore,
} from '../../components/agent/agentPanelStore.js';
import {
  Button,
  ConfirmDialog,
  RegistryTable,
} from '../../components/beautifui/index.js';
import { ArtifactHistoryDrawer } from '../../components/history/index.js';
import { TiptapMarkdownEditor } from '../../components/markdown/index.js';
import { usePreferences, type NavViewId } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import {
  getProjectStepsFromBootstrap,
  useStepViewMode,
  type StepViewMode,
} from '../../navigation/index.js';
import { ViewModeHeader } from './ViewModeHeader.js';

// ─── Helper: Parse A/B Classification Tag on Requirement Decisions ────────────
function parseDecisionTag(raw: string): {
  tag: '[AI自动补全]' | '[待确认]' | '[已确认]';
  tagEn: '[AI Auto-Completed]' | '[Pending]' | '[Confirmed]';
  badgeClass: 'badge-accent' | 'badge-warn' | 'badge-ok';
  categoryLabelZh: string;
  categoryLabelEn: string;
  body: string;
} {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (trimmed.startsWith('[AI自动补全]') || lower.startsWith('[ai auto-completed]')) {
    const prefixLen = trimmed.startsWith('[AI自动补全]')
      ? '[AI自动补全]'.length
      : '[AI Auto-Completed]'.length;
    return {
      tag: '[AI自动补全]',
      tagEn: '[AI Auto-Completed]',
      badgeClass: 'badge-accent',
      categoryLabelZh: 'A类默认补全',
      categoryLabelEn: 'Class-A Auto',
      body: trimmed.slice(prefixLen).trim(),
    };
  }
  if (
    trimmed.startsWith('[待确认]') ||
    lower.startsWith('[pending]') ||
    lower.startsWith('[open]')
  ) {
    const prefixLen = trimmed.startsWith('[待确认]')
      ? '[待确认]'.length
      : lower.startsWith('[pending]')
        ? '[Pending]'.length
        : '[Open]'.length;
    return {
      tag: '[待确认]',
      tagEn: '[Pending]',
      badgeClass: 'badge-warn',
      categoryLabelZh: 'B类待确认',
      categoryLabelEn: 'Class-B Pending',
      body: trimmed.slice(prefixLen).trim(),
    };
  }
  if (trimmed.startsWith('[已确认]') || lower.startsWith('[confirmed]')) {
    const prefixLen = trimmed.startsWith('[已确认]')
      ? '[已确认]'.length
      : '[Confirmed]'.length;
    return {
      tag: '[已确认]',
      tagEn: '[Confirmed]',
      badgeClass: 'badge-ok',
      categoryLabelZh: 'B类已收敛',
      categoryLabelEn: 'Class-B Confirmed',
      body: trimmed.slice(prefixLen).trim(),
    };
  }
  return {
    tag: '[已确认]',
    tagEn: '[Confirmed]',
    badgeClass: 'badge-ok',
    categoryLabelZh: '已收敛决策',
    categoryLabelEn: 'Confirmed',
    body: trimmed,
  };
}

interface NormalizedAggregateSignal {
  key: string;
  title: string;
  englishCode?: string;
  detail?: string;
}

function parseAndDedupeAggregates(rawItems: string[]): NormalizedAggregateSignal[] {
  const byKey = new Map<string, NormalizedAggregateSignal>();

  for (const raw of rawItems) {
    let cleaned = raw
      .trim()
      .replace(/^(AGG候选|AGG|M1)\s*[:：\-·]\s*/i, '')
      .replace(/\s*(\[候选\]|\(候选\)|（候选）)\s*$/g, '')
      .trim();
    if (!cleaned) continue;

    // Extract trailing parenthetical description, e.g. "门店 Store (单店经营，预留多店扩展)"
    let detail: string | undefined;
    const parenMatch = /^(.*?)\s*[\(（]([^()（）]+)[\)）]\s*$/.exec(cleaned);
    if (parenMatch && parenMatch[1]?.trim()) {
      cleaned = parenMatch[1].trim();
      const note = parenMatch[2]?.trim();
      if (note && note !== '候选') {
        detail = note;
      }
    }

    // Separate bilingual title + English identifier, e.g. "员工账号 EmployeeAccount"
    let title = cleaned;
    let englishCode: string | undefined;
    const biMatch = /^([^\x00-\x7F/·\s]+(?:[/·][^\x00-\x7F/·\s]+)*)\s+([A-Za-z][A-Za-z0-9_]*)$/.exec(
      cleaned,
    );
    if (biMatch) {
      title = biMatch[1]!.trim();
      englishCode = biMatch[2]!.trim();
    }

    // Canonicalize primary entity noun so repeated refinements across turns merge cleanly
    const canonicalKey = title
      .toLowerCase()
      .replace(/\s+/g, '')
      .split(/[/、·]/)[0]!;

    const existing = byKey.get(canonicalKey);
    if (!existing) {
      byKey.set(canonicalKey, {
        key: canonicalKey || cleaned,
        title,
        ...(englishCode ? { englishCode } : {}),
        ...(detail ? { detail } : {}),
      });
    } else {
      byKey.set(canonicalKey, {
        key: existing.key,
        title: title.length >= existing.title.length ? title : existing.title,
        englishCode: englishCode || existing.englishCode,
        detail:
          detail && (!existing.detail || detail.length >= existing.detail.length)
            ? detail
            : existing.detail,
      });
    }
  }

  return [...byKey.values()];
}

type ConvergenceTab = 'DECISIONS' | 'M1' | 'M3';

// ─── 2. Requirement Exploration (需求探索 / Live Streaming + Scoped HITL) ──────
export function RequirementExploreView({
  onNavigate,
}: {
  onNavigate: (view: NavViewId) => void;
}) {
  const { t } = usePreferences();
  const {
    data,
    activeSessionId,
    liveSessionDrafts,
    startSrsSynthesisRun,
  } = useWorkbenchStore();
  const agentPanelOpen = useAgentPanelStore((s) => s.open);
  const rememberedSessionByScope = useAgentPanelStore((s) => s.sessionByScope);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<ConvergenceTab>('DECISIONS');
  const [signalFilter, setSignalFilter] = useState('');

  useEffect(() => {
    if (!data) return;
    const exists = data.requirementSessions.some((s) => s.id === selectedSessionId);
    if (!exists) {
      setSelectedSessionId(data.requirementSessions[0]?.id ?? '');
    }
  }, [data?.activeProject.id, data?.requirementSessions, selectedSessionId]);

  // Extract domain signals from unified REQUIREMENT AgentSessions (artifacts + tool traces + HITL answers)
  const extraReqArtifacts = useMemo(() => {
    const aggs = new Set<string>();
    const rules = new Set<string>();
    const decisions = new Set<string>();
    const openQuestions = new Set<string>();

    for (const sess of data?.agentSessions ?? []) {
      if (sess.projectId !== data?.activeProject.id || sess.agentKind !== 'REQUIREMENT') {
        continue;
      }
      for (const m of sess.messages) {
        for (const art of m.artifacts ?? []) {
          if (art.kind === 'REQUIREMENT_HINTS') {
            art.aggregates.forEach((a) => aggs.add(a));
            art.rules.forEach((r) => rules.add(r));
            art.decisions?.forEach((d) => decisions.add(d));
            art.openQuestions.forEach((q) => openQuestions.add(q));
          }
        }
        for (const tc of m.toolCalls ?? []) {
          if (tc.toolName === 'record_requirement_insights' && tc.arguments) {
            const args = tc.arguments;
            if (Array.isArray(args.discoveredAggregates)) {
              args.discoveredAggregates.forEach((a) => aggs.add(String(a)));
            }
            if (Array.isArray(args.discoveredRules)) {
              args.discoveredRules.forEach((r) => rules.add(String(r)));
            }
            if (Array.isArray(args.resolvedDecisions)) {
              args.resolvedDecisions.forEach((d) => decisions.add(String(d)));
            }
            if (Array.isArray(args.openQuestions)) {
              args.openQuestions.forEach((q) => openQuestions.add(String(q)));
            }
          }
        }
        if (m.askUser?.answered && (m.askUser.selectedAnswers?.length ?? 0) > 0) {
          decisions.add(
            `${t('[已确认]', '[Confirmed]')} ${m.askUser.header ? `${m.askUser.header}: ` : ''}${m.askUser.selectedAnswers!.join('; ')}`,
          );
        }
      }
    }
    return {
      aggs: [...aggs],
      rules: [...rules],
      decisions: [...decisions],
      openQuestions: [...openQuestions],
    };
  }, [data?.agentSessions, data?.activeProject.id, t]);

  if (!data) return null;
  const sessions = data.requirementSessions;
  const session =
    sessions.find((s) => s.id === selectedSessionId) ?? sessions[0] ?? undefined;

  const normalizedAggs = useMemo(
    () =>
      parseAndDedupeAggregates([
        ...(session?.discoveredAggregates ?? []),
        ...extraReqArtifacts.aggs,
      ]),
    [session?.discoveredAggregates, extraReqArtifacts.aggs],
  );

  const mergedRules = useMemo(
    () => [
      ...new Set([...(session?.discoveredRules ?? []), ...extraReqArtifacts.rules]),
    ],
    [session?.discoveredRules, extraReqArtifacts.rules],
  );

  const mergedDecisions = useMemo(() => {
    const combined = [
      ...new Set([
        ...(session?.resolvedDecisions ?? []),
        ...extraReqArtifacts.decisions,
      ]),
    ];
    // Append unresolved open questions tagged as [待确认] if not yet resolved
    for (const q of extraReqArtifacts.openQuestions) {
      const cleanQ = q.replace(/^\[[^\]]+\]\s*/, '').trim();
      const alreadyCovered = combined.some((d) => d.includes(cleanQ.slice(0, 12)));
      if (!alreadyCovered) {
        combined.push(q.startsWith('[') ? q : `[待确认] ${q}`);
      }
    }
    return combined;
  }, [
    session?.resolvedDecisions,
    extraReqArtifacts.decisions,
    extraReqArtifacts.openQuestions,
  ]);

  const filterQ = signalFilter.trim().toLowerCase();
  const filteredAggs = useMemo(
    () =>
      filterQ
        ? normalizedAggs.filter(
            (a) =>
              a.title.toLowerCase().includes(filterQ) ||
              (a.englishCode?.toLowerCase().includes(filterQ) ?? false) ||
              (a.detail?.toLowerCase().includes(filterQ) ?? false),
          )
        : normalizedAggs,
    [normalizedAggs, filterQ],
  );

  const filteredRules = useMemo(
    () =>
      filterQ
        ? mergedRules.filter((r) => r.toLowerCase().includes(filterQ))
        : mergedRules,
    [mergedRules, filterQ],
  );

  const filteredDecisions = useMemo(
    () =>
      filterQ
        ? mergedDecisions.filter((d) => d.toLowerCase().includes(filterQ))
        : mergedDecisions,
    [mergedDecisions, filterQ],
  );

  // SRS synthesis reads the conversation it runs in, so it goes to the one on screen
  // unless that one is still empty; then the most recent conversation with content.
  const preferredAgentSession = useMemo(() => {
    const candidates = (data.agentSessions ?? [])
      .filter((s) => s.projectId === data.activeProject.id && s.agentKind === 'REQUIREMENT')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const rememberedId =
      rememberedSessionByScope[agentSessionScopeKey(data.activeProject.id, 'REQUIREMENT')];
    const onScreen =
      candidates.find((s) => s.id === activeSessionId) ??
      candidates.find((s) => s.id === rememberedId);
    if (onScreen && onScreen.messages.length > 0) return onScreen;
    return candidates.find((s) => s.messages.length > 0);
  }, [data.agentSessions, data.activeProject.id, activeSessionId, rememberedSessionByScope]);

  const totalSignalCount =
    normalizedAggs.length + mergedRules.length + mergedDecisions.length;
  const pendingDecisionCount = mergedDecisions.filter(
    (d) => parseDecisionTag(d).badgeClass === 'badge-warn',
  ).length;
  const canSynthesize = Boolean(
    session || preferredAgentSession || totalSignalCount > 0,
  );

  const synthesizingSrs = (data.agentSessions ?? []).some(
    (s) =>
      s.projectId === data.activeProject.id &&
      s.agentKind === 'REQUIREMENT' &&
      (s.status === 'RUNNING' || Boolean(liveSessionDrafts[s.id])),
  );

  const handleSynthesizeSrs = () => {
    if (!canSynthesize || synthesizingSrs) return;
    useAgentPanelStore.getState().revealPanel();
    void startSrsSynthesisRun({
      ...(session?.id ? { requirementSessionId: session.id } : {}),
      ...(preferredAgentSession?.id ? { agentSessionId: preferredAgentSession.id } : {}),
    });
  };

  const openConversation = () => {
    useAgentPanelStore.getState().revealPanel();
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLTextAreaElement>('[data-testid="agent-panel-composer-input"]')
        ?.focus();
    });
  };

  const renderDecisionItem = (dec: string, idx: number) => {
    const parsed = parseDecisionTag(dec);
    return (
      <li
        key={`${idx}-${dec.slice(0, 20)}`}
        className={cn('req-item', parsed.badgeClass === 'badge-warn' && 'is-pending')}
      >
        <div className="req-item-meta">
          <span className={`badge ${parsed.badgeClass}`}>
            {t(parsed.tag, parsed.tagEn).replace(/^\[|\]$/g, '')}
          </span>
          <span className="req-item-kind">
            {t(parsed.categoryLabelZh, parsed.categoryLabelEn)}
          </span>
        </div>
        <p className="req-item-body">{parsed.body}</p>
      </li>
    );
  };

  const renderAggregateItem = (agg: NormalizedAggregateSignal) => (
    <li key={agg.key} className="req-item">
      <div className="req-item-meta">
        <span className="req-item-title">{agg.title}</span>
        {agg.englishCode && <code className="req-item-code">{agg.englishCode}</code>}
      </div>
      {agg.detail && <p className="req-item-body is-muted">{agg.detail}</p>}
    </li>
  );

  const renderRuleItem = (rule: string, idx: number) => {
    const parsed = parseDecisionTag(rule);
    const trimmedRule = rule.trim().toLowerCase();
    const hasExplicitPrefix =
      rule.trim().startsWith('[AI自动补全]') ||
      rule.trim().startsWith('[待确认]') ||
      rule.trim().startsWith('[已确认]') ||
      trimmedRule.startsWith('[ai auto-completed]') ||
      trimmedRule.startsWith('[pending]') ||
      trimmedRule.startsWith('[open]') ||
      trimmedRule.startsWith('[confirmed]');

    return (
      <li key={`${idx}-${rule.slice(0, 20)}`} className="req-item is-numbered">
        <span className="req-item-index" aria-hidden="true">
          {idx + 1}
        </span>
        <p className="req-item-body">
          {hasExplicitPrefix && (
            <span className={`badge ${parsed.badgeClass} req-item-inline-badge`}>
              {t(parsed.tag, parsed.tagEn).replace(/^\[|\]$/g, '')}
            </span>
          )}
          {hasExplicitPrefix ? parsed.body : rule}
        </p>
      </li>
    );
  };

  const columns = [
    {
      id: 'DECISIONS' as const,
      icon: <CheckCircle2 size={13} aria-hidden="true" />,
      label: t('分级决策', 'Decisions'),
      hint: t('A 类自动补全 · B 类需你确认', 'Class-A auto-completed · Class-B needs you'),
      total: mergedDecisions.length,
      shown: filteredDecisions.length,
      emptyText: t(
        '对话中出现的业务边界决策会记录在这里。',
        'Business-boundary decisions from the conversation are recorded here.',
      ),
      body: filteredDecisions.map(renderDecisionItem),
    },
    {
      id: 'M1' as const,
      icon: <Boxes size={13} aria-hidden="true" />,
      label: t('领域聚合根 M1', 'Aggregates · M1'),
      hint: t('核心业务对象，已去重', 'Core business objects, deduplicated'),
      total: normalizedAggs.length,
      shown: filteredAggs.length,
      emptyText: t(
        '识别出的核心业务对象会归档在这里。',
        'Core business objects identified so far are filed here.',
      ),
      body: filteredAggs.map(renderAggregateItem),
    },
    {
      id: 'M3' as const,
      icon: <GitBranch size={13} aria-hidden="true" />,
      label: t('业务规则 M3', 'Rules · M3'),
      hint: t('阈值、准入红线与约束', 'Thresholds, gates, and constraints'),
      total: mergedRules.length,
      shown: filteredRules.length,
      emptyText: t(
        '规则阈值与准入红线会沉淀在这里。',
        'Rule thresholds and gate conditions settle here.',
      ),
      body: filteredRules.map(renderRuleItem),
    },
  ];

  return (
    <div className="req-explore">
      <section className="card req-explore-head">
        <div className="req-explore-head-main">
          <h3 className="card-title">{t('需求要素看板', 'Requirement Board')}</h3>
          <p className="req-explore-sub">
            {t(
              '与智能体对话时识别出的决策、聚合根和业务规则会自动去重归档到这里，随时可合成规格说明书。',
              'Decisions, aggregates, and rules found during the conversation are deduplicated here, ready to synthesize into an SRS.',
            )}
          </p>
        </div>
        <div className="req-explore-head-actions">
          {sessions.length > 1 && (
            <select
              className="select req-explore-source"
              aria-label={t('需求来源', 'Requirement source')}
              value={session?.id ?? ''}
              onChange={(e) => setSelectedSessionId(e.target.value)}
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={() => onNavigate('app-req-docs')}>
            {t('需求文档', 'SRS Docs')}
            <ArrowRight size={13} aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="accent"
            size="sm"
            data-testid="synthesize-srs-btn"
            disabled={!canSynthesize || synthesizingSrs}
            title={t(
              '基于需求探索对话合成 9 章节《软件需求规格说明书》',
              'Synthesize the 9-chapter SRS from the requirement conversation',
            )}
            onClick={handleSynthesizeSrs}
          >
            {synthesizingSrs ? (
              <Loader2 size={13.5} className="pipeline-spin" aria-hidden="true" />
            ) : (
              <Sparkles size={13.5} aria-hidden="true" />
            )}
            {synthesizingSrs
              ? t('正在合成规格书…', 'Synthesizing SRS…')
              : t('合成需求规格说明书', 'Synthesize SRS')}
          </Button>
        </div>
      </section>

      <section
        className="req-board"
        data-testid="requirement-board"
        data-active-tab={activeTab}
        aria-label={t('已收敛需求要素', 'Converged requirement signals')}
      >
        {totalSignalCount === 0 ? (
          <div className="req-board-empty">
            <span className="req-board-empty-mark" aria-hidden="true">
              <Sparkles size={20} />
            </span>
            <h4 className="req-board-empty-title">
              {t('还没有沉淀任何需求要素', 'No requirement signals yet')}
            </h4>
            <p className="req-board-empty-text">
              {t(
                '在右侧对话里描述业务场景、角色或规则。常规项智能体会自动补全，遇到模糊的业务边界会请你确认，结果都会归档到这块看板。',
                'Describe a scenario, role, or rule in the conversation. Routine items are auto-completed, ambiguous boundaries come back to you for confirmation, and everything is filed on this board.',
              )}
            </p>
            <Button type="button" variant="accent" size="md" onClick={openConversation}>
              <Sparkles size={14} aria-hidden="true" />
              {t('开始需求探索', 'Start Exploring')}
            </Button>
          </div>
        ) : (
          <>
            <div className="req-board-bar">
              <div
                role="tablist"
                aria-label={t('需求要素分类', 'Requirement signal categories')}
                className="req-board-tabs"
              >
                {columns.map((col, idx) => (
                  <button
                    key={col.id}
                    id={`req-signal-tab-${col.id}`}
                    type="button"
                    role="tab"
                    tabIndex={activeTab === col.id ? 0 : -1}
                    aria-selected={activeTab === col.id}
                    aria-controls={`req-signal-panel-${col.id}`}
                    className="req-tab"
                    onClick={() => setActiveTab(col.id)}
                    onKeyDown={(e) => {
                      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
                      e.preventDefault();
                      const nextIdx =
                        e.key === 'Home'
                          ? 0
                          : e.key === 'End'
                            ? columns.length - 1
                            : (idx + (e.key === 'ArrowRight' ? 1 : -1) + columns.length) %
                              columns.length;
                      const nextCol = columns[nextIdx]!;
                      setActiveTab(nextCol.id);
                      document.getElementById(`req-signal-tab-${nextCol.id}`)?.focus();
                    }}
                  >
                    {col.label}
                    <span className="req-tab-count">{col.shown}</span>
                  </button>
                ))}
              </div>
              <div className="req-board-summary">
                {pendingDecisionCount > 0 ? (
                  <span className="badge badge-warn">
                    {t(`${pendingDecisionCount} 项待你确认`, `${pendingDecisionCount} awaiting you`)}
                  </span>
                ) : (
                  <span className="req-board-summary-text">
                    {t(`共 ${totalSignalCount} 项`, `${totalSignalCount} total`)}
                  </span>
                )}
              </div>
              <label className="req-board-search">
                <Search size={13} aria-hidden="true" />
                <input
                  type="search"
                  value={signalFilter}
                  onChange={(e) => setSignalFilter(e.target.value)}
                  placeholder={t('筛选要素…', 'Filter signals…')}
                  aria-label={t('筛选需求要素', 'Filter requirement signals')}
                />
              </label>
            </div>

            <div className="req-board-cols">
              {columns.map((col) => (
                <div
                  key={col.id}
                  id={`req-signal-panel-${col.id}`}
                  role="tabpanel"
                  aria-labelledby={`req-signal-tab-${col.id}`}
                  className="req-col"
                  data-col={col.id}
                >
                  <header className="req-col-head">
                    <span className="req-col-title">
                      {col.icon}
                      {col.label}
                    </span>
                    <span className="req-col-count">
                      {filterQ ? `${col.shown}/${col.total}` : col.total}
                    </span>
                    <span className="req-col-hint">{col.hint}</span>
                  </header>
                  {col.body.length === 0 ? (
                    <p className="req-col-empty">
                      {filterQ && col.total > 0
                        ? t('没有匹配的条目', 'Nothing matches the filter')
                        : col.emptyText}
                    </p>
                  ) : (
                    <ul className="req-col-list req-signal-scroller bui-scroller">{col.body}</ul>
                  )}
                </div>
              ))}
            </div>

            {!agentPanelOpen && (
              <footer className="req-board-foot">
                <span>
                  {t(
                    '想补充或修正？回到对话继续探索，看板会实时更新。',
                    'Something missing or wrong? Continue the conversation and the board updates live.',
                  )}
                </span>
                <Button type="button" variant="secondary" size="sm" onClick={openConversation}>
                  <Sparkles size={13} aria-hidden="true" />
                  {t('继续对话', 'Continue Conversation')}
                </Button>
              </footer>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// ─── 3. Requirement Documents (需求文档 SRS: Registry + Tiptap Markdown) ─────
export function RequirementDocsView({
  onNavigate,
}: {
  onNavigate?: (view: NavViewId) => void;
}) {
  const { t } = usePreferences();
  const {
    data,
    activeItemId,
    liveSessionDrafts,
    patchData,
    setActiveItemId,
    setActiveNav,
    showToast,
  } = useWorkbenchStore();
  const [pageMode, setPageMode] = useState<'WORKSPACE' | 'REGISTRY'>('WORKSPACE');
  const [selectedDocId, setSelectedDocId] = useState<string>('');
  const [docTitle, setDocTitle] = useState<string>('');
  const [docVersion, setDocVersion] = useState<string>('v1.0');
  const [content, setContent] = useState<string>('');
  const [deletingDoc, setDeletingDoc] = useState<RequirementDoc | null>(null);
  const mdUploadRef = useRef<HTMLInputElement | null>(null);

  const docs = data?.requirementDocs ?? [];
  const selectedDoc = docs.find((d) => d.id === selectedDocId) ?? docs[0];

  useEffect(() => {
    if (!data || !activeItemId) return;
    const target = data.requirementDocs.find((d) => d.id === activeItemId);
    if (target && target.id !== selectedDocId) {
      setSelectedDocId(target.id);
      setDocTitle(target.title);
      setDocVersion(target.version);
      setContent(target.content);
      setPageMode('WORKSPACE');
    }
  }, [activeItemId, data?.requirementDocs]);

  useEffect(() => {
    if (!data) return;
    const list = data.requirementDocs;
    if (list.length === 0) {
      setSelectedDocId('');
      setDocTitle(`${data.activeProject.name} 软件需求规格说明书`);
      setDocVersion('v1.0');
      setContent('');
      return;
    }
    const found = list.find((d) => d.id === selectedDocId);
    if (!found) {
      // listRequirementDocs is ordered by updated_at DESC — list[0] is the newest document
      const latest = list[0]!;
      setSelectedDocId(latest.id);
      setDocTitle(latest.title);
      setDocVersion(latest.version);
      setContent(latest.content);
    }
  }, [data?.activeProject.id, data?.requirementDocs]);

  useEffect(() => {
    if (!selectedDoc) return;
    setDocTitle(selectedDoc.title);
    setDocVersion(selectedDoc.version);
    setContent(selectedDoc.content);
  }, [selectedDoc?.id, selectedDoc?.updatedAt]);

  if (!data) return null;

  const generatingProto = (data.agentSessions ?? []).some(
    (s) =>
      s.projectId === data.activeProject.id &&
      s.agentKind === 'PROTOTYPE_CO_DESIGN' &&
      (s.status === 'RUNNING' || Boolean(liveSessionDrafts[s.id])),
  );

  const handleSaveDoc = async (mdToSave = content) => {
    const targetId = selectedDoc?.id ?? `doc-${Date.now()}`;
    const res = await apiPostJson<{
      doc: RequirementDoc;
      docs: RequirementDoc[];
      artifactHistory?: ArtifactHistoryEntryView[];
    }>('/api/requirements/docs', {
      id: targetId,
      projectId: data.activeProject.id,
      title: docTitle.trim() || `${data.activeProject.name} 需求文档`,
      version: docVersion.trim() || 'v1.0',
      content: mdToSave,
      status: 'DRAFT',
    });
    patchData({
      requirementDocs: res.docs,
      ...(res.artifactHistory ? { artifactHistory: res.artifactHistory } : {}),
    });
    setSelectedDocId(res.doc.id);
    showToast(
      t(
        '需求文档修改已保存（确认需求文档后下游步骤才会更新）',
        'Requirements draft saved (confirm requirements when ready for downstream steps)',
      ),
    );
  };

  const handleCreateBlankDoc = async () => {
    const res = await apiPostJson<{
      doc: RequirementDoc;
      docs: RequirementDoc[];
      artifactHistory?: ArtifactHistoryEntryView[];
    }>('/api/requirements/docs', {
      id: `doc-${Date.now()}`,
      projectId: data.activeProject.id,
      title: `${data.activeProject.name} 需求规格书 #${docs.length + 1}`,
      version: 'v1.0',
      content: `# ${data.activeProject.name} 软件需求规格说明书\n\n## 1. 业务目标与范围\n\n## 2. 核心领域对象与状态机\n\n| 对象名称 | 编码 | 核心职责 |\n| --- | --- | --- |\n| 示例聚合根 | AGG-01 | 核心业务单据 |\n`,
      status: 'DRAFT',
    });
    patchData({
      requirementDocs: res.docs,
      ...(res.artifactHistory ? { artifactHistory: res.artifactHistory } : {}),
    });
    setSelectedDocId(res.doc.id);
    setPageMode('WORKSPACE');
    showToast(t('已新建需求规格书草稿', 'Created new SRS draft'));
  };

  const handleCloneDoc = async (doc: RequirementDoc) => {
    const res = await apiPostJson<{
      doc: RequirementDoc;
      docs: RequirementDoc[];
      artifactHistory?: ArtifactHistoryEntryView[];
    }>('/api/requirements/docs', {
      id: `doc-clone-${Date.now()}`,
      projectId: data.activeProject.id,
      title: `${doc.title} (副本)`,
      version: doc.version,
      content: doc.content,
      status: 'DRAFT',
    });
    patchData({
      requirementDocs: res.docs,
      ...(res.artifactHistory ? { artifactHistory: res.artifactHistory } : {}),
    });
    showToast(t(`已克隆文档「${doc.title}」`, `Cloned "${doc.title}"`));
  };

  const handleConfirmDeleteDoc = async () => {
    if (!deletingDoc) return;
    const res = await apiDeleteResource<{
      docs: RequirementDoc[];
      artifactHistory?: ArtifactHistoryEntryView[];
    }>(`/api/requirements/docs/${deletingDoc.id}?projectId=${data.activeProject.id}`);
    patchData({
      requirementDocs: res.docs,
      ...(res.artifactHistory ? { artifactHistory: res.artifactHistory } : {}),
    });
    setDeletingDoc(null);
    showToast(t('已删除需求规格书', 'Deleted SRS document'));
  };

  const handleUploadMdFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    const baseTitle =
      file.name.replace(/\.(md|txt)$/i, '') || `${data.activeProject.name} 需求规格书`;
    const res = await apiPostJson<{
      doc: RequirementDoc;
      docs: RequirementDoc[];
      artifactHistory?: ArtifactHistoryEntryView[];
    }>('/api/requirements/docs', {
      id: `doc-upload-${Date.now()}`,
      projectId: data.activeProject.id,
      title: baseTitle,
      version: 'v1.0',
      content: text,
      status: 'DRAFT',
    });
    patchData({
      requirementDocs: res.docs,
      ...(res.artifactHistory ? { artifactHistory: res.artifactHistory } : {}),
    });
    setSelectedDocId(res.doc.id);
    setDocTitle(res.doc.title);
    setDocVersion(res.doc.version);
    setContent(text);
    setPageMode('WORKSPACE');
    showToast(
      t(
        `已导入本地需求文档「${file.name}」，核对后请确认需求文档`,
        `Imported "${file.name}" as draft; review and confirm when ready`,
      ),
    );
  };

  const handleGeneratePrototype = async () => {
    if (generatingProto) return;
    let targetDocId = selectedDoc?.id;
    if (!targetDocId && content.trim()) {
      const saveJson = await apiPostJson<{
        doc: RequirementDoc;
        docs: RequirementDoc[];
        artifactHistory?: ArtifactHistoryEntryView[];
      }>('/api/requirements/docs', {
        id: `doc-${Date.now()}`,
        projectId: data.activeProject.id,
        title: docTitle.trim() || `${data.activeProject.name} 需求文档`,
        version: docVersion.trim() || 'v1.0',
        content,
        status: 'DRAFT',
      });
      patchData({
        requirementDocs: saveJson.docs,
        ...(saveJson.artifactHistory ? { artifactHistory: saveJson.artifactHistory } : {}),
      });
      targetDocId = saveJson.doc.id;
    }
    setActiveItemId(targetDocId ?? null);
    setActiveNav('app-prototype', { itemId: targetDocId ?? null });
    onNavigate?.('app-prototype');
    useAgentPanelStore.getState().revealPanel();
  };

  return (
    <div className="space-y-3">
      <input
        ref={mdUploadRef}
        type="file"
        accept=".md,.txt" className="hidden"
        onChange={handleUploadMdFile}
      />

      <ViewModeHeader
        mode={pageMode}
        onChange={setPageMode}
        workspaceLabel={t('编辑', 'Editor')}
        registryLabel={t('全部版本', 'All Versions')}
        count={docs.length}
        testIdPrefix="srs"
        centerSlot={
          pageMode === 'WORKSPACE' ? (
            <>
              {docs.length > 1 && (
                <select
                  className="select"
                  style={{ flex: '0 1 220px', width: 'auto', minWidth: 0, maxWidth: 260 }}
                  aria-label={t('切换需求规格书', 'Switch SRS document')}
                  value={selectedDoc?.id ?? ''}
                  onChange={(e) => setSelectedDocId(e.target.value)}
                >
                  {docs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title} ({d.version})
                    </option>
                  ))}
                </select>
              )}
              <input
                className="input"
                style={{ flex: '1 1 180px', width: 'auto', minWidth: 140 }}
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder={t('文档标题', 'Document Title')}
                aria-label={t('文档标题', 'Document Title')}
              />
              <input
                className="input"
                style={{ flex: '0 0 72px', width: 72, fontFamily: 'var(--font-mono)' }}
                value={docVersion}
                onChange={(e) => setDocVersion(e.target.value)}
                placeholder="v1.0"
                aria-label={t('版本号', 'Version')}
              />
              {selectedDoc && (
                <span
                  className={cn(
                    'badge shrink-0',
                    selectedDoc.status === 'DRAFT' ? 'badge-warn' : 'badge-ok',
                  )}
                >
                  {selectedDoc.status}
                </span>
              )}
            </>
          ) : undefined
        }
        rightActions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title={t('新建空白规格书', 'New blank SRS')}
              aria-label={t('新建空白规格书', 'New blank SRS')}
              onClick={() => void handleCreateBlankDoc()}
            >
              <Plus size={14} aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title={t('上传本地 .md', 'Upload .md')}
              aria-label={t('上传本地 .md', 'Upload .md')}
              onClick={() => mdUploadRef.current?.click()}
            >
              <Upload size={14} aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="accent" size="sm"
              data-testid="generate-prototype-btn"
              disabled={generatingProto}
              title={t(
                '基于此需求规格书生成可交互 HTML 原型',
                'Generate an interactive HTML prototype from this SRS',
              )}
              onClick={() => void handleGeneratePrototype()}
            >
              {generatingProto && <Loader2 size={13.5} className="pipeline-spin" aria-hidden="true" />}
              {generatingProto
                ? t('正在生成原型…', 'Generating…')
                : t('生成界面原型', 'Generate Prototype')}
              {!generatingProto && <ArrowRight size={13.5} aria-hidden="true" />}
            </Button>
          </>
        }
      />

      {pageMode === 'REGISTRY' ? (
        <RegistryTable<RequirementDoc>
          testId="srs-registry-table"
          title={t('软件需求规格说明书注册表', 'SRS Document Registry')}
          subtitle={t(
            '管理多版本需求规格书草稿、评审确认状态、副本克隆与清理',
            'Manage multi-version SRS documents, statuses, clones, and cleanup',
          )}
          rows={docs}
          getRowKey={(d) => d.id}
          activeRowKey={selectedDoc?.id}
          matchesSearch={(d, q) =>
            d.title.toLowerCase().includes(q) ||
            d.version.toLowerCase().includes(q) ||
            d.content.toLowerCase().includes(q)
          }
          statusFilters={[
            { value: 'ALL', label: t('全部', 'All') },
            { value: 'DRAFT', label: 'DRAFT' },
            { value: 'CONFIRMED', label: 'CONFIRMED' },
            { value: 'PUBLISHED', label: 'PUBLISHED' },
          ]}
          getRowStatus={(d) => d.status}
          primaryActionLabel={t('新建需求规格书', 'New SRS Doc')}
          onPrimaryAction={() => void handleCreateBlankDoc()}
          onRowClick={(d) => {
            setSelectedDocId(d.id);
            setPageMode('WORKSPACE');
          }}
          columns={[
            {
              key: 'title',
              header: t('文档标题', 'Title'),
              render: (d) => (
                <div>
                  <div className="font-semibold text-foreground">{d.title}</div>
                  <div className="font-mono text-[11.5px] text-faint-foreground">{d.id}</div>
                </div>
              ),
            },
            {
              key: 'version',
              header: t('版本', 'Version'),
              width: '100px',
              render: (d) => <span className="badge badge-accent">{d.version}</span>,
            },
            {
              key: 'status',
              header: t('状态', 'Status'),
              width: '120px',
              render: (d) => <span className="badge badge-ok">{d.status}</span>,
            },
            {
              key: 'updatedAt',
              header: t('更新时间', 'Updated'),
              width: '170px',
              render: (d) => (
                <span className="font-mono text-[11.5px] text-faint-foreground">
                  {d.updatedAt.slice(0, 19).replace('T', ' ')}
                </span>
              ),
            },
            {
              key: 'actions',
              header: t('操作', 'Actions'),
              align: 'right',
              render: (d) => (
                <div
                  className="inline-flex items-center gap-1.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => {
                      setSelectedDocId(d.id);
                      setPageMode('WORKSPACE');
                    }}
                  >
                    {t('编辑', 'Edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => void handleCloneDoc(d)}
                    title={t('克隆副本', 'Clone')}
                  >
                    <Copy size={12} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-destructive"
                    onClick={() => setDeletingDoc(d)}
                    title={t('删除', 'Delete')}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              ),
            },
          ]}
        />
      ) : (
        <TiptapMarkdownEditor
          value={content}
          onChange={setContent}
          onSave={handleSaveDoc}
          saveLabel={t('保存修改', 'Save Draft')}
          downloadFilename={`${(docTitle || 'SRS').replace(/[\\/:*?"<>|]+/g, '_')}-${docVersion}.md`}
          minHeight={320}
          className="srs-editor"
        />
      )}

      <ConfirmDialog
        open={Boolean(deletingDoc)}
        danger
        title={t('删除需求规格书', 'Delete SRS Document')}
        description={
          deletingDoc ? t(`确认删除「${deletingDoc.title}」吗？`, `Delete "${deletingDoc.title}"?`) : ''
        }
        onClose={() => setDeletingDoc(null)}
        onConfirm={() => void handleConfirmDeleteDoc()}
      />
    </div>
  );
}

// ─── 4. Unified Requirements Step Canvas (Spec #37 §5 & §6, Issue #64) ──────

export function formatRequirementTextForBusinessView(
  raw: string,
  locale: BusinessLocale = 'zh-CN',
): string {
  return sanitizeBusinessViewCopy(raw, locale);
}

interface ParsedRequirementSection {
  id: string;
  heading: string;
  rawLines: string[];
  displayTitle: string;
  displayLines: string[];
  summaryLine: string;
}

function parseRequirementMarkdownSections(
  markdown: string,
  locale: BusinessLocale,
): ParsedRequirementSection[] {
  const lines = normalizeStepMarkdown(markdown).split('\n');
  const rawSections: { heading: string; bodyLines: string[] }[] = [];
  let current: { heading: string; bodyLines: string[] } | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (/^#\s+/.test(trimmed) && !/^##/.test(trimmed)) {
      continue;
    }
    const h2Match = /^##\s+(.+)$/.exec(trimmed);
    if (h2Match) {
      if (current) rawSections.push(current);
      current = { heading: h2Match[1]!.trim(), bodyLines: [] };
      continue;
    }
    if (!current) {
      if (!trimmed) continue;
      current = {
        heading: locale === 'en-US' ? 'Overview & Goals' : '业务目标与范围',
        bodyLines: [],
      };
    }
    current.bodyLines.push(rawLine);
  }
  if (current) rawSections.push(current);

  return rawSections.map((sec, index) => {
    const displayTitle =
      formatRequirementTextForBusinessView(sec.heading, locale) ||
      (locale === 'en-US' ? `Section ${index + 1}` : `第 ${index + 1} 部分`);
    const displayLines = sec.bodyLines
      .map((line) => line.trim())
      .filter((line) => Boolean(line) && !/^\|?\s*[-:]+\s*\|/.test(line))
      .map((line) =>
        line
          .replace(/^#{3,6}\s+/, '')
          .replace(/^[-*+]\s+/, '')
          .replace(/^\d+\.\s+/, '')
          .replace(/\*\*([^*]+)\*\*/g, '$1'),
      )
      .map((line) => formatRequirementTextForBusinessView(line, locale))
      .filter(Boolean);
    const summaryLine =
      displayLines[0] ?? (locale === 'en-US' ? 'No details yet' : '暂无详细条目');
    return {
      id: `req-sec-${index + 1}`,
      heading: sec.heading,
      rawLines: sec.bodyLines,
      displayTitle,
      displayLines,
      summaryLine,
    };
  });
}

export function RequirementsStepView({
  onNavigate,
}: {
  onNavigate: (view: NavViewId) => void;
}) {
  const { locale, t } = usePreferences();
  const {
    data,
    activeSessionId,
    liveSessionDrafts,
    highlightedRequirementSection,
    historyDrawerArtifactKind,
    patchData,
    showToast,
    focusRequirementSection,
    openArtifactHistoryDrawer,
    closeArtifactHistoryDrawer,
    undoArtifactChange,
    restoreArtifactBeforeChange,
    startSrsSynthesisRun,
    confirmRequirementsStep,
  } = useWorkbenchStore();
  const rememberedSessionByScope = useAgentPanelStore((s) => s.sessionByScope);

  const [viewMode, setViewMode] = useStepViewMode('REQUIREMENTS');
  const [toggledSections, setToggledSections] = useState<Record<string, boolean>>({});
  const [activeHighlightedSectionId, setActiveHighlightedSectionId] = useState<string | null>(
    null,
  );
  const [isEditingInline, setIsEditingInline] = useState(false);
  const [inlineDraft, setInlineDraft] = useState('');
  const [savingInline, setSavingInline] = useState(false);
  const [confirmingStep, setConfirmingStep] = useState(false);
  const [historyBusyEntryId, setHistoryBusyEntryId] = useState<string | null>(null);

  // Reset ephemeral section/editing state on project switch
  useEffect(() => {
    setToggledSections({});
    setActiveHighlightedSectionId(null);
    setIsEditingInline(false);
  }, [data?.activeProject.id]);

  const toggleViewMode = (nextMode: StepViewMode) => {
    setViewMode(nextMode);
  };

  const convergedOutline = useMemo(() => {
    const objects = new Set<string>();
    const rules = new Set<string>();
    const decisions = new Set<string>();
    const openQuestions = new Set<string>();

    for (const reqSess of data?.requirementSessions ?? []) {
      reqSess.discoveredAggregates.forEach((a) => objects.add(a));
      reqSess.discoveredRules.forEach((r) => rules.add(r));
      reqSess.resolvedDecisions.forEach((d) => decisions.add(d));
    }

    for (const sess of data?.agentSessions ?? []) {
      if (sess.projectId !== data?.activeProject.id || sess.agentKind !== 'REQUIREMENT') {
        continue;
      }
      for (const m of sess.messages) {
        for (const art of m.artifacts ?? []) {
          if (art.kind === 'REQUIREMENT_HINTS') {
            art.aggregates.forEach((a) => objects.add(a));
            art.rules.forEach((r) => rules.add(r));
            art.decisions?.forEach((d) => decisions.add(d));
            art.openQuestions.forEach((q) => openQuestions.add(q));
          }
        }
        for (const tc of m.toolCalls ?? []) {
          if (tc.toolName === 'record_requirement_insights' && tc.arguments) {
            const args = tc.arguments;
            if (Array.isArray(args.discoveredAggregates)) {
              args.discoveredAggregates.forEach((a) => objects.add(String(a)));
            }
            if (Array.isArray(args.discoveredRules)) {
              args.discoveredRules.forEach((r) => rules.add(String(r)));
            }
            if (Array.isArray(args.resolvedDecisions)) {
              args.resolvedDecisions.forEach((d) => decisions.add(String(d)));
            }
            if (Array.isArray(args.openQuestions)) {
              args.openQuestions.forEach((q) => openQuestions.add(String(q)));
            }
          }
        }
        if (m.askUser?.answered && (m.askUser.selectedAnswers?.length ?? 0) > 0) {
          decisions.add(
            `${m.askUser.question}：${m.askUser.selectedAnswers!.join(' · ')}`,
          );
        }
      }
    }

    return {
      objects: [...objects]
        .map((item) => formatRequirementTextForBusinessView(item, locale))
        .filter(Boolean),
      rules: [...rules]
        .map((item) => formatRequirementTextForBusinessView(item, locale))
        .filter(Boolean),
      decisions: [...decisions]
        .map((item) =>
          formatRequirementTextForBusinessView(
            item.replace(/^\[(?:AI自动补全|AI Auto-Completed|已确认|Confirmed|待确认|Pending|Open)\]\s*/i, ''),
            locale,
          ),
        )
        .filter(Boolean),
      openQuestions: [...openQuestions]
        .map((item) =>
          formatRequirementTextForBusinessView(
            item.replace(/^\[(?:待确认|Pending|Open)\]\s*/i, ''),
            locale,
          ),
        )
        .filter(Boolean),
    };
  }, [data?.agentSessions, data?.requirementSessions, data?.activeProject.id, locale]);

  const preferredAgentSession = useMemo(() => {
    if (!data) return undefined;
    const candidates = (data.agentSessions ?? [])
      .filter((s) => s.projectId === data.activeProject.id && s.agentKind === 'REQUIREMENT')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const rememberedId =
      rememberedSessionByScope[agentSessionScopeKey(data.activeProject.id, 'REQUIREMENT')];
    const onScreen =
      candidates.find((s) => s.id === activeSessionId) ??
      candidates.find((s) => s.id === rememberedId);
    if (onScreen && onScreen.messages.length > 0) return onScreen;
    return candidates.find((s) => s.messages.length > 0);
  }, [data, activeSessionId, rememberedSessionByScope]);

  const currentDoc = data?.requirementDocs[0];
  const parsedSections = useMemo(
    () => (currentDoc ? parseRequirementMarkdownSections(currentDoc.content, locale) : []),
    [currentDoc?.content, locale],
  );

  // Jump to & highlight a target section when clicked from ChangeSummaryCard or History Drawer
  useEffect(() => {
    if (!highlightedRequirementSection) return;
    const targetHeading = highlightedRequirementSection.heading.trim().toLowerCase();
    if (!targetHeading) return;
    const matched =
      parsedSections.find((sec) => sec.heading.trim().toLowerCase() === targetHeading) ??
      parsedSections.find((sec) =>
        sec.heading
          .trim()
          .replace(/^\d+(?:\.\d+)*[.\s、：:-]+/, '')
          .toLowerCase() ===
        targetHeading.replace(/^\d+(?:\.\d+)*[.\s、：:-]+/, ''),
      );
    if (!matched) return;

    if (viewMode === 'technical') {
      setViewMode('business');
    }
    setIsEditingInline(false);
    setToggledSections((prev) => ({ ...prev, [matched.id]: true }));
    setActiveHighlightedSectionId(matched.id);

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      window.requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(
          `[data-section-id="${matched.id}"]`,
        );
        el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      });
    }
  }, [highlightedRequirementSection?.seq, parsedSections, viewMode, setViewMode]);

  if (!data) return null;

  const steps = getProjectStepsFromBootstrap(data);
  const reqStep = steps.find((s) => s.id === 'REQUIREMENTS')!;
  const stepState = reqStep.state;

  const confirmedReq = data.stepConfirmations?.requirements ?? null;
  const reqHistoryEntries = (data.artifactHistory ?? []).filter(
    (entry) => entry.artifactKind === 'REQUIREMENTS_DOC',
  );
  const historyDrawerOpen = historyDrawerArtifactKind === 'REQUIREMENTS_DOC';

  const handleHistoryDrawerOpenChange = (open: boolean) => {
    if (open) {
      openArtifactHistoryDrawer('REQUIREMENTS_DOC');
    } else {
      closeArtifactHistoryDrawer();
    }
  };

  const handleUndoLatestFromDrawer = async (entry: ArtifactHistoryEntryView) => {
    setHistoryBusyEntryId(entry.id);
    try {
      await undoArtifactChange('REQUIREMENTS_DOC', entry.id);
      setIsEditingInline(false);
    } finally {
      setHistoryBusyEntryId(null);
    }
  };

  const handleRestoreBeforeFromDrawer = async (entry: ArtifactHistoryEntryView) => {
    setHistoryBusyEntryId(entry.id);
    try {
      await restoreArtifactBeforeChange('REQUIREMENTS_DOC', entry.id);
      setIsEditingInline(false);
    } finally {
      setHistoryBusyEntryId(null);
    }
  };

  const handleJumpFromDrawer = (target: ArtifactJumpTarget) => {
    if (target.kind === 'REQUIREMENTS_SECTION') {
      focusRequirementSection(target.sectionHeading, target.docId);
    }
  };

  const assistantWorking = (data.agentSessions ?? []).some(
    (s) =>
      s.projectId === data.activeProject.id &&
      s.agentKind === 'REQUIREMENT' &&
      (s.status === 'RUNNING' || Boolean(liveSessionDrafts[s.id])),
  );

  const confirmedSections = confirmedReq
    ? parseRequirementMarkdownSections(confirmedReq.content, locale)
    : [];
  const modifiedSectionIndexes = new Set<number>();
  if (stepState === 'UNCONFIRMED_CHANGES') {
    parsedSections.forEach((sec, idx) => {
      const prev = confirmedSections[idx];
      if (!prev || prev.rawLines.join('\n').trim() !== sec.rawLines.join('\n').trim()) {
        modifiedSectionIndexes.add(idx);
      }
    });
  }

  const focusLeftComposer = () => {
    useAgentPanelStore.getState().revealPanel();
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        document
          .querySelector<HTMLTextAreaElement>('[data-testid="agent-panel-composer-input"]')
          ?.focus();
      });
    }
  };

  const handleSynthesizeDocument = () => {
    if (assistantWorking) return;
    useAgentPanelStore.getState().revealPanel();
    const reqSess = data.requirementSessions[0];
    void startSrsSynthesisRun({
      ...(reqSess?.id ? { requirementSessionId: reqSess.id } : {}),
      ...(preferredAgentSession?.id ? { agentSessionId: preferredAgentSession.id } : {}),
      ...(currentDoc?.id ? { docId: currentDoc.id } : {}),
    });
  };

  const handleConfirmRequirements = async () => {
    if (!currentDoc || confirmingStep) return;
    setConfirmingStep(true);
    try {
      const confirmed = await confirmRequirementsStep(currentDoc.id);
      if (confirmed) {
        setToggledSections({});
        setIsEditingInline(false);
        showToast(
          t(
            '已确认需求文档，原型步骤已解锁',
            'Requirements document confirmed; Prototype step is now unlocked',
          ),
        );
      }
    } finally {
      setConfirmingStep(false);
    }
  };

  const handleOpenInlineEdit = () => {
    setInlineDraft(
      currentDoc?.content ||
        `# ${data.activeProject.name} ${t('需求文档', 'Requirements Document')}\n\n## 1. ${t('业务目标与范围', 'Business Goals & Scope')}\n- `,
    );
    setIsEditingInline(true);
  };

  const handleSaveInlineEdit = async () => {
    if (savingInline || !inlineDraft.trim()) return;
    setSavingInline(true);
    try {
      const targetId = currentDoc?.id ?? `doc-${Date.now()}`;
      const res = await apiPostJson<{
        doc: RequirementDoc;
        docs: RequirementDoc[];
        artifactHistory?: ArtifactHistoryEntryView[];
      }>('/api/requirements/docs', {
        id: targetId,
        projectId: data.activeProject.id,
        title: currentDoc?.title || `${data.activeProject.name} ${t('需求文档', 'Requirements Document')}`,
        version: currentDoc?.version || 'v1.0',
        content: inlineDraft,
        status: 'DRAFT',
      });
      patchData({
        requirementDocs: res.docs,
        ...(res.artifactHistory ? { artifactHistory: res.artifactHistory } : {}),
      });
      setIsEditingInline(false);
      showToast(
        t(
          '需求修改已保存；确认需求文档后下游步骤才会更新',
          'Changes saved; confirm requirements when ready to update downstream steps',
        ),
      );
    } finally {
      setSavingInline(false);
    }
  };

  if (viewMode === 'technical') {
    return (
      <div className="space-y-3" data-testid="requirements-technical-details">
        <div className="card flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="font-semibold text-foreground">
              {t(BUSINESS_VOCABULARY.TECHNICAL_DETAILS.zh, BUSINESS_VOCABULARY.TECHNICAL_DETAILS.en)}
            </span>
            <span className="text-muted-foreground">
              {t(reqStep.statusSummary.zh, reqStep.statusSummary.en)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="requirements-history-btn"
              onClick={() => openArtifactHistoryDrawer('REQUIREMENTS_DOC')}
            >
              <History size={13} aria-hidden="true" />
              {t('历史与恢复', 'History')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="synthesize-srs-btn"
              disabled={assistantWorking}
              onClick={handleSynthesizeDocument}
            >
              <Sparkles size={13} aria-hidden="true" />
              {t('整理需求文档', 'Synthesize Document')}
            </Button>
            {currentDoc && stepState !== 'CONFIRMED' && (
              <Button
                type="button"
                variant="accent"
                size="sm"
                data-testid="confirm-requirements-btn"
                disabled={confirmingStep || assistantWorking}
                onClick={() => void handleConfirmRequirements()}
              >
                {stepState === 'UNCONFIRMED_CHANGES'
                  ? t('重新确认需求文档', 'Re-confirm requirements')
                  : t('确认需求文档', 'Confirm requirements')}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="requirements-view-mode-toggle"
              onClick={() => toggleViewMode('business')}
            >
              {t(
                `返回${BUSINESS_VOCABULARY.BUSINESS_VIEW.zh}`,
                `Back to ${BUSINESS_VOCABULARY.BUSINESS_VIEW.en}`,
              )}
            </Button>
          </div>
        </div>
        <RequirementDocsView onNavigate={onNavigate} />
        <ArtifactHistoryDrawer
          open={historyDrawerOpen}
          onOpenChange={handleHistoryDrawerOpenChange}
          artifactLabel={{ zh: '需求文档', en: 'Requirements Document' }}
          entries={reqHistoryEntries}
          busyEntryId={historyBusyEntryId}
          onUndoLatest={handleUndoLatestFromDrawer}
          onRestoreBefore={handleRestoreBeforeFromDrawer}
          onJumpToTarget={handleJumpFromDrawer}
        />
      </div>
    );
  }

  const outlineCount =
    convergedOutline.objects.length +
    convergedOutline.rules.length +
    convergedOutline.decisions.length +
    convergedOutline.openQuestions.length;

  const canSynthesize =
    Boolean(preferredAgentSession) ||
    data.requirementSessions.length > 0 ||
    outlineCount > 0;

  const statusText = assistantWorking
    ? t(
        'AI 助手正在整理需求内容，完成后可以在这里检查并确认。',
        'AI Assistant is organizing your requirements; review and confirm them here once finished.',
      )
    : !currentDoc && stepState === 'IN_PROGRESS'
      ? t(
          '已记录对话中的业务要点。点击右上角整理成完整需求文档，核对无误后即可确认。',
          'Key business points from your conversation are recorded. Generate the full requirements document to review and confirm.',
        )
      : t(reqStep.statusSummary.zh, reqStep.statusSummary.en);

  return (
    <div className="space-y-4" data-testid="requirements-step-canvas">
      <section className="card space-y-2.5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 font-title text-[18px] font-semibold text-foreground">
            {t('需求文档', 'Requirements Document')}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="requirements-history-btn"
              onClick={() => openArtifactHistoryDrawer('REQUIREMENTS_DOC')}
            >
              <History size={13} aria-hidden="true" />
              {t('历史与恢复', 'History')}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="requirements-view-mode-toggle"
              onClick={() => toggleViewMode('technical')}
            >
              {t(
                BUSINESS_VOCABULARY.TECHNICAL_DETAILS.zh,
                BUSINESS_VOCABULARY.TECHNICAL_DETAILS.en,
              )}
            </Button>

            {!isEditingInline && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="edit-requirements-inline-btn"
                onClick={handleOpenInlineEdit}
              >
                <Edit3 size={13} aria-hidden="true" />
                {currentDoc ? t('修改文字', 'Edit text') : t('直接编写', 'Write directly')}
              </Button>
            )}

            {currentDoc && canSynthesize && !isEditingInline && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="synthesize-srs-btn"
                disabled={assistantWorking}
                onClick={handleSynthesizeDocument}
              >
                {assistantWorking ? (
                  <Loader2 size={13} className="pipeline-spin" aria-hidden="true" />
                ) : (
                  <Sparkles size={13} aria-hidden="true" />
                )}
                {t('让 AI 助手重新整理', 'Refresh with AI Assistant')}
              </Button>
            )}

            {/* Single Primary Action per state (Business View Rule 1) */}
            {!assistantWorking && !isEditingInline && (
              <>
                {stepState === 'NOT_STARTED' && !currentDoc && (
                  <Button
                    type="button"
                    variant="accent"
                    size="sm"
                    data-testid="start-requirements-chat-btn"
                    onClick={focusLeftComposer}
                  >
                    <Sparkles size={13.5} aria-hidden="true" />
                    {t('开始描述需求', 'Start describing requirements')}
                  </Button>
                )}

                {stepState === 'IN_PROGRESS' && !currentDoc && (
                  <Button
                    type="button"
                    variant="accent"
                    size="sm"
                    data-testid="synthesize-srs-btn"
                    disabled={!canSynthesize}
                    onClick={handleSynthesizeDocument}
                  >
                    <Sparkles size={13.5} aria-hidden="true" />
                    {t('整理成需求文档', 'Generate requirements document')}
                  </Button>
                )}

                {currentDoc && (stepState === 'IN_PROGRESS' || stepState === 'UNCONFIRMED_CHANGES') && (
                  <Button
                    type="button"
                    variant="accent"
                    size="sm"
                    data-testid="confirm-requirements-btn"
                    disabled={confirmingStep}
                    onClick={() => void handleConfirmRequirements()}
                  >
                    <CheckCircle2 size={14} aria-hidden="true" />
                    {stepState === 'UNCONFIRMED_CHANGES'
                      ? t('重新确认需求文档', 'Re-confirm requirements')
                      : t('确认需求文档', 'Confirm requirements')}
                  </Button>
                )}

                {currentDoc && stepState === 'CONFIRMED' && (
                  <Button
                    type="button"
                    variant="accent"
                    size="sm"
                    data-testid="go-to-prototype-btn"
                    onClick={() => onNavigate('app-prototype')}
                  >
                    {t('开始做原型', 'Go to Prototype')}
                    <ArrowRight size={14} aria-hidden="true" />
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        <p
          className={cn(
            'm-0 flex items-center gap-2 rounded-md border px-3 py-2 text-[13px]',
            stepState === 'CONFIRMED'
              ? 'border-border bg-success-soft/55 text-foreground'
              : stepState === 'UNCONFIRMED_CHANGES'
                ? 'border-border bg-warning-soft/65 text-foreground'
                : 'border-border bg-muted/60 text-muted-foreground',
          )}
          data-testid="requirements-status-banner"
          data-step-state={stepState}
        >
          {stepState === 'CONFIRMED' ? (
            <CheckCircle2 size={15} className="shrink-0 text-success" aria-hidden="true" />
          ) : stepState === 'UNCONFIRMED_CHANGES' ? (
            <Info size={15} className="shrink-0 text-warning" aria-hidden="true" />
          ) : (
            <CircleDot size={15} className="shrink-0 text-primary" aria-hidden="true" />
          )}
          <span>{statusText}</span>
        </p>
      </section>

      {isEditingInline ? (
        <section className="card space-y-3 p-4" data-testid="requirements-inline-editor">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-foreground">
              {t('直接修改需求文档内容', 'Edit requirements document text')}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsEditingInline(false)}
              >
                {t('取消', 'Cancel')}
              </Button>
              <Button
                type="button"
                variant="accent"
                size="sm"
                data-testid="save-requirements-inline-btn"
                disabled={savingInline || !inlineDraft.trim()}
                onClick={() => void handleSaveInlineEdit()}
              >
                {t('保存修改', 'Save changes')}
              </Button>
            </div>
          </div>
          <textarea
            data-testid="requirements-inline-textarea"
            aria-label={t('需求文档内容', 'Requirements document content')}
            value={inlineDraft}
            onChange={(e) => setInlineDraft(e.target.value)}
            rows={14}
            className="w-full rounded-md border border-border bg-background p-3 text-[13.5px] leading-relaxed text-foreground focus:border-primary focus:outline-none"
          />
        </section>
      ) : currentDoc ? (
        <article className="space-y-2" data-testid="requirements-document-sections">
          {parsedSections.map((section, idx) => {
            const isModified = modifiedSectionIndexes.has(idx);
            const isHighlighted = activeHighlightedSectionId === section.id;
            const defaultExpanded =
              stepState === 'IN_PROGRESS'
                ? true
                : stepState === 'UNCONFIRMED_CHANGES'
                  ? isModified || modifiedSectionIndexes.size === 0
                  : false;
            const isOpen = toggledSections[section.id] ?? defaultExpanded;

            return (
              <section
                key={section.id}
                className={cn(
                  'card overflow-hidden p-0',
                  isHighlighted && 'border-primary ring-2 ring-ring/30',
                )}
                data-testid={`requirements-section-${idx}`}
                data-section-id={section.id}
                data-section-heading={section.heading}
                data-highlighted={isHighlighted ? 'true' : undefined}
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() =>
                    setToggledSections((prev) => ({ ...prev, [section.id]: !isOpen }))
                  }
                  className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-3 text-left hover:bg-muted/45"
                >
                  {isOpen ? (
                    <ChevronDown size={15} className="shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
                  )}
                  <span className="font-medium text-foreground">{section.displayTitle}</span>
                  {isModified && (
                    <span className="badge badge-warn shrink-0">
                      {t('已修改', 'Modified')}
                    </span>
                  )}
                  {!isOpen && (
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
                      {section.summaryLine}
                    </span>
                  )}
                </button>
                {isOpen && (
                  <ul className="m-0 list-disc space-y-1.5 border-t border-border py-3 pr-4 pl-9 text-[13.5px] leading-relaxed text-foreground">
                    {section.displayLines.map((line, lineIdx) => (
                      <li key={`${section.id}-${lineIdx}`}>{line}</li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </article>
      ) : outlineCount > 0 ? (
        <article className="space-y-2" data-testid="requirements-forming-outline">
          {convergedOutline.objects.length > 0 && (
            <section className="card space-y-2 p-4">
              <h3 className="m-0 text-[14px] font-semibold text-foreground">
                {t('识别到的业务对象', 'Business Objects')}
              </h3>
              <ul className="m-0 list-disc space-y-1 pl-5 text-[13.5px] text-foreground">
                {convergedOutline.objects.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          )}
          {convergedOutline.decisions.length > 0 && (
            <section className="card space-y-2 p-4">
              <h3 className="m-0 text-[14px] font-semibold text-foreground">
                {t('已明确的业务约定', 'Confirmed Business Choices')}
              </h3>
              <ul className="m-0 list-disc space-y-1 pl-5 text-[13.5px] text-foreground">
                {convergedOutline.decisions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          )}
          {convergedOutline.rules.length > 0 && (
            <section className="card space-y-2 p-4">
              <h3 className="m-0 text-[14px] font-semibold text-foreground">
                {t('业务规则要点', 'Key Business Rules')}
              </h3>
              <ul className="m-0 list-disc space-y-1 pl-5 text-[13.5px] text-foreground">
                {convergedOutline.rules.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          )}
          {convergedOutline.openQuestions.length > 0 && (
            <section className="card space-y-2 p-4">
              <h3 className="m-0 text-[14px] font-semibold text-foreground">
                {t('待你补充确认的问题', 'Open Questions')}
              </h3>
              <ul className="m-0 list-disc space-y-1 pl-5 text-[13.5px] text-muted-foreground">
                {convergedOutline.openQuestions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          )}
        </article>
      ) : (
        <section className="card flex flex-col items-center justify-center gap-2 py-12 text-center">
          <Sparkles size={22} className="text-primary" aria-hidden="true" />
          <h3 className="m-0 text-[15px] font-semibold text-foreground">
            {t('需求文档将在对话中逐步成形', 'Your requirements document will take shape here')}
          </h3>
          <p className="m-0 max-w-[460px] text-[13px] leading-relaxed text-muted-foreground">
            {t(
              '在左侧向 AI 助手描述你想做的业务系统、参与角色与关键流程。遇到需要你做选择的地方，AI 助手会给出可点选的方案。',
              'Tell the AI Assistant on the left what system you want to build, who uses it, and how key workflows run. When choices arise, you will get clickable options.',
            )}
          </p>
        </section>
      )}

      <ArtifactHistoryDrawer
        open={historyDrawerOpen}
        onOpenChange={handleHistoryDrawerOpenChange}
        artifactLabel={{ zh: '需求文档', en: 'Requirements Document' }}
        entries={reqHistoryEntries}
        busyEntryId={historyBusyEntryId}
        onUndoLatest={handleUndoLatestFromDrawer}
        onRestoreBefore={handleRestoreBeforeFromDrawer}
        onJumpToTarget={handleJumpFromDrawer}
      />
    </div>
  );
}
