import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectUnifiedAgentTurn } from '../src/packages/agent-runtime/index.js';
import {
  CONTEXT_ITEM_KINDS,
  createWorkspaceStore,
  type ModelCallSummary,
} from '../src/packages/workspace-store/index.js';

/**
 * Real-model smoke test for Context Snapshots (ADR 0017, #78). Runs two turns against the local
 * pi agent's `zai-coding-cn` provider and checks that every Model Call recorded a snapshot with
 * provider-reported usage. Not part of CI.
 *
 * The API key comes from `ZAI_CODING_CN_API_KEY` or `~/.pi/agent/auth.json` at run time. The store
 * is in memory, so the key is never written to a file. Usage: `pnpm smoke:context`, which sets
 * `NODE_USE_ENV_PROXY=1` so Node's fetch honours `HTTPS_PROXY` the way curl does.
 */
const PROVIDER = 'zai-coding-cn';
const agentDir = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), '.pi', 'agent');

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.join(agentDir, file), 'utf8'));
  } catch {
    return undefined;
  }
}

function resolveApiKey(): string {
  const fromEnv = process.env.ZAI_CODING_CN_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const auth = readJson('auth.json') as Record<string, { key?: string }> | undefined;
  const fromPi = auth?.[PROVIDER]?.key?.trim();
  if (fromPi) return fromPi;
  throw new Error(`No API key: set ZAI_CODING_CN_API_KEY or sign in to ${PROVIDER} with pi.`);
}

function resolveModel(): { id: string; baseUrl: string; contextWindow: number } {
  const id = process.env.SMOKE_MODEL ?? 'glm-5.3-flash';
  const store = readJson('models-store.json') as
    | Record<string, { models?: { id: string; baseUrl?: string; contextWindow?: number }[] }>
    | undefined;
  const entry = store?.[PROVIDER]?.models?.find((m) => m.id === id);
  return {
    id,
    baseUrl: entry?.baseUrl ?? 'https://open.bigmodel.cn/api/coding/paas/v4',
    contextWindow: entry?.contextWindow ?? 1_000_000,
  };
}

function formatCall(call: ModelCallSummary): string {
  const u = call.usage;
  const byKind = CONTEXT_ITEM_KINDS.filter((k) => call.estimate.byKind[k] > 0)
    .map((k) => `${k}≈${call.estimate.byKind[k]}`)
    .join(' ');
  return [
    `#${call.seq} ${call.purpose} ${call.status} ${call.model} ${call.durationMs}ms`,
    `  usage[${u.source}] prompt=${u.promptTokens} (uncached=${u.inputTokens} cacheRead=${u.cacheReadTokens} cacheWrite=${u.cacheWriteTokens}) output=${u.outputTokens}`,
    `  window=${call.contextWindow} included=${call.includedCount} excluded=${call.excludedCount}`,
    `  estimate: ${byKind}`,
  ].join('\n');
}

async function main(): Promise<void> {
  const apiKey = resolveApiKey();
  const model = resolveModel();
  const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
  try {
    store.updateSystemSettings({ mockLlmMode: false });
    for (const p of store.listLlmProviders()) store.saveLlmProvider({ ...p, enabled: false });
    store.saveLlmProvider({
      id: 'smoke-zai-coding-cn',
      name: 'Z.ai Coding (smoke)',
      providerType: 'OPENAI_COMPATIBLE',
      baseUrl: model.baseUrl,
      apiKey,
      defaultModel: model.id,
      availableModels: [model.id],
      contextWindow: model.contextWindow,
      enabled: true,
    });

    const projectId = store.listProjects()[0]!.id;
    const session = store.createAgentSession({ projectId, agentKind: 'REQUIREMENT' });
    const prompts = ['我想做一个采购合同管理系统，先帮我列三条最关键的需求，简短回答。', '再补充一条关于合同到期提醒的需求。'];
    for (const prompt of prompts) {
      console.log(`\n> ${prompt}`);
      const turn = await collectUnifiedAgentTurn(store, {
        sessionId: session.id,
        prompt,
        mockMode: false,
        locale: 'zh-CN',
      });
      const reply = turn.session.messages.filter((m) => m.role === 'assistant').at(-1);
      console.log(`< ${(reply?.content ?? '').slice(0, 200).replace(/\s+/g, ' ')}…`);
      console.log(`  session.tokenUsage = ${JSON.stringify(turn.session.tokenUsage)}`);
      if (turn.session.status === 'ERROR') throw new Error(`Turn failed: ${reply?.errorDiagnostic?.message ?? 'unknown'}`);
    }

    const calls = store.listModelCalls(projectId, session.id);
    console.log(`\nModel Calls (${calls.length}):`);
    for (const call of calls) console.log(formatCall(call));

    const detail = store.getModelCall(projectId, calls[0]!.id)!;
    console.log(
      `\nFirst call items: ${detail.included.map((i) => `${i.kind}${i.label ? `:${i.label}` : ''}`).join(', ')}`,
    );

    const problems: string[] = [];
    if (calls.length === 0) problems.push('no Model Call was recorded');
    if (!calls.every((c) => c.hasDetail)) problems.push('a recent call lost its full snapshot');
    if (!calls.some((c) => c.usage.source === 'PROVIDER')) problems.push('no call carries provider-reported usage');
    if (!detail.included.some((i) => i.kind === 'BUSINESS_CONTEXT')) problems.push('business context was not separated');
    if (problems.length > 0) {
      console.error(`\nFAIL: ${problems.join('; ')}`);
      process.exitCode = 1;
    } else {
      console.log('\nPASS: every Model Call recorded a Context Snapshot with provider-reported usage.');
    }
  } finally {
    store.close();
  }
}

main().catch((error: unknown) => {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
