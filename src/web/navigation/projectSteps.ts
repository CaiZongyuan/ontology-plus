import {
  BUSINESS_VOCABULARY,
  PROJECT_STEP_IDS,
  PROJECT_STEP_NAMES,
  PROJECT_STEP_STATE_NAMES,
  pickBusinessText,
  type BilingualText,
  type BusinessLocale,
  type ProjectStepId,
  type ProjectStepStateId,
} from '../../packages/business-vocabulary/index.js';
import type { ModelCode, OntologySuite } from '../../packages/ontology-core/index.js';
import type {
  AgentSession,
  AssembledApplication,
  ConfirmedPrototypeRevision,
  GeneratedSkill,
  PrototypeArtifact,
  RequirementDoc,
  RequirementSession,
} from '../../packages/workspace-store/index.js';

export type ProjectStepNumber = 1 | 2 | 3 | 4 | 5;

export type ProjectStepTargetView =
  | 'app-req-explore'
  | 'app-req-docs'
  | 'app-prototype'
  | 'app-ontology'
  | 'app-assembly-dev';

export interface ProjectNextStep {
  step: ProjectStepNumber;
  targetView: ProjectStepTargetView;
  labelZh: string;
  labelEn: string;
  hintZh: string;
  hintEn: string;
}

export interface ProjectLifecycleState {
  hasExploration: boolean;
  explorationCount: number;
  hasSrsDoc: boolean;
  srsDocCount: number;
  hasPrototype: boolean;
  hasConfirmedPrototype: boolean;
  prototypeCount: number;
  presentModelCount: number;
  hasOntology: boolean;
  hasForeignDemoTemplate: boolean;
  foreignTemplateNameZh?: string;
  foreignTemplateNameEn?: string;
  projectApps: AssembledApplication[];
  projectSkills: GeneratedSkill[];
  nextStep: ProjectNextStep;
}

export interface ProjectStepProgressInput {
  project: {
    id: string;
    domain?: string;
    suite: OntologySuite;
    validation: {
      presentModels: readonly ModelCode[];
      errorCount?: number;
      warningCount?: number;
    };
  };
  agentSessions?: readonly Pick<AgentSession, 'projectId' | 'agentKind' | 'messages'>[];
  requirementSessions?: readonly Pick<RequirementSession, 'id'>[];
  requirementDocs: readonly (Pick<RequirementDoc, 'id'> & Partial<Pick<RequirementDoc, 'status'>>)[];
  prototypes: readonly (Pick<PrototypeArtifact, 'id'> & Partial<Pick<PrototypeArtifact, 'currentRevisionId'>>)[];
  confirmedPrototypeRevision?: Pick<ConfirmedPrototypeRevision, 'prototypeId' | 'revisionId'> | null;
  assembledApplications?: readonly AssembledApplication[];
  generatedSkills?: readonly GeneratedSkill[];
}

export interface ProjectLifecycleBootstrapSlice {
  activeProject: ProjectStepProgressInput['project'];
  agentSessions?: ProjectStepProgressInput['agentSessions'];
  requirementSessions?: ProjectStepProgressInput['requirementSessions'];
  requirementDocs: ProjectStepProgressInput['requirementDocs'];
  prototypes: ProjectStepProgressInput['prototypes'];
  confirmedPrototypeRevision?: ProjectStepProgressInput['confirmedPrototypeRevision'];
  assembledApplications?: ProjectStepProgressInput['assembledApplications'];
  generatedSkills?: ProjectStepProgressInput['generatedSkills'];
}

const CLM_DEMO_DOMAIN = '合同全生命周期管理系统';
const MFT_DEMO_DOMAIN = '企业文件安全传输系统 (MFT)';

export function deriveProjectStepProgress(input: ProjectStepProgressInput): ProjectLifecycleState {
  const { project } = input;
  const reqAgentSessions = (input.agentSessions ?? []).filter(
    (s) => s.projectId === project.id && s.agentKind === 'REQUIREMENT' && s.messages.length > 0,
  );
  const explorationCount = Math.max(
    (input.requirementSessions ?? []).length,
    reqAgentSessions.length,
  );
  const hasExploration = explorationCount > 0;
  const srsDocCount = input.requirementDocs.length;
  const hasSrsDoc = srsDocCount > 0;
  const prototypeCount = input.prototypes.length;
  const hasPrototype = prototypeCount > 0;
  const hasConfirmedPrototype = Boolean(input.confirmedPrototypeRevision);
  const presentModelCount = project.validation.presentModels.length;
  const hasOntology = presentModelCount > 0;

  const isContractForeign =
    project.id !== 'proj-contract' &&
    project.suite.M1?.domain === CLM_DEMO_DOMAIN &&
    project.domain !== CLM_DEMO_DOMAIN;
  const isMftForeign =
    project.id !== 'proj-mft' &&
    project.suite.M1?.domain === MFT_DEMO_DOMAIN &&
    project.domain !== MFT_DEMO_DOMAIN;
  const hasForeignDemoTemplate = isContractForeign || isMftForeign;

  const projectApps = (input.assembledApplications ?? []).filter((a) => a.projectId === project.id);
  const projectSkills = (input.generatedSkills ?? []).filter((s) => s.projectId === project.id);

  let nextStep: ProjectNextStep;
  if (!hasExploration) {
    nextStep = {
      step: 1,
      targetView: 'app-req-explore',
      labelZh: '前往第 1 步：开始需求探索',
      labelEn: 'Step 1: Start Requirement Exploration',
      hintZh: '先与 AI 澄清核心业务角色、单据与规则决策，再逐步自动生成规格书、原型与业务本体。',
      hintEn:
        'Clarify domain roles, entities, and rules with AI first before generating downstream artifacts.',
    };
  } else if (!hasSrsDoc) {
    nextStep = {
      step: 2,
      targetView: 'app-req-explore',
      labelZh: '前往需求探索：合成《需求文档》',
      labelEn: 'Step 2: Synthesize SRS Document',
      hintZh: '您已完成需求探索对话，下一步请合成《软件需求说明书》，作为原型与本体的输入依据。',
      hintEn:
        'Exploration session found. Next, synthesize the Software Requirements Specification (SRS).',
    };
  } else if (!hasConfirmedPrototype) {
    nextStep = hasPrototype
      ? {
          step: 3,
          targetView: 'app-prototype',
          labelZh: '前往界面原型：确认为当前原型',
          labelEn: 'Step 3: Confirm Current Prototype',
          hintZh:
            '草稿原型已生成，请先在「界面原型」中点击「确认为当前原型」，再推导 11 元模型业务本体。',
          hintEn:
            'Draft prototype exists. Confirm a prototype revision ("Confirm Current Prototype") first before synthesizing the 11-model ontology.',
        }
      : {
          step: 3,
          targetView: 'app-req-docs',
          labelZh: '前往需求文档：生成交互界面原型',
          labelEn: 'Step 3: Generate UI Prototype',
          hintZh: '《需求文档》已就绪，下一步请生成交互式 HTML 原型以确认页面布局与业务操作流。',
          hintEn:
            'SRS is ready. Next, generate an interactive HTML prototype to confirm screens and actions.',
        };
  } else if (!hasOntology) {
    nextStep = {
      step: 4,
      targetView: 'app-prototype',
      labelZh: '前往界面原型：一键推导业务本体',
      labelEn: 'Step 4: Synthesize 11-Model Ontology',
      hintZh: '交互原型已就绪，现在可在「界面原型」中一键推导出本工程专属的 11 元模型业务本体。',
      hintEn:
        'Prototype is ready. Synthesize your project-specific 11-model ontology from the prototype.',
    };
  } else {
    nextStep = {
      step: 5,
      targetView: 'app-assembly-dev',
      labelZh: '前往应用开发：组装四层开发资料包',
      labelEn: 'Step 5: Assemble 4-Layer Dev Package',
      hintZh: '业务本体已就绪，可绑定四层架构资产并编译导出《开发指导书》与开发资料包。',
      hintEn: 'Business ontology is ready. Bind 4-layer assets and compile the development package.',
    };
  }

  return {
    hasExploration,
    explorationCount,
    hasSrsDoc,
    srsDocCount,
    hasPrototype,
    hasConfirmedPrototype,
    prototypeCount,
    presentModelCount,
    hasOntology,
    hasForeignDemoTemplate,
    ...(isContractForeign
      ? {
          foreignTemplateNameZh: '合同全生命周期管理系统 (CLM)',
          foreignTemplateNameEn: 'Contract Lifecycle Management (CLM)',
        }
      : isMftForeign
        ? {
            foreignTemplateNameZh: '企业文件安全传输系统 (MFT)',
            foreignTemplateNameEn: 'Enterprise MFT Security',
          }
        : {}),
    projectApps,
    projectSkills,
    nextStep,
  };
}

export function getProjectLifecycleState(data: ProjectLifecycleBootstrapSlice): ProjectLifecycleState {
  return deriveProjectStepProgress({
    project: data.activeProject,
    ...(data.agentSessions ? { agentSessions: data.agentSessions } : {}),
    ...(data.requirementSessions ? { requirementSessions: data.requirementSessions } : {}),
    requirementDocs: data.requirementDocs,
    prototypes: data.prototypes,
    ...(data.confirmedPrototypeRevision !== undefined
      ? { confirmedPrototypeRevision: data.confirmedPrototypeRevision }
      : {}),
    ...(data.assembledApplications ? { assembledApplications: data.assembledApplications } : {}),
    ...(data.generatedSkills ? { generatedSkills: data.generatedSkills } : {}),
  });
}

export interface ProjectStepBlockedInfo {
  readonly reason: BilingualText;
  readonly detail: BilingualText;
  readonly actionLabel: BilingualText;
  readonly upstreamStep: ProjectStepId;
}

export interface ProjectStepStatusView {
  readonly id: ProjectStepId;
  readonly index: number;
  readonly name: BilingualText;
  readonly state: ProjectStepStateId;
  readonly stateLabel: BilingualText;
  readonly hasContent: boolean;
  readonly blocked?: ProjectStepBlockedInfo;
}

const BLOCKED_STEP_COPY: Readonly<
  Record<Exclude<ProjectStepId, 'REQUIREMENTS'>, ProjectStepBlockedInfo>
> = {
  PROTOTYPE: {
    reason: { zh: '需先确认需求', en: 'Needs requirements first' },
    detail: {
      zh: '需要先完成并确认需求文档，才能围绕确定的业务范围生成原型。',
      en: 'Confirm your requirements document first before generating an interactive prototype.',
    },
    actionLabel: { zh: '去完成需求', en: 'Go to Requirements' },
    upstreamStep: 'REQUIREMENTS',
  },
  BUSINESS_MODEL: {
    reason: { zh: '需先确认原型', en: 'Needs prototype first' },
    detail: {
      zh: '需要先确认界面原型，才能从中提炼并核对业务模型。',
      en: 'Confirm an interactive prototype first before building the business model.',
    },
    actionLabel: { zh: '去确认原型', en: 'Go to Prototype' },
    upstreamStep: 'PROTOTYPE',
  },
  DELIVERY: {
    reason: { zh: '需先确认业务模型', en: 'Needs business model first' },
    detail: {
      zh: '需要先确认业务模型，才能生成开发资料包与交付物。',
      en: 'Confirm your business model first before generating deliverables.',
    },
    actionLabel: { zh: '去确认业务模型', en: 'Go to Business Model' },
    upstreamStep: 'BUSINESS_MODEL',
  },
};

export function deriveProjectSteps(input: ProjectStepProgressInput): readonly ProjectStepStatusView[] {
  const lifecycle = deriveProjectStepProgress(input);
  const hasConfirmedRequirementDoc = input.requirementDocs.some(
    (doc) => doc.status === undefined || doc.status === 'CONFIRMED' || doc.status === 'PUBLISHED',
  );
  const hasAnyRequirementWork = lifecycle.hasExploration || lifecycle.hasSrsDoc;

  const requirementsState: ProjectStepStateId = hasConfirmedRequirementDoc
    ? 'CONFIRMED'
    : hasAnyRequirementWork
      ? 'IN_PROGRESS'
      : 'NOT_STARTED';

  const confirmedProto = input.confirmedPrototypeRevision;
  const confirmedProtoEntity = confirmedProto
    ? input.prototypes.find((p) => p.id === confirmedProto.prototypeId)
    : undefined;
  const hasUnconfirmedProtoChanges = Boolean(
    confirmedProto &&
      confirmedProtoEntity?.currentRevisionId &&
      confirmedProtoEntity.currentRevisionId !== confirmedProto.revisionId,
  );

  const prototypeBlocked = !hasConfirmedRequirementDoc && !lifecycle.hasPrototype;
  const prototypeState: ProjectStepStateId = confirmedProto
    ? hasUnconfirmedProtoChanges
      ? 'UNCONFIRMED_CHANGES'
      : 'CONFIRMED'
    : lifecycle.hasPrototype
      ? 'IN_PROGRESS'
      : 'NOT_STARTED';

  const errorCount = input.project.validation.errorCount ?? 0;
  const isModelCompleteAndClean = lifecycle.presentModelCount === 11 && errorCount === 0;
  const businessModelBlocked = !lifecycle.hasConfirmedPrototype && !lifecycle.hasOntology;
  const businessModelState: ProjectStepStateId = !lifecycle.hasOntology
    ? 'NOT_STARTED'
    : isModelCompleteAndClean
      ? 'CONFIRMED'
      : 'IN_PROGRESS';

  const hasDeliveryContent =
    lifecycle.projectApps.length > 0 || lifecycle.projectSkills.length > 0;
  const hasCompiledPackageSnapshot = lifecycle.projectApps.some((app) =>
    Boolean(app.latestPackageSnapshotId),
  );
  const deliveryBlocked = !lifecycle.hasOntology && !hasDeliveryContent;
  const deliveryState: ProjectStepStateId = hasCompiledPackageSnapshot
    ? 'CONFIRMED'
    : hasDeliveryContent || isModelCompleteAndClean
      ? 'IN_PROGRESS'
      : 'NOT_STARTED';

  const stateById: Record<ProjectStepId, ProjectStepStateId> = {
    REQUIREMENTS: requirementsState,
    PROTOTYPE: prototypeState,
    BUSINESS_MODEL: businessModelState,
    DELIVERY: deliveryState,
  };
  const hasContentById: Record<ProjectStepId, boolean> = {
    REQUIREMENTS: hasAnyRequirementWork,
    PROTOTYPE: lifecycle.hasPrototype,
    BUSINESS_MODEL: lifecycle.hasOntology,
    DELIVERY: hasDeliveryContent,
  };
  const blockedById: Partial<Record<ProjectStepId, ProjectStepBlockedInfo>> = {
    ...(prototypeBlocked ? { PROTOTYPE: BLOCKED_STEP_COPY.PROTOTYPE } : {}),
    ...(businessModelBlocked ? { BUSINESS_MODEL: BLOCKED_STEP_COPY.BUSINESS_MODEL } : {}),
    ...(deliveryBlocked ? { DELIVERY: BLOCKED_STEP_COPY.DELIVERY } : {}),
  };

  return PROJECT_STEP_IDS.map((id, index) => {
    const state = stateById[id];
    const blocked = blockedById[id];
    return {
      id,
      index,
      name: PROJECT_STEP_NAMES[id],
      state,
      stateLabel: PROJECT_STEP_STATE_NAMES[state],
      hasContent: hasContentById[id],
      ...(blocked ? { blocked } : {}),
    };
  });
}

export function getProjectStepsFromBootstrap(
  data: ProjectLifecycleBootstrapSlice,
): readonly ProjectStepStatusView[] {
  return deriveProjectSteps({
    project: data.activeProject,
    ...(data.agentSessions ? { agentSessions: data.agentSessions } : {}),
    ...(data.requirementSessions ? { requirementSessions: data.requirementSessions } : {}),
    requirementDocs: data.requirementDocs,
    prototypes: data.prototypes,
    ...(data.confirmedPrototypeRevision !== undefined
      ? { confirmedPrototypeRevision: data.confirmedPrototypeRevision }
      : {}),
    ...(data.assembledApplications ? { assembledApplications: data.assembledApplications } : {}),
    ...(data.generatedSkills ? { generatedSkills: data.generatedSkills } : {}),
  });
}

export interface ProjectHealthSummary {
  readonly tone: 'ok' | 'warning' | 'error';
  readonly errorCount: number;
  readonly warningCount: number;
  readonly text: BilingualText;
}

export function deriveProjectHealthSummary(validation: {
  errorCount: number;
  warningCount: number;
}): ProjectHealthSummary {
  const errorCount = Math.max(0, validation.errorCount);
  const warningCount = Math.max(0, validation.warningCount);
  if (errorCount > 0) {
    return {
      tone: 'error',
      errorCount,
      warningCount,
      text: {
        zh: `${errorCount} 个${BUSINESS_VOCABULARY.CONSISTENCY_ERROR.zh}`,
        en: `${errorCount} ${errorCount === 1 ? 'problem to fix' : 'problems to fix'}`,
      },
    };
  }
  if (warningCount > 0) {
    return {
      tone: 'warning',
      errorCount: 0,
      warningCount,
      text: {
        zh: `${warningCount} 处${BUSINESS_VOCABULARY.STAGE_WARNING.zh}`,
        en: `${warningCount} ${warningCount === 1 ? 'part not yet completed' : 'parts not yet completed'}`,
      },
    };
  }
  return {
    tone: 'ok',
    errorCount: 0,
    warningCount: 0,
    text: {
      zh: `没有${BUSINESS_VOCABULARY.CONSISTENCY_ERROR.zh}`,
      en: 'No problems to fix',
    },
  };
}

export function formatProjectHealthStatus(
  validation: { errorCount: number; warningCount: number },
  locale: BusinessLocale = 'zh-CN',
): string {
  return pickBusinessText(deriveProjectHealthSummary(validation).text, locale);
}
