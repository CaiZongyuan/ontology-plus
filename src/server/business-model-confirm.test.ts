import { describe, expect, it } from 'vitest';
import { checkBusinessViewMarkup } from '../packages/business-vocabulary/index.js';
import { CONTRACT_LIFECYCLE_SUITE, type OntologySuite } from '../packages/ontology-core/index.js';
import {
  createWorkspaceStore,
  type BusinessModelStepConfirmationRecord,
  type ProjectStepConfirmations,
} from '../packages/workspace-store/index.js';
import type { ProjectStepStatusView } from '../web/navigation/projectSteps.js';
import { createApiApp } from './app.js';

describe('server HTTP: Business Model confirmation gate, suiteSnapshot immutability, OUTDATED cascade, and ADR 0010 synthesis (#71)', () => {
  it('rejects confirming Business Model when Prototype is unconfirmed, when suite is empty, or when Consistency Errors exist, with plain business-language messages in zh-CN and en-US', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    try {
      const app = createApiApp(store);

      // 1. Unconfirmed Prototype (even when suite has 11 clean models, e.g. proj-mft) -> 409 PROTOTYPE_NOT_CONFIRMED
      const noProtoZhRes = await app.request('/api/projects/proj-mft/steps/business-model/confirm', {
        method: 'POST',
        headers: { 'x-onto-locale': 'zh-CN' },
      });
      expect(noProtoZhRes.status).toBe(409);
      const noProtoZh = (await noProtoZhRes.json()) as {
        code: string;
        error: string;
        messageZh: string;
        messageEn: string;
      };
      expect(noProtoZh.code).toBe('PROTOTYPE_NOT_CONFIRMED');
      expect(checkBusinessViewMarkup(noProtoZh.error, { plainText: true })).toEqual([]);
      expect(checkBusinessViewMarkup(noProtoZh.messageEn, { plainText: true })).toEqual([]);

      const noProtoEnRes = await app.request('/api/projects/proj-mft/steps/business-model/confirm', {
        method: 'POST',
        headers: { 'x-onto-locale': 'en-US' },
      });
      expect(noProtoEnRes.status).toBe(409);
      const noProtoEn = (await noProtoEnRes.json()) as { code: string; error: string };
      expect(noProtoEn.code).toBe('PROTOTYPE_NOT_CONFIRMED');
      expect(noProtoEn.error).toBe(noProtoZh.messageEn);

      // 2. Empty Business Model (Prototype confirmed, but suite cleared to {}) -> 409 EMPTY_BUSINESS_MODEL
      const emptyProj = store.createProject({
        name: '门店巡检台账系统',
        code: 'STORE-INSPECT',
        domain: '连锁门店运营',
        template: 'EMPTY',
      });
      const reqDoc = store.saveRequirementDoc({
        id: 'rdoc-inspect-1',
        projectId: emptyProj.id,
        title: '门店巡检需求文档',
        version: 'v1.0',
        status: 'DRAFT',
        content: '# 门店巡检需求\n\n## 1. 业务目标\n记录门店每日巡检单。',
      });
      store.confirmRequirementsStep(emptyProj.id, { docId: reqDoc.id });
      const createdProto = store.createPrototype(emptyProj.id, {
        name: '门店巡检原型',
        htmlContent:
          '<section data-screen-id="SCR-INSP-LIST" data-screen-name="巡检单列表" data-screen-type="LIST"><button data-element-id="EL-NEW-INSP" data-element-type="BUTTON">新建巡检单</button></section>',
        source: 'GENERATED',
      });
      store.confirmPrototypeRevision(emptyProj.id, createdProto.revision.id);
      store.commitSuite(emptyProj.id, {}, { source: { kind: 'MANUAL' } });

      const emptyRes = await app.request(
        `/api/projects/${emptyProj.id}/steps/business-model/confirm`,
        {
          method: 'POST',
          headers: { 'x-onto-locale': 'zh-CN' },
        },
      );
      expect(emptyRes.status).toBe(409);
      const emptyJson = (await emptyRes.json()) as {
        code: string;
        error: string;
        messageEn: string;
      };
      expect(emptyJson.code).toBe('EMPTY_BUSINESS_MODEL');
      expect(checkBusinessViewMarkup(emptyJson.error, { plainText: true })).toEqual([]);
      expect(checkBusinessViewMarkup(emptyJson.messageEn, { plainText: true })).toEqual([]);

      // 3. Suite with Consistency Error (errorCount > 0) -> 409 CONSISTENCY_ERRORS_PRESENT
      store.commitSuite(
        emptyProj.id,
        {
          M1: {
            model_type: 'OBJECT',
            domain: emptyProj.domain,
            version: '1.0.0',
            aggregates: [
              {
                id: 'AGG-01',
                name: 'InspectionOrder',
                alias: '巡检单',
                aggregateType: 'AGGREGATE_ROOT',
                description: '门店日常巡检单',
                lifecycle: ['DRAFT', 'COMPLETED'],
                tags: [],
                attributes: [
                  {
                    name: 'category',
                    label: '巡检类别',
                    type: 'DictionaryRef',
                    dictionaryRef: { dictionaryId: 'DICT-MISSING-01', typeCode: 'CAT' },
                    required: true,
                    refRules: [],
                  },
                ],
                entities: [],
                valueObjects: [],
                invariants: [],
              },
            ],
            data_dictionaries: [],
            aggregate_associations: [],
          },
        },
        { source: { kind: 'MANUAL' } },
      );

      const errRes = await app.request(
        `/api/projects/${emptyProj.id}/steps/business-model/confirm`,
        {
          method: 'POST',
          headers: { 'x-onto-locale': 'en-US' },
        },
      );
      expect(errRes.status).toBe(409);
      const errJson = (await errRes.json()) as {
        code: string;
        errorCount: number;
        error: string;
        messageZh: string;
        messageEn: string;
      };
      expect(errJson.code).toBe('CONSISTENCY_ERRORS_PRESENT');
      expect(errJson.errorCount).toBeGreaterThan(0);
      expect(checkBusinessViewMarkup(errJson.messageZh, { plainText: true })).toEqual([]);
      expect(checkBusinessViewMarkup(errJson.messageEn, { plainText: true })).toEqual([]);
    } finally {
      store.close();
    }
  });

  it('allows confirming when errorCount === 0 even with Stage Warnings, freezes suiteSnapshot across later edits, cascades OUTDATED on Prototype re-confirmation, and gates Confirm-as-is on errorCount === 0', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    try {
      const app = createApiApp(store);

      const proj = store.createProject({
        name: '设备维保工单系统',
        code: 'EQUIP-MAINT',
        domain: '工厂设备维保',
        template: 'EMPTY',
      });
      const reqDoc = store.saveRequirementDoc({
        id: 'rdoc-maint-1',
        projectId: proj.id,
        title: '设备维保需求文档',
        version: 'v1.0',
        status: 'DRAFT',
        content: '# 设备维保需求\n\n## 1. 业务目标\n管理设备报修与维保验收。',
      });
      store.confirmRequirementsStep(proj.id, { docId: reqDoc.id });

      const protoCreated = store.createPrototype(proj.id, {
        name: '设备维保原型',
        htmlContent:
          '<section data-screen-id="SCR-WO-LIST" data-screen-name="维保工单列表" data-screen-type="LIST"><input data-element-id="EL-WO-NO" data-element-type="INPUT" data-element-label="工单编号" data-binding="WorkOrder.orderNo" /></section>',
        source: 'GENERATED',
      });

      // Populate only M1 + MU (so errorCount === 0, while warningCount === 9 Stage Warnings!)
      const partialSuite: OntologySuite = {
        M1: {
          model_type: 'OBJECT',
          domain: proj.domain,
          version: '1.0.0',
          aggregates: [
            {
              id: 'AGG-01',
              name: 'WorkOrder',
              alias: '维保工单',
              aggregateType: 'AGGREGATE_ROOT',
              description: '设备报修与维保记录',
              lifecycle: ['DRAFT', 'COMPLETED'],
              tags: [],
              attributes: [
                {
                  name: 'orderNo',
                  label: '工单编号',
                  type: 'String',
                  required: true,
                  refRules: [],
                },
              ],
              entities: [],
              valueObjects: [],
              invariants: [],
            },
          ],
          data_dictionaries: [],
          aggregate_associations: [],
        },
      };
      store.commitSuite(proj.id, partialSuite, { source: { kind: 'MANUAL' } });
      const protoConf1 = store.confirmPrototypeRevision(proj.id, protoCreated.revision.id);

      const currentAfterProto = store.getProject(proj.id)!;
      expect(currentAfterProto.validation.errorCount).toBe(0);
      expect(currentAfterProto.validation.warningCount).toBeGreaterThan(0);

      // 1. Confirm Business Model succeeds despite non-blocking Stage Warnings!
      const confirmRes1 = await app.request(
        `/api/projects/${proj.id}/steps/business-model/confirm`,
        { method: 'POST' },
      );
      expect(confirmRes1.status).toBe(200);
      const confirmJson1 = (await confirmRes1.json()) as {
        confirmation: BusinessModelStepConfirmationRecord;
        stepConfirmations: ProjectStepConfirmations;
        steps: ProjectStepStatusView[];
      };
      expect(confirmJson1.confirmation.basedOnConfirmationId).toBe(protoConf1.confirmed.id);
      expect(confirmJson1.confirmation.suiteSnapshot?.M1?.aggregates[0]?.alias).toBe('维保工单');
      expect(confirmJson1.steps.find((s) => s.id === 'BUSINESS_MODEL')?.state).toBe('CONFIRMED');
      expect(confirmJson1.steps.find((s) => s.id === 'DELIVERY')?.state).toBe('IN_PROGRESS');
      expect(confirmJson1.steps.find((s) => s.id === 'DELIVERY')?.blocked).toBeUndefined();

      // 2. Edit suite after confirmation -> transitions to UNCONFIRMED_CHANGES while suiteSnapshot stays frozen!
      const editedSuite = structuredClone(store.getProject(proj.id)!.suite);
      editedSuite.M1!.aggregates[0]!.alias = '特种设备维保工单';
      editedSuite.M1!.aggregates[0]!.attributes.push({
        name: 'technicianName',
        label: '维修工程师',
        type: 'String',
        required: false,
        refRules: [],
      });
      await app.request(`/api/projects/${proj.id}/suite`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suite: editedSuite, note: '补充维修工程师字段' }),
      });

      const statusAfterEdit = (await (
        await app.request(`/api/projects/${proj.id}/step-confirmations`)
      ).json()) as {
        stepConfirmations: ProjectStepConfirmations;
        steps: ProjectStepStatusView[];
      };
      expect(statusAfterEdit.steps.find((s) => s.id === 'BUSINESS_MODEL')?.state).toBe(
        'UNCONFIRMED_CHANGES',
      );
      expect(
        statusAfterEdit.stepConfirmations.businessModel?.suiteSnapshot?.M1?.aggregates[0]?.alias,
      ).toBe('维保工单');
      expect(
        statusAfterEdit.stepConfirmations.businessModel?.suiteSnapshot?.M1?.aggregates[0]
          ?.attributes,
      ).toHaveLength(1);

      // 3. Append & confirm a new Prototype revision -> Business Model becomes OUTDATED while keeping existing suite intact!
      const protoRev2 = store.appendPrototypeRevision(protoCreated.prototype.id, {
        htmlContent:
          '<section data-screen-id="SCR-WO-LIST" data-screen-name="维保工单列表（含优先级）" data-screen-type="LIST"><input data-element-id="EL-WO-NO" data-element-type="INPUT" data-element-label="工单编号" data-binding="WorkOrder.orderNo" /></section>',
        title: '调整列表标题',
      });
      const confirmProto2Res = await app.request(
        `/api/projects/${proj.id}/prototypes/confirm-revision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revisionId: protoRev2.revision.id }),
        },
      );
      expect(confirmProto2Res.status).toBe(200);
      const protoConf2Id = store.getProjectStepConfirmations(proj.id).prototype!.id;
      expect(protoConf2Id).not.toBe(protoConf1.confirmed.id);

      const outdatedStatus = (await (
        await app.request(`/api/projects/${proj.id}/step-confirmations`)
      ).json()) as { steps: ProjectStepStatusView[] };
      expect(outdatedStatus.steps.find((s) => s.id === 'BUSINESS_MODEL')?.state).toBe('OUTDATED');
      // Existing Business Model manual edits are preserved 100%!
      expect(store.getProject(proj.id)!.suite.M1?.aggregates[0]?.alias).toBe('特种设备维保工单');

      // 4. Introduce a Consistency Error while OUTDATED -> "Confirm as is" MUST still be rejected!
      const brokenSuite = structuredClone(store.getProject(proj.id)!.suite);
      brokenSuite.M2 = {
        model_type: 'BEHAVIOR',
        domain: proj.domain,
        version: '1.0.0',
        behaviors: [
          {
            id: 'BHV-01',
            name: 'closeWorkOrder',
            alias: '完工结案',
            ownerEntity: 'NonExistentEntity',
            behaviorType: 'COMMAND',
            triggerType: 'SYSTEM',
            inputParameters: [],
            outputParameters: [],
            preconditions: [],
            stateChanges: [],
            invokedRules: [],
            producedEvents: [],
            requiredPermissions: [],
          },
        ],
      };
      store.commitSuite(proj.id, brokenSuite, { source: { kind: 'MANUAL' } });
      expect(store.getProject(proj.id)!.validation.errorCount).toBeGreaterThan(0);

      const confirmAsIsBlockedRes = await app.request(
        `/api/projects/${proj.id}/steps/business-model/confirm`,
        { method: 'POST' },
      );
      expect(confirmAsIsBlockedRes.status).toBe(409);
      const confirmAsIsBlockedJson = (await confirmAsIsBlockedRes.json()) as { code: string };
      expect(confirmAsIsBlockedJson.code).toBe('CONSISTENCY_ERRORS_PRESENT');

      // 5. Fix the error -> "Confirm as is" succeeds and updates basedOnConfirmationId to protoConf2Id!
      const fixedSuite = structuredClone(store.getProject(proj.id)!.suite);
      fixedSuite.M2!.behaviors[0]!.ownerEntity = 'WorkOrder';
      store.commitSuite(proj.id, fixedSuite, { source: { kind: 'MANUAL' } });
      expect(store.getProject(proj.id)!.validation.errorCount).toBe(0);

      const confirmAsIsOkRes = await app.request(
        `/api/projects/${proj.id}/steps/business-model/confirm`,
        { method: 'POST' },
      );
      expect(confirmAsIsOkRes.status).toBe(200);
      const confirmAsIsOkJson = (await confirmAsIsOkRes.json()) as {
        confirmation: BusinessModelStepConfirmationRecord;
        steps: ProjectStepStatusView[];
      };
      expect(confirmAsIsOkJson.confirmation.id).not.toBe(confirmJson1.confirmation.id);
      expect(confirmAsIsOkJson.confirmation.basedOnConfirmationId).toBe(protoConf2Id);
      expect(confirmAsIsOkJson.confirmation.suiteSnapshot?.M1?.aggregates[0]?.alias).toBe(
        '特种设备维保工单',
      );
      expect(confirmAsIsOkJson.steps.find((s) => s.id === 'BUSINESS_MODEL')?.state).toBe(
        'CONFIRMED',
      );
    } finally {
      store.close();
    }
  });

  it('reads ONLY the Confirmed Prototype Revision during synthesize_ontology_suite and refuses unconfirmed drafts or mismatched revisionIds (ADR 0010)', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    try {
      const app = createApiApp(store);

      const proj = store.createProject({
        name: '供应商样品寄送系统',
        code: 'SAMPLE-SHIP',
        domain: '采购样品管理',
        template: 'EMPTY',
      });
      const reqDoc = store.saveRequirementDoc({
        id: 'rdoc-sample-1',
        projectId: proj.id,
        title: '样品寄送需求文档',
        version: 'v1.0',
        status: 'DRAFT',
        content: '# 样品寄送需求\n\n## 1. 业务目标\n管理供应商寄样单与质检结论。',
      });
      store.confirmRequirementsStep(proj.id, { docId: reqDoc.id });

      // Create an UNCONFIRMED draft prototype R1
      const proto = store.createPrototype(proj.id, {
        name: '样品寄送原型',
        htmlContent:
          '<section data-screen-id="SCR-SMP-LIST" data-screen-name="寄样单列表" data-screen-type="LIST"><input data-element-id="EL-SMP-NO" data-element-type="INPUT" data-element-label="寄样单号" data-binding="SampleOrder.sampleNo" /></section>',
        source: 'GENERATED',
      });

      const copilotSess = store.createAgentSession({
        projectId: proj.id,
        agentKind: 'COPILOT',
        title: '业务模型整理会话',
      });

      // 1. Before confirming Prototype, synthesize_ontology_suite refuses and leaves suite empty!
      await (
        await app.request(`/api/agent-sessions/${copilotSess.id}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: '[ACTION:SYNTHESIZE_ONTOLOGY_SUITE {}]\n整理业务模型',
            mockMode: true,
          }),
        })
      ).text();
      expect(store.getProject(proj.id)!.validation.presentModels).toHaveLength(0);

      // 2. Confirm R1, then append an UNCONFIRMED draft R2 containing DraftSecretField99
      store.confirmPrototypeRevision(proj.id, proto.revision.id);
      const draftR2 = store.appendPrototypeRevision(proto.prototype.id, {
        htmlContent:
          '<section data-screen-id="SCR-SMP-LIST" data-screen-name="寄样单列表" data-screen-type="LIST"><input data-element-id="EL-SMP-NO" data-element-type="INPUT" data-element-label="寄样单号" data-binding="SampleOrder.sampleNo" /><input data-element-id="EL-SECRET" data-element-type="INPUT" data-element-label="草稿实验字段" data-binding="SampleOrder.draftSecretField99" /></section>',
        title: '未确认草稿实验',
      });

      // Synthesize must read ONLY confirmed R1 ("sampleNo"), ignoring unconfirmed R2 ("draftSecretField99")!
      await (
        await app.request(`/api/agent-sessions/${copilotSess.id}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: '[ACTION:SYNTHESIZE_ONTOLOGY_SUITE {}]\n整理业务模型',
            mockMode: true,
          }),
        })
      ).text();

      const afterR1Synth = store.getProject(proj.id)!;
      expect(afterR1Synth.validation.presentModels).toHaveLength(11);
      expect(afterR1Synth.validation.errorCount).toBe(0);
      const sampleAgg1 = afterR1Synth.suite.M1?.aggregates.find((a) => a.name === 'SampleOrder');
      expect(sampleAgg1?.attributes.map((a) => a.name)).toContain('sampleNo');
      expect(sampleAgg1?.attributes.map((a) => a.name)).not.toContain('draftSecretField99');

      // 3. Explicitly requesting unconfirmed revisionId is also rejected!
      await (
        await app.request(`/api/agent-sessions/${copilotSess.id}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: `[ACTION:SYNTHESIZE_ONTOLOGY_SUITE {"revisionId":"${draftR2.revision.id}"}]\n尝试从草稿修订合成`,
            mockMode: true,
          }),
        })
      ).text();
      const latestAssistantAfterReject = [...store.getAgentSession(copilotSess.id)!.messages]
        .reverse()
        .find((m) => m.role === 'assistant');
      const rejectedTrace = latestAssistantAfterReject?.toolCalls?.find(
        (tc) => tc.toolName === 'synthesize_ontology_suite',
      );
      expect(rejectedTrace?.isError).toBe(true);
      expect(
        store
          .getProject(proj.id)!
          .suite.M1?.aggregates.find((a) => a.name === 'SampleOrder')
          ?.attributes.map((a) => a.name),
      ).not.toContain('draftSecretField99');

      // 4. Confirm R2 -> now synthesize_ontology_suite ("mode":"update") reads confirmed R2 and aligns draftSecretField99 into M1!
      store.confirmPrototypeRevision(proj.id, draftR2.revision.id);
      await (
        await app.request(`/api/agent-sessions/${copilotSess.id}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: '[ACTION:SYNTHESIZE_ONTOLOGY_SUITE {"mode":"update"}]\n根据最新已确认的原型更新业务模型',
            mockMode: true,
          }),
        })
      ).text();

      const afterR2Update = store.getProject(proj.id)!;
      expect(afterR2Update.validation.errorCount).toBe(0);
      expect(
        afterR2Update.suite.M1?.aggregates
          .find((a) => a.name === 'SampleOrder')
          ?.attributes.map((a) => a.name),
      ).toContain('draftSecretField99');
    } finally {
      store.close();
    }
  });

  it('repairs Consistency Errors in Mock LLM mode when synthesize_ontology_suite runs with mode="fix_problems"', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    try {
      const app = createApiApp(store);
      const cloned = store.cloneProject('proj-contract', {
        name: '修复一致性问题测试工程',
        code: 'FIX-ERR-71',
      });

      // Introduce a dangling ownerEntity error on M2 behavior BHV-01
      const broken = structuredClone(cloned.suite);
      broken.M2!.behaviors[0]!.ownerEntity = 'DeletedGhostAggregate';
      store.commitSuite(cloned.id, broken, { source: { kind: 'MANUAL' } });
      expect(store.getProject(cloned.id)!.validation.errorCount).toBeGreaterThan(0);

      const copilotSess = store.createAgentSession({
        projectId: cloned.id,
        agentKind: 'COPILOT',
        title: '修复业务模型问题',
      });

      await (
        await app.request(`/api/agent-sessions/${copilotSess.id}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt:
              '[ACTION:SYNTHESIZE_ONTOLOGY_SUITE {"mode":"fix_problems"}]\n请修复业务模型中需要修正的问题',
            mockMode: true,
          }),
        })
      ).text();

      const repaired = store.getProject(cloned.id)!;
      expect(repaired.validation.errorCount).toBe(0);
      const historyEntries = store.listArtifactHistoryViews(cloned.id, {
        artifactKind: 'ONTOLOGY_SUITE',
      });
      expect(historyEntries.length).toBeGreaterThanOrEqual(2);
      expect(historyEntries[0]?.source.kind).toBe('AGENT_RUN');
    } finally {
      store.close();
    }
  });
});
