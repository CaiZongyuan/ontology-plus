import { expect, test } from '@playwright/test';

test.describe('Home Screen: One-Sentence Project Creation & Step Status (#61)', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('renders 3 starter examples on first use, fills input without auto-submitting, creates project into Requirements chat, and tracks project step status on Home', async ({
    page,
  }) => {
    // 1. Intercept only the first bootstrap load so Home opens in the first-use (0 projects) state
    await page.route(
      '**/api/bootstrap*',
      async (route) => {
        const upstream = await route.fetch();
        const json = (await upstream.json()) as Record<string, unknown>;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...json, projects: [] }),
        });
      },
      { times: 1 },
    );

    await page.goto('/#/overview');
    await expect(page.getByTestId('home-view')).toBeVisible();
    await expect(page.getByTestId('home-project-list')).toBeHidden();

    const input = page.getByTestId('home-description-input');
    const submitBtn = page.getByTestId('home-create-submit-btn');
    await expect(input).toBeVisible();
    await expect(submitBtn).toBeDisabled();

    // 2. Verify all 3 clickable examples in zh-CN & en-US
    await expect(page.getByTestId('home-example-0')).toContainText('合同管理');
    await expect(page.getByTestId('home-example-1')).toContainText('供应商准入');
    await expect(page.getByTestId('home-example-2')).toContainText('售后工单');

    await page.getByTestId('locale-toggle-btn').click();
    await expect(page.getByTestId('home-example-0')).toContainText('Contract Management');
    await expect(page.getByTestId('home-example-1')).toContainText('Supplier Onboarding');
    await expect(page.getByTestId('home-example-2')).toContainText('After-Sales Service');
    await page.getByTestId('locale-toggle-btn').click();

    // 3. Clicking an example fills and focuses the input WITHOUT auto-submitting
    let createProjectCalled = false;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/api/projects')) {
        createProjectCalled = true;
      }
    });

    const expectedSentence =
      '管理供应商准入：供应商在线提交资质，采购和质量部门分别审核，每年做一次评估，不合格的暂停合作。';
    await page.getByTestId('home-example-1').click();
    await expect(input).toHaveValue(expectedSentence);
    await expect(input).toBeFocused();
    await expect(submitBtn).toBeEnabled();
    await expect(page.getByTestId('home-view')).toBeVisible();
    expect(createProjectCalled).toBe(false);

    // 4. Submit creates the project, navigates directly into REQUIREMENTS, and sends description as first user message
    await submitBtn.click();

    await expect(page.getByTestId('step-tab-REQUIREMENTS')).toHaveAttribute('aria-current', 'step');
    const agentPanel = page.getByTestId('agent-panel');
    await expect(agentPanel).toBeVisible();
    await expect(agentPanel).toContainText(expectedSentence);
    await expect(
      agentPanel.locator('[data-testid="agent-run-card"][data-run-status="SUCCEEDED"]').last(),
    ).toBeVisible({ timeout: 25_000 });

    // Capture new project ID from project selector
    const createdProjectId = await page.getByTestId('project-selector').inputValue();
    expect(createdProjectId).toBeTruthy();
    expect(createdProjectId).not.toBe('proj-contract');

    // 5. Return to Home and verify the new project and existing projects show their step & status
    await page.getByTestId('nav-overview').click();
    await expect(page.getByTestId('home-view')).toBeVisible();
    await expect(page.getByTestId('home-example-0')).toBeHidden();
    await expect(page.getByTestId('home-project-list')).toBeVisible();

    await expect(page.getByTestId(`home-project-row-${createdProjectId}`)).toContainText(
      '管理供应商准入',
    );
    await expect(page.getByTestId(`home-project-step-${createdProjectId}`)).toContainText(
      '需求 · 进行中',
    );
    await expect(page.getByTestId('home-project-step-proj-contract')).toContainText(
      /交付 · (进行中|已确认)/,
    );
    await expect(page.getByTestId('home-project-step-proj-mft')).toContainText(
      '业务模型 · 进行中',
    );

    // 6. Clean up the created test project via non-blocking ConfirmDialog so shared workspace stays clean
    await page.getByTestId(`home-project-more-btn-${createdProjectId}`).click();
    await page.getByTestId(`home-project-delete-btn-${createdProjectId}`).click();
    await expect(page.getByTestId('home-delete-project-dialog')).toBeVisible();
    await page.getByTestId('home-delete-project-dialog-confirm-btn').click();
    await expect(page.getByTestId(`home-project-row-${createdProjectId}`)).toBeHidden();

    // 7. Clicking an existing project row opens it directly at its current active step
    await page.getByTestId('home-open-project-proj-mft').click();
    await expect(page.getByTestId('project-selector')).toHaveValue('proj-mft');
    await expect(page.getByTestId('step-tab-BUSINESS_MODEL')).toHaveAttribute(
      'aria-current',
      'step',
    );
    await page.getByTestId('project-selector').selectOption('proj-contract');
    await expect(page.getByTestId('project-selector')).toHaveValue('proj-contract');
  });
});
