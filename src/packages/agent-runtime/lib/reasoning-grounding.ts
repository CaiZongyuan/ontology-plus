import {
  buildDataGrounding,
  findJoinPath,
  type DataGrounding,
  type GroundingJoin,
  type SqlGroundingReport,
} from '../../ontology-core/index.js';
import type { ProjectDetail, WorkspaceStore } from '../../workspace-store/index.js';
import { type AgentLocale, pickLocaleText } from './locale.js';

// Data Ontology Reasoning reads its grounding from the Ontology Suite. This
// module adds what the suite does not know (tables registered as data
// resources, the dictionary table) and words the grounding for a prompt.

const PROMPT_MAX_TABLES = 40;
const PROMPT_MAX_COLUMNS = 40;
const PROMPT_MAX_SQL_CHARS = 700;
const PROMPT_MAX_MULTI_HOP_PATHS = 12;

/** The dictionary table is always queryable; reasoning joins labels through it. */
const DICTIONARY_TABLE = {
  table: '__dict',
  columns: ['type_code', 'type_name', 'item_code', 'item_label', 'sort_order', 'flag'].map(
    (column) => ({ column }),
  ),
};

export function buildProjectDataGrounding(
  store: WorkspaceStore,
  project: ProjectDetail | undefined,
  question?: string,
): DataGrounding {
  const registered = store.listDatabaseResources().flatMap((db) =>
    db.tables.map((tbl) => ({
      table: tbl.tableName,
      columns: tbl.columns.map((c) => ({
        column: c.name,
        columnType: c.type,
        ...(c.comment ? { label: c.comment } : {}),
      })),
    })),
  );
  return buildDataGrounding(project?.suite ?? {}, {
    ...(question ? { question } : {}),
    unmappedTables: [...registered, DICTIONARY_TABLE],
  });
}

export const formatJoin = (join: GroundingJoin): string =>
  `${join.leftTable}.${join.leftColumn} = ${join.rightTable}.${join.rightColumn}`;

/** The grounding as a system-prompt section. Bounded; says so when it had to cut. */
export function renderDataGrounding(grounding: DataGrounding, locale: AgentLocale): string {
  const zh = locale !== 'en-US';
  const mapped = grounding.tables.filter((t) => t.mapped);
  const unmapped = grounding.tables.filter((t) => !t.mapped);
  const lines: string[] = [];

  lines.push(
    zh
      ? '【取数依据】由当前工程的本体套件（MM 映射、M1 关联、M7 查询）确定性推出。只能查询下面列出的表与列；连接只能使用下面列出的等值条件，不得自行编造连接条件。'
      : '[Data grounding] Derived deterministically from the active Ontology Suite (MM mappings, M1 associations, M7 queries). Query only the tables and columns listed here; join only on the equality conditions listed here and never invent a join condition.',
  );

  if (mapped.length > 0) {
    lines.push(
      zh
        ? '已映射的表（表 ← 业务对象：列(业务属性)，* 为主键）：'
        : 'Mapped tables (table <- business object: column(business attribute), * marks the primary key):',
    );
    for (const table of mapped.slice(0, PROMPT_MAX_TABLES)) {
      const columns = table.columns.slice(0, PROMPT_MAX_COLUMNS).map((c) => {
        const label = c.label && c.label !== c.column ? `(${c.label})` : '';
        return `${c.isPrimaryKey ? '*' : ''}${c.column}${label}`;
      });
      const cut = table.columns.length - columns.length;
      const object = table.objectName
        ? ` <- ${table.objectName}${table.objectAlias ? `(${table.objectAlias})` : ''}`
        : '';
      lines.push(
        `- ${table.table}${object}: ${columns.join(', ')}${
          cut > 0 ? (zh ? `，……另有 ${cut} 列未列出` : `, ... ${cut} more columns not shown`) : ''
        }`,
      );
    }
    if (mapped.length > PROMPT_MAX_TABLES) {
      lines.push(
        zh
          ? `（另有 ${mapped.length - PROMPT_MAX_TABLES} 张已映射的表因篇幅未列出，可用 inspect_ontology_model 查看 MM。）`
          : `(${mapped.length - PROMPT_MAX_TABLES} more mapped tables are not shown; inspect MM with inspect_ontology_model.)`,
      );
    }
  }

  if (grounding.joins.length > 0) {
    lines.push(zh ? '可用连接（等值条件，可双向使用，可串联成多表路径）：' : 'Known joins (equality, usable in either direction, chainable into multi-table paths):');
    for (const join of grounding.joins) lines.push(`- ${formatJoin(join)}`);
    if (mapped.length >= 2) {
      const multiHopLines: string[] = [];
      const boundedTables = mapped.slice(0, PROMPT_MAX_TABLES);
      outer: for (let i = 0; i < boundedTables.length; i += 1) {
        for (let j = i + 1; j < boundedTables.length; j += 1) {
          const left = boundedTables[i]!;
          const right = boundedTables[j]!;
          const path = findJoinPath(grounding, left.table, right.table);
          if (path && path.length >= 2) {
            multiHopLines.push(`- ${left.table} <-> ${right.table}: ${path.map(formatJoin).join(' -> ')}`);
            if (multiHopLines.length >= PROMPT_MAX_MULTI_HOP_PATHS) break outer;
          }
        }
      }
      if (multiHopLines.length > 0) {
        lines.push(
          zh
            ? '多跳关联路径（非直接相邻表须经中间表串联）：'
            : 'Multi-hop join paths (non-adjacent tables connect via intermediate tables):',
        );
        lines.push(...multiHopLines);
      }
    }
    lines.push(
      zh
        ? '两张表之间没有列出的连接可达时，表示没有已知连接：请说明无法关联，不要猜测条件。'
        : 'When no listed join connects two tables there is no known join: say they cannot be related instead of guessing a condition.',
    );
  } else if (mapped.length > 1) {
    lines.push(
      zh
        ? '本体中没有已知的表间连接：请只做单表查询，或说明无法关联。'
        : 'The ontology records no join between these tables: query a single table, or say they cannot be related.',
    );
  }

  if (grounding.referenceQueries.length > 0) {
    lines.push(
      zh
        ? 'M7 参考查询（已通过一致性校验；口径相符时优先复用或在其基础上改写）：'
        : 'M7 reference queries (validated; reuse or adapt one when its definition fits the question):',
    );
    for (const query of grounding.referenceQueries) {
      const sql = query.sql.replace(/\s+/g, ' ');
      lines.push(
        `- ${query.id} ${query.alias}: ${sql.length > PROMPT_MAX_SQL_CHARS ? `${sql.slice(0, PROMPT_MAX_SQL_CHARS)}…` : sql}`,
      );
    }
  }

  if (unmapped.length > 0) {
    lines.push(
      zh
        ? '不在本体映射内但可查询的表（没有已知连接）：'
        : 'Queryable tables outside the ontology mapping (no known joins):',
    );
    lines.push(
      unmapped
        .slice(0, PROMPT_MAX_TABLES)
        .map(
          (t) =>
            `${t.table}(${t.columns
              .slice(0, PROMPT_MAX_COLUMNS)
              .map((c) => c.column)
              .join(', ')})`,
        )
        .join('; '),
    );
  }

  for (const note of describeMissingModels(grounding, locale)) lines.push(note);
  return lines.join('\n');
}

/** One plain sentence per model whose absence limits grounding. */
export function describeMissingModels(grounding: DataGrounding, locale: AgentLocale): string[] {
  const notes: string[] = [];
  if (grounding.missing.includes('MM')) {
    notes.push(
      pickLocaleText(
        locale,
        '当前工程缺少 MM（对象-数据表映射模型）：无法从本体确定业务对象对应的表、列与连接。补充 MM 后才能做有据的取数。',
        'This project has no MM (object-table mapping model): the ontology cannot say which tables, columns, and joins hold its business objects. Grounded querying needs MM.',
      ),
    );
  }
  if (grounding.missing.includes('M7')) {
    notes.push(
      pickLocaleText(
        locale,
        '当前工程缺少 M7（查询统计与报表模型）：没有可复用的参考查询，SQL 只能依据已列出的表与连接编写。',
        'This project has no M7 (query & report model): there is no reference query to reuse, so SQL must be written from the listed tables and joins alone.',
      ),
    );
  }
  return notes;
}

/** Why a query was refused, worded so the agent can correct itself in the same turn. */
export function describeGroundingRefusal(
  grounding: DataGrounding,
  report: SqlGroundingReport,
  locale: AgentLocale,
): string {
  const available = grounding.tables.map((t) => t.table).join(', ');
  return pickLocaleText(
    locale,
    `查询未执行：引用了取数依据之外的表 ${report.unknownTables.join(', ')}。可查询的表：${available || '（无）'}。请改用这些表重写 SQL。`,
    `Query not run: it references tables outside the data grounding: ${report.unknownTables.join(', ')}. Queryable tables: ${available || '(none)'}. Rewrite the SQL using these tables.`,
  );
}

/** One warning per join condition the ontology does not back. */
export function describeJoinWarnings(
  report: SqlGroundingReport,
  locale: AgentLocale,
  grounding?: DataGrounding,
): string[] {
  return report.unknownJoins.map((unknown) => {
    const match = /^([^.\s=]+)\.[^.\s=]+\s*=\s*([^.\s=]+)\.[^.\s=]+$/.exec(unknown.condition.trim());
    const leftTable = match?.[1];
    const rightTable = match?.[2];
    const path =
      unknown.knownJoins.length > 0
        ? unknown.knownJoins
        : grounding && leftTable && rightTable
          ? (findJoinPath(grounding, leftTable, rightTable) ?? [])
          : [];

    if (path.length >= 2) {
      const endpoints = new Set(
        [leftTable, rightTable].filter((t): t is string => Boolean(t)).map((t) => t.toLowerCase()),
      );
      const intermediates: string[] = [];
      for (const hop of path) {
        for (const tbl of [hop.leftTable, hop.rightTable]) {
          if (
            !endpoints.has(tbl.toLowerCase()) &&
            !intermediates.some((existing) => existing.toLowerCase() === tbl.toLowerCase())
          ) {
            intermediates.push(tbl);
          }
        }
      }
      const chain = path.map(formatJoin).join(' -> ');
      return pickLocaleText(
        locale,
        intermediates.length > 0
          ? `连接条件 ${unknown.condition} 不在本体的已知连接中，结果可能有误：这两张表之间没有直接连接，需经中间表 ${intermediates.join('、')} 多跳关联：${chain}。`
          : `连接条件 ${unknown.condition} 不在本体的已知连接中，结果可能有误：这两张表之间没有直接连接，需按多跳路径关联：${chain}。`,
        intermediates.length > 0
          ? `Join condition ${unknown.condition} is not a join the ontology knows; the result may be wrong: there is no direct join between these tables — join via intermediate table(s) ${intermediates.join(', ')}: ${chain}.`
          : `Join condition ${unknown.condition} is not a join the ontology knows; the result may be wrong: there is no direct join between these tables — join via multi-hop path: ${chain}.`,
      );
    }

    const known = path.map(formatJoin).join(' AND ');
    return known
      ? pickLocaleText(
          locale,
          `连接条件 ${unknown.condition} 不在本体的已知连接中，结果可能有误。这两张表的已知连接是：${known}。`,
          `Join condition ${unknown.condition} is not a join the ontology knows; the result may be wrong. The known join between these tables is: ${known}.`,
        )
      : pickLocaleText(
          locale,
          `连接条件 ${unknown.condition} 不在本体的已知连接中，且这两张表之间没有已知连接，结果可能有误。`,
          `Join condition ${unknown.condition} is not a join the ontology knows, and no known join connects these tables; the result may be wrong.`,
        );
  });
}
