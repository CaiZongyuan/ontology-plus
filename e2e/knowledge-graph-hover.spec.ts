import { expect, test } from '@playwright/test';

test.describe('Knowledge Graph hover stability', () => {
  test('hovering entity blocks in Swimlane and Ego modes does not hide nodes or oscillate mouseleave', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('nav-app-knowledge-graph').click();

    // Ensure a project with ontology graph nodes is active
    const hasKg = await page
      .getByTestId('kg-root')
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    if (!hasKg) {
      const switched = await page.evaluate(async () => {
        const res = await fetch('/api/workspace');
        const ws = await res.json();
        const candidate = ws.projects?.find(
          (p: { knowledgeGraph?: { nodes?: unknown[] } }) =>
            (p.knowledgeGraph?.nodes?.length ?? 0) > 0,
        );
        if (!candidate) return false;
        await fetch('/api/projects/active', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: candidate.id }),
        });
        return true;
      });
      expect(switched).toBe(true);
      await page.reload();
      await page.getByTestId('nav-app-knowledge-graph').click();
    }

    await expect(page.getByTestId('kg-root')).toBeVisible();
    await page.waitForTimeout(800); // allow initial ELK layout & fitView to settle

    const assertHoverStable = async (modeLabel: string) => {
      await page.evaluate(() => {
        const rfEl = document.querySelector('.react-flow');
        if (!rfEl) throw new Error('Missing .react-flow');
        const win = window as unknown as {
          __kgTrace: Array<{ ev: string; id: string | null; vis?: string }>;
          __kgObs?: MutationObserver;
        };
        win.__kgObs?.disconnect();
        win.__kgTrace = [];

        const obs = new MutationObserver((records) => {
          for (const rec of records) {
            const el = rec.target as HTMLElement;
            if (
              rec.type === 'attributes' &&
              rec.attributeName === 'style' &&
              el.classList?.contains('react-flow__node')
            ) {
              win.__kgTrace.push({
                ev: 'style',
                id: el.getAttribute('data-id'),
                vis: el.style.visibility,
              });
            }
          }
        });
        obs.observe(rfEl, { attributes: true, subtree: true, attributeFilter: ['style'] });
        win.__kgObs = obs;

        if (!(rfEl as unknown as { __kgBound?: boolean }).__kgBound) {
          (rfEl as unknown as { __kgBound?: boolean }).__kgBound = true;
          rfEl.addEventListener(
            'mouseleave',
            (e) => {
              const t = e.target as HTMLElement;
              if (t.classList?.contains('react-flow__node-ontologyEntity')) {
                win.__kgTrace.push({
                  ev: 'leave',
                  id: t.getAttribute('data-id'),
                });
              }
            },
            true,
          );
        }
      });

      const nodeCount = await page.getByTestId('kg-node').count();
      expect(nodeCount).toBeGreaterThan(0);

      for (let i = 0; i < Math.min(5, nodeCount); i += 1) {
        const node = page.getByTestId('kg-node').nth(i);
        const nodeId = await node.getAttribute('data-node-id');
        const box = await node.boundingBox();
        if (!box || box.width < 12 || box.height < 12) continue;

        await page.mouse.move(4, 4);
        await page.waitForTimeout(60);
        await page.evaluate(() => {
          (window as unknown as { __kgTrace: unknown[] }).__kgTrace = [];
        });

        // Move inside the block and jitter slightly within its interior bounds
        await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
        for (let k = 0; k < 6; k += 1) {
          await page.waitForTimeout(50);
          await page.mouse.move(
            box.x + box.width * 0.5 + (k % 2 === 0 ? 3 : -3),
            box.y + box.height * 0.5 + (k % 3 === 0 ? 2 : -2),
          );
        }

        const trace = await page.evaluate(
          () =>
            (
              window as unknown as {
                __kgTrace: Array<{ ev: string; id: string | null; vis?: string }>;
              }
            ).__kgTrace,
        );
        const hiddenFlashes = trace.filter((t) => t.ev === 'style' && t.vis === 'hidden');
        const spuriousLeaves = trace.filter((t) => t.ev === 'leave' && t.id === nodeId);

        expect(
          hiddenFlashes,
          `[${modeLabel}] node ${nodeId} should never become visibility:hidden during hover`,
        ).toEqual([]);
        expect(
          spuriousLeaves,
          `[${modeLabel}] node ${nodeId} should never emit spurious mouseleave while cursor stays inside`,
        ).toEqual([]);
      }
    };

    await assertHoverStable('STAGE_SWIMLANE');

    await page.getByTestId('kg-mode-ego-btn').click();
    await page.waitForTimeout(500);
    await assertHoverStable('EGO_FOCUS');
  });
});

