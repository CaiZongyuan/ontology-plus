import { expect, test } from '@playwright/test';

test.describe('Step Hand-off (#72): Cross-Step Proposal Card, Decline, Ready Accept & Blocked-Step Accept', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('proposes handoff in Prototype, stays put with zero side effects on Decline, and delivers request to an unstarted Business Model step (#48 Decision #3) where AI Assistant explains missing upstream confirmation', async ({
    page,
    request,
  }) => {
    const createdRes = await request.post('/api/projects', {
      data: {
        name: '设备采购审批工作台',
        code: `EQUIP_HANDOFF_${Date.now().toString(36).toUpperCase()}`,
        center: 'APPLICATION',
        domain: '采购与设备验收',
        template: 'EMPTY',
      },
    });
    expect(createdRes.ok()).toBe(true);
    const { project } = (await createdRes.json()) as { project: { id: string } };

    // Confirm Requirements v1.0 and create an UNCONFIRMED draft prototype -> BUSINESS_MODEL is still blocked ("需先确认原型")
    const docId = `rdoc-handoff-${Date.now().toString(36)}`;
    const docRes = await request.post('/api/requirements/docs', {
      data: {
        id: docId,
        projectId: project.id,
        title: '设备采购审批需求文档',
        version: 'v1.0',
        status: 'DRAFT',
        content: [
          '# 设备采购审批需求文档',
          '',
          '## 1. 业务范围',
          '- 围绕**设备采购单**（EquipmentOrder）管理申购、比价与验收。',
        ].join('\n'),
      },
    });
    expect(docRes.ok()).toBe(true);
    const confirmReqRes = await request.post(
      `/api/projects/${project.id}/steps/requirements/confirm`,
      { data: { docId } },
    );
    expect(confirmReqRes.ok()).toBe(true);

    const protoRes = await request.post(`/api/projects/${project.id}/prototypes`, {
      data: {
        name: '设备采购草稿原型',
        source: 'GENERATED',
        htmlContent:
          '<section data-screen-id="SCR-EQ-LIST" data-screen-name="设备采购台账" data-screen-type="LIST"><button type="button" data-element-id="EL-NEW-EQ" data-element-type="BUTTON">新建采购单</button></section>',
      },
    });
    expect(protoRes.ok()).toBe(true);

    await page.goto(`/?projectId=${project.id}&mode=app-prototype`);
    await expect(page.getByTestId('step-tab-PROTOTYPE')).toHaveAttribute('aria-current', 'step');
    await expect(page.getByTestId('step-status-BUSINESS_MODEL')).toHaveText('需先确认原型');

    const agentPanel = page.getByTestId('agent-panel');
    await expect(agentPanel).toBeVisible();

    // 1. Ask a Business Model approval rule question inside Prototype -> proposes hand-off card
    const firstPrompt = '采购订单超过 50 万元要总经理审批';
    await page.getByTestId('agent-panel-composer-input').fill(firstPrompt);
    await page.getByTestId('agent-panel-send-btn').click();

    const firstHandoffCard = agentPanel.getByTestId('step-handoff-card').last();
    await expect(firstHandoffCard).toBeVisible({ timeout: 25_000 });
    await expect(firstHandoffCard).toHaveAttribute('data-handoff-status', 'PENDING');
    await expect(firstHandoffCard.getByTestId('step-handoff-request')).toContainText(firstPrompt);
    await expect(firstHandoffCard.getByTestId('step-handoff-accept-btn')).toContainText(
      '转到该步骤继续',
    );
    await expect(firstHandoffCard.getByTestId('step-handoff-decline-btn')).toContainText(
      '留在这里',
    );

    // 2. Click Decline ("留在这里") -> stays on Prototype, collapses to 1-line summary, zero side effects
    await firstHandoffCard.getByTestId('step-handoff-decline-btn').click();
    await expect(firstHandoffCard).toHaveAttribute('data-handoff-status', 'DECLINED');
    await expect(firstHandoffCard.getByTestId('step-handoff-resolved')).toBeVisible();
    await expect(page.getByTestId('step-tab-PROTOTYPE')).toHaveAttribute('aria-current', 'step');

    const checkAfterDecline = await (
      await request.get(`/api/projects/${project.id}`)
    ).json();
    expect(checkAfterDecline.prototypes[0].revisions).toHaveLength(1);
    expect(checkAfterDecline.project.validation.presentModels).toEqual([]);
    expect(
      checkAfterDecline.agentSessions.filter(
        (s: { agentKind: string }) => s.agentKind === 'COPILOT',
      ),
    ).toHaveLength(0);

    // 3. Propose handoff again and click Accept -> navigates to unstarted BUSINESS_MODEL & delivers request!
    const secondPrompt = '新增采购订单超过 50 万元必须由总经理审批的业务规则';
    await page.getByTestId('agent-panel-composer-input').fill(secondPrompt);
    await page.getByTestId('agent-panel-send-btn').click();

    const secondHandoffCard = agentPanel.getByTestId('step-handoff-card').last();
    await expect(secondHandoffCard).toHaveAttribute('data-handoff-status', 'PENDING', {
      timeout: 25_000,
    });
    await secondHandoffCard.getByTestId('step-handoff-accept-btn').click();

    // Arrives at BUSINESS_MODEL (which cannot start yet because Prototype is unconfirmed)
    await expect(page.getByTestId('step-tab-BUSINESS_MODEL')).toHaveAttribute(
      'aria-current',
      'step',
    );
    await expect(page.getByTestId('step-status-BUSINESS_MODEL')).toHaveText('需先确认原型');

    // Request is delivered as a user turn and AI Assistant replies explaining Prototype confirmation is needed first
    await expect(
      agentPanel
        .locator('[data-testid="conversation-assistant-reply"][data-run-status="SUCCEEDED"]')
        .last(),
    ).toBeVisible({ timeout: 25_000 });
    await expect(agentPanel.getByTestId('agent-turn-user').last()).toContainText(secondPrompt);
    await expect(agentPanel.getByTestId('agent-turn-handoff-origin').last()).toContainText('原型');
    await expect(agentPanel.getByTestId('conversation-assistant-markdown').last()).toContainText(
      /原型.*确认/,
    );

    // Zero downstream models were silently created while BUSINESS_MODEL cannot start yet
    const checkAfterBlockedAccept = await (
      await request.get(`/api/projects/${project.id}`)
    ).json();
    expect(checkAfterBlockedAccept.project.validation.presentModels).toEqual([]);
  });

  test('hands off from Prototype to a ready Business Model step on proj-contract, executes in target session, and supports zh-CN & en-US copy', async ({
    page,
  }) => {
    await page.goto('/?projectId=proj-contract&mode=app-prototype');
    await expect(page.getByTestId('step-tab-PROTOTYPE')).toHaveAttribute('aria-current', 'step');

    const agentPanel = page.getByTestId('agent-panel');
    await expect(agentPanel).toBeVisible();

    const ruleRequest = '新增框架采购合同超过 100 万元要总经理审批的业务规则';
    await page.getByTestId('agent-panel-composer-input').fill(ruleRequest);
    await page.getByTestId('agent-panel-send-btn').click();

    const handoffCard = agentPanel.getByTestId('step-handoff-card').last();
    await expect(handoffCard).toHaveAttribute('data-handoff-status', 'PENDING', {
      timeout: 25_000,
    });

    // Verify bilingual toggle on the live Step Hand-off card
    await page.getByTestId('locale-toggle-btn').click();
    await expect(handoffCard).toContainText('Hand off to Business Model?');
    await expect(handoffCard.getByTestId('step-handoff-accept-btn')).toContainText(
      'Continue in Business Model',
    );
    await expect(handoffCard.getByTestId('step-handoff-decline-btn')).toContainText('Stay here');
    await page.getByTestId('locale-toggle-btn').click();
    await expect(handoffCard.getByTestId('step-handoff-accept-btn')).toContainText(
      '转到该步骤继续',
    );

    // Accept -> navigates to BUSINESS_MODEL and runs in Business Model's current conversation
    await handoffCard.getByTestId('step-handoff-accept-btn').click();
    await expect(page.getByTestId('step-tab-BUSINESS_MODEL')).toHaveAttribute(
      'aria-current',
      'step',
    );
    await expect(
      agentPanel
        .locator('[data-testid="conversation-assistant-reply"][data-run-status="SUCCEEDED"]')
        .last(),
    ).toBeVisible({ timeout: 25_000 });
    await expect(agentPanel.getByTestId('agent-turn-user').last()).toContainText(ruleRequest);
    await expect(agentPanel.getByTestId('conversation-assistant-markdown').last()).toBeVisible();

    // Returning to Prototype shows the collapsed ACCEPTED 1-line summary
    await page.getByTestId('step-tab-PROTOTYPE').click();
    const resolvedCard = agentPanel.getByTestId('step-handoff-card').last();
    await expect(resolvedCard).toHaveAttribute('data-handoff-status', 'ACCEPTED');
    await expect(resolvedCard.getByTestId('step-handoff-resolved')).toContainText('业务模型');
  });
});
