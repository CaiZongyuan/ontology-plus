import { roundHalfUp } from './metrics.js';
import type { Customer, Product, Revision } from './types.js';
import { REVISIONS } from './types.js';

export interface Quote {
  readonly goodsCents: number;
  readonly discountCents: number;
  readonly shippingCents: number;
  readonly taxCents: number;
  readonly totalCents: number;
}

/** Prices new order lines under the rules of one requirement revision (spec §3.2, §6.2). */
export function priceOrder(customer: Customer, lines: readonly { product: Product; qty: number }[], revision: Revision): Quote {
  const wholesale = customer.type === 'WHOLESALE';
  const goods = lines.reduce((t, l) => t + l.qty * (wholesale ? l.product.wholesaleCents : l.product.retailCents), 0);
  const discountOn = REVISIONS.indexOf(revision) >= REVISIONS.indexOf('v3');
  const discount = wholesale && discountOn && goods >= 100_000 ? roundHalfUp(goods, 5, 100) : 0;
  const shipping = wholesale ? 1500 : goods >= 7500 ? 0 : 795;
  const tax = wholesale && customer.certificateValid ? 0 : roundHalfUp(goods - discount, 825, 10_000);
  return { goodsCents: goods, discountCents: discount, shippingCents: shipping, taxCents: tax, totalCents: goods - discount + shipping + tax };
}
