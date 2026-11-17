import { describe, expect, it } from 'vitest';
import type { OntologySuite } from '../../packages/ontology-core/index.js';
import type {
  AssembledApplication,
  GeneratedSkill,
} from '../../packages/workspace-store/index.js';
import {
  deriveProjectStepProgress,
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
});
