import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve, type ServerType } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { openTeacoRepository } from '../../examples/teaco/app/db.js';
import { createTeacoRuntimeApp } from '../../examples/teaco/app/runtime.js';
import type { Env } from './env.js';

/**
 * The first TeaCo smoke suite (spec §14.1, 24 cases). The operator is scripted and acts only
 * through Ontology Plus's public API; the verifier reads TeaCo's own database (or the platform's
 * records when the case is about the platform) and never takes the operator's word for a result.
 * Cases that need a language model, or a capability deliberately left out, are NOT_RUN with the
 * reason — never removed and never counted as passed.
 */
export interface Bilingual {
  readonly zh: string;
  readonly en: string;
}

export interface CheckResult {
  readonly id: string;
  readonly passed: boolean;
  readonly evidence: string;
}

export type CampaignType = 'reference-app-validation' | 'operate-campaign';

export interface SmokeCase {
  readonly id: string;
  readonly track: string;
  readonly title: Bilingual;
  readonly campaignType: CampaignType;
  readonly run?: (env: Env) => Promise<CheckResult[]>;
  readonly notRun?: Bilingual;
}

const bi = (zh: string, en: string): Bilingual => ({ zh, en });
const check = (id: string, passed: boolean, evidence: string): CheckResult => ({ id, passed, evidence });
const one = <T,>(rows: T[]): T => rows[0]!;
const n = (env: Env, query: string, ...params: (string | number)[]) => Number(Object.values(one(env.sql(query, ...params)) as object)[0]);
const OPEN = "('NEW','PAID','PACKED','ON_HOLD')";
const SHIPPED = "('SHIPPED','DELIVERED')";

/** Prepare and approve one change through Ontology Plus, as a person would in the console. */
async function approved(env: Env, actionId: string, actor: string, target: string | undefined, params: Record<string, unknown> = {}) {
  const prepared = await env.call('POST', `${env.base}/console/actions/${actionId}/prepare`, { actor, target, params });
  if (prepared.status !== 201) return { prepared, approved: null };
  const approvedRes = await env.call('POST', `${env.base}/console/invocations/${prepared.body.invocation.id}/approve`);
  return { prepared, approved: approvedRes.body.invocation as { status: string; receipt?: any; idempotencyKey: string; failure?: { code: string } } };
}

const metric = async (env: Env, actor: string, id: string) =>
  (await env.call('GET', `${env.base}/console/overview?actor=${actor}`)).body.data.metrics.values.find((v: { id: string }) => v.id === id)?.value as number;

const amanda = (env: Env) => one(env.sql<{ id: string }>("SELECT id FROM customers WHERE name = 'Amanda Bennett'")).id;

const source = (name: string) => readFileSync(fileURLToPath(new URL(`../../examples/teaco/sources/${name}`, import.meta.url)), 'utf8');
const change = (v: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../examples/teaco/changes/${v}.json`, import.meta.url)), 'utf8'));

const needsModel = bi(
  '需要用语言模型从原始表格和需求里发现业务模型；配置自己的 AI 服务（BYOK）后才能运行，确定性门禁里不跑。',
  'Needs a language model to discover the business model from raw tables and requirements; runs only with your own AI service (BYOK), not in the deterministic gate.',
);

export const SMOKE_CASES: readonly SmokeCase[] = [
  { id: 'T1-002', track: 'discovery', campaignType: 'operate-campaign', title: bi('找出客户→订单→明细→商品的关联', 'Find Customer→Order→OrderItem→Product relations'), notRun: needsModel },
  { id: 'T1-004', track: 'discovery', campaignType: 'operate-campaign', title: bi('提取订单状态与取消/发货规则', 'Extract order states and cancel/ship rules'), notRun: needsModel },
  { id: 'T1-005', track: 'discovery', campaignType: 'operate-campaign', title: bi('提取零售/批发价格、运费与税', 'Extract retail/wholesale pricing, shipping and tax'), notRun: needsModel },

  {
    id: 'T2-002', track: 'build', campaignType: 'reference-app-validation',
    title: bi('参考应用真正启动，重启后数据还在', 'The reference app really starts and keeps its data across a restart'),
    async run(env) {
      await approved(env, 'ship_order', 'owner', '1106');
      env.repository.close();
      const reopened = openTeacoRepository(env.dbPath);
      const server = await new Promise<ServerType>((resolve) => {
        const s = serve({ fetch: (req) => createTeacoRuntimeApp({ repository: reopened, revision: 'v1' }).fetch(req), port: 0, hostname: '127.0.0.1' }, () => resolve(s));
      });
      try {
        const port = (server.address() as AddressInfo).port;
        const manifest = (await (await fetch(`http://127.0.0.1:${port}/.well-known/ontology-plus.json`)).json()) as { protocol: string };
        const order = (await (await fetch(`http://127.0.0.1:${port}/runtime/objects/orders/1106`, { headers: { 'X-Ontology-Plus-Actor': 'owner' } })).json()) as { values: { status: { en: string } } };
        return [
          check('listens-on-loopback', manifest.protocol === 'ontology-plus-connect/1', `http://127.0.0.1:${port} answered ${manifest.protocol}`),
          check('state-survives-restart', order.values.status.en === 'Shipped', `order 1106 after reopen: ${order.values.status.en}`),
        ];
      } finally {
        await new Promise((done) => server.close(done));
        reopened.close();
      }
    },
  },
  {
    id: 'T2-003', track: 'build', campaignType: 'reference-app-validation',
    title: bi('用户、邀请、角色与登录', 'Users, invitations, roles and sign-in'),
    notRun: bi('参考应用按 v0.3.1 决定不做登录与邀请（本地接入不做权限认证），身份由经营驾驶舱选择。', 'By the v0.3.1 decision the reference app has no sign-in or invitations (no authentication on local connections); the identity is chosen in the console.'),
  },
  {
    id: 'T2-004', track: 'build', campaignType: 'reference-app-validation',
    title: bi('导入与规范化：142 客户、60 商品、110 订单', 'Import and normalisation: 142 customers, 60 teas, 110 orders'),
    async run(env) {
      return [
        check('customers', n(env, 'SELECT COUNT(*) FROM customers') === 142, `${n(env, 'SELECT COUNT(*) FROM customers')} customers`),
        check('products', n(env, 'SELECT COUNT(*) FROM products') === 60, `${n(env, 'SELECT COUNT(*) FROM products')} products`),
        check('orders', n(env, 'SELECT COUNT(*) FROM orders') === 110, `${n(env, 'SELECT COUNT(*) FROM orders')} orders`),
        check('same-name-different-email', n(env, "SELECT COUNT(*) FROM customers WHERE name = 'Maria Lopez'") === 2 && n(env, "SELECT COUNT(*) FROM customers WHERE name = 'Charles Murphy'") === 1, 'Maria Lopez ×2, Charles Murphy ×1 (BB #15)'),
      ];
    },
  },
  {
    id: 'T2-006', track: 'build', campaignType: 'reference-app-validation',
    title: bi('审计与真实交易：下单、发货留下完整记录', 'Audit and real transactions: creating and shipping leave a full record'),
    async run(env) {
      const created = await approved(env, 'create_order', 'owner', undefined, { customer: amanda(env), lines: [{ sku: 'BLK-ASSAM-4OZ', qty: 2 }] });
      const no = created.approved?.receipt?.after?.key as string;
      await approved(env, 'ship_order', 'owner', no);
      return [
        check('order-shipped', one(env.sql<{ status: string }>('SELECT status FROM orders WHERE order_number = ?', no)).status === 'SHIPPED', `order ${no} shipped`),
        check('audit', n(env, "SELECT COUNT(*) FROM audit_log WHERE entity_id = ? AND entity_type = 'order'", no) === 2, 'create + status audit rows'),
        check('outbox', n(env, 'SELECT COUNT(*) FROM outbox_events WHERE aggregate_id = ?', no) === 2, 'OrderCreated + OrderShipped in the outbox'),
        check('ledger', n(env, "SELECT -SUM(delta_qty) FROM inventory_movements WHERE order_number = ? AND reason = 'SHIP'", no) === 2, 'stock movement of 2'),
      ];
    },
  },
  {
    id: 'T2-010', track: 'build', campaignType: 'reference-app-validation',
    title: bi('接入并核对契约；应用一变就停', 'Connect and check the contract; stop as soon as the app changes'),
    async run(env) {
      const record = env.store.getConnectedApp(env.projectId)!;
      const read = await env.call('GET', `${env.base}/console/overview`);
      env.setRevision('v2');
      const drifted = await env.call('GET', `${env.base}/console/overview`);
      return [
        check('connected', record.status === 'CONNECTED' && record.manifestFingerprint.startsWith('sha256:'), `fingerprint ${record.manifestFingerprint.slice(0, 19)}…`),
        check('reads', read.status === 200, `overview ${read.status}`),
        check('drift-stops-reads', drifted.status === 409 && drifted.body.error.code === 'DRIFTED', `after redeploy: ${drifted.status} ${drifted.body?.error?.code}`),
      ];
    },
  },

  {
    id: 'T3-005', track: 'integration', campaignType: 'reference-app-validation',
    title: bi('邮箱大小写与空白不影响认人', 'Email case and whitespace do not split a customer'),
    async run(env) {
      const raw = readFileSync(fileURLToPath(new URL('../datasets/bb-seed0/customers.csv', import.meta.url)), 'utf8').split(/\r?\n/).filter((l) => l.trim()).length - 1;
      const unique = n(env, 'SELECT COUNT(DISTINCT email_norm) FROM customers');
      return [
        check('raw-rows', raw === 150, `${raw} raw rows`),
        check('one-customer-per-email', unique === 142 && n(env, 'SELECT COUNT(*) FROM customers') === 142, `${unique} distinct normalised emails`),
        check('normalised', n(env, 'SELECT COUNT(*) FROM customers WHERE email_norm <> lower(trim(email_norm))') === 0, 'every stored email is trimmed lowercase'),
      ];
    },
  },
  {
    id: 'T3-008', track: 'integration', campaignType: 'reference-app-validation',
    title: bi('金额统一成整数分', 'Money normalised to integer cents'),
    async run(env) {
      const top = one(env.sql<{ sku: string; retail_cents: number }>('SELECT sku, retail_cents FROM products ORDER BY retail_cents DESC LIMIT 1'));
      return [
        check('highest-price', top.sku === 'MAT-CERMON-1LB' && top.retail_cents === 14800, `${top.sku} ${top.retail_cents} cents (BB #17)`),
        check('integers', n(env, 'SELECT COUNT(*) FROM products WHERE typeof(retail_cents) <> \'integer\' OR typeof(wholesale_cents) <> \'integer\'') === 0, 'all prices stored as integers'),
      ];
    },
  },
  {
    id: 'T3-013', track: 'integration', campaignType: 'reference-app-validation',
    title: bi('明细按订单汇总，不重复计数', 'Lines aggregate to their order without double counting'),
    async run(env) {
      return [
        check('order-1006-lines', n(env, "SELECT COUNT(*) FROM order_items WHERE order_number = '1006'") === 3, '#1006 has three lines (BB #19)'),
        check('one-header-per-order', n(env, 'SELECT COUNT(*) FROM (SELECT order_number FROM orders GROUP BY order_number HAVING COUNT(*) > 1)') === 0, 'no duplicate order headers'),
        check('shipped-sales-by-header', n(env, `SELECT SUM(total_cents) FROM orders WHERE status IN ${SHIPPED}`) === 2433827, 'shipped sales summed per order = $24,338.27'),
      ];
    },
  },

  {
    id: 'T4-001', track: 'analytics', campaignType: 'operate-campaign',
    title: bi('现在有多少订单没发货', 'How many orders are not shipped'),
    async run(env) {
      const answer = await metric(env, 'owner', 'open_orders');
      const oracle = n(env, `SELECT COUNT(*) FROM orders WHERE status IN ${OPEN}`);
      return [check('matches-independent-count', answer === oracle && oracle === 34, `answered ${answer}, database ${oracle}`)];
    },
  },
  {
    id: 'T4-002', track: 'analytics', campaignType: 'operate-campaign',
    title: bi('已发货销售额', 'Shipped sales'),
    async run(env) {
      const answer = await metric(env, 'owner', 'shipped_sales');
      const oracle = n(env, `SELECT SUM(total_cents) FROM orders WHERE status IN ${SHIPPED}`);
      return [check('matches-independent-sum', answer === oracle && oracle === 2433827, `answered ${answer}, database ${oracle}`)];
    },
  },
  {
    id: 'T4-007', track: 'analytics', campaignType: 'operate-campaign',
    title: bi('Jonah 只看到自己范围的数字', 'Jonah sees only his own scope'),
    async run(env) {
      const answer = await metric(env, 'jonah', 'open_orders');
      const oracle = n(env, `SELECT COUNT(*) FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.status IN ${OPEN} AND c.manager_id = 'jonah' AND c.type = 'WHOLESALE'`);
      return [
        check('scoped-count', answer === oracle && oracle === 3, `answered ${answer}, scoped database ${oracle}`),
        check('no-global-leak', answer !== n(env, `SELECT COUNT(*) FROM orders WHERE status IN ${OPEN}`), 'differs from the whole-shop count'),
      ];
    },
  },

  {
    id: 'T5-003', track: 'governance', campaignType: 'operate-campaign',
    title: bi('发现负库存并保留原值', 'Find the negative stock and keep the original value'),
    async run(env) {
      const issues = (await env.call('GET', `${env.base}/console/overview`)).body.data.dataIssues.issues as { id: string; needsDecision: boolean }[];
      const p = one(env.sql<{ stock_qty: number; raw_stock: number; stock_blocked: number }>("SELECT stock_qty, raw_stock, stock_blocked FROM products WHERE sku = 'HRB-PEPMNT-2OZ'"));
      return [
        check('issue-reported', issues.some((i) => i.id === 'negative-stock-HRB-PEPMNT-2OZ' && i.needsDecision), 'data check lists it as needing a decision'),
        check('raw-kept', p.raw_stock === -2, `original value ${p.raw_stock} kept`),
        check('no-silent-fix', p.stock_qty === 0 && p.stock_blocked === 1, 'held at 0 and locked until confirmed'),
      ];
    },
  },
  {
    id: 'T5-009', track: 'governance', campaignType: 'operate-campaign',
    title: bi('批准后修复一项已核实的异常并复查', 'Repair a confirmed problem after approval and re-check'),
    async run(env) {
      const r = await approved(env, 'repair_stock', 'owner', 'HRB-PEPMNT-2OZ', { quantity: 20 });
      const issues = (await env.call('GET', `${env.base}/console/overview`)).body.data.dataIssues.issues as { id: string; status: string }[];
      const p = one(env.sql<{ stock_qty: number; stock_blocked: number }>("SELECT stock_qty, stock_blocked FROM products WHERE sku = 'HRB-PEPMNT-2OZ'"));
      return [
        check('approved-and-read-back', r.approved?.status === 'VERIFIED', `invocation ${r.approved?.status}`),
        check('state', p.stock_qty === 20 && p.stock_blocked === 0, `stock ${p.stock_qty}, locked ${p.stock_blocked}`),
        check('movement', n(env, "SELECT COUNT(*) FROM inventory_movements WHERE sku = 'HRB-PEPMNT-2OZ' AND reason = 'IMPORT_REPAIR'") === 1, 'one repair movement'),
        check('recheck', issues.find((i) => i.id === 'negative-stock-HRB-PEPMNT-2OZ')?.status === 'VERIFIED', 'the data check now shows it verified'),
      ];
    },
  },

  {
    id: 'T6-004', track: 'operations', campaignType: 'operate-campaign',
    title: bi('合法发货并核对库存', 'Ship lawfully and check the stock'),
    async run(env) {
      const lines = env.sql<{ sku: string; qty: number }>("SELECT sku, SUM(qty) AS qty FROM order_items WHERE order_number = '1106' GROUP BY sku");
      const before = new Map(env.sql<{ sku: string; stock_qty: number }>('SELECT sku, stock_qty FROM products').map((p) => [p.sku, p.stock_qty]));
      const r = await approved(env, 'ship_order', 'owner', '1106');
      const after = new Map(env.sql<{ sku: string; stock_qty: number }>('SELECT sku, stock_qty FROM products').map((p) => [p.sku, p.stock_qty]));
      return [
        check('verified', r.approved?.status === 'VERIFIED', `invocation ${r.approved?.status}`),
        check('state', one(env.sql<{ status: string }>("SELECT status FROM orders WHERE order_number = '1106'")).status === 'SHIPPED', 'order 1106 shipped'),
        check('stock-deltas', lines.every((l) => before.get(l.sku)! - after.get(l.sku)! === l.qty), lines.map((l) => `${l.sku} -${l.qty}`).join(', ')),
        check('outbox', n(env, "SELECT COUNT(*) FROM outbox_events WHERE aggregate_id = '1106' AND type = 'OrderShipped'") === 1, 'one OrderShipped event'),
      ];
    },
  },
  {
    id: 'T6-005', track: 'operations', campaignType: 'operate-campaign',
    title: bi('重放同一个发货请求，库存只扣一次', 'Replay the same shipping request; stock is taken once'),
    async run(env) {
      const r = await approved(env, 'ship_order', 'owner', '1106');
      const key = r.approved!.idempotencyKey;
      const replay = await createTeacoRuntimeApp({ repository: env.repository, revision: 'v1' }).request('/runtime/actions/ship_order/invoke', {
        method: 'POST', headers: { 'X-Ontology-Plus-Actor': 'owner', 'content-type': 'application/json' },
        body: JSON.stringify({ target: '1106', params: {}, idempotencyKey: key, expectedVersion: r.prepared.body.invocation.targetVersion }),
      });
      const body = (await replay.json()) as { replayed?: boolean };
      return [
        check('replayed', body.replayed === true, `second invoke replayed=${body.replayed}`),
        check('one-decrement', n(env, "SELECT COUNT(*) FROM inventory_movements WHERE order_number = '1106' AND reason = 'SHIP'") === n(env, "SELECT COUNT(DISTINCT sku) FROM order_items WHERE order_number = '1106'"), 'one movement per tea'),
      ];
    },
  },
  {
    id: 'T6-007', track: 'operations', campaignType: 'operate-campaign',
    title: bi('库存不够时发货被拒，什么都不变', 'Shipping without enough stock is refused and nothing changes'),
    async run(env) {
      const created = await approved(env, 'create_order', 'owner', undefined, { customer: amanda(env), lines: [{ sku: 'WHT-SILVER-1LB', qty: 5 }] });
      const no = created.approved!.receipt.after.key as string;
      const before = n(env, "SELECT stock_qty FROM products WHERE sku = 'WHT-SILVER-1LB'");
      const attempt = await env.call('POST', `${env.base}/console/actions/ship_order/prepare`, { actor: 'owner', target: no });
      return [
        check('refused', attempt.status === 422 && attempt.body.error.code === 'BACKORDERED', `prepare ${attempt.status} ${attempt.body?.error?.code}`),
        check('no-side-effect', n(env, "SELECT stock_qty FROM products WHERE sku = 'WHT-SILVER-1LB'") === before && one(env.sql<{ status: string }>('SELECT status FROM orders WHERE order_number = ?', no)).status === 'NEW', `stock ${before}, order still new`),
      ];
    },
  },
  {
    id: 'T6-011', track: 'operations', campaignType: 'operate-campaign',
    title: bi('Jonah 读写别人客户的订单被拒', 'Jonah is refused another manager’s orders'),
    async run(env) {
      const read = await env.call('GET', `${env.base}/console/objects/orders/1008?actor=jonah`);
      const write = await env.call('POST', `${env.base}/console/actions/cancel_order/prepare`, { actor: 'jonah', target: '1008' });
      return [
        check('read-refused', read.status === 404, `read ${read.status}`),
        check('write-refused', write.status === 404 || write.status === 422, `prepare ${write.status} ${write.body?.error?.code}`),
        check('unchanged', one(env.sql<{ status: string }>("SELECT status FROM orders WHERE order_number = '1008'")).status !== 'CANCELLED', 'order 1008 untouched'),
      ];
    },
  },

  {
    id: 'T7-003', track: 'knowledge', campaignType: 'operate-campaign',
    title: bi('新报价到了，回答当前值；问 8 月回答 8 月的', 'A new quote arrives: answer the current value, and August’s for August'),
    async run(env) {
      for (const f of ['leafline-quotes-2026-08.csv', 'leafline-quotes-2026-09.csv']) {
        const s = await env.call('POST', `${env.base}/data-sources`, { fileName: f, content: source(f) });
        await env.call('POST', `${env.base}/data-sources/${s.body.source.id}/decide`, { decision: 'VERIFY' });
      }
      const ask = async (asOf: string) => (await env.call('GET', `${env.base}/knowledge?subject=WHT-SILVER-1LB&asOf=${asOf}`)).body.claims.filter((x: any) => x.claim.predicate === 'unit_cost').map((x: any) => x.claim.value.value);
      const now = await ask('2026-09-15T00:00:00.000Z');
      const august = await ask('2026-08-15T00:00:00.000Z');
      return [check('current', JSON.stringify(now) === '[3290]', `September: ${now}`), check('as-of', JSON.stringify(august) === '[3140]', `August: ${august}`)];
    },
  },
  {
    id: 'T7-005', track: 'knowledge', campaignType: 'operate-campaign',
    title: bi('退役的说法不再被当作现行', 'A retired statement is no longer cited as current'),
    async run(env) {
      const s = await env.call('POST', `${env.base}/data-sources`, { fileName: 'leafline-quotes-2026-09.csv', content: source('leafline-quotes-2026-09.csv') });
      await env.call('POST', `${env.base}/data-sources/${s.body.source.id}/decide`, { decision: 'VERIFY' });
      const lead = (await env.call('GET', `${env.base}/knowledge?subject=WHT-SILVER-1LB`)).body.claims.find((x: any) => x.claim.predicate === 'lead_time_days').claim;
      await env.call('POST', `${env.base}/knowledge/${lead.id}/decide`, { decision: 'RETIRE' });
      const current = (await env.call('GET', `${env.base}/knowledge?subject=WHT-SILVER-1LB`)).body.claims.map((x: any) => x.claim.predicate);
      const past = (await env.call('GET', `${env.base}/knowledge?subject=WHT-SILVER-1LB&asOf=2026-09-15T00:00:00.000Z`)).body.claims.map((x: any) => x.claim.predicate);
      return [
        check('not-current', !current.includes('lead_time_days'), `current: ${current.join(', ')}`),
        check('kept-for-its-past', past.includes('lead_time_days'), 'still true for September'),
        check('application-unchanged', n(env, 'SELECT COUNT(*) FROM audit_log') === 0, 'no business write'),
      ];
    },
  },

  {
    id: 'T8-001', track: 'autonomy', campaignType: 'operate-campaign',
    title: bi('缺货事件触发一次调查', 'A shortage event starts exactly one investigation'),
    async run(env) {
      await approved(env, 'create_order', 'owner', undefined, { customer: amanda(env), lines: [{ sku: 'WHT-SILVER-1LB', qty: 5 }] });
      const first = (await env.call('GET', `${env.base}/console/tasks`)).body;
      env.store.saveConnectedApp({ ...env.store.getConnectedApp(env.projectId)!, eventCursor: '0' });
      const again = (await env.call('GET', `${env.base}/console/tasks`)).body;
      const events = n(env, "SELECT COUNT(*) FROM outbox_events WHERE type = 'StockShortage'");
      return [
        check('event-in-outbox', events === 1, `${events} StockShortage event`),
        check('one-task', first.tasks.length === 1 && again.tasks.length === 1, `${first.tasks.length} then ${again.tasks.length} after re-delivery`),
        check('dedup', again.received === 0 && again.duplicates > 0, `re-delivery: ${again.received} new, ${again.duplicates} repeats`),
        check('no-action-by-event', n(env, "SELECT stock_qty FROM products WHERE sku = 'WHT-SILVER-1LB'") === 3, 'stock untouched by the event'),
      ];
    },
  },
  {
    id: 'T8-008', track: 'autonomy', campaignType: 'operate-campaign',
    title: bi('提出模型变更并做影响分析', 'Propose a model change with impact analysis'),
    async run(env) {
      await env.call('POST', `${env.base}/change-proposals`, change('v2'));
      const proposal = (await env.call('POST', `${env.base}/console/releases/v2/verify`)).body.proposal;
      return [
        check('impact', proposal.verification.changes.some((c: any) => c.area === 'report' && c.kind === 'added'), proposal.verification.changes.map((c: any) => c.text.en).join('; ')),
        check('regression', proposal.verification.regression.every((r: any) => !r.changed), `${proposal.verification.regression.length} existing figures unchanged`),
        check('acceptance', proposal.status === 'VERIFIED', `${proposal.verification.results.filter((r: any) => r.outcome === 'PASS').length}/${proposal.verification.results.length} checks pass`),
        check('nothing-released', n(env, "SELECT COUNT(*) FROM app_state WHERE key = 'active_revision'") === 0, 'still on v1 until someone releases it'),
      ];
    },
  },
];
