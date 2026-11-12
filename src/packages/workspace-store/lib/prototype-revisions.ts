import type {
  AppendPrototypeRevisionInput,
  ConfirmedPrototypeRevision,
  ConfirmedPrototypeRevisionRecord,
  CreatePrototypeInput,
  DesignBrief,
  InteractivePrototype,
  PrototypeRevision,
  PrototypeRevisionSource,
} from './types.js';

/** Raw prototype payload persisted in `workspace_entities` (`collection = 'prototypes'`). */
export interface StoredInteractivePrototype {
  id: string;
  projectId: string;
  name: string;
  version: string;
  baseVersion?: string;
  designBrief?: DesignBrief;
  coDesignSessionId?: string;
  revisions: PrototypeRevision[];
  currentRevisionId: string;
  createdAt: string;
  updatedAt: string;
}

/** Legacy flat `PrototypeArtifact` row persisted before two-tier revisions existed. */
export interface LegacyStoredPrototype {
  id: string;
  projectId: string;
  name: string;
  version?: string;
  htmlContent: string;
  extractedScreenCount?: number;
  updatedAt?: string;
  revisions?: undefined;
}

export class PrototypeConfirmedDeleteError extends Error {
  readonly code = 'PROTOTYPE_HOLDS_CONFIRMED_REVISION' as const;
  readonly prototypeId: string;
  readonly confirmedRevisionId: string;
  readonly messageZh: string;
  readonly messageEn: string;

  constructor(params: {
    prototypeId: string;
    prototypeName: string;
    confirmedRevisionId: string;
    confirmedRevisionTitle?: string;
  }) {
    const revDescZh = params.confirmedRevisionTitle
      ? `「${params.confirmedRevisionTitle}」`
      : params.confirmedRevisionId;
    const revDescEn = params.confirmedRevisionTitle
      ? `"${params.confirmedRevisionTitle}"`
      : params.confirmedRevisionId;
    const messageZh = `界面原型「${params.prototypeName}」持有当前工程的已确认修订（${revDescZh}），无法删除；请先在其他原型上确认新修订后再删除。`;
    const messageEn = `Prototype "${params.prototypeName}" holds this project's Confirmed Revision (${revDescEn}) and cannot be deleted until another prototype revision is confirmed.`;
    super(`${messageZh} (${messageEn})`);
    this.name = 'PrototypeConfirmedDeleteError';
    this.prototypeId = params.prototypeId;
    this.confirmedRevisionId = params.confirmedRevisionId;
    this.messageZh = messageZh;
    this.messageEn = messageEn;
  }
}

export type AnyStoredPrototype = StoredInteractivePrototype | LegacyStoredPrototype;

const SCREEN_TAG_RE = /<([a-z0-9]+)\b[^>]*data-screen-id\s*=\s*["']([^"']+)["'][^>]*>/gi;

export function countPrototypeScreens(html: string): number {
  SCREEN_TAG_RE.lastIndex = 0;
  let count = 0;
  while (SCREEN_TAG_RE.exec(html) !== null) {
    count += 1;
  }
  return count;
}

export function summarizeRevisionTitle(input: {
  title?: string;
  instruction?: string;
  source: PrototypeRevisionSource;
  revisionNumber: number;
  version?: string;
}): string {
  const raw = (input.title?.trim() || input.instruction?.trim() || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (raw) {
    return raw.length > 48 ? `${raw.slice(0, 47)}…` : raw;
  }
  switch (input.source) {
    case 'GENERATED':
      return `生成首版原型 (#${input.revisionNumber})`;
    case 'REFINED':
      return `AI 精修修订 (#${input.revisionNumber})`;
    case 'UPLOADED':
      return `导入 HTML 原型 (#${input.revisionNumber})`;
    case 'RESTORED':
      return `恢复历史修订 (#${input.revisionNumber})`;
    case 'CLONED':
      return `另存为新原型基线 (#${input.revisionNumber})`;
    case 'MIGRATED':
      return input.version ? `初始修订 (${input.version})` : '初始修订';
    case 'MANUAL_SAVE':
    default:
      return `手动保存修订 (#${input.revisionNumber})`;
  }
}

export function isLegacyStoredPrototype(
  stored: AnyStoredPrototype,
): stored is LegacyStoredPrototype {
  return !Array.isArray((stored as StoredInteractivePrototype).revisions);
}

export function upgradeLegacyPrototype(
  legacy: LegacyStoredPrototype,
  fallbackTimestamp = '2026-01-01T00:00:00.000Z',
): StoredInteractivePrototype {
  const ts = legacy.updatedAt?.trim() || fallbackTimestamp;
  const version = legacy.version?.trim() || 'v1.0';
  const revisionId = `${legacy.id}::rev-1`;
  const extractedScreenCount =
    typeof legacy.extractedScreenCount === 'number'
      ? legacy.extractedScreenCount
      : countPrototypeScreens(legacy.htmlContent);

  const revision: PrototypeRevision = {
    id: revisionId,
    prototypeId: legacy.id,
    projectId: legacy.projectId,
    revisionNumber: 1,
    title: summarizeRevisionTitle({
      source: 'MIGRATED',
      revisionNumber: 1,
      version,
    }),
    htmlContent: legacy.htmlContent,
    extractedScreenCount,
    source: 'MIGRATED',
    createdAt: ts,
  };

  return {
    id: legacy.id,
    projectId: legacy.projectId,
    name: legacy.name,
    version,
    baseVersion: version.replace(/-r\d+$/i, ''),
    revisions: [revision],
    currentRevisionId: revisionId,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function hydrateInteractivePrototype(
  stored: StoredInteractivePrototype,
  confirmation?: ConfirmedPrototypeRevisionRecord,
): InteractivePrototype {
  const orderedRevisions = [...stored.revisions]
    .sort((a, b) => a.revisionNumber - b.revisionNumber)
    .map((rev) => ({ ...rev }));
  const latestRevision =
    orderedRevisions.find((r) => r.id === stored.currentRevisionId) ??
    orderedRevisions[orderedRevisions.length - 1]!;

  const isConfirmed = Boolean(
    confirmation &&
      confirmation.prototypeId === stored.id &&
      orderedRevisions.some((r) => r.id === confirmation.revisionId),
  );
  const confirmedIdx = isConfirmed
    ? orderedRevisions.findIndex((r) => r.id === confirmation!.revisionId)
    : -1;
  const aheadOfConfirmedCount =
    confirmedIdx >= 0 ? Math.max(0, orderedRevisions.length - 1 - confirmedIdx) : 0;

  return {
    id: stored.id,
    projectId: stored.projectId,
    name: stored.name,
    ...(stored.designBrief ? { designBrief: structuredClone(stored.designBrief) } : {}),
    ...(stored.coDesignSessionId ? { coDesignSessionId: stored.coDesignSessionId } : {}),
    revisions: orderedRevisions,
    currentRevisionId: latestRevision.id,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    version: stored.version,
    htmlContent: latestRevision.htmlContent,
    extractedScreenCount: latestRevision.extractedScreenCount,
    isConfirmed,
    ...(isConfirmed && confirmation ? { confirmedRevisionId: confirmation.revisionId } : {}),
    aheadOfConfirmedCount,
  };
}

export function buildStoredPrototypeOnCreate(params: {
  projectId: string;
  prototypeId: string;
  revisionId: string;
  now: string;
  input: CreatePrototypeInput;
}): { stored: StoredInteractivePrototype; revision: PrototypeRevision } {
  const source: PrototypeRevisionSource = params.input.source ?? 'MANUAL_SAVE';
  const baseVersion = params.input.version?.trim() || 'v1.0';
  const revision: PrototypeRevision = {
    id: params.revisionId,
    prototypeId: params.prototypeId,
    projectId: params.projectId,
    revisionNumber: 1,
    title: summarizeRevisionTitle({
      title: params.input.title,
      instruction: params.input.instruction,
      source,
      revisionNumber: 1,
      version: baseVersion,
    }),
    ...(params.input.starred !== undefined ? { starred: params.input.starred } : {}),
    htmlContent: params.input.htmlContent,
    extractedScreenCount: countPrototypeScreens(params.input.htmlContent),
    source,
    ...(params.input.agentRunId ? { agentRunId: params.input.agentRunId } : {}),
    createdAt: params.now,
  };

  const stored: StoredInteractivePrototype = {
    id: params.prototypeId,
    projectId: params.projectId,
    name: params.input.name,
    version: baseVersion,
    baseVersion,
    ...(params.input.designBrief
      ? { designBrief: structuredClone(params.input.designBrief) }
      : {}),
    ...(params.input.coDesignSessionId
      ? { coDesignSessionId: params.input.coDesignSessionId }
      : {}),
    revisions: [revision],
    currentRevisionId: revision.id,
    createdAt: params.now,
    updatedAt: params.now,
  };

  return { stored, revision };
}

export function deriveNextVersionLabel(
  stored: StoredInteractivePrototype,
  nextRevisionNumber: number,
  explicitVersion?: string,
): string {
  if (explicitVersion?.trim()) {
    return explicitVersion.trim();
  }
  const base = stored.baseVersion || stored.version.replace(/-r\d+$/i, '');
  return `${base}-r${Math.max(1, nextRevisionNumber - 1)}`;
}

export function buildStoredPrototypeOnAppend(params: {
  stored: StoredInteractivePrototype;
  revisionId: string;
  now: string;
  input: AppendPrototypeRevisionInput;
}): { stored: StoredInteractivePrototype; revision: PrototypeRevision } {
  const ordered = [...params.stored.revisions].sort((a, b) => a.revisionNumber - b.revisionNumber);
  const nextRevisionNumber =
    ordered.length > 0 ? ordered[ordered.length - 1]!.revisionNumber + 1 : 1;
  const source: PrototypeRevisionSource = params.input.source ?? 'MANUAL_SAVE';
  const nextVersion = deriveNextVersionLabel(
    params.stored,
    nextRevisionNumber,
    params.input.version,
  );

  const revision: PrototypeRevision = {
    id: params.revisionId,
    prototypeId: params.stored.id,
    projectId: params.stored.projectId,
    revisionNumber: nextRevisionNumber,
    title: summarizeRevisionTitle({
      title: params.input.title,
      instruction: params.input.instruction,
      source,
      revisionNumber: nextRevisionNumber,
      version: nextVersion,
    }),
    ...(params.input.starred !== undefined ? { starred: params.input.starred } : {}),
    htmlContent: params.input.htmlContent,
    extractedScreenCount: countPrototypeScreens(params.input.htmlContent),
    source,
    ...(params.input.restoredFromRevisionId
      ? { restoredFromRevisionId: params.input.restoredFromRevisionId }
      : {}),
    ...(params.input.agentRunId ? { agentRunId: params.input.agentRunId } : {}),
    createdAt: params.now,
  };

  const nextStored: StoredInteractivePrototype = {
    ...params.stored,
    ...(params.input.name?.trim() ? { name: params.input.name.trim() } : {}),
    version: nextVersion,
    revisions: [...ordered, revision],
    currentRevisionId: revision.id,
    updatedAt: params.now,
  };

  return { stored: nextStored, revision };
}

export function buildStoredPrototypeOnRestore(params: {
  stored: StoredInteractivePrototype;
  targetRevisionId: string;
  newRevisionId: string;
  now: string;
  title?: string;
}): { stored: StoredInteractivePrototype; revision: PrototypeRevision } {
  const target = params.stored.revisions.find((r) => r.id === params.targetRevisionId);
  if (!target) {
    throw new Error(`Prototype revision not found: ${params.targetRevisionId}`);
  }
  const autoTitle =
    params.title?.trim() || `恢复自修订 #${target.revisionNumber}（${target.title}）`;
  return buildStoredPrototypeOnAppend({
    stored: params.stored,
    revisionId: params.newRevisionId,
    now: params.now,
    input: {
      title: autoTitle,
      htmlContent: target.htmlContent,
      source: 'RESTORED',
      restoredFromRevisionId: target.id,
    },
  });
}

export function applyRevisionMetadataPatch(
  stored: StoredInteractivePrototype,
  revisionId: string,
  patch: { title?: string; starred?: boolean },
): { stored: StoredInteractivePrototype; revision: PrototypeRevision } {
  const ordered = [...stored.revisions].sort((a, b) => a.revisionNumber - b.revisionNumber);
  const targetIdx = ordered.findIndex((r) => r.id === revisionId);
  if (targetIdx < 0) {
    throw new Error(`Prototype revision not found: ${revisionId}`);
  }
  const existing = ordered[targetIdx]!;
  const updatedRevision: PrototypeRevision = {
    ...existing,
    ...(patch.title !== undefined && patch.title.trim() ? { title: patch.title.trim() } : {}),
    ...(patch.starred !== undefined ? { starred: patch.starred } : {}),
  };
  const nextRevisions = ordered.map((rev, idx) => (idx === targetIdx ? updatedRevision : rev));
  return {
    stored: {
      ...stored,
      revisions: nextRevisions,
    },
    revision: updatedRevision,
  };
}

export function hydrateConfirmedPrototypeRevision(
  record: ConfirmedPrototypeRevisionRecord,
  storedPrototype: StoredInteractivePrototype,
): ConfirmedPrototypeRevision | undefined {
  const hydratedProto = hydrateInteractivePrototype(storedPrototype, record);
  const revision = hydratedProto.revisions.find((r) => r.id === record.revisionId);
  if (!revision) return undefined;
  return {
    projectId: record.projectId,
    prototypeId: record.prototypeId,
    revisionId: record.revisionId,
    confirmedAt: record.confirmedAt,
    prototype: hydratedProto,
    revision,
    htmlContent: revision.htmlContent,
  };
}
