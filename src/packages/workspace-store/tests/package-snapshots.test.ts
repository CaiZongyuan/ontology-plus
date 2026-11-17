import { describe, expect, it, vi } from 'vitest';
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

  it('rolls back the package, latest pointer, and generation log when a transactional write fails', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const original = store.saveAssembledApplication.bind(store);
    const originalApplication = store.listAssembledApplications().find((item) => item.id === 'app-contract-clm')!;
    vi.spyOn(store, 'saveAssembledApplication').mockImplementation((application) => {
      original(application);
      throw new Error('Simulated failure after saving the pointer and log');
    });
    expect(() => store.saveDevelopmentPackageSnapshot(packageSnapshot('failed-generation'))).toThrow(/Simulated failure/);
    expect(store.listDevelopmentPackageSnapshots('app-contract-clm')).toEqual([]);
    expect(store.listAssembledApplications().find((item) => item.id === 'app-contract-clm')).toEqual(originalApplication);
  });

  it('mirrors a committed snapshot and its application pointer together through D1 batch', () => {
    const batches: unknown[][] = [];
    const store = createWorkspaceStore({
      dbPath: ':memory:', enableFileMirror: false,
      d1Database: {
        async exec() {},
        prepare(query) {
          let parameters: unknown[] = [];
          return {
            query, get values() { return parameters; },
            bind(...values: unknown[]) { parameters = values; return this; },
            async run() {},
            async all() { return { results: [] }; },
            async first() { return null; },
          };
        },
        async batch(statements) { batches.push(statements); },
      },
    });
    store.saveDevelopmentPackageSnapshot(packageSnapshot('mirrored-generation'));
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    expect(batches[0]).toEqual([
      expect.objectContaining({ values: expect.arrayContaining(['development_package_snapshots', 'mirrored-generation']) }),
      expect.objectContaining({ values: expect.arrayContaining(['assembled_apps', 'app-contract-clm']) }),
    ]);
  });

  it('retains application-owned history when deleting a former source project after rebinding', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.saveDevelopmentPackageSnapshot(packageSnapshot('retained-source-project'));
    const application = store.listAssembledApplications().find((item) => item.id === 'app-contract-clm')!;
    store.saveAssembledApplication({ ...application, projectId: 'proj-mft' });
    store.deleteProject('proj-contract');
    expect(store.getDevelopmentPackageSnapshot('retained-source-project')).toEqual(packageSnapshot('retained-source-project'));
    expect(store.listAssembledApplications().some((item) => item.id === application.id)).toBe(true);
  });

  it('removes every snapshot of applications deleted with their current project, including history from other projects', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.saveDevelopmentPackageSnapshot(packageSnapshot('previous-project-history'));
    const application = store.listAssembledApplications().find((item) => item.id === 'app-contract-clm')!;
    store.saveAssembledApplication({ ...application, projectId: 'proj-mft' });
    store.saveDevelopmentPackageSnapshot({ ...packageSnapshot('current-project-history'), projectId: 'proj-mft' });
    store.deleteProject('proj-mft', true);
    expect(store.getDevelopmentPackageSnapshot('previous-project-history')).toBeUndefined();
    expect(store.getDevelopmentPackageSnapshot('current-project-history')).toBeUndefined();
  });
});
