import { expect, test } from '@playwright/test';
import {
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
} from '../src/packages/business-vocabulary/index.js';

// Minimal valid 1x1 PNG buffer
const TINY_PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

test.describe('Conversation Composer & Message Actions (#81)', () => {
  test.beforeEach(({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error(`Forbidden blocking browser dialog triggered: ${dialog.message()}`);
    });
  });

  test('persists per-session drafts across switch & reload, quotes canvas/reply selections, attaches/pastes images, copies replies, edits/retries ONLY latest user turn, and queues/withdraws/stops active runs', async ({
    page,
    request,
  }) => {
    const createdRes = await request.post('/api/projects', {
      data: {
        name: '集团采购合同风控平台',
        code: `CONV_81_${Date.now().toString(36).toUpperCase()}`,
        center: 'APPLICATION',
        domain: '采购与法务风控',
        template: 'EMPTY',
      },
    });
    expect(createdRes.ok()).toBe(true);
    const { project } = (await createdRes.json()) as { project: { id: string } };

    // Seed a requirement document so the step canvas has real business prose to select & quote
    const docRes = await request.post('/api/requirements/docs', {
      data: {
        id: `rdoc-81-${Date.now().toString(36)}`,
        projectId: project.id,
        title: '集团采购合同管理需求规格书',
        version: 'v1.0',
        content: [
          '# 1. 业务目标与范围',
          '',
          '建立集团统一的供应商准入审核、采购合同分级会签与履约验收闭环。',
          '',
          '# 2. 关键审批规则',
          '',
          '年度累计金额超过一百万元的框架合同必须经过法务负责人与财务总监双签。',
        ].join('\n'),
      },
    });
    expect(docRes.ok()).toBe(true);

    // Seed two REQUIREMENT sessions: Session A (2 turns) and Session B (1 turn)
    const sessARes = await request.post('/api/agent-sessions', {
      data: {
        projectId: project.id,
        agentKind: 'REQUIREMENT',
        title: '合同审批主对话',
        initialMessages: [
          {
            id: 'u-81-a1',
            role: 'user',
            content: '第一轮：请明确供应商准入需要核验哪些证照材料',
            timestamp: '2026-11-18T08:00:00.000Z',
          },
          {
            id: 'a-81-a1',
            role: 'assistant',
            content:
              '供应商准入需核验营业执照、行业经营许可证以及近两年纳税信用证明材料。',
            timestamp: '2026-11-18T08:00:05.000Z',
          },
          {
            id: 'u-81-a2',
            role: 'user',
            content: '第二轮（待修改）：超过 200 万元的采购合同走双签审批',
            timestamp: '2026-11-18T08:02:00.000Z',
          },
          {
            id: 'a-81-a2',
            role: 'assistant',
            content: '已按 200 万元双签门槛记录采购合同分级审批要求。',
            timestamp: '2026-11-18T08:02:06.000Z',
          },
        ],
      },
    });
    expect(sessARes.ok()).toBe(true);
    const { session: sessA } = (await sessARes.json()) as { session: { id: string } };

    const sessBRes = await request.post('/api/agent-sessions', {
      data: {
        projectId: project.id,
        agentKind: 'REQUIREMENT',
        title: '外币结算专题对话',
        initialMessages: [
          {
            id: 'u-81-b1',
            role: 'user',
            content: '梳理跨境采购多币种汇率折算口径',
            timestamp: '2026-11-18T08:05:00.000Z',
          },
          {
            id: 'a-81-b1',
            role: 'assistant',
            content: '建议按合同签署当日央行中间价锁定预算折算汇率。',
            timestamp: '2026-11-18T08:05:04.000Z',
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

      // Switch to Session A ("合同审批主对话")
      await panel.getByTestId('assistant-history-menu-btn').click();
      await page
        .getByTestId('assistant-history-menu')
        .locator('[data-testid="assistant-history-item"]', { hasText: '合同审批主对话' })
        .getByTestId('assistant-select-session-btn')
        .click();

      const composerInput = panel.getByTestId('agent-panel-composer-input');
      await expect(panel.getByTestId('conversation-turn')).toHaveCount(2);

      // ─── 1. Per-Session Persisted Drafts across Session Switch & Reload ───
      await composerInput.fill('会话A未发草稿：补充履约保证金退还条件');

      // Switch to Session B -> composer should be empty -> enter Session B's own draft
      await panel.getByTestId('assistant-history-menu-btn').click();
      await page
        .getByTestId('assistant-history-menu')
        .locator('[data-testid="assistant-history-item"]', { hasText: '外币结算专题对话' })
        .getByTestId('assistant-select-session-btn')
        .click();
      await expect(composerInput).toHaveValue('');
      await composerInput.fill('会话B独立草稿：约定汇率波动超 3% 调价条款');

      // Switch back to Session A -> restores Session A's draft
      await panel.getByTestId('assistant-history-menu-btn').click();
      await page
        .getByTestId('assistant-history-menu')
        .locator('[data-testid="assistant-history-item"]', { hasText: '合同审批主对话' })
        .getByTestId('assistant-select-session-btn')
        .click();
      await expect(composerInput).toHaveValue('会话A未发草稿：补充履约保证金退还条件');

      // Reload browser -> Session A's draft is still restored from localStorage
      await page.reload();
      await expect(page.getByTestId('agent-panel')).toBeVisible();
      await expect(page.getByTestId('agent-panel-composer-input')).toHaveValue(
        '会话A未发草稿：补充履约保证金退还条件',
      );
      await page.getByTestId('agent-panel-composer-input').fill('');

      // ─── 2. Copy Reply & Latest-User-Message-Only Edit / Retry ───
      const replyCopyBtns = panel.getByTestId('reply-copy-btn');
      await expect(replyCopyBtns).toHaveCount(2);
      await replyCopyBtns.first().click();
      await expect(replyCopyBtns.first()).toHaveAttribute('data-copied', 'true');
      await expect(replyCopyBtns.first()).toContainText('已复制');

      const userTurns = panel.getByTestId('conversation-user-message');
      await expect(userTurns).toHaveCount(2);
      const earlierUserTurn = userTurns.nth(0);
      const latestUserTurn = userTurns.nth(1);

      // Earlier user message has NO edit or retry buttons, and exposes calm restore-history guidance on hover
      await expect(earlierUserTurn).toHaveAttribute('data-latest-user-turn', 'false');
      await expect(earlierUserTurn.getByTestId('user-msg-edit-btn')).toHaveCount(0);
      await expect(earlierUserTurn.getByTestId('user-msg-retry-btn')).toHaveCount(0);
      await earlierUserTurn.hover();
      await expect(earlierUserTurn.getByTestId('earlier-msg-locked-hint')).toBeVisible();
      await expect(earlierUserTurn.getByTestId('earlier-msg-locked-hint')).toContainText(
        '仅支持编辑最后一条消息；如需回到更早的状态，请在历史记录中使用「恢复到这次变更之前」',
      );

      // Latest user message HAS Edit and Retry buttons; editing replaces turn 2 in-place cleanly
      await expect(latestUserTurn).toHaveAttribute('data-latest-user-turn', 'true');
      await expect(latestUserTurn.getByTestId('user-msg-edit-btn')).toBeVisible();
      await expect(latestUserTurn.getByTestId('user-msg-retry-btn')).toBeVisible();

      await latestUserTurn.getByTestId('user-msg-edit-btn').click();
      const editInput = latestUserTurn.getByTestId('user-msg-edit-input');
      await expect(editInput).toBeVisible();
      await editInput.fill('第二轮（已修改）：超过 50 万元的采购合同即需法务与财务双签');
      await latestUserTurn.getByTestId('user-msg-edit-submit').click();

      await expect(
        panel.locator('[data-testid="conversation-turn"][data-run-status="SUCCEEDED"]').nth(1),
      ).toBeVisible({ timeout: 25_000 });
      await expect(panel.getByTestId('conversation-turn')).toHaveCount(2);
      await expect(panel).toContainText('第二轮（已修改）：超过 50 万元的采购合同即需法务与财务双签');
      await expect(panel).not.toContainText('第二轮（待修改）：超过 200 万元的采购合同走双签审批');

      // Clicking "重试" on the latest user message replaces & re-runs the latest turn without duplicating it
      await latestUserTurn.getByTestId('user-msg-retry-btn').click();
      await expect(
        panel.locator('[data-testid="conversation-turn"][data-run-status="SUCCEEDED"]').nth(1),
      ).toBeVisible({ timeout: 25_000 });
      await expect(panel.getByTestId('conversation-turn')).toHaveCount(2);

      // ─── 3. Quote Selected Text from Assistant Reply & Step Canvas into Composer ───
      await page.evaluate(() => {
        const md = document.querySelector('[data-testid="conversation-assistant-markdown"]');
        if (!md) throw new Error('Assistant markdown not found');
        const range = document.createRange();
        range.selectNodeContents(md);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });

      const quoteBtn = page.getByTestId('selection-quote-btn');
      await expect(quoteBtn).toBeVisible();
      await expect(quoteBtn).toContainText('引用到对话');
      await quoteBtn.click();

      await expect(panel.getByTestId('composer-quote-chip')).toHaveCount(1);
      await expect(panel.getByTestId('agent-panel-composer-input')).toBeFocused();

      // Also select text on the Requirements step canvas
      await page.evaluate(() => {
        const canvas = document.querySelector('[data-testid="requirements-step-canvas"]');
        const targetP = canvas?.querySelector('p') ?? canvas;
        if (!targetP) throw new Error('Canvas text not found');
        const range = document.createRange();
        range.selectNodeContents(targetP);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
      await expect(quoteBtn).toBeVisible();
      await quoteBtn.click();
      await expect(panel.getByTestId('composer-quote-chip')).toHaveCount(2);

      // Remove first quote chip, keep canvas quote chip, type question, and send
      await panel.getByTestId('composer-quote-remove-btn').first().click();
      await expect(panel.getByTestId('composer-quote-chip')).toHaveCount(1);
      await panel
        .getByTestId('agent-panel-composer-input')
        .fill('请针对这段引用补充逾期未审批提醒机制');
      await panel.getByTestId('agent-panel-send-btn').click();

      await expect(
        panel.locator('[data-testid="conversation-turn"][data-run-status="SUCCEEDED"]').nth(2),
      ).toBeVisible({ timeout: 25_000 });
      await expect(panel.getByTestId('composer-quote-chip')).toHaveCount(0);
      await expect(panel.getByTestId('conversation-user-message').nth(2)).toContainText('>');
      await expect(panel.getByTestId('conversation-user-message').nth(2)).toContainText(
        '请针对这段引用补充逾期未审批提醒机制',
      );

      // ─── 4. Paste & Attach Image into Composer and Send in User Turn ───
      // Test clipboard paste of an image File
      await page.evaluate((pngBytes) => {
        const form = document.querySelector('.agent-panel-composer-form');
        if (!form) throw new Error('Composer form not found');
        const file = new File([new Uint8Array(pngBytes)], 'pasted-approval-sketch.png', {
          type: 'image/png',
        });
        const dt = new DataTransfer();
        dt.items.add(file);
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt,
        });
        form.dispatchEvent(pasteEvent);
      }, Array.from(TINY_PNG_BUFFER));

      await expect(panel.getByTestId('composer-image-strip')).toBeVisible();
      await expect(
        panel.getByTestId('composer-image-strip').getByTestId('local-image-thumbnail'),
      ).toHaveCount(1);
      await expect(panel.getByTestId('composer-image-strip')).toContainText(
        'pasted-approval-sketch.png',
      );

      // Also attach a second image via file input
      await panel.getByTestId('composer-image-input').setInputFiles({
        name: 'uploaded-seal-rule.png',
        mimeType: 'image/png',
        buffer: TINY_PNG_BUFFER,
      });
      await expect(
        panel.getByTestId('composer-image-strip').getByTestId('local-image-thumbnail'),
      ).toHaveCount(2);

      // Also drag & drop a third image onto the composer form
      await page.evaluate((pngBytes) => {
        const form = document.querySelector('.agent-panel-composer-form');
        if (!form) throw new Error('Composer form not found');
        const file = new File([new Uint8Array(pngBytes)], 'dropped-matrix.png', {
          type: 'image/png',
        });
        const dt = new DataTransfer();
        dt.items.add(file);
        const dropEvent = new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        });
        form.dispatchEvent(dropEvent);
      }, Array.from(TINY_PNG_BUFFER));

      await expect(
        panel.getByTestId('composer-image-strip').getByTestId('local-image-thumbnail'),
      ).toHaveCount(3);

      await panel
        .getByTestId('agent-panel-composer-input')
        .fill('请结合这三张审批草图核对印章会签环节');
      await panel.getByTestId('agent-panel-send-btn').click();

      await expect(
        panel.locator('[data-testid="conversation-turn"][data-run-status="SUCCEEDED"]').nth(3),
      ).toBeVisible({ timeout: 25_000 });
      await expect(
        panel
          .getByTestId('conversation-user-message')
          .nth(3)
          .getByTestId('agent-run-images')
          .getByTestId('local-image-thumbnail'),
      ).toHaveCount(3);

      // ─── 5. Queue While Running, Withdraw Queued Item, and Cancel Active Run via Stop Button ───
      let releaseStream: (() => void) | undefined;
      const streamGate = new Promise<void>((resolve) => {
        releaseStream = resolve;
      });

      await page.route(`**/api/agent-sessions/${sessA.id}/stream`, async (route) => {
        await streamGate;
        await route.abort('aborted').catch(() => undefined);
      });

      await panel
        .getByTestId('agent-panel-composer-input')
        .fill('长耗时梳理任务：逐章核对违约责任条款');
      await panel.getByTestId('agent-panel-send-btn').click();

      // Active run shows Stop button right in composer
      const stopBtn = panel.getByTestId('composer-stop-btn');
      await expect(stopBtn).toBeVisible();
      await expect(stopBtn).toContainText('停止');

      // Queue a follow-up message while active run is in progress
      await panel.getByTestId('agent-panel-composer-input').fill('排队待撤回消息：补充争议管辖地');
      await expect(panel.getByTestId('agent-panel-send-btn')).toContainText('排队发送');
      await panel.getByTestId('agent-panel-send-btn').click();

      const queueBox = panel.getByTestId('agent-panel-queue');
      await expect(queueBox).toBeVisible();
      await expect(queueBox).toContainText('排队待撤回消息：补充争议管辖地');

      // Withdraw the queued prompt before it runs
      await queueBox.getByTestId('agent-panel-queue-remove-btn').click();
      await expect(queueBox).toHaveCount(0);

      // Cancel active run via Stop button
      await page.unroute(`**/api/agent-sessions/${sessA.id}/stream`);
      await stopBtn.click();
      releaseStream?.();
      await expect(stopBtn).toHaveCount(0);

      // Final Business View vocabulary guard across both locales
      const zhHtml = await page.locator('.wb-shell').evaluate((el) => el.outerHTML);
      const zhViolations = checkBusinessViewMarkup(zhHtml);
      expect(zhViolations, formatBusinessViewViolations(zhViolations)).toEqual([]);

      await page.getByTestId('locale-toggle-btn').click();
      const enHtml = await page.locator('.wb-shell').evaluate((el) => el.outerHTML);
      const enViolations = checkBusinessViewMarkup(enHtml);
      expect(enViolations, formatBusinessViewViolations(enViolations)).toEqual([]);
    } finally {
      await request.post('/api/projects/active', { data: { projectId: 'proj-contract' } });
      await request.delete(`/api/projects/${project.id}?force=true`);
    }
  });
});
