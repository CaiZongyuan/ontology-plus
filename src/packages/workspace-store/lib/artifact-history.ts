import {
  BUSINESS_VOCABULARY,
  MODEL_BUSINESS_NAMES,
  checkBusinessViewMarkup,
  getModelBusinessName,
  sanitizeBusinessText,
  type BilingualText,
  type BusinessLocale,
} from '../../business-vocabulary/index.js';
import {
  computeMuDiff,
  diffOntologySuites,
  extractMuFromPrototypeHtml,
  type AggregateRoot,
  type ModelCode,
  type MuElementDiff,
  type MuEventDiff,
  type OntologyElementDiff,
  type OntologySuite,
  type RelatedAggregateRef,
} from '../../ontology-core/index.js';
import { normalizeStepMarkdown } from './step-confirmations.js';
import type {
  ArtifactHistoryEntry,
  ArtifactHistoryEntryView,
  ArtifactHistorySource,
  ChangeSummaryItemView,
  ChangeSummaryView,
  InteractivePrototype,
  PersistedArtifactHistoryKind,
  PrototypeRevision,
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
  if (/^>?\s*(?:来源会话|Source\s+Session)\s*[:：]/i.test(out.trim())) {
    return '';
  }
  out = out.replace(/[（(]\s*(?:对应|映射|关联|对齐)[^)）]*(?:M[1-7]|ME|MU|MM|MI)[^)）]*[)）]/g, '');
  out = out.replace(
    /[`'"]?\s*\/\s*[`'"]?(?:AGG|ENT|VO|DIC|DICT|ASSOC|BHV|BEH|RUL|RULE|EVT|SCN|ACT|ROL|ROLE|PERM|PGRP|FLW|FLOW|ACTV|QRY|RPT|SCR|EL|UIE|NAV|CC|MAP|INT|IF|MET|ASCN|WB)-[A-Z0-9-]+[`'"]?/g,
    '',
  );
  out = out.replace(ELEMENT_ID_RE, '');
  out = out.replace(MODEL_STAGE_CODE_RE, '');
  out = out.replace(/\b(?:asess|req-sess)-[a-z0-9-]+\b/gi, '');
  out = out.replace(
    /createdAt\/updatedAt\s*审计字段(?:与幂等乐观锁版本号|、乐观锁版本号)?/gi,
    locale === 'en-US' ? 'creation and update timestamps' : '创建与修改时间记录',
  );
  out = out.replace(
    /createdAt\/updatedAt\s*audit\s*(?:fields|timestamps)(?:\s*(?:and|,)\s*optimistic\s*lock(?:ing)?\s*version)?/gi,
    locale === 'en-US' ? 'creation and update timestamps' : '创建与修改时间记录',
  );
  out = out.replace(
    /11\s*元模型(?:业务本体|标准)?/g,
    locale === 'en-US' ? BUSINESS_VOCABULARY.ONTOLOGY_SUITE.en : BUSINESS_VOCABULARY.ONTOLOGY_SUITE.zh,
  );
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
    .replace(
      /[（(]\s*[·\-:]?\s*(?:HUMAN|SYSTEM|COMMAND|QUERY|EVENT_HANDLER|EXTERNAL_CALL|COLLABORATION|APPROVAL|PROVIDED|DEPENDENT|MASTER|DETAIL|EXT|PrimaryEntity(?:\.[A-Za-z]+)?)\s*[)）]/g,
      '',
    )
    .replace(/[:：]\s*(?:→\s*)+[。.]?/g, locale === 'en-US' ? '.' : '。')
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
  return !diffOntologySuites(before, after).hasChanges;
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

function buildEntryTitle(source: ArtifactHistorySource, isRedo = false): BilingualText {
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
      return isRedo
        ? {
            zh: '重做上一次改动',
            en: 'Redid latest change',
          }
        : {
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

const CJK_RE = /[\u4e00-\u9fff]/;

const LOWERCASE_TITLE_WORDS = new Set([
  'a',
  'an',
  'the',
  'for',
  'of',
  'to',
  'in',
  'on',
  'by',
  'with',
  'and',
  'or',
  'from',
  'as',
  'at',
]);

function humanizeCodeIdentifier(raw: string): string {
  const spaced = raw
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!spaced) return '';
  const words = spaced.split(' ');
  return words
    .map((word, idx) => {
      if (/^[A-Z0-9]{2,}$/.test(word)) return word;
      const lower = word.toLowerCase();
      if (idx > 0 && idx < words.length - 1 && LOWERCASE_TITLE_WORDS.has(lower)) {
        return lower;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function buildSuiteElementDisplayMap(
  beforeSuite: OntologySuite | undefined,
  afterSuite: OntologySuite | undefined,
  locale: BusinessLocale,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  const reg = (id: string | undefined, label: string | undefined) => {
    const k = id?.trim();
    const v = label?.trim();
    if (!k || !v) return;
    if (checkBusinessViewMarkup(v, { plainText: true }).length === 0) {
      map.set(k, v);
    }
  };

  for (const suite of [beforeSuite, afterSuite]) {
    if (!suite) continue;
    for (const agg of suite.M1?.aggregates ?? []) {
      reg(agg.id, locale === 'en-US' && !CJK_RE.test(agg.name) ? humanizeCodeIdentifier(agg.name) : agg.alias || agg.name);
    }
    for (const dict of suite.M1?.data_dictionaries ?? []) reg(dict.id, dict.name);
    for (const beh of suite.M2?.behaviors ?? []) reg(beh.id, beh.alias || beh.name);
    for (const rule of suite.M3?.rules ?? []) reg(rule.id, rule.alias || rule.name);
    for (const ev of suite.ME?.events ?? []) reg(ev.id, ev.label || ev.name);
    for (const sc of suite.M4?.event_scenarios ?? []) reg(sc.id, sc.name);
    for (const actor of suite.M5?.actors ?? []) reg(actor.id, actor.name);
    for (const role of suite.M5?.roles ?? []) reg(role.id, role.name);
    for (const pg of suite.M5?.permissionGroups ?? []) reg(pg.id, pg.name);
    for (const perm of suite.M5?.permissions ?? []) reg(perm.id, perm.name);
    for (const flow of suite.M6?.flows ?? []) reg(flow.id, flow.name);
    for (const qr of suite.M7?.query_reports ?? []) reg(qr.id, qr.alias || qr.name);
    for (const scr of suite.MU?.screens ?? []) reg(scr.screenId, scr.name);
    for (const cc of suite.MU?.cross_cutting_ui ?? []) reg(cc.id, cc.name);
    for (const intf of suite.MI?.interfaces ?? []) reg(intf.interfaceId, intf.name);
  }
  return map;
}

function ensureCleanBusinessCopy(
  raw: string,
  locale: BusinessLocale,
  displayMap: ReadonlyMap<string, string>,
  fallback: string,
): string {
  const sanitized = sanitizeBusinessText(raw, locale, { elementDisplayMap: displayMap }).trim();
  if (sanitized && checkBusinessViewMarkup(sanitized, { plainText: true }).length === 0) {
    return sanitized;
  }
  const copied = sanitizeBusinessViewCopy(sanitized || raw, locale);
  if (copied && checkBusinessViewMarkup(copied, { plainText: true }).length === 0) {
    return copied;
  }
  return fallback;
}

function toBilingualElementName(
  rawDisplayName: string | undefined,
  rawName: string | undefined,
  fallback: BilingualText,
  displayMapZh: ReadonlyMap<string, string>,
  displayMapEn: ReadonlyMap<string, string>,
): BilingualText {
  const disp = (rawDisplayName ?? '').trim();
  const tech = (rawName ?? '').trim();

  const candidateZh = disp || tech;
  const cleanZh = ensureCleanBusinessCopy(candidateZh, 'zh-CN', displayMapZh, '');
  const zh =
    cleanZh && cleanZh !== '关联项'
      ? cleanZh
      : fallback.zh;

  let candidateEn = '';
  if (disp && !CJK_RE.test(disp) && checkBusinessViewMarkup(disp, { plainText: true }).length === 0) {
    candidateEn = disp;
  } else if (
    tech &&
    !CJK_RE.test(tech) &&
    checkBusinessViewMarkup(tech, { plainText: true }).length === 0
  ) {
    candidateEn = humanizeCodeIdentifier(tech);
  } else {
    candidateEn = disp || tech;
  }
  const cleanEn = ensureCleanBusinessCopy(candidateEn, 'en-US', displayMapEn, '');
  const en =
    cleanEn && cleanEn !== 'related item'
      ? cleanEn
      : fallback.en;

  return { zh, en };
}

function formatObjectListZh(objects: readonly BilingualText[]): string {
  if (objects.length === 0) return '';
  if (objects.length === 1) return `『${objects[0]!.zh}』`;
  if (objects.length === 2) return `『${objects[0]!.zh}』与『${objects[1]!.zh}』`;
  const head = objects
    .slice(0, -1)
    .map((o) => `『${o.zh}』`)
    .join('、');
  return `${head}与『${objects[objects.length - 1]!.zh}』`;
}

function formatObjectListEn(objects: readonly BilingualText[]): string {
  if (objects.length === 0) return '';
  if (objects.length === 1) return `'${objects[0]!.en}'`;
  if (objects.length === 2) return `'${objects[0]!.en}' and '${objects[1]!.en}'`;
  const head = objects
    .slice(0, -1)
    .map((o) => `'${o.en}'`)
    .join(', ');
  return `${head}, and '${objects[objects.length - 1]!.en}'`;
}

function resolveElementKindSingularTerm(diff: OntologyElementDiff): BilingualText {
  switch (diff.elementKind) {
    case 'data_dictionary':
      return { zh: '业务选项字典', en: 'Option Dictionary' };
    case 'aggregate_association':
      return { zh: '对象关联', en: 'Object Relationship' };
    case 'actor':
      return { zh: '参与方', en: 'Participant' };
    case 'role':
      return { zh: '角色', en: 'Role' };
    case 'permission_group':
      return { zh: '权限组', en: 'Permission Group' };
    case 'permission':
      return { zh: '权限', en: 'Permission' };
    case 'navigation_edge':
      return { zh: '界面跳转', en: 'Screen Navigation' };
    case 'cross_cutting_ui':
      return { zh: '全局界面元素', en: 'Shared Screen Element' };
    default:
      return {
        zh: getModelBusinessName(diff.modelCode, 'zh-CN', { singular: true }),
        en: getModelBusinessName(diff.modelCode, 'en-US', { singular: true }),
      };
  }
}

function resolveFallbackRelatedAggregates(
  diff: OntologyElementDiff,
  beforeSuite: OntologySuite | undefined,
  afterSuite: OntologySuite | undefined,
  aggregatesByIdOrName: ReadonlyMap<string, RelatedAggregateRef>,
): RelatedAggregateRef[] {
  if (diff.relatedAggregates.length > 0) return diff.relatedAggregates;

  if (diff.elementKind === 'data_dictionary') {
    for (const suite of [afterSuite, beforeSuite]) {
      for (const agg of suite?.M1?.aggregates ?? []) {
        if ((agg.attributes ?? []).some((a) => a.dictionaryRef?.dictionaryId === diff.elementId)) {
          const ref = aggregatesByIdOrName.get(agg.id);
          if (ref) return [ref];
        }
      }
    }
  }

  if (diff.elementKind === 'navigation_edge' || diff.elementKind === 'cross_cutting_ui') {
    const screenIds = new Set<string>();
    for (const suite of [afterSuite, beforeSuite]) {
      if (diff.elementKind === 'navigation_edge') {
        const edge = (suite?.MU?.navigation_edges ?? []).find((e) => e.id === diff.elementId);
        if (edge?.fromScreen) screenIds.add(edge.fromScreen);
        if (edge?.toScreen) screenIds.add(edge.toScreen);
      } else {
        const cc = (suite?.MU?.cross_cutting_ui ?? []).find((c) => c.id === diff.elementId);
        for (const sId of cc?.scopeScreens ?? []) screenIds.add(sId);
      }
    }
    if (screenIds.size > 0) {
      for (const suite of [afterSuite, beforeSuite]) {
        for (const agg of suite?.M1?.aggregates ?? []) {
          if ((agg.uiBindings ?? []).some((b) => screenIds.has(b))) {
            const ref = aggregatesByIdOrName.get(agg.id);
            if (ref) return [ref];
          }
        }
      }
    }
  }

  return [];
}

function extractModifiedAggregateFieldLabels(
  diff: OntologyElementDiff,
  beforeAgg: AggregateRoot | undefined,
  afterAgg: AggregateRoot | undefined,
  displayMapZh: ReadonlyMap<string, string>,
  displayMapEn: ReadonlyMap<string, string>,
): BilingualText[] {
  const attrNames: string[] = [];
  const seen = new Set<string>();
  for (const fc of diff.changedFields) {
    const match = /^attributes\[([^\]]+)\]/.exec(fc.field);
    if (match?.[1] && !seen.has(match[1])) {
      seen.add(match[1]);
      attrNames.push(match[1]);
    }
  }
  const labels: BilingualText[] = [];
  for (const attrName of attrNames) {
    const attr =
      afterAgg?.attributes.find((a) => a.name === attrName) ??
      beforeAgg?.attributes.find((a) => a.name === attrName);
    labels.push(
      toBilingualElementName(
        attr?.label || attr?.name || attrName,
        attr?.name || attrName,
        { zh: '字段', en: 'Field' },
        displayMapZh,
        displayMapEn,
      ),
    );
  }
  return labels;
}

/**
 * Renders `diffOntologySuites(beforeSuite, afterSuite)` into Business-Object-grouped,
 * Business View-safe `ChangeSummaryItemView[]` with canvas jump targets (#70).
 */
export function buildOntologySuiteChangeSummaryItems(
  beforeSuite: OntologySuite | undefined,
  afterSuite: OntologySuite | undefined,
  entryId = 'suite',
): ChangeSummaryItemView[] {
  const suiteDiff = diffOntologySuites(beforeSuite, afterSuite);
  if (!suiteDiff.hasChanges) return [];

  const displayMapZh = buildSuiteElementDisplayMap(beforeSuite, afterSuite, 'zh-CN');
  const displayMapEn = buildSuiteElementDisplayMap(beforeSuite, afterSuite, 'en-US');

  const aggregatesByIdOrName = new Map<string, RelatedAggregateRef>();
  const aggregateByIdBefore = new Map<string, AggregateRoot>();
  const aggregateByIdAfter = new Map<string, AggregateRoot>();
  const aggregateOrder = new Map<string, number>();
  let orderIdx = 0;

  for (const agg of afterSuite?.M1?.aggregates ?? []) {
    aggregateByIdAfter.set(agg.id, agg);
    const ref: RelatedAggregateRef = {
      aggregateId: agg.id,
      name: agg.name,
      displayName: agg.alias || agg.name,
    };
    aggregatesByIdOrName.set(agg.id, ref);
    aggregatesByIdOrName.set(agg.name, ref);
    aggregateOrder.set(agg.id, orderIdx++);
  }
  for (const agg of beforeSuite?.M1?.aggregates ?? []) {
    aggregateByIdBefore.set(agg.id, agg);
    if (!aggregatesByIdOrName.has(agg.id)) {
      const ref: RelatedAggregateRef = {
        aggregateId: agg.id,
        name: agg.name,
        displayName: agg.alias || agg.name,
      };
      aggregatesByIdOrName.set(agg.id, ref);
      aggregatesByIdOrName.set(agg.name, ref);
      aggregateOrder.set(agg.id, orderIdx++);
    }
  }

  const firstActiveAggId = afterSuite?.M1?.aggregates[0]?.id;

  interface RankedItem {
    groupOrder: number;
    seq: number;
    item: ChangeSummaryItemView;
  }
  const ranked: RankedItem[] = [];

  const formatStandaloneChangeLabel = (
    status: OntologyElementDiff['status'],
    kindTerm: BilingualText,
    elName: BilingualText,
  ): BilingualText => {
    if (status === 'ADDED') {
      return {
        zh: `新增${kindTerm.zh}『${elName.zh}』`,
        en: `Added ${kindTerm.en} '${elName.en}'`,
      };
    }
    if (status === 'REMOVED') {
      return {
        zh: `移除${kindTerm.zh}『${elName.zh}』`,
        en: `Removed ${kindTerm.en} '${elName.en}'`,
      };
    }
    return {
      zh: `更新${kindTerm.zh}『${elName.zh}』`,
      en: `Updated ${kindTerm.en} '${elName.en}'`,
    };
  };

  suiteDiff.changes.forEach((diff, idx) => {
    const pushRankedItem = (
      groupOrder: number,
      groupLabel: BilingualText,
      pageId: string,
      labelRaw: BilingualText,
    ) => {
      ranked.push({
        groupOrder,
        seq: idx,
        item: {
          id: `${entryId}-${diff.modelCode}-${diff.elementId}-${idx}`,
          changeType: diff.status,
          groupLabel,
          label: {
            zh: ensureCleanBusinessCopy(labelRaw.zh, 'zh-CN', displayMapZh, groupLabel.zh),
            en: ensureCleanBusinessCopy(labelRaw.en, 'en-US', displayMapEn, groupLabel.en),
          },
          jumpTarget: {
            kind: 'BUSINESS_OBJECT',
            objectId: pageId,
            pageId,
            anchorId: diff.elementId,
            modelCode: diff.modelCode,
            elementId: diff.elementId,
          },
        },
      });
    };

    const kindTerm = resolveElementKindSingularTerm(diff);
    const elName = toBilingualElementName(
      diff.displayName,
      diff.name,
      kindTerm,
      displayMapZh,
      displayMapEn,
    );

    const resolveAggName = (ref: RelatedAggregateRef): BilingualText => {
      const canonical = aggregatesByIdOrName.get(ref.aggregateId) ?? ref;
      return toBilingualElementName(
        canonical.displayName,
        canonical.name,
        {
          zh: MODEL_BUSINESS_NAMES.M1.singularZh,
          en: MODEL_BUSINESS_NAMES.M1.singularEn,
        },
        displayMapZh,
        displayMapEn,
      );
    };

    // 1. Cross-object models (M6 Flows, M5 Roles & Permissions, M7 Queries & Reports)
    if (diff.modelCode === 'M6' || diff.modelCode === 'M5' || diff.modelCode === 'M7') {
      const crossPageId =
        diff.modelCode === 'M6'
          ? 'view:flows'
          : diff.modelCode === 'M5'
            ? 'view:roles'
            : 'view:reports';
      const groupOrder =
        diff.modelCode === 'M6' ? 1000 : diff.modelCode === 'M5' ? 1001 : 1002;
      const groupLabel: BilingualText = {
        zh: MODEL_BUSINESS_NAMES[diff.modelCode].zh,
        en: MODEL_BUSINESS_NAMES[diff.modelCode].en,
      };
      const labelRaw: BilingualText =
        diff.elementKind === 'model_metadata'
          ? { zh: `更新${groupLabel.zh}`, en: `Updated ${groupLabel.en}` }
          : formatStandaloneChangeLabel(diff.status, kindTerm, elName);

      pushRankedItem(groupOrder, groupLabel, crossPageId, labelRaw);
      return;
    }

    // 2. Object-scoped models (M1, M2, M3, ME, M4, MU, MM, MI)
    const aggRefs = resolveFallbackRelatedAggregates(
      diff,
      beforeSuite,
      afterSuite,
      aggregatesByIdOrName,
    );
    const aggNames = aggRefs.map(resolveAggName);

    if (aggRefs.length > 0) {
      const primaryAgg = aggRefs[0]!;
      const primaryObjName = aggNames[0]!;
      const groupOrder = aggregateOrder.get(primaryAgg.aggregateId) ?? 500;
      const targetPageId = aggregateByIdAfter.has(primaryAgg.aggregateId)
        ? primaryAgg.aggregateId
        : (firstActiveAggId ?? 'view:flows');

      let labelRaw: BilingualText;

      if (diff.elementKind === 'aggregate') {
        if (diff.status !== 'MODIFIED') {
          labelRaw = formatStandaloneChangeLabel(diff.status, kindTerm, elName);
        } else {
          const hasFieldChange = diff.changedFields.some(
            (f) =>
              f.field === 'attributes' ||
              f.field.startsWith('attributes[') ||
              f.field.startsWith('attributes.') ||
              f.field === 'entities' ||
              f.field.startsWith('entities[') ||
              f.field === 'valueObjects' ||
              f.field.startsWith('valueObjects['),
          );
          const hasInvariantChange = diff.changedFields.some(
            (f) => f.field === 'invariants' || f.field.startsWith('invariants['),
          );
          if (hasFieldChange) {
            const fieldLabels = extractModifiedAggregateFieldLabels(
              diff,
              aggregateByIdBefore.get(diff.elementId),
              aggregateByIdAfter.get(diff.elementId),
              displayMapZh,
              displayMapEn,
            );
            if (fieldLabels.length > 0) {
              const shownZh = fieldLabels
                .slice(0, 2)
                .map((f) => `『${f.zh}』`)
                .join('、');
              const shownEn = fieldLabels
                .slice(0, 2)
                .map((f) => `'${f.en}'`)
                .join(', ');
              const moreZh = fieldLabels.length > 2 ? `等 ${fieldLabels.length} 项` : '';
              const moreEn = fieldLabels.length > 2 ? ` (+${fieldLabels.length - 2} more)` : '';
              labelRaw = {
                zh: `修改业务对象『${elName.zh}』的字段${shownZh}${moreZh}`,
                en: `Updated fields of Business Object '${elName.en}' (${shownEn}${moreEn})`,
              };
            } else {
              labelRaw = {
                zh: `修改业务对象『${elName.zh}』的字段`,
                en: `Updated fields of Business Object '${elName.en}'`,
              };
            }
          } else if (hasInvariantChange) {
            labelRaw = {
              zh: `修改业务对象『${elName.zh}』的业务规则`,
              en: `Updated rules on Business Object '${elName.en}'`,
            };
          } else if (diff.previousDisplayName && diff.previousDisplayName !== diff.displayName) {
            const prevName = toBilingualElementName(
              diff.previousDisplayName,
              diff.previousName ?? diff.name,
              kindTerm,
              displayMapZh,
              displayMapEn,
            );
            labelRaw = {
              zh: `将业务对象『${prevName.zh}』重命名为『${elName.zh}』`,
              en: `Renamed Business Object '${prevName.en}' to '${elName.en}'`,
            };
          } else {
            labelRaw = {
              zh: `修改业务对象『${elName.zh}』的说明与属性`,
              en: `Updated Business Object '${elName.en}'`,
            };
          }
        }
      } else if (diff.elementKind === 'aggregate_association') {
        const objsZh = formatObjectListZh(aggNames);
        const objsEn = formatObjectListEn(aggNames);
        labelRaw =
          diff.status === 'ADDED'
            ? { zh: `新增${objsZh}的对象关联`, en: `Added relationship between ${objsEn}` }
            : diff.status === 'REMOVED'
              ? { zh: `移除${objsZh}的对象关联`, en: `Removed relationship between ${objsEn}` }
              : { zh: `更新${objsZh}的对象关联`, en: `Updated relationship between ${objsEn}` };
      } else if (diff.elementKind === 'mapping') {
        labelRaw =
          diff.status === 'ADDED'
            ? {
                zh: `在『${primaryObjName.zh}』上新增数据存储配置`,
                en: `Added Data Storage on '${primaryObjName.en}'`,
              }
            : diff.status === 'REMOVED'
              ? {
                  zh: `从『${primaryObjName.zh}』移除数据存储配置`,
                  en: `Removed Data Storage from '${primaryObjName.en}'`,
                }
              : {
                  zh: `更新『${primaryObjName.zh}』的数据存储配置`,
                  en: `Updated Data Storage on '${primaryObjName.en}'`,
                };
      } else {
        const objsZh = formatObjectListZh(aggNames);
        const objsEn = formatObjectListEn(aggNames);
        labelRaw =
          diff.status === 'ADDED'
            ? {
                zh: `在${objsZh}上新增${kindTerm.zh}『${elName.zh}』`,
                en: `Added ${kindTerm.en} '${elName.en}' on ${objsEn}`,
              }
            : diff.status === 'REMOVED'
              ? {
                  zh: `从${objsZh}移除${kindTerm.zh}『${elName.zh}』`,
                  en: `Removed ${kindTerm.en} '${elName.en}' from ${objsEn}`,
                }
              : {
                  zh: `在${objsZh}上更新${kindTerm.zh}『${elName.zh}』`,
                  en: `Updated ${kindTerm.en} '${elName.en}' on ${objsEn}`,
                };
      }

      pushRankedItem(groupOrder, primaryObjName, targetPageId, labelRaw);
      return;
    }

    // 3. Global / unbound element fallback ("其他" / "Other")
    const otherGroup: BilingualText = { zh: '其他', en: 'Other' };
    const fallbackPageId =
      (afterSuite && Object.keys(afterSuite).length > 0 ? 'view:other' : firstActiveAggId) ??
      'view:flows';
    const labelRaw: BilingualText =
      diff.elementKind === 'model_metadata'
        ? {
            zh: `更新${getModelBusinessName(diff.modelCode, 'zh-CN')}`,
            en: `Updated ${getModelBusinessName(diff.modelCode, 'en-US')}`,
          }
        : formatStandaloneChangeLabel(diff.status, kindTerm, elName);

    pushRankedItem(1003, otherGroup, fallbackPageId, labelRaw);
  });

  ranked.sort((a, b) => a.groupOrder - b.groupOrder || a.seq - b.seq);
  return ranked.map((r) => r.item);
}

function resolvePrototypeControlTerm(
  elementType: MuElementDiff['elementType'] | undefined,
): BilingualText {
  switch ((elementType ?? '').toUpperCase()) {
    case 'BUTTON':
      return { zh: '按钮', en: 'button' };
    case 'INPUT':
    case 'TEXTAREA':
      return { zh: '输入项', en: 'field' };
    case 'SELECT':
      return { zh: '下拉选项', en: 'selector' };
    case 'TABLE':
      return { zh: '表格', en: 'table' };
    case 'FORM':
      return { zh: '表单区', en: 'form' };
    case 'CARD':
      return { zh: '卡片区', en: 'card' };
    default:
      return { zh: '界面元素', en: 'control' };
  }
}

const EMPTY_DISPLAY_MAP: ReadonlyMap<string, string> = new Map();

function cleanPrototypeBusinessName(
  raw: string | undefined,
  fallback: BilingualText,
): BilingualText {
  return toBilingualElementName(raw, raw, fallback, EMPTY_DISPLAY_MAP, EMPTY_DISPLAY_MAP);
}

const AUTO_REVISION_TITLE_RE =
  /^(?:生成首版原型|AI\s*精修修订|导入\s*HTML\s*原型|恢复历史修订|另存为新原型基线|初始修订|手动保存修订|恢复自修订|撤销上一次改动|重做上一次改动)/i;

function isGenericAutoRevisionTitle(title: string | undefined): boolean {
  const trimmed = (title ?? '').trim();
  if (!trimmed) return true;
  return AUTO_REVISION_TITLE_RE.test(trimmed);
}

export interface BuildPrototypeChangeSummaryOptions {
  previousHtml?: string;
  nextHtml: string;
  prototypeId: string;
  revisionId: string;
  previousRevisionId?: string;
  domain?: string;
  isRestoreOrUndo?: boolean;
}

/**
 * Renders consecutive prototype HTML states (`previousHtml` -> `nextHtml`) into screen-grouped,
 * Business View-safe `ChangeSummaryItemView[]` via `extractMuFromPrototypeHtml` + `computeMuDiff`,
 * falling back cleanly for visual-only CSS/layout edits and anchor-free initial prototypes (#67).
 */
export function buildPrototypeChangeSummaryItems(
  options: BuildPrototypeChangeSummaryOptions,
): ChangeSummaryItemView[] {
  const domain = options.domain?.trim() || 'OntologyDomain';
  const prevMu =
    options.previousHtml !== undefined
      ? extractMuFromPrototypeHtml(options.previousHtml, domain)
      : undefined;
  const nextMu = extractMuFromPrototypeHtml(options.nextHtml, domain);
  const diff = computeMuDiff(prevMu, nextMu);

  const makeAnchorTarget = (screenId?: string, elementId?: string) => ({
    kind: 'PROTOTYPE_ANCHOR' as const,
    prototypeId: options.prototypeId,
    revisionId: options.revisionId,
    ...(options.previousRevisionId ? { previousRevisionId: options.previousRevisionId } : {}),
    ...(screenId ? { screenId } : {}),
    ...(elementId ? { elementId } : {}),
  });

  if (!diff.summary.hasChanges) {
    if (options.previousHtml === undefined) {
      const count = nextMu.screens.length;
      return [
        {
          id: `${options.revisionId}-proto-init`,
          changeType: 'ADDED',
          label:
            count > 0
              ? {
                  zh: `生成了包含 ${count} 个界面的初始原型`,
                  en: `Generated initial prototype with ${count} ${count === 1 ? 'screen' : 'screens'}`,
                }
              : {
                  zh: '生成了初始界面原型',
                  en: 'Generated initial prototype',
                },
          jumpTarget: makeAnchorTarget(nextMu.screens[0]?.screenId),
        },
      ];
    }

    if (options.previousHtml !== options.nextHtml) {
      const count = nextMu.screens.length;
      return [
        {
          id: `${options.revisionId}-proto-visual`,
          changeType: 'MODIFIED',
          label: {
            zh: '更新了界面视觉样式与布局',
            en: 'Updated visual styling and layout',
          },
          ...(count > 0
            ? {
                detail: {
                  zh: `保留现有 ${count} 个界面的字段与操作结构不变`,
                  en: `Preserved fields and actions across ${count} ${count === 1 ? 'screen' : 'screens'}`,
                },
              }
            : {}),
          jumpTarget: makeAnchorTarget(nextMu.screens[0]?.screenId),
        },
      ];
    }

    if (options.isRestoreOrUndo) {
      return [
        {
          id: `${options.revisionId}-proto-restored`,
          changeType: 'MODIFIED',
          label: {
            zh: '恢复了先前的界面原型版本',
            en: 'Restored earlier prototype version',
          },
          jumpTarget: makeAnchorTarget(nextMu.screens[0]?.screenId),
        },
      ];
    }

    return [];
  }

  const items: ChangeSummaryItemView[] = [];
  let seq = 0;
  const pushItem = (
    changeType: ChangeSummaryItemView['changeType'],
    groupLabel: BilingualText,
    labelRaw: BilingualText,
    detailRaw?: BilingualText,
    screenId?: string,
    elementId?: string,
  ) => {
    seq += 1;
    items.push({
      id: `${options.revisionId}-proto-${seq}`,
      changeType,
      groupLabel: {
        zh: ensureCleanBusinessCopy(groupLabel.zh, 'zh-CN', EMPTY_DISPLAY_MAP, '界面'),
        en: ensureCleanBusinessCopy(groupLabel.en, 'en-US', EMPTY_DISPLAY_MAP, 'Screen'),
      },
      label: {
        zh: ensureCleanBusinessCopy(labelRaw.zh, 'zh-CN', EMPTY_DISPLAY_MAP, groupLabel.zh),
        en: ensureCleanBusinessCopy(labelRaw.en, 'en-US', EMPTY_DISPLAY_MAP, groupLabel.en),
      },
      ...(detailRaw
        ? {
            detail: {
              zh: ensureCleanBusinessCopy(detailRaw.zh, 'zh-CN', EMPTY_DISPLAY_MAP, ''),
              en: ensureCleanBusinessCopy(detailRaw.en, 'en-US', EMPTY_DISPLAY_MAP, ''),
            },
          }
        : {}),
      jumpTarget: makeAnchorTarget(screenId, elementId),
    });
  };

  for (const sc of diff.screens) {
    if (sc.status === 'UNCHANGED') continue;
    const screenName = cleanPrototypeBusinessName(sc.name, {
      zh: MODEL_BUSINESS_NAMES.MU.singularZh,
      en: MODEL_BUSINESS_NAMES.MU.singularEn,
    });

    if (sc.status === 'ADDED') {
      let detailRaw: BilingualText | undefined;
      if (sc.elements.length > 0) {
        const cleanEls = sc.elements.map((el) =>
          cleanPrototypeBusinessName(el.label, resolvePrototypeControlTerm(el.elementType)),
        );
        const shownZh = cleanEls
          .slice(0, 2)
          .map((e) => `『${e.zh}』`)
          .join('、');
        const shownEn = cleanEls
          .slice(0, 2)
          .map((e) => `'${e.en}'`)
          .join(', ');
        const moreZh = cleanEls.length > 2 ? `等 ${cleanEls.length} 项` : '';
        const moreEn = cleanEls.length > 2 ? ` (${cleanEls.length} controls)` : '';
        detailRaw = {
          zh: `包含${shownZh}${moreZh}`,
          en: `Includes ${shownEn}${moreEn}`,
        };
      }
      pushItem(
        'ADDED',
        screenName,
        {
          zh: `新增界面『${screenName.zh}』`,
          en: `Added screen '${screenName.en}'`,
        },
        detailRaw,
        sc.screenId,
      );
      continue;
    }

    if (sc.status === 'REMOVED') {
      pushItem(
        'REMOVED',
        screenName,
        {
          zh: `移除界面『${screenName.zh}』`,
          en: `Removed screen '${screenName.en}'`,
        },
        undefined,
        sc.screenId,
      );
      continue;
    }

    const changedElements = sc.elements.filter(
      (el): el is MuElementDiff & { status: 'ADDED' | 'MODIFIED' | 'REMOVED' } =>
        el.status !== 'UNCHANGED',
    );
    const changedEvents = sc.events.filter(
      (ev): ev is MuEventDiff & { status: 'ADDED' | 'MODIFIED' | 'REMOVED' } =>
        ev.status !== 'UNCHANGED',
    );
    const coveredTriggerElements = new Set<string>();

    for (const el of changedElements) {
      coveredTriggerElements.add(el.elementId);
      const kind = resolvePrototypeControlTerm(el.elementType);
      const elName = cleanPrototypeBusinessName(el.label, kind);
      const labelRaw: BilingualText =
        el.status === 'ADDED'
          ? {
              zh: `在『${screenName.zh}』上新增${kind.zh}『${elName.zh}』`,
              en: `Added ${kind.en} '${elName.en}' on '${screenName.en}'`,
            }
          : el.status === 'REMOVED'
            ? {
                zh: `从『${screenName.zh}』移除${kind.zh}『${elName.zh}』`,
                en: `Removed ${kind.en} '${elName.en}' from '${screenName.en}'`,
              }
            : {
                zh: `在『${screenName.zh}』上调整${kind.zh}『${elName.zh}』`,
                en: `Updated ${kind.en} '${elName.en}' on '${screenName.en}'`,
              };
      pushItem(
        el.status,
        screenName,
        labelRaw,
        undefined,
        sc.screenId,
        el.status !== 'REMOVED' ? el.elementId : undefined,
      );
    }

    for (const ev of changedEvents) {
      if (
        (ev.status === 'ADDED' || ev.status === 'REMOVED') &&
        ev.triggerElementId &&
        coveredTriggerElements.has(ev.triggerElementId)
      ) {
        continue;
      }
      const evName = cleanPrototypeBusinessName(ev.name, {
        zh: '交互操作',
        en: 'interaction',
      });
      const labelRaw: BilingualText =
        ev.status === 'ADDED'
          ? {
              zh: `在『${screenName.zh}』上新增交互动作『${evName.zh}』`,
              en: `Added interaction '${evName.en}' on '${screenName.en}'`,
            }
          : ev.status === 'REMOVED'
            ? {
                zh: `从『${screenName.zh}』移除交互动作『${evName.zh}』`,
                en: `Removed interaction '${evName.en}' from '${screenName.en}'`,
              }
            : {
                zh: `在『${screenName.zh}』上更新交互动作『${evName.zh}』`,
                en: `Updated interaction '${evName.en}' on '${screenName.en}'`,
              };
      pushItem(
        ev.status,
        screenName,
        labelRaw,
        undefined,
        sc.screenId,
        ev.status !== 'REMOVED' && ev.triggerElementId ? ev.triggerElementId : undefined,
      );
    }

    if (changedElements.length === 0 && changedEvents.length === 0) {
      if (sc.previousName && sc.previousName !== sc.name) {
        const prevScreenName = cleanPrototypeBusinessName(sc.previousName, {
          zh: MODEL_BUSINESS_NAMES.MU.singularZh,
          en: MODEL_BUSINESS_NAMES.MU.singularEn,
        });
        pushItem(
          'MODIFIED',
          screenName,
          {
            zh: `将界面『${prevScreenName.zh}』重命名为『${screenName.zh}』`,
            en: `Renamed screen '${prevScreenName.en}' to '${screenName.en}'`,
          },
          undefined,
          sc.screenId,
        );
      } else {
        pushItem(
          'MODIFIED',
          screenName,
          {
            zh: `更新界面『${screenName.zh}』的页面设置`,
            en: `Updated settings of screen '${screenName.en}'`,
          },
          undefined,
          sc.screenId,
        );
      }
    }
  }

  return items;
}

export function isPreExistingPrototypeBaselineRevision(rev: PrototypeRevision): boolean {
  return (
    rev.revisionNumber === 1 &&
    !rev.agentRunId &&
    (rev.source === 'GENERATED' || rev.source === 'MIGRATED' || rev.source === 'CLONED')
  );
}

/**
 * Projects a prototype's linear `PrototypeRevision[]` onto `ArtifactHistoryEntryView[]`
 * without duplicating HTML in storage (#67).
 */
export function buildPrototypeArtifactHistoryViews(
  prototype: Pick<
    InteractivePrototype,
    'id' | 'projectId' | 'name' | 'revisions' | 'coDesignSessionId'
  >,
  options?: {
    domain?: string;
    maxEntries?: number;
  },
): ArtifactHistoryEntryView[] {
  if (prototype.revisions.length === 0) return [];
  const ordered = [...prototype.revisions].sort((a, b) => a.revisionNumber - b.revisionNumber);
  const byId = new Map<string, PrototypeRevision>();
  const undoDepthById = new Map<string, number>();
  const activelyUndoneIds = new Set<string>();

  for (const rev of ordered) {
    byId.set(rev.id, rev);
    if (rev.undoneRevisionId) {
      const parentDepth = undoDepthById.get(rev.undoneRevisionId) ?? 0;
      const depth = parentDepth + 1;
      undoDepthById.set(rev.id, depth);
      activelyUndoneIds.add(rev.undoneRevisionId);
      const target = byId.get(rev.undoneRevisionId);
      if (target?.undoneRevisionId) {
        activelyUndoneIds.delete(target.undoneRevisionId);
      }
    } else {
      undoDepthById.set(rev.id, 0);
    }
  }

  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ARTIFACT_HISTORY_ENTRIES;
  const viewsNewestFirst: ArtifactHistoryEntryView[] = [];

  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    if (viewsNewestFirst.length >= maxEntries) break;
    const rev = ordered[i]!;
    if (i === 0 && isPreExistingPrototypeBaselineRevision(rev)) {
      continue;
    }

    const prevRev = i > 0 ? ordered[i - 1] : undefined;
    const hasPriorRevision = Boolean(prevRev);
    const isLatest = i === ordered.length - 1;
    const canUndo = isLatest && hasPriorRevision;
    const canRestoreBefore = hasPriorRevision;
    const isUndone = activelyUndoneIds.has(rev.id);
    const undoDepth = undoDepthById.get(rev.id) ?? 0;
    const isRedo = Boolean(rev.undoneRevisionId && undoDepth > 0 && undoDepth % 2 === 0);

    let source: ArtifactHistorySource;
    if (rev.undoneRevisionId) {
      source = { kind: 'UNDO', undoneEntryId: rev.undoneRevisionId };
    } else if (rev.source === 'RESTORED') {
      source = {
        kind: 'RESTORE',
        restoredFromEntryId:
          rev.restoredBeforeRevisionId ?? rev.restoredFromRevisionId ?? rev.id,
      };
    } else if (
      rev.agentRunId ||
      rev.source === 'AGENT_RUN' ||
      rev.source === 'REFINED' ||
      (rev.source === 'GENERATED' && Boolean(rev.agentRunId))
    ) {
      const rawReason =
        rev.agentReason?.trim() ||
        rev.instruction?.trim() ||
        (!isGenericAutoRevisionTitle(rev.title) ? rev.title.trim() : '');
      source = {
        kind: 'AGENT_RUN',
        runId: rev.agentRunId ?? rev.id,
        ...(prototype.coDesignSessionId ? { sessionId: prototype.coDesignSessionId } : {}),
        ...(rawReason ? { reason: rawReason } : {}),
      };
    } else {
      const rawNote =
        rev.instruction?.trim() ||
        (!isGenericAutoRevisionTitle(rev.title) ? rev.title.trim() : '');
      source = {
        kind: 'MANUAL',
        ...(rawNote ? { note: rawNote } : {}),
      };
    }

    const title = buildEntryTitle(source, isRedo);
    const reason = buildReasonFromSource(source);
    const items = buildPrototypeChangeSummaryItems({
      ...(prevRev ? { previousHtml: prevRev.htmlContent, previousRevisionId: prevRev.id } : {}),
      nextHtml: rev.htmlContent,
      prototypeId: prototype.id,
      revisionId: rev.id,
      ...(options?.domain ? { domain: options.domain } : {}),
      isRestoreOrUndo: source.kind === 'UNDO' || source.kind === 'RESTORE',
    });

    if (items.length === 0) {
      continue;
    }

    const changeSummary: ChangeSummaryView = {
      entryId: rev.id,
      artifactKind: 'PROTOTYPE',
      targetId: prototype.id,
      ...(reason ? { reason } : {}),
      items,
      canUndo,
      ...(isUndone ? { isUndone: true } : {}),
      ...(prevRev
        ? {
            compareRevisionPair: {
              prototypeId: prototype.id,
              leftRevisionId: prevRev.id,
              rightRevisionId: rev.id,
            },
          }
        : {}),
    };

    viewsNewestFirst.push({
      id: rev.id,
      projectId: prototype.projectId,
      artifactKind: 'PROTOTYPE',
      targetId: prototype.id,
      sequence: rev.revisionNumber,
      createdAt: rev.createdAt,
      source,
      title,
      changeSummary,
      canRestoreBefore,
    });
  }

  return viewsNewestFirst;
}

function buildReasonFromSource(source: ArtifactHistorySource): BilingualText | undefined {
  const raw =
    source.kind === 'AGENT_RUN'
      ? source.reason
      : source.kind === 'MANUAL'
        ? source.note
        : undefined;
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  if (/^【已确认设计简报|^===\s*CONFIRMED DESIGN BRIEF/i.test(trimmed)) {
    return {
      zh: '根据已确认的设计简报与需求文档生成首版可交互原型。',
      en: 'Generated the initial interactive prototype from the confirmed design brief and requirements.',
    };
  }
  if (/^\[PROTOTYPE_BRIEF_RESTYLE\]/i.test(trimmed)) {
    return {
      zh: '根据更新后的设计简报调整界面视觉风格，保留原有交互结构。',
      en: 'Updated the visual style from the revised design brief while preserving screen structure.',
    };
  }
  if (/^\[ACTION:[A-Z_]+/.test(trimmed)) {
    const afterBracket = trimmed.replace(/^\[ACTION:[^\r\n]*\]\s*/, '').trim();
    if (!afterBracket) return undefined;
    const zh = sanitizeBusinessViewCopy(afterBracket, 'zh-CN');
    const en = sanitizeBusinessViewCopy(afterBracket, 'en-US');
    if (!zh && !en) return undefined;
    return { zh: zh || en, en: en || zh };
  }
  const zh = sanitizeBusinessViewCopy(trimmed, 'zh-CN');
  const en = sanitizeBusinessViewCopy(trimmed, 'en-US');
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

  const undoDepthById = new Map<string, number>();

  for (const entry of chronologicalEntries) {
    byId.set(entry.id, entry);
    latestByKind.set(entry.artifactKind, entry.id);
    if (entry.source.kind === 'UNDO') {
      const parentDepth = undoDepthById.get(entry.source.undoneEntryId) ?? 0;
      const depth = parentDepth + 1;
      undoDepthById.set(entry.id, depth);
      activelyUndoneIds.add(entry.source.undoneEntryId);
      const target = byId.get(entry.source.undoneEntryId);
      if (target?.source.kind === 'UNDO') {
        activelyUndoneIds.delete(target.source.undoneEntryId);
      }
    } else {
      undoDepthById.set(entry.id, 0);
    }
  }

  const viewsNewestFirst: ArtifactHistoryEntryView[] = [];
  for (let i = chronologicalEntries.length - 1; i >= 0; i -= 1) {
    const entry = chronologicalEntries[i]!;
    const canUndo = latestByKind.get(entry.artifactKind) === entry.id;
    const isUndone = activelyUndoneIds.has(entry.id);
    const undoDepth = undoDepthById.get(entry.id) ?? 0;
    const isRedo = entry.source.kind === 'UNDO' && undoDepth > 0 && undoDepth % 2 === 0;
    const reason = buildReasonFromSource(entry.source);
    const title = buildEntryTitle(entry.source, isRedo);

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

    const suiteItems = buildOntologySuiteChangeSummaryItems(
      entry.beforeState,
      entry.afterState,
      entry.id,
    );
    const changeSummary: ChangeSummaryView = {
      entryId: entry.id,
      artifactKind: 'ONTOLOGY_SUITE',
      targetId: entry.targetId,
      ...(reason ? { reason } : {}),
      items: suiteItems,
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
