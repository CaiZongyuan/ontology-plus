import { describe, expect, it } from 'vitest';
import { createWorkspaceStore, type DevelopmentPackageSnapshot } from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';

describe('application package snapshot API', () => {
  it('requires explicit generation before package preview or download', async () => {
    const api = createApiApp(createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false }));
    const preview = await api.request('/api/applications/app-contract-clm/package');
    expect(preview.status).toBe(409);
    expect(await preview.json()).toMatchObject({ code: 'PACKAGE_NOT_GENERATED' });
    const download = await api.request('/api/applications/app-contract-clm/package.zip');
    expect(download.status).toBe(409);
  });

  it('downloads exactly the reviewed snapshot after saved inputs change, until explicit regeneration', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const api = createApiApp(store);
    const generate = () => api.request('/api/applications/app-contract-clm/compile-package', { method: 'POST' });
    const response = await generate();
    expect(response.status).toBe(200);
    const first = (await response.json() as { compiledPackage: DevelopmentPackageSnapshot }).compiledPackage;
    expect(first.snapshotId).toBeTruthy();
    expect(first.files.some((file) => file.relativePath === 'AGENTS.md')).toBe(true);
    const initialZip = await api.request('/api/applications/app-contract-clm/package.zip');
    const initialBytes = new Uint8Array(await initialZip.arrayBuffer());

    const application = store.listAssembledApplications().find((item) => item.id === first.appId)!;
    store.saveAssembledApplication({ ...application, developmentInstructions: 'Implement the revised retention requirement.' });
    const preview = await api.request('/api/applications/app-contract-clm/package');
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ stale: true, compiledPackage: first });
    const unchangedZip = await api.request('/api/applications/app-contract-clm/package.zip');
    expect(new Uint8Array(await unchangedZip.arrayBuffer())).toEqual(initialBytes);

    const secondResponse = await generate();
    expect(secondResponse.status).toBe(200);
    const second = (await secondResponse.json() as { compiledPackage: DevelopmentPackageSnapshot }).compiledPackage;
    expect(second.snapshotId).not.toBe(first.snapshotId);
    expect(second.inputFingerprint).not.toBe(first.inputFingerprint);
    const current = await api.request('/api/applications/app-contract-clm/package');
    expect(await current.json()).toMatchObject({ stale: false, compiledPackage: second });
    const retained = await api.request(`/api/applications/app-contract-clm/package?snapshotId=${first.snapshotId}`);
    expect(await retained.json()).toMatchObject({ compiledPackage: first });
  });

  it('rejects unresolved assets and unconfirmed prototype choices without substituting another source', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const api = createApiApp(store);
    const application = store.listAssembledApplications().find((item) => item.id === 'app-contract-clm')!;
    store.saveAssembledApplication({ ...application, uiUeAssetId: 'missing-ui-standard' });
    const missing = await api.request('/api/applications/app-contract-clm/compile-package', { method: 'POST' });
    expect(missing.status).toBe(422);
    expect(await missing.json()).toMatchObject({ code: 'INVALID_ASSEMBLY_INPUT' });

    const confirmation = store.getConfirmedPrototypeRevision(application.projectId)!;
    const { revision } = store.appendPrototypeRevision(confirmation.prototypeId, {
      htmlContent: `${confirmation.htmlContent}\n<!-- unconfirmed trial -->`,
    });
    store.saveAssembledApplication({ ...application, prototypeRevisionId: revision.id });
    const unconfirmed = await api.request('/api/applications/app-contract-clm/compile-package', { method: 'POST' });
    expect(unconfirmed.status).toBe(422);
    expect(await unconfirmed.json()).toMatchObject({ code: 'INVALID_ASSEMBLY_INPUT' });
  });

  it('requires regeneration after changing projects while preserving explicit application-owned history', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const api = createApiApp(store);
    const generated = await api.request('/api/applications/app-contract-clm/compile-package', { method: 'POST' });
    const { compiledPackage } = await generated.json() as { compiledPackage: DevelopmentPackageSnapshot };
    const application = store.listAssembledApplications().find((item) => item.id === compiledPackage.appId)!;
    store.saveAssembledApplication({ ...application, projectId: 'proj-mft' });
    const current = await api.request('/api/applications/app-contract-clm/package');
    expect(current.status).toBe(409);
    const retained = await api.request(`/api/applications/app-contract-clm/package?snapshotId=${compiledPackage.snapshotId}`);
    expect(retained.status).toBe(200);
    expect(await retained.json()).toMatchObject({ stale: true, compiledPackage });

    const other = store.cloneAssembledApplication(application.id);
    const unrelated = await api.request(`/api/applications/${other.id}/package?snapshotId=${compiledPackage.snapshotId}`);
    expect(unrelated.status).toBe(404);
  });
});
