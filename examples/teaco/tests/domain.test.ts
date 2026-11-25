import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { monthlySales, normalizeSeed, parseMoneyCents, parseSourceDate, priceOrder, shopMetrics, type Dataset } from '../domain/index.js';

const seedDir = fileURLToPath(new URL('../../../benchmark/datasets/bb-seed0/', import.meta.url));
export function loadSeed0(): Dataset {
  const read = (f: string) => readFileSync(seedDir + f, 'utf8');
  return normalizeSeed({ customersCsv: read('customers.csv'), productsCsv: read('products.csv'), orderLinesCsv: read('order_lines.csv') });
}

describe('importing bb-seed0 (spec §4.2, §4.3)', () => {
  const data = loadSeed0();

  it('lands on the published counts', () => {
    expect([data.customers.length, data.products.length, data.orders.length]).toEqual([142, 60, 110]);
    expect(data.customers.filter((c) => c.type === 'WHOLESALE').length).toBe(38);
    expect(data.managers.map((m) => [m.id, data.customers.filter((c) => c.managerId === m.id).length])).toEqual([['priya', 13], ['jonah', 14], ['carlos', 11]]);
    expect(data.customers.filter((c) => c.certificateValid).length).toBe(27);
    expect(data.customers.filter((c) => c.name === 'Maria Lopez').length).toBe(2);
    const counts = Object.fromEntries(['NEW', 'PAID', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED'].map((s) => [s, data.orders.filter((o) => o.status === s).length]));
    expect(counts).toEqual({ NEW: 16, PAID: 12, PACKED: 6, SHIPPED: 14, DELIVERED: 52, CANCELLED: 10 });
  });

  it('keeps what was charged and leaves stock alone (BB 20) and locks the negative stock (BB 18)', () => {
    const o1006 = data.orders.find((o) => o.number === '1006')!;
    expect([o1006.lines.length, o1006.goodsCents, o1006.shippingCents, o1006.taxCents, o1006.totalCents]).toEqual([3, 141120, 1500, 0, 142620]);
    expect(data.products.find((p) => p.sku === 'HRB-HIBISC-4OZ')!.stock).toBe(91);
    const pep = data.products.find((p) => p.sku === 'HRB-PEPMNT-2OZ')!;
    expect([pep.stock, pep.rawStock, pep.stockBlocked]).toEqual([0, -2, true]);
    expect(data.issues.filter((i) => i.needsDecision).map((i) => i.id)).toEqual(['negative-stock-HRB-PEPMNT-2OZ']);
  });

  it('reads the month-first slash dates instead of quarantining them (DQ-08)', () => {
    expect(data.orders.find((o) => o.number === '1104')!.date).toBe('2026-09-08');
    expect(parseSourceDate('09/08/2026')!.date).toBe('2026-09-08');
    expect(parseSourceDate('2/3/26')!.date).toBe('2026-02-03');
    expect(parseSourceDate('07-Jan-2026')!.date).toBe('2026-01-07');
    expect(parseSourceDate('31/01/2026')).toBeNull();
    expect(data.issues.some((i) => i.id === 'orders-quarantined')).toBe(false);
  });

  it('computes the dashboard figures per scope (BB 8, 9)', () => {
    expect(shopMetrics(data, { kind: 'all', readOnly: false })).toEqual({
      openOrders: 34, backorderedOrders: 0, shippedOrders: 66, shippedSalesCents: 2433827, shippedTaxCents: 77187, averageShippedOrderCents: 36876,
    });
    expect(shopMetrics(data, { kind: 'manager', managerId: 'jonah' }).openOrders).toBe(3);
  });

  it('builds the March report and Jonah’s scoped copy (BB 27–29)', () => {
    const march = monthlySales(data, { kind: 'all', readOnly: false }).filter((r) => r.month === '2026-03');
    expect(march.map((r) => [r.channel, r.orders, r.goodsCents, r.shippingCents, r.taxCents, r.totalCents])).toEqual([
      ['RETAIL', 5, 51250, 2385, 4228, 57863],
      ['WHOLESALE', 5, 467880, 7500, 0, 475380],
    ]);
    const all = monthlySales(data, { kind: 'all', readOnly: false });
    expect(all.reduce((t, r) => t + r.totalCents, 0)).toBe(2433827);
    expect(monthlySales(data, { kind: 'manager', managerId: 'jonah' }).filter((r) => r.month === '2026-03').map((r) => [r.channel, r.orders, r.totalCents])).toEqual([['WHOLESALE', 2, 249840]]);
  });

  it('prices new orders per revision (BB 21, 22, 30–32)', () => {
    const cust = (company: string, name?: string) => data.customers.find((c) => (name ? c.name === name : c.company === company))!;
    const prod = (sku: string) => data.products.find((p) => p.sku === sku)!;
    const amanda = cust('', 'Amanda Bennett');
    expect(priceOrder(amanda, [{ product: prod('BLK-ASSAM-4OZ'), qty: 2 }, { product: prod('OOL-TIEGUA-4OZ'), qty: 1 }], 'v1')).toEqual({ goodsCents: 6050, discountCents: 0, shippingCents: 795, taxCents: 499, totalCents: 7344 });
    expect(priceOrder(cust('Cedar Grove Gift Shop'), [{ product: prod('BLK-ASSAM-4OZ'), qty: 12 }], 'v1').totalCents).toBe(15529);
    expect(priceOrder(cust('Cedar Grove Gift Shop'), [{ product: prod('HRB-ROOIBO-1LB'), qty: 90 }], 'v3')).toEqual({ goodsCents: 112500, discountCents: 5625, shippingCents: 1500, taxCents: 8817, totalCents: 117192 });
    expect(priceOrder(cust('Blue Door Cafe'), [{ product: prod('HRB-ROOIBO-1LB'), qty: 80 }], 'v3').totalCents).toBe(96500);
    expect(priceOrder(cust('Blue Door Cafe'), [{ product: prod('HRB-ROOIBO-1LB'), qty: 79 }], 'v3').totalCents).toBe(100250);
    expect(priceOrder(amanda, [{ product: prod('HRB-ROOIBO-1LB'), qty: 48 }], 'v3').totalCents).toBe(109116);
  });

  it('parses money without floating point', () => {
    expect([parseMoneyCents('$148.00'), parseMoneyCents('1,240.5'), parseMoneyCents('7.95'), parseMoneyCents('abc')]).toEqual([14800, 124050, 795, null]);
  });
});
