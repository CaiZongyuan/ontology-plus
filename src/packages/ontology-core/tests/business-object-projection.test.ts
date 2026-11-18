import { describe, expect, it } from 'vitest';
import {
  CONTRACT_LIFECYCLE_SUITE,
  MFT_ENTERPRISE_SUITE,
  projectByBusinessObject,
} from '../index.js';

describe('projectByBusinessObject: per-business-object page projection', () => {
  it('projects each M1 AggregateRoot in CONTRACT_LIFECYCLE_SUITE with all default-expanded and default-collapsed sections and technical locators', () => {
    const projection = projectByBusinessObject(CONTRACT_LIFECYCLE_SUITE);

    expect(projection.objects.map((o) => o.id)).toEqual(['AGG-01', 'AGG-02', 'AGG-03']);
    expect(projection.objects.map((o) => o.displayName)).toEqual([
      '合同',
      '签约相对方',
      '履约结算单',
    ]);

    const contract = projection.objects.find((o) => o.id === 'AGG-01')!;
    expect(contract.locator).toEqual({ model: 'M1', elementId: 'AGG-01' });

    // 1. Default-expanded: fields + structural M1 details (subEntities, valueObjects, associations, dictionaries)
    expect(contract.fields.map((f) => f.displayName)).toEqual([
      '合同编号',
      '合同名称',
      '合同类型',
      '相对方编号',
      '合同总金额',
      '合同状态',
      '履约有效期',
      '风险等级',
    ]);
    const counterpartyRefField = contract.fields.find((f) => f.name === 'counterpartyId')!;
    expect(counterpartyRefField.targetObject?.displayName).toBe('签约相对方');
    expect(counterpartyRefField.locator.model).toBe('M1');
    expect(counterpartyRefField.locator.elementId).toBe('AGG-01');

    const typeField = contract.fields.find((f) => f.name === 'contractType')!;
    expect(typeField.dictionary?.typeName).toBe('合同类型');
    expect(typeField.dictionary?.items.map((i) => i.label)).toEqual([
      '销售合同',
      '采购合同',
      '技术服务外包合同',
      '保密协议',
    ]);

    expect(contract.subEntities.map((e) => e.displayName)).toEqual([
      '合同标的明细',
      '收付款里程碑',
    ]);
    expect(contract.subEntities[0]?.fields).toHaveLength(4);
    expect(contract.valueObjects.map((v) => v.displayName)).toEqual(['履约期限值对象']);
    expect(contract.dictionaries.map((d) => d.id)).toEqual(['DICT-CONTRACT']);
    expect(contract.associations.map((a) => a.id)).toEqual(['ASSOC-01', 'ASSOC-02']);

    // 2. Default-expanded: actions (M2 behaviors owned by Contract)
    expect(contract.actions.map((a) => a.id)).toEqual([
      'BHV-01',
      'BHV-02',
      'BHV-03',
      'BHV-05',
      'BHV-06',
    ]);
    expect(contract.actions[0]?.displayName).toBe('起草合同');
    expect(contract.actions[0]?.locator).toEqual({ model: 'M2', elementId: 'BHV-01' });

    // 3. Default-expanded: businessRules (own attribute refRules + invariants + M3 rules)
    const attrRuleNames = contract.businessRules
      .filter((r) => r.kind === 'ATTRIBUTE_RULE')
      .map((r) => r.name);
    expect(attrRuleNames).toEqual([
      'ContractNoFormat',
      'TitleLengthRule',
      'PositiveContractAmount',
      'PositiveQuantity',
    ]);
    const invariantNames = contract.businessRules
      .filter((r) => r.kind === 'INVARIANT')
      .map((r) => r.name);
    expect(invariantNames).toEqual([
      'MilestoneSumMatchesContractAmount',
      'LineItemSumMatchesContractAmount',
    ]);
    const m3RuleIds = contract.businessRules
      .filter((r) => r.kind === 'M3_RULE')
      .map((r) => r.id);
    expect(m3RuleIds).toEqual(['RULE-01', 'RULE-02', 'RULE-03']);

    // 4. Default-expanded: authorizedRoles ("谁能做" from M5 + M2, including role inheritance)
    expect(contract.authorizedRoles.map((r) => r.roleId)).toEqual([
      'ROLE-CONTRACT-SPEC',
      'ROLE-DEPT-MGR',
    ]);
    const specRole = contract.authorizedRoles.find((r) => r.roleId === 'ROLE-CONTRACT-SPEC')!;
    expect(specRole.displayName).toBe('合同专员角色');
    expect(specRole.actors.map((a) => a.id)).toEqual(['ACT-01']);
    expect(specRole.actions.map((a) => a.id)).toEqual(['BHV-01', 'BHV-02', 'BHV-05', 'BHV-06']);
    expect(specRole.locator).toEqual({ model: 'M5', elementId: 'ROLE-CONTRACT-SPEC' });

    const mgrRole = contract.authorizedRoles.find((r) => r.roleId === 'ROLE-DEPT-MGR')!;
    // ROLE-DEPT-MGR inherits from ROLE-CONTRACT-SPEC and adds PERM-CONTRACT-APPROVE (BHV-03)
    expect(mgrRole.actions.map((a) => a.id)).toEqual([
      'BHV-01',
      'BHV-02',
      'BHV-03',
      'BHV-05',
      'BHV-06',
    ]);
    expect(mgrRole.inheritedActionIds).toEqual(['BHV-01', 'BHV-02']);

    // 5. Default-collapsed sections: events, automations, screens, integrations, dataStorage
    expect(contract.events.map((e) => e.id)).toEqual(['EVT-01', 'EVT-02', 'EVT-03']);
    expect(contract.events[0]?.locator).toEqual({ model: 'ME', elementId: 'EVT-01' });

    expect(contract.automations.map((s) => s.id)).toEqual(['SCN-01']);
    expect(contract.automations[0]?.locator).toEqual({ model: 'M4', elementId: 'SCN-01' });

    expect(contract.screens.map((s) => s.id)).toEqual([
      'SCR-CONTRACT-LIST',
      'SCR-CONTRACT-EDIT',
      'SCR-CONTRACT-APPROVAL',
    ]);
    expect(contract.screens[0]?.locator).toEqual({
      model: 'MU',
      elementId: 'SCR-CONTRACT-LIST',
    });

    expect(contract.integrations.map((i) => i.id)).toEqual([
      'IF-01',
      'IF-02',
      'IF-EXT-ESIGN-03',
    ]);
    expect(contract.integrations[0]?.locator).toEqual({ model: 'MI', elementId: 'IF-01' });

    expect(contract.dataStorage.map((m) => m.id)).toEqual(['MAP-CONTRACT-01']);
    expect(contract.dataStorage[0]?.tableNames).toEqual([
      't_contract',
      't_contract_line_item',
      't_payment_milestone',
    ]);
    expect(contract.dataStorage[0]?.locator).toEqual({
      model: 'MM',
      elementId: 'MAP-CONTRACT-01',
    });

    // SettlementOrder receives EVT-03 as subscriber and SCN-01 as target object
    const settlement = projection.objects.find((o) => o.id === 'AGG-03')!;
    expect(settlement.actions.map((a) => a.id)).toEqual(['BHV-04']);
    expect(settlement.automaticActions.map((a) => a.id)).toEqual(['BHV-04']);
    expect(settlement.events.map((e) => ({ id: e.id, relation: e.relation }))).toEqual([
      { id: 'EVT-03', relation: 'SUBSCRIBED' },
    ]);
    expect(settlement.automations.map((s) => s.id)).toEqual(['SCN-01']);
    expect(settlement.dataStorage.map((m) => m.id)).toEqual(['MAP-SETTLEMENT-03']);
  });

  it('projects partial 5-model MFT_ENTERPRISE_SUITE cleanly with empty collapsed sections when late-stage models are absent', () => {
    const projection = projectByBusinessObject(MFT_ENTERPRISE_SUITE);

    expect(projection.objects).toHaveLength(1);
    const task = projection.objects[0]!;
    expect(task.displayName).toBe('文件传输任务');
    expect(task.fields).toHaveLength(5);
    expect(task.actions.map((a) => a.id)).toEqual(['BHV-MFT-01']);
    expect(task.businessRules.map((r) => r.id)).toEqual(['RULE-MFT-01']);
    expect(task.authorizedRoles.map((r) => r.roleId)).toEqual(['ROLE-MFT-ADMIN']);
    expect(task.events.map((e) => e.id)).toEqual(['EVT-MFT-01']);
    expect(task.automations).toEqual([]);
    expect(task.screens).toEqual([]);
    expect(task.integrations).toEqual([]);
    expect(task.dataStorage).toEqual([]);
  });
});

describe('projectByBusinessObject: shared cross-object M3 rule identity', () => {
  it('surfaces each cross-object M3 rule on every referenced business object page as the exact same canonical rule entry and ID', () => {
    const projection = projectByBusinessObject(CONTRACT_LIFECYCLE_SUITE);

    const contract = projection.objects.find((o) => o.id === 'AGG-01')!;
    const counterparty = projection.objects.find((o) => o.id === 'AGG-02')!;
    const settlement = projection.objects.find((o) => o.id === 'AGG-03')!;

    // RULE-01 references Contract & Counterparty
    const rule01OnContract = contract.businessRules.find((r) => r.id === 'RULE-01')!;
    const rule01OnCounterparty = counterparty.businessRules.find((r) => r.id === 'RULE-01')!;
    const rule01OnSettlement = settlement.businessRules.find((r) => r.id === 'RULE-01');

    expect(rule01OnContract).toBeDefined();
    expect(rule01OnCounterparty).toBeDefined();
    expect(rule01OnSettlement).toBeUndefined();

    // Exact same identity: same ID, same canonical ProjectedM3Rule object, same underlying M3 RuleItem
    expect(rule01OnContract.id).toBe('RULE-01');
    expect(rule01OnContract).toBe(rule01OnCounterparty);
    if (rule01OnContract.kind === 'M3_RULE' && rule01OnCounterparty.kind === 'M3_RULE') {
      expect(rule01OnContract.rule).toBe(CONTRACT_LIFECYCLE_SUITE.M3!.rules[0]);
      expect(rule01OnCounterparty.rule).toBe(rule01OnContract.rule);
    }
    expect(rule01OnContract.isCrossObject).toBe(true);
    expect(rule01OnContract.relatedObjectIds).toEqual(['AGG-01', 'AGG-02']);
    expect(rule01OnContract.relatedObjects.map((o) => o.displayName)).toEqual([
      '合同',
      '签约相对方',
    ]);

    // RULE-02 only references Contract
    const rule02OnContract = contract.businessRules.find((r) => r.id === 'RULE-02')!;
    expect(rule02OnContract.isCrossObject).toBe(false);
    expect(rule02OnContract.relatedObjectIds).toEqual(['AGG-01']);
    expect(counterparty.businessRules.find((r) => r.id === 'RULE-02')).toBeUndefined();
    expect(settlement.businessRules.find((r) => r.id === 'RULE-02')).toBeUndefined();

    // RULE-03 references Contract & SettlementOrder
    const rule03OnContract = contract.businessRules.find((r) => r.id === 'RULE-03')!;
    const rule03OnSettlement = settlement.businessRules.find((r) => r.id === 'RULE-03')!;
    expect(rule03OnContract).toBe(rule03OnSettlement);
    expect(rule03OnContract.isCrossObject).toBe(true);
    expect(rule03OnContract.relatedObjectIds).toEqual(['AGG-01', 'AGG-03']);
  });

  it('deduplicates mixed id/name/alias references to the same aggregate and links rules across 3 objects via event subscriberEntityRef and parameterMapping', () => {
    const suite = structuredClone(CONTRACT_LIFECYCLE_SUITE);
    suite.M3!.rules.push({
      id: 'RULE-04',
      name: 'TriPartySettlementComplianceRule',
      alias: '三方资信与结算联动合规规则',
      ruleType: 'EVENT_DRIVEN',
      scope: 'CROSS_OBJECT',
      version: '1.0',
      // Mixes id, English name, and Chinese alias for Contract + alias for Counterparty
      referencedObjects: ['AGG-01', 'Contract', '合同', '签约相对方'],
      parameters: [],
      expression: 'Counterparty.status == "ACTIVE" && SettlementOrder.settlementAmount > 0',
      violationMessage: '三方合规校验未通过',
      triggeredByEvents: [],
      producedEvents: [],
      triggeredBehaviors: [
        {
          behaviorRef: 'BHV-EXTERNAL-UNMAPPED',
          parameterMapping: {
            settlementAmount: 'SettlementOrder.settlementAmount',
          },
        },
      ],
    });
    suite.ME!.events[2]!.subscribers.push({
      subscriberType: 'RULE',
      subscriberRef: 'RULE-04',
      subscriberEntityRef: '履约结算单',
      deliveryMode: 'SYNC',
    });

    const projection = projectByBusinessObject(suite);
    const [contract, counterparty, settlement] = projection.objects;

    const onContract = contract!.businessRules.filter((r) => r.id === 'RULE-04');
    const onCounterparty = counterparty!.businessRules.filter((r) => r.id === 'RULE-04');
    const onSettlement = settlement!.businessRules.filter((r) => r.id === 'RULE-04');

    // Appears exactly once on each of the 3 objects, and all 3 point to the identical instance
    expect(onContract).toHaveLength(1);
    expect(onCounterparty).toHaveLength(1);
    expect(onSettlement).toHaveLength(1);
    expect(onContract[0]).toBe(onCounterparty[0]);
    expect(onCounterparty[0]).toBe(onSettlement[0]);
    expect(onContract[0]!.relatedObjectIds).toEqual(['AGG-01', 'AGG-02', 'AGG-03']);
  });
});

describe('projectByBusinessObject: three cross-object views (M6, M5, M7)', () => {
  it('enriches flowsAndApprovals, rolesAndPermissions, and queriesAndReports on CONTRACT_LIFECYCLE_SUITE', () => {
    const projection = projectByBusinessObject(CONTRACT_LIFECYCLE_SUITE);

    // 1. M6 flowsAndApprovals
    expect(projection.flowsAndApprovals.flows).toHaveLength(1);
    const flow = projection.flowsAndApprovals.flows[0]!;
    expect(flow.id).toBe('FLW-01');
    expect(flow.displayName).toBe('合同起草与风险分级审批主流程');
    expect(flow.locator).toEqual({ model: 'M6', elementId: 'FLW-01' });
    expect(flow.primaryObject?.displayName).toBe('合同');
    // Invokes SCN-01 which spans Contract & SettlementOrder
    expect(flow.referencedObjects.map((o) => o.displayName)).toEqual(['合同', '履约结算单']);
    expect(flow.participatingRoles.map((r) => r.displayName)).toEqual([
      '合同专员角色',
      '法务审批主管角色',
    ]);
    const legalAct = flow.activities.find((a) => a.id === 'ACTV-LEGAL-APPROVE')!;
    expect(legalAct.role?.displayName).toBe('法务审批主管角色');
    expect(legalAct.action?.displayName).toBe('审批通过合同');
    expect(legalAct.screen?.displayName).toBe('法务风险会签与审批工作台');

    // 2. M5 rolesAndPermissions
    expect(projection.rolesAndPermissions.actors.map((a) => a.id)).toEqual([
      'ACT-01',
      'ACT-02',
      'ACT-EXT-ESIGN',
    ]);
    expect(projection.rolesAndPermissions.roles.map((r) => r.id)).toEqual([
      'ROLE-CONTRACT-SPEC',
      'ROLE-DEPT-MGR',
    ]);
    expect(projection.rolesAndPermissions.permissions).toHaveLength(5);

    const mgrRole = projection.rolesAndPermissions.roles.find((r) => r.id === 'ROLE-DEPT-MGR')!;
    expect(mgrRole.objectGrants.map((g) => g.object.displayName)).toEqual([
      '合同',
      '履约结算单',
    ]);
    expect(
      mgrRole.objectGrants.find((g) => g.object.id === 'AGG-03')?.actions.map((a) => a.displayName),
    ).toEqual(['生成首期履约结算单']);

    // 3. M7 queriesAndReports
    expect(projection.queriesAndReports.items.map((q) => q.id)).toEqual(['QRY-01', 'RPT-02']);
    expect(projection.queriesAndReports.queries.map((q) => q.id)).toEqual(['QRY-01']);
    expect(projection.queriesAndReports.reports.map((q) => q.id)).toEqual(['RPT-02']);

    const qry01 = projection.queriesAndReports.queries[0]!;
    expect(qry01.displayName).toBe('合同全量台账分页查询');
    expect(qry01.locator).toEqual({ model: 'M7', elementId: 'QRY-01' });
    expect(qry01.boundAction?.id).toBe('BHV-05');
    expect(qry01.sourceObjects.map((o) => o.displayName)).toEqual(['合同', '签约相对方']);
    expect(qry01.screens.map((s) => s.id)).toEqual(['SCR-CONTRACT-LIST']);

    const rpt02 = projection.queriesAndReports.reports[0]!;
    expect(rpt02.displayName).toBe('合同风险分级与履约结算统计报表');
    expect(rpt02.boundAction?.id).toBe('BHV-06');
    expect(rpt02.sourceObjects.map((o) => o.displayName)).toEqual(['合同', '履约结算单']);
  });

  it('resolves flow gateway branch ruleRef & subFlowRef objects, permissionGroups, and cyclic role inheritance without infinite loops', () => {
    const suite = structuredClone(CONTRACT_LIFECYCLE_SUITE);

    // Add gateway branch ruleRef (RULE-01 -> Counterparty) + subFlowRef cycle safety
    suite.M6!.flows[0]!.activities.find((a) => a.id === 'ACTV-RISK-GW')!.branches[0]!.ruleRef =
      'RULE-01';
    suite.M6!.flows.push({
      id: 'FLW-SUB-02',
      name: '相对方资信复核子流程',
      flowType: 'COLLABORATION',
      primaryAggregate: 'Counterparty',
      roleRefs: ['ROLE-DEPT-MGR'],
      trigger: { triggerType: 'SUB_FLOW' },
      activities: [
        {
          id: 'SUB-START',
          name: '开始',
          activityType: 'START',
          nextActivity: 'SUB-CALL-BACK',
          branches: [],
        },
        {
          id: 'SUB-CALL-BACK',
          name: '递归子流程测试节点',
          activityType: 'SUB_FLOW_CALL',
          subFlowRef: 'FLW-01',
          nextActivity: 'SUB-END',
          branches: [],
        },
        { id: 'SUB-END', name: '结束', activityType: 'END', branches: [] },
      ],
    });

    // Add permissionGroups + cyclic role inheritance (ROLE-A <-> ROLE-B)
    suite.M5!.permissionGroups = [
      {
        id: 'PG-COUNTERPARTY-AUDIT',
        name: '相对方资信核验权限组',
        permissions: ['PERM-CP-VIEW'],
      },
    ];
    suite.M5!.permissions.push({
      id: 'PERM-CP-VIEW',
      name: '查看相对方资信权限',
      code: 'counterparty:view',
      targetAggregate: 'Counterparty',
      allowedBehaviors: [],
      uiControlledElements: [],
    });
    suite.M5!.roles[0]!.inheritsFrom = ['ROLE-DEPT-MGR']; // Cycle: SPEC <-> MGR
    suite.M5!.roles[0]!.permissionGroups = ['PG-COUNTERPARTY-AUDIT'];

    const projection = projectByBusinessObject(suite);

    const flow01 = projection.flowsAndApprovals.flows.find((f) => f.id === 'FLW-01')!;
    expect(flow01.referencedObjects.map((o) => o.id)).toEqual(['AGG-01', 'AGG-02', 'AGG-03']);

    const subFlow02 = projection.flowsAndApprovals.flows.find((f) => f.id === 'FLW-SUB-02')!;
    expect(subFlow02.referencedObjects.map((o) => o.id)).toEqual([
      'AGG-01',
      'AGG-02',
      'AGG-03',
    ]);

    expect(projection.rolesAndPermissions.permissionGroups.map((pg) => pg.id)).toEqual([
      'PG-COUNTERPARTY-AUDIT',
    ]);
    // Both roles inherit PERM-CP-VIEW safely despite cycle, authorizing them on Counterparty
    const counterparty = projection.objects.find((o) => o.id === 'AGG-02')!;
    expect(counterparty.authorizedRoles.map((r) => r.roleId)).toEqual([
      'ROLE-CONTRACT-SPEC',
      'ROLE-DEPT-MGR',
    ]);
  });
});

describe('projectByBusinessObject: zero dropped elements ("不丢元素") and unassigned "other" group', () => {
  function collectAllProjectedLocators(
    projection: ReturnType<typeof projectByBusinessObject>,
  ): Set<string> {
    const seen = new Set<string>();
    const add = (model: string, elementId: string) => seen.add(`${model}:${elementId}`);

    for (const obj of projection.objects) {
      add(obj.locator.model, obj.locator.elementId);
      for (const d of obj.dictionaries) add(d.locator.model, d.locator.elementId);
      for (const assoc of obj.associations) add(assoc.locator.model, assoc.locator.elementId);
      for (const act of obj.actions) add(act.locator.model, act.locator.elementId);
      for (const r of obj.businessRules) {
        if (r.kind === 'M3_RULE') add(r.locator.model, r.locator.elementId);
      }
      for (const ev of obj.events) add(ev.locator.model, ev.locator.elementId);
      for (const sc of obj.automations) add(sc.locator.model, sc.locator.elementId);
      for (const scr of obj.screens) {
        add(scr.locator.model, scr.locator.elementId);
        for (const edge of scr.navigationEdges) add('MU', edge.id);
        for (const cc of scr.crossCuttingUi) add('MU', cc.id);
      }
      for (const intf of obj.integrations) add(intf.locator.model, intf.locator.elementId);
      for (const st of obj.dataStorage) add(st.locator.model, st.locator.elementId);
    }

    for (const fl of projection.flowsAndApprovals.flows) {
      add(fl.locator.model, fl.locator.elementId);
    }
    for (const act of projection.rolesAndPermissions.actors) {
      add(act.locator.model, act.locator.elementId);
    }
    for (const role of projection.rolesAndPermissions.roles) {
      add(role.locator.model, role.locator.elementId);
    }
    for (const pg of projection.rolesAndPermissions.permissionGroups) {
      add(pg.locator.model, pg.locator.elementId);
    }
    for (const perm of projection.rolesAndPermissions.permissions) {
      add(perm.locator.model, perm.locator.elementId);
    }
    for (const qr of projection.queriesAndReports.items) {
      add(qr.locator.model, qr.locator.elementId);
    }
    for (const item of projection.other) {
      add(item.locator.model, item.locator.elementId);
    }

    return seen;
  }

  function collectAllSuiteElementKeys(suite: typeof CONTRACT_LIFECYCLE_SUITE): string[] {
    const keys: string[] = [];
    for (const a of suite.M1?.aggregates ?? []) keys.push(`M1:${a.id}`);
    for (const d of suite.M1?.data_dictionaries ?? []) keys.push(`M1:${d.id}`);
    for (const assoc of suite.M1?.aggregate_associations ?? []) keys.push(`M1:${assoc.id}`);
    for (const b of suite.M2?.behaviors ?? []) keys.push(`M2:${b.id}`);
    for (const r of suite.M3?.rules ?? []) keys.push(`M3:${r.id}`);
    for (const e of suite.ME?.events ?? []) keys.push(`ME:${e.id}`);
    for (const s of suite.M4?.event_scenarios ?? []) keys.push(`M4:${s.id}`);
    for (const a of suite.M5?.actors ?? []) keys.push(`M5:${a.id}`);
    for (const r of suite.M5?.roles ?? []) keys.push(`M5:${r.id}`);
    for (const pg of suite.M5?.permissionGroups ?? []) keys.push(`M5:${pg.id}`);
    for (const p of suite.M5?.permissions ?? []) keys.push(`M5:${p.id}`);
    for (const f of suite.M6?.flows ?? []) keys.push(`M6:${f.id}`);
    for (const q of suite.M7?.query_reports ?? []) keys.push(`M7:${q.id}`);
    for (const s of suite.MU?.screens ?? []) keys.push(`MU:${s.screenId}`);
    for (const n of suite.MU?.navigation_edges ?? []) keys.push(`MU:${n.id}`);
    for (const cc of suite.MU?.cross_cutting_ui ?? []) keys.push(`MU:${cc.id}`);
    for (const m of suite.MM?.mappings ?? []) keys.push(`MM:${m.id}`);
    for (const i of suite.MI?.interfaces ?? []) keys.push(`MI:${i.interfaceId}`);
    return keys;
  }

  it('accounts for 100% of elements across all 11 models in CONTRACT_LIFECYCLE_SUITE with zero unassigned items', () => {
    const projection = projectByBusinessObject(CONTRACT_LIFECYCLE_SUITE);
    const projectedKeys = collectAllProjectedLocators(projection);
    const suiteKeys = collectAllSuiteElementKeys(CONTRACT_LIFECYCLE_SUITE);

    expect(suiteKeys.length).toBeGreaterThan(25);
    for (const key of suiteKeys) {
      expect(projectedKeys.has(key), `Expected projected output to contain ${key}`).toBe(true);
    }
    expect(projection.other).toEqual([]);
  });

  it('propagates rule-produced ME events to downstream MI event integrations onto the rule owner object', () => {
    const suite = structuredClone(CONTRACT_LIFECYCLE_SUITE);
    suite.ME!.events.push({
      id: 'EVT-RULE-04',
      name: 'Contract.HighRiskEscalated',
      label: '高风险合同升级告警事件',
      producerType: 'RULE',
      producerBehaviorRef: '',
      producerRuleRef: 'RULE-02', // RULE-02 belongs to Contract
      sourceAggregate: '',
      orderingSemantic: 'AT_LEAST_ONCE',
      payload: [],
      subscribers: [],
    });
    suite.MI!.interfaces.push({
      interfaceId: 'IF-EVENT-WEBHOOK-04',
      name: '推送高风险合同升级Webhook接口',
      direction: 'PROVIDED',
      interfaceCategory: 'EVENT',
      protocol: 'WEBHOOK',
      format: 'JSON',
      relatedEventRef: 'EVT-RULE-04',
      inputFields: [],
      outputFields: [],
      returnRules: [],
    });

    const projection = projectByBusinessObject(suite);
    const contract = projection.objects.find((o) => o.id === 'AGG-01')!;

    expect(contract.events.map((e) => e.id)).toContain('EVT-RULE-04');
    expect(contract.integrations.map((i) => i.id)).toContain('IF-EVENT-WEBHOOK-04');
    expect(projection.other).toEqual([]);
  });

  it('places orphan elements across all object-scoped models into "other" while keeping M5/M6/M7 in cross-object views, including when M1 is absent', () => {
    const suiteWithOrphans = structuredClone(CONTRACT_LIFECYCLE_SUITE);

    suiteWithOrphans.M1!.data_dictionaries.push({
      id: 'DICT-ORPHAN',
      name: '未绑定全局枚举字典',
      types: [],
    });
    suiteWithOrphans.M1!.aggregate_associations.push({
      id: 'ASSOC-ORPHAN',
      sourceAggregate: 'GhostA',
      targetAggregate: 'GhostB',
      associationType: 'REFERENCE',
      sourceRole: '幽灵源',
      targetRole: '幽灵目标',
      cardinality: 'ONE_TO_ONE',
      referenceField: 'ghostId',
    });
    suiteWithOrphans.M2!.behaviors.push({
      id: 'BHV-ORPHAN',
      name: 'purgeSystemCache',
      alias: '清理系统缓存',
      ownerEntity: 'GhostSystem',
      behaviorType: 'COMMAND',
      triggerType: 'SYSTEM',
      inputParameters: [],
      outputParameters: [],
      preconditions: [],
      stateChanges: [],
      invokedRules: [],
      producedEvents: [],
      requiredPermissions: [],
    });
    suiteWithOrphans.M3!.rules.push({
      id: 'RULE-ORPHAN',
      name: 'GlobalMaintenanceWindowRule',
      alias: '系统维护窗口禁写规则',
      ruleType: 'POLICY',
      scope: 'REUSABLE',
      version: '1.0',
      referencedObjects: [],
      parameters: [],
      expression: 'now() not in maintenanceWindow',
      triggeredByEvents: [],
      producedEvents: [],
      triggeredBehaviors: [],
    });
    suiteWithOrphans.ME!.events.push({
      id: 'EVT-ORPHAN',
      name: 'System.Heartbeat',
      label: '系统心跳事件',
      producerType: 'BEHAVIOR',
      producerBehaviorRef: 'BHV-ORPHAN',
      sourceAggregate: 'GhostSystem',
      orderingSemantic: 'BEST_EFFORT',
      payload: [],
      subscribers: [],
    });
    suiteWithOrphans.M4!.event_scenarios.push({
      id: 'SCN-ORPHAN',
      name: '孤立自动巡检联动',
      triggerEventRef: 'EVT-ORPHAN',
      involvedAggregates: ['GhostSystem'],
      preconditions: [],
      postconditions: [],
      steps: [],
    });
    suiteWithOrphans.MU!.screens.push({
      screenId: 'SCR-ORPHAN-LOGIN',
      name: '统一登录页',
      screenType: 'FORM',
      roleRefs: [],
      elements: [],
      events: [],
    });
    suiteWithOrphans.MU!.navigation_edges.push({
      id: 'NAV-ORPHAN',
      fromScreen: 'SCR-ORPHAN-LOGIN',
      toScreen: 'EXIT',
      mode: 'REPLACE',
    });
    suiteWithOrphans.MU!.cross_cutting_ui.push({
      id: 'CC-GLOBAL-TIMEOUT',
      name: '全局会话超时锁屏',
      type: 'TIMEOUT',
      scopeScreens: ['*'],
    });
    suiteWithOrphans.MM!.mappings.push({
      id: 'MAP-ORPHAN',
      objectRef: 'AGG-GHOST',
      objectRole: 'AGGREGATE_ROOT',
      objectName: 'GhostSystem',
      tableMappings: [{ tableName: 't_sys_audit', tableRole: 'LOG', primaryKey: 'id', foreignKeys: [], columnMappings: [] }],
    });
    suiteWithOrphans.MI!.interfaces.push({
      interfaceId: 'IF-ORPHAN-HEALTH',
      name: '健康检查探针接口',
      direction: 'PROVIDED',
      interfaceCategory: 'QUERY',
      protocol: 'REST',
      format: 'JSON',
      inputFields: [],
      outputFields: [],
      returnRules: [],
    });

    const projection = projectByBusinessObject(suiteWithOrphans);

    expect(projection.other.map((o) => ({ id: o.id, kind: o.kind, model: o.locator.model }))).toEqual([
      { id: 'DICT-ORPHAN', kind: 'DATA_DICTIONARY', model: 'M1' },
      { id: 'ASSOC-ORPHAN', kind: 'ASSOCIATION', model: 'M1' },
      { id: 'BHV-ORPHAN', kind: 'ACTION', model: 'M2' },
      { id: 'RULE-ORPHAN', kind: 'RULE', model: 'M3' },
      { id: 'EVT-ORPHAN', kind: 'EVENT', model: 'ME' },
      { id: 'SCN-ORPHAN', kind: 'AUTOMATION', model: 'M4' },
      { id: 'SCR-ORPHAN-LOGIN', kind: 'SCREEN', model: 'MU' },
      { id: 'NAV-ORPHAN', kind: 'NAVIGATION_EDGE', model: 'MU' },
      { id: 'CC-GLOBAL-TIMEOUT', kind: 'CROSS_CUTTING_UI', model: 'MU' },
      { id: 'MAP-ORPHAN', kind: 'DATA_STORAGE', model: 'MM' },
      { id: 'IF-ORPHAN-HEALTH', kind: 'INTEGRATION', model: 'MI' },
    ]);

    const allProjected = collectAllProjectedLocators(projection);
    for (const key of collectAllSuiteElementKeys(suiteWithOrphans)) {
      expect(allProjected.has(key), `Missing ${key}`).toBe(true);
    }

    // When M1 is completely absent, objects is [] and zero elements are dropped
    const { M1: _omitted, ...suiteWithoutM1 } = CONTRACT_LIFECYCLE_SUITE;
    const noM1Projection = projectByBusinessObject(suiteWithoutM1);
    expect(noM1Projection.objects).toEqual([]);
    const noM1ProjectedKeys = collectAllProjectedLocators(noM1Projection);
    for (const key of collectAllSuiteElementKeys(suiteWithoutM1)) {
      expect(noM1ProjectedKeys.has(key), `Missing ${key} when M1 is absent`).toBe(true);
    }
  });

  it('handles an empty suite {} and remains pure and deterministic without mutating input', () => {
    const emptyProj = projectByBusinessObject({});
    expect(emptyProj).toEqual({
      objects: [],
      sharedRules: [],
      flowsAndApprovals: { flows: [] },
      rolesAndPermissions: {
        roles: [],
        actors: [],
        permissionGroups: [],
        permissions: [],
      },
      queriesAndReports: { items: [], queries: [], reports: [] },
      other: [],
    });

    const snapshotBefore = structuredClone(CONTRACT_LIFECYCLE_SUITE);
    const first = projectByBusinessObject(CONTRACT_LIFECYCLE_SUITE);
    const second = projectByBusinessObject(CONTRACT_LIFECYCLE_SUITE);
    expect(CONTRACT_LIFECYCLE_SUITE).toEqual(snapshotBefore);
    expect(first).toEqual(second);
  });
});
