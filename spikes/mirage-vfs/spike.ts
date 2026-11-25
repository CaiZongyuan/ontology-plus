import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { AssistantEntry, createRegistry, Harness, MemoryStorage } from '@earendil-works/pi-durable';
import { CodingTools } from '@earendil-works/pi-durable/tools';
import { Mount, MountMode, RAMVFS, Workspace } from '@struktoai/mirage-node';
import { MirageExecutionEnv, mirageExtension } from '@struktoai/mirage-pi-durable';

/**
 * Mirage VFS with pi-durable 1.5.2, reproducible from this folder's lockfile (TeaCo spec §9.1,
 * ADR 0021). No language model: a deterministic faux model asks for tools, Mirage runs them.
 * Checks: a read-only mount of a TeaCo snapshot refuses writes; a writable scratch mount accepts
 * them; Pi Durable's bash tool runs inside Mirage, not on this machine.
 */
const context = BACKGROUND_CONTEXT;
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, evidence: string) => results.push([name, ok, evidence]);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

// 1. A TeaCo snapshot, written once, then mounted read-only.
const orders = readFileSync(fileURLToPath(new URL('../../benchmark/datasets/bb-seed0/order_lines.csv', import.meta.url)), 'utf8');
const snapshot = new RAMVFS();
const loader = new Workspace({ '/s': snapshot }, { mode: MountMode.WRITE });
await loader.vfs.write('/s/order_lines.csv', new TextEncoder().encode(orders));
const ws = new Workspace({ '/teaco': new Mount(snapshot, { mode: MountMode.READ }), '/work': new RAMVFS() }, { mode: MountMode.WRITE });

const lines = await ws.shell('wc -l /teaco/order_lines.csv');
check('shell reads the snapshot', text(lines.stdout).trim().startsWith(String(orders.split('\n').length - (orders.endsWith('\n') ? 1 : 0))), text(lines.stdout).trim());
const refused = await ws.shell('echo x > /teaco/order_lines.csv');
check('read-only mount refuses a write', refused.exitCode !== 0, `exit ${refused.exitCode}: ${text(refused.stderr).trim()}`);
const wrote = await ws.shell('grep -c "" /teaco/order_lines.csv > /work/count.txt && cat /work/count.txt');
check('scratch mount takes a write', wrote.exitCode === 0 && text(wrote.stdout).trim().length > 0, `count.txt = ${text(wrote.stdout).trim()}`);

// 2. Pi Durable's execution environment over the same workspace.
const env = new MirageExecutionEnv(ws, { cwd: '/' });
let streamed = '';
const execd = await env.exec('head -n 1 /teaco/order_lines.csv', { onOutput: (out: string) => { streamed += out; } }, context);
check('ExecutionEnv.exec runs in Mirage', execd.ok && execd.value.exitCode === 0 && streamed.includes('Order #,Order Date'), streamed.trim().slice(0, 60));
const writeRefused = await env.writeFile('/teaco/x.txt', 'x', context);
check('ExecutionEnv cannot write the snapshot', !writeRefused.ok, writeRefused.ok ? 'written' : String(writeRefused.error.message ?? writeRefused.error));

// 3. A Pi Durable harness, faux model, bash tool executed inside Mirage.
const faux = fauxProvider({ provider: 'faux', models: [{ id: 'spike', name: 'spike', input: ['text'], reasoning: false, contextWindow: 32000, maxTokens: 1024 }], tokensPerSecond: 100000 });
let seen = '';
faux.setResponses([
  () => fauxAssistantMessage([fauxToolCall('bash', { command: 'grep -c WHT-SILVER /teaco/order_lines.csv; ls /' })], { stopReason: 'toolUse' }),
  (ctx) => {
    const last = ctx.messages.filter((m) => m.role === 'toolResult').at(-1);
    seen = last ? last.content.filter((c): c is { type: 'text'; text: string } => c.type === 'text').map((c) => c.text).join('') : '';
    return fauxAssistantMessage([fauxText(`tool said: ${seen.trim()}`)]);
  },
]);
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(CodingTools);
registry.install(mirageExtension(ws));
const harness = await Harness.open(new MemoryStorage(), { models, registry, env: ({ cwd }) => new MirageExecutionEnv(ws, { cwd: cwd ?? '/' }) }, context);
const root = await harness.root(context, { agent: { model: { provider: 'faux', modelId: 'spike' } } });
const settled = await (await root.submit({ type: 'input', content: 'count Silver Needle lines' }, context)).wait(context);
let answer = '';
if (settled.status === 'done' && settled.type === 'input') {
  const entry = await root.commit((tx) => tx.entry(AssistantEntry, settled.answer), context);
  for (const m of entry?.model ?? []) if (m.role === 'assistant') for (const p of m.content) if (p.type === 'text') answer += p.text;
}
await harness.close(context);
check('harness bash tool ran inside Mirage', /teaco/.test(seen) && /work/.test(seen), seen.replace(/\s+/g, ' ').trim().slice(0, 80));
check('harness turn completed', settled.status === 'done' && answer.startsWith('tool said:'), answer.slice(0, 60));

for (const [name, ok, evidence] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${evidence}`);
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
