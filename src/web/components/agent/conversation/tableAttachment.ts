import { parseCsv, profileColumns } from '../../../../packages/data-management/index.js';

/**
 * A table attached to the conversation (TeaCo spec U-01): the AI reads its header, column types and
 * first rows, not the whole file. The summary travels with the message as a quoted block that starts
 * with a marker, so the chip can show it as a table rather than as quoted text.
 */
export const TABLE_MARKER = { zh: '[附带表格', en: '[Attached table' } as const;
const SAMPLE_ROWS = 5;
const MAX_COLUMNS = 10;
const MAX_BYTES = 1024 * 1024;

export interface TableSummary {
  readonly name: string;
  readonly rows: number;
  readonly text: string;
}

const typeName = (type: string, zh: boolean) =>
  zh ? ({ money: '金额', number: '数字', date: '日期', text: '文字' } as Record<string, string>)[type] ?? type : type;

/** Summarises a comma-separated table; null when it has no header and rows. */
export function summarizeTable(fileName: string, content: string, locale: 'zh-CN' | 'en-US'): TableSummary | null {
  if (content.length > MAX_BYTES) return null;
  const table = parseCsv(content);
  if (table.header.length < 2 || table.rows.length === 0) return null;
  const zh = locale !== 'en-US';
  const name = fileName.replace(/\.[a-z0-9]+$/i, '');
  const profiles = profileColumns(table).slice(0, MAX_COLUMNS);
  const header = profiles.map((p) => p.name);
  const cell = (v: string) => v.replace(/\|/g, '/').replace(/\s+/g, ' ').trim().slice(0, 24);
  const lines = [
    zh ? `${TABLE_MARKER.zh}：${name}（${table.rows.length} 行）]` : `${TABLE_MARKER.en}: ${name} (${table.rows.length} rows)]`,
    (zh ? '列：' : 'Columns: ') + profiles.map((p) => `${p.name}（${typeName(p.type, zh)}${p.problems.length ? (zh ? `，${p.problems.length} 处格式不一` : `, ${p.problems.length} odd cells`) : ''}）`).join(zh ? '、' : ', '),
    zh ? `前 ${Math.min(SAMPLE_ROWS, table.rows.length)} 行：` : `First ${Math.min(SAMPLE_ROWS, table.rows.length)} rows:`,
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...table.rows.slice(0, SAMPLE_ROWS).map((r) => `| ${header.map((_, i) => cell(r[i] ?? '')).join(' | ')} |`),
  ];
  return { name, rows: table.rows.length, text: lines.join('\n') };
}

/** The chip label for an attached table, or null for an ordinary quote. */
export function tableChipLabel(quote: string): string | null {
  const m = /^\[(?:附带表格：(.+?)（(\d+) 行）|Attached table: (.+?) \((\d+) rows\))\]/.exec(quote);
  if (!m) return null;
  return m[1] ? `${m[1]} · ${m[2]} 行` : `${m[3]} · ${m[4]} rows`;
}
