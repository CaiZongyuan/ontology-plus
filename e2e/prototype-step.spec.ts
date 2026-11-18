import { expect, test } from '@playwright/test';

test.describe('Prototype Step: Redesigned Shell, Business Screen Diff & Outdated Actions (#66)', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('generates prototype via canvas button as AI Assistant run, previews screen changes before confirming, preserves prototype when Outdated, and supports both "不需要改动，按现状确认" (cascading Outdated to Business Model) and "让 AI 助手更新"', async ({
    page,
    request,
  }) => {
    // Create an isolated empty project so we exercise the full Prototype lifecycle deterministically
    const createdRes = await request.post('/api/projects', {
      data: {
        name: '供应商准入与评级系统',
        code: `SUPPLIER_PROTO_${Date.now().toString(36).toUpperCase()}`,
        center: 'APPLICATION',
        domain: '采购供应商准入管理',
        template: 'EMPTY',
      },
    });
    expect(createdRes.ok()).toBe(true);
    const { project } = (await createdRes.json()) as { project: { id: string } };

    // 1. Legacy URL compatibility (?mode=app-prototype & #/app-prototype) -> unified PROTOTYPE step with no subview bar
    await page.goto(`/?projectId=${project.id}&mode=app-prototype`);
    await expect(page.getByTestId('step-tab-PROTOTYPE')).toHaveAttribute('aria-current', 'step');
    await expect(page.getByTestId('step-subview-bar')).toHaveCount(0);

    // Before Requirements is confirmed: Prototype step is blocked ("需先确认需求")
    await expect(page.getByTestId('step-status-PROTOTYPE')).toHaveText('需先确认需求');
    await expect(page.getByTestId('prototype-blocked-state')).toBeVisible();

    // Command Palette (Ctrl+K) exposes the unified Prototype step without legacy "界面原型" under All pages
    await page.getByTestId('open-command-palette-btn').click();
    const palette = page.getByTestId('command-palette');
    await expect(palette).toBeVisible();
    await expect(palette).toContainText('原型');
    await expect(palette).not.toContainText('UI Prototype & MU');
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();

    // Also verify hash-route compatibility (#/app-prototype)
    await page.goto(`/?projectId=${project.id}#/app-prototype`);
    await expect(page.getByTestId('step-tab-PROTOTYPE')).toHaveAttribute('aria-current', 'step');
    await expect(page.getByTestId('prototype-blocked-state')).toBeVisible();

    // 2. Save & confirm Requirements v1.0 -> Prototype unlocks into Briefing Stage
    const docSaveRes = await request.post('/api/requirements/docs', {
      data: {
        id: `rdoc-sup-${Date.now().toString(36)}`,
        projectId: project.id,
        title: '供应商准入评审需求文档',
        version: 'v1.0',
        status: 'DRAFT',
        content: [
          '# 供应商准入评审需求文档',
          '',
          '## 1. 核心业务范围',
          '- 围绕**供应商准入申请**（SupplierApplication）与**资质审核记录**（QualificationReview）构建准入台账与审批流。',
          '',
          '## 2. 准入规则',
          '- 年采购额超过 50 万元的供应商必须上传营业执照与质量体系证书并经采购主管复核。',
        ].join('\n'),
      },
    });
    expect(docSaveRes.ok()).toBe(true);
    const { doc: savedDoc } = (await docSaveRes.json()) as { doc: { id: string; content: string } };

    const reqConfirm1 = await request.post(
      `/api/projects/${project.id}/steps/requirements/confirm`,
      { data: { docId: savedDoc.id } },
    );
    expect(reqConfirm1.ok()).toBe(true);

    await page.reload();
    await expect(page.getByTestId('step-status-REQUIREMENTS')).toHaveText('已确认');
    await expect(page.getByTestId('step-status-PROTOTYPE')).toHaveText('未开始');
    await expect(page.getByTestId('prototype-briefing-stage')).toBeVisible();
    await expect(page.getByTestId('visual-reference-picker')).toBeVisible();
    await expect(page.getByTestId('design-brief-card')).toBeVisible();
    await expect(page.getByTestId('style-tile-card')).toBeVisible();

    // 3. Click "确认设计简报并生成原型" on the Briefing canvas -> streams as an AI 助手 run in left panel & enters Canvas Stage
    const agentPanel = page.getByTestId('agent-panel');
    await expect(agentPanel).toBeVisible();
    await page.getByTestId('confirm-brief-generate-btn').click();

    await expect(
      agentPanel.locator('[data-testid="agent-run-card"][data-run-status="SUCCEEDED"]').last(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('prototype-canvas-stage')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('step-status-PROTOTYPE')).toHaveText('进行中');

    // 4. Preview Screen Changes in plain business language before confirming Prototype
    await page.getByTestId('prototype-confirm-revision-btn').click();
    const confirmModal = page.getByTestId('confirm-revision-mu-diff-modal');
    await expect(confirmModal).toBeVisible();
    await expect(confirmModal.getByTestId('confirm-screen-changes-summary')).toBeVisible();
    await expect(confirmModal.getByTestId('confirm-screen-changes-list')).toBeVisible();
    await expect(confirmModal.getByTestId('confirm-screen-changes-list')).toContainText(/新增 \d+ 个界面/);
    await expect(confirmModal.getByTestId('confirm-screen-changes-list')).not.toContainText('未命名');

    await confirmModal.getByTestId('confirm-revision-approve-btn').click();
    await expect(confirmModal).toBeHidden();
    await expect(page.getByTestId('step-status-PROTOTYPE')).toHaveText('已确认');
    await expect(page.getByTestId('go-to-business-model-btn')).toBeVisible();

    // Synthesize & confirm Business Model from the confirmed Prototype so we can verify step-by-step cascading (#48 Decision #1)
    const copilotCreateRes = await request.post('/api/agent-sessions', {
      data: {
        projectId: project.id,
        agentKind: 'COPILOT',
        title: '业务模型整理会话',
      },
    });
    expect(copilotCreateRes.ok()).toBe(true);
    const { session: copilotSession } = (await copilotCreateRes.json()) as {
      session: { id: string };
    };
    const synthRes = await request.post(`/api/agent-sessions/${copilotSession.id}/stream`, {
      data: {
        prompt: '[ACTION:SYNTHESIZE_ONTOLOGY_SUITE {}]\n从已确认原型合成业务模型',
        mockMode: true,
      },
    });
    expect(synthRes.ok()).toBe(true);
    await synthRes.text();

    const bmConfirmRes = await request.post(
      `/api/projects/${project.id}/steps/business-model/confirm`,
      { data: {} },
    );
    expect(bmConfirmRes.ok()).toBe(true);

    await page.reload();
    await expect(page.getByTestId('step-status-REQUIREMENTS')).toHaveText('已确认');
    await expect(page.getByTestId('step-status-PROTOTYPE')).toHaveText('已确认');
    await expect(page.getByTestId('step-status-BUSINESS_MODEL')).toHaveText('已确认');

    // 5. Go back to Requirements, edit inline & re-confirm -> Prototype becomes "待更新", Business Model stays "已确认"!
    await page.getByTestId('step-tab-REQUIREMENTS').click();
    await page.getByTestId('edit-requirements-inline-btn').click();
    const reqTextarea = page.getByTestId('requirements-inline-textarea');
    await reqTextarea.fill(
      `${savedDoc.content}\n\n## 3. 现场考察记录\n- 重点原材料供应商支持登记现场考察评分备注。\n`,
    );
    await page.getByTestId('save-requirements-inline-btn').click();
    await page.getByTestId('confirm-requirements-btn').click();

    await expect(page.getByTestId('step-status-REQUIREMENTS')).toHaveText('已确认');
    await expect(page.getByTestId('step-status-PROTOTYPE')).toHaveText('待更新');
    await expect(page.getByTestId('step-status-BUSINESS_MODEL')).toHaveText('已确认');

    // 6. Return to Prototype -> verify existing prototype canvas is preserved AND Outdated banner shows both actions
    await page.getByTestId('step-tab-PROTOTYPE').click();
    const outdatedBanner = page.getByTestId('prototype-outdated-banner');
    await expect(outdatedBanner).toBeVisible();
    await expect(outdatedBanner).toContainText(
      '需求有了新的确认；原型更新确认后，业务模型也会提示更新。',
    );
    await expect(page.getByTestId('prototype-canvas-stage')).toBeVisible();
    await expect(page.getByTestId('prototype-ask-assistant-update-btn')).toBeVisible();
    await expect(page.getByTestId('prototype-confirm-as-is-btn')).toBeVisible();

    // Click "不需要改动，按现状确认" -> Prototype immediately becomes "已确认" AND Business Model cascades to "待更新"!
    await page.getByTestId('prototype-confirm-as-is-btn').click();
    await expect(outdatedBanner).toBeHidden();
    await expect(page.getByTestId('step-status-PROTOTYPE')).toHaveText('已确认');
    await expect(page.getByTestId('step-status-BUSINESS_MODEL')).toHaveText('待更新');

    // 7. Re-confirm Requirements a second time -> test "让 AI 助手更新" (including <1280px compact pane switch!)
    await page.getByTestId('step-tab-REQUIREMENTS').click();
    await page.getByTestId('edit-requirements-inline-btn').click();
    await page
      .getByTestId('requirements-inline-textarea')
      .fill(`${savedDoc.content}\n\n## 4. 黑名单预警筛选\n- 准入列表支持按黑名单风险状态快速筛选。\n`);
    await page.getByTestId('save-requirements-inline-btn').click();
    await page.getByTestId('confirm-requirements-btn').click();
    await expect(page.getByTestId('step-status-PROTOTYPE')).toHaveText('待更新');

    await page.getByTestId('step-tab-PROTOTYPE').click();
    await expect(page.getByTestId('prototype-outdated-banner')).toBeVisible();

    // Resize to compact (<1280px) viewport on Canvas pane, click "让 AI 助手更新" -> automatically switches to Conversation pane & streams run!
    await page.setViewportSize({ width: 1120, height: 820 });
    await page.getByTestId('workspace-pane-canvas').click();
    await expect(page.getByTestId('project-workspace')).toHaveAttribute(
      'data-active-pane',
      'canvas',
    );

    await page.getByTestId('prototype-ask-assistant-update-btn').click();
    await expect(page.getByTestId('project-workspace')).toHaveAttribute(
      'data-active-pane',
      'conversation',
    );
    await expect(
      page
        .getByTestId('agent-panel')
        .locator('[data-testid="agent-run-card"][data-run-status="SUCCEEDED"]')
        .last(),
    ).toBeVisible({ timeout: 30_000 });

    // Restore desktop viewport -> new revision R2 is ready on Canvas -> preview Screen Changes & confirm R2 -> clears Outdated!
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId('prototype-history-btn')).toContainText('R2');
    await page.getByTestId('prototype-confirm-revision-btn').click();
    await expect(page.getByTestId('confirm-revision-mu-diff-modal')).toBeVisible();
    await page.getByTestId('confirm-revision-approve-btn').click();

    await expect(page.getByTestId('prototype-outdated-banner')).toBeHidden();
    await expect(page.getByTestId('step-status-PROTOTYPE')).toHaveText('已确认');
  });
});
