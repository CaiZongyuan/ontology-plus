import { describe, expect, it } from 'vitest';
import { checkBusinessViewMarkup } from '../../packages/business-vocabulary/index.js';
import type { OntologySuite } from '../../packages/ontology-core/index.js';
import {
  computeOntologySuiteHash,
  computeStepContentHash,
  type AssembledApplication,
  type DevelopmentPackageSnapshot,
  type GeneratedSkill,
  type ProjectStepConfirmations,
} from '../../packages/workspace-store/index.js';
import {
  deriveProjectHealthSummary,
  deriveProjectStepProgress,
  deriveProjectSteps,
  formatProjectHealthStatus,
  getProjectLifecycleState,
  type ProjectStepProgressInput,
} from './index.js';

function makeConfirmedRevision(prototypeId = 'proto-1', revisionId = 'rev-1') {
  return {
    id: 'sconf-proto-1',
    prototypeId,
    revisionId,
    basedOnConfirmationId: 'sconf-req-1',
  };
}

function makeEmptyConfirmations(): ProjectStepConfirmations {
  return {
    requirements: null,
    prototype: null,
    businessModel: null,
  };
}

function makeBaseInput(overrides: Partial<ProjectStepProgressInput> = {}): ProjectStepProgressInput {
  return {
    project: {
      id: 'proj-custom',
      domain: '仓储履约管理系统',
      suite: {},
      validation: {
        presentModels: [],
      },
    },
    agentSessions: [],
    requirementSessions: [],
    requirementDocs: [],
    prototypes: [],
    confirmedPrototypeRevision: null,
    stepConfirmations: makeEmptyConfirmations(),
    assembledApplications: [],
    packageSnapshots: [],
    generatedSkills: [],
    ...overrides,
  };
}

describe('deriveProjectStepProgress and getProjectLifecycleState', () => {
  it('derives Step 1 when no requirement exploration exists and ignores empty or foreign-project agent sessions', () => {
    const state = deriveProjectStepProgress(
      makeBaseInput({
        agentSessions: [
          { projectId: 'proj-custom', agentKind: 'REQUIREMENT', messages: [] },
          {
            projectId: 'proj-other',
            agentKind: 'REQUIREMENT',
            messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: '2026-11-17T00:00:00Z' }],
          },
          {
            projectId: 'proj-custom',
            agentKind: 'COPILOT',
            messages: [{ id: 'm2', role: 'user', content: 'hi', timestamp: '2026-11-17T00:00:00Z' }],
          },
        ],
      }),
    );

    expect(state.hasExploration).toBe(false);
    expect(state.explorationCount).toBe(0);
    expect(state.nextStep).toMatchObject({
      step: 1,
      targetView: 'app-requirements',
    });
  });

  it('derives Step 2 once exploration exists (via agent session or legacy requirement session) but SRS doc is absent', () => {
    const viaAgent = deriveProjectStepProgress(
      makeBaseInput({
        agentSessions: [
          {
            projectId: 'proj-custom',
            agentKind: 'REQUIREMENT',
            messages: [{ id: 'm1', role: 'user', content: '盘点出入库规则', timestamp: '2026-11-17T00:00:00Z' }],
          },
          {
            projectId: 'proj-custom',
            agentKind: 'REQUIREMENT',
            messages: [{ id: 'm2', role: 'user', content: '补充波次分配', timestamp: '2026-11-17T00:00:00Z' }],
          },
        ],
        requirementSessions: [{ id: 'legacy-req-1' }],
      }),
    );

    expect(viaAgent.hasExploration).toBe(true);
    expect(viaAgent.explorationCount).toBe(2);
    expect(viaAgent.hasSrsDoc).toBe(false);
    expect(viaAgent.nextStep).toMatchObject({
      step: 2,
      targetView: 'app-requirements',
    });
  });

  it('distinguishes Step 3 generate-prototype vs confirm-prototype based on confirmed requirements, draft prototypes, and confirmed revision', () => {
    const reqContent = '# 仓储需求\n\n## 1. 目标\n波次拣货。';
    const stepConfirmations: ProjectStepConfirmations = {
      requirements: {
        id: 'sconf-req-1',
        projectId: 'proj-custom',
        step: 'REQUIREMENTS',
        docId: 'doc-1',
        title: '仓储需求',
        version: 'v1.0',
        content: reqContent,
        contentHash: computeStepContentHash(reqContent),
        basedOnConfirmationId: null,
        confirmedAt: '2026-11-17T01:00:00Z',
      },
      prototype: null,
      businessModel: null,
    };

    const step3Generate = deriveProjectStepProgress(
      makeBaseInput({
        requirementSessions: [{ id: 'req-1' }],
        requirementDocs: [{ id: 'doc-1', status: 'CONFIRMED', content: reqContent }],
        stepConfirmations,
        prototypes: [],
        confirmedPrototypeRevision: null,
      }),
    );
    expect(step3Generate.hasSrsDoc).toBe(true);
    expect(step3Generate.hasPrototype).toBe(false);
    expect(step3Generate.hasConfirmedPrototype).toBe(false);
    expect(step3Generate.nextStep).toMatchObject({
      step: 3,
      targetView: 'app-prototype',
    });

    const step3Confirm = deriveProjectStepProgress(
      makeBaseInput({
        requirementSessions: [{ id: 'req-1' }],
        requirementDocs: [{ id: 'doc-1', status: 'CONFIRMED', content: reqContent }],
        stepConfirmations,
        prototypes: [{ id: 'proto-1' }, { id: 'proto-2' }],
        confirmedPrototypeRevision: null,
      }),
    );
    expect(step3Confirm.hasPrototype).toBe(true);
    expect(step3Confirm.prototypeCount).toBe(2);
    expect(step3Confirm.hasConfirmedPrototype).toBe(false);
    expect(step3Confirm.nextStep).toMatchObject({
      step: 3,
      targetView: 'app-prototype',
    });
  });

  it('derives Step 4 when prototype is confirmed without ontology, and Step 5 once ontology models are present', () => {
    const confirmed = makeConfirmedRevision();
    const step4 = deriveProjectStepProgress(
      makeBaseInput({
        requirementSessions: [{ id: 'req-1' }],
        requirementDocs: [{ id: 'doc-1' }],
        prototypes: [{ id: 'proto-1' }],
        confirmedPrototypeRevision: confirmed,
      }),
    );
    expect(step4.hasConfirmedPrototype).toBe(true);
    expect(step4.hasOntology).toBe(false);
    expect(step4.nextStep).toMatchObject({
      step: 4,
      targetView: 'app-prototype',
    });

    const appForActive = { id: 'app-1', projectId: 'proj-custom', name: 'WMS App' } as AssembledApplication;
    const skillForActive = { id: 'sk-1', projectId: 'proj-custom', slug: 'wms-skill' } as GeneratedSkill;

    const step5 = deriveProjectStepProgress(
      makeBaseInput({
        project: {
          id: 'proj-custom',
          domain: '仓储履约管理系统',
          suite: {},
          validation: {
            presentModels: ['M1', 'M2', 'M3', 'MU'],
          },
        },
        requirementSessions: [{ id: 'req-1' }],
        requirementDocs: [{ id: 'doc-1' }],
        prototypes: [{ id: 'proto-1' }],
        confirmedPrototypeRevision: confirmed,
        assembledApplications: [appForActive],
        generatedSkills: [skillForActive],
      }),
    );
    expect(step5.hasOntology).toBe(true);
    expect(step5.presentModelCount).toBe(4);
    expect(step5.nextStep).toMatchObject({
      step: 5,
      targetView: 'app-assembly-dev',
    });
  });

  it('detects foreign CLM and MFT demo templates only when project id and domain do not match', () => {
    const clmSuite = {
      M1: { domain: '合同全生命周期管理系统', aggregates: [], dictionaries: [] },
    } as unknown as OntologySuite;
    const mftSuite = {
      M1: { domain: '企业文件安全传输系统 (MFT)', aggregates: [], dictionaries: [] },
    } as unknown as OntologySuite;

    const foreignClm = deriveProjectStepProgress(
      makeBaseInput({
        project: {
          id: 'proj-custom',
          domain: '采购协同管理',
          suite: clmSuite,
          validation: { presentModels: ['M1'] },
        },
      }),
    );
    expect(foreignClm.hasForeignDemoTemplate).toBe(true);

    const nativeClm = deriveProjectStepProgress(
      makeBaseInput({
        project: {
          id: 'proj-contract',
          domain: '合同全生命周期管理系统',
          suite: clmSuite,
          validation: { presentModels: ['M1'] },
        },
      }),
    );
    expect(nativeClm.hasForeignDemoTemplate).toBe(false);

    const foreignMft = getProjectLifecycleState({
      activeProject: {
        id: 'proj-custom-2',
        domain: '金融清算平台',
        suite: mftSuite,
        validation: { presentModels: ['M1'] },
      } as never,
      requirementDocs: [],
      prototypes: [],
    });
    expect(foreignMft.hasForeignDemoTemplate).toBe(true);
  });

  it('derives all 5 step states purely from project data + stepConfirmations and enforces cascading OUTDATED (#64)', () => {
    // 1. Brand-new empty project: Step 1 NOT_STARTED, Steps 2–4 blocked pointing to immediate upstream
    const emptySteps = deriveProjectSteps(makeBaseInput());
    expect(emptySteps.map((s) => s.id)).toEqual([
      'REQUIREMENTS',
      'PROTOTYPE',
      'BUSINESS_MODEL',
      'DELIVERY',
    ]);
    expect(emptySteps[0]).toMatchObject({
      id: 'REQUIREMENTS',
      state: 'NOT_STARTED',
      hasContent: false,
    });
    expect(emptySteps[0]!.blocked).toBeUndefined();
    expect(emptySteps[1]!.blocked?.upstreamStep).toBe('REQUIREMENTS');
    expect(emptySteps[2]!.blocked?.upstreamStep).toBe('PROTOTYPE');
    expect(emptySteps[3]!.blocked?.upstreamStep).toBe('BUSINESS_MODEL');

    for (const step of emptySteps) {
      expect(checkBusinessViewMarkup(step.name.zh, { plainText: true })).toEqual([]);
      expect(checkBusinessViewMarkup(step.name.en, { plainText: true })).toEqual([]);
      expect(checkBusinessViewMarkup(step.stateLabel.zh, { plainText: true })).toEqual([]);
      expect(checkBusinessViewMarkup(step.stateLabel.en, { plainText: true })).toEqual([]);
      expect(checkBusinessViewMarkup(step.statusSummary.zh, { plainText: true })).toEqual([]);
      expect(checkBusinessViewMarkup(step.statusSummary.en, { plainText: true })).toEqual([]);
      if (step.blocked) {
        expect(checkBusinessViewMarkup(step.blocked.reason.zh, { plainText: true })).toEqual([]);
        expect(checkBusinessViewMarkup(step.blocked.reason.en, { plainText: true })).toEqual([]);
        expect(checkBusinessViewMarkup(step.blocked.detail.zh, { plainText: true })).toEqual([]);
        expect(checkBusinessViewMarkup(step.blocked.detail.en, { plainText: true })).toEqual([]);
        expect(checkBusinessViewMarkup(step.blocked.actionLabel.zh, { plainText: true })).toEqual(
          [],
        );
        expect(checkBusinessViewMarkup(step.blocked.actionLabel.en, { plainText: true })).toEqual(
          [],
        );
      }
    }

    // 2. Saved requirement doc WITHOUT step confirmation -> IN_PROGRESS, Prototype STILL blocked!
    const v1Content = '# 仓储系统需求\n\n## 1. 业务目标\n- 入库验收与波次出库';
    const unconfirmedDocSteps = deriveProjectSteps(
      makeBaseInput({
        requirementDocs: [{ id: 'doc-1', status: 'DRAFT', content: v1Content }],
      }),
    );
    expect(unconfirmedDocSteps[0]!.state).toBe('IN_PROGRESS');
    expect(unconfirmedDocSteps[1]!.state).toBe('NOT_STARTED');
    expect(unconfirmedDocSteps[1]!.blocked?.upstreamStep).toBe('REQUIREMENTS');

    // 3. Confirming Requirements -> Requirements CONFIRMED, Prototype unblocked NOT_STARTED
    const reqConf1 = {
      id: 'sconf-req-1',
      projectId: 'proj-custom',
      step: 'REQUIREMENTS' as const,
      docId: 'doc-1',
      title: '仓储系统需求',
      version: 'v1.0',
      content: v1Content,
      contentHash: computeStepContentHash(v1Content),
      basedOnConfirmationId: null,
      confirmedAt: '2026-11-17T01:00:00Z',
    };
    const afterReqConfirmSteps = deriveProjectSteps(
      makeBaseInput({
        requirementDocs: [{ id: 'doc-1', status: 'CONFIRMED', content: v1Content }],
        stepConfirmations: {
          requirements: reqConf1,
          prototype: null,
          businessModel: null,
        },
      }),
    );
    expect(afterReqConfirmSteps[0]!.state).toBe('CONFIRMED');
    expect(afterReqConfirmSteps[1]!.state).toBe('NOT_STARTED');
    expect(afterReqConfirmSteps[1]!.blocked).toBeUndefined();
    expect(afterReqConfirmSteps[2]!.blocked?.upstreamStep).toBe('PROTOTYPE');

    // 4. Editing requirement doc AFTER confirmation -> Requirements UNCONFIRMED_CHANGES, Prototype unaffected!
    const v2Content = '# 仓储系统需求\n\n## 1. 业务目标\n- 入库验收、波次出库与冷链温控抽检';
    const protoConf1 = {
      id: 'sconf-proto-1',
      projectId: 'proj-custom',
      step: 'PROTOTYPE' as const,
      prototypeId: 'proto-1',
      revisionId: 'rev-1',
      basedOnConfirmationId: reqConf1.id,
      confirmedAt: '2026-11-17T02:00:00Z',
    };
    const sampleSuite = { M1: { model: 'M1', domain: '仓储', version: '1.0.0', aggregates: [], data_dictionaries: [], aggregate_associations: [] } } as unknown as OntologySuite;
    const modelConf1 = {
      id: 'sconf-model-1',
      projectId: 'proj-custom',
      step: 'BUSINESS_MODEL' as const,
      suite: sampleSuite,
      suiteHash: computeOntologySuiteHash(sampleSuite),
      presentModels: ['M1' as const],
      basedOnConfirmationId: protoConf1.id,
      confirmedAt: '2026-11-17T03:00:00Z',
    };
    const snap1: Pick<
      DevelopmentPackageSnapshot,
      'snapshotId' | 'appId' | 'compiledAt' | 'basedOnBusinessModelConfirmationId'
    > = {
      snapshotId: 'pkg-1',
      appId: 'app-1',
      compiledAt: '2026-11-17T04:00:00Z',
      basedOnBusinessModelConfirmationId: modelConf1.id,
    };
    const editedReqSteps = deriveProjectSteps(
      makeBaseInput({
        project: {
          id: 'proj-custom',
          domain: '仓储',
          suite: sampleSuite,
          validation: { presentModels: ['M1'], errorCount: 0 },
        },
        requirementDocs: [{ id: 'doc-1', status: 'DRAFT', content: v2Content }],
        prototypes: [{ id: 'proto-1', currentRevisionId: 'rev-1' }],
        confirmedPrototypeRevision: {
          id: protoConf1.id,
          prototypeId: 'proto-1',
          revisionId: 'rev-1',
          basedOnConfirmationId: reqConf1.id,
        },
        stepConfirmations: {
          requirements: reqConf1,
          prototype: protoConf1,
          businessModel: modelConf1,
        },
        assembledApplications: [
          {
            id: 'app-1',
            projectId: 'proj-custom',
            name: 'WMS App',
            latestPackageSnapshotId: 'pkg-1',
          } as AssembledApplication,
        ],
        packageSnapshots: [snap1],
      }),
    );
    expect(editedReqSteps.map((s) => s.state)).toEqual([
      'UNCONFIRMED_CHANGES',
      'CONFIRMED',
      'CONFIRMED',
      'CONFIRMED',
    ]);

    // 5. Re-confirming Requirements (reqConf2) -> ONLY Prototype becomes OUTDATED; Business Model & Delivery remain CONFIRMED (#48 Decision #1)!
    const reqConf2 = {
      ...reqConf1,
      id: 'sconf-req-2',
      content: v2Content,
      contentHash: computeStepContentHash(v2Content),
      confirmedAt: '2026-11-17T05:00:00Z',
    };
    const cascadingStep1 = deriveProjectSteps(
      makeBaseInput({
        project: {
          id: 'proj-custom',
          domain: '仓储',
          suite: sampleSuite,
          validation: { presentModels: ['M1'], errorCount: 0 },
        },
        requirementDocs: [{ id: 'doc-1', status: 'CONFIRMED', content: v2Content }],
        prototypes: [{ id: 'proto-1', currentRevisionId: 'rev-1' }],
        confirmedPrototypeRevision: {
          id: protoConf1.id,
          prototypeId: 'proto-1',
          revisionId: 'rev-1',
          basedOnConfirmationId: reqConf1.id,
        },
        stepConfirmations: {
          requirements: reqConf2,
          prototype: protoConf1,
          businessModel: modelConf1,
        },
        assembledApplications: [
          {
            id: 'app-1',
            projectId: 'proj-custom',
            name: 'WMS App',
            latestPackageSnapshotId: 'pkg-1',
          } as AssembledApplication,
        ],
        packageSnapshots: [snap1],
      }),
    );
    expect(cascadingStep1.map((s) => s.state)).toEqual([
      'CONFIRMED',
      'OUTDATED',
      'CONFIRMED',
      'CONFIRMED',
    ]);
    expect(cascadingStep1[1]!.statusSummary.zh).toContain('需求有了新的确认');
    expect(cascadingStep1[1]!.statusSummary.zh).toContain('业务模型也会提示更新');
    expect(
      checkBusinessViewMarkup(cascadingStep1[1]!.statusSummary.zh, { plainText: true }),
    ).toEqual([]);
    expect(
      checkBusinessViewMarkup(cascadingStep1[1]!.statusSummary.en, { plainText: true }),
    ).toEqual([]);

    // 6. Re-confirming Prototype (protoConf2 based on reqConf2) -> Prototype CONFIRMED, Business Model becomes OUTDATED, Delivery stays CONFIRMED!
    const protoConf2 = {
      ...protoConf1,
      id: 'sconf-proto-2',
      basedOnConfirmationId: reqConf2.id,
      confirmedAt: '2026-11-17T06:00:00Z',
    };
    const cascadingStep2 = deriveProjectSteps(
      makeBaseInput({
        project: {
          id: 'proj-custom',
          domain: '仓储',
          suite: sampleSuite,
          validation: { presentModels: ['M1'], errorCount: 0 },
        },
        requirementDocs: [{ id: 'doc-1', status: 'CONFIRMED', content: v2Content }],
        prototypes: [{ id: 'proto-1', currentRevisionId: 'rev-1' }],
        confirmedPrototypeRevision: {
          id: protoConf2.id,
          prototypeId: 'proto-1',
          revisionId: 'rev-1',
          basedOnConfirmationId: reqConf2.id,
        },
        stepConfirmations: {
          requirements: reqConf2,
          prototype: protoConf2,
          businessModel: modelConf1,
        },
        assembledApplications: [
          {
            id: 'app-1',
            projectId: 'proj-custom',
            name: 'WMS App',
            latestPackageSnapshotId: 'pkg-1',
          } as AssembledApplication,
        ],
        packageSnapshots: [snap1],
      }),
    );
    expect(cascadingStep2.map((s) => s.state)).toEqual([
      'CONFIRMED',
      'CONFIRMED',
      'OUTDATED',
      'CONFIRMED',
    ]);

    // 7. Re-confirming Business Model (modelConf2 based on protoConf2) -> Business Model CONFIRMED, Delivery becomes OUTDATED (#48 Decision #4)!
    const modelConf2 = {
      ...modelConf1,
      id: 'sconf-model-2',
      basedOnConfirmationId: protoConf2.id,
      confirmedAt: '2026-11-17T07:00:00Z',
    };
    const cascadingStep3 = deriveProjectSteps(
      makeBaseInput({
        project: {
          id: 'proj-custom',
          domain: '仓储',
          suite: sampleSuite,
          validation: { presentModels: ['M1'], errorCount: 0 },
        },
        requirementDocs: [{ id: 'doc-1', status: 'CONFIRMED', content: v2Content }],
        prototypes: [{ id: 'proto-1', currentRevisionId: 'rev-1' }],
        confirmedPrototypeRevision: {
          id: protoConf2.id,
          prototypeId: 'proto-1',
          revisionId: 'rev-1',
          basedOnConfirmationId: reqConf2.id,
        },
        stepConfirmations: {
          requirements: reqConf2,
          prototype: protoConf2,
          businessModel: modelConf2,
        },
        assembledApplications: [
          {
            id: 'app-1',
            projectId: 'proj-custom',
            name: 'WMS App',
            latestPackageSnapshotId: 'pkg-1',
          } as AssembledApplication,
        ],
        packageSnapshots: [snap1],
      }),
    );
    expect(cascadingStep3.map((s) => s.state)).toEqual([
      'CONFIRMED',
      'CONFIRMED',
      'CONFIRMED',
      'OUTDATED',
    ]);

    // 8. Legacy imported project (like proj-mft): 5 models + generated skill, no req docs or prototypes
    const legacySteps = deriveProjectSteps(
      makeBaseInput({
        project: {
          id: 'proj-mft',
          domain: 'MFT',
          suite: {},
          validation: {
            presentModels: ['M1', 'M2', 'M3', 'ME', 'M5'],
            errorCount: 0,
          },
        },
        generatedSkills: [{ id: 'sk-1', projectId: 'proj-mft' } as GeneratedSkill],
      }),
    );
    expect(legacySteps[1]!.blocked?.upstreamStep).toBe('REQUIREMENTS');
    expect(legacySteps[2]!.blocked).toBeUndefined();
    expect(legacySteps[2]!.hasContent).toBe(true);
    expect(legacySteps[2]!.state).toBe('IN_PROGRESS');
  });

  it('formats project health status purely in business vocabulary with zero technical violations', () => {
    expect(deriveProjectHealthSummary({ errorCount: 3, warningCount: 2 })).toEqual({
      tone: 'error',
      errorCount: 3,
      warningCount: 2,
      text: { zh: '3 个需要修正的问题', en: '3 problems to fix' },
    });
    expect(formatProjectHealthStatus({ errorCount: 1, warningCount: 4 }, 'en-US')).toBe(
      '1 problem to fix',
    );
    expect(formatProjectHealthStatus({ errorCount: 0, warningCount: 2 }, 'zh-CN')).toBe(
      '2 处尚未完成的部分',
    );
    expect(formatProjectHealthStatus({ errorCount: 0, warningCount: 0 }, 'zh-CN')).toBe(
      '没有需要修正的问题',
    );

    for (const sample of [
      { errorCount: 3, warningCount: 2 },
      { errorCount: 0, warningCount: 2 },
      { errorCount: 0, warningCount: 0 },
    ]) {
      expect(
        checkBusinessViewMarkup(formatProjectHealthStatus(sample, 'zh-CN'), { plainText: true }),
      ).toEqual([]);
      expect(
        checkBusinessViewMarkup(formatProjectHealthStatus(sample, 'en-US'), { plainText: true }),
      ).toEqual([]);
    }
  });
});
