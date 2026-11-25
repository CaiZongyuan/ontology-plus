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
  COMMAND_NAMES,
  COMMAND_NAMES_BI,
  offeredActions,
  planCommand,
  type CommandName,
} from '../domain/index.js';
import type { TeacoRepository } from './db.js';

/**
 * TeaCo's side of connection contract v1 (spec v0.3.1 §11.3). It follows the public contract
 * only and imports nothing from Ontology Plus. Reads are filtered by the Acting Identity sent in
 * `X-Ontology-Plus-Actor`; the runtime interface is meant to listen on loopback.
 */
export interface TeacoRuntimeOptions {
  readonly repository: TeacoRepository;
  /** The requirement version in use until another one is activated (then the database decides). */
  readonly revision: Revision;
  readonly now?: () => Date;
}

const PROTOCOL = 'ontology-plus-connect/1';
const ACTOR_HEADER = 'X-Ontology-Plus-Actor';
/** Reads (and previews of changes) as a staged version, without putting it in use (spec §10.6). */
const RELEASE_HEADER = 'X-Ontology-Plus-Release';
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

/** What each version changes, in the shop's words; shown by Ontology Plus as the application's notes. */
const RELEASE_NOTES: Record<Revision, Bilingual[]> = {
  v1: [bi('客户、商品、订单和经营概览；发货时扣库存，缺货不能发货', 'Customers, teas, orders and the overview; stock is taken at shipping and backordered orders cannot ship')],
  v2: [bi('新增「月度销售报表」：按下单月份分零售、批发，看订单数、货款、运费、税和合计；只算已发货和已送达，不含取消的订单', 'Adds the monthly sales report: per order month, retail and wholesale apart — orders, goods, shipping, tax and total; only shipped and delivered orders, not cancelled ones')],
  v3: [
    bi('批发订单货款满 $1,000 打 95 折，税按折后货款算，运费不变；零售不参加', 'Wholesale goods of $1,000 or more get 5% off; tax is on the discounted goods; shipping is unchanged; retail is not included'),
    bi('已有订单不按新规则重算', 'Existing orders are not repriced'),
  ],
  v4: [
    bi('新增订单状态「挂起中」：客户经理可以挂起自己客户还没发货的订单，只有店主能解除', 'Adds the On hold order state: account managers can hold their own customers’ unshipped orders; only the owner can release them'),
    bi('挂起中的订单不能发货，仍算没发货的订单', 'Orders on hold cannot ship and still count as not shipped'),
  ],
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

export function buildManifest(data: Dataset, revision: Revision, live: Revision = revision) {
  const at = REVISIONS.indexOf(live);
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
    actions: manifestActions(revision),
    dataIssues: true,
    activity: true,
    events: true,
    releases: {
      current: live,
      previous: at > 0 ? REVISIONS[at - 1]! : null,
      available: REVISIONS.map((v) => ({ version: v, name: REVISION_NAMES[v], notes: RELEASE_NOTES[v] })),
    },
  };
}

const VERSIONED_ACTIONS: Partial<Record<CommandName, Revision>> = { hold_order: 'v4', release_order: 'v4' };

/** Approved runtime changes TeaCo offers (spec §10.1); each runs only after a person approves it. */
function manifestActions(revision: Revision) {
  const quantity = [{ key: 'quantity', label: bi('实际数量', 'Actual quantity'), type: 'number', required: true }];
  const desc: Partial<Record<CommandName, Bilingual>> = {
    ship_order: bi('库存够才发得出；还没付款或打包的会同时补记', 'Ships only with enough stock; payment and packing are recorded on the way if missing'),
    hold_order: bi('客户经理可以挂起自己客户的订单，只有店主能解除', 'Account managers hold their own customers’ orders; only the owner releases them'),
    repair_stock: bi('导入时库存写错的茶，按实际盘点修正后才能发货', 'For teas imported with impossible stock: set the counted quantity so they can ship'),
    create_order: bi('价格、运费和税由订单系统按现行规则计算', 'The order system prices it under the current rules'),
  };
  return COMMAND_NAMES.filter((id) => !VERSIONED_ACTIONS[id] || atLeast(revision, VERSIONED_ACTIONS[id]!)).map((id) => ({
    id,
    name: COMMAND_NAMES_BI[id],
    objectId: id === 'adjust_stock' || id === 'repair_stock' ? 'products' : 'orders',
    target: id === 'create_order' ? 'none' : 'record',
    params: id === 'adjust_stock' || id === 'repair_stock'
      ? quantity
      : id === 'create_order'
        ? [
            { key: 'customer', label: bi('客户', 'Customer'), type: 'object-ref', objectId: 'customers', required: true },
            { key: 'lines', label: bi('明细', 'Lines'), type: 'lines', objectId: 'products', required: true },
          ]
        : [],
    ...(desc[id] ? { description: desc[id] } : {}),
  }));
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
  const { repository } = options;
  const now = options.now ?? (() => new Date());
  const app = new Hono<{ Variables: { data: Dataset; actor: ActorDef; revision: Revision; preview: boolean } }>();
  const liveRevision = async () => (await repository.getActiveRevision()) ?? options.revision;
  /** The version a request reads: the one in use, or a staged one named in the release header. */
  const requestedRevision = (header: string | undefined): Revision | 'UNKNOWN' | null => {
    const wanted = header?.trim();
    if (!wanted) return null;
    return (REVISIONS as readonly string[]).includes(wanted) ? (wanted as Revision) : 'UNKNOWN';
  };
  const unknownRelease = bi('这个应用没有这个版本。', 'This application has no such version.');

  app.get('/', async (c) => {
    const revision = await liveRevision();
    return c.html(`<!doctype html><meta charset="utf-8"><title>TeaCo</title><body style="font-family:system-ui;padding:32px">
      <h1>TeaCo 茶叶订单系统</h1><p>需求 ${revision}：${REVISION_NAMES[revision].zh}。这是 Ontology Plus 的参考应用；接入清单在
      <a href="/.well-known/ontology-plus.json">/.well-known/ontology-plus.json</a>。</p></body>`);
  });

  app.get('/.well-known/ontology-plus.json', async (c) => {
    const live = await liveRevision();
    const wanted = requestedRevision(c.req.header(RELEASE_HEADER));
    if (wanted === 'UNKNOWN') return c.json({ error: { code: 'UNKNOWN_RELEASE', message: unknownRelease } }, 404);
    return c.json(buildManifest(await repository.loadDataset(), wanted ?? live, live));
  });

  app.use('/runtime/*', async (c, next) => {
    const data = await repository.loadDataset();
    const list = actors(data);
    const wanted = c.req.header(ACTOR_HEADER)?.trim();
    const actor = wanted ? list.find((a) => a.id === wanted) : list[0];
    if (!actor) return c.json({ error: `unknown acting identity "${wanted}"` }, 400);
    const release = requestedRevision(c.req.header(RELEASE_HEADER));
    if (release === 'UNKNOWN') return c.json({ error: { code: 'UNKNOWN_RELEASE', message: unknownRelease } }, 404);
    c.set('data', data);
    c.set('actor', actor);
    c.set('revision', release ?? (await liveRevision()));
    c.set('preview', release !== null);
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
        counts: orderFilters(c.var.revision).map((f) => ({ filter: f.id, count: scoped.filter((o) => match(o, f.id)).length })),
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
        asOf, key, values: row.values, flags: row.flags, actions: c.var.preview ? [] : offeredActions(data, actor, c.var.revision, 'orders', key),
        sections: [
          { title: bi('明细', 'Lines'), columns: lineCols, rows: o.lines.map((l) => ({ tea: productName(products.get(l.sku), l.sku), qty: l.qty, unit: l.unitCents, amount: l.qty * l.unitCents })) },
          {
            title: bi('金额怎么算出来的', 'How the total adds up'), columns: sumCols,
            rows: [
              { item: bi('货款', 'Goods'), amount: o.goodsCents },
              ...(atLeast(c.var.revision, 'v3') ? [{ item: bi('批发折扣', 'Wholesale discount'), amount: -o.discountCents }] : []),
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
        asOf, key, actions: c.var.preview ? [] : offeredActions(data, actor, c.var.revision, 'products', key),
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
    if (c.req.param('reportId') !== 'monthly_sales' || !atLeast(c.var.revision, 'v2')) return c.json({ error: 'unknown report' }, 404);
    const withDiscount = atLeast(c.var.revision, 'v3');
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
    return c.json({
      asOf: now().toISOString(),
      issues: c.var.data.issues.map(({ action, ...i }) => ({ ...i, needsDecision: i.needsDecision && decides, ...(decides && action && i.status !== 'VERIFIED' ? { action } : {}) })),
    });
  });

  app.get('/runtime/activity', async (c) => c.json({ asOf: now().toISOString(), events: await repository.listActivity(20) }));

  // ─── Approved runtime changes (spec §10.1): prepare previews, invoke commits, invocations reads back ───
  const offered = (revision: Revision) => new Set<string>(manifestActions(revision).map((a) => a.id));
  const statusFor = (code: string) => (code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' ? 404 : code === 'VERSION_CONFLICT' || code === 'IDEMPOTENCY_KEY_REUSED' ? 409 : 422);
  const readBody = async (c: { req: { json: <T>() => Promise<T> } }) =>
    c.req.json<{ target?: string; params?: Record<string, unknown>; idempotencyKey?: string; expectedVersion?: number | null }>().catch(() => ({}) as Record<string, never>);

  app.post('/runtime/actions/:actionId/prepare', async (c) => {
    const actionId = c.req.param('actionId');
    if (!offered(c.var.revision).has(actionId)) return c.json({ error: { code: 'UNKNOWN_ACTION', message: bi('这个版本没有这个操作。', 'This version does not offer that action.') } }, 404);
    const body = await readBody(c);
    const plan = planCommand(c.var.data, c.var.actor, c.var.revision, { action: actionId as CommandName, target: body.target, params: body.params });
    if (!plan.ok) return c.json({ error: { code: plan.code, message: plan.message } }, statusFor(plan.code));
    return c.json({ asOf: now().toISOString(), preview: { summary: plan.summary, effects: plan.effects, target: { key: plan.target.key, version: plan.target.version } } });
  });

  app.post('/runtime/actions/:actionId/invoke', async (c) => {
    const actionId = c.req.param('actionId');
    if (c.var.preview) {
      return c.json({ error: { code: 'PREVIEW_READ_ONLY', message: bi('还没上线的版本只能预览，不能执行改动。', 'A version that is not live can be previewed, not changed.') } }, 409);
    }
    if (!offered(c.var.revision).has(actionId)) return c.json({ error: { code: 'UNKNOWN_ACTION', message: bi('这个版本没有这个操作。', 'This version does not offer that action.') } }, 404);
    const body = await readBody(c);
    if (!body.idempotencyKey) return c.json({ error: { code: 'INVALID_PARAMS', message: bi('缺少请求编号。', 'The request key is missing.') } }, 422);
    const result = await repository.execute({
      actor: c.var.actor, revision: c.var.revision, idempotencyKey: body.idempotencyKey, expectedVersion: body.expectedVersion ?? null, at: now().toISOString(),
      request: { action: actionId as CommandName, target: body.target, params: body.params },
    });
    if (!result.ok) return c.json({ error: { code: result.code, message: result.message } }, statusFor(result.code));
    return c.json({ receipt: result.receipt, replayed: result.replayed });
  });

  // ─── Releases (spec §10.6): Ontology Plus puts a verified version in use, or goes back one ───
  app.post('/runtime/releases/:version/activate', async (c) => {
    if (c.var.actor.access.kind !== 'all' || c.var.actor.access.readOnly) {
      return c.json({ error: { code: 'FORBIDDEN', message: bi('只有店主能让新版本上线或回退。', 'Only the owner can put a version live or go back.') } }, 403);
    }
    const to = requestedRevision(c.req.param('version'));
    if (!to || to === 'UNKNOWN') return c.json({ error: { code: 'UNKNOWN_RELEASE', message: unknownRelease } }, 404);
    const from = await liveRevision();
    if (to !== from) {
      const body = await c.req.json<{ requestId?: string }>().catch(() => ({}) as { requestId?: string });
      const result = await repository.activateRevision({ to, from, at: now().toISOString(), requestId: body.requestId ?? `release-${to}-${Date.now()}` });
      if (!result.ok) return c.json({ error: { code: result.code, message: result.message } }, 409);
    }
    return c.json({ current: to, previous: from });
  });

  // ─── Events (spec §10.3): the transactional outbox, read in order from a position ───
  app.get('/runtime/events', async (c) => {
    if (c.var.actor.access.kind !== 'all') {
      return c.json({ error: { code: 'FORBIDDEN', message: bi('只有看得到全店的身份能读事件。', 'Only a whole-shop identity can read events.') } }, 403);
    }
    const after = Math.max(Number(c.req.query('after') ?? 0) || 0, 0);
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 20) || 20, 1), 100);
    const { events, cursor } = await repository.listOutbox(after, limit);
    return c.json({
      cursor: String(cursor),
      events: events.map((e) => ({ id: e.id, type: e.type, subject: e.subject, version: e.version, time: e.time, correlationId: e.correlationId, data: e.data })),
    });
  });

  app.get('/runtime/invocations/:key', async (c) => {
    const receipt = await repository.findReceipt(c.var.actor.id, c.req.param('key'));
    return receipt ? c.json({ receipt }) : c.json({ error: { code: 'NOT_FOUND', message: bi('没有这个请求编号的记录。', 'No record for that request key.') } }, 404);
  });

  return app;
}
