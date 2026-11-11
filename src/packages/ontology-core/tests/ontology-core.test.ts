import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_LIFECYCLE_SUITE,
  CONTRACT_PROTOTYPE_HTML,
  MFT_ENTERPRISE_SUITE,
  analyzeImpact,
  buildKnowledgeGraph,
  exportToOwl,
  extractLayoutElementIds,
  extractMuFromPrototypeHtml,
  isRelativeManifestPath,
  parseManifestJson,
  parseModelYaml,
  parseSuiteFromYamlFiles,
  renameOntologySymbol,
  serializeManifestJson,
  serializeSuiteToYamlFiles,
  validateOntologySuite,
  type OntologySuite,
} from '../index.js';

function cloneSuite(suite: OntologySuite): OntologySuite {
  return JSON.parse(JSON.stringify(suite)) as OntologySuite;
}

describe('ontology-core deep module', () => {
  it('validates the full 11-model Contract Lifecycle Management benchmark suite with zero errors and zero warnings', () => {
    const report = validateOntologySuite(CONTRACT_LIFECYCLE_SUITE);
    expect(report.diagnostics.filter((d) => d.tier === 'ERROR')).toEqual([]);
    expect(report.valid).toBe(true);
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
    expect(report.presentModels).toHaveLength(11);
    expect(report.missingModels).toHaveLength(0);
  });

  it('produces non-blocking STAGE_WARNING diagnostics for progressive partial suites (MFT 5-model suite)', () => {
    const report = validateOntologySuite(MFT_ENTERPRISE_SUITE);
    expect(report.diagnostics.filter((d) => d.tier === 'ERROR')).toEqual([]);
    expect(report.valid).toBe(true);
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(6);
    expect(report.diagnostics.every((d) => d.tier === 'STAGE_WARNING')).toBe(true);
  });

  it('detects cross-model consistency errors across M1, M2, M6, M7, ME, and MU', () => {
    const broken = cloneSuite(CONTRACT_LIFECYCLE_SUITE);

    // 1. Break M1 attribute refRule expression (omit `value`)
    broken.M1!.aggregates[0].attributes[0].refRules![0].expression = 'contractNo != null';

    // 2. Break M2-M7 1-to-1 link
    broken.M2!.behaviors.find((b) => b.id === 'BHV-05')!.queryReportRef = 'NON-EXISTENT-RPT';

    // 3. Break M7 SQL parameter binding
    broken.M7!.query_reports[0].referenceSql.sql += ' AND c.dept = :undeclaredDept';

    // 4. Break MU layout [elementId] and callChain order
    broken.MU!.screens[0].layout += '\n| [EL-GHOST-WIDGET] |';
    broken.MU!.screens[1].events[0].callChain = [
      { stepOrder: 1, stepType: 'EVENT_EMIT', refId: 'EVT-01' },
      { stepOrder: 2, stepType: 'VALIDATE', refId: 'RULE-01' },
    ];

    const report = validateOntologySuite(broken);
    expect(report.valid).toBe(false);
    const codes = report.diagnostics.map((d) => d.code);
    expect(codes).toContain('M1_REFRULE_INVALID_EXPRESSION');
    expect(codes).toContain('M2_DANGLING_QUERY_REPORT_REF');
    expect(codes).toContain('M7_UNDECLARED_SQL_PARAMETER');
    expect(codes).toContain('MU_LAYOUT_UNKNOWN_ELEMENT');
    expect(codes).toContain('MU_INVALID_CALL_CHAIN_ORDER');
  });

  it('validates manifest.json relative paths per §14.3 and rejects absolute/traversal/backslash paths', () => {
    expect(isRelativeManifestPath('m1-object-model.yaml')).toBe(true);
    expect(isRelativeManifestPath('models/m7-report-model.yaml')).toBe(true);
    expect(isRelativeManifestPath('/etc/passwd')).toBe(false);
    expect(isRelativeManifestPath('C:\\Ontology\\m1.yaml')).toBe(false);
    expect(isRelativeManifestPath('D:/Ontology/m1.yaml')).toBe(false);
    expect(isRelativeManifestPath('../secret/m1.yaml')).toBe(false);
    expect(isRelativeManifestPath('models\\m1.yaml')).toBe(false);

    const validJson = serializeManifestJson({
      version: '1.0',
      projectId: 'contract-clm',
      domain: '合同全生命周期管理系统',
      models: {
        M1: 'm1-object-model.yaml',
        MU: 'ui/mu-ui-model.yaml',
      },
    });
    const parsed = parseManifestJson(validJson);
    expect(parsed.projectId).toBe('contract-clm');
    expect(parsed.models.M1).toBe('m1-object-model.yaml');

    expect(() =>
      parseManifestJson(
        JSON.stringify({
          projectId: 'bad',
          domain: 'test',
          models: { M1: '/abs/m1-object-model.yaml' },
        }),
      ),
    ).toThrow(/relative path/i);

    expect(() =>
      parseManifestJson(
        JSON.stringify({
          projectId: 'bad',
          domain: 'test',
          models: { M1: '../escape/m1-object-model.yaml' },
        }),
      ),
    ).toThrow(/relative path/i);
  });

  it('normalizes canonical framework YAML templates and upstream Onto-Model sample YAML files cleanly', () => {
    // 1. Canonical M2/M3/ME/M4/M5/M6/M7/MU/MI shapes from ontology-plus-framework.md Chapters 3–12
    const m2 = parseModelYaml(
      'M2',
      `
model_type: BEHAVIOR
domain: OrderDomain
behaviors:
  - behaviorId: BHV-ORD-01
    name: submitOrder
    alias: 提交订单
    owner: Order
    behaviorType: COMMAND
    triggerType: USER_ACTION
    appliedRules: [RULE-ORD-01]
    postconditions:
      - targetField: Order.status
        changeType: TRANSITION
        expression: "'DRAFT' -> 'SUBMITTED'"
    emittedEvents: [EVT-ORD-01]
    syncTriggers:
      - ruleRef: RULE-ORD-01
        behaviorRef: BHV-ORD-02
`,
    );
    expect(m2.behaviors[0].id).toBe('BHV-ORD-01');
    expect(m2.behaviors[0].ownerEntity).toBe('Order');
    expect(m2.behaviors[0].invokedRules).toEqual(['RULE-ORD-01']);
    expect(m2.behaviors[0].stateChanges[0].targetField).toBe('Order.status');
    expect(m2.behaviors[0].producedEvents).toEqual(['EVT-ORD-01']);

    const m3 = parseModelYaml(
      'M3',
      `
model_type: RULE
domain: OrderDomain
rules:
  - ruleId: RULE-ORD-01
    name: OrderCreditRule
    alias: 信用规则
    ruleType: EVENT_DRIVEN
    scope: EVENT_DRIVEN
    inputParams:
      - name: amount
        type: Money
        sourceField: Order.amount
    subscribedEvents: [EVT-ORD-01]
    expression: "Order.amount > 0"
`,
    );
    expect(m3.rules[0].id).toBe('RULE-ORD-01');
    expect(m3.rules[0].parameters[0].source).toBe('Order.amount');
    expect(m3.rules[0].triggeredByEvents).toEqual(['EVT-ORD-01']);

    const me = parseModelYaml(
      'ME',
      `
model_type: EVENT
domain: OrderDomain
events:
  - eventId: EVT-ORD-01
    name: Order.Submitted
    alias: 订单已提交
    producerType: RULE
    producerRuleRef: RULE-ORD-01
    sourceObject: Order
    subscribers:
      - subscriberBehaviorRef: BHV-ORD-02
        subscriberEntityRef: Inventory
        deliveryMode: SYNC
`,
    );
    expect(me.events[0].id).toBe('EVT-ORD-01');
    expect(me.events[0].producerType).toBe('RULE');
    expect(me.events[0].producerRuleRef).toBe('RULE-ORD-01');
    expect(me.events[0].subscribers[0].subscriberType).toBe('BEHAVIOR');
    expect(me.events[0].subscribers[0].subscriberRef).toBe('BHV-ORD-02');

    const m5 = parseModelYaml(
      'M5',
      `
model_type: ACTOR
domain: OrderDomain
actors:
  - actorId: ACT-EXT-01
    name: 外部支付网关
    actorType: EXTERNAL
    externalContract:
      protocol: HTTPS
`,
    );
    expect(m5.actors[0].id).toBe('ACT-EXT-01');
    expect(m5.actors[0].actorType).toBe('EXTERNAL_ENTITY');

    const m7 = parseModelYaml(
      'M7',
      `
model_type: REPORT
domain: OrderDomain
reports:
  - reportId: RPT-ORD-01
    name: OrderListQuery
    alias: 订单列表查询
    reportType: LIST_QUERY
    behaviorRef: BHV-ORD-QRY
    sourceObjects:
      - objectRef: Order
        alias: o
        primary: true
      - objectRef: Customer
        alias: c
        preAggregation:
          groupBy: [c.id]
          columns:
            - name: orderCnt
              sourceExpression: COUNT(c.id)
              aggregateFunction: COUNT
    joins:
      - joinType: LEFT_JOIN
        leftSource: o
        rightSource: c
        onCondition: o.customer_id = c.id
    selectFields:
      - fieldName: orderNo
        label: 订单号
        expression: o.order_no
        dataType: String
    sqlTemplate: "SELECT o.order_no FROM t_order o"
`,
    );
    expect(m7.query_reports[0].id).toBe('RPT-ORD-01');
    expect(m7.query_reports[0].queryType).toBe('LIST_QUERY');
    expect(m7.query_reports[0].primarySource.aggregateRef).toBe('Order');
    expect(m7.query_reports[0].joins[0].aggregateRef).toBe('Customer');
    expect(m7.query_reports[0].joins[0].preAggregated).toBe(true);

    const mi = parseModelYaml(
      'MI',
      `
model_type: INTERFACE
domain: OrderDomain
interfaces:
  - interfaceId: IF-ORD-01
    name: 创建订单接口
    direction: PROVIDED
    category: COMMAND
    relatedBehaviorRef: BHV-ORD-01
    inputFields:
      - name: lines
        label: 明细列表
        type: Array
        required: true
        fields:
          - name: skuCode
            label: 商品编码
            type: String
            mappedRef: Order.OrderLine[].skuCode
`,
    );
    expect(mi.interfaces[0].inputFields[0].fields?.[0].mappedRef).toBe('Order.OrderLine[].skuCode');

    const m6 = parseModelYaml(
      'M6',
      `
model_type: FLOW
domain: OrderDomain
flows:
  - flowId: FLW-ORD-01
    name: 订单审批流
    flowType: APPROVAL
    businessObjectRefs: [Order]
    roleRefs: [ROLE-MGR]
    trigger:
      triggerType: BEHAVIOR
      behaviorRef: BHV-ORD-01
    activities:
      - activityId: ACT-01
        name: 开始
        activityType: START
        nextActivities: [ACT-02]
      - activityId: ACT-02
        name: 主管审批
        activityType: APPROVAL_TASK
        roleRef: ROLE-MGR
        nextActivities: [ACT-03]
      - activityId: ACT-03
        name: 审批路由
        activityType: GATEWAY
        branches:
          - branchName: 通过
            conditionExpression: "outcome == 'APPROVED'"
            targetActivity: ACT-04
          - branchName: 驳回
            isDefault: true
            targetActivity: ACT-04
      - activityId: ACT-04
        name: 结束
        activityType: END
`,
    );
    expect(m6.flows[0].id).toBe('FLW-ORD-01');
    expect(m6.flows[0].primaryAggregate).toBe('Order');
    expect(m6.flows[0].activities[0].nextActivity).toBe('ACT-02');
    expect(m6.flows[0].activities[2].branches[0].condition).toBe("outcome == 'APPROVED'");

    const mu = parseModelYaml(
      'MU',
      `
model_type: UI
domain: OrderDomain
screens:
  - screenId: SCR-ORD-01
    name: 订单列表
    screenType: QUERY_LIST
    elements:
      - id: tbrMain
        type: TOOLBAR
        label: 工具栏
      - id: btnClose
        type: BUTTON
        label: 退出
    events:
      - eventId: SCR-ORD-01.btnClose_Click
        name: 点击退出
        callChain:
          - step: NAVIGATE
            to: EXIT
`,
    );
    expect(mu.screens[0].elements[0].elementId).toBe('tbrMain');
    expect(mu.screens[0].events[0].triggerElementId).toBe('btnClose');
    expect(mu.screens[0].events[0].callChain[0].refId).toBe('EXIT');

    // 2. Real upstream sample files in references/Onto-Model/sample/
    const sampleDir = path.resolve(process.cwd(), 'references/Onto-Model/sample');
    if (fs.existsSync(sampleDir)) {
      const rawFiles: Record<string, string> = {};
      for (const entry of fs.readdirSync(sampleDir)) {
        if (entry.endsWith('.yaml')) {
          rawFiles[entry] = fs.readFileSync(path.join(sampleDir, entry), 'utf8');
        }
      }
      const { suite: sampleSuite, parseErrors } = parseSuiteFromYamlFiles(rawFiles);
      expect(parseErrors).toEqual([]);
      expect(sampleSuite.M1?.aggregates.length).toBeGreaterThan(0);
      expect(sampleSuite.M2?.behaviors.length).toBeGreaterThan(0);
      expect(sampleSuite.M3?.rules.length).toBeGreaterThan(0);
      expect(sampleSuite.ME?.events.length).toBeGreaterThan(0);
      expect(sampleSuite.M4?.event_scenarios.length).toBeGreaterThan(0);
      expect(sampleSuite.M5?.roles.length).toBeGreaterThan(0);
    }
  });

  it('enforces M1 sub-entity/VO rules, dictionary defaultValue, association field, and bidirectional M2<->M7 1:1 checks', () => {
    const suite = cloneSuite(CONTRACT_LIFECYCLE_SUITE);

    // M1 sub-entity refRule missing `value`
    suite.M1!.aggregates[0].entities[0].attributes[1].refRules![0].expression = 'quantity > 0';
    // M1 DictionaryRef invalid defaultValue
    suite.M1!.aggregates[0].attributes[2].defaultValue = 'NON_EXISTENT_CODE';
    // M1 association unknown referenceField
    suite.M1!.aggregate_associations[0].referenceField = 'ghostFieldId';
    // M2<->M7 1:1 broken by omitting queryReportRef on QUERY behavior while M7 still points to it
    delete suite.M2!.behaviors.find((b) => b.id === 'BHV-05')!.queryReportRef;

    const report = validateOntologySuite(suite);
    const codes = report.diagnostics.map((d) => d.code);
    expect(codes).toContain('M1_REFRULE_INVALID_EXPRESSION');
    expect(codes).toContain('M1_INVALID_DICTIONARY_DEFAULT');
    expect(codes).toContain('M1_DANGLING_ASSOCIATION_FIELD');
    expect(codes).toContain('M2_M7_ONE_TO_ONE_MISMATCH');
  });

  it('enforces M4 cross-aggregate constraint, M5 role inheritance cycles, and M6 flow graph invariants', () => {
    const suite = cloneSuite(CONTRACT_LIFECYCLE_SUITE);

    // M4 single-aggregate scenario violation
    suite.M4!.event_scenarios[0].involvedAggregates = ['Contract'];
    suite.M4!.event_scenarios[0].sourceObjectRef = 'Contract';
    suite.M4!.event_scenarios[0].targetObjectRefs = ['Contract'];
    for (const st of suite.M4!.event_scenarios[0].steps) {
      st.targetAggregate = 'Contract';
      if (st.stepType === 'BEHAVIOR_CALL') st.refId = 'BHV-01';
    }

    // M5 role inheritance cycle: ROLE-CONTRACT-SPEC -> ROLE-DEPT-MGR -> ROLE-CONTRACT-SPEC
    suite.M5!.roles[0].inheritsFrom = ['ROLE-DEPT-MGR'];

    // M6 unreachable node, dead-end node, gateway missing condition, approval missing reject path, sub-flow cycle
    const flow = suite.M6!.flows[0];
    flow.activities.find((a) => a.id === 'ACTV-LEGAL-APPROVE')!.nextActivity = 'ACTV-AUTO-EFFECT';
    flow.activities.find((a) => a.id === 'ACTV-RISK-GW')!.branches[0].condition = undefined;
    flow.activities.push({
      id: 'ACTV-ORPHAN',
      name: '孤立自递归子流程节点',
      activityType: 'SUB_FLOW_CALL',
      subFlowRef: 'FLW-01',
      branches: [],
    });

    const report = validateOntologySuite(suite);
    const codes = report.diagnostics.map((d) => d.code);
    expect(codes).toContain('M4_SINGLE_AGGREGATE_SCENARIO');
    expect(codes).toContain('M5_ROLE_INHERITANCE_CYCLE');
    expect(codes).toContain('M6_APPROVAL_MISSING_REJECT_PATH');
    expect(codes).toContain('M6_GATEWAY_BRANCH_MISSING_CONDITION');
    expect(codes).toContain('M6_UNREACHABLE_ACTIVITY');
    expect(codes).toContain('M6_DEAD_END_ACTIVITY');
    expect(codes).toContain('M6_SUB_FLOW_CYCLE');
  });

  it('enforces M7 multi-join fan-out check, MU layout notations & EXIT & pure VALIDATE rules, MM detail FK & attributeRef, MI refs, and 8 reverse-traceability checks', () => {
    // Layout token parser check for [btn], (cbo), {tbr}, @grd
    const layoutTokens = extractLayoutElementIds(
      '| {tbrMain} |\n| [txtKeyword*] (cboStatus) @grdLedger (SCR-CONTRACT-LIST) |',
    );
    expect(layoutTokens).toEqual([
      { elementId: 'txtKeyword', requiredInLayout: true },
      { elementId: 'tbrMain', requiredInLayout: false },
      { elementId: 'cboStatus', requiredInLayout: false },
      { elementId: 'grdLedger', requiredInLayout: false },
    ]);

    // NAVIGATE: EXIT is valid without triggering MU_DANGLING_NAVIGATE_SCREEN
    const exitSuite = cloneSuite(CONTRACT_LIFECYCLE_SUITE);
    exitSuite.MU!.screens[0].events[0].callChain.push({
      stepOrder: 3,
      stepType: 'NAVIGATE',
      refId: 'EXIT',
    });
    expect(validateOntologySuite(exitSuite).errorCount).toBe(0);

    // Break M7 fan-out, MU VALIDATE side-effect rule, MM detail FK & attributeRef, MI duplicate, and reverse-traceability
    const broken = cloneSuite(CONTRACT_LIFECYCLE_SUITE);
    broken.M7!.query_reports[1].joins = [
      {
        joinType: 'LEFT',
        aggregateRef: 'SettlementOrder',
        alias: 'so1',
        onCondition: 'c.id = so1.contract_ref',
      },
      {
        joinType: 'LEFT',
        aggregateRef: 'Counterparty',
        alias: 'cp1',
        onCondition: 'c.counterparty_id = cp1.id',
      },
    ];
    // MU VALIDATE invoking RULE-03 (which triggers BHV-04)
    broken.MU!.screens[2].events[0].callChain[0].refId = 'RULE-03';
    // Reverse traceability mismatches
    broken.M1!.aggregates[0].uiBindings!.push('SCR-NON-EXISTENT');
    broken.M2!.behaviors[0].uiEventRefs = ['UIE-NON-EXISTENT'];
    broken.M3!.rules[0].uiValidationRefs = ['SCR-CONTRACT-EDIT'];
    broken.ME!.events[0].uiEventPath = 'SCR-GHOST -> UIE-GHOST';
    broken.M4!.event_scenarios[0].uiTriggerScreen = 'SCR-CONTRACT-LIST';
    broken.M5!.permissions[0].uiControlledElements.push('EL-GHOST');
    broken.M6!.flows[0].activities[1].screenRef = 'SCR-GHOST';
    broken.M7!.query_reports[0].uiScreenRefs = ['SCR-CONTRACT-APPROVAL'];
    // MM detail table without FK + dangling attributeRef
    broken.MM!.mappings[0].tableMappings[1].foreignKeys = [];
    broken.MM!.mappings[0].tableMappings[1].columnMappings = [
      {
        attributeRef: 'Contract.unknownColumnAttr',
        column: 'bad_col',
        columnType: 'VARCHAR(32)',
      },
    ];
    // MI duplicate ID & dangling entity/report ref
    broken.MI!.interfaces.push({
      ...broken.MI!.interfaces[0],
      relatedEntityRef: 'UnknownAggregate',
      relatedReportRef: 'RPT-GHOST',
    });

    const report = validateOntologySuite(broken);
    const codes = report.diagnostics.map((d) => d.code);
    expect(codes).toContain('M7_MULTI_JOIN_FANOUT_RISK');
    expect(codes).toContain('MU_VALIDATE_RULE_HAS_SIDE_EFFECTS');
    expect(codes).toContain('M1_DANGLING_UI_BINDING');
    expect(codes).toContain('M2_DANGLING_UI_EVENT_REF');
    expect(codes).toContain('M3_DANGLING_UI_VALIDATION_REF');
    expect(codes).toContain('ME_DANGLING_UI_EVENT_PATH');
    expect(codes).toContain('M4_DANGLING_UI_TRIGGER_SCREEN');
    expect(codes).toContain('M5_DANGLING_UI_CONTROLLED_ELEMENT');
    expect(codes).toContain('M6_DANGLING_SCREEN_REF');
    expect(codes).toContain('M7_DANGLING_UI_SCREEN_REF');
    expect(codes).toContain('MM_DETAIL_MISSING_MASTER_FK');
    expect(codes).toContain('MM_DANGLING_ATTRIBUTE_REF');
    expect(codes).toContain('MI_DUPLICATE_INTERFACE_ID');
    expect(codes).toContain('MI_DANGLING_ENTITY_REF');
    expect(codes).toContain('MI_DANGLING_REPORT_REF');
  });

  it('performs impact analysis and cascade rename across all 11 models (aggregates, roles, UI elements) while preserving zero validation errors', () => {
    const impact = analyzeImpact(CONTRACT_LIFECYCLE_SUITE, 'Contract');
    expect(impact.canDeleteSafely).toBe(false);
    expect(impact.references.length).toBeGreaterThan(10);

    const renamed = renameOntologySymbol(
      CONTRACT_LIFECYCLE_SUITE,
      'Contract',
      'CommercialAgreement',
    );
    expect(renamed.changedReferences.length).toBe(impact.references.length);
    expect(renamed.changelogEntry).toContain('Cascade Rename `Contract` -> `CommercialAgreement`');

    const postValidation = validateOntologySuite(renamed.suite);
    expect(postValidation.diagnostics.filter((d) => d.tier === 'ERROR')).toEqual([]);
    expect(postValidation.valid).toBe(true);
    expect(postValidation.errorCount).toBe(0);

    // Cascade rename on Role (including M5 Role.inheritsFrom, M6 Flow, and MU Screen roleRefs)
    const roleImpact = analyzeImpact(CONTRACT_LIFECYCLE_SUITE, 'ROLE-CONTRACT-SPEC');
    const roleRenamed = renameOntologySymbol(
      CONTRACT_LIFECYCLE_SUITE,
      'ROLE-CONTRACT-SPEC',
      'ROLE-AGREEMENT-SPEC',
    );
    expect(roleRenamed.changedReferences.length).toBe(roleImpact.references.length);
    expect(validateOntologySuite(roleRenamed.suite).errorCount).toBe(0);

    // Cascade rename on UI Element (including MU ASCII layout [EL-BTN-SEARCH], M5 uiControlledElements, UIEvent triggerElementId)
    const elImpact = analyzeImpact(CONTRACT_LIFECYCLE_SUITE, 'EL-BTN-SEARCH');
    const elRenamed = renameOntologySymbol(
      CONTRACT_LIFECYCLE_SUITE,
      'EL-BTN-SEARCH',
      'EL-BTN-QUERY-LEDGER',
    );
    expect(elRenamed.changedReferences.length).toBe(elImpact.references.length);
    expect(validateOntologySuite(elRenamed.suite).errorCount).toBe(0);
  });

  it('round-trips all 11 models through YAML files and builds non-dangling Knowledge Graph + full 11-model OWL XML + valid MU extraction', () => {
    const files = serializeSuiteToYamlFiles(CONTRACT_LIFECYCLE_SUITE);
    expect(Object.keys(files)).toHaveLength(11);

    const { suite: parsed, parseErrors } = parseSuiteFromYamlFiles(files);
    expect(parseErrors).toEqual([]);
    const report = validateOntologySuite(parsed);
    expect(report.valid).toBe(true);
    expect(report.errorCount).toBe(0);

    // Knowledge Graph: zero dangling edges & degree populated on every node
    const graph = buildKnowledgeGraph(parsed);
    expect(graph.nodes.length).toBeGreaterThan(25);
    expect(graph.edges.length).toBeGreaterThan(30);
    const nodeIdSet = new Set(graph.nodes.map((n) => n.id));
    for (const edge of graph.edges) {
      expect(nodeIdSet.has(edge.source)).toBe(true);
      expect(nodeIdSet.has(edge.target)).toBe(true);
    }
    expect(graph.nodes.every((n) => typeof n.metadata?.degree === 'number')).toBe(true);

    // OWL/RDF XML: covers all 11 models and sanitizes non-ASCII identifiers safely
    const owl = exportToOwl(parsed);
    expect(owl).toContain('<owl:Ontology');
    expect(owl).toContain('<owl:Class rdf:ID="Contract">');
    for (const code of ['M1', 'M2', 'M3', 'ME', 'M4', 'M5', 'M6', 'M7', 'MU', 'MM', 'MI']) {
      expect(owl).toContain(`<onto:modelCode>${code}</onto:modelCode>`);
    }

    // HTML prototype MU extraction: preserves VALIDATE -> BEHAVIOR_CALL -> EVENT_EMIT -> SCENARIO_CALL -> REPORT_CALL -> NAVIGATE order
    const extractedMu = extractMuFromPrototypeHtml(
      CONTRACT_PROTOTYPE_HTML,
      '合同全生命周期管理系统',
    );
    expect(extractedMu.screens).toHaveLength(3);
    expect(extractedMu.screens[0].screenId).toBe('SCR-CONTRACT-LIST');
    expect(extractedMu.screens[1].layout).toContain('[EL-CONTRACT-NO*]');
    expect(extractedMu.navigation_edges).toHaveLength(1);
    expect(extractedMu.navigation_edges[0].toScreen).toBe('SCR-CONTRACT-APPROVAL');

    const suiteWithExtractedMu: OntologySuite = {
      ...CONTRACT_LIFECYCLE_SUITE,
      MU: extractedMu,
    };
    const extractedReport = validateOntologySuite(suiteWithExtractedMu);
    expect(extractedReport.diagnostics.filter((d) => d.tier === 'ERROR')).toEqual([]);
    expect(extractedReport.valid).toBe(true);
  });
});
