import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { CONTRACT_LIFECYCLE_SUITE, validateOntologySuite } from '../../ontology-core/index.js';
import { createWorkspaceStore } from '../../workspace-store/index.js';
import {
  DOMAIN_RUN_TOOL_NAMES,
  LlmGatewayError,
  ONTOLOGY_TOOL_NAMES,
  OPENAI_ONTOLOGY_TOOLS,
  abortActiveAgentSession,
  applyOntologyToolCall,
  buildPiModelsForStore,
  buildTurnSseEvents,
  collectUnifiedAgentTurn,
  compactAgentSession,
  createSseEventStream,
  ensurePrototypeCoDesignSession,
  generatePrototypeFromDoc,
  ontologyToolRegistry,
  runAppCodingAgentTurn,
  runCapabilitySmartChatTurn,
  runDataOntologyReasoning,
  runRequirementGrillingTurn,
  runUnifiedAgentSessionStream,
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

  it('executes ontology copilot Agent Run tool mutations gated by ontology-core validation', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const copilotSess = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'COPILOT',
      title: 'Copilot Rule Session',
    });
    const turn = await collectUnifiedAgentTurn(store, {
      sessionId: copilotSess.id,
      prompt: '请新增一条跨境知识产权合同法务总监必审规则',
      activeModelCode: 'M3',
      mockMode: true,
    });

    const lastMsg = turn.session.messages.at(-1)!;
    expect(lastMsg.toolCalls?.some((tc) => tc.toolName === 'upsert_rule' && !tc.isError)).toBe(
      true,
    );
    const updatedProj = store.getProject('proj-contract')!;
    expect(updatedProj.validation.valid).toBe(true);
    expect(updatedProj.validation.errorCount).toBe(0);
    expect(updatedProj.suite.M3?.rules.length).toBe(4);
  }, 30000);

  it('satisfies critical copilot M3 rule mutation invariant and rejects corrupting deletions via validator gate', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const copilotSess = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'COPILOT',
      title: 'Copilot Validator Gate Session',
    });

    const ruleTurn = await collectUnifiedAgentTurn(store, {
      sessionId: copilotSess.id,
      prompt: '请为合同新增一条付款里程碑逾期超 30 天自动冻结结算单的校验规则',
      activeModelCode: 'M3',
      mockMode: true,
    });

    expect(
      ruleTurn.session.messages.at(-1)?.toolCalls?.some((tc) => tc.toolName === 'upsert_rule'),
    ).toBe(true);
    expect(store.getProject('proj-contract')!.suite.M3?.rules.length).toBe(4);
    expect(store.getProject('proj-contract')!.validation.errorCount).toBe(0);

    // Deleting referenced core aggregate AGG-01 must be rejected by validator and leave suite intact
    const rejectTurn = await collectUnifiedAgentTurn(store, {
      sessionId: copilotSess.id,
      prompt: '请删除核心聚合根 AGG-01',
      activeModelCode: 'M1',
      mockMode: true,
    });

    const rejectCalls = rejectTurn.session.messages.at(-1)?.toolCalls ?? [];
    expect(rejectCalls.some((tc) => tc.toolName === 'delete_element' && tc.isError)).toBe(true);
    const afterReject = store.getProject('proj-contract')!;
    expect(afterReject.validation.errorCount).toBe(0);
    expect(afterReject.suite.M1?.aggregates.some((a) => a.id === 'AGG-01')).toBe(true);
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

  it('synthesizes canonical 9-Part SRS (需求规格说明书.md) via REQUIREMENT Agent Run including mandatory sub-items 9.1 through 9.7', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    expect(DOMAIN_RUN_TOOL_NAMES).toHaveLength(5);
    const reqAgentSess = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'REQUIREMENT',
      targetId: 'req-sess-contract-01',
      title: '合同需求规格合成会话',
    });
    const turn = await collectUnifiedAgentTurn(store, {
      sessionId: reqAgentSess.id,
      prompt:
        '[ACTION:SYNTHESIZE_SRS {"requirementSessionId":"req-sess-contract-01"}]\n请合成九章节需求规格说明书',
      mockMode: true,
    });

    const lastMsg = turn.session.messages.at(-1)!;
    const docArt = lastMsg.artifacts?.find((a) => a.kind === 'REQUIREMENT_DOC');
    expect(docArt?.kind).toBe('REQUIREMENT_DOC');
    const savedDoc = store
      .listRequirementDocs('proj-contract')
      .find((d) => d.id === (docArt?.kind === 'REQUIREMENT_DOC' ? docArt.docId : ''));
    expect(savedDoc).toBeDefined();
    expect(savedDoc!.title).toContain('需求规格说明书');
    for (let ch = 1; ch <= 9; ch++) {
      expect(savedDoc!.content).toContain(`## ${ch}. `);
    }
    for (let sub = 1; sub <= 7; sub++) {
      expect(savedDoc!.content).toContain(`### 9.${sub} `);
    }
    const reqSession = store
      .listRequirementSessions('proj-contract')
      .find((s) => s.id === 'req-sess-contract-01');
    expect(reqSession?.status).toBe('CONVERGED');
  }, 20000);

  it('generates semantic HTML prototype, refines it, and synthesizes 11-model ontology & tech arch via Agent Runs with 0 consistency errors', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const emptyProj = store.createProject({
      name: '供应商采购订单协同系统',
      code: 'SRM-PO',
      domain: '采购与供应链协同',
      template: 'EMPTY',
    });
    expect(emptyProj.currentStage).toBe(0);
    expect(emptyProj.validation.presentModels).toEqual([]);

    const protoRes = await generatePrototypeFromDoc(store, {
      projectId: emptyProj.id,
      prompt: '生成包含采购单台账、起草与主管审核三屏联动的交互原型',
    });

    expect(protoRes.prototype.htmlContent).toContain('data-screen-id=');
    expect(protoRes.prototype.htmlContent).toContain('data-element-id=');
    expect(protoRes.prototype.htmlContent).toContain('data-binding=');
    expect(protoRes.prototype.htmlContent).toContain('data-event-id=');
    expect(protoRes.prototype.extractedScreenCount).toBeGreaterThanOrEqual(3);
    // Step 3 must NOT prematurely populate ontology models before Step 4
    expect(protoRes.project.validation.presentModels).toEqual([]);
    expect(protoRes.project.validation.errorCount).toBe(0);

    const coDesignSession = ensurePrototypeCoDesignSession(
      store,
      emptyProj.id,
      protoRes.prototype.id,
    );
    await collectUnifiedAgentTurn(store, {
      sessionId: coDesignSession.id,
      prompt: '在台账页顶部补充紧急采购交期红线提示徽章',
      mockMode: true,
    });
    const afterRefineProj = store.getProject(emptyProj.id)!;
    expect(afterRefineProj.validation.presentModels).toEqual([]);
    expect(afterRefineProj.validation.errorCount).toBe(0);

    const copilotSess = store.createAgentSession({
      projectId: emptyProj.id,
      agentKind: 'COPILOT',
      title: 'SRM 本体合成会话',
    });
    const synthTurn = await collectUnifiedAgentTurn(store, {
      sessionId: copilotSess.id,
      prompt: `[ACTION:SYNTHESIZE_ONTOLOGY_SUITE {"prototypeId":"${protoRes.prototype.id}"}]\n从原型合成 11 模型`,
      mockMode: true,
    });
    const suiteArt = synthTurn.session.messages
      .at(-1)
      ?.artifacts?.find((a) => a.kind === 'ONTOLOGY_SUITE');
    expect(suiteArt).toMatchObject({
      kind: 'ONTOLOGY_SUITE',
      modelCount: 11,
      errorCount: 0,
    });
    const synthProj = store.getProject(emptyProj.id)!;
    expect(synthProj.validation.presentModels).toHaveLength(11);
    expect(synthProj.validation.errorCount).toBe(0);
    expect(synthProj.validation.valid).toBe(true);

    // Custom project accidentally created with CONTRACT template strips foreign Contract aggregate on Step 4 synthesis
    const accidentalDemoProj = store.createProject({
      name: '咖啡店管理系统',
      code: 'COFFEE-POS',
      domain: '餐饮门店运营',
      template: 'CONTRACT',
    });
    expect(accidentalDemoProj.suite.M1?.aggregates[0]?.name).toBe('Contract');
    const coffeeProto = store.savePrototypeAndSyncMu(accidentalDemoProj.id, {
      name: '咖啡店点单与出杯原型',
      syncMu: false,
      htmlContent:
        '<section data-screen-id="SCR-COFFEE-POS" data-screen-name="门店点单台"><input data-element-id="EL-DRINK" data-binding="CoffeeOrder.drinkCode" /><button data-element-id="EL-SUBMIT" data-event-id="EVT-ORDER-PAID">下单出杯</button></section>',
    }).prototype;
    const coffeeCopilotSess = store.createAgentSession({
      projectId: accidentalDemoProj.id,
      agentKind: 'COPILOT',
      title: '咖啡店本体合成会话',
    });
    await collectUnifiedAgentTurn(store, {
      sessionId: coffeeCopilotSess.id,
      prompt: `[ACTION:SYNTHESIZE_ONTOLOGY_SUITE {"prototypeId":"${coffeeProto.id}"}]\n合成 11 模型本体`,
      mockMode: true,
    });
    const coffeeUpdatedProj = store.getProject(accidentalDemoProj.id)!;
    expect(coffeeUpdatedProj.validation.errorCount).toBe(0);
    expect(
      coffeeUpdatedProj.suite.M1?.aggregates.some((a) => a.name === 'Contract'),
    ).toBe(false);
    expect(
      coffeeUpdatedProj.suite.M1?.aggregates.some((a) => a.name === 'CoffeeOrder'),
    ).toBe(true);

    const codingSess = store.createAgentSession({
      projectId: emptyProj.id,
      agentKind: 'CODING',
      title: 'SRM 架构研发会话',
    });
    const archTurn = await collectUnifiedAgentTurn(store, {
      sessionId: codingSess.id,
      prompt:
        '[ACTION:GENERATE_TECH_ARCH {"name":"SRM 11模型深模块云原生架构","stackTags":["TypeScript","Hono","D1"]}]\n生成技术架构规范',
      mockMode: true,
    });
    const archArt = archTurn.session.messages
      .at(-1)
      ?.artifacts?.find((a) => a.kind === 'TECH_ARCH_ASSET');
    expect(archArt?.kind).toBe('TECH_ARCH_ASSET');
    const savedArch = store
      .listFourLayerAssets()
      .find((a) => a.id === (archArt?.kind === 'TECH_ARCH_ASSET' ? archArt.assetId : ''));
    expect(savedArch?.layer).toBe('TECH_ARCH');

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

  it('streams standard SSE frames and executes metric insight + scenario attribution via REASONING Agent Runs', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const reasoningSess = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'REASONING',
      title: '指标与归因分析会话',
    });

    const insightTurn = await collectUnifiedAgentTurn(store, {
      sessionId: reasoningSess.id,
      prompt: '[ACTION:METRIC_INSIGHT {"metricId":"MET-02"}]\n请分析 MET-02 指标波动原因',
      reasoningMode: 'ASK_WHY',
      mockMode: true,
    });
    const insightArt = insightTurn.session.messages
      .at(-1)
      ?.artifacts?.find((a) => a.kind === 'METRIC_INSIGHT');
    expect(insightArt?.kind).toBe('METRIC_INSIGHT');
    if (insightArt?.kind === 'METRIC_INSIGHT') {
      expect(insightArt.writebackInterfaceId).toBe('WB-01');
      expect(insightArt.anomalyDrivers.length).toBeGreaterThan(0);
    }

    const reportsBefore = store.listAnalyticsReports().length;
    const attrTurn = await collectUnifiedAgentTurn(store, {
      sessionId: reasoningSess.id,
      prompt:
        '[ACTION:SCENARIO_ATTRIBUTION {"scenarioId":"ascn-01","saveAsReport":true}]\n请执行归因推演并保存报告',
      reasoningMode: 'ASK_WHY',
      mockMode: true,
    });
    const attrArt = attrTurn.session.messages
      .at(-1)
      ?.artifacts?.find((a) => a.kind === 'ANALYTICS_REPORT');
    expect(attrArt?.kind).toBe('ANALYTICS_REPORT');
    if (attrArt?.kind === 'ANALYTICS_REPORT') {
      expect(attrArt.recommendedWritebackId).toBe('WB-01');
      expect(attrArt.reportId).toBeTruthy();
      expect(attrArt.causalBreakdown?.length).toBeGreaterThan(0);
    }
    expect(store.listAnalyticsReports().length).toBeGreaterThan(reportsBefore);

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

  it('reports honest LlmGatewayError across all migrated Agent Run actions with zero fake template artifacts when live gateway fails', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: false });
    // Point every provider at a guaranteed unreachable port
    for (const p of store.listLlmProviders()) {
      store.saveLlmProvider({
        ...p,
        baseUrl: 'http://127.0.0.1:59999/v1',
        enabled: true,
      });
    }

    const docsBefore = store.listRequirementDocs('proj-contract').length;
    const assetsBefore = store.listFourLayerAssets().length;
    const reportsBefore = store.listAnalyticsReports().length;

    const probes: { kind: 'COPILOT' | 'REQUIREMENT' | 'CODING' | 'REASONING'; prompt: string }[] = [
      { kind: 'COPILOT', prompt: '测试离线网关诊断' },
      {
        kind: 'COPILOT',
        prompt: '[ACTION:SYNTHESIZE_ONTOLOGY_SUITE {}]\n从原型推导 11 模型',
      },
      {
        kind: 'REQUIREMENT',
        prompt: '[ACTION:SYNTHESIZE_SRS {}]\n合成九章节 SRS',
      },
      {
        kind: 'CODING',
        prompt: '[ACTION:GENERATE_TECH_ARCH {"name":"探测技术架构"}]\n生成技术架构',
      },
      {
        kind: 'REASONING',
        prompt: '[ACTION:METRIC_INSIGHT {"metricId":"MET-02"}]\n指标波动洞察',
      },
      {
        kind: 'REASONING',
        prompt:
          '[ACTION:SCENARIO_ATTRIBUTION {"scenarioId":"ascn-01","saveAsReport":true}]\n场景归因',
      },
    ];

    for (const probe of probes) {
      const session = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: probe.kind,
        title: `Live Gateway Failure Probe (${probe.kind})`,
      });
      const turn = await collectUnifiedAgentTurn(store, {
        sessionId: session.id,
        prompt: probe.prompt,
        mockMode: false,
      });
      expect(turn.events.some((e) => e.event === 'run_error')).toBe(true);
      expect(turn.session.status).toBe('ERROR');
      const lastMsg = turn.session.messages.at(-1);
      expect(lastMsg?.errorDiagnostic?.code).toBe('LLM_GATEWAY_ERROR');
      expect(lastMsg?.artifacts ?? []).toHaveLength(0);
    }

    // Zero fake template SRS, tech arch assets, or attribution reports persisted!
    expect(store.listRequirementDocs('proj-contract').length).toBe(docsBefore);
    expect(store.listFourLayerAssets().length).toBe(assetsBefore);
    expect(store.listAnalyticsReports().length).toBe(reportsBefore);
  }, 25000);

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

  it('respects session.providerId, refreshes inactivity timeout while streaming, preserves partial tool traces on LLM_TIMEOUT, and avoids fake gateway errors on user abort', async () => {
    let mode: 'ACTIVE_SLOW_STREAM' | 'STALL_ON_STEP_2' = 'ACTIVE_SLOW_STREAM';
    let stepCounter = 0;

    const server = http.createServer((req, res) => {
      stepCounter += 1;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      if (stepCounter === 1) {
        res.write(
          `data: ${JSON.stringify({
            id: 'cmpl-step-1',
            object: 'chat.completion.chunk',
            choices: [
              {
                index: 0,
                delta: {
                  content: '我先查看当前本体工程的已有模型情况，再和你一起梳理需求。',
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_inspect_m1',
                      type: 'function',
                      function: {
                        name: 'inspect_ontology_model',
                        arguments: '{"modelCode":"M1"}',
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({
            id: 'cmpl-step-1',
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
          })}\n\n`,
        );
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      if (mode === 'ACTIVE_SLOW_STREAM') {
        // Emit 6 chunks spaced 110ms apart (~660ms total > 350ms idleTimeoutMs), proving watchdog resets per chunk
        let emitted = 0;
        const timer = setInterval(() => {
          if (res.writableEnded || res.destroyed) {
            clearInterval(timer);
            return;
          }
          emitted += 1;
          if (emitted <= 5) {
            res.write(
              `data: ${JSON.stringify({
                id: 'cmpl-step-2',
                object: 'chat.completion.chunk',
                choices: [
                  {
                    index: 0,
                    delta: { reasoning_content: `思考分片#${emitted} ` },
                    finish_reason: null,
                  },
                ],
              })}\n\n`,
            );
          } else {
            clearInterval(timer);
            res.write(
              `data: ${JSON.stringify({
                id: 'cmpl-step-2',
                object: 'chat.completion.chunk',
                choices: [
                  {
                    index: 0,
                    delta: { content: '\n已完成咖啡店订单与会员核心模型梳理。' },
                    finish_reason: 'stop',
                  },
                ],
              })}\n\n`,
            );
            res.write('data: [DONE]\n\n');
            res.end();
          }
        }, 110);
        req.on('close', () => clearInterval(timer));
        return;
      }

      // STALL_ON_STEP_2: keep HTTP stream silent until idleTimeoutMs triggers
      req.on('close', () => {
        if (!res.writableEnded) res.end();
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const mockGatewayUrl = `http://127.0.0.1:${port}/v1`;

    try {
      const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
      for (const p of store.listLlmProviders()) {
        store.deleteLlmProvider(p.id);
      }
      store.saveLlmProvider({
        id: 'prov-0-unused',
        name: 'Unused First Gateway',
        providerType: 'OPENAI_COMPATIBLE',
        baseUrl: 'http://127.0.0.1:59998/v1',
        apiKey: 'none',
        defaultModel: 'unused-model',
        availableModels: ['unused-model'],
        enabled: true,
      });
      store.saveLlmProvider({
        id: 'prov-1-selected',
        name: 'Selected Gateway',
        providerType: 'OPENAI_COMPATIBLE',
        baseUrl: mockGatewayUrl,
        apiKey: 'test-key',
        defaultModel: 'auto/glm-5.3-flash',
        availableModels: ['auto/glm-5.3-flash'],
        enabled: true,
      });
      expect(store.listLlmProviders()[0]?.id).toBe('prov-0-unused');

      const session = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'REQUIREMENT',
        title: '新建需求探索会话',
        providerId: 'prov-1-selected',
      });

      // 1. Verify session.providerId is honored over enabledProviders[0]
      const built = buildPiModelsForStore(store, session, { mockMode: false });
      expect(built.providerConfig?.id).toBe('prov-1-selected');
      expect(built.selectedModel.id).toBe('auto/glm-5.3-flash');

      // 2. Active slow stream (> idleTimeoutMs cumulative, < idleTimeoutMs between chunks) succeeds
      stepCounter = 0;
      mode = 'ACTIVE_SLOW_STREAM';
      const okTurn = await collectUnifiedAgentTurn(store, {
        sessionId: session.id,
        prompt: '我要做一个咖啡店管理系统',
        mockMode: false,
        idleTimeoutMs: 350,
      });
      expect(okTurn.events.some((e) => e.event === 'message_end')).toBe(true);
      expect(okTurn.session.messages.at(-1)?.errorDiagnostic).toBeUndefined();
      expect(okTurn.session.messages.at(-1)?.content).toContain('已完成咖啡店订单与会员核心模型梳理');

      // 3. Genuine stall on Step 2 reports LLM_TIMEOUT (not generic 会话生成已中止) and preserves Step 1 progress
      stepCounter = 0;
      mode = 'STALL_ON_STEP_2';
      const stallTurn = await collectUnifiedAgentTurn(store, {
        sessionId: session.id,
        prompt: '继续细化库存批次模型',
        mockMode: false,
        idleTimeoutMs: 140,
      });
      const lastMsg = stallTurn.session.messages.at(-1);
      expect(lastMsg?.errorDiagnostic?.code).toBe('LLM_TIMEOUT');
      expect(lastMsg?.errorDiagnostic?.message).toContain('超时');
      expect(lastMsg?.content).toContain('我先查看当前本体工程的已有模型情况');
      expect(lastMsg?.toolCalls?.some((t) => t.toolName === 'inspect_ontology_model')).toBe(true);

      // 4. Manual user abort stops cleanly without appending a fake errorDiagnostic bubble
      stepCounter = 0;
      mode = 'STALL_ON_STEP_2';
      const abortSess = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'REQUIREMENT',
        title: '手动中止测试',
        providerId: 'prov-1-selected',
      });
      const abortEvents: string[] = [];
      for await (const ev of runUnifiedAgentSessionStream(store, {
        sessionId: abortSess.id,
        prompt: '测试用户手动停止',
        mockMode: false,
        idleTimeoutMs: 5000,
      })) {
        abortEvents.push(ev.event);
        if (ev.event === 'tool_result') {
          abortActiveAgentSession(abortSess.id);
        }
      }
      const afterAbort = store.getAgentSession(abortSess.id)!;
      expect(abortEvents).not.toContain('run_error');
      expect(afterAbort.status).toBe('IDLE');
      expect(afterAbort.messages.every((m) => !m.errorDiagnostic)).toBe(true);
      expect(
        afterAbort.messages.at(-1)?.toolCalls?.some((t) => t.toolName === 'inspect_ontology_model'),
      ).toBe(true);
    } finally {
      server.close();
    }
  }, 20000);

  it('keeps custom EMPTY projects domain-authentic with zero Contract leakage across tools and AgentSession SRS synthesis', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const coffeeProj = store.createProject({
      name: '精品咖啡门店管理系统',
      code: 'COFFEE_SHOP',
      center: 'APPLICATION',
      domain: '餐饮门店零售',
      description: '堂食+外带点单、配方扣减与会员积分营销',
      template: 'EMPTY',
    });

    // 1. Mutating an empty suite via ontology tools never injects hardcoded "Contract"
    let working = coffeeProj.suite;
    working = applyOntologyToolCall(
      working,
      'upsert_aggregate',
      { name: 'CoffeeOrder', alias: '咖啡订单', lifecycle: ['CREATED', 'PAID', 'READY'] },
      coffeeProj.domain,
    ).nextSuite;
    working = applyOntologyToolCall(
      working,
      'upsert_behavior',
      { alias: '门店扫码下单', behaviorType: 'COMMAND' },
      coffeeProj.domain,
    ).nextSuite;
    working = applyOntologyToolCall(
      working,
      'upsert_rule',
      { alias: '饮品出杯自动扣减咖啡豆配方库存' },
      coffeeProj.domain,
    ).nextSuite;
    working = applyOntologyToolCall(
      working,
      'upsert_flow',
      { name: '门店点单制作履约流' },
      coffeeProj.domain,
    ).nextSuite;

    const validation = validateOntologySuite(working);
    expect(validation.errorCount).toBe(0);
    expect(JSON.stringify(working)).not.toContain('Contract');
    expect(working.M6?.flows[0]?.flowType).toBe('COLLABORATION');

    // 2. Synthesizing SRS directly from a REQUIREMENT AgentSession preserves multi-turn + HITL context
    const reqAgentSess = store.createAgentSession({
      projectId: coffeeProj.id,
      agentKind: 'REQUIREMENT',
      title: '咖啡店需求探索',
    });
    store.saveAgentSession({
      ...reqAgentSess,
      messages: [
        {
          id: 'u-1',
          role: 'user',
          content: '我们要做精品咖啡馆堂食+外带系统，包含饮品配方扣减与完整会员积分优惠券。',
          timestamp: new Date().toISOString(),
        },
        {
          id: 'a-1',
          role: 'assistant',
          content: '已记录核心领域要素，请确认定制规格方案。',
          timestamp: new Date().toISOString(),
          artifacts: [
            {
              kind: 'REQUIREMENT_HINTS',
              aggregates: ['咖啡订单 CoffeeOrder', '饮品配方 DrinkRecipe', '会员档案 MemberProfile'],
              rules: ['每杯饮品出杯后按配方比例自动扣减原料库存'],
              decisions: ['[已确认] 经营模式：堂食 + 外带（经典门店模式）'],
              openQuestions: [],
            },
          ],
          askUser: {
            id: 'hitl-cup',
            header: '定制规格',
            question: '饮品定制选项需要支持到什么程度？',
            options: ['标准三维定制（杯型/温度/甜度）', '深度客制（加浓/燕麦奶/风味糖浆加价）'],
            answered: true,
            selectedAnswers: ['深度客制（加浓/燕麦奶/风味糖浆加价）'],
          },
        },
      ],
    });

    const srsTurn = await collectUnifiedAgentTurn(store, {
      sessionId: reqAgentSess.id,
      prompt: '[ACTION:SYNTHESIZE_SRS {}]\n请合成咖啡店需求规格说明书',
      mockMode: true,
    });
    const srsArt = srsTurn.session.messages
      .at(-1)
      ?.artifacts?.find((a) => a.kind === 'REQUIREMENT_DOC');
    expect(srsArt?.kind).toBe('REQUIREMENT_DOC');
    const coffeeDoc = store.listRequirementDocs(coffeeProj.id)[0]!;
    expect(coffeeDoc.content).toContain('## 1.');
    expect(coffeeDoc.content).toContain('## 9.');
    expect(coffeeDoc.content).toContain('### 9.7');
    expect(coffeeDoc.content).toContain('CoffeeOrder');
    expect(coffeeDoc.content).toContain('深度客制');
    expect(coffeeDoc.content).not.toContain('采购合同');
    expect(coffeeDoc.content).not.toContain('风控主管');
  });

  it('supports end-to-end en-US locale across unified streaming, tool traces, HITL, SRS, and gateway diagnostics', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const enProj = store.createProject({
      name: 'Specialty Roastery POS',
      code: 'ROASTERY_POS',
      center: 'APPLICATION',
      domain: 'Retail & Hospitality',
      template: 'EMPTY',
    });

    // 1. Unified COPILOT turn in en-US emits English tool trace summaryEn
    const copilotSess = store.createAgentSession({
      projectId: enProj.id,
      agentKind: 'COPILOT',
      title: 'English Modeling Session',
    });
    const turn1 = await collectUnifiedAgentTurn(store, {
      sessionId: copilotSess.id,
      prompt: 'Please add an aggregate BrewBatch for specialty coffee roasting',
      mockMode: true,
      locale: 'en-US',
    });
    const lastCopilotMsg = turn1.session.messages.at(-1)!;
    expect(lastCopilotMsg.toolCalls?.length).toBeGreaterThan(0);
    expect(lastCopilotMsg.toolCalls?.[0]?.output).toMatch(/Upserted|Inspected/i);
    expect(lastCopilotMsg.content).not.toMatch(/[\u4e00-\u9fa5]{4,}/);

    // 2. Unified REQUIREMENT turn with English ambiguity prompt triggers English Scoped HITL card
    const reqSess = store.createAgentSession({
      projectId: enProj.id,
      agentKind: 'REQUIREMENT',
      title: 'English Requirement Discovery',
    });
    const turn2 = await collectUnifiedAgentTurn(store, {
      sessionId: reqSess.id,
      prompt: 'We are not sure about loyalty tier expiration rules, please give me options',
      mockMode: true,
      locale: 'en-US',
    });
    const hitlMsg = turn2.session.messages.at(-1)!;
    expect(hitlMsg.askUser).toBeDefined();
    expect(hitlMsg.askUser?.question).toMatch(/[A-Za-z]/);

    // 3. Synthesizing SRS in en-US via REQUIREMENT Agent Run produces English 9-chapter SRS with zero Chinese tag leaks
    await collectUnifiedAgentTurn(store, {
      sessionId: reqSess.id,
      prompt: '[ACTION:SYNTHESIZE_SRS {}]\nSynthesize 9-chapter English SRS document',
      mockMode: true,
      locale: 'en-US',
    });
    const enSrsDoc = store.listRequirementDocs(enProj.id)[0]!;
    expect(enSrsDoc.content).toContain('## 1. Project Background, Goals & Scope Boundaries');
    expect(enSrsDoc.content).toContain('BrewBatch');
    expect(enSrsDoc.content).toContain(
      '## 9. Non-Functional Requirements, Integration & Governance Checklist',
    );
    expect(enSrsDoc.content).toContain('### 9.7');
    expect(enSrsDoc.content).toContain('[Pending]');
    expect(enSrsDoc.content).not.toContain('[待确认]');

    // 4. LlmGatewayError produces English remediation when locale is en-US
    const gwErr = new LlmGatewayError({
      providerName: 'Primary Gateway',
      baseUrl: 'http://127.0.0.1:3425/v1',
      model: 'auto/glm-5.3-flash',
      message: 'Connection refused',
      locale: 'en-US',
    });
    const diag = gwErr.toDiagnostic('en-US');
    expect(diag.remediation).toContain('LLM Center');
    expect(diag.remediation).not.toMatch(/[\u4e00-\u9fa5]/);
  });

  it('supports cancelling an in-flight SRS synthesis Agent Run and resuming via CONTINUE without data loss', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    const proj = store.createProject({
      name: '茶饮门店工单平台',
      code: 'TEA-OPS',
      domain: '新茶饮门店运营',
      template: 'EMPTY',
    });
    const reqSess = store.createRequirementSession({
      projectId: proj.id,
      title: '茶饮需求探索',
    });
    const agentSess = store.createAgentSession({
      projectId: proj.id,
      agentKind: 'REQUIREMENT',
      targetId: reqSess.id,
      title: '茶饮 SRS 合成会话',
    });

    // Abort immediately upon session_meta before save_synthesized_srs_doc executes
    for await (const ev of runUnifiedAgentSessionStream(store, {
      sessionId: agentSess.id,
      prompt: `[ACTION:SYNTHESIZE_SRS {"requirementSessionId":"${reqSess.id}"}]\n合成 9 章节 SRS`,
      mockMode: true,
    })) {
      if (ev.event === 'session_meta') {
        abortActiveAgentSession(agentSess.id);
      }
    }
    const afterCancel = store.getAgentSession(agentSess.id)!;
    expect(afterCancel.status).toBe('IDLE');
    expect(afterCancel.messages.at(-1)?.cancelled).toBe(true);
    expect(store.listRequirementDocs(proj.id)).toHaveLength(0);

    // Resuming with mode: 'CONTINUE' (empty prompt) resolves the prior [ACTION:SYNTHESIZE_SRS] and completes!
    const resumed = await collectUnifiedAgentTurn(store, {
      sessionId: agentSess.id,
      mode: 'CONTINUE',
      mockMode: true,
    });
    expect(
      resumed.session.messages.at(-1)?.artifacts?.some((a) => a.kind === 'REQUIREMENT_DOC'),
    ).toBe(true);
    const savedDocs = store.listRequirementDocs(proj.id);
    expect(savedDocs).toHaveLength(1);
    expect(savedDocs[0]!.content).toContain('## 9.');
  });

  it('never mutates suite.MU during prototype generation/refinement and synthesizes ontology from the Confirmed Revision when prototypeId is omitted', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });

    // 1. On proj-contract (which has 11 models), refining a prototype via PROTOTYPE_CO_DESIGN MUST NOT mutate suite.MU
    const beforeContractMu = JSON.stringify(store.getProject('proj-contract')!.suite.MU);
    const seedProto = store.listPrototypes('proj-contract')[0]!;
    const seedCoDesign = ensurePrototypeCoDesignSession(store, 'proj-contract', seedProto.id);
    await collectUnifiedAgentTurn(store, {
      sessionId: seedCoDesign.id,
      prompt: '增加实验性合同批量作废危险按钮',
      mockMode: true,
    });
    const updatedSeedProto = store.getPrototype(seedProto.id)!;
    expect(updatedSeedProto.revisions).toHaveLength(2);
    expect(updatedSeedProto.aheadOfConfirmedCount).toBe(1);
    expect(JSON.stringify(store.getProject('proj-contract')!.suite.MU)).toBe(beforeContractMu);

    // 2. When prototypeId is omitted, synthesize_ontology_suite MUST read Confirmed Revision, NOT newest unconfirmed revision/prototype
    const proj = store.createProject({
      name: '设备巡检协同平台',
      code: 'EAM-INSP',
      domain: '工业设备点巡检',
      template: 'EMPTY',
    });

    const protoA = store.createPrototype(proj.id, {
      name: '巡检方向 A',
      htmlContent:
        '<section data-screen-id="SCR-INSP-TASK" data-screen-name="巡检工单台账"><input data-element-id="EL-TASK-CODE" data-binding="InspectionTask.taskCode" /><button data-element-id="EL-COMPLETE" data-event-id="EVT-INSP-DONE">提交巡检</button></section>',
      source: 'GENERATED',
    });
    store.confirmPrototypeRevision(proj.id, protoA.revision.id);

    // Append an unconfirmed experimental revision 2 on protoA
    store.appendPrototypeRevision(protoA.prototype.id, {
      htmlContent:
        '<section data-screen-id="SCR-UNCONFIRMED-EXP" data-screen-name="未确认实验屏"><input data-element-id="EL-EXP" data-binding="UnconfirmedExperiment.expCode" /></section>',
      instruction: '临时尝试完全不同的实验聚合',
      source: 'REFINED',
    });

    // Also create a brand-new unconfirmed prototype B (which sits at listPrototypes(proj.id)[0]!)
    store.createPrototype(proj.id, {
      name: '巡检方向 B（未确认最新行）',
      htmlContent:
        '<section data-screen-id="SCR-NEWER-DRAFT" data-screen-name="未确认方向B"><input data-element-id="EL-DRAFT" data-binding="UnconfirmedDirectionB.draftCode" /></section>',
      source: 'GENERATED',
    });
    expect(store.listPrototypes(proj.id)[0]!.name).toBe('巡检方向 B（未确认最新行）');

    const copilotSess = store.createAgentSession({
      projectId: proj.id,
      agentKind: 'COPILOT',
      title: 'EAM 11-Model Synthesis',
    });
    await collectUnifiedAgentTurn(store, {
      sessionId: copilotSess.id,
      prompt: '[ACTION:SYNTHESIZE_ONTOLOGY_SUITE {}]\n从已确认原型版本合成 11 模型本体',
      mockMode: true,
    });
    const synthProj = store.getProject(proj.id)!;
    expect(synthProj.validation.errorCount).toBe(0);
    const aggNames = synthProj.suite.M1!.aggregates.map((a) => a.name);
    expect(aggNames).toContain('InspectionTask');
    expect(aggNames).not.toContain('UnconfirmedExperiment');
    expect(aggNames).not.toContain('UnconfirmedDirectionB');
    expect(synthProj.suite.MU?.screens.map((s) => s.screenId)).toContain('SCR-INSP-TASK');
    expect(synthProj.suite.MU?.screens.map((s) => s.screenId)).not.toContain('SCR-NEWER-DRAFT');
  }, 30000);
});
