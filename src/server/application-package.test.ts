import { describe, expect, it } from 'vitest';
import { CONTRACT_LIFECYCLE_SUITE, CONTRACT_PROTOTYPE_HTML } from '../packages/ontology-core/index.js';
import {
  createWorkspaceStore,
  DEFAULT_TECHNOLOGY_PROFILE_ID,
  type DevelopmentPackageSnapshot,
} from '../packages/workspace-store/index.js';
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

  it('rejects compilation when Business Model is unconfirmed, compiles strictly from confirmed snapshots without draft leakage, auto-provisions default application, and drives all 4 Delivery states (#73)', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const api = createApiApp(store);

    const project = store.createProject({
      name: '供应商准入评审系统',
      code: 'SUPPLIER-DELIV',
      domain: '供应商管理',
      template: 'EMPTY',
    });
    store.saveRequirementDoc({
      id: 'rdoc-sup-deliv',
      projectId: project.id,
      title: '供应商准入需求规格书',
      version: 'v1.0',
      status: 'DRAFT',
      content: '# 供应商准入需求\n\n## 1. 业务范围\n- 供应商资质提交与准入审批。',
    });
    store.confirmRequirementsStep(project.id, { docId: 'rdoc-sup-deliv' });
    const { revision } = store.createPrototype(project.id, {
      name: '供应商准入原型',
      htmlContent: CONTRACT_PROTOTYPE_HTML,
    });
    store.confirmPrototypeRevision(project.id, revision.id);
    store.updateSuite(project.id, structuredClone(CONTRACT_LIFECYCLE_SUITE), 'Initial suite');

    const getDeliveryState = async () => {
      const stepRes = await api.request(`/api/projects/${project.id}/step-confirmations`);
      const stepJson = (await stepRes.json()) as {
        steps: { id: string; state: string }[];
      };
      const projectsRes = await api.request('/api/projects');
      const projectsJson = (await projectsRes.json()) as {
        projects: { id: string; stepStates: Record<string, string> }[];
      };
      const storeDelivery = projectsJson.projects.find((p) => p.id === project.id)!.stepStates.DELIVERY;
      const derivedDelivery = stepJson.steps.find((s) => s.id === 'DELIVERY')!.state;
      expect(storeDelivery).toBe(derivedDelivery);
      return derivedDelivery;
    };

    // State 1: NOT_STARTED — Business Model has draft models, but has NOT been confirmed yet
    expect(await getDeliveryState()).toBe('NOT_STARTED');

    // Both project-level and explicit application compile endpoints reject unconfirmed Business Model
    const rejectedProjectCompile = await api.request(
      `/api/projects/${project.id}/compile-package`,
      { method: 'POST', headers: { 'x-onto-locale': 'zh-CN' } },
    );
    expect(rejectedProjectCompile.status).toBe(409);
    const rejectedBody = (await rejectedProjectCompile.json()) as { error: string; code: string };
    expect(rejectedBody.code).toBe('BUSINESS_MODEL_UNCONFIRMED');
    expect(rejectedBody.error).toContain('业务模型');
    // Rejecting early must not leave behind a half-created application
    expect(store.listAssembledApplications().filter((a) => a.projectId === project.id)).toHaveLength(0);

    // Even if an explicit application record already exists, POST /api/applications/:appId/compile-package rejects when Business Model is unconfirmed
    const profile = store.listTechnologyProfiles()[0]!;
    const manualApp = store.saveAssembledApplication({
      id: 'app-sup-deliv',
      name: '供应商准入系统',
      projectId: project.id,
      technologyProfileId: profile.id,
      ...profile.defaultAssetIds,
      prototypeRevisionId: revision.id,
      developmentInstructions: '',
      status: 'ASSEMBLED',
      agentDevLogs: [],
    });
    const rejectedAppCompile = await api.request(
      `/api/applications/${manualApp.id}/compile-package`,
      { method: 'POST', headers: { 'x-onto-locale': 'en-US' } },
    );
    expect(rejectedAppCompile.status).toBe(409);
    expect(await rejectedAppCompile.json()).toMatchObject({
      code: 'BUSINESS_MODEL_UNCONFIRMED',
    });
    store.deleteAssembledApplication(manualApp.id);

    // Confirm Business Model v1 -> State 2: IN_PROGRESS
    const modelConfirm1 = store.confirmBusinessModelStep(project.id);
    expect(await getDeliveryState()).toBe('IN_PROGRESS');

    // Mutate BOTH live requirement draft AND live project.suite AFTER confirmation (unconfirmed drafts!)
    store.saveRequirementDoc({
      id: 'rdoc-sup-deliv',
      projectId: project.id,
      title: '供应商准入需求规格书',
      version: 'v1.1-draft',
      status: 'DRAFT',
      content: '# 供应商准入需求\n\n- UNCONFIRMED_REQ_DRAFT_MARKER_73',
    });
    const draftSuite = structuredClone(CONTRACT_LIFECYCLE_SUITE);
    draftSuite.M1!.aggregates[0]!.description = 'UNCONFIRMED_MODEL_DRAFT_MARKER_73';
    store.updateSuite(project.id, draftSuite, 'Unconfirmed draft edit');

    // Compile via project-level endpoint -> auto-provisions default application with platform defaults!
    const compile1Res = await api.request(`/api/projects/${project.id}/compile-package`, {
      method: 'POST',
    });
    expect(compile1Res.status).toBe(200);
    const compile1Json = (await compile1Res.json()) as {
      application: { id: string; technologyProfileId?: string };
      compiledPackage: DevelopmentPackageSnapshot;
      stale: boolean;
    };
    expect(compile1Json.application.technologyProfileId).toBe(DEFAULT_TECHNOLOGY_PROFILE_ID);
    expect(compile1Json.compiledPackage.basedOnBusinessModelConfirmationId).toBe(
      modelConfirm1.confirmation.id,
    );
    expect(compile1Json.compiledPackage.manifestJson.basedOnBusinessModelConfirmationId).toBe(
      modelConfirm1.confirmation.id,
    );

    const m1Yaml = compile1Json.compiledPackage.files.find(
      (f) => f.relativePath === 'references/ontology/M1.yaml',
    )!.content;
    const reqMd = compile1Json.compiledPackage.files.find(
      (f) => f.relativePath === 'references/requirements.md',
    )!.content;
    expect(m1Yaml).not.toContain('UNCONFIRMED_MODEL_DRAFT_MARKER_73');
    expect(reqMd).not.toContain('UNCONFIRMED_REQ_DRAFT_MARKER_73');
    expect(reqMd).toContain('供应商资质提交与准入审批');

    // Unconfirmed draft mutations must NOT mark the saved package stale, and Delivery is State 3: CONFIRMED!
    const pkgCheck = await api.request(
      `/api/applications/${compile1Json.application.id}/package`,
    );
    expect(await pkgCheck.json()).toMatchObject({ stale: false });
    expect(await getDeliveryState()).toBe('CONFIRMED');

    // Confirming the new Business Model draft -> State 4: OUTDATED!
    const modelConfirm2 = store.confirmBusinessModelStep(project.id);
    expect(modelConfirm2.confirmation.id).not.toBe(modelConfirm1.confirmation.id);
    expect(await getDeliveryState()).toBe('OUTDATED');
    const pkgCheckAfterReconfirm = await api.request(
      `/api/applications/${compile1Json.application.id}/package`,
    );
    expect(await pkgCheckAfterReconfirm.json()).toMatchObject({ stale: true });

    // Regenerating updates snapshot to modelConfirm2 (including the newly confirmed draft!) -> back to CONFIRMED!
    const compile2Res = await api.request(`/api/projects/${project.id}/compile-package`, {
      method: 'POST',
    });
    expect(compile2Res.status).toBe(200);
    const compile2Json = (await compile2Res.json()) as {
      compiledPackage: DevelopmentPackageSnapshot;
    };
    expect(compile2Json.compiledPackage.basedOnBusinessModelConfirmationId).toBe(
      modelConfirm2.confirmation.id,
    );
    const m1Yaml2 = compile2Json.compiledPackage.files.find(
      (f) => f.relativePath === 'references/ontology/M1.yaml',
    )!.content;
    expect(m1Yaml2).toContain('UNCONFIRMED_MODEL_DRAFT_MARKER_73');
    expect(await getDeliveryState()).toBe('CONFIRMED');

    // Changing application-specific implementation instructions also marks Delivery OUTDATED until regenerated!
    const savedApp = store
      .listAssembledApplications()
      .find((a) => a.id === compile1Json.application.id)!;
    store.saveAssembledApplication({
      ...savedApp,
      developmentInstructions: 'Enforce dual audit log retention.',
    });
    expect(await getDeliveryState()).toBe('OUTDATED');
  });
});

