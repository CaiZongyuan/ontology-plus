import { parseCsv } from './csv.js';
import type { AccountManager, Customer, DataIssue, Dataset, Order, OrderLine, OrderStatus, Product } from './types.js';

/**
 * Normalises the three Business Bench seed files into TeaCo records (spec §4.2). Raw files
 * are never edited; every correction is reported as a data issue with its evidence.
 */
export interface SeedFiles {
  readonly customersCsv: string;
  readonly productsCsv: string;
  readonly orderLinesCsv: string;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/**
 * Reads the date styles this source declares (DQ-08): ISO, US month-first slashes
 * (MM/DD/YYYY and MM/DD/YY), DD-Mon-YYYY and English month names. Anything else is not guessed.
 */
export function parseSourceDate(raw: string): { date: string; style: string } | null {
  const s = raw.trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return wrap(iso(+m[1]!, +m[2]!, +m[3]!), 'YYYY-MM-DD');
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return wrap(iso(+m[3]!, +m[1]!, +m[2]!), 'MM/DD/YYYY');
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/))) return wrap(iso(2000 + +m[3]!, +m[1]!, +m[2]!), 'MM/DD/YY');
  if ((m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/))) return wrap(monthDate(m[2]!, +m[1]!, +m[3]!), 'DD-Mon-YYYY');
  if ((m = s.match(/^([A-Za-z]+) (\d{1,2}), (\d{4})$/))) return wrap(monthDate(m[1]!, +m[2]!, +m[3]!), 'Month DD, YYYY');
  if ((m = s.match(/^([A-Za-z]{3}) (\d{1,2}) (\d{4})$/))) return wrap(monthDate(m[1]!, +m[2]!, +m[3]!), 'Mon DD YYYY');
  return null;
  function wrap(date: string | null, style: string) { return date ? { date, style } : null; }
  function monthDate(name: string, d: number, y: number) {
    const idx = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
    return idx < 0 ? null : iso(y, idx + 1, d);
  }
}

/** Parses money written as "60.45", "$148.00" or "1,240.00" into integer cents without floating point. */
export function parseMoneyCents(raw: string): number | null {
  const s = raw.trim().replace(/^\$\s*/, '').replace(/,/g, '');
  const m = s.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
}

const STATUS_WORDS: Record<string, OrderStatus> = {
  new: 'NEW', paid: 'PAID', packed: 'PACKED', shipped: 'SHIPPED', delivered: 'DELIVERED', cancelled: 'CANCELLED', canceled: 'CANCELLED',
};
const VALID_CERTIFICATES = new Set(['yes', 'y', 'on file']);
const collapse = (s: string) => s.trim().replace(/\s+/g, ' ');
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

export function normalizeSeed(files: SeedFiles): Dataset {
  const issues: DataIssue[] = [];

  // ─── customers (DQ-01, DQ-02, DQ-03) ───
  const customerRows = parseCsv(files.customersCsv);
  const byEmail = new Map<string, Customer>();
  const rawRowsByEmail = new Map<string, string>();
  const managers = new Map<string, AccountManager>();
  let exactDupes = 0;
  let caseDupes = 0;
  for (const row of customerRows) {
    const email = row['Email']!.trim().toLowerCase();
    const rawKey = JSON.stringify(row);
    if (byEmail.has(email)) {
      if (rawRowsByEmail.get(email) === rawKey) exactDupes++;
      else caseDupes++;
      continue;
    }
    const type = row['Type']!.trim().toLowerCase() === 'wholesale' ? 'WHOLESALE' : 'RETAIL';
    let managerId: string | null = null;
    const managerName = collapse(row['Account Manager'] ?? '');
    if (type === 'WHOLESALE' && managerName) {
      const name = titleCase(managerName.toLowerCase());
      managerId = name.split(' ')[0]!.toLowerCase();
      if (!managers.has(managerId)) managers.set(managerId, { id: managerId, name });
    }
    const certificateRaw = (row['Resale Certificate'] ?? '').trim();
    byEmail.set(email, {
      id: `c${byEmail.size + 1}`,
      email,
      name: collapse(row['Name'] ?? ''),
      company: collapse(row['Company'] ?? ''),
      type,
      managerId,
      certificateValid: type === 'WHOLESALE' && VALID_CERTIFICATES.has(certificateRaw.toLowerCase()),
      certificateRaw,
      city: collapse(row['City'] ?? ''),
      state: collapse(row['State'] ?? ''),
    });
    rawRowsByEmail.set(email, rawKey);
  }
  const customers = [...byEmail.values()];
  const wholesale = customers.filter((c) => c.type === 'WHOLESALE');
  const expired = wholesale.filter((c) => c.certificateRaw.toLowerCase() === 'expired').length;
  const managerList = [...managers.values()];
  issues.push(
    verified('customers-dedupe',
      { zh: `客户去重：${customerRows.length} 行 → ${customers.length} 位客户`, en: `Customers de-duplicated: ${customerRows.length} rows → ${customers.length} customers` },
      { zh: `${exactDupes} 行完全重复、${caseDupes} 行只是邮箱大小写不同；同名但邮箱不同的客户是不同的人，没有合并。`, en: `${exactDupes} rows were exact duplicates and ${caseDupes} differed only in email capitals; customers with the same name but different emails are different people and were not merged.` }),
    verified('customer-types',
      { zh: '客户类型和客户经理写法统一', en: 'Customer types and account managers made consistent' },
      {
        zh: `零售 ${customers.length - wholesale.length} 位，批发 ${wholesale.length} 位；${managerList.map((m) => `${m.name} ${wholesale.filter((c) => c.managerId === m.id).length} 位`).join('、')}。`,
        en: `${customers.length - wholesale.length} retail and ${wholesale.length} wholesale customers; ${managerList.map((m) => `${m.name} ${wholesale.filter((c) => c.managerId === m.id).length}`).join(', ')}.`,
      }),
    verified('certificates',
      { zh: '免税证书识别', en: 'Resale certificates recognised' },
      {
        zh: `${wholesale.filter((c) => c.certificateValid).length} 家批发客户免税；${wholesale.filter((c) => !c.certificateValid).length} 家要交税，其中 ${expired} 家的证书写着“已过期”。`,
        en: `${wholesale.filter((c) => c.certificateValid).length} wholesale customers are tax-exempt; ${wholesale.filter((c) => !c.certificateValid).length} are taxed, ${expired} of them with a certificate written as "Expired".`,
      }),
  );

  // ─── products (DQ-04, DQ-05, DQ-06) ───
  const productRows = parseCsv(files.productsCsv);
  const products = new Map<string, Product>();
  let productDupes = 0;
  for (const row of productRows) {
    const sku = row['SKU']!.trim();
    const retail = parseMoneyCents(row['Retail Price']!);
    const whole = parseMoneyCents(row['Wholesale Price']!);
    const rawStock = Number.parseInt(row['Stock']!, 10);
    if (retail === null || whole === null || !Number.isFinite(rawStock)) {
      issues.push(open(`product-unreadable-${sku}`, { zh: `商品 ${sku} 有读不懂的价格或库存`, en: `Product ${sku} has an unreadable price or stock` }, { zh: '这一行没有导入，等你确认。', en: 'The row was not imported and awaits your review.' }));
      continue;
    }
    const product: Product = { sku, name: collapse(row['Product']!), size: collapse(row['Size']!), retailCents: retail, wholesaleCents: whole, stock: Math.max(0, rawStock), rawStock, stockBlocked: rawStock < 0 };
    const seen = products.get(sku);
    if (seen) {
      if (JSON.stringify(seen) === JSON.stringify(product)) productDupes++;
      else issues.push(open(`product-conflict-${sku}`, { zh: `商品 ${sku} 出现了两种不同的写法`, en: `Product ${sku} appears twice with different values` }, { zh: '保留了第一行，第二行等你确认。', en: 'The first row was kept; the second awaits your review.' }));
      continue;
    }
    products.set(sku, product);
  }
  const textPrices = productRows.filter((r) => /\$/.test(r['Retail Price']!) || /\$/.test(r['Wholesale Price']!)).length;
  const priciest = [...products.values()].sort((a, b) => b.retailCents - a.retailCents)[0];
  issues.push(
    verified('products-dedupe',
      { zh: `商品去重：${productRows.length} 行 → ${products.size} 款茶`, en: `Products de-duplicated: ${productRows.length} rows → ${products.size} teas` },
      { zh: `${productDupes} 行是重复的商品（包括编号末尾多了空格的那一行）。`, en: `${productDupes} rows repeated a product (including one whose code had a trailing space).` }),
    verified('prices-as-text',
      { zh: '价格统一成数字', en: 'Prices turned into numbers' },
      { zh: `${textPrices} 行的价格写成了“$148.00”这样的文字；最贵的是 ${priciest ? `${priciest.name}（${priciest.size}）` : '—'}。`, en: `${textPrices} rows wrote prices as text such as "$148.00"; the most expensive tea is ${priciest ? `${priciest.name} (${priciest.size})` : '—'}.` }),
  );
  for (const p of products.values()) {
    if (p.stockBlocked) {
      issues.push(open(`negative-stock-${p.sku}`,
        { zh: `${p.name}（${p.size}）导入时库存是 ${p.rawStock}`, en: `${p.name} (${p.size}) had stock ${p.rawStock} on import` },
        { zh: '库存不可能是负数，先按 0 处理并锁住，确认实际数量前不能发货；原始数字保留着。', en: 'Stock cannot be negative, so it is held at 0 and locked; nothing with this tea ships until you confirm the real count. The original figure is kept.' },
        true));
    }
  }

  // ─── orders (DQ-07 … DQ-11) ───
  const lineRows = parseCsv(files.orderLinesCsv);
  const groups = new Map<string, Record<string, string>[]>();
  let withoutHash = 0;
  for (const row of lineRows) {
    const rawNo = row['Order #']!.trim();
    if (!rawNo.startsWith('#')) withoutHash++;
    const no = rawNo.replace(/^#/, '');
    groups.set(no, [...(groups.get(no) ?? []), row]);
  }
  const orders: Order[] = [];
  const dateStyles = new Set<string>();
  const quarantined: string[] = [];
  for (const [no, rows] of groups) {
    const head = rows[0]!;
    const sameHeader = rows.every((r) => ['Order Date', 'Customer Email', 'Status', 'Shipping', 'Tax', 'Order Total'].every((k) => r[k]!.trim().toLowerCase() === head[k]!.trim().toLowerCase()));
    const date = parseSourceDate(head['Order Date']!);
    const status = STATUS_WORDS[head['Status']!.trim().toLowerCase()];
    const customer = byEmail.get(head['Customer Email']!.trim().toLowerCase());
    const shipping = parseMoneyCents(head['Shipping']!);
    const tax = parseMoneyCents(head['Tax']!);
    const total = parseMoneyCents(head['Order Total']!);
    const lines: OrderLine[] = rows.map((r) => ({ sku: r['SKU']!.trim(), qty: Number.parseInt(r['Qty']!, 10), unitCents: parseMoneyCents(r['Unit Price']!) ?? Number.NaN }));
    const linesOk = lines.every((l) => products.has(l.sku) && Number.isInteger(l.qty) && l.qty > 0 && Number.isInteger(l.unitCents));
    if (!sameHeader || !date || !status || !customer || shipping === null || tax === null || total === null || !linesOk) {
      quarantined.push(no);
      continue;
    }
    dateStyles.add(date.style);
    const goods = lines.reduce((t, l) => t + l.qty * l.unitCents, 0);
    if (goods + shipping + tax !== total) {
      quarantined.push(no);
      continue;
    }
    orders.push({ number: no, date: date.date, customerId: customer.id, status, lines, goodsCents: goods, discountCents: 0, shippingCents: shipping, taxCents: tax, totalCents: total, imported: true });
  }
  orders.sort((a, b) => Number(a.number) - Number(b.number));
  issues.push(
    verified('order-grouping',
      { zh: `订单明细合并：${lineRows.length} 行 → ${orders.length} 张订单`, en: `Order lines grouped: ${lineRows.length} rows → ${orders.length} orders` },
      { zh: `${withoutHash} 行的订单号前面没写 #，按同一张订单处理；运费、税和总额在每行都重复了一遍，按订单只算一次。`, en: `${withoutHash} rows wrote the order number without "#" and were grouped with their order; shipping, tax and total repeat on every line and are counted once per order.` }),
    verified('dates-and-statuses',
      { zh: '日期和状态写法统一', en: 'Dates and statuses made consistent' },
      { zh: `${dateStyles.size} 种日期写法都按「月/日/年」读取；Canceled、CANCELLED 等统一成「已取消」。`, en: `${dateStyles.size} date styles were read month-first; "Canceled", "CANCELLED" and the like became "Cancelled".` }),
    verified('history-no-restock',
      { zh: '历史订单不重复扣库存', en: 'Historical orders do not move stock' },
      { zh: '导入的已发货、已送达订单只记当时实际收的金额，不再扣库存；当前库存以商品表为准。', en: 'Imported shipped and delivered orders keep what was charged and do not take stock again; current stock is the product file’s figure.' }),
  );
  if (quarantined.length) {
    issues.push(open('orders-quarantined',
      { zh: `${quarantined.length} 张订单没有导入`, en: `${quarantined.length} orders were not imported` },
      { zh: `订单 ${quarantined.join('、')} 的日期、客户、商品或金额对不上，等你确认。`, en: `Orders ${quarantined.join(', ')} have a date, customer, product or amount that does not add up and await review.` }));
  }

  return { managers: managerList, customers, products: [...products.values()], orders, issues };
}

function verified(id: string, title: DataIssue['title'], detail: DataIssue['detail']): DataIssue {
  return { id, title, detail, status: 'VERIFIED', needsDecision: false };
}
function open(id: string, title: DataIssue['title'], detail: DataIssue['detail'], needsDecision = false): DataIssue {
  return { id, title, detail, status: 'OPEN', needsDecision };
}
