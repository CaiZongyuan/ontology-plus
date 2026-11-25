import { Hono } from 'hono';
import {
  OPEN_STATUSES,
  REVISIONS,
  customerInScope,
  monthlySales,
  scopedOrders,
  shopMetrics,
  shortSkus,
  type Bilingual,
  type Customer,
  type Dataset,
  type Order,
  type OrderStatus,
  type Product,
  type Revision,
  type Scope,
} from '../domain/index.js';
import type { TeacoRepository } from './db.js';

/**
 * TeaCo's side of connection contract v1 (spec v0.3.1 §11.3). It follows the public contract
 * only and imports nothing from Ontology Plus. Reads are filtered by the Acting Identity sent in
 * `X-Ontology-Plus-Actor`; the runtime interface is meant to listen on loopback.
 */
export interface TeacoRuntimeOptions {
  readonly repository: TeacoRepository;
  readonly revision: Revision;
  readonly now?: () => Date;
}

const PROTOCOL = 'ontology-plus-connect/1';
const ACTOR_HEADER = 'X-Ontology-Plus-Actor';
const bi = (zh: string, en: string): Bilingual => ({ zh, en });
const atLeast = (r: Revision, min: Revision) => REVISIONS.indexOf(r) >= REVISIONS.indexOf(min);

const STATUS_NAMES: Record<OrderStatus, Bilingual> = {
  NEW: bi('新建', 'New'), PAID: bi('已付款', 'Paid'), PACKED: bi('已打包', 'Packed'), ON_HOLD: bi('挂起中', 'On hold'),
  SHIPPED: bi('已发货', 'Shipped'), DELIVERED: bi('已送达', 'Delivered'), CANCELLED: bi('已取消', 'Cancelled'),
};
const CHANNEL = { RETAIL: bi('零售', 'Retail'), WHOLESALE: bi('批发', 'Wholesale') };
const REVISION_NAMES: Record<Revision, Bilingual> = {
  v1: bi('初版订单系统', 'First order system'), v2: bi('按月销售报表', 'Monthly sales report'),
  v3: bi('批发满 $1,000 打 95 折', '5% off wholesale from $1,000'), v4: bi('订单挂起', 'Orders on hold'),
};

interface ActorDef {
  readonly id: string;
  readonly name: Bilingual;
  readonly role: Bilingual;
  readonly scope: Bilingual;
  readonly access: Scope;
}

function actors(data: Dataset): ActorDef[] {
  const count = (id: string) => data.customers.filter((c) => c.type === 'WHOLESALE' && c.managerId === id).length;
  return [
    { id: 'owner', name: bi('店主', 'Owner'), role: bi('管理员', 'Admin'), scope: bi('全店', 'Whole shop'), access: { kind: 'all', readOnly: false } },
    ...data.managers.map((m): ActorDef => ({
      id: m.id, name: bi(m.name, m.name), role: bi('客户经理', 'Account manager'),
      scope: bi(`自己负责的 ${count(m.id)} 家批发客户`, `The ${count(m.id)} wholesale customers they manage`),
      access: { kind: 'manager', managerId: m.id },
    })),
    { id: 'finance', name: bi('财务', 'Finance'), role: bi('只读', 'Read-only'), scope: bi('全店，只能看不能改', 'Whole shop, read only'), access: { kind: 'all', readOnly: true } },
  ];
}

function orderFilters(revision: Revision) {
  const statuses: OrderStatus[] = ['NEW', 'PAID', 'PACKED', ...(atLeast(revision, 'v4') ? (['ON_HOLD'] as const) : []), 'SHIPPED', 'DELIVERED', 'CANCELLED'];
  return [{ id: 'open', label: bi('没发货', 'Not shipped') }, ...statuses.map((s) => ({ id: s.toLowerCase(), label: STATUS_NAMES[s] })), { id: 'all', label: bi('全部', 'All') }];
}

export function buildManifest(data: Dataset, revision: Revision) {
  return {
    protocol: PROTOCOL,
    application: {
      name: bi('TeaCo 茶叶订单系统', 'TeaCo tea orders'),
      version: revision,
      description: bi(`需求 ${revision}：${REVISION_NAMES[revision].zh}`, `Requirement ${revision}: ${REVISION_NAMES[revision].en}`),
      currency: 'USD',
    },
    model: { revision },
    actors: actors(data).map(({ access: _access, ...a }) => a),
    metrics: [
      { id: 'open_orders', name: bi('没发货的订单', 'Orders not shipped'), unit: 'count', headline: bi('还有 {value} 张订单没发货', '{value} orders have not shipped') },
      { id: 'shipped_sales', name: bi('已发货销售额', 'Shipped sales'), unit: 'money' },
      { id: 'shipped_tax', name: bi('已发货税额', 'Sales tax on shipped orders'), unit: 'money' },
      { id: 'average_shipped_order', name: bi('平均每单', 'Average shipped order'), unit: 'money' },
    ],
    objects: [
      {
        id: 'orders', name: bi('订单', 'Orders'), modelObject: 'Order', titleField: 'customer', statusField: 'status',
        fields: [
          { key: 'number', label: bi('订单号', 'Order'), type: 'text' },
          { key: 'customer', label: bi('客户', 'Customer'), type: 'text' },
          { key: 'channel', label: bi('渠道', 'Channel'), type: 'tag' },
          { key: 'date', label: bi('下单日期', 'Order date'), type: 'date' },
          { key: 'status', label: bi('状态', 'Status'), type: 'status' },
          { key: 'total', label: bi('金额', 'Total'), type: 'money' },
        ],
        filters: orderFilters(revision),
      },
      {
        id: 'products', name: bi('商品与库存', 'Teas and stock'), modelObject: 'Product', titleField: 'name', statusField: 'state',
        fields: [
          { key: 'name', label: bi('茶', 'Tea'), type: 'text' },
          { key: 'size', label: bi('规格', 'Size'), type: 'text' },
          { key: 'sku', label: bi('货号', 'Item code'), type: 'text' },
          { key: 'retail', label: bi('零售价', 'Retail price'), type: 'money' },
          { key: 'wholesale', label: bi('批发价', 'Wholesale price'), type: 'money' },
          { key: 'stock', label: bi('库存', 'Stock'), type: 'number' },
          { key: 'state', label: bi('状态', 'State'), type: 'status' },
        ],
        filters: [{ id: 'attention', label: bi('库存少或锁住', 'Low or locked') }, { id: 'all', label: bi('全部', 'All') }],
      },
      {
        id: 'customers', name: bi('客户', 'Customers'), modelObject: 'Customer', titleField: 'name',
        fields: [
          { key: 'name', label: bi('客户', 'Customer'), type: 'text' },
          { key: 'type', label: bi('类型', 'Type'), type: 'tag' },
          { key: 'manager', label: bi('客户经理', 'Account manager'), type: 'text' },
          { key: 'tax', label: bi('税', 'Tax'), type: 'tag' },
          { key: 'city', label: bi('城市', 'City'), type: 'text' },
          { key: 'orders', label: bi('订单数', 'Orders'), type: 'number' },
        ],
        filters: [{ id: 'wholesale', label: bi('批发', 'Wholesale') }, { id: 'retail', label: bi('零售', 'Retail') }, { id: 'all', label: bi('全部', 'All') }],
      },
    ],
    reports: atLeast(revision, 'v2')
      ? [{ id: 'monthly_sales', name: bi('月度销售报表', 'Monthly sales'), description: bi('每月零售、批发分开看订单数、货款、运费、税和总额', 'Orders, goods, shipping, tax and total per month, retail and wholesale apart') }]
      : [],
    dataIssues: true,
    activity: true,
  };
}

const customerName = (c: Customer) => c.company || c.name;
const productName = (p: Product | undefined, sku: string) => (p ? `${p.name}（${p.size}）` : sku);

function orderRow(o: Order, customers: Map<string, Customer>, products: Map<string, Product>) {
  const c = customers.get(o.customerId)!;
  const short = shortSkus(o, products);
  const blocked = short.some((s) => products.get(s)?.stockBlocked);
  return {
    key: o.number,
    values: { number: o.number, customer: customerName(c), channel: CHANNEL[c.type], date: o.date, status: STATUS_NAMES[o.status], total: o.totalCents },
    flags: short.length ? [{ tone: 'error', label: blocked ? bi('库存受阻', 'Stock locked') : bi('缺货', 'Backordered') }] : [],
  };
}

function productState(p: Product) {
  if (p.stockBlocked) return bi('锁住', 'Locked');
  if (p.stock <= 5) return bi('库存少', 'Low');
  return bi('正常', 'In stock');
}

export function createTeacoRuntimeApp(options: TeacoRuntimeOptions) {
  const { repository, revision } = options;
  const now = options.now ?? (() => new Date());
  const app = new Hono<{ Variables: { data: Dataset; actor: ActorDef } }>();

  app.get('/', (c) =>
    c.html(`<!doctype html><meta charset="utf-8"><title>TeaCo</title><body style="font-family:system-ui;padding:32px">
      <h1>TeaCo 茶叶订单系统</h1><p>需求 ${revision}：${REVISION_NAMES[revision].zh}。这是 Ontology Plus 的参考应用；接入清单在
      <a href="/.well-known/ontology-plus.json">/.well-known/ontology-plus.json</a>。</p></body>`),
  );

  app.get('/.well-known/ontology-plus.json', async (c) => c.json(buildManifest(await repository.loadDataset(), revision)));

  app.use('/runtime/*', async (c, next) => {
    const data = await repository.loadDataset();
    const list = actors(data);
    const wanted = c.req.header(ACTOR_HEADER)?.trim();
    const actor = wanted ? list.find((a) => a.id === wanted) : list[0];
    if (!actor) return c.json({ error: `unknown acting identity "${wanted}"` }, 400);
    c.set('data', data);
    c.set('actor', actor);
    await next();
  });

  app.get('/runtime/metrics', (c) => {
    const m = shopMetrics(c.var.data, c.var.actor.access);
    return c.json({
      asOf: now().toISOString(),
      values: [
        { id: 'open_orders', value: m.openOrders, hint: m.backorderedOrders ? bi(`其中 ${m.backorderedOrders} 张缺货`, `${m.backorderedOrders} backordered`) : bi('都有货', 'All in stock') },
        { id: 'shipped_sales', value: m.shippedSalesCents, hint: bi(`${m.shippedOrders} 张已发货或送达`, `${m.shippedOrders} shipped or delivered`) },
        { id: 'shipped_tax', value: m.shippedTaxCents, hint: bi('只对货款收税', 'Tax is on goods only') },
        { id: 'average_shipped_order', value: m.averageShippedOrderCents, hint: bi('已发货订单的平均总额', 'Mean total of shipped orders') },
      ],
    });
  });

  app.get('/runtime/objects/:objectId', (c) => {
    const { data, actor } = c.var;
    const filter = c.req.query('filter') ?? '';
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50) || 50, 1), 200);
    const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0);
    const customers = new Map(data.customers.map((x) => [x.id, x]));
    const products = new Map(data.products.map((x) => [x.sku, x]));
    const page = <T,>(rows: T[]) => rows.slice(offset, offset + limit);

    if (c.req.param('objectId') === 'orders') {
      const scoped = scopedOrders(data, actor.access).sort((a, b) => b.date.localeCompare(a.date) || Number(b.number) - Number(a.number));
      const match = (o: Order, f: string) => (f === 'open' ? OPEN_STATUSES.includes(o.status) : f === 'all' || f === '' ? true : o.status.toLowerCase() === f);
      const rows = scoped.filter((o) => match(o, filter || 'open'));
      return c.json({
        asOf: now().toISOString(), total: rows.length,
        counts: orderFilters(revision).map((f) => ({ filter: f.id, count: scoped.filter((o) => match(o, f.id)).length })),
        rows: page(rows).map((o) => orderRow(o, customers, products)),
      });
    }
    if (c.req.param('objectId') === 'products') {
      const all = [...data.products].sort((a, b) => Number(b.stockBlocked) - Number(a.stockBlocked) || a.stock - b.stock || a.name.localeCompare(b.name));
      const attention = (p: Product) => p.stockBlocked || p.stock <= 5;
      const rows = all.filter((p) => (filter === 'attention' ? attention(p) : true));
      return c.json({
        asOf: now().toISOString(), total: rows.length,
        counts: [{ filter: 'attention', count: all.filter(attention).length }, { filter: 'all', count: all.length }],
        rows: page(rows).map((p) => ({
          key: p.sku,
          values: { name: p.name, size: p.size, sku: p.sku, retail: p.retailCents, wholesale: p.wholesaleCents, stock: p.stock, state: productState(p) },
          flags: p.stockBlocked ? [{ tone: 'error', label: bi(`导入时库存是 ${p.rawStock}`, `Imported with stock ${p.rawStock}`) }] : p.stock <= 5 ? [{ tone: 'warning', label: bi(`只剩 ${p.stock}`, `${p.stock} left`) }] : [],
        })),
      });
    }
    if (c.req.param('objectId') === 'customers') {
      const visible = data.customers.filter((x) => customerInScope(x, actor.access));
      const managers = new Map(data.managers.map((m) => [m.id, m.name]));
      const orderCount = (id: string) => data.orders.filter((o) => o.customerId === id).length;
      const match = (x: Customer) => (filter === 'wholesale' ? x.type === 'WHOLESALE' : filter === 'retail' ? x.type === 'RETAIL' : true);
      const rows = visible.filter(match).sort((a, b) => customerName(a).localeCompare(customerName(b)));
      return c.json({
        asOf: now().toISOString(), total: rows.length,
        counts: ['wholesale', 'retail', 'all'].map((f) => ({ filter: f, count: visible.filter((x) => (f === 'wholesale' ? x.type === 'WHOLESALE' : f === 'retail' ? x.type === 'RETAIL' : true)).length })),
        rows: page(rows).map((x) => ({
          key: x.id,
          values: {
            name: customerName(x), type: CHANNEL[x.type], manager: x.managerId ? managers.get(x.managerId) ?? '' : '',
            tax: x.type === 'RETAIL' || !x.certificateValid ? bi('应税', 'Taxed') : bi('免税', 'Tax-exempt'), city: x.city, orders: orderCount(x.id),
          },
          flags: x.type === 'WHOLESALE' && x.certificateRaw.toLowerCase() === 'expired' ? [{ tone: 'warning', label: bi('证书已过期', 'Certificate expired') }] : [],
        })),
      });
    }
    return c.json({ error: 'unknown business object' }, 404);
  });

  app.get('/runtime/objects/:objectId/:key', (c) => {
    const { data, actor } = c.var;
    const customers = new Map(data.customers.map((x) => [x.id, x]));
    const products = new Map(data.products.map((x) => [x.sku, x]));
    const key = c.req.param('key');
    const asOf = now().toISOString();
    if (c.req.param('objectId') === 'orders') {
      const o = scopedOrders(data, actor.access).find((x) => x.number === key);
      if (!o) return c.json({ error: 'not found' }, 404);
      const row = orderRow(o, customers, products);
      const lineCols = [{ key: 'tea', label: bi('茶', 'Tea'), type: 'text' }, { key: 'qty', label: bi('数量', 'Qty'), type: 'number' }, { key: 'unit', label: bi('单价', 'Unit price'), type: 'money' }, { key: 'amount', label: bi('金额', 'Amount'), type: 'money' }];
      const sumCols = [{ key: 'item', label: bi('项目', 'Item'), type: 'text' }, { key: 'amount', label: bi('金额', 'Amount'), type: 'money' }];
      return c.json({
        asOf, key, values: row.values, flags: row.flags,
        sections: [
          { title: bi('明细', 'Lines'), columns: lineCols, rows: o.lines.map((l) => ({ tea: productName(products.get(l.sku), l.sku), qty: l.qty, unit: l.unitCents, amount: l.qty * l.unitCents })) },
          {
            title: bi('金额怎么算出来的', 'How the total adds up'), columns: sumCols,
            rows: [
              { item: bi('货款', 'Goods'), amount: o.goodsCents },
              ...(atLeast(revision, 'v3') ? [{ item: bi('批发折扣', 'Wholesale discount'), amount: -o.discountCents }] : []),
              { item: bi('运费', 'Shipping'), amount: o.shippingCents },
              { item: bi('税', 'Tax'), amount: o.taxCents },
              { item: bi('合计', 'Total'), amount: o.totalCents },
            ],
          },
        ],
        notes: o.imported ? [bi('这是导入的历史订单，金额按当时实际收取的记录，不按现在的规则重算。', 'This is an imported historical order; it keeps what was charged and is not repriced under today’s rules.')] : [],
      });
    }
    if (c.req.param('objectId') === 'products') {
      const p = products.get(key);
      if (!p) return c.json({ error: 'not found' }, 404);
      const open = data.orders.filter((o) => OPEN_STATUSES.includes(o.status) && o.lines.some((l) => l.sku === key));
      return c.json({
        asOf, key,
        values: { name: p.name, size: p.size, sku: p.sku, retail: p.retailCents, wholesale: p.wholesaleCents, stock: p.stock, state: productState(p) },
        sections: [{
          title: bi('等着这款茶的未发货订单', 'Unshipped orders waiting for this tea'),
          columns: [{ key: 'number', label: bi('订单号', 'Order'), type: 'text' }, { key: 'qty', label: bi('数量', 'Qty'), type: 'number' }, { key: 'status', label: bi('状态', 'Status'), type: 'status' }],
          rows: open.filter((o) => customerInScope(customers.get(o.customerId)!, actor.access)).map((o) => ({ number: o.number, qty: o.lines.filter((l) => l.sku === key).reduce((t, l) => t + l.qty, 0), status: STATUS_NAMES[o.status] })),
        }],
        notes: p.stockBlocked ? [bi(`导入时库存写的是 ${p.rawStock}，先按 0 处理并锁住，确认实际数量前不能发货。`, `The file said ${p.rawStock}; stock is held at 0 and locked until the real count is confirmed.`)] : [],
      });
    }
    if (c.req.param('objectId') === 'customers') {
      const x = customers.get(key);
      if (!x || !customerInScope(x, actor.access)) return c.json({ error: 'not found' }, 404);
      const managers = new Map(data.managers.map((m) => [m.id, m.name]));
      const own = data.orders.filter((o) => o.customerId === key).sort((a, b) => b.date.localeCompare(a.date));
      return c.json({
        asOf, key,
        values: {
          name: customerName(x), type: CHANNEL[x.type], manager: x.managerId ? managers.get(x.managerId) ?? '' : '',
          tax: x.type === 'RETAIL' || !x.certificateValid ? bi('应税', 'Taxed') : bi('免税', 'Tax-exempt'), city: x.city, orders: own.length,
        },
        sections: [{
          title: bi('订单', 'Orders'),
          columns: [{ key: 'number', label: bi('订单号', 'Order'), type: 'text' }, { key: 'date', label: bi('下单日期', 'Order date'), type: 'date' }, { key: 'status', label: bi('状态', 'Status'), type: 'status' }, { key: 'total', label: bi('金额', 'Total'), type: 'money' }],
          rows: own.map((o) => ({ number: o.number, date: o.date, status: STATUS_NAMES[o.status], total: o.totalCents })),
        }],
        notes: x.type === 'WHOLESALE' && x.certificateRaw ? [bi(`免税证书在原表里写的是“${x.certificateRaw}”。`, `The resale certificate was written as "${x.certificateRaw}".`)] : [],
      });
    }
    return c.json({ error: 'unknown business object' }, 404);
  });

  app.get('/runtime/reports/:reportId', (c) => {
    if (c.req.param('reportId') !== 'monthly_sales' || !atLeast(revision, 'v2')) return c.json({ error: 'unknown report' }, 404);
    const withDiscount = atLeast(revision, 'v3');
    return c.json({
      asOf: now().toISOString(),
      title: bi('月度销售报表', 'Monthly sales'),
      columns: [
        { key: 'month', label: bi('月份', 'Month'), type: 'text' },
        { key: 'channel', label: bi('渠道', 'Channel'), type: 'tag' },
        { key: 'orders', label: bi('订单', 'Orders'), type: 'number' },
        { key: 'goods', label: bi('货款', 'Goods'), type: 'money' },
        ...(withDiscount ? [{ key: 'discount', label: bi('折扣', 'Discount'), type: 'money' }] : []),
        { key: 'shipping', label: bi('运费', 'Shipping'), type: 'money' },
        { key: 'tax', label: bi('税', 'Tax'), type: 'money' },
        { key: 'total', label: bi('合计', 'Total'), type: 'money' },
      ],
      rows: monthlySales(c.var.data, c.var.actor.access).map((r) => ({
        month: r.month, channel: CHANNEL[r.channel], orders: r.orders, goods: r.goodsCents,
        ...(withDiscount ? { discount: r.discountCents } : {}), shipping: r.shippingCents, tax: r.taxCents, total: r.totalCents,
      })),
      basis: bi('按下单日期算月份，只算已发货和已送达的订单；取消的不算。', 'Months follow the order date; only shipped and delivered orders count, cancelled ones do not.'),
    });
  });

  app.get('/runtime/data-issues', (c) => {
    // Everyone may see the data check; only the owner decides repairs (stock and imports are admin work, §3.1).
    const decides = c.var.actor.access.kind === 'all' && !c.var.actor.access.readOnly;
    return c.json({ asOf: now().toISOString(), issues: c.var.data.issues.map((i) => ({ ...i, needsDecision: i.needsDecision && decides })) });
  });

  app.get('/runtime/activity', async (c) => c.json({ asOf: now().toISOString(), events: await repository.listActivity(20) }));

  return app;
}
