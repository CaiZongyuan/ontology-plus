import yaml from 'js-yaml';
import type {
  AggregateRoot,
  Attribute,
  BehaviorItem,
  InterfaceItem,
  ModelCode,
  ObjectTableMapping,
  OntologySuite,
  QueryReportItem,
  ValidationDiagnostic,
  ValidationReport,
} from './types.js';
import { validateOntologySuite } from './validator.js';

// Ontology Extraction, shared by the browser (live preview, review) and the
// server (job creation, merge gate). Everything here is pure and synchronous:
// no I/O, no LLM.

// ─── Evidence & candidates ────────────────────────────────────────────────────

/** 1-based inclusive line range inside the extraction source text. */
export interface SourceRange {
  startLine: number;
  endLine: number;
}

/**
 * How a candidate was derived: read off the source by the structural scan, or
 * judged by the LLM during semantic alignment. Deliberately an open set, so a
 * later origin (another source, a human) needs no migration of stored jobs.
 */
export type EvidenceOrigin = 'PARSED' | 'INFERRED' | (string & {});

export interface ExtractionEvidence {
  origin: EvidenceOrigin;
  note: string;
  lines?: SourceRange;
  excerpt?: string;
  /** The LLM cited a quote that is not in the source; nothing to check it against. */
  unverified?: boolean;
}

export type CandidateChange = 'ADDED' | 'MODIFIED';
export type CandidateDecision = 'ACCEPTED' | 'REJECTED';

export interface ExtractionCandidate {
  /** `${modelCode}/${collection}/${elementId}`. */
  key: string;
  modelCode: ModelCode;
  collection: string;
  elementId: string;
  label: string;
  /** Relative to the suite the extraction ran against. */
  change: CandidateChange;
  element: unknown;
  /** Empty when the element exists only to keep the suite consistent. */
  evidence: ExtractionEvidence[];
}

export interface SemanticAlignmentReport {
  /**
   * DONE: the LLM round ran and contributed. SKIPPED: it was not run. FAILED:
   * it was attempted and nothing usable came back. Anything but DONE means the
   * job holds the structural scan only.
   */
  status: 'DONE' | 'SKIPPED' | 'FAILED';
  /** Why the round did not run or did not contribute; rendered by the UI. */
  reason?:
    | 'MOCK_MODE'
    | 'NOT_REQUESTED'
    | 'LEGACY_JOB'
    | 'GATEWAY_ERROR'
    | 'UNUSABLE_RESPONSE';
  /** Provider diagnostics when the gateway call failed. */
  diagnostic?: {
    message: string;
    providerName?: string;
    baseUrl?: string;
    model?: string;
    remediation?: string;
  };
  /** How much of the source structure the size cap kept out of the LLM call. */
  omitted?: { tables: number; columns: number };
  /** LLM proposals discarded by `sanitizeAlignment` / the validator, with the reason. */
  dropped?: { item: string; reason: string }[];
}

export interface CandidateTally {
  total: number;
  /** Read off the source by the structural scan. */
  parsed: number;
  /** Exists only because the LLM inferred it. */
  inferred: number;
  /** No source evidence: added to keep the suite consistent. */
  supplemented: number;
  accepted: number;
  rejected: number;
}

export function tallyCandidates(
  candidates: ExtractionCandidate[],
  decisions: Record<string, CandidateDecision | undefined> = {},
): CandidateTally {
  const tally: CandidateTally = {
    total: candidates.length,
    parsed: 0,
    inferred: 0,
    supplemented: 0,
    accepted: 0,
    rejected: 0,
  };
  for (const cand of candidates) {
    if (cand.evidence.length === 0) tally.supplemented += 1;
    else if (cand.evidence.some((e) => e.origin === 'PARSED')) tally.parsed += 1;
    else tally.inferred += 1;
    if (decisions[cand.key] === 'ACCEPTED') tally.accepted += 1;
    else if (decisions[cand.key] === 'REJECTED') tally.rejected += 1;
  }
  return tally;
}

// ─── Source parsing ───────────────────────────────────────────────────────────

export interface ParsedSourceColumn {
  name: string;
  sqlType: string;
  nullable: boolean;
  unique: boolean;
  isPrimaryKey: boolean;
  fkTargetTable?: string;
  fkTargetColumn?: string;
}

export interface ParsedSourceTable {
  tableName: string;
  primaryKey: string;
  columns: ParsedSourceColumn[];
  foreignKeys: {
    fkName: string;
    localColumn: string;
    targetTable: string;
    targetColumn: string;
  }[];
  lines: SourceRange;
}

export interface ParsedSourceOperation {
  method: string;
  routePath: string;
  operationId?: string;
  summary?: string;
  lines?: SourceRange;
}

export interface ParsedSourceStructure {
  tables: ParsedSourceTable[];
  operations: ParsedSourceOperation[];
}

const EXCERPT_MAX_CHARS = 360;

function computeLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function offsetToLine(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function excerptOf(source: string, lines: SourceRange): string {
  const text = source
    .split(/\r?\n/)
    .slice(lines.startLine - 1, lines.endLine)
    .join('\n')
    .trim();
  return text.length > EXCERPT_MAX_CHARS ? `${text.slice(0, EXCERPT_MAX_CHARS)}…` : text;
}

function splitTopLevelCommas(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '(') depth += 1;
    else if (ch === ')' && depth > 0) depth -= 1;
    if (ch === ',' && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseTables(source: string, lineStarts: number[]): ParsedSourceTable[] {
  const results: ParsedSourceTable[] = [];
  const headerRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"a-zA-Z0-9_.]+)\s*\(/gi;
  let match: RegExpExecArray | null;

  while ((match = headerRegex.exec(source)) !== null) {
    const rawName = match[1]!.replace(/[`"]/g, '').replace(/^[a-zA-Z0-9_]+\./, '');
    let idx = headerRegex.lastIndex;
    let depth = 1;
    while (idx < source.length && depth > 0) {
      if (source[idx] === '(') depth += 1;
      else if (source[idx] === ')') depth -= 1;
      idx += 1;
    }
    const body = source.slice(headerRegex.lastIndex, Math.max(headerRegex.lastIndex, idx - 1));
    const items = splitTopLevelCommas(body);

    const columns: ParsedSourceColumn[] = [];
    const foreignKeys: ParsedSourceTable['foreignKeys'] = [];
    let primaryKey = '';

    for (const rawItem of items) {
      const item = rawItem.replace(/--.*$/gm, '').trim();
      if (!item) continue;

      const pkConstraint = item.match(/^(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (pkConstraint) {
        const firstPk = pkConstraint[1]!.split(',')[0]!.trim().replace(/[`"]/g, '');
        if (firstPk) primaryKey = firstPk;
        continue;
      }

      const fkConstraint = item.match(
        /^(?:CONSTRAINT\s+(\S+)\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+([`"a-zA-Z0-9_]+)\s*\(([^)]+)\)/i,
      );
      if (fkConstraint) {
        const localColumn = fkConstraint[2]!.trim().replace(/[`"]/g, '');
        const targetTable = fkConstraint[3]!.trim().replace(/[`"]/g, '');
        const targetColumn = fkConstraint[4]!.trim().replace(/[`"]/g, '');
        const fkName = fkConstraint[1]?.replace(/[`"]/g, '') ?? `fk_${rawName}_${localColumn}`;
        foreignKeys.push({ fkName, localColumn, targetTable, targetColumn });
        continue;
      }

      if (/^(?:CONSTRAINT|UNIQUE|INDEX|KEY|CHECK)\b/i.test(item)) continue;

      const colMatch = item.match(
        /^([`"a-zA-Z0-9_]+)\s+([a-zA-Z0-9_]+(?:\s*\([^)]*\))?)([\s\S]*)$/,
      );
      if (!colMatch) continue;
      const colName = colMatch[1]!.replace(/[`"]/g, '');
      const sqlType = colMatch[2]!.replace(/\s+/g, '');
      const rest = colMatch[3] ?? '';
      const isPk = /\bPRIMARY\s+KEY\b/i.test(rest);
      const notNull = isPk || /\bNOT\s+NULL\b/i.test(rest);
      const unique = /\bUNIQUE\b/i.test(rest);
      if (isPk && !primaryKey) primaryKey = colName;

      let fkTargetTable: string | undefined;
      let fkTargetColumn: string | undefined;
      const inlineRef = rest.match(/REFERENCES\s+([`"a-zA-Z0-9_]+)\s*(?:\(([^)]+)\))?/i);
      if (inlineRef) {
        fkTargetTable = inlineRef[1]!.replace(/[`"]/g, '');
        fkTargetColumn = (inlineRef[2] ?? 'id').trim().replace(/[`"]/g, '');
        foreignKeys.push({
          fkName: `fk_${rawName}_${colName}`,
          localColumn: colName,
          targetTable: fkTargetTable,
          targetColumn: fkTargetColumn,
        });
      }

      columns.push({
        name: colName,
        sqlType,
        nullable: !notNull,
        unique,
        isPrimaryKey: isPk,
        ...(fkTargetTable ? { fkTargetTable } : {}),
        ...(fkTargetColumn ? { fkTargetColumn } : {}),
      });
    }

    for (const fk of foreignKeys) {
      const col = columns.find((c) => c.name === fk.localColumn);
      if (col) {
        col.fkTargetTable = fk.targetTable;
        col.fkTargetColumn = fk.targetColumn;
      }
    }

    if (!primaryKey) {
      const idCol = columns.find((c) => c.name === 'id') ?? columns[0];
      primaryKey = idCol?.name ?? 'id';
      if (idCol) idCol.isPrimaryKey = true;
    } else {
      const pkCol = columns.find((c) => c.name === primaryKey);
      if (pkCol) pkCol.isPrimaryKey = true;
    }

    results.push({
      tableName: rawName,
      primaryKey,
      columns,
      foreignKeys,
      lines: {
        startLine: offsetToLine(lineStarts, match.index),
        endLine: offsetToLine(lineStarts, Math.max(match.index, idx - 1)),
      },
    });
  }

  // SOURCE_CODE snippets: TypeScript interface/type/class or Prisma model blocks.
  if (results.length === 0) {
    const codeEntityRegex =
      /(?:export\s+)?(?:interface|class|model|type)\s+([A-Z][A-Za-z0-9_]*)\s*(?:=\s*)?\{([\s\S]*?)\}/g;
    let codeMatch: RegExpExecArray | null;
    while ((codeMatch = codeEntityRegex.exec(source)) !== null) {
      const entityName = codeMatch[1]!;
      const body = codeMatch[2] ?? '';
      const tableName = `t_${entityName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()}`;
      const columns: ParsedSourceColumn[] = [];
      for (const rawLine of body.split(/\r?\n|;/)) {
        const line = rawLine.replace(/\/\/.*$/, '').trim();
        if (!line) continue;
        const tsField = line.match(
          /^(?:readonly\s+|public\s+|private\s+)?([a-zA-Z_][a-zA-Z0-9_]*)(\?)?\s*:\s*([A-Za-z0-9_[\]|<>'" ]+)/,
        );
        const prismaField = !tsField
          ? line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+(String|Int|Float|Decimal|Boolean|DateTime)\b(\?)?/)
          : null;
        if (!tsField && !prismaField) continue;
        const rawFieldName = (tsField?.[1] ?? prismaField?.[1])!;
        const optional = Boolean(tsField?.[2] || prismaField?.[3]);
        const rawType = (tsField?.[3] ?? prismaField?.[2] ?? 'string').toLowerCase();
        const colSnake = rawFieldName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
        const sqlType =
          rawType.includes('number') || rawType.includes('decimal') || rawType.includes('float')
            ? 'DECIMAL(18,2)'
            : rawType.includes('int')
              ? 'INTEGER'
              : rawType.includes('bool')
                ? 'BOOLEAN'
                : rawType.includes('date')
                  ? 'TIMESTAMP'
                  : 'VARCHAR(128)';
        columns.push({
          name: colSnake,
          sqlType,
          nullable: optional,
          unique: colSnake === 'id' || colSnake.endsWith('_no') || colSnake.endsWith('_code'),
          isPrimaryKey: colSnake === 'id',
        });
      }
      if (columns.length === 0) continue;
      if (!columns.some((c) => c.isPrimaryKey)) {
        columns.unshift({
          name: 'id',
          sqlType: 'VARCHAR(36)',
          nullable: false,
          unique: true,
          isPrimaryKey: true,
        });
      }
      results.push({
        tableName,
        primaryKey: 'id',
        columns,
        foreignKeys: [],
        lines: {
          startLine: offsetToLine(lineStarts, codeMatch.index),
          endLine: offsetToLine(lineStarts, codeMatch.index + codeMatch[0].length - 1),
        },
      });
    }
  }

  return results;
}

function parseOperations(source: string, lineStarts: number[]): ParsedSourceOperation[] {
  const ops: ParsedSourceOperation[] = [];
  const seen = new Set<string>();
  const sourceLines = source.split(/\r?\n/);

  const pushOp = (
    method: string,
    routePath: string,
    operationId?: string,
    summary?: string,
    line?: number,
  ) => {
    const upper = method.toUpperCase();
    const key = `${upper} ${routePath}`;
    if (seen.has(key)) return;
    seen.add(key);
    const foundLine =
      line ?? (sourceLines.findIndex((text) => text.includes(routePath)) + 1 || undefined);
    ops.push({
      method: upper,
      routePath,
      ...(operationId ? { operationId } : {}),
      ...(summary ? { summary } : {}),
      ...(foundLine ? { lines: { startLine: foundLine, endLine: foundLine } } : {}),
    });
  };

  // 1. Embedded OpenAPI YAML / JSON section.
  if (/\bpaths\s*:/i.test(source)) {
    const openapiStart = source.search(
      /(?:openapi\s*:|swagger\s*:|\{\s*"openapi"|\{\s*"paths"|paths\s*:)/i,
    );
    if (openapiStart >= 0) {
      try {
        const parsed = yaml.load(source.slice(openapiStart)) as Record<string, unknown> | null;
        const pathsObj =
          parsed && typeof parsed === 'object'
            ? ((parsed.paths ?? parsed) as Record<string, unknown>)
            : undefined;
        if (pathsObj && typeof pathsObj === 'object') {
          for (const [routePath, methodsObj] of Object.entries(pathsObj)) {
            if (!routePath.startsWith('/') || !methodsObj || typeof methodsObj !== 'object') continue;
            for (const [m, spec] of Object.entries(methodsObj as Record<string, unknown>)) {
              if (!/^(get|post|put|patch|delete)$/i.test(m)) continue;
              const specRec = (spec && typeof spec === 'object' ? spec : {}) as Record<string, unknown>;
              pushOp(
                m,
                routePath,
                specRec.operationId ? String(specRec.operationId) : undefined,
                specRec.summary ? String(specRec.summary) : undefined,
              );
            }
          }
        }
      } catch {
        // Mixed DDL + YAML rarely parses as one document; the line scan below covers it.
      }
    }

    let currentPath: string | undefined;
    sourceLines.forEach((line, i) => {
      const pathMatch = line.match(/^\s*['"]?(\/[a-zA-Z0-9_/{}-]+)['"]?\s*:\s*$/);
      if (pathMatch) {
        currentPath = pathMatch[1];
        return;
      }
      if (!currentPath) return;
      const methodMatch = line.match(/^\s{2,8}['"]?(get|post|put|patch|delete)['"]?\s*:\s*(.*)$/i);
      if (methodMatch) {
        pushOp(methodMatch[1]!, currentPath, undefined, undefined, i + 1);
        return;
      }
      if (/^\S/.test(line)) currentPath = undefined;
    });
  }

  // 2. Inline REST endpoint lines, e.g. `-- POST /api/v1/contracts/draft -> ...`.
  const inlineEndpointRegex =
    /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[a-zA-Z0-9_/{}-]+)(?:\s*(?:->|:|-)\s*([^\r\n]+))?/g;
  let inlineMatch: RegExpExecArray | null;
  while ((inlineMatch = inlineEndpointRegex.exec(source)) !== null) {
    pushOp(
      inlineMatch[1]!,
      inlineMatch[2]!,
      undefined,
      inlineMatch[3]?.trim(),
      offsetToLine(lineStarts, inlineMatch.index),
    );
  }

  return ops;
}

/** Deterministic read of tables and service operations out of pasted source material. */
export function parseSourceStructure(source: string): ParsedSourceStructure {
  const lineStarts = computeLineStarts(source);
  return {
    tables: parseTables(source, lineStarts),
    operations: parseOperations(source, lineStarts),
  };
}

// ─── Naming & typing helpers ──────────────────────────────────────────────────

const AUDIT_SKIP_COLUMNS = new Set([
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
  'deleted_at',
  'flag',
]);

function toCamelCase(snake: string): string {
  return snake
    .trim()
    .replace(/[`"]/g, '')
    .toLowerCase()
    .replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function toPascalCaseFromTable(tableName: string): string {
  const camel = toCamelCase(tableName.trim().replace(/[`"]/g, '').replace(/^t_/i, ''));
  return camel ? camel[0]!.toUpperCase() + camel.slice(1) : 'ExtractedEntity';
}

function tableTag(tableName: string): string {
  return tableName
    .replace(/^t_/i, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_');
}

function mapSqlTypeToOntologyType(sqlType: string): Attribute['type'] {
  const upper = sqlType.toUpperCase();
  if (/(INT|SERIAL)/.test(upper)) return 'Integer';
  if (/(DECIMAL|NUMERIC|NUMBER|REAL|FLOAT|DOUBLE)/.test(upper)) return 'Decimal';
  if (/(BOOL)/.test(upper)) return 'Boolean';
  if (/(TIMESTAMP|DATETIME)/.test(upper)) return 'DateTime';
  if (/\bDATE\b/.test(upper)) return 'Date';
  return 'String';
}

function sqlTypeFamily(sqlType: string | undefined): 'int' | 'num' | 'text' | 'other' {
  const upper = (sqlType ?? '').toUpperCase();
  if (/(INT|SERIAL)/.test(upper)) return 'int';
  if (/(DECIMAL|NUMERIC|NUMBER|REAL|FLOAT|DOUBLE)/.test(upper)) return 'num';
  if (/(CHAR|TEXT|UUID|STRING)/.test(upper)) return 'text';
  return 'other';
}

function typesCompatible(a: string | undefined, b: string | undefined): boolean {
  const fa = sqlTypeFamily(a);
  const fb = sqlTypeFamily(b);
  return fa === 'other' || fb === 'other' || fa === fb;
}

// ─── Suite element addressing ─────────────────────────────────────────────────

const ELEMENT_COLLECTIONS: { modelCode: ModelCode; collection: string; idKey: string }[] = [
  { modelCode: 'M1', collection: 'aggregates', idKey: 'id' },
  { modelCode: 'M1', collection: 'data_dictionaries', idKey: 'id' },
  { modelCode: 'M1', collection: 'aggregate_associations', idKey: 'id' },
  { modelCode: 'M2', collection: 'behaviors', idKey: 'id' },
  { modelCode: 'M3', collection: 'rules', idKey: 'id' },
  { modelCode: 'ME', collection: 'events', idKey: 'id' },
  { modelCode: 'M4', collection: 'event_scenarios', idKey: 'id' },
  { modelCode: 'M5', collection: 'actors', idKey: 'id' },
  { modelCode: 'M5', collection: 'roles', idKey: 'id' },
  { modelCode: 'M5', collection: 'permissionGroups', idKey: 'id' },
  { modelCode: 'M5', collection: 'permissions', idKey: 'id' },
  { modelCode: 'M6', collection: 'flows', idKey: 'id' },
  { modelCode: 'M7', collection: 'query_reports', idKey: 'id' },
  { modelCode: 'MU', collection: 'screens', idKey: 'screenId' },
  { modelCode: 'MU', collection: 'navigation_edges', idKey: 'id' },
  { modelCode: 'MU', collection: 'cross_cutting_ui', idKey: 'id' },
  { modelCode: 'MM', collection: 'mappings', idKey: 'id' },
  { modelCode: 'MI', collection: 'interfaces', idKey: 'interfaceId' },
];

const EMPTY_MODEL_FACTORIES: Record<ModelCode, (domain: string) => Record<string, unknown>> = {
  M1: (domain) => ({
    model_type: 'OBJECT',
    version: '5.0',
    domain,
    aggregates: [],
    data_dictionaries: [],
    aggregate_associations: [],
  }),
  M2: (domain) => ({ model_type: 'BEHAVIOR', version: '5.0', domain, behaviors: [] }),
  M3: (domain) => ({ model_type: 'RULE', version: '5.0', domain, rules: [] }),
  ME: (domain) => ({ model_type: 'EVENT', version: '5.0', domain, events: [] }),
  M4: (domain) => ({ model_type: 'SCENARIO', version: '5.0', domain, event_scenarios: [] }),
  M5: (domain) => ({
    model_type: 'ACTOR',
    version: '5.0',
    domain,
    actors: [],
    roles: [],
    permissions: [],
  }),
  M6: (domain) => ({ model_type: 'FLOW', version: '5.0', domain, flows: [] }),
  M7: (domain) => ({ model_type: 'QUERY_REPORT', version: '5.0', domain, query_reports: [] }),
  MU: (domain) => ({
    model_type: 'UI',
    version: '5.0',
    domain,
    screens: [],
    navigation_edges: [],
    cross_cutting_ui: [],
  }),
  MM: (domain) => ({ model_type: 'MAPPING', version: '1.0', domain, mappings: [] }),
  MI: (domain) => ({ model_type: 'INTERFACE', version: '1.0', domain, interfaces: [] }),
};

type LooseModel = Record<string, unknown>;
type LooseElement = Record<string, unknown>;

export function candidateKey(modelCode: ModelCode, collection: string, elementId: string): string {
  return `${modelCode}/${collection}/${elementId}`;
}

function cloneSuite(suite: OntologySuite): OntologySuite {
  return JSON.parse(JSON.stringify(suite)) as OntologySuite;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec)
      .filter((k) => rec[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(rec[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function elementsOf(suite: OntologySuite, modelCode: ModelCode, collection: string): LooseElement[] {
  const model = suite[modelCode] as LooseModel | undefined;
  const list = model?.[collection];
  return Array.isArray(list) ? (list as LooseElement[]) : [];
}

function labelOf(element: LooseElement, collection: string, elementId: string): string {
  if (collection === 'aggregate_associations') {
    return `${String(element.sourceAggregate)} → ${String(element.targetAggregate)}`;
  }
  if (collection === 'mappings') {
    const tables = (element.tableMappings as { tableName: string }[] | undefined) ?? [];
    return `${String(element.objectName)} ↔ ${tables.map((t) => t.tableName).join(', ')}`;
  }
  return String(element.alias ?? element.label ?? element.name ?? elementId);
}

// ─── Structural scan (round 1, deterministic) ─────────────────────────────────

export interface StructuralScanResult {
  /** The suite the scan ran against, plus everything read off the source. */
  suite: OntologySuite;
  evidenceByKey: Record<string, ExtractionEvidence[]>;
  tables: ParsedSourceTable[];
  operations: ParsedSourceOperation[];
  /** Tables of this source whose aggregate did not exist before the scan. */
  newAggregateTables: string[];
}

export function scanSourceStructure(input: {
  baseSuite: OntologySuite;
  source: string;
  domain: string;
}): StructuralScanResult {
  const { source, domain } = input;
  const { tables, operations } = parseSourceStructure(source);
  const suite = cloneSuite(input.baseSuite);
  const evidenceByKey: Record<string, ExtractionEvidence[]> = {};
  const newAggregateTables: string[] = [];

  const addEvidence = (
    modelCode: ModelCode,
    collection: string,
    elementId: string,
    note: string,
    lines?: SourceRange,
  ) => {
    const key = candidateKey(modelCode, collection, elementId);
    (evidenceByKey[key] ??= []).push({
      origin: 'PARSED',
      note,
      ...(lines ? { lines, excerpt: excerptOf(source, lines) } : {}),
    });
  };

  const M1 = (suite.M1 ??= EMPTY_MODEL_FACTORIES.M1(domain) as NonNullable<OntologySuite['M1']>);
  const M2 = (suite.M2 ??= EMPTY_MODEL_FACTORIES.M2(domain) as NonNullable<OntologySuite['M2']>);
  const M7 = (suite.M7 ??= EMPTY_MODEL_FACTORIES.M7(domain) as NonNullable<OntologySuite['M7']>);
  const MM = (suite.MM ??= EMPTY_MODEL_FACTORIES.MM(domain) as NonNullable<OntologySuite['MM']>);
  const MI = (suite.MI ??= EMPTY_MODEL_FACTORIES.MI(domain) as NonNullable<OntologySuite['MI']>);

  // The validator binds every QUERY behavior 1-to-1 with an M7 item; keep
  // pre-existing behaviors valid once M7 is present.
  for (const existingBhv of M2.behaviors) {
    if (existingBhv.behaviorType !== 'QUERY' || existingBhv.queryReportRef) continue;
    const fallbackQryId = `QRY-AUTO-${existingBhv.id}`;
    existingBhv.queryReportRef = fallbackQryId;
    if (M7.query_reports.some((q) => q.id === fallbackQryId)) continue;
    M7.query_reports.push({
      id: fallbackQryId,
      name: `${existingBhv.name}Query`,
      alias: existingBhv.alias,
      queryType: 'LIST_QUERY',
      behaviorRef: existingBhv.id,
      primarySource: { aggregateRef: existingBhv.ownerEntity, alias: 't' },
      joins: [],
      parameters: [],
      conditions: [],
      resultColumns: [],
      groupBy: [],
      orderBy: [],
      referenceSql: {
        dialect: 'SQLite',
        sql: `SELECT * FROM ${existingBhv.ownerEntity.toLowerCase()} t`,
        parameterMappings: [],
        resultMappings: [],
      },
    } as QueryReportItem);
  }

  const tableToAggName = new Map<string, string>();
  for (const existingMapping of MM.mappings) {
    for (const tm of existingMapping.tableMappings) {
      tableToAggName.set(tm.tableName.toLowerCase(), existingMapping.objectName);
    }
  }
  for (const tbl of tables) {
    tableToAggName.set(tbl.tableName.toLowerCase(), toPascalCaseFromTable(tbl.tableName));
  }

  const createdBehaviorByAgg = new Map<string, { cmdId: string; qryId: string }>();

  for (const tbl of tables) {
    const objectName = toPascalCaseFromTable(tbl.tableName);
    const upperTag = tableTag(tbl.tableName);
    const tableNote = `CREATE TABLE ${tbl.tableName}`;

    let agg: AggregateRoot | undefined = M1.aggregates.find(
      (a) => a.name.toLowerCase() === objectName.toLowerCase(),
    );
    const extractedAttributes: Attribute[] = [];

    for (const col of tbl.columns) {
      if (col.isPrimaryKey || col.name.toLowerCase() === 'id') continue;
      if (AUDIT_SKIP_COLUMNS.has(col.name.toLowerCase())) continue;

      const attrName = toCamelCase(col.name);
      const targetAggName = col.fkTargetTable
        ? tableToAggName.get(col.fkTargetTable.toLowerCase())
        : undefined;
      const targetExistsInM1 =
        Boolean(targetAggName) &&
        (M1.aggregates.some((a) => a.name === targetAggName) ||
          tables.some((pt) => toPascalCaseFromTable(pt.tableName) === targetAggName));

      if (targetAggName && targetExistsInM1 && targetAggName !== objectName) {
        extractedAttributes.push({
          name: attrName,
          label: col.name,
          type: 'AggregateRootRef',
          required: !col.nullable,
          ...(col.unique ? { unique: true } : {}),
          targetAggregate: targetAggName,
        });
      } else {
        extractedAttributes.push({
          name: attrName,
          label: col.name,
          type: mapSqlTypeToOntologyType(col.sqlType),
          required: !col.nullable,
          ...(col.unique ? { unique: true } : {}),
        });
      }
    }

    if (extractedAttributes.length === 0) {
      extractedAttributes.push({ name: 'code', label: '业务编码', type: 'String', required: false });
    }

    if (!agg) {
      agg = {
        id: `AGG-EXT-${upperTag}`,
        name: objectName,
        alias: `${objectName} (${tbl.tableName})`,
        aggregateType: 'AGGREGATE_ROOT',
        description: `从物理数据表 ${tbl.tableName} 自动萃取生成的领域聚合根。`,
        lifecycle: ['ACTIVE', 'ARCHIVED'],
        tags: ['EXTRACTED'],
        attributes: extractedAttributes,
        entities: [],
        valueObjects: [],
        invariants: [],
      };
      M1.aggregates.push(agg);
      newAggregateTables.push(tbl.tableName);
    } else {
      for (const newAttr of extractedAttributes) {
        if (!agg.attributes.some((a) => a.name === newAttr.name)) agg.attributes.push(newAttr);
      }
    }
    addEvidence('M1', 'aggregates', agg.id, tableNote, tbl.lines);

    for (const fk of tbl.foreignKeys) {
      const targetAggName = tableToAggName.get(fk.targetTable.toLowerCase());
      if (!targetAggName || targetAggName === agg.name) continue;
      const assocId = `ASSOC-EXT-${upperTag}-${toCamelCase(fk.localColumn).toUpperCase()}`;
      if (!M1.aggregate_associations.some((a) => a.id === assocId)) {
        M1.aggregate_associations.push({
          id: assocId,
          sourceAggregate: agg.name,
          targetAggregate: targetAggName,
          associationType: 'REFERENCE',
          sourceRole: toCamelCase(agg.name),
          targetRole: toCamelCase(targetAggName),
          cardinality: 'MANY_TO_ONE',
          referenceField: toCamelCase(fk.localColumn),
        });
      }
      addEvidence(
        'M1',
        'aggregate_associations',
        assocId,
        `FOREIGN KEY ${tbl.tableName}.${fk.localColumn} → ${fk.targetTable}.${fk.targetColumn}`,
        tbl.lines,
      );
    }

    const mappingId = `MAP-EXT-${upperTag}`;
    const aggName = agg.name;
    const tableMappingEntry: ObjectTableMapping['tableMappings'][number] = {
      tableName: tbl.tableName,
      tableRole: 'MASTER',
      primaryKey: tbl.primaryKey,
      foreignKeys: tbl.foreignKeys.map((fk) => ({ ...fk })),
      columnMappings: tbl.columns
        .filter((col) => !AUDIT_SKIP_COLUMNS.has(col.name.toLowerCase()))
        .map((col) => {
          const isPk = col.isPrimaryKey || col.name === tbl.primaryKey;
          return {
            attributeRef: isPk ? `${aggName}.id` : `${aggName}.${toCamelCase(col.name)}`,
            column: col.name,
            columnType: col.sqlType,
            nullable: col.nullable,
            ...(col.unique ? { unique: true } : {}),
            ...(isPk ? { isPrimaryKey: true } : {}),
            ...(col.fkTargetTable ? { isForeignKey: true, fkTargetTable: col.fkTargetTable } : {}),
            ...(col.fkTargetColumn ? { fkTargetColumn: col.fkTargetColumn } : {}),
          };
        }),
    };

    const existingMap = MM.mappings.find((m) => m.id === mappingId || m.objectName === aggName);
    if (existingMap) {
      const tblIdx = existingMap.tableMappings.findIndex((t) => t.tableName === tbl.tableName);
      if (tblIdx >= 0) existingMap.tableMappings[tblIdx] = tableMappingEntry;
      else existingMap.tableMappings.push(tableMappingEntry);
    } else {
      MM.mappings.push({
        id: mappingId,
        objectRef: agg.id,
        objectRole: 'AGGREGATE_ROOT',
        objectName: aggName,
        mappingNote: `Extracted from DDL table ${tbl.tableName}`,
        tableMappings: [tableMappingEntry],
      });
    }
    addEvidence('MM', 'mappings', existingMap?.id ?? mappingId, tableNote, tbl.lines);

    const cmdBhvId = `BHV-EXT-CMD-${upperTag}`;
    const qryBhvId = `BHV-EXT-QRY-${upperTag}`;
    const qryReportId = `QRY-EXT-${upperTag}`;
    const templateNote = `按表 ${tbl.tableName} 生成的标准模板`;

    if (!M2.behaviors.some((b) => b.id === cmdBhvId)) {
      M2.behaviors.push({
        id: cmdBhvId,
        name: `save${aggName}`,
        alias: `保存${aggName}`,
        ownerEntity: aggName,
        behaviorType: 'COMMAND',
        triggerType: 'EXTERNAL',
        description: `由存量表 ${tbl.tableName} 萃取生成的标准命令行为。`,
        inputParameters: agg.attributes.slice(0, 5).map((a) => ({
          name: a.name,
          label: a.label,
          type: a.type,
          required: a.required,
        })),
        outputParameters: [{ name: 'id', label: '主键ID', type: 'String', required: true }],
        preconditions: [],
        stateChanges: [],
        invokedRules: [],
        producedEvents: [],
        requiredPermissions: [],
      } as BehaviorItem);
      addEvidence('M2', 'behaviors', cmdBhvId, templateNote, tbl.lines);
    }

    if (!M2.behaviors.some((b) => b.id === qryBhvId)) {
      M2.behaviors.push({
        id: qryBhvId,
        name: `list${aggName}`,
        alias: `分页查询${aggName}`,
        ownerEntity: aggName,
        behaviorType: 'QUERY',
        triggerType: 'EXTERNAL',
        description: `由存量表 ${tbl.tableName} 萃取生成的标准列表查询行为。`,
        inputParameters: [],
        outputParameters: [{ name: 'items', label: '列表记录', type: 'Array', required: true }],
        preconditions: [],
        stateChanges: [],
        invokedRules: [],
        producedEvents: [],
        requiredPermissions: [],
        queryReportRef: qryReportId,
      } as BehaviorItem);
      addEvidence('M2', 'behaviors', qryBhvId, templateNote, tbl.lines);
    }

    if (!M7.query_reports.some((q) => q.id === qryReportId)) {
      const selectCols = tbl.columns
        .filter((c) => !AUDIT_SKIP_COLUMNS.has(c.name.toLowerCase()))
        .slice(0, 6);
      const resultCols = selectCols.map((c) => ({
        name: toCamelCase(c.name),
        label: c.name,
        sourceExpr: `t.${c.name}`,
        dataType: mapSqlTypeToOntologyType(c.sqlType),
      }));
      const sqlProjection =
        selectCols.length > 0
          ? selectCols.map((c) => `t.${c.name} AS ${toCamelCase(c.name)}`).join(', ')
          : 't.*';
      M7.query_reports.push({
        id: qryReportId,
        name: `${aggName}ListQuery`,
        alias: `${aggName}台账列表查询`,
        queryType: 'LIST_QUERY',
        behaviorRef: qryBhvId,
        description: `针对物理表 ${tbl.tableName} 的分页查询语义定义。`,
        primarySource: { aggregateRef: aggName, alias: 't' },
        joins: [],
        parameters: [],
        conditions: [],
        resultColumns: resultCols,
        groupBy: [],
        orderBy: [],
        pagination: { enabled: true, defaultPageSize: 20, maxPageSize: 100 },
        referenceSql: {
          dialect: 'SQLite',
          sql: `SELECT ${sqlProjection} FROM ${tbl.tableName} t`,
          parameterMappings: [],
          resultMappings: resultCols.map((rc) => rc.name),
        },
      } as QueryReportItem);
      addEvidence('M7', 'query_reports', qryReportId, templateNote, tbl.lines);
    }

    createdBehaviorByAgg.set(aggName.toLowerCase(), { cmdId: cmdBhvId, qryId: qryBhvId });
  }

  // Service operations -> MI interfaces, each bound to a behavior so PROVIDED
  // interface validation holds.
  const primaryAgg = M1.aggregates[M1.aggregates.length - 1];

  operations.forEach((op, i) => {
    const slug = `${op.method}_${op.routePath}`
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32);
    const interfaceId = `IF-EXT-${slug || i + 1}`;
    if (MI.interfaces.some((it) => it.interfaceId === interfaceId)) return;

    const opNote = `${op.method} ${op.routePath}`;
    const isQuery = op.method === 'GET';
    let relatedBehaviorRef: string | undefined;
    let relatedReportRef: string | undefined;

    if (primaryAgg) {
      const pair = createdBehaviorByAgg.get(primaryAgg.name.toLowerCase());
      if (pair) relatedBehaviorRef = isQuery ? pair.qryId : pair.cmdId;
    }
    if (!relatedBehaviorRef) {
      const existingMatch = M2.behaviors.find((b) =>
        isQuery ? b.behaviorType === 'QUERY' : b.behaviorType === 'COMMAND',
      );
      if (existingMatch) {
        relatedBehaviorRef = existingMatch.id;
      } else if (primaryAgg) {
        const autoBhvId = `BHV-API-${slug || i + 1}`;
        const autoBhv = {
          id: autoBhvId,
          name: op.operationId ?? `${isQuery ? 'queryApi' : 'invokeApi'}${i + 1}`,
          alias: op.summary ?? opNote,
          ownerEntity: primaryAgg.name,
          behaviorType: isQuery ? 'QUERY' : 'COMMAND',
          triggerType: 'EXTERNAL',
          inputParameters: [],
          outputParameters: [],
          preconditions: [],
          stateChanges: [],
          invokedRules: [],
          producedEvents: [],
          requiredPermissions: [],
        } as BehaviorItem;
        if (isQuery) {
          const autoQryId = `QRY-API-${slug || i + 1}`;
          autoBhv.queryReportRef = autoQryId;
          M7.query_reports.push({
            id: autoQryId,
            name: `${op.operationId ?? `ApiQuery${i + 1}`}Report`,
            alias: op.summary ?? opNote,
            queryType: 'LIST_QUERY',
            behaviorRef: autoBhvId,
            primarySource: { aggregateRef: primaryAgg.name, alias: 't' },
            joins: [],
            parameters: [],
            conditions: [],
            resultColumns: [],
            groupBy: [],
            orderBy: [],
            referenceSql: {
              dialect: 'SQLite',
              sql: `SELECT * FROM ${primaryAgg.name.toLowerCase()} t`,
              parameterMappings: [],
              resultMappings: [],
            },
          } as QueryReportItem);
          addEvidence('M7', 'query_reports', autoQryId, opNote, op.lines);
          relatedReportRef = autoQryId;
        }
        M2.behaviors.push(autoBhv);
        addEvidence('M2', 'behaviors', autoBhvId, opNote, op.lines);
        relatedBehaviorRef = autoBhvId;
      }
    }

    if (!relatedReportRef && isQuery && relatedBehaviorRef) {
      relatedReportRef = M2.behaviors.find((b) => b.id === relatedBehaviorRef)?.queryReportRef;
    }

    MI.interfaces.push({
      interfaceId,
      name: op.summary ?? op.operationId ?? opNote,
      direction: 'PROVIDED',
      interfaceCategory: isQuery ? 'QUERY' : 'COMMAND',
      protocol: 'REST',
      format: 'JSON',
      contractNote: opNote,
      description: `从 OpenAPI 接口契约 ${opNote} 萃取生成。`,
      ...(relatedBehaviorRef ? { relatedBehaviorRef } : {}),
      ...(primaryAgg ? { relatedEntityRef: primaryAgg.name } : {}),
      ...(relatedReportRef ? { relatedReportRef } : {}),
      inputFields: [],
      outputFields: [
        { name: 'code', label: '状态码', type: 'Integer', required: true },
        { name: 'data', label: '响应载荷', type: 'Object', required: false },
      ],
      returnRules: [{ code: '200', scenario: '调用成功', httpStatus: 200, message: 'OK' }],
    } as InterfaceItem);
    addEvidence('MI', 'interfaces', interfaceId, opNote, op.lines);
  });

  return { suite, evidenceByKey, tables, operations, newAggregateTables };
}

// ─── Candidates: diff, classify, merge ────────────────────────────────────────

/**
 * Every element of `next` that is new or different relative to `base`, as a
 * reviewable candidate. Extraction never removes, so removals are not reported.
 */
export function buildExtractionCandidates(
  base: OntologySuite,
  next: OntologySuite,
  evidenceByKey: Record<string, ExtractionEvidence[]> = {},
): ExtractionCandidate[] {
  const candidates: ExtractionCandidate[] = [];
  for (const { modelCode, collection, idKey } of ELEMENT_COLLECTIONS) {
    const baseById = new Map(
      elementsOf(base, modelCode, collection).map((el) => [String(el[idKey]), el]),
    );
    for (const element of elementsOf(next, modelCode, collection)) {
      const elementId = String(element[idKey]);
      const before = baseById.get(elementId);
      if (before && stableStringify(before) === stableStringify(element)) continue;
      const key = candidateKey(modelCode, collection, elementId);
      candidates.push({
        key,
        modelCode,
        collection,
        elementId,
        label: labelOf(element, collection, elementId),
        change: before ? 'MODIFIED' : 'ADDED',
        element,
        evidence: evidenceByKey[key] ?? [],
      });
    }
  }
  return candidates;
}

/** Where each candidate stands against the suite as it is *now*. */
export function classifyCandidates(
  current: OntologySuite,
  candidates: ExtractionCandidate[],
): Record<string, CandidateChange | 'UNCHANGED'> {
  const result: Record<string, CandidateChange | 'UNCHANGED'> = {};
  for (const cand of candidates) {
    const idKey =
      ELEMENT_COLLECTIONS.find(
        (c) => c.modelCode === cand.modelCode && c.collection === cand.collection,
      )?.idKey ?? 'id';
    const existing = elementsOf(current, cand.modelCode, cand.collection).find(
      (el) => String(el[idKey]) === cand.elementId,
    );
    result[cand.key] = !existing
      ? 'ADDED'
      : stableStringify(existing) === stableStringify(cand.element)
        ? 'UNCHANGED'
        : 'MODIFIED';
  }
  return result;
}

function mergeCandidates(
  current: OntologySuite,
  candidates: ExtractionCandidate[],
  domain: string,
): OntologySuite {
  const suite = cloneSuite(current);
  for (const cand of candidates) {
    const spec = ELEMENT_COLLECTIONS.find(
      (c) => c.modelCode === cand.modelCode && c.collection === cand.collection,
    );
    if (!spec) continue;
    const loose = suite as Record<string, LooseModel | undefined>;
    const model = (loose[cand.modelCode] ??= EMPTY_MODEL_FACTORIES[cand.modelCode](domain));
    const list = (Array.isArray(model[cand.collection])
      ? model[cand.collection]
      : (model[cand.collection] = [])) as LooseElement[];
    const element = JSON.parse(JSON.stringify(cand.element)) as LooseElement;
    const idx = list.findIndex((el) => String(el[spec.idKey]) === cand.elementId);
    if (idx >= 0) list[idx] = element;
    else list.push(element);
  }
  return suite;
}

function diagnosticIdentity(d: ValidationDiagnostic): string {
  return [d.code, d.model, d.elementId ?? '', d.path ?? ''].join('|');
}

export interface CandidateMergePreview {
  suite: OntologySuite;
  validation: ValidationReport;
  acceptedCount: number;
  /** Consistency Errors the merge would introduce; non-empty blocks applying. */
  newErrors: ValidationDiagnostic[];
}

/**
 * Merge the accepted candidates into the suite as it is now and validate the
 * result. The browser calls this while the reviewer toggles decisions; the
 * server calls it again as the gate before saving.
 */
export function previewCandidateMerge(input: {
  current: OntologySuite;
  candidates: ExtractionCandidate[];
  decisions: Record<string, CandidateDecision | undefined>;
  domain: string;
}): CandidateMergePreview {
  const accepted = input.candidates.filter((c) => input.decisions[c.key] === 'ACCEPTED');
  const suite = mergeCandidates(input.current, accepted, input.domain);
  const validation = validateOntologySuite(suite);
  const known = new Set(
    validateOntologySuite(input.current)
      .diagnostics.filter((d) => d.tier === 'ERROR')
      .map(diagnosticIdentity),
  );
  const newErrors = validation.diagnostics.filter(
    (d) => d.tier === 'ERROR' && !known.has(diagnosticIdentity(d)),
  );
  return { suite, validation, acceptedCount: accepted.length, newErrors };
}

// ─── Semantic alignment (round 2): what the LLM may choose from ───────────────

export interface AlignmentSkeleton {
  /** Tables read from this source; the only ones the LLM may label. */
  tables: {
    table: string;
    primaryKey: string;
    columns: {
      column: string;
      sqlType: string;
      declaredRef?: string;
      /** Tables this column may be judged to reference. Absent means "not a reference". */
      refCandidates?: string[];
    }[];
  }[];
  /** Tables already mapped in the project: valid reference targets, never relabeled. */
  knownTables: { table: string; primaryKey: string; objectName: string }[];
  /** What the size cap left out of this skeleton, if anything. */
  omitted?: { tables: number; columns: number };
}

interface RefTarget {
  table: string;
  primaryKeyType?: string;
}

function looksLikeReferenceColumn(name: string): boolean {
  return /(_id|Id)$/.test(name) && name.toLowerCase() !== 'id';
}

/** Upper bound on what one semantic-alignment call is shown. */
export const ALIGNMENT_MAX_TABLES = 40;
export const ALIGNMENT_MAX_COLUMNS_PER_TABLE = 60;

export function buildAlignmentSkeleton(scan: StructuralScanResult): AlignmentSkeleton {
  const sourceTableNames = new Set(scan.tables.map((t) => t.tableName.toLowerCase()));
  const knownTables: AlignmentSkeleton['knownTables'] = [];
  const targets: RefTarget[] = scan.tables.map((t) => ({
    table: t.tableName,
    primaryKeyType: t.columns.find((c) => c.name === t.primaryKey)?.sqlType,
  }));

  for (const mapping of scan.suite.MM?.mappings ?? []) {
    for (const tm of mapping.tableMappings) {
      if (sourceTableNames.has(tm.tableName.toLowerCase())) continue;
      knownTables.push({
        table: tm.tableName,
        primaryKey: tm.primaryKey,
        objectName: mapping.objectName,
      });
      targets.push({
        table: tm.tableName,
        primaryKeyType: tm.columnMappings.find((c) => c.column === tm.primaryKey)?.columnType,
      });
    }
  }

  const shownTables = scan.tables.slice(0, ALIGNMENT_MAX_TABLES);
  const omittedTables = scan.tables.length - shownTables.length;
  const omittedColumns = shownTables.reduce(
    (sum, t) => sum + Math.max(0, t.columns.length - ALIGNMENT_MAX_COLUMNS_PER_TABLE),
    0,
  );

  return {
    ...(omittedTables > 0 || omittedColumns > 0 ? { omitted: { tables: omittedTables, columns: omittedColumns } } : {}),
    tables: shownTables.map((t) => ({
      table: t.tableName,
      primaryKey: t.primaryKey,
      columns: t.columns.slice(0, ALIGNMENT_MAX_COLUMNS_PER_TABLE).map((c) => {
        const isCandidate =
          !c.isPrimaryKey && !c.fkTargetTable && looksLikeReferenceColumn(c.name);
        const refCandidates = isCandidate
          ? targets
              .filter(
                (target) =>
                  target.table !== t.tableName &&
                  typesCompatible(c.sqlType, target.primaryKeyType),
              )
              .map((target) => target.table)
          : [];
        return {
          column: c.name,
          sqlType: c.sqlType,
          ...(c.fkTargetTable ? { declaredRef: c.fkTargetTable } : {}),
          ...(refCandidates.length > 0 ? { refCandidates } : {}),
        };
      }),
    })),
    knownTables,
  };
}

export interface SanitizedAlignment {
  tableLabels: { table: string; alias?: string; description?: string }[];
  columnLabels: { table: string; column: string; label: string }[];
  inferredRefs: { table: string; column: string; targetTable: string }[];
  dropped: { item: string; reason: string }[];
}

function cleanText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  return text && text.length <= maxChars ? text : undefined;
}

/**
 * Reduce a raw LLM alignment answer to what the skeleton allows. The LLM picks
 * from listed candidates or says null; anything else is dropped and recorded,
 * never repaired by guessing.
 */
export function sanitizeAlignment(skeleton: AlignmentSkeleton, raw: unknown): SanitizedAlignment {
  const result: SanitizedAlignment = {
    tableLabels: [],
    columnLabels: [],
    inferredRefs: [],
    dropped: [],
  };
  const rawTables = (raw as { tables?: unknown } | null)?.tables;
  if (!Array.isArray(rawTables)) {
    result.dropped.push({ item: '(response)', reason: 'no "tables" array' });
    return result;
  }

  const seenTables = new Set<string>();
  for (const entry of rawTables as Record<string, unknown>[]) {
    const tableName = typeof entry?.table === 'string' ? entry.table : '';
    const skel = skeleton.tables.find((t) => t.table === tableName);
    if (!skel || seenTables.has(tableName)) {
      result.dropped.push({
        item: tableName || '(table)',
        reason: skel ? 'duplicate table' : 'table is not in the scanned source',
      });
      continue;
    }
    seenTables.add(tableName);

    const alias = cleanText(entry.alias, 40);
    const description = cleanText(entry.description, 200);
    if (alias || description) {
      result.tableLabels.push({
        table: tableName,
        ...(alias ? { alias } : {}),
        ...(description ? { description } : {}),
      });
    }

    const seenColumns = new Set<string>();
    for (const colEntry of (Array.isArray(entry.columns) ? entry.columns : []) as Record<
      string,
      unknown
    >[]) {
      const columnName = typeof colEntry?.column === 'string' ? colEntry.column : '';
      const item = `${tableName}.${columnName || '(column)'}`;
      const skelCol = skel.columns.find((c) => c.column === columnName);
      if (!skelCol || seenColumns.has(columnName)) {
        result.dropped.push({
          item,
          reason: skelCol ? 'duplicate column' : 'column is not in the scanned table',
        });
        continue;
      }
      seenColumns.add(columnName);

      const label = cleanText(colEntry.label, 40);
      if (label) result.columnLabels.push({ table: tableName, column: columnName, label });

      const refTable = colEntry.refTable;
      if (refTable === null || refTable === undefined || refTable === '') continue;
      if (typeof refTable !== 'string' || !skelCol.refCandidates?.includes(refTable)) {
        result.dropped.push({
          item: `${item} → ${String(refTable)}`,
          reason: 'reference target is not one of the listed candidates',
        });
        continue;
      }
      result.inferredRefs.push({ table: tableName, column: columnName, targetTable: refTable });
    }
  }
  return result;
}

function errorCount(suite: OntologySuite): number {
  return validateOntologySuite(suite).errorCount;
}

/**
 * Apply a sanitized alignment to a structural scan. Labels touch only the
 * aggregates this scan created. Each inferred reference becomes its own
 * association candidate and is kept only if the suite stays consistent.
 */
export function applyAlignment(
  scan: StructuralScanResult,
  alignment: SanitizedAlignment,
  source: string,
): { scan: StructuralScanResult; dropped: { item: string; reason: string }[] } {
  const suite = cloneSuite(scan.suite);
  const evidenceByKey: Record<string, ExtractionEvidence[]> = Object.fromEntries(
    Object.entries(scan.evidenceByKey).map(([k, v]) => [k, [...v]]),
  );
  const dropped = [...alignment.dropped];
  const M1 = suite.M1;
  if (!M1) return { scan, dropped };

  const tableByName = new Map(scan.tables.map((t) => [t.tableName, t]));
  const newTables = new Set(scan.newAggregateTables);
  const aggForTable = (tableName: string): AggregateRoot | undefined => {
    const name = toPascalCaseFromTable(tableName);
    return M1.aggregates.find((a) => a.name === name);
  };
  const targetAggName = (tableName: string): string | undefined => {
    if (tableByName.has(tableName)) return toPascalCaseFromTable(tableName);
    return suite.MM?.mappings.find((m) =>
      m.tableMappings.some((tm) => tm.tableName === tableName),
    )?.objectName;
  };

  const labelledAggs = new Map<string, number>();
  for (const tl of alignment.tableLabels) {
    const agg = newTables.has(tl.table) ? aggForTable(tl.table) : undefined;
    if (!agg) continue;
    if (tl.alias) agg.alias = tl.alias;
    if (tl.description) agg.description = tl.description;
    labelledAggs.set(agg.id, labelledAggs.get(agg.id) ?? 0);
  }
  for (const cl of alignment.columnLabels) {
    const agg = newTables.has(cl.table) ? aggForTable(cl.table) : undefined;
    const attr = agg?.attributes.find((a) => a.name === toCamelCase(cl.column));
    if (!agg || !attr) continue;
    attr.label = cl.label;
    labelledAggs.set(agg.id, (labelledAggs.get(agg.id) ?? 0) + 1);
  }
  for (const [aggId, attrCount] of labelledAggs) {
    (evidenceByKey[candidateKey('M1', 'aggregates', aggId)] ??= []).push({
      origin: 'INFERRED',
      note: `语义对齐给出别名、说明与 ${attrCount} 个属性标签`,
    });
  }

  let baselineErrors = errorCount(suite);
  for (const ref of alignment.inferredRefs) {
    const item = `${ref.table}.${ref.column} → ${ref.targetTable}`;
    const table = tableByName.get(ref.table);
    const sourceAgg = aggForTable(ref.table);
    const targetName = targetAggName(ref.targetTable);
    if (!table || !sourceAgg || !targetName || targetName === sourceAgg.name) {
      dropped.push({ item, reason: 'source or target aggregate could not be resolved' });
      continue;
    }
    const assocId = `ASSOC-INF-${tableTag(ref.table)}-${toCamelCase(ref.column).toUpperCase()}`;
    if (M1.aggregate_associations.some((a) => a.id === assocId)) continue;

    M1.aggregate_associations.push({
      id: assocId,
      sourceAggregate: sourceAgg.name,
      targetAggregate: targetName,
      associationType: 'REFERENCE',
      sourceRole: toCamelCase(sourceAgg.name),
      targetRole: toCamelCase(targetName),
      cardinality: 'MANY_TO_ONE',
      referenceField: toCamelCase(ref.column),
      description: `语义对齐推断：${ref.table}.${ref.column} 引用 ${ref.targetTable}（源材料未声明外键）。`,
    });
    const after = errorCount(suite);
    if (after > baselineErrors) {
      M1.aggregate_associations.pop();
      dropped.push({ item, reason: 'would introduce a Consistency Error' });
      continue;
    }
    baselineErrors = after;

    const columnLine = source
      .split(/\r?\n/)
      .findIndex(
        (text, i) =>
          i + 1 >= table.lines.startLine &&
          i + 1 <= table.lines.endLine &&
          new RegExp(`\\b${ref.column}\\b`).test(text),
      );
    const lines: SourceRange =
      columnLine >= 0 ? { startLine: columnLine + 1, endLine: columnLine + 1 } : table.lines;
    (evidenceByKey[candidateKey('M1', 'aggregate_associations', assocId)] ??= []).push({
      origin: 'INFERRED',
      note: `未声明的引用：${item}`,
      lines,
      excerpt: excerptOf(source, lines),
    });
  }

  return { scan: { ...scan, suite, evidenceByKey }, dropped };
}

/**
 * Find a quote the LLM attributed to the source. Returns null when the quote
 * is not actually there, so an invented citation never becomes evidence.
 */
export function locateQuote(
  source: string,
  quote: string | undefined,
): { lines: SourceRange; excerpt: string } | null {
  const needle = (quote ?? '').replace(/\s+/g, ' ').trim();
  if (needle.length < 4) return null;
  const sourceLines = source.split(/\r?\n/);
  // A quote may span a few wrapped lines; prefer the tightest window that holds it.
  for (let span = 1; span <= 4; span += 1) {
    for (let i = 0; i + span <= sourceLines.length; i += 1) {
      const window = sourceLines
        .slice(i, i + span)
        .join(' ')
        .replace(/\s+/g, ' ');
      if (window.includes(needle)) {
        const lines = { startLine: i + 1, endLine: i + span };
        return { lines, excerpt: excerptOf(source, lines) };
      }
    }
  }
  return null;
}
