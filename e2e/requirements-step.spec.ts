import { expect, test } from '@playwright/test';

test.describe('Requirements Step, Single-Question Option Card & Cascading Confirmations (#64)', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('redirects legacy ?mode=app-req-explore & ?mode=app-req-docs URLs to unified Requirements step without subview bar, collapses answered option cards to 1 line, unlocks Prototype only after confirming Requirements, and marks Prototype Outdated on re-confirmation', async ({
    page,
    request,
  }) => {
    // Create a clean empty project via HTTP so we exercise the full lifecycle deterministically
    const createdRes = await request.post('/api/projects', {
      data: {
        name: '门店冷链验收系统',
        code: `COLD_STORE_${Date.now().toString(36).toUpperCase()}`,
        center: 'APPLICATION',
        domain: '连锁门店冷链验收',
        template: 'EMPTY',
      },
    });
    expect(createdRes.ok()).toBe(true);
    const { project } = (await createdRes.json()) as { project: { id: string } };

    // 1. Legacy URL compatibility (?mode=app-req-docs and ?mode=app-req-explore) -> unified Requirements step with NO subview bar
    await page.goto(`/?projectId=${project.id}&mode=app-req-docs`);
    await expect(page.getByTestId('step-tab-REQUIREMENTS')).toHaveAttribute('aria-current', 'step');
    await expect(page.getByTestId('requirements-step-canvas')).toBeVisible();
    await expect(page.getByTestId('step-subview-bar')).toHaveCount(0);

    await page.goto(`/?projectId=${project.id}&mode=app-req-explore`);
    await expect(page.getByTestId('step-tab-REQUIREMENTS')).toHaveAttribute('aria-current', 'step');
    await expect(page.getByTestId('requirements-step-canvas')).toBeVisible();
    await expect(page.getByTestId('step-subview-bar')).toHaveCount(0);

    // Initially: Requirements is "未开始", Prototype is blocked ("需先确认需求")
    await expect(page.getByTestId('step-status-REQUIREMENTS')).toHaveText('未开始');
    await expect(page.getByTestId('step-status-PROTOTYPE')).toHaveText('需先确认需求');

    const agentPanel = page.getByTestId('agent-panel');
    await expect(agentPanel).toBeVisible();

    // 2. Converse in Requirements & trigger a single-question option card
    await page
      .getByTestId('agent-panel-composer-input')
      .fill('收货温度超标时我不确定怎么处理，请给我待确认选项让我选择');
    await page.getByTestId('agent-panel-send-btn').click();

    const optionCard = agentPanel.getByTestId('agent-hitl-card').last();
    await expect(optionCard).toBeVisible({ timeout: 25_000 });
    await optionCard.getByTestId('agent-hitl-option-1').click();
    await optionCard.getByTestId('agent-hitl-submit-btn').click();

    // Answered card collapses to a single-line summary showing both question and chosen answer
    const answeredSummary = agentPanel.getByTestId('agent-hitl-answered-summary').last();
    await expect(answeredSummary).toBeVisible({ timeout: 25_000 });
    await expect(answeredSummary).toContainText('收货温度超标');
    await expect(answeredSummary).toContainText('特批会签');
    const summaryHeight = await answeredSummary.evaluate((el) => el.getBoundingClientRect().height);
    expect(summaryHeight).toBeLessThanOrEqual(44);

    // Forming outline appears on the right canvas while Requirements is "进行中"
    await expect(page.getByTestId('step-status-REQUIREMENTS')).toHaveText('进行中');
    await expect(page.getByTestId('requirements-forming-outline')).toBeVisible();

    // 3. Synthesize Requirements Document -> saves as DRAFT (NOT auto-confirmed!), Prototype STILL blocked
    await page.getByTestId('synthesize-srs-btn').click();
    await expect(page.getByTestId('confirm-requirements-btn')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId('requirements-document-sections')).toBeVisible();
    await expect(page.getByTestId('step-status-REQUIREMENTS')).toHaveText('进行中');
    await expect(page.getByTestId('step-status-PROTOTYPE')).toHaveText('需先确认需求');

    // 4. Explicitly confirm Requirements -> Requirements becomes "已确认", Prototype unlocks ("未开始")!
    await page.getByTestId('confirm-requirements-btn').click();
    await expect(page.getByTestId('step-status-REQUIREMENTS')).toHaveText('已确认');
    await expect(page.getByTestId('step-status-PROTOTYPE')).toHaveText('未开始');
    await expect(page.getByTestId('go-to-prototype-btn')).toBeVisible();

    // 5. Generate & confirm a Prototype revision so we can verify downstream cascading OUTDATED
    const protoCreateRes = await request.post(`/api/projects/${project.id}/prototypes`, {
      data: {
        name: '门店冷链验收原型',
        htmlContent:
          '<main data-prototype-root="true"><section data-screen-id="SCR-COLD-LIST" data-screen-name="冷链验收单列表" data-screen-type="LIST"><button data-element-id="EL-ACT-ACCEPT" data-element-type="BUTTON">确认验收</button></section></main>',
        source: 'GENERATED',
      },
    });
    expect(protoCreateRes.ok()).toBe(true);
    const protoJson = (await protoCreateRes.json()) as {
      revision: { id: string };
    };
    const protoConfirmRes = await request.post(
      `/api/projects/${project.id}/prototypes/confirm-revision`,
      {
        data: { revisionId: protoJson.revision.id },
      },
    );
    expect(protoConfirmRes.ok()).toBe(true);

    await page.reload();
    await expect(page.getByTestId('step-status-REQUIREMENTS')).toHaveText('已确认');
    await expect(page.getByTestId('step-status-PROTOTYPE')).toHaveText('已确认');

    // 6. Edit Requirements inline on the canvas -> Requirements becomes "有未确认的修改", Prototype stays "已确认"
    await page.getByTestId('edit-requirements-inline-btn').click();
    const inlineTextarea = page.getByTestId('requirements-inline-textarea');
    await expect(inlineTextarea).toBeVisible();
    const prevMd = await inlineTextarea.inputValue();
    await inlineTextarea.fill(
      `${prevMd}\n\n## 补充冷链复核要求\n- 冰鲜品类温度高于 4 摄氏度时需拍照留档并由店长复核。\n`,
    );
    await page.getByTestId('save-requirements-inline-btn').click();

    await expect(page.getByTestId('step-status-REQUIREMENTS')).toHaveText('有未确认的修改');
    await expect(page.getByTestId('requirements-status-banner')).toContainText('有未确认的修改');
    await expect(page.getByTestId('step-status-PROTOTYPE')).toHaveText('已确认');

    // 7. Re-confirm Requirements -> Requirements becomes "已确认" and Prototype immediately becomes "待更新"!
    await page.getByTestId('confirm-requirements-btn').click();
    await expect(page.getByTestId('step-status-REQUIREMENTS')).toHaveText('已确认');
    await expect(page.getByTestId('step-status-PROTOTYPE')).toHaveText('待更新');
  });
});
