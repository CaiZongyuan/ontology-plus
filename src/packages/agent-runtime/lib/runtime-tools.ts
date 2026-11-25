import {
  ConnectionError,
  parseConnectionManifest,
  type Bilingual,
  type ConnectionManifest,
  type FetchLike,
} from '../../application-runtime/index.js';
import { openConnection, prepareInvocation, type GatewayFailure } from '../../runtime-gateway/index.js';
import type { AgentSession, AgentToolCallTrace, WorkspaceStore } from '../../workspace-store/index.js';
import { type AgentLocale, pickLocaleText } from './locale.js';
import type { DomainToolExecutionResult } from './domain-run-tools.js';
import type { OpenAiFunctionTool } from './tools.js';

/**
 * The AI Assistant inside the Operations Console (TeaCo spec §19.4 M3, ADR 0020): it reads the
 * connected application through the runtime gateway and can only *propose* a change, which becomes
 * an approval card a person decides on. It never names the Acting Identity — every call uses the
 * identity the person chose in the console — and every answer carries its basis (application,
 * identity, time of the reading).
 */
export const OPERATIONS_CONSOLE_SESSION_TARGET = 'operations-console';

export const isOperationsConsoleSession = (session: Pick<AgentSession, 'agentKind' | 'targetId'>): boolean =>
  session.agentKind === 'REASONING' && session.targetId === OPERATIONS_CONSOLE_SESSION_TARGET;

export const RUNTIME_TOOL_NAMES = [
  'read_operations_overview',
  'list_business_records',
  'read_business_record',
  'read_business_report',
  'propose_business_change',
] as const;
export type RuntimeToolName = (typeof RUNTIME_TOOL_NAMES)[number];
export const isRuntimeToolName = (name: string): name is RuntimeToolName => (RUNTIME_TOOL_NAMES as readonly string[]).includes(name);

export const RUNTIME_OPENAI_TOOLS: OpenAiFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'read_operations_overview',
      description:
        'Read the connected application’s headline figures, the data problems that need a decision, and how many changes wait for approval — as the Acting Identity the person chose.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_business_records',
      description: 'List records of one business object the application declares (for example orders), optionally under one of its declared filters.',
      parameters: {
        type: 'object',
        properties: {
          objectId: { type: 'string', description: 'A business object id from the application declaration.' },
          filter: { type: 'string', description: 'One of that object’s declared filter ids.' },
          limit: { type: 'integer', description: 'At most 50; defaults to 10.' },
        },
        required: ['objectId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_business_record',
      description: 'Read one record in full: its values, flags, line tables, notes, and which changes this identity may start on it now.',
      parameters: {
        type: 'object',
        properties: { objectId: { type: 'string' }, key: { type: 'string' } },
        required: ['objectId', 'key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_business_report',
      description: 'Read one declared report with its counting rule.',
      parameters: { type: 'object', properties: { reportId: { type: 'string' } }, required: ['reportId'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_business_change',
      description:
        'Prepare one declared action (for example shipping an order) and put it in front of the person as an approval card. Nothing changes until the person approves it; never claim it ran. The application re-checks every rule and the identity.',
      parameters: {
        type: 'object',
        properties: {
          actionId: { type: 'string', description: 'A declared action id.' },
          target: { type: 'string', description: 'The record key the action applies to, when it applies to one.' },
          params: { type: 'object', description: 'The action’s declared parameters.' },
        },
        required: ['actionId'],
      },
    },
  },
];

export interface RuntimeToolOptions {
  /** Tests reach an in-process application here; production uses the global fetch. */
  readonly fetch?: FetchLike;
}

const tb = (locale: AgentLocale, b: Bilingual | null | undefined) => (b ? pickLocaleText(locale, b.zh, b.en) : '');

function formatValue(value: unknown, type: string, locale: AgentLocale, currency: string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object' && value && 'zh' in value && 'en' in value) return tb(locale, value as Bilingual);
  if (type === 'money' && typeof value === 'number') {
    // The same notation as the console in both languages ($24,338.27, not US$24,338.27).
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value / 100);
  }
  if (typeof value === 'number') return new Intl.NumberFormat(locale === 'en-US' ? 'en-US' : 'zh-CN').format(value);
  return String(value);
}

/** `2026-09-10 09:00 UTC`: the reading time, stated plainly with its zone. */
function readingTime(asOf: string): string {
  const d = new Date(asOf);
  return Number.isNaN(d.getTime()) ? asOf : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function basisLine(manifest: ConnectionManifest, actorId: string, asOf: string, locale: AgentLocale): string {
  const actor = manifest.actors.find((a) => a.id === actorId);
  asOf = readingTime(asOf);
  return pickLocaleText(
    locale,
    `依据：${manifest.application.name.zh}（${manifest.application.version}），以 ${actor?.name.zh ?? actorId}（${actor?.scope.zh ?? ''}）的身份读取，数据时间 ${asOf}`,
    `Basis: ${manifest.application.name.en} (${manifest.application.version}), read as ${actor?.name.en ?? actorId} (${actor?.scope.en ?? ''}) at ${asOf}`,
  );
}

function failureText(f: GatewayFailure, locale: AgentLocale): string {
  const own = typeof f.message === 'object' ? tb(locale, f.message) : null;
  switch (f.code) {
    case 'NOT_CONNECTED':
      return pickLocaleText(locale, '这个项目还没有接入应用，没有可读的经营数据。', 'This project has no connected application, so there is no operating data to read.');
    case 'DRIFTED':
      return pickLocaleText(
        locale,
        '应用或业务模型在接入后有变化，需要先在「应用与连接」里重新核对；核对前不读取也不改动任何数据。',
        'The application or the Business Model changed since it was connected; re-check it under Application and connection first. Nothing is read or changed until then.',
      );
    case 'UNREACHABLE':
    case 'BAD_RESPONSE':
      return pickLocaleText(locale, `现在连不上应用（${f.code}），没有拿到任何数字。`, `The application cannot be reached right now (${f.code}); no figures were read.`);
    default:
      return own ?? (typeof f.message === 'string' ? f.message : f.code);
  }
}

function result(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
  started: number,
  answer: string,
  data: Record<string, unknown>,
  isError = false,
  artifact?: DomainToolExecutionResult['artifact'],
): DomainToolExecutionResult {
  const trace: AgentToolCallTrace = { id: toolCallId, toolName, arguments: args, output: answer, isError, durationMs: Date.now() - started };
  return { trace, toolResultContent: JSON.stringify({ answer, ...data }), isError, ...(artifact ? { artifact } : {}) };
}

/** Executes one runtime tool for a console conversation. */
export async function executeRuntimeTool(
  store: WorkspaceStore,
  session: AgentSession,
  toolCallId: string,
  toolName: RuntimeToolName,
  args: Record<string, unknown>,
  locale: AgentLocale,
  options: RuntimeToolOptions = {},
): Promise<DomainToolExecutionResult> {
  const started = Date.now();
  const deps = { store, ...(options.fetch ? { fetch: options.fetch } : {}) };
  const record = store.getConnectedApp(session.projectId);
  // The identity is the person's choice in the console; the model's arguments cannot change it.
  const actingIdentity = record?.actingIdentity ?? undefined;
  const fail = (message: string, code: string) => result(toolCallId, toolName, args, started, message, { error: { code } }, true);

  if (toolName === 'propose_business_change') {
    const actionId = typeof args.actionId === 'string' ? args.actionId : '';
    const target = typeof args.target === 'string' && args.target.trim() ? args.target.trim() : undefined;
    const params = args.params && typeof args.params === 'object' ? (args.params as Record<string, unknown>) : {};
    const prepared = await prepareInvocation(deps, session.projectId, { actionId, actor: actingIdentity, target, params, requestedBy: 'assistant' });
    if (!prepared.ok) {
      return fail(
        pickLocaleText(locale, `没有准备成：${failureText(prepared, locale)}`, `Not prepared: ${failureText(prepared, locale)}`),
        prepared.code,
      );
    }
    const inv = prepared.value;
    const answer = pickLocaleText(
      locale,
      `已准备好「${inv.preview.summary.zh}」，等你批准后才会执行；批准前什么都不会改变。会发生：${inv.preview.effects.map((e) => e.zh).join('；')}。`,
      `Prepared "${inv.preview.summary.en}". It runs only after you approve it; nothing changes before then. It would: ${inv.preview.effects.map((e) => e.en).join('; ')}.`,
    );
    return result(toolCallId, toolName, args, started, answer, { invocationId: inv.id, status: inv.status, expiresAt: inv.expiresAt }, false, {
      kind: 'RUNTIME_APPROVAL',
      invocationId: inv.id,
      summary: inv.preview.summary,
    });
  }

  const opened = await openConnection(deps, session.projectId, actingIdentity);
  if (!opened.ok) return fail(failureText(opened, locale), opened.code);
  const { client, manifest, actor } = opened.value;
  const currency = manifest.application.currency;
  try {
    if (toolName === 'read_operations_overview') {
      const [metrics, issues] = await Promise.all([client.metrics(actor), manifest.dataIssues ? client.dataIssues(actor) : Promise.resolve(null)]);
      const values = new Map(metrics.values.map((v) => [v.id, v]));
      const figures = manifest.metrics.map((m) => {
        const v = values.get(m.id);
        const hint = tb(locale, v?.hint ?? m.hint ?? null);
        return `${tb(locale, m.name)} ${formatValue(v?.value, m.unit, locale, currency)}${hint ? pickLocaleText(locale, `（${hint}）`, ` (${hint})`) : ''}`;
      });
      const decisions = (issues?.issues ?? []).filter((i) => i.needsDecision && i.status !== 'VERIFIED' && i.status !== 'DISMISSED');
      const waiting = store.listActionInvocations(session.projectId).filter((i) => i.status === 'PENDING_APPROVAL' && i.expiresAt >= new Date().toISOString());
      const answer = [
        figures.join(pickLocaleText(locale, '；', '; ')),
        decisions.length
          ? pickLocaleText(locale, `有 ${decisions.length} 个数据问题需要你决定：${decisions.map((d) => d.title.zh).join('；')}`, `${decisions.length} data problem(s) need your decision: ${decisions.map((d) => d.title.en).join('; ')}`)
          : pickLocaleText(locale, '没有需要你决定的数据问题', 'No data problem needs your decision'),
        waiting.length ? pickLocaleText(locale, `有 ${waiting.length} 项改动等你批准`, `${waiting.length} change(s) wait for your approval`) : '',
        basisLine(manifest, actor, metrics.asOf, locale),
      ]
        .filter(Boolean)
        .join(pickLocaleText(locale, '。\n\n', '.\n\n'));
      return result(toolCallId, toolName, args, started, answer, { asOf: metrics.asOf, metrics: metrics.values, decisions: decisions.map((d) => ({ id: d.id, title: d.title })) });
    }

    if (toolName === 'list_business_records') {
      const object = manifest.objects.find((o) => o.id === args.objectId);
      if (!object) return fail(pickLocaleText(locale, `应用没有声明「${String(args.objectId)}」这类记录；可查：${manifest.objects.map((o) => `${o.id}（${o.name.zh}）`).join('、')}`, `The application declares no "${String(args.objectId)}" records; available: ${manifest.objects.map((o) => `${o.id} (${o.name.en})`).join(', ')}`), 'UNKNOWN_OBJECT');
      const filter = typeof args.filter === 'string' && object.filters.some((f) => f.id === args.filter) ? args.filter : object.filters[0]?.id;
      const limit = Math.min(50, Math.max(1, Number(args.limit) || 10));
      const list = await client.listObjects(object.id, actor, { ...(filter ? { filter } : {}), limit });
      const filterName = object.filters.find((f) => f.id === filter)?.label;
      const shown = list.rows.map((row) => {
        const parts = object.fields
          .slice(0, 6)
          .map((f) => formatValue(row.values[f.key], f.type, locale, currency))
          .filter((v) => v !== row.key);
        const flags = row.flags.map((fl) => tb(locale, fl.label)).join('/');
        return `${row.key}: ${parts.join(' · ')}${flags ? ` [${flags}]` : ''}`;
      });
      const answer = [
        pickLocaleText(
          locale,
          `${object.name.zh}${filterName ? `「${filterName.zh}」` : ''}共 ${list.total} 条${list.rows.length < list.total ? `，下面是前 ${list.rows.length} 条` : ''}：`,
          `${object.name.en}${filterName ? ` "${filterName.en}"` : ''}: ${list.total} in total${list.rows.length < list.total ? `, first ${list.rows.length} shown` : ''}:`,
        ),
        ...shown.map((line) => `- ${line}`),
        '',
        basisLine(manifest, actor, list.asOf, locale),
      ].join('\n');
      return result(toolCallId, toolName, args, started, answer, { asOf: list.asOf, total: list.total, counts: list.counts, columns: object.fields.map((f) => f.key), rows: list.rows });
    }

    if (toolName === 'read_business_record') {
      const object = manifest.objects.find((o) => o.id === args.objectId);
      if (!object) return fail(pickLocaleText(locale, `应用没有声明「${String(args.objectId)}」这类记录。`, `The application declares no "${String(args.objectId)}" records.`), 'UNKNOWN_OBJECT');
      const key = String(args.key ?? '');
      const detail = await client.getObject(object.id, key, actor);
      const fields = object.fields.map((f) => `${tb(locale, f.label)} ${formatValue(detail.values[f.key], f.type, locale, currency)}`);
      const actions = manifest.actions.filter((a) => detail.actions.includes(a.id)).map((a) => tb(locale, a.name));
      const answer = [
        pickLocaleText(locale, `${object.name.zh} ${key}：${fields.join('；')}`, `${object.name.en} ${key}: ${fields.join('; ')}`),
        detail.flags.length ? pickLocaleText(locale, `标记：${detail.flags.map((f) => f.label.zh).join('、')}`, `Flags: ${detail.flags.map((f) => f.label.en).join(', ')}`) : '',
        ...detail.notes.map((n) => tb(locale, n)),
        actions.length
          ? pickLocaleText(locale, `这个身份现在可以对它做：${actions.join('、')}（都需要你批准）`, `This identity may now: ${actions.join(', ')} (each needs your approval)`)
          : pickLocaleText(locale, '这个身份现在不能对它做任何改动', 'This identity cannot change it now'),
        basisLine(manifest, actor, detail.asOf, locale),
      ]
        .filter(Boolean)
        .join('\n\n');
      return result(toolCallId, toolName, args, started, answer, { asOf: detail.asOf, key, values: detail.values, flags: detail.flags, sections: detail.sections, actions: detail.actions });
    }

    // read_business_report
    const reportDef = manifest.reports.find((r) => r.id === args.reportId);
    if (!reportDef) {
      return fail(
        pickLocaleText(locale, `应用没有声明这个报表；现有：${manifest.reports.map((r) => `${r.id}（${r.name.zh}）`).join('、') || '无'}`, `The application declares no such report; available: ${manifest.reports.map((r) => `${r.id} (${r.name.en})`).join(', ') || 'none'}`),
        'UNKNOWN_REPORT',
      );
    }
    const report = await client.report(reportDef.id, actor);
    const cell = (v: string) => v.replace(/\|/g, '/');
    const header = `| ${report.columns.map((c) => cell(tb(locale, c.label))).join(' | ')} |`;
    const rule = `| ${report.columns.map(() => '---').join(' | ')} |`;
    const lines = report.rows.slice(0, 24).map((row) => `| ${report.columns.map((c) => cell(formatValue(row[c.key], c.type, locale, currency))).join(' | ')} |`);
    const answer = [
      `**${tb(locale, report.title)}**`,
      '',
      header,
      rule,
      ...lines,
      '',
      report.basis ? pickLocaleText(locale, `口径：${report.basis.zh}`, `Counting rule: ${report.basis.en}`) : '',
      '',
      basisLine(manifest, actor, report.asOf, locale),
    ].join('\n');
    return result(toolCallId, toolName, args, started, answer, { asOf: report.asOf, columns: report.columns, rows: report.rows, basis: report.basis ?? null });
  } catch (err) {
    if (err instanceof ConnectionError) {
      const own = err.appError?.message;
      const text =
        err.code === 'NOT_FOUND'
          ? pickLocaleText(locale, '没有这一条，或者它不在当前身份能看的范围内。', 'No such record, or it is outside the current identity’s scope.')
          : own
            ? tb(locale, own)
            : pickLocaleText(locale, `读取失败（${err.code}），没有拿到数字。`, `Reading failed (${err.code}); no figures were read.`);
      return fail(text, err.code);
    }
    throw err;
  }
}

/** The system prompt section for a console conversation. */
export function renderRuntimeContext(store: WorkspaceStore, session: AgentSession, locale: AgentLocale): string {
  const record = store.getConnectedApp(session.projectId);
  if (!record) {
    return pickLocaleText(locale, '这个项目还没有接入应用。', 'This project has no connected application.');
  }
  const parsed = parseConnectionManifest(record.manifest);
  if (!parsed.ok) return pickLocaleText(locale, '保存的接入清单无法读取。', 'The saved Connection Manifest cannot be read.');
  const m = parsed.manifest;
  const actor = m.actors.find((a) => a.id === record.actingIdentity) ?? m.actors[0]!;
  const zh = locale !== 'en-US';
  return [
    zh
      ? `你是经营驾驶舱里的 AI 助手，帮用户了解「${m.application.name.zh}」的实时经营情况，并在用户要求时准备改动。当前身份：${actor.name.zh}（${actor.role.zh}，${actor.scope.zh}）——这是用户在驾驶舱顶栏选的，你不能更换。`
      : `You are the AI Assistant in the Operations Console. Help the person understand how "${m.application.name.en}" is doing right now and prepare changes when asked. Acting identity: ${actor.name.en} (${actor.role.en}, ${actor.scope.en}) — chosen by the person in the console header; you cannot change it.`,
    zh ? '规则：' : 'Rules:',
    zh
      ? '- 每个数字都必须来自本轮工具返回的结果，回答末尾带上工具给出的「依据」那一行；没读到就说没读到，不要估算。'
      : '- Every figure must come from a tool result in this turn; end the answer with the tool’s "Basis" line. If nothing was read, say so; never estimate.',
    zh
      ? '- 想改任何东西，只能调用 propose_business_change：它只生成一张审批卡，用户批准后才执行。不要说已经执行了。'
      : '- To change anything, call propose_business_change: it only creates an approval card, and it runs after the person approves. Never say it already ran.',
    zh ? '- 用业务话回答，不要提接口、代码或内部编号。' : '- Answer in business language; do not mention interfaces, code or internal ids.',
    zh ? '可读的业务对象：' : 'Business objects:',
    ...m.objects.map((o) => `- ${o.id}: ${tb(locale, o.name)}${o.filters.length ? ` (${zh ? '筛选' : 'filters'}: ${o.filters.map((f) => `${f.id}=${tb(locale, f.label)}`).join(', ')})` : ''}`),
    m.reports.length ? (zh ? '报表：' : 'Reports:') : '',
    ...m.reports.map((r) => `- ${r.id}: ${tb(locale, r.name)}`),
    m.actions.length ? (zh ? '可准备的改动：' : 'Changes that can be prepared:') : '',
    ...m.actions.map((a) => `- ${a.id}: ${tb(locale, a.name)}${a.params.length ? ` (${a.params.map((p) => `${p.key}:${p.type}`).join(', ')})` : ''}${a.description ? ` — ${tb(locale, a.description)}` : ''}`),
  ]
    .filter(Boolean)
    .join('\n');
}

// ─── Simulated console turns (no model configured) ───────────────────────────

export type ConsoleTurnPlan =
  | { readonly kind: 'tool'; readonly toolName: RuntimeToolName; readonly args: Record<string, unknown> }
  | { readonly kind: 'text'; readonly text: string };

const lower = (s: string) => s.toLowerCase();
const names = (b: Bilingual) => [b.zh, b.en].filter(Boolean).map(lower);
const KEY_PATTERN = /(?<![\w-])([A-Za-z]{2,}(?:-[A-Za-z0-9]+)+|\d{3,})(?![\w-])/;

/**
 * Plans one simulated console turn from the declaration alone: a declared action named in the
 * question becomes a proposal, a declared report or filter is read, a record key is looked up, and
 * anything else reads the overview. Nothing here knows a particular application.
 */
export function planConsoleTurn(manifest: ConnectionManifest | null, prompt: string, locale: AgentLocale): ConsoleTurnPlan {
  if (!manifest) {
    return { kind: 'text', text: pickLocaleText(locale, '这个项目还没有接入应用，先在首页的项目菜单里接入开发好的应用。', 'This project has no connected application yet; connect one from the project menu on Home.') };
  }
  const text = lower(prompt);
  const key = KEY_PATTERN.exec(prompt)?.[1];
  const longest = <T,>(items: { item: T; name: string }[]) => items.filter((x) => text.includes(x.name)).sort((a, b) => b.name.length - a.name.length)[0]?.item;

  const filtered = longest(manifest.objects.flatMap((o) => o.filters.filter((f) => f.id !== 'all').flatMap((f) => names(f.label).map((name) => ({ item: { o, f }, name })))));
  const object = longest(manifest.objects.flatMap((o) => names(o.name).map((name) => ({ item: o, name }))));
  const report = longest(manifest.reports.flatMap((r) => [...names(r.name), lower(r.id)].map((name) => ({ item: r, name }))))
    ?? (/(报表|月报|按月|每月|report|monthly)/i.test(prompt) ? manifest.reports[0] : undefined);
  // A filter label can contain an action's name (没发货 ⊃ 发货); inside it, the words describe records.
  const labelSpans = manifest.objects.flatMap((o) => o.filters.flatMap((f) => names(f.label)))
    .flatMap((label) => [...text.matchAll(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].map((m) => [m.index!, m.index! + label.length] as const));
  const standalone = (name: string) =>
    [...text.matchAll(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].some(
      (m) => !labelSpans.some(([a, b]) => b - a > name.length && m.index! >= a && m.index! + name.length <= b),
    );
  const action = longest(manifest.actions.flatMap((a) => names(a.name).filter(standalone).map((name) => ({ item: a, name }))));
  if (action && (key || action.target === 'none')) {
    const params: Record<string, unknown> = {};
    for (const p of action.params) {
      if (p.type !== 'number') continue;
      const m = /(?:改为|改成|设为|设成|调到|调整为|to|=)\s*(-?\d+)/i.exec(prompt);
      if (m) params[p.key] = Number(m[1]);
    }
    const missing = action.params.filter((p) => p.required && params[p.key] === undefined);
    if (missing.length) {
      return {
        kind: 'text',
        text: pickLocaleText(locale, `准备「${action.name.zh}」还需要：${missing.map((p) => p.label.zh).join('、')}。`, `To prepare "${action.name.en}" I still need: ${missing.map((p) => p.label.en).join(', ')}.`),
      };
    }
    return { kind: 'tool', toolName: 'propose_business_change', args: { actionId: action.id, ...(key ? { target: key } : {}), params } };
  }
  if (action && !filtered && !object && !report) {
    return { kind: 'text', text: pickLocaleText(locale, `要对哪一条「${action.name.zh}」？请告诉我编号。`, `Which record should I "${action.name.en}"? Tell me its number.`) };
  }

  if (report) return { kind: 'tool', toolName: 'read_business_report', args: { reportId: report.id } };

  if (key) return { kind: 'tool', toolName: 'read_business_record', args: { objectId: (object ?? manifest.objects[0])!.id, key } };
  if (filtered) return { kind: 'tool', toolName: 'list_business_records', args: { objectId: filtered.o.id, filter: filtered.f.id, limit: 10 } };
  if (object) return { kind: 'tool', toolName: 'list_business_records', args: { objectId: object.id, limit: 10 } };
  return { kind: 'tool', toolName: 'read_operations_overview', args: {} };
}

/** The final simulated reply: the tool's own business-language answer. */
export function consoleAnswerFromToolResult(resultText: string, isError: boolean, locale: AgentLocale): string {
  let answer = resultText;
  try {
    const parsed = JSON.parse(resultText) as { answer?: unknown };
    if (typeof parsed.answer === 'string') answer = parsed.answer;
  } catch {
    // Plain text results are shown as they are.
  }
  return isError ? pickLocaleText(locale, `没能完成：${answer}`, `Could not complete it: ${answer}`) : answer;
}

export function connectedManifest(store: WorkspaceStore, projectId: string): ConnectionManifest | null {
  const record = store.getConnectedApp(projectId);
  if (!record) return null;
  const parsed = parseConnectionManifest(record.manifest);
  return parsed.ok ? parsed.manifest : null;
}
