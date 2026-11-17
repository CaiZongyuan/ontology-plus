import {
  BUSINESS_VOCABULARY,
  MODEL_BUSINESS_NAMES,
  checkBusinessViewMarkup,
  type BilingualText,
  type BusinessLocale,
} from '../../business-vocabulary/index.js';
import type { ModelCode, OntologySuite } from '../../ontology-core/index.js';
import { computeOntologySuiteHash, normalizeStepMarkdown } from './step-confirmations.js';
import type {
  ArtifactHistoryEntry,
  ArtifactHistoryEntryView,
  ArtifactHistorySource,
  ChangeSummaryItemView,
  ChangeSummaryView,
  PersistedArtifactHistoryKind,
  RequirementDoc,
  RequirementDocDiff,
  RequirementDocHistoryState,
  RequirementDocSnapshot,
  RequirementSectionChange,
} from './types.js';

export const DEFAULT_MAX_ARTIFACT_HISTORY_ENTRIES = 50;

export class ArtifactHistoryConflictError extends Error {
  readonly code: 'NOTHING_TO_UNDO' | 'STALE_LATEST_ENTRY';
  readonly messageZh: string;
  readonly messageEn: string;

  constructor(params: {
    code: 'NOTHING_TO_UNDO' | 'STALE_LATEST_ENTRY';
    messageZh: string;
    messageEn: string;
  }) {
    super(`${params.messageZh} (${params.messageEn})`);
    this.name = 'ArtifactHistoryConflictError';
    this.code = params.code;
    this.messageZh = params.messageZh;
    this.messageEn = params.messageEn;
  }
}

export class ArtifactHistoryNotFoundError extends Error {
  readonly code = 'ARTIFACT_HISTORY_ENTRY_NOT_FOUND' as const;
  readonly entryId: string;

  constructor(entryId: string) {
    super(`Artifact history entry not found: ${entryId}`);
    this.name = 'ArtifactHistoryNotFoundError';
    this.entryId = entryId;
  }
}

const ELEMENT_ID_RE =
  /(?<![A-Za-z0-9_-])(?:AGG|ENT|VO|DIC|DICT|ASSOC|BHV|BEH|RUL|RULE|EVT|SCN|ACT|ROL|ROLE|PERM|PGRP|FLW|FLOW|ACTV|QRY|RPT|SCR|EL|UIE|NAV|CC|MAP|INT|IF|MET|ASCN|WB)-[A-Z0-9]+(?:-[A-Z0-9]+)*(?![A-Za-z0-9_-])/g;

const MODEL_STAGE_CODE_RE =
  /(?<![A-Za-z0-9_])(?:M[1-7]|ME|MU|MM|MI|STAGE)_[A-Z0-9_]+(?![A-Za-z0-9_])/g;

const PHYSICAL_TABLE_RE = /(?<![A-Za-z0-9_])t_[a-z][a-z0-9_]+(?![A-Za-z0-9_])/g;

const MODEL_CODE_RE = /(?<![A-Za-z0-9_])(M[1-7]|ME|MU|MM|MI)(?![A-Za-z0-9_])/g;

/**
 * Sanitizes section headings, excerpts, and assistant notes so Business View surfaces
 * never leak model codes (`M1`–`MI`), element IDs (`AGG-01`), file extensions, or protocol names.
 */
export function sanitizeBusinessViewCopy(
  raw: string,
  locale: BusinessLocale = 'zh-CN',
): string {
  if (!raw) return '';
  let out = raw;
  out = out.replace(/[（(]\s*(?:对应|映射|关联|对齐)[^)）]*(?:M[1-7]|ME|MU|MM|MI)[^)）]*[)）]/g, '');
  out = out.replace(
    /[`'"]?\s*\/\s*[`'"]?(?:AGG|ENT|VO|DIC|DICT|ASSOC|BHV|BEH|RUL|RULE|EVT|SCN|ACT|ROL|ROLE|PERM|PGRP|FLW|FLOW|ACTV|QRY|RPT|SCR|EL|UIE|NAV|CC|MAP|INT|IF|MET|ASCN|WB)-[A-Z0-9-]+[`'"]?/g,
    '',
  );
  out = out.replace(ELEMENT_ID_RE, '');
  out = out.replace(MODEL_STAGE_CODE_RE, '');
  out = out.replace(PHYSICAL_TABLE_RE, locale === 'en-US' ? 'business table' : '业务数据表');
  out = out.replace(MODEL_CODE_RE, (_m, code: string) => {
    const entry = MODEL_BUSINESS_NAMES[code as ModelCode];
    return entry ? (locale === 'en-US' ? entry.en : entry.zh) : '';
  });
  out = out.replace(/\.(?:yaml|yml|json|owl|ddl|sql|md|html|css|zip)(?![A-Za-z0-9_])/gi, '');
  out = out.replace(
    /(?<![A-Za-z0-9_])(?:YAML|YML|JSON|OWL|DDL|SQLite|SQL|Markdown|HTML5?|CSS|ZIP)(?![A-Za-z0-9_])/gi,
    locale === 'en-US' ? 'document' : '规格',
  );
  out = out.replace(
    /(?<![A-Za-z0-9_])(?:gRPC|RPC|MCP|SSE|REST|HTTPS?|RESTful|GraphQL|OpenAPI)(?![A-Za-z0-9_])/gi,
    locale === 'en-US' ? 'integration' : '接口',
  );
  out = out.replace(
    /(?<![A-Za-z0-9_])(?:Agent\s+Sessions?|Agent\s+Runs?|Agent\s+Panels?|Architecture\s+Asset\s+Agent|Application\s+Development\s+Agent|Application\s+Coding\s+Agent|Copilot|PROTOTYPE_CO_DESIGN)(?![A-Za-z0-9_])|智能体会话|智能体运行|智能体面板|Agent\s*面板|Agent\s*运行|架构资产智能体|应用开发智能体/gi,
    locale === 'en-US' ? BUSINESS_VOCABULARY.AI_ASSISTANT.en : BUSINESS_VOCABULARY.AI_ASSISTANT.zh,
  );
  out = out
    .replace(/[`]/g, '')
    .replace(/\(\s*\)|（\s*）/g, '')
    .replace(/^\s*[:：\-·]+\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (checkBusinessViewMarkup(out, { plainText: true }).length > 0) {
    return '';
  }
  return out;
}

export function toRequirementDocSnapshot(doc: RequirementDoc): RequirementDocSnapshot {
  return {
    id: doc.id,
    projectId: doc.projectId,
    title: doc.title,
    version: doc.version,
    status: doc.status,
    content: doc.content,
  };
}

export function captureRequirementDocState(docs: readonly RequirementDoc[]): RequirementDocHistoryState {
  const snapshots = docs.map(toRequirementDocSnapshot);
  return {
    doc: snapshots[0] ?? null,
    docs: snapshots,
  };
}

function areDocSnapshotsEqual(
  a: RequirementDocSnapshot | null,
  b: RequirementDocSnapshot | null,
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return (
    a.id === b.id &&
    a.title.trim() === b.title.trim() &&
    normalizeStepMarkdown(a.content) === normalizeStepMarkdown(b.content)
  );
}

export function areRequirementDocStatesEqual(
  before: RequirementDocHistoryState,
  after: RequirementDocHistoryState,
): boolean {
  if (!areDocSnapshotsEqual(before.doc, after.doc)) return false;
  if (before.docs.length !== after.docs.length) return false;
  for (let i = 0; i < before.docs.length; i += 1) {
    if (!areDocSnapshotsEqual(before.docs[i]!, after.docs[i]!)) return false;
  }
  return true;
}

export function areOntologySuitesEqual(before: OntologySuite, after: OntologySuite): boolean {
  return computeOntologySuiteHash(before) === computeOntologySuiteHash(after);
}

interface ParsedMarkdownSection {
  heading: string;
  exactKey: string;
  titleOnlyKey: string;
  bodyLines: string[];
  normalizedBody: string;
}

function normalizeHeadingExactKey(heading: string): string {
  return heading.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeHeadingTitleOnlyKey(heading: string): string {
  const stripped = heading
    .trim()
    .replace(/^\d+(?:\.\d+)*[.\s、：:-]+/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  return stripped || normalizeHeadingExactKey(heading);
}

function normalizeContentLines(lines: readonly string[]): string[] {
  return lines
    .map((line) => line.replace(/\s+$/g, '').trim())
    .filter((line) => line.length > 0 && !/^\|?\s*[-:]+\s*\|/.test(line));
}

function parseMarkdownIntoSections(markdown: string): {
  documentHeading: string;
  sections: ParsedMarkdownSection[];
} {
  const normalized = normalizeStepMarkdown(markdown);
  if (!normalized) {
    return { documentHeading: '', sections: [] };
  }
  const lines = normalized.split('\n');
  const hasH2 = lines.some((l) => /^##\s+\S/.test(l.trim()));
  const hasH3 = !hasH2 && lines.some((l) => /^###\s+\S/.test(l.trim()));
  const sectionPattern = hasH2
    ? /^##\s+(.+)$/
    : hasH3
      ? /^###\s+(.+)$/
      : /^#\s+(.+)$/;

  let documentHeading = '';
  const rawSections: { heading: string; bodyLines: string[] }[] = [];
  let current: { heading: string; bodyLines: string[] } | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if ((hasH2 || hasH3) && /^#\s+(.+)$/.test(trimmed) && !/^##/.test(trimmed)) {
      if (!documentHeading) {
        documentHeading = trimmed.replace(/^#\s+/, '').trim();
      }
      continue;
    }
    const match = sectionPattern.exec(trimmed);
    if (match) {
      if (current) rawSections.push(current);
      current = { heading: match[1]!.trim(), bodyLines: [] };
      continue;
    }
    if (!current) {
      if (!trimmed) continue;
      current = { heading: '业务目标与范围', bodyLines: [] };
    }
    current.bodyLines.push(rawLine);
  }
  if (current) rawSections.push(current);

  const sections: ParsedMarkdownSection[] = rawSections.map((sec) => {
    const cleanLines = normalizeContentLines(sec.bodyLines);
    return {
      heading: sec.heading,
      exactKey: normalizeHeadingExactKey(sec.heading),
      titleOnlyKey: normalizeHeadingTitleOnlyKey(sec.heading),
      bodyLines: cleanLines,
      normalizedBody: cleanLines.join('\n'),
    };
  });

  return { documentHeading, sections };
}

function computeLineMultisetDelta(
  beforeLines: readonly string[],
  afterLines: readonly string[],
): { addedLines: number; removedLines: number; firstAdded?: string; firstRemoved?: string } {
  const beforeCounts = new Map<string, number>();
  for (const line of beforeLines) {
    beforeCounts.set(line, (beforeCounts.get(line) ?? 0) + 1);
  }
  let addedLines = 0;
  let firstAdded: string | undefined;
  const remainingBefore = new Map(beforeCounts);
  for (const line of afterLines) {
    const count = remainingBefore.get(line) ?? 0;
    if (count > 0) {
      remainingBefore.set(line, count - 1);
    } else {
      addedLines += 1;
      if (firstAdded === undefined) firstAdded = line;
    }
  }

  let removedLines = 0;
  let firstRemoved: string | undefined;
  const afterCounts = new Map<string, number>();
  for (const line of afterLines) {
    afterCounts.set(line, (afterCounts.get(line) ?? 0) + 1);
  }
  for (const line of beforeLines) {
    const count = afterCounts.get(line) ?? 0;
    if (count > 0) {
      afterCounts.set(line, count - 1);
    } else {
      removedLines += 1;
      if (firstRemoved === undefined) firstRemoved = line;
    }
  }

  return {
    addedLines,
    removedLines,
    ...(firstAdded !== undefined ? { firstAdded } : {}),
    ...(firstRemoved !== undefined ? { firstRemoved } : {}),
  };
}

function cleanExcerptLine(rawLine: string | undefined): string | undefined {
  if (!rawLine) return undefined;
  const stripped = rawLine
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .trim();
  const safe = sanitizeBusinessViewCopy(stripped, 'zh-CN');
  if (!safe) return undefined;
  return safe.length > 72 ? `${safe.slice(0, 71)}…` : safe;
}

function formatLineDeltaDetailZh(added: number, removed: number): string {
  if (added > 0 && removed > 0) return `新增 ${added} 行，移除 ${removed} 行`;
  if (added > 0) return `新增 ${added} 行`;
  if (removed > 0) return `移除 ${removed} 行`;
  return '调整了章节表述';
}

function formatLineDeltaDetailEn(added: number, removed: number): string {
  if (added > 0 && removed > 0) return `+${added} lines, -${removed} lines`;
  if (added > 0) return `+${added} lines`;
  if (removed > 0) return `-${removed} lines`;
  return 'Updated section wording';
}

/**
 * Computes deterministic section-level differences between two `RequirementDocSnapshot` states.
 * All returned section summaries and excerpts are sanitized for Business View presentation.
 */
export function computeRequirementDocDiff(
  before: Pick<RequirementDocSnapshot, 'title' | 'content'> | null | undefined,
  after: Pick<RequirementDocSnapshot, 'title' | 'content'> | null | undefined,
): RequirementDocDiff {
  const beforeContent = normalizeStepMarkdown(before?.content ?? '');
  const afterContent = normalizeStepMarkdown(after?.content ?? '');
  const beforeTitle = (before?.title ?? '').trim();
  const afterTitle = (after?.title ?? '').trim();
  const titleChanged = Boolean(before && after && beforeTitle !== afterTitle);

  if (beforeContent === afterContent && !titleChanged && Boolean(before) === Boolean(after)) {
    return {
      hasChanges: false,
      titleChanged: false,
      ...(beforeTitle ? { beforeTitle } : {}),
      ...(afterTitle ? { afterTitle } : {}),
      addedCount: 0,
      modifiedCount: 0,
      removedCount: 0,
      sections: [],
    };
  }

  const parsedBefore = parseMarkdownIntoSections(beforeContent);
  const parsedAfter = parseMarkdownIntoSections(afterContent);

  const matchedBeforeIndexes = new Set<number>();
  const afterToBefore = new Map<number, number>();

  // Pass 1: exact heading match
  parsedAfter.sections.forEach((afterSec, aIdx) => {
    const bIdx = parsedBefore.sections.findIndex(
      (bSec, idx) => !matchedBeforeIndexes.has(idx) && bSec.exactKey === afterSec.exactKey,
    );
    if (bIdx >= 0) {
      matchedBeforeIndexes.add(bIdx);
      afterToBefore.set(aIdx, bIdx);
    }
  });

  // Pass 2: stripped-number title match for renumbered sections
  parsedAfter.sections.forEach((afterSec, aIdx) => {
    if (afterToBefore.has(aIdx)) return;
    const bIdx = parsedBefore.sections.findIndex(
      (bSec, idx) =>
        !matchedBeforeIndexes.has(idx) &&
        bSec.titleOnlyKey.length >= 2 &&
        bSec.titleOnlyKey === afterSec.titleOnlyKey,
    );
    if (bIdx >= 0) {
      matchedBeforeIndexes.add(bIdx);
      afterToBefore.set(aIdx, bIdx);
    }
  });

  const sections: RequirementSectionChange[] = [];
  let addedCount = 0;
  let modifiedCount = 0;
  let removedCount = 0;

  parsedAfter.sections.forEach((afterSec, aIdx) => {
    const matchedIdx = afterToBefore.get(aIdx);
    const titleZh =
      sanitizeBusinessViewCopy(afterSec.heading, 'zh-CN') || `第 ${aIdx + 1} 部分`;
    const titleEn =
      sanitizeBusinessViewCopy(afterSec.heading, 'en-US') || `Section ${aIdx + 1}`;

    if (matchedIdx === undefined) {
      const addedLines = Math.max(1, afterSec.bodyLines.length);
      const excerpt = cleanExcerptLine(afterSec.bodyLines[0]);
      addedCount += 1;
      sections.push({
        id: `sec-add-${aIdx}`,
        changeType: 'ADDED',
        sectionHeading: afterSec.heading,
        sectionTitle: titleZh,
        addedLines,
        removedLines: 0,
        ...(excerpt ? { excerpt } : {}),
        summary: {
          zh: `新增章节「${titleZh}」（${addedLines} 行）`,
          en: `Added section "${titleEn}" (${addedLines} lines)`,
        },
      });
      return;
    }

    const beforeSec = parsedBefore.sections[matchedIdx]!;
    if (
      beforeSec.normalizedBody === afterSec.normalizedBody &&
      beforeSec.heading === afterSec.heading
    ) {
      return;
    }

    const delta = computeLineMultisetDelta(beforeSec.bodyLines, afterSec.bodyLines);
    const excerpt = cleanExcerptLine(delta.firstAdded ?? delta.firstRemoved);
    modifiedCount += 1;
    sections.push({
      id: `sec-mod-${aIdx}`,
      changeType: 'MODIFIED',
      sectionHeading: afterSec.heading,
      sectionTitle: titleZh,
      addedLines: delta.addedLines,
      removedLines: delta.removedLines,
      ...(excerpt ? { excerpt } : {}),
      summary: {
        zh: `修改章节「${titleZh}」（${formatLineDeltaDetailZh(delta.addedLines, delta.removedLines)}）`,
        en: `Updated section "${titleEn}" (${formatLineDeltaDetailEn(delta.addedLines, delta.removedLines)})`,
      },
    });
  });

  parsedBefore.sections.forEach((beforeSec, bIdx) => {
    if (matchedBeforeIndexes.has(bIdx)) return;
    const titleZh =
      sanitizeBusinessViewCopy(beforeSec.heading, 'zh-CN') || `原第 ${bIdx + 1} 部分`;
    const titleEn =
      sanitizeBusinessViewCopy(beforeSec.heading, 'en-US') || `Previous section ${bIdx + 1}`;
    const removedLines = Math.max(1, beforeSec.bodyLines.length);
    const excerpt = cleanExcerptLine(beforeSec.bodyLines[0]);
    removedCount += 1;
    sections.push({
      id: `sec-rem-${bIdx}`,
      changeType: 'REMOVED',
      sectionHeading: beforeSec.heading,
      sectionTitle: titleZh,
      addedLines: 0,
      removedLines,
      ...(excerpt ? { excerpt } : {}),
      summary: {
        zh: `移除章节「${titleZh}」`,
        en: `Removed section "${titleEn}"`,
      },
    });
  });

  if (sections.length === 0 && (titleChanged || parsedBefore.documentHeading !== parsedAfter.documentHeading)) {
    const cleanAfterTitleZh =
      sanitizeBusinessViewCopy(afterTitle || parsedAfter.documentHeading, 'zh-CN') || '需求文档';
    const cleanAfterTitleEn =
      sanitizeBusinessViewCopy(afterTitle || parsedAfter.documentHeading, 'en-US') ||
      'Requirements Document';
    modifiedCount += 1;
    sections.push({
      id: 'sec-title',
      changeType: 'MODIFIED',
      sectionHeading: '',
      sectionTitle: cleanAfterTitleZh,
      addedLines: 0,
      removedLines: 0,
      summary: {
        zh: `更新文档标题为「${cleanAfterTitleZh}」`,
        en: `Updated document title to "${cleanAfterTitleEn}"`,
      },
    });
  }

  return {
    hasChanges: sections.length > 0,
    titleChanged,
    ...(beforeTitle ? { beforeTitle } : {}),
    ...(afterTitle ? { afterTitle } : {}),
    addedCount,
    modifiedCount,
    removedCount,
    sections,
  };
}

function buildEntryTitle(source: ArtifactHistorySource): BilingualText {
  switch (source.kind) {
    case 'AGENT_RUN':
      return {
        zh: `${BUSINESS_VOCABULARY.AI_ASSISTANT.zh}更新`,
        en: `${BUSINESS_VOCABULARY.AI_ASSISTANT.en} update`,
      };
    case 'MANUAL':
      return {
        zh: '手动修改',
        en: 'Manual edit',
      };
    case 'UNDO':
      return {
        zh: '撤销上一次改动',
        en: 'Undid latest change',
      };
    case 'RESTORE':
      return {
        zh: '恢复到较早状态',
        en: 'Restored earlier state',
      };
  }
}

function buildReasonFromSource(source: ArtifactHistorySource): BilingualText | undefined {
  const raw =
    source.kind === 'AGENT_RUN'
      ? source.reason
      : source.kind === 'MANUAL'
        ? source.note
        : undefined;
  if (!raw?.trim()) return undefined;
  const zh = sanitizeBusinessViewCopy(raw, 'zh-CN');
  const en = sanitizeBusinessViewCopy(raw, 'en-US');
  if (!zh && !en) return undefined;
  return {
    zh: zh || en,
    en: en || zh,
  };
}

export function buildArtifactHistoryViews(
  chronologicalEntries: readonly ArtifactHistoryEntry[],
): ArtifactHistoryEntryView[] {
  if (chronologicalEntries.length === 0) return [];
  const latestByKind = new Map<PersistedArtifactHistoryKind, string>();
  const byId = new Map<string, ArtifactHistoryEntry>();
  const activelyUndoneIds = new Set<string>();

  for (const entry of chronologicalEntries) {
    byId.set(entry.id, entry);
    latestByKind.set(entry.artifactKind, entry.id);
    if (entry.source.kind === 'UNDO') {
      activelyUndoneIds.add(entry.source.undoneEntryId);
      const target = byId.get(entry.source.undoneEntryId);
      if (target?.source.kind === 'UNDO') {
        activelyUndoneIds.delete(target.source.undoneEntryId);
      }
    }
  }

  const viewsNewestFirst: ArtifactHistoryEntryView[] = [];
  for (let i = chronologicalEntries.length - 1; i >= 0; i -= 1) {
    const entry = chronologicalEntries[i]!;
    const canUndo = latestByKind.get(entry.artifactKind) === entry.id;
    const isUndone = activelyUndoneIds.has(entry.id);
    const reason = buildReasonFromSource(entry.source);
    const title = buildEntryTitle(entry.source);

    if (entry.artifactKind === 'REQUIREMENTS_DOC') {
      const diff = computeRequirementDocDiff(entry.beforeState.doc, entry.afterState.doc);
      const activeDocId = entry.afterState.doc?.id ?? entry.beforeState.doc?.id ?? entry.targetId;
      const items: ChangeSummaryItemView[] = diff.sections.map((sec) => ({
        id: `${entry.id}-${sec.id}`,
        changeType: sec.changeType,
        label: sec.summary,
        ...(sec.excerpt
          ? {
              detail: {
                zh: sec.excerpt,
                en: sec.excerpt,
              },
            }
          : {}),
        ...(sec.changeType !== 'REMOVED' && sec.sectionHeading
          ? {
              jumpTarget: {
                kind: 'REQUIREMENTS_SECTION' as const,
                ...(activeDocId ? { docId: activeDocId } : {}),
                sectionHeading: sec.sectionHeading,
              },
            }
          : {}),
      }));

      if (items.length === 0 && !entry.afterState.doc && entry.beforeState.doc) {
        items.push({
          id: `${entry.id}-doc-cleared`,
          changeType: 'REMOVED',
          label: {
            zh: '恢复到创建需求文档之前的状态',
            en: 'Restored to the state before the requirements document was created',
          },
        });
      }

      const changeSummary: ChangeSummaryView = {
        entryId: entry.id,
        artifactKind: 'REQUIREMENTS_DOC',
        targetId: entry.targetId,
        ...(reason ? { reason } : {}),
        items,
        canUndo,
        ...(isUndone ? { isUndone: true } : {}),
      };

      viewsNewestFirst.push({
        id: entry.id,
        projectId: entry.projectId,
        artifactKind: 'REQUIREMENTS_DOC',
        targetId: entry.targetId,
        sequence: entry.sequence,
        createdAt: entry.createdAt,
        source: entry.source,
        title,
        changeSummary,
        requirementsDiff: diff,
      });
      continue;
    }

    // ONTOLOGY_SUITE envelope ready for #70 typed suite diff integration
    const changeSummary: ChangeSummaryView = {
      entryId: entry.id,
      artifactKind: 'ONTOLOGY_SUITE',
      targetId: entry.targetId,
      ...(reason ? { reason } : {}),
      items: [
        {
          id: `${entry.id}-suite`,
          changeType: 'MODIFIED',
          label: {
            zh: `更新了${BUSINESS_VOCABULARY.ONTOLOGY_SUITE.zh}`,
            en: `Updated ${BUSINESS_VOCABULARY.ONTOLOGY_SUITE.en}`,
          },
        },
      ],
      canUndo,
      ...(isUndone ? { isUndone: true } : {}),
    };

    viewsNewestFirst.push({
      id: entry.id,
      projectId: entry.projectId,
      artifactKind: 'ONTOLOGY_SUITE',
      targetId: entry.targetId,
      sequence: entry.sequence,
      createdAt: entry.createdAt,
      source: entry.source,
      title,
      changeSummary,
    });
  }

  return viewsNewestFirst;
}
