import http from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  createWorkspaceStore,
  type SuiteCommitEvent,
} from '../packages/workspace-store/index.js';
import {
  type AgentRunEndEvent,
  type AgentRunStartEvent,
  findSessionAgentRun,
  listSessionAgentRuns,
} from '../packages/agent-runtime/index.js';
import { createApiApp } from './app.js';

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('HTTP Agent Run lifecycle hooks & persistent runId', () => {
  it('invokes onRunStart before SRS and OntologySuite mutations and onRunEnd after persistence with projectId, sessionKind, and projectStep', async () => {
    const timeline: string[] = [];
    const startEvents: AgentRunStartEvent[] = [];
    const endEvents: AgentRunEndEvent[] = [];
    const suiteCommits: SuiteCommitEvent[] = [];

    const store = createWorkspaceStore({
      dbPath: ':memory:',
      enableFileMirror: false,
      onSuiteCommit: (commit) => {
        suiteCommits.push(commit);
        if (commit.source.kind === 'AGENT_RUN') {
          timeline.push(`suite_commit:${commit.source.toolName}:${commit.source.runId}`);
        }
      },
    });
    store.updateSystemSettings({ mockLlmMode: true });

    let docsCountAtSrsStart = -1;
    let docsCountAtSrsEnd = -1;
    let rulesCountAtCopilotStart = -1;
    let rulesCountAtCopilotEnd = -1;

    const api = createApiApp(store, {
      agentRunHooks: {
        onRunStart: (ev) => {
          startEvents.push(ev);
          timeline.push(`run_start:${ev.sessionKind}:${ev.runId}`);
          // User message with persistent runId is already stored when onRunStart runs
          const storedSession = store.getAgentSession(ev.sessionId)!;
          expect(storedSession.messages.some((m) => m.role === 'user' && m.id === ev.runId && m.runId === ev.runId)).toBe(true);
          if (ev.sessionKind === 'REQUIREMENT' && ev.projectId) {
            docsCountAtSrsStart = store.listRequirementDocs(ev.projectId).length;
          }
          if (ev.sessionKind === 'COPILOT' && ev.projectId) {
            rulesCountAtCopilotStart = store.getProject(ev.projectId)!.suite.M3?.rules.length ?? 0;
          }
        },
        onRunEnd: (ev) => {
          endEvents.push(ev);
          timeline.push(`run_end:${ev.sessionKind}:${ev.outcome}:${ev.runId}`);
          if (ev.sessionKind === 'REQUIREMENT' && ev.projectId) {
            docsCountAtSrsEnd = store.listRequirementDocs(ev.projectId).length;
          }
          if (ev.sessionKind === 'COPILOT' && ev.projectId) {
            rulesCountAtCopilotEnd = store.getProject(ev.projectId)!.suite.M3?.rules.length ?? 0;
          }
        },
      },
    });

    // 1. REQUIREMENT session synthesizing a new SRS document
    const emptyProj = store.createProject({
      name: '冷链质检管理',
      code: 'COLD_QA',
      domain: '冷链医药',
      template: 'EMPTY',
    });
    const reqSessRes = await api.request(
      '/api/agent-sessions',
      jsonInit('POST', { projectId: emptyProj.id, agentKind: 'REQUIREMENT' }),
    );
    const { session: reqSess } = (await reqSessRes.json()) as { session: { id: string } };

    const srsStreamRes = await api.request(
      `/api/agent-sessions/${reqSess.id}/stream`,
      jsonInit('POST', {
        prompt: '[ACTION:SYNTHESIZE_SRS {}]\n请合成九章节软件需求规格说明书',
        mockMode: true,
      }),
    );
    expect(srsStreamRes.status).toBe(200);
    expect(await srsStreamRes.text()).toContain('event: message_end');

    expect(docsCountAtSrsStart).toBe(0);
    expect(docsCountAtSrsEnd).toBe(1);
    expect(startEvents[0]).toMatchObject({
      sessionId: reqSess.id,
      projectId: emptyProj.id,
      sessionKind: 'REQUIREMENT',
      projectStep: 'REQUIREMENTS',
    });
    expect(endEvents[0]).toMatchObject({
      runId: startEvents[0]!.runId,
      sessionId: reqSess.id,
      projectId: emptyProj.id,
      sessionKind: 'REQUIREMENT',
      projectStep: 'REQUIREMENTS',
      outcome: 'COMPLETED',
    });

    // 2. COPILOT session mutating OntologySuite
    const copSessRes = await api.request(
      '/api/agent-sessions',
      jsonInit('POST', { projectId: 'proj-contract', agentKind: 'COPILOT' }),
    );
    const { session: copSess } = (await copSessRes.json()) as { session: { id: string } };

    const baselineRules = store.getProject('proj-contract')!.suite.M3!.rules.length;
    const copStreamRes = await api.request(
      `/api/agent-sessions/${copSess.id}/stream`,
      jsonInit('POST', {
        prompt: '请新增一条高金额海外合同合规双签规则',
        mockMode: true,
      }),
    );
    expect(copStreamRes.status).toBe(200);
    expect(await copStreamRes.text()).toContain('event: message_end');

    const copRunId = startEvents[1]!.runId;
    expect(rulesCountAtCopilotStart).toBe(baselineRules);
    expect(rulesCountAtCopilotEnd).toBe(baselineRules + 1);
    expect(suiteCommits).toHaveLength(1);
    expect(timeline).toEqual([
      `run_start:REQUIREMENT:${startEvents[0]!.runId}`,
      `run_end:REQUIREMENT:COMPLETED:${startEvents[0]!.runId}`,
      `run_start:COPILOT:${copRunId}`,
      `suite_commit:upsert_rule:${copRunId}`,
      `run_end:COPILOT:COMPLETED:${copRunId}`,
    ]);

    const storedCopSession = store.getAgentSession(copSess.id)!;
    const recoveredRun = findSessionAgentRun(storedCopSession, copRunId);
    expect(recoveredRun).toMatchObject({
      runId: copRunId,
      sessionId: copSess.id,
      projectId: 'proj-contract',
      sessionKind: 'COPILOT',
      projectStep: 'BUSINESS_MODEL',
      outcome: 'COMPLETED',
    });
  });

  it('attributes multiple ontology tool calls within a single Agent Run (parallel and multi-round) to the exact same persistent runId', async () => {
    let llmCallIndex = 0;
    const server = http.createServer(async (req, res) => {
      let rawBody = '';
      for await (const chunk of req) rawBody += String(chunk);

      if (req.url?.endsWith('/chat/completions')) {
        llmCallIndex += 1;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        });

        if (llmCallIndex === 1) {
          // Step 1: two parallel ontology mutations in a single assistant response
          res.write(
            `data: ${JSON.stringify({
              id: 'chatcmpl-multi-1',
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: 'multi-tool-model',
              choices: [
                {
                  index: 0,
                  delta: {
                    role: 'assistant',
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_onto_agg_1',
                        type: 'function',
                        function: {
                          name: 'upsert_aggregate',
                          arguments: JSON.stringify({
                            id: 'AGG-BOND-99',
                            name: 'GuaranteeBond',
                            alias: '履约保函',
                            description: '大额合同银行履约保函对象',
                          }),
                        },
                      },
                      {
                        index: 1,
                        id: 'call_onto_rule_2',
                        type: 'function',
                        function: {
                          name: 'upsert_rule',
                          arguments: JSON.stringify({
                            id: 'RULE-BOND-99',
                            name: 'GuaranteeBondAmountRule',
                            alias: '履约保函足额覆盖校验',
                            ruleType: 'VALIDATION',
                            referencedObjects: ['GuaranteeBond'],
                            expression: 'GuaranteeBond.id != null',
                            violationMessage: '履约保函未足额覆盖合同金额',
                          }),
                        },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
            })}\n\n`,
          );
          res.end('data: [DONE]\n\n');
          return;
        }

        if (llmCallIndex === 2) {
          // Step 2: a third ontology mutation referencing the newly added aggregate & rule
          res.write(
            `data: ${JSON.stringify({
              id: 'chatcmpl-multi-2',
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: 'multi-tool-model',
              choices: [
                {
                  index: 0,
                  delta: {
                    role: 'assistant',
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_onto_bhv_3',
                        type: 'function',
                        function: {
                          name: 'upsert_behavior',
                          arguments: JSON.stringify({
                            id: 'BHV-BOND-99',
                            name: 'registerGuaranteeBond',
                            alias: '登记履约保函',
                            ownerEntity: 'GuaranteeBond',
                            behaviorType: 'COMMAND',
                            triggerType: 'USER_ACTION',
                            invokedRules: ['RULE-BOND-99'],
                          }),
                        },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
            })}\n\n`,
          );
          res.end('data: [DONE]\n\n');
          return;
        }

        // Step 3: final summary text
        res.write(
          `data: ${JSON.stringify({
            id: 'chatcmpl-multi-3',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'multi-tool-model',
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  content: '已完成「履约保函」业务对象、足额校验规则及登记操作的联动建模。',
                },
                finish_reason: 'stop',
              },
            ],
          })}\n\n`,
        );
        res.end('data: [DONE]\n\n');
        return;
      }

      void rawBody;
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };

    try {
      const timeline: string[] = [];
      const commits: SuiteCommitEvent[] = [];
      const startEvents: AgentRunStartEvent[] = [];
      const endEvents: AgentRunEndEvent[] = [];

      const store = createWorkspaceStore({
        dbPath: ':memory:',
        enableFileMirror: false,
        onSuiteCommit: (ev) => {
          commits.push(ev);
          if (ev.source.kind === 'AGENT_RUN') {
            timeline.push(`commit:${ev.source.toolName}:${ev.source.runId}`);
          }
        },
      });
      store.updateSystemSettings({ mockLlmMode: false });
      for (const p of store.listLlmProviders()) {
        store.saveLlmProvider({ ...p, enabled: false });
      }
      store.saveLlmProvider({
        id: 'llm-multi-onto',
        name: 'Multi-Tool Ontology Gateway',
        providerType: 'OPENAI_COMPATIBLE',
        baseUrl: `http://127.0.0.1:${addr.port}/v1`,
        apiKey: 'test-key',
        defaultModel: 'multi-tool-model',
        availableModels: ['multi-tool-model'],
        enabled: true,
      });

      const api = createApiApp(store, {
        agentRunHooks: {
          onRunStart: (ev) => {
            startEvents.push(ev);
            timeline.push(`start:${ev.runId}`);
          },
          onRunEnd: (ev) => {
            endEvents.push(ev);
            timeline.push(`end:${ev.outcome}:${ev.runId}`);
          },
        },
      });

      const createRes = await api.request(
        '/api/agent-sessions',
        jsonInit('POST', { projectId: 'proj-contract', agentKind: 'COPILOT' }),
      );
      const { session } = (await createRes.json()) as { session: { id: string } };

      const streamRes = await api.request(
        `/api/agent-sessions/${session.id}/stream`,
        jsonInit('POST', {
          prompt: '请新增履约保函对象、足额覆盖规则与登记履约保函操作',
          mockMode: false,
        }),
      );
      expect(streamRes.status).toBe(200);
      const sseText = await streamRes.text();
      expect(sseText).toContain('event: message_end');

      expect(startEvents).toHaveLength(1);
      expect(endEvents).toHaveLength(1);
      const runId = startEvents[0]!.runId;

      expect(commits).toHaveLength(3);
      for (const commit of commits) {
        expect(commit.source).toMatchObject({
          kind: 'AGENT_RUN',
          runId,
          sessionId: session.id,
        });
      }

      expect(timeline).toEqual([
        `start:${runId}`,
        `commit:upsert_aggregate:${runId}`,
        `commit:upsert_rule:${runId}`,
        `commit:upsert_behavior:${runId}`,
        `end:COMPLETED:${runId}`,
      ]);

      const updatedProject = store.getProject('proj-contract')!;
      expect(updatedProject.validation.errorCount).toBe(0);
      expect(updatedProject.suite.M1?.aggregates.some((a) => a.id === 'AGG-BOND-99')).toBe(true);
      expect(updatedProject.suite.M3?.rules.some((r) => r.id === 'RULE-BOND-99')).toBe(true);
      expect(updatedProject.suite.M2?.behaviors.some((b) => b.id === 'BHV-BOND-99')).toBe(true);

      const savedSession = store.getAgentSession(session.id)!;
      const runs = listSessionAgentRuns(savedSession);
      expect(runs).toHaveLength(1);
      expect(runs[0]?.runId).toBe(runId);
      expect(runs[0]?.assistantMessage?.toolCalls).toHaveLength(3);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('tracks AWAITING_USER on ask_user pause and assigns a distinct persistent runId on askUserAnswer continuation, plus null projectStep on CAPABILITY/REASONING', async () => {
    const startEvents: AgentRunStartEvent[] = [];
    const endEvents: AgentRunEndEvent[] = [];

    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });

    const api = createApiApp(store, {
      agentRunHooks: {
        onRunStart: (ev) => {
          startEvents.push(ev);
        },
        onRunEnd: (ev) => {
          endEvents.push(ev);
        },
      },
    });

    // 1. REQUIREMENT session pausing on ask_user, then continuing via askUserAnswer
    const reqCreate = await api.request(
      '/api/agent-sessions',
      jsonInit('POST', { projectId: 'proj-contract', agentKind: 'REQUIREMENT' }),
    );
    const { session: reqSession } = (await reqCreate.json()) as { session: { id: string } };

    const turn1Res = await api.request(
      `/api/agent-sessions/${reqSession.id}/stream`,
      jsonInit('POST', {
        prompt: '审批超时后我不确定哪种方案更好，请给我几个选项',
        mockMode: true,
      }),
    );
    expect(turn1Res.status).toBe(200);
    expect(await turn1Res.text()).toContain('event: ask_user');

    expect(endEvents[0]).toMatchObject({
      runId: startEvents[0]!.runId,
      sessionId: reqSession.id,
      projectId: 'proj-contract',
      sessionKind: 'REQUIREMENT',
      projectStep: 'REQUIREMENTS',
      outcome: 'AWAITING_USER',
    });

    const afterTurn1 = store.getAgentSession(reqSession.id)!;
    expect(afterTurn1.status).toBe('WAITING_INPUT');
    const askPromptId = afterTurn1.messages.find((m) => m.askUser)?.askUser?.id;
    expect(askPromptId).toBeTruthy();
    expect(listSessionAgentRuns(afterTurn1)[0]?.outcome).toBe('AWAITING_USER');

    const turn2Res = await api.request(
      `/api/agent-sessions/${reqSession.id}/stream`,
      jsonInit('POST', {
        askUserAnswer: {
          promptId: askPromptId!,
          selectedAnswers: ['进入 M6 特批会签流：保留草稿并自动升级至法务与财务总监双签'],
        },
        mockMode: true,
      }),
    );
    expect(turn2Res.status).toBe(200);
    expect(await turn2Res.text()).toContain('event: message_end');

    expect(startEvents[1]!.runId).not.toBe(startEvents[0]!.runId);
    expect(endEvents[1]).toMatchObject({
      runId: startEvents[1]!.runId,
      sessionId: reqSession.id,
      projectId: 'proj-contract',
      sessionKind: 'REQUIREMENT',
      projectStep: 'REQUIREMENTS',
      outcome: 'COMPLETED',
    });

    const recoveredRuns = listSessionAgentRuns(store.getAgentSession(reqSession.id)!);
    expect(recoveredRuns.map((r) => r.runId)).toEqual([
      startEvents[0]!.runId,
      startEvents[1]!.runId,
    ]);

    // 2. Non-step REASONING session maps projectStep to null
    const reasCreate = await api.request(
      '/api/agent-sessions',
      jsonInit('POST', { projectId: 'proj-contract', agentKind: 'REASONING' }),
    );
    const { session: reasSession } = (await reasCreate.json()) as { session: { id: string } };
    const reasRes = await api.request(
      `/api/agent-sessions/${reasSession.id}/stream`,
      jsonInit('POST', { prompt: '统计当前合同履约状态分布', mockMode: true }),
    );
    expect(reasRes.status).toBe(200);
    await reasRes.text();
    expect(endEvents[2]).toMatchObject({
      sessionId: reasSession.id,
      projectId: 'proj-contract',
      sessionKind: 'REASONING',
      projectStep: null,
      outcome: 'COMPLETED',
    });
  });

  it('fires onRunEnd with accurate FAILED and ABORTED outcomes and keeps /status and /abort runId identical', async () => {
    const server = http.createServer(async (req, res) => {
      if (req.url?.endsWith('/chat/completions')) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        });
        await new Promise((r) => setTimeout(r, 800));
        if (!res.destroyed) {
          res.end('data: [DONE]\n\n');
        }
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };

    try {
      const startEvents: AgentRunStartEvent[] = [];
      const endEvents: AgentRunEndEvent[] = [];

      const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
      store.updateSystemSettings({ mockLlmMode: false });
      for (const p of store.listLlmProviders()) {
        store.saveLlmProvider({ ...p, enabled: false });
      }

      const api = createApiApp(store, {
        agentRunHooks: {
          onRunStart: (ev) => {
            startEvents.push(ev);
          },
          onRunEnd: (ev) => {
            endEvents.push(ev);
          },
        },
      });

      // 1. FAILED run when no LLM gateway is enabled in live mode
      const failCreate = await api.request(
        '/api/agent-sessions',
        jsonInit('POST', { projectId: 'proj-contract', agentKind: 'COPILOT' }),
      );
      const { session: failSess } = (await failCreate.json()) as { session: { id: string } };

      const failStreamRes = await api.request(
        `/api/agent-sessions/${failSess.id}/stream`,
        jsonInit('POST', { prompt: '新增一条合同校验规则', mockMode: false }),
      );
      expect(failStreamRes.status).toBe(200);
      const failSse = await failStreamRes.text();
      expect(failSse).toContain('event: run_error');

      expect(startEvents).toHaveLength(1);
      expect(endEvents).toHaveLength(1);
      const failRunId = startEvents[0]!.runId;
      expect(endEvents[0]).toMatchObject({
        runId: failRunId,
        sessionId: failSess.id,
        projectId: 'proj-contract',
        sessionKind: 'COPILOT',
        projectStep: 'BUSINESS_MODEL',
        outcome: 'FAILED',
      });
      expect(endEvents[0]!.error?.code).toBeTruthy();

      const storedFailSess = store.getAgentSession(failSess.id)!;
      const errAssistant = storedFailSess.messages.find((m) => m.role === 'assistant')!;
      expect(errAssistant.runId).toBe(failRunId);
      expect(endEvents[0]!.assistantMessageId).toBe(errAssistant.id);
      expect(findSessionAgentRun(storedFailSess, failRunId)?.outcome).toBe('FAILED');

      // 2. ABORTED run while streaming against slow local gateway
      store.saveLlmProvider({
        id: 'llm-slow-abort',
        name: 'Slow Abort Gateway',
        providerType: 'OPENAI_COMPATIBLE',
        baseUrl: `http://127.0.0.1:${addr.port}/v1`,
        apiKey: 'test-key',
        defaultModel: 'slow-model',
        availableModels: ['slow-model'],
        enabled: true,
      });

      const abortCreate = await api.request(
        '/api/agent-sessions',
        jsonInit('POST', { projectId: 'proj-contract', agentKind: 'ARCHITECTURE' }),
      );
      const { session: abortSess } = (await abortCreate.json()) as { session: { id: string } };

      const abortStreamPromise = api.request(
        `/api/agent-sessions/${abortSess.id}/stream`,
        jsonInit('POST', { prompt: '审阅仓库架构标准', mockMode: false }),
      );

      // Wait briefly until session_meta is buffered and activeRun is live
      let liveRunId: string | undefined;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const statusRes = await api.request(`/api/agent-sessions/${abortSess.id}/status`);
        const statusJson = (await statusRes.json()) as {
          live: { active: boolean; runId?: string };
        };
        if (statusJson.live.active && statusJson.live.runId) {
          liveRunId = statusJson.live.runId;
          break;
        }
        await new Promise((r) => setTimeout(r, 15));
      }
      expect(liveRunId).toBeTruthy();

      const abortRes = await api.request(`/api/agent-sessions/${abortSess.id}/abort`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId: liveRunId }),
      });
      expect(abortRes.status).toBe(200);
      const abortJson = (await abortRes.json()) as { aborted: boolean; runId?: string };
      expect(abortJson.aborted).toBe(true);
      expect(abortJson.runId).toBe(liveRunId);

      const streamDone = await abortStreamPromise;
      expect(await streamDone.text()).toContain('event: message_end');

      expect(startEvents).toHaveLength(2);
      expect(endEvents).toHaveLength(2);
      expect(startEvents[1]!.runId).toBe(liveRunId);
      expect(endEvents[1]).toMatchObject({
        runId: liveRunId,
        sessionId: abortSess.id,
        projectId: 'proj-contract',
        sessionKind: 'ARCHITECTURE',
        projectStep: 'DELIVERY',
        outcome: 'ABORTED',
      });

      const storedAbortSess = store.getAgentSession(abortSess.id)!;
      const cancelledAssistant = storedAbortSess.messages.find((m) => m.role === 'assistant')!;
      expect(cancelledAssistant.cancelled).toBe(true);
      expect(cancelledAssistant.runId).toBe(liveRunId);
      expect(endEvents[1]!.assistantMessageId).toBe(cancelledAssistant.id);
      expect(findSessionAgentRun(storedAbortSess, liveRunId!)?.outcome).toBe('ABORTED');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
