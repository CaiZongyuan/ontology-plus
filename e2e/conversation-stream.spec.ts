import { expect, test } from '@playwright/test';
import {
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
} from '../src/packages/business-vocabulary/index.js';

test.describe('Conversation Stream Skeleton (#79): Streaming Markdown, Sticky Scroll, Jump to Latest & Per-Session Scroll Memory', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('renders continuous turns without AgentRunCard, keeps sticky scroll unless scrolled up, shows Jump to latest without yanking during streaming, and restores scroll offset across session switches and reload', async ({
    page,
    request,
  }) => {
    const createdRes = await request.post('/api/projects', {
      data: {
        name: '供应链采购协同平台',
        code: `CONV_79_${Date.now().toString(36).toUpperCase()}`,
        center: 'APPLICATION',
        domain: '供应链采购管理',
        template: 'EMPTY',
      },
    });
    expect(createdRes.ok()).toBe(true);
    const { project } = (await createdRes.json()) as { project: { id: string } };

    // Seed a multi-turn REQUIREMENT conversation (Session A) tall enough to overflow viewport, including Markdown headings, lists, table, and code block
    const longReply = (n: number) =>
      [
        `## 第 ${n} 轮业务梳理结论`,
        '',
        '- **准入核验**：供应商营业执照、质量体系认证与年度资信评级核对。',
        '- **分级会签**：普通采购由采购经理审批，超额采购由法务与财务双签。',
        '- **异常处置**：到货批次抽检不合格时支持整批拒收或让步接收扣款。',
        '',
        '| 业务环节 | 负责角色 | 处理时限 |',
        '| --- | --- | --- |',
        '| 资质初审 | 采购专员 | 2 个工作日 |',
        '| 大额会签 | 法务与财务负责人 | 3 个工作日 |',
        '',
        '```ts',
        `export const stageLimitDays_${n} = 3;`,
        '```',
        ...(n === 1
          ? [
              '',
              '```mermaid',
              'flowchart LR',
              '  Apply["提交资质"] --> Audit["双签审核"]',
              '  Audit --> Active["准入生效"]',
              '```',
            ]
          : []),
      ].join('\n');

    const initialMessages = Array.from({ length: 6 }, (_, idx) => {
      const turnNo = idx + 1;
      return [
        {
          id: `u-seed-${turnNo}`,
          role: 'user' as const,
          content: `请梳理第 ${turnNo} 部分供应商准入与合同履约验收条款细节`,
          timestamp: new Date(Date.UTC(2026, 10, 18, 8, turnNo * 2, 0)).toISOString(),
        },
        {
          id: `a-seed-${turnNo}`,
          role: 'assistant' as const,
          content: longReply(turnNo),
          timestamp: new Date(Date.UTC(2026, 10, 18, 8, turnNo * 2, 30)).toISOString(),
        },
      ];
    }).flat();

    const sessARes = await request.post('/api/agent-sessions', {
      data: {
        projectId: project.id,
        agentKind: 'REQUIREMENT',
        title: '供应商准入长对话',
        initialMessages,
      },
    });
    expect(sessARes.ok()).toBe(true);
    const { session: sessA } = (await sessARes.json()) as { session: { id: string } };

    const sessBRes = await request.post('/api/agent-sessions', {
      data: {
        projectId: project.id,
        agentKind: 'REQUIREMENT',
        title: '短对话分会场',
        initialMessages: [
          {
            id: 'u-short-1',
            role: 'user',
            content: '确认发票三单匹配规则',
            timestamp: '2026-11-18T09:00:00.000Z',
          },
          {
            id: 'a-short-1',
            role: 'assistant',
            content: '已记录**订单、入库单、发票**三单匹配校验规则。',
            timestamp: '2026-11-18T09:00:05.000Z',
          },
        ],
      },
    });
    expect(sessBRes.ok()).toBe(true);

    try {
      await page.goto(`/?projectId=${project.id}&step=requirements`);
      const panel = page.getByTestId('agent-panel');
      await expect(panel).toBeVisible();
      await expect(panel).toHaveAttribute('data-presentation-mode', 'conversation');

      // Switch to Session A ("供应商准入长对话") via History Menu
      await panel.getByTestId('assistant-history-menu-btn').click();
      const historyMenu = page.getByTestId('assistant-history-menu');
      await expect(historyMenu).toBeVisible();
      await historyMenu
        .locator('[data-testid="assistant-history-item"]', { hasText: '供应商准入长对话' })
        .getByTestId('assistant-select-session-btn')
        .click();

      const thread = panel.getByTestId('conversation-thread');
      await expect(panel.getByTestId('conversation-turn')).toHaveCount(6);
      await expect(panel.getByTestId('agent-run-card')).toHaveCount(0);

      // Verify Markdown headings, lists, tables, code blocks, and Mermaid diagram rendered cleanly
      await expect(thread.locator('h2').first()).toContainText('业务梳理结论');
      await expect(thread.locator('table').first()).toBeVisible();
      await expect(thread.getByTestId('mermaid-diagram').first()).toBeVisible({ timeout: 15_000 });

      // Initially pinned to bottom -> Jump to latest button is hidden
      const jumpBtn = panel.getByTestId('conversation-jump-to-latest');
      await expect(jumpBtn).toHaveCount(0);

      const initialScrollMetrics = await thread.evaluate((el) => ({
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
      }));
      expect(initialScrollMetrics.scrollHeight).toBeGreaterThan(
        initialScrollMetrics.clientHeight + 250,
      );
      expect(
        initialScrollMetrics.scrollHeight -
          initialScrollMetrics.scrollTop -
          initialScrollMetrics.clientHeight,
      ).toBeLessThanOrEqual(48);

      // 1. User scrolls up away from the bottom -> "跳到最新" button appears!
      await thread.evaluate((el) => {
        el.scrollTop = 120;
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
      });
      await expect(jumpBtn).toBeVisible();
      await expect(jumpBtn).toContainText('跳到最新');

      // Bilingual check on "Jump to latest" + Business View markup guard
      await page.getByTestId('locale-toggle-btn').click();
      await expect(jumpBtn).toContainText('Jump to latest');
      const enMarkup = await page.locator('.wb-shell').evaluate((el) => el.outerHTML);
      const enViolations = checkBusinessViewMarkup(enMarkup);
      expect(enViolations, formatBusinessViewViolations(enViolations)).toEqual([]);

      await page.getByTestId('locale-toggle-btn').click();
      await expect(jumpBtn).toContainText('跳到最新');
      const zhMarkup = await page.locator('.wb-shell').evaluate((el) => el.outerHTML);
      const zhViolations = checkBusinessViewMarkup(zhMarkup);
      expect(zhViolations, formatBusinessViewViolations(zhViolations)).toEqual([]);

      // 2. Incoming streaming chunks while user is scrolled up MUST NOT yank scrollTop to bottom!
      // Trigger synthesize-srs-btn (canvas button -> runs a real streaming 7th turn without composer submit)
      await page.getByTestId('synthesize-srs-btn').click();
      await expect(panel.getByTestId('conversation-turn')).toHaveCount(7, { timeout: 25_000 });
      await expect(page.getByTestId('requirements-document-sections')).toBeVisible({
        timeout: 25_000,
      });

      const scrollTopDuringRead = await thread.evaluate((el) => Math.round(el.scrollTop));
      expect(scrollTopDuringRead).toBe(120);
      await expect(jumpBtn).toBeVisible();

      // 3. Switch to Session B (at bottom -> no Jump button), then switch back to Session A -> restores scrollTop ~120!
      await panel.getByTestId('assistant-history-menu-btn').click();
      await page
        .getByTestId('assistant-history-menu')
        .locator('[data-testid="assistant-history-item"]', { hasText: '短对话分会场' })
        .getByTestId('assistant-select-session-btn')
        .click();
      await expect(jumpBtn).toHaveCount(0);
      await expect(panel).toContainText('确认发票三单匹配规则');

      await panel.getByTestId('assistant-history-menu-btn').click();
      await page
        .getByTestId('assistant-history-menu')
        .locator('[data-testid="assistant-history-item"]', { hasText: '供应商准入长对话' })
        .getByTestId('assistant-select-session-btn')
        .click();
      await expect(jumpBtn).toBeVisible();
      const restoredAfterSwitch = await thread.evaluate((el) => Math.round(el.scrollTop));
      expect(restoredAfterSwitch).toBe(120);

      // 4. Reload browser -> restores Session A's saved scroll offset (120) and Jump to latest button!
      await page.reload();
      await expect(page.getByTestId('agent-panel')).toBeVisible();
      await expect(page.getByTestId('conversation-jump-to-latest')).toBeVisible();
      const restoredAfterReload = await page
        .getByTestId('conversation-thread')
        .evaluate((el) => Math.round(el.scrollTop));
      expect(restoredAfterReload).toBe(120);

      // 5. Clicking "跳到最新" scrolls back to bottom, hides the button, and re-arms sticky scroll!
      await page.getByTestId('conversation-jump-to-latest').click();
      await expect(page.getByTestId('conversation-jump-to-latest')).toHaveCount(0);
      const pinnedMetrics = await page.getByTestId('conversation-thread').evaluate((el) => ({
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
      }));
      expect(
        pinnedMetrics.scrollHeight - pinnedMetrics.scrollTop - pinnedMetrics.clientHeight,
      ).toBeLessThanOrEqual(48);
    } finally {
      await request.post('/api/projects/active', { data: { projectId: 'proj-contract' } });
      await request.delete(`/api/projects/${project.id}?force=true`);
    }
  });
});
