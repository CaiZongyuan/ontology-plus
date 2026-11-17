import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspaceStore } from '../../workspace-store/index.js';
import {
  type AgentRunEndEvent,
  type AgentRunStartEvent,
  collectUnifiedAgentTurn,
  deriveProjectStepForSessionKind,
  ensurePrototypeCoDesignSession,
  findSessionAgentRun,
  getLiveAgentSessionStatus,
  listSessionAgentRuns,
  registerAgentRunLifecycleHooks,
} from '../index.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('Agent Run persistent runId & ProjectStep derivation', () => {
  it('maps every AgentSessionKind deterministically to its ProjectStep or null', () => {
    expect(deriveProjectStepForSessionKind('REQUIREMENT')).toBe('REQUIREMENTS');
    expect(deriveProjectStepForSessionKind('PROTOTYPE_CO_DESIGN')).toBe('PROTOTYPE');
    expect(deriveProjectStepForSessionKind('COPILOT')).toBe('BUSINESS_MODEL');
    expect(deriveProjectStepForSessionKind('ARCHITECTURE')).toBe('DELIVERY');
    expect(deriveProjectStepForSessionKind('CODING')).toBe('DELIVERY');
    expect(deriveProjectStepForSessionKind('CAPABILITY')).toBeNull();
    expect(deriveProjectStepForSessionKind('REASONING')).toBeNull();
  });

  it('persists deterministic runId on session messages, emits it in SSE events, and recovers it after reloading SQLite', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onto-run-id-'));
    tempDirs.push(tmpDir);
    const dbPath = path.join(tmpDir, 'workspace.db');

    const store1 = createWorkspaceStore({ dbPath, enableFileMirror: false });
    store1.updateSystemSettings({ mockLlmMode: true });

    const session = store1.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'COPILOT',
      title: 'Persistent Run ID Test',
    });

    const turn = await collectUnifiedAgentTurn(store1, {
      sessionId: session.id,
      prompt: '请新增一条高风险合同履约保证金校验规则',
      mockMode: true,
    });

    const userMsg = turn.session.messages.find((m) => m.role === 'user')!;
    const assistantMsg = turn.session.messages.find((m) => m.role === 'assistant')!;
    expect(userMsg).toBeDefined();
    expect(assistantMsg).toBeDefined();
    expect(userMsg.runId).toBe(userMsg.id);
    expect(assistantMsg.runId).toBe(userMsg.id);

    const expectedRunId = userMsg.id;

    const metaEvt = turn.events.find((e) => e.event === 'session_meta');
    const endEvt = turn.events.find((e) => e.event === 'message_end');
    expect(metaEvt?.data.runId).toBe(expectedRunId);
    expect(endEvt?.data.runId).toBe(expectedRunId);

    store1.close();

    // Reopen a fresh store on the same SQLite database file and recover the run record
    const store2 = createWorkspaceStore({ dbPath, enableFileMirror: false });
    try {
      const reloadedSession = store2.getAgentSession(session.id)!;
      expect(reloadedSession).toBeDefined();

      const runs = listSessionAgentRuns(reloadedSession);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        runId: expectedRunId,
        sessionId: session.id,
        projectId: 'proj-contract',
        sessionKind: 'COPILOT',
        projectStep: 'BUSINESS_MODEL',
        outcome: 'COMPLETED',
      });
      expect(runs[0]!.userMessage?.id).toBe(expectedRunId);
      expect(runs[0]!.assistantMessage?.id).toBe(assistantMsg.id);
      expect(findSessionAgentRun(reloadedSession, expectedRunId)).toEqual(runs[0]);
    } finally {
      store2.close();
    }
  });

  it('aligns ActiveBackgroundSessionRun.runId, PrototypeRevision.agentRunId, onRunStart, and onRunEnd on the same persistent runId', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });

    const createdProto = store.createPrototype('proj-contract', {
      name: '合同台账交互原型',
      htmlContent:
        '<!doctype html><html><body><section data-screen-id="SCR-LIST" data-screen-name="合同列表"><button data-element-id="EL-NEW" data-element-type="BUTTON" data-element-label="新建合同">新建合同</button></section></body></html>',
      source: 'GENERATED',
    });
    const session = ensurePrototypeCoDesignSession(
      store,
      'proj-contract',
      createdProto.prototype.id,
    );

    const startEvents: AgentRunStartEvent[] = [];
    const endEvents: AgentRunEndEvent[] = [];
    let liveRunIdAtStart: string | undefined;
    let revisionCountAtStart = -1;
    let revisionCountAtEnd = -1;

    const unregister = registerAgentRunLifecycleHooks(store, {
      onRunStart: (ev) => {
        startEvents.push(ev);
        liveRunIdAtStart = getLiveAgentSessionStatus(store, session.id).runId;
        revisionCountAtStart = store.getPrototype(createdProto.prototype.id)!.revisions.length;
      },
      onRunEnd: (ev) => {
        endEvents.push(ev);
        revisionCountAtEnd = store.getPrototype(createdProto.prototype.id)!.revisions.length;
      },
    });

    const turn = await collectUnifiedAgentTurn(store, {
      sessionId: session.id,
      prompt: '请在顶部新增一个批量导出按钮',
      mockMode: true,
    });

    expect(startEvents).toHaveLength(1);
    expect(endEvents).toHaveLength(1);

    const runId = startEvents[0]!.runId;
    expect(liveRunIdAtStart).toBe(runId);
    expect(revisionCountAtStart).toBe(1);
    expect(revisionCountAtEnd).toBe(2);

    expect(startEvents[0]).toMatchObject({
      runId,
      sessionId: session.id,
      projectId: 'proj-contract',
      sessionKind: 'PROTOTYPE_CO_DESIGN',
      projectStep: 'PROTOTYPE',
      targetId: createdProto.prototype.id,
    });
    expect(endEvents[0]).toMatchObject({
      runId,
      sessionId: session.id,
      projectId: 'proj-contract',
      sessionKind: 'PROTOTYPE_CO_DESIGN',
      projectStep: 'PROTOTYPE',
      outcome: 'COMPLETED',
    });

    const updatedProto = store.getPrototype(createdProto.prototype.id)!;
    const latestRevision = updatedProto.revisions.at(-1)!;
    expect(latestRevision.agentRunId).toBe(runId);

    const assistantMsg = turn.session.messages.find((m) => m.role === 'assistant')!;
    expect(endEvents[0]!.assistantMessageId).toBe(assistantMsg.id);

    // Unregistering stops subsequent hook deliveries
    unregister();
    await collectUnifiedAgentTurn(store, {
      sessionId: session.id,
      prompt: '再增加一个筛选框',
      mockMode: true,
    });
    expect(startEvents).toHaveLength(1);
    expect(endEvents).toHaveLength(1);
  });
});
