import type {
  AgentImageAttachmentRef,
  AgentImageAttachmentRole,
} from '../../../../packages/workspace-store/index.js';
import { createSessionStorageLru, type WebStorageLike } from './sessionStorageLru.js';

export const CONVERSATION_DRAFT_STORAGE_KEY = 'onto_conversation_draft_v1';

export interface ConversationSessionDraft {
  readonly text: string;
  readonly quotes: readonly string[];
  readonly attachments?: readonly AgentImageAttachmentRef[];
}

export type ConversationDraftEntry = ConversationSessionDraft;
export type DraftStorageLike = WebStorageLike;

export const EMPTY_CONVERSATION_DRAFT: ConversationSessionDraft = {
  text: '',
  quotes: [],
};

const VALID_ROLES = new Set<AgentImageAttachmentRole>([
  'primary_ref',
  'borrowed_ref',
  'selection_crop',
  'user_upload',
]);

function normalizeAttachmentRef(raw: unknown): AgentImageAttachmentRef | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
  const mimeType = typeof candidate.mimeType === 'string' ? candidate.mimeType.trim() : '';
  const source =
    candidate.source === 'local' || candidate.source === 'remote' ? candidate.source : null;
  if (!id || !name || !mimeType || !source) return null;

  const remoteUrl =
    typeof candidate.remoteUrl === 'string' && candidate.remoteUrl.trim()
      ? candidate.remoteUrl.trim()
      : undefined;
  const width =
    typeof candidate.width === 'number' && Number.isFinite(candidate.width) && candidate.width > 0
      ? candidate.width
      : undefined;
  const height =
    typeof candidate.height === 'number' &&
    Number.isFinite(candidate.height) &&
    candidate.height > 0
      ? candidate.height
      : undefined;
  const role =
    typeof candidate.role === 'string' && VALID_ROLES.has(candidate.role as AgentImageAttachmentRole)
      ? (candidate.role as AgentImageAttachmentRole)
      : undefined;

  return {
    id,
    name,
    mimeType,
    source,
    ...(remoteUrl ? { remoteUrl } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(role ? { role } : {}),
  };
}

export function isConversationDraftEmpty(draft: ConversationSessionDraft): boolean {
  return (
    draft.text.length === 0 &&
    draft.quotes.length === 0 &&
    (draft.attachments?.length ?? 0) === 0
  );
}

function normalizeDraft(value: unknown): ConversationSessionDraft | null {
  if (typeof value === 'string') {
    const entry: ConversationSessionDraft = { text: value, quotes: [] };
    return isConversationDraftEmpty(entry) ? null : entry;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const text = typeof candidate.text === 'string' ? candidate.text : '';
  const quotes = Array.isArray(candidate.quotes)
    ? candidate.quotes.filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
    : [];
  const attachments = Array.isArray(candidate.attachments)
    ? candidate.attachments
        .map((item) => normalizeAttachmentRef(item))
        .filter((item): item is AgentImageAttachmentRef => item !== null)
    : [];
  const normalized: ConversationSessionDraft = {
    text,
    quotes,
    ...(attachments.length > 0 ? { attachments } : {}),
  };
  return isConversationDraftEmpty(normalized) ? null : normalized;
}

function cloneDraft(entry: ConversationSessionDraft): ConversationSessionDraft {
  return {
    text: entry.text,
    quotes: [...entry.quotes],
    ...(entry.attachments && entry.attachments.length > 0
      ? { attachments: entry.attachments.map((att) => ({ ...att })) }
      : {}),
  };
}

const draftLru = createSessionStorageLru<ConversationSessionDraft>({
  storageKey: CONVERSATION_DRAFT_STORAGE_KEY,
  normalize: normalizeDraft,
  clone: cloneDraft,
});

export function readSessionDraft(
  sessionId: string | undefined | null,
  storage?: DraftStorageLike | null,
): ConversationSessionDraft {
  return draftLru.read(sessionId, storage) ?? EMPTY_CONVERSATION_DRAFT;
}

export function writeSessionDraft(
  sessionId: string | undefined | null,
  draft: ConversationSessionDraft,
  storage?: DraftStorageLike | null,
): void {
  if (!sessionId) return;
  const normalized = normalizeDraft(draft);
  if (!normalized) {
    draftLru.remove(sessionId, storage);
    return;
  }
  draftLru.write(sessionId, normalized, storage);
}

export function clearSessionDraft(
  sessionId: string | undefined | null,
  storage?: DraftStorageLike | null,
): void {
  draftLru.remove(sessionId, storage);
}

export function clearConversationDraftMemoryForTests(): void {
  draftLru.clearMemory();
}
