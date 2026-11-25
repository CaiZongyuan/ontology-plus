/** TeaCo canonical records (spec §6.1, logical). Money is integer cents. */
export type CustomerType = 'RETAIL' | 'WHOLESALE';
export type OrderStatus = 'NEW' | 'PAID' | 'PACKED' | 'ON_HOLD' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
export type Revision = 'v1' | 'v2' | 'v3' | 'v4';
export const REVISIONS: readonly Revision[] = ['v1', 'v2', 'v3', 'v4'];

export interface AccountManager {
  readonly id: string;
  readonly name: string;
}

export interface Customer {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly company: string;
  readonly type: CustomerType;
  readonly managerId: string | null;
  readonly certificateValid: boolean;
  readonly certificateRaw: string;
  readonly city: string;
  readonly state: string;
}

export interface Product {
  readonly sku: string;
  readonly name: string;
  readonly size: string;
  readonly retailCents: number;
  readonly wholesaleCents: number;
  readonly stock: number;
  /** Stock as written in the source file, kept for evidence (spec DQ-06). */
  readonly rawStock: number;
  /** Stock under review; nothing containing this product may ship until it is resolved. */
  readonly stockBlocked: boolean;
}

export interface OrderLine {
  readonly sku: string;
  readonly qty: number;
  readonly unitCents: number;
}

export interface Order {
  readonly number: string;
  readonly date: string;
  readonly customerId: string;
  readonly status: OrderStatus;
  readonly lines: readonly OrderLine[];
  readonly goodsCents: number;
  readonly discountCents: number;
  readonly shippingCents: number;
  readonly taxCents: number;
  readonly totalCents: number;
  readonly imported: boolean;
}

export type IssueStatus = 'OPEN' | 'INVESTIGATING' | 'PROPOSED' | 'APPROVED' | 'APPLIED' | 'VERIFIED' | 'DISMISSED';

export interface Bilingual {
  readonly zh: string;
  readonly en: string;
}

export interface DataIssue {
  readonly id: string;
  readonly title: Bilingual;
  readonly detail: Bilingual;
  readonly status: IssueStatus;
  readonly needsDecision: boolean;
}

export interface Dataset {
  readonly managers: readonly AccountManager[];
  readonly customers: readonly Customer[];
  readonly products: readonly Product[];
  readonly orders: readonly Order[];
  readonly issues: readonly DataIssue[];
}
