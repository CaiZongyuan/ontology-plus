import { expect, test } from '@playwright/test';
import {
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
} from '../src/packages/business-vocabulary/index.js';

test.describe('Folded Work Process, Level-2 Tool Details, Inline Change Summary Undo & Platform Failures (#80)', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('folds thinking + tool calls into Work Process (Level 0 -> Level 1 -> Level 2), undoes latest change from the inline reply strip, and reports ADR 0016 platform failures cleanly', async ({
    page,
    request,
  }) => {
    const createdRes = await request.post('/api/projects', {
      data: {
        name: '制造采购合同验收系统',
        code: `WORK_80_${Date.now().toString(36).toUpperCase()}`,
        center: 'APPLICATION',
        domain: '制造企业采购管理',
        template: 'EMPTY',
      },
    });
    expect(createdRes.ok()).toBe(true);
    const { project } = (await createdRes.json()) as { project: { id: string } };

    // Seed a REQUIREMENT session turn carrying thinking + raw tool traces (including M1 / AGG-01)
    const sessRes = await request.post('/api/agent-sessions', {
      data: {
        projectId: project.id,
        agentKind: 'REQUIREMENT',
        title: '采购审批需求梳理',
        initialMessages: [
          {
            id: 'u-work-1',
            role: 'user',
            content: '帮我梳理采购合同三级审批与付款节点需求',
            timestamp: '2026-11-18T10:00:00.000Z',
          },
          {
            id: 'a-work-1',
            role: 'assistant',
            content: '已梳理**三级审批**与**三期付款节点**要点，可直接生成需求文档。',
            thinking: '先读取现有业务对象，再整理三级审批与付款计划要点。',
            thinkingDurationMs: 6_000,
            timestamp: '2026-11-18T10:00:08.000Z',
            toolCalls: [
              {
                id: 'tc-work-1',
                toolName: 'inspect_ontology_model',
                arguments: { modelCode: 'M1', targetId: 'AGG-01' },
                output: '{"aggregates":["AGG-01"]}',
                durationMs: 420,
              },
              {
                id: 'tc-work-2',
                toolName: 'record_requirement_insights',
                arguments: {
                  aggregates: ['采购合同', '供应商', '付款计划'],
                  rules: ['金额分级审批', '到期前 30 天提醒'],
                },
                output: '{"status":"OK","recorded":5}',
                durationMs: 860,
              },
            ],
          },
        ],
      },
    });
    expect(sessRes.ok()).toBe(true);

    try {
      await page.goto(`/?projectId=${project.id}&step=requirements`);
      const panel = page.getByTestId('agent-panel');
      await expect(panel).toBeVisible();

      const workBlock = panel.getByTestId('conversation-work-process').first();
      await expect(workBlock).toBeVisible();
      await expect(workBlock).toHaveAttribute('data-expanded', 'false');
      await expect(workBlock).toContainText('工作过程');
      await expect(workBlock).toContainText('思考 6 秒 · 2 个步骤');
      await expect(workBlock.getByTestId('conversation-work-body')).toHaveCount(0);

      // Collapsed Business View guard in both zh-CN and en-US
      const zhMarkup = await page.locator('.wb-shell').evaluate((el) => el.outerHTML);
      const zhViolations = checkBusinessViewMarkup(zhMarkup);
      expect(zhViolations, formatBusinessViewViolations(zhViolations)).toEqual([]);

      await page.getByTestId('locale-toggle-btn').click();
      await expect(workBlock).toContainText('Work process');
      await expect(workBlock).toContainText('Thought for 6s · 2 steps');
      const enMarkup = await page.locator('.wb-shell').evaluate((el) => el.outerHTML);
      const enViolations = checkBusinessViewMarkup(enMarkup);
      expect(enViolations, formatBusinessViewViolations(enViolations)).toEqual([]);

      await page.getByTestId('locale-toggle-btn').click();
      await expect(workBlock).toContainText('思考 6 秒 · 2 个步骤');

      // Level 1: Click Work Process header -> shows thinking + 1 row per tool in business language
      await workBlock.getByTestId('conversation-work-toggle').click();
      await expect(workBlock).toHaveAttribute('data-expanded', 'true');
      await expect(workBlock.getByTestId('conversation-thinking-block')).toContainText(
        '思考了 6 秒',
      );
      await expect(workBlock.getByTestId('agent-run-thinking')).toContainText(
        '先读取现有业务对象',
      );
      const toolSteps = workBlock.getByTestId('conversation-tool-step');
      await expect(toolSteps).toHaveCount(2);
      await expect(toolSteps.nth(0)).toContainText('检查业务对象');
      await expect(toolSteps.nth(0)).toContainText('0.4s');
      await expect(toolSteps.nth(1)).toContainText('记录需求要点');
      await expect(toolSteps.nth(1)).toContainText('整理 3 个业务对象、2 条业务规则');
      await expect(workBlock.getByTestId('conversation-tool-detail')).toHaveCount(0);

      // Level 2: Click the first tool row -> reveals raw toolName, JSON args, and output
      await toolSteps.nth(0).getByTestId('conversation-tool-toggle').click();
      await expect(toolSteps.nth(0).getByTestId('conversation-tool-detail')).toBeVisible();
      await expect(toolSteps.nth(0).getByTestId('conversation-tool-name')).toContainText(
        'inspect_ontology_model',
      );
      await expect(toolSteps.nth(0).getByTestId('conversation-tool-args')).toContainText(
        '"modelCode": "M1"',
      );
      await expect(toolSteps.nth(0).getByTestId('conversation-tool-result')).toContainText(
        '{"aggregates":["AGG-01"]}',
      );

      // Collapse back to Level 0
      await workBlock.getByTestId('conversation-work-toggle').click();
      await expect(workBlock).toHaveAttribute('data-expanded', 'false');

      // Synthesize Requirements Document -> triggers real mutating turn with inline Variant B Change Summary strip at end of reply, then 1-click Undo directly from the strip!
      await page.getByTestId('synthesize-srs-btn').click();
      await expect(page.getByTestId('requirements-document-sections')).toBeVisible({
        timeout: 25_000,
      });

      const strip = panel.getByTestId('run-change-summary');
      await expect(strip).toHaveCount(1);
      await expect(strip).toHaveAttribute('data-variant', 'strip');
      await expect(strip.getByTestId('change-summary-headline')).toContainText(
        /需求文档改了\s*\d+\s*处/,
      );
      await strip.getByTestId('change-summary-undo-btn').click();
      await expect(page.getByTestId('requirements-document-sections')).toHaveCount(0);

      // Simulate an ADR 0016 platform gateway failure on the next turn -> calm message + tucked diagnostics + Retry + platform settings navigation
      await page.route(
        '**/api/agent-sessions/*/stream',
        async (route) => {
          await route.fulfill({
            status: 502,
            contentType: 'application/json',
            body: JSON.stringify({
              error: 'HTTP 502 Bad Gateway',
              diagnostic: {
                code: 'LLM_GATEWAY_ERROR',
                providerName: 'Unreachable Corp Gateway',
                baseUrl: 'http://127.0.0.1:9999/v1',
                statusCode: 502,
                message: 'ECONNREFUSED 127.0.0.1:9999',
                remediation: 'Check gateway URL and API key in Platform Settings.',
              },
            }),
          });
        },
        { times: 1 },
      );

      await page.getByTestId('agent-panel-composer-input').fill('继续补充质保金结算条款');
      await page.getByTestId('agent-panel-send-btn').click();

      const failureBox = panel.getByTestId('agent-run-failure');
      await expect(failureBox).toBeVisible();
      await expect(failureBox).toContainText('AI 服务暂不可用，请联系为你部署的人');
      await expect(failureBox.getByTestId('agent-run-retry-btn')).toBeVisible();
      await expect(failureBox.getByTestId('agent-run-diagnostic-details')).toBeHidden();

      // Guard still passes with 0 violations while diagnostics are tucked
      const failCollapsedMarkup = await page.locator('.wb-shell').evaluate((el) => el.outerHTML);
      expect(checkBusinessViewMarkup(failCollapsedMarkup)).toEqual([]);

      await failureBox.getByTestId('conversation-diagnostic-toggle').click();
      await expect(failureBox.getByTestId('agent-run-diagnostic-details')).toBeVisible();
      await expect(failureBox.getByTestId('agent-run-diagnostic-details')).toContainText(
        'LLM_GATEWAY_ERROR',
      );
      await expect(failureBox.getByTestId('agent-run-diagnostic-details')).toContainText(
        'Unreachable Corp Gateway',
      );

      await failureBox.getByTestId('agent-run-open-platform-settings-btn').click();
      await expect(page).toHaveURL(/llm-center/);
    } finally {
      await request.post('/api/projects/active', { data: { projectId: 'proj-contract' } });
      await request.delete(`/api/projects/${project.id}?force=true`);
    }
  });
});
