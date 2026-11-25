import { OPEN_STATUSES, customerInScope, shortSkus, type Scope } from './metrics.js';
import { priceOrder } from './pricing.js';
import { REVISIONS, type Bilingual, type Dataset, type Order, type OrderStatus, type Product, type Revision } from './types.js';

/**
 * TeaCo business commands (spec §3.2, §6.2, v0.3.1 decisions). `planCommand` is pure: the same
 * plan answers "prepare" (a preview, nothing written) and "invoke" (the repository applies the
 * changes atomically after re-planning against fresh data inside its transaction).
 */
export type CommandName =
  | 'pay_order'
  | 'pack_order'
  | 'ship_order'
  | 'deliver_order'
  | 'cancel_order'
  | 'hold_order'
  | 'release_order'
  | 'adjust_stock'
  | 'repair_stock'
  | 'create_order';

export const COMMAND_NAMES: readonly CommandName[] = [
  'pay_order', 'pack_order', 'ship_order', 'deliver_order', 'cancel_order', 'hold_order', 'release_order', 'adjust_stock', 'repair_stock', 'create_order',
];

export interface CommandRequest {
  readonly action: CommandName;
  readonly target?: string | undefined;
  readonly params?: Readonly<Record<string, unknown>> | undefined;
}

export type CommandErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_TRANSITION'
  | 'BACKORDERED'
  | 'STOCK_LOCKED'
  | 'ON_HOLD'
  | 'INVALID_PARAMS'
  | 'NOT_IN_REVISION';

export type Change =
  | { readonly kind: 'order-status'; readonly number: string; readonly from: OrderStatus; readonly to: OrderStatus; readonly holdPrevious: OrderStatus | null }
  | { readonly kind: 'stock'; readonly sku: string; readonly from: number; readonly to: number; readonly unblock: boolean; readonly reason: 'SHIP' | 'ADJUST' | 'IMPORT_REPAIR'; readonly orderNumber?: string }
  | { readonly kind: 'issue'; readonly id: string; readonly status: 'VERIFIED' }
  | { readonly kind: 'create-order'; readonly order: Order };

export interface CommandTarget {
  readonly kind: 'order' | 'product' | 'none';
  readonly key: string | null;
  readonly version: number | null;
}

export type CommandPlan =
  | { readonly ok: true; readonly summary: Bilingual; readonly effects: readonly Bilingual[]; readonly changes: readonly Change[]; readonly target: CommandTarget }
  | { readonly ok: false; readonly code: CommandErrorCode; readonly message: Bilingual };

export interface CommandActor {
  readonly id: string;
  readonly access: Scope;
}

const bi = (zh: string, en: string): Bilingual => ({ zh, en });
const fail = (code: CommandErrorCode, zh: string, en: string): CommandPlan => ({ ok: false, code, message: bi(zh, en) });
const atLeast = (r: Revision, min: Revision) => REVISIONS.indexOf(r) >= REVISIONS.indexOf(min);

export const STATUS_NAMES: Record<OrderStatus, Bilingual> = {
  NEW: bi('新建', 'New'), PAID: bi('已付款', 'Paid'), PACKED: bi('已打包', 'Packed'), ON_HOLD: bi('挂起中', 'On hold'),
  SHIPPED: bi('已发货', 'Shipped'), DELIVERED: bi('已送达', 'Delivered'), CANCELLED: bi('已取消', 'Cancelled'),
};

export const COMMAND_NAMES_BI: Record<CommandName, Bilingual> = {
  pay_order: bi('记为已付款', 'Mark paid'),
  pack_order: bi('记为已打包', 'Mark packed'),
  ship_order: bi('发货', 'Ship'),
  deliver_order: bi('记为已送达', 'Mark delivered'),
  cancel_order: bi('取消订单', 'Cancel order'),
  hold_order: bi('挂起', 'Put on hold'),
  release_order: bi('解除挂起', 'Release hold'),
  adjust_stock: bi('调整库存', 'Set stock'),
  repair_stock: bi('按盘点修正库存', 'Correct stock from a count'),
  create_order: bi('下单', 'Create order'),
};

const productName = (p: Product | undefined, sku: string) => (p ? `${p.name}（${p.size}）` : sku);
const productNameEn = (p: Product | undefined, sku: string) => (p ? `${p.name} (${p.size})` : sku);
const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function isAdmin(actor: CommandActor) {
  return actor.access.kind === 'all' && !actor.access.readOnly;
}

/** Plans one command for one acting identity under one requirement revision. Pure. */
export function planCommand(data: Dataset, actor: CommandActor, revision: Revision, req: CommandRequest): CommandPlan {
  if (actor.access.kind === 'all' && actor.access.readOnly) return fail('FORBIDDEN', '财务是只读身份，不能修改任何业务数据。', 'Finance is read-only and cannot change business data.');
  const products = new Map(data.products.map((p) => [p.sku, p]));
  const customers = new Map(data.customers.map((c) => [c.id, c]));

  if (req.action === 'adjust_stock' || req.action === 'repair_stock') {
    if (!isAdmin(actor)) return fail('FORBIDDEN', '只有店主能改库存。', 'Only the owner can change stock.');
    const p = req.target ? products.get(req.target) : undefined;
    if (!p) return fail('NOT_FOUND', '没有这款茶。', 'No such tea.');
    const qty = Number(req.params?.quantity);
    if (!Number.isInteger(qty) || qty < 0) return fail('INVALID_PARAMS', '数量要填不小于 0 的整数。', 'The quantity must be a whole number of at least 0.');
    const target: CommandTarget = { kind: 'product', key: p.sku, version: p.version };
    if (req.action === 'adjust_stock') {
      if (p.stockBlocked) return fail('STOCK_LOCKED', `${productName(p, p.sku)}还有导入问题没处理，请用「按盘点修正库存」。`, `${productNameEn(p, p.sku)} still has an import problem; use "Correct stock from a count".`);
      return {
        ok: true, target,
        summary: bi(`把${productName(p, p.sku)}的库存改为 ${qty}`, `Set stock of ${productNameEn(p, p.sku)} to ${qty}`),
        effects: [bi(`库存 ${p.stock} → ${qty}`, `Stock ${p.stock} → ${qty}`), bi('记一笔库存流水，谁改的、什么时候改的都有记录', 'A stock movement records who changed it and when')],
        changes: [{ kind: 'stock', sku: p.sku, from: p.stock, to: qty, unblock: false, reason: 'ADJUST' }],
      };
    }
    if (!p.stockBlocked) return fail('INVALID_TRANSITION', `${productName(p, p.sku)}没有待修正的导入问题。`, `${productNameEn(p, p.sku)} has no import problem to correct.`);
    const issue = data.issues.find((i) => i.action?.actionId === 'repair_stock' && i.action.target === p.sku);
    return {
      ok: true, target,
      summary: bi(`按盘点把${productName(p, p.sku)}的库存改为 ${qty} 并解锁`, `Correct ${productNameEn(p, p.sku)} to ${qty} from a count and unlock it`),
      effects: [
        bi(`库存 ${p.stock} → ${qty}，可以正常发货`, `Stock ${p.stock} → ${qty}; it can ship again`),
        bi(`原始的 ${p.rawStock} 保留在导入记录里，另记一笔库存流水`, `The original ${p.rawStock} stays in the import record; a stock movement is added`),
        ...(issue ? [bi('这个数据问题会标为「已处理」', 'This data problem is marked handled')] : []),
      ],
      changes: [
        { kind: 'stock', sku: p.sku, from: p.stock, to: qty, unblock: true, reason: 'IMPORT_REPAIR' },
        ...(issue ? [{ kind: 'issue', id: issue.id, status: 'VERIFIED' } as const] : []),
      ],
    };
  }

  if (req.action === 'create_order') return planCreateOrder(data, actor, revision, req, products, customers);

  const order = req.target ? data.orders.find((o) => o.number === req.target) : undefined;
  if (!order || !customerInScope(customers.get(order.customerId)!, actor.access)) {
    return fail('NOT_FOUND', '找不到这张订单，或它不在你的范围内。', 'No such order, or it is outside your scope.');
  }
  const target: CommandTarget = { kind: 'order', key: order.number, version: order.version };
  const from = order.status;
  const step = (to: OrderStatus, extraEffects: Bilingual[] = [], holdPrevious: OrderStatus | null = null): CommandPlan => ({
    ok: true, target,
    summary: bi(`${COMMAND_NAMES_BI[req.action].zh}：订单 ${order.number}`, `${COMMAND_NAMES_BI[req.action].en}: order ${order.number}`),
    effects: [bi(`订单 ${order.number}：${STATUS_NAMES[from].zh} → ${STATUS_NAMES[to].zh}`, `Order ${order.number}: ${STATUS_NAMES[from].en} → ${STATUS_NAMES[to].en}`), ...extraEffects],
    changes: [{ kind: 'order-status', number: order.number, from, to, holdPrevious }],
  });
  const wrongState = (zh: string, en: string) => fail('INVALID_TRANSITION', `${zh}订单 ${order.number} 现在是「${STATUS_NAMES[from].zh}」。`, `${en} Order ${order.number} is ${STATUS_NAMES[from].en}.`);
  const holdBlocks = from === 'ON_HOLD' && !isAdmin(actor);

  switch (req.action) {
    case 'pay_order':
      if (from === 'ON_HOLD') return fail('ON_HOLD', `订单 ${order.number} 挂起中，解除前不能推进。`, `Order ${order.number} is on hold and cannot move until released.`);
      return from === 'NEW' ? step('PAID') : wrongState('只有新建的订单能记为已付款。', 'Only new orders can be marked paid.');
    case 'pack_order':
      if (from === 'ON_HOLD') return fail('ON_HOLD', `订单 ${order.number} 挂起中，解除前不能推进。`, `Order ${order.number} is on hold and cannot move until released.`);
      return from === 'PAID' ? step('PACKED') : wrongState('只有已付款的订单能打包。', 'Only paid orders can be packed.');
    case 'deliver_order':
      return from === 'SHIPPED' ? step('DELIVERED') : wrongState('只有已发货的订单能记为已送达。', 'Only shipped orders can be marked delivered.');
    case 'cancel_order':
      if (from === 'SHIPPED' || from === 'DELIVERED') return wrongState('已经发货的订单不能取消。', 'A shipped order cannot be cancelled.');
      if (from === 'CANCELLED') return wrongState('这张订单已经取消了。', 'This order is already cancelled.');
      if (holdBlocks) return fail('ON_HOLD', `订单 ${order.number} 挂起中，只有店主能取消或解除。`, `Order ${order.number} is on hold; only the owner can cancel or release it.`);
      return step('CANCELLED', [bi('库存不变（还没发货）', 'Stock is unchanged (nothing shipped)')]);
    case 'hold_order':
      if (!atLeast(revision, 'v4')) return fail('NOT_IN_REVISION', '「挂起」是需求 v4 才有的功能。', 'Holding orders arrives with requirement v4.');
      if (!(['NEW', 'PAID', 'PACKED'] as OrderStatus[]).includes(from)) return wrongState('只有还没发货的订单能挂起。', 'Only unshipped orders can be put on hold.');
      return step('ON_HOLD', [bi('挂起期间不能发货，仍算没发货的订单；只有店主能解除', 'While on hold it cannot ship and still counts as open; only the owner can release it')], from);
    case 'release_order':
      if (!atLeast(revision, 'v4')) return fail('NOT_IN_REVISION', '「挂起」是需求 v4 才有的功能。', 'Holding orders arrives with requirement v4.');
      if (!isAdmin(actor)) return fail('FORBIDDEN', '只有店主能解除挂起。', 'Only the owner can release a hold.');
      if (from !== 'ON_HOLD' || !order.holdPrevious) return wrongState('这张订单没有挂起。', 'This order is not on hold.');
      return step(order.holdPrevious, [bi(`回到挂起前的「${STATUS_NAMES[order.holdPrevious].zh}」`, `Back to ${STATUS_NAMES[order.holdPrevious].en}, as before the hold`)]);
    case 'ship_order': {
      if (from === 'ON_HOLD') return fail('ON_HOLD', `订单 ${order.number} 挂起中，不能发货。`, `Order ${order.number} is on hold and cannot ship.`);
      if (!(['NEW', 'PAID', 'PACKED'] as OrderStatus[]).includes(from)) return wrongState('只有还没发货的订单能发货。', 'Only unshipped orders can ship.');
      const short = shortSkus(order, products);
      if (short.length) {
        const locked = short.filter((s) => products.get(s)?.stockBlocked);
        if (locked.length) return fail('STOCK_LOCKED', `${locked.map((s) => productName(products.get(s), s)).join('、')}还有导入问题，确认库存前不能发货。`, `${locked.map((s) => productNameEn(products.get(s), s)).join(', ')} has an import problem; it cannot ship until stock is confirmed.`);
        return fail('BACKORDERED', `缺货：${short.map((s) => `${productName(products.get(s), s)}只有 ${products.get(s)?.stock ?? 0}`).join('；')}。补货后才能发货。`, `Backordered: ${short.map((s) => `${productNameEn(products.get(s), s)} has only ${products.get(s)?.stock ?? 0}`).join('; ')}. It can ship after a restock.`);
      }
      const need = new Map<string, number>();
      for (const l of order.lines) need.set(l.sku, (need.get(l.sku) ?? 0) + l.qty);
      const stockChanges: Change[] = [...need].map(([sku, qty]) => {
        const p = products.get(sku)!;
        return { kind: 'stock', sku, from: p.stock, to: p.stock - qty, unblock: false, reason: 'SHIP', orderNumber: order.number };
      });
      const skipped = from === 'NEW' ? bi('同时补记付款和打包', 'Payment and packing are recorded on the way') : from === 'PAID' ? bi('同时补记打包', 'Packing is recorded on the way') : null;
      return {
        ok: true, target,
        summary: bi(`发货：订单 ${order.number}`, `Ship order ${order.number}`),
        effects: [
          bi(`订单 ${order.number}：${STATUS_NAMES[from].zh} → 已发货`, `Order ${order.number}: ${STATUS_NAMES[from].en} → Shipped`),
          ...(skipped ? [skipped] : []),
          ...stockChanges.map((c) => c.kind === 'stock' ? bi(`${productName(products.get(c.sku), c.sku)}：库存 ${c.from} → ${c.to}`, `${productNameEn(products.get(c.sku), c.sku)}: stock ${c.from} → ${c.to}`) : bi('', '')),
          bi(`已发货销售额 +${money(order.totalCents)}`, `Shipped sales +${money(order.totalCents)}`),
        ],
        changes: [{ kind: 'order-status', number: order.number, from, to: 'SHIPPED', holdPrevious: null }, ...stockChanges],
      };
    }
    default:
      return fail('INVALID_PARAMS', '不认识这个操作。', 'Unknown action.');
  }
}

function planCreateOrder(
  data: Dataset,
  actor: CommandActor,
  revision: Revision,
  req: CommandRequest,
  products: Map<string, Product>,
  customers: Map<string, Dataset['customers'][number]>,
): CommandPlan {
  const customer = customers.get(String(req.params?.customer ?? ''));
  if (!customer || !customerInScope(customer, actor.access)) return fail('INVALID_PARAMS', '要选一位你范围内的客户。', 'Choose a customer within your scope.');
  const rawLines = Array.isArray(req.params?.lines) ? (req.params!.lines as unknown[]) : [];
  const lines = rawLines.map((l) => ({ sku: String((l as { sku?: unknown }).sku ?? ''), qty: Number((l as { qty?: unknown }).qty) }));
  if (lines.length === 0 || lines.some((l) => !products.has(l.sku) || !Number.isInteger(l.qty) || l.qty <= 0)) {
    return fail('INVALID_PARAMS', '每一行都要选一款茶，数量是正整数。', 'Each line needs a tea and a positive whole quantity.');
  }
  const quote = priceOrder(customer, lines.map((l) => ({ product: products.get(l.sku)!, qty: l.qty })), revision);
  const number = String(Math.max(0, ...data.orders.map((o) => Number(o.number) || 0)) + 1);
  const wholesale = customer.type === 'WHOLESALE';
  const order: Order = {
    number, date: String(req.params?.date ?? new Date().toISOString().slice(0, 10)), customerId: customer.id, status: 'NEW',
    lines: lines.map((l) => ({ sku: l.sku, qty: l.qty, unitCents: wholesale ? products.get(l.sku)!.wholesaleCents : products.get(l.sku)!.retailCents })),
    goodsCents: quote.goodsCents, discountCents: quote.discountCents, shippingCents: quote.shippingCents, taxCents: quote.taxCents, totalCents: quote.totalCents,
    imported: false, holdPrevious: null, version: 1,
  };
  const name = customer.company || customer.name;
  return {
    ok: true,
    target: { kind: 'none', key: null, version: null },
    summary: bi(`为 ${name} 下单（订单 ${number}）`, `Create order ${number} for ${name}`),
    effects: [
      bi(`货款 ${money(quote.goodsCents)}${quote.discountCents ? `，折扣 -${money(quote.discountCents)}` : ''}，运费 ${money(quote.shippingCents)}，税 ${money(quote.taxCents)}，合计 ${money(quote.totalCents)}`,
        `Goods ${money(quote.goodsCents)}${quote.discountCents ? `, discount -${money(quote.discountCents)}` : ''}, shipping ${money(quote.shippingCents)}, tax ${money(quote.taxCents)}, total ${money(quote.totalCents)}`),
      bi('价格由订单系统按现行规则计算并记下', 'Prices are computed by the order system under the current rules and kept'),
      bi('没发货的订单 +1；库存要到发货时才扣', 'Open orders +1; stock is taken only when it ships'),
    ],
    changes: [{ kind: 'create-order', order }],
  };
}

/** Actions worth offering on one record: allowed for this identity and state, even if stock blocks them today. */
export function offeredActions(data: Dataset, actor: CommandActor, revision: Revision, objectId: 'orders' | 'products', key: string): CommandName[] {
  const candidates: CommandName[] = objectId === 'orders'
    ? ['pay_order', 'pack_order', 'ship_order', 'deliver_order', 'cancel_order', 'hold_order', 'release_order']
    : ['adjust_stock', 'repair_stock'];
  return candidates.filter((action) => {
    const plan = planCommand(data, actor, revision, { action, target: key, params: { quantity: 0 } });
    // Shipping stays on offer while stock blocks it, so the reason can be shown; locked stock is fixed by repair, not adjust.
    return plan.ok || (action === 'ship_order' && (plan.code === 'BACKORDERED' || plan.code === 'STOCK_LOCKED'));
  });
}

export const isOpenStatus = (s: OrderStatus) => OPEN_STATUSES.includes(s);
