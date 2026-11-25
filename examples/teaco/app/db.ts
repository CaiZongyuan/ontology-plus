import { DatabaseSync } from 'node:sqlite';
import {
  REVISIONS,
  planCommand,
  type Bilingual,
  type Change,
  type CommandActor,
  type CommandErrorCode,
  type CommandRequest,
  type DataIssue,
  type Dataset,
  type Order,
  type Revision,
} from '../domain/index.js';

/** One recorded business event shown in "最近发生的事". */
export interface ActivityEvent {
  readonly at: string;
  readonly kind: 'ok' | 'info' | 'warning';
  readonly text: Bilingual;
}

/** What a committed command returns; replaying the same idempotency key returns the same receipt. */
export interface CommandReceipt {
  readonly commandId: string;
  readonly action: string;
  readonly actor: string;
  readonly idempotencyKey: string;
  readonly target: string | null;
  readonly status: 'COMMITTED';
  readonly summary: Bilingual;
  readonly effects: readonly Bilingual[];
  /** Target state after the command: its new version and, for orders, status. */
  readonly after: { readonly key: string | null; readonly version: number | null; readonly state: string | null };
  readonly committedAt: string;
}

export type ExecuteResult =
  | { readonly ok: true; readonly receipt: CommandReceipt; readonly replayed: boolean }
  | { readonly ok: false; readonly code: CommandErrorCode | 'VERSION_CONFLICT' | 'IDEMPOTENCY_KEY_REUSED'; readonly message: Bilingual };

export interface ExecuteInput {
  readonly actor: CommandActor;
  readonly revision: Revision;
  readonly request: CommandRequest;
  readonly idempotencyKey: string;
  /** The target version the approval was bound to; null for commands without a target. */
  readonly expectedVersion: number | null;
  readonly at: string;
}

/**
 * TeaCo's repository port. It is asynchronous from the start so the same callers can move
 * to Cloudflare D1 in P5 (spec v0.3.1 revision note 6); locally it is backed by node:sqlite.
 */
export interface TeacoRepository {
  isEmpty(): Promise<boolean>;
  importSeed(data: Dataset, at: string): Promise<void>;
  loadDataset(): Promise<Dataset>;
  listActivity(limit: number): Promise<ActivityEvent[]>;
  recordActivity(event: ActivityEvent): Promise<void>;
  /** Plans and applies one command in a single transaction: all its writes or none (spec §6.2). */
  execute(input: ExecuteInput): Promise<ExecuteResult>;
  findReceipt(actorId: string, idempotencyKey: string): Promise<CommandReceipt | null>;
  /** The requirement version in use, once one was activated; null means the process default. */
  getActiveRevision(): Promise<Revision | null>;
  /**
   * Puts another requirement version in use (go-live or roll-back, spec §10.6). Refused while data
   * exists that the target version cannot represent (orders on hold before v4): it must be resolved
   * by a business action first, never by rolling code back over committed transactions.
   */
  activateRevision(input: { readonly to: Revision; readonly from: Revision; readonly at: string; readonly requestId: string }): Promise<ActivateResult>;
  close(): void;
}

export type ActivateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'ROLLBACK_BLOCKED'; readonly message: Bilingual };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS account_managers (id TEXT PRIMARY KEY, display_name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY, email_norm TEXT NOT NULL UNIQUE, name TEXT NOT NULL, company TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('RETAIL','WHOLESALE')), manager_id TEXT REFERENCES account_managers(id),
  certificate_valid INTEGER NOT NULL, certificate_raw TEXT NOT NULL, city TEXT NOT NULL, state TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS customers_manager_type ON customers(manager_id, type);
CREATE TABLE IF NOT EXISTS products (
  sku TEXT PRIMARY KEY, name TEXT NOT NULL, size TEXT NOT NULL,
  retail_cents INTEGER NOT NULL CHECK (retail_cents >= 0), wholesale_cents INTEGER NOT NULL CHECK (wholesale_cents >= 0),
  stock_qty INTEGER NOT NULL CHECK (stock_qty >= 0), raw_stock INTEGER NOT NULL, stock_blocked INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS orders (
  order_number TEXT PRIMARY KEY, order_date TEXT NOT NULL, customer_id TEXT NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL CHECK (status IN ('NEW','PAID','PACKED','ON_HOLD','SHIPPED','DELIVERED','CANCELLED')),
  goods_cents INTEGER NOT NULL, discount_cents INTEGER NOT NULL, shipping_cents INTEGER NOT NULL, tax_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL, imported INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS orders_customer_status ON orders(customer_id, status);
CREATE INDEX IF NOT EXISTS orders_status_date ON orders(status, order_date);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_number TEXT NOT NULL REFERENCES orders(order_number),
  sku TEXT NOT NULL REFERENCES products(sku), qty INTEGER NOT NULL CHECK (qty > 0), unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0));
CREATE INDEX IF NOT EXISTS order_items_order_product ON order_items(order_number, sku);
CREATE TABLE IF NOT EXISTS data_issues (
  id TEXT PRIMARY KEY, title_zh TEXT NOT NULL, title_en TEXT NOT NULL, detail_zh TEXT NOT NULL, detail_en TEXT NOT NULL,
  status TEXT NOT NULL, needs_decision INTEGER NOT NULL, position INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, text_zh TEXT NOT NULL, text_en TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS action_commands (
  command_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action_id TEXT NOT NULL, idem_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL, receipt_json TEXT NOT NULL, committed_at TEXT NOT NULL,
  UNIQUE(actor_id, idem_key));
CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT NOT NULL REFERENCES products(sku), order_number TEXT,
  delta_qty INTEGER NOT NULL, reason TEXT NOT NULL, command_id TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(command_id, sku));
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,
  actor_id TEXT NOT NULL, before_json TEXT, after_json TEXT, request_id TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS audit_entity ON audit_log(entity_type, entity_id, created_at);
CREATE TABLE IF NOT EXISTS outbox_events (
  event_id TEXT PRIMARY KEY, type TEXT NOT NULL, aggregate_id TEXT NOT NULL, aggregate_version INTEGER,
  payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL, correlation_id TEXT NOT NULL,
  delivery_state TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT);
CREATE INDEX IF NOT EXISTS outbox_delivery ON outbox_events(delivery_state, next_attempt_at);
CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

/** Columns added after the first schema; applied once to databases created earlier. */
const COLUMN_MIGRATIONS: readonly [table: string, column: string, ddl: string][] = [
  ['products', 'version', 'ALTER TABLE products ADD COLUMN version INTEGER NOT NULL DEFAULT 1'],
  ['orders', 'hold_previous_status', 'ALTER TABLE orders ADD COLUMN hold_previous_status TEXT'],
  ['data_issues', 'action_id', 'ALTER TABLE data_issues ADD COLUMN action_id TEXT'],
  ['data_issues', 'action_target', 'ALTER TABLE data_issues ADD COLUMN action_target TEXT'],
];

type Row = Record<string, string | number | null>;

const EVENT_TYPES: Record<string, string> = {
  PAID: 'OrderPaid', PACKED: 'OrderPacked', SHIPPED: 'OrderShipped', DELIVERED: 'OrderDelivered',
  CANCELLED: 'OrderCancelled', ON_HOLD: 'OrderHeld',
};

async function payloadHash(req: CommandRequest): Promise<string> {
  const text = JSON.stringify({ action: req.action, target: req.target ?? null, params: req.params ?? {} });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function openTeacoRepository(path: string): TeacoRepository {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  for (const [table, column, ddl] of COLUMN_MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) db.exec(ddl);
  }
  const all = (sql: string, ...params: (string | number | null)[]) => db.prepare(sql).all(...params) as Row[];
  const run = (sql: string, ...params: (string | number | null)[]) => db.prepare(sql).run(...params);

  function loadDatasetSync(): Dataset {
    const lines = new Map<string, Order['lines'][number][]>();
    for (const r of all('SELECT order_number, sku, qty, unit_price_cents FROM order_items ORDER BY id')) {
      const k = r.order_number as string;
      lines.set(k, [...(lines.get(k) ?? []), { sku: r.sku as string, qty: r.qty as number, unitCents: r.unit_price_cents as number }]);
    }
    return {
      managers: all('SELECT id, display_name FROM account_managers ORDER BY rowid').map((r) => ({ id: r.id as string, name: r.display_name as string })),
      customers: all('SELECT * FROM customers ORDER BY rowid').map((r) => ({
        id: r.id as string, email: r.email_norm as string, name: r.name as string, company: r.company as string,
        type: r.type as 'RETAIL' | 'WHOLESALE', managerId: (r.manager_id as string | null) ?? null,
        certificateValid: r.certificate_valid === 1, certificateRaw: r.certificate_raw as string, city: r.city as string, state: r.state as string,
      })),
      products: all('SELECT * FROM products ORDER BY rowid').map((r) => ({
        sku: r.sku as string, name: r.name as string, size: r.size as string, retailCents: r.retail_cents as number,
        wholesaleCents: r.wholesale_cents as number, stock: r.stock_qty as number, rawStock: r.raw_stock as number, stockBlocked: r.stock_blocked === 1,
        version: r.version as number,
      })),
      orders: all('SELECT * FROM orders ORDER BY CAST(order_number AS INTEGER)').map((r) => ({
        number: r.order_number as string, date: r.order_date as string, customerId: r.customer_id as string, status: r.status as Order['status'],
        lines: lines.get(r.order_number as string) ?? [], goodsCents: r.goods_cents as number, discountCents: r.discount_cents as number,
        shippingCents: r.shipping_cents as number, taxCents: r.tax_cents as number, totalCents: r.total_cents as number, imported: r.imported === 1,
        holdPrevious: (r.hold_previous_status as Order['status'] | null) ?? null, version: r.version as number,
      })),
      issues: all('SELECT * FROM data_issues ORDER BY position').map((r): DataIssue => ({
        id: r.id as string, title: { zh: r.title_zh as string, en: r.title_en as string }, detail: { zh: r.detail_zh as string, en: r.detail_en as string },
        status: r.status as DataIssue['status'], needsDecision: r.needs_decision === 1,
        ...(r.action_id ? { action: { actionId: r.action_id as string, target: r.action_target as string } } : {}),
      })),
    };
  }

  function receiptFor(actorId: string, key: string): { hash: string; receipt: CommandReceipt } | null {
    const r = all('SELECT payload_hash, receipt_json FROM action_commands WHERE actor_id = ? AND idem_key = ?', actorId, key)[0];
    return r ? { hash: r.payload_hash as string, receipt: JSON.parse(r.receipt_json as string) as CommandReceipt } : null;
  }

  /** Applies planned changes with conditional writes; any write that does not land aborts the transaction. */
  function applyChanges(changes: readonly Change[], actorId: string, commandId: string, at: string): { version: number | null; state: string | null } {
    const guard = (result: { changes: number | bigint }, what: string) => {
      if (Number(result.changes) !== 1) throw new Error(`CONFLICT: ${what}`);
    };
    let after: { version: number | null; state: string | null } = { version: null, state: null };
    for (const c of changes) {
      if (c.kind === 'order-status') {
        const before = all('SELECT version FROM orders WHERE order_number = ?', c.number)[0]!;
        guard(run(
          'UPDATE orders SET status = ?, hold_previous_status = ?, version = version + 1 WHERE order_number = ? AND status = ?',
          c.to, c.holdPrevious, c.number, c.from,
        ), `order ${c.number} is no longer ${c.from}`);
        after = { version: (before.version as number) + 1, state: c.to };
        run('INSERT INTO audit_log (entity_type, entity_id, action, actor_id, before_json, after_json, request_id, created_at) VALUES (?,?,?,?,?,?,?,?)',
          'order', c.number, 'STATUS', actorId, JSON.stringify({ status: c.from }), JSON.stringify({ status: c.to }), commandId, at);
        run('INSERT INTO outbox_events (event_id, type, aggregate_id, aggregate_version, payload_json, occurred_at, correlation_id) VALUES (?,?,?,?,?,?,?)',
          `${commandId}:${c.number}`, c.from === 'ON_HOLD' && c.to !== 'CANCELLED' ? 'OrderReleased' : EVENT_TYPES[c.to] ?? 'OrderUpdated', c.number, after.version, JSON.stringify({ from: c.from, to: c.to }), at, commandId);
      } else if (c.kind === 'stock') {
        const before = all('SELECT version FROM products WHERE sku = ?', c.sku)[0]!;
        // Conditional on the stock the plan saw, so a concurrent change can never be overwritten.
        guard(run(
          'UPDATE products SET stock_qty = ?, stock_blocked = CASE WHEN ? THEN 0 ELSE stock_blocked END, version = version + 1 WHERE sku = ? AND stock_qty = ?',
          c.to, c.unblock ? 1 : 0, c.sku, c.from,
        ), `stock of ${c.sku} changed`);
        run('INSERT INTO inventory_movements (sku, order_number, delta_qty, reason, command_id, created_at) VALUES (?,?,?,?,?,?)',
          c.sku, c.orderNumber ?? null, c.to - c.from, c.reason, commandId, at);
        run('INSERT INTO audit_log (entity_type, entity_id, action, actor_id, before_json, after_json, request_id, created_at) VALUES (?,?,?,?,?,?,?,?)',
          'product', c.sku, c.reason, actorId, JSON.stringify({ stock: c.from }), JSON.stringify({ stock: c.to }), commandId, at);
        if (c.reason !== 'SHIP') after = { version: (before.version as number) + 1, state: String(c.to) };
      } else if (c.kind === 'issue') {
        run('UPDATE data_issues SET status = ?, needs_decision = 0 WHERE id = ?', c.status, c.id);
      } else if (c.kind === 'create-order') {
        const o = c.order;
        run('INSERT INTO orders (order_number, order_date, customer_id, status, goods_cents, discount_cents, shipping_cents, tax_cents, total_cents, imported, version) VALUES (?,?,?,?,?,?,?,?,?,?,1)',
          o.number, o.date, o.customerId, o.status, o.goodsCents, o.discountCents, o.shippingCents, o.taxCents, o.totalCents, 0);
        for (const l of o.lines) run('INSERT INTO order_items (order_number, sku, qty, unit_price_cents) VALUES (?,?,?,?)', o.number, l.sku, l.qty, l.unitCents);
        run('INSERT INTO audit_log (entity_type, entity_id, action, actor_id, before_json, after_json, request_id, created_at) VALUES (?,?,?,?,?,?,?,?)',
          'order', o.number, 'CREATE', actorId, null, JSON.stringify({ status: 'NEW', total: o.totalCents }), commandId, at);
        run('INSERT INTO outbox_events (event_id, type, aggregate_id, aggregate_version, payload_json, occurred_at, correlation_id) VALUES (?,?,?,?,?,?,?)',
          `${commandId}:${o.number}`, 'OrderCreated', o.number, 1, JSON.stringify({ total: o.totalCents }), at, commandId);
        after = { version: 1, state: 'NEW' };
      }
    }
    return after;
  }

  return {
    async isEmpty() {
      return (all('SELECT COUNT(*) AS n FROM orders')[0]!.n as number) === 0;
    },
    async importSeed(data, at) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const m = db.prepare('INSERT INTO account_managers (id, display_name) VALUES (?, ?)');
        for (const x of data.managers) m.run(x.id, x.name);
        const c = db.prepare('INSERT INTO customers VALUES (?,?,?,?,?,?,?,?,?,?)');
        for (const x of data.customers) c.run(x.id, x.email, x.name, x.company, x.type, x.managerId, x.certificateValid ? 1 : 0, x.certificateRaw, x.city, x.state);
        const p = db.prepare('INSERT INTO products (sku, name, size, retail_cents, wholesale_cents, stock_qty, raw_stock, stock_blocked, version) VALUES (?,?,?,?,?,?,?,?,1)');
        for (const x of data.products) p.run(x.sku, x.name, x.size, x.retailCents, x.wholesaleCents, x.stock, x.rawStock, x.stockBlocked ? 1 : 0);
        const o = db.prepare('INSERT INTO orders (order_number, order_date, customer_id, status, goods_cents, discount_cents, shipping_cents, tax_cents, total_cents, imported) VALUES (?,?,?,?,?,?,?,?,?,?)');
        const li = db.prepare('INSERT INTO order_items (order_number, sku, qty, unit_price_cents) VALUES (?,?,?,?)');
        for (const x of data.orders) {
          o.run(x.number, x.date, x.customerId, x.status, x.goodsCents, x.discountCents, x.shippingCents, x.taxCents, x.totalCents, x.imported ? 1 : 0);
          for (const l of x.lines) li.run(x.number, l.sku, l.qty, l.unitCents);
        }
        const di = db.prepare('INSERT INTO data_issues (id, title_zh, title_en, detail_zh, detail_en, status, needs_decision, position, action_id, action_target) VALUES (?,?,?,?,?,?,?,?,?,?)');
        data.issues.forEach((x, i) => di.run(x.id, x.title.zh, x.title.en, x.detail.zh, x.detail.en, x.status, x.needsDecision ? 1 : 0, i, x.action?.actionId ?? null, x.action?.target ?? null));
        run('INSERT INTO activity (at, kind, text_zh, text_en) VALUES (?,?,?,?)',
          at, 'ok',
          `导入了 3 份表格：${data.customers.length} 位客户、${data.products.length} 款茶、${data.orders.length} 张订单，发现并处理了 ${data.issues.length} 类数据问题`,
          `Imported 3 tables: ${data.customers.length} customers, ${data.products.length} teas, ${data.orders.length} orders; found and handled ${data.issues.length} kinds of data problem`,
        );
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    async loadDataset() {
      // Databases imported before the repair action existed: link the negative-stock issue to it.
      run("UPDATE data_issues SET action_id = 'repair_stock', action_target = substr(id, 16) WHERE id LIKE 'negative-stock-%' AND action_id IS NULL");
      return loadDatasetSync();
    },
    async listActivity(limit) {
      return all('SELECT at, kind, text_zh, text_en FROM activity ORDER BY id DESC LIMIT ?', limit).map((r) => ({
        at: r.at as string, kind: r.kind as ActivityEvent['kind'], text: { zh: r.text_zh as string, en: r.text_en as string },
      }));
    },
    async recordActivity(e) {
      run('INSERT INTO activity (at, kind, text_zh, text_en) VALUES (?,?,?,?)', e.at, e.kind, e.text.zh, e.text.en);
    },
    async execute(input) {
      const hash = await payloadHash(input.request);
      const prior = receiptFor(input.actor.id, input.idempotencyKey);
      if (prior) {
        return prior.hash === hash
          ? { ok: true, receipt: prior.receipt, replayed: true }
          : { ok: false, code: 'IDEMPOTENCY_KEY_REUSED', message: { zh: '同一个请求编号被用在了内容不同的操作上，已拒绝。', en: 'The same request key was used for a different action and was refused.' } };
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        // Re-plan against the data as it is inside the transaction, never the data the preview saw.
        const data = loadDatasetSync();
        const plan = planCommand(data, input.actor, input.revision, input.request);
        if (!plan.ok) {
          db.exec('ROLLBACK');
          return { ok: false, code: plan.code, message: plan.message };
        }
        if (input.expectedVersion !== null && plan.target.version !== input.expectedVersion) {
          db.exec('ROLLBACK');
          return {
            ok: false, code: 'VERSION_CONFLICT',
            message: { zh: `批准之后它被改过（批准时第 ${input.expectedVersion} 版，现在第 ${plan.target.version} 版），这次批准作废。`, en: `It changed after the approval (approved at version ${input.expectedVersion}, now ${plan.target.version}); the approval no longer holds.` },
          };
        }
        const commandId = `cmd-${crypto.randomUUID()}`;
        const after = applyChanges(plan.changes, input.actor.id, commandId, input.at);
        const created = plan.changes.find((c): c is Extract<Change, { kind: 'create-order' }> => c.kind === 'create-order');
        const key = plan.target.key ?? created?.order.number ?? null;
        const receipt: CommandReceipt = {
          commandId, action: input.request.action, actor: input.actor.id, idempotencyKey: input.idempotencyKey, target: key,
          status: 'COMMITTED', summary: plan.summary, effects: plan.effects, after: { key, ...after }, committedAt: input.at,
        };
        run('INSERT INTO action_commands (command_id, actor_id, action_id, idem_key, payload_hash, receipt_json, committed_at) VALUES (?,?,?,?,?,?,?)',
          commandId, input.actor.id, input.request.action, input.idempotencyKey, hash, JSON.stringify(receipt), input.at);
        run('INSERT INTO activity (at, kind, text_zh, text_en) VALUES (?,?,?,?)', input.at, 'ok', `${plan.summary.zh}（已执行）`, `${plan.summary.en} (done)`);
        db.exec('COMMIT');
        return { ok: true, receipt, replayed: false };
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
        if (err instanceof Error && err.message.startsWith('CONFLICT')) {
          return { ok: false, code: 'VERSION_CONFLICT', message: { zh: '执行时数据刚好被别人改了，什么都没写入，请重新准备。', en: 'The data changed while executing; nothing was written. Prepare it again.' } };
        }
        throw err;
      }
    },
    async findReceipt(actorId, key) {
      return receiptFor(actorId, key)?.receipt ?? null;
    },
    async getActiveRevision() {
      const row = db.prepare("SELECT value FROM app_state WHERE key = 'active_revision'").get() as { value: string } | undefined;
      return row && (REVISIONS as readonly string[]).includes(row.value) ? (row.value as Revision) : null;
    },
    async activateRevision({ to, from, at, requestId }) {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (REVISIONS.indexOf(to) < REVISIONS.indexOf('v4')) {
          const held = (db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'ON_HOLD'").get() as { n: number }).n;
          if (held > 0) {
            db.exec('ROLLBACK');
            return {
              ok: false,
              code: 'ROLLBACK_BLOCKED',
              message: {
                zh: `有 ${held} 张订单处于「挂起中」，需求 ${to} 没有这个状态。请先解除挂起或取消这些订单，再回到 ${to}。`,
                en: `${held} order(s) are on hold, which requirement ${to} has no state for. Release or cancel them first, then go back to ${to}.`,
              },
            };
          }
        }
        run("INSERT INTO app_state (key, value) VALUES ('active_revision', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", to);
        run('INSERT INTO audit_log (entity_type, entity_id, action, actor_id, before_json, after_json, request_id, created_at) VALUES (?,?,?,?,?,?,?,?)',
          'release', 'active_revision', 'ACTIVATE', 'ontology-plus', JSON.stringify({ revision: from }), JSON.stringify({ revision: to }), requestId, at);
        const back = REVISIONS.indexOf(to) < REVISIONS.indexOf(from);
        run('INSERT INTO activity (at, kind, text_zh, text_en) VALUES (?,?,?,?)', at, back ? 'warning' : 'ok',
          back ? `回到需求 ${to}（从 ${from}）` : `需求 ${to} 上线（原为 ${from}）`,
          back ? `Back to requirement ${to} (from ${from})` : `Requirement ${to} is live (was ${from})`);
        db.exec('COMMIT');
        return { ok: true };
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    close() {
      db.close();
    },
  };
}
