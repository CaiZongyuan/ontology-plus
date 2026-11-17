import { expect, test } from '@playwright/test';

test.describe('Prototype Unified Change Summary, Reload-Persistent Undo & Append-Only Restore (#67)', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('renders computed screen Change Summary on AI refinement runs, opens side-by-side compare, persists 1-click Undo across reload, and supports Undo-of-Undo (Redo) & undoable append-only Restore', async ({
    page,
    request,
  }) => {
    // 1. Setup isolated project with confirmed Requirements and confirmed baseline R1 prototype
    const createdRes = await request.post('/api/projects', {
      data: {
        name: '合同档案借阅工作台',
        code: `PROTO_HIST_${Date.now().toString(36).toUpperCase()}`,
        center: 'APPLICATION',
        domain: '合同档案借阅管理',
        template: 'EMPTY',
      },
    });
    expect(createdRes.ok()).toBe(true);
    const { project } = (await createdRes.json()) as { project: { id: string } };

    const docRes = await request.post('/api/requirements/docs', {
      data: {
        id: `rdoc-arch-${Date.now().toString(36)}`,
        projectId: project.id,
        title: '合同档案借阅需求书',
        version: 'v1.0',
        status: 'DRAFT',
        content: [
          '# 合同档案借阅需求书',
          '',
          '## 1. 核心业务范围',
          '- 管理纸质合同归档台账、线上借阅登记与超期催还。',
        ].join('\n'),
      },
    });
    expect(docRes.ok()).toBe(true);
    const { doc } = (await docRes.json()) as { doc: { id: string } };

    const reqConfRes = await request.post(
      `/api/projects/${project.id}/steps/requirements/confirm`,
      { data: { docId: doc.id } },
    );
    expect(reqConfRes.ok()).toBe(true);

    const baselineHtml = [
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>合同归档台账</title></head><body>',
      '<section data-screen-id="SCR-01" data-screen-name="合同归档台账" data-screen-type="LIST">',
      '  <h1>合同归档台账</h1>',
      '  <input type="text" placeholder="归档编号" data-element-id="EL-01" data-element-type="INPUT" data-element-label="归档编号" />',
      '  <button type="button" data-element-id="EL-02" data-element-type="BUTTON" data-element-label="登记借阅">登记借阅</button>',
      '</section>',
      '</body></html>',
    ].join('\n');

    const protoCreateRes = await request.post(`/api/projects/${project.id}/prototypes`, {
      data: {
        name: '合同归档台账原型',
        htmlContent: baselineHtml,
        source: 'GENERATED',
        title: '初始归档台账基线',
      },
    });
    expect(protoCreateRes.ok()).toBe(true);
    const {
      prototype: createdProto,
      revision: rev1,
    } = (await protoCreateRes.json()) as {
      prototype: { id: string };
      revision: { id: string };
    };

    const protoConfRes = await request.post(
      `/api/projects/${project.id}/prototypes/confirm-revision`,
      { data: { revisionId: rev1.id } },
    );
    expect(protoConfRes.ok()).toBe(true);

    // 2. Open Prototype step -> verify baseline R1 on Canvas Stage
    await page.goto(`/?projectId=${project.id}&mode=app-prototype`);
    await expect(page.getByTestId('prototype-canvas-stage')).toBeVisible();
    await expect(page.getByTestId('step-status-PROTOTYPE')).toHaveText('已确认');
    await expect(page.getByTestId('prototype-history-btn')).toContainText('R1');

    const agentPanel = page.getByTestId('agent-panel');
    await expect(agentPanel).toBeVisible();

    // 3. Refine prototype via AI Assistant -> creates R2 and renders computed screen Change Summary
    await page
      .getByTestId('agent-panel-composer-input')
      .fill('增加借阅状态筛选框');
    await page.getByTestId('agent-panel-send-btn').click();

    const changeSummary = agentPanel.getByTestId('run-change-summary');
    await expect(changeSummary).toHaveCount(1, { timeout: 25_000 });
    await expect(changeSummary).toContainText('合同归档台账');
    await expect(changeSummary).toContainText('增加借阅状态筛选框');
    await expect(changeSummary.getByTestId('change-summary-reason')).toBeVisible();
    await expect(changeSummary.getByTestId('change-summary-compare-btn')).toBeVisible();
    await expect(changeSummary.getByTestId('change-summary-undo-btn')).toBeVisible();
    await expect(page.getByTestId('prototype-history-btn')).toContainText('R2');
    await expect(page.getByTestId('step-status-PROTOTYPE')).toHaveText('有未确认的修改');

    // 4. Click "对比" on Change Summary -> opens side-by-side revision compare in Business View
    await changeSummary.getByTestId('change-summary-compare-btn').click();
    const revDrawer = page.getByTestId('prototype-revision-history-drawer');
    await expect(revDrawer).toBeVisible();
    await expect(revDrawer.getByTestId('revision-side-by-side-compare')).toBeVisible();
    await expect(revDrawer.getByTestId('compare-mu-diff-section')).toContainText(
      '增加借阅状态筛选框',
    );
    await revDrawer.getByTestId('revision-drawer-close-btn').click();
    await expect(revDrawer).toBeHidden();

    // Click Change Summary item -> locates target screen/control on canvas
    await changeSummary.getByTestId('change-summary-item').first().click();
    await expect(page.getByTestId('prototype-canvas-stage')).toBeVisible();

    // 5. Reload browser -> Change Summary & 1-click Undo survive reload and revert to R1's HTML!
    await page.reload();
    await expect(page.getByTestId('prototype-canvas-stage')).toBeVisible();
    const reloadedSummary = agentPanel.getByTestId('run-change-summary');
    await expect(reloadedSummary).toHaveCount(1);
    await expect(reloadedSummary.getByTestId('change-summary-undo-btn')).toBeVisible();

    await reloadedSummary.getByTestId('change-summary-undo-btn').click();
    await expect(reloadedSummary.getByTestId('change-summary-undone-badge')).toBeVisible();
    await expect(page.getByTestId('prototype-history-btn')).toContainText('R3');

    const protosAfterUndo = (await (
      await request.get(`/api/projects/${project.id}/prototypes`)
    ).json()) as { prototypes: { id: string; htmlContent: string }[] };
    expect(protosAfterUndo.prototypes[0]!.htmlContent).not.toContain('增加借阅状态筛选框');

    // 6. Open unified History Drawer -> Undo the Undo (Redo!) brings back R2's refinement!
    await reloadedSummary.getByTestId('change-summary-open-history-btn').click();
    const historyDrawer = page.getByTestId('artifact-history-drawer');
    await expect(historyDrawer).toBeVisible();
    // Timeline has R2 (AI run) + R3 (Undo of R2) = 2 entries
    await expect(historyDrawer.getByTestId('artifact-history-item')).toHaveCount(2);

    await historyDrawer.getByTestId('history-undo-latest-btn').click();
    await expect(historyDrawer.getByTestId('artifact-history-item')).toHaveCount(3);
    await expect(reloadedSummary.getByTestId('change-summary-undone-badge')).toHaveCount(0);
    await expect(page.getByTestId('prototype-history-btn')).toContainText('R4');

    const protosAfterRedo = (await (
      await request.get(`/api/projects/${project.id}/prototypes`)
    ).json()) as { prototypes: { id: string; htmlContent: string }[] };
    expect(protosAfterRedo.prototypes[0]!.htmlContent).toContain('增加借阅状态筛选框');

    // Close History Drawer, make a second AI refinement (R5), then append-only Restore to BEFORE R2 + Undo of Restore!
    await page.keyboard.press('Escape');
    await expect(historyDrawer).toBeHidden();

    await page
      .getByTestId('agent-panel-composer-input')
      .fill('增加批量催还按钮');
    await page.getByTestId('agent-panel-send-btn').click();
    await expect(agentPanel.getByTestId('run-change-summary')).toHaveCount(2, {
      timeout: 25_000,
    });
    await expect(page.getByTestId('prototype-history-btn')).toContainText('R5');

    // Open History Drawer via the superseded first run card's "查看历史" button
    await agentPanel
      .getByTestId('run-change-summary')
      .first()
      .getByTestId('change-summary-open-history-btn')
      .click();
    await expect(historyDrawer).toBeVisible();
    await expect(historyDrawer.getByTestId('artifact-history-item')).toHaveCount(4);

    // Click "恢复到此改动之前" on earliest entry (R2) -> appends R6 restoring baseline R1 without destroying R2..R5!
    await historyDrawer
      .getByTestId('artifact-history-item')
      .last()
      .getByTestId('history-restore-before-btn')
      .click();
    await expect(historyDrawer.getByTestId('artifact-history-item')).toHaveCount(5);
    await expect(page.getByTestId('prototype-history-btn')).toContainText('R6');

    const protosAfterRestore = (await (
      await request.get(`/api/projects/${project.id}/prototypes`)
    ).json()) as { prototypes: { htmlContent: string; revisions: unknown[] }[] };
    expect(protosAfterRestore.prototypes[0]!.revisions).toHaveLength(6);
    expect(protosAfterRestore.prototypes[0]!.htmlContent).not.toContain('增加借阅状态筛选框');
    expect(protosAfterRestore.prototypes[0]!.htmlContent).not.toContain('增加批量催还按钮');

    // Undo the Restore itself -> appends R7 bringing back both refinements!
    await historyDrawer.getByTestId('history-undo-latest-btn').click();
    await expect(historyDrawer.getByTestId('artifact-history-item')).toHaveCount(6);
    await expect(page.getByTestId('prototype-history-btn')).toContainText('R7');

    const protosAfterUndoRestore = (await (
      await request.get(`/api/projects/${project.id}/prototypes`)
    ).json()) as { prototypes: { id: string; htmlContent: string; revisions: unknown[] }[] };
    expect(protosAfterUndoRestore.prototypes[0]!.id).toBe(createdProto.id);
    expect(protosAfterUndoRestore.prototypes[0]!.revisions).toHaveLength(7);
    expect(protosAfterUndoRestore.prototypes[0]!.htmlContent).toContain('增加借阅状态筛选框');
    expect(protosAfterUndoRestore.prototypes[0]!.htmlContent).toContain('增加批量催还按钮');
  });
});
