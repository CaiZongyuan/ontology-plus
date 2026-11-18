import { expect, test } from '@playwright/test';

test.describe('Requirements Change Summary, Reload-Persistent Undo & Append-Only Restore (#65)', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('omits Change Summary on zero-diff runs, renders computed section Change Summary + jump-to-section on mutating runs, persists Undo across browser reload, and supports append-only Restore + Undo of Restore', async ({
    page,
    request,
  }) => {
    const createdRes = await request.post('/api/projects', {
      data: {
        name: '疫苗冷链追溯验收系统',
        code: `VAC_HIST_${Date.now().toString(36).toUpperCase()}`,
        center: 'APPLICATION',
        domain: '生物制品冷链追溯',
        template: 'EMPTY',
      },
    });
    expect(createdRes.ok()).toBe(true);
    const { project } = (await createdRes.json()) as { project: { id: string } };

    await page.goto(`/?projectId=${project.id}&mode=app-req-docs`);
    await expect(page.getByTestId('requirements-step-canvas')).toBeVisible();

    const agentPanel = page.getByTestId('agent-panel');
    await expect(agentPanel).toBeVisible();

    // 1. Exploratory turn that records domain signals without modifying RequirementDoc -> NO Change Summary & NO Undo
    await page
      .getByTestId('agent-panel-composer-input')
      .fill('疾控中心收货时需核对疫苗批签发合格证与全程冷链温度记录');
    await page.getByTestId('agent-panel-send-btn').click();

    await expect(page.getByTestId('requirements-forming-outline')).toBeVisible({
      timeout: 25_000,
    });
    await expect(agentPanel.getByTestId('agent-run-card')).toHaveCount(0);
    await expect(agentPanel.getByTestId('conversation-turn')).toHaveCount(1);
    await expect(agentPanel.getByTestId('run-change-summary')).toHaveCount(0);
    await expect(agentPanel.getByTestId('change-summary-undo-btn')).toHaveCount(0);

    // 2. Synthesize Requirements Document -> computed section Change Summary + 1-sentence reason + Undo appear
    await page.getByTestId('synthesize-srs-btn').click();
    await expect(page.getByTestId('requirements-document-sections')).toBeVisible({
      timeout: 25_000,
    });

    const changeSummary = agentPanel.getByTestId('run-change-summary');
    await expect(changeSummary).toHaveCount(1);
    await expect(changeSummary.getByTestId('change-summary-reason')).toBeVisible();
    await expect(changeSummary.getByTestId('change-summary-undo-btn')).toBeVisible();
    const sectionItems = changeSummary.getByTestId('change-summary-item');
    expect(await sectionItems.count()).toBeGreaterThanOrEqual(5);

    // Confirm Requirements so sections collapse by default, then click a Change Summary item to jump & expand/highlight!
    await page.getByTestId('confirm-requirements-btn').click();
    await expect(page.getByTestId('step-status-REQUIREMENTS')).toHaveText('已确认');

    // Click the 2nd section item in the Change Summary -> expands & highlights that section on the canvas
    await sectionItems.nth(1).click();
    const highlightedSection = page.locator('[data-highlighted="true"]');
    await expect(highlightedSection).toHaveCount(1);
    await expect(highlightedSection.locator('button').first()).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    // 3. Edit Requirements manually on the canvas -> supersedes the AI run as latest change
    await page.getByTestId('edit-requirements-inline-btn').click();
    const inlineTextarea = page.getByTestId('requirements-inline-textarea');
    await expect(inlineTextarea).toBeVisible();
    const synthesizedMd = await inlineTextarea.inputValue();
    await inlineTextarea.fill(
      `${synthesizedMd}\n\n## 10. 断链应急封存规程\n- 运输途中超温超过 30 分钟须立即隔离封存并上报质量负责人。\n`,
    );
    await page.getByTestId('save-requirements-inline-btn').click();

    await expect(page.getByTestId('step-status-REQUIREMENTS')).toHaveText('有未确认的修改');
    await expect(page.getByTestId('requirements-document-sections')).toContainText(
      '断链应急封存规程',
    );
    // Earlier AI run card keeps its Change Summary, and no longer shows 1-click Undo
    await expect(agentPanel.getByTestId('run-change-summary')).toHaveCount(1);
    await expect(agentPanel.getByTestId('change-summary-undo-btn')).toHaveCount(0);

    // 4. Reload browser -> history & Undo survive reload!
    await page.reload();
    await expect(page.getByTestId('requirements-step-canvas')).toBeVisible();
    await expect(agentPanel.getByTestId('run-change-summary')).toHaveCount(1);
    await expect(page.getByTestId('step-status-REQUIREMENTS')).toHaveText('有未确认的修改');

    // Open History drawer and 1-click Undo the manual edit after reload
    await page.getByTestId('requirements-history-btn').click();
    const historyDrawer = page.getByTestId('artifact-history-drawer');
    await expect(historyDrawer).toBeVisible();
    await expect(historyDrawer.getByTestId('artifact-history-item')).toHaveCount(2);
    await expect(historyDrawer.getByTestId('history-undo-latest-btn')).toBeVisible();
    await expect(historyDrawer.getByTestId('history-restore-before-btn')).toHaveCount(1);

    await historyDrawer.getByTestId('history-undo-latest-btn').click();

    // Manual edit is undone: step returns to CONFIRMED and section 10 is gone!
    await expect(page.getByTestId('step-status-REQUIREMENTS')).toHaveText('已确认');
    await expect(page.getByTestId('requirements-document-sections')).not.toContainText(
      '断链应急封存规程',
    );

    // 5. Append-only Restore to BEFORE the initial SRS synthesis (earliest item in timeline)
    const historyItemsAfterUndo = historyDrawer.getByTestId('artifact-history-item');
    await expect(historyItemsAfterUndo).toHaveCount(3);
    await historyItemsAfterUndo
      .last()
      .getByTestId('history-restore-before-btn')
      .click();

    // Document is restored to the pre-synthesis state (forming outline, no document sections), while preserving all 4 history rows!
    await expect(historyDrawer.getByTestId('artifact-history-item')).toHaveCount(4);
    await expect(page.getByTestId('requirements-document-sections')).toHaveCount(0);
    await expect(page.getByTestId('requirements-forming-outline')).toBeVisible();

    // 6. Undo the Restore itself via 1-click Undo -> brings back the synthesized Requirements Document!
    await historyDrawer.getByTestId('history-undo-latest-btn').click();
    await expect(historyDrawer.getByTestId('artifact-history-item')).toHaveCount(5);
    await expect(page.getByTestId('requirements-document-sections')).toBeVisible();
    await expect(page.getByTestId('step-status-REQUIREMENTS')).toHaveText('已确认');
  });
});
