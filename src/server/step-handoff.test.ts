import { describe, expect, it } from 'vitest';
import {
  getToolsForAgentKind,
  type UnifiedAgentSseEvent,
} from '../packages/agent-runtime/index.js';
import {
  createWorkspaceStore,
  type AgentSession,
  type AgentSessionKind,
  type StepHandoffProposal,
} from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';

const ALL_SPECIALIST_KINDS: readonly AgentSessionKind[] = [
  'REQUIREMENT',
  'PROTOTYPE_CO_DESIGN',
  'COPILOT',
  'ARCHITECTURE',
  'CODING',
  'CAPABILITY',
  'REASONING',
] as const;

function jsonInit(method: string, body: unknown, locale: 'zh-CN' | 'en-US' = 'zh-CN'): RequestInit {
  return {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Onto-Locale': locale,
    },
    body: JSON.stringify(body),
  };
}

function parseSseEvents(rawSse: string): UnifiedAgentSseEvent[] {
  const blocks = rawSse.split('\n\n').filter((b) => b.trim().length > 0);
  const events: UnifiedAgentSseEvent[] = [];
  for (const block of blocks) {
    let id = '';
    let event = '';
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('id:')) id = line.slice(3).trim();
      else if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (event && dataLines.length > 0) {
      events.push({
        id,
        event: event as UnifiedAgentSseEvent['event'],
        data: JSON.parse(dataLines.join('\n')) as Record<string, unknown>,
      });
    }
  }
  return events;
}

describe('Step Hand-off (#72): specialist isolation, propose_step_handoff, accept & decline', () => {
  it('exposes propose_step_handoff on every specialist agent kind while strictly forbidding cross-step mutation tools', () => {
    for (const kind of ALL_SPECIALIST_KINDS) {
      const toolNames = getToolsForAgentKind(kind).map((t) => t.name);
      expect(toolNames, `${kind} must expose propose_step_handoff`).toContain(
        'propose_step_handoff',
      );
    }

    // Strict cross-step isolation per specialist
    const protoTools = getToolsForAgentKind('PROTOTYPE_CO_DESIGN').map((t) => t.name);
    expect(protoTools).not.toContain('upsert_rule');
    expect(protoTools).not.toContain('upsert_aggregate');
    expect(protoTools).not.toContain('save_synthesized_srs_doc');
    expect(protoTools).not.toContain('save_application_instructions');

    const reqTools = getToolsForAgentKind('REQUIREMENT').map((t) => t.name);
    expect(reqTools).not.toContain('edit_prototype_anchor');
    expect(reqTools).not.toContain('rewrite_prototype_page');
    expect(reqTools).not.toContain('upsert_rule');
    expect(reqTools).not.toContain('save_application_instructions');

    const copilotTools = getToolsForAgentKind('COPILOT').map((t) => t.name);
    expect(copilotTools).not.toContain('edit_prototype_anchor');
    expect(copilotTools).not.toContain('rewrite_prototype_page');
    expect(copilotTools).not.toContain('save_synthesized_srs_doc');
    expect(copilotTools).not.toContain('save_application_instructions');

    const codingTools = getToolsForAgentKind('CODING').map((t) => t.name);
    expect(codingTools).not.toContain('edit_prototype_anchor');
    expect(codingTools).not.toContain('upsert_rule');
    expect(codingTools).not.toContain('save_synthesized_srs_doc');
  });

  it('rejects cross-step tool invocations at runtime even if an upstream LLM attempts to emit a disallowed tool call', async () => {
    const prevLive = process.env.ONTOLOGY_LIVE_LLM;
    process.env.ONTOLOGY_LIVE_LLM = '1';
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: false });
    for (const existing of store.listLlmProviders()) {
      store.saveLlmProvider({ ...existing, enabled: false });
    }
    store.saveLlmProvider({
      id: 'prov-rogue-llm',
      name: 'Simulated Rogue LLM',
      providerType: 'OPENAI_COMPATIBLE',
      baseUrl: 'http://127.0.0.1:19876/v1',
      apiKey: 'sk-rogue',
      defaultModel: 'rogue-model',
      availableModels: ['rogue-model'],
      enabled: true,
    });

    const originalFetch = globalThis.fetch;
    let callStep = 0;
    globalThis.fetch = async () => {
      callStep += 1;
      const encoder = new TextEncoder();
      const chunks =
        callStep === 1
          ? [
              `data: ${JSON.stringify({
                id: 'c1',
                object: 'chat.completion.chunk',
                choices: [
                  {
                    index: 0,
                    delta: {
                      role: 'assistant',
                      tool_calls: [
                        {
                          index: 0,
                          id: 'tc-rogue-1',
                          type: 'function',
                          function: {
                            name: 'upsert_rule',
                            arguments: JSON.stringify({
                              id: 'RULE-ROGUE-99',
                              name: 'RogueRule',
                              alias: '越界规则',
                            }),
                          },
                        },
                      ],
                    },
                    finish_reason: 'tool_calls',
                  },
                ],
              })}\n\n`,
              'data: [DONE]\n\n',
            ]
          : [
              `data: ${JSON.stringify({
                id: 'c2',
                object: 'chat.completion.chunk',
                choices: [
                  {
                    index: 0,
                    delta: {
                      role: 'assistant',
                      content: '该业务规则不在原型步骤范围内。',
                    },
                    finish_reason: 'stop',
                  },
                ],
              })}\n\n`,
              'data: [DONE]\n\n',
            ];
      return new Response(
        new ReadableStream({
          start(ctrl) {
            for (const ch of chunks) ctrl.enqueue(encoder.encode(ch));
            ctrl.close();
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    };

    try {
      const api = createApiApp(store);
      const seedProto = store.listPrototypes('proj-contract')[0]!;
      const baselineRules = store.getProject('proj-contract')!.suite.M3!.rules.length;
      const protoSess = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'PROTOTYPE_CO_DESIGN',
        targetId: seedProto.id,
        title: 'Rogue Isolation Check',
      });

      const res = await api.request(
        `/api/agent-sessions/${protoSess.id}/stream`,
        jsonInit('POST', { prompt: '直接帮我改业务规则', mockMode: false }),
      );
      expect(res.status).toBe(200);
      await res.text();

      const afterSess = store.getAgentSession(protoSess.id)!;
      const rogueTrace = afterSess.messages
        .at(-1)!
        .toolCalls?.find((t) => t.toolName === 'upsert_rule');
      expect(rogueTrace?.isError).toBe(true);
      expect(store.getProject('proj-contract')!.suite.M3!.rules).toHaveLength(baselineRules);
    } finally {
      globalThis.fetch = originalFetch;
      if (prevLive === undefined) delete process.env.ONTOLOGY_LIVE_LLM;
      else process.env.ONTOLOGY_LIVE_LLM = prevLive;
      store.close();
    }
  });

  it('proposes a handoff without mutating the source or target step, declines with zero side effects, and accepts by delivering request into targetStep session', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    const api = createApiApp(store);

    try {
      const seedProto = store.listPrototypes('proj-contract')[0]!;
      const baselineRevCount = seedProto.revisions.length;
      const baselineRuleCount = store.getProject('proj-contract')!.suite.M3!.rules.length;

      // Create/ensure Prototype Co-Design session on proj-contract
      const protoSessRes = await api.request(
        `/api/projects/proj-contract/prototypes/${seedProto.id}/co-design-session`,
        jsonInit('POST', {}),
      );
      expect(protoSessRes.status).toBe(200);
      const { session: protoSess } = (await protoSessRes.json()) as { session: AgentSession };

      // 1. User asks for an approval threshold rule inside Prototype -> proposes handoff to BUSINESS_MODEL, zero mutations!
      const crossPrompt = '合同金额超过 50 万元要总经理审批';
      const streamRes1 = await api.request(
        `/api/agent-sessions/${protoSess.id}/stream`,
        jsonInit('POST', { prompt: crossPrompt, mockMode: true }),
      );
      expect(streamRes1.status).toBe(200);
      const events1 = parseSseEvents(await streamRes1.text());
      const handoffEvt1 = events1.find((ev) => ev.event === 'step_handoff');
      expect(handoffEvt1).toBeDefined();

      const afterProposeProto = store.getPrototype(seedProto.id)!;
      expect(afterProposeProto.revisions).toHaveLength(baselineRevCount);
      expect(store.getProject('proj-contract')!.suite.M3!.rules).toHaveLength(baselineRuleCount);

      const persistedSess1 = store.getAgentSession(protoSess.id)!;
      const assistantMsg1 = persistedSess1.messages.at(-1)!;
      expect(assistantMsg1.stepHandoff).toMatchObject({
        sourceStep: 'PROTOTYPE',
        targetStep: 'BUSINESS_MODEL',
        request: crossPrompt,
        status: 'PENDING',
      });
      const handoffId1 = assistantMsg1.stepHandoff!.id;

      // 2. Decline the handoff -> marks DECLINED, stays in place, zero changes to target sessions or project artifacts
      const sessionsBeforeDecline = JSON.stringify(
        store.listAgentSessions({ projectId: 'proj-contract', agentKind: 'COPILOT' }),
      );
      const declineRes = await api.request(
        `/api/agent-sessions/${protoSess.id}/handoffs/${handoffId1}/decline`,
        jsonInit('POST', {}),
      );
      expect(declineRes.status).toBe(200);
      const declineJson = (await declineRes.json()) as {
        handoff: StepHandoffProposal;
        sourceSession: AgentSession;
      };
      expect(declineJson.handoff.status).toBe('DECLINED');
      expect(declineJson.handoff.resolvedAt).toBeTruthy();
      expect(
        JSON.stringify(
          store.listAgentSessions({ projectId: 'proj-contract', agentKind: 'COPILOT' }),
        ),
      ).toBe(sessionsBeforeDecline);
      expect(store.getProject('proj-contract')!.suite.M3!.rules).toHaveLength(baselineRuleCount);

      // Re-declining or accepting an already declined handoff returns 409
      const doubleDecline = await api.request(
        `/api/agent-sessions/${protoSess.id}/handoffs/${handoffId1}/decline`,
        jsonInit('POST', {}),
      );
      expect(doubleDecline.status).toBe(409);

      const acceptAfterDecline = await api.request(
        `/api/agent-sessions/${protoSess.id}/handoffs/${handoffId1}/accept`,
        jsonInit('POST', { mockMode: true }),
      );
      expect(acceptAfterDecline.status).toBe(409);

      // 3. Propose a second handoff and ACCEPT it -> delivers exact request as a user turn in BUSINESS_MODEL's current session
      const crossPrompt2 = '新增合同金额超过 50 万元必须由总经理审批的业务规则';
      const streamRes2 = await api.request(
        `/api/agent-sessions/${protoSess.id}/stream`,
        jsonInit('POST', { prompt: crossPrompt2, mockMode: true }),
      );
      expect(streamRes2.status).toBe(200);
      await streamRes2.text();

      const handoff2 = store.getAgentSession(protoSess.id)!.messages.at(-1)!.stepHandoff!;
      expect(handoff2.status).toBe('PENDING');
      expect(handoff2.targetStep).toBe('BUSINESS_MODEL');

      const acceptRes = await api.request(
        `/api/agent-sessions/${protoSess.id}/handoffs/${handoff2.id}/accept`,
        jsonInit('POST', { mockMode: true }),
      );
      expect(acceptRes.status).toBe(200);
      const acceptJson = (await acceptRes.json()) as {
        handoff: StepHandoffProposal;
        targetStep: string;
        targetNavView: string;
        targetSessionId: string;
        targetRunId: string;
        targetSession: AgentSession;
      };
      expect(acceptJson.handoff.status).toBe('ACCEPTED');
      expect(acceptJson.targetStep).toBe('BUSINESS_MODEL');
      expect(acceptJson.targetNavView).toBe('app-ontology');
      expect(acceptJson.targetSession.agentKind).toBe('COPILOT');

      // Target session received the exact request as a user turn and completed an assistant reply
      const deliveredUserMsg = acceptJson.targetSession.messages.find(
        (m) => m.role === 'user' && m.content === crossPrompt2,
      );
      expect(deliveredUserMsg).toBeDefined();
      expect(deliveredUserMsg?.handoffFrom).toMatchObject({
        handoffId: handoff2.id,
        sourceStep: 'PROTOTYPE',
        sourceSessionId: protoSess.id,
      });
      const targetAssistantMsg = acceptJson.targetSession.messages.at(-1)!;
      expect(targetAssistantMsg.role).toBe('assistant');
      expect(targetAssistantMsg.content.trim().length).toBeGreaterThan(0);

      // Source prototype still untouched!
      expect(store.getPrototype(seedProto.id)!.revisions).toHaveLength(baselineRevCount);

      // Double-accept is idempotently rejected with 409!
      const doubleAccept = await api.request(
        `/api/agent-sessions/${protoSess.id}/handoffs/${handoff2.id}/accept`,
        jsonInit('POST', { mockMode: true }),
      );
      expect(doubleAccept.status).toBe(409);
    } finally {
      store.close();
    }
  });

  it('delivers handoffs to not-yet-ready ("还不能开始") steps (#48 Decision #3) and explains missing upstream confirmation without mutating downstream artifacts', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    const api = createApiApp(store);

    try {
      const emptyProj = store.createProject({
        name: '门店巡检排班项目',
        code: 'STORE_INSP',
        domain: '连锁门店运营',
        template: 'EMPTY',
      });

      // Case A: In REQUIREMENTS (unconfirmed), ask to tweak prototype table columns -> handoff to unstarted PROTOTYPE
      const reqSess = store.createAgentSession({
        projectId: emptyProj.id,
        agentKind: 'REQUIREMENT',
        title: '巡检需求梳理',
      });
      const protoReqPrompt = '在界面原型表格里加一列巡检评分';
      const reqStream = await api.request(
        `/api/agent-sessions/${reqSess.id}/stream`,
        jsonInit('POST', { prompt: protoReqPrompt, mockMode: true }),
      );
      expect(reqStream.status).toBe(200);
      await reqStream.text();

      const toProtoHandoff = store.getAgentSession(reqSess.id)!.messages.at(-1)!.stepHandoff!;
      expect(toProtoHandoff).toMatchObject({
        sourceStep: 'REQUIREMENTS',
        targetStep: 'PROTOTYPE',
        request: protoReqPrompt,
        status: 'PENDING',
      });

      const acceptProtoRes = await api.request(
        `/api/projects/${emptyProj.id}/step-handoffs/${toProtoHandoff.id}/accept`,
        jsonInit('POST', { mockMode: true }),
      );
      expect(acceptProtoRes.status).toBe(200);
      const acceptProtoJson = (await acceptProtoRes.json()) as {
        targetStep: string;
        targetNavView: string;
        targetSession: AgentSession;
      };
      expect(acceptProtoJson.targetStep).toBe('PROTOTYPE');
      expect(acceptProtoJson.targetNavView).toBe('app-prototype');
      expect(acceptProtoJson.targetSession.agentKind).toBe('PROTOTYPE_CO_DESIGN');
      expect(
        acceptProtoJson.targetSession.messages.some(
          (m) => m.role === 'user' && m.content === protoReqPrompt,
        ),
      ).toBe(true);
      const protoBlockedReply = acceptProtoJson.targetSession.messages.at(-1)!;
      expect(protoBlockedReply.role).toBe('assistant');
      expect(protoBlockedReply.content).toMatch(/需求.*确认|不能开始/);
      // Zero prototypes fabricated!
      expect(store.listPrototypes(emptyProj.id)).toHaveLength(0);

      // Case B: Confirm Requirements & create an UNCONFIRMED draft prototype -> BUSINESS_MODEL still cannot start yet!
      store.saveRequirementDoc({
        id: 'rdoc-insp-1',
        projectId: emptyProj.id,
        title: '门店巡检排班需求文档',
        version: 'v1.0',
        status: 'DRAFT',
        content: '# 门店巡检排班需求文档\n\n## 1. 业务范围\n围绕**巡检任务**（InspectionTask）管理排班与复核。',
      });
      store.confirmRequirementsStep(emptyProj.id, { docId: 'rdoc-insp-1' });
      const draftProto = store.createPrototype(emptyProj.id, {
        name: '门店巡检草稿原型',
        htmlContent:
          '<section data-screen-id="SCR-INSP-LIST" data-screen-name="巡检台账" data-screen-type="LIST"><button type="button" data-element-id="EL-NEW" data-element-type="BUTTON">新建巡检</button></section>',
        source: 'GENERATED',
      });
      const boundProtoSess = store.createAgentSession({
        projectId: emptyProj.id,
        agentKind: 'PROTOTYPE_CO_DESIGN',
        targetId: draftProto.prototype.id,
        title: '巡检原型会话',
      });

      // Ask about an approval rule in PROTOTYPE -> handoff to unstarted BUSINESS_MODEL
      const bmRulePrompt = '巡检不合格整改单超过 3 次必须由区域总监审批';
      const bmStream = await api.request(
        `/api/agent-sessions/${boundProtoSess.id}/stream`,
        jsonInit('POST', { prompt: bmRulePrompt, mockMode: true }),
      );
      expect(bmStream.status).toBe(200);
      await bmStream.text();

      const toBmHandoff = store.getAgentSession(boundProtoSess.id)!.messages.at(-1)!.stepHandoff!;
      expect(toBmHandoff).toMatchObject({
        sourceStep: 'PROTOTYPE',
        targetStep: 'BUSINESS_MODEL',
        request: bmRulePrompt,
        status: 'PENDING',
      });

      const acceptBmRes = await api.request(
        `/api/agent-sessions/${boundProtoSess.id}/handoffs/${toBmHandoff.id}/accept`,
        jsonInit('POST', { mockMode: true }),
      );
      expect(acceptBmRes.status).toBe(200);
      const acceptBmJson = (await acceptBmRes.json()) as {
        targetStep: string;
        targetNavView: string;
        targetSession: AgentSession;
      };
      expect(acceptBmJson.targetStep).toBe('BUSINESS_MODEL');
      expect(acceptBmJson.targetNavView).toBe('app-ontology');
      expect(
        acceptBmJson.targetSession.messages.some(
          (m) => m.role === 'user' && m.content === bmRulePrompt,
        ),
      ).toBe(true);
      const bmBlockedReply = acceptBmJson.targetSession.messages.at(-1)!;
      expect(bmBlockedReply.role).toBe('assistant');
      expect(bmBlockedReply.content).toMatch(/原型.*确认|不能开始/);
      // Zero ontology models mutated while BUSINESS_MODEL cannot start yet!
      expect(store.getProject(emptyProj.id)!.validation.presentModels).toEqual([]);

      // Case C: Ask to generate development package in PROTOTYPE -> handoff to unstarted DELIVERY
      const delivPrompt = '现在帮我生成开发资料包供研发下载';
      const delivStream = await api.request(
        `/api/agent-sessions/${boundProtoSess.id}/stream`,
        jsonInit('POST', { prompt: delivPrompt, mockMode: true }),
      );
      expect(delivStream.status).toBe(200);
      await delivStream.text();

      const toDelivHandoff = store
        .getAgentSession(boundProtoSess.id)!
        .messages.at(-1)!.stepHandoff!;
      expect(toDelivHandoff).toMatchObject({
        sourceStep: 'PROTOTYPE',
        targetStep: 'DELIVERY',
        request: delivPrompt,
        status: 'PENDING',
      });

      const acceptDelivRes = await api.request(
        `/api/agent-sessions/${boundProtoSess.id}/handoffs/${toDelivHandoff.id}/accept`,
        jsonInit('POST', { mockMode: true }),
      );
      expect(acceptDelivRes.status).toBe(200);
      const acceptDelivJson = (await acceptDelivRes.json()) as {
        targetStep: string;
        targetNavView: string;
        targetSession: AgentSession;
      };
      expect(acceptDelivJson.targetStep).toBe('DELIVERY');
      expect(acceptDelivJson.targetNavView).toBe('app-assembly-dev');
      expect(acceptDelivJson.targetSession.agentKind).toBe('CODING');
      expect(
        acceptDelivJson.targetSession.messages.some(
          (m) => m.role === 'user' && m.content === delivPrompt,
        ),
      ).toBe(true);
      const delivBlockedReply = acceptDelivJson.targetSession.messages.at(-1)!;
      expect(delivBlockedReply.role).toBe('assistant');
      expect(delivBlockedReply.content).toMatch(/业务模型.*确认|不能开始/);
      expect(
        store.listAssembledApplications().filter((a) => a.projectId === emptyProj.id),
      ).toHaveLength(0);
    } finally {
      store.close();
    }
  });
});
