import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { M1ObjectModelSchema, MMMappingModelSchema, type OntologySuite } from '../../ontology-core/index.js';
import { createWorkspaceStore, type WorkspaceStore } from '../../workspace-store/index.js';
import {
  buildMockMetricInsightToolArgs,
  buildMockScenarioAttributionToolArgs,
  collectUnifiedAgentTurn,
  executeDomainRunToolCall,
  gatherEvidence,
  runGroundedQuery,
  shareBreakdown,
} from '../index.js';

/**
 * #19 regression (TeaCo spec §8.5): Metric Insight and Scenario Attribution take every figure from
 * a grounded query, or give none and say what is missing — in a non-contract domain, without MM,
 * with a failing query, and with an empty table, in both languages.
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** TeaCo order rows (a slice of bb-seed0) in a table the contract demo knows nothing about. */
const ORDERS: [string, string, string, number][] = [
  ['1001', 'RETAIL', 'SHIPPED', 4210],
  ['1002', 'WHOLESALE', 'SHIPPED', 91200],
  ['1003', 'RETAIL', 'PAID', 2860],
  ['1004', 'RETAIL', 'NEW', 3315],
  ['1005', 'WHOLESALE', 'PAID', 37028],
  ['1006', 'RETAIL', 'SHIPPED', 5760],
];

function teacoSuite(table: string): OntologySuite {
  const raw = {
    M1: {
      model_type: 'OBJECT',
      version: '1.0',
      domain: 'TeaCo',
      aggregates: [
        {
          id: 'AGG-ORDER',
          name: 'Order',
          alias: '订单',
          lifecycle: ['NEW', 'PAID', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED'],
          attributes: [
            { name: 'orderNo', label: '订单号', type: 'String', required: true },
            { name: 'channel', label: '渠道', type: 'String', required: true },
            { name: 'status', label: '状态', type: 'String', required: true },
            { name: 'totalCents', label: '金额', type: 'Integer', required: true },
          ],
        },
      ],
    },
    MM: {
      model_type: 'MAPPING',
      version: '1.0',
      domain: 'TeaCo',
      mappings: [
        {
          id: 'MM-ORDER',
          objectRef: 'AGG-ORDER',
          objectRole: 'AGGREGATE_ROOT',
          objectName: 'Order',
          tableMappings: [
            {
              tableName: table,
              tableRole: 'MASTER',
              primaryKey: 'order_no',
              foreignKeys: [],
              columnMappings: [
                { attributeRef: 'Order.orderNo', column: 'order_no', columnType: 'VARCHAR(16)', isPrimaryKey: true },
                { attributeRef: 'Order.channel', column: 'channel', columnType: 'VARCHAR(16)' },
                { attributeRef: 'Order.status', column: 'status', columnType: 'VARCHAR(16)' },
                { attributeRef: 'Order.totalCents', column: 'total_cents', columnType: 'INTEGER' },
              ],
            },
          ],
        },
      ],
    },
  };
  return { M1: M1ObjectModelSchema.parse(raw.M1), MM: MMMappingModelSchema.parse(raw.MM) } as OntologySuite;
}

function setup(rows = ORDERS) {
  const dir = mkdtempSync(join(tmpdir(), 'evidence-'));
  dirs.push(dir);
  const dbPath = join(dir, 'workspace.sqlite');
  const store = createWorkspaceStore({ dbPath, enableFileMirror: false });
  const raw = new DatabaseSync(dbPath);
  raw.exec('CREATE TABLE teaco_orders (order_no TEXT PRIMARY KEY, channel TEXT, status TEXT, total_cents INTEGER)');
  raw.exec('CREATE TABLE teaco_empty (order_no TEXT PRIMARY KEY, channel TEXT, status TEXT, total_cents INTEGER)');
  const insert = raw.prepare('INSERT INTO teaco_orders VALUES (?, ?, ?, ?)');
  for (const r of rows) insert.run(...r);
  raw.close();
  const project = (table: string, withMM = true) => {
    const p = store.createProject({ name: 'TeaCo', code: 'TEACO', domain: '茶叶零售', template: 'EMPTY' });
    const suite = teacoSuite(table);
    return store.updateSuite(p.id, withMM ? suite : { M1: suite.M1 }, 'TeaCo fixture');
  };
  store.saveMetric({
    id: 'MET-TEACO', code: 'MET-TEACO', name: '订单量', category: 'SALES', formula: 'COUNT(order)', unit: '单',
    currentValue: '6', yoYChange: '+0%', status: 'NORMAL', dimensions: ['status'], linkedAggregate: 'Order',
  });
  store.saveAnalyticsScenario({
    id: 'ASCN-TEACO', name: '订单分布', domain: 'TeaCo', triggerCondition: 'open_orders > 30',
    relatedMetrics: ['MET-TEACO'], causalFactors: [], recommendedActions: [], writebackInterfaceId: '',
  });
  return { store, project };
}

const noDefaultPercent = (text: string) => {
  for (const legacy of ['85.0%', '62.0%', '26.5%', '25.0%', 't_contract']) expect(text).not.toContain(legacy);
};

describe('#19 grounded evidence for Metric Insight and Scenario Attribution', () => {
  it('computes shares only from rows the grounding allows, in a non-contract domain', () => {
    const { store, project } = setup();
    const p = project('teaco_orders');
    const evidence = gatherEvidence(store, p, { objectName: 'Order', dimensions: ['status'] }, 'zh-CN');
    expect(evidence.ok).toBe(true);
    if (!evidence.ok) return;
    expect(evidence.sql).toBe('SELECT status AS dimension, COUNT(*) AS record_count FROM teaco_orders GROUP BY status ORDER BY record_count DESC');
    const shares = shareBreakdown(evidence)!;
    expect(shares.rows).toEqual([
      { label: 'SHIPPED', value: 3, share: '50.0%' },
      { label: 'PAID', value: 2, share: '33.3%' },
      { label: 'NEW', value: 1, share: '16.7%' },
    ]);

    for (const locale of ['zh-CN', 'en-US'] as const) {
      const insight = buildMockMetricInsightToolArgs(store, p, 'MET-TEACO', locale);
      expect(insight.ok).toBe(true);
      if (!insight.ok) continue;
      const drivers = insight.args.anomalyDrivers as string[];
      expect(drivers.map((d) => d.match(/\d+\.\d%/)![0])).toEqual(['50.0%', '33.3%', '16.7%']);
      expect(insight.args.evidenceSql).toBe(evidence.sql);
      noDefaultPercent(JSON.stringify(insight.args));
      const attribution = buildMockScenarioAttributionToolArgs(store, p, 'ASCN-TEACO', undefined, true, locale);
      expect(attribution.ok).toBe(true);
      if (!attribution.ok) continue;
      expect((attribution.args.causalBreakdown as { weight: string }[]).map((c) => c.weight)).toEqual(['50.0%', '33.3%', '16.7%']);
      expect(String(attribution.args.attributionMarkdown)).toContain(locale === 'zh-CN' ? '不能证明因果' : 'do not prove causes');
      noDefaultPercent(JSON.stringify(attribution.args));
    }
  });

  it('gives no figures without MM, and says so in the asked language', () => {
    const { store, project } = setup();
    const p = project('teaco_orders', false);
    const zh = buildMockMetricInsightToolArgs(store, p, 'MET-TEACO', 'zh-CN');
    const en = buildMockMetricInsightToolArgs(store, p, 'MET-TEACO', 'en-US');
    expect(zh).toMatchObject({ ok: false, sql: null });
    expect(!zh.ok && zh.message).toContain('缺少 MM');
    expect(!en.ok && en.message).toContain('has no MM');
    expect(!zh.ok && zh.message).not.toMatch(/\d+(\.\d+)?%/);
  });

  it('separates a failing query and an empty table from a real zero', () => {
    const { store, project } = setup();
    const missing = gatherEvidence(store, project('teaco_missing_table'), { objectName: 'Order' }, 'zh-CN');
    expect(missing).toMatchObject({ ok: false, gap: 'QUERY_FAILED' });
    const empty = gatherEvidence(store, project('teaco_empty'), { objectName: 'Order' }, 'en-US');
    expect(empty).toMatchObject({ ok: false, gap: 'EMPTY' });
    expect(!empty.ok && empty.message).toContain('no rows');
    const zeroAttribution = buildMockScenarioAttributionToolArgs(store, project('teaco_empty'), 'ASCN-TEACO', undefined, true, 'zh-CN');
    expect(zeroAttribution.ok).toBe(false);
  });

  it('marks a single group as uncertain instead of weighting it', () => {
    const { store, project } = setup([['1001', 'RETAIL', 'SHIPPED', 4210]]);
    const p = project('teaco_orders');
    const attribution = buildMockScenarioAttributionToolArgs(store, p, 'ASCN-TEACO', undefined, true, 'zh-CN');
    expect(attribution).toMatchObject({ ok: false });
    expect(!attribution.ok && attribution.message).toContain('归因不确定');
    const insight = buildMockMetricInsightToolArgs(store, p, 'MET-TEACO', 'zh-CN');
    expect(insight.ok && (insight.args.anomalyDrivers as string[])[0]).toContain('不计算占比');
  });

  it('refuses to save an insight or a report whose evidence is missing, outside the grounding, or empty', async () => {
    const { store, project } = setup();
    const p = project('teaco_empty');
    const session = store.createAgentSession({ projectId: p.id, agentKind: 'REASONING', title: 'evidence' });
    const reportsBefore = store.listAnalyticsReports().length;
    const save = (toolName: string, args: Record<string, unknown>) =>
      executeDomainRunToolCall(store, session, `tc-${toolName}`, toolName, args, 'zh-CN');
    const insightArgs = { metricId: 'MET-TEACO', insightMarkdown: '订单量上升 85.0%', anomalyDrivers: ['渠道占 62.0%'], suggestedAction: '复核' };
    expect((await save('save_metric_insight', insightArgs))!.isError).toBe(true);
    expect((await save('save_metric_insight', { ...insightArgs, evidenceSql: 'SELECT * FROM t_contract' }))!.trace.output).toContain('必须读取本工程映射的业务表');
    expect((await save('save_metric_insight', { ...insightArgs, evidenceSql: 'SELECT status, COUNT(*) AS n FROM teaco_empty GROUP BY status' }))!.trace.output).toContain('没有任何行');
    const report = await save('save_scenario_attribution_report', {
      scenarioId: 'ASCN-TEACO', attributionMarkdown: '# 归因', causalBreakdown: [{ factor: 'x', weight: '62.0%', evidence: 'none' }],
      evidenceSql: 'SELECT status, COUNT(*) AS n FROM teaco_empty GROUP BY status',
    });
    expect(report!.isError).toBe(true);
    expect(store.listAnalyticsReports().length).toBe(reportsBefore);
    const grounded = runGroundedQuery(store, project('teaco_orders'), 'SELECT channel, SUM(total_cents) AS total FROM teaco_orders GROUP BY channel', 'zh-CN');
    expect(grounded.ok && shareBreakdown(grounded)!.rows.map((r) => r.share)).toEqual(['88.8%', '11.2%']);
  });

  it('runs the whole simulated turn without inventing figures when the evidence is missing', async () => {
    const { store, project } = setup();
    const p = project('teaco_orders', false);
    const session = store.createAgentSession({ projectId: p.id, agentKind: 'REASONING', title: 'no MM' });
    const turn = await collectUnifiedAgentTurn(store as WorkspaceStore, {
      sessionId: session.id,
      prompt: '[ACTION:METRIC_INSIGHT {"metricId":"MET-TEACO"}]\n请解读订单量',
      reasoningMode: 'ASK_WHY',
      mockMode: true,
    });
    const last = turn.session.messages.at(-1)!;
    expect(last.artifacts ?? []).toEqual([]);
    expect(last.content).toContain('缺少 MM');
    expect(last.content).not.toMatch(/\d+\.\d%/);
  }, 20000);
});
