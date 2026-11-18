import { expect, test } from '@playwright/test';
import {
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
} from '../src/packages/business-vocabulary/index.js';

const CONTEXT_INSPECTOR_DRAWER_TEST_ID = 'context-inspector-drawer';

test.describe('Context Occupancy Ring, Removed Messages Notice & Context Composition Bar (#82)', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('renders SVG-only occupancy ring beside Send, opens wide two-column overlay over canvas without squeezing canvas or hiding AgentPanel, shows 7-segment composition & Simulated badge, dismisses via backdrop/Escape, and jumps from inline Removed notice to archived items after compaction', async ({
    page,
    request,
  }) => {
    const createdRes = await request.post('/api/projects', {
      data: {
        name: '采购合同履约协同系统',
        code: `CTX_82_${Date.now().toString(36).toUpperCase()}`,
        center: 'APPLICATION',
        domain: '采购与合同管理',
        template: 'EMPTY',
      },
    });
    expect(createdRes.ok()).toBe(true);
    const { project } = (await createdRes.json()) as { project: { id: string } };

    try {
      await page.goto(`/?projectId=${project.id}&step=requirements`);
      const panel = page.getByTestId('agent-panel');
      await expect(panel).toBeVisible();
      await expect(panel).toHaveAttribute('data-presentation-mode', 'conversation');

      // 1. Before any call, ring is mounted beside Send button at 0% with SVG only (zero text)
      const composer = panel.getByTestId('agent-panel-composer');
      const ring = composer.getByTestId('context-occupancy-ring');
      const sendBtn = composer.getByTestId('agent-panel-send-btn');
      await expect(ring).toBeVisible();
      await expect(sendBtn).toBeVisible();
      await expect(ring).toHaveAttribute('data-occupancy-pct', '0');
      await expect(ring).toHaveAttribute('data-occupancy-warn', 'false');
      await expect(ring).toHaveAttribute('title', '对话记忆已用 0%');
      expect((await ring.innerText()).trim()).toBe('');

      // Context Inspector is closed by default, and no removed notice exists yet
      await expect(page.getByTestId(CONTEXT_INSPECTOR_DRAWER_TEST_ID)).toHaveCount(0);
      await expect(panel.getByTestId('conversation-removed-notice')).toHaveCount(0);

      // 2. Send a message in Requirements step -> records real simulated Context Snapshot
      const input = composer.getByTestId('agent-panel-composer-input');
      await input.fill('第一轮：我们需要管理供应商准入审核、采购合同起草与多级审批。');
      await sendBtn.click();

      await expect(panel.getByTestId('conversation-turn')).toHaveCount(1);
      await expect(
        panel.getByTestId('conversation-turn').first(),
      ).toHaveAttribute('data-run-status', 'SUCCEEDED', { timeout: 15_000 });

      // Add two more turns via stream API on the created session so session has 6 messages (>4 for compaction)
      const bootAfterFirstTurn = await (
        await request.get(`/api/bootstrap?projectId=${encodeURIComponent(project.id)}`)
      ).json();
      const reqSession = (
        bootAfterFirstTurn.agentSessions as Array<{
          id: string;
          projectId: string;
          agentKind: string;
        }>
      ).find((s) => s.projectId === project.id && s.agentKind === 'REQUIREMENT');
      expect(reqSession).toBeDefined();

      for (const followUp of [
        '第二轮：超过 100 万元的采购合同必须经过法务与财务双签。',
        '第三轮：合同到期前 30 天自动向经办人发送续签提醒。',
      ]) {
        const streamRes = await request.post(`/api/agent-sessions/${reqSession!.id}/stream`, {
          data: { prompt: followUp, mockMode: true },
        });
        expect(streamRes.ok()).toBe(true);
        await streamRes.text();
      }

      await page.reload();
      await expect(panel.getByTestId('conversation-turn')).toHaveCount(3);
      await expect(ring).toBeVisible();

      // Measure canvas width & AgentPanel bounds BEFORE opening Context Inspector
      const canvas = page.getByTestId('workbench-canvas');
      await expect(canvas).toBeVisible();
      const canvasBoxBefore = await canvas.boundingBox();
      const panelBoxBefore = await panel.boundingBox();
      expect(canvasBoxBefore).not.toBeNull();
      expect(panelBoxBefore).not.toBeNull();

      // 3. Click occupancy ring -> wide two-column overlay opens over canvas without squeezing canvas!
      await ring.click();
      const drawer = page.getByTestId(CONTEXT_INSPECTOR_DRAWER_TEST_ID);
      await expect(drawer).toBeVisible();

      const canvasBoxDuring = await canvas.boundingBox();
      const panelBoxDuring = await panel.boundingBox();
      const drawerBox = await drawer.boundingBox();
      expect(canvasBoxDuring).not.toBeNull();
      expect(panelBoxDuring).not.toBeNull();
      expect(drawerBox).not.toBeNull();

      // Canvas width MUST remain completely unchanged (zero squeeze!) and AgentPanel stays visible
      expect(Math.round(canvasBoxDuring!.width)).toBe(Math.round(canvasBoxBefore!.width));
      expect(Math.round(panelBoxDuring!.width)).toBe(Math.round(panelBoxBefore!.width));
      await expect(panel).toBeVisible();
      // Overlay starts at AgentPanel's right edge, never covering conversation
      expect(drawerBox!.x).toBeGreaterThanOrEqual(
        panelBoxDuring!.x + panelBoxDuring!.width - 2,
      );

      // Verify wide two-column layout
      const leftCol = drawer.getByTestId('context-inspector-left-col');
      const rightCol = drawer.getByTestId('context-inspector-right-col');
      await expect(leftCol).toBeVisible();
      await expect(rightCol).toBeVisible();
      const leftBox = await leftCol.boundingBox();
      const rightBox = await rightCol.boundingBox();
      expect(leftBox).not.toBeNull();
      expect(rightBox).not.toBeNull();
      expect(rightBox!.x).toBeGreaterThan(leftBox!.x);

      // Verify 7 composition segments + SIMULATED usage source badge ("模拟" / "Simulated")
      const compBar = leftCol.getByTestId('context-composition-bar');
      await expect(compBar).toBeVisible();
      await expect(compBar.getByTestId('context-composition-segment')).toHaveCount(7);
      const usageSource = compBar.getByTestId('context-usage-source');
      await expect(usageSource).toBeVisible();
      await expect(usageSource).toHaveAttribute('data-source', 'SIMULATED');
      await expect(usageSource).toContainText('模拟');

      // Toggle locale to en-US briefly to verify bilingual header & Simulated badge, then switch back
      await page.getByTestId('locale-toggle-btn').click();
      await expect(drawer.getByTestId('context-inspector-title')).toHaveText('Conversation memory');
      await expect(usageSource).toContainText('Simulated');
      await page.getByTestId('locale-toggle-btn').click();
      await expect(drawer.getByTestId('context-inspector-title')).toHaveText('对话记忆');

      // Verify Business View guard passes with ONLY context-inspector-drawer exempted while open
      const openBodyHtml = await page.locator('body').innerHTML();
      expect(openBodyHtml).toContain(`data-testid="${CONTEXT_INSPECTOR_DRAWER_TEST_ID}"`);
      const openViolations = checkBusinessViewMarkup(openBodyHtml, {
        ignoreTestIds: [CONTEXT_INSPECTOR_DRAWER_TEST_ID],
      });
      expect(openViolations, formatBusinessViewViolations(openViolations)).toEqual([]);

      // 4. Click backdrop closes overlay; reopen and verify Escape also closes overlay
      await drawer.getByTestId('context-inspector-backdrop').click();
      await expect(drawer).toHaveCount(0);

      await ring.click();
      await expect(drawer).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0);

      // 5. Trigger compaction on the session -> reload -> inline RemovedMessagesNotice appears in stream!
      const compactRes = await request.post(`/api/agent-sessions/${reqSession!.id}/compact`);
      expect(compactRes.ok()).toBe(true);

      await page.reload();
      const removedNotice = panel.getByTestId('conversation-removed-notice');
      await expect(removedNotice).toBeVisible();
      await expect(removedNotice).toContainText('较早的 2 条消息已概括 · 查看已移出内容');

      // Closed-drawer Business View guard check WITHOUT ignoreTestIds (proves ring + removed notice pass strictly!)
      const closedBodyHtml = await page.locator('body').innerHTML();
      const closedViolations = checkBusinessViewMarkup(closedBodyHtml);
      expect(closedViolations, formatBusinessViewViolations(closedViolations)).toEqual([]);

      // 6. Click inline Removed notice -> opens Context Inspector focused on removed section with archived content!
      await removedNotice.click();
      await expect(drawer).toBeVisible();
      await expect(drawer).toHaveAttribute('data-focus', 'removed');

      const removedSection = drawer.getByTestId('context-inspector-removed-section');
      await expect(removedSection).toBeVisible();
      await expect(removedSection).toHaveAttribute('data-focused', 'true');
      await expect(removedSection.getByTestId('context-removed-item')).toHaveCount(2);
      await expect(removedSection).toContainText(
        '第一轮：我们需要管理供应商准入审核、采购合同起草与多级审批。',
      );

      // Close button dismisses cleanly
      await drawer.getByTestId('context-inspector-close-btn').click();
      await expect(drawer).toHaveCount(0);
    } finally {
      await request.delete(`/api/projects/${encodeURIComponent(project.id)}`).catch(() => undefined);
    }
  });
});
