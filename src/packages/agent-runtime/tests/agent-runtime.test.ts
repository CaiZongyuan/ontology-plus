import { describe, expect, it } from 'vitest';
import { CONTRACT_LIFECYCLE_SUITE, validateOntologySuite } from '../../ontology-core/index.js';
import { createWorkspaceStore } from '../../workspace-store/index.js';
import {
  LlmGatewayError,
  ONTOLOGY_TOOL_NAMES,
  OPENAI_ONTOLOGY_TOOLS,
  applyOntologyToolCall,
  buildTurnSseEvents,
  collectUnifiedAgentTurn,
  compactAgentSession,
  createSseEventStream,
  generateMetricInsight,
  generatePrototypeFromDoc,
  generateTechArchitectureDoc,
  ontologyToolRegistry,
  refinePrototypeWithAi,
  runAppCodingAgentTurn,
  runCapabilitySmartChatTurn,
  runDataOntologyReasoning,
  runOntologyCopilotTurn,
  runRequirementGrillingTurn,
  runScenarioAttributionTurn,
  synthesizeOntologyFromPrototype,
  synthesizeRequirementDocFromSession,
  testLlmGatewayConnection,
} from '../index.js';

describe('agent-runtime deep module', () => {
  it('connects to the configured local Pi LLM gateway (auto/glm-5.3-flash) or reports status cleanly', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const provider = store.listLlmProviders()[0];
    const ping = await testLlmGatewayConnection(provider);
    expect(ping.baseUrl).toBe('http://127.0.0.1:3425/v1');
    expect(ping.discoveredModels.length).toBeGreaterThan(0);
  }, 30000);

  it('executes ontology copilot tool mutations gated by ontology-core validation', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const res = await runOntologyCopilotTurn(store, {
      projectId: 'proj-contract',
      prompt: '请新增一条跨境知识产权合同法务总监必审规则',
      activeModel: 'M3',
    });

    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].toolName).toBe('upsert_rule');
    expect(res.toolCalls[0].status).toBe('APPLIED');
    expect(res.project.validation.valid).toBe(true);
    expect(res.project.validation.errorCount).toBe(0);
    expect(res.project.suite.M3?.rules.length).toBe(4);
  }, 30000);

  it('satisfies critical copilot M3 rule mutation invariant and rejects corrupting deletions via validator gate', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });

    const ruleTurn = await runOntologyCopilotTurn(store, {
      projectId: 'proj-contract',
      prompt: '请为合同新增一条付款里程碑逾期超 30 天自动冻结结算单的校验规则',
    });

    expect(ruleTurn.toolCalls[0].toolName).toBe('upsert_rule');
    expect(ruleTurn.toolCalls[0].status).toBe('APPLIED');
    expect(ruleTurn.project.suite.M3?.rules.length).toBe(4);
    expect(ruleTurn.project.validation.errorCount).toBe(0);

    // Deleting referenced core aggregate AGG-01 must be rejected by validator and leave suite intact
    const rejectTurn = await runOntologyCopilotTurn(store, {
      projectId: 'proj-contract',
      prompt: '请删除核心聚合根 AGG-01',
      activeModel: 'M1',
    });

    expect(rejectTurn.toolCalls[0].toolName).toBe('delete_element');
    expect(rejectTurn.toolCalls[0].status).toBe('REJECTED_BY_VALIDATOR');
    expect(rejectTurn.project.validation.errorCount).toBe(0);
    expect(rejectTurn.project.suite.M1?.aggregates.some((a) => a.id === 'AGG-01')).toBe(true);
  }, 30000);

  it('registers all 12 durable tools in pi-durable registry and mutates all 11 ontology models validly', () => {
    expect(ONTOLOGY_TOOL_NAMES).toHaveLength(12);
    expect(OPENAI_ONTOLOGY_TOOLS).toHaveLength(12);
    expect(ontologyToolRegistry.snapshot().tools()).toHaveLength(12);

    let suite = JSON.parse(JSON.stringify(CONTRACT_LIFECYCLE_SUITE));
    suite = applyOntologyToolCall(suite, 'upsert_aggregate', { alias: '履约保函' }).nextSuite;
    suite = applyOntologyToolCall(suite, 'upsert_behavior', {
      alias: '查询履约保函台账',
      behaviorType: 'QUERY',
    }).nextSuite;
    suite = applyOntologyToolCall(suite, 'upsert_rule', { alias: '保函有效期校验规则' }).nextSuite;
    suite = applyOntologyToolCall(suite, 'upsert_event', { label: '保函已归档事件' }).nextSuite;
    suite = applyOntologyToolCall(suite, 'upsert_scenario', { name: '保函生效联动场景' }).nextSuite;
    suite = applyOntologyToolCall(suite, 'upsert_actor_role', { roleName: '资金风控官角色' }).nextSuite;
    suite = applyOntologyToolCall(suite, 'upsert_flow', { name: '保函开立审批流程' }).nextSuite;
    suite = applyOntologyToolCall(suite, 'upsert_query_report', { alias: '保函风险汇总报表' }).nextSuite;
    suite = applyOntologyToolCall(suite, 'upsert_screen', { name: '保函监控看板' }).nextSuite;
    suite = applyOntologyToolCall(suite, 'upsert_mapping', { tableName: 't_contract_audit_ext' }).nextSuite;
    suite = applyOntologyToolCall(suite, 'upsert_interface', { name: '保函核验服务接口' }).nextSuite;

    const report = validateOntologySuite(suite);
    expect(report.errorCount).toBe(0);
    expect(report.valid).toBe(true);
  });

  it('runs requirement grilling and data ontology reasoning (ASK_POLICY)', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });

    const [grill, reasoning] = await Promise.all([
      runRequirementGrillingTurn(store, {
        sessionId: 'req-sess-contract-01',
        userMessage: '补充要求：合同变更金额超过原合同 20% 时必须重新触发法务终审。',
      }),
      runDataOntologyReasoning(store, {
        question: '分析高风险合同逾期率上升原因并给出回写处置建议',
        mode: 'ASK_POLICY',
      }),
    ]);

    expect(grill.session.messages.length).toBeGreaterThan(4);
    expect(grill.session.discoveredRules.length).toBeGreaterThan(3);
    expect(grill.session.resolvedDecisions.some((d) => d.includes('[AI自动补全]'))).toBe(true);
    expect(reasoning.mode).toBe('ASK_POLICY');
    expect(reasoning.policyRecommendations[0].writebackInterfaceId).toBe('WB-01');
  }, 40000);

  it('synthesizes canonical 9-Part SRS (需求规格说明书.md) including mandatory sub-items 9.1 through 9.7', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const res = await synthesizeRequirementDocFromSession(store, {
      sessionId: 'req-sess-contract-01',
    });

    expect(res.doc.title).toContain('需求规格说明书');
    for (let ch = 1; ch <= 9; ch++) {
      expect(res.doc.content).toContain(`## ${ch}. `);
    }
    for (let sub = 1; sub <= 7; sub++) {
      expect(res.doc.content).toContain(`### 9.${sub} `);
    }
    expect(res.session.status).toBe('CONVERGED');
  }, 20000);

  it('generates semantic HTML prototype, refines it, and synthesizes 11-model ontology with 0 consistency errors', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const emptyProj = store.createProject({
      name: '供应商采购订单协同系统',
      code: 'SRM-PO',
      domain: '采购与供应链协同',
      template: 'EMPTY',
    });

    const protoRes = await generatePrototypeFromDoc(store, {
      projectId: emptyProj.id,
      prompt: '生成包含采购单台账、起草与主管审核三屏联动的交互原型',
    });

    expect(protoRes.prototype.htmlContent).toContain('data-screen-id=');
    expect(protoRes.prototype.htmlContent).toContain('data-element-id=');
    expect(protoRes.prototype.htmlContent).toContain('data-binding=');
    expect(protoRes.prototype.htmlContent).toContain('data-event-id=');
    expect(protoRes.prototype.extractedScreenCount).toBeGreaterThanOrEqual(3);
    expect(protoRes.project.validation.errorCount).toBe(0);

    const refined = await refinePrototypeWithAi(store, {
      projectId: emptyProj.id,
      prototypeId: protoRes.prototype.id,
      instruction: '在台账页顶部补充紧急采购交期红线提示徽章',
    });
    expect(refined.project.validation.errorCount).toBe(0);

    const synth = await synthesizeOntologyFromPrototype(store, {
      projectId: emptyProj.id,
      prototypeId: refined.prototype.id,
    });
    expect(synth.synthesizedModels).toHaveLength(11);
    expect(synth.validation.errorCount).toBe(0);
    expect(synth.validation.valid).toBe(true);

    const arch = await generateTechArchitectureDoc(store, {
      name: 'SRM 11模型深模块云原生架构',
      stackTags: ['TypeScript', 'Hono', 'D1'],
    });
    expect(arch.asset.layer).toBe('TECH_ARCH');

    const coding = await runAppCodingAgentTurn(store, {
      appId: 'app-contract-clm',
      instruction: '同步最新 M3 合规校验规则至后端应用服务层',
    });
    expect(coding.generatedFilesCount).toBeGreaterThan(5);
  }, 30000);

  it('runs capability smart chat turn invoking dynamic MCP tools and citing SKILL.md rules', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const chatRes = await runCapabilitySmartChatTurn(store, {
      agentId: 'agent-contract-copilot',
      userMessage: '请查询当前合同台账并核对百万级合同资信合规规则',
    });

    expect(chatRes.toolInvocations).toHaveLength(1);
    expect(chatRes.toolInvocations[0].output).toContain('SUCCESS');
    expect(chatRes.message.content).toContain('SKILL.md');
    expect(chatRes.session.messages.length).toBe(2);
  }, 30000);

  it('streams standard SSE frames (message_start -> delta -> tool_call -> tool_result -> render_payload -> message_end) and analytics insights', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const insight = await generateMetricInsight(store, { metricId: 'MET-02' });
    expect(insight.writebackInterfaceId).toBe('WB-01');

    const attr = await runScenarioAttributionTurn(store, {
      scenarioId: 'ascn-01',
      saveAsReport: true,
    });
    expect(attr.recommendedWritebackId).toBe('WB-01');
    expect(attr.savedReport?.id).toBeTruthy();

    const events = buildTurnSseEvents({
      sessionId: 'sse-test-01',
      reply: '已完成本体变更与一致性校验。',
      toolCalls: [{ toolName: 'upsert_rule', args: { id: 'RULE-04' }, status: 'APPLIED' }],
      renderPayload: { errorCount: 0 },
    });

    const stream = createSseEventStream(events);
    const rawText = await new Response(stream).text();

    const startIdx = rawText.indexOf('event: message_start');
    const deltaIdx = rawText.indexOf('event: delta');
    const callIdx = rawText.indexOf('event: tool_call');
    const resultIdx = rawText.indexOf('event: tool_result');
    const payloadIdx = rawText.indexOf('event: render_payload');
    const endIdx = rawText.indexOf('event: message_end');

    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(deltaIdx).toBeGreaterThan(startIdx);
    expect(callIdx).toBeGreaterThan(deltaIdx);
    expect(resultIdx).toBeGreaterThan(callIdx);
    expect(payloadIdx).toBeGreaterThan(resultIdx);
    expect(endIdx).toBeGreaterThan(payloadIdx);
  }, 20000);

  it('throws LlmGatewayError instead of silent fake fallback when live mode hits an offline gateway', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    // Point the sole provider at a guaranteed unreachable port
    const existing = store.listLlmProviders();
    for (const p of existing) {
      store.saveLlmProvider({
        ...p,
        baseUrl: 'http://127.0.0.1:59999/v1',
        enabled: true,
      });
    }

    await expect(
      runOntologyCopilotTurn(store, {
        projectId: 'proj-contract',
        prompt: '查询当前模型结构',
        mockMode: false,
      }),
    ).rejects.toBeInstanceOf(LlmGatewayError);

    const session = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'COPILOT',
      title: 'Live Gateway Failure Probe',
    });
    const turn = await collectUnifiedAgentTurn(store, {
      sessionId: session.id,
      prompt: '测试离线网关诊断',
      mockMode: false,
    });
    expect(turn.events.some((e) => e.event === 'run_error')).toBe(true);
    expect(turn.session.status).toBe('ERROR');
    expect(turn.session.messages.at(-1)?.errorDiagnostic?.code).toBe('LLM_GATEWAY_ERROR');
  }, 20000);

  it('streams unified AgentSession with multi-step validator self-repair, Scoped HITL ask_user, fork, and compact', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });

    // 1. Multi-step Validator Self-Repair in COPILOT
    const copilotSess = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'COPILOT',
      title: '新会话',
    });
    const repairTurn = await collectUnifiedAgentTurn(store, {
      sessionId: copilotSess.id,
      prompt: '执行悬空自修复测试创建跨聚合场景',
      mockMode: true,
    });

    expect(repairTurn.events.some((e) => e.event === 'thinking_delta')).toBe(true);
    const traces = repairTurn.session.messages.at(-1)?.toolCalls ?? [];
    expect(traces.length).toBe(2);
    expect(traces[0]?.isError).toBe(true);
    expect(traces[1]?.isError).toBe(false);
    expect(traces[1]?.validatorRepair).toBe(true);
    expect(store.getProject('proj-contract')!.validation.errorCount).toBe(0);

    // 2. Scoped HITL ask_user pause & resume
    const reqSess = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'REQUIREMENT',
      title: '需求边界探索',
    });
    const hitlTurn = await collectUnifiedAgentTurn(store, {
      sessionId: reqSess.id,
      prompt: '当履约里程碑逾期时我不确定采用哪种方案，请给我待确认选项让我选择',
      mockMode: true,
    });
    expect(hitlTurn.events.some((e) => e.event === 'ask_user')).toBe(true);
    expect(hitlTurn.session.status).toBe('WAITING_INPUT');
    const askPrompt = hitlTurn.session.messages.at(-1)?.askUser;
    expect(askPrompt?.options.length).toBeGreaterThanOrEqual(2);

    const resumedTurn = await collectUnifiedAgentTurn(store, {
      sessionId: reqSess.id,
      askUserAnswer: {
        promptId: askPrompt!.id,
        selectedAnswers: [askPrompt!.options[0]!],
        freeformText: '超过 100 万同时抄送法务总监',
      },
      mockMode: true,
    });
    expect(resumedTurn.session.status).toBe('IDLE');
    expect(resumedTurn.session.messages.some((m) => m.askUser?.answered === true)).toBe(true);

    // 3. Fork from an earlier message & Compact long history
    const forked = store.forkAgentSession(
      resumedTurn.session.id,
      resumedTurn.session.messages[1]!.id,
    );
    expect(forked.parentSessionId).toBe(resumedTurn.session.id);
    expect(forked.messages.length).toBe(2);

    await collectUnifiedAgentTurn(store, {
      sessionId: resumedTurn.session.id,
      prompt: '补充第二条结算核销一致性规则',
      mockMode: true,
    });
    const compacted = compactAgentSession(store, resumedTurn.session.id);
    expect(compacted.compactedSummary).toBeTruthy();
    expect(compacted.messages.length).toBeLessThanOrEqual(4);
  }, 20000);
});
