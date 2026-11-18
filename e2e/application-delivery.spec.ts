import fs from 'node:fs';
import { expect, test } from '@playwright/test';

test('confirms a selected prototype revision in Technical Details, previews a fixed English package and downloads that snapshot after source changes', async ({ page, request }, testInfo) => {
  page.on('dialog', (dialog) => { throw new Error(`Blocking browser dialog: ${dialog.message()}`); });
  const bootstrap = await (await request.get('/api/bootstrap?projectId=proj-contract')).json();
  const confirmed = bootstrap.confirmedPrototypeRevision;
  const appended = await (await request.post(`/api/prototypes/${confirmed.prototypeId}/revisions`, {
    data: { htmlContent: `${confirmed.htmlContent}\n<!-- APPLICATION_PACKAGE_REVISION -->`, title: 'Application package review candidate' },
  })).json();
  await page.goto('/?step=delivery');
  await expect(page.getByTestId('delivery-business-view')).toBeVisible();
  await page.getByTestId('open-technical-details-btn').click();
  await expect(page.getByTestId('application-development-workflow')).toBeVisible();
  await page.getByTestId('development-prototype-revision').selectOption(appended.revision.id);
  await expect(page.getByTestId('confirm-revision-mu-diff-modal')).toBeVisible();
  await page.getByTestId('confirm-revision-approve-btn').click();
  await expect(page.getByTestId('confirm-revision-mu-diff-modal')).not.toBeVisible();
  await expect(page.getByTestId('development-prototype-revision')).toHaveValue(appended.revision.id);
  // Confirming a new prototype revision synced MU; confirm the updated Business Model so Delivery compiles the confirmed snapshot
  const confirmBm = await request.post('/api/projects/proj-contract/steps/business-model/confirm', { data: {} });
  expect(confirmBm.ok()).toBe(true);
  await page.getByTestId('compile-dev-package-btn').click();
  await expect(page.getByTestId('compiled-package-inspector')).toBeVisible();
  await expect(page.getByTestId('package-preview-path')).toHaveText('AGENTS.md');
  await expect(page.getByTestId('package-file-preview').getByRole('heading', { name: 'Coding agent instructions' })).toBeVisible();
  await page.getByTestId('package-file-preview').getByRole('link', { name: 'Architecture', exact: true }).click();
  await expect(page.getByTestId('package-preview-path')).toHaveText('docs/architecture.md');
  const applicationId = await page.getByTestId('development-application-select').inputValue();
  const first = await (await request.get(`/api/applications/${applicationId}/package`)).json();
  expect(first.stale).toBe(false);
  expect(first.compiledPackage.manifestJson.sources.prototype.revisionId).toBe(appended.revision.id);
  const original = await request.get(`/api/applications/${applicationId}/package.zip?snapshotId=${first.compiledPackage.snapshotId}`);
  const originalBytes = await original.body();

  await page.getByTestId('application-development-instructions').fill('Preserve the reviewed UI and verify the revised retention requirement.');
  await page.getByTestId('save-application-instructions-btn').click();
  await expect(page.getByTestId('package-stale-indicator')).toContainText(/待更新|Outdated/);
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('download-package-zip-btn').click();
  const download = await downloadPromise;
  const downloadPath = testInfo.outputPath('reviewed-development-package.zip');
  await download.saveAs(downloadPath);
  expect(fs.readFileSync(downloadPath)).toEqual(originalBytes);
  await page.reload();
  await page.getByTestId('step-tab-DELIVERY').click();
  await expect(page.getByTestId('saved-package-snapshot')).toContainText(first.compiledPackage.snapshotId);
  await page.getByTestId('compile-dev-package-btn').click();
  await expect.poll(async () => (await (await request.get(`/api/applications/${applicationId}/package`)).json()).compiledPackage.snapshotId)
    .not.toBe(first.compiledPackage.snapshotId);
});

test('keeps architecture authoring in Technical Details separate from Delivery CODING review and renders assistant Markdown', async ({ page, request }) => {
  page.on('dialog', (dialog) => { throw new Error(`Blocking browser dialog: ${dialog.message()}`); });
  await page.goto('/?step=delivery');
  await expect(page.getByTestId('delivery-business-view')).toBeVisible();
  const panel = page.getByTestId('agent-panel');
  await page.getByTestId('agent-panel-composer-input').fill('Review this application input specification.');
  await page.getByTestId('agent-panel-send-btn').click();
  await expect(panel.locator('[data-tool-name="read_application_inputs"]').last()).toBeAttached();
  await expect(panel.getByTestId('agent-run-text').getByRole('heading', { name: /Application specification input review|应用规格输入检查/ })).toBeVisible();

  await page.getByTestId('open-technical-details-btn').click();
  await page.getByTestId('delivery-tech-tab-standards').click();
  await expect(panel.getByTestId('assistant-panel-title')).toHaveText(/^(AI 助手|AI Assistant)$/);
  await expect(panel.getByTestId('assistant-panel-subtitle')).toContainText(/编写与维护开发规范|Authoring development standards/);
  await expect(panel.locator('[data-tool-name="read_application_inputs"]')).toHaveCount(0);
  await page.getByTestId('agent-panel-composer-input').fill('Inspect the repository standards catalog.');
  await page.getByTestId('agent-panel-send-btn').click();
  await expect(panel.locator('[data-tool-name="read_architecture_assets"]').last()).toBeAttached();

  await page.getByTestId('back-to-business-view-btn').click();
  await expect(page.getByTestId('delivery-business-view')).toBeVisible();
  await expect(panel.locator('[data-tool-name="read_application_inputs"]').last()).toBeAttached();

  const sessions = (await (await request.get('/api/agent-sessions?projectId=proj-contract')).json()).agentSessions;
  expect(sessions.some((session: { agentKind: string }) => session.agentKind === 'ARCHITECTURE')).toBe(true);
  expect(sessions.some((session: { agentKind: string }) => session.agentKind === 'CODING')).toBe(true);
});

test('walks Delivery Business View through NOT_STARTED, IN_PROGRESS, CONFIRMED, and OUTDATED with RunnableSystemSlot and automatic platform defaults (#73)', async ({ page, request }) => {
  page.on('dialog', (dialog) => { throw new Error(`Blocking browser dialog: ${dialog.message()}`); });
  const created = await (await request.post('/api/projects', {
    data: { description: '做一个供应商准入与年度复评系统：供应商提交资质材料，采购与质量会签审批。' },
  })).json();
  const projectId = created.project.id as string;

  await request.post('/api/requirements/docs', {
    data: {
      id: `rdoc-${projectId}`,
      projectId,
      title: '供应商准入需求文档',
      version: 'v1.0',
      status: 'DRAFT',
      content: '# 供应商准入需求\n\n## 1. 业务目标\n- 供应商在线提交资质并完成年度复评。',
    },
  });
  await request.post(`/api/projects/${projectId}/steps/requirements/confirm`, { data: {} });

  const contractBoot = await (await request.get('/api/bootstrap?projectId=proj-contract')).json();
  const protoRes = await (await request.post(`/api/projects/${projectId}/prototypes`, {
    data: { name: '供应商准入界面原型', htmlContent: contractBoot.confirmedPrototypeRevision.htmlContent },
  })).json();
  const createdProto = (protoRes.prototypes as { id: string; currentRevisionId: string }[])[0]!;
  await request.post(`/api/projects/${projectId}/prototypes/confirm-revision`, {
    data: { revisionId: createdProto.currentRevisionId },
  });
  await request.put(`/api/projects/${projectId}/suite`, {
    data: { suite: contractBoot.activeProject.suite, note: 'Seed suite' },
  });

  // 1. Visit Delivery before Business Model is confirmed -> NOT_STARTED
  await page.goto(`/?projectId=${encodeURIComponent(projectId)}&step=delivery`);
  await expect(page.getByTestId('delivery-business-view')).toBeVisible();
  await expect(page.getByTestId('delivery-status-banner')).toHaveAttribute('data-step-state', 'NOT_STARTED');
  await expect(page.getByTestId('runnable-system-slot')).toHaveAttribute('data-slot-status', 'UNAVAILABLE');
  await expect(page.getByTestId('runnable-system-slot')).toContainText('蓝图已就绪，可交付开发');
  await expect(page.getByTestId('delivery-go-to-business-model-btn')).toBeVisible();

  // 2. Confirm Business Model -> IN_PROGRESS, then generate package with 1 click (platform defaults applied automatically!)
  await page.getByTestId('delivery-go-to-business-model-btn').click();
  await expect(page.getByTestId('confirm-business-model-btn')).toBeVisible();
  await page.getByTestId('confirm-business-model-btn').click();
  await page.getByTestId('go-to-delivery-btn').click();

  await expect(page.getByTestId('delivery-status-banner')).toHaveAttribute('data-step-state', 'IN_PROGRESS');
  await expect(page.getByTestId('delivery-readiness-check')).toContainText('业务模型已确认');
  await expect(page.getByTestId('delivery-readiness-check')).toContainText('没有需要修正的问题');

  await page.getByTestId('compile-dev-package-btn').click();
  await expect(page.getByTestId('delivery-status-banner')).toHaveAttribute('data-step-state', 'CONFIRMED');
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('download-package-zip-btn').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('-development-package.zip');

  // 3. Re-confirm Business Model after an edit -> Delivery becomes OUTDATED ("待更新"), then updates back to CONFIRMED
  const nextSuite = structuredClone(contractBoot.activeProject.suite);
  nextSuite.M1.aggregates[0].description = '支持供应商准入审批与年度资信复评归档';
  await request.put(`/api/projects/${projectId}/suite`, {
    data: { suite: nextSuite, note: 'Refine description' },
  });
  await request.post(`/api/projects/${projectId}/steps/business-model/confirm`, { data: {} });

  await page.reload();
  await expect(page.getByTestId('delivery-status-banner')).toHaveAttribute('data-step-state', 'OUTDATED');
  await expect(page.getByTestId('delivery-status-banner')).toContainText('待更新');
  await page.getByTestId('compile-dev-package-btn').click();
  await expect(page.getByTestId('delivery-status-banner')).toHaveAttribute('data-step-state', 'CONFIRMED');
});
