import { describe, expect, it } from 'vitest';
import { createWorkspaceStore } from '../../workspace-store/index.js';
import {
  runDataOntologyReasoning,
  runOntologyCopilotTurn,
  runRequirementGrillingTurn,
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
    expect(reasoning.mode).toBe('ASK_POLICY');
    expect(reasoning.policyRecommendations[0].writebackInterfaceId).toBe('WB-01');
  }, 40000);
});

