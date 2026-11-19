import { expect, test } from '@playwright/test';

test.describe('Business Model Step Confirmation, Plain-Language Problems & Cascading OUTDATED (#71)', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('blocks confirmation when Consistency Errors exist, resolves problems via AI Assistant, confirms Business Model, and handles both "不需要改动，按现状确认" & "让 AI 助手更新" when Prototype re-confirms', async ({
    page,
    request,
  }) => {
    const cloneRes = await request.post('/api/projects/proj-contract/clone', {
      data: {
        name: '业务模型步骤确认测试项目',
        code: `E2E_BM_CONFIRM_${Date.now().toString(36).toUpperCase()}`,
      },
    });
    expect(cloneRes.ok()).toBe(true);
    const { project: cloned } = (await cloneRes.json()) as { project: { id: string } };

    try {
      // Ensure deterministic CONFIRMED baseline on the cloned project regardless of prior specs' edits to proj-contract
      const initProtoConf = await request.post(
        `/api/projects/${cloned.id}/steps/prototype/confirm`,
        { data: {} },
      );
      expect(initProtoConf.ok()).toBe(true);
      const initBmConf = await request.post(
        `/api/projects/${cloned.id}/steps/business-model/confirm`,
        { data: {} },
      );
      expect(initBmConf.ok()).toBe(true);

      await page.goto(`/?projectId=${cloned.id}&mode=app-ontology`);
      await expect(page.getByTestId('business-model-business-view')).toBeVisible();
      await expect(page.getByTestId('step-status-BUSINESS_MODEL')).toHaveText('已确认');
      await expect(page.getByTestId('business-model-status-banner')).toHaveAttribute(
        'data-step-state',
        'CONFIRMED',
      );
      await expect(page.getByTestId('go-to-delivery-btn')).toBeVisible();

      // 1. Open Technical Details & introduce a Consistency Error on M2 BHV-01 (dangling ownerEntity)
      await page.getByTestId('open-technical-details-btn').click();
      await expect(page.getByTestId('business-model-technical-view')).toBeVisible();
      await page.getByTestId('model-nav-M2').click();

      const ownerInput = page.locator('#onto-card-BHV-01 input[list="m1-agg-datalist"]');
      await expect(ownerInput).toBeVisible();
      await ownerInput.fill('UnknownGhostEntity');
      await page.getByTestId('structured-save-btn').click();
      await expect(page.getByTestId('validation-error-badge')).not.toContainText('0 Errors');

      // 2. Return to Business View -> see "需要修正的问题" in plain language & confirm button blocked!
      await page.getByTestId('back-to-business-view-btn').click();
      await expect(page.getByTestId('business-model-business-view')).toBeVisible();
      await expect(page.getByTestId('step-status-BUSINESS_MODEL')).toHaveText('有未确认的修改');
      await expect(page.getByTestId('confirm-business-model-btn')).toBeDisabled();

      const problemsCard = page.getByTestId('business-model-problems-card');
      await expect(problemsCard).toBeVisible();
      await expect(problemsCard).toContainText('需要修正的问题');
      await expect(problemsCard).toContainText('起草合同');
      await expect(problemsCard).not.toContainText(/BHV-01|M2_DANGLING_OWNER_ENTITY|\bM2\b/);

      // 3. Click "让 AI 助手处理" -> dispatches COPILOT run, clears Consistency Error, and unlocks confirmation!
      const agentPanel = page.getByTestId('agent-panel');
      await page.getByTestId('fix-problems-with-assistant-btn').click();
      await expect(
        agentPanel
          .locator('[data-testid="conversation-assistant-reply"][data-run-status="SUCCEEDED"]')
          .last(),
      ).toBeVisible({ timeout: 25_000 });
      await expect(agentPanel.getByTestId('run-change-summary').last()).toBeVisible();

      await expect(page.getByTestId('business-model-problems-card')).toHaveCount(0);
      await expect(page.getByTestId('confirm-business-model-btn')).toBeEnabled();

      // 4. Confirm Business Model -> step becomes "已确认" and offers "去交付"
      await page.getByTestId('confirm-business-model-btn').click();
      await expect(page.getByTestId('step-status-BUSINESS_MODEL')).toHaveText('已确认');
      await expect(page.getByTestId('business-model-status-banner')).toHaveAttribute(
        'data-step-state',
        'CONFIRMED',
      );
      await expect(page.getByTestId('go-to-delivery-btn')).toBeVisible();

      // 4b. Verify "尚未完成的部分" (Stage Warning) is collapsed by default, non-blocking for confirmation, and completable via AI Assistant!
      const bootRes = await request.get(`/api/bootstrap?projectId=${cloned.id}`);
      const bootJson = (await bootRes.json()) as {
        activeProject: { suite: Record<string, unknown> };
      };
      const suiteMissingMi = { ...bootJson.activeProject.suite };
      delete suiteMissingMi.MI;
      const putSuiteRes = await request.put(`/api/projects/${cloned.id}/suite`, {
        data: { suite: suiteMissingMi, note: '暂不填写对外接口说明' },
      });
      expect(putSuiteRes.ok()).toBe(true);

      await page.reload();
      const incompleteCard = page.getByTestId('business-model-incomplete-card');
      await expect(incompleteCard).toBeVisible();
      await expect(page.getByTestId('toggle-incomplete-parts-btn')).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      await expect(incompleteCard).toContainText('对外接口');
      await expect(incompleteCard).not.toContainText(/\bMI\b/);
      // Non-blocking Stage Warning still allows confirming Business Model!
      await expect(page.getByTestId('confirm-business-model-btn')).toBeEnabled();

      await page.getByTestId('toggle-incomplete-parts-btn').click();
      await expect(page.getByTestId('complete-missing-with-assistant-btn')).toBeVisible();
      await page.getByTestId('complete-missing-with-assistant-btn').click();
      await expect(
        agentPanel
          .locator('[data-testid="conversation-assistant-reply"][data-run-status="SUCCEEDED"]')
          .last(),
      ).toBeVisible({ timeout: 25_000 });
      await expect(page.getByTestId('business-model-incomplete-card')).toHaveCount(0);

      await page.getByTestId('confirm-business-model-btn').click();
      await expect(page.getByTestId('step-status-BUSINESS_MODEL')).toHaveText('已确认');

      // 5. Re-confirm Prototype (clean cosmetic revision R2) -> Business Model becomes "待更新" while objects stay intact
      const protosRes = await request.get(`/api/projects/${cloned.id}/prototypes`);
      expect(protosRes.ok()).toBe(true);
      const protosJson = (await protosRes.json()) as {
        prototypes: { id: string; htmlContent: string }[];
      };
      const proto = protosJson.prototypes[0]!;

      const rev2Res = await request.post(`/api/prototypes/${proto.id}/revisions`, {
        data: {
          title: '微调列表间距',
          htmlContent: `${proto.htmlContent}\n<!-- layout spacing tweak -->`,
        },
      });
      expect(rev2Res.ok()).toBe(true);
      const rev2Json = (await rev2Res.json()) as { revision: { id: string } };

      const confirmProto2Res = await request.post(
        `/api/projects/${cloned.id}/prototypes/confirm-revision`,
        { data: { revisionId: rev2Json.revision.id } },
      );
      expect(confirmProto2Res.ok()).toBe(true);

      await page.reload();
      await expect(page.getByTestId('business-model-business-view')).toBeVisible();
      await expect(page.getByTestId('step-status-BUSINESS_MODEL')).toHaveText('待更新');
      await expect(page.getByTestId('business-object-title')).toHaveText('合同');

      const outdatedBanner = page.getByTestId('business-model-outdated-banner');
      await expect(outdatedBanner).toBeVisible();
      await expect(outdatedBanner).toContainText('原型有了新的确认');
      await expect(page.getByTestId('business-model-ask-assistant-update-btn')).toBeEnabled();
      await expect(page.getByTestId('business-model-confirm-as-is-btn')).toBeEnabled();

      // Test "不需要改动，按现状确认" -> transitions Business Model back to "已确认"!
      await page.getByTestId('business-model-confirm-as-is-btn').click();
      await expect(outdatedBanner).toBeHidden();
      await expect(page.getByTestId('step-status-BUSINESS_MODEL')).toHaveText('已确认');

      // 6. Re-confirm Prototype R3 adding a new bound field "纸质归档柜号" (Contract.archiveCabinetNo)
      const htmlWithArchiveField = proto.htmlContent.replace(
        '</section>',
        `  <div><input data-element-id="EL-CONTRACT-ARCHIVE-NO" data-element-label="纸质归档柜号" data-element-type="INPUT" data-binding="Contract.archiveCabinetNo" /></div>\n  </section>`,
      );
      const rev3Res = await request.post(`/api/prototypes/${proto.id}/revisions`, {
        data: {
          title: '补充纸质归档柜号输入框',
          htmlContent: htmlWithArchiveField,
        },
      });
      expect(rev3Res.ok()).toBe(true);
      const rev3Json = (await rev3Res.json()) as { revision: { id: string } };

      const confirmProto3Res = await request.post(
        `/api/projects/${cloned.id}/prototypes/confirm-revision`,
        { data: { revisionId: rev3Json.revision.id } },
      );
      expect(confirmProto3Res.ok()).toBe(true);

      await page.reload();
      await expect(page.getByTestId('step-status-BUSINESS_MODEL')).toHaveText('待更新');
      await expect(page.getByTestId('business-model-outdated-banner')).toBeVisible();
      // Because Contract.archiveCabinetNo is not yet on Contract in M1, errorCount > 0 -> "按现状确认" is blocked!
      await expect(page.getByTestId('business-model-confirm-as-is-btn')).toBeDisabled();

      // Test "让 AI 助手更新" -> aligns Contract.archiveCabinetNo with Change Summary & Undo, then confirm!
      const summaryCountBefore = await agentPanel.getByTestId('run-change-summary').count();
      await page.getByTestId('business-model-ask-assistant-update-btn').click();
      await expect(agentPanel.getByTestId('run-change-summary')).toHaveCount(
        summaryCountBefore + 1,
        { timeout: 25_000 },
      );
      await expect(
        agentPanel
          .locator('[data-testid="conversation-assistant-reply"][data-run-status="SUCCEEDED"]')
          .last(),
      ).toBeVisible({ timeout: 25_000 });
      const alignSummary = agentPanel.getByTestId('run-change-summary').last();
      await alignSummary.getByTestId('change-summary-toggle-btn').click();
      await expect(alignSummary).toContainText('纸质归档柜号');
      await expect(page.getByTestId('object-section-fields')).toContainText('纸质归档柜号');

      await expect(page.getByTestId('confirm-business-model-btn')).toBeEnabled();
      await page.getByTestId('confirm-business-model-btn').click();
      await expect(page.getByTestId('step-status-BUSINESS_MODEL')).toHaveText('已确认');
      await expect(page.getByTestId('business-model-outdated-banner')).toBeHidden();
    } finally {
      await request.delete(`/api/projects/${cloned.id}?force=true`);
    }
  });
});
