import http from 'node:http';
import { expect, test } from '@playwright/test';
import {
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
} from '../src/packages/business-vocabulary/index.js';

const CONTEXT_INSPECTOR_DRAWER_TEST_ID = 'context-inspector-drawer';

interface GatewayBody {
  messages: { role: string; content: unknown }[];
}

function sseChunk(delta: Record<string, unknown>, finish: string | null): string {
  return `data: ${JSON.stringify({
    id: 'cmpl-e2e-84',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'e2e-snapshot-model',
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
}

function usageChunk(prompt: number, completion: number, cached: number): string {
  return `data: ${JSON.stringify({
    id: 'cmpl-e2e-84',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'e2e-snapshot-model',
    choices: [],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion,
      prompt_tokens_details: { cached_tokens: cached },
    },
  })}\n\n`;
}

async function startDeterministicSubagentGateway(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const ch of req) chunks.push(ch as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as GatewayBody;
    const last = body.messages.at(-1);
    const lastText =
      typeof last?.content === 'string'
        ? last.content
        : JSON.stringify(last?.content ?? '');

    res.writeHead(200, { 'Content-Type': 'text/event-stream' });

    const screenMatch = /`(SCR-[A-Z0-9-]+)`/.exec(lastText);
    if (screenMatch) {
      const sid = screenMatch[1]!;
      const promptTokens = sid === 'SCR-LEDGER' ? 2400 : 1850;
      res.write(
        sseChunk(
          {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: `tc-sub-${sid}`,
                type: 'function',
                function: {
                  name: 'upsert_prototype_screen',
                  arguments: JSON.stringify({
                    screenId: sid,
                    screenHtml: `<div class="proto-card"><button type="button" data-element-id="EL-${sid}-CREATE" data-element-type="BUTTON" data-element-label="新建单据">+ 新建单据</button></div>`,
                  }),
                },
              },
            ],
          },
          'tool_calls',
        ),
      );
      res.write(usageChunk(promptTokens, 160, 0));
    } else if (last?.role === 'user' && lastText.includes('跨步骤转交审批规则')) {
      res.write(
        sseChunk(
          {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'tc-handoff-84',
                type: 'function',
                function: {
                  name: 'propose_step_handoff',
                  arguments: JSON.stringify({
                    targetStep: 'BUSINESS_MODEL',
                    request: '新增超过 100 万元采购合同须总经理审批的业务规则',
                    reason: '业务规则属于「业务模型」步骤的范围',
                  }),
                },
              },
            ],
          },
          'tool_calls',
        ),
      );
      res.write(usageChunk(3100, 140, 1200));
    } else if (last?.role === 'user') {
      const code = `
        await tools.init_prototype_shell({
          appTitle: "合同协同工作台",
          screens: [
            { screenId: "SCR-LEDGER", screenName: "合同台账列表", screenType: "LIST" },
            { screenId: "SCR-APPROVAL", screenName: "合同审批详情", screenType: "APPROVAL" }
          ]
        });
        return await tools.spawn_subagents({
          tasks: [
            { title: "构建合同台账列表", roleLabel: "台账设计师", screenId: "SCR-LEDGER", screenName: "合同台账列表", instruction: "构建台账列表核心筛选与表格" },
            { title: "构建合同审批详情", roleLabel: "审批设计师", screenId: "SCR-APPROVAL", screenName: "合同审批详情", instruction: "构建审批详情与通过动作" }
          ]
        });
      `;
      res.write(
        sseChunk(
          {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'tc-codemode-84',
                type: 'function',
                function: {
                  name: 'codemode',
                  arguments: JSON.stringify({ code }),
                },
              },
            ],
          },
          'tool_calls',
        ),
      );
      res.write(usageChunk(3600, 220, 2000));
    } else {
      res.write(
        sseChunk(
          {
            role: 'assistant',
            content: '已完成操作并记录当前进度。',
          },
          'stop',
        ),
      );
      res.write(usageChunk(3900, 90, 2400));
    }

    res.end('data: [DONE]\n\n');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test.describe('Context Events List & Subagent Lanes (#84)', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('displays COMPACT, TRIM, HANDOFF, and SUBAGENT events with type filters & click-to-jump, and renders Subagent Lanes that enter subagent snapshots on click', async ({
    page,
    request,
  }) => {
    const gateway = await startDeterministicSubagentGateway();
    const providerId = `llm-e2e-84-${Date.now().toString(36)}`;

    const createdRes = await request.post('/api/projects', {
      data: {
        name: '合同并行原型与上下文事件系统',
        code: `CTX_84_${Date.now().toString(36).toUpperCase()}`,
        center: 'APPLICATION',
        domain: '采购与合同管理',
        template: 'EMPTY',
      },
    });
    expect(createdRes.ok()).toBe(true);
    const { project } = (await createdRes.json()) as { project: { id: string } };

    try {
      // 1. Register isolated gateway provider (disabled globally so other sessions remain untouched)
      const saveProvRes = await request.post('/api/llm/providers', {
        data: {
          id: providerId,
          name: 'E2E 84 Snapshot Gateway',
          providerType: 'OPENAI_COMPATIBLE',
          baseUrl: gateway.baseUrl,
          apiKey: 'e2e-local-only',
          defaultModel: 'e2e-snapshot-model',
          availableModels: ['e2e-snapshot-model'],
          contextWindow: 128_000,
          enabled: false,
        },
      });
      expect(saveProvRes.ok()).toBe(true);

      // 2. Save & confirm Requirements document so Prototype step is unlocked
      const docId = `rdoc-84-${Date.now().toString(36)}`;
      const docRes = await request.post('/api/requirements/docs', {
        data: {
          id: docId,
          projectId: project.id,
          title: '采购合同管理需求说明',
          version: 'v1.0',
          content: '# 采购合同管理\n## 1. 目标\n管理合同台账列表与合同审批详情。',
        },
      });
      expect(docRes.ok()).toBe(true);

      const confirmRes = await request.post(
        `/api/projects/${encodeURIComponent(project.id)}/steps/requirements/confirm`,
        { data: { docId } },
      );
      expect(confirmRes.ok()).toBe(true);

      // 3. Create PROTOTYPE_CO_DESIGN session with 20 older messages so Turn 1 triggers sliding-window TRIM (excludedCount > 0)
      const initialMessages = Array.from({ length: 20 }, (_, i) => ({
        id: `msg-seed-84-${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `第 ${i + 1} 条早期版式讨论记录`,
        timestamp: new Date(Date.UTC(2026, 10, 18, 8, i)).toISOString(),
      }));

      const createSessRes = await request.post('/api/agent-sessions', {
        data: {
          projectId: project.id,
          agentKind: 'PROTOTYPE_CO_DESIGN',
          title: '合同协同原型会话',
          providerId,
          codeMode: true,
          multiAgentConcurrency: 3,
          initialMessages,
        },
      });
      expect(createSessRes.ok()).toBe(true);
      const { session } = (await createSessRes.json()) as { session: { id: string } };

      // 4. Turn 1: triggers TRIM on call #1 + SUBAGENT dispatch (2 parallel subagent lanes #2 & #3) + summary #4
      const turn1Res = await request.post(`/api/agent-sessions/${session.id}/stream`, {
        data: {
          prompt: '生成双屏首版原型（台账列表与审批详情）',
          prototypeName: '合同协同原型',
          mockMode: false,
        },
      });
      expect(turn1Res.ok()).toBe(true);
      await turn1Res.text();

      // 5. Compaction: records COMPACT event
      const compactRes = await request.post(`/api/agent-sessions/${session.id}/compact`);
      expect(compactRes.ok()).toBe(true);

      // 6. Turn 2: triggers HANDOFF event (`propose_step_handoff`)
      const turn2Res = await request.post(`/api/agent-sessions/${session.id}/stream`, {
        data: {
          prompt: '跨步骤转交审批规则：超过 100 万必须总经理审批',
          mockMode: false,
        },
      });
      expect(turn2Res.ok()).toBe(true);
      await turn2Res.text();

      // 7. Navigate to Prototype step for this project & session and open Context Inspector
      await page.goto(
        `/?projectId=${encodeURIComponent(project.id)}&step=prototype&sessionId=${encodeURIComponent(session.id)}`,
      );

      const panel = page.getByTestId('agent-panel');
      await expect(panel).toBeVisible();
      const ring = panel.getByTestId('context-occupancy-ring');
      await expect(ring).toBeVisible();
      await ring.click();

      const drawer = page.getByTestId(CONTEXT_INSPECTOR_DRAWER_TEST_ID);
      await expect(drawer).toBeVisible();

      const leftCol = drawer.getByTestId('context-inspector-left-col');
      const rightCol = drawer.getByTestId('context-inspector-right-col');
      const timeline = leftCol.getByTestId('context-call-timeline');
      const eventsSection = leftCol.getByTestId('context-events-section');
      const lanesSection = leftCol.getByTestId('context-subagent-lanes-section');
      const browser = rightCol.getByTestId('context-browser');

      await expect(timeline).toBeVisible();
      await expect(eventsSection).toBeVisible();
      await expect(lanesSection).toBeVisible();
      await expect(browser).toBeVisible();

      // Verify all 4 event categories are present in ContextEventsList
      const eventItems = eventsSection.getByTestId('context-event-item');
      expect(await eventItems.count()).toBeGreaterThanOrEqual(4);
      await expect(
        eventsSection.locator('[data-testid="context-event-item"][data-event-kind="COMPACT"]'),
      ).toHaveCount(1);
      await expect(
        eventsSection.locator('[data-testid="context-event-item"][data-event-kind="TRIM"]'),
      ).toHaveCount(1);
      await expect(
        eventsSection.locator('[data-testid="context-event-item"][data-event-kind="HANDOFF"]'),
      ).toHaveCount(1);
      await expect(
        eventsSection.locator('[data-testid="context-event-item"][data-event-kind="SUBAGENT"]'),
      ).toHaveCount(1);

      // Verify Type Filter Bar filters each category accurately
      for (const filterKind of ['COMPACT', 'TRIM', 'HANDOFF', 'SUBAGENT'] as const) {
        const filterBtn = eventsSection.locator(
          `[data-testid="context-event-filter"][data-filter-kind="${filterKind}"]`,
        );
        await filterBtn.click();
        await expect(filterBtn).toHaveAttribute('aria-pressed', 'true');
        await expect(eventItems).toHaveCount(1);
        await expect(eventItems.first()).toHaveAttribute('data-event-kind', filterKind);
      }

      const allFilterBtn = eventsSection.locator(
        '[data-testid="context-event-filter"][data-filter-kind="ALL"]',
      );
      await allFilterBtn.click();
      await expect(eventItems).toHaveCount(4);

      // Click HANDOFF event -> jumps ContextBrowser & ModelCallTimeline to the hand-off call
      const handoffEvent = eventsSection.locator(
        '[data-testid="context-event-item"][data-event-kind="HANDOFF"]',
      );
      const handoffSeq = await handoffEvent.getAttribute('data-call-seq');
      expect(Number(handoffSeq)).toBeGreaterThanOrEqual(5);
      await handoffEvent.click();

      await expect(browser).toHaveAttribute('data-selected-call-seq', handoffSeq!);
      await expect(browser.getByTestId('context-browser-head')).toContainText(
        `第 #${handoffSeq} 次调用发送的内容`,
      );
      await expect(browser).toContainText('propose_step_handoff');

      // Click TRIM event -> jumps ContextBrowser to call #1
      const trimEvent = eventsSection.locator(
        '[data-testid="context-event-item"][data-event-kind="TRIM"]',
      );
      await trimEvent.click();
      await expect(browser).toHaveAttribute('data-selected-call-seq', '1');
      await expect(browser.getByTestId('context-browser-head')).toContainText(
        '第 #1 次调用发送的内容',
      );

      // Verify Subagent Lanes Panel displays both subagent lanes with context size, call count, and COMPLETED status
      const lanes = lanesSection.getByTestId('context-subagent-lane');
      await expect(lanes).toHaveCount(2);
      await expect(lanesSection).toContainText('台账设计师');
      await expect(lanesSection).toContainText('审批设计师');
      await expect(lanesSection).toContainText('2,400');
      await expect(lanesSection).toContainText('1,850');
      await expect(lanesSection).toContainText('1 次调用');
      await expect(lanesSection).toContainText('已完成');
      await expect(lanesSection).toContainText('源自 #1');

      // Click "台账设计师" lane -> enters its SUBAGENT Model Call in ContextBrowser!
      const ledgerLane = lanes.filter({ hasText: '台账设计师' });
      const ledgerCallId = await ledgerLane.getAttribute('data-target-call-id');
      expect(ledgerCallId).toBeTruthy();
      await ledgerLane.click();

      await expect(browser).toHaveAttribute('data-selected-call-id', ledgerCallId!);
      await expect(browser.getByTestId('context-browser-head')).toContainText(
        '子智能体 · 台账设计师',
      );
      const subUserCategory = browser.locator(
        '[data-testid="context-browser-category"][data-category-kind="USER_MESSAGE"]',
      );
      await expect(subUserCategory).toContainText('你是并行专职子智能体（台账设计师）');
      await subUserCategory.getByTestId('context-browser-item-toggle').first().click();
      await expect(
        subUserCategory.getByTestId('context-browser-item-content').first(),
      ).toContainText('SCR-LEDGER');

      // Bilingual check (zh-CN -> en-US -> zh-CN)
      await page.getByTestId('locale-toggle-btn').click();
      await expect(eventsSection).toContainText('Context events');
      await expect(eventsSection).toContainText('Subagent dispatch');
      await expect(eventsSection).toContainText('Sliding window');
      await expect(eventsSection).toContainText('Step hand-off');
      await expect(lanesSection).toContainText('Subagent lanes');
      await expect(lanesSection).toContainText('1 call');
      await expect(lanesSection).toContainText('Completed');
      await page.getByTestId('locale-toggle-btn').click();

      // Business View guard check with ONLY context-inspector-drawer exempted
      const openBodyHtml = await page.locator('body').innerHTML();
      const violations = checkBusinessViewMarkup(openBodyHtml, {
        ignoreTestIds: [CONTEXT_INSPECTOR_DRAWER_TEST_ID],
      });
      expect(violations, formatBusinessViewViolations(violations)).toEqual([]);

      await drawer.getByTestId('context-inspector-close-btn').click();
      await expect(drawer).toHaveCount(0);
    } finally {
      await request
        .delete(`/api/llm/providers/${encodeURIComponent(providerId)}`)
        .catch(() => undefined);
      await request
        .delete(`/api/projects/${encodeURIComponent(project.id)}`)
        .catch(() => undefined);
      await gateway.close();
    }
  });
});
