import { expect, test } from '@playwright/test';

const FORBIDDEN_INTERNAL_AGENT_TERMS =
  /Agent Session|Agent Run|Agent Panel|Architecture Asset Agent|Application Development Agent|智能体会话|智能体运行|智能体面板|架构资产智能体|应用开发智能体/;

test.describe('Single AI Assistant & History Menu (#62)', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('presents a single AI 助手 / AI Assistant across all 4 Project Steps, Technical Details, and Secondary Areas while keeping per-step conversations separate', async ({
    page,
  }) => {
    await page.goto('/');

    const panel = page.getByTestId('agent-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('assistant-panel-title')).toHaveText('AI 助手');
    await expect(panel.locator('[data-testid="agent-panel-session-select"]')).toHaveCount(0);

    // Toggle to en-US and back to zh-CN
    await page.getByTestId('locale-toggle-btn').click();
    await expect(panel.getByTestId('assistant-panel-title')).toHaveText('AI Assistant');
    await page.getByTestId('locale-toggle-btn').click();
    await expect(panel.getByTestId('assistant-panel-title')).toHaveText('AI 助手');

    // Step 1: REQUIREMENTS -> send a step-specific turn
    await page.getByTestId('step-tab-REQUIREMENTS').click();
    await expect(panel.getByTestId('assistant-panel-title')).toHaveText('AI 助手');
    await page.getByTestId('agent-panel-composer-input').fill('需求步骤独立话题：明确合同归档保留年限');
    await page.getByTestId('agent-panel-send-btn').click();
    await expect(
      panel.locator('[data-testid="agent-run-card"][data-run-status="SUCCEEDED"]').last(),
    ).toBeVisible({ timeout: 25_000 });
    await expect(panel).toContainText('需求步骤独立话题：明确合同归档保留年限');

    // Step 2: PROTOTYPE -> header still says AI 助手, and Requirements topic does not bleed into Prototype
    await page.getByTestId('step-tab-PROTOTYPE').click();
    await expect(panel.getByTestId('assistant-panel-title')).toHaveText('AI 助手');
    await expect(panel).not.toContainText('需求步骤独立话题：明确合同归档保留年限');

    // Step 3: BUSINESS_MODEL -> header still says AI 助手, separate COPILOT conversation
    await page.getByTestId('step-tab-BUSINESS_MODEL').click();
    await expect(panel.getByTestId('assistant-panel-title')).toHaveText('AI 助手');
    await expect(panel).not.toContainText('需求步骤独立话题：明确合同归档保留年限');

    // Step 4: DELIVERY (Business View & Technical Details) -> header says AI 助手, never Architecture/Application Agent
    await page.getByTestId('step-tab-DELIVERY').click();
    await expect(panel.getByTestId('assistant-panel-title')).toHaveText('AI 助手');
    await expect(page.getByTestId('coding-agent-context-card')).toContainText('AI 助手');
    await expect(page.locator('body')).not.toContainText(FORBIDDEN_INTERNAL_AGENT_TERMS);

    await page.getByTestId('nav-app-four-layer-assets').click();
    await expect(panel.getByTestId('assistant-panel-title')).toHaveText('AI 助手');
    await expect(panel.getByTestId('assistant-panel-subtitle')).toHaveText('编写与维护开发规范');
    await expect(page.getByTestId('open-generate-tech-arch-btn')).toContainText(
      '请 AI 助手协助编写规范',
    );
    await expect(page.locator('body')).not.toContainText(FORBIDDEN_INTERNAL_AGENT_TERMS);

    // Secondary Areas: Capability Chat & Data Reasoning also present as AI 助手
    await page.getByTestId('more-menu-btn').click();
    await page.getByTestId('more-menu-capability').click();
    await page.getByTestId('nav-cap-agents').click();
    if (!(await panel.isVisible())) {
      await page.getByTestId('agent-panel-toggle').click();
    }
    await expect(panel.getByTestId('assistant-panel-title')).toHaveText('AI 助手');
    await expect(page.locator('body')).not.toContainText(FORBIDDEN_INTERNAL_AGENT_TERMS);

    await page.getByTestId('more-menu-btn').click();
    await page.getByTestId('more-menu-analytics').click();
    await page.getByTestId('nav-data-reasoning').click();
    if (!(await panel.isVisible())) {
      await page.getByTestId('agent-panel-toggle').click();
    }
    await expect(panel.getByTestId('assistant-panel-title')).toHaveText('AI 助手');
    await expect(page.locator('body')).not.toContainText(FORBIDDEN_INTERNAL_AGENT_TERMS);

    // Returning to REQUIREMENTS restores that step's own conversation
    await page.getByTestId('back-to-project-btn').click();
    await page.getByTestId('step-tab-REQUIREMENTS').click();
    await expect(panel).toContainText('需求步骤独立话题：明确合同归档保留年限');
  });

  test('manages conversations inside the History Menu (create, switch, rename, delete) and forbids manual create/delete for Prototype Co-Design', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('step-tab-REQUIREMENTS').click();

    const panel = page.getByTestId('agent-panel');
    const historyBtn = panel.getByTestId('assistant-history-menu-btn');
    await expect(historyBtn).toBeVisible();

    // 1. Open History Menu & create a new conversation
    await historyBtn.click();
    const menu = page.getByTestId('assistant-history-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId('assistant-new-session-btn')).toBeVisible();
    await menu.getByTestId('assistant-new-session-btn').click();
    await expect(menu).toBeHidden();
    await expect(panel.getByTestId('agent-panel-empty')).toBeVisible();

    // Send a prompt in the new conversation
    await page.getByTestId('agent-panel-composer-input').fill('新开话题：跨境外币结算汇率锁定条款');
    await page.getByTestId('agent-panel-send-btn').click();
    await expect(
      panel.locator('[data-testid="agent-run-card"][data-run-status="SUCCEEDED"]').last(),
    ).toBeVisible({ timeout: 25_000 });

    // 2. Rename the active conversation inline in the History Menu (zero window.prompt)
    await historyBtn.click();
    await expect(menu).toBeVisible();
    const activeRow = menu.locator('[data-testid="assistant-history-item"][data-active="true"]');
    await activeRow.getByTestId('assistant-rename-session-btn').click();
    const renameInput = menu.getByTestId('assistant-rename-session-input');
    await expect(renameInput).toBeVisible();
    await renameInput.fill('外币汇率锁定专题');
    await renameInput.press('Enter');
    await expect(
      menu.locator('[data-testid="assistant-history-item"][data-active="true"]'),
    ).toContainText('外币汇率锁定专题');

    // 3. Switch to the seeded previous conversation and verify topic separation
    const otherRow = menu
      .locator('[data-testid="assistant-history-item"][data-active="false"]')
      .first();
    await otherRow.getByTestId('assistant-select-session-btn').click();
    await expect(menu).toBeHidden();
    await expect(panel).not.toContainText('新开话题：跨境外币结算汇率锁定条款');

    // Switch back to the renamed conversation and verify persistence across reload
    await historyBtn.click();
    await menu
      .locator('[data-testid="assistant-history-item"]', { hasText: '外币汇率锁定专题' })
      .getByTestId('assistant-select-session-btn')
      .click();
    await expect(panel).toContainText('新开话题：跨境外币结算汇率锁定条款');

    await page.reload();
    await page.getByTestId('step-tab-REQUIREMENTS').click();
    await expect(page.getByTestId('agent-panel')).toContainText('新开话题：跨境外币结算汇率锁定条款');

    // 4. Delete the conversation inline in the History Menu (zero window.confirm)
    await page.getByTestId('agent-panel').getByTestId('assistant-history-menu-btn').click();
    const reloadedMenu = page.getByTestId('assistant-history-menu');
    const targetRow = reloadedMenu.locator('[data-testid="assistant-history-item"]', {
      hasText: '外币汇率锁定专题',
    });
    await targetRow.getByTestId('assistant-delete-session-btn').click();
    await targetRow.getByTestId('assistant-delete-confirm-btn').click();
    await expect(
      reloadedMenu.locator('[data-testid="assistant-history-item"]', {
        hasText: '外币汇率锁定专题',
      }),
    ).toHaveCount(0);

    // Close menu via Escape, then check PROTOTYPE step History Menu invariant (before & after bound session creation)
    await page.keyboard.press('Escape');
    await page.getByTestId('step-tab-PROTOTYPE').click();
    const protoPanel = page.getByTestId('agent-panel');
    await protoPanel.getByTestId('assistant-history-menu-btn').click();
    const protoMenu = page.getByTestId('assistant-history-menu');
    await expect(protoMenu).toBeVisible();
    await expect(protoMenu).toContainText('随界面原型自动管理');
    await expect(protoMenu.getByTestId('assistant-new-session-btn')).toHaveCount(0);
    await expect(protoMenu.getByTestId('assistant-delete-session-btn')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Trigger a prototype refinement turn so the 1-to-1 bound session is populated, then re-verify no create/delete
    await page.getByTestId('agent-panel-composer-input').fill('微调筛选栏间距');
    await page.getByTestId('agent-panel-send-btn').click();
    await expect(
      protoPanel.locator('[data-testid="agent-run-card"][data-run-status="SUCCEEDED"]').last(),
    ).toBeVisible({ timeout: 25_000 });

    await protoPanel.getByTestId('assistant-history-menu-btn').click();
    await expect(protoMenu.getByTestId('assistant-history-item').first()).toBeVisible();
    await expect(protoMenu.getByTestId('assistant-rename-session-btn').first()).toBeVisible();
    await expect(protoMenu.getByTestId('assistant-new-session-btn')).toHaveCount(0);
    await expect(protoMenu.getByTestId('assistant-delete-session-btn')).toHaveCount(0);
  });
});
