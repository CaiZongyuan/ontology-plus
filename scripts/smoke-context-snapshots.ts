import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectUnifiedAgentTurn } from '../src/packages/agent-runtime/index.js';
import {
  CONTEXT_ITEM_KINDS,
  createWorkspaceStore,
  type ModelCallSummary,
  type WorkspaceStore,
} from '../src/packages/workspace-store/index.js';

/**
 * Real-model smoke test for Context Snapshots (ADR 0017, #78, #84).
 * - Default (`pnpm smoke:context`): runs two REQUIREMENT turns against `zai-coding-cn` (`glm-5.3-flash`)
 *   and checks that every Model Call recorded a snapshot with provider-reported usage.
 * - `--prototype-subagents`: confirms a Requirements doc on a fresh in-memory store, creates a
 *   `PROTOTYPE_CO_DESIGN` session (`codeMode: true`, `multiAgentConcurrency: 3`), runs a real parallel
 *   `spawn_subagents` turn for 2 screens, and verifies `SUBAGENT` Model Calls, `parentCallId`,
 *   `laneLabel`, `responseToolNames`, and `usage.source === 'PROVIDER'`.
 *
 * The API key comes from `ZAI_CODING_CN_API_KEY` or `~/.pi/agent/auth.json` at run time. The store
 * is in memory, so the key is never written to a file or stdout.
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

function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join('[REDACTED]');
}

function formatCall(call: ModelCallSummary): string {
  const u = call.usage;
  const byKind = CONTEXT_ITEM_KINDS.filter((k) => call.estimate.byKind[k] > 0)
    .map((k) => `${k}≈${call.estimate.byKind[k]}`)
    .join(' ');
  const laneMeta = call.laneLabel ? ` lane="${call.laneLabel.zh}"` : '';
  const parentMeta = call.parentCallId ? ` parent=${call.parentCallId}` : '';
  const toolsMeta =
    call.responseToolNames && call.responseToolNames.length > 0
      ? ` responseTools=[${call.responseToolNames.join(', ')}]`
      : '';
  return [
    `#${call.seq} [${call.id}] ${call.purpose}${laneMeta}${parentMeta} ${call.status} ${call.model} ${call.durationMs}ms${toolsMeta}`,
    `  usage[${u.source}] prompt=${u.promptTokens} (uncached=${u.inputTokens} cacheRead=${u.cacheReadTokens} cacheWrite=${u.cacheWriteTokens}) output=${u.outputTokens}`,
    `  window=${call.contextWindow} included=${call.includedCount} excluded=${call.excludedCount}`,
    `  estimate: ${byKind}`,
  ].join('\n');
}

function configureLiveStore(
  apiKey: string,
  model: { id: string; baseUrl: string; contextWindow: number },
): WorkspaceStore {
  const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
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
  return store;
}

async function runRequirementsSmoke(
  apiKey: string,
  model: { id: string; baseUrl: string; contextWindow: number },
): Promise<void> {
  const store = configureLiveStore(apiKey, model);
  try {
    const projectId = store.listProjects()[0]!.id;
    const session = store.createAgentSession({ projectId, agentKind: 'REQUIREMENT' });
    const prompts = [
      '我想做一个采购合同管理系统，先帮我列三条最关键的需求，简短回答。',
      '再补充一条关于合同到期提醒的需求。',
    ];
    for (const prompt of prompts) {
      console.log(`\n> ${prompt}`);
      const turn = await collectUnifiedAgentTurn(store, {
        sessionId: session.id,
        prompt,
        mockMode: false,
        locale: 'zh-CN',
      });
      const reply = turn.session.messages.filter((m) => m.role === 'assistant').at(-1);
      console.log(
        `< ${redactSecret((reply?.content ?? '').slice(0, 200).replace(/\s+/g, ' '), apiKey)}…`,
      );
      console.log(`  session.tokenUsage = ${JSON.stringify(turn.session.tokenUsage)}`);
      if (turn.session.status === 'ERROR') {
        throw new Error(
          `Turn failed: ${redactSecret(reply?.errorDiagnostic?.message ?? 'unknown', apiKey)}`,
        );
      }
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
    if (!calls.some((c) => c.usage.source === 'PROVIDER')) {
      problems.push('no call carries provider-reported usage');
    }
    if (!detail.included.some((i) => i.kind === 'BUSINESS_CONTEXT')) {
      problems.push('business context was not separated');
    }
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

async function runPrototypeSubagentsSmoke(
  apiKey: string,
  model: { id: string; baseUrl: string; contextWindow: number },
): Promise<void> {
  const store = configureLiveStore(apiKey, model);
  try {
    const projectId = store.listProjects()[0]!.id;
    const reqDoc = store.saveRequirementDoc({
      id: 'req-doc-smoke-84',
      projectId,
      title: '采购合同管理精简需求说明',
      version: 'v1.0',
      status: 'DRAFT',
      content: [
        '# 采购合同管理系统需求规格',
        '## 1. 业务目标',
        '- 统一管理采购合同台账列表与多级审批详情。',
        '## 2. 核心页面',
        '- 合同台账列表页：按状态检索合同并新建合同。',
        '- 合同审批详情页：查看合同关键金额并执行审批通过或退回。',
      ].join('\n'),
    });
    store.confirmRequirementsStep(projectId, { docId: reqDoc.id });

    const session = store.createAgentSession({
      projectId,
      agentKind: 'PROTOTYPE_CO_DESIGN',
      title: '采购合同原型 · 并行子智能体冒烟',
      codeMode: true,
      multiAgentConcurrency: 3,
    });

    const prompt = [
      '请构建极简采购合同首版双屏原型（保持精炼快速完成）：',
      '1. 先调用 `init_prototype_shell` 初始化应用外壳与 2 个分屏骨架：`SCR-LEDGER`（合同台账列表页，LIST）和 `SCR-APPROVAL`（合同审批详情页，APPROVAL）；',
      '2. 紧接着务必调用 `spawn_subagents` 派生 2 个并行子智能体（roleLabel 分别为「台账设计师」和「审批设计师」），分别构建 `SCR-LEDGER` 与 `SCR-APPROVAL`；每个分屏 HTML 控制在 30～45 行以内，只放 1 个搜索框和 1～2 个带合法 `data-element-id` 与 `data-element-type` 的按钮，禁止使用 alert/confirm/prompt。',
    ].join('\n');

    console.log(`\n[Prototype Parallel Subagents Smoke · model=${model.id}]`);
    console.log(`> ${prompt.replace(/\n/g, '\n  ')}`);

    const turn = await collectUnifiedAgentTurn(store, {
      sessionId: session.id,
      prompt,
      prototypeName: '采购合同并行冒烟原型',
      codeMode: true,
      multiAgentConcurrency: 3,
      mockMode: false,
      locale: 'zh-CN',
    });

    const reply = turn.session.messages.filter((m) => m.role === 'assistant').at(-1);
    console.log(
      `< ${redactSecret((reply?.content ?? '').slice(0, 220).replace(/\s+/g, ' '), apiKey)}`,
    );
    console.log(`  session.tokenUsage = ${JSON.stringify(turn.session.tokenUsage)}`);
    console.log(
      `  persisted subagentLanes = ${JSON.stringify(
        (reply?.subagentLanes ?? []).map((l) => ({
          workerLabel: l.workerLabel.zh,
          taskTitle: l.taskTitle.zh,
          status: l.status,
        })),
      )}`,
    );

    if (turn.session.status === 'ERROR') {
      throw new Error(
        `Prototype turn failed: ${redactSecret(reply?.errorDiagnostic?.message ?? 'unknown', apiKey)}`,
      );
    }

    const calls = store.listModelCalls(projectId, session.id);
    console.log(`\nRecorded Model Calls (${calls.length}):`);
    for (const call of calls) console.log(formatCall(call));

    const turnCalls = calls.filter((c) => c.purpose === 'TURN');
    const subCalls = calls.filter((c) => c.purpose === 'SUBAGENT');
    const turnCallById = new Map(turnCalls.map((c) => [c.id, c]));

    const problems: string[] = [];
    if (subCalls.length < 2) {
      problems.push(`expected >= 2 SUBAGENT calls, got ${subCalls.length}`);
    }
    for (const sub of subCalls) {
      const parent = sub.parentCallId ? turnCallById.get(sub.parentCallId) : undefined;
      if (!parent) {
        problems.push(
          `SUBAGENT call #${sub.seq} missing valid parentCallId (${String(sub.parentCallId)})`,
        );
      } else {
        const tools = parent.responseToolNames ?? [];
        if (!tools.includes('spawn_subagents') && !tools.includes('codemode')) {
          problems.push(
            `parent call #${parent.seq} responseToolNames [${tools.join(', ')}] missing spawn_subagents/codemode`,
          );
        }
      }
      if (!sub.laneLabel?.zh || !sub.laneLabel?.en) {
        problems.push(`SUBAGENT call #${sub.seq} missing laneLabel`);
      }
    }
    if (!calls.every((c) => c.usage.source === 'PROVIDER')) {
      problems.push('not all calls carry usage.source === PROVIDER');
    }

    if (problems.length > 0) {
      console.error(`\nFAIL: ${problems.join('; ')}`);
      process.exitCode = 1;
    } else {
      console.log(
        `\nPASS: ${subCalls.length} parallel SUBAGENT Model Calls linked via parentCallId with laneLabel, responseToolNames, and PROVIDER-reported usage.`,
      );
    }
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  const apiKey = resolveApiKey();
  const model = resolveModel();
  try {
    const runProtoSubagents = process.argv.includes('--prototype-subagents');
    if (runProtoSubagents) {
      await runPrototypeSubagentsSmoke(apiKey, model);
    } else {
      await runRequirementsSmoke(apiKey, model);
    }
  } catch (error: unknown) {
    const raw = error instanceof Error ? error.message : String(error);
    console.error(`FAIL: ${redactSecret(raw, apiKey)}`);
    process.exitCode = 1;
  }
}

void main();
