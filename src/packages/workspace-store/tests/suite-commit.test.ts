import { describe, expect, it } from 'vitest';
import {
  createWorkspaceStore,
  type SuiteCommitEvent,
} from '../index.js';

describe('workspace-store unified suite write entrypoint (commitSuite)', () => {
  it('commits a suite with explicit source attribution and notifies onSuiteCommit with before/after snapshots', () => {
    const commits: SuiteCommitEvent[] = [];
    const store = createWorkspaceStore({
      dbPath: ':memory:',
      enableFileMirror: false,
      onSuiteCommit: (event) => commits.push(event),
    });

    const before = store.getProject('proj-mft')!;
    expect(commits).toHaveLength(0);

    const updated = store.commitSuite(
      'proj-mft',
      {},
      {
        source: { kind: 'AGENT_RUN', runId: 'amsg-run-01', sessionId: 'sess-01', toolName: 'delete_element' },
        note: 'Cleared demo suite in agent run',
      },
    );

    expect(updated.validation.presentModels).toEqual([]);
    expect(updated.changelog).toContain('Cleared demo suite in agent run');
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      projectId: 'proj-mft',
      previousSuite: before.suite,
      nextSuite: {},
      source: {
        kind: 'AGENT_RUN',
        runId: 'amsg-run-01',
        sessionId: 'sess-01',
        toolName: 'delete_element',
      },
      note: 'Cleared demo suite in agent run',
    });
    expect(commits[0]!.committedAt).toBeTruthy();
  });

  it('routes renameSymbol through commitSuite while preserving cascade rename return shape and changelog entry', () => {
    const commits: SuiteCommitEvent[] = [];
    const store = createWorkspaceStore({
      dbPath: ':memory:',
      enableFileMirror: false,
      onSuiteCommit: (event) => commits.push(event),
    });

    const before = store.getProject('proj-contract')!;
    const result = store.renameSymbol('proj-contract', 'SettlementOrder', 'PaymentSettlement');

    expect(result.changedCount).toBeGreaterThan(3);
    expect(result.changelogEntry).toContain('Cascade Rename `SettlementOrder` -> `PaymentSettlement`');
    expect(result.project.changelog).toContain(result.changelogEntry);
    expect(result.project.validation.valid).toBe(true);

    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      projectId: 'proj-contract',
      source: {
        kind: 'SYMBOL_RENAME',
        oldId: 'SettlementOrder',
        newId: 'PaymentSettlement',
      },
    });
    expect(commits[0]!.previousSuite.M1?.aggregates.some((a) => a.name === 'SettlementOrder')).toBe(true);
    expect(commits[0]!.nextSuite.M1?.aggregates.some((a) => a.name === 'PaymentSettlement')).toBe(true);
    expect(commits[0]!.previousSuite).toEqual(before.suite);
  });
});
