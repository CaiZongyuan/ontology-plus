import { describe, expect, it } from 'vitest';
import { checkBusinessViewMarkup } from '../packages/business-vocabulary/index.js';
import {
  createWorkspaceStore,
  type ProjectStepConfirmations,
  type ProjectStepStatusView,
  type RequirementDoc,
  type RequirementsStepConfirmationRecord,
} from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';

describe('server HTTP: step confirmations, confirmed-requirements prototype gate, and cascading OUTDATED (#64)', () => {
  it('exposes seeded stepConfirmations on /api/bootstrap for proj-contract and empty confirmations for proj-mft', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    try {
      const app = createApiApp(store);

      const contractRes = await app.request('/api/bootstrap?projectId=proj-contract');
      expect(contractRes.status).toBe(200);
      const contractJson = (await contractRes.json()) as {
        stepConfirmations: ProjectStepConfirmations;
      };
      expect(contractJson.stepConfirmations.requirements?.docId).toBe('req-doc-contract-srs');
      expect(contractJson.stepConfirmations.prototype?.basedOnConfirmationId).toBe(
        contractJson.stepConfirmations.requirements?.id,
      );
      expect(contractJson.stepConfirmations.businessModel?.basedOnConfirmationId).toBe(
        contractJson.stepConfirmations.prototype?.id,
      );

      const mftRes = await app.request('/api/bootstrap?projectId=proj-mft');
      expect(mftRes.status).toBe(200);
      const mftJson = (await mftRes.json()) as {
        stepConfirmations: ProjectStepConfirmations;
      };
      expect(mftJson.stepConfirmations).toEqual({
        requirements: null,
        prototype: null,
        businessModel: null,
      });
    } finally {
      store.close();
    }
  });

  it('does not auto-confirm SRS on synthesis, blocks prototype generation until Requirements is confirmed, reads confirmed snapshot across draft edits, and cascades OUTDATED one step at a time', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    try {
      const app = createApiApp(store);

      // 1. Create a fresh empty project
      const createProjRes = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '冷链车队调度系统',
          code: 'COLD-FLEET',
          domain: '冷链物流调度',
          template: 'EMPTY',
        }),
      });
      expect(createProjRes.status).toBe(200);
      const { project } = (await createProjRes.json()) as { project: { id: string } };

      // 2. Synthesize SRS via REQUIREMENT agent -> must save as DRAFT (NOT auto-confirmed!)
      const createReqSessRes = await app.request('/api/agent-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          agentKind: 'REQUIREMENT',
          title: '冷链需求梳理',
        }),
      });
      const { session: reqSession } = (await createReqSessRes.json()) as {
        session: { id: string };
      };

      await (
        await app.request(`/api/agent-sessions/${reqSession.id}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: '核心业务对象是冷链运单 ColdWaybill，需要记录车厢实时温控与签收验收。',
            mockMode: true,
          }),
        })
      ).text();

      await (
        await app.request(`/api/agent-sessions/${reqSession.id}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: '[ACTION:SYNTHESIZE_SRS {}]\n整理需求规格书',
            mockMode: true,
          }),
        })
      ).text();

      const docsAfterSynth = store.listRequirementDocs(project.id);
      expect(docsAfterSynth).toHaveLength(1);
      expect(docsAfterSynth[0]!.status).toBe('DRAFT');
      expect(store.getProjectStepConfirmations(project.id).requirements).toBeNull();

      // 3. Prototype generation endpoints refuse cleanly before Requirements is confirmed!
      const blockedBriefRes = await app.request(`/api/projects/${project.id}/design-brief-assist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'decide', mockMode: true }),
      });
      expect(blockedBriefRes.status).toBe(409);
      const blockedBriefJson = (await blockedBriefRes.json()) as { code: string; error: string };
      expect(blockedBriefJson.code).toBe('REQUIREMENTS_NOT_CONFIRMED');
      expect(checkBusinessViewMarkup(blockedBriefJson.error, { plainText: true })).toEqual([]);

      const blockedProtoSessionRes = await app.request(
        `/api/projects/${project.id}/prototype-co-design-sessions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: '未确认需求时尝试生成原型' }),
        },
      );
      expect(blockedProtoSessionRes.status).toBe(409);

      // Even direct PROTOTYPE_CO_DESIGN session streaming refuses to generate a prototype when Requirements is unconfirmed
      const directProtoSess = store.createAgentSession({
        projectId: project.id,
        agentKind: 'PROTOTYPE_CO_DESIGN',
        title: '直接会话测试',
      });
      await (
        await app.request(`/api/agent-sessions/${directProtoSess.id}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: '生成冷链运单原型',
            mockMode: true,
          }),
        })
      ).text();
      expect(store.listPrototypes(project.id)).toHaveLength(0);

      // 4. Write clean business doc & confirm Requirements via POST /api/projects/:id/steps/requirements/confirm
      const saveCleanDocRes = await app.request('/api/requirements/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: docsAfterSynth[0]!.id,
          projectId: project.id,
          title: '冷链车队调度需求文档',
          version: 'v1.0',
          status: 'DRAFT',
          content:
            '# 冷链车队调度需求文档\n\n## 1. 业务目标\n围绕**冷链运单**（ColdWaybill）管理发车温控与到站签收。',
        }),
      });
      expect(saveCleanDocRes.status).toBe(200);
      expect(store.getProjectStepConfirmations(project.id).requirements).toBeNull();

      const confirmReq1Res = await app.request(
        `/api/projects/${project.id}/steps/requirements/confirm`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ docId: docsAfterSynth[0]!.id }),
        },
      );
      expect(confirmReq1Res.status).toBe(200);
      const confirmReq1Json = (await confirmReq1Res.json()) as {
        confirmation: RequirementsStepConfirmationRecord;
        doc: RequirementDoc;
        stepConfirmations: ProjectStepConfirmations;
        steps: ProjectStepStatusView[];
      };
      expect(confirmReq1Json.doc.status).toBe('CONFIRMED');
      expect(confirmReq1Json.confirmation.step).toBe('REQUIREMENTS');
      expect(confirmReq1Json.steps[0]!.state).toBe('CONFIRMED');
      expect(confirmReq1Json.steps[1]!.state).toBe('NOT_STARTED');
      expect(confirmReq1Json.steps[1]!.blocked).toBeUndefined();

      // 5. Edit requirement doc AFTER confirmation -> step becomes UNCONFIRMED_CHANGES, while downstream still reads confirmed snapshot!
      await app.request('/api/requirements/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: docsAfterSynth[0]!.id,
          projectId: project.id,
          title: '冷链车队调度需求文档',
          version: 'v1.1',
          status: 'DRAFT',
          content:
            '# 冷链车队调度需求文档\n\n## 1. 业务目标\n临时草稿：围绕**未确认神秘实体DraftOnlyEntity99**测试草稿隔离。',
        }),
      });

      const statusAfterEditRes = await app.request(
        `/api/projects/${project.id}/step-confirmations`,
      );
      expect(statusAfterEditRes.status).toBe(200);
      const statusAfterEditJson = (await statusAfterEditRes.json()) as {
        stepConfirmations: ProjectStepConfirmations;
        steps: ProjectStepStatusView[];
      };
      expect(statusAfterEditJson.steps[0]!.state).toBe('UNCONFIRMED_CHANGES');
      expect(statusAfterEditJson.stepConfirmations.requirements?.content).toContain('冷链运单');
      expect(statusAfterEditJson.stepConfirmations.requirements?.content).not.toContain(
        'DraftOnlyEntity99',
      );

      // Generate Design Brief & Prototype R1 -> MUST read confirmed snapshot ("冷链运单"), NOT "DraftOnlyEntity99"!
      const briefAssistRes = await app.request(`/api/projects/${project.id}/design-brief-assist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'decide', mockMode: true }),
      });
      expect(briefAssistRes.status).toBe(200);
      const briefAssistJson = (await briefAssistRes.json()) as {
        brief: Record<string, unknown>;
      };
      const briefText = JSON.stringify(briefAssistJson.brief);
      expect(briefText).toContain('冷链运单');
      expect(briefText).not.toContain('DraftOnlyEntity99');

      const createProtoSessRes = await app.request(
        `/api/projects/${project.id}/prototype-co-design-sessions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: '冷链首版原型生成' }),
        },
      );
      expect(createProtoSessRes.status).toBe(200);
      const { session: protoSession } = (await createProtoSessRes.json()) as {
        session: { id: string };
      };
      await (
        await app.request(`/api/agent-sessions/${protoSession.id}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: '请根据已确认需求生成首版响应式原型',
            prototypeName: '冷链运单工作台原型',
            mockMode: true,
          }),
        })
      ).text();

      const generatedProtos = store.listPrototypes(project.id);
      expect(generatedProtos).toHaveLength(1);
      expect(generatedProtos[0]!.htmlContent).toContain('冷链运单');
      expect(generatedProtos[0]!.htmlContent).not.toContain('DraftOnlyEntity99');

      // 6. Confirm Prototype & synthesize + confirm Business Model
      const confirmProto1Res = await app.request(
        `/api/projects/${project.id}/prototypes/confirm-revision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revisionId: generatedProtos[0]!.currentRevisionId }),
        },
      );
      expect(confirmProto1Res.status).toBe(200);

      const copilotSess = store.createAgentSession({
        projectId: project.id,
        agentKind: 'COPILOT',
        title: '业务模型合成',
      });
      await (
        await app.request(`/api/agent-sessions/${copilotSess.id}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: '[ACTION:SYNTHESIZE_ONTOLOGY_SUITE {}]\n根据已确认原型推导业务模型',
            mockMode: true,
          }),
        })
      ).text();

      const confirmModel1Res = await app.request(
        `/api/projects/${project.id}/steps/business-model/confirm`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
      );
      expect(confirmModel1Res.status).toBe(200);

      // 7. Re-confirm Requirements (v1.1) -> Prototype becomes OUTDATED, while Business Model stays CONFIRMED!
      const confirmReq2Res = await app.request(
        `/api/projects/${project.id}/steps/requirements/confirm`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ docId: docsAfterSynth[0]!.id }),
        },
      );
      expect(confirmReq2Res.status).toBe(200);
      const confirmReq2Json = (await confirmReq2Res.json()) as {
        steps: ProjectStepStatusView[];
      };
      expect(confirmReq2Json.steps.map((s) => s.state)).toEqual([
        'CONFIRMED',
        'OUTDATED',
        'CONFIRMED',
        'IN_PROGRESS',
      ]);

      // 8. Re-confirm Prototype as-is -> Prototype becomes CONFIRMED, Business Model now becomes OUTDATED!
      const confirmProto2Res = await app.request(
        `/api/projects/${project.id}/prototypes/confirm-revision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revisionId: generatedProtos[0]!.currentRevisionId }),
        },
      );
      expect(confirmProto2Res.status).toBe(200);

      const afterProtoReconfirm = (await (
        await app.request(`/api/projects/${project.id}/step-confirmations`)
      ).json()) as { steps: ProjectStepStatusView[] };
      expect(afterProtoReconfirm.steps.map((s) => s.state)).toEqual([
        'CONFIRMED',
        'CONFIRMED',
        'OUTDATED',
        'IN_PROGRESS',
      ]);
    } finally {
      store.close();
    }
  });
});
