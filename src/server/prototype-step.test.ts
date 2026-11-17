import { describe, expect, it } from 'vitest';
import { checkBusinessViewMarkup } from '../packages/business-vocabulary/index.js';
import {
  createWorkspaceStore,
  type ConfirmedPrototypeRevision,
  type InteractivePrototype,
  type ProjectStepConfirmations,
  type PrototypeStepConfirmationRecord,
} from '../packages/workspace-store/index.js';
import type { ProjectStepStatusView } from '../web/navigation/projectSteps.js';
import { createApiApp } from './app.js';

describe('server HTTP: Prototype step confirmations, OUTDATED preservation, confirm-as-is, and AI Assistant update (#66)', () => {
  it('returns 409 with clean business language when confirming Prototype step before any prototype exists', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    try {
      const app = createApiApp(store);
      const proj = store.createProject({
        name: '设备巡检系统',
        code: 'EQUIP-INSP',
        domain: '工业设备巡检',
        template: 'EMPTY',
      });

      const zhRes = await app.request(`/api/projects/${proj.id}/steps/prototype/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-onto-locale': 'zh-CN' },
        body: JSON.stringify({}),
      });
      expect(zhRes.status).toBe(409);
      const zhJson = (await zhRes.json()) as { code: string; error: string };
      expect(zhJson.code).toBe('PROTOTYPE_MISSING');
      expect(checkBusinessViewMarkup(zhJson.error, { plainText: true })).toEqual([]);

      const enRes = await app.request(`/api/projects/${proj.id}/steps/prototype/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-onto-locale': 'en-US' },
        body: JSON.stringify({}),
      });
      expect(enRes.status).toBe(409);
      const enJson = (await enRes.json()) as { code: string; error: string };
      expect(enJson.code).toBe('PROTOTYPE_MISSING');
      expect(checkBusinessViewMarkup(enJson.error, { plainText: true })).toEqual([]);
    } finally {
      store.close();
    }
  });

  it('preserves prototype HTML, revisions, and Design Brief intact when Requirements is re-confirmed (marking Prototype OUTDATED only), and supports Confirm-as-is to clear OUTDATED and cascade to Business Model', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    try {
      const app = createApiApp(store);

      // 1. Seeded proj-contract starts with Requirements, Prototype, and Business Model all CONFIRMED
      const initialStatus = (await (
        await app.request('/api/projects/proj-contract/step-confirmations')
      ).json()) as {
        stepConfirmations: ProjectStepConfirmations;
        steps: ProjectStepStatusView[];
      };
      const reqConf1 = initialStatus.stepConfirmations.requirements!;
      const protoConf1 = initialStatus.stepConfirmations.prototype!;
      const modelConf1 = initialStatus.stepConfirmations.businessModel!;
      expect(reqConf1).toBeTruthy();
      expect(protoConf1.basedOnConfirmationId).toBe(reqConf1.id);
      expect(modelConf1.basedOnConfirmationId).toBe(protoConf1.id);
      expect(initialStatus.steps.slice(0, 3).map((s) => s.state)).toEqual([
        'CONFIRMED',
        'CONFIRMED',
        'CONFIRMED',
      ]);

      const beforeProtos = store.listPrototypes('proj-contract');
      expect(beforeProtos.length).toBeGreaterThanOrEqual(1);
      const activeProtoBefore = beforeProtos.find((p) => p.id === protoConf1.prototypeId)!;
      const htmlBefore = activeProtoBefore.htmlContent;
      const revisionsCountBefore = activeProtoBefore.revisions.length;

      // 2. Edit & re-confirm Requirements -> Prototype becomes OUTDATED; prototype HTML & revisions stay 100% intact; Business Model stays CONFIRMED
      const reqDoc = store.listRequirementDocs('proj-contract')[0]!;
      await app.request('/api/requirements/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: reqDoc.id,
          projectId: 'proj-contract',
          title: reqDoc.title,
          version: 'v2.0',
          status: 'DRAFT',
          content: `${reqDoc.content}\n\n## 补充条款\n- 合同盖章后支持登记归档日期与归档编号。`,
        }),
      });

      const reconfirmReqRes = await app.request(
        '/api/projects/proj-contract/steps/requirements/confirm',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ docId: reqDoc.id }),
        },
      );
      expect(reconfirmReqRes.status).toBe(200);
      const reconfirmReqJson = (await reconfirmReqRes.json()) as {
        stepConfirmations: ProjectStepConfirmations;
        steps: ProjectStepStatusView[];
      };
      const reqConf2 = reconfirmReqJson.stepConfirmations.requirements!;
      expect(reqConf2.id).not.toBe(reqConf1.id);

      const protoStepOutdated = reconfirmReqJson.steps.find((s) => s.id === 'PROTOTYPE')!;
      const modelStepStillConfirmed = reconfirmReqJson.steps.find(
        (s) => s.id === 'BUSINESS_MODEL',
      )!;
      expect(protoStepOutdated.state).toBe('OUTDATED');
      expect(protoStepOutdated.statusSummary.zh).toBe(
        '需求有了新的确认；原型更新确认后，业务模型也会提示更新。',
      );
      expect(checkBusinessViewMarkup(protoStepOutdated.statusSummary.zh, { plainText: true })).toEqual([]);
      expect(checkBusinessViewMarkup(protoStepOutdated.statusSummary.en, { plainText: true })).toEqual([]);
      expect(modelStepStillConfirmed.state).toBe('CONFIRMED');

      // Downstream prototype HTML and revision history were NOT wiped or auto-rewritten
      const afterReqProtos = store.listPrototypes('proj-contract');
      const activeProtoDuringOutdated = afterReqProtos.find((p) => p.id === protoConf1.prototypeId)!;
      expect(activeProtoDuringOutdated.htmlContent).toBe(htmlBefore);
      expect(activeProtoDuringOutdated.revisions).toHaveLength(revisionsCountBefore);

      // 3. "不需要改动，按现状确认" via POST /api/projects/:id/steps/prototype/confirm (without changing prototype HTML!)
      const confirmAsIsRes = await app.request(
        '/api/projects/proj-contract/steps/prototype/confirm',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      expect(confirmAsIsRes.status).toBe(200);
      const confirmAsIsJson = (await confirmAsIsRes.json()) as {
        confirmation: PrototypeStepConfirmationRecord;
        confirmedRevision: ConfirmedPrototypeRevision;
        prototype: InteractivePrototype;
        stepConfirmations: ProjectStepConfirmations;
        steps: ProjectStepStatusView[];
      };

      expect(confirmAsIsJson.confirmation.id).not.toBe(protoConf1.id);
      expect(confirmAsIsJson.confirmation.revisionId).toBe(protoConf1.revisionId);
      expect(confirmAsIsJson.confirmation.basedOnConfirmationId).toBe(reqConf2.id);
      expect(confirmAsIsJson.prototype.htmlContent).toBe(htmlBefore);

      // PROTOTYPE is now CONFIRMED, and BUSINESS_MODEL now cascades to OUTDATED!
      expect(confirmAsIsJson.steps.find((s) => s.id === 'PROTOTYPE')?.state).toBe('CONFIRMED');
      expect(confirmAsIsJson.steps.find((s) => s.id === 'BUSINESS_MODEL')?.state).toBe('OUTDATED');

      // Step confirmations history retains both prototype confirmation records
      const protoHistory = store.listStepConfirmations('proj-contract', 'PROTOTYPE');
      expect(protoHistory.length).toBeGreaterThanOrEqual(2);
    } finally {
      store.close();
    }
  });

  it('supports "让 AI 助手更新" as a normal PROTOTYPE_CO_DESIGN run appending a new revision, then confirming it to clear OUTDATED', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    try {
      const app = createApiApp(store);

      // Re-confirm Requirements on proj-contract so Prototype enters OUTDATED
      const reqDoc = store.listRequirementDocs('proj-contract')[0]!;
      await app.request('/api/requirements/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: reqDoc.id,
          projectId: 'proj-contract',
          title: reqDoc.title,
          version: 'v2.1',
          status: 'DRAFT',
          content: `${reqDoc.content}\n\n## 新增筛选\n- 合同列表支持按归档状态筛选。`,
        }),
      });
      const reqConfRes = await app.request(
        '/api/projects/proj-contract/steps/requirements/confirm',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ docId: reqDoc.id }),
        },
      );
      const { stepConfirmations: afterReqConfs } = (await reqConfRes.json()) as {
        stepConfirmations: ProjectStepConfirmations;
      };
      const latestReqConfId = afterReqConfs.requirements!.id;

      const protoBefore = store.listPrototypes('proj-contract')[0]!;
      const ensureSessRes = await app.request(
        `/api/projects/proj-contract/prototypes/${protoBefore.id}/co-design-session`,
        { method: 'POST' },
      );
      expect(ensureSessRes.status).toBe(200);
      const { session } = (await ensureSessRes.json()) as { session: { id: string } };

      // Run AI Assistant update in PROTOTYPE_CO_DESIGN session
      await (
        await app.request(`/api/agent-sessions/${session.id}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: '根据最新确认的需求文档补充归档状态筛选栏',
            mockMode: true,
          }),
        })
      ).text();

      const protoAfterUpdate = store.getPrototype(protoBefore.id)!;
      expect(protoAfterUpdate.revisions.length).toBe(protoBefore.revisions.length + 1);
      expect(protoAfterUpdate.currentRevisionId).not.toBe(protoBefore.currentRevisionId);

      // Confirm the updated revision via POST /api/projects/:id/prototypes/confirm-revision
      const confirmUpdatedRes = await app.request(
        '/api/projects/proj-contract/prototypes/confirm-revision',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revisionId: protoAfterUpdate.currentRevisionId }),
        },
      );
      expect(confirmUpdatedRes.status).toBe(200);
      const confirmUpdatedJson = (await confirmUpdatedRes.json()) as {
        stepConfirmations: ProjectStepConfirmations;
        steps: ProjectStepStatusView[];
      };
      expect(confirmUpdatedJson.stepConfirmations.prototype?.revisionId).toBe(
        protoAfterUpdate.currentRevisionId,
      );
      expect(confirmUpdatedJson.stepConfirmations.prototype?.basedOnConfirmationId).toBe(
        latestReqConfId,
      );
      expect(confirmUpdatedJson.steps.find((s) => s.id === 'PROTOTYPE')?.state).toBe('CONFIRMED');
      expect(confirmUpdatedJson.steps.find((s) => s.id === 'BUSINESS_MODEL')?.state).toBe(
        'OUTDATED',
      );
    } finally {
      store.close();
    }
  });
});
