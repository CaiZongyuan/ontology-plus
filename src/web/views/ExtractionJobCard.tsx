import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Trash2, X } from 'lucide-react';
import {
  classifyCandidates,
  previewCandidateMerge,
  tallyCandidates,
  type CandidateDecision,
  type ExtractionCandidate,
  type ModelCode,
} from '../../packages/ontology-core/index.js';
import type { ExtractionJob, ProjectDetail } from '../../packages/workspace-store/index.js';
import { Button } from '../components/beautifui/index.js';
import { usePreferences } from '../i18n.js';

type Decisions = Record<string, CandidateDecision>;

/**
 * One Ontology Extraction job: what it proposes, the evidence each Extraction
 * Candidate rests on, and the per-candidate Confirmation. The merge preview
 * runs here with the same function the server uses as its gate.
 */
export function ExtractionJobCard(props: {
  job: ExtractionJob;
  /** The job's target project, when it is the one open in the workbench. */
  project: ProjectDetail | undefined;
  merging: boolean;
  onSaveDecisions: (jobId: string, changes: Record<string, CandidateDecision | null>) => void;
  onMerge: (jobId: string) => void;
  onDelete: (job: ExtractionJob) => void;
}) {
  const { job, project, merging, onSaveDecisions, onMerge, onDelete } = props;
  const { t } = usePreferences();
  const [expanded, setExpanded] = useState(false);
  const [decisions, setDecisions] = useState<Decisions>(job.decisions);

  useEffect(() => {
    setDecisions(job.decisions);
  }, [job.decisions]);

  const merged = Boolean(job.appliedToProject);
  const canReview = !merged && Boolean(project);
  const tally = useMemo(() => tallyCandidates(job.candidates, decisions), [job.candidates, decisions]);

  const standing = useMemo(
    () => (project && expanded ? classifyCandidates(project.suite, job.candidates) : {}),
    [project, expanded, job.candidates],
  );
  const preview = useMemo(
    () =>
      project && expanded && canReview
        ? previewCandidateMerge({
            current: project.suite,
            candidates: job.candidates,
            decisions,
            domain: project.domain,
          })
        : null,
    [project, expanded, canReview, job.candidates, decisions],
  );

  const groups = useMemo(() => {
    const byModel = new Map<ModelCode, ExtractionCandidate[]>();
    for (const cand of job.candidates) {
      (byModel.get(cand.modelCode) ?? byModel.set(cand.modelCode, []).get(cand.modelCode)!).push(cand);
    }
    return [...byModel.entries()];
  }, [job.candidates]);

  const decide = (changes: Record<string, CandidateDecision | null>) => {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const [key, value] of Object.entries(changes)) {
        if (value) next[key] = value;
        else delete next[key];
      }
      return next;
    });
    onSaveDecisions(job.id, changes);
  };

  const alignment = job.semanticAlignment;
  const structureOnly = alignment.status !== 'DONE';
  const alignmentReason =
    alignment.reason === 'MOCK_MODE'
      ? t('Mock 模式下未执行语义对齐', 'Semantic alignment did not run in Mock mode')
      : alignment.reason === 'GATEWAY_ERROR'
        ? t('语义对齐失败：LLM 网关不可用', 'Semantic alignment failed: LLM gateway unavailable')
        : alignment.reason === 'UNUSABLE_RESPONSE'
          ? t('语义对齐失败：LLM 返回的内容不可用', 'Semantic alignment failed: the LLM response was unusable')
          : alignment.reason === 'LEGACY_JOB'
            ? t('升级前创建的任务', 'Created before candidates existed')
            : alignment.reason === 'NOT_REQUESTED'
              ? t('未请求语义对齐', 'Semantic alignment was not requested')
              : '';

  return (
    <div
      className="p-2.5 rounded-[6px] bg-inset border border-line flex flex-col gap-1.5"
      data-testid={`extraction-job-${job.id}`}
    >
      <div className="flex justify-between items-start gap-2">
        <div>
          <strong>{job.title}</strong>
          <div className="text-[11.5px] text-muted-foreground font-mono">
            {job.sourceType} · Project: {job.projectId}
          </div>
        </div>
        <div className="flex gap-1 shrink-0 items-center">
          <span className={`badge ${merged ? 'badge-ok' : 'badge-warn'}`}>
            {merged
              ? job.appliedCandidateCount !== undefined
                ? t(`已合并 ${job.appliedCandidateCount} 项`, `Merged ${job.appliedCandidateCount}`)
                : t('已合并至工程', 'Merged')
              : job.candidates.length === 0
                ? t('未产生候选', 'No candidates')
                : t('待确认', 'Pending confirmation')}
          </span>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onDelete(job)}
            title={t('删除任务记录', 'Delete job')}
          >
            <Trash2 size={11.5} className="text-red" />
          </Button>
        </div>
      </div>

      <div className="text-[12.5px] text-muted-foreground">{job.summary}</div>

      <div className="flex flex-wrap gap-1.5 text-[11.5px] font-mono">
        <span className="badge" title={t('由结构扫描从源材料读出', 'Read off the source by the structural scan')}>
          {t('读出', 'Parsed')}: {tally.parsed}
        </span>
        <span className="badge" title={t('由 LLM 推断得出', 'Inferred by the LLM')}>
          {t('推断', 'Inferred')}: {tally.inferred}
        </span>
        {tally.supplemented > 0 && (
          <span
            className="badge"
            title={t('无源材料依据，为保持套件一致而补充', 'No source evidence; added to keep the suite consistent')}
          >
            {t('补充', 'Supplemented')}: {tally.supplemented}
          </span>
        )}
        <span className="badge">
          {t('已确认', 'Confirmed')}: {tally.accepted + tally.rejected}/{tally.total}
        </span>
        <span className={`badge ${structureOnly ? 'badge-warn' : 'badge-ok'}`} title={alignmentReason}>
          {structureOnly
            ? t('仅结构扫描', 'Structural scan only')
            : t('结构扫描 + 语义对齐', 'Scan + semantic alignment')}
        </span>
      </div>

      {structureOnly && alignment.status === 'FAILED' && (
        <div className="text-[12px] p-[6px_8px] rounded-[6px] border border-line bg-surface">
          <div className="font-medium">{alignmentReason}</div>
          {alignment.diagnostic && (
            <div className="text-muted-foreground">
              {alignment.diagnostic.providerName ? `${alignment.diagnostic.providerName} · ` : ''}
              {alignment.diagnostic.message}
              {alignment.diagnostic.remediation ? ` ${alignment.diagnostic.remediation}` : ''}
            </div>
          )}
        </div>
      )}

      {(alignment.dropped?.length || alignment.omitted) && (
        <details className="text-[12px]">
          <summary className="cursor-pointer text-muted-foreground">
            {alignment.dropped?.length
              ? t(
                  `语义对齐丢弃了 ${alignment.dropped.length} 项不合规内容`,
                  `Semantic alignment dropped ${alignment.dropped.length} invalid proposals`,
                )
              : t('语义对齐输入已截断', 'Semantic alignment input was capped')}
          </summary>
          <ul className="mt-1 pl-4 list-disc font-mono text-[11.5px]">
            {alignment.omitted && (
              <li>
                {t(
                  `超出规模上限未送入：${alignment.omitted.tables} 张表、${alignment.omitted.columns} 列`,
                  `Left out by the size cap: ${alignment.omitted.tables} tables, ${alignment.omitted.columns} columns`,
                )}
              </li>
            )}
            {(alignment.dropped ?? []).map((d, i) => (
              <li key={`${d.item}-${i}`}>
                {d.item} — {d.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex justify-between items-center gap-2 flex-wrap">
        <div className="flex flex-wrap gap-1">
          {job.extractedModels.map((m) => (
            <span key={m} className="badge badge-accent">
              {m}
            </span>
          ))}
        </div>
        {job.candidates.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={expanded}
            data-testid={`extraction-candidates-toggle-${job.id}`}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {t(`萃取候选 (${job.candidates.length})`, `Candidates (${job.candidates.length})`)}
          </Button>
        )}
      </div>

      {expanded && (
        <div className="flex flex-col gap-2 pt-1 border-t border-line">
          {!merged && !project && (
            <div className="text-[12px] text-muted-foreground">
              {t(
                '切换到该任务的目标工程后，才能确认候选并合并。',
                "Open this job's target project to confirm candidates and merge.",
              )}
            </div>
          )}

          {groups.map(([modelCode, list]) => (
            <div key={modelCode} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold font-mono">
                  {modelCode} · {list.length}
                </span>
                {canReview && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        decide(Object.fromEntries(list.map((c) => [c.key, 'ACCEPTED' as const])))
                      }
                    >
                      {t('全部采纳', 'Accept all')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        decide(Object.fromEntries(list.map((c) => [c.key, 'REJECTED' as const])))
                      }
                    >
                      {t('全部拒绝', 'Reject all')}
                    </Button>
                  </div>
                )}
              </div>

              {list.map((cand) => {
                const state = standing[cand.key];
                const decision = decisions[cand.key];
                const inferredOnly =
                  cand.evidence.length > 0 && !cand.evidence.some((e) => e.origin === 'PARSED');
                return (
                  <div
                    key={cand.key}
                    className="p-[6px_8px] rounded-[6px] bg-surface border border-line flex flex-col gap-1"
                    data-testid={`extraction-candidate-${cand.key}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1 text-[12.5px]">
                          {state && (
                            <span
                              className={`badge ${state === 'MODIFIED' ? 'badge-warn' : state === 'ADDED' ? 'badge-accent' : ''}`}
                              title={
                                state === 'MODIFIED'
                                  ? t(
                                      '工程中已有同 ID 元素：采纳 = 采用候选，拒绝 = 保留现有',
                                      'An element with this ID exists: accept takes the candidate, reject keeps the existing one',
                                    )
                                  : undefined
                              }
                            >
                              {state === 'ADDED'
                                ? t('新增', 'New')
                                : state === 'MODIFIED'
                                  ? t('修改', 'Modifies')
                                  : t('已在工程中', 'Already in project')}
                            </span>
                          )}
                          <span className="font-medium truncate">{cand.label}</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono truncate">
                          {cand.elementId}
                        </div>
                      </div>

                      {canReview && state !== 'UNCHANGED' && (
                        <div className="flex gap-1 shrink-0">
                          <Button
                            variant="toggle"
                            size="xs"
                            aria-pressed={decision === 'ACCEPTED'}
                            data-testid={`accept-${cand.key}`}
                            onClick={() =>
                              decide({ [cand.key]: decision === 'ACCEPTED' ? null : 'ACCEPTED' })
                            }
                          >
                            <Check size={11.5} />
                            {t('采纳', 'Accept')}
                          </Button>
                          <Button
                            variant="toggle"
                            size="xs"
                            aria-pressed={decision === 'REJECTED'}
                            data-testid={`reject-${cand.key}`}
                            onClick={() =>
                              decide({ [cand.key]: decision === 'REJECTED' ? null : 'REJECTED' })
                            }
                          >
                            <X size={11.5} />
                            {t('拒绝', 'Reject')}
                          </Button>
                        </div>
                      )}
                      {!canReview && decision && (
                        <span className={`badge ${decision === 'ACCEPTED' ? 'badge-ok' : ''}`}>
                          {decision === 'ACCEPTED' ? t('已采纳', 'Accepted') : t('已拒绝', 'Rejected')}
                        </span>
                      )}
                    </div>

                    {cand.evidence.length === 0 ? (
                      <div className="text-[11.5px] text-muted-foreground">
                        {t(
                          '无源材料依据：为保持套件一致而补充。',
                          'No source evidence: added to keep the suite consistent.',
                        )}
                      </div>
                    ) : (
                      <details className="text-[11.5px]">
                        <summary className="cursor-pointer text-muted-foreground">
                          <span className={`badge ${inferredOnly ? 'badge-warn' : ''}`}>
                            {inferredOnly ? t('推断', 'Inferred') : t('读出', 'Parsed')}
                          </span>{' '}
                          {cand.evidence[0]!.note}
                          {cand.evidence.length > 1 ? ` +${cand.evidence.length - 1}` : ''}
                        </summary>
                        <div className="mt-1 flex flex-col gap-1">
                          {cand.evidence.map((ev, i) => (
                            <div key={i}>
                              <div className="text-muted-foreground">
                                {ev.origin === 'PARSED'
                                  ? t('结构扫描读出', 'Parsed by the structural scan')
                                  : ev.origin === 'INFERRED'
                                    ? t('语义对齐推断', 'Inferred by semantic alignment')
                                    : ev.origin}
                                {ev.lines
                                  ? ` · ${t('源材料第', 'source lines ')}${ev.lines.startLine}${
                                      ev.lines.endLine !== ev.lines.startLine
                                        ? `–${ev.lines.endLine}`
                                        : ''
                                    }${t(' 行', '')}`
                                  : ''}
                                {ev.unverified ? ` · ${t('无可核对出处', 'no verifiable passage')}` : ''}
                                {` · ${ev.note}`}
                              </div>
                              {ev.excerpt && (
                                <pre className="m-0 p-[6px_8px] rounded-[6px] bg-inset border border-line font-mono text-[11px] whitespace-pre-wrap break-words">
                                  {ev.excerpt}
                                </pre>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {canReview && preview && (
            <div className="flex flex-col gap-1.5 pt-1 border-t border-line">
              {preview.newErrors.length > 0 ? (
                <div
                  className="text-[12px] p-[6px_8px] rounded-[6px] border border-line bg-surface"
                  data-testid={`extraction-merge-blocked-${job.id}`}
                >
                  <div className="font-medium text-red">
                    {t(
                      `按当前选择合并会引入 ${preview.newErrors.length} 个一致性错误，需调整采纳项：`,
                      `Merging this selection would introduce ${preview.newErrors.length} Consistency Errors; adjust what you accept:`,
                    )}
                  </div>
                  <ul className="mt-1 pl-4 list-disc">
                    {preview.newErrors.slice(0, 8).map((d) => (
                      <li key={d.id}>
                        <span className="font-mono">
                          {d.model}
                          {d.elementId ? ` ${d.elementId}` : ''}
                        </span>{' '}
                        {t(d.messageZh, d.messageEn)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="text-[12px] text-muted-foreground">
                  {preview.acceptedCount > 0
                    ? t(
                        `按当前选择合并不会引入新的一致性错误。`,
                        `Merging this selection introduces no new Consistency Errors.`,
                      )
                    : t('尚未采纳任何候选。', 'No candidate accepted yet.')}
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  variant="accent"
                  size="sm"
                  data-testid={`extraction-merge-${job.id}`}
                  disabled={merging || preview.acceptedCount === 0 || preview.newErrors.length > 0}
                  onClick={() => onMerge(job.id)}
                >
                  {merging
                    ? t('正在合并...', 'Merging...')
                    : t(
                        `合并已采纳的 ${preview.acceptedCount} 项`,
                        `Merge ${preview.acceptedCount} accepted`,
                      )}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
