import { describe, expect, it } from 'vitest';
import { CONTRACT_LIFECYCLE_SUITE } from '../packages/ontology-core/index.js';
import { createWorkspaceStore } from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';

describe('Home projects API (#61)', () => {
  it('returns every project with its 4-step states, currentStep, and currentStepState on GET /api/projects and GET /api/bootstrap', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);

    const listRes = await app.request('/api/projects');
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      projects: {
        id: string;
        name: string;
        currentStep?: string;
        currentStepState?: string;
        stepStates?: Record<string, string>;
      }[];
    };

    const contractProj = listBody.projects.find((p) => p.id === 'proj-contract');
    const mftProj = listBody.projects.find((p) => p.id === 'proj-mft');
    expect(contractProj).toBeDefined();
    expect(mftProj).toBeDefined();

    // Seeded proj-contract has confirmed requirements doc, confirmed prototype, clean 11-model suite, and uncompiled app
    expect(contractProj?.stepStates).toEqual({
      REQUIREMENTS: 'CONFIRMED',
      PROTOTYPE: 'CONFIRMED',
      BUSINESS_MODEL: 'CONFIRMED',
      DELIVERY: 'IN_PROGRESS',
    });
    expect(contractProj?.currentStep).toBe('DELIVERY');
    expect(contractProj?.currentStepState).toBe('IN_PROGRESS');

    // Seeded proj-mft is a legacy capability extraction project with 5 models
    expect(mftProj?.stepStates).toEqual({
      REQUIREMENTS: 'NOT_STARTED',
      PROTOTYPE: 'NOT_STARTED',
      BUSINESS_MODEL: 'IN_PROGRESS',
      DELIVERY: 'NOT_STARTED',
    });
    expect(mftProj?.currentStep).toBe('BUSINESS_MODEL');
    expect(mftProj?.currentStepState).toBe('IN_PROGRESS');

    // Bootstrap includes the exact same step status summary on every project without N+1 fetches
    const bootRes = await app.request('/api/bootstrap');
    expect(bootRes.status).toBe(200);
    const bootBody = (await bootRes.json()) as typeof listBody;
    expect(bootBody.projects).toEqual(listBody.projects);

    // Walk a fresh project through step transitions and verify server step derivation tracks each milestone
    const fresh = store.createProject({
      name: '售后工单系统',
      code: 'AFTER-SALES',
      domain: '售后服务',
      template: 'EMPTY',
    });

    const getSummary = async () => {
      const res = await app.request('/api/projects');
      const json = (await res.json()) as typeof listBody;
      return json.projects.find((p) => p.id === fresh.id)!;
    };

    // 1. Brand-new empty project -> REQUIREMENTS / NOT_STARTED
    expect(await getSummary()).toMatchObject({
      currentStep: 'REQUIREMENTS',
      currentStepState: 'NOT_STARTED',
      stepStates: {
        REQUIREMENTS: 'NOT_STARTED',
        PROTOTYPE: 'NOT_STARTED',
        BUSINESS_MODEL: 'NOT_STARTED',
        DELIVERY: 'NOT_STARTED',
      },
    });

    // 2. Active REQUIREMENT conversation -> REQUIREMENTS / IN_PROGRESS
    store.createAgentSession({
      projectId: fresh.id,
      agentKind: 'REQUIREMENT',
      title: '售后工单需求',
      initialMessages: [
        {
          id: 'msg-1',
          role: 'user',
          content: '客户在小程序报修，客服派单给工程师上门维修并回访。',
          timestamp: '2026-11-17T09:00:00.000Z',
        },
      ],
    });
    expect(await getSummary()).toMatchObject({
      currentStep: 'REQUIREMENTS',
      currentStepState: 'IN_PROGRESS',
    });

    // 3. Draft requirement doc stays IN_PROGRESS; explicit step confirmation (#64) advances currentStep to PROTOTYPE / NOT_STARTED
    store.saveRequirementDoc({
      id: 'rdoc-after-sales',
      projectId: fresh.id,
      title: '售后工单需求规格书',
      version: 'v1.0',
      status: 'DRAFT',
      content: '# 售后工单需求',
    });
    expect(await getSummary()).toMatchObject({
      currentStep: 'REQUIREMENTS',
      currentStepState: 'IN_PROGRESS',
    });
    store.confirmRequirementsStep(fresh.id, { docId: 'rdoc-after-sales' });
    expect(await getSummary()).toMatchObject({
      currentStep: 'PROTOTYPE',
      currentStepState: 'NOT_STARTED',
      stepStates: {
        REQUIREMENTS: 'CONFIRMED',
        PROTOTYPE: 'NOT_STARTED',
        BUSINESS_MODEL: 'NOT_STARTED',
        DELIVERY: 'NOT_STARTED',
      },
    });

    // 4. Draft prototype -> PROTOTYPE / IN_PROGRESS; confirmed -> BUSINESS_MODEL / IN_PROGRESS; new unconfirmed rev -> PROTOTYPE / UNCONFIRMED_CHANGES
    const { prototype, revision } = store.createPrototype(fresh.id, {
      name: '售后工单原型',
      htmlContent: '<section data-screen-id="SCR-01">工单列表</section>',
    });
    expect(await getSummary()).toMatchObject({
      currentStep: 'PROTOTYPE',
      currentStepState: 'IN_PROGRESS',
    });

    // Confirming a prototype with semantic screen anchors syncs MU, moving BUSINESS_MODEL into IN_PROGRESS
    store.confirmPrototypeRevision(fresh.id, revision.id);
    expect(await getSummary()).toMatchObject({
      currentStep: 'BUSINESS_MODEL',
      currentStepState: 'IN_PROGRESS',
    });

    const { revision: rev2 } = store.appendPrototypeRevision(prototype.id, {
      htmlContent: '<section data-screen-id="SCR-01">工单列表 v2</section>',
    });
    expect(await getSummary()).toMatchObject({
      currentStep: 'PROTOTYPE',
      currentStepState: 'UNCONFIRMED_CHANGES',
    });

    // Re-confirm prototype + commit clean 11-model suite + confirm Business Model -> DELIVERY / IN_PROGRESS
    store.confirmPrototypeRevision(fresh.id, rev2.id);
    store.updateSuite(fresh.id, structuredClone(CONTRACT_LIFECYCLE_SUITE), 'Load 11 models');
    store.confirmBusinessModelStep(fresh.id);
    expect(await getSummary()).toMatchObject({
      currentStep: 'DELIVERY',
      currentStepState: 'IN_PROGRESS',
      stepStates: {
        REQUIREMENTS: 'CONFIRMED',
        PROTOTYPE: 'CONFIRMED',
        BUSINESS_MODEL: 'CONFIRMED',
        DELIVERY: 'IN_PROGRESS',
      },
    });

    store.close();
  });

  it('supports an empty workspace (first-use state) cleanly on GET /api/projects and GET /api/bootstrap', async () => {
    const store = createWorkspaceStore({
      dbPath: ':memory:',
      enableFileMirror: false,
      seedProjects: false,
    });
    const app = createApiApp(store);

    const listRes = await app.request('/api/projects');
    expect(listRes.status).toBe(200);
    expect(await listRes.json()).toEqual({ projects: [] });

    const bootRes = await app.request('/api/bootstrap');
    expect(bootRes.status).toBe(200);
    const bootBody = (await bootRes.json()) as {
      projects: unknown[];
      activeProject: { id: string; validation: { errorCount: number } };
    };
    expect(bootBody.projects).toEqual([]);
    expect(bootBody.activeProject.validation.errorCount).toBe(0);

    store.close();
  });

  it('creates a clean EMPTY project from a single-sentence description (201) with readable name, collision-safe code, and persisted description', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);

    const zhSentence =
      '做一个合同管理系统：业务部门起草合同，法务审核，按金额分级审批，签署后归档，到期前提醒续签。';
    const zhRes = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: `  ${zhSentence}  ` }),
    });
    expect(zhRes.status).toBe(201);
    const zhBody = (await zhRes.json()) as {
      project: {
        id: string;
        name: string;
        code: string;
        domain: string;
        description: string;
        currentStage: number;
        currentStep?: string;
        currentStepState?: string;
        validation: { presentModels: string[] };
      };
      projects: { id: string; code: string }[];
    };

    expect(zhBody.project.name).toBe('合同管理系统');
    expect(zhBody.project.domain).toBe('合同管理系统');
    expect(zhBody.project.description).toBe(zhSentence);
    expect(zhBody.project.code).toMatch(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/);
    expect(zhBody.project.currentStage).toBe(0);
    expect(zhBody.project.validation.presentModels).toEqual([]);
    expect(zhBody.project.currentStep).toBe('REQUIREMENTS');
    expect(zhBody.project.currentStepState).toBe('NOT_STARTED');

    // Submitting the exact same sentence again generates a distinct collision-safe code
    const zhDupRes = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: zhSentence }),
    });
    expect(zhDupRes.status).toBe(201);
    const zhDupBody = (await zhDupRes.json()) as typeof zhBody;
    expect(zhDupBody.project.code).not.toBe(zhBody.project.code);

    // English single-sentence description
    const enSentence =
      'Build a supplier onboarding portal: vendors submit qualifications online, procurement and QA review annually.';
    const enRes = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: enSentence }),
    });
    expect(enRes.status).toBe(201);
    const enBody = (await enRes.json()) as typeof zhBody;
    expect(enBody.project.name).toBe('Supplier onboarding portal');
    expect(enBody.project.description).toBe(enSentence);
    expect(enBody.project.validation.presentModels).toEqual([]);

    // Blank description without name is rejected with 400
    const badRes = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: '   ' }),
    });
    expect(badRes.status).toBe(400);

    // Legacy structured POST /api/projects { name, code, domain, template } still works unchanged (200)
    const legacyRes = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '手工结构化工程',
        code: 'LEGACY-STRUCT',
        domain: '采购协同',
        template: 'CONTRACT',
      }),
    });
    expect(legacyRes.status).toBe(200);
    const legacyBody = (await legacyRes.json()) as typeof zhBody;
    expect(legacyBody.project.name).toBe('手工结构化工程');
    expect(legacyBody.project.code).toBe('LEGACY-STRUCT');
    expect(legacyBody.project.domain).toBe('采购协同');
    expect(legacyBody.project.validation.presentModels).toHaveLength(11);

    store.close();
  });
});
