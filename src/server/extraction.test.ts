import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ExtractionCandidate,
  SemanticAlignmentReport,
  ValidationDiagnostic,
} from '../packages/ontology-core/index.js';
import {
  createWorkspaceStore,
  type ExtractionJob,
  type ProjectDetail,
} from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';

const ORDER_DDL = `CREATE TABLE t_customer (
  id VARCHAR(36) PRIMARY KEY,
  customer_name VARCHAR(128) NOT NULL
);
CREATE TABLE t_sales_order (
  id VARCHAR(36) PRIMARY KEY,
  order_no VARCHAR(32) NOT NULL UNIQUE,
  customer_id VARCHAR(36) NOT NULL,
  total_amount DECIMAL(18,2) NOT NULL
);`;

const POLICY_DOC = [
  '# 采购合同管理制度',
  '',
  '采购合同由采购专员起草，合同金额超过 100 万元的须经财务总监审批。',
  '合同签署后生成付款计划，并通知供应商。',
].join('\n');

interface JobResponse {
  job: ExtractionJob;
  project: ProjectDetail;
  blockedBy: ValidationDiagnostic[];
  extractionJobs: ExtractionJob[];
  code?: string;
  error?: string;
  diagnostic?: { code: string; providerName: string; message: string };
}

type TestApp = ReturnType<typeof createApiApp>;

function setup() {
  const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
  return { store, app: createApiApp(store) };
}

/** Live mode against a stubbed OpenAI-compatible gateway. Returns the request bodies it saw. */
function setupLive(reply: string | Error) {
  process.env.ONTOLOGY_LIVE_LLM = '1';
  const ctx = setup();
  ctx.store.updateSystemSettings({ mockLlmMode: false });
  for (const existing of ctx.store.listLlmProviders()) {
    ctx.store.saveLlmProvider({ ...existing, enabled: false });
  }
  ctx.store.saveLlmProvider({
    id: 'prov-test-extraction',
    name: 'Test Extraction Gateway',
    providerType: 'OPENAI_COMPATIBLE',
    baseUrl: 'http://127.0.0.1:19997/v1',
    apiKey: 'sk-test',
    defaultModel: 'auto/glm-5.3-flash',
    availableModels: ['auto/glm-5.3-flash'],
    enabled: true,
  });

  const requests: { messages: { role: string; content: string }[] }[] = [];
  const encoder = new TextEncoder();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (typeof init?.body === 'string') requests.push(JSON.parse(init.body));
      if (reply instanceof Error) throw reply;
      const stream = new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`,
            ),
          );
          ctrl.enqueue(encoder.encode('data: [DONE]\n\n'));
          ctrl.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }),
  );
  return { ...ctx, requests };
}

async function createJob(
  app: TestApp,
  overrides: Partial<{
    projectId: string;
    title: string;
    sourceType: ExtractionJob['sourceType'];
    sourceSnippet: string;
    applyImmediately: boolean;
  }> = {},
  extraHeaders: Record<string, string> = {},
) {
  const res = await app.request('/api/capability/extraction-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify({
      systemId: 'sys-mft-transfer',
      projectId: 'proj-mft',
      title: '销售订单本体萃取',
      sourceType: 'DDL_AND_OPENAPI',
      sourceSnippet: ORDER_DDL,
      applyImmediately: false,
      ...overrides,
    }),
  });
  return { status: res.status, json: (await res.json()) as JobResponse };
}

async function decide(app: TestApp, jobId: string, decisions: Record<string, string | null>) {
  const res = await app.request(`/api/capability/extraction-jobs/${jobId}/decisions`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decisions }),
  });
  return { status: res.status, json: (await res.json()) as JobResponse };
}

async function merge(app: TestApp, jobId: string) {
  const res = await app.request(`/api/capability/extraction-jobs/${jobId}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  return { status: res.status, json: (await res.json()) as JobResponse };
}

const all = (candidates: ExtractionCandidate[], decision: 'ACCEPTED' | 'REJECTED') =>
  Object.fromEntries(candidates.map((c) => [c.key, decision]));
const aggregateNames = (project: ProjectDetail) => project.suite.M1!.aggregates.map((a) => a.name);

describe('Ontology Extraction over HTTP: candidates, confirmation, merge gate', () => {
  afterEach(() => {
    delete process.env.ONTOLOGY_LIVE_LLM;
    vi.unstubAllGlobals();
  });

  it('returns candidates with evidence, records confirmations, and merges only what was accepted', async () => {
    const { app, store } = setup();
    const before = aggregateNames(store.getProject('proj-mft')!);

    const created = await createJob(app);
    expect(created.status).toBe(200);
    const { job } = created.json;
    expect(job.appliedToProject).toBe(false);
    expect(job.decisions).toEqual({});
    expect(job.extractedTablesCount).toBe(2);
    expect('candidateSuite' in job).toBe(false);
    expect('confidenceScore' in job).toBe(false);
    expect(job.semanticAlignment).toEqual({ status: 'SKIPPED', reason: 'MOCK_MODE' });

    const order = job.candidates.find((c) => c.key === 'M1/aggregates/AGG-EXT-SALES_ORDER')!;
    expect(order.evidence[0]).toMatchObject({
      origin: 'PARSED',
      lines: { startLine: 5, endLine: 10 },
    });
    expect(order.evidence[0]!.excerpt).toContain('CREATE TABLE t_sales_order');
    // Nothing reached the project yet.
    expect(aggregateNames(store.getProject('proj-mft')!)).toEqual(before);

    // Accept everything about Customer, reject everything about SalesOrder.
    const decisions = Object.fromEntries(
      job.candidates.map((c) => [c.key, c.key.includes('SALES_ORDER') ? 'REJECTED' : 'ACCEPTED']),
    );
    const saved = await decide(app, job.id, { ...decisions, 'M1/aggregates/NOT-A-CANDIDATE': 'ACCEPTED' });
    expect(saved.status).toBe(200);
    expect(saved.json.job.decisions).toEqual(decisions);

    // Confirmations persist on the job.
    const bootstrap = (await (await app.request('/api/bootstrap')).json()) as {
      extractionJobs: ExtractionJob[];
    };
    expect(bootstrap.extractionJobs.find((j) => j.id === job.id)!.decisions).toEqual(decisions);

    const merged = await merge(app, job.id);
    expect(merged.status).toBe(200);
    expect(merged.json.blockedBy).toEqual([]);
    expect(merged.json.job.status).toBe('REVIEWED');
    expect(merged.json.job.appliedToProject).toBe(true);
    expect(merged.json.job.appliedCandidateCount).toBe(
      Object.values(decisions).filter((d) => d === 'ACCEPTED').length,
    );
    expect(aggregateNames(merged.json.project)).toEqual([...before, 'Customer']);
    expect(merged.json.project.validation.errorCount).toBe(0);

    // A merged job is closed to further confirmation and merging.
    expect((await decide(app, job.id, { [order.key]: 'ACCEPTED' })).status).toBe(409);
    const again = await merge(app, job.id);
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('ALREADY_MERGED');
  });

  it('merges into the suite as it is at merge time, keeping edits made after the extraction', async () => {
    const { app, store } = setup();
    const { job } = (await createJob(app)).json;

    // The project is edited while the job waits for review.
    const edited = store.getProject('proj-mft')!.suite;
    edited.M1!.aggregates[0]!.alias = '萃取之后人工修改的别名';
    store.updateSuite('proj-mft', edited, 'Manual edit after extraction');

    await decide(app, job.id, all(job.candidates, 'ACCEPTED'));
    const merged = await merge(app, job.id);
    expect(merged.status).toBe(200);
    expect(merged.json.project.suite.M1!.aggregates[0]!.alias).toBe('萃取之后人工修改的别名');
    expect(aggregateNames(merged.json.project)).toEqual(
      expect.arrayContaining(['Customer', 'SalesOrder']),
    );
  });

  it('refuses a merge that would introduce Consistency Errors, names the elements, and writes nothing', async () => {
    const { app, store } = setup();
    const { job } = (await createJob(app)).json;
    const before = JSON.stringify(store.getProject('proj-mft')!.suite);

    // Nothing accepted yet: there is nothing to merge.
    const empty = await merge(app, job.id);
    expect(empty.status).toBe(400);
    expect(empty.json.code).toBe('NOTHING_ACCEPTED');

    // Keep the behaviors of SalesOrder but reject the aggregate they belong to.
    await decide(app, job.id, {
      ...all(job.candidates, 'ACCEPTED'),
      'M1/aggregates/AGG-EXT-SALES_ORDER': 'REJECTED',
    });
    const blocked = await merge(app, job.id);
    expect(blocked.status).toBe(409);
    expect(blocked.json.code).toBe('MERGE_BLOCKED');
    expect(blocked.json.blockedBy.length).toBeGreaterThan(0);
    expect(blocked.json.blockedBy.every((d) => d.tier === 'ERROR')).toBe(true);
    expect(blocked.json.blockedBy.map((d) => `${d.elementId} ${d.messageZh}`).join('\n')).toContain(
      'SalesOrder',
    );
    expect(blocked.json.job.appliedToProject).toBe(false);
    expect(JSON.stringify(store.getProject('proj-mft')!.suite)).toBe(before);

    // The reviewer decides how to resolve it; here by accepting the aggregate.
    await decide(app, job.id, { 'M1/aggregates/AGG-EXT-SALES_ORDER': 'ACCEPTED' });
    const merged = await merge(app, job.id);
    expect(merged.status).toBe(200);
    expect(merged.json.project.validation.errorCount).toBe(0);
  });

  it('"merge immediately" accepts every candidate in one step through the same gate', async () => {
    const { app } = setup();
    const created = await createJob(app, { applyImmediately: true });
    expect(created.status).toBe(200);
    const { job, project, blockedBy } = created.json;
    expect(blockedBy).toEqual([]);
    expect(job.appliedToProject).toBe(true);
    expect(job.appliedCandidateCount).toBe(job.candidates.length);
    expect(Object.values(job.decisions).every((d) => d === 'ACCEPTED')).toBe(true);
    expect(aggregateNames(project)).toEqual(expect.arrayContaining(['Customer', 'SalesOrder']));
    expect(project.validation.errorCount).toBe(0);
  });

  it('"merge immediately" falls back to pending confirmation when the gate blocks the merge, leaving the project untouched', async () => {
    const { app, store } = setup();
    const stagedProj = store.createProject({
      name: '阶段行为测试工程',
      code: 'STAGE_GATE_TEST',
      domain: '测试',
      template: 'EMPTY',
    });
    const baselineSuite = {
      M2: { model_type: 'BEHAVIOR' as const, version: '5.0' as const, domain: '测试', behaviors: [] },
    };
    store.updateSuite(stagedProj.id, baselineSuite, 'Initialize empty M2 behavior model');
    expect(store.getProject(stagedProj.id)!.validation.errorCount).toBe(0);

    const created = await createJob(app, {
      projectId: stagedProj.id,
      sourceSnippet: 'POST /api/v1/orders -> createOrder',
      applyImmediately: true,
    });
    expect(created.status).toBe(200);
    const { job, project, blockedBy } = created.json;
    expect(job.appliedToProject).toBe(false);
    expect(blockedBy.length).toBeGreaterThan(0);
    expect(blockedBy.every((d) => d.tier === 'ERROR')).toBe(true);
    expect(blockedBy.map((d) => d.elementId).join(',')).toContain('IF-EXT-POST_API_V1_ORDERS');
    expect(project.suite).toEqual(baselineSuite);
    expect(store.getProject(stagedProj.id)!.suite).toEqual(baselineSuite);
  });

  it('respects an explicit X-Onto-Locale: zh-CN header even when the DDL snippet and title are pure ASCII', async () => {
    const { app } = setup();
    const created = await createJob(
      app,
      { title: 'Sales Order DDL Extraction', sourceSnippet: ORDER_DDL },
      { 'X-Onto-Locale': 'zh-CN' },
    );
    expect(created.status).toBe(200);
    expect(created.json.job.summary).toContain('本体萃取完成');
    expect(created.json.job.summary).not.toContain('Ontology Extraction finished');
  });
});

describe('Ontology Extraction over HTTP: semantic alignment', () => {
  afterEach(() => {
    delete process.env.ONTOLOGY_LIVE_LLM;
    vi.unstubAllGlobals();
  });

  const alignmentOf = (job: ExtractionJob): SemanticAlignmentReport => job.semanticAlignment;

  it('adds labels and an inferred reference as its own candidate, in a single LLM call', async () => {
    const { app, requests } = setupLive(
      JSON.stringify({
        tables: [
          {
            table: 't_sales_order',
            alias: '销售订单',
            description: '客户下达的销售订单。',
            columns: [
              { column: 'customer_id', label: '下单客户', refTable: 't_customer' },
              { column: 'order_no', label: '订单编号', refTable: null },
            ],
          },
          { table: 't_customer', alias: '客户', columns: [] },
        ],
      }),
    );

    const { status, json } = await createJob(app);
    expect(status).toBe(200);
    expect(requests).toHaveLength(1);
    expect(alignmentOf(json.job)).toEqual({ status: 'DONE' });

    const order = json.job.candidates.find((c) => c.elementId === 'AGG-EXT-SALES_ORDER')!;
    expect(order.element).toMatchObject({ alias: '销售订单', description: '客户下达的销售订单。' });
    expect(order.evidence.map((e) => e.origin)).toEqual(['PARSED', 'INFERRED']);

    const inferred = json.job.candidates.find(
      (c) => c.elementId === 'ASSOC-INF-SALES_ORDER-CUSTOMERID',
    )!;
    expect(inferred.element).toMatchObject({
      sourceAggregate: 'SalesOrder',
      targetAggregate: 'Customer',
    });
    expect(inferred.evidence[0]).toMatchObject({
      origin: 'INFERRED',
      lines: { startLine: 8, endLine: 8 },
    });

    // An inference is a candidate like any other: it can be turned down on its own.
    await decide(app, json.job.id, {
      ...all(json.job.candidates, 'ACCEPTED'),
      [inferred.key]: 'REJECTED',
    });
    const merged = await merge(app, json.job.id);
    expect(merged.status).toBe(200);
    expect(
      merged.json.project.suite.M1!.aggregate_associations.some((a) => a.id === inferred.elementId),
    ).toBe(false);
    expect(aggregateNames(merged.json.project)).toContain('SalesOrder');
  });

  it('drops what the LLM invents and records why, keeping the rest', async () => {
    const { app } = setupLive(
      JSON.stringify({
        tables: [
          {
            table: 't_sales_order',
            alias: '销售订单',
            columns: [{ column: 'customer_id', label: '客户', refTable: 't_warehouse' }],
          },
          { table: 't_invented', alias: '编造的表' },
        ],
      }),
    );

    const { json } = await createJob(app);
    const report = alignmentOf(json.job);
    expect(report.status).toBe('DONE');
    expect(report.dropped?.map((d) => d.item)).toEqual([
      't_sales_order.customer_id → t_warehouse',
      't_invented',
    ]);
    expect(json.job.candidates.some((c) => c.elementId.startsWith('ASSOC-INF-'))).toBe(false);
    expect(
      json.job.candidates.find((c) => c.elementId === 'AGG-EXT-SALES_ORDER')!.element,
    ).toMatchObject({ alias: '销售订单' });
  });

  it('returns the structural scan, labelled as such, when the LLM answer is unusable', async () => {
    const { app } = setupLive('抱歉，我无法处理这个请求。');
    const { status, json } = await createJob(app);
    expect(status).toBe(200);
    const report = alignmentOf(json.job);
    expect(report.status).toBe('FAILED');
    expect(report.reason).toBe('UNUSABLE_RESPONSE');
    expect(report.dropped).toHaveLength(1);
    expect(json.job.summary).toMatch(/仅结构扫描|structural scan only/);
    expect(json.job.candidates.some((c) => c.elementId === 'AGG-EXT-SALES_ORDER')).toBe(true);
    expect(json.job.candidates.every((c) => c.evidence.every((e) => e.origin === 'PARSED'))).toBe(true);
  });

  it('returns the structural scan with provider diagnostics when the gateway is down', async () => {
    const { app } = setupLive(new TypeError('fetch failed'));
    const { status, json } = await createJob(app);
    expect(status).toBe(200);
    const report = alignmentOf(json.job);
    expect(report.status).toBe('FAILED');
    expect(report.reason).toBe('GATEWAY_ERROR');
    expect(report.diagnostic?.providerName).toBe('Test Extraction Gateway');
    expect(report.diagnostic?.message).toBeTruthy();
    expect(json.job.summary).toMatch(/仅结构扫描|structural scan only/);
    expect(json.job.candidates.some((c) => c.elementId === 'AGG-EXT-CUSTOMER')).toBe(true);
  }, 20000);

  it('marks semantic alignment DONE when the LLM returns a valid tables array with no extra labels or inferred references', async () => {
    const { app } = setupLive(
      JSON.stringify({
        tables: [
          {
            table: 't_sales_order',
            columns: [{ column: 'customer_id', refTable: null }],
          },
          { table: 't_customer', columns: [] },
        ],
      }),
    );
    const { status, json } = await createJob(app);
    expect(status).toBe(200);
    expect(alignmentOf(json.job)).toEqual({ status: 'DONE' });
    expect(json.job.summary).toMatch(/结构扫描 \+ 语义对齐|structural scan \+ semantic alignment/);
  });
});

describe('Ontology Extraction over HTTP: prose sources', () => {
  afterEach(() => {
    delete process.env.ONTOLOGY_LIVE_LLM;
    vi.unstubAllGlobals();
  });

  it('turns an LLM blueprint into candidates that cite the passage they rest on', async () => {
    const { app, store } = setupLive(
      JSON.stringify({
        aggregates: [
          {
            sourceQuote: '采购合同由采购专员起草',
            name: 'PurchaseContract',
            alias: '采购合同',
            attributes: [{ name: 'amount', label: '合同金额', type: 'Decimal', required: true }],
          },
          {
            sourceQuote: '供应商须通过年度资质审核',
            name: 'SupplierAudit',
            alias: '供应商审核',
            attributes: [{ name: 'result', label: '审核结果', type: 'String', required: true }],
          },
        ],
        behaviors: [
          {
            sourceQuote: '合同签署后生成付款计划',
            name: 'signContract',
            alias: '签署合同',
            ownerEntity: 'PurchaseContract',
            behaviorType: 'COMMAND',
          },
        ],
      }),
    );
    const before = JSON.stringify(store.getProject('proj-mft')!.suite);

    const { status, json } = await createJob(app, {
      sourceType: 'LOG_AND_DOC',
      sourceSnippet: POLICY_DOC,
    });
    expect(status).toBe(200);
    expect(json.job.semanticAlignment.status).toBe('DONE');
    expect(json.job.extractedTablesCount).toBe(0);
    expect(JSON.stringify(store.getProject('proj-mft')!.suite)).toBe(before);

    const byName = (name: string) =>
      json.job.candidates.find(
        (c) => c.collection === 'aggregates' && (c.element as { name: string }).name === name,
      )!;
    const contract = byName('PurchaseContract');
    expect(contract.evidence).toHaveLength(1);
    expect(contract.evidence[0]).toMatchObject({
      origin: 'INFERRED',
      lines: { startLine: 3, endLine: 3 },
    });
    expect(contract.evidence[0]!.excerpt).toContain('采购合同由采购专员起草');
    expect(contract.evidence[0]!.unverified).toBeUndefined();

    // A quote that is not in the source never becomes an excerpt.
    const audit = byName('SupplierAudit');
    expect(audit.evidence[0]!.unverified).toBe(true);
    expect(audit.evidence[0]!.excerpt).toBeUndefined();
    expect(audit.evidence[0]!.lines).toBeUndefined();

    const behavior = json.job.candidates.find(
      (c) => c.collection === 'behaviors' && (c.element as { name: string }).name === 'signContract',
    )!;
    expect(behavior.evidence[0]!.lines).toEqual({ startLine: 4, endLine: 4 });
  });

  it('fails outright, with provider diagnostics, when the gateway is down and nothing was scanned', async () => {
    const { app, store } = setupLive(new TypeError('fetch failed'));
    const jobsBefore = store.listExtractionJobs().length;

    const { status, json } = await createJob(app, {
      sourceType: 'LOG_AND_DOC',
      sourceSnippet: POLICY_DOC,
    });
    expect(status).toBe(503);
    expect(json.diagnostic?.code).toBe('LLM_GATEWAY_ERROR');
    expect(json.diagnostic?.providerName).toBe('Test Extraction Gateway');
    expect(store.listExtractionJobs()).toHaveLength(jobsBefore);
  }, 20000);

  it('fails outright when the LLM returns nothing that can be extracted', async () => {
    const { app, store } = setupLive('这份文档没有可以萃取的内容。');
    const jobsBefore = store.listExtractionJobs().length;
    const { status, json } = await createJob(app, {
      sourceType: 'LOG_AND_DOC',
      sourceSnippet: POLICY_DOC,
    });
    expect(status).toBe(503);
    expect(json.diagnostic?.code).toBe('LLM_GATEWAY_ERROR');
    expect(store.listExtractionJobs()).toHaveLength(jobsBefore);
  });

  it('assigns non-colliding *-DOC-* IDs, attaches M5 actor/role evidence, and omits synthetic MU/AuditLog bloat', async () => {
    const { app, store } = setupLive(
      JSON.stringify({
        aggregates: [
          {
            sourceQuote: '采购合同由采购专员起草',
            name: 'PurchaseContract',
            alias: '采购合同',
            attributes: [{ name: 'amount', label: '合同金额', type: 'Decimal', required: true }],
          },
        ],
        actors: [
          {
            sourceQuote: '采购合同由采购专员起草',
            actorName: '采购专员',
            roleName: '采购经办',
            roleCode: 'PROCUREMENT_SPEC',
          },
        ],
        behaviors: [
          {
            sourceQuote: '合同签署后生成付款计划',
            name: 'signContract',
            alias: '签署合同',
            ownerEntity: 'PurchaseContract',
            behaviorType: 'COMMAND',
          },
        ],
        rules: [
          {
            sourceQuote: '合同金额超过 100 万元的须经财务总监审批',
            name: 'HighValueApprovalRule',
            alias: '大额合同审批规则',
            ruleType: 'VALIDATION',
            referencedObjects: ['PurchaseContract'],
            expression: 'amount <= 1000000',
            violationMessage: '须经财务总监审批',
          },
        ],
      }),
    );
    const baselineAggIds = new Set(store.getProject('proj-mft')!.suite.M1!.aggregates.map((a) => a.id));

    const { status, json } = await createJob(app, {
      sourceType: 'LOG_AND_DOC',
      sourceSnippet: POLICY_DOC,
    });
    expect(status).toBe(200);

    const contract = json.job.candidates.find(
      (c) => c.collection === 'aggregates' && (c.element as { name: string }).name === 'PurchaseContract',
    )!;
    expect(contract.change).toBe('ADDED');
    expect(contract.elementId).toMatch(/^AGG-DOC-/);
    expect(baselineAggIds.has(contract.elementId)).toBe(false);

    const behavior = json.job.candidates.find(
      (c) => c.collection === 'behaviors' && (c.element as { name: string }).name === 'signContract',
    )!;
    expect(behavior.change).toBe('ADDED');
    expect(behavior.elementId).toMatch(/^BHV-DOC-/);

    const rule = json.job.candidates.find(
      (c) => c.collection === 'rules' && (c.element as { name: string }).name === 'HighValueApprovalRule',
    )!;
    expect(rule.change).toBe('ADDED');
    expect(rule.elementId).toMatch(/^RULE-DOC-/);

    const actor = json.job.candidates.find(
      (c) => c.modelCode === 'M5' && c.collection === 'actors' && (c.element as { name: string }).name === '采购专员',
    )!;
    expect(actor.change).toBe('ADDED');
    expect(actor.elementId).toMatch(/^ACT-DOC-/);
    expect(actor.evidence).toHaveLength(1);
    expect(actor.evidence[0]).toMatchObject({
      origin: 'INFERRED',
      lines: { startLine: 3, endLine: 3 },
    });

    const role = json.job.candidates.find(
      (c) => c.modelCode === 'M5' && c.collection === 'roles' && (c.element as { name: string }).name === '采购经办',
    )!;
    expect(role.change).toBe('ADDED');
    expect(role.elementId).toMatch(/^ROLE-DOC-/);
    expect(role.evidence).toHaveLength(1);
    expect(role.evidence[0]).toMatchObject({
      origin: 'INFERRED',
      lines: { startLine: 3, endLine: 3 },
    });

    // No synthetic AuditLog aggregate, MU screens, or M4 scenarios injected into prose extraction.
    expect(
      json.job.candidates.some(
        (c) =>
          c.modelCode === 'MU' ||
          c.modelCode === 'M4' ||
          JSON.stringify(c.element).includes('AuditLog'),
      ),
    ).toBe(false);
  });

  it('in Mock mode says the LLM round did not run instead of pretending it did, while producing a reviewable demo candidate', async () => {
    const { app } = setup();
    const { status, json } = await createJob(app, {
      sourceType: 'LOG_AND_DOC',
      sourceSnippet: POLICY_DOC,
    });
    expect(status).toBe(200);
    expect(json.job.semanticAlignment).toEqual({ status: 'SKIPPED', reason: 'MOCK_MODE' });
    expect(json.job.candidates.length).toBeGreaterThan(0);
    expect(json.job.candidates.every((c) => c.evidence.every((e) => e.origin === 'INFERRED'))).toBe(true);
    expect(json.job.candidates[0]!.evidence[0]).toMatchObject({
      origin: 'INFERRED',
      lines: { startLine: 1, endLine: 1 },
    });

    await decide(app, json.job.id, all(json.job.candidates, 'ACCEPTED'));
    const merged = await merge(app, json.job.id);
    expect(merged.status).toBe(200);
    expect(merged.json.project.validation.errorCount).toBe(0);
  });
});
