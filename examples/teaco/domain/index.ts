/** TeaCo domain: pure TypeScript with Web-standard APIs only, so it runs unchanged on Workers (spec §5.4). */
export * from './types.js';
export { parseCsv } from './csv.js';
export { normalizeSeed, parseMoneyCents, parseSourceDate, type SeedFiles } from './normalize.js';
export {
  OPEN_STATUSES,
  SHIPPED_STATUSES,
  customerInScope,
  monthlySales,
  roundHalfUp,
  scopedOrders,
  shopMetrics,
  shortSkus,
  type MonthlyRow,
  type Scope,
  type ShopMetrics,
} from './metrics.js';
export { priceOrder, type Quote } from './pricing.js';
