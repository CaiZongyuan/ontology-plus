import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  Copy,
  GitBranch,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import type { RequirementDoc } from '../../../packages/workspace-store/index.js';
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
import { TiptapMarkdownEditor } from '../../components/markdown/index.js';
import { usePreferences, type NavViewId } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
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
    const res = await apiPostJson<{ doc: RequirementDoc; docs: RequirementDoc[] }>(
      '/api/requirements/docs',
      {
        id: targetId,
        projectId: data.activeProject.id,
        title: docTitle.trim() || `${data.activeProject.name} 软件需求规格说明书`,
        version: docVersion.trim() || 'v1.0',
        content: mdToSave,
        status: 'CONFIRMED',
      },
    );
    patchData({ requirementDocs: res.docs });
    setSelectedDocId(res.doc.id);
    showToast(
      t(
        '《软件需求说明书》已保存并标记为 CONFIRMED',
        'SRS Document saved and marked CONFIRMED',
      ),
    );
  };

  const handleCreateBlankDoc = async () => {
    const res = await apiPostJson<{ doc: RequirementDoc; docs: RequirementDoc[] }>(
      '/api/requirements/docs',
      {
        id: `doc-${Date.now()}`,
        projectId: data.activeProject.id,
        title: `${data.activeProject.name} 需求规格书 #${docs.length + 1}`,
        version: 'v1.0',
        content: `# ${data.activeProject.name} 软件需求规格说明书\n\n## 1. 业务目标与范围\n\n## 2. 核心领域对象与状态机\n\n| 对象名称 | 编码 | 核心职责 |\n| --- | --- | --- |\n| 示例聚合根 | AGG-01 | 核心业务单据 |\n`,
        status: 'DRAFT',
      },
    );
    patchData({ requirementDocs: res.docs });
    setSelectedDocId(res.doc.id);
    setPageMode('WORKSPACE');
    showToast(t('已新建需求规格书草稿', 'Created new SRS draft'));
  };

  const handleCloneDoc = async (doc: RequirementDoc) => {
    const res = await apiPostJson<{ doc: RequirementDoc; docs: RequirementDoc[] }>(
      '/api/requirements/docs',
      {
        id: `doc-clone-${Date.now()}`,
        projectId: data.activeProject.id,
        title: `${doc.title} (副本)`,
        version: doc.version,
        content: doc.content,
        status: 'DRAFT',
      },
    );
    patchData({ requirementDocs: res.docs });
    showToast(t(`已克隆文档「${doc.title}」`, `Cloned "${doc.title}"`));
  };

  const handleConfirmDeleteDoc = async () => {
    if (!deletingDoc) return;
    const res = await apiDeleteResource<{ docs: RequirementDoc[] }>(
      `/api/requirements/docs/${deletingDoc.id}?projectId=${data.activeProject.id}`,
    );
    patchData({ requirementDocs: res.docs });
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
    const res = await apiPostJson<{ doc: RequirementDoc; docs: RequirementDoc[] }>(
      '/api/requirements/docs',
      {
        id: `doc-upload-${Date.now()}`,
        projectId: data.activeProject.id,
        title: baseTitle,
        version: 'v1.0',
        content: text,
        status: 'CONFIRMED',
      },
    );
    patchData({ requirementDocs: res.docs });
    setSelectedDocId(res.doc.id);
    setDocTitle(res.doc.title);
    setDocVersion(res.doc.version);
    setContent(text);
    setPageMode('WORKSPACE');
    showToast(
      t(
        `已导入本地需求规格书「${file.name}」并保存`,
        `Imported and saved Markdown document "${file.name}"`,
      ),
    );
  };

  const handleGeneratePrototype = async () => {
    if (generatingProto) return;
    let targetDocId = selectedDoc?.id;
    if (!targetDocId && content.trim()) {
      const saveJson = await apiPostJson<{ doc: RequirementDoc; docs: RequirementDoc[] }>(
        '/api/requirements/docs',
        {
          id: `doc-${Date.now()}`,
          projectId: data.activeProject.id,
          title: docTitle.trim() || `${data.activeProject.name} 软件需求规格说明书`,
          version: docVersion.trim() || 'v1.0',
          content,
          status: 'CONFIRMED',
        },
      );
      patchData({ requirementDocs: saveJson.docs });
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
          saveLabel={t('保存并确认', 'Save & Confirm')}
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
