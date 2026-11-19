import { expect, test, type Page } from '@playwright/test';
import {
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
} from '../src/packages/business-vocabulary/index.js';

async function assertLiveBusinessViewClean(page: Page, stepLabel: string) {
  const shellHtml = await page.locator('.wb-shell').evaluate((el) => el.outerHTML);
  const violations = checkBusinessViewMarkup(shellHtml);
  expect(violations, `[${stepLabel}]\n${formatBusinessViewViolations(violations)}`).toEqual([]);
}

test.describe('Full End-to-End Business User Journey (#74)', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('walks from bare "/" Home one-sentence creation through Requirements, Prototype, cascading Outdated, Business Model confirmation, and Delivery readiness with Change Summaries, 1-click Undo, zero jargon leaks, and zero blocking dialogs', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    let createdProjectId = '';

    try {
      // 1. Open bare "/" -> lands on Home ('overview'), enter one-sentence system description & submit
      await page.goto('/');
      await expect(page.getByTestId('home-view')).toBeVisible();
      await assertLiveBusinessViewClean(page, 'Home (bare /)');

      const description =
        '我想做一个合同管理系统：管理供应商准入、合同起草会签、用印归档与履约付款结算。';
      const homeInput = page.getByTestId('home-description-input');
      const homeSubmit = page.getByTestId('home-create-submit-btn');
      await homeInput.fill(description);
      await expect(homeSubmit).toBeEnabled();
      await homeSubmit.click();

      // Lands directly in Requirements conversation with description sent as first user turn
      await expect(page.getByTestId('step-tab-REQUIREMENTS')).toHaveAttribute(
        'aria-current',
        'step',
      );
      const agentPanel = page.getByTestId('agent-panel');
      await expect(agentPanel).toBeVisible();
      await expect(agentPanel).toContainText(description);
      await expect(
        agentPanel.locator('[data-testid="conversation-turn"][data-run-status="SUCCEEDED"]').last(),
      ).toBeVisible({ timeout: 30_000 });
      await expect(agentPanel.getByTestId('agent-run-card')).toHaveCount(0);

      createdProjectId = await page.getByTestId('project-selector').inputValue();
      expect(createdProjectId).toBeTruthy();
      expect(createdProjectId).not.toBe('proj-contract');

      await expect(page.getByTestId('requirements-forming-outline')).toBeVisible();
      await assertLiveBusinessViewClean(page, 'Requirements after initial turn');

      // 2. Synthesize Requirements Document -> verify Change Summary -> 1-click Undo -> re-synthesize -> Confirm Requirements
      await page.getByTestId('synthesize-srs-btn').click();
      await expect(page.getByTestId('requirements-document-sections')).toBeVisible({
        timeout: 30_000,
      });

      const reqChangeSummary = agentPanel.getByTestId('run-change-summary').last();
      await expect(reqChangeSummary).toBeVisible();
      await reqChangeSummary.getByTestId('change-summary-toggle-btn').click();
      await expect(reqChangeSummary.getByTestId('change-summary-reason')).toBeVisible();
      await expect(reqChangeSummary.getByTestId('change-summary-undo-btn')).toBeVisible();
      await assertLiveBusinessViewClean(page, 'Requirements draft + Change Summary');

      // 1-click Undo reverts synthesized document back to forming outline
      await reqChangeSummary.getByTestId('change-summary-undo-btn').click();
      await expect(reqChangeSummary.getByTestId('change-summary-undone-badge')).toBeVisible();
      await expect(page.getByTestId('requirements-document-sections')).toHaveCount(0);
      await expect(page.getByTestId('requirements-forming-outline')).toBeVisible();

      // Re-synthesize and confirm Requirements -> unlocks Prototype
      await page.getByTestId('synthesize-srs-btn').click();
      await expect(page.getByTestId('requirements-document-sections')).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId('step-status-PROTOTYPE')).toHaveText('需先确认需求');

      await page.getByTestId('confirm-requirements-btn').click();
      await expect(page.getByTestId('step-status-REQUIREMENTS')).toHaveText('已确认');
      await expect(page.getByTestId('step-status-PROTOTYPE')).toHaveText('未开始');
      await expect(page.getByTestId('go-to-prototype-btn')).toBeVisible();
      await assertLiveBusinessViewClean(page, 'Requirements CONFIRMED');

      // 3. Enter Prototype -> generate initial prototype -> refine via AI Assistant -> Change Summary & Undo -> preview Screen Changes & Confirm
      await page.getByTestId('go-to-prototype-btn').click();
      await expect(page.getByTestId('step-tab-PROTOTYPE')).toHaveAttribute('aria-current', 'step');
      await expect(page.getByTestId('prototype-briefing-stage')).toBeVisible();
      await assertLiveBusinessViewClean(page, 'Prototype Briefing Stage');

      await page.getByTestId('confirm-brief-generate-btn').click();
      await expect(page.getByTestId('prototype-canvas-stage')).toBeVisible({ timeout: 30_000 });
      await expect(
        agentPanel
          .locator('[data-testid="conversation-assistant-reply"][data-run-status="SUCCEEDED"]')
          .last(),
      ).toBeVisible({ timeout: 30_000 });
      await expect(agentPanel.getByTestId('agent-run-card')).toHaveCount(0);
      await expect(page.getByTestId('step-status-PROTOTYPE')).toHaveText('进行中');

      // Refine prototype via AI Assistant -> creates R2 with computed Change Summary & Undo
      await page.getByTestId('agent-panel-composer-input').fill('增加归档状态筛选框');
      await page.getByTestId('agent-panel-send-btn').click();

      const protoChangeSummary = agentPanel.getByTestId('run-change-summary').last();
      await expect(protoChangeSummary).toBeVisible({ timeout: 30_000 });
      await expect(protoChangeSummary.getByTestId('change-summary-undo-btn')).toBeVisible();
      await expect(page.getByTestId('prototype-history-btn')).toContainText('R2');
      await assertLiveBusinessViewClean(page, 'Prototype refined + Change Summary');

      // Test 1-click Undo on Prototype refinement -> reverts to R1 content (appended as R3)
      await protoChangeSummary.getByTestId('change-summary-undo-btn').click();
      await expect(protoChangeSummary.getByTestId('change-summary-undone-badge')).toBeVisible();
      await expect(page.getByTestId('prototype-history-btn')).toContainText('R3');

      // Apply a clean refinement (R4) and preview Screen Changes before confirming Prototype
      await page.getByTestId('agent-panel-composer-input').fill('增加法务审核状态筛选栏');
      await page.getByTestId('agent-panel-send-btn').click();
      await expect(page.getByTestId('prototype-history-btn')).toContainText('R4', {
        timeout: 30_000,
      });

      await page.getByTestId('prototype-confirm-revision-btn').click();
      const confirmProtoModal = page.getByTestId('confirm-revision-mu-diff-modal');
      await expect(confirmProtoModal).toBeVisible();
      await expect(confirmProtoModal.getByTestId('confirm-screen-changes-summary')).toBeVisible();
      await expect(confirmProtoModal.getByTestId('confirm-screen-changes-list')).toBeVisible();
      const modalHtml = await confirmProtoModal.evaluate((el) => el.outerHTML);
      expect(checkBusinessViewMarkup(modalHtml)).toEqual([]);

      await confirmProtoModal.getByTestId('confirm-revision-approve-btn').click();
      await expect(confirmProtoModal).toBeHidden();
      await expect(page.getByTestId('step-status-PROTOTYPE')).toHaveText('已确认');
      await expect(page.getByTestId('go-to-business-model-btn')).toBeVisible();
      await assertLiveBusinessViewClean(page, 'Prototype CONFIRMED');

      // 4. Return to Requirements -> edit ("有未确认的修改") -> re-confirm -> verify Prototype becomes "待更新" while keeping content intact -> confirm Prototype
      await page.getByTestId('step-tab-REQUIREMENTS').click();
      await page.getByTestId('edit-requirements-inline-btn').click();
      const inlineTextarea = page.getByTestId('requirements-inline-textarea');
      const existingMarkdown = await inlineTextarea.inputValue();
      await inlineTextarea.fill(
        `${existingMarkdown}\n\n## 补充用印归档要求\n- 已盖章合同必须登记纸质原件归档柜号。\n`,
      );
      await page.getByTestId('save-requirements-inline-btn').click();

      await expect(page.getByTestId('step-status-REQUIREMENTS')).toHaveText('有未确认的修改');
      await expect(page.getByTestId('step-status-PROTOTYPE')).toHaveText('已确认');

      await page.getByTestId('confirm-requirements-btn').click();
      await expect(page.getByTestId('step-status-REQUIREMENTS')).toHaveText('已确认');
      await expect(page.getByTestId('step-status-PROTOTYPE')).toHaveText('待更新');

      await page.getByTestId('step-tab-PROTOTYPE').click();
      await expect(page.getByTestId('prototype-outdated-banner')).toBeVisible();
      await expect(page.getByTestId('prototype-canvas-stage')).toBeVisible();
      await assertLiveBusinessViewClean(page, 'Prototype OUTDATED');

      await page.getByTestId('prototype-confirm-as-is-btn').click();
      await expect(page.getByTestId('prototype-outdated-banner')).toBeHidden();
      await expect(page.getByTestId('step-status-PROTOTYPE')).toHaveText('已确认');

      // 5. Enter Business Model -> synthesize from confirmed Prototype -> verify Business Objects, grouped Change Summary, click-to-jump, 1-click Undo & Confirm Business Model
      await page.getByTestId('step-tab-BUSINESS_MODEL').click();
      await expect(page.getByTestId('step-tab-BUSINESS_MODEL')).toHaveAttribute(
        'aria-current',
        'step',
      );
      await expect(page.getByTestId('business-model-empty-state')).toBeVisible();
      await expect(page.getByTestId('organize-business-model-btn')).toBeVisible();
      await assertLiveBusinessViewClean(page, 'Business Model Empty State');

      await page.getByTestId('organize-business-model-btn').click();
      await expect(page.getByTestId('business-object-page')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('business-object-title')).toContainText('合同');
      await expect(page.getByTestId('business-model-problems-card')).toHaveCount(0);
      await expect(page.getByTestId('shell-health-status')).toContainText('没有需要修正的问题');

      const synthSummary = agentPanel.getByTestId('run-change-summary').last();
      await expect(synthSummary).toBeVisible();
      await synthSummary.getByTestId('change-summary-toggle-btn').click();
      await expect(synthSummary).toContainText('合同');
      await assertLiveBusinessViewClean(page, 'Business Model synthesized');

      // Navigate to Cross-Object Flows view, add an Action on "合同" via AI Assistant, click Change Summary item to jump back to "合同", then 1-click Undo!
      await page.getByTestId('bm-nav-flows').click();
      await expect(page.getByTestId('cross-view-flows')).toBeVisible();

      await page
        .getByTestId('agent-panel-composer-input')
        .fill('请在合同上新增业务操作『提交归档复核』');
      await page.getByTestId('agent-panel-send-btn').click();

      await expect(agentPanel.getByTestId('run-change-summary')).toHaveCount(2, {
        timeout: 30_000,
      });
      const actionSummary = agentPanel.getByTestId('run-change-summary').last();
      await actionSummary.getByTestId('change-summary-toggle-btn').click();
      await expect(actionSummary).toContainText('合同');
      await expect(actionSummary).toContainText('提交归档复核');

      // Click Change Summary item -> jumps from cross-view-flows back to Business Object "合同" & flashes the added action
      await actionSummary.getByTestId('change-summary-item').first().click();
      await expect(page.getByTestId('business-object-title')).toContainText('合同');
      await expect(
        page.locator('[data-testid="object-section-actions"] [data-flash="true"]'),
      ).toContainText('提交归档复核');

      // 1-click Undo reverts the added action while keeping synthesized Business Objects intact
      await actionSummary.getByTestId('change-summary-undo-btn').click();
      await expect(actionSummary.getByTestId('change-summary-undone-badge')).toBeVisible();
      await expect(page.getByTestId('object-section-actions')).not.toContainText('提交归档复核');
      await expect(page.getByTestId('business-model-problems-card')).toHaveCount(0);

      // Confirm Business Model with zero "需要修正的问题"
      await expect(page.getByTestId('confirm-business-model-btn')).toBeEnabled();
      await page.getByTestId('confirm-business-model-btn').click();
      await expect(page.getByTestId('step-status-BUSINESS_MODEL')).toHaveText('已确认');
      await expect(page.getByTestId('business-model-status-banner')).toHaveAttribute(
        'data-step-state',
        'CONFIRMED',
      );
      await expect(page.getByTestId('go-to-delivery-btn')).toBeVisible();
      await assertLiveBusinessViewClean(page, 'Business Model CONFIRMED');

      // 6. Inspect Delivery readiness & RunnableSystemSlot
      await page.getByTestId('go-to-delivery-btn').click();
      await expect(page.getByTestId('delivery-business-view')).toBeVisible();
      await expect(page.getByTestId('delivery-status-banner')).toHaveAttribute(
        'data-step-state',
        'IN_PROGRESS',
      );
      await expect(page.getByTestId('delivery-readiness-check')).toContainText('业务模型已确认');
      await expect(page.getByTestId('delivery-readiness-check')).toContainText(
        '没有需要修正的问题',
      );
      await expect(page.getByTestId('runnable-system-slot')).toContainText(
        '蓝图已就绪，可交付开发',
      );
      await assertLiveBusinessViewClean(page, 'Delivery Readiness');
    } finally {
      await request.post('/api/projects/active', { data: { projectId: 'proj-contract' } });
      if (createdProjectId && createdProjectId !== 'proj-contract') {
        await request.delete(`/api/projects/${createdProjectId}?force=true`);
      }
    }
  });
});
