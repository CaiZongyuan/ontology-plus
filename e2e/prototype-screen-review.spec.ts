import fs from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * #93: after each screen finishes writing, the server captures its 1280 × 860 artboard screenshot
 * and runs at most one visual check + targeted fix round per screen. In Mock replay, `SCR-ORDERS`
 * initially lands with an overflowing table (`class="page too-wide"`), `report_review` flags the
 * issue in business language, and `edit_screen` uniquely replaces only that snippet in place
 * without reloading the artboard iframe or storing screenshot bytes in `界面原型.html`.
 */

const EVIDENCE_DIR = '.scratch/issue-93';

async function setUpProjectWithConfirmedRequirements(request: import('@playwright/test').APIRequestContext) {
  const createdRes = await request.post('/api/projects', {
    data: {
      name: '门店订货系统',
      code: `SCREEN_REVIEW_${Date.now().toString(36).toUpperCase()}`,
      center: 'APPLICATION',
      domain: '门店订货管理',
      template: 'EMPTY',
    },
  });
  expect(createdRes.ok()).toBe(true);
  const { project } = (await createdRes.json()) as { project: { id: string } };
  const docRes = await request.post('/api/requirements/docs', {
    data: {
      id: `rdoc-rev-${Date.now().toString(36)}`,
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

test.describe('Prototype screenshot review & targeted fix (#93)', () => {
  test.beforeAll(() => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  });

  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('runs live 截图检查 with scan-band, logs business finding, and morphs targeted fix on SCR-ORDERS without iframe reload', async ({
    page,
    request,
  }) => {
    const projectId = await setUpProjectWithConfirmedRequirements(request);
    await page.goto(`/?projectId=${projectId}&mode=app-prototype`);
    await expect(page.getByTestId('prototype-briefing-stage')).toBeVisible();

    await page.getByTestId('confirm-brief-generate-btn').click();
    await expect(page.getByTestId('prototype-live-canvas')).toBeVisible({ timeout: 15_000 });

    // Observe real transient visual signals (scan-band, phase states, pre-fix overflow, iframe identity)
    await page.evaluate(() => {
      type ReviewWatch = {
        reviewPhaseNow: boolean;
        scanBands: string[];
        sawFixingStatus: boolean;
        sawFixNarration: string[];
        sawInitialOverflow: boolean;
      };
      const w = window as unknown as { __reviewWatch?: ReviewWatch };
      w.__reviewWatch = {
        reviewPhaseNow: false,
        scanBands: [],
        sawFixingStatus: false,
        sawFixNarration: [],
        sawInitialOverflow: false,
      };
      const inspect = () => {
        const state = w.__reviewWatch!;
        if (document.querySelector('[data-testid="prototype-phase-review"][data-phase-status="now"]')) {
          state.reviewPhaseNow = true;
        }
        for (const scan of Array.from(document.querySelectorAll('[data-testid^="prototype-artboard-scan-"]'))) {
          const id = scan.getAttribute('data-testid') ?? '';
          if (id && !state.scanBands.includes(id)) state.scanBands.push(id);
        }
        if (document.querySelector('[data-build-status="fixing"]')) {
          state.sawFixingStatus = true;
        }
        for (const pill of Array.from(document.querySelectorAll('[data-testid^="prototype-fix-narration-"]'))) {
          const txt = pill.textContent?.trim() ?? '';
          if (txt && !state.sawFixNarration.includes(txt)) state.sawFixNarration.push(txt);
        }
        const ordersFrame = document.querySelector<HTMLIFrameElement>(
          '[data-testid="prototype-artboard-frame-SCR-ORDERS"]',
        );
        if (ordersFrame?.contentWindow) {
          const cw = ordersFrame.contentWindow as unknown as { __ordersFrameLoadedOnce?: boolean };
          if (cw.__ordersFrameLoadedOnce === undefined && ordersFrame.contentDocument?.body?.children.length) {
            cw.__ordersFrameLoadedOnce = true;
          }
          if (ordersFrame.contentDocument?.querySelector('.too-wide')) {
            state.sawInitialOverflow = true;
          }
        }
      };
      inspect();
      new MutationObserver(inspect).observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
      });
      setInterval(inspect, 40);
    });

    // Wait for `截图检查` (`review`) phase to become active (`now`) or finish (`done`), and capture mid-review evidence
    await expect
      .poll(
        async () =>
          await page
            .getByTestId('prototype-phase-review')
            .getAttribute('data-phase-status')
            .catch(() => 'not_started'),
        { timeout: 45_000, intervals: [60] },
      )
      .toMatch(/^(now|done)$/);
    await page.screenshot({ path: `${EVIDENCE_DIR}/e2e-review-in-progress.png` });

    // Wait for R1 to complete
    await expect(page.getByTestId('prototype-history-btn')).toContainText('R1', { timeout: 60_000 });

    const watch = await page.evaluate(
      () =>
        (window as unknown as {
          __reviewWatch: {
            reviewPhaseNow: boolean;
            scanBands: string[];
            sawFixingStatus: boolean;
            sawFixNarration: string[];
            sawInitialOverflow: boolean;
          };
        }).__reviewWatch,
    );
    expect(watch.reviewPhaseNow).toBe(true);
    expect(watch.scanBands.length).toBeGreaterThan(0);
    expect(watch.sawInitialOverflow).toBe(true);
    expect(watch.sawFixingStatus).toBe(true);

    // Phase bar & strip outcomes reflect the completed review + 1 targeted fix
    await expect(page.getByTestId('prototype-phase-review')).toHaveAttribute('data-phase-status', 'done');
    await expect(page.getByTestId('prototype-phase-review')).toContainText('4 屏已查 · 修正 1 屏');
    await expect(page.getByTestId('prototype-strip-card-SCR-ORDERS')).toHaveAttribute('data-review-outcome', 'fixed');
    await expect(page.getByTestId('prototype-strip-card-SCR-HOME')).toHaveAttribute('data-review-outcome', 'pass');

    // Build log records the visual finding and the localized fix in pure business language (zero IDs!)
    const log = page.getByTestId('prototype-build-log');
    const findingEntry = log.locator(
      '[data-testid="prototype-build-log-entry"][data-kind="review_finding"][data-screen-id="SCR-ORDERS"]',
    );
    const fixedEntry = log.locator(
      '[data-testid="prototype-build-log-entry"][data-kind="screen_fixed"][data-screen-id="SCR-ORDERS"]',
    );
    await expect(findingEntry).toContainText('检查「订货单列表」发现问题：');
    await expect(fixedEntry).toContainText('已局部修正「订货单列表」');
    await expect(log).not.toContainText('SCR-');
    await expect(log).not.toContainText('EL-');

    // Verify `SCR-ORDERS` table was fixed in place on the artboard WITHOUT reloading its iframe
    const ordersCheck = await page.evaluate(() => {
      const frame = document.querySelector<HTMLIFrameElement>('[data-testid="prototype-artboard-frame-SCR-ORDERS"]')!;
      const doc = frame.contentDocument!;
      const section = doc.querySelector('[data-element-id="EL-ORDERS-TABLE"]')!;
      const table = doc.querySelector('[data-element-id="EL-ORDERS-GRID"]')!;
      const rect = table.getBoundingClientRect();
      return {
        loadedOnce: Boolean((frame.contentWindow as unknown as { __ordersFrameLoadedOnce?: boolean }).__ordersFrameLoadedOnce),
        hasTooWide: section.classList.contains('too-wide'),
        tableRight: rect.right,
        tableWidth: rect.width,
      };
    });
    expect(ordersCheck.loadedOnce).toBe(true);
    expect(ordersCheck.hasTooWide).toBe(false);
    expect(ordersCheck.tableWidth).toBeGreaterThan(400);
    expect(ordersCheck.tableRight).toBeLessThanOrEqual(1280);

    await page.screenshot({ path: `${EVIDENCE_DIR}/e2e-review-fixed-complete.png` });

    // Verify saved `界面原型.html` contains the targeted fix and ZERO embedded screenshot bytes
    const protosRes = await request.get(`/api/projects/${projectId}/prototypes`);
    expect(protosRes.ok()).toBe(true);
    const { prototypes } = (await protosRes.json()) as { prototypes: { id: string; htmlContent: string }[] };
    expect(prototypes.length).toBeGreaterThan(0);
    expect(prototypes[0]!.htmlContent).not.toContain('class="page too-wide"');
    expect(prototypes[0]!.htmlContent).not.toContain('data:image/');

    // Bilingual check: switch to English and verify phase bar + review log lines
    await page.evaluate(() => localStorage.setItem('onto_locale', 'en-US'));
    await page.reload();
    await expect(page.getByTestId('prototype-phase-review')).toContainText('Screenshot check', { timeout: 15_000 });
    await expect(page.getByTestId('prototype-phase-review')).toContainText('4 checked · 1 fixed');
    await expect(page.getByTestId('prototype-build-log')).toContainText('Issue found on');
    await expect(page.getByTestId('prototype-build-log')).toContainText('Fixed "');
    await page.screenshot({ path: `${EVIDENCE_DIR}/e2e-review-en-us.png` });
  });
});
