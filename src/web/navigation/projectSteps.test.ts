import { describe, expect, it } from 'vitest';
import { checkBusinessViewMarkup } from '../../packages/business-vocabulary/index.js';
import type { OntologySuite } from '../../packages/ontology-core/index.js';
import type {
  AssembledApplication,
  GeneratedSkill,
} from '../../packages/workspace-store/index.js';
import {
  deriveProjectHealthSummary,
  deriveProjectStepProgress,
  deriveProjectSteps,
  formatProjectHealthStatus,
  getProjectLifecycleState,
  type ProjectStepProgressInput,
} from './index.js';

function makeConfirmedRevision(prototypeId = 'proto-1') {
  return {
    prototypeId,
    revisionId: 'rev-1',
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
    assembledApplications: [],
    generatedSkills: [],
    ...overrides,
  };
}

describe('deriveProjectStepProgress and getProjectLifecycleState', () => {
  it('derives Step 1 when no requirement exploration exists and ignores empty or foreign-project agent sessions', () => {
    const state = deriveProjectStepProgress(
      makeBaseInput({
        agentSessions: [
          // Empty REQUIREMENT session on active project does not count as completed exploration
          { projectId: 'proj-custom', agentKind: 'REQUIREMENT', messages: [] },
          // Non-empty REQUIREMENT session on another project does not count
          {
            projectId: 'proj-other',
            agentKind: 'REQUIREMENT',
            messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: '2026-11-17T00:00:00Z' }],
          },
          // Non-REQUIREMENT session on active project does not count
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
      targetView: 'app-req-explore',
      labelEn: 'Step 1: Start Requirement Exploration',
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
      targetView: 'app-req-explore',
      labelEn: 'Step 2: Synthesize SRS Document',
    });
  });

  it('distinguishes Step 3 generate-prototype vs confirm-prototype based on draft prototypes and confirmed revision', () => {
    const step3Generate = deriveProjectStepProgress(
      makeBaseInput({
        requirementSessions: [{ id: 'req-1' }],
        requirementDocs: [{ id: 'doc-1' }],
        prototypes: [],
        confirmedPrototypeRevision: null,
      }),
    );
    expect(step3Generate.hasSrsDoc).toBe(true);
    expect(step3Generate.srsDocCount).toBe(1);
    expect(step3Generate.hasPrototype).toBe(false);
    expect(step3Generate.hasConfirmedPrototype).toBe(false);
    expect(step3Generate.nextStep).toMatchObject({
      step: 3,
      targetView: 'app-req-docs',
      labelEn: 'Step 3: Generate UI Prototype',
    });

    const step3Confirm = deriveProjectStepProgress(
      makeBaseInput({
        requirementSessions: [{ id: 'req-1' }],
        requirementDocs: [{ id: 'doc-1' }],
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
      labelEn: 'Step 3: Confirm Current Prototype',
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
    expect(step4.presentModelCount).toBe(0);
    expect(step4.nextStep).toMatchObject({
      step: 4,
      targetView: 'app-prototype',
      labelEn: 'Step 4: Synthesize 11-Model Ontology',
    });

    const appForActive = { id: 'app-1', projectId: 'proj-custom', name: 'WMS App' } as AssembledApplication;
    const appForOther = { id: 'app-2', projectId: 'proj-other', name: 'Other App' } as AssembledApplication;
    const skillForActive = { id: 'sk-1', projectId: 'proj-custom', slug: 'wms-skill' } as GeneratedSkill;
    const skillForOther = { id: 'sk-2', projectId: 'proj-other', slug: 'other-skill' } as GeneratedSkill;

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
        assembledApplications: [appForActive, appForOther],
        generatedSkills: [skillForActive, skillForOther],
      }),
    );
    expect(step5.hasOntology).toBe(true);
    expect(step5.presentModelCount).toBe(4);
    expect(step5.projectApps).toEqual([appForActive]);
    expect(step5.projectSkills).toEqual([skillForActive]);
    expect(step5.nextStep).toMatchObject({
      step: 5,
      targetView: 'app-assembly-dev',
      labelEn: 'Step 5: Assemble 4-Layer Dev Package',
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
    expect(foreignClm.foreignTemplateNameZh).toBe('合同全生命周期管理系统 (CLM)');
    expect(foreignClm.foreignTemplateNameEn).toBe('Contract Lifecycle Management (CLM)');

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
    expect(nativeClm.foreignTemplateNameZh).toBeUndefined();

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
    expect(foreignMft.foreignTemplateNameZh).toBe('企业文件安全传输系统 (MFT)');
    expect(foreignMft.foreignTemplateNameEn).toBe('Enterprise MFT Security');
  });

  it('derives the 4 ordered Project Steps, blocked reasons, unconfirmed changes, and legacy project overrides cleanly', () => {
    // 1. Brand-new empty project: Step 1 open, Steps 2–4 blocked pointing to immediate upstream
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

    expect(emptySteps[1]).toMatchObject({
      id: 'PROTOTYPE',
      state: 'NOT_STARTED',
      hasContent: false,
      blocked: {
        reason: { zh: '需先确认需求', en: 'Needs requirements first' },
        upstreamStep: 'REQUIREMENTS',
      },
    });
    expect(emptySteps[2]).toMatchObject({
      id: 'BUSINESS_MODEL',
      state: 'NOT_STARTED',
      hasContent: false,
      blocked: {
        reason: { zh: '需先确认原型', en: 'Needs prototype first' },
        upstreamStep: 'PROTOTYPE',
      },
    });
    expect(emptySteps[3]).toMatchObject({
      id: 'DELIVERY',
      state: 'NOT_STARTED',
      hasContent: false,
      blocked: {
        reason: { zh: '需先确认业务模型', en: 'Needs business model first' },
        upstreamStep: 'BUSINESS_MODEL',
      },
    });

    for (const step of emptySteps) {
      expect(checkBusinessViewMarkup(step.name.zh, { plainText: true })).toEqual([]);
      expect(checkBusinessViewMarkup(step.name.en, { plainText: true })).toEqual([]);
      expect(checkBusinessViewMarkup(step.stateLabel.zh, { plainText: true })).toEqual([]);
      expect(checkBusinessViewMarkup(step.stateLabel.en, { plainText: true })).toEqual([]);
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

    // 2. Draft requirement doc keeps Requirements IN_PROGRESS and Prototype blocked
    const draftReqSteps = deriveProjectSteps(
      makeBaseInput({
        requirementDocs: [{ id: 'doc-draft', status: 'DRAFT' }],
      }),
    );
    expect(draftReqSteps[0]!.state).toBe('IN_PROGRESS');
    expect(draftReqSteps[1]!.blocked?.upstreamStep).toBe('REQUIREMENTS');

    // 3. Confirmed requirement + unconfirmed prototype revision v2 over confirmed v1
    const unconfirmedProtoSteps = deriveProjectSteps(
      makeBaseInput({
        requirementDocs: [{ id: 'doc-1', status: 'CONFIRMED' }],
        prototypes: [{ id: 'proto-1', currentRevisionId: 'rev-2' }],
        confirmedPrototypeRevision: { prototypeId: 'proto-1', revisionId: 'rev-1' },
      }),
    );
    expect(unconfirmedProtoSteps[0]!.state).toBe('CONFIRMED');
    expect(unconfirmedProtoSteps[1]!.state).toBe('UNCONFIRMED_CHANGES');
    expect(unconfirmedProtoSteps[1]!.blocked).toBeUndefined();
    expect(unconfirmedProtoSteps[2]!.state).toBe('NOT_STARTED');
    expect(unconfirmedProtoSteps[2]!.blocked).toBeUndefined();

    // 4. Full 11-model suite + compiled package snapshot -> Business Model & Delivery CONFIRMED
    const fullSteps = deriveProjectSteps(
      makeBaseInput({
        project: {
          id: 'proj-custom',
          domain: '合同管理',
          suite: {},
          validation: {
            presentModels: ['M1', 'M2', 'M3', 'ME', 'M4', 'M5', 'M6', 'M7', 'MU', 'MM', 'MI'],
            errorCount: 0,
          },
        },
        requirementDocs: [{ id: 'doc-1', status: 'CONFIRMED' }],
        prototypes: [{ id: 'proto-1', currentRevisionId: 'rev-1' }],
        confirmedPrototypeRevision: { prototypeId: 'proto-1', revisionId: 'rev-1' },
        assembledApplications: [
          {
            id: 'app-1',
            projectId: 'proj-custom',
            name: 'CLM App',
            latestPackageSnapshotId: 'snap-1',
          } as AssembledApplication,
        ],
      }),
    );
    expect(fullSteps.map((s) => s.state)).toEqual([
      'CONFIRMED',
      'CONFIRMED',
      'CONFIRMED',
      'CONFIRMED',
    ]);

    // 5. Legacy imported project (like proj-mft): 5 models + generated skill, no req docs or prototypes
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
    expect(legacySteps[3]!.blocked).toBeUndefined();
    expect(legacySteps[3]!.state).toBe('IN_PROGRESS');
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
    expect(formatProjectHealthStatus({ errorCount: 0, warningCount: 2 }, 'en-US')).toBe(
      '2 parts not yet completed',
    );
    expect(formatProjectHealthStatus({ errorCount: 0, warningCount: 1 }, 'en-US')).toBe(
      '1 part not yet completed',
    );
    expect(formatProjectHealthStatus({ errorCount: 0, warningCount: 0 }, 'zh-CN')).toBe(
      '没有需要修正的问题',
    );
    expect(formatProjectHealthStatus({ errorCount: 0, warningCount: 0 }, 'en-US')).toBe(
      'No problems to fix',
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
