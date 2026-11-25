import type { Customer, Dataset, Order, OrderStatus, Product } from './types.js';

/** The identity a request acts as (spec §11.3): the whole shop, one account manager, or read-only finance. */
export type Scope = { readonly kind: 'all'; readonly readOnly: boolean } | { readonly kind: 'manager'; readonly managerId: string };

export const OPEN_STATUSES: readonly OrderStatus[] = ['NEW', 'PAID', 'PACKED', 'ON_HOLD'];
export const SHIPPED_STATUSES: readonly OrderStatus[] = ['SHIPPED', 'DELIVERED'];

/** Round half up of n × num / den for non-negative integers (spec §3.2). */
export const roundHalfUp = (n: number, num: number, den: number) => Math.floor((n * num * 2 + den) / (den * 2));

export function customerInScope(customer: Customer, scope: Scope): boolean {
  return scope.kind === 'all' || (customer.type === 'WHOLESALE' && customer.managerId === scope.managerId);
}

export function scopedOrders(data: Dataset, scope: Scope): Order[] {
  const visible = new Set(data.customers.filter((c) => customerInScope(c, scope)).map((c) => c.id));
  return data.orders.filter((o) => visible.has(o.customerId));
}

/** SKUs an open order cannot ship today: not enough stock, or stock still under review (R-STOCK-02, per order). */
export function shortSkus(order: Order, products: ReadonlyMap<string, Product>): string[] {
  if (!OPEN_STATUSES.includes(order.status)) return [];
  const need = new Map<string, number>();
  for (const l of order.lines) need.set(l.sku, (need.get(l.sku) ?? 0) + l.qty);
  return [...need].filter(([sku, qty]) => {
    const p = products.get(sku);
    return !p || p.stockBlocked || qty > p.stock;
  }).map(([sku]) => sku);
}

export interface ShopMetrics {
  readonly openOrders: number;
  readonly backorderedOrders: number;
  readonly shippedOrders: number;
  readonly shippedSalesCents: number;
  readonly shippedTaxCents: number;
  readonly averageShippedOrderCents: number | null;
}

/** The four dashboard figures of BB item 8, for one scope. */
export function shopMetrics(data: Dataset, scope: Scope): ShopMetrics {
  const products = new Map(data.products.map((p) => [p.sku, p]));
  const orders = scopedOrders(data, scope);
  const open = orders.filter((o) => OPEN_STATUSES.includes(o.status));
  const shipped = orders.filter((o) => SHIPPED_STATUSES.includes(o.status));
  const sales = shipped.reduce((t, o) => t + o.totalCents, 0);
  return {
    openOrders: open.length,
    backorderedOrders: open.filter((o) => shortSkus(o, products).length > 0).length,
    shippedOrders: shipped.length,
    shippedSalesCents: sales,
    shippedTaxCents: shipped.reduce((t, o) => t + o.taxCents, 0),
    averageShippedOrderCents: shipped.length ? roundHalfUp(sales, 1, shipped.length) : null,
  };
}

export interface MonthlyRow {
  readonly month: string;
  readonly channel: 'RETAIL' | 'WHOLESALE';
  readonly orders: number;
  readonly goodsCents: number;
  readonly discountCents: number;
  readonly shippingCents: number;
  readonly taxCents: number;
  readonly totalCents: number;
}

/** v2 monthly report (BB items 27–29): shipped and delivered orders by order month and channel. */
export function monthlySales(data: Dataset, scope: Scope): MonthlyRow[] {
  const customers = new Map(data.customers.map((c) => [c.id, c]));
  const rows = new Map<string, MonthlyRow>();
  for (const o of scopedOrders(data, scope)) {
    if (!SHIPPED_STATUSES.includes(o.status)) continue;
    const channel = customers.get(o.customerId)!.type;
    const key = `${o.date.slice(0, 7)}|${channel}`;
    const r = rows.get(key) ?? { month: o.date.slice(0, 7), channel, orders: 0, goodsCents: 0, discountCents: 0, shippingCents: 0, taxCents: 0, totalCents: 0 };
    rows.set(key, { ...r, orders: r.orders + 1, goodsCents: r.goodsCents + o.goodsCents, discountCents: r.discountCents + o.discountCents, shippingCents: r.shippingCents + o.shippingCents, taxCents: r.taxCents + o.taxCents, totalCents: r.totalCents + o.totalCents });
  }
  return [...rows.values()].sort((a, b) => a.month.localeCompare(b.month) || a.channel.localeCompare(b.channel));
}
