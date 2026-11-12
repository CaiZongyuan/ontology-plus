import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { createWorkspaceStore } from '../../workspace-store/index.js';
import { collectUnifiedAgentTurn } from '../index.js';

/**
 * A local OpenAI-compatible gateway that answers each step of a turn with the
 * next scripted reply: a `run_readonly_sql` tool call, or closing text.
 */
async function startScriptedGateway(script: ({ sql: string } | { text: string })[]) {
  const requests: { messages: { role: string; content: unknown }[] }[] = [];
  let step = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      requests.push(JSON.parse(body));
      const reply = script[Math.min(step, script.length - 1)]!;
      step += 1;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunk = (delta: unknown, finish: string | null) =>
        res.write(
          `data: ${JSON.stringify({
            id: `cmpl-${step}`,
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta, finish_reason: finish }],
          })}\n\n`,
        );
      if ('sql' in reply) {
        chunk(
          {
            tool_calls: [
              {
                index: 0,
                id: `call_sql_${step}`,
                type: 'function',
                function: { name: 'run_readonly_sql', arguments: JSON.stringify({ sql: reply.sql }) },
              },
            ],
          },
          null,
        );
        chunk({}, 'tool_calls');
      } else {
        chunk({ content: reply.text }, 'stop');
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return { server, requests, baseUrl: `http://127.0.0.1:${port}/v1` };
}

function storeWithGateway(baseUrl: string) {
  const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
  for (const p of store.listLlmProviders()) store.deleteLlmProvider(p.id);
  store.saveLlmProvider({
    id: 'prov-reasoning',
    name: 'Scripted Gateway',
    providerType: 'OPENAI_COMPATIBLE',
    baseUrl,
    apiKey: 'test-key',
    defaultModel: 'auto/glm-5.3-flash',
    availableModels: ['auto/glm-5.3-flash'],
    enabled: true,
  });
  return store;
}

const systemPromptOf = (request: { messages: { role: string; content: unknown }[] }): string => {
  const system = request.messages.find((m) => m.role === 'system' || m.role === 'developer');
  return typeof system?.content === 'string' ? system.content : JSON.stringify(system?.content);
};

describe('agent-runtime: grounded Data Ontology Reasoning session', () => {
  it('grounds the agent on the suite, refuses tables outside it, and warns on joins it does not back', async () => {
    const gateway = await startScriptedGateway([
      // 1. Reaches for a workspace-internal table.
      { sql: 'SELECT payload_json FROM workspace_entities LIMIT 5' },
      // 2. Joins two mapped tables on a condition the ontology does not know.
      {
        sql: 'SELECT c.contract_no, cp.company_name FROM t_contract c JOIN t_counterparty cp ON c.contract_no = cp.company_name',
      },
      // 3. Uses the known join.
      {
        sql: 'SELECT cp.company_name, COUNT(c.id) AS contract_cnt FROM t_contract c JOIN t_counterparty cp ON c.counterparty_id = cp.id GROUP BY cp.company_name',
      },
      { text: '已按相对方统计合同数量。' },
    ]);

    try {
      const store = storeWithGateway(gateway.baseUrl);
      const session = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'REASONING',
        title: '有据问数',
        providerId: 'prov-reasoning',
      });
      const turn = await collectUnifiedAgentTurn(store, {
        sessionId: session.id,
        prompt: '按相对方统计合同数量',
        mockMode: false,
      });

      // The agent was told what it may query: whole tables, and how they join.
      const prompt = systemPromptOf(gateway.requests[0]!);
      const contractMapping = store
        .getProject('proj-contract')!
        .suite.MM!.mappings.flatMap((m) => m.tableMappings)
        .find((tm) => tm.tableName === 't_contract')!;
      expect(contractMapping.columnMappings.length).toBeGreaterThan(6);
      for (const cm of contractMapping.columnMappings) expect(prompt).toContain(cm.column);
      expect(prompt).toContain('t_contract.counterparty_id = t_counterparty.id');
      expect(prompt).toContain(store.getProject('proj-contract')!.suite.M7!.query_reports[0]!.id);

      const sqlCalls = turn.session.messages
        .flatMap((m) => m.toolCalls ?? [])
        .filter((t) => t.toolName === 'run_readonly_sql');
      expect(sqlCalls).toHaveLength(3);

      // 1. Refused before running, with the tables to choose from.
      expect(sqlCalls[0]!.isError).toBe(true);
      expect(sqlCalls[0]!.output).toContain('workspace_entities');
      expect(sqlCalls[0]!.output).toContain('t_contract');
      expect(sqlCalls[0]!.output).toContain('t_counterparty');

      // 2. Ran, and the result carries the warning with the join the ontology does know.
      expect(sqlCalls[1]!.isError).toBe(false);
      expect(sqlCalls[1]!.output).toContain('t_contract.contract_no = t_counterparty.company_name');
      expect(sqlCalls[1]!.output).toContain('t_contract.counterparty_id = t_counterparty.id');

      // 3. A grounded query runs clean.
      expect(sqlCalls[2]!.isError).toBe(false);
      expect(sqlCalls[2]!.output).not.toContain('t_contract.counterparty_id = t_counterparty.id');

      // The refusal and the warning went back to the model so it could correct itself.
      const fedBack = JSON.stringify(gateway.requests.slice(1).map((r) => r.messages));
      expect(fedBack).toContain('availableTables');
      expect(fedBack).toContain('groundingWarnings');

      expect(turn.session.messages.at(-1)?.content).toContain('已按相对方统计合同数量');
      expect(turn.session.messages.at(-1)?.errorDiagnostic).toBeUndefined();
    } finally {
      gateway.server.close();
    }
  }, 20000);

  it('tells the agent which model is missing when the project cannot ground a query', async () => {
    const gateway = await startScriptedGateway([{ text: '当前工程缺少映射模型，无法取数。' }]);
    try {
      const store = storeWithGateway(gateway.baseUrl);
      const empty = store.createProject({
        name: '空白工程',
        code: 'EMPTY_GROUNDING',
        domain: '测试',
        template: 'EMPTY',
      });
      const session = store.createAgentSession({
        projectId: empty.id,
        agentKind: 'REASONING',
        title: '缺模型',
        providerId: 'prov-reasoning',
      });
      await collectUnifiedAgentTurn(store, {
        sessionId: session.id,
        prompt: '本月订单总额是多少',
        mockMode: false,
      });

      const prompt = systemPromptOf(gateway.requests[0]!);
      expect(prompt).toMatch(/缺少 MM|has no MM/);
      expect(prompt).toMatch(/缺少 M7|has no M7/);
    } finally {
      gateway.server.close();
    }
  }, 20000);

  it('renders multi-hop join paths in both locales and guides bogus non-adjacent joins through intermediate tables', async () => {
    const gateway = await startScriptedGateway([
      {
        sql: 'SELECT li.item_name, cp.company_name FROM t_contract_line_item li JOIN t_counterparty cp ON li.item_name = cp.company_name',
      },
      { text: 'Should join via t_contract.' },
      {
        sql: 'SELECT li.item_name, cp.company_name FROM t_contract_line_item li JOIN t_counterparty cp ON li.item_name = cp.company_name',
      },
      { text: '需经中间表 t_contract 关联。' },
    ]);
    try {
      const store = storeWithGateway(gateway.baseUrl);
      const sessionEn = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'REASONING',
        title: 'Multi-hop grounding',
        providerId: 'prov-reasoning',
      });
      const turnEn = await collectUnifiedAgentTurn(store, {
        sessionId: sessionEn.id,
        prompt: 'Break down contract line items by counterparty',
        locale: 'en-US',
        mockMode: false,
      });

      const promptEn = systemPromptOf(gateway.requests[0]!);
      expect(promptEn).toContain('Multi-hop join paths');
      expect(promptEn).toContain(
        't_contract_line_item <-> t_counterparty: t_contract_line_item.contract_id = t_contract.id -> t_contract.counterparty_id = t_counterparty.id',
      );
      const sqlCallEn = turnEn.session.messages
        .flatMap((m) => m.toolCalls ?? [])
        .find((t) => t.toolName === 'run_readonly_sql')!;
      expect(sqlCallEn.output).toContain('no direct join');
      expect(sqlCallEn.output).toContain('t_contract');
      expect(sqlCallEn.output).toContain(
        't_contract_line_item.contract_id = t_contract.id -> t_contract.counterparty_id = t_counterparty.id',
      );

      const sessionZh = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'REASONING',
        title: '多跳路径问数',
        providerId: 'prov-reasoning',
      });
      const turnZh = await collectUnifiedAgentTurn(store, {
        sessionId: sessionZh.id,
        prompt: '按相对方统计合同标的明细',
        locale: 'zh-CN',
        mockMode: false,
      });

      const promptZh = systemPromptOf(gateway.requests[2]!);
      expect(promptZh).toContain('多跳关联路径');
      expect(promptZh).toContain(
        't_contract_line_item <-> t_counterparty: t_contract_line_item.contract_id = t_contract.id -> t_contract.counterparty_id = t_counterparty.id',
      );
      const sqlCallZh = turnZh.session.messages
        .flatMap((m) => m.toolCalls ?? [])
        .find((t) => t.toolName === 'run_readonly_sql')!;
      expect(sqlCallZh.output).toContain('没有直接连接');
      expect(sqlCallZh.output).toContain('t_contract');
      expect(sqlCallZh.output).toContain(
        't_contract_line_item.contract_id = t_contract.id -> t_contract.counterparty_id = t_counterparty.id',
      );
    } finally {
      gateway.server.close();
    }
  }, 20000);
});
