import { expect, test } from '@playwright/test';

/**
 * #95 (`[原型] 演示路线：生成与播放`, #88 review verdict: A + B combined):
 * After screens and #93 screenshot review finish, the lead writes 2–4 Demo Tours (`演示路线`)
 * anchored to real `data-screen-id` / `data-element-id` targets inside `界面原型.html`, logs
 * `演示路线已就绪` without autoplaying, portals the `▶ 播放演示` picker outside any overflow
 * container, switches the right sidebar between `BuildLog` and the step script, spotlights and
 * genuinely acts on the live iframe DOM in both Canvas (`画板`) and Web (`网页`, #97) modes, and
 * scrolls off-screen web targets into view.
 */

async function setUpProjectWithConfirmedRequirements(request: import('@playwright/test').APIRequestContext) {
  const createdRes = await request.post('/api/projects', {
    data: {
      name: '门店订货系统',
      code: `DEMO_TOURS_${Date.now().toString(36).toUpperCase()}`,
      center: 'APPLICATION',
      domain: '门店订货管理',
      template: 'EMPTY',
    },
  });
  expect(createdRes.ok()).toBe(true);
  const { project } = (await createdRes.json()) as { project: { id: string } };
  const docRes = await request.post('/api/requirements/docs', {
    data: {
      id: `rdoc-tour-${Date.now().toString(36)}`,
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

test.describe('Prototype Demo Tours (#95): generation, portal menu, script sidebar, spotlight & real playback', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('writes Demo Tours into 界面原型.html without autoplaying, plays with real DOM actions in Canvas & Web modes, and switches sidebar cleanly', async ({
    page,
    request,
  }) => {
    const projectId = await setUpProjectWithConfirmedRequirements(request);
    await page.goto(`/?projectId=${projectId}&mode=app-prototype`);
    await expect(page.getByTestId('prototype-briefing-stage')).toBeVisible();
    await page.getByTestId('confirm-brief-generate-btn').click();
    await expect(page.getByTestId('prototype-live-canvas')).toBeVisible({ timeout: 15_000 });

    // Wait for R1 build to finish
    await expect(page.getByTestId('prototype-history-btn')).toContainText('R1', { timeout: 60_000 });

    // 1. `演示路线` phase is `done` (`演示路线已就绪`), logged in BuildLog, and NEVER autoplays!
    const toursPhase = page.getByTestId('prototype-phase-tours');
    await expect(toursPhase).toHaveAttribute('data-phase-status', 'done');
    await expect(toursPhase).toContainText('演示路线已就绪');
    const buildLog = page.getByTestId('prototype-build-log');
    await expect(buildLog).toBeVisible();
    await expect(buildLog.locator('[data-testid="prototype-build-log-entry"][data-kind="tours_ready"]')).toContainText(
      '演示路线已就绪',
    );
    await expect(page.getByTestId('demo-tour-player-bar')).toHaveCount(0);
    await expect(page.getByTestId('demo-tour-script-panel')).toHaveCount(0);

    // Saved `界面原型.html` embeds `<script type="application/json" data-proto-tours>`
    const protosRes = await request.get(`/api/projects/${projectId}/prototypes`);
    expect(protosRes.ok()).toBe(true);
    const { prototypes } = (await protosRes.json()) as { prototypes: { id: string; htmlContent: string }[] };
    expect(prototypes[0]!.htmlContent).toContain('data-proto-tours');

    // 2. Click `▶ 播放演示`: menu is portaled onto `document.body` outside any overflow container and fully visible
    const playTrigger = page.getByTestId('demo-tour-play-trigger');
    await expect(playTrigger).toBeVisible();
    await expect(playTrigger).toContainText('播放演示');
    await playTrigger.click();

    const menu = page.getByTestId('demo-tour-menu');
    await expect(menu).toBeVisible();
    const portalInfo = await page.evaluate(() => {
      const m = document.querySelector<HTMLElement>('[data-testid="demo-tour-menu"]')!;
      const r = m.getBoundingClientRect();
      return {
        parentIsBody: m.parentElement === document.body,
        insidePhaseBar: Boolean(document.querySelector('[data-testid="prototype-phase-bar"]')?.contains(m)),
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
        vw: window.innerWidth,
        vh: window.innerHeight,
        text: m.textContent ?? '',
      };
    });
    expect(portalInfo.parentIsBody).toBe(true);
    expect(portalInfo.insidePhaseBar).toBe(false);
    expect(portalInfo.width).toBeGreaterThanOrEqual(240);
    expect(portalInfo.height).toBeGreaterThanOrEqual(120);
    expect(portalInfo.left).toBeGreaterThanOrEqual(0);
    expect(portalInfo.top).toBeGreaterThanOrEqual(0);
    expect(portalInfo.right).toBeLessThanOrEqual(portalInfo.vw);
    expect(portalInfo.bottom).toBeLessThanOrEqual(portalInfo.vh);
    expect(portalInfo.text).toContain('门店第一次订货');
    expect(portalInfo.text).not.toContain('SCR-');
    expect(portalInfo.text).not.toContain('场景');

    // 3. Canvas mode playback: right panel switches to script, spotlight + subtitle + controls work, real DOM mutates
    await page.getByTestId('demo-tour-option-first-order').click();
    await expect(page.getByTestId('prototype-build-log')).toHaveCount(0);
    const scriptPanel = page.getByTestId('demo-tour-script-panel');
    await expect(scriptPanel).toBeVisible();
    await expect(scriptPanel.locator('[data-testid^="demo-tour-step-"]')).toHaveCount(7);
    await expect(page.getByTestId('demo-tour-player-bar')).toBeVisible();
    await expect(page.getByTestId('demo-tour-caption')).toBeVisible();
    await expect(page.getByTestId('demo-tour-spotlight')).toBeVisible();

    // Pause, jump directly to Step 3 (`SCR-NEW-ORDER` search input) via right script, then resume through Step 4 (`+` x3)
    const pauseToggle = page.getByTestId('demo-tour-pause-toggle');
    await pauseToggle.click();
    await expect(page.getByTestId('demo-tour-player-bar')).toHaveAttribute('data-tour-paused', 'true');

    // Click step index 2 (3rd step: type '可颂' on SCR-NEW-ORDER) — jumps and plays from step 3!
    await page.getByTestId('demo-tour-step-2').click();
    await expect(page.getByTestId('demo-tour-progress')).toContainText('/ 7');

    // Wait until step 4 (`EL-NEW-ORDER-BUTTON-2` clicked 3 times) finishes mutating SCR-NEW-ORDER's real iframe DOM
    const newOrderFrame = page.frameLocator('[data-testid="prototype-artboard-frame-SCR-NEW-ORDER"]');
    await expect(newOrderFrame.locator('[data-element-id="EL-NEW-SEARCH"]')).toHaveValue('可颂', { timeout: 15_000 });
    await expect(newOrderFrame.locator('[data-element-id="EL-QTY-CROISSANT"] [data-qty]')).toHaveText('3', {
      timeout: 15_000,
    });

    // Test Previous / Next controls while paused
    await pauseToggle.click();
    await expect(page.getByTestId('demo-tour-player-bar')).toHaveAttribute('data-tour-paused', 'true');
    await page.getByTestId('demo-tour-prev').click();
    await pauseToggle.click(); // pause again after step jump
    await expect(page.getByTestId('demo-tour-player-bar')).toHaveAttribute('data-tour-paused', 'true');
    const stepBeforeNext = await page.getByTestId('demo-tour-player-bar').getAttribute('data-tour-step');
    await page.getByTestId('demo-tour-next').click();
    await expect
      .poll(async () => await page.getByTestId('demo-tour-player-bar').getAttribute('data-tour-step'))
      .not.toBe(stepBeforeNext);

    // Exit restores `BuildLog` on the right sidebar and brings back the canvas dock
    await page.getByTestId('demo-tour-exit').click();
    await expect(page.getByTestId('demo-tour-player-bar')).toHaveCount(0);
    await expect(page.getByTestId('demo-tour-script-panel')).toHaveCount(0);
    await expect(page.getByTestId('prototype-build-log')).toBeVisible();
    await expect(page.getByTestId('prototype-canvas-dock')).toBeVisible();

    // 4. Web mode (#97): genuinely navigates pages across screens and scrolls off-screen targets into view!
    await page.getByTestId('prototype-dock-view-web').click();
    const webView = page.getByTestId('prototype-web-view');
    await expect(webView).toBeVisible();
    await page.getByTestId('prototype-web-page-select').selectOption('SCR-HOME');
    await expect(webView).toHaveAttribute('data-web-screen', 'SCR-HOME');

    // Push `EL-ORDER-DETAIL-BUTTON-1` far down on `SCR-ORDER-DETAIL` so it starts off-screen and must scroll into view
    const webFrame = page.frameLocator('[data-testid="prototype-web-frame"]');
    await webFrame.locator('[data-element-id="EL-ORDER-DETAIL-BUTTON-1"]').evaluate((el) => {
      (el as HTMLElement).style.marginTop = '1400px';
    });

    await page.getByTestId('demo-tour-play-trigger').click();
    await page.getByTestId('demo-tour-option-track-delivery').click();

    // Wait for the 4-step `track-delivery` tour to navigate SCR-HOME -> SCR-ORDERS -> SCR-ORDER-DETAIL and complete
    await expect(page.getByTestId('demo-tour-player-bar')).toHaveAttribute('data-tour-completed', 'true', {
      timeout: 20_000,
    });
    await expect(webView).toHaveAttribute('data-web-screen', 'SCR-ORDER-DETAIL');
    await expect(webFrame.locator('[data-element-id="EL-ORDERS-INPUT-1"]')).toHaveValue('DH-1025');
    const webScrollTop = await webFrame
      .locator('body')
      .evaluate((body) => (body.ownerDocument.scrollingElement ?? body.ownerDocument.documentElement).scrollTop);
    expect(webScrollTop).toBeGreaterThan(300);

    await page.getByTestId('demo-tour-exit').click();
    await expect(page.getByTestId('prototype-build-log')).toBeVisible();

    // 5. Bilingual check (`en-US`): English Demo Tour chrome, zero "Scenario"
    await page.evaluate(() => localStorage.setItem('onto_locale', 'en-US'));
    await page.reload();
    await expect(page.getByTestId('prototype-phase-tours')).toContainText('Demo tours ready', { timeout: 15_000 });
    await expect(page.getByTestId('demo-tour-play-trigger')).toContainText('Play Demo');
    await page.getByTestId('demo-tour-play-trigger').click();
    await expect(page.getByTestId('demo-tour-menu')).toContainText('Pick a Demo Tour to play');
    const enMenuText = await page.getByTestId('demo-tour-menu').innerText();
    expect(enMenuText).not.toContain('Scenario');
  });
});
