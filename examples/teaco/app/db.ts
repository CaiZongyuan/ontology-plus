import { DatabaseSync } from 'node:sqlite';
import type { Bilingual, DataIssue, Dataset, Order } from '../domain/index.js';

/** One recorded business event shown in "最近发生的事". */
export interface ActivityEvent {
  readonly at: string;
  readonly kind: 'ok' | 'info' | 'warning';
  readonly text: Bilingual;
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
  close(): void;
}

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
`;

type Row = Record<string, string | number | null>;

export function openTeacoRepository(path: string): TeacoRepository {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  const all = (sql: string, ...params: (string | number)[]) => db.prepare(sql).all(...params) as Row[];

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
        const p = db.prepare('INSERT INTO products VALUES (?,?,?,?,?,?,?,?)');
        for (const x of data.products) p.run(x.sku, x.name, x.size, x.retailCents, x.wholesaleCents, x.stock, x.rawStock, x.stockBlocked ? 1 : 0);
        const o = db.prepare('INSERT INTO orders (order_number, order_date, customer_id, status, goods_cents, discount_cents, shipping_cents, tax_cents, total_cents, imported) VALUES (?,?,?,?,?,?,?,?,?,?)');
        const li = db.prepare('INSERT INTO order_items (order_number, sku, qty, unit_price_cents) VALUES (?,?,?,?)');
        for (const x of data.orders) {
          o.run(x.number, x.date, x.customerId, x.status, x.goodsCents, x.discountCents, x.shippingCents, x.taxCents, x.totalCents, x.imported ? 1 : 0);
          for (const l of x.lines) li.run(x.number, l.sku, l.qty, l.unitCents);
        }
        const di = db.prepare('INSERT INTO data_issues VALUES (?,?,?,?,?,?,?,?)');
        data.issues.forEach((x, i) => di.run(x.id, x.title.zh, x.title.en, x.detail.zh, x.detail.en, x.status, x.needsDecision ? 1 : 0, i));
        db.prepare('INSERT INTO activity (at, kind, text_zh, text_en) VALUES (?,?,?,?)').run(
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
        })),
        orders: all('SELECT * FROM orders ORDER BY CAST(order_number AS INTEGER)').map((r) => ({
          number: r.order_number as string, date: r.order_date as string, customerId: r.customer_id as string, status: r.status as Order['status'],
          lines: lines.get(r.order_number as string) ?? [], goodsCents: r.goods_cents as number, discountCents: r.discount_cents as number,
          shippingCents: r.shipping_cents as number, taxCents: r.tax_cents as number, totalCents: r.total_cents as number, imported: r.imported === 1,
        })),
        issues: all('SELECT * FROM data_issues ORDER BY position').map((r): DataIssue => ({
          id: r.id as string, title: { zh: r.title_zh as string, en: r.title_en as string }, detail: { zh: r.detail_zh as string, en: r.detail_en as string },
          status: r.status as DataIssue['status'], needsDecision: r.needs_decision === 1,
        })),
      };
    },
    async listActivity(limit) {
      return all('SELECT at, kind, text_zh, text_en FROM activity ORDER BY id DESC LIMIT ?', limit).map((r) => ({
        at: r.at as string, kind: r.kind as ActivityEvent['kind'], text: { zh: r.text_zh as string, en: r.text_en as string },
      }));
    },
    async recordActivity(e) {
      db.prepare('INSERT INTO activity (at, kind, text_zh, text_en) VALUES (?,?,?,?)').run(e.at, e.kind, e.text.zh, e.text.en);
    },
    close() {
      db.close();
    },
  };
}
