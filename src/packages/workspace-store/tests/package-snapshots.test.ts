import { describe, expect, it } from 'vitest';
import { createWorkspaceStore, type DevelopmentPackageSnapshot } from '../index.js';

function packageSnapshot(snapshotId: string): DevelopmentPackageSnapshot {
  return {
    snapshotId,
    appId: 'app-contract-clm',
    appName: 'Contract implementation instructions',
    projectId: 'proj-contract',
    inputFingerprint: 'fixed-input-revision',
    outputDir: `packages/app-contract-clm/${snapshotId}`,
    compiledAt: '2026-11-17T01:00:00.000Z',
    files: [{ relativePath: 'AGENTS.md', category: 'GUIDE', sizeBytes: 5, content: 'Start' }],
    manifestJson: { snapshotId },
  };
}

describe('immutable development package storage', () => {
  it('retains immutable generation snapshots while selecting the latest package for an application', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const first = packageSnapshot('package-first');
    store.saveDevelopmentPackageSnapshot(first);
    first.files[0].content = 'Mutated after persistence';
    expect(store.getDevelopmentPackageSnapshot('package-first')?.files[0].content).toBe('Start');
    expect(store.listAssembledApplications().find((app) => app.id === first.appId)?.latestPackageSnapshotId)
      .toBe('package-first');

    const overwrite = packageSnapshot('package-first');
    overwrite.files[0].content = 'Attempted replacement';
    expect(() => store.saveDevelopmentPackageSnapshot(overwrite)).toThrow(/immutable|already exists/i);
    store.saveDevelopmentPackageSnapshot(packageSnapshot('package-second'));
    expect(store.listDevelopmentPackageSnapshots(first.appId)).toHaveLength(2);
    expect(store.getDevelopmentPackageSnapshot('package-first')?.files[0].content).toBe('Start');
    expect(store.listAssembledApplications().find((app) => app.id === first.appId)?.latestPackageSnapshotId)
      .toBe('package-second');
  });

  it('rejects a package for another application project and clears generated-package ownership when cloning', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    expect(() => store.saveDevelopmentPackageSnapshot({
      ...packageSnapshot('wrong-project'), projectId: 'proj-mft',
    })).toThrow(/project/i);
    store.saveDevelopmentPackageSnapshot(packageSnapshot('original-package'));
    const clone = store.cloneAssembledApplication('app-contract-clm');
    expect(clone.latestPackageSnapshotId).toBeUndefined();
    expect(store.listDevelopmentPackageSnapshots(clone.id)).toEqual([]);
  });
});
