import { describe, expect, it } from 'vitest';
import {
  ALIGNMENT_MAX_TABLES,
  CONTRACT_LIFECYCLE_SUITE,
  MFT_ENTERPRISE_SUITE,
  applyAlignment,
  buildAlignmentSkeleton,
  buildExtractionCandidates,
  classifyCandidates,
  locateQuote,
  parseSourceStructure,
  previewCandidateMerge,
  sanitizeAlignment,
  scanSourceStructure,
  tallyCandidates,
  validateOntologySuite,
  type CandidateDecision,
  type ExtractionCandidate,
  type OntologySuite,
} from '../index.js';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const ORDER_DDL = `CREATE TABLE t_customer (
  id VARCHAR(36) PRIMARY KEY,
  customer_name VARCHAR(128) NOT NULL
);
CREATE TABLE t_sales_order (
  id VARCHAR(36) PRIMARY KEY,
  order_no VARCHAR(32) NOT NULL UNIQUE,
  customer_id VARCHAR(36) NOT NULL,
  warehouse_id INTEGER,
  total_amount DECIMAL(18,2) NOT NULL
);`;

function scanOrders(baseSuite: OntologySuite = {}) {
  const scan = scanSourceStructure({ baseSuite, source: ORDER_DDL, domain: '销售' });
  const candidates = buildExtractionCandidates(baseSuite, scan.suite, scan.evidenceByKey);
  return { scan, candidates };
}

const acceptAll = (candidates: ExtractionCandidate[]): Record<string, CandidateDecision> =>
  Object.fromEntries(candidates.map((c) => [c.key, 'ACCEPTED' as const]));

describe('ontology-core: source structure parsing', () => {
  it('reads inline and constraint-style keys, schema prefixes, quoted names, and line ranges', () => {
    const source = `-- legacy order lines
CREATE TABLE IF NOT EXISTS "sales"."t_order_line" (
  line_id BIGINT NOT NULL,
  contract_id VARCHAR(36),
  qty DECIMAL(18,2) NOT NULL, -- quantity
  CONSTRAINT pk_line PRIMARY KEY (line_id),
  CONSTRAINT fk_line_contract FOREIGN KEY (contract_id) REFERENCES t_contract(id),
  UNIQUE (contract_id, line_id)
);

CREATE TABLE t_tag (id INTEGER PRIMARY KEY, order_line_id BIGINT REFERENCES t_order_line(line_id));`;

    const { tables } = parseSourceStructure(source);
    expect(tables.map((t) => t.tableName)).toEqual(['t_order_line', 't_tag']);

    const line = tables[0]!;
    expect(line.primaryKey).toBe('line_id');
    expect(line.columns.map((c) => c.name)).toEqual(['line_id', 'contract_id', 'qty']);
    expect(line.foreignKeys).toEqual([
      {
        fkName: 'fk_line_contract',
        localColumn: 'contract_id',
        targetTable: 't_contract',
        targetColumn: 'id',
      },
    ]);
    expect(line.lines).toEqual({ startLine: 2, endLine: 9 });

    const tag = tables[1]!;
    expect(tag.columns.find((c) => c.name === 'order_line_id')?.fkTargetTable).toBe('t_order_line');
    expect(tag.lines).toEqual({ startLine: 11, endLine: 11 });
  });

  it('reads OpenAPI paths and inline REST endpoints with the line each sits on', () => {
    const source = `openapi: 3.0.0
paths:
  /api/v1/clusters:
    get:
      operationId: listClusters
      summary: 查询集群
    post:
      summary: 注册集群
-- DELETE /api/v1/clusters/{id} -> 下线集群`;

    const { operations } = parseSourceStructure(source);
    expect(operations.map((o) => `${o.method} ${o.routePath}`)).toEqual([
      'GET /api/v1/clusters',
      'POST /api/v1/clusters',
      'DELETE /api/v1/clusters/{id}',
    ]);
    expect(operations[0]!.lines?.startLine).toBe(4);
    expect(operations[2]!.lines?.startLine).toBe(9);
    expect(operations[2]!.summary).toBe('下线集群');
  });

  it('reads TypeScript interfaces and Prisma models when there is no DDL', () => {
    const source = `export interface SupplierEvaluation {
  id: string;
  supplierCode: string;
  score: number;
  evaluatedAt?: Date;
}

model PurchasePlan {
  planNo String
  budget Decimal?
}`;
    const { tables } = parseSourceStructure(source);
    expect(tables.map((t) => t.tableName)).toEqual(['t_supplier_evaluation', 't_purchase_plan']);
    expect(tables[0]!.columns.map((c) => c.name)).toEqual([
      'id',
      'supplier_code',
      'score',
      'evaluated_at',
    ]);
    expect(tables[0]!.lines).toEqual({ startLine: 1, endLine: 6 });
    // A model without an id gets one, so the aggregate has an identity.
    expect(tables[1]!.columns[0]!.name).toBe('id');
    expect(tables[1]!.columns.find((c) => c.name === 'budget')?.nullable).toBe(true);
  });

  it('reads nothing from prose', () => {
    expect(parseSourceStructure('合同金额超过 100 万需要财务总监审批。')).toEqual({
      tables: [],
      operations: [],
    });
  });
});

describe('ontology-core: extraction candidates and evidence', () => {
  it('turns a structural scan into element-level candidates, each citing its source lines', () => {
    const { candidates } = scanOrders();

    const order = candidates.find((c) => c.elementId === 'AGG-EXT-SALES_ORDER')!;
    expect(order.modelCode).toBe('M1');
    expect(order.collection).toBe('aggregates');
    expect(order.key).toBe('M1/aggregates/AGG-EXT-SALES_ORDER');
    expect(order.change).toBe('ADDED');
    expect(order.evidence).toHaveLength(1);
    expect(order.evidence[0]!.origin).toBe('PARSED');
    expect(order.evidence[0]!.lines).toEqual({ startLine: 5, endLine: 11 });
    expect(order.evidence[0]!.excerpt).toContain('CREATE TABLE t_sales_order');

    expect(new Set(candidates.map((c) => c.modelCode))).toEqual(new Set(['M1', 'M2', 'M7', 'MM']));
    expect(candidates.every((c) => c.evidence.length > 0)).toBe(true);
    expect(tallyCandidates(candidates)).toMatchObject({
      total: candidates.length,
      parsed: candidates.length,
      inferred: 0,
      supplemented: 0,
    });
  });

  it('gives no evidence to elements added only to keep the suite consistent', () => {
    // A QUERY behavior without a report: once M7 exists the validator needs one.
    const base: OntologySuite = {
      M1: {
        model_type: 'OBJECT',
        version: '5.0',
        domain: '销售',
        aggregates: [
          {
            id: 'AGG-01',
            name: 'Invoice',
            alias: '发票',
            aggregateType: 'AGGREGATE_ROOT',
            lifecycle: ['ACTIVE'],
            tags: [],
            attributes: [{ name: 'invoiceNo', label: '发票号', type: 'String', required: true }],
            entities: [],
            valueObjects: [],
            invariants: [],
          },
        ],
        data_dictionaries: [],
        aggregate_associations: [],
      },
      M2: {
        model_type: 'BEHAVIOR',
        version: '5.0',
        domain: '销售',
        behaviors: [
          {
            id: 'BHV-01',
            name: 'listInvoices',
            alias: '查询发票',
            ownerEntity: 'Invoice',
            behaviorType: 'QUERY',
            triggerType: 'EXTERNAL',
            inputParameters: [],
            outputParameters: [],
            preconditions: [],
            stateChanges: [],
            invokedRules: [],
            producedEvents: [],
            requiredPermissions: [],
          },
        ],
      },
    } as OntologySuite;

    const { candidates } = scanOrders(base);
    const supplementedReport = candidates.find((c) => c.elementId === 'QRY-AUTO-BHV-01')!;
    expect(supplementedReport.evidence).toEqual([]);
    const reboundBehavior = candidates.find((c) => c.elementId === 'BHV-01')!;
    expect(reboundBehavior.change).toBe('MODIFIED');
    expect(reboundBehavior.evidence).toEqual([]);
    expect(tallyCandidates(candidates).supplemented).toBe(2);
  });

  it('classifies candidates against the suite as it is now, not as it was at extraction', () => {
    const { scan, candidates } = scanOrders();
    const order = candidates.find((c) => c.elementId === 'AGG-EXT-SALES_ORDER')!;
    const customer = candidates.find((c) => c.elementId === 'AGG-EXT-CUSTOMER')!;

    expect(classifyCandidates({}, candidates)[order.key]).toBe('ADDED');

    // Later the project gained the same elements: one identical, one edited.
    const later = clone(scan.suite);
    later.M1!.aggregates.find((a) => a.id === 'AGG-EXT-CUSTOMER')!.alias = '客户（已人工修订）';
    const standing = classifyCandidates(later, candidates);
    expect(standing[order.key]).toBe('UNCHANGED');
    expect(standing[customer.key]).toBe('MODIFIED');
  });
});

describe('ontology-core: merging confirmed candidates', () => {
  it('merges only accepted candidates into the current suite and keeps edits made since extraction', () => {
    const { candidates } = scanOrders();
    const customerKeys = candidates.filter((c) => JSON.stringify(c.element).includes('Customer'));
    const decisions: Record<string, CandidateDecision> = {};
    for (const cand of candidates) {
      decisions[cand.key] = cand.key.includes('CUSTOMER') ? 'ACCEPTED' : 'REJECTED';
    }
    expect(customerKeys.length).toBeGreaterThan(0);

    // The project changed after the extraction ran.
    const current = clone(MFT_ENTERPRISE_SUITE);
    const before = current.M1!.aggregates.length;
    current.M1!.aggregates[0]!.alias = '期间人工修改的别名';

    const preview = previewCandidateMerge({ current, candidates, decisions, domain: '销售' });
    expect(preview.newErrors).toEqual([]);
    expect(preview.acceptedCount).toBe(candidates.filter((c) => c.key.includes('CUSTOMER')).length);
    expect(preview.suite.M1!.aggregates).toHaveLength(before + 1);
    expect(preview.suite.M1!.aggregates[0]!.alias).toBe('期间人工修改的别名');
    expect(preview.suite.M1!.aggregates.some((a) => a.name === 'Customer')).toBe(true);
    expect(preview.suite.M1!.aggregates.some((a) => a.name === 'SalesOrder')).toBe(false);
    // The input suite is not mutated.
    expect(current.M1!.aggregates).toHaveLength(before);
  });

  it('blocks a merge that accepts a behavior but rejects the aggregate it belongs to, naming the element', () => {
    const { candidates } = scanOrders();
    const decisions = acceptAll(candidates);
    decisions['M1/aggregates/AGG-EXT-SALES_ORDER'] = 'REJECTED';

    const preview = previewCandidateMerge({ current: {}, candidates, decisions, domain: '销售' });
    expect(preview.newErrors.length).toBeGreaterThan(0);
    expect(preview.newErrors.every((d) => d.tier === 'ERROR')).toBe(true);
    const named = preview.newErrors.map((d) => `${d.elementId ?? ''} ${d.messageEn}`).join('\n');
    expect(named).toContain('SalesOrder');
    expect(named).toMatch(/BHV-EXT-(CMD|QRY)-SALES_ORDER/);

    // Accepting the aggregate as well clears the gate.
    const whole = previewCandidateMerge({
      current: {},
      candidates,
      decisions: acceptAll(candidates),
      domain: '销售',
    });
    expect(whole.newErrors).toEqual([]);
    expect(whole.validation.errorCount).toBe(0);
  });

  it('does not count Consistency Errors the project already had', () => {
    const broken = clone(MFT_ENTERPRISE_SUITE);
    broken.M2!.behaviors[0]!.ownerEntity = 'NoSuchAggregate';
    const existingErrors = validateOntologySuite(broken).errorCount;
    expect(existingErrors).toBeGreaterThan(0);

    const scan = scanSourceStructure({ baseSuite: broken, source: ORDER_DDL, domain: 'MFT' });
    const candidates = buildExtractionCandidates(broken, scan.suite, scan.evidenceByKey);
    const preview = previewCandidateMerge({
      current: broken,
      candidates,
      decisions: acceptAll(candidates),
      domain: 'MFT',
    });
    expect(preview.newErrors).toEqual([]);
    expect(preview.validation.errorCount).toBe(existingErrors);
  });

  it('treats an undecided candidate as not accepted', () => {
    const { candidates } = scanOrders();
    const preview = previewCandidateMerge({ current: {}, candidates, decisions: {}, domain: '销售' });
    expect(preview.acceptedCount).toBe(0);
    expect(preview.suite).toEqual({});
  });
});

describe('ontology-core: semantic alignment', () => {
  it('lists reference targets only for undeclared, non-key, reference-shaped columns of a compatible type', () => {
    const { scan } = scanOrders();
    const skeleton = buildAlignmentSkeleton(scan);
    const order = skeleton.tables.find((t) => t.table === 't_sales_order')!;
    const column = (name: string) => order.columns.find((c) => c.column === name)!;

    expect(column('customer_id').refCandidates).toEqual(['t_customer']);
    // INTEGER cannot reference a VARCHAR key.
    expect(column('warehouse_id').refCandidates).toBeUndefined();
    expect(column('order_no').refCandidates).toBeUndefined();
    expect(column('id').refCandidates).toBeUndefined();
    expect(skeleton.omitted).toBeUndefined();
  });

  it('offers tables the project already maps as reference targets, but never for relabeling', () => {
    const scan = scanSourceStructure({
      baseSuite: CONTRACT_LIFECYCLE_SUITE,
      source: 'CREATE TABLE t_probe (id VARCHAR(36) PRIMARY KEY, owner_id VARCHAR(36));',
      domain: '合同',
    });
    const skeleton = buildAlignmentSkeleton(scan);
    expect(skeleton.tables.map((t) => t.table)).toEqual(['t_probe']);
    expect(skeleton.knownTables.length).toBeGreaterThan(0);
    const candidates = skeleton.tables[0]!.columns.find((c) => c.column === 'owner_id')!.refCandidates!;
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((name) => skeleton.knownTables.some((k) => k.table === name))).toBe(true);
  });

  it('caps the skeleton and reports what was left out', () => {
    const many = Array.from(
      { length: ALIGNMENT_MAX_TABLES + 3 },
      (_, i) => `CREATE TABLE t_bulk_${i} (id INTEGER PRIMARY KEY, name VARCHAR(32));`,
    ).join('\n');
    const scan = scanSourceStructure({ baseSuite: {}, source: many, domain: 'bulk' });
    const skeleton = buildAlignmentSkeleton(scan);
    expect(skeleton.tables).toHaveLength(ALIGNMENT_MAX_TABLES);
    expect(skeleton.omitted).toEqual({ tables: 3, columns: 0 });
  });

  it('keeps what the skeleton allows and drops everything else with a reason', () => {
    const { scan } = scanOrders();
    const skeleton = buildAlignmentSkeleton(scan);
    const sanitized = sanitizeAlignment(skeleton, {
      tables: [
        {
          table: 't_sales_order',
          alias: '销售订单',
          description: '客户下达的销售订单。',
          columns: [
            { column: 'customer_id', label: '客户', refTable: 't_customer' },
            { column: 'warehouse_id', label: '仓库', refTable: 't_customer' },
            { column: 'order_no', label: '订单号', refTable: null },
            { column: 'made_up_column', label: '编造' },
            { column: 'total_amount', label: 'x'.repeat(80) },
          ],
        },
        { table: 't_sales_order', alias: '重复' },
        { table: 't_invented', alias: '编造的表' },
      ],
    });

    expect(sanitized.tableLabels).toEqual([
      { table: 't_sales_order', alias: '销售订单', description: '客户下达的销售订单。' },
    ]);
    expect(sanitized.columnLabels.map((c) => c.column)).toEqual([
      'customer_id',
      'warehouse_id',
      'order_no',
    ]);
    expect(sanitized.inferredRefs).toEqual([
      { table: 't_sales_order', column: 'customer_id', targetTable: 't_customer' },
    ]);
    const reasons = sanitized.dropped.map((d) => `${d.item}: ${d.reason}`);
    expect(reasons).toEqual([
      't_sales_order.warehouse_id → t_customer: reference target is not one of the listed candidates',
      't_sales_order.made_up_column: column is not in the scanned table',
      't_sales_order: duplicate table',
      't_invented: table is not in the scanned source',
    ]);
  });

  it('rejects a response of the wrong shape outright', () => {
    const { scan } = scanOrders();
    const skeleton = buildAlignmentSkeleton(scan);
    for (const raw of [null, 'not json', { tables: 'nope' }, []]) {
      const sanitized = sanitizeAlignment(skeleton, raw);
      expect(sanitized.tableLabels).toEqual([]);
      expect(sanitized.inferredRefs).toEqual([]);
      expect(sanitized.dropped).toHaveLength(1);
    }
  });

  it('labels only aggregates this scan created and turns each inferred reference into its own candidate', () => {
    const { scan } = scanOrders();
    const skeleton = buildAlignmentSkeleton(scan);
    const sanitized = sanitizeAlignment(skeleton, {
      tables: [
        {
          table: 't_sales_order',
          alias: '销售订单',
          columns: [{ column: 'customer_id', label: '客户', refTable: 't_customer' }],
        },
      ],
    });
    const aligned = applyAlignment(scan, sanitized, ORDER_DDL);
    const candidates = buildExtractionCandidates({}, aligned.scan.suite, aligned.scan.evidenceByKey);

    const order = candidates.find((c) => c.elementId === 'AGG-EXT-SALES_ORDER')!;
    expect((order.element as { alias: string }).alias).toBe('销售订单');
    expect(order.evidence.map((e) => e.origin)).toEqual(['PARSED', 'INFERRED']);

    const inferred = candidates.find((c) => c.elementId === 'ASSOC-INF-SALES_ORDER-CUSTOMERID')!;
    expect(inferred.collection).toBe('aggregate_associations');
    expect(inferred.element).toMatchObject({
      sourceAggregate: 'SalesOrder',
      targetAggregate: 'Customer',
      referenceField: 'customerId',
    });
    expect(inferred.evidence).toHaveLength(1);
    expect(inferred.evidence[0]!.origin).toBe('INFERRED');
    expect(inferred.evidence[0]!.lines).toEqual({ startLine: 8, endLine: 8 });
    expect(inferred.evidence[0]!.excerpt).toContain('customer_id');

    expect(tallyCandidates(candidates).inferred).toBe(1);
    expect(validateOntologySuite(aligned.scan.suite).errorCount).toBe(0);
    // The scan it was given is left as it was.
    expect(scan.suite.M1!.aggregate_associations).toEqual([]);
  });

  it('never relabels an aggregate the project already had', () => {
    const base = scanOrders().scan.suite;
    const rescan = scanSourceStructure({ baseSuite: base, source: ORDER_DDL, domain: '销售' });
    expect(rescan.newAggregateTables).toEqual([]);
    const sanitized = sanitizeAlignment(buildAlignmentSkeleton(rescan), {
      tables: [{ table: 't_sales_order', alias: '被改写的别名' }],
    });
    const aligned = applyAlignment(rescan, sanitized, ORDER_DDL);
    expect(aligned.scan.suite.M1!.aggregates.find((a) => a.name === 'SalesOrder')!.alias).not.toBe(
      '被改写的别名',
    );
  });
});

describe('ontology-core: quote verification', () => {
  const doc = ['# 采购制度', '', '合同金额超过 100 万元的，', '须经财务总监审批后方可签署。', '', '供应商每年评估一次。'].join(
    '\n',
  );

  it('finds a quote, tolerating whitespace and line wrapping', () => {
    expect(locateQuote(doc, '供应商每年评估一次')?.lines).toEqual({ startLine: 6, endLine: 6 });
    const wrapped = locateQuote(doc, '合同金额超过 100 万元的，  须经财务总监审批');
    expect(wrapped?.lines).toEqual({ startLine: 3, endLine: 4 });
    expect(wrapped?.excerpt).toContain('财务总监');
  });

  it('returns null for a quote that is absent, missing, or too short to mean anything', () => {
    expect(locateQuote(doc, '合同金额超过 500 万元')).toBeNull();
    expect(locateQuote(doc, undefined)).toBeNull();
    expect(locateQuote(doc, '合同')).toBeNull();
  });
});
