import { create } from 'zustand';
import type {
  PrototypeRefinementSelection,
  TransientTurnImageInput,
} from '../../../packages/agent-runtime/index.js';
import type {
  AgentImageAttachmentRef,
  AgentSession,
  InteractivePrototype,
  PrototypeRevision,
  PrototypeTargetAnchor,
} from '../../../packages/workspace-store/index.js';
import {
  apiRestorePrototypeRevision,
  getCurrentClientLocale,
  useWorkbenchStore,
  type SessionLiveDraft,
} from '../../api.js';
import {
  resolveTurnImagesForRequest,
  storeUploadedOrPastedImage,
} from '../../lib/localImageStore.js';
import { useAgentPanelStore } from '../agent/agentPanelStore.js';
import {
  toRefinementSelections,
  type PrototypeSelectionCropPayload,
  type PrototypeSelectionTarget,
  type PrototypeVisualAnnotation,
} from './PrototypeVisualInspector.js';

export type { PrototypeSelectionCropPayload };

export type BeforeAfterViewMode = 'AFTER' | 'BEFORE';

export interface PrototypeSelectionAttachment {
  id: string;
  prototypeId: string;
  target: PrototypeSelectionTarget;
  anchor: PrototypeTargetAnchor;
  semanticLabel: string;
  imageRef: AgentImageAttachmentRef;
  note: string;
  createdAt: string;
}

export interface PostRunPrototypeReview {
  prototypeId: string;
  revision: PrototypeRevision;
  previousRevision: PrototypeRevision;
  modifiedAnchors: PrototypeTargetAnchor[];
}

// 1x1 transparent PNG fallback when capturing in headless/non-canvas environments
const FALLBACK_1X1_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function decodeBase64Bytes(base64: string): Uint8Array {
  const clean = base64.replace(/^data:[^;]+;base64,/, '').trim();
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(clean, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function selectionTargetToAnchor(target: PrototypeSelectionTarget): PrototypeTargetAnchor {
  return {
    ...(target.screenId ? { screenId: target.screenId } : {}),
    ...(target.elementId ? { elementId: target.elementId } : {}),
    ...(target.cssSelector ? { cssSelector: target.cssSelector } : {}),
    ...(target.label ? { label: target.label } : {}),
  };
}

export function formatSelectionSemanticLabel(target: PrototypeSelectionTarget): string {
  const parts: string[] = [];
  if (target.screenId) parts.push(target.screenId);
  if (target.elementId) parts.push(target.elementId);
  if (target.label && !parts.includes(target.label)) {
    parts.push(target.label);
  }
  return parts.join(' · ') || target.cssSelector || target.tagName;
}

export function resolveHighlightSelectorFromAnchor(
  anchor: PrototypeTargetAnchor | null | undefined,
): string | null {
  if (!anchor) return null;
  if (anchor.screenId && anchor.elementId) {
    return `[data-screen-id="${escapeAttrValue(anchor.screenId)}"] [data-element-id="${escapeAttrValue(anchor.elementId)}"]`;
  }
  if (anchor.elementId) {
    return anchor.elementId;
  }
  if (anchor.cssSelector) {
    return anchor.cssSelector;
  }
  if (anchor.screenId) {
    return anchor.screenId;
  }
  return null;
}

export function resolveLiveRunningPrototypeAnchor(
  session: AgentSession | null | undefined,
  liveDraft: SessionLiveDraft | null | undefined,
): PrototypeTargetAnchor | null {
  const isRunning = Boolean(liveDraft) || session?.status === 'RUNNING';
  if (!isRunning) return null;

  if (liveDraft?.steps && liveDraft.steps.length > 0) {
    for (let i = liveDraft.steps.length - 1; i >= 0; i -= 1) {
      const step = liveDraft.steps[i]!;
      if (step.status === 'RUNNING' && step.targetAnchor) {
        return step.targetAnchor;
      }
    }
  }

  if (liveDraft?.activeAnchor) {
    return liveDraft.activeAnchor;
  }

  if (liveDraft?.steps && liveDraft.steps.length > 0) {
    for (let i = liveDraft.steps.length - 1; i >= 0; i -= 1) {
      const anchor = liveDraft.steps[i]?.targetAnchor;
      if (anchor) return anchor;
    }
  }

  return null;
}

export function resolvePostRunPrototypeReview(
  prototype: InteractivePrototype | null | undefined,
  session: AgentSession | null | undefined,
  dismissedRevisionByPrototype: Record<string, string>,
): PostRunPrototypeReview | null {
  if (!prototype || prototype.revisions.length < 2) return null;

  const currentIdx = prototype.revisions.findIndex((r) => r.id === prototype.currentRevisionId);
  const resolvedIdx = currentIdx >= 0 ? currentIdx : prototype.revisions.length - 1;
  if (resolvedIdx <= 0) return null;

  const currentRevision = prototype.revisions[resolvedIdx]!;
  const previousRevision = prototype.revisions[resolvedIdx - 1]!;

  if (currentRevision.source === 'RESTORED') return null;
  if (dismissedRevisionByPrototype[prototype.id] === currentRevision.id) return null;

  const messages = session?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]!;
    if (msg.role !== 'assistant' || !msg.artifacts) continue;
    for (const art of msg.artifacts) {
      if (
        art.kind === 'PROTOTYPE_REVISION' &&
        art.revisionId === currentRevision.id &&
        (!art.prototypeId || art.prototypeId === prototype.id)
      ) {
        return {
          prototypeId: prototype.id,
          revision: currentRevision,
          previousRevision,
          modifiedAnchors: art.modifiedAnchors ?? [],
        };
      }
    }
  }

  if (currentRevision.source === 'AGENT_RUN') {
    return {
      prototypeId: prototype.id,
      revision: currentRevision,
      previousRevision,
      modifiedAnchors: [],
    };
  }

  return null;
}

export interface PrototypeSelectionStoreState {
  attachmentsByPrototype: Record<string, PrototypeSelectionAttachment[]>;
  beforeAfterByPrototype: Record<string, { revisionId: string; mode: BeforeAfterViewMode }>;
  dismissedRevisionByPrototype: Record<string, string>;
  flashedRevisionByPrototype: Record<string, string>;

  getAttachments: (prototypeId: string) => PrototypeSelectionAttachment[];
  upsertAttachment: (prototypeId: string, attachment: PrototypeSelectionAttachment) => void;
  removeSelectionAttachment: (prototypeId: string, attachmentId: string) => void;
  clearAttachments: (prototypeId: string) => void;
  consumeAttachments: (prototypeId: string) => PrototypeSelectionAttachment[];
  hoverAttachment: (attachment: PrototypeSelectionAttachment | null) => void;

  setBeforeAfterMode: (
    prototypeId: string,
    mode: BeforeAfterViewMode,
    revisionId?: string,
  ) => void;
  getBeforeAfterMode: (prototypeId: string, currentRevisionId?: string) => BeforeAfterViewMode;
  dismissPostRunReview: (prototypeId: string, revisionId: string) => void;
  markRevisionFlashed: (prototypeId: string, revisionId: string) => void;
  hasRevisionFlashed: (prototypeId: string, revisionId: string) => boolean;
}

const EMPTY_ATTACHMENTS: PrototypeSelectionAttachment[] = [];

export const usePrototypeSelectionStore = create<PrototypeSelectionStoreState>(
  (set, get, storeApi) => {
    const syncSet = (
      partial:
        | Partial<PrototypeSelectionStoreState>
        | ((state: PrototypeSelectionStoreState) => Partial<PrototypeSelectionStoreState>),
    ) => {
      set(partial);
      Object.assign(storeApi.getInitialState(), get());
    };

    return {
      attachmentsByPrototype: {},
      beforeAfterByPrototype: {},
      dismissedRevisionByPrototype: {},
      flashedRevisionByPrototype: {},

      getAttachments: (prototypeId) =>
        get().attachmentsByPrototype[prototypeId] ?? EMPTY_ATTACHMENTS,

      upsertAttachment: (prototypeId, attachment) => {
        const current = get().attachmentsByPrototype[prototypeId] ?? [];
        const existingIdx = current.findIndex(
          (item) =>
            item.id === attachment.id ||
            (item.target.cssSelector === attachment.target.cssSelector &&
              item.target.kind === attachment.target.kind &&
              item.target.elementId === attachment.target.elementId),
        );
        const nextList =
          existingIdx >= 0
            ? current.map((item, idx) => (idx === existingIdx ? attachment : item))
            : [...current, attachment];

        syncSet({
          attachmentsByPrototype: {
            ...get().attachmentsByPrototype,
            [prototypeId]: nextList,
          },
        });
      },

      removeSelectionAttachment: (prototypeId, attachmentId) => {
        const current = get().attachmentsByPrototype[prototypeId] ?? [];
        const removed = current.find((item) => item.id === attachmentId);
        const nextList = current.filter((item) => item.id !== attachmentId);
        const nextMap = { ...get().attachmentsByPrototype };
        if (nextList.length > 0) {
          nextMap[prototypeId] = nextList;
        } else {
          delete nextMap[prototypeId];
        }
        syncSet({ attachmentsByPrototype: nextMap });

        if (removed) {
          const hovered = useAgentPanelStore.getState().hoveredAnchor;
          if (
            hovered &&
            hovered.screenId === removed.anchor.screenId &&
            hovered.elementId === removed.anchor.elementId &&
            hovered.cssSelector === removed.anchor.cssSelector
          ) {
            useAgentPanelStore.getState().setHoveredAnchor(null);
            Object.assign(useAgentPanelStore.getInitialState(), useAgentPanelStore.getState());
          }
        }
      },

      clearAttachments: (prototypeId) => {
        const nextMap = { ...get().attachmentsByPrototype };
        delete nextMap[prototypeId];
        syncSet({ attachmentsByPrototype: nextMap });
      },

      consumeAttachments: (prototypeId) => {
        const current = get().attachmentsByPrototype[prototypeId] ?? [];
        if (current.length > 0) {
          const nextMap = { ...get().attachmentsByPrototype };
          delete nextMap[prototypeId];
          syncSet({ attachmentsByPrototype: nextMap });
        }
        useAgentPanelStore.getState().setHoveredAnchor(null);
        Object.assign(useAgentPanelStore.getInitialState(), useAgentPanelStore.getState());
        return current;
      },

      hoverAttachment: (attachment) => {
        const nextAnchor = attachment ? attachment.anchor : null;
        useAgentPanelStore.getState().setHoveredAnchor(nextAnchor);
        Object.assign(useAgentPanelStore.getInitialState(), useAgentPanelStore.getState());
      },

      setBeforeAfterMode: (prototypeId, mode, revisionId = '') => {
        syncSet({
          beforeAfterByPrototype: {
            ...get().beforeAfterByPrototype,
            [prototypeId]: { revisionId, mode },
          },
        });
      },

      getBeforeAfterMode: (prototypeId, currentRevisionId) => {
        const entry = get().beforeAfterByPrototype[prototypeId];
        if (!entry) return 'AFTER';
        if (currentRevisionId && entry.revisionId && entry.revisionId !== currentRevisionId) {
          return 'AFTER';
        }
        return entry.mode;
      },

      dismissPostRunReview: (prototypeId, revisionId) => {
        const nextBeforeAfter = { ...get().beforeAfterByPrototype };
        delete nextBeforeAfter[prototypeId];
        syncSet({
          beforeAfterByPrototype: nextBeforeAfter,
          dismissedRevisionByPrototype: {
            ...get().dismissedRevisionByPrototype,
            [prototypeId]: revisionId,
          },
        });
      },

      markRevisionFlashed: (prototypeId, revisionId) => {
        if (get().flashedRevisionByPrototype[prototypeId] === revisionId) return;
        syncSet({
          flashedRevisionByPrototype: {
            ...get().flashedRevisionByPrototype,
            [prototypeId]: revisionId,
          },
        });
      },

      hasRevisionFlashed: (prototypeId, revisionId) =>
        get().flashedRevisionByPrototype[prototypeId] === revisionId,
    };
  },
);

function createCropBlob(crop?: PrototypeSelectionCropPayload | null): {
  blob: Blob;
  width: number;
  height: number;
} {
  if (crop && crop.dataBase64) {
    const bytes = decodeBase64Bytes(crop.dataBase64);
    const mimeType =
      crop.mimeType === 'image/png' || crop.mimeType === 'image/jpeg'
        ? crop.mimeType
        : 'image/webp';
    return {
      blob: new Blob([bytes as BlobPart], { type: mimeType }),
      width: Math.max(1, Math.round(crop.width || 120)),
      height: Math.max(1, Math.round(crop.height || 60)),
    };
  }
  const fallbackBytes = decodeBase64Bytes(FALLBACK_1X1_PNG_BASE64);
  return {
    blob: new Blob([fallbackBytes as BlobPart], { type: 'image/png' }),
    width: 1,
    height: 1,
  };
}

export async function ingestSelectionTargetAsAttachment(
  prototypeId: string,
  target: PrototypeSelectionTarget,
  options?: {
    crop?: PrototypeSelectionCropPayload | null;
    note?: string;
  },
): Promise<PrototypeSelectionAttachment> {
  const semanticLabel = formatSelectionSemanticLabel(target);
  const anchor = selectionTargetToAnchor(target);
  const { blob, width, height } = createCropBlob(
    options?.crop ?? {
      mimeType: 'image/png',
      dataBase64: FALLBACK_1X1_PNG_BASE64,
      width: Math.max(1, Math.round(target.rect.width || 120)),
      height: Math.max(1, Math.round(target.rect.height || 60)),
    },
  );

  const { ref } = await storeUploadedOrPastedImage(blob, {
    name: semanticLabel,
    role: 'selection_crop',
    width,
    height,
  });

  const existing = usePrototypeSelectionStore
    .getState()
    .getAttachments(prototypeId)
    .find(
      (item) =>
        item.target.cssSelector === target.cssSelector &&
        item.target.kind === target.kind &&
        item.target.elementId === target.elementId,
    );

  const attachment: PrototypeSelectionAttachment = {
    id: existing?.id ?? `selatt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    prototypeId,
    target,
    anchor,
    semanticLabel,
    imageRef: ref,
    note: options?.note?.trim() ?? existing?.note ?? '',
    createdAt: new Date().toISOString(),
  };

  usePrototypeSelectionStore.getState().upsertAttachment(prototypeId, attachment);
  return attachment;
}

export async function upgradeSelectionAttachmentCrop(
  prototypeId: string,
  cssSelector: string,
  crop: PrototypeSelectionCropPayload,
): Promise<void> {
  const current = usePrototypeSelectionStore.getState().getAttachments(prototypeId);
  const match = [...current].reverse().find((item) => item.target.cssSelector === cssSelector);
  if (!match) return;

  const { blob, width, height } = createCropBlob(crop);
  const { ref } = await storeUploadedOrPastedImage(blob, {
    name: match.semanticLabel,
    role: 'selection_crop',
    width,
    height,
  });

  usePrototypeSelectionStore.getState().upsertAttachment(prototypeId, {
    ...match,
    imageRef: ref,
  });
}

export async function buildRefinementPayloadFromAttachments(
  attachments: readonly PrototypeSelectionAttachment[],
  options: {
    visionSupported: boolean;
    additionalAnnotations?: PrototypeVisualAnnotation[];
    immediateDraft?: { target: PrototypeSelectionTarget; note: string } | null;
  },
): Promise<{
  selections: PrototypeRefinementSelection[];
  images: TransientTurnImageInput[];
}> {
  const attachmentAnnotations: PrototypeVisualAnnotation[] = attachments.map((att, idx) => ({
    id: att.id,
    index: idx + 1,
    target: att.target,
    note: att.note,
  }));

  const combinedAnnotations = [...attachmentAnnotations];
  for (const extra of options.additionalAnnotations ?? []) {
    const isDuplicate = combinedAnnotations.some(
      (a) =>
        a.target.cssSelector === extra.target.cssSelector &&
        a.target.kind === extra.target.kind &&
        a.target.elementId === extra.target.elementId,
    );
    if (!isDuplicate) {
      combinedAnnotations.push({
        ...extra,
        index: combinedAnnotations.length + 1,
      });
    }
  }

  const selections = toRefinementSelections(combinedAnnotations, options.immediateDraft ?? null);

  const fallbackNotesById: Record<string, string | undefined> = {};
  for (const att of attachments) {
    fallbackNotesById[att.imageRef.id] = att.note
      ? `${att.semanticLabel}: ${att.note}`
      : att.semanticLabel;
  }

  let images: TransientTurnImageInput[];
  if (options.visionSupported) {
    images = await resolveTurnImagesForRequest(
      attachments.map((att) => att.imageRef),
      fallbackNotesById,
    );
  } else {
    // Active provider does not support vision: omit dataBase64 bytes on the wire while keeping
    // lightweight metadata so the server records visionFallbackUsed without storing image bytes.
    images = attachments.map((att) => {
      const ref = att.imageRef;
      const note = fallbackNotesById[ref.id];
      return {
        id: ref.id,
        name: ref.name,
        mimeType: ref.mimeType,
        ...(ref.width !== undefined ? { width: ref.width } : {}),
        ...(ref.height !== undefined ? { height: ref.height } : {}),
        role: ref.role ?? 'selection_crop',
        ...(note ? { textFallbackNote: note } : {}),
      };
    });
  }

  return { selections, images };
}

export async function submitPrototypeComposerTurnWithSelections(input: {
  projectId: string;
  prototypeId: string;
  instruction: string;
  visionSupported: boolean;
  additionalAnnotations?: PrototypeVisualAnnotation[];
  immediateDraft?: { target: PrototypeSelectionTarget; note: string } | null;
  mockMode?: boolean;
}): Promise<{ sessionId: string }> {
  const consumed = usePrototypeSelectionStore.getState().consumeAttachments(input.prototypeId);
  const { selections, images } = await buildRefinementPayloadFromAttachments(consumed, {
    visionSupported: input.visionSupported,
    ...(input.additionalAnnotations ? { additionalAnnotations: input.additionalAnnotations } : {}),
    ...(input.immediateDraft !== undefined ? { immediateDraft: input.immediateDraft } : {}),
  });

  const res = await useWorkbenchStore.getState().startPrototypeRefinementRun({
    projectId: input.projectId,
    prototypeId: input.prototypeId,
    instruction: input.instruction,
    ...(selections.length > 0 ? { selections } : {}),
    ...(images.length > 0 ? { images } : {}),
    ...(input.mockMode !== undefined ? { mockMode: input.mockMode } : {}),
  });
  Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
  return res;
}

export async function revertPostRunToPreviousRevision(
  prototypeId: string,
  previousRevisionId: string,
): Promise<void> {
  const res = await apiRestorePrototypeRevision(prototypeId, previousRevisionId);
  const store = useWorkbenchStore.getState();
  store.patchData({
    prototypes: res.prototypes,
    confirmedPrototypeRevision: res.confirmedRevision,
  });
  Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

  usePrototypeSelectionStore
    .getState()
    .setBeforeAfterMode(prototypeId, 'AFTER', res.revision.id);

  const locale = getCurrentClientLocale();
  store.showToast(
    locale === 'en-US'
      ? `Reverted to previous revision as R${res.revision.revisionNumber}`
      : `已回到上一修订（追加为 R${res.revision.revisionNumber}）`,
  );
}

export function resetPrototypeSelectionStoreForTests(): void {
  const initial = {
    attachmentsByPrototype: {},
    beforeAfterByPrototype: {},
    dismissedRevisionByPrototype: {},
    flashedRevisionByPrototype: {},
  };
  usePrototypeSelectionStore.setState(initial);
  Object.assign(usePrototypeSelectionStore.getInitialState(), usePrototypeSelectionStore.getState());
}
