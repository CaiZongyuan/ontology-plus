// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSubagentLaneTrace } from '../../../../packages/workspace-store/index.js';
import { PreferencesProvider } from '../../../i18n.js';
import { AgentPanel } from '../AgentPanel.js';
import type { AgentRunView } from '../agentRun.js';

const label = (text: string) => ({ zh: text, en: text });
const task: AgentSubagentLaneTrace = {
  laneId: 'lane-one', workerIndex: 1, workerLabel: label('Reviewer'), taskTitle: label('Review orders'),
  assignment: 'Cross-check order totals against receipts.',
  status: 'RUNNING', liveAction: label('Checking recent orders'), startedAt: new Date().toISOString(),
};
const run: AgentRunView = {
  id: 'live', sourceSessionId: 'conversation-a', title: label('Plan orders'), startedAt: Date.now(),
  status: 'RUNNING', steps: [], liveStatus: label('Reviewing'), subagentLanes: [task],
};

describe('latest delegated work in the conversation panel', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const submit = vi.fn();
  function render(runs: AgentRunView[], session = 'conversation-a') {
    act(() => root.render(<PreferencesProvider><AgentPanel title={label('AI Assistant')} width={400}
      activeSessionId={session} runs={runs} onClose={vi.fn()} onResize={vi.fn()}
      onSubmitPrompt={submit} composerValue="Unsent note" /></PreferencesProvider>));
  }
  function clickSwitcherButton(title: string) {
    const button = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="View delegated work"] button'))
      .find((node) => node.textContent === title);
    expect(button).toBeDefined();
    act(() => button!.click());
  }
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    localStorage.setItem('onto_locale', 'en-US');
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
    submit.mockClear();
  });
  it('follows a selected task through completion; persisted tasks are readable on remount', () => {
    render([run]);
    clickSwitcherButton('Review orders');
    expect(host.querySelector('textarea')).toBeNull();
    expect(host.querySelector('[aria-label="Task record"]')?.textContent).toContain('Cross-check order totals against receipts.');
    expect(host.querySelector('[aria-label="Task record"]')?.textContent).toContain('Checking recent orders');
    const saved: AgentRunView = { ...run, id: 'saved', status: 'SUCCEEDED', subagentLanes: [{ ...task, status: 'DONE', output: 'All orders accounted for' }] };
    render([saved]);
    expect(host.querySelector('[aria-label="Task record"]')?.textContent).toContain('All orders accounted for');
    clickSwitcherButton('Main assistant');
    expect(host.querySelector('textarea')?.value).toBe('Unsent note');
    act(() => root.unmount());
    root = createRoot(host);
    render([saved]);
    clickSwitcherButton('Review orders');
    expect(host.querySelector('[aria-label="Task record"]')?.textContent).toContain('All orders accounted for');
    expect(submit).not.toHaveBeenCalled();
  });
  it('never offers historical tasks or carries a selection into another conversation', () => {
    render([run]);
    clickSwitcherButton('Review orders');
    const next: AgentRunView = { ...run, id: 'new', subagentLanes: [] };
    render([run, next]);
    expect(host.querySelector('[aria-label="View delegated work"]')).toBeNull();
    expect(host.querySelector('textarea')).not.toBeNull();
    render([{ ...run, sourceSessionId: 'conversation-b' }], 'conversation-b');
    expect(host.querySelector('[aria-label="Task record"]')).toBeNull();
    expect(host.querySelector('textarea')).not.toBeNull();
  });
});
