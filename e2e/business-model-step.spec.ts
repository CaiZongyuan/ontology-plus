import { expect, test } from '@playwright/test';

test.describe('Business Model Step (#68): Business Object Projection, Technical Details Locator & Command Palette', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('browses Business Objects & Cross-Object Views, expands collapsed sections, locates exact element in Technical Details, remembers per-step mode across reload, and jumps via Command Palette & legacy URLs', async ({
    page,
  }) => {
    await page.goto('/?projectId=proj-contract');

    // 1. Default is Business View with zero legacy 3-button subview bar
    await expect(page.getByTestId('business-model-business-view')).toBeVisible();
    await expect(page.getByTestId('step-subview-bar')).toHaveCount(0);
    await expect(page.getByTestId('nav-app-ontology')).toHaveCount(0);
    await expect(page.getByTestId('nav-app-model-files')).toHaveCount(0);
    await expect(page.getByTestId('nav-app-knowledge-graph')).toHaveCount(0);

    // 2. Verify Business Object pages & Cross-Object views in left directory
    await expect(page.getByTestId('bm-nav-object-AGG-01')).toContainText('合同');
    await expect(page.getByTestId('bm-nav-object-AGG-02')).toContainText('签约相对方');
    await expect(page.getByTestId('bm-nav-object-AGG-03')).toContainText('履约结算单');
    await expect(page.getByTestId('bm-nav-flows')).toContainText('流程与审批');
    await expect(page.getByTestId('bm-nav-roles')).toContainText('角色与权限');
    await expect(page.getByTestId('bm-nav-reports')).toContainText('查询与报表');

    // 3. Default expanded vs default collapsed sections on Business Object "合同"
    await expect(page.getByTestId('business-object-title')).toHaveText('合同');
    for (const sec of ['fields', 'actions', 'businessRules', 'authorizedRoles']) {
      await expect(page.getByTestId(`object-section-toggle-${sec}`)).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    }
    for (const sec of ['events', 'automations', 'screens', 'integrations', 'dataStorage']) {
      await expect(page.getByTestId(`object-section-toggle-${sec}`)).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    }

    // Expand a collapsed section ("业务事件")
    await page.getByTestId('object-section-toggle-events').click();
    await expect(page.getByTestId('object-section-toggle-events')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(page.getByTestId('object-section-events')).toContainText('合同草稿已创建');

    // 4. Cross-object M3 rule appears identically on "合同" and "履约结算单"
    const contractRuleText = await page
      .getByTestId('business-rule-text-RULE-03')
      .innerText();
    expect(contractRuleText).toContain('累计结算不超合同总额守恒规则');
    await page
      .getByTestId('shared-rule-links-RULE-03')
      .getByRole('button', { name: /履约结算单/ })
      .click();
    await expect(page.getByTestId('business-object-title')).toHaveText('履约结算单');
    expect(await page.getByTestId('business-rule-text-RULE-03').innerText()).toBe(
      contractRuleText,
    );

    // Browse the 3 cross-object views
    await page.getByTestId('bm-nav-flows').click();
    await expect(page.getByTestId('cross-view-flows')).toContainText('合同起草与风险分级审批主流程');
    await page.getByTestId('bm-nav-roles').click();
    await expect(page.getByTestId('cross-view-roles')).toContainText('合同专员');
    await page.getByTestId('bm-nav-reports').click();
    await expect(page.getByTestId('cross-view-reports')).toContainText('合同全量台账分页查询');

    // 5. Select Business Object "签约相对方" (AGG-02) -> Open Technical Details -> locates M1 / AGG-02
    await page.getByTestId('bm-nav-object-AGG-02').click();
    await expect(page.getByTestId('business-object-title')).toHaveText('签约相对方');
    await page.getByTestId('open-technical-details-btn').click();

    await expect(page.getByTestId('business-model-technical-view')).toBeVisible();
    await expect(page.getByTestId('model-nav-M1')).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.owb-selection-chip')).toContainText('AGG-02');
    await expect(page.getByTestId('validation-error-badge')).toContainText('0 Errors');

    // Switch across Knowledge Graph & Model Files sub-tabs inside Technical Details
    await page.getByTestId('tech-tab-graph').click();
    await expect(page.getByTestId('kg-root')).toBeVisible();
    await page.getByTestId('tech-tab-files').click();
    await expect(page.getByTestId('export-owl-btn')).toBeVisible();
    await page.getByTestId('tech-tab-editor').click();
    await expect(page.getByTestId('validation-error-badge')).toBeVisible();

    // 6. Reload remembers Technical Details per step (without any global switch)
    await page.reload();
    await expect(page.getByTestId('business-model-technical-view')).toBeVisible();
    const storedModes = await page.evaluate(() => ({
      businessModel: localStorage.getItem('onto_step_view_mode_BUSINESS_MODEL'),
      requirements: localStorage.getItem('onto_step_view_mode_REQUIREMENTS'),
      delivery: localStorage.getItem('onto_step_view_mode_DELIVERY'),
    }));
    expect(storedModes).toEqual({
      businessModel: 'technical',
      requirements: null,
      delivery: null,
    });

    // 7. Return to Business View
    await page.getByTestId('back-to-business-view-btn').click();
    await expect(page.getByTestId('business-model-business-view')).toBeVisible();

    // 8. Command Palette (Ctrl+K) searches Business Objects and jumps directly to selected object
    await page.keyboard.press('Control+k');
    const palette = page.getByTestId('command-palette');
    await expect(palette).toBeVisible();
    await palette.getByRole('textbox').fill('履约结算单');
    await palette.getByRole('option', { name: /履约结算单/ }).click();
    await expect(palette).toBeHidden();
    await expect(page.getByTestId('business-model-business-view')).toBeVisible();
    await expect(page.getByTestId('business-object-title')).toHaveText('履约结算单');

    // 9. Legacy URL backward compatibility (?mode=app-knowledge-graph and ?mode=app-model-files)
    await page.goto('/?projectId=proj-contract&mode=app-knowledge-graph');
    await expect(page.getByTestId('business-model-technical-view')).toBeVisible();
    await expect(page.getByTestId('kg-root')).toBeVisible();

    await page.goto('/?projectId=proj-contract&mode=app-model-files');
    await expect(page.getByTestId('business-model-technical-view')).toBeVisible();
    await expect(page.getByTestId('export-owl-btn')).toBeVisible();
  });
});
