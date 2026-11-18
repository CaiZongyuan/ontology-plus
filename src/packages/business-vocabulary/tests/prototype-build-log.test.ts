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
