import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
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

  it('survives client SSE disconnect during REQUIREMENT SRS synthesis Agent Run and reattaches via /live', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
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

    const createSessRes = await app.request('/api/agent-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: coffeeProject.id,
        agentKind: 'REQUIREMENT',
        targetId: reqSession.id,
        title: '咖啡店 SRS 合成会话',
      }),
    });
    expect(createSessRes.status).toBe(200);
    const { session: createdSess } = (await createSessRes.json()) as {
      session: { id: string };
    };

    // Start SRS synthesis stream, read initial event, then immediately abort client SSE connection!
    const clientAbort = new AbortController();
    const sseRes = await app.request(`/api/agent-sessions/${createdSess.id}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: `[ACTION:SYNTHESIZE_SRS {"requirementSessionId":"${reqSession.id}"}]\n合成 9 章节需求规格书`,
        mockMode: true,
      }),
      signal: clientAbort.signal,
    });
    expect(sseRes.status).toBe(200);
    const reader = sseRes.body!.getReader();
    const firstRead = await reader.read();
    const firstText = new TextDecoder().decode(firstRead.value);
    expect(firstText).toContain('event: session_meta');
    clientAbort.abort();

    // Reattach via GET /api/agent-sessions/:id/live (simulating page refresh) and consume until completion
    const liveRes = await app.request(`/api/agent-sessions/${createdSess.id}/live`);
    expect(liveRes.status).toBe(200);
    const liveText = await liveRes.text();
    expect(liveText).toContain('event: message_end');

    const docs = store.listRequirementDocs(coffeeProject.id);
    expect(docs.length).toBe(1);
    expect(docs[0]!.status).toBe('CONFIRMED');
    expect(docs[0]!.content).toContain('## 1.');
    expect(docs[0]!.content).toContain('## 9.');
    expect(docs[0]!.content).toContain('### 9.7');

    // Reopening via /api/bootstrap hydrates completed REQUIREMENT session with REQUIREMENT_DOC artifact
    const bootRes = await app.request(`/api/bootstrap?projectId=${coffeeProject.id}`);
    const bootJson = (await bootRes.json()) as {
      requirementDocs: { id: string; status: string }[];
      agentSessions: {
        id: string;
        status: string;
        messages: { artifacts?: { kind: string; docId?: string }[] }[];
      }[];
    };
    expect(bootJson.requirementDocs.length).toBe(1);
    const hydratedSession = bootJson.agentSessions.find((s) => s.id === createdSess.id)!;
    expect(hydratedSession.status).toBe('IDLE');
    expect(
      hydratedSession.messages
        .flatMap((m) => m.artifacts ?? [])
        .some((a) => a.kind === 'REQUIREMENT_DOC' && a.docId === docs[0]!.id),
    ).toBe(true);
  });

  it('executes all 6 migrated actions as session Agent Runs, supports abort/continue, and retires legacy one-shot routes', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    const app = createApiApp(store);

    // 1. All retired pipeline-tasks & synchronous/streaming one-shot HTTP routes return 404
    const retiredRoutes = [
      '/api/pipeline-tasks',
      '/api/projects/proj-contract/prototypes/generate',
      '/api/projects/proj-contract/copilot',
      '/api/projects/proj-contract/copilot/stream',
      '/api/requirements/req-sess-contract-01/synthesize-doc',
      '/api/requirements/req-sess-contract-01/synthesize-doc/stream',
      '/api/projects/proj-contract/prototypes/synthesize-ontology',
      '/api/assets/generate-tech-arch',
      '/api/analytics/metrics/MET-02/insight',
      '/api/analytics/scenarios/ascn-01/attribute',
    ];
    for (const route of retiredRoutes) {
      const res = await app.request(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
    }

    // Helper to create session and run stream
    const runSessionAction = async (
      projectId: string,
      agentKind: 'REQUIREMENT' | 'COPILOT' | 'CODING' | 'REASONING',
      prompt: string,
    ) => {
      const sessRes = await app.request('/api/agent-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, agentKind, title: `${agentKind} Test` }),
      });
      const { session } = (await sessRes.json()) as { session: { id: string } };
      const streamRes = await app.request(`/api/agent-sessions/${session.id}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, mockMode: true }),
      });
      expect(streamRes.status).toBe(200);
      const sseText = await streamRes.text();
      expect(sseText).toContain('event: artifact');
      expect(sseText).toContain('event: message_end');
      return session.id;
    };

    // 3. 11-Model Ontology Synthesis + Copilot rule mutation on a fresh EMPTY project with prototype
    const srmProj = store.createProject({
      name: '仓储波次拣货系统',
      code: 'WMS_WAVE',
      domain: '智能仓储作业',
      template: 'EMPTY',
    });
    const wmsProto = store.createPrototype(srmProj.id, {
      name: '波次拣货看板',
      htmlContent:
        '<section data-screen-id="SCR-WAVE-BOARD" data-screen-name="波次调度台"><input data-element-id="EL-WAVE-NO" data-binding="PickingWave.waveNo" /><button data-element-id="EL-DISPATCH" data-event-id="EVT-WAVE-DISPATCHED">下发波次</button></section>',
      source: 'GENERATED',
    });
    store.confirmPrototypeRevision(srmProj.id, wmsProto.revision.id);

    await runSessionAction(
      srmProj.id,
      'COPILOT',
      `[ACTION:SYNTHESIZE_ONTOLOGY_SUITE {"prototypeId":"${wmsProto.prototype.id}"}]\n合成 11 模型`,
    );
    expect(store.getProject(srmProj.id)!.validation.presentModels).toHaveLength(11);
    expect(store.getProject(srmProj.id)!.validation.errorCount).toBe(0);

    await runSessionAction(
      'proj-contract',
      'COPILOT',
      '请新增一条跨境大额合同双签审批规则',
    );
    expect(store.getProject('proj-contract')!.validation.errorCount).toBe(0);

    // 4. Tech Arch Generation in CODING session
    const assetsBefore = store.listFourLayerAssets().length;
    await runSessionAction(
      'proj-contract',
      'CODING',
      '[ACTION:GENERATE_TECH_ARCH {"name":"WMS 云原生四层技术架构","stackTags":["TypeScript","Hono","D1"]}]\n生成技术架构规范',
    );
    expect(store.listFourLayerAssets().length).toBe(assetsBefore + 1);

    // 5. Metric Insight & Scenario Attribution in REASONING session
    await runSessionAction(
      'proj-contract',
      'REASONING',
      '[ACTION:METRIC_INSIGHT {"metricId":"MET-02"}]\n生成指标波动洞察',
    );
    const reportsBefore = store.listAnalyticsReports().length;
    await runSessionAction(
      'proj-contract',
      'REASONING',
      '[ACTION:SCENARIO_ATTRIBUTION {"scenarioId":"ascn-01","saveAsReport":true}]\n执行场景归因并归档报告',
    );
    expect(store.listAnalyticsReports().length).toBe(reportsBefore + 1);
  });

  it('preserves incremental DRAFT requirement doc when upstream LLM stream drops mid-SRS-run and never fabricates template results on gateway failure', async () => {
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
    const reqSess = store.createRequirementSession({
      projectId: proj.id,
      title: '烘焙需求探索',
      initialPrompt: '支持现烤出炉批次排程与临期报损管理',
    });
    const agentSess = store.createAgentSession({
      projectId: proj.id,
      agentKind: 'REQUIREMENT',
      targetId: reqSess.id,
      title: '烘焙 SRS 合成会话',
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
                  `data: ${JSON.stringify({ id: 'chatcmpl-drop-1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: partialMarkdown }, finish_reason: null }] })}\n\n`,
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

    const streamRes = await app.request(`/api/agent-sessions/${agentSess.id}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: `[ACTION:SYNTHESIZE_SRS {"requirementSessionId":"${reqSess.id}"}]\n合成 9 章节需求规格书`,
        mockMode: false,
      }),
    });
    const rawSse = await streamRes.text();
    expect(rawSse).toContain('event: run_error');

    const savedDocs = store.listRequirementDocs(proj.id);
    expect(savedDocs.length).toBe(1);
    expect(savedDocs[0]!.status).toBe('DRAFT');
    expect(savedDocs[0]!.content).toContain('现烤烘焙门店');

    // Now simulate HTTP 502 Bad Gateway on a CODING Tech Arch run: must emit run_error and create ZERO assets
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Bad Gateway', { status: 502 })),
    );
    const codingSess = store.createAgentSession({
      projectId: proj.id,
      agentKind: 'CODING',
      title: '烘焙架构生成',
    });
    const assetsBefore = store.listFourLayerAssets().length;
    const archStreamRes = await app.request(`/api/agent-sessions/${codingSess.id}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '[ACTION:GENERATE_TECH_ARCH {"name":"烘焙云原生架构"}]\n生成架构',
        mockMode: false,
      }),
    });
    const archSse = await archStreamRes.text();
    expect(archSse).toContain('event: run_error');
    expect(store.listFourLayerAssets().length).toBe(assetsBefore);
    expect(store.getAgentSession(codingSess.id)?.status).toBe('ERROR');
  });

  it('runs multiple distinct Agent Sessions in parallel via /api/agent-sessions/:id/stream', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    const app = createApiApp(store);

    const reqSess = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'REQUIREMENT',
      title: '并行需求探索会话',
    });
    const codingSess = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'CODING',
      title: '并行编码规范会话',
    });

    const [reqRes, codingRes] = await Promise.all([
      app.request(`/api/agent-sessions/${reqSess.id}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: '确认：大额跨境合同需财务总监复核',
          mockMode: true,
        }),
      }),
      app.request(`/api/agent-sessions/${codingSess.id}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: '[ACTION:GENERATE_TECH_ARCH {"name":"并行技术架构资产","stackTags":["TypeScript","Hono"]}]\n生成技术架构',
          mockMode: true,
        }),
      }),
    ]);

    expect(reqRes.status).toBe(200);
    expect(codingRes.status).toBe(200);
    const [reqSse, codingSse] = await Promise.all([reqRes.text(), codingRes.text()]);
    expect(reqSse).toContain('event: message_end');
    expect(codingSse).toContain('event: artifact');
    expect(codingSse).toContain('event: message_end');
  });

  it('replaces synchronous /refine with PROTOTYPE_CO_DESIGN session anchored edits + /live SSE attach', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    const app = createApiApp(store);

    const bootRes = await app.request('/api/bootstrap');
    const bootJson = (await bootRes.json()) as {
      activeProject: { id: string };
      prototypes: { id: string; version: string; htmlContent: string }[];
    };
    const projectId = bootJson.activeProject.id;
    const protoId = bootJson.prototypes[0]!.id;
    const beforeHtml = bootJson.prototypes[0]!.htmlContent;

    // 1. Legacy synchronous /refine endpoint is removed (404)
    const legacyRefineRes = await app.request(
      `/api/projects/${projectId}/prototypes/${protoId}/refine`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: '增加按钮' }),
      },
    );
    expect(legacyRefineRes.status).toBe(404);

    // 2. Ensure PROTOTYPE_CO_DESIGN session for prototype
    const coDesignRes = await app.request(
      `/api/projects/${projectId}/prototypes/${protoId}/co-design-session`,
      { method: 'POST' },
    );
    expect(coDesignRes.status).toBe(200);
    const coDesignJson = (await coDesignRes.json()) as {
      session: { id: string; agentKind: string; targetId?: string };
      prototype: { id: string; coDesignSessionId?: string };
    };
    expect(coDesignJson.session.agentKind).toBe('PROTOTYPE_CO_DESIGN');
    expect(coDesignJson.session.targetId).toBe(protoId);
    expect(coDesignJson.prototype.coDesignSessionId).toBe(coDesignJson.session.id);

    // 3. Stream anchored refinement targeting SCR-CONTRACT-APPROVAL / EL-BTN-APPROVE
    const streamRes = await app.request(
      `/api/agent-sessions/${coDesignJson.session.id}/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt:
            '--- 用户在界面原型上框选/点选的目标区域与批注 ---\n#1 [ELEMENT] selector="button[data-element-id=\\"EL-BTN-APPROVE\\"]" (screen=SCR-CONTRACT-APPROVAL, element=EL-BTN-APPROVE)\n   Note: 在此处增加法务退回重审按钮\n\n在此处增加法务退回重审按钮',
          mockMode: true,
        }),
      },
    );
    expect(streamRes.status).toBe(200);
    const sseText = await streamRes.text();
    expect(sseText).toContain('read_prototype_anchor');
    expect(sseText).toContain('edit_prototype_anchor');
    expect(sseText).toContain('PROTOTYPE_REVISION');

    const updatedProto = store.getPrototype(protoId)!;
    expect(updatedProto.revisions).toHaveLength(2);
    expect(updatedProto.revisions[1]!.source).toBe('AGENT_RUN');

    // Untouched prefix before SCR-CONTRACT-APPROVAL stayed byte-for-byte identical
    const approvalStart = beforeHtml.indexOf('data-screen-id="SCR-CONTRACT-APPROVAL"');
    expect(approvalStart).toBeGreaterThan(0);
    expect(updatedProto.htmlContent.slice(0, approvalStart)).toBe(
      beforeHtml.slice(0, approvalStart),
    );

    // 4. GET /api/agent-sessions/:id/live returns snapshot SSE frame cleanly
    const liveRes = await app.request(`/api/agent-sessions/${coDesignJson.session.id}/live`);
    expect(liveRes.status).toBe(200);
    const liveText = await liveRes.text();
    expect(liveText).toContain('event: message_end');
  });

  it('serves two-tier prototype revision REST APIs, enforces 409 deletion guard on Confirmed Revision, and compiles Dev Package from Confirmed Revision', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    const projectId = 'proj-contract';

    const beforeMu = JSON.stringify(store.getProject(projectId)!.suite.MU);

    // 1. GET /api/projects/:id/prototypes returns seeded prototype + confirmedRevision
    const listRes = await app.request(`/api/projects/${projectId}/prototypes`);
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as {
      prototypes: { id: string; isConfirmed: boolean; htmlContent: string }[];
      confirmedRevision: { prototypeId: string; revisionId: string } | null;
    };
    expect(listJson.confirmedRevision?.prototypeId).toBe('proto-contract-v1');
    expect(listJson.prototypes[0]!.isConfirmed).toBe(true);
    const baseContractHtml = listJson.prototypes[0]!.htmlContent;

    // 2. Deleting confirmed prototype returns HTTP 409 PROTOTYPE_HOLDS_CONFIRMED_REVISION
    const blockedDel = await app.request(
      `/api/prototypes/proto-contract-v1?projectId=${projectId}`,
      {
        method: 'DELETE',
      },
    );
    expect(blockedDel.status).toBe(409);
    const blockedJson = (await blockedDel.json()) as { error: string; code: string };
    expect(blockedJson.code).toBe('PROTOTYPE_HOLDS_CONFIRMED_REVISION');
    expect(blockedJson.error).toBeTruthy();

    // 3. Create new prototype + append revision WITHOUT syncing suite.MU
    const confirmedRev1Html = `${baseContractHtml}\n<!-- CONFIRMED_MARKER_REV1 --><section data-screen-id="SCR-DUAL-SIGN" data-screen-name="双栏会签工作台"><button data-element-id="EL-SIGN-NOW" data-element-type="BUTTON">立即会签</button></section>`;
    const createRes = await app.request(`/api/projects/${projectId}/prototypes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '新视觉方向：双栏会签工作台',
        htmlContent: confirmedRev1Html,
        title: '首版双栏会签布局',
      }),
    });
    expect(createRes.status).toBe(200);
    const createdJson = (await createRes.json()) as {
      prototype: { id: string; currentRevisionId: string; isConfirmed: boolean };
    };
    expect(createdJson.prototype.isConfirmed).toBe(false);
    expect(JSON.stringify(store.getProject(projectId)!.suite.MU)).toBe(beforeMu);

    const newProtoId = createdJson.prototype.id;
    const rev1Id = createdJson.prototype.currentRevisionId;

    const appendRes = await app.request(`/api/prototypes/${newProtoId}/revisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        htmlContent:
          '<!-- UNCONFIRMED_EXPERIMENT_REV2 --><section data-screen-id="SCR-EXP-DRAFT" data-screen-name="未确认草稿屏"></section>',
        instruction: '尝试激进单屏布局实验',
      }),
    });
    expect(appendRes.status).toBe(200);
    const appendedJson = (await appendRes.json()) as {
      revision: { id: string; revisionNumber: number };
    };
    expect(appendedJson.revision.revisionNumber).toBe(2);
    expect(JSON.stringify(store.getProject(projectId)!.suite.MU)).toBe(beforeMu);

    // 4. Rename & star revision 1
    const patchRes = await app.request(`/api/prototypes/${newProtoId}/revisions/${rev1Id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '已评审双栏定稿', starred: true }),
    });
    expect(patchRes.status).toBe(200);
    const patchedJson = (await patchRes.json()) as {
      revision: { title: string; starred?: boolean };
    };
    expect(patchedJson.revision.title).toBe('已评审双栏定稿');
    expect(patchedJson.revision.starred).toBe(true);

    // 5. Confirm revision 1 -> updates ONLY suite.MU and moves Confirmed Revision to rev1Id
    const confirmRes = await app.request(`/api/projects/${projectId}/prototypes/confirm-revision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revisionId: rev1Id }),
    });
    expect(confirmRes.status).toBe(200);
    const confirmJson = (await confirmRes.json()) as {
      confirmedRevision: { prototypeId: string; revisionId: string };
      project: {
        suite: { MU?: { screens: { screenId: string }[] } };
        validation: { errorCount: number };
      };
    };
    expect(confirmJson.confirmedRevision.prototypeId).toBe(newProtoId);
    expect(confirmJson.confirmedRevision.revisionId).toBe(rev1Id);
    expect(confirmJson.project.suite.MU?.screens.map((s) => s.screenId)).toContain('SCR-DUAL-SIGN');
    expect(confirmJson.project.validation.errorCount).toBe(0);

    // 6. Restore revision 1 -> appends revision 3 while keeping rev1Id as Confirmed Revision
    const restoreRes = await app.request(
      `/api/prototypes/${newProtoId}/revisions/${rev1Id}/restore`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(restoreRes.status).toBe(200);
    const restoreJson = (await restoreRes.json()) as {
      revision: { revisionNumber: number; restoredFromRevisionId?: string };
      confirmedRevision: { revisionId: string } | null;
    };
    expect(restoreJson.revision.revisionNumber).toBe(3);
    expect(restoreJson.revision.restoredFromRevisionId).toBe(rev1Id);
    expect(restoreJson.confirmedRevision?.revisionId).toBe(rev1Id);

    // Append unconfirmed rev 4 with distinct marker to prove package.zip reads Confirmed Revision (rev1Id)!
    await app.request(`/api/prototypes/${newProtoId}/revisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        htmlContent:
          '<!-- UNCONFIRMED_REV4 --><section data-screen-id="SCR-REV4" data-screen-name="未确认修订4"></section>',
        title: '未确认修订4',
      }),
    });

    const zipRes = await app.request('/api/applications/app-contract-clm/package.zip');
    expect(zipRes.status).toBe(200);
    const zipBytes = new Uint8Array(await zipRes.arrayBuffer());
    const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
    let offset = 0;
    let extractedProtoHtml = '';
    while (offset + 30 <= zipBytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
      const method = view.getUint16(offset + 8, true);
      const compSize = view.getUint32(offset + 18, true);
      const nameLen = view.getUint16(offset + 26, true);
      const extraLen = view.getUint16(offset + 28, true);
      const entryName = new TextDecoder().decode(
        zipBytes.subarray(offset + 30, offset + 30 + nameLen),
      );
      const dataStart = offset + 30 + nameLen + extraLen;
      const compSlice = zipBytes.subarray(dataStart, dataStart + compSize);
      if (entryName === '参考资料/界面原型.html') {
        const rawBytes = method === 8 ? inflateRawSync(compSlice) : compSlice;
        extractedProtoHtml = new TextDecoder().decode(rawBytes);
        break;
      }
      offset = dataStart + compSize;
    }
    expect(extractedProtoHtml).toContain('CONFIRMED_MARKER_REV1');
    expect(extractedProtoHtml).not.toContain('UNCONFIRMED_REV4');
    expect(extractedProtoHtml).not.toContain('UNCONFIRMED_EXPERIMENT_REV2');

    // Now old seed prototype no longer holds Confirmed Revision and CAN be deleted!
    const okDel = await app.request(`/api/prototypes/proto-contract-v1?projectId=${projectId}`, {
      method: 'DELETE',
    });
    expect(okDel.status).toBe(200);
  });

  it('isolates SQLite database and file mirror into ONTOLOGY_WORKSPACE_ROOT when createWorkspaceStore() is called without arguments', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onto-isolated-store-'));
    const prevRoot = process.env.ONTOLOGY_WORKSPACE_ROOT;
    const prevDb = process.env.ONTOLOGY_DB_PATH;
    try {
      process.env.ONTOLOGY_WORKSPACE_ROOT = tmpDir;
      delete process.env.ONTOLOGY_DB_PATH;
      const isolatedStore = createWorkspaceStore();
      expect(isolatedStore.listProjects().length).toBeGreaterThanOrEqual(2);
      expect(fs.existsSync(path.join(tmpDir, 'onto-cs.db'))).toBe(true);
    } finally {
      if (prevRoot === undefined) delete process.env.ONTOLOGY_WORKSPACE_ROOT;
      else process.env.ONTOLOGY_WORKSPACE_ROOT = prevRoot;
      if (prevDb === undefined) delete process.env.ONTOLOGY_DB_PATH;
      else process.env.ONTOLOGY_DB_PATH = prevDb;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
