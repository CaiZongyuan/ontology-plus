import { expect, test } from '@playwright/test';

test.describe('Ontology Suite Change Summary, Reload-Persistent Undo/Redo & Append-Only Restore (#70)', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('omits Change Summary on no-op runs, renders Business-Object-grouped Change Summary + canvas jump/flash on mutating runs, survives reload for Undo, and backs Technical Details Undo/Redo + History Restore with server history', async ({
    page,
    request,
  }) => {
    const createdRes = await request.post('/api/projects', {
      data: {
        name: '集团采购合同履约平台',
        code: `ONT_HIST_${Date.now().toString(36).toUpperCase()}`,
        center: 'APPLICATION',
        domain: 'contract_lifecycle',
        template: 'CONTRACT',
      },
    });
    expect(createdRes.ok()).toBe(true);
    const { project } = (await createdRes.json()) as { project: { id: string } };

    await page.goto(`/?projectId=${project.id}&mode=app-ontology`);
    await expect(page.getByTestId('business-model-business-view')).toBeVisible();

    const agentPanel = page.getByTestId('agent-panel');
    await expect(agentPanel).toBeVisible();

    // Switch to Counterparty (AGG-02) so we can verify click-to-locate jumps back to Contract (AGG-01)
    await page.getByTestId('bm-nav-object-AGG-02').click();
    await expect(page.getByTestId('bm-nav-object-AGG-02')).toHaveAttribute('aria-current', 'page');

    // 1. Read-only inspection turn -> NO Change Summary & NO Undo
    await page
      .getByTestId('agent-panel-composer-input')
      .fill('请检查当前业务模型的结构与状态');
    await page.getByTestId('agent-panel-send-btn').click();

    await expect(
      agentPanel.locator(
        '[data-testid="conversation-assistant-reply"][data-run-status="SUCCEEDED"]',
      ),
    ).toHaveCount(1, { timeout: 25_000 });
    await expect(agentPanel.getByTestId('run-change-summary')).toHaveCount(0);
    await expect(agentPanel.getByTestId('change-summary-undo-btn')).toHaveCount(0);

    // 2. Mutating Copilot turn -> adds Action "提交审批" on "合同" -> inline Change Summary strip appears
    await page
      .getByTestId('agent-panel-composer-input')
      .fill('请在合同上新增业务操作『提交审批』');
    await page.getByTestId('agent-panel-send-btn').click();

    const changeSummary = agentPanel.getByTestId('run-change-summary');
    await expect(changeSummary).toHaveCount(1, { timeout: 25_000 });
    await expect(changeSummary.getByTestId('change-summary-undo-btn')).toBeVisible();
    await changeSummary.getByTestId('change-summary-toggle-btn').click();
    await expect(changeSummary).toContainText('合同');
    await expect(changeSummary).toContainText('在『合同』上新增业务操作『提交审批』');
    await expect(changeSummary.getByTestId('change-summary-reason')).toBeVisible();

    // 3. Click Change Summary item -> jumps canvas from AGG-02 back to AGG-01 (合同) & flashes the new action!
    await changeSummary.getByTestId('change-summary-item').first().click();
    await expect(page.getByTestId('bm-nav-object-AGG-01')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('business-object-title')).toContainText('合同');
    const flashedAction = page.locator('[data-testid="object-section-actions"] [data-flash="true"]');
    await expect(flashedAction).toHaveCount(1);
    await expect(flashedAction).toContainText('提交审批');

    // 4. Reload browser -> Change Summary & 1-click Undo survive reload and revert the Copilot change!
    await page.reload();
    await expect(page.getByTestId('business-model-business-view')).toBeVisible();
    const reloadedSummary = agentPanel.getByTestId('run-change-summary');
    await expect(reloadedSummary).toHaveCount(1);
    await expect(reloadedSummary.getByTestId('change-summary-undo-btn')).toBeVisible();

    await reloadedSummary.getByTestId('change-summary-undo-btn').click();
    await expect(page.getByTestId('object-section-actions')).not.toContainText('提交审批');
    await expect(reloadedSummary.getByTestId('change-summary-undone-badge')).toBeVisible();

    // 5. Technical Details edit + Undo + Redo backed 100% by server history across reloads!
    await page.getByTestId('open-technical-details-btn').click();
    await expect(page.getByTestId('business-model-technical-view')).toBeVisible();
    await page.getByTestId('model-nav-M1').click();

    await page.getByTestId('add-model-item-btn').click();
    await expect(page.locator('.workbench-left')).toContainText('AGG-04');
    await expect(page.getByTestId('undo-btn')).toBeEnabled();
    await expect(page.getByTestId('redo-btn')).toBeDisabled();

    // Reload browser before clicking undo-btn -> server history keeps undo-btn enabled!
    await page.reload();
    await expect(page.getByTestId('business-model-technical-view')).toBeVisible();
    await expect(page.locator('.workbench-left')).toContainText('AGG-04');
    await expect(page.getByTestId('undo-btn')).toBeEnabled();
    await expect(page.getByTestId('redo-btn')).toBeDisabled();

    // Click Undo in Technical Details -> removes AGG-04 and enables Redo!
    await page.getByTestId('undo-btn').click();
    await expect(page.locator('.workbench-left')).not.toContainText('AGG-04');
    await expect(page.getByTestId('undo-btn')).toBeDisabled();
    await expect(page.getByTestId('redo-btn')).toBeEnabled();

    // Reload browser before clicking redo-btn -> server history keeps redo-btn enabled!
    await page.reload();
    await expect(page.getByTestId('business-model-technical-view')).toBeVisible();
    await expect(page.getByTestId('redo-btn')).toBeEnabled();

    await page.getByTestId('redo-btn').click();
    await expect(page.locator('.workbench-left')).toContainText('AGG-04');
    await expect(page.getByTestId('undo-btn')).toBeEnabled();
    await expect(page.getByTestId('redo-btn')).toBeDisabled();

    // 6. Return to Business View -> open History Drawer -> append-only Restore to before earliest change + Undo of Restore!
    await page.getByTestId('back-to-business-view-btn').click();
    await expect(page.getByTestId('business-model-business-view')).toBeVisible();
    await expect(page.getByTestId('bm-nav-object-AGG-04')).toBeVisible();

    await page.getByTestId('business-model-history-btn').click();
    const historyDrawer = page.getByTestId('artifact-history-drawer');
    await expect(historyDrawer).toBeVisible();
    // Timeline has: 1) Copilot run, 2) Undo of Copilot run, 3) Manual AGG-04 add, 4) Undo, 5) Redo = 5 entries
    await expect(historyDrawer.getByTestId('artifact-history-item')).toHaveCount(5);

    await historyDrawer
      .getByTestId('artifact-history-item')
      .last()
      .getByTestId('history-restore-before-btn')
      .click();

    await expect(historyDrawer.getByTestId('artifact-history-item')).toHaveCount(6);
    await expect(page.getByTestId('bm-nav-object-AGG-04')).toHaveCount(0);

    // Undo the Restore itself -> brings AGG-04 back!
    await historyDrawer.getByTestId('history-undo-latest-btn').click();
    await expect(historyDrawer.getByTestId('artifact-history-item')).toHaveCount(7);
    await expect(page.getByTestId('bm-nav-object-AGG-04')).toBeVisible();
  });
});
