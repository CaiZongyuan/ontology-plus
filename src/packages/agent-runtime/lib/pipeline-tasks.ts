import type { WorkspaceStore } from '../../workspace-store/index.js';
import type { AgentLocale } from './locale.js';
import { LlmGatewayError } from './pi-session-engine.js';
import {
  generatePrototypeFromDoc,
  synthesizeOntologyFromPrototype,
  synthesizeRequirementDocFromSession,
  type SrsSynthesisProgressEvent,
  type SrsSynthesisProgressPhase,
} from './runtime.js';

export type PipelineTaskKind = 'SRS_SYNTHESIS' | 'PROTOTYPE_GEN' | 'ONTOLOGY_SYNTH';
export type PipelineTaskStatus = 'RUNNING' | 'COMPLETED' | 'ERROR' | 'CANCELLED';

export interface PipelineStageLogEntry {
  id: string;
  step: 1 | 2 | 3 | 4;
  phase: SrsSynthesisProgressPhase | 'ERROR' | 'CANCELLED';
  messageZh: string;
  messageEn: string;
  timestamp: string;
}

export interface PipelineTaskSnapshot {
  id: string;
  kind: PipelineTaskKind;
  projectId: string;
  projectName: string;
  sessionId?: string;
  docId?: string;
  prototypeId?: string;
  prompt?: string;
  status: PipelineTaskStatus;
  step: 1 | 2 | 3 | 4;
  phase: string;
  messageZh: string;
  messageEn: string;
  currentChapter?: string;
  completedChapters: number;
  thinkingChars: number;
  thinkingText?: string;
  streamedChars: number;
  streamedText?: string;
  previewTail?: string;
  providerModel?: string;
  draftDocId?: string;
  stageLogs: PipelineStageLogEntry[];
  startedAt: number;
  finishedAt?: number;
  targetView: 'req_docs' | 'req_prototype' | 'app_modeling';
  resultItemId?: string;
  unreadCompletion: boolean;
  errorMessage?: string;
  dismissed?: boolean;
}

export interface StartPipelineTaskInput {
  kind: PipelineTaskKind;
  projectId: string;
  sessionId?: string;
  docId?: string;
  prototypeId?: string;
  prompt?: string;
  title?: string;
  version?: string;
  resumeFromText?: string;
  locale?: AgentLocale | string;
}

export interface PipelineTaskProgressFrame {
  taskId: string;
  status: PipelineTaskStatus;
  step: 1 | 2 | 3 | 4;
  phase: string;
  messageZh: string;
  messageEn: string;
  currentChapter?: string;
  completedChapters: number;
  thinkingDelta?: string;
  thinkingChars: number;
  contentDelta?: string;
  replaceStreamedText?: string;
  streamedChars: number;
  previewTail?: string;
  providerModel?: string;
  draftDocId?: string;
  stageLogs: PipelineStageLogEntry[];
}

type TaskSseListener = {
  send: (eventName: string, payload: unknown) => void;
  close: () => void;
};

interface LivePipelineTaskEntry {
  snapshot: PipelineTaskSnapshot;
  controller: AbortController;
  listeners: Set<TaskSseListener>;
  lastCheckpointAt: number;
  lastStageSignature: string;
  promise: Promise<PipelineTaskSnapshot>;
}

const PIPELINE_WORKFLOW_KEY = 'PIPELINE_TASK';
const MAX_PERSISTED_STREAM_CHARS = 180_000;
const MAX_PERSISTED_THINKING_CHARS = 60_000;
const MAX_STAGE_LOGS = 48;

const liveTasksByStore = new WeakMap<WorkspaceStore, Map<string, LivePipelineTaskEntry>>();

function getStoreTaskMap(store: WorkspaceStore): Map<string, LivePipelineTaskEntry> {
  let map = liveTasksByStore.get(store);
  if (!map) {
    map = new Map<string, LivePipelineTaskEntry>();
    liveTasksByStore.set(store, map);
  }
  return map;
}

function targetViewForKind(kind: PipelineTaskKind): PipelineTaskSnapshot['targetView'] {
  if (kind === 'SRS_SYNTHESIS') return 'req_docs';
  if (kind === 'PROTOTYPE_GEN') return 'req_prototype';
  return 'app_modeling';
}

function initialMessagesForKind(kind: PipelineTaskKind): { messageZh: string; messageEn: string } {
  if (kind === 'SRS_SYNTHESIS') {
    return {
      messageZh: '正在启动后台持久化规格书合成任务，聚合会话记录与已确认决策…',
      messageEn: 'Starting durable background SRS synthesis task and aggregating session context…',
    };
  }
  if (kind === 'PROTOTYPE_GEN') {
    return {
      messageZh: '正在启动后台交互式 HTML5 原型生成任务…',
      messageEn: 'Starting durable background interactive HTML5 prototype task…',
    };
  }
  return {
    messageZh: '正在启动后台 11 元模型结构化推导任务…',
    messageEn: 'Starting durable background 11-model ontology synthesis task…',
  };
}

function persistSnapshotCheckpoint(store: WorkspaceStore, snapshot: PipelineTaskSnapshot): void {
  if (typeof store.saveAgentCheckpoint !== 'function') return;
  try {
    const compactSnapshot: PipelineTaskSnapshot = {
      ...snapshot,
      ...(snapshot.streamedText && snapshot.streamedText.length > MAX_PERSISTED_STREAM_CHARS
        ? { streamedText: snapshot.streamedText.slice(-MAX_PERSISTED_STREAM_CHARS) }
        : {}),
      ...(snapshot.thinkingText && snapshot.thinkingText.length > MAX_PERSISTED_THINKING_CHARS
        ? { thinkingText: snapshot.thinkingText.slice(-MAX_PERSISTED_THINKING_CHARS) }
        : {}),
    };
    store.saveAgentCheckpoint(
      snapshot.id,
      PIPELINE_WORKFLOW_KEY,
      JSON.stringify(compactSnapshot),
    );
  } catch {
    // Non-blocking checkpoint persistence
  }
}

function appendOrUpdateStageLog(
  logs: PipelineStageLogEntry[],
  entry: Omit<PipelineStageLogEntry, 'id' | 'timestamp'>,
  signature: string,
  prevSignature: string,
): { nextLogs: PipelineStageLogEntry[]; nextSignature: string } {
  const nowIso = new Date().toISOString();
  if (logs.length > 0 && signature === prevSignature) {
    const updated = [...logs];
    const last = updated[updated.length - 1]!;
    updated[updated.length - 1] = {
      ...last,
      messageZh: entry.messageZh,
      messageEn: entry.messageEn,
    };
    return { nextLogs: updated, nextSignature: signature };
  }
  const nextEntry: PipelineStageLogEntry = {
    id: `slog-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    step: entry.step,
    phase: entry.phase,
    messageZh: entry.messageZh,
    messageEn: entry.messageEn,
    timestamp: nowIso,
  };
  const nextLogs = [...logs, nextEntry].slice(-MAX_STAGE_LOGS);
  return { nextLogs, nextSignature: signature };
}

function reconcileStaleCheckpointSnapshot(
  store: WorkspaceStore,
  snapshot: PipelineTaskSnapshot,
): PipelineTaskSnapshot {
  if (snapshot.status !== 'RUNNING') return snapshot;
  const liveMap = getStoreTaskMap(store);
  if (liveMap.has(snapshot.id)) {
    return liveMap.get(snapshot.id)!.snapshot;
  }

  // Server restarted while this task was previously marked RUNNING — reconcile against stored artifacts
  if (snapshot.kind === 'SRS_SYNTHESIS') {
    const docs = store.listRequirementDocs(snapshot.projectId);
    const matchedDoc = snapshot.draftDocId
      ? docs.find((d) => d.id === snapshot.draftDocId)
      : undefined;
    if (matchedDoc && matchedDoc.status === 'CONFIRMED') {
      const recovered: PipelineTaskSnapshot = {
        ...snapshot,
        status: 'COMPLETED',
        step: 4,
        phase: 'DONE',
        finishedAt: Date.now(),
        resultItemId: matchedDoc.id,
        completedChapters: 9,
        streamedText: snapshot.streamedText || matchedDoc.content,
        streamedChars: (snapshot.streamedText || matchedDoc.content).length,
        previewTail: (snapshot.streamedText || matchedDoc.content).slice(-1600),
        messageZh: `已生成《${matchedDoc.title}》(${matchedDoc.version})`,
        messageEn: `Generated "${matchedDoc.title}" (${matchedDoc.version})`,
      };
      persistSnapshotCheckpoint(store, recovered);
      return recovered;
    }
    if (matchedDoc) {
      const recoveredDraftErr: PipelineTaskSnapshot = {
        ...snapshot,
        status: 'ERROR',
        phase: 'ERROR',
        finishedAt: Date.now(),
        resultItemId: matchedDoc.id,
        streamedText: snapshot.streamedText || matchedDoc.content,
        streamedChars: (snapshot.streamedText || matchedDoc.content).length,
        previewTail: (snapshot.streamedText || matchedDoc.content).slice(-1600),
        messageZh: `服务重启中断了流式合成，已为您自动保留阶段草稿《${matchedDoc.title}》，可查看草稿或重新合成完整版`,
        messageEn: `Server restart interrupted streaming; partial draft "${matchedDoc.title}" was preserved automatically`,
        errorMessage: 'SERVER_RESTART_INTERRUPTED',
      };
      persistSnapshotCheckpoint(store, recoveredDraftErr);
      return recoveredDraftErr;
    }
  }

  const interrupted: PipelineTaskSnapshot = {
    ...snapshot,
    status: 'ERROR',
    phase: 'ERROR',
    finishedAt: Date.now(),
    messageZh: '后台生成任务因服务重启中断，请点击重试继续生成',
    messageEn: 'Background generation was interrupted by a server restart; please retry',
    errorMessage: 'SERVER_RESTART_INTERRUPTED',
  };
  persistSnapshotCheckpoint(store, interrupted);
  return interrupted;
}

export function listServerPipelineTasks(
  store: WorkspaceStore,
  projectId?: string,
): PipelineTaskSnapshot[] {
  const merged = new Map<string, PipelineTaskSnapshot>();
  const liveMap = getStoreTaskMap(store);

  if (typeof store.listAgentCheckpoints === 'function') {
    const rows = store.listAgentCheckpoints(PIPELINE_WORKFLOW_KEY);
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.stateJson) as PipelineTaskSnapshot;
        if (!parsed || !parsed.id) continue;
        const reconciled = reconcileStaleCheckpointSnapshot(store, parsed);
        merged.set(reconciled.id, reconciled);
      } catch {
        // Ignore malformed checkpoint JSON
      }
    }
  }

  for (const [id, live] of liveMap.entries()) {
    merged.set(id, live.snapshot);
  }

  return Array.from(merged.values())
    .filter((t) => !t.dismissed && (!projectId || t.projectId === projectId))
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 20);
}

export function getServerPipelineTask(
  store: WorkspaceStore,
  taskId: string,
): PipelineTaskSnapshot | undefined {
  const live = getStoreTaskMap(store).get(taskId);
  if (live) return live.snapshot;
  if (typeof store.loadAgentCheckpoint === 'function') {
    const row = store.loadAgentCheckpoint(taskId);
    if (row && row.workflow === PIPELINE_WORKFLOW_KEY) {
      try {
        const parsed = JSON.parse(row.stateJson) as PipelineTaskSnapshot;
        return reconcileStaleCheckpointSnapshot(store, parsed);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function broadcastToTaskListeners(
  entry: LivePipelineTaskEntry,
  eventName: string,
  payload: unknown,
  closeAfter = false,
): void {
  for (const listener of Array.from(entry.listeners)) {
    try {
      listener.send(eventName, payload);
      if (closeAfter) {
        listener.close();
      }
    } catch {
      entry.listeners.delete(listener);
    }
  }
  if (closeAfter) {
    entry.listeners.clear();
  }
}

export function startServerPipelineTask(
  store: WorkspaceStore,
  input: StartPipelineTaskInput,
): { task: PipelineTaskSnapshot; reusedRunning: boolean } {
  const liveMap = getStoreTaskMap(store);

  // Idempotently return any currently RUNNING task of the same kind in the same project
  for (const existing of liveMap.values()) {
    if (
      existing.snapshot.projectId === input.projectId &&
      existing.snapshot.kind === input.kind &&
      existing.snapshot.status === 'RUNNING'
    ) {
      return { task: existing.snapshot, reusedRunning: true };
    }
  }

  const project = store.getProject(input.projectId);
  if (!project) {
    throw new Error(`Project not found: ${input.projectId}`);
  }

  // Auto-dismiss older finished tasks of the same kind & project so fresh runs replace stale cards
  for (const prev of listServerPipelineTasks(store, input.projectId)) {
    if (prev.kind === input.kind && prev.status !== 'RUNNING') {
      dismissServerPipelineTask(store, prev.id);
    }
  }

  const taskId = `ptask-${input.kind.toLowerCase()}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const initMsg = initialMessagesForKind(input.kind);
  const nowIso = new Date().toISOString();
  const initialLog: PipelineStageLogEntry = {
    id: `slog-${Date.now().toString(36)}-init`,
    step: 1,
    phase: 'CONTEXT',
    messageZh: initMsg.messageZh,
    messageEn: initMsg.messageEn,
    timestamp: nowIso,
  };

  const preAssignedDocId =
    input.kind === 'SRS_SYNTHESIS'
      ? input.docId || `req-doc-${project.id}-${Date.now().toString(36)}`
      : input.docId;

  const snapshot: PipelineTaskSnapshot = {
    id: taskId,
    kind: input.kind,
    projectId: project.id,
    projectName: project.name,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(preAssignedDocId ? { docId: preAssignedDocId, draftDocId: preAssignedDocId } : {}),
    ...(input.prototypeId ? { prototypeId: input.prototypeId } : {}),
    ...(input.prompt ? { prompt: input.prompt } : {}),
    status: 'RUNNING',
    step: 1,
    phase: 'CONTEXT',
    messageZh: initMsg.messageZh,
    messageEn: initMsg.messageEn,
    completedChapters: 0,
    thinkingChars: 0,
    streamedChars: 0,
    stageLogs: [initialLog],
    startedAt: Date.now(),
    targetView: targetViewForKind(input.kind),
    unreadCompletion: false,
  };

  const controller = new AbortController();
  const entry: LivePipelineTaskEntry = {
    snapshot,
    controller,
    listeners: new Set(),
    lastCheckpointAt: Date.now(),
    lastStageSignature: '1:CONTEXT::init',
    promise: Promise.resolve(snapshot),
  };

  liveMap.set(taskId, entry);
  persistSnapshotCheckpoint(store, snapshot);

  entry.promise = executeDetachedPipelineTask(store, entry, input, preAssignedDocId).finally(() => {
    // Keep finished snapshot persisted in SQLite; prune from live map after listeners close
    liveMap.delete(taskId);
  });

  return { task: entry.snapshot, reusedRunning: false };
}

async function executeDetachedPipelineTask(
  store: WorkspaceStore,
  entry: LivePipelineTaskEntry,
  input: StartPipelineTaskInput,
  preAssignedDocId?: string,
): Promise<PipelineTaskSnapshot> {
  const handleProgress = (ev: SrsSynthesisProgressEvent) => {
    const cur = entry.snapshot;
    if (cur.status !== 'RUNNING') return;

    const isThinkingPhase = Boolean(ev.thinkingDelta) && !ev.contentDelta && !cur.streamedChars;
    const signature = `${ev.step}:${ev.phase}:${ev.currentChapter ?? ''}:${isThinkingPhase ? 'thinking' : 'stream'}`;
    const stageChanged = signature !== entry.lastStageSignature;
    const { nextLogs, nextSignature } = appendOrUpdateStageLog(
      cur.stageLogs,
      {
        step: ev.step,
        phase: ev.phase,
        messageZh: ev.messageZh,
        messageEn: ev.messageEn,
      },
      signature,
      entry.lastStageSignature,
    );
    entry.lastStageSignature = nextSignature;

    const nextThinkingText =
      ev.thinkingText ??
      (ev.thinkingDelta ? `${cur.thinkingText ?? ''}${ev.thinkingDelta}` : cur.thinkingText);
    const nextStreamedText =
      ev.streamedText ??
      (ev.contentDelta ? `${cur.streamedText ?? ''}${ev.contentDelta}` : cur.streamedText);

    const updated: PipelineTaskSnapshot = {
      ...cur,
      step: ev.step,
      phase: ev.phase,
      messageZh: ev.messageZh,
      messageEn: ev.messageEn,
      ...(ev.currentChapter ? { currentChapter: ev.currentChapter } : {}),
      completedChapters: ev.completedChapters ?? cur.completedChapters,
      ...(nextThinkingText !== undefined ? { thinkingText: nextThinkingText } : {}),
      thinkingChars: ev.thinkingChars ?? nextThinkingText?.length ?? cur.thinkingChars,
      ...(nextStreamedText !== undefined ? { streamedText: nextStreamedText } : {}),
      streamedChars: ev.streamedChars ?? nextStreamedText?.length ?? cur.streamedChars,
      ...(ev.previewTail ? { previewTail: ev.previewTail } : {}),
      ...(ev.providerModel ? { providerModel: ev.providerModel } : {}),
      ...(ev.draftDocId ? { draftDocId: ev.draftDocId } : {}),
      stageLogs: nextLogs,
    };
    entry.snapshot = updated;

    const now = Date.now();
    if (stageChanged || now - entry.lastCheckpointAt >= 1200) {
      entry.lastCheckpointAt = now;
      persistSnapshotCheckpoint(store, updated);
    }

    const frame: PipelineTaskProgressFrame = {
      taskId: updated.id,
      status: updated.status,
      step: updated.step,
      phase: updated.phase,
      messageZh: updated.messageZh,
      messageEn: updated.messageEn,
      ...(updated.currentChapter ? { currentChapter: updated.currentChapter } : {}),
      completedChapters: updated.completedChapters,
      ...(ev.thinkingDelta ? { thinkingDelta: ev.thinkingDelta } : {}),
      thinkingChars: updated.thinkingChars,
      ...(ev.contentDelta ? { contentDelta: ev.contentDelta } : {}),
      ...(ev.streamedText !== undefined &&
      ev.streamedText !== `${cur.streamedText ?? ''}${ev.contentDelta ?? ''}`
        ? { replaceStreamedText: ev.streamedText }
        : {}),
      streamedChars: updated.streamedChars,
      ...(updated.previewTail ? { previewTail: updated.previewTail } : {}),
      ...(updated.providerModel ? { providerModel: updated.providerModel } : {}),
      ...(updated.draftDocId ? { draftDocId: updated.draftDocId } : {}),
      stageLogs: updated.stageLogs,
    };
    broadcastToTaskListeners(entry, 'progress', frame, false);
  };

  try {
    if (input.kind === 'SRS_SYNTHESIS') {
      const resolvedSessionId =
        input.sessionId ||
        store.listAgentSessions({ projectId: input.projectId, agentKind: 'REQUIREMENT' })[0]?.id ||
        store.listRequirementSessions(input.projectId)[0]?.id;
      if (!resolvedSessionId) {
        throw new Error('No requirement exploration session found for SRS synthesis');
      }

      const res = await synthesizeRequirementDocFromSession(store, {
        sessionId: resolvedSessionId,
        projectId: input.projectId,
        ...(preAssignedDocId ? { docId: preAssignedDocId } : {}),
        ...(input.title ? { title: input.title } : {}),
        ...(input.version ? { version: input.version } : {}),
        ...(input.resumeFromText ? { resumeFromText: input.resumeFromText } : {}),
        ...(input.locale ? { locale: input.locale } : {}),
        signal: entry.controller.signal,
        onProgress: handleProgress,
      });

      const doneMsgZh = `已生成《${res.doc.title}》(${res.doc.version})，共 ${res.doc.content.length.toLocaleString()} 字`;
      const doneMsgEn = `Generated "${res.doc.title}" (${res.doc.version}), ${res.doc.content.length.toLocaleString()} chars`;
      const { nextLogs } = appendOrUpdateStageLog(
        entry.snapshot.stageLogs,
        { step: 4, phase: 'DONE', messageZh: doneMsgZh, messageEn: doneMsgEn },
        '4:DONE:complete',
        entry.lastStageSignature,
      );

      const completed: PipelineTaskSnapshot = {
        ...entry.snapshot,
        status: 'COMPLETED',
        step: 4,
        phase: 'DONE',
        messageZh: doneMsgZh,
        messageEn: doneMsgEn,
        completedChapters: 9,
        streamedText: res.doc.content,
        streamedChars: res.doc.content.length,
        previewTail: res.doc.content.slice(-1600),
        providerModel: res.providerUsed || entry.snapshot.providerModel,
        draftDocId: res.doc.id,
        resultItemId: res.doc.id,
        stageLogs: nextLogs,
        finishedAt: Date.now(),
        unreadCompletion: true,
      };
      entry.snapshot = completed;
      persistSnapshotCheckpoint(store, completed);
      broadcastToTaskListeners(entry, 'complete', { task: completed, docId: res.doc.id }, true);
      return completed;
    }

    if (input.kind === 'PROTOTYPE_GEN') {
      const res = await generatePrototypeFromDoc(store, {
        projectId: input.projectId,
        ...(input.docId ? { docId: input.docId } : {}),
        ...(input.prompt ? { prompt: input.prompt } : {}),
        ...(input.resumeFromText ? { resumeFromText: input.resumeFromText } : {}),
        ...(input.locale ? { locale: input.locale } : {}),
        signal: entry.controller.signal,
        onProgress: handleProgress,
      });

      const doneMsgZh = `已生成交互原型《${res.prototype.name}》（自动提取 ${res.prototype.extractedScreenCount} 个业务屏幕同步至 MU 模型）`;
      const doneMsgEn = `Generated prototype "${res.prototype.name}" (${res.prototype.extractedScreenCount} screens synced to MU)`;
      const { nextLogs } = appendOrUpdateStageLog(
        entry.snapshot.stageLogs,
        { step: 4, phase: 'DONE', messageZh: doneMsgZh, messageEn: doneMsgEn },
        '4:DONE:complete',
        entry.lastStageSignature,
      );

      const completed: PipelineTaskSnapshot = {
        ...entry.snapshot,
        status: 'COMPLETED',
        step: 4,
        phase: 'DONE',
        messageZh: doneMsgZh,
        messageEn: doneMsgEn,
        streamedText: res.prototype.htmlContent,
        streamedChars: res.prototype.htmlContent.length,
        previewTail: res.prototype.htmlContent.slice(-1600),
        providerModel: res.providerUsed || entry.snapshot.providerModel,
        resultItemId: res.prototype.id,
        stageLogs: nextLogs,
        finishedAt: Date.now(),
        unreadCompletion: true,
      };
      entry.snapshot = completed;
      persistSnapshotCheckpoint(store, completed);
      broadcastToTaskListeners(
        entry,
        'complete',
        { task: completed, prototypeId: res.prototype.id },
        true,
      );
      return completed;
    }

    const res = await synthesizeOntologyFromPrototype(store, {
      projectId: input.projectId,
      ...(input.prototypeId ? { prototypeId: input.prototypeId } : {}),
      ...(input.docId ? { docId: input.docId } : {}),
      ...(input.locale ? { locale: input.locale } : {}),
      signal: entry.controller.signal,
      onProgress: handleProgress,
    });

    const doneMsgZh = `11 元模型对齐完毕（已覆盖 ${res.synthesizedModels.length}/11 个模型，一致性错误 ${res.validation.errorCount} 项）`;
    const doneMsgEn = `11-model suite synthesized (${res.synthesizedModels.length}/11 models · ${res.validation.errorCount} errors)`;
    const { nextLogs } = appendOrUpdateStageLog(
      entry.snapshot.stageLogs,
      { step: 4, phase: 'DONE', messageZh: doneMsgZh, messageEn: doneMsgEn },
      '4:DONE:complete',
      entry.lastStageSignature,
    );

    const completed: PipelineTaskSnapshot = {
      ...entry.snapshot,
      status: 'COMPLETED',
      step: 4,
      phase: 'DONE',
      messageZh: doneMsgZh,
      messageEn: doneMsgEn,
      resultItemId: res.project.id,
      stageLogs: nextLogs,
      finishedAt: Date.now(),
      unreadCompletion: true,
    };
    entry.snapshot = completed;
    persistSnapshotCheckpoint(store, completed);
    broadcastToTaskListeners(entry, 'complete', { task: completed }, true);
    return completed;
  } catch (err) {
    if (
      entry.controller.signal.aborted ||
      (err instanceof Error && err.name === 'AbortError')
    ) {
      const cancelZh = '已手动取消生成任务';
      const cancelEn = 'Generation task cancelled by user';
      const { nextLogs } = appendOrUpdateStageLog(
        entry.snapshot.stageLogs,
        { step: entry.snapshot.step, phase: 'CANCELLED', messageZh: cancelZh, messageEn: cancelEn },
        'CANCELLED',
        entry.lastStageSignature,
      );
      const cancelled: PipelineTaskSnapshot = {
        ...entry.snapshot,
        status: 'CANCELLED',
        phase: 'CANCELLED',
        messageZh: cancelZh,
        messageEn: cancelEn,
        stageLogs: nextLogs,
        finishedAt: Date.now(),
      };
      entry.snapshot = cancelled;
      persistSnapshotCheckpoint(store, cancelled);
      broadcastToTaskListeners(entry, 'cancelled', { task: cancelled }, true);
      return cancelled;
    }

    const rawMsg =
      err instanceof LlmGatewayError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);

    const preservedDraft =
      input.kind === 'SRS_SYNTHESIS' && entry.snapshot.draftDocId
        ? store.listRequirementDocs(input.projectId).find((d) => d.id === entry.snapshot.draftDocId)
        : undefined;

    const errZh = preservedDraft
      ? `${rawMsg}（已自动保留已生成的阶段草稿《${preservedDraft.title}》）`
      : rawMsg;
    const errEn = preservedDraft
      ? `${rawMsg} (Partial draft "${preservedDraft.title}" was automatically preserved)`
      : rawMsg;

    const { nextLogs } = appendOrUpdateStageLog(
      entry.snapshot.stageLogs,
      { step: entry.snapshot.step, phase: 'ERROR', messageZh: errZh, messageEn: errEn },
      'ERROR',
      entry.lastStageSignature,
    );

    const failed: PipelineTaskSnapshot = {
      ...entry.snapshot,
      status: 'ERROR',
      phase: 'ERROR',
      messageZh: errZh,
      messageEn: errEn,
      errorMessage: rawMsg,
      ...(preservedDraft ? { resultItemId: preservedDraft.id } : {}),
      stageLogs: nextLogs,
      finishedAt: Date.now(),
      unreadCompletion: true,
    };
    entry.snapshot = failed;
    persistSnapshotCheckpoint(store, failed);
    broadcastToTaskListeners(entry, 'run_error', { task: failed, message: rawMsg }, true);
    return failed;
  }
}

export function cancelServerPipelineTask(
  store: WorkspaceStore,
  taskId: string,
): PipelineTaskSnapshot | undefined {
  const live = getStoreTaskMap(store).get(taskId);
  if (live) {
    live.controller.abort();
    const cancelZh = '已手动取消生成任务';
    const cancelEn = 'Generation task cancelled by user';
    const { nextLogs } = appendOrUpdateStageLog(
      live.snapshot.stageLogs,
      { step: live.snapshot.step, phase: 'CANCELLED', messageZh: cancelZh, messageEn: cancelEn },
      'CANCELLED',
      live.lastStageSignature,
    );
    live.snapshot = {
      ...live.snapshot,
      status: 'CANCELLED',
      phase: 'CANCELLED',
      messageZh: cancelZh,
      messageEn: cancelEn,
      stageLogs: nextLogs,
      finishedAt: Date.now(),
    };
    persistSnapshotCheckpoint(store, live.snapshot);
    broadcastToTaskListeners(live, 'cancelled', { task: live.snapshot }, true);
    return live.snapshot;
  }
  const existing = getServerPipelineTask(store, taskId);
  if (!existing) return undefined;
  if (existing.status === 'RUNNING') {
    const cancelled: PipelineTaskSnapshot = {
      ...existing,
      status: 'CANCELLED',
      phase: 'CANCELLED',
      messageZh: '已手动取消生成任务',
      messageEn: 'Generation task cancelled by user',
      finishedAt: Date.now(),
    };
    persistSnapshotCheckpoint(store, cancelled);
    return cancelled;
  }
  return existing;
}

export function dismissServerPipelineTask(
  store: WorkspaceStore,
  taskId: string,
): PipelineTaskSnapshot | undefined {
  const live = getStoreTaskMap(store).get(taskId);
  if (live && live.snapshot.status === 'RUNNING') {
    // Do not dismiss an actively running task without explicit cancel
    return live.snapshot;
  }
  const existing = getServerPipelineTask(store, taskId);
  if (!existing) return undefined;
  const updated: PipelineTaskSnapshot = {
    ...existing,
    dismissed: true,
    unreadCompletion: false,
  };
  persistSnapshotCheckpoint(store, updated);
  return updated;
}

export function markServerPipelineTaskRead(
  store: WorkspaceStore,
  taskId: string,
): PipelineTaskSnapshot | undefined {
  const live = getStoreTaskMap(store).get(taskId);
  if (live) {
    live.snapshot = { ...live.snapshot, unreadCompletion: false };
    persistSnapshotCheckpoint(store, live.snapshot);
    return live.snapshot;
  }
  const existing = getServerPipelineTask(store, taskId);
  if (!existing) return undefined;
  const updated: PipelineTaskSnapshot = {
    ...existing,
    unreadCompletion: false,
  };
  persistSnapshotCheckpoint(store, updated);
  return updated;
}

/**
 * Resume an interrupted or failed pipeline task from its persisted SQLite `streamedText` checkpoint
 * instead of regenerating from character 0. Falls back to a clean restart if < 200 chars were saved.
 */
export function resumeServerPipelineTask(
  store: WorkspaceStore,
  taskId: string,
  locale?: AgentLocale | string,
): { task: PipelineTaskSnapshot; reusedRunning: boolean } | undefined {
  const liveMap = getStoreTaskMap(store);
  const alreadyLive = liveMap.get(taskId);
  if (alreadyLive && alreadyLive.snapshot.status === 'RUNNING') {
    return { task: alreadyLive.snapshot, reusedRunning: true };
  }

  let stored: PipelineTaskSnapshot | undefined;
  if (typeof store.loadAgentCheckpoint === 'function') {
    const row = store.loadAgentCheckpoint(taskId);
    if (row && row.workflow === PIPELINE_WORKFLOW_KEY) {
      try {
        stored = JSON.parse(row.stateJson) as PipelineTaskSnapshot;
      } catch {
        stored = undefined;
      }
    }
  }
  if (!stored) return undefined;

  // If another task of the same kind in the same project is already RUNNING, attach to it
  for (const existing of liveMap.values()) {
    if (
      existing.snapshot.projectId === stored.projectId &&
      existing.snapshot.kind === stored.kind &&
      existing.snapshot.status === 'RUNNING'
    ) {
      return { task: existing.snapshot, reusedRunning: true };
    }
  }

  const savedPrefix = stored.streamedText ?? '';
  const canContinueFromPrefix =
    savedPrefix.trim().length >= 200 &&
    (stored.kind === 'SRS_SYNTHESIS' || stored.kind === 'PROTOTYPE_GEN');

  if (!canContinueFromPrefix) {
    return startServerPipelineTask(store, {
      kind: stored.kind,
      projectId: stored.projectId,
      ...(stored.sessionId ? { sessionId: stored.sessionId } : {}),
      ...(stored.docId ? { docId: stored.docId } : {}),
      ...(stored.prototypeId ? { prototypeId: stored.prototypeId } : {}),
      ...(stored.prompt ? { prompt: stored.prompt } : {}),
      ...(locale ? { locale } : {}),
    });
  }

  const resumeMsgZh = `已从断点（已保存 ${savedPrefix.length.toLocaleString()} 字）恢复后台任务，正在无缝续写剩余内容…`;
  const resumeMsgEn = `Resumed from checkpoint (${savedPrefix.length.toLocaleString()} chars preserved); continuing live stream…`;
  const { nextLogs, nextSignature } = appendOrUpdateStageLog(
    stored.stageLogs ?? [],
    {
      step: 3,
      phase: 'GENERATING',
      messageZh: resumeMsgZh,
      messageEn: resumeMsgEn,
    },
    `3:GENERATING:resume-${Date.now().toString(36)}`,
    '',
  );

  const resumedSnapshot: PipelineTaskSnapshot = {
    ...stored,
    status: 'RUNNING',
    step: 3,
    phase: 'GENERATING',
    messageZh: resumeMsgZh,
    messageEn: resumeMsgEn,
    streamedText: savedPrefix,
    streamedChars: savedPrefix.length,
    previewTail: savedPrefix.slice(-1600),
    stageLogs: nextLogs,
    unreadCompletion: false,
    dismissed: false,
  };
  delete resumedSnapshot.finishedAt;
  delete resumedSnapshot.errorMessage;

  const controller = new AbortController();
  const entry: LivePipelineTaskEntry = {
    snapshot: resumedSnapshot,
    controller,
    listeners: new Set(),
    lastCheckpointAt: Date.now(),
    lastStageSignature: nextSignature,
    promise: Promise.resolve(resumedSnapshot),
  };

  liveMap.set(resumedSnapshot.id, entry);
  persistSnapshotCheckpoint(store, resumedSnapshot);

  const taskInput: StartPipelineTaskInput = {
    kind: resumedSnapshot.kind,
    projectId: resumedSnapshot.projectId,
    ...(resumedSnapshot.sessionId ? { sessionId: resumedSnapshot.sessionId } : {}),
    ...(resumedSnapshot.docId ? { docId: resumedSnapshot.docId } : {}),
    ...(resumedSnapshot.prototypeId ? { prototypeId: resumedSnapshot.prototypeId } : {}),
    ...(resumedSnapshot.prompt ? { prompt: resumedSnapshot.prompt } : {}),
    resumeFromText: savedPrefix,
    ...(locale ? { locale } : {}),
  };

  entry.promise = executeDetachedPipelineTask(
    store,
    entry,
    taskInput,
    resumedSnapshot.draftDocId || resumedSnapshot.docId,
  ).finally(() => {
    liveMap.delete(resumedSnapshot.id);
  });

  return { task: entry.snapshot, reusedRunning: false };
}

/**
 * Flush all in-flight pipeline snapshots to SQLite synchronously (e.g. on SIGTERM / SIGINT before hot reload)
 * so zero streamed bytes are lost across process restarts.
 */
export function flushRunningPipelineCheckpoints(store: WorkspaceStore): number {
  const liveMap = getStoreTaskMap(store);
  let count = 0;
  for (const entry of liveMap.values()) {
    if (entry.snapshot.status === 'RUNNING') {
      persistSnapshotCheckpoint(store, entry.snapshot);
      count += 1;
    }
  }
  return count;
}

/**
 * Automatically resume any recently active RUNNING pipeline checkpoints on server boot
 * so `tsx watch` hot-reloads or server restarts never drop an in-flight SRS / Prototype generation.
 */
export function autoResumeInterruptedPipelineTasks(
  store: WorkspaceStore,
  maxAgeMs = 30 * 60 * 1000,
): PipelineTaskSnapshot[] {
  if (typeof store.listAgentCheckpoints !== 'function') return [];
  const liveMap = getStoreTaskMap(store);
  const resumed: PipelineTaskSnapshot[] = [];
  const now = Date.now();

  for (const row of store.listAgentCheckpoints(PIPELINE_WORKFLOW_KEY)) {
    try {
      const parsed = JSON.parse(row.stateJson) as PipelineTaskSnapshot;
      if (!parsed?.id || parsed.dismissed) continue;
      if (liveMap.has(parsed.id)) continue;
      const updatedMs = row.updatedAt ? Date.parse(row.updatedAt) : parsed.startedAt;
      const ageMs = Number.isFinite(updatedMs) ? now - updatedMs : now - parsed.startedAt;
      if (parsed.status === 'RUNNING' && ageMs <= maxAgeMs) {
        const res = resumeServerPipelineTask(store, parsed.id);
        if (res) {
          resumed.push(res.task);
        }
      }
    } catch {
      // Ignore malformed checkpoint entries
    }
  }

  return resumed;
}

export function createPipelineTaskSseStream(
  store: WorkspaceStore,
  taskId: string,
  reqSignal?: AbortSignal,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let streamClosed = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
      let attachedEntry: LivePipelineTaskEntry | undefined;
      let listenerObj: TaskSseListener | undefined;

      const cleanup = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = undefined;
        }
        if (attachedEntry && listenerObj) {
          attachedEntry.listeners.delete(listenerObj);
        }
        if (!streamClosed) {
          streamClosed = true;
          try {
            controller.close();
          } catch {
            // Ignore already-closed stream
          }
        }
      };

      const sendRaw = (chunk: string) => {
        if (streamClosed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      const sendEvent = (eventName: string, payload: unknown) => {
        sendRaw(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
      };

      const live = getStoreTaskMap(store).get(taskId);
      const snapshot = live?.snapshot ?? getServerPipelineTask(store, taskId);

      if (!snapshot) {
        sendEvent('run_error', { message: `Pipeline task not found: ${taskId}` });
        cleanup();
        return;
      }

      // Immediately hydrate subscriber with full snapshot (stageLogs + thinkingText + streamedText)
      sendEvent('snapshot', { task: snapshot });

      if (!live || snapshot.status !== 'RUNNING') {
        if (snapshot.status === 'COMPLETED') {
          sendEvent('complete', { task: snapshot, resultItemId: snapshot.resultItemId });
        } else if (snapshot.status === 'CANCELLED') {
          sendEvent('cancelled', { task: snapshot });
        } else {
          sendEvent('run_error', {
            task: snapshot,
            message: snapshot.errorMessage || snapshot.messageZh,
          });
        }
        cleanup();
        return;
      }

      attachedEntry = live;
      listenerObj = {
        send: sendEvent,
        close: cleanup,
      };
      live.listeners.add(listenerObj);

      // Keepalive comment frame every 12s prevents Vite / proxy / browser idle socket drops
      heartbeatTimer = setInterval(() => {
        sendRaw(': keepalive\n\n');
      }, 12_000);

      // IMPORTANT: Client disconnect ONLY detaches this SSE observer — NEVER aborts the background task!
      reqSignal?.addEventListener('abort', cleanup, { once: true });
    },
  });
}
