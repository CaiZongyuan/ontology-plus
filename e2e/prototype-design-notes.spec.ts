import { expect, test, type Page } from '@playwright/test';

async function setUpProjectWithConfirmedRequirements(
  request: import('@playwright/test').APIRequestContext,
) {
  const createdRes = await request.post('/api/projects', {
    data: {
      name: '门店订货系统',
      code: `DESIGN_NOTES_${Date.now().toString(36).toUpperCase()}`,
      center: 'APPLICATION',
      domain: '门店订货管理',
      template: 'EMPTY',
    },
  });
  expect(createdRes.ok()).toBe(true);
  const { project } = (await createdRes.json()) as { project: { id: string } };
  const docRes = await request.post('/api/requirements/docs', {
    data: {
      id: `rdoc-notes-${Date.now().toString(36)}`,
      projectId: project.id,
      title: '门店订货需求文档',
      version: 'v1.0',
      status: 'DRAFT',
      content:
        '# 门店订货需求文档\n\n## 1. 核心业务范围\n- 围绕**订货单**（StoreOrder）支持店长订货、收货与退款审批。',
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

async function waitForCameraToSettle(page: Page) {
  let last = '';
  await expect
    .poll(
      async () => {
        const now = await page
          .getByTestId('prototype-canvas-world')
          .evaluate((el) => (el as HTMLElement).style.transform);
        const settled = now === last;
        last = now;
        return settled;
      },
      { timeout: 5_000, intervals: [150] },
    )
    .toBe(true);
}

async function readHomeNoteCoords(page: Page) {
  return page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="prototype-design-notes-overlay-SCR-HOME"] [data-testid^="prototype-design-note-EL-"]',
      ),
    );
    return nodes.map((el) => ({
      id: el.getAttribute('data-element-id'),
      left: el.style.left,
      top: el.style.top,
      width: el.style.width,
      outside: el.getAttribute('data-outside'),
      fontFamily: getComputedStyle(el).fontFamily,
      pointerEvents: getComputedStyle(el).pointerEvents,
      text: el.textContent ?? '',
    }));
  });
}

test.describe('Prototype Design Notes (#94): handwritten callouts in canvas and web modes', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('renders bundled KaiTi handwritten callouts + curved arrows mid-build and after save, keeps prototype interactive in canvas and web modes, places deterministically, and extracts data-note into MU', async ({
    page,
    request,
  }) => {
    const externalFontOrStyleRequests: string[] = [];
    const localWenkaiSlices: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      const type = req.resourceType();
      const isExternal =
        /^https?:\/\//i.test(url) && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url);
      if (isExternal && (type === 'font' || type === 'stylesheet' || /\.(woff2?|ttf|otf|css)(\?|$)/i.test(url))) {
        externalFontOrStyleRequests.push(url);
      }
      if (url.includes('lxgwwenkailite') && url.endsWith('.woff2')) {
        localWenkaiSlices.push(url);
      }
    });

    const projectId = await setUpProjectWithConfirmedRequirements(request);
    await page.goto(`/?projectId=${projectId}&mode=app-prototype`);
    await expect(page.getByTestId('prototype-briefing-stage')).toBeVisible();
    await page.getByTestId('confirm-brief-generate-btn').click();

    const viewport = page.getByTestId('prototype-canvas-viewport');
    await expect(viewport).toBeVisible({ timeout: 15_000 });

    // Wait until at least one screen is actively streaming, then turn 设计说明 ON mid-build!
    await expect
      .poll(
        () =>
          page
            .locator('[data-testid^="prototype-artboard-SCR-"][data-screen-status="streaming"]')
            .count(),
        { timeout: 25_000, intervals: [60] },
      )
      .toBeGreaterThanOrEqual(1);

    const toggle = page.getByTestId('prototype-dock-design-notes');
    await expect(toggle).toContainText('设计说明');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(viewport).toHaveAttribute('data-following', 'false');

    // Design notes appear live while the build is still streaming
    await expect
      .poll(
        () => page.locator('[data-testid^="prototype-design-notes-overlay-SCR-"]').count(),
        { timeout: 15_000, intervals: [100] },
      )
      .toBeGreaterThanOrEqual(1);

    // Wait for the build to complete and save R1; Design Notes stays ON on the same canvas
    await expect(page.getByTestId('prototype-history-btn')).toContainText('R1', { timeout: 60_000 });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('prototype-design-notes-overlay-SCR-HOME')).toBeVisible();

    // Bundled offline LXGW WenKai Lite slices loaded from local server with zero external CDN requests
    expect(externalFontOrStyleRequests).toEqual([]);
    await expect.poll(() => localWenkaiSlices.length, { timeout: 5_000 }).toBeGreaterThan(0);

    const coordsInitial = await readHomeNoteCoords(page);
    expect(coordsInitial.length).toBeGreaterThanOrEqual(4);
    for (const item of coordsInitial) {
      expect(item.fontFamily).toContain('LXGW WenKai Lite');
      expect(item.pointerEvents).toBe('none');
      expect(item.text).not.toMatch(/^\d+[.、\s]/);
    }

    // Full-row block EL-HOME-GREET skips dashed outline; compact button EL-HOME-NEW-ORDER gets one + curved arrow
    await expect(page.getByTestId('prototype-design-note-outline-EL-HOME-GREET')).toHaveCount(0);
    await expect(page.getByTestId('prototype-design-note-outline-EL-HOME-NEW-ORDER')).toHaveCount(1);
    await expect(
      page
        .getByTestId('prototype-design-note-arrow-EL-HOME-NEW-ORDER')
        .locator('path[data-role="arrow-stroke"]'),
    ).toHaveCount(2);

    // Determinism across re-toggle AND page reload
    await toggle.click();
    await expect(page.getByTestId('prototype-design-notes-overlay-SCR-HOME')).toHaveCount(0);
    await toggle.click();
    await waitForCameraToSettle(page);
    const coordsRetoggled = await readHomeNoteCoords(page);
    expect(coordsRetoggled).toEqual(coordsInitial);

    await page.reload();
    await expect(page.getByTestId('prototype-live-canvas')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('prototype-dock-design-notes').click();
    await waitForCameraToSettle(page);
    const coordsAfterReload = await readHomeNoteCoords(page);
    expect(coordsAfterReload).toEqual(coordsInitial);

    // Canvas try-mode operability while 设计说明 stays ON: buttons and inputs inside SCR-NEW-ORDER work!
    await page.getByTestId('prototype-strip-card-SCR-NEW-ORDER').locator('button').first().click();
    await waitForCameraToSettle(page);
    await page.getByTestId('prototype-artboard-SCR-NEW-ORDER').dblclick();
    await expect(viewport).toHaveAttribute('data-trying', 'SCR-NEW-ORDER');
    await waitForCameraToSettle(page);

    const newOrderFrame = page.frameLocator('[data-testid="prototype-artboard-frame-SCR-NEW-ORDER"]');
    const qty = newOrderFrame.locator('[data-element-id="EL-QTY-CROISSANT"] [data-qty]');
    await expect(qty).toHaveText('0');
    await newOrderFrame.locator('[data-element-id="EL-NEW-ORDER-BUTTON-2"]').click();
    await expect(qty).toHaveText('1');
    await newOrderFrame.locator('[data-element-id="EL-NEW-SEARCH"]').fill('可颂');
    await expect(newOrderFrame.locator('[data-element-id="EL-NEW-SEARCH"]')).toHaveValue('可颂');

    // Web mode (#97) with 设计说明 ON: notes stay inside page width, scroll smoothly, and keep page interactive
    await page.getByTestId('prototype-dock-view-web').click();
    await expect(viewport).toHaveAttribute('data-view', 'web');
    await expect(page.getByTestId('prototype-dock-design-notes')).toHaveAttribute('aria-pressed', 'true');
    const webOverlay = page.getByTestId('prototype-web-design-notes-overlay');
    await expect(webOverlay).toBeVisible();

    const webBoundsCheck = await page.evaluate(() => {
      const pageEl = document.querySelector<HTMLElement>('[data-testid="prototype-web-page"]')!;
      const notes = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid="prototype-web-design-notes-overlay"] [data-testid^="prototype-design-note-EL-"]',
        ),
      );
      const pw = pageEl.clientWidth;
      return notes.every((n) => {
        const left = parseFloat(n.style.left);
        const w = parseFloat(n.style.width);
        return left >= 0 && left + w <= pw;
      });
    });
    expect(webBoundsCheck).toBe(true);

    const webFrame = page.frameLocator('[data-testid="prototype-web-frame"]');
    const webQty = webFrame.locator('[data-element-id="EL-QTY-CROISSANT"] [data-qty]');
    await expect(webQty).toHaveText('0');
    await webFrame.locator('[data-element-id="EL-NEW-ORDER-BUTTON-2"]').click();
    await expect(webQty).toHaveText('1');

    // Bilingual zh-CN <-> en-US toggle updates the dock button label
    await page.getByTestId('locale-toggle-btn').click();
    await expect(page.getByTestId('prototype-dock-design-notes')).toContainText('Design Notes');
    await page.getByTestId('locale-toggle-btn').click();
    await expect(page.getByTestId('prototype-dock-design-notes')).toContainText('设计说明');

    // Confirm prototype revision and verify MU extracts data-note into UIElement.description
    const protosRes = await request.get(`/api/projects/${projectId}/prototypes`);
    expect(protosRes.ok()).toBe(true);
    const { prototypes } = (await protosRes.json()) as {
      prototypes: Array<{ id: string; currentRevisionId: string }>;
    };
    expect(prototypes.length).toBeGreaterThan(0);
    const confirmProtoRes = await request.post(`/api/projects/${projectId}/steps/prototype/confirm`, {
      data: { revisionId: prototypes[0]!.currentRevisionId },
    });
    expect(confirmProtoRes.ok()).toBe(true);

    const projRes = await request.get(`/api/projects/${projectId}`);
    expect(projRes.ok()).toBe(true);
    const { project } = (await projRes.json()) as {
      project: {
        suite: {
          MU?: {
            screens: Array<{
              screenId: string;
              elements: Array<{ elementId: string; description?: string }>;
            }>;
          };
        };
      };
    };
    const homeScreen = project.suite.MU?.screens.find((s) => s.screenId === 'SCR-HOME');
    const newOrderBtn = homeScreen?.elements.find((e) => e.elementId === 'EL-HOME-NEW-ORDER');
    expect(newOrderBtn?.description).toBe('新建订单：店长发现缺货时，从这里开始订货。');
    expect(externalFontOrStyleRequests).toEqual([]);
  });
});
