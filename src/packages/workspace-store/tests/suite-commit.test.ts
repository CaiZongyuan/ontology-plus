import { describe, expect, it } from 'vitest';
import {
  SuiteValidationRejectedError,
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

  it('enforces rejectOnNewErrors on commitSuite without mutating storage or firing onSuiteCommit, while permitting edits that introduce zero new errors', () => {
    const commits: SuiteCommitEvent[] = [];
    const store = createWorkspaceStore({
      dbPath: ':memory:',
      enableFileMirror: false,
      onSuiteCommit: (event) => commits.push(event),
    });

    const baseline = store.getProject('proj-contract')!;

    // 1. Candidate introducing a new Consistency Error is rejected when rejectOnNewErrors: true
    const brokenSuite = JSON.parse(JSON.stringify(baseline.suite));
    brokenSuite.M1.aggregates.find((a: { id: string }) => a.id === 'AGG-02').alias = '合同';

    let thrown: unknown;
    try {
      store.commitSuite('proj-contract', brokenSuite, {
        source: { kind: 'MANUAL', modelCode: 'M1' },
        note: 'Attempt duplicate Business Object alias',
        rejectOnNewErrors: true,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(SuiteValidationRejectedError);
    const rejected = thrown as SuiteValidationRejectedError;
    expect(rejected.code).toBe('SUITE_VALIDATION_REJECTED');
    expect(rejected.newErrors.length).toBeGreaterThan(0);
    expect(rejected.newErrors.some((d) => d.code === 'M1_DUPLICATE_AGGREGATE_NAME')).toBe(true);

    // Stored project and commit hook remain completely untouched
    expect(commits).toHaveLength(0);
    expect(store.getProject('proj-contract')!.suite).toEqual(baseline.suite);
    expect(store.getProject('proj-contract')!.changelog).toBe(baseline.changelog);

    // 2. Expert write (rejectOnNewErrors omitted) still saves suites with Consistency Errors
    const withExistingError = JSON.parse(JSON.stringify(baseline.suite));
    withExistingError.M2.behaviors.push({
      ...withExistingError.M2.behaviors[0],
      id: 'BHV-EXPERT-WIP',
      name: 'wipAction',
      alias: '待补齐动作',
      ownerEntity: 'PendingObject',
    });
    const expertSaved = store.commitSuite('proj-contract', withExistingError, {
      source: { kind: 'MANUAL' },
      note: 'Expert WIP save',
    });
    expect(expertSaved.validation.errorCount).toBeGreaterThan(0);
    expect(commits).toHaveLength(1);

    // 3. Subsequent Business View edit (rejectOnNewErrors: true) that adds ZERO new errors succeeds
    const calmDescEdit = JSON.parse(JSON.stringify(expertSaved.suite));
    calmDescEdit.M1.aggregates[0].description = '更新后的企业商务合同说明';
    const businessSaved = store.commitSuite('proj-contract', calmDescEdit, {
      source: { kind: 'MANUAL', modelCode: 'M1' },
      note: 'Business View description edit',
      rejectOnNewErrors: true,
    });
    expect(businessSaved.suite.M1!.aggregates[0]!.description).toBe('更新后的企业商务合同说明');
    expect(commits).toHaveLength(2);
    expect(commits[1]).toMatchObject({
      projectId: 'proj-contract',
      source: { kind: 'MANUAL', modelCode: 'M1' },
      note: 'Business View description edit',
    });
  });
});
