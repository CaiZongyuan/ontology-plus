import { describe, expect, it } from 'vitest';
import {
  BusinessModelConfirmError,
  RequirementsConfirmError,
  computeOntologySuiteHash,
  computeStepContentHash,
  createWorkspaceStore,
} from '../index.js';

describe('workspace-store: unified StepConfirmationRecord across Requirements, Prototype, and Business Model', () => {
  it('seeds aligned step confirmations on proj-contract and leaves proj-mft unconfirmed', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    try {
      const contractConfirmations = store.getProjectStepConfirmations('proj-contract');
      expect(contractConfirmations.requirements).toBeTruthy();
      expect(contractConfirmations.requirements?.step).toBe('REQUIREMENTS');
      expect(contractConfirmations.requirements?.basedOnConfirmationId).toBeNull();
      expect(contractConfirmations.requirements?.docId).toBe('req-doc-contract-srs');
      expect(contractConfirmations.requirements?.content.length).toBeGreaterThan(50);

      expect(contractConfirmations.prototype).toBeTruthy();
      expect(contractConfirmations.prototype?.step).toBe('PROTOTYPE');
      expect(contractConfirmations.prototype?.basedOnConfirmationId).toBe(
        contractConfirmations.requirements?.id,
      );
      expect(store.getConfirmedPrototypeRevision('proj-contract')?.basedOnConfirmationId).toBe(
        contractConfirmations.requirements?.id,
      );

      expect(contractConfirmations.businessModel).toBeTruthy();
      expect(contractConfirmations.businessModel?.step).toBe('BUSINESS_MODEL');
      expect(contractConfirmations.businessModel?.basedOnConfirmationId).toBe(
        contractConfirmations.prototype?.id,
      );
      expect(contractConfirmations.businessModel?.suiteHash).toBe(
        computeOntologySuiteHash(store.getProject('proj-contract')!.suite),
      );

      const mftConfirmations = store.getProjectStepConfirmations('proj-mft');
      expect(mftConfirmations).toEqual({
        requirements: null,
        prototype: null,
        businessModel: null,
      });
    } finally {
      store.close();
    }
  });

  it('confirms Requirements snapshot, preserves confirmed snapshot across draft edits, links upstream confirmation IDs down the chain, and rejects invalid confirmations', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    try {
      const proj = store.createProject({
        name: '门店采购验收系统',
        code: 'STORE-PROC',
        domain: '零售门店采购',
        template: 'EMPTY',
      });

      // Confirming Requirements with no requirement doc throws RequirementsConfirmError
      expect(() => store.confirmRequirementsStep(proj.id)).toThrow(RequirementsConfirmError);

      // Save a draft doc -> NOT confirmed until explicit confirmRequirementsStep
      const draftDoc = store.saveRequirementDoc({
        id: 'rdoc-1',
        projectId: proj.id,
        title: '门店采购需求文档',
        version: 'v1.0',
        status: 'DRAFT',
        content: '# 门店采购需求\n\n## 1. 业务目标\n- 支持门店发起采购申请并由店长审批。',
      });
      expect(store.getProjectStepConfirmations(proj.id).requirements).toBeNull();

      // Explicitly confirm Requirements
      const reqConfirm1 = store.confirmRequirementsStep(proj.id, { docId: draftDoc.id });
      expect(reqConfirm1.doc.status).toBe('CONFIRMED');
      expect(reqConfirm1.confirmation.step).toBe('REQUIREMENTS');
      expect(reqConfirm1.confirmation.basedOnConfirmationId).toBeNull();
      expect(reqConfirm1.confirmation.content).toBe(draftDoc.content);
      expect(reqConfirm1.confirmation.contentHash).toBe(computeStepContentHash(draftDoc.content));

      // Edit the requirement doc afterwards -> confirmed snapshot remains frozen at v1 content
      const editedContent =
        '# 门店采购需求\n\n## 1. 业务目标\n- 支持门店发起采购申请并增加区域总监大额复核。';
      store.saveRequirementDoc({
        id: draftDoc.id,
        projectId: proj.id,
        title: '门店采购需求文档',
        version: 'v1.1',
        status: 'DRAFT',
        content: editedContent,
      });
      const stillV1 = store.getProjectStepConfirmations(proj.id).requirements!;
      expect(stillV1.id).toBe(reqConfirm1.confirmation.id);
      expect(stillV1.content).toContain('店长审批');
      expect(stillV1.content).not.toContain('区域总监大额复核');

      // Create & confirm a Prototype revision -> records basedOnConfirmationId = reqConfirm1.confirmation.id
      const createdProto = store.createPrototype(proj.id, {
        name: '门店采购原型',
        htmlContent:
          '<section data-screen-id="SCR-PO-LIST" data-screen-name="采购单列表" data-screen-type="LIST"><button data-element-id="EL-NEW-PO" data-element-type="BUTTON">新建采购单</button></section>',
        source: 'GENERATED',
      });
      const protoConfirm1 = store.confirmPrototypeRevision(proj.id, createdProto.revision.id);
      expect(protoConfirm1.confirmed.id).toBeTruthy();
      expect(protoConfirm1.confirmed.basedOnConfirmationId).toBe(reqConfirm1.confirmation.id);
      expect(store.getProjectStepConfirmations(proj.id).prototype?.basedOnConfirmationId).toBe(
        reqConfirm1.confirmation.id,
      );

      // Business model confirmation rejects when consistency errors exist, succeeds when clean
      store.commitSuite(
        proj.id,
        {
          M1: {
            model_type: 'OBJECT',
            domain: proj.domain,
            version: '1.0.0',
            aggregates: [
              {
                id: 'AGG-01',
                name: 'PurchaseOrder',
                alias: '采购单',
                aggregateType: 'AGGREGATE_ROOT',
                description: '门店采购单',
                lifecycle: ['DRAFT', 'APPROVED'],
                tags: [],
                attributes: [
                  {
                    name: 'orderNo',
                    label: '采购单号',
                    type: 'DictionaryRef',
                    dictionaryRef: { dictionaryId: 'DICT-MISSING-99', typeCode: 'MISSING' },
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
      expect(store.getProject(proj.id)!.validation.errorCount).toBeGreaterThan(0);
      expect(() => store.confirmBusinessModelStep(proj.id)).toThrow(BusinessModelConfirmError);

      // Fix consistency error and confirm Business Model -> basedOnConfirmationId = protoConfirm1.confirmed.id
      store.commitSuite(
        proj.id,
        {
          ...store.getProject(proj.id)!.suite,
          M1: {
            ...store.getProject(proj.id)!.suite.M1!,
            aggregates: [
              {
                ...store.getProject(proj.id)!.suite.M1!.aggregates[0]!,
                attributes: [
                  {
                    name: 'orderNo',
                    label: '采购单号',
                    type: 'String',
                    required: true,
                    refRules: [],
                  },
                ],
              },
            ],
          },
        },
        { source: { kind: 'MANUAL' } },
      );
      expect(store.getProject(proj.id)!.validation.errorCount).toBe(0);
      const modelConfirm1 = store.confirmBusinessModelStep(proj.id);
      expect(modelConfirm1.confirmation.basedOnConfirmationId).toBe(protoConfirm1.confirmed.id);

      // Re-confirming Requirements creates a NEW confirmation ID; Prototype still points to reqConfirm1, Business Model still points to protoConfirm1
      const reqConfirm2 = store.confirmRequirementsStep(proj.id, { docId: draftDoc.id });
      expect(reqConfirm2.confirmation.id).not.toBe(reqConfirm1.confirmation.id);
      expect(reqConfirm2.confirmation.content).toContain('区域总监大额复核');
      const allConfirmations = store.getProjectStepConfirmations(proj.id);
      expect(allConfirmations.requirements?.id).toBe(reqConfirm2.confirmation.id);
      expect(allConfirmations.prototype?.basedOnConfirmationId).toBe(reqConfirm1.confirmation.id);
      expect(allConfirmations.businessModel?.basedOnConfirmationId).toBe(protoConfirm1.confirmed.id);
      expect(store.listStepConfirmations(proj.id, 'REQUIREMENTS')).toHaveLength(2);
    } finally {
      store.close();
    }
  });
});
