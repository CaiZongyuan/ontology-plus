import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceStore } from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';
import workerEntry, { type CloudflareD1Database } from './worker.js';

describe('server API & Cloudflare Worker integration', () => {
  it('serves health, bootstrap, security headers, ZIP package download, MCP SQL tools, and read-only SQL sandbox', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);

    const healthRes = await app.request('/api/health');
    expect(healthRes.status).toBe(200);
    expect(healthRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(healthRes.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');

    const bootRes = await app.request('/api/bootstrap');
    expect(bootRes.status).toBe(200);
    const bootJson = (await bootRes.json()) as {
      activeProject: { id: string; validation: { errorCount: number } };
      capabilityChatSessions: unknown[];
    };
    expect(bootJson.activeProject.id).toBe('proj-contract');
    expect(bootJson.activeProject.validation.errorCount).toBe(0);
    expect(Array.isArray(bootJson.capabilityChatSessions)).toBe(true);

    // Verify PKZIP development package HTTP download
    const zipRes = await app.request('/api/applications/app-contract-clm/package.zip');
    expect(zipRes.status).toBe(200);
    expect(zipRes.headers.get('Content-Type')).toBe('application/zip');
    const zipBuf = new Uint8Array(await zipRes.arrayBuffer());
    expect(zipBuf[0]).toBe(0x50);
    expect(zipBuf[1]).toBe(0x4b);

    // Verify read-only SQL endpoint enriches __label and blocks DDL/DML
    const sqlOk = await app.request('/api/analytics/sql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: 'SELECT contract_no, status, total_amount FROM t_contract LIMIT 3',
      }),
    });
    expect(sqlOk.status).toBe(200);
    const sqlData = (await sqlOk.json()) as { rows: Record<string, unknown>[] };
    expect(sqlData.rows.length).toBeGreaterThan(0);
    expect(sqlData.rows[0].status__label).toBeTruthy();

    const sqlBlocked = await app.request('/api/analytics/sql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: 'DROP TABLE t_contract' }),
    });
    expect(sqlBlocked.status).toBe(400);

    // Verify MCP server executes real SQLite rows on M7 query tools
    const capsRes = await app.request('/api/mcp/proj-contract/capabilities');
    const capsJson = (await capsRes.json()) as {
      tools: { name: string; sourceModel: string }[];
    };
    const m7Tool = capsJson.tools.find((t) => t.sourceModel === 'M7' && t.name.startsWith('m7_'))!;
    expect(m7Tool).toBeTruthy();

    const mcpRes = await app.request('/api/mcp/proj-contract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'q-1',
        method: 'tools/call',
        params: {
          name: m7Tool.name,
          arguments: {},
        },
      }),
    });
    expect(mcpRes.status).toBe(200);
    const mcpJson = (await mcpRes.json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(mcpJson.result.isError).toBe(false);
    expect(mcpJson.result.content[0].text).toContain('t_contract');
  });

  it('executes Cloudflare Worker fetch handler with simulated D1 binding cleanly', async () => {
    const executedQueries: string[] = [];
    const mockD1: CloudflareD1Database = {
      async exec(query: string) {
        executedQueries.push(query);
        return {};
      },
      prepare(query: string) {
        executedQueries.push(query);
        return {
          bind() {
            return this;
          },
          async run() {
            return {};
          },
          async all<T>() {
            return { results: [] as T[] };
          },
          async first<T>() {
            return null as T | null;
          },
        };
      },
    };

    const res = await workerEntry.fetch(
      new Request('https://ontology-plus.workers.dev/api/health'),
      { ONTOLOGY_DB: mockD1 },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe('ontology-plus');
    expect(executedQueries.length).toBeGreaterThan(0);
  });

  it('supports unified AgentSession SSE streaming, session fork/compact, project snapshots/restore, Skill refinement guard, and 409 reference protection', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    const app = createApiApp(store);

    // 1. Create AgentSession and stream SSE tool-loop turn
    const createSessRes = await app.request('/api/agent-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-contract',
        agentKind: 'COPILOT',
        title: 'API SSE Integration Test',
      }),
    });
    expect(createSessRes.status).toBe(200);
    const { session } = (await createSessRes.json()) as { session: { id: string } };
    expect(session.id).toBeTruthy();

    const streamRes = await app.request(`/api/agent-sessions/${session.id}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '请新增一条超额采购合同双重风控校验规则',
        activeModelCode: 'M3',
      }),
    });
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get('Content-Type')).toContain('text/event-stream');
    const sseBody = await streamRes.text();
    expect(sseBody).toContain('event: session_meta');
    expect(sseBody).toContain('event: tool_call');
    expect(sseBody).toContain('upsert_rule');
    expect(sseBody).toContain('event: tool_result');
    expect(sseBody).toContain('event: delta');
    expect(sseBody).toContain('event: message_end');

    // 2. Fork session from turn
    const forkRes = await app.request(`/api/agent-sessions/${session.id}/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Forked Copilot Branch' }),
    });
    expect(forkRes.status).toBe(200);
    const forkJson = (await forkRes.json()) as {
      session: { id: string; parentSessionId: string; messages: unknown[] };
    };
    expect(forkJson.session.parentSessionId).toBe(session.id);
    expect(forkJson.session.messages.length).toBeGreaterThanOrEqual(2);

    // 3. Project snapshot & restore
    const snapRes = await app.request('/api/projects/proj-contract/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'v1.0-baseline', note: 'Before mutation' }),
    });
    expect(snapRes.status).toBe(200);
    const { snapshot } = (await snapRes.json()) as { snapshot: { id: string } };

    const restoreRes = await app.request(
      `/api/projects/proj-contract/snapshots/${snapshot.id}/restore`,
      { method: 'POST' },
    );
    expect(restoreRes.status).toBe(200);

    // 4. 409 Reference conflict protection on referenced 4-layer asset (and ?force=1 override)
    const referencedAssetId = store.listAssembledApplications()[0]!.uiUeAssetId;
    const conflictRes = await app.request(`/api/assets/${referencedAssetId}`, {
      method: 'DELETE',
    });
    expect(conflictRes.status).toBe(409);

    const forceRes = await app.request(`/api/assets/${referencedAssetId}?force=1`, {
      method: 'DELETE',
    });
    expect(forceRes.status).toBe(200);

    // 5. Skill manual refinement flag & re-compile reset
    const existingSkill = store.listGeneratedSkills()[0]!;
    const refineRes = await app.request(`/api/skills/${existingSkill.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...existingSkill,
        skillMarkdown: `${existingSkill.skillMarkdown}\n\n## 手工补充条款\n`,
        isCustomRefined: true,
      }),
    });
    expect(refineRes.status).toBe(200);
    const refineJson = (await refineRes.json()) as { skill: { isCustomRefined: boolean } };
    expect(refineJson.skill.isCustomRefined).toBe(true);

    const recompileRes = await app.request('/api/projects/proj-contract/generate-skill', {
      method: 'POST',
    });
    expect(recompileRes.status).toBe(200);
    const recompileJson = (await recompileRes.json()) as { skill: { isCustomRefined: boolean } };
    expect(recompileJson.skill.isCustomRefined).toBe(false);
  });

  afterEach(() => {
    delete process.env.ONTOLOGY_LIVE_LLM;
    vi.unstubAllGlobals();
  });

  it('survives client SSE disconnect during durable SRS_SYNTHESIS task and streams reasoning + full content', async () => {
    process.env.ONTOLOGY_LIVE_LLM = '1';
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: false });
    for (const existing of store.listLlmProviders()) {
      store.saveLlmProvider({ ...existing, enabled: false });
    }
    store.saveLlmProvider({
      id: 'prov-test-sse',
      name: 'Test Streaming Gateway',
      providerType: 'OPENAI_COMPATIBLE',
      baseUrl: 'http://127.0.0.1:19999/v1',
      apiKey: 'sk-test-123',
      defaultModel: 'glm-5.3-flash',
      availableModels: ['glm-5.3-flash'],
      enabled: true,
    });
    const app = createApiApp(store);

    const coffeeProject = store.createProject({
      name: '咖啡店管理系统',
      code: 'COFFEE_SHOP',
      domain: '门店点单与配方库存',
      template: 'EMPTY',
    });
    const reqSession = store.createRequirementSession({
      projectId: coffeeProject.id,
      title: '咖啡店需求澄清',
      initialPrompt: '支持堂食扫码点单、杯型冰度客制化、BOM配方自动扣减咖啡豆与鲜奶库存',
    });

    const encoder = new TextEncoder();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const sseChunks = [
          `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '先梳理咖啡店订单、配方BOM与原料批次三大核心聚合根…' } }] })}\n\n`,
          `data: ${JSON.stringify({ choices: [{ delta: { content: '# 咖啡店管理系统 — 需求规格说明书\n\n## 1. 项目背景、业务目标与范围边界\n打通堂食扫码点单与配方自动扣库闭环。\n\n' } }] })}\n\n`,
          `data: ${JSON.stringify({ choices: [{ delta: { content: '## 2. 业务参与方、角色与数据权限矩阵\n- 咖啡师与店长分级授权。\n\n## 3. 核心业务对象、状态生命周期与数据字典\n- `CoffeeOrder`（点单聚合）与 `RecipeBom`（配方清单）。\n\n' } }] })}\n\n`,
          'data: [DONE]\n\n',
        ];
        const stream = new ReadableStream<Uint8Array>({
          async start(ctrl) {
            for (const ch of sseChunks) {
              await new Promise((r) => setTimeout(r, 25));
              ctrl.enqueue(encoder.encode(ch));
            }
            ctrl.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }),
    );

    const startRes = await app.request('/api/pipeline-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'SRS_SYNTHESIS',
        projectId: coffeeProject.id,
        sessionId: reqSession.id,
      }),
    });
    expect(startRes.status).toBe(200);
    const { task: startedTask } = (await startRes.json()) as { task: { id: string } };
    expect(startedTask.id).toBeTruthy();

    // Connect an SSE observer, read initial snapshot, then immediately abort client HTTP connection!
    const clientAbort = new AbortController();
    const sseRes = await app.request(`/api/pipeline-tasks/${startedTask.id}/stream`, {
      signal: clientAbort.signal,
    });
    expect(sseRes.status).toBe(200);
    const reader = sseRes.body!.getReader();
    const firstRead = await reader.read();
    const firstText = new TextDecoder().decode(firstRead.value);
    expect(firstText).toContain('event: snapshot');
    clientAbort.abort();

    // Wait for detached server task to finish despite client disconnect
    for (let i = 0; i < 30; i += 1) {
      const checkRes = await app.request(`/api/pipeline-tasks/${startedTask.id}`);
      const { task } = (await checkRes.json()) as { task: { status: string } };
      if (task.status === 'COMPLETED') break;
      await new Promise((r) => setTimeout(r, 25));
    }

    const docs = store.listRequirementDocs(coffeeProject.id);
    expect(docs.length).toBe(1);
    expect(docs[0]!.status).toBe('CONFIRMED');
    expect(docs[0]!.content).toContain('CoffeeOrder');
    expect(docs[0]!.content).toContain('## 9. ');

    // Reopening via /api/bootstrap hydrates completed task with full thinkingText, streamedText & stageLogs
    const bootRes = await app.request(`/api/bootstrap?projectId=${coffeeProject.id}`);
    const bootJson = (await bootRes.json()) as {
      requirementDocs: { id: string; status: string }[];
      pipelineTasks: {
        id: string;
        status: string;
        thinkingText?: string;
        streamedText?: string;
        stageLogs: unknown[];
      }[];
    };
    expect(bootJson.requirementDocs.length).toBe(1);
    const completedTask = bootJson.pipelineTasks.find((t) => t.id === startedTask.id)!;
    expect(completedTask.status).toBe('COMPLETED');
    expect(completedTask.thinkingText).toContain('配方BOM');
    expect(completedTask.streamedText).toContain('CoffeeOrder');
    expect(completedTask.stageLogs.length).toBeGreaterThanOrEqual(2);
    for (const log of completedTask.stageLogs as { messageZh: string }[]) {
      expect(log.messageZh).not.toContain('已思考');
    }
  });

  it('sends reasoning_effort=low and recovers automatically if upstream model exhausts tokens inside reasoning_content', async () => {
    process.env.ONTOLOGY_LIVE_LLM = '1';
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: false });
    for (const existing of store.listLlmProviders()) {
      store.saveLlmProvider({ ...existing, enabled: false });
    }
    store.saveLlmProvider({
      id: 'prov-test-reasoning-exhaust',
      name: 'Test Reasoning Gateway',
      providerType: 'OPENAI_COMPATIBLE',
      baseUrl: 'http://127.0.0.1:19998/v1',
      apiKey: 'sk-test-exhaust',
      defaultModel: 'auto/glm-5.3-flash',
      availableModels: ['auto/glm-5.3-flash'],
      enabled: true,
    });
    const app = createApiApp(store);

    const proj = store.createProject({
      name: '精品茶饮系统',
      code: 'TEA_SHOP',
      domain: '现制茶饮与原料效期管理',
      template: 'EMPTY',
    });
    const sess = store.createRequirementSession({
      projectId: proj.id,
      title: '茶饮需求探索',
      initialPrompt: '支持茶底效期预警、配方BOM自动扣减与门店订货',
    });

    const encoder = new TextEncoder();
    const fullSrsMarkdown = [
      '# 精品茶饮系统 — 软件需求规格说明书 (SRS)',
      '',
      '## 1. 项目背景、业务目标与范围边界',
      '围绕现制茶饮门店构建茶底效期监控、配方BOM原料自动扣减与门店补货全闭环。',
      '',
      '## 2. 业务参与方与角色矩阵',
      '- 调饮师、值班店长、仓配专员。',
      '',
      '## 3. 核心业务流程与关键场景',
      '顾客点单 -> 制作茶饮并按配方扣减茶底与鲜奶 -> 茶底超时自动触发报损提醒。',
      '',
      '## 4. 领域概念与数据实体（对齐 M1）',
      '- `TeaOrder`（茶饮订单）、`TeaBaseBatch`（茶底批次）、`RecipeItem`（配方明细）。',
      '',
      '## 5. 业务动作、状态流转与前置/后置契约（对齐 M2 / M3）',
      '- `brewTeaBase`、`completeTeaOrder`、`discardExpiredTeaBase`。',
      '',
      '## 6. 业务规则、计算口径与异常处理（对齐 M4）',
      '- 绿茶茶底出汤超过 4 小时禁止出杯，自动锁定批次状态。',
      '',
      '## 7. 界面屏幕规划与关键交互要求（对齐 MU）',
      '- 点单收银台、茶底效期看板、原料库存台账。',
      '',
      '## 8. 外部集成、权限审计与非功能性需求（对齐 M7）',
      '- 小程序订单回调幂等校验，效期报损留存操作人审计日志。',
      '',
      '## 9. 验收标准清单（可测试准则）',
      '- Given 茶底已超 4 小时效期，When 调饮师扫码出杯，Then 系统拦截并提示效期锁定。',
    ].join('\n');

    const capturedBodies: Record<string, unknown>[] = [];
    let callIndex = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        callIndex += 1;
        if (typeof init?.body === 'string') {
          capturedBodies.push(JSON.parse(init.body) as Record<string, unknown>);
        }
        const currentCall = callIndex;
        const stream = new ReadableStream<Uint8Array>({
          start(ctrl) {
            if (currentCall === 1) {
              // Simulate reasoning token exhaustion: only reasoning_content, zero content!
              ctrl.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '梳理茶底效期规则、配方扣减与 9 章节结构…' } }] })}\n\n`,
                ),
              );
              ctrl.enqueue(encoder.encode('data: [DONE]\n\n'));
              ctrl.close();
              return;
            }
            // Continuation retry streams the actual Markdown body
            ctrl.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: fullSrsMarkdown } }] })}\n\n`,
              ),
            );
            ctrl.enqueue(encoder.encode('data: [DONE]\n\n'));
            ctrl.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }),
    );

    const startRes = await app.request('/api/pipeline-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'SRS_SYNTHESIS',
        projectId: proj.id,
        sessionId: sess.id,
      }),
    });
    const { task: started } = (await startRes.json()) as { task: { id: string } };

    for (let i = 0; i < 40; i += 1) {
      const checkRes = await app.request(`/api/pipeline-tasks/${started.id}`);
      const { task } = (await checkRes.json()) as { task: { status: string } };
      if (task.status !== 'RUNNING') break;
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(capturedBodies.length).toBe(2);
    expect(capturedBodies[0]?.reasoning_effort).toBe('low');
    expect(capturedBodies[0]?.max_tokens).toBe(32768);

    const finalRes = await app.request(`/api/pipeline-tasks/${started.id}`);
    const { task: finalTask } = (await finalRes.json()) as {
      task: { status: string; messageZh: string; stageLogs: { messageZh: string }[] };
    };
    expect(finalTask.status).toBe('COMPLETED');
    expect(finalTask.messageZh).not.toContain('已思考');

    const docs = store.listRequirementDocs(proj.id);
    expect(docs.length).toBe(1);
    expect(docs[0]!.status).toBe('CONFIRMED');
    expect(docs[0]!.content).toContain('TeaBaseBatch');
  });

  it('preserves incremental DRAFT requirement doc when upstream LLM stream drops mid-generation', async () => {
    process.env.ONTOLOGY_LIVE_LLM = '1';
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: false });
    for (const existing of store.listLlmProviders()) {
      store.saveLlmProvider({ ...existing, enabled: false });
    }
    store.saveLlmProvider({
      id: 'prov-test-drop',
      name: 'Test Drop Gateway',
      providerType: 'OPENAI_COMPATIBLE',
      baseUrl: 'http://127.0.0.1:19999/v1',
      apiKey: 'sk-test-drop',
      defaultModel: 'glm-5.3-flash',
      availableModels: ['glm-5.3-flash'],
      enabled: true,
    });
    const app = createApiApp(store);

    const proj = store.createProject({
      name: '烘焙工坊系统',
      code: 'BAKERY',
      domain: '现烤门店运营',
      template: 'EMPTY',
    });
    const sess = store.createRequirementSession({
      projectId: proj.id,
      title: '烘焙需求探索',
      initialPrompt: '支持现烤出炉批次排程与临期报损管理',
    });

    const encoder = new TextEncoder();
    const partialMarkdown =
      '# 烘焙工坊系统 — 需求规格说明书\n\n## 1. 项目背景、业务目标与范围边界\n本项目围绕现烤烘焙门店构建出炉批次排程、原料领用、临期折扣与报损核销全链路数字化管理闭环，确保每一批次面团发酵与烘烤时效可追溯、门店库存精准受控。\n\n## 2. 业务参与方与角色矩阵\n- 烘焙师、门店店长、总部督导。\n';

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        let emittedFirst = false;
        const stream = new ReadableStream<Uint8Array>({
          pull(ctrl) {
            if (!emittedFirst) {
              emittedFirst = true;
              ctrl.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ choices: [{ delta: { content: partialMarkdown } }] })}\n\n`,
                ),
              );
              return;
            }
            ctrl.error(new Error('Simulated upstream TCP reset'));
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }),
    );

    const startRes = await app.request('/api/pipeline-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'SRS_SYNTHESIS',
        projectId: proj.id,
        sessionId: sess.id,
      }),
    });
    const { task: started } = (await startRes.json()) as { task: { id: string } };

    for (let i = 0; i < 30; i += 1) {
      const checkRes = await app.request(`/api/pipeline-tasks/${started.id}`);
      const { task } = (await checkRes.json()) as { task: { status: string } };
      if (task.status !== 'RUNNING') break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const savedDocs = store.listRequirementDocs(proj.id);
    expect(savedDocs.length).toBe(1);
    expect(savedDocs[0]!.status).toBe('DRAFT');
    expect(savedDocs[0]!.content).toContain('现烤烘焙门店');
  });

  it('resumes an interrupted PROTOTYPE_GEN task from its persisted SQLite checkpoint instead of starting from 0', async () => {
    process.env.ONTOLOGY_LIVE_LLM = '1';
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: false });
    for (const existing of store.listLlmProviders()) {
      store.saveLlmProvider({ ...existing, enabled: false });
    }
    store.saveLlmProvider({
      id: 'prov-test-proto-resume',
      name: 'Test Proto Resume Gateway',
      providerType: 'OPENAI_COMPATIBLE',
      baseUrl: 'http://127.0.0.1:19997/v1',
      apiKey: 'sk-test-proto-resume',
      defaultModel: 'auto/glm-5.3-flash',
      availableModels: ['auto/glm-5.3-flash'],
      enabled: true,
    });
    const app = createApiApp(store);

    const proj = store.createProject({
      name: '咖啡店管理系统',
      code: 'COFFEE_POS',
      domain: '精品咖啡门店运营',
      template: 'EMPTY',
    });

    const partialHtmlPrefix = [
      '<!DOCTYPE html>',
      '<html lang="zh-CN"><head><meta charset="UTF-8"><title>咖啡店管理系统</title></head><body>',
      '<section data-screen-id="SCR-POS-CASHIER" data-screen-name="点单收银台" data-screen-type="FORM" data-route="/pos" data-role-refs="ROLE-01">',
      '  <input data-element-id="EL-CUP-SIZE" data-element-name="cupSize" data-element-label="杯型" data-element-type="INPUT" data-binding="CoffeeOrder.cupSize" />',
      '  <button data-element-id="EL-SUBMIT-ORDER" data-element-name="submitBtn" data-element-label="下单结算" data-element-type="BUTTON" data-event-id="UIE-SUBMIT" data-event-name="提交订单" data-behavior-ref="BHV-01">下单</button>',
      '</section>',
      '<section data-screen-id="SCR-INVENTORY" data-screen-name="原料库存台账" data-screen-type="LIST" data-route="/inventory" data-role-refs="ROLE-01">',
      '  <table data-element-id="EL-INV-TABLE" data-element-name="invTable" data-element-label="库存列表" data-element-type="TABLE" data-source="QRY-01"><tbody><tr><td>咖啡豆</td></tr></tbody></table>',
      '</section>',
      '<script>',
      "  function addFlow(item, kind, qty) { console.info(item, kind, qty); }",
      "  addFlow('咖啡豆','扣减",
    ].join('\n');

    // Simulate a SERVER_RESTART_INTERRUPTED checkpoint saved in SQLite
    const interruptedId = 'ptask-prototype_gen-interrupted-test';
    store.saveAgentCheckpoint(
      interruptedId,
      'PIPELINE_TASK',
      JSON.stringify({
        id: interruptedId,
        kind: 'PROTOTYPE_GEN',
        projectId: proj.id,
        projectName: proj.name,
        status: 'ERROR',
        step: 3,
        phase: 'ERROR',
        messageZh: '后台生成任务因服务重启中断，请点击重试继续生成',
        messageEn: 'Background generation was interrupted by a server restart; please retry',
        errorMessage: 'SERVER_RESTART_INTERRUPTED',
        completedChapters: 2,
        thinkingChars: 0,
        streamedChars: partialHtmlPrefix.length,
        streamedText: partialHtmlPrefix,
        previewTail: partialHtmlPrefix.slice(-400),
        stageLogs: [],
        startedAt: Date.now() - 60_000,
        finishedAt: Date.now() - 5_000,
        targetView: 'req_prototype',
        unreadCompletion: false,
      }),
    );

    const encoder = new TextEncoder();
    let capturedUserPrompt = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          messages?: { role: string; content: string }[];
        };
        capturedUserPrompt = body.messages?.find((m) => m.role === 'user')?.content ?? '';
        // Upstream repeats the unfinished tail statement and closes </script></body></html>
        const continuationChunk = "addFlow('咖啡豆','扣减','-18g');\n</script>\n</body>\n</html>";
        const stream = new ReadableStream<Uint8Array>({
          start(ctrl) {
            ctrl.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: continuationChunk } }] })}\n\n`,
              ),
            );
            ctrl.enqueue(encoder.encode('data: [DONE]\n\n'));
            ctrl.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }),
    );

    const resumeRes = await app.request(`/api/pipeline-tasks/${interruptedId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: 'zh-CN' }),
    });
    expect(resumeRes.status).toBe(200);

    for (let i = 0; i < 30; i += 1) {
      const checkRes = await app.request(`/api/pipeline-tasks/${interruptedId}`);
      const { task } = (await checkRes.json()) as { task: { status: string } };
      if (task.status !== 'RUNNING') break;
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(capturedUserPrompt).toContain('已生成前序内容');
    expect(capturedUserPrompt).toContain('SCR-POS-CASHIER');

    const finalRes = await app.request(`/api/pipeline-tasks/${interruptedId}`);
    const { task: finalTask } = (await finalRes.json()) as {
      task: { status: string; streamedText: string; resultItemId?: string };
    };
    expect(finalTask.status).toBe('COMPLETED');
    expect(finalTask.resultItemId).toBeTruthy();

    const protos = store.listPrototypes(proj.id);
    expect(protos.length).toBe(1);
    expect(protos[0]!.extractedScreenCount).toBe(2);
    // Seam overlap deduplicated cleanly: no double `addFlow('咖啡豆','扣减addFlow(`!
    expect(protos[0]!.htmlContent).toContain("addFlow('咖啡豆','扣减','-18g');");
    expect(protos[0]!.htmlContent).not.toContain("扣减addFlow");
  });
});
