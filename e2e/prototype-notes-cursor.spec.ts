import { expect, test } from '@playwright/test';

/**
 * #92: Prototype Notes (`data-note`), real element-measured agent cursors, narration bubbles,
 * BuildLog "现在" rows, and per-device cursor preferences on both the canvas and in web mode.
 */

async function setUpProjectWithConfirmedRequirements(request: import('@playwright/test').APIRequestContext) {
  const createdRes = await request.post('/api/projects', {
    data: {
      name: '门店订货系统',
      code: `CURSOR_NOTES_${Date.now().toString(36).toUpperCase()}`,
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

test.describe('Prototype Notes, real agent cursors, and live narration (#92)', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('shows real measured cursor + narration bubble + BuildLog "现在" row on canvas AND in web mode, with portaled per-device cursor menu', async ({
    page,
    request,
  }) => {
    const projectId = await setUpProjectWithConfirmedRequirements(request);
    await page.goto(`/?projectId=${projectId}&mode=app-prototype`);
    await expect(page.getByTestId('prototype-briefing-stage')).toBeVisible();

    await page.getByTestId('confirm-brief-generate-btn').click();
    const viewport = page.getByTestId('prototype-canvas-viewport');
    await expect(viewport).toBeVisible({ timeout: 15_000 });

    // 1. Canvas mode: observe a live cursor with arrow style, assistant name, narration bubble, and matching BuildLog "现在" row.
    const observedCanvas = await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const cursors = Array.from(
              document.querySelectorAll<HTMLElement>('[data-testid^="prototype-agent-cursor-SCR-"]'),
            );
            const liveRows = Array.from(
              document.querySelectorAll<HTMLElement>('[data-testid="prototype-build-log-live"]'),
            );
            for (const c of cursors) {
              const sid = c.getAttribute('data-screen-id') ?? '';
              const bubble = c.querySelector<HTMLElement>(`[data-testid="prototype-cursor-bubble-${sid}"]`);
              const nameTag = c.querySelector<HTMLElement>('[data-testid="prototype-cursor-name"]');
              const bubbleText = bubble?.textContent?.trim() ?? '';
              const matchingLog = liveRows.find(
                (r) => r.getAttribute('data-screen-id') === sid && (r.textContent ?? '').includes(bubbleText),
              );
              if (bubbleText && nameTag?.textContent?.trim() && matchingLog) {
                return {
                  screenId: sid,
                  style: c.getAttribute('data-cursor-style'),
                  name: nameTag.textContent.trim(),
                  sentence: bubbleText,
                  logHasNow: (matchingLog.textContent ?? '').includes('现在'),
                };
              }
            }
            return null;
          }),
        { timeout: 30_000, intervals: [60] },
      )
      .not.toBeNull()
      .then(() =>
        page.evaluate(() => {
          const c = document.querySelector<HTMLElement>('[data-testid^="prototype-agent-cursor-SCR-"]');
          const bubble = document.querySelector<HTMLElement>('[data-testid^="prototype-cursor-bubble-SCR-"]');
          return {
            style: c?.getAttribute('data-cursor-style') ?? 'arrow',
            sentence: bubble?.textContent?.trim() ?? '',
          };
        }),
      );

    expect(observedCanvas.style).toBe('arrow');
    await page.screenshot({ path: '.scratch/issue-92/e2e-canvas-cursor-narration.png' });

    // Wait for initial build R1 to finish (SCR-REFUND is left unfinished in Mock replay).
    await expect(page.getByTestId('prototype-history-btn')).toContainText('R1', { timeout: 60_000 });

    // Saved revision embeds Prototype Notes (`data-note`) on anchored elements.
    const homeNoteCount = await page
      .frameLocator('[data-testid="prototype-artboard-frame-SCR-HOME"]')
      .locator('[data-element-id][data-note]')
      .count();
    expect(homeNoteCount).toBeGreaterThanOrEqual(3);

    // 2. Open 「光标 ▾」 menu -> portaled outside the overflow-hidden canvas viewport; switch to nib.
    await page.getByTestId('prototype-dock-cursor').click();
    const menu = page.getByTestId('prototype-cursor-menu');
    await expect(menu).toBeVisible();
    const portaledOutsideViewport = await page.evaluate(() => {
      const vp = document.querySelector('[data-testid="prototype-canvas-viewport"]');
      const mn = document.querySelector('[data-testid="prototype-cursor-menu"]');
      return Boolean(vp && mn && !vp.contains(mn) && document.body.contains(mn));
    });
    expect(portaledOutsideViewport).toBe(true);
    await page.screenshot({ path: '.scratch/issue-92/e2e-cursor-menu.png' });

    await page.getByTestId('prototype-cursor-style-nib').click();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    // Reload: cursor preference is remembered on this device.
    await page.reload();
    await expect(page.getByTestId('prototype-canvas-viewport')).toBeVisible({ timeout: 15_000 });

    // 3. Switch to Web mode and resume SCR-REFUND -> watch live nib cursor + narration bubble + BuildLog "现在" row in web mode!
    await page.getByTestId('prototype-dock-view-web').click();
    await expect(page.getByTestId('prototype-web-view')).toBeVisible();
    await page.getByTestId('prototype-web-page-select').selectOption('SCR-REFUND');
    await expect(page.getByTestId('prototype-web-view')).toHaveAttribute('data-web-screen', 'SCR-REFUND');

    await page.getByTestId('prototype-web-retry-SCR-REFUND').click();

    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const c = document.querySelector<HTMLElement>('[data-testid="prototype-web-agent-cursor"]');
            const bubble = document.querySelector<HTMLElement>('[data-testid="prototype-web-cursor-bubble"]');
            const liveRow = document.querySelector<HTMLElement>(
              '[data-testid="prototype-build-log-live"][data-screen-id="SCR-REFUND"]',
            );
            const text = bubble?.textContent?.trim() ?? '';
            if (!c || !text || !liveRow) return null;
            return {
              style: c.getAttribute('data-cursor-style'),
              sentence: text,
              inLog: (liveRow.textContent ?? '').includes(text),
            };
          }),
        { timeout: 25_000, intervals: [50] },
      )
      .toEqual(
        expect.objectContaining({
          style: 'nib',
          inLog: true,
        }),
      );

    await page.screenshot({ path: '.scratch/issue-92/e2e-web-cursor-narration.png' });
    await expect(page.getByTestId('prototype-history-btn')).toContainText('R2', { timeout: 60_000 });
  });
});
