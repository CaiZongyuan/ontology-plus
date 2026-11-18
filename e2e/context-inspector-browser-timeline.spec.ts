import { expect, test } from '@playwright/test';
import {
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
} from '../src/packages/business-vocabulary/index.js';

const CONTEXT_INSPECTOR_DRAWER_TEST_ID = 'context-inspector-drawer';

test.describe('Context Browser & Model Call Timeline (#83)', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('records 2+ turns in Requirements, renders two-column timeline & ContextBrowser, toggles Cumulative/Delta, syncs right column on bar #1 click, and expands system prompt & tool definition items with source badges', async ({
    page,
    request,
  }) => {
    const createdRes = await request.post('/api/projects', {
      data: {
        name: '设备维保合同协同系统',
        code: `CTX_83_${Date.now().toString(36).toUpperCase()}`,
        center: 'APPLICATION',
        domain: '设备与采购管理',
        template: 'EMPTY',
      },
    });
    expect(createdRes.ok()).toBe(true);
    const { project } = (await createdRes.json()) as { project: { id: string } };

    try {
      await page.goto(`/?projectId=${project.id}&step=requirements`);
      const panel = page.getByTestId('agent-panel');
      await expect(panel).toBeVisible();

      const composer = panel.getByTestId('agent-panel-composer');
      const input = composer.getByTestId('agent-panel-composer-input');
      const sendBtn = composer.getByTestId('agent-panel-send-btn');
      const ring = composer.getByTestId('context-occupancy-ring');

      // Turn 1
      await input.fill('第一轮：我们需要管理设备维保供应商准入审核与维保合同三级会签。');
      await sendBtn.click();
      await expect(panel.getByTestId('conversation-turn')).toHaveCount(1);
      await expect(panel.getByTestId('conversation-turn').nth(0)).toHaveAttribute(
        'data-run-status',
        'SUCCEEDED',
        { timeout: 15_000 },
      );

      // Turn 2
      await input.fill('第二轮：维保合同到期前 30 天自动向设备管理员发送续保提醒。');
      await sendBtn.click();
      await expect(panel.getByTestId('conversation-turn')).toHaveCount(2);
      await expect(panel.getByTestId('conversation-turn').nth(1)).toHaveAttribute(
        'data-run-status',
        'SUCCEEDED',
        { timeout: 15_000 },
      );

      // Open Context Inspector ("对话记忆")
      await ring.click();
      const drawer = page.getByTestId(CONTEXT_INSPECTOR_DRAWER_TEST_ID);
      await expect(drawer).toBeVisible();

      const leftCol = drawer.getByTestId('context-inspector-left-col');
      const rightCol = drawer.getByTestId('context-inspector-right-col');
      await expect(leftCol).toBeVisible();
      await expect(rightCol).toBeVisible();

      // Verify left column has ContextCompositionBar + ModelCallTimeline with 2+ bars inside bounded scroll strip
      await expect(leftCol.getByTestId('context-composition-bar')).toBeVisible();
      const timeline = leftCol.getByTestId('context-call-timeline');
      await expect(timeline).toBeVisible();
      const scrollStrip = timeline.getByTestId('context-timeline-scroll');
      await expect(scrollStrip).toBeVisible();

      const leftBox = await leftCol.boundingBox();
      const scrollBox = await scrollStrip.boundingBox();
      expect(leftBox).not.toBeNull();
      expect(scrollBox).not.toBeNull();
      expect(scrollBox!.width).toBeLessThanOrEqual(leftBox!.width);

      const bars = timeline.getByTestId('context-timeline-bar');
      const barCount = await bars.count();
      expect(barCount).toBeGreaterThanOrEqual(2);

      // Verify right column has ContextBrowser synced to latest call initially
      const browser = rightCol.getByTestId('context-browser');
      await expect(browser).toBeVisible();
      await expect(rightCol.getByTestId('context-inspector-removed-section')).toBeVisible();

      const latestSeq = await browser.getAttribute('data-selected-call-seq');
      expect(Number(latestSeq)).toBeGreaterThanOrEqual(2);
      await expect(browser.getByTestId('context-browser-head')).toContainText(
        `第 #${latestSeq} 次调用发送的内容`,
      );
      await expect(browser).toContainText('第一轮：我们需要管理设备维保供应商准入审核与维保合同三级会签。');

      // Switch timeline between "累计" and "增量"
      const cumBtn = timeline.getByTestId('context-timeline-mode-cumulative');
      const deltaBtn = timeline.getByTestId('context-timeline-mode-delta');
      await expect(cumBtn).toHaveAttribute('aria-pressed', 'true');
      await expect(timeline).toHaveAttribute('data-timeline-mode', 'cumulative');

      await deltaBtn.click();
      await expect(deltaBtn).toHaveAttribute('aria-pressed', 'true');
      await expect(timeline).toHaveAttribute('data-timeline-mode', 'delta');
      await expect(timeline.getByTestId('context-timeline-selected-summary')).toContainText('增量');

      await cumBtn.click();
      await expect(cumBtn).toHaveAttribute('aria-pressed', 'true');
      await expect(timeline).toHaveAttribute('data-timeline-mode', 'cumulative');

      // Click bar #1 and verify right column switches immediately to call #1
      const bar1 = timeline.locator('[data-testid="context-timeline-bar"][data-call-seq="1"]');
      await expect(bar1).toBeVisible();
      await bar1.click();

      await expect(bar1).toHaveAttribute('data-selected', 'true');
      await expect(timeline.getByTestId('context-timeline-selected-summary')).toContainText('#1');
      await expect(browser).toHaveAttribute('data-selected-call-seq', '1');
      await expect(browser.getByTestId('context-browser-head')).toContainText(
        '第 #1 次调用发送的内容',
      );

      // Verify system prompt & tool definition categories + tool source badges ("内置" / "codemode")
      const instCategory = browser.locator(
        '[data-testid="context-browser-category"][data-category-kind="INSTRUCTIONS"]',
      );
      const toolCategory = browser.locator(
        '[data-testid="context-browser-category"][data-category-kind="TOOL_DEFINITION"]',
      );
      await expect(instCategory).toBeVisible();
      await expect(toolCategory).toBeVisible();

      const toolSources = toolCategory.getByTestId('context-tool-source');
      expect(await toolSources.count()).toBeGreaterThan(0);
      const sourceTexts = await toolSources.allInnerTexts();
      expect(
        sourceTexts.some((txt) => txt.trim() === '内置' || txt.trim() === 'codemode'),
      ).toBe(true);

      // Expand system prompt item to view raw content
      const instItemToggle = instCategory.getByTestId('context-browser-item-toggle').first();
      await expect(instItemToggle).toHaveAttribute('aria-expanded', 'false');
      await instItemToggle.click();
      await expect(instItemToggle).toHaveAttribute('aria-expanded', 'true');
      const instContent = instCategory.getByTestId('context-browser-item-content').first();
      await expect(instContent).toBeVisible();
      expect((await instContent.innerText()).trim().length).toBeGreaterThan(10);

      // Expand a tool definition item to view raw JSON schema
      const toolItemToggle = toolCategory.getByTestId('context-browser-item-toggle').first();
      await expect(toolItemToggle).toHaveAttribute('aria-expanded', 'false');
      await toolItemToggle.click();
      await expect(toolItemToggle).toHaveAttribute('aria-expanded', 'true');
      const toolContent = toolCategory.getByTestId('context-browser-item-content').first();
      await expect(toolContent).toBeVisible();
      await expect(toolContent).toContainText('"name"');
      await expect(toolContent).toContainText('"parameters"');

      // Bilingual check (en-US -> zh-CN)
      await page.getByTestId('locale-toggle-btn').click();
      await expect(timeline).toContainText('Call timeline');
      await expect(cumBtn).toHaveText('Cumulative');
      await expect(deltaBtn).toHaveText('Delta');
      await expect(browser.getByTestId('context-browser-head')).toContainText(
        'Call #1 context snapshot',
      );
      await page.getByTestId('locale-toggle-btn').click();

      // Business View guard check with context-inspector-drawer exempted
      const openBodyHtml = await page.locator('body').innerHTML();
      const violations = checkBusinessViewMarkup(openBodyHtml, {
        ignoreTestIds: [CONTEXT_INSPECTOR_DRAWER_TEST_ID],
      });
      expect(violations, formatBusinessViewViolations(violations)).toEqual([]);

      await drawer.getByTestId('context-inspector-close-btn').click();
      await expect(drawer).toHaveCount(0);
    } finally {
      await request.delete(`/api/projects/${encodeURIComponent(project.id)}`).catch(() => undefined);
    }
  });
});
