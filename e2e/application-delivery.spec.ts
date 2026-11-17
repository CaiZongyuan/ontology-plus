import fs from 'node:fs';
import { expect, test } from '@playwright/test';

test('confirms a selected prototype revision, previews a fixed English package and downloads that snapshot after source changes', async ({ page, request }, testInfo) => {
  page.on('dialog', (dialog) => { throw new Error(`Blocking browser dialog: ${dialog.message()}`); });
  const bootstrap = await (await request.get('/api/bootstrap?projectId=proj-contract')).json();
  const confirmed = bootstrap.confirmedPrototypeRevision;
  const appended = await (await request.post(`/api/prototypes/${confirmed.prototypeId}/revisions`, {
    data: { htmlContent: `${confirmed.htmlContent}\n<!-- APPLICATION_PACKAGE_REVISION -->`, title: 'Application package review candidate' },
  })).json();
  await page.goto('/');
  await page.getByTestId('nav-app-assembly-dev').click();
  await expect(page.getByTestId('application-development-workflow')).toBeVisible();
  await page.getByTestId('development-prototype-revision').selectOption(appended.revision.id);
  await expect(page.getByTestId('confirm-revision-mu-diff-modal')).toBeVisible();
  await page.getByTestId('confirm-revision-approve-btn').click();
  await expect(page.getByTestId('confirm-revision-mu-diff-modal')).not.toBeVisible();
  await expect(page.getByTestId('development-prototype-revision')).toHaveValue(appended.revision.id);
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
  await expect(page.getByTestId('package-stale-indicator')).toContainText(/输入已变化|Inputs changed/);
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('download-package-zip-btn').click();
  const download = await downloadPromise;
  const downloadPath = testInfo.outputPath('reviewed-development-package.zip');
  await download.saveAs(downloadPath);
  expect(fs.readFileSync(downloadPath)).toEqual(originalBytes);
  await page.reload();
  await page.getByTestId('nav-app-assembly-dev').click();
  await expect(page.getByTestId('saved-package-snapshot')).toContainText(first.compiledPackage.snapshotId);
  await page.getByTestId('compile-dev-package-btn').click();
  await expect.poll(async () => (await (await request.get(`/api/applications/${applicationId}/package`)).json()).compiledPackage.snapshotId)
    .not.toBe(first.compiledPackage.snapshotId);
});

test('keeps architecture authoring separate from application review and renders assistant Markdown', async ({ page, request }) => {
  await page.goto('/');
  await page.getByTestId('nav-app-assembly-dev').click();
  const panel = page.getByTestId('agent-panel');
  await page.getByTestId('agent-panel-composer-input').fill('Review this application input specification.');
  await page.getByTestId('agent-panel-send-btn').click();
  await expect(panel.locator('[data-tool-name="read_application_inputs"]').last()).toBeVisible();
  await expect(panel.getByTestId('agent-run-text').getByRole('heading', { name: /Application specification input review|应用规格输入检查/ })).toBeVisible();
  await page.getByTestId('nav-app-four-layer-assets').click();
  await expect(panel.locator('.agent-panel-title')).toContainText(/架构资产|Architecture Asset/);
  await expect(panel.locator('[data-tool-name="read_application_inputs"]')).toHaveCount(0);
  await page.getByTestId('agent-panel-composer-input').fill('Inspect the repository standards catalog.');
  await page.getByTestId('agent-panel-send-btn').click();
  await expect(panel.locator('[data-tool-name="read_architecture_assets"]').last()).toBeVisible();
  const sessions = (await (await request.get('/api/agent-sessions?projectId=proj-contract')).json()).agentSessions;
  expect(sessions.some((session: { agentKind: string }) => session.agentKind === 'ARCHITECTURE')).toBe(true);
  expect(sessions.some((session: { agentKind: string }) => session.agentKind === 'CODING')).toBe(true);
});
