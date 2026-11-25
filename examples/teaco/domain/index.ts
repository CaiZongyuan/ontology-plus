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
export {
  COMMAND_NAMES,
  COMMAND_NAMES_BI,
  STATUS_NAMES,
  offeredActions,
  planCommand,
  type Change,
  type CommandActor,
  type CommandErrorCode,
  type CommandName,
  type CommandPlan,
  type CommandRequest,
  type CommandTarget,
} from './commands.js';
