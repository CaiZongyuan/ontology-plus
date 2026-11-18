import { expect, test, type Page } from '@playwright/test';

/**
 * #90: in Mock mode the lead first declares the Build Plan, whose arguments stream: each planned
 * screen gets a blank artboard and a strip card at once. Helpers then build the screens; the
 * recording gets the refund screen wrong, so it fails with one business sentence and
 * 「继续这一屏」, which redoes exactly that screen.
 */

const SCREENS = ['SCR-HOME', 'SCR-ORDERS', 'SCR-NEW-ORDER', 'SCR-ORDER-DETAIL', 'SCR-REFUND'];
const FAILING = 'SCR-REFUND';
const EVIDENCE = '.scratch/issue-90';

async function setUpProjectWithConfirmedRequirements(request: import('@playwright/test').APIRequestContext) {
  const createdRes = await request.post('/api/projects', {
    data: {
      name: '门店订货系统',
      code: `BUILD_PLAN_${Date.now().toString(36).toUpperCase()}`,
      center: 'APPLICATION',
      domain: '门店订货管理',
      template: 'EMPTY',
    },
  });
  expect(createdRes.ok()).toBe(true);
  const { project } = (await createdRes.json()) as { project: { id: string } };
  const docRes = await request.post('/api/requirements/docs', {
    data: {
      id: `rdoc-plan-${Date.now().toString(36)}`,
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

const card = (page: Page, sid: string) => page.getByTestId(`prototype-strip-card-${sid}`);

test.describe('Build Plan (#90): plan first, real per-screen states, continue one screen', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('the plan puts every screen on the canvas first; one screen fails with a reason and is continued alone', async ({
    page,
    request,
  }) => {
    const projectId = await setUpProjectWithConfirmedRequirements(request);
    await page.goto(`/?projectId=${projectId}&mode=app-prototype`);
    await expect(page.getByTestId('prototype-briefing-stage')).toBeVisible();
    const clickedAt = Date.now();
    await page.getByTestId('confirm-brief-generate-btn').click();

    // 1. The plan arrives: the plan phase is (or was) "now", and every planned screen has an
    //    artboard and a strip card before any screen has been drawn.
    await expect(page.getByTestId('prototype-phase-plan')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid^="prototype-strip-card-SCR-"]')).toHaveCount(SCREENS.length, {
      timeout: 10_000,
    });
    const planSeconds = (Date.now() - clickedAt) / 1000;
    const drawnWhenPlanned = await page.locator('[data-testid^="prototype-artboard-SCR-"][data-screen-status="ready"]').count();
    expect(drawnWhenPlanned).toBe(0);
    await expect(page.locator('[data-testid^="prototype-artboard-SCR-"]')).toHaveCount(SCREENS.length);
    const order = await page
      .locator('[data-testid^="prototype-strip-card-SCR-"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')!.replace('prototype-strip-card-', '')));
    expect(order).toEqual(SCREENS);
    await page.screenshot({ path: `${EVIDENCE}/e2e-plan-arrived.png` });

    // 2. Screens are built by helpers that are named on the canvas while they work.
    await expect(page.getByTestId('prototype-phase-screens')).toHaveAttribute('data-phase-status', 'now', {
      timeout: 20_000,
    });
    await expect(page.locator('[data-testid^="prototype-strip-card-SCR-"][data-build-status="writing"]').first()).toBeVisible();
    await expect(page.locator('[data-testid^="prototype-artboard-owner-"]').filter({ hasText: '助手' }).first()).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/e2e-building.png` });

    // 3. The run ends: four screens done, the refund screen failed with one business sentence.
    await expect(page.getByTestId('prototype-history-btn')).toContainText('R1', { timeout: 60_000 });
    for (const sid of SCREENS) {
      await expect(card(page, sid)).toHaveAttribute('data-build-status', sid === FAILING ? 'failed' : 'done');
    }
    await expect(page.getByTestId(`prototype-strip-failure-${FAILING}`)).toHaveText(
      '这一屏有按钮或输入框没有标注好，没能通过检查。',
    );
    await expect(page.getByTestId('prototype-phase-plan')).toHaveAttribute('data-phase-status', 'done');
    await expect(page.getByTestId('prototype-phase-style')).toHaveAttribute('data-phase-status', 'skipped');
    await expect(page.getByTestId('prototype-phase-screens')).toHaveAttribute('data-phase-status', 'failed');
    await expect(page.getByTestId('prototype-phase-review')).toHaveAttribute('data-phase-status', 'skipped');
    await expect(page.getByTestId('prototype-phase-review')).toContainText('未做视觉检查');
    await expect(page.getByTestId('prototype-phase-tours')).toHaveAttribute('data-phase-status', 'skipped');

    // The build log: time, assistant, screen, business sentence; the failure line can continue.
    const log = page.getByTestId('prototype-build-log');
    const failLine = log.locator(`[data-testid="prototype-build-log-entry"][data-kind="screen_failed"][data-screen-id="${FAILING}"]`);
    await expect(failLine).toContainText('「退款审批」没画完');
    await expect(failLine).toContainText(/\d{2}:\d{2}:\d{2}/);
    await expect(failLine).toContainText(/助手 \d/);
    await expect(page.getByTestId(`prototype-build-log-resume-${FAILING}`)).toBeVisible();
    await expect(log).not.toContainText('SCR-');
    await page.screenshot({ path: `${EVIDENCE}/e2e-screen-failed.png` });

    // Clicking a log line focuses that screen (manual camera: follow stops).
    const viewport = page.getByTestId('prototype-canvas-viewport');
    await log.locator(`[data-testid="prototype-build-log-entry"][data-kind="screen_done"][data-screen-id="SCR-ORDERS"] button`).click();
    await expect(viewport).toHaveAttribute('data-following', 'false');
    // Double-clicking a strip card tries that screen; Esc exits.
    await card(page, 'SCR-HOME').dblclick();
    await expect(viewport).toHaveAttribute('data-trying', 'SCR-HOME');
    await page.keyboard.press('Escape');
    await expect(viewport).toHaveAttribute('data-trying', '');

    // The same state is there after a reload (it is persisted with the run).
    await page.reload();
    await expect(card(page, FAILING)).toHaveAttribute('data-build-status', 'failed', { timeout: 15_000 });
    const otherScreensBefore = await page.evaluate((ids) => {
      const out: Record<string, string> = {};
      for (const id of ids) {
        const frame = document.querySelector<HTMLIFrameElement>(`[data-testid="prototype-artboard-frame-${id}"]`);
        out[id] = frame?.contentDocument?.querySelector(`[data-screen-id="${id}"]`)?.innerHTML ?? '';
      }
      return out;
    }, SCREENS.filter((s) => s !== FAILING));

    // 4. 「继续这一屏」: exactly that screen is redone; the others stay as they were.
    await page.evaluate(() => {
      (window as unknown as { __canvasBeforeResume?: Element | null }).__canvasBeforeResume = document.querySelector(
        '[data-testid="prototype-live-canvas"]',
      );
    });
    await page.getByTestId(`artboard-retry-btn-${FAILING}`).click();
    await expect(page.getByTestId(`artboard-retry-btn-${FAILING}`)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('prototype-history-btn')).toContainText('R2', { timeout: 60_000 });
    for (const sid of SCREENS) {
      await expect(card(page, sid)).toHaveAttribute('data-build-status', 'done');
    }
    await expect(page.getByTestId(`prototype-strip-failure-${FAILING}`)).toHaveCount(0);
    await expect(page.getByTestId('prototype-phase-screens')).toHaveAttribute('data-phase-status', 'done');
    await expect(log.locator('[data-testid="prototype-build-log-entry"][data-kind="screen_resumed"]')).toContainText(
      '继续画「退款审批」',
    );
    await expect(page.getByTestId(`prototype-artboard-${FAILING}`)).toHaveAttribute('data-screen-status', 'ready');
    const refund = page.frameLocator(`[data-testid="prototype-artboard-frame-${FAILING}"]`);
    await expect(refund.locator('[data-element-id="EL-REFUND-BUTTON-1"]')).toBeVisible();

    const otherScreensAfter = await page.evaluate((ids) => {
      const out: Record<string, string> = {};
      for (const id of ids) {
        const frame = document.querySelector<HTMLIFrameElement>(`[data-testid="prototype-artboard-frame-${id}"]`);
        out[id] = frame?.contentDocument?.querySelector(`[data-screen-id="${id}"]`)?.innerHTML ?? '';
      }
      return out;
    }, SCREENS.filter((s) => s !== FAILING));
    expect(otherScreensAfter).toEqual(otherScreensBefore);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __canvasBeforeResume?: Element | null }).__canvasBeforeResume ===
          document.querySelector('[data-testid="prototype-live-canvas"]'),
      ),
    ).toBe(true);
    await page.getByTestId('prototype-dock-fit-all').click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${EVIDENCE}/e2e-screen-continued.png` });

    test.info().annotations.push({ type: 'plan-seconds', description: planSeconds.toFixed(1) });
  });
});
