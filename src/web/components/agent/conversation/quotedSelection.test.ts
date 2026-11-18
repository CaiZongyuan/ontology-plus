import { describe, expect, it } from 'vitest';
import {
  appendUniqueQuote,
  composePromptWithQuotes,
  computeFloatingQuoteButtonPosition,
  formatQuotedBlockquote,
  normalizeQuotedSnippet,
  resolveQuotableSourceFromElement,
  summarizeQuoteChipLabel,
} from './quotedSelection.js';

function fakeElement(matchingSelectors: readonly string[]) {
  const set = new Set(matchingSelectors);
  return {
    closest: (selector: string) => {
      const parts = selector.split(',').map((s) => s.trim());
      return parts.some((p) => set.has(p)) ? {} : null;
    },
  };
}

describe('quotedSelection (#81)', () => {
  it('normalizes quoted snippets, builds chip labels, and composes Markdown blockquotes onto prompts', () => {
    expect(normalizeQuotedSnippet('   \n\t  ')).toBe('');
    expect(normalizeQuotedSnippet('  第一行条款\r\n\r\n\r\n第二行条款  ')).toBe(
      '第一行条款\n\n第二行条款',
    );

    expect(formatQuotedBlockquote('普通采购由采购经理审批\n超额采购由法务与财务双签')).toBe(
      '> 普通采购由采购经理审批\n> 超额采购由法务与财务双签',
    );

    expect(
      composePromptWithQuotes(
        ['超过 100 万元的合同需要法务与财务双签。'],
        '请将门槛调整为 50 万元并补充超时升级规则',
      ),
    ).toBe(
      '> 超过 100 万元的合同需要法务与财务双签。\n\n请将门槛调整为 50 万元并补充超时升级规则',
    );

    expect(composePromptWithQuotes([], '直接发送普通消息')).toBe('直接发送普通消息');
    expect(composePromptWithQuotes(['单独发送引用内容'], '   ')).toBe('> 单独发送引用内容');

    const withFirst = appendUniqueQuote([], '  供应商资质初审 2 个工作日  ');
    expect(withFirst).toEqual(['供应商资质初审 2 个工作日']);
    expect(appendUniqueQuote(withFirst, '供应商资质初审 2 个工作日')).toEqual([
      '供应商资质初审 2 个工作日',
    ]);

    expect(summarizeQuoteChipLabel('第一行\n第二行内容紧凑展示', 40)).toBe('第一行 第二行内容紧凑展示');
  });

  it('recognizes quotable selections in assistant replies and step canvases while excluding inputs, buttons, and composer chrome', () => {
    expect(
      resolveQuotableSourceFromElement(
        fakeElement(['[data-testid="conversation-assistant-markdown"]', '[data-testid="agent-panel"]']),
      ),
    ).toBe('reply');

    expect(
      resolveQuotableSourceFromElement(
        fakeElement(['[data-testid="requirements-step-canvas"]', '[data-testid="workbench-canvas"]']),
      ),
    ).toBe('canvas');

    // Excluded inside inputs/textareas/buttons even when on canvas
    expect(
      resolveQuotableSourceFromElement(
        fakeElement(['textarea', '[data-testid="workbench-canvas"]']),
      ),
    ).toBeNull();
    expect(
      resolveQuotableSourceFromElement(
        fakeElement(['button', '[data-testid="conversation-assistant-markdown"]']),
      ),
    ).toBeNull();

    // Excluded inside non-reply parts of agent-panel (such as user message bubble or composer)
    expect(
      resolveQuotableSourceFromElement(fakeElement(['[data-testid="agent-panel"]'])),
    ).toBeNull();
  });

  it('positions floating quote button above selection and flips below when near top viewport edge', () => {
    const normal = computeFloatingQuoteButtonPosition(
      { top: 220, left: 400, width: 120, height: 22, bottom: 242 },
      { width: 1440, height: 900 },
    );
    expect(normal.top).toBeLessThan(220);
    expect(normal.left).toBeGreaterThanOrEqual(12);

    const nearTop = computeFloatingQuoteButtonPosition(
      { top: 18, left: 4, width: 60, height: 20, bottom: 38 },
      { width: 1440, height: 900 },
    );
    expect(nearTop.top).toBeGreaterThanOrEqual(38);
    expect(nearTop.left).toBe(12);
  });
});
