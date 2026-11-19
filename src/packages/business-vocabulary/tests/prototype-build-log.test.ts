import { describe, expect, it } from 'vitest';
import type { PrototypeBuildFailureCode, PrototypeBuildLogEntry } from '../../ontology-core/index.js';
import {
  checkBusinessViewMarkup,
  describePrototypeBuildFailure,
  describePrototypeBuildLogEntry,
  prototypeBuildAgentName,
} from '../index.js';

const NAMES: Record<string, string> = { 'SCR-REFUND': '退款审批' };
const nameOf = (id: string) => NAMES[id] ?? id;

const ENTRIES: PrototypeBuildLogEntry[] = [
  { id: 1, at: '', agent: 0, kind: 'plan_ready', count: 5 },
  { id: 2, at: '', agent: 3, kind: 'screen_started', screenId: 'SCR-REFUND' },
  { id: 3, at: '', agent: 3, kind: 'screen_done', screenId: 'SCR-REFUND', count: 6 },
  { id: 4, at: '', agent: 3, kind: 'screen_failed', screenId: 'SCR-REFUND', failure: 'validation_failed' },
  { id: 5, at: '', agent: 0, kind: 'screen_resumed', screenId: 'SCR-REFUND' },
  { id: 6, at: '', agent: 0, kind: 'phase_skipped', phase: 'review' },
  { id: 7, at: '', agent: 0, kind: 'build_finished', count: 4, failedCount: 1 },
  { id: 8, at: '', agent: 0, kind: 'plan_rejected' },
  { id: 9, at: '', agent: 0, kind: 'plan_from_dispatch', count: 2 },
  { id: 10, at: '', agent: 0, kind: 'screens_added', screenId: 'SCR-REFUND' },
  { id: 11, at: '', agent: 0, kind: 'style_started' },
  { id: 12, at: '', agent: 0, kind: 'style_ready', locked: true },
  { id: 13, at: '', agent: 0, kind: 'style_ready', locked: false },
  { id: 14, at: '', agent: 0, kind: 'style_values_changed', valueKeys: ['accent', 'mode'] },
  { id: 15, at: '', agent: 0, kind: 'style_lock_unavailable' },
  { id: 16, at: '', agent: 0, kind: 'review_started', screenId: 'SCR-REFUND' },
  { id: 17, at: '', agent: 0, kind: 'review_passed', screenId: 'SCR-REFUND' },
  { id: 18, at: '', agent: 0, kind: 'review_finding', screenId: 'SCR-REFUND', detail: '表格 EL-ORDERS-TABLE 右侧「状态」列被裁切' },
  { id: 19, at: '', agent: 0, kind: 'screen_fixing', screenId: 'SCR-REFUND', detail: '收窄表格宽度让「状态」列完整显示' },
  { id: 20, at: '', agent: 0, kind: 'screen_fixed', screenId: 'SCR-REFUND', detail: '收窄表格宽度让「状态」列完整显示' },
];

describe('prototype build log sentences', () => {
  it('names the screen, never its technical id, in both languages', () => {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const lines = ENTRIES.map((e) => describePrototypeBuildLogEntry(e, nameOf, locale));
      expect(lines.every((l) => l.length > 0)).toBe(true);
      expect(lines.join('\n')).not.toContain('SCR-');
      const markup = `<ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>`;
      expect(checkBusinessViewMarkup(markup)).toEqual([]);
    }
    expect(describePrototypeBuildLogEntry(ENTRIES[3]!, nameOf, 'zh-CN')).toBe(
      '「退款审批」没画完：这一屏有按钮或输入框没有标注好，没能通过检查。',
    );
    expect(describePrototypeBuildLogEntry(ENTRIES[6]!, nameOf, 'en-US')).toContain('1 not finished');
    expect(describePrototypeBuildLogEntry(ENTRIES[13]!, nameOf, 'zh-CN')).toContain('主色、深浅模式');
    expect(describePrototypeBuildLogEntry(ENTRIES[13]!, nameOf, 'en-US')).toContain('main colour, light/dark mode');
    expect(describePrototypeBuildLogEntry(ENTRIES[14]!, nameOf, 'zh-CN')).toContain('找不到你确认风格样张时用的参考');
    expect(describePrototypeBuildLogEntry(ENTRIES[14]!, nameOf, 'en-US')).toContain('Style Tile');
  });

  it('has one sentence for every failure and names the assistants', () => {
    const codes: PrototypeBuildFailureCode[] = [
      'not_written',
      'validation_failed',
      'timeout',
      'model_error',
      'cancelled',
      'interrupted',
    ];
    for (const code of codes) {
      expect(describePrototypeBuildFailure(code, 'zh-CN')).toMatch(/。$/);
      expect(describePrototypeBuildFailure(code, 'en-US')).toMatch(/\.$/);
    }
    expect(prototypeBuildAgentName(0, 'zh-CN')).toBe('主助手');
    expect(prototypeBuildAgentName(2, 'en-US')).toBe('Helper 2');
  });
});
