import {
  ConnectionError,
  type Bilingual,
  type ConnectionClient,
  type ConnectionManifest,
  type RuntimeEvent,
} from '../../application-runtime/index.js';
import type { RuntimeTaskRecord } from '../../workspace-store/index.js';
import { openConnection, type GatewayDeps, type GatewayResult } from './gateway.js';

/**
 * Events from a connected application (TeaCo spec §10.3, U-14, T8-001/002). Ontology Plus reads
 * the application's outbox from its last position; delivery is at least once, so every event id
 * is received once and a repeat does nothing. Only bound event types start work, and that work is
 * checked against the latest state before anything is put in front of a person — an event never
 * changes the application by itself.
 */
const bi = (zh: string, en: string): Bilingual => ({ zh, en });
const nowIso = (deps: GatewayDeps) => (deps.now?.() ?? new Date()).toISOString();
const MAX_PAGES = 10;

export interface PollResult {
  readonly received: number;
  readonly duplicates: number;
  readonly tasks: readonly RuntimeTaskRecord[];
}

interface ShortageItem {
  readonly sku: string;
  readonly name: Bilingual | string;
  readonly need: number;
  readonly stock: number;
  readonly locked?: boolean;
  readonly openDemand?: number;
}

/** Reads new events, records each once, and starts the task its type is bound to. */
export async function pollEvents(deps: GatewayDeps, projectId: string): Promise<GatewayResult<PollResult>> {
  const opened = await openConnection(deps, projectId, undefined);
  if (!opened.ok) return opened;
  const { client, manifest } = opened.value;
  if (!manifest.events) return { ok: true, value: { received: 0, duplicates: 0, tasks: [] } };
  // Events are shop-wide: read them as the first identity that sees the whole application.
  const reader = manifest.actors[0]!.id;
  let cursor = deps.store.getConnectedApp(projectId)?.eventCursor ?? '0';
  let received = 0;
  let duplicates = 0;
  const tasks: RuntimeTaskRecord[] = [];
  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const batch = await client.events(reader, cursor, 50);
      for (const event of batch.events) {
        if (deps.store.getRuntimeEvent(projectId, event.id)) {
          duplicates += 1;
          continue;
        }
        deps.store.saveRuntimeEvent({ projectId, eventId: event.id, type: event.type, subject: event.subject, time: event.time, receivedAt: nowIso(deps), data: event.data });
        received += 1;
        const task = await startBoundTask(deps, projectId, client, manifest, reader, event);
        if (task) tasks.push(task);
      }
      const record = deps.store.getConnectedApp(projectId);
      if (record) deps.store.saveConnectedApp({ ...record, eventCursor: batch.cursor });
      if (batch.cursor === cursor || batch.events.length === 0) break;
      cursor = batch.cursor;
    }
  } catch (err) {
    if (err instanceof ConnectionError) return { ok: false, status: 502, code: err.code, message: err.message };
    throw err;
  }
  return { ok: true, value: { received, duplicates, tasks } };
}

async function startBoundTask(
  deps: GatewayDeps,
  projectId: string,
  client: ConnectionClient,
  manifest: ConnectionManifest,
  reader: string,
  event: RuntimeEvent,
): Promise<RuntimeTaskRecord | null> {
  if (event.type !== 'StockShortage') return null;
  const id = `task-${projectId}-${event.id}`;
  if (deps.store.getRuntimeTask(id)) return null;
  const data = (event.data ?? {}) as { order?: string; items?: ShortageItem[] };
  const order = data.order ?? event.subject;
  const at = nowIso(deps);
  const base: RuntimeTaskRecord = {
    id, projectId, kind: 'STOCK_SHORTAGE', eventId: event.id, subject: order, status: 'OPEN',
    title: bi(`订单 ${order} 缺货，发不了`, `Order ${order} is short of stock and cannot ship`),
    findings: [], suggestions: [], invocationIds: [],
    log: [{ at, text: bi(`收到应用的缺货通知（${event.time.slice(0, 16).replace('T', ' ')} UTC），按最新数据核实`, `Shortage notice received from the application (${event.time.slice(0, 16).replace('T', ' ')} UTC); checked against the latest data`) }],
    createdAt: at, updatedAt: at,
  };
  return deps.store.saveRuntimeTask(await investigateShortage(base, client, manifest, reader, data.items ?? []));
}

/**
 * Re-reads every tea the notice named: an event can arrive late or twice, so only what is still
 * short now is reported, and nothing is suggested for stock that has since been refilled.
 */
async function investigateShortage(task: RuntimeTaskRecord, client: ConnectionClient, manifest: ConnectionManifest, reader: string, items: readonly ShortageItem[]): Promise<RuntimeTaskRecord> {
  const findings: Bilingual[] = [];
  const suggestions: RuntimeTaskRecord['suggestions'][number][] = [];
  const productObject = manifest.objects.find((o) => o.id === 'products');
  const adjust = manifest.actions.find((a) => a.id === 'adjust_stock');
  const repair = manifest.actions.find((a) => a.id === 'repair_stock');
  let orderOpen = true;
  try {
    const order = await client.getObject('orders', task.subject, reader);
    orderOpen = order.flags.some((f) => f.tone === 'warning' || f.tone === 'error');
  } catch (err) {
    if (!(err instanceof ConnectionError)) throw err;
    orderOpen = false;
  }
  for (const item of items) {
    let stock = item.stock;
    let locked = Boolean(item.locked);
    if (productObject) {
      try {
        const detail = await client.getObject('products', item.sku, reader);
        if (typeof detail.values.stock === 'number') stock = detail.values.stock;
        locked = detail.flags.some((f) => f.tone === 'error');
      } catch (err) {
        if (!(err instanceof ConnectionError)) throw err;
      }
    }
    if (!locked && stock >= item.need) continue;
    const demand = Math.max(item.openDemand ?? item.need, item.need);
    const name = typeof item.name === 'string' ? bi(item.name, item.name) : item.name;
    findings.push(
      locked
        ? bi(`${name.zh}：库存被锁住（等盘点确认），这张订单要 ${item.need}`, `${name.en}: stock is locked until a count is confirmed; this order needs ${item.need}`)
        : bi(`${name.zh}：这张订单要 ${item.need}，现在库存 ${stock}；所有没发货的订单一共要 ${demand}`, `${name.en}: this order needs ${item.need}, stock is ${stock}; all unshipped orders need ${demand}`),
    );
    const action = locked ? repair : adjust;
    if (action) {
      suggestions.push({
        actionId: action.id, target: item.sku, params: { quantity: demand },
        label: locked ? bi(`按盘点修正${name.zh}的库存`, `Correct ${name.en} from a count`) : bi(`把${name.zh}的库存调到 ${demand}`, `Set ${name.en} stock to ${demand}`),
      });
    }
  }
  const at = task.updatedAt;
  if (!orderOpen || findings.length === 0) {
    return {
      ...task, status: 'NO_LONGER_NEEDED', findings,
      log: [...task.log, { at, text: bi('核实时已经不缺货了（可能已补货、已发货或已取消），不需要处理', 'Checked: no longer short (restocked, shipped or cancelled); nothing to do') }],
    };
  }
  return { ...task, findings, suggestions };
}

export function listTasks(deps: GatewayDeps, projectId: string): RuntimeTaskRecord[] {
  return deps.store.listRuntimeTasks(projectId);
}

/** Records what a person did with a task: handed over to an approval, or dismissed. */
export function settleTask(deps: GatewayDeps, projectId: string, taskId: string, outcome: { readonly handedOver?: string; readonly dismiss?: boolean }): GatewayResult<RuntimeTaskRecord> {
  const task = deps.store.getRuntimeTask(taskId);
  if (!task || task.projectId !== projectId) return { ok: false, status: 404, code: 'NO_SUCH_TASK', message: 'No such task' };
  if (task.status !== 'OPEN') return { ok: false, status: 409, code: 'NOT_OPEN', message: 'The task is already settled' };
  const at = nowIso(deps);
  return {
    ok: true,
    value: deps.store.saveRuntimeTask(
      outcome.dismiss
        ? { ...task, status: 'DISMISSED', updatedAt: at, log: [...task.log, { at, text: bi('你决定先不处理', 'You chose not to act on it') }] }
        : { ...task, status: 'HANDED_OVER', invocationIds: [...task.invocationIds, outcome.handedOver ?? ''], updatedAt: at, log: [...task.log, { at, text: bi('已准备好改动，等你批准', 'A change was prepared for your approval') }] },
    ),
  };
}
