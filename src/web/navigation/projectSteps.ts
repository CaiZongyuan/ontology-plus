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
    };
  };
  agentSessions?: readonly Pick<AgentSession, 'projectId' | 'agentKind' | 'messages'>[];
  requirementSessions?: readonly Pick<RequirementSession, 'id'>[];
  requirementDocs: readonly Pick<RequirementDoc, 'id'>[];
  prototypes: readonly Pick<PrototypeArtifact, 'id'>[];
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
