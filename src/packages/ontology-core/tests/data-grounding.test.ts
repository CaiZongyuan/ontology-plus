import { describe, expect, it } from 'vitest';
import {
  CONTRACT_LIFECYCLE_SUITE,
  buildDataGrounding,
  checkSqlGrounding,
  findJoinPath,
  type GroundingJoin,
  type OntologySuite,
} from '../index.js';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const joinText = (join: GroundingJoin) =>
  `${join.leftTable}.${join.leftColumn} = ${join.rightTable}.${join.rightColumn}`;

const grounding = buildDataGrounding(CONTRACT_LIFECYCLE_SUITE, {
  unmappedTables: [
    { table: '__dict', columns: [{ column: 'item_code' }, { column: 'item_label' }] },
    { table: 't_warehouse_stock', columns: [{ column: 'sku' }, { column: 'qty' }] },
  ],
});

describe('ontology-core: data grounding', () => {
  it('lists every column of every mapped table with the business attribute it stores', () => {
    const mm = CONTRACT_LIFECYCLE_SUITE.MM!;
    const mappedTables = mm.mappings.flatMap((m) => m.tableMappings);
    const contract = grounding.tables.find((t) => t.table === 't_contract')!;
    const contractMapping = mappedTables.find((tm) => tm.tableName === 't_contract')!;

    expect(grounding.tables.filter((t) => t.mapped).map((t) => t.table)).toEqual(
      mappedTables.map((tm) => tm.tableName),
    );
    expect(contract.columns.map((c) => c.column)).toEqual(
      contractMapping.columnMappings.map((cm) => cm.column),
    );
    expect(contract.columns.length).toBeGreaterThan(6);
    expect(contract.objectName).toBe('Contract');
    expect(contract.primaryKey).toBe(contractMapping.primaryKey);

    const labelled = contract.columns.find((c) => c.attributeRef === 'Contract.contractNo')!;
    expect(labelled.column).toBe('contract_no');
    expect(labelled.label).toBe(
      CONTRACT_LIFECYCLE_SUITE.M1!.aggregates
        .find((a) => a.name === 'Contract')!
        .attributes.find((a) => a.name === 'contractNo')!.label,
    );
  });

  it('keeps queryable tables outside MM apart from mapped ones', () => {
    const stock = grounding.tables.find((t) => t.table === 't_warehouse_stock')!;
    expect(stock.mapped).toBe(false);
    expect(stock.objectName).toBeUndefined();
    expect(stock.columns.map((c) => c.column)).toEqual(['sku', 'qty']);
  });

  it('reads joins off MM foreign keys', () => {
    expect(grounding.joins.map(joinText)).toEqual(
      expect.arrayContaining([
        't_contract.counterparty_id = t_counterparty.id',
        't_contract_line_item.contract_id = t_contract.id',
      ]),
    );
    expect(grounding.joins.every((j) => j.source === 'MM_FOREIGN_KEY')).toBe(true);
    // Each condition appears once even though MM and M1 both describe it.
    expect(new Set(grounding.joins.map(joinText)).size).toBe(grounding.joins.length);
  });

  it('resolves M1 associations to joins when MM declares no foreign key', () => {
    const suite = clone(CONTRACT_LIFECYCLE_SUITE);
    for (const mapping of suite.MM!.mappings) {
      for (const tm of mapping.tableMappings) {
        tm.foreignKeys = [];
        for (const cm of tm.columnMappings) {
          delete cm.isForeignKey;
          delete cm.fkTargetTable;
          delete cm.fkTargetColumn;
        }
      }
    }
    const fromAssociations = buildDataGrounding(suite);
    expect(fromAssociations.joins.length).toBe(suite.M1!.aggregate_associations.length);
    expect(fromAssociations.joins.every((j) => j.source === 'M1_ASSOCIATION')).toBe(true);
    expect(fromAssociations.joins.map(joinText)).toContain(
      't_contract.counterparty_id = t_counterparty.id',
    );
    expect(fromAssociations.joins.map((j) => j.ref)).toEqual(
      suite.M1!.aggregate_associations.map((a) => a.id),
    );
  });

  it('ranks M7 reference queries by overlap with the question and caps how many it returns', () => {
    const reports = CONTRACT_LIFECYCLE_SUITE.M7!.query_reports;
    expect(reports.length).toBeGreaterThan(1);
    const target = reports[reports.length - 1]!;

    const ranked = buildDataGrounding(CONTRACT_LIFECYCLE_SUITE, {
      question: `请给我 ${target.alias}`,
      maxReferenceQueries: 2,
    }).referenceQueries;
    expect(ranked).toHaveLength(Math.min(2, reports.length));
    expect(ranked[0]!.id).toBe(target.id);
    expect(ranked[0]!.sql).toBe(target.referenceSql.sql.trim());
    expect(ranked[0]!.score).toBeGreaterThan(0);

    // With no question there is nothing to rank by: model order, score zero.
    const unranked = buildDataGrounding(CONTRACT_LIFECYCLE_SUITE).referenceQueries;
    expect(unranked[0]!.id).toBe(reports[0]!.id);
    expect(unranked.every((q) => q.score === 0)).toBe(true);
  });

  it('says which model is missing instead of grounding on nothing', () => {
    expect(grounding.missing).toEqual([]);

    const empty = buildDataGrounding({});
    expect(empty.missing).toEqual(['MM', 'M7']);
    expect(empty.tables).toEqual([]);
    expect(empty.joins).toEqual([]);
    expect(empty.referenceQueries).toEqual([]);

    const noReports: OntologySuite = { ...CONTRACT_LIFECYCLE_SUITE };
    delete noReports.M7;
    expect(buildDataGrounding(noReports).missing).toEqual(['M7']);
  });
});

describe('ontology-core: join paths', () => {
  it('returns the direct join between two associated tables', () => {
    expect(findJoinPath(grounding, 't_contract', 't_counterparty')!.map(joinText)).toEqual([
      't_contract.counterparty_id = t_counterparty.id',
    ]);
    expect(findJoinPath(grounding, 'T_COUNTERPARTY', 't_contract')).toHaveLength(1);
    expect(findJoinPath(grounding, 't_contract', 't_contract')).toEqual([]);
  });

  it('chains joins through an intermediate table', () => {
    expect(findJoinPath(grounding, 't_contract_line_item', 't_counterparty')!.map(joinText)).toEqual([
      't_contract_line_item.contract_id = t_contract.id',
      't_contract.counterparty_id = t_counterparty.id',
    ]);
  });

  it('returns null when no known join connects the tables', () => {
    expect(findJoinPath(grounding, 't_contract', 't_warehouse_stock')).toBeNull();
    expect(findJoinPath(grounding, 't_contract', 't_does_not_exist')).toBeNull();
  });
});

describe('ontology-core: SQL grounding check', () => {
  const check = (sql: string) => checkSqlGrounding(grounding, sql);

  it('accepts queries over mapped tables, registered tables, and the dictionary table', () => {
    const report = check(
      `SELECT c.contract_no, d.item_label FROM t_contract c LEFT JOIN __dict d ON d.item_code = c.status`,
    );
    expect(report.referencedTables).toEqual(['t_contract', '__dict']);
    expect(report.unknownTables).toEqual([]);
    expect(check('SELECT sku FROM "t_warehouse_stock"').unknownTables).toEqual([]);
    expect(check('select * from main.T_CONTRACT limit 5').unknownTables).toEqual([]);
  });

  it('refuses tables outside the grounding, wherever they appear', () => {
    expect(check('SELECT * FROM workspace_entities').unknownTables).toEqual(['workspace_entities']);
    expect(check('SELECT name FROM sqlite_master').unknownTables).toEqual(['sqlite_master']);
    expect(check('SELECT * FROM t_contract c JOIN projects p ON p.id = c.id').unknownTables).toEqual([
      'projects',
    ]);
    // Comma joins and subqueries do not hide a table.
    expect(check('SELECT * FROM t_contract c, projects p').unknownTables).toEqual(['projects']);
    expect(
      check('SELECT * FROM t_contract WHERE id IN (SELECT project_id FROM workspace_entities)')
        .unknownTables,
    ).toEqual(['workspace_entities']);
    expect(
      check('SELECT * FROM (SELECT * FROM agent_sessions) s JOIN t_contract c ON c.id = s.id')
        .unknownTables,
    ).toEqual(['agent_sessions']);
    // Schema-qualified table cannot be masked by a CTE of the same name.
    expect(
      check('WITH workspace_entities AS (SELECT 1) SELECT * FROM main.workspace_entities')
        .unknownTables,
    ).toEqual(['workspace_entities']);
    expect(
      check('WITH workspace_entities AS (SELECT 1) SELECT * FROM "main"."workspace_entities"')
        .unknownTables,
    ).toEqual(['workspace_entities']);
    // Subquery-scoped CTE does not leak to outer query.
    expect(
      check(
        'SELECT * FROM (WITH workspace_entities AS (SELECT 1) SELECT * FROM workspace_entities) s, workspace_entities',
      ).unknownTables,
    ).toEqual(['workspace_entities']);
    // Comma-join after JOIN ... ON / USING still checks the trailing table.
    expect(
      check(
        'SELECT * FROM t_contract c JOIN t_counterparty cp ON c.counterparty_id = cp.id, workspace_entities',
      ).unknownTables,
    ).toEqual(['workspace_entities']);
    expect(
      check('SELECT * FROM t_contract JOIN t_counterparty USING (id), workspace_entities')
        .unknownTables,
    ).toEqual(['workspace_entities']);
    // Commas inside function calls in ON (...) do not trigger false table expectations.
    expect(
      check(
        "SELECT * FROM t_contract c JOIN t_counterparty cp ON COALESCE(c.counterparty_id, '') = cp.id",
      ).unknownTables,
    ).toEqual([]);
  });

  it('does not mistake CTE names, derived-table aliases, or functions for tables', () => {
    const report = check(
      `WITH high_risk AS (SELECT id, total_amount FROM t_contract WHERE risk_level = 'HIGH'),
            ranked (id, amount) AS (SELECT id, total_amount FROM high_risk)
       SELECT r.id, x.total
       FROM ranked r
       JOIN (SELECT contract_id, SUM(planned_amount) AS total FROM t_payment_milestone GROUP BY contract_id) x
         ON x.contract_id = r.id
       WHERE r.amount IS DISTINCT FROM x.total`,
    );
    expect(report.unknownTables).toEqual([]);
    expect(report.referencedTables).toEqual(['t_contract', 't_payment_milestone']);
    expect(report.unknownJoins).toEqual([]);

    expect(check(`SELECT value FROM json_each('[1,2]')`).unknownTables).toEqual([]);
    expect(check(`SELECT 'FROM projects' AS note FROM t_contract`).unknownTables).toEqual([]);
  });

  it('passes joins the ontology knows, in either direction and through aliases', () => {
    expect(
      check(
        `SELECT cp.company_name, COUNT(c.id) FROM t_contract c
         JOIN t_counterparty cp ON c.counterparty_id = cp.id GROUP BY cp.company_name`,
      ).unknownJoins,
    ).toEqual([]);
    expect(
      check(
        `SELECT * FROM t_counterparty JOIN t_contract ON t_counterparty.id = t_contract.counterparty_id`,
      ).unknownJoins,
    ).toEqual([]);
    // An implicit join in WHERE is still a join.
    expect(
      check(`SELECT * FROM t_contract c, t_counterparty cp WHERE cp.id = c.counterparty_id`)
        .unknownJoins,
    ).toEqual([]);
  });

  it('flags a join the ontology does not back and shows the join it does know', () => {
    const report = check(
      `SELECT * FROM t_contract c JOIN t_counterparty cp ON c.contract_no = cp.company_name`,
    );
    expect(report.unknownTables).toEqual([]);
    expect(report.unknownJoins).toHaveLength(1);
    expect(report.unknownJoins[0]!.condition).toBe(
      't_contract.contract_no = t_counterparty.company_name',
    );
    expect(report.unknownJoins[0]!.knownJoins.map(joinText)).toEqual([
      't_contract.counterparty_id = t_counterparty.id',
    ]);
  });

  it('stays silent about conditions it cannot judge', () => {
    // Self-join, join to an unmapped table, non-equality, expression join, USING.
    for (const sql of [
      `SELECT * FROM t_contract a JOIN t_contract b ON a.id = b.parent_id`,
      `SELECT * FROM t_contract c JOIN t_warehouse_stock s ON s.sku = c.contract_no`,
      `SELECT * FROM t_contract c JOIN t_counterparty cp ON c.total_amount >= cp.credit_limit`,
      `SELECT * FROM t_contract c JOIN t_counterparty cp ON LOWER(c.contract_no) = LOWER(cp.company_name)`,
      `SELECT * FROM t_contract JOIN t_counterparty USING (id)`,
    ]) {
      expect(check(sql).unknownJoins).toEqual([]);
      expect(check(sql).unknownTables).toEqual([]);
    }
  });
});
