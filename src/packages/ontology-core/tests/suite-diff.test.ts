import { describe, expect, it } from 'vitest';
import {
  CONTRACT_LIFECYCLE_SUITE,
  MFT_ENTERPRISE_SUITE,
  MODEL_CODES,
  diffOntologySuites,
  parseSuiteFromYamlFiles,
  serializeSuiteToYamlFiles,
  type OntologySuite,
} from '../index.js';

function cloneSuite(suite: OntologySuite): OntologySuite {
  return JSON.parse(JSON.stringify(suite)) as OntologySuite;
}

describe('suite-diff: typed Ontology Suite diff across all 11 models', () => {
  it('returns an empty diff with hasChanges === false for identical, empty, optional-shell, and YAML-roundtripped suites', () => {
    const emptyDiff = diffOntologySuites(undefined, {});
    expect(emptyDiff.hasChanges).toBe(false);
    expect(emptyDiff.changes).toEqual([]);
    expect(emptyDiff.summary).toEqual({
      addedCount: 0,
      removedCount: 0,
      modifiedCount: 0,
      totalChanges: 0,
      changedModels: [],
      hasChanges: false,
    });
    expect(Object.keys(emptyDiff.models)).toEqual(MODEL_CODES);
    for (const code of MODEL_CODES) {
      expect(emptyDiff.models[code]).toEqual({
        modelCode: code,
        added: [],
        removed: [],
        modified: [],
        changes: [],
        summary: {
          addedCount: 0,
          removedCount: 0,
          modifiedCount: 0,
          totalChanges: 0,
          hasChanges: false,
        },
      });
    }

    // Identical empty model shells produce zero changes
    const shellSuite: OntologySuite = {
      M1: {
        model_type: 'OBJECT',
        version: '5.0',
        domain: '测试域',
        aggregates: [],
        data_dictionaries: [],
        aggregate_associations: [],
      },
      M2: { model_type: 'BEHAVIOR', version: '5.0', domain: '测试域', behaviors: [] },
      M4: { model_type: 'SCENARIO', version: '5.0', domain: '测试域', event_scenarios: [] },
      M7: { model_type: 'QUERY_REPORT', version: '5.0', domain: '测试域', query_reports: [] },
      MU: {
        model_type: 'UI',
        version: '5.0',
        domain: '测试域',
        screens: [],
        navigation_edges: [],
        cross_cutting_ui: [],
      },
    };
    expect(diffOntologySuites(shellSuite, cloneSuite(shellSuite)).hasChanges).toBe(false);

    // Benchmark suites against deep clones of themselves
    const contractDiff = diffOntologySuites(
      CONTRACT_LIFECYCLE_SUITE,
      cloneSuite(CONTRACT_LIFECYCLE_SUITE),
    );
    expect(contractDiff.hasChanges).toBe(false);
    expect(contractDiff.changes).toEqual([]);

    const mftDiff = diffOntologySuites(MFT_ENTERPRISE_SUITE, cloneSuite(MFT_ENTERPRISE_SUITE));
    expect(mftDiff.hasChanges).toBe(false);
    expect(mftDiff.changes).toEqual([]);

    // Benchmark suite against YAML roundtrip of itself
    const { suite: roundtrippedContract, parseErrors } = parseSuiteFromYamlFiles(
      serializeSuiteToYamlFiles(CONTRACT_LIFECYCLE_SUITE),
    );
    expect(parseErrors).toEqual([]);
    const roundtripDiff = diffOntologySuites(CONTRACT_LIFECYCLE_SUITE, roundtrippedContract);
    expect(roundtripDiff.hasChanges).toBe(false);
    expect(roundtripDiff.changes).toEqual([]);
  });

  it('detects ADDED and REMOVED elements across all 11 models and all 18 element collections', () => {
    const fullSuite = cloneSuite(CONTRACT_LIFECYCLE_SUITE);
    fullSuite.M5!.permissionGroups = [
      {
        id: 'PG-CONTRACT-CORE',
        name: '合同核心作业权限组',
        permissions: ['PERM-CONTRACT-READ', 'PERM-CONTRACT-WRITE'],
      },
    ];

    // Empty -> fullSuite: every element across all 11 models is ADDED
    const addedDiff = diffOntologySuites({}, fullSuite);
    expect(addedDiff.hasChanges).toBe(true);
    expect(addedDiff.summary.changedModels).toEqual(MODEL_CODES);
    expect(addedDiff.summary.removedCount).toBe(0);
    expect(addedDiff.summary.modifiedCount).toBe(0);

    // Exact expected counts per model on CONTRACT_LIFECYCLE_SUITE + 1 permissionGroup:
    // M1: 3 aggregates + 1 dictionary + 2 associations = 6
    // M2: 6 behaviors
    // M3: 3 rules
    // ME: 3 events
    // M4: 1 scenario
    // M5: 3 actors + 2 roles + 1 permissionGroup + 5 permissions = 11
    // M6: 1 flow
    // M7: 2 query_reports
    // MU: 3 screens + 2 navigation_edges + 1 cross_cutting_ui = 6
    // MM: 3 mappings
    // MI: 3 interfaces
    // Total = 45
    expect(addedDiff.models.M1.summary.addedCount).toBe(6);
    expect(addedDiff.models.M2.summary.addedCount).toBe(6);
    expect(addedDiff.models.M3.summary.addedCount).toBe(3);
    expect(addedDiff.models.ME.summary.addedCount).toBe(3);
    expect(addedDiff.models.M4.summary.addedCount).toBe(1);
    expect(addedDiff.models.M5.summary.addedCount).toBe(11);
    expect(addedDiff.models.M6.summary.addedCount).toBe(1);
    expect(addedDiff.models.M7.summary.addedCount).toBe(2);
    expect(addedDiff.models.MU.summary.addedCount).toBe(6);
    expect(addedDiff.models.MM.summary.addedCount).toBe(3);
    expect(addedDiff.models.MI.summary.addedCount).toBe(3);
    expect(addedDiff.summary.addedCount).toBe(45);
    expect(addedDiff.summary.totalChanges).toBe(45);

    // Spot-check elementKind, elementId, name, and business displayName across models
    expect(addedDiff.changes.find((c) => c.elementId === 'AGG-01')).toMatchObject({
      modelCode: 'M1',
      collection: 'aggregates',
      elementKind: 'aggregate',
      elementId: 'AGG-01',
      name: 'Contract',
      displayName: '合同',
      status: 'ADDED',
      changedFields: [],
    });
    expect(addedDiff.changes.find((c) => c.elementId === 'DICT-CONTRACT')).toMatchObject({
      modelCode: 'M1',
      collection: 'data_dictionaries',
      elementKind: 'data_dictionary',
      displayName: '合同业务主字典',
      status: 'ADDED',
    });
    expect(addedDiff.changes.find((c) => c.elementId === 'ASSOC-01')).toMatchObject({
      modelCode: 'M1',
      collection: 'aggregate_associations',
      elementKind: 'aggregate_association',
      name: 'Contract -> Counterparty',
      displayName: '合同 → 签约相对方',
      status: 'ADDED',
    });
    expect(addedDiff.changes.find((c) => c.elementId === 'BHV-02')).toMatchObject({
      modelCode: 'M2',
      collection: 'behaviors',
      elementKind: 'behavior',
      name: 'submitContractApproval',
      displayName: '提交合同审批',
      status: 'ADDED',
    });
    expect(addedDiff.changes.find((c) => c.elementId === 'RULE-01')).toMatchObject({
      modelCode: 'M3',
      collection: 'rules',
      elementKind: 'rule',
      name: 'CounterpartyCreditThresholdRule',
      displayName: '相对方资信额度准入规则',
      status: 'ADDED',
    });
    expect(addedDiff.changes.find((c) => c.elementId === 'EVT-02')).toMatchObject({
      modelCode: 'ME',
      collection: 'events',
      elementKind: 'event',
      name: 'Contract.SubmittedForApproval',
      displayName: '合同已提交审批事件',
      status: 'ADDED',
    });
    expect(addedDiff.changes.find((c) => c.elementId === 'SCN-01')).toMatchObject({
      modelCode: 'M4',
      collection: 'event_scenarios',
      elementKind: 'scenario',
      displayName: '合同审批生效联动首期结算场景',
      status: 'ADDED',
    });
    expect(addedDiff.changes.find((c) => c.elementId === 'PG-CONTRACT-CORE')).toMatchObject({
      modelCode: 'M5',
      collection: 'permissionGroups',
      elementKind: 'permission_group',
      displayName: '合同核心作业权限组',
      status: 'ADDED',
    });
    expect(addedDiff.changes.find((c) => c.elementId === 'FLW-01')).toMatchObject({
      modelCode: 'M6',
      collection: 'flows',
      elementKind: 'flow',
      displayName: '合同起草与风险分级审批主流程',
      status: 'ADDED',
    });
    expect(addedDiff.changes.find((c) => c.elementId === 'QRY-01')).toMatchObject({
      modelCode: 'M7',
      collection: 'query_reports',
      elementKind: 'query_report',
      name: 'ContractLedgerDetailQuery',
      displayName: '合同全量台账分页查询',
      status: 'ADDED',
    });
    expect(addedDiff.changes.find((c) => c.elementId === 'SCR-CONTRACT-EDIT')).toMatchObject({
      modelCode: 'MU',
      collection: 'screens',
      elementKind: 'screen',
      displayName: '合同起草与条款配置页',
      status: 'ADDED',
    });
    expect(addedDiff.changes.find((c) => c.elementId === 'NAV-01')).toMatchObject({
      modelCode: 'MU',
      collection: 'navigation_edges',
      elementKind: 'navigation_edge',
      name: 'SCR-CONTRACT-LIST -> SCR-CONTRACT-EDIT',
      displayName: '合同台账与风险监控工作台 → 合同起草与条款配置页',
      status: 'ADDED',
    });
    expect(addedDiff.changes.find((c) => c.elementId === 'CC-UI-01')).toMatchObject({
      modelCode: 'MU',
      collection: 'cross_cutting_ui',
      elementKind: 'cross_cutting_ui',
      displayName: '高风险合同法务红线提示横幅',
      status: 'ADDED',
    });
    expect(addedDiff.changes.find((c) => c.elementId === 'MAP-CONTRACT-01')).toMatchObject({
      modelCode: 'MM',
      collection: 'mappings',
      elementKind: 'mapping',
      name: 'Contract',
      displayName: '合同',
      status: 'ADDED',
    });
    expect(addedDiff.changes.find((c) => c.elementId === 'IF-01')).toMatchObject({
      modelCode: 'MI',
      collection: 'interfaces',
      elementKind: 'interface',
      displayName: '起草并保存商务合同接口',
      status: 'ADDED',
    });

    // fullSuite -> Empty: every element across all 11 models is REMOVED
    const removedDiff = diffOntologySuites(fullSuite, {});
    expect(removedDiff.hasChanges).toBe(true);
    expect(removedDiff.summary.addedCount).toBe(0);
    expect(removedDiff.summary.removedCount).toBe(45);
    expect(removedDiff.summary.modifiedCount).toBe(0);
    expect(removedDiff.summary.changedModels).toEqual(MODEL_CODES);
    expect(removedDiff.changes.every((c) => c.status === 'REMOVED')).toBe(true);
  });

  it('detects MODIFIED elements with field-level changedFields across all 11 models including nested attributes, invariants, steps, activities, columns, and UI call chains', () => {
    const prev = cloneSuite(CONTRACT_LIFECYCLE_SUITE);
    const next = cloneSuite(CONTRACT_LIFECYCLE_SUITE);

    // M1: aggregate (alias, lifecycle, nested attribute edit + add, entity attribute, VO, invariant), dictionary item, association
    const contract = next.M1!.aggregates.find((a) => a.id === 'AGG-01')!;
    contract.alias = '商务合同';
    contract.lifecycle = [...contract.lifecycle, 'CANCELLED'];
    contract.attributes.find((a) => a.name === 'totalAmount')!.label = '含税合同总额';
    contract.attributes.push({
      name: 'taxRate',
      label: '增值税率',
      type: 'Decimal',
      required: true,
    });
    contract.entities
      .find((e) => e.name === 'ContractLineItem')!
      .attributes.find((a) => a.name === 'unitPrice')!.label = '不含税单价';
    contract.valueObjects.find((v) => v.name === 'SignPeriod')!.immutable = false;
    contract.invariants.find((i) => i.name === 'MilestoneSumMatchesContractAmount')!.expression =
      'round(sum(PaymentMilestone.plannedAmount), 2) == totalAmount';

    next.M1!.data_dictionaries[0]!
      .types.find((t) => t.typeCode === 'RISK_LEVEL')!
      .items.find((i) => i.code === 'HIGH')!.label = '极高风险（总裁会签）';
    next.M1!.aggregate_associations[0]!.cardinality = 'ONE_TO_ONE';

    // M2: behavior
    const submitBhv = next.M2!.behaviors.find((b) => b.id === 'BHV-02')!;
    submitBhv.name = 'submitContractForReview';
    submitBhv.alias = '正式提交合同会签';
    submitBhv.inputParameters.find((p) => p.name === 'submitComment')!.required = true;
    submitBhv.preconditions[0]!.expression = "Contract.status in ['DRAFT', 'RETURNED']";

    // M3: rule
    const rule02 = next.M3!.rules.find((r) => r.id === 'RULE-02')!;
    rule02.referencedObjects = ['Contract', 'Counterparty'];
    rule02.expression = "Contract.totalAmount >= 1000000 ? 'HIGH' : 'LOW'";

    // ME: event
    const evt02 = next.ME!.events.find((e) => e.id === 'EVT-02')!;
    evt02.orderingSemantic = 'FIFO';
    evt02.payload.find((p) => p.name === 'riskLevel')!.required = false;
    evt02.subscribers[0]!.deliveryMode = 'SYNC';

    // M4: scenario step
    next.M4!.event_scenarios[0]!.steps.find((s) => s.stepOrder === 3)!.description =
      '实时校验累计结算守恒上限';

    // M5: actor externalContract, role dataScope, permission allowedBehaviors
    next.M5!.actors.find((a) => a.id === 'ACT-EXT-ESIGN')!.externalContract!.timeoutMs = 12000;
    next.M5!.roles.find((r) => r.id === 'ROLE-CONTRACT-SPEC')!.dataScope = 'SELF';
    next.M5!.permissions.find((p) => p.id === 'PERM-CONTRACT-SUBMIT')!.allowedBehaviors = [
      'BHV-01',
      'BHV-02',
    ];

    // M6: flow trigger, activity roleRef, branch condition
    const flow = next.M6!.flows[0]!;
    flow.trigger.triggerType = 'BEHAVIOR';
    flow.activities.find((a) => a.id === 'ACTV-LEGAL-APPROVE')!.roleRef = 'ROLE-CONTRACT-SPEC';
    flow.activities.find((a) => a.id === 'ACTV-RISK-GW')!.branches[0]!.condition =
      "Contract.riskLevel == 'HIGH'";

    // M7: query_report resultColumn label + referenceSql.sql
    const qry01 = next.M7!.query_reports.find((q) => q.id === 'QRY-01')!;
    qry01.resultColumns.find((c) => c.name === 'totalAmount')!.label = '签约含税总额';
    qry01.referenceSql.sql = 'SELECT c.contract_no FROM t_contract c';

    // MU: screen (name, element edit + add, event callChain), navigation_edge, cross_cutting_ui
    const editScreen = next.MU!.screens.find((s) => s.screenId === 'SCR-CONTRACT-EDIT')!;
    editScreen.name = '合同起草与会签提交页';
    editScreen.elements.find((e) => e.elementId === 'EL-TOTAL-AMOUNT')!.label = '含税总金额(元)';
    editScreen.elements.push({
      elementId: 'EL-TAX-RATE',
      name: 'taxRateInput',
      label: '增值税率',
      elementType: 'NUMBER',
      io: 'IN_OUT',
      required: true,
      dataBinding: 'Contract.taxRate',
    });
    editScreen.events
      .find((ev) => ev.eventId === 'UIE-SUBMIT-APPROVAL')!
      .callChain.push({
        stepOrder: 4,
        stepType: 'NAVIGATE',
        refId: 'SCR-CONTRACT-APPROVAL',
      });
    next.MU!.navigation_edges[0]!.mode = 'MODAL';
    next.MU!.cross_cutting_ui[0]!.description = '高风险合同顶部红线横幅预警';

    // MM: mapping nested columnMapping
    next.MM!.mappings
      .find((m) => m.id === 'MAP-CONTRACT-01')!
      .tableMappings.find((t) => t.tableName === 't_contract')!
      .columnMappings.find((c) => c.column === 'total_amount')!.columnType = 'DECIMAL(20,4)';

    // MI: interface protocol, inputField required, returnRule message
    const if01 = next.MI!.interfaces.find((i) => i.interfaceId === 'IF-01')!;
    if01.protocol = 'gRPC';
    if01.inputFields.find((f) => f.name === 'totalAmount')!.required = false;
    if01.returnRules.find((r) => r.code === 'CONTRACT_200')!.message = '商务合同草稿已落库';

    const diff = diffOntologySuites(prev, next);
    expect(diff.hasChanges).toBe(true);
    expect(diff.summary.addedCount).toBe(0);
    expect(diff.summary.removedCount).toBe(0);
    expect(diff.summary.changedModels).toEqual(MODEL_CODES);
    // 3(M1) + 1(M2) + 1(M3) + 1(ME) + 1(M4) + 3(M5) + 1(M6) + 1(M7) + 3(MU) + 1(MM) + 1(MI) = 17 modified elements
    expect(diff.summary.modifiedCount).toBe(17);

    // M1 aggregate Contract
    const contractDiff = diff.models.M1.modified.find((c) => c.elementId === 'AGG-01')!;
    expect(contractDiff.displayName).toBe('商务合同');
    expect(contractDiff.previousDisplayName).toBe('合同');
    expect(contractDiff.previousName).toBeUndefined();
    expect(contractDiff.changedFields).toEqual(
      expect.arrayContaining([
        { field: 'alias', before: '合同', after: '商务合同' },
        {
          field: 'lifecycle',
          before: 'DRAFT, PENDING_APPROVAL, APPROVED, SIGNED, EXECUTING, ARCHIVED, TERMINATED',
          after:
            'DRAFT, PENDING_APPROVAL, APPROVED, SIGNED, EXECUTING, ARCHIVED, TERMINATED, CANCELLED',
        },
        {
          field: 'attributes[totalAmount].label',
          before: '合同总金额',
          after: '含税合同总额',
        },
        expect.objectContaining({
          field: 'attributes[taxRate]',
          before: '—',
        }),
        {
          field: 'entities[ContractLineItem].attributes[unitPrice].label',
          before: '含税单价',
          after: '不含税单价',
        },
        {
          field: 'valueObjects[SignPeriod].immutable',
          before: 'true',
          after: 'false',
        },
        {
          field: 'invariants[MilestoneSumMatchesContractAmount].expression',
          before: 'sum(PaymentMilestone.plannedAmount) == totalAmount',
          after: 'round(sum(PaymentMilestone.plannedAmount), 2) == totalAmount',
        },
      ]),
    );

    // M1 dictionary & association
    expect(diff.models.M1.modified.find((c) => c.elementId === 'DICT-CONTRACT')!.changedFields).toEqual([
      {
        field: 'types[RISK_LEVEL].items[HIGH].label',
        before: '高风险（法务总监终审）',
        after: '极高风险（总裁会签）',
      },
    ]);
    expect(diff.models.M1.modified.find((c) => c.elementId === 'ASSOC-01')!.changedFields).toContainEqual({
      field: 'cardinality',
      before: 'MANY_TO_ONE',
      after: 'ONE_TO_ONE',
    });

    // M2 behavior
    const bhvDiff = diff.models.M2.modified[0]!;
    expect(bhvDiff.name).toBe('submitContractForReview');
    expect(bhvDiff.previousName).toBe('submitContractApproval');
    expect(bhvDiff.displayName).toBe('正式提交合同会签');
    expect(bhvDiff.previousDisplayName).toBe('提交合同审批');
    expect(bhvDiff.changedFields).toEqual(
      expect.arrayContaining([
        { field: 'name', before: 'submitContractApproval', after: 'submitContractForReview' },
        { field: 'alias', before: '提交合同审批', after: '正式提交合同会签' },
        { field: 'inputParameters[submitComment].required', before: 'false', after: 'true' },
        {
          field: 'preconditions[OnlyDraftCanSubmit].expression',
          before: "Contract.status == 'DRAFT'",
          after: "Contract.status in ['DRAFT', 'RETURNED']",
        },
      ]),
    );

    // M3 rule
    expect(diff.models.M3.modified[0]!.changedFields).toEqual([
      { field: 'referencedObjects', before: 'Contract', after: 'Contract, Counterparty' },
      {
        field: 'expression',
        before:
          "Contract.totalAmount >= 2000000 ? 'HIGH' : (Contract.totalAmount >= 500000 ? 'MEDIUM' : 'LOW')",
        after: "Contract.totalAmount >= 1000000 ? 'HIGH' : 'LOW'",
      },
    ]);

    // ME event
    expect(diff.models.ME.modified[0]!.changedFields).toEqual([
      { field: 'orderingSemantic', before: 'EXACTLY_ONCE', after: 'FIFO' },
      { field: 'payload[riskLevel].required', before: 'true', after: 'false' },
      { field: 'subscribers[BEHAVIOR:BHV-03].deliveryMode', before: 'ASYNC', after: 'SYNC' },
    ]);

    // M4 scenario step
    expect(diff.models.M4.modified[0]!.changedFields).toEqual([
      {
        field: 'steps[3].description',
        before: '校验结算总额度上限规则',
        after: '实时校验累计结算守恒上限',
      },
    ]);

    // M5 actor, role, permission
    expect(diff.models.M5.modified.find((c) => c.elementId === 'ACT-EXT-ESIGN')!.changedFields).toEqual([
      { field: 'externalContract.timeoutMs', before: '5000', after: '12000' },
    ]);
    expect(diff.models.M5.modified.find((c) => c.elementId === 'ROLE-CONTRACT-SPEC')!.changedFields).toEqual([
      { field: 'dataScope', before: 'DEPARTMENT', after: 'SELF' },
    ]);
    expect(diff.models.M5.modified.find((c) => c.elementId === 'PERM-CONTRACT-SUBMIT')!.changedFields).toEqual([
      { field: 'allowedBehaviors', before: 'BHV-02', after: 'BHV-01, BHV-02' },
    ]);

    // M6 flow
    expect(diff.models.M6.modified[0]!.changedFields).toEqual([
      { field: 'trigger.triggerType', before: 'USER_ACTION', after: 'BEHAVIOR' },
      {
        field: 'activities[ACTV-RISK-GW].branches[ACTV-LEGAL-APPROVE].condition',
        before: "Contract.riskLevel == 'HIGH' || Contract.totalAmount >= 500000",
        after: "Contract.riskLevel == 'HIGH'",
      },
      {
        field: 'activities[ACTV-LEGAL-APPROVE].roleRef',
        before: 'ROLE-DEPT-MGR',
        after: 'ROLE-CONTRACT-SPEC',
      },
    ]);

    // M7 query_report
    expect(diff.models.M7.modified[0]!.changedFields).toEqual([
      { field: 'resultColumns[totalAmount].label', before: '合同总金额', after: '签约含税总额' },
      expect.objectContaining({
        field: 'referenceSql.sql',
        after: 'SELECT c.contract_no FROM t_contract c',
      }),
    ]);

    // MU screen, nav edge, cross-cutting UI
    const screenDiff = diff.models.MU.modified.find((c) => c.elementId === 'SCR-CONTRACT-EDIT')!;
    expect(screenDiff.changedFields).toEqual(
      expect.arrayContaining([
        { field: 'name', before: '合同起草与条款配置页', after: '合同起草与会签提交页' },
        {
          field: 'elements[EL-TOTAL-AMOUNT].label',
          before: '合同总金额(元)',
          after: '含税总金额(元)',
        },
        expect.objectContaining({
          field: 'elements[EL-TAX-RATE]',
          before: '—',
        }),
        {
          field: 'events[UIE-SUBMIT-APPROVAL].callChain',
          before: 'VALIDATE:RULE-02 -> BEHAVIOR_CALL:BHV-02 -> EVENT_EMIT:EVT-02',
          after:
            'VALIDATE:RULE-02 -> BEHAVIOR_CALL:BHV-02 -> EVENT_EMIT:EVT-02 -> NAVIGATE:SCR-CONTRACT-APPROVAL',
        },
      ]),
    );
    expect(diff.models.MU.modified.find((c) => c.elementId === 'NAV-01')!.changedFields).toEqual([
      { field: 'mode', before: 'PUSH', after: 'MODAL' },
    ]);
    expect(diff.models.MU.modified.find((c) => c.elementId === 'CC-UI-01')!.changedFields).toEqual([
      {
        field: 'description',
        before: '当 riskLevel == HIGH 时顶部常驻显示法务合规审查清单提示。',
        after: '高风险合同顶部红线横幅预警',
      },
    ]);

    // MM mapping
    expect(diff.models.MM.modified[0]!.changedFields).toEqual([
      {
        field: 'tableMappings[t_contract].columnMappings[total_amount].columnType',
        before: 'DECIMAL(18,2)',
        after: 'DECIMAL(20,4)',
      },
    ]);

    // MI interface
    expect(diff.models.MI.modified[0]!.changedFields).toEqual([
      { field: 'protocol', before: 'REST', after: 'gRPC' },
      { field: 'inputFields[totalAmount].required', before: 'true', after: 'false' },
      {
        field: 'returnRules[CONTRACT_200].message',
        before: '合同起草成功',
        after: '商务合同草稿已落库',
      },
    ]);
  });

  it('attributes changes to related M1 business objects (aggregates) across direct, cross-object, inferred UI/interface, and removed-aggregate cases', () => {
    const contractRef = { aggregateId: 'AGG-01', name: 'Contract', displayName: '合同' };
    const counterpartyRef = {
      aggregateId: 'AGG-02',
      name: 'Counterparty',
      displayName: '签约相对方',
    };
    const settlementRef = {
      aggregateId: 'AGG-03',
      name: 'SettlementOrder',
      displayName: '履约结算单',
    };

    const initialDiff = diffOntologySuites({}, CONTRACT_LIFECYCLE_SUITE);
    const byId = new Map(initialDiff.changes.map((c) => [c.elementId, c]));

    // Single-owner elements
    expect(byId.get('AGG-01')!.relatedAggregates).toEqual([contractRef]);
    expect(byId.get('BHV-02')!.relatedAggregates).toEqual([contractRef]);
    expect(byId.get('EVT-02')!.relatedAggregates).toEqual([contractRef]);
    expect(byId.get('PERM-SETTLEMENT-MANAGE')!.relatedAggregates).toEqual([settlementRef]);
    expect(byId.get('MAP-CONTRACT-01')!.relatedAggregates).toEqual([contractRef]);

    // Multi-aggregate / cross-object elements
    expect(byId.get('ASSOC-01')!.relatedAggregates).toEqual([contractRef, counterpartyRef]);
    expect(byId.get('RULE-01')!.relatedAggregates).toEqual([contractRef, counterpartyRef]);
    expect(byId.get('SCN-01')!.relatedAggregates).toEqual([contractRef, settlementRef]);
    expect(byId.get('FLW-01')!.relatedAggregates).toEqual([contractRef]);
    expect(byId.get('QRY-01')!.relatedAggregates).toEqual([contractRef, counterpartyRef]);

    // Inferred MU screen & MI interface attribution
    expect(byId.get('SCR-CONTRACT-LIST')!.relatedAggregates).toEqual([contractRef]);
    expect(byId.get('SCR-CONTRACT-EDIT')!.relatedAggregates).toEqual([
      contractRef,
      counterpartyRef,
    ]);
    expect(byId.get('IF-01')!.relatedAggregates).toEqual([contractRef]);
    expect(byId.get('IF-02')!.relatedAggregates).toEqual([contractRef]);
    expect(byId.get('IF-EXT-ESIGN-03')!.relatedAggregates).toEqual([
      contractRef,
      counterpartyRef,
    ]);

    // Global / cross-cutting elements without a single owning business object
    expect(byId.get('ACT-01')!.relatedAggregates).toEqual([]);
    expect(byId.get('ROLE-CONTRACT-SPEC')!.relatedAggregates).toEqual([]);
    expect(byId.get('DICT-CONTRACT')!.relatedAggregates).toEqual([]);
    expect(byId.get('NAV-01')!.relatedAggregates).toEqual([]);
    expect(byId.get('CC-UI-01')!.relatedAggregates).toEqual([]);

    // Newly added screen without M1.uiBindings still attributes via element dataBinding & event callChain
    const withNewScreen = cloneSuite(CONTRACT_LIFECYCLE_SUITE);
    withNewScreen.MU!.screens.push({
      screenId: 'SCR-SETTLEMENT-PAY',
      name: '结算单核销操作台',
      screenType: 'FORM',
      roleRefs: [],
      elements: [
        {
          elementId: 'EL-SETTLEMENT-NO',
          name: 'settlementNo',
          label: '结算单号',
          elementType: 'INPUT',
          io: 'OUT',
          required: false,
          dataBinding: 'SettlementOrder.settlementNo',
        },
      ],
      events: [],
    });
    const screenAddedDiff = diffOntologySuites(CONTRACT_LIFECYCLE_SUITE, withNewScreen);
    expect(screenAddedDiff.changes).toHaveLength(1);
    expect(screenAddedDiff.changes[0]!.relatedAggregates).toEqual([settlementRef]);

    // Removed aggregate + removed behavior in the same diff still resolves aggregate metadata from previousSuite
    const afterRemoval = cloneSuite(CONTRACT_LIFECYCLE_SUITE);
    afterRemoval.M1!.aggregates = afterRemoval.M1!.aggregates.filter((a) => a.id !== 'AGG-03');
    afterRemoval.M2!.behaviors = afterRemoval.M2!.behaviors.filter((b) => b.id !== 'BHV-04');
    const removalDiff = diffOntologySuites(CONTRACT_LIFECYCLE_SUITE, afterRemoval);
    expect(
      removalDiff.changes.find((c) => c.elementId === 'AGG-03')!.relatedAggregates,
    ).toEqual([settlementRef]);
    expect(
      removalDiff.changes.find((c) => c.elementId === 'BHV-04')!.relatedAggregates,
    ).toEqual([settlementRef]);
  });

  it('handles optional empty normalization, ordered column/step sequences, duplicate-field conditions, and sub-entity table mappings', () => {
    // 1. Optional undefined vs [] / "" normalization produces zero false-positive changes
    const prevMft = cloneSuite(MFT_ENTERPRISE_SUITE);
    const nextMft = cloneSuite(MFT_ENTERPRISE_SUITE);
    nextMft.M1!.aggregates[0]!.uiBindings = [];
    nextMft.M2!.behaviors[0]!.syncTriggers = [];
    nextMft.M2!.behaviors[0]!.uiEventRefs = [];
    nextMft.M5!.permissionGroups = [];
    nextMft.M5!.roles[0]!.description = '';
    expect(diffOntologySuites(prevMft, nextMft).hasChanges).toBe(false);

    // 2. Reordering M7 resultColumns and editing duplicate-field conditions are both captured
    const prevReport = cloneSuite(CONTRACT_LIFECYCLE_SUITE);
    prevReport.M7!.query_reports[0]!.conditions = [
      { field: 'c.total_amount', operator: '>=', parameterRef: 'minAmount' },
      { field: 'c.total_amount', operator: '<=', parameterRef: 'maxAmount' },
    ];
    const nextReport = cloneSuite(prevReport);
    nextReport.M7!.query_reports[0]!.resultColumns = [
      ...nextReport.M7!.query_reports[0]!.resultColumns,
    ].reverse();
    nextReport.M7!.query_reports[0]!.conditions[1]!.operator = '<';

    const reportDiff = diffOntologySuites(prevReport, nextReport);
    expect(reportDiff.hasChanges).toBe(true);
    const qryFields = reportDiff.models.M7.modified[0]!.changedFields.map((f) => f.field);
    expect(qryFields).toEqual(['conditions', 'resultColumns']);

    // 3. MM sub-entity mapping resolves sub-entity alias and attributes to parent M1 aggregate
    const withSubEntityMapping = cloneSuite(CONTRACT_LIFECYCLE_SUITE);
    withSubEntityMapping.MM!.mappings.push({
      id: 'MAP-LINE-ITEM-04',
      objectRef: 'ContractLineItem',
      objectRole: 'ENTITY',
      objectName: 'ContractLineItem',
      tableMappings: [
        {
          tableName: 't_contract_line_item_ext',
          tableRole: 'EXT',
          primaryKey: 'id',
          foreignKeys: [],
          columnMappings: [],
        },
      ],
    });
    const subEntityMapDiff = diffOntologySuites(CONTRACT_LIFECYCLE_SUITE, withSubEntityMapping);
    expect(subEntityMapDiff.changes).toHaveLength(1);
    expect(subEntityMapDiff.changes[0]).toMatchObject({
      modelCode: 'MM',
      elementKind: 'mapping',
      elementId: 'MAP-LINE-ITEM-04',
      name: 'ContractLineItem',
      displayName: '合同标的明细',
      status: 'ADDED',
      relatedAggregates: [{ aggregateId: 'AGG-01', name: 'Contract', displayName: '合同' }],
    });
  });

  it('detects empty-model additions/removals and model-level metadata modifications across all 11 models', () => {
    const emptyShellAll11: OntologySuite = {
      M1: {
        model_type: 'OBJECT',
        version: '5.0',
        domain: '合同管理',
        aggregates: [],
        data_dictionaries: [],
        aggregate_associations: [],
      },
      M2: { model_type: 'BEHAVIOR', version: '5.0', domain: '合同管理', behaviors: [] },
      M3: { model_type: 'RULE', version: '5.0', domain: '合同管理', rules: [] },
      ME: { model_type: 'EVENT', version: '5.0', domain: '合同管理', events: [] },
      M4: { model_type: 'SCENARIO', version: '5.0', domain: '合同管理', event_scenarios: [] },
      M5: {
        model_type: 'ACTOR',
        version: '5.0',
        domain: '合同管理',
        actors: [],
        roles: [],
        permissions: [],
      },
      M6: { model_type: 'FLOW', version: '5.0', domain: '合同管理', flows: [] },
      M7: { model_type: 'QUERY_REPORT', version: '5.0', domain: '合同管理', query_reports: [] },
      MU: {
        model_type: 'UI',
        version: '5.0',
        domain: '合同管理',
        application: 'contract-portal',
        screens: [],
        navigation_edges: [],
        cross_cutting_ui: [],
      },
      MM: { model_type: 'MAPPING', version: '1.0', domain: '合同管理', mappings: [] },
      MI: { model_type: 'INTERFACE', version: '1.0', domain: '合同管理', interfaces: [] },
    };

    const addEmptyDiff = diffOntologySuites({}, emptyShellAll11);
    expect(addEmptyDiff.hasChanges).toBe(true);
    expect(addEmptyDiff.summary.addedCount).toBe(11);
    expect(addEmptyDiff.summary.changedModels).toEqual(MODEL_CODES);
    for (const code of MODEL_CODES) {
      expect(addEmptyDiff.models[code].added).toEqual([
        {
          modelCode: code,
          collection: 'model_metadata',
          elementKind: 'model_metadata',
          elementId: code,
          name: '合同管理',
          displayName: '合同管理',
          status: 'ADDED',
          changedFields: [],
          relatedAggregates: [],
        },
      ]);
    }

    const removeEmptyDiff = diffOntologySuites(emptyShellAll11, {});
    expect(removeEmptyDiff.hasChanges).toBe(true);
    expect(removeEmptyDiff.summary.removedCount).toBe(11);
    expect(removeEmptyDiff.summary.changedModels).toEqual(MODEL_CODES);
    expect(
      removeEmptyDiff.changes.every(
        (c) => c.elementKind === 'model_metadata' && c.status === 'REMOVED',
      ),
    ).toBe(true);

    // Modifying model-level metadata fields across all 11 models on a populated suite
    const nextPopulated = cloneSuite(CONTRACT_LIFECYCLE_SUITE);
    for (const code of MODEL_CODES) {
      const m = nextPopulated[code] as Record<string, unknown>;
      m.domain = '集团合同中心';
      m.version = '6.0';
    }
    nextPopulated.MU!.application = 'group-contract-app';

    const metaDiff = diffOntologySuites(CONTRACT_LIFECYCLE_SUITE, nextPopulated);
    expect(metaDiff.hasChanges).toBe(true);
    expect(metaDiff.summary.modifiedCount).toBe(11);
    expect(metaDiff.summary.changedModels).toEqual(MODEL_CODES);
    expect(metaDiff.models.M1.modified[0]).toMatchObject({
      modelCode: 'M1',
      collection: 'model_metadata',
      elementKind: 'model_metadata',
      elementId: 'M1',
      name: '集团合同中心',
      previousName: '合同全生命周期管理系统',
      displayName: '集团合同中心',
      previousDisplayName: '合同全生命周期管理系统',
      status: 'MODIFIED',
    });
    expect(metaDiff.models.MU.modified[0]!.changedFields).toEqual(
      expect.arrayContaining([
        { field: 'domain', before: '合同全生命周期管理系统', after: '集团合同中心' },
        { field: 'version', before: '5.0', after: '6.0' },
        { field: 'application', before: '—', after: 'group-contract-app' },
      ]),
    );
  });
});
