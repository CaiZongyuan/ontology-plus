import type { OntologySuite } from './types.js';

// Data grounding for Data Ontology Reasoning: what may be queried and how
// tables join, derived deterministically from the suite (`MM`, `M1`, `M7`).
// Pure and synchronous; nothing here invents a table, a column, or a join.

export interface GroundingColumn {
  column: string;
  columnType?: string;
  isPrimaryKey?: boolean;
  /** `Aggregate.attribute` this column stores, when mapped. */
  attributeRef?: string;
  label?: string;
}

export interface GroundingTable {
  table: string;
  /** False for tables that are queryable but not described by `MM`. */
  mapped: boolean;
  objectName?: string;
  objectAlias?: string;
  primaryKey?: string;
  columns: GroundingColumn[];
}

/** One equality condition; usable in either direction. */
export interface GroundingJoin {
  leftTable: string;
  leftColumn: string;
  rightTable: string;
  rightColumn: string;
  source: 'MM_FOREIGN_KEY' | 'M1_ASSOCIATION';
  /** Foreign key name or association id the join was read from. */
  ref: string;
}

export interface GroundingReferenceQuery {
  id: string;
  name: string;
  alias: string;
  sql: string;
  /** Word overlap with the question; 0 when no question was given. */
  score: number;
}

export interface DataGrounding {
  tables: GroundingTable[];
  joins: GroundingJoin[];
  referenceQueries: GroundingReferenceQuery[];
  /** Models whose absence limits what can be grounded. */
  missing: ('MM' | 'M7')[];
}

export interface UnmappedQueryableTable {
  table: string;
  columns: { column: string; columnType?: string; label?: string }[];
}

const lower = (value: string): string => value.toLowerCase();

function joinIdentity(join: Pick<GroundingJoin, 'leftTable' | 'leftColumn' | 'rightTable' | 'rightColumn'>): string {
  const a = `${lower(join.leftTable)}.${lower(join.leftColumn)}`;
  const b = `${lower(join.rightTable)}.${lower(join.rightColumn)}`;
  return a < b ? `${a}=${b}` : `${b}=${a}`;
}

/** Lowercase ASCII words plus CJK bigrams, so Chinese questions match without a tokenizer. */
function questionTerms(text: string): Set<string> {
  const terms = new Set<string>();
  for (const word of lower(text).match(/[a-z0-9_]{2,}/g) ?? []) terms.add(word);
  for (const run of text.match(/[一-鿿]+/g) ?? []) {
    if (run.length === 1) terms.add(run);
    for (let i = 0; i + 1 < run.length; i += 1) terms.add(run.slice(i, i + 2));
  }
  return terms;
}

export function buildDataGrounding(
  suite: OntologySuite,
  options: {
    question?: string;
    /** Queryable tables outside `MM` (registered data resources, the dictionary table). */
    unmappedTables?: UnmappedQueryableTable[];
    maxReferenceQueries?: number;
  } = {},
): DataGrounding {
  const tables: GroundingTable[] = [];
  const joins: GroundingJoin[] = [];
  const seenJoins = new Set<string>();
  const seenTables = new Set<string>();

  const attributeLabels = new Map<string, string>();
  const aggregateAliases = new Map<string, string>();
  for (const agg of suite.M1?.aggregates ?? []) {
    aggregateAliases.set(agg.name, agg.alias);
    for (const attr of agg.attributes) attributeLabels.set(`${agg.name}.${attr.name}`, attr.label);
    for (const entity of agg.entities ?? []) {
      for (const attr of entity.attributes ?? []) {
        attributeLabels.set(`${agg.name}.${entity.name}.${attr.name}`, attr.label);
        attributeLabels.set(`${entity.name}.${attr.name}`, attr.label);
      }
    }
  }

  const addJoin = (join: GroundingJoin) => {
    if (lower(join.leftTable) === lower(join.rightTable)) return;
    const identity = joinIdentity(join);
    if (seenJoins.has(identity)) return;
    seenJoins.add(identity);
    joins.push(join);
  };

  const mappings = suite.MM?.mappings ?? [];
  const primaryKeyOf = new Map<string, string>();
  /** Aggregate name -> its MASTER (or first) table. */
  const masterTableOf = new Map<string, string>();
  for (const mapping of mappings) {
    for (const tm of mapping.tableMappings) {
      primaryKeyOf.set(lower(tm.tableName), tm.primaryKey);
      if (!masterTableOf.has(mapping.objectName) || tm.tableRole === 'MASTER') {
        masterTableOf.set(mapping.objectName, tm.tableName);
      }
    }
  }

  for (const mapping of mappings) {
    for (const tm of mapping.tableMappings) {
      if (seenTables.has(lower(tm.tableName))) continue;
      seenTables.add(lower(tm.tableName));
      tables.push({
        table: tm.tableName,
        mapped: true,
        objectName: mapping.objectName,
        ...(aggregateAliases.has(mapping.objectName)
          ? { objectAlias: aggregateAliases.get(mapping.objectName)! }
          : {}),
        primaryKey: tm.primaryKey,
        columns: tm.columnMappings.map((cm) => ({
          column: cm.column,
          columnType: cm.columnType,
          ...(cm.isPrimaryKey || cm.column === tm.primaryKey ? { isPrimaryKey: true } : {}),
          attributeRef: cm.attributeRef,
          ...(attributeLabels.has(cm.attributeRef)
            ? { label: attributeLabels.get(cm.attributeRef)! }
            : {}),
        })),
      });

      for (const fk of tm.foreignKeys) {
        addJoin({
          leftTable: tm.tableName,
          leftColumn: fk.localColumn,
          rightTable: fk.targetTable,
          rightColumn: fk.targetColumn,
          source: 'MM_FOREIGN_KEY',
          ref: fk.fkName,
        });
      }
      for (const cm of tm.columnMappings) {
        if (!cm.isForeignKey || !cm.fkTargetTable) continue;
        const targetColumn = cm.fkTargetColumn ?? primaryKeyOf.get(lower(cm.fkTargetTable));
        if (!targetColumn) continue;
        addJoin({
          leftTable: tm.tableName,
          leftColumn: cm.column,
          rightTable: cm.fkTargetTable,
          rightColumn: targetColumn,
          source: 'MM_FOREIGN_KEY',
          ref: `${tm.tableName}.${cm.column}`,
        });
      }
    }
  }

  // M1 associations resolve to a join only when MM says where both ends live.
  for (const assoc of suite.M1?.aggregate_associations ?? []) {
    const sourceTable = masterTableOf.get(assoc.sourceAggregate);
    const targetTable = masterTableOf.get(assoc.targetAggregate);
    if (!sourceTable || !targetTable) continue;
    const targetPk = primaryKeyOf.get(lower(targetTable));
    const sourceColumn = tables
      .find((t) => lower(t.table) === lower(sourceTable))
      ?.columns.find((c) => c.attributeRef === `${assoc.sourceAggregate}.${assoc.referenceField}`)
      ?.column;
    if (!targetPk || !sourceColumn) continue;
    addJoin({
      leftTable: sourceTable,
      leftColumn: sourceColumn,
      rightTable: targetTable,
      rightColumn: targetPk,
      source: 'M1_ASSOCIATION',
      ref: assoc.id,
    });
  }

  for (const extra of options.unmappedTables ?? []) {
    if (seenTables.has(lower(extra.table))) continue;
    seenTables.add(lower(extra.table));
    tables.push({
      table: extra.table,
      mapped: false,
      columns: extra.columns.map((c) => ({
        column: c.column,
        ...(c.columnType ? { columnType: c.columnType } : {}),
        ...(c.label ? { label: c.label } : {}),
      })),
    });
  }

  const terms = questionTerms(options.question ?? '');
  const ranked = (suite.M7?.query_reports ?? [])
    .filter((q) => q.referenceSql?.sql?.trim())
    .map((q, order) => {
      const haystack = lower(
        [
          q.name,
          q.alias,
          q.description ?? '',
          q.primarySource.aggregateRef,
          aggregateAliases.get(q.primarySource.aggregateRef) ?? '',
          q.resultColumns.map((c) => `${c.name} ${c.label}`).join(' '),
          q.referenceSql.sql,
        ].join(' '),
      );
      let score = 0;
      for (const term of terms) if (haystack.includes(term)) score += 1;
      return { order, score, id: q.id, name: q.name, alias: q.alias, sql: q.referenceSql.sql.trim() };
    })
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, options.maxReferenceQueries ?? 3)
    .map(({ order: _order, ...rest }) => rest);

  const missing: DataGrounding['missing'] = [];
  if (mappings.length === 0) missing.push('MM');
  if ((suite.M7?.query_reports ?? []).length === 0) missing.push('M7');

  return { tables, joins, referenceQueries: ranked, missing };
}

/**
 * Shortest chain of known joins between two tables. Null means there is no
 * known way to connect them; callers must say so rather than guess a condition.
 */
export function findJoinPath(
  grounding: DataGrounding,
  fromTable: string,
  toTable: string,
): GroundingJoin[] | null {
  const start = lower(fromTable);
  const goal = lower(toTable);
  if (start === goal) return [];

  const adjacency = new Map<string, { next: string; join: GroundingJoin }[]>();
  for (const join of grounding.joins) {
    const left = lower(join.leftTable);
    const right = lower(join.rightTable);
    (adjacency.get(left) ?? adjacency.set(left, []).get(left)!).push({ next: right, join });
    (adjacency.get(right) ?? adjacency.set(right, []).get(right)!).push({ next: left, join });
  }

  const cameFrom = new Map<string, { prev: string; join: GroundingJoin }>();
  const queue = [start];
  const visited = new Set([start]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of adjacency.get(current) ?? []) {
      if (visited.has(edge.next)) continue;
      visited.add(edge.next);
      cameFrom.set(edge.next, { prev: current, join: edge.join });
      if (edge.next === goal) {
        const path: GroundingJoin[] = [];
        let cursor = goal;
        while (cursor !== start) {
          const step = cameFrom.get(cursor)!;
          path.unshift(step.join);
          cursor = step.prev;
        }
        return path;
      }
      queue.push(edge.next);
    }
  }
  return null;
}

// ─── SQL grounding check ──────────────────────────────────────────────────────

export interface SqlGroundingReport {
  /** Tables the query reads, as written (CTE names and derived tables excluded). */
  referencedTables: string[];
  /** Referenced tables outside the grounding: the query must not run. */
  unknownTables: string[];
  /** Equality conditions between two mapped tables that match no known join. */
  unknownJoins: { condition: string; knownJoins: GroundingJoin[] }[];
}

const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'GROUP', 'ORDER', 'BY', 'HAVING', 'LIMIT', 'OFFSET', 'UNION',
  'INTERSECT', 'EXCEPT', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'NATURAL',
  'ON', 'USING', 'AS', 'AND', 'OR', 'NOT', 'WITH', 'RECURSIVE', 'WINDOW', 'CASE', 'WHEN', 'THEN',
  'ELSE', 'END', 'IN', 'IS', 'NULL', 'LIKE', 'BETWEEN', 'EXISTS', 'DISTINCT', 'ALL', 'ASC',
  'DESC', 'INDEXED', 'MATERIALIZED', 'VALUES',
]);

interface SqlToken {
  /** Identifier text with quotes removed, or the raw punctuation. */
  text: string;
  kind: 'word' | 'quoted' | 'string' | 'number' | 'punct';
}

function tokenizeSql(sql: string): SqlToken[] {
  const pattern =
    /'(?:[^']|'')*'|"[^"]*"|`[^`]*`|\[[^\]]*\]|[A-Za-z_一-鿿][A-Za-z0-9_$一-鿿]*|\d+(?:\.\d+)?|[^\s]/g;
  const tokens: SqlToken[] = [];
  for (const raw of sql.match(pattern) ?? []) {
    const first = raw[0]!;
    if (first === "'") tokens.push({ text: raw, kind: 'string' });
    else if (first === '"' || first === '`' || first === '[')
      tokens.push({ text: raw.slice(1, -1), kind: 'quoted' });
    else if (/[0-9]/.test(first)) tokens.push({ text: raw, kind: 'number' });
    else if (/[A-Za-z_一-鿿]/.test(first)) tokens.push({ text: raw, kind: 'word' });
    else tokens.push({ text: raw, kind: 'punct' });
  }
  return tokens;
}

const isKeyword = (token: SqlToken | undefined): boolean =>
  Boolean(token && token.kind === 'word' && SQL_KEYWORDS.has(token.text.toUpperCase()));
const isIdentifier = (token: SqlToken | undefined): boolean =>
  Boolean(token && (token.kind === 'quoted' || (token.kind === 'word' && !isKeyword(token))));
const isPunct = (token: SqlToken | undefined, text: string): boolean =>
  Boolean(token && token.kind === 'punct' && token.text === text);
const isWord = (token: SqlToken | undefined, upper: string): boolean =>
  Boolean(token && token.kind === 'word' && token.text.toUpperCase() === upper);

/**
 * Check a read-only query against the grounding before it runs. A lexical
 * scan, not a parser: it prefers missing a suspicious join to flagging a
 * legitimate one, but it never lets an unknown table through.
 */
export function checkSqlGrounding(grounding: DataGrounding, sql: string): SqlGroundingReport {
  const tokens = tokenizeSql(sql);
  const cteNames = new Set<string>();
  const referenced: string[] = [];
  /** Qualifier (alias or table name) -> tables it stands for; '' marks a derived table. */
  const qualifiers = new Map<string, Set<string>>();
  const bind = (qualifier: string, table: string) => {
    const key = lower(qualifier);
    (qualifiers.get(key) ?? qualifiers.set(key, new Set()).get(key)!).add(lower(table));
  };

  // CTE definitions: `name AS (`, `name (cols) AS (`, `name AS MATERIALIZED (`.
  for (let i = 0; i < tokens.length; i += 1) {
    if (!isIdentifier(tokens[i])) continue;
    let j = i + 1;
    if (isPunct(tokens[j], '(')) {
      let depth = 1;
      j += 1;
      while (j < tokens.length && depth > 0) {
        if (isPunct(tokens[j], '(')) depth += 1;
        else if (isPunct(tokens[j], ')')) depth -= 1;
        j += 1;
      }
    }
    if (!isWord(tokens[j], 'AS')) continue;
    j += 1;
    if (isWord(tokens[j], 'NOT')) j += 1;
    if (isWord(tokens[j], 'MATERIALIZED')) j += 1;
    if (isPunct(tokens[j], '(')) cteNames.add(lower(tokens[i]!.text));
  }

  let depth = 0;
  const expectTable = new Set<number>();
  const listOpen = new Set<number>();
  /** After a table factor at this depth: the table an alias would name ('' = derived). */
  const pendingAlias = new Map<number, string>();

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;

    if (isPunct(token, '(')) {
      if (expectTable.has(depth)) {
        // Derived table or parenthesised join; its contents are scanned as we go.
        expectTable.delete(depth);
        listOpen.add(depth);
        pendingAlias.set(depth, '');
        const outer = depth;
        depth += 1;
        // A parenthesised join starts with a table, not SELECT.
        if (!isWord(tokens[i + 1], 'SELECT') && !isWord(tokens[i + 1], 'WITH') && !isWord(tokens[i + 1], 'VALUES')) {
          expectTable.add(depth);
          pendingAlias.delete(outer);
        }
      } else {
        depth += 1;
      }
      continue;
    }
    if (isPunct(token, ')')) {
      expectTable.delete(depth);
      listOpen.delete(depth);
      pendingAlias.delete(depth);
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (isPunct(token, ',')) {
      pendingAlias.delete(depth);
      if (listOpen.has(depth)) expectTable.add(depth);
      continue;
    }

    // `a IS DISTINCT FROM b` compares values; it does not open a table list.
    const opensTableList =
      isWord(token, 'JOIN') || (isWord(token, 'FROM') && !isWord(tokens[i - 1], 'DISTINCT'));
    if (opensTableList) {
      pendingAlias.delete(depth);
      listOpen.delete(depth);
      expectTable.add(depth);
      continue;
    }

    if (expectTable.has(depth) && isIdentifier(token)) {
      // `schema.table` -> keep the last part.
      let end = i;
      while (isPunct(tokens[end + 1], '.') && isIdentifier(tokens[end + 2])) end += 2;
      const name = tokens[end]!.text;
      expectTable.delete(depth);
      listOpen.add(depth);
      if (isPunct(tokens[end + 1], '(')) {
        // Table-valued function, e.g. json_each(...): not a table.
        pendingAlias.set(depth, '');
      } else {
        referenced.push(name);
        bind(name, name);
        pendingAlias.set(depth, name);
      }
      i = end;
      continue;
    }

    if (pendingAlias.has(depth)) {
      if (isWord(token, 'AS')) continue;
      if (isIdentifier(token)) {
        bind(token.text, pendingAlias.get(depth)!);
        pendingAlias.delete(depth);
        continue;
      }
      pendingAlias.delete(depth);
    }

    if (isKeyword(token)) {
      expectTable.delete(depth);
      listOpen.delete(depth);
    }
  }

  const known = new Map(grounding.tables.map((t) => [lower(t.table), t]));
  const referencedTables = [...new Set(referenced.filter((name) => !cteNames.has(lower(name))))];
  const unknownTables = referencedTables.filter((name) => !known.has(lower(name)));

  const knownJoinIds = new Set(grounding.joins.map(joinIdentity));
  const resolve = (qualifier: string): GroundingTable | undefined => {
    const bound = qualifiers.get(lower(qualifier));
    if (!bound || bound.size !== 1) return undefined;
    const [table] = [...bound];
    if (!table || cteNames.has(table)) return undefined;
    const entry = known.get(table);
    return entry?.mapped ? entry : undefined;
  };

  const unknownJoins: SqlGroundingReport['unknownJoins'] = [];
  const seenConditions = new Set<string>();
  for (let i = 0; i + 6 < tokens.length; i += 1) {
    if (
      !isIdentifier(tokens[i]) ||
      !isPunct(tokens[i + 1], '.') ||
      !isIdentifier(tokens[i + 2]) ||
      !isPunct(tokens[i + 3], '=') ||
      !isIdentifier(tokens[i + 4]) ||
      !isPunct(tokens[i + 5], '.') ||
      !isIdentifier(tokens[i + 6])
    ) {
      continue;
    }
    // `a.b.c = ...` or `... = d.e.f`: not a plain column pair.
    if (isPunct(tokens[i - 1], '.') || isPunct(tokens[i + 7], '.')) continue;
    const left = resolve(tokens[i]!.text);
    const right = resolve(tokens[i + 4]!.text);
    if (!left || !right || lower(left.table) === lower(right.table)) continue;
    const pair = {
      leftTable: left.table,
      leftColumn: tokens[i + 2]!.text,
      rightTable: right.table,
      rightColumn: tokens[i + 6]!.text,
    };
    const identity = joinIdentity(pair);
    if (knownJoinIds.has(identity) || seenConditions.has(identity)) continue;
    seenConditions.add(identity);
    unknownJoins.push({
      condition: `${pair.leftTable}.${pair.leftColumn} = ${pair.rightTable}.${pair.rightColumn}`,
      knownJoins: findJoinPath(grounding, left.table, right.table) ?? [],
    });
  }

  return { referencedTables, unknownTables, unknownJoins };
}
