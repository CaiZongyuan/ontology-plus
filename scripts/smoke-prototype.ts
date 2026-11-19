import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  attachUnifiedAgentSessionLiveStream,
  listPrototypeAnchors,
  startUnifiedAgentSessionTurn,
} from '../src/packages/agent-runtime/index.js';
import {
  readPrototypeDemoTours,
  readPrototypeNotes,
  splitPrototypeDocument,
  validatePrototypeDemoTours,
} from '../src/packages/ontology-core/index.js';
import {
  createWorkspaceStore,
  type DesignBrief,
  type WorkspaceStore,
} from '../src/packages/workspace-store/index.js';

/**
 * Real-model smoke test for the live Prototype pipeline (spec #87 test decision 5, #96).
 *
 * Seeds a realistic 5-screen Requirements doc + approved Design Brief on an in-memory
 * WorkspaceStore, runs a real `PROTOTYPE_CO_DESIGN` build with concurrency 3 against
 * `zai-coding-cn` (`SMOKE_MODEL ?? 'glm-5.3-flash'`), and measures wall-clock elapsed time to:
 *   1. Build Plan (`plan_screens`) — target <= 10s
 *   2. Style Tile started (`define_style` stream start) — target <= 30s
 *   3. First screen started (`upsert_prototype_screen` stream start) — target <= 60s
 *   4. Full completion (5 screens + screenshot review + Demo Tours) — target <= 300s
 *
 * The API key is read from `ZAI_CODING_CN_API_KEY` or `~/.pi/agent/auth.json` at runtime,
 * never written to disk, and redacted from any printed output.
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

function fmtSec(ms: number | null): string {
  if (ms === null) return 'N/A';
  return `${(ms / 1000).toFixed(2)}s`;
}

async function runPrototypeSmoke(
  apiKey: string,
  model: { id: string; baseUrl: string; contextWindow: number },
): Promise<void> {
  const store = configureLiveStore(apiKey, model);
  try {
    const project = store.listProjects()[0]!;
    const projectId = project.id;

    const reqDoc = store.saveRequirementDoc({
      id: 'req-doc-smoke-96',
      projectId,
      title: '烘焙连锁门店订货与退货管理需求规格',
      version: 'v1.0',
      status: 'DRAFT',
      content: [
        '# 烘焙连锁门店订货管理系统需求规格',
        '## 1. 业务目标',
        '- 让各加盟与直营门店店长高效完成每日原料订货、订单跟踪、收货验收与临期退货申请。',
        '## 2. 核心页面（5 屏）',
        '1. **门店工作台（SCR-HOME）**：展示今日待处理订货、配送中包裹、本月配额等关键指标，并提供快速下单入口。',
        '2. **订货单列表（SCR-ORDERS）**：支持按状态与客户/门店筛选历史订货单，点击行可查看详情，提供新建订货按钮。',
        '3. **新建订货单（SCR-NEW-ORDER）**：选择常用烘焙原料、调整箱数步进器，右侧实时汇总金额并提交订货单。',
        '4. **订货单详情（SCR-DETAIL）**：展示单据状态、配送进度、明细行与确认收货操作。',
        '5. **退货审批（SCR-REFUND）**：提交或审批门店损毁/临期退货申请，填写原因并执行通过或驳回。',
        '## 3. 核心角色与演示目标',
        '- 店长：首次下单订货；跟踪配送中订单；提交临期退货申请。',
      ].join('\n'),
    });
    store.confirmRequirementsStep(projectId, { docId: reqDoc.id });

    const nowIso = new Date().toISOString();
    const designBrief: DesignBrief = {
      items: [
        { id: 'b-pos', category: 'positioning', statement: '温暖克制、清晰易读的烘焙门店日常运营工作台' },
        { id: 'b-tone', category: 'tone_palette', statement: '暖纸浅底 (#fbf9f4)、纯白卡片 (#ffffff)、陶土橙主强调色 (#c2612b)' },
        { id: 'b-layout', category: 'density_layout', statement: '自适应宽度排版，桌面/平板/手机零横向溢出，表格与表单留白舒适' },
      ],
      userFeelNote: '暖纸质感、直观好点、少废话',
      styleValues: {
        mode: 'light',
        background: '#fbf9f4',
        surface: '#ffffff',
        inset: '#f2ede4',
        accent: '#c2612b',
        accentInk: '#ffffff',
        border: '#e4ddd0',
        ink: '#221c16',
        mutedInk: '#6e655a',
        ok: '#2f7d4f',
        warn: '#b46914',
        danger: '#b83b32',
        fontFamily: "system-ui, -apple-system, 'PingFang SC', 'Noto Sans SC', sans-serif",
        radiusPx: 10,
        density: 'comfortable',
      },
      approvedAt: nowIso,
      updatedAt: nowIso,
    };

    const session = store.createAgentSession({
      projectId,
      agentKind: 'PROTOTYPE_CO_DESIGN',
      title: '烘焙门店订货原型 · 真实冒烟',
      multiAgentConcurrency: 3,
      designBrief,
    });

    const prompt = [
      '【已确认设计简报 · 生成首版可交互原型 Revision #1】',
      '请按以下 5 屏需求构建烘焙连锁门店订货管理系统首版原型：',
      '1. 先调用 `plan_screens` 列出 5 屏施工计划（SCR-HOME 门店工作台、SCR-ORDERS 订货单列表、SCR-NEW-ORDER 新建订货单、SCR-DETAIL 订货单详情、SCR-REFUND 退货审批）。',
      '2. 再调用 `define_style` 使用已锁定的暖纸色板定义共用组件样式并画出风格样张。',
      '3. 然后调用 `spawn_subagents` 并行构建这 5 屏（每屏 80~150 行紧凑 HTML，带真实 data-element-id、data-element-type、data-note 原型说明与 data-navigate-to 跳转）。',
      '4. 所有屏完成后调用 `write_demo_tours` 编写 2~3 条可播放的演示路线。',
    ].join('\n');

    console.log(`[smoke:prototype] model=${model.id} concurrency=3 screens=5`);
    const t0 = Date.now();
    let tPlanReadyMs: number | null = null;
    let tStyleStartMs: number | null = null;
    let tFirstScreenStartMs: number | null = null;
    let tDoneMs: number | null = null;

    await startUnifiedAgentSessionTurn(
      store,
      {
        sessionId: session.id,
        prompt,
        prototypeName: '烘焙门店订货原型 (Smoke)',
        designBrief,
        multiAgentConcurrency: 3,
        mockMode: false,
        locale: 'zh-CN',
      },
      { awaitCompletion: false },
    );

    let streamError: string | null = null;
    for await (const ev of attachUnifiedAgentSessionLiveStream(store, session.id)) {
      const elapsed = Date.now() - t0;
      if (ev.event === 'tool_delta' || ev.event === 'tool_call') {
        const toolName = String(ev.data.toolName ?? '');
        if (toolName === 'define_style' && tStyleStartMs === null) {
          tStyleStartMs = elapsed;
          console.log(`  [${fmtSec(elapsed)}] define_style stream started`);
        }
        if (toolName === 'upsert_prototype_screen' && tFirstScreenStartMs === null) {
          tFirstScreenStartMs = elapsed;
          console.log(`  [${fmtSec(elapsed)}] first screen tool_call started`);
        }
      } else if (ev.event === 'tool_result') {
        const trace = ev.data.trace as { toolName?: string } | undefined;
        if (trace?.toolName === 'plan_screens' && tPlanReadyMs === null) {
          tPlanReadyMs = elapsed;
          console.log(`  [${fmtSec(elapsed)}] plan_screens committed`);
        }
      } else if (ev.event === 'prototype_screen') {
        if (tFirstScreenStartMs === null) {
          tFirstScreenStartMs = elapsed;
          console.log(`  [${fmtSec(elapsed)}] first prototype_screen delta (${String(ev.data.screenId ?? '')})`);
        }
      } else if (ev.event === 'prototype_style') {
        if (tStyleStartMs === null) {
          tStyleStartMs = elapsed;
          console.log(`  [${fmtSec(elapsed)}] style phase started`);
        }
      } else if (ev.event === 'prototype_phase') {
        const phase = String(ev.data.phase ?? '');
        const status = String(ev.data.status ?? '');
        if (phase === 'style' && status === 'now' && tStyleStartMs === null) {
          tStyleStartMs = elapsed;
          console.log(`  [${fmtSec(elapsed)}] style phase started`);
        }
      } else if (ev.event === 'prototype_plan') {
        const screens = (ev.data.screens as unknown[] | undefined) ?? [];
        if (screens.length > 0 && tPlanReadyMs === null) {
          tPlanReadyMs = elapsed;
          console.log(`  [${fmtSec(elapsed)}] Build Plan ready (${screens.length} screens)`);
        }
      } else if (ev.event === 'run_error') {
        streamError = redactSecret(String(ev.data.message ?? 'unknown error'), apiKey);
      }
    }
    tDoneMs = Date.now() - t0;

    const finalSession = store.getAgentSession(session.id)!;
    const protos = store.listPrototypes(projectId);
    const createdProto = protos[0];
    const split = createdProto ? splitPrototypeDocument(createdProto.htmlContent) : { screens: [] };
    const readyScreens = split.screens.filter((s) => s.status === 'ready');
    const tours = createdProto ? readPrototypeDemoTours(createdProto.htmlContent) : [];
    const notes = createdProto ? readPrototypeNotes(createdProto.htmlContent) : [];
    const anchors = createdProto ? listPrototypeAnchors(createdProto.htmlContent) : { screens: [] };
    const tourCheck = createdProto
      ? validatePrototypeDemoTours(createdProto.htmlContent, tours)
      : { ok: false, issues: [{ message: 'no prototype saved' }] };

    console.log('\n## Smoke Timing & Quality Report\n');
    console.log(`| Stage | Measured | Target | Status |`);
    console.log(`|---|---:|---:|---|`);
    console.log(
      `| Build Plan (\`plan_screens\`) | ${fmtSec(tPlanReadyMs)} | <= 10.00s | ${tPlanReadyMs !== null && tPlanReadyMs <= 10_000 ? 'PASS' : 'MISS'} |`,
    );
    console.log(
      `| Style Tile started (\`define_style\`) | ${fmtSec(tStyleStartMs)} | <= 30.00s | ${tStyleStartMs !== null && tStyleStartMs <= 30_000 ? 'PASS' : 'MISS'} |`,
    );
    console.log(
      `| First screen started | ${fmtSec(tFirstScreenStartMs)} | <= 60.00s | ${tFirstScreenStartMs !== null && tFirstScreenStartMs <= 60_000 ? 'PASS' : 'MISS'} |`,
    );
    console.log(
      `| Full completion (5 screens + review + tours) | ${fmtSec(tDoneMs)} | <= 300.00s | ${tDoneMs <= 300_000 ? 'PASS' : 'MISS'} |`,
    );
    console.log('');
    console.log(`- Session status: ${finalSession.status}`);
    console.log(`- Ready screens: ${readyScreens.length}/${split.screens.length} (${readyScreens.map((s) => s.screenId).join(', ')})`);
    console.log(`- Anchored screens: ${anchors.screens.length}, Prototype Notes: ${notes.length}`);
    console.log(`- Demo Tours: ${tours.length} (validation: ${tourCheck.ok ? 'VALID' : `INVALID (${tourCheck.issues.length} issues)`})`);
    if (!tourCheck.ok) {
      for (const issue of tourCheck.issues) {
        console.log(`  - Tour issue: ${JSON.stringify(issue)}`);
      }
    }
    if (streamError) {
      console.error(`- Stream error: ${streamError}`);
    }

    const problems: string[] = [];
    if (finalSession.status === 'ERROR') problems.push(`session ERROR: ${streamError ?? 'unknown'}`);
    if (readyScreens.length < 5) problems.push(`expected 5 ready screens, got ${readyScreens.length}`);
    if (tours.length < 2) problems.push(`expected >= 2 Demo Tours, got ${tours.length}`);
    if (!tourCheck.ok) problems.push(`demo tour validation failed (${tourCheck.issues.length} issues)`);

    if (problems.length > 0) {
      console.error(`\nFAIL: ${problems.join('; ')}`);
      process.exitCode = 1;
    } else {
      console.log('\nPASS: 5-screen prototype + Demo Tours completed cleanly.');
    }
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  const apiKey = resolveApiKey();
  const model = resolveModel();
  try {
    await runPrototypeSmoke(apiKey, model);
  } catch (error: unknown) {
    const raw = error instanceof Error ? error.message : String(error);
    console.error(`FAIL: ${redactSecret(raw, apiKey)}`);
    process.exitCode = 1;
  }
}

void main();
