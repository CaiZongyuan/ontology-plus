import { expect, test, type Page } from '@playwright/test';

/**
 * #89: in Mock mode the first prototype build replays a recorded multi-screen build through the
 * real engine. Screens stream onto one pan/zoom canvas, several at once; artboards load once and
 * are morphed in place; the same canvas carries on after the revision is saved.
 */

const SCREENS = ['SCR-HOME', 'SCR-ORDERS', 'SCR-NEW-ORDER', 'SCR-ORDER-DETAIL', 'SCR-REFUND'];

async function setUpProjectWithConfirmedRequirements(request: import('@playwright/test').APIRequestContext) {
  const createdRes = await request.post('/api/projects', {
    data: {
      name: '门店订货系统',
      code: `LIVE_BUILD_${Date.now().toString(36).toUpperCase()}`,
      center: 'APPLICATION',
      domain: '门店订货管理',
      template: 'EMPTY',
    },
  });
  expect(createdRes.ok()).toBe(true);
  const { project } = (await createdRes.json()) as { project: { id: string } };
  const docRes = await request.post('/api/requirements/docs', {
    data: {
      id: `rdoc-live-${Date.now().toString(36)}`,
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

function streamingCount(page: Page) {
  return page.locator('[data-testid^="prototype-artboard-SCR-"][data-screen-status="streaming"]').count();
}

test.describe('Prototype live build (#89): per-screen streaming onto one canvas', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('replays a multi-screen build in parallel, never reloads an artboard, and keeps the canvas after saving', async ({
    page,
    request,
  }) => {
    const projectId = await setUpProjectWithConfirmedRequirements(request);
    await page.goto(`/?projectId=${projectId}&mode=app-prototype`);
    await expect(page.getByTestId('prototype-briefing-stage')).toBeVisible();

    await page.getByTestId('confirm-brief-generate-btn').click();

    // The live canvas appears while the run is going (nothing saved yet).
    const canvas = page.getByTestId('prototype-live-canvas');
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('prototype-canvas-toolbar')).toHaveAttribute('data-pending-live', 'true');
    await page.evaluate(() => {
      (window as unknown as { __liveCanvas?: Element | null }).__liveCanvas = document.querySelector(
        '[data-testid="prototype-live-canvas"]',
      );
    });

    // Several screens are being drawn at the same time.
    await expect.poll(() => streamingCount(page), { timeout: 20_000, intervals: [50] }).toBeGreaterThanOrEqual(2);
    const viewport = page.getByTestId('prototype-canvas-viewport');
    await expect(viewport).toHaveAttribute('data-following', 'true');
    await expect(viewport).not.toHaveAttribute('data-follow-target', '');
    await page.screenshot({ path: '.scratch/issue-89/e2e-streaming.png' });

    // Mark every artboard's document: a reload would wipe the marker.
    await expect(page.locator('[data-testid^="prototype-artboard-frame-"]')).toHaveCount(SCREENS.length);
    await page.evaluate(() => {
      for (const frame of Array.from(document.querySelectorAll<HTMLIFrameElement>('[data-testid^="prototype-artboard-frame-"]'))) {
        (frame.contentWindow as unknown as { __loadedOnce?: boolean }).__loadedOnce = true;
      }
    });

    // The run finishes and the revision is saved.
    await expect(
      page.getByTestId('agent-panel').locator('[data-testid="agent-run-card"][data-run-status="SUCCEEDED"]').last(),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('prototype-history-btn')).toContainText('R1', { timeout: 15_000 });
    for (const sid of SCREENS) {
      await expect(page.getByTestId(`prototype-artboard-${sid}`)).toHaveAttribute('data-screen-status', 'ready');
    }

    // Same canvas element, every iframe loaded exactly once and still holds the marker.
    const continuity = await page.evaluate(() => {
      const current = document.querySelector('[data-testid="prototype-live-canvas"]');
      const frames = Array.from(document.querySelectorAll<HTMLIFrameElement>('[data-testid^="prototype-artboard-frame-"]'));
      return {
        sameCanvas: (window as unknown as { __liveCanvas?: Element | null }).__liveCanvas === current,
        loadCounts: frames.map((f) => f.getAttribute('data-load-count')),
        markers: frames.map((f) => Boolean((f.contentWindow as unknown as { __loadedOnce?: boolean }).__loadedOnce)),
        texts: frames.map((f) => f.contentDocument?.body.textContent?.length ?? 0),
      };
    });
    expect(continuity.sameCanvas).toBe(true);
    expect(continuity.loadCounts).toEqual(SCREENS.map(() => '1'));
    expect(continuity.markers).toEqual(SCREENS.map(() => true));
    expect(continuity.texts.every((n) => n > 50)).toBe(true);

    await page.screenshot({ path: '.scratch/issue-89/e2e-saved-canvas.png' });

    // Manual pan stops following; the dock turns it back on.
    await viewport.hover();
    await page.mouse.wheel(120, 80);
    await expect(viewport).toHaveAttribute('data-following', 'false');
    await page.getByTestId('prototype-dock-follow').click();
    await expect(viewport).toHaveAttribute('data-following', 'true');
    const zoomBefore = await page.getByTestId('prototype-dock-zoom-level').textContent();
    await page.getByTestId('prototype-dock-zoom-in').click();
    await expect(page.getByTestId('prototype-dock-zoom-level')).not.toHaveText(zoomBefore ?? '');

    // Double-click to try a screen; its navigation moves to the target screen; Esc exits.
    await page.getByTestId('prototype-dock-fit-all').click();
    await page.getByTestId('prototype-artboard-SCR-HOME').dblclick();
    await expect(viewport).toHaveAttribute('data-trying', 'SCR-HOME');
    await expect(page.getByTestId('prototype-try-hint')).toBeVisible();
    await page
      .frameLocator('[data-testid="prototype-artboard-frame-SCR-HOME"]')
      .locator('[data-navigate-to="SCR-NEW-ORDER"]')
      .first()
      .click();
    await expect(viewport).toHaveAttribute('data-trying', 'SCR-NEW-ORDER');
    // The screen's own script (its extraJs) runs in the artboard: the + stepper adds a box.
    const orderForm = page.frameLocator('[data-testid="prototype-artboard-frame-SCR-NEW-ORDER"]');
    const firstQty = orderForm.locator('[data-element-id="EL-QTY-CROISSANT"] [data-qty]');
    await expect(firstQty).toHaveText('0');
    await orderForm.locator('[data-element-id="EL-NEW-ORDER-BUTTON-2"]').click();
    await expect(firstQty).toHaveText('1');
    expect(await page.getByTestId('prototype-artboard-frame-SCR-NEW-ORDER').getAttribute('data-load-count')).toBe('1');
    await page.waitForTimeout(700); // let the camera tween settle before the evidence screenshot
    await page.screenshot({ path: '.scratch/issue-89/e2e-try-mode.png' });
    await page.keyboard.press('Escape');
    await expect(viewport).toHaveAttribute('data-trying', '');
  });

  test('a page reload mid-build catches up with each screen’s current state', async ({ page, request }) => {
    const projectId = await setUpProjectWithConfirmedRequirements(request);
    await page.goto(`/?projectId=${projectId}&mode=app-prototype`);
    await page.getByTestId('confirm-brief-generate-btn').click();
    await expect.poll(() => streamingCount(page), { timeout: 20_000, intervals: [50] }).toBeGreaterThanOrEqual(1);

    await page.reload();
    // While the build is still running, the reconnected canvas already shows all five screens,
    // and every screen the run had started has its content (caught up, not replayed from zero).
    await expect(page.getByTestId('prototype-live-canvas')).toBeVisible({ timeout: 15_000 });
    const snapshot = () =>
      page.evaluate(() => {
        const boards = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="prototype-artboard-SCR-"]'));
        const started = boards.filter((b) => b.getAttribute('data-screen-status') !== 'queued');
        const hasOwnContent = (b: HTMLElement) => {
          const section = b.querySelector('iframe')?.contentDocument?.querySelector('[data-screen-id]');
          return Boolean(section && section.children.length > 0 && !section.querySelector('.proto-skeleton-card'));
        };
        return {
          pending:
            document.querySelector('[data-testid="prototype-canvas-toolbar"]')?.getAttribute('data-pending-live') === 'true',
          boards: boards.length,
          started: started.length,
          startedWithContent: started.filter(hasOwnContent).length,
        };
      });
    await expect
      .poll(async () => {
        const s = await snapshot();
        return s.pending && s.boards === SCREENS.length && s.started >= 1 && s.startedWithContent === s.started;
      }, { timeout: 15_000, intervals: [100] })
      .toBe(true);
    await expect(page.getByTestId('prototype-history-btn')).toContainText('R1', { timeout: 60_000 });
    for (const sid of SCREENS) {
      await expect(page.getByTestId(`prototype-artboard-${sid}`)).toHaveAttribute('data-screen-status', 'ready');
    }
  });
});
