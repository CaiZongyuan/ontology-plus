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
import {
  computeOntologySuiteHash,
  computeStepContentHash,
  isPackageSnapshotOutdatedForApp,
  normalizeStepMarkdown,
  type AgentSession,
  type AssembledApplication,
  type ConfirmedPrototypeRevision,
  type DevelopmentPackageSnapshot,
  type GeneratedSkill,
  type ProjectStepConfirmations,
  type PrototypeArtifact,
  type PrototypeStepConfirmationRecord,
  type RequirementDoc,
  type RequirementSession,
} from '../../packages/workspace-store/index.js';

export type ProjectStepNumber = 1 | 2 | 3 | 4 | 5;

export type ProjectStepTargetView =
  | 'app-requirements'
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
  requirementDocs: readonly (Pick<RequirementDoc, 'id'> &
    Partial<Pick<RequirementDoc, 'status' | 'content' | 'updatedAt'>>)[];
  prototypes: readonly (Pick<PrototypeArtifact, 'id'> &
    Partial<Pick<PrototypeArtifact, 'currentRevisionId'>>)[];
  confirmedPrototypeRevision?:
    | (Pick<ConfirmedPrototypeRevision, 'prototypeId' | 'revisionId'> &
        Partial<Pick<ConfirmedPrototypeRevision, 'id' | 'basedOnConfirmationId' | 'confirmedAt'>>)
    | null;
  stepConfirmations?: ProjectStepConfirmations | null;
  assembledApplications?: readonly AssembledApplication[];
  packageSnapshots?: readonly (Pick<
    DevelopmentPackageSnapshot,
    'snapshotId' | 'appId' | 'compiledAt' | 'basedOnBusinessModelConfirmationId'
  > &
    Partial<Pick<DevelopmentPackageSnapshot, 'manifestJson'>>)[];
  generatedSkills?: readonly GeneratedSkill[];
}

export interface ProjectLifecycleBootstrapSlice {
  activeProject: ProjectStepProgressInput['project'];
  agentSessions?: ProjectStepProgressInput['agentSessions'];
  requirementSessions?: ProjectStepProgressInput['requirementSessions'];
  requirementDocs: ProjectStepProgressInput['requirementDocs'];
  prototypes: ProjectStepProgressInput['prototypes'];
  confirmedPrototypeRevision?: ProjectStepProgressInput['confirmedPrototypeRevision'];
  stepConfirmations?: ProjectStepProgressInput['stepConfirmations'];
  assembledApplications?: ProjectStepProgressInput['assembledApplications'];
  packageSnapshots?: ProjectStepProgressInput['packageSnapshots'];
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
  const hasConfirmedRequirements = Boolean(input.stepConfirmations?.requirements);
  const prototypeCount = input.prototypes.length;
  const hasPrototype = prototypeCount > 0;
  const hasConfirmedPrototype = Boolean(
    input.stepConfirmations?.prototype ?? input.confirmedPrototypeRevision,
  );
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
  if (!hasExploration && !hasSrsDoc) {
    nextStep = {
      step: 1,
      targetView: 'app-requirements',
      labelZh: '前往第 1 步：开始需求探索',
      labelEn: 'Step 1: Start Requirements',
      hintZh: '先与 AI 助手描述想做的系统，梳理核心业务对象与业务规则。',
      hintEn: 'Describe your system with the AI Assistant to clarify core objects and business rules.',
    };
  } else if (!hasConfirmedPrototype && (!hasSrsDoc || !hasConfirmedRequirements)) {
    nextStep = {
      step: 2,
      targetView: 'app-requirements',
      labelZh: hasSrsDoc ? '前往需求：确认需求文档' : '前往需求：整理并确认需求文档',
      labelEn: hasSrsDoc ? 'Step 2: Confirm Requirements Document' : 'Step 2: Synthesize & Confirm Requirements',
      hintZh: '需求文档确认后，原型步骤将依据确认版本解锁。',
      hintEn: 'Once the requirements document is confirmed, the Prototype step unlocks.',
    };
  } else if (!hasConfirmedPrototype) {
    nextStep = hasPrototype
      ? {
          step: 3,
          targetView: 'app-prototype',
          labelZh: '前往原型：确认当前原型',
          labelEn: 'Step 3: Confirm Current Prototype',
          hintZh: '草稿原型已生成，请先确认原型修订，再整理业务模型。',
          hintEn: 'Draft prototype exists. Confirm a prototype revision first before building the Business Model.',
        }
      : {
          step: 3,
          targetView: 'app-prototype',
          labelZh: '前往原型：生成交互界面原型',
          labelEn: 'Step 3: Generate Prototype',
          hintZh: '需求文档已确认，下一步可生成交互界面原型以确认页面布局与业务操作。',
          hintEn: 'Requirements confirmed. Next, generate an interactive prototype to review screens and actions.',
        };
  } else if (!hasOntology) {
    nextStep = {
      step: 4,
      targetView: 'app-prototype',
      labelZh: '前往原型：推导业务模型',
      labelEn: 'Step 4: Synthesize Business Model',
      hintZh: '交互原型已确认，现在可推导出当前项目的业务模型。',
      hintEn: 'Prototype is confirmed. Synthesize your project Business Model from the prototype.',
    };
  } else {
    nextStep = {
      step: 5,
      targetView: 'app-assembly-dev',
      labelZh: '前往交付：生成开发资料包',
      labelEn: 'Step 5: Generate Development Package',
      hintZh: '业务模型已就绪，可前往交付步骤检查就绪状态并下载开发资料包。',
      hintEn: 'Business Model is ready. Open Delivery to check readiness and download the development package.',
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
    ...(data.stepConfirmations !== undefined ? { stepConfirmations: data.stepConfirmations } : {}),
    ...(data.assembledApplications ? { assembledApplications: data.assembledApplications } : {}),
    ...(data.packageSnapshots ? { packageSnapshots: data.packageSnapshots } : {}),
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
  readonly statusSummary: BilingualText;
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

function resolvePrototypeStepConfirmation(
  input: ProjectStepProgressInput,
): PrototypeStepConfirmationRecord | null {
  if (input.stepConfirmations?.prototype) {
    return input.stepConfirmations.prototype;
  }
  if (!input.confirmedPrototypeRevision) {
    return null;
  }
  return {
    id:
      input.confirmedPrototypeRevision.id ??
      `sconf-proto-${input.project.id}-${input.confirmedPrototypeRevision.revisionId}`,
    projectId: input.project.id,
    step: 'PROTOTYPE',
    prototypeId: input.confirmedPrototypeRevision.prototypeId,
    revisionId: input.confirmedPrototypeRevision.revisionId,
    basedOnConfirmationId: input.confirmedPrototypeRevision.basedOnConfirmationId ?? null,
    confirmedAt: input.confirmedPrototypeRevision.confirmedAt ?? '',
  };
}

function buildStepStatusSummary(
  step: ProjectStepId,
  state: ProjectStepStateId,
  blocked?: ProjectStepBlockedInfo,
): BilingualText {
  if (blocked) {
    return blocked.detail;
  }
  switch (step) {
    case 'REQUIREMENTS':
      switch (state) {
        case 'NOT_STARTED':
          return {
            zh: '和左边的 AI 助手描述你想做的系统，需求文档会在这里逐步成形。',
            en: 'Describe the system you want to build to the AI Assistant on the left, and the requirements document will take shape here.',
          };
        case 'IN_PROGRESS':
          return {
            zh: '需求文档尚未确认。检查内容无误后请点击确认，原型会依据确认版本生成。',
            en: 'Requirements are in progress. Review the document and confirm it to unlock Prototype.',
          };
        case 'UNCONFIRMED_CHANGES':
          return {
            zh: '需求文档有未确认的修改。原型仍依据上次确认的版本；重新确认后，原型会标为待更新。',
            en: 'Requirements have unconfirmed changes. Prototype still uses the last confirmed version; re-confirming will mark Prototype as Outdated.',
          };
        case 'CONFIRMED':
          return {
            zh: '需求文档已确认。下一步可以开始做原型；若想法变了，随时回来修改。',
            en: 'Requirements document confirmed. Next, build your Prototype; you can return and revise anytime.',
          };
        case 'OUTDATED':
          return {
            zh: '需求文档待更新。',
            en: 'Requirements are outdated.',
          };
      }
      break;
    case 'PROTOTYPE':
      switch (state) {
        case 'NOT_STARTED':
          return {
            zh: '需求文档已确认。现在可以挑选视觉参考或让 AI 助手生成首版原型。',
            en: 'Requirements are confirmed. Pick visual references or ask the AI Assistant to generate the first prototype.',
          };
        case 'IN_PROGRESS':
          return {
            zh: '原型草稿已生成，尚未确认。核对界面无误后请确认原型。',
            en: 'A draft prototype is in progress. Review the screens and confirm the prototype when ready.',
          };
        case 'OUTDATED':
          return {
            zh: '需求有了新的确认；原型更新确认后，业务模型也会提示更新。',
            en: 'Requirements were re-confirmed; once the prototype is updated and confirmed, the Business Model will also prompt for an update.',
          };
        case 'UNCONFIRMED_CHANGES':
          return {
            zh: '原型有未确认的新修订。业务模型仍依据上次确认的原型；确认新修订后会更新下游。',
            en: 'Prototype has unconfirmed revisions. Business Model still uses the previously confirmed prototype.',
          };
        case 'CONFIRMED':
          return {
            zh: '原型已确认。下一步可以整理并确认业务模型。',
            en: 'Prototype confirmed. Next, review and confirm your Business Model.',
          };
      }
      break;
    case 'BUSINESS_MODEL':
      switch (state) {
        case 'NOT_STARTED':
          return {
            zh: '原型已确认。现在可以让 AI 助手根据已确认的原型整理业务模型。',
            en: 'Prototype confirmed. Ask the AI Assistant to synthesize the Business Model from the confirmed prototype.',
          };
        case 'IN_PROGRESS':
          return {
            zh: '业务模型正在完善中。没有需要修正的问题后即可确认业务模型。',
            en: 'Business Model is in progress. Resolve any problems to fix and confirm when ready.',
          };
        case 'OUTDATED':
          return {
            zh: '原型有了新的确认；业务模型更新确认后，交付也会提示更新。',
            en: 'The prototype was re-confirmed; once the Business Model is updated and confirmed, Delivery will also prompt for an update.',
          };
        case 'UNCONFIRMED_CHANGES':
          return {
            zh: '业务模型有未确认的修改。交付仍依据上次确认的业务模型；重新确认后生效。',
            en: 'Business Model has unconfirmed changes. Delivery still uses the previously confirmed Business Model.',
          };
        case 'CONFIRMED':
          return {
            zh: '业务模型已确认。下一步可以前往交付生成开发资料包。',
            en: 'Business Model confirmed. Next, open Delivery to generate your development package.',
          };
      }
      break;
    case 'DELIVERY':
      switch (state) {
        case 'NOT_STARTED':
          return {
            zh: '需要先确认业务模型，才能生成开发资料包。',
            en: 'Confirm the Business Model first before generating the development package.',
          };
        case 'IN_PROGRESS':
          return {
            zh: '业务模型已确认，还没有基于当前确认版本生成开发资料包。',
            en: 'Business Model is confirmed; generate a development package snapshot from the current confirmation.',
          };
        case 'OUTDATED':
          return {
            zh: '业务模型有了新的确认；重新生成开发资料包即可对齐最新业务模型。',
            en: 'Business Model was re-confirmed; regenerate the development package to match the latest confirmation.',
          };
        case 'UNCONFIRMED_CHANGES':
          return {
            zh: '交付配置有未生成的新改动，重新生成开发资料包后生效。',
            en: 'Delivery settings have uncompiled edits; regenerate the development package to apply them.',
          };
        case 'CONFIRMED':
          return {
            zh: '蓝图已就绪，已基于当前确认的业务模型生成开发资料包，可交付开发。',
            en: 'Blueprint ready: a development package snapshot has been generated from the confirmed Business Model.',
          };
      }
      break;
  }
}

export function deriveProjectSteps(input: ProjectStepProgressInput): readonly ProjectStepStatusView[] {
  const lifecycle = deriveProjectStepProgress(input);
  const reqConf = input.stepConfirmations?.requirements ?? null;
  const protoConf = resolvePrototypeStepConfirmation(input);
  const modelConf = input.stepConfirmations?.businessModel ?? null;

  // 1. REQUIREMENTS
  const hasAnyRequirementWork = lifecycle.hasExploration || lifecycle.hasSrsDoc;
  let requirementsState: ProjectStepStateId;
  if (!reqConf) {
    requirementsState = hasAnyRequirementWork ? 'IN_PROGRESS' : 'NOT_STARTED';
  } else {
    const latestDoc = input.requirementDocs[0];
    const matchedDoc = input.requirementDocs.find((d) => d.id === reqConf.docId);
    const hasNewerDifferentDoc = Boolean(latestDoc && latestDoc.id !== reqConf.docId);
    const contentChanged =
      !matchedDoc ||
      (matchedDoc.content !== undefined
        ? computeStepContentHash(matchedDoc.content) !== reqConf.contentHash &&
          normalizeStepMarkdown(matchedDoc.content) !== normalizeStepMarkdown(reqConf.content)
        : matchedDoc.status === 'DRAFT');
    requirementsState =
      hasNewerDifferentDoc || contentChanged ? 'UNCONFIRMED_CHANGES' : 'CONFIRMED';
  }

  // 2. PROTOTYPE
  const prototypeBlocked = !reqConf && !protoConf && !lifecycle.hasPrototype;
  let prototypeState: ProjectStepStateId;
  if (!protoConf) {
    prototypeState = lifecycle.hasPrototype ? 'IN_PROGRESS' : 'NOT_STARTED';
  } else if (reqConf && protoConf.basedOnConfirmationId !== reqConf.id) {
    prototypeState = 'OUTDATED';
  } else {
    const confirmedProtoEntity = input.prototypes.find((p) => p.id === protoConf.prototypeId);
    const hasUnconfirmedProtoChanges = Boolean(
      confirmedProtoEntity?.currentRevisionId &&
        confirmedProtoEntity.currentRevisionId !== protoConf.revisionId,
    );
    prototypeState = hasUnconfirmedProtoChanges ? 'UNCONFIRMED_CHANGES' : 'CONFIRMED';
  }

  // 3. BUSINESS_MODEL (Cascading rule: ONLY outdated when Prototype's current confirmation changed!)
  const businessModelBlocked = !protoConf && !modelConf && !lifecycle.hasOntology;
  let businessModelState: ProjectStepStateId;
  if (!modelConf) {
    businessModelState = lifecycle.hasOntology ? 'IN_PROGRESS' : 'NOT_STARTED';
  } else if (protoConf && modelConf.basedOnConfirmationId !== protoConf.id) {
    businessModelState = 'OUTDATED';
  } else {
    const currentSuiteHash = computeOntologySuiteHash(input.project.suite);
    businessModelState =
      currentSuiteHash !== modelConf.suiteHash ? 'UNCONFIRMED_CHANGES' : 'CONFIRMED';
  }

  // 4. DELIVERY (#48 Decision #4: mapped from Business Model confirmation + package snapshots)
  const hasDeliveryContent =
    lifecycle.projectApps.length > 0 || lifecycle.projectSkills.length > 0;
  const deliveryBlocked = !modelConf;

  const snapshotsById = new Map(
    (input.packageSnapshots ?? []).map((snap) => [snap.snapshotId, snap]),
  );
  const appsWithSnapshot = lifecycle.projectApps.filter((app) =>
    Boolean(app.latestPackageSnapshotId),
  );
  let deliveryState: ProjectStepStateId;
  if (!modelConf) {
    deliveryState = 'NOT_STARTED';
  } else if (appsWithSnapshot.length === 0) {
    deliveryState = 'IN_PROGRESS';
  } else {
    const resolvedEntries = appsWithSnapshot
      .map((app) => {
        const snapshot = snapshotsById.get(app.latestPackageSnapshotId!);
        return snapshot ? { app, snapshot } : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((a, b) => b.snapshot.compiledAt.localeCompare(a.snapshot.compiledAt));
    const latestEntry = resolvedEntries[0];
    if (
      latestEntry &&
      isPackageSnapshotOutdatedForApp(latestEntry.snapshot, latestEntry.app, modelConf.id)
    ) {
      deliveryState = 'OUTDATED';
    } else {
      deliveryState = 'CONFIRMED';
    }
  }

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
      statusSummary: buildStepStatusSummary(id, state, blocked),
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
    ...(data.stepConfirmations !== undefined ? { stepConfirmations: data.stepConfirmations } : {}),
    ...(data.assembledApplications ? { assembledApplications: data.assembledApplications } : {}),
    ...(data.packageSnapshots ? { packageSnapshots: data.packageSnapshots } : {}),
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
