import { expect, test } from '@playwright/test';

/**
 * #97: web mode. In Mock mode the build replays through the real engine; the prototype can be
 * watched and browsed as a real page at its real width, and opened as its own page in a new tab
 * that navigates with the shell's own script (the same as the saved 界面原型.html).
 */

async function setUpProjectWithConfirmedRequirements(request: import('@playwright/test').APIRequestContext) {
  const createdRes = await request.post('/api/projects', {
    data: {
      name: '门店订货系统',
      code: `WEB_MODE_${Date.now().toString(36).toUpperCase()}`,
      center: 'APPLICATION',
      domain: '门店订货管理',
      template: 'EMPTY',
    },
  });
  expect(createdRes.ok()).toBe(true);
  const { project } = (await createdRes.json()) as { project: { id: string } };
  const docRes = await request.post('/api/requirements/docs', {
    data: {
      id: `rdoc-web-${Date.now().toString(36)}`,
      projectId: project.id,
      title: '门店订货需求文档',
      version: 'v1.0',
      status: 'DRAFT',
      content: '# 门店订货需求文档\n\n## 1. 核心业务范围\n- 围绕**订货单**（StoreOrder）支持店长订货、收货与退款审批。',
    },
  });
  expect(docRes.ok()).toBe(true);
  const { doc } = (await docRes.json()) as { doc: { id: string } };
  const confirmRes = await request.post(`/api/projects/${project.id}/steps/requirements/confirm`, {
    data: { docId: doc.id },
  });
  expect(confirmRes.ok()).toBe(true);
  return project.id;
}

test.describe('Prototype web mode (#97)', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('watches the build as a page, browses it at real width, and opens it standalone in a new tab', async ({
    page,
    request,
    context,
  }) => {
    const projectId = await setUpProjectWithConfirmedRequirements(request);
    await page.goto(`/?projectId=${projectId}&mode=app-prototype`);
    await page.getByTestId('confirm-brief-generate-btn').click();

    const viewport = page.getByTestId('prototype-canvas-viewport');
    await expect(viewport).toBeVisible({ timeout: 15_000 });
    await expect(viewport).toHaveAttribute('data-view', 'artboards'); // the first time: artboards

    // Switch to web mode mid-build: it follows the page being drawn.
    await page.getByTestId('prototype-dock-view-web').click();
    await expect(viewport).toHaveAttribute('data-view', 'web');
    const web = page.getByTestId('prototype-web-view');
    await expect(web).toBeVisible();
    await expect(page.getByTestId('prototype-web-drawing')).toBeVisible({ timeout: 20_000 });
    await expect(web).not.toHaveAttribute('data-web-screen', '');
    await page.screenshot({ path: '.scratch/issue-97/e2e-web-mode-building.png' });

    // The build finishes and is saved; the web page carries on.
    await expect(page.getByTestId('prototype-history-btn')).toContainText('R1', { timeout: 60_000 });
    await expect(page.getByTestId('prototype-web-drawing')).toHaveCount(0);

    // Real width: the frame fills the page area, far wider than an artboard on the canvas.
    const frameEl = page.getByTestId('prototype-web-frame');
    const box = await frameEl.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(700);

    // Browse: page select, a link inside the prototype, back and forward; each page starts at the top.
    await page.getByTestId('prototype-web-page-select').selectOption('SCR-HOME');
    await expect(web).toHaveAttribute('data-web-screen', 'SCR-HOME');
    const frame = page.frameLocator('[data-testid="prototype-web-frame"]');
    await expect(frame.locator('[data-screen-id="SCR-HOME"]')).toBeVisible();
    await frame.locator('body').evaluate((body) => {
      body.ownerDocument.scrollingElement!.scrollTop = 300;
    });
    await frame.locator('[data-navigate-to="SCR-NEW-ORDER"]').first().click();
    await expect(web).toHaveAttribute('data-web-screen', 'SCR-NEW-ORDER');
    await expect(frame.locator('[data-screen-id="SCR-NEW-ORDER"]')).toBeVisible();
    expect(await frame.locator('body').evaluate((body) => body.ownerDocument.scrollingElement!.scrollTop)).toBe(0);
    // the screen's own script works here too
    const qty = frame.locator('[data-element-id="EL-QTY-CROISSANT"] [data-qty]');
    await expect(qty).toHaveText('0');
    await frame.locator('[data-element-id="EL-NEW-ORDER-BUTTON-2"]').click();
    await expect(qty).toHaveText('1');
    await page.getByTestId('prototype-web-back').click();
    await expect(web).toHaveAttribute('data-web-screen', 'SCR-HOME');
    await page.getByTestId('prototype-web-forward').click();
    await expect(web).toHaveAttribute('data-web-screen', 'SCR-NEW-ORDER');
    // the page keeps what was done on it (one document, pages switch by is-active)
    await expect(qty).toHaveText('1');
    // a screen-strip card shows that page, and its card is the highlighted one
    await page.getByTestId('prototype-strip-card-SCR-REFUND').locator('button').first().click();
    await expect(web).toHaveAttribute('data-web-screen', 'SCR-REFUND');
    await expect(page.getByTestId('prototype-strip-card-SCR-REFUND')).toHaveClass(/border-primary/);
    await page.getByTestId('prototype-web-back').click();
    await expect(web).toHaveAttribute('data-web-screen', 'SCR-NEW-ORDER');
    expect(await frameEl.getAttribute('data-load-count')).toBe('1');
    await page.waitForTimeout(700); // let the page's fade-in finish before the evidence screenshot
    await page.screenshot({ path: '.scratch/issue-97/e2e-web-mode-saved.png' });

    // 新标签页打开: the composed document, on the page shown, with its own navigation.
    const [tab] = await Promise.all([
      context.waitForEvent('page'),
      page.getByTestId('prototype-web-open-standalone').click(),
    ]);
    await tab.waitForLoadState('domcontentloaded');
    await expect(tab.locator('[data-screen-id="SCR-NEW-ORDER"]')).toBeVisible();
    await expect(tab.locator('[data-screen-id="SCR-HOME"]')).toBeHidden();
    await tab.locator('[data-nav-screen="SCR-ORDERS"]').click();
    await expect(tab.locator('[data-screen-id="SCR-ORDERS"]')).toBeVisible();
    await tab.locator('[data-navigate-to="SCR-ORDER-DETAIL"]').first().click();
    await expect(tab.locator('[data-screen-id="SCR-ORDER-DETAIL"]')).toBeVisible();
    await tab.goBack();
    await expect(tab.locator('[data-screen-id="SCR-ORDERS"]')).toBeVisible();
    await tab.waitForTimeout(700);
    await tab.screenshot({ path: '.scratch/issue-97/e2e-standalone-tab.png', fullPage: true });
    await tab.close();

    // The choice is remembered on this device.
    await page.reload();
    await expect(page.getByTestId('prototype-canvas-viewport')).toHaveAttribute('data-view', 'web', { timeout: 15_000 });
  });

  test('a finished build suggests web mode in the build log', async ({ page, request }) => {
    const projectId = await setUpProjectWithConfirmedRequirements(request);
    await page.goto(`/?projectId=${projectId}&mode=app-prototype`);
    await page.getByTestId('confirm-brief-generate-btn').click();
    await expect(page.getByTestId('prototype-canvas-viewport')).toHaveAttribute('data-view', 'artboards', {
      timeout: 15_000,
    });
    // The recorded build leaves one screen unfinished (#90); the suggestion waits until every
    // screen is drawn, so continue that screen first.
    await expect(page.getByTestId('prototype-history-btn')).toContainText('R1', { timeout: 60_000 });
    const hint = page.getByTestId('prototype-web-mode-hint');
    await expect(hint).toHaveCount(0);
    await page.getByTestId('artboard-retry-btn-SCR-REFUND').click();
    await expect(page.getByTestId('prototype-history-btn')).toContainText('R2', { timeout: 60_000 });
    await expect(hint).toBeVisible({ timeout: 15_000 });
    await expect(hint).toContainText('网页');
    await page.getByTestId('prototype-web-mode-hint-try').click();
    await expect(page.getByTestId('prototype-canvas-viewport')).toHaveAttribute('data-view', 'web');
  });
});
