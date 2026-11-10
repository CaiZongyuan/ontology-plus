import type { OntologySuite } from './types.js';

export const CONTRACT_LIFECYCLE_SUITE: OntologySuite = {
  M1: {
    model_type: 'OBJECT',
    version: '5.0',
    domain: '合同全生命周期管理系统',
    aggregates: [
      {
        id: 'AGG-01',
        name: 'Contract',
        alias: '合同',
        aggregateType: 'AGGREGATE_ROOT',
        description:
          '企业商务合同聚合根，承载合同起草、条款明细、多级审批、电子签章与履约归档全生命周期状态与不变量。',
        lifecycle: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SIGNED', 'EXECUTING', 'ARCHIVED', 'TERMINATED'],
        tags: ['CORE_DOMAIN', 'CONTRACT', 'LEGAL_FINANCE'],
        uiBindings: ['SCR-CONTRACT-LIST', 'SCR-CONTRACT-EDIT', 'SCR-CONTRACT-APPROVAL'],
        attributes: [
          {
            name: 'contractNo',
            label: '合同编号',
            type: 'String',
            required: true,
            unique: true,
            description: '系统按年度+部门规则自动生成的唯一合同编号',
            refRules: [
              {
                name: 'ContractNoFormat',
                expression: "value.matches('^CT-[0-9]{4}-[0-9]{4,}$')",
                violationMessage: '合同编号格式必须为 CT-YYYY-NNNN',
                enforcedAt: 'ON_CREATE',
              },
            ],
            uiBindings: ['EL-CONTRACT-NO', 'EL-FILTER-KEYWORD'],
          },
          {
            name: 'title',
            label: '合同名称',
            type: 'String',
            required: true,
            refRules: [
              {
                name: 'TitleLengthRule',
                expression: 'value.length >= 4 && value.length <= 120',
                violationMessage: '合同名称长度需在 4 到 120 个字符之间',
                enforcedAt: 'ALWAYS',
              },
            ],
            uiBindings: ['EL-CONTRACT-TITLE'],
          },
          {
            name: 'contractType',
            label: '合同类型',
            type: 'DictionaryRef',
            required: true,
            dictionaryRef: {
              dictionaryId: 'DICT-CONTRACT',
              typeCode: 'CONTRACT_TYPE',
            },
            uiBindings: ['EL-CONTRACT-TYPE', 'EL-FILTER-TYPE'],
          },
          {
            name: 'counterpartyId',
            label: '相对方编号',
            type: 'AggregateRootRef',
            required: true,
            targetAggregate: 'Counterparty',
            uiBindings: ['EL-COUNTERPARTY-REF'],
          },
          {
            name: 'totalAmount',
            label: '合同总金额',
            type: 'Money',
            required: true,
            refRules: [
              {
                name: 'PositiveContractAmount',
                expression: 'value > 0',
                violationMessage: '合同总金额必须大于 0',
                enforcedAt: 'ALWAYS',
              },
            ],
            uiBindings: ['EL-TOTAL-AMOUNT'],
          },
          {
            name: 'status',
            label: '合同状态',
            type: 'Enum',
            required: true,
            defaultValue: 'DRAFT',
            enumValues: [
              'DRAFT',
              'PENDING_APPROVAL',
              'APPROVED',
              'SIGNED',
              'EXECUTING',
              'ARCHIVED',
              'TERMINATED',
            ],
            uiBindings: ['EL-CONTRACT-STATUS', 'EL-FILTER-STATUS'],
          },
          {
            name: 'signPeriod',
            label: '履约有效期',
            type: 'ValueObject',
            required: true,
            valueObjectRef: 'SignPeriod',
            uiBindings: ['EL-SIGN-PERIOD'],
          },
          {
            name: 'riskLevel',
            label: '风险等级',
            type: 'DictionaryRef',
            required: true,
            dictionaryRef: {
              dictionaryId: 'DICT-CONTRACT',
              typeCode: 'RISK_LEVEL',
            },
            uiBindings: ['EL-RISK-LEVEL'],
          },
        ],
        entities: [
          {
            name: 'ContractLineItem',
            alias: '合同标的明细',
            localId: 'lineId',
            cardinality: 'ONE_OR_MORE',
            cascadeDelete: true,
            description: '合同包含的标的物或服务交付明细项',
            attributes: [
              {
                name: 'itemName',
                label: '标的名称',
                type: 'String',
                required: true,
              },
              {
                name: 'quantity',
                label: '数量',
                type: 'Integer',
                required: true,
                refRules: [
                  {
                    name: 'PositiveQuantity',
                    expression: 'value >= 1',
                    violationMessage: '标的数量必须大于等于 1',
                    enforcedAt: 'ALWAYS',
                  },
                ],
              },
              {
                name: 'unitPrice',
                label: '含税单价',
                type: 'Money',
                required: true,
              },
              {
                name: 'subtotalAmount',
                label: '明细小计',
                type: 'Money',
                required: true,
              },
            ],
          },
          {
            name: 'PaymentMilestone',
            alias: '收付款里程碑',
            localId: 'milestoneId',
            cardinality: 'ONE_OR_MORE',
            cascadeDelete: true,
            description: '合同分期收付款计划节点',
            attributes: [
              {
                name: 'phaseName',
                label: '期次名称',
                type: 'String',
                required: true,
              },
              {
                name: 'plannedRatio',
                label: '付款比例(%)',
                type: 'Decimal',
                required: true,
              },
              {
                name: 'plannedAmount',
                label: '计划金额',
                type: 'Money',
                required: true,
              },
              {
                name: 'dueDate',
                label: '计划付款日',
                type: 'Date',
                required: true,
              },
            ],
          },
        ],
        valueObjects: [
          {
            name: 'SignPeriod',
            alias: '履约期限值对象',
            immutable: true,
            equalityFields: ['effectiveDate', 'expiryDate'],
            attributes: [
              {
                name: 'effectiveDate',
                label: '生效日期',
                type: 'Date',
                required: true,
              },
              {
                name: 'expiryDate',
                label: '到期日期',
                type: 'Date',
                required: true,
              },
            ],
          },
        ],
        invariants: [
          {
            name: 'MilestoneSumMatchesContractAmount',
            expression: 'sum(PaymentMilestone.plannedAmount) == totalAmount',
            violationMessage: '所有收付款里程碑计划金额之和必须等于合同总金额',
            enforcedAt: 'ALWAYS',
          },
          {
            name: 'LineItemSumMatchesContractAmount',
            expression: 'sum(ContractLineItem.subtotalAmount) == totalAmount',
            violationMessage: '所有标的明细小计之和必须等于合同总金额',
            enforcedAt: 'ALWAYS',
          },
        ],
      },
      {
        id: 'AGG-02',
        name: 'Counterparty',
        alias: '签约相对方',
        aggregateType: 'AGGREGATE_ROOT',
        description: '客户、供应商或合作伙伴等外部签约主体主数据及资信评级聚合根。',
        lifecycle: ['ACTIVE', 'BLACKLISTED', 'SUSPENDED'],
        tags: ['MASTER_DATA', 'COUNTERPARTY'],
        uiBindings: ['SCR-CONTRACT-EDIT'],
        attributes: [
          {
            name: 'creditCode',
            label: '统一社会信用代码',
            type: 'String',
            required: true,
            unique: true,
            refRules: [
              {
                name: 'CreditCodeLen',
                expression: 'value.length == 18',
                violationMessage: '统一社会信用代码必须为 18 位',
                enforcedAt: 'ALWAYS',
              },
            ],
          },
          {
            name: 'companyName',
            label: '企业全称',
            type: 'String',
            required: true,
          },
          {
            name: 'creditRating',
            label: '资信等级',
            type: 'Enum',
            required: true,
            enumValues: ['AAA', 'AA', 'A', 'B', 'C'],
          },
          {
            name: 'status',
            label: '准入状态',
            type: 'Enum',
            required: true,
            enumValues: ['ACTIVE', 'BLACKLISTED', 'SUSPENDED'],
          },
        ],
        entities: [],
        valueObjects: [],
        invariants: [],
      },
      {
        id: 'AGG-03',
        name: 'SettlementOrder',
        alias: '履约结算单',
        aggregateType: 'AGGREGATE_ROOT',
        description: '基于已签署合同里程碑触发的实际资金结算与发票核销单据。',
        lifecycle: ['PENDING', 'AUDITED', 'PAID', 'REJECTED'],
        tags: ['FINANCE', 'SETTLEMENT'],
        attributes: [
          {
            name: 'settlementNo',
            label: '结算单号',
            type: 'String',
            required: true,
            unique: true,
          },
          {
            name: 'contractRef',
            label: '关联合同',
            type: 'AggregateRootRef',
            required: true,
            targetAggregate: 'Contract',
          },
          {
            name: 'settlementAmount',
            label: '本次结算金额',
            type: 'Money',
            required: true,
            refRules: [
              {
                name: 'PositiveSettlement',
                expression: 'value > 0',
                violationMessage: '结算金额必须大于 0',
                enforcedAt: 'ALWAYS',
              },
            ],
          },
          {
            name: 'settlementStatus',
            label: '结算状态',
            type: 'Enum',
            required: true,
            enumValues: ['PENDING', 'AUDITED', 'PAID', 'REJECTED'],
          },
        ],
        entities: [],
        valueObjects: [],
        invariants: [],
      },
    ],
    data_dictionaries: [
      {
        id: 'DICT-CONTRACT',
        name: '合同业务主字典',
        description: '统一维护合同分类与法务风险等级枚举项',
        types: [
          {
            typeCode: 'CONTRACT_TYPE',
            typeName: '合同类型',
            items: [
              { code: 'SALES', label: '销售合同', enabled: true, sortOrder: 10 },
              { code: 'PROCUREMENT', label: '采购合同', enabled: true, sortOrder: 20 },
              { code: 'OUTSOURCING', label: '技术服务外包合同', enabled: true, sortOrder: 30 },
              { code: 'NDA', label: '保密协议', enabled: true, sortOrder: 40 },
            ],
          },
          {
            typeCode: 'RISK_LEVEL',
            typeName: '风险等级',
            items: [
              { code: 'LOW', label: '低风险（标准模板）', enabled: true, sortOrder: 10 },
              { code: 'MEDIUM', label: '中风险（部门会签）', enabled: true, sortOrder: 20 },
              { code: 'HIGH', label: '高风险（法务总监终审）', enabled: true, sortOrder: 30 },
            ],
          },
        ],
      },
    ],
    aggregate_associations: [
      {
        id: 'ASSOC-01',
        sourceAggregate: 'Contract',
        targetAggregate: 'Counterparty',
        associationType: 'REFERENCE',
        sourceRole: '签约合同',
        targetRole: '签约相对方',
        cardinality: 'MANY_TO_ONE',
        referenceField: 'counterpartyId',
        description: '每份合同必须绑定一个准入状态正常的签约相对方',
      },
      {
        id: 'ASSOC-02',
        sourceAggregate: 'SettlementOrder',
        targetAggregate: 'Contract',
        associationType: 'REFERENCE',
        sourceRole: '履约结算单',
        targetRole: '所属合同',
        cardinality: 'MANY_TO_ONE',
        referenceField: 'contractRef',
        description: '每张履约结算单对应一份执行中合同的里程碑期次',
      },
    ],
  },
  M2: {
    model_type: 'BEHAVIOR',
    version: '5.0',
    domain: '合同全生命周期管理系统',
    behaviors: [
      {
        id: 'BHV-01',
        name: 'draftContract',
        alias: '起草合同',
        ownerEntity: 'Contract',
        behaviorType: 'COMMAND',
        triggerType: 'USER_ACTION',
        description: '由合同专员创建新合同草稿，校验相对方准入资信与标的金额平衡规则。',
        inputParameters: [
          { name: 'title', label: '合同名称', type: 'String', required: true },
          { name: 'contractType', label: '合同类型', type: 'String', required: true },
          { name: 'counterpartyId', label: '相对方编号', type: 'String', required: true },
          { name: 'totalAmount', label: '合同总金额', type: 'Money', required: true },
        ],
        outputParameters: [
          { name: 'contractId', label: '合同ID', type: 'String', required: true },
          { name: 'contractNo', label: '合同编号', type: 'String', required: true },
        ],
        preconditions: [
          {
            name: 'CounterpartyMustBeActive',
            expression: "Counterparty.status == 'ACTIVE'",
            violationMessage: '黑名单或冻结状态的相对方禁止起草合同',
          },
        ],
        stateChanges: [
          {
            targetField: 'Contract.status',
            changeType: 'SET',
            expression: "'DRAFT'",
            description: '新建合同初始状态设为草稿 DRAFT',
          },
        ],
        invokedRules: ['RULE-01', 'RULE-02'],
        producedEvents: ['EVT-01'],
        requiredPermissions: ['PERM-CONTRACT-WRITE'],
        uiEventRefs: ['UIE-SAVE-DRAFT'],
      },
      {
        id: 'BHV-02',
        name: 'submitContractApproval',
        alias: '提交合同审批',
        ownerEntity: 'Contract',
        behaviorType: 'COMMAND',
        triggerType: 'USER_ACTION',
        description: '将草稿合同正式提交至多级会签工作流，并依据金额阈值自动计算风险等级。',
        inputParameters: [
          { name: 'contractId', label: '合同ID', type: 'String', required: true },
          { name: 'submitComment', label: '提交说明', type: 'String', required: false },
        ],
        outputParameters: [{ name: 'status', label: '当前状态', type: 'String', required: true }],
        preconditions: [
          {
            name: 'OnlyDraftCanSubmit',
            expression: "Contract.status == 'DRAFT'",
            violationMessage: '仅草稿状态合同可提交审批',
          },
        ],
        stateChanges: [
          {
            targetField: 'Contract.status',
            changeType: 'TRANSITION',
            expression: "'DRAFT' -> 'PENDING_APPROVAL'",
            description: '合同流转至待审批状态',
          },
        ],
        invokedRules: ['RULE-01', 'RULE-02'],
        producedEvents: ['EVT-02'],
        requiredPermissions: ['PERM-CONTRACT-SUBMIT'],
        uiEventRefs: ['UIE-SUBMIT-APPROVAL'],
      },
      {
        id: 'BHV-03',
        name: 'approveContract',
        alias: '审批通过合同',
        ownerEntity: 'Contract',
        behaviorType: 'COMMAND',
        triggerType: 'FLOW',
        description: '部门主管或法务总监对合同进行审批放行，触发电子签章与首期结算预备。',
        inputParameters: [
          { name: 'contractId', label: '合同ID', type: 'String', required: true },
          { name: 'approvalOpinion', label: '审批意见', type: 'String', required: true },
        ],
        outputParameters: [{ name: 'status', label: '审批后状态', type: 'String', required: true }],
        preconditions: [
          {
            name: 'MustBePendingApproval',
            expression: "Contract.status == 'PENDING_APPROVAL'",
            violationMessage: '合同必须处于待审批状态',
          },
        ],
        stateChanges: [
          {
            targetField: 'Contract.status',
            changeType: 'TRANSITION',
            expression: "'PENDING_APPROVAL' -> 'EXECUTING'",
            description: '审批通过并完成电子签章后进入履约执行状态',
          },
        ],
        invokedRules: ['RULE-03'],
        producedEvents: ['EVT-03'],
        requiredPermissions: ['PERM-CONTRACT-APPROVE'],
        uiEventRefs: ['UIE-APPROVE-CONTRACT'],
      },
      {
        id: 'BHV-04',
        name: 'createInitialSettlement',
        alias: '生成首期履约结算单',
        ownerEntity: 'SettlementOrder',
        behaviorType: 'EVENT_HANDLER',
        triggerType: 'EVENT',
        description: '监听合同审批生效事件，按首期收付款里程碑自动创建待核销结算单。',
        inputParameters: [
          { name: 'contractId', label: '合同ID', type: 'String', required: true },
          { name: 'initialAmount', label: '首期金额', type: 'Money', required: true },
        ],
        outputParameters: [
          { name: 'settlementNo', label: '结算单号', type: 'String', required: true },
        ],
        preconditions: [],
        stateChanges: [
          {
            targetField: 'SettlementOrder.settlementStatus',
            changeType: 'SET',
            expression: "'PENDING'",
          },
        ],
        invokedRules: ['RULE-03'],
        producedEvents: [],
        requiredPermissions: ['PERM-SETTLEMENT-MANAGE'],
      },
      {
        id: 'BHV-05',
        name: 'queryContractLedger',
        alias: '查询合同台账与履约进度',
        ownerEntity: 'Contract',
        behaviorType: 'QUERY',
        triggerType: 'USER_ACTION',
        description: '多维度分页检索合同主台账、相对方资信及累计结算进度。',
        inputParameters: [
          { name: 'keyword', label: '关键字', type: 'String', required: false },
          { name: 'contractType', label: '合同类型', type: 'String', required: false },
          { name: 'status', label: '合同状态', type: 'String', required: false },
        ],
        outputParameters: [
          { name: 'items', label: '合同台账列表', type: 'Array', required: true },
        ],
        preconditions: [],
        stateChanges: [],
        invokedRules: [],
        producedEvents: [],
        requiredPermissions: ['PERM-CONTRACT-READ'],
        queryReportRef: 'QRY-01',
        uiEventRefs: ['UIE-SEARCH-LEDGER'],
      },
      {
        id: 'BHV-06',
        name: 'reportDepartmentRiskStats',
        alias: '统计合同风险与履约率报表',
        ownerEntity: 'Contract',
        behaviorType: 'QUERY',
        triggerType: 'SYSTEM',
        description: '按合同类型与风险等级汇总统计签约总额、平均履约周期及结算达成率。',
        inputParameters: [
          { name: 'riskLevel', label: '风险等级', type: 'String', required: false },
        ],
        outputParameters: [
          { name: 'summaryRows', label: '统计汇总行', type: 'Array', required: true },
        ],
        preconditions: [],
        stateChanges: [],
        invokedRules: [],
        producedEvents: [],
        requiredPermissions: ['PERM-CONTRACT-READ'],
        queryReportRef: 'RPT-02',
      },
    ],
  },
  M3: {
    model_type: 'RULE',
    version: '5.0',
    domain: '合同全生命周期管理系统',
    rules: [
      {
        id: 'RULE-01',
        name: 'CounterpartyCreditThresholdRule',
        alias: '相对方资信额度准入规则',
        ruleType: 'VALIDATION',
        scope: 'CROSS_OBJECT',
        version: '1.0',
        description: '当合同总金额超过 100 万元时，签约相对方资信等级必须达到 AA 或 AAA 级。',
        referencedObjects: ['Contract', 'Counterparty'],
        parameters: [
          { name: 'totalAmount', type: 'Money', source: 'Contract.totalAmount' },
          { name: 'creditRating', type: 'String', source: 'Counterparty.creditRating' },
        ],
        expression:
          "Contract.totalAmount <= 1000000 || Counterparty.creditRating in ['AAA', 'AA']",
        violationMessage: '超过 100 万元的大额合同仅允许与 AA/AAA 级资信相对方签署',
        triggeredByEvents: [],
        producedEvents: [],
        triggeredBehaviors: [],
        uiValidationRefs: ['SCR-CONTRACT-EDIT'],
      },
      {
        id: 'RULE-02',
        name: 'ContractRiskTierDecisionRule',
        alias: '合同金额与类型风险定级规则',
        ruleType: 'DECISION_TABLE',
        scope: 'CROSS_BEHAVIOR',
        version: '1.0',
        description: '根据合同总金额与合同类型自动判定风险等级（HIGH / MEDIUM / LOW）。',
        referencedObjects: ['Contract'],
        parameters: [
          { name: 'totalAmount', type: 'Money', source: 'Contract.totalAmount' },
          { name: 'contractType', type: 'String', source: 'Contract.contractType' },
        ],
        expression:
          "Contract.totalAmount >= 2000000 ? 'HIGH' : (Contract.totalAmount >= 500000 ? 'MEDIUM' : 'LOW')",
        violationMessage: '大额合同必须升级至高风险法务会签通道',
        triggeredByEvents: [],
        producedEvents: [],
        triggeredBehaviors: [],
        uiValidationRefs: ['SCR-CONTRACT-EDIT'],
      },
      {
        id: 'RULE-03',
        name: 'SettlementCeilingGuardRule',
        alias: '累计结算不超合同总额守恒规则',
        ruleType: 'CALCULATION',
        scope: 'CROSS_OBJECT',
        version: '1.0',
        description: '同一份合同下所有履约结算单累计金额不得超过合同总金额。',
        referencedObjects: ['Contract', 'SettlementOrder'],
        parameters: [
          { name: 'totalAmount', type: 'Money', source: 'Contract.totalAmount' },
          { name: 'settlementAmount', type: 'Money', source: 'SettlementOrder.settlementAmount' },
        ],
        expression: 'sum(SettlementOrder.settlementAmount) <= Contract.totalAmount',
        violationMessage: '累计结算金额不能超过合同总金额上限',
        triggeredByEvents: ['EVT-03'],
        producedEvents: [],
        triggeredBehaviors: [
          {
            behaviorRef: 'BHV-04',
            parameterMapping: {
              contractId: 'Contract.id',
              initialAmount: 'Contract.PaymentMilestone[0].plannedAmount',
            },
          },
        ],
      },
    ],
  },
  ME: {
    model_type: 'EVENT',
    version: '5.0',
    domain: '合同全生命周期管理系统',
    events: [
      {
        id: 'EVT-01',
        name: 'Contract.DraftCreated',
        label: '合同草稿已创建事件',
        description: '合同专员完成起草保存后发布，用于记录审计轨迹。',
        producerType: 'BEHAVIOR',
        producerBehaviorRef: 'BHV-01',
        sourceAggregate: 'Contract',
        orderingSemantic: 'AT_LEAST_ONCE',
        idempotencyKey: 'contractNo',
        payload: [
          { name: 'contractNo', label: '合同编号', type: 'String', required: true },
          { name: 'title', label: '合同名称', type: 'String', required: true },
          { name: 'totalAmount', label: '合同总金额', type: 'Money', required: true },
        ],
        subscribers: [],
      },
      {
        id: 'EVT-02',
        name: 'Contract.SubmittedForApproval',
        label: '合同已提交审批事件',
        description: '合同提交审批后触发多级审批流启动与法务风险扫描。',
        producerType: 'BEHAVIOR',
        producerBehaviorRef: 'BHV-02',
        sourceAggregate: 'Contract',
        orderingSemantic: 'EXACTLY_ONCE',
        idempotencyKey: 'contractNo',
        payload: [
          { name: 'contractNo', label: '合同编号', type: 'String', required: true },
          { name: 'riskLevel', label: '风险等级', type: 'String', required: true },
        ],
        subscribers: [
          {
            subscriberType: 'BEHAVIOR',
            subscriberRef: 'BHV-03',
            deliveryMode: 'ASYNC',
            description: '推送待办至部门主管与法务审批收件箱',
          },
        ],
      },
      {
        id: 'EVT-03',
        name: 'Contract.ApprovedAndSigned',
        label: '合同已审批生效事件',
        description: '合同完成终审与电子签章后触发首期履约结算单自动生成。',
        producerType: 'BEHAVIOR',
        producerBehaviorRef: 'BHV-03',
        sourceAggregate: 'Contract',
        orderingSemantic: 'EXACTLY_ONCE',
        idempotencyKey: 'contractNo',
        payload: [
          { name: 'contractNo', label: '合同编号', type: 'String', required: true },
          { name: 'totalAmount', label: '合同总金额', type: 'Money', required: true },
        ],
        subscribers: [
          {
            subscriberType: 'RULE',
            subscriberRef: 'RULE-03',
            deliveryMode: 'SYNC',
            description: '校验结算额度上限并触发首期结算单生成',
          },
          {
            subscriberType: 'BEHAVIOR',
            subscriberRef: 'BHV-04',
            deliveryMode: 'ASYNC',
            description: '自动生成首期履约结算单',
          },
        ],
      },
    ],
  },
  M4: {
    model_type: 'SCENARIO',
    version: '5.0',
    domain: '合同全生命周期管理系统',
    event_scenarios: [
      {
        id: 'SCN-01',
        name: '合同审批生效联动首期结算场景',
        description:
          '当合同经法务/部门审批通过后，发布生效事件，自动校验结算额度守恒规则并创建首期结算单。',
        triggerBehaviorRef: 'BHV-03',
        triggerEventRef: 'EVT-03',
        involvedAggregates: ['Contract', 'SettlementOrder'],
        preconditions: ["Contract.status == 'PENDING_APPROVAL'"],
        postconditions: [
          "Contract.status == 'EXECUTING'",
          "SettlementOrder.settlementStatus == 'PENDING'",
        ],
        steps: [
          {
            stepOrder: 1,
            stepType: 'BEHAVIOR_CALL',
            refId: 'BHV-03',
            targetAggregate: 'Contract',
            description: '执行合同审批放行命令',
          },
          {
            stepOrder: 2,
            stepType: 'EVENT_EMIT',
            refId: 'EVT-03',
            targetAggregate: 'Contract',
            description: '广播合同已审批生效事件',
          },
          {
            stepOrder: 3,
            stepType: 'RULE_EVALUATE',
            refId: 'RULE-03',
            targetAggregate: 'SettlementOrder',
            description: '校验结算总额度上限规则',
          },
          {
            stepOrder: 4,
            stepType: 'BEHAVIOR_CALL',
            refId: 'BHV-04',
            targetAggregate: 'SettlementOrder',
            description: '创建首期履约结算单',
          },
        ],
        uiTriggerScreen: 'SCR-CONTRACT-APPROVAL',
      },
    ],
  },
  M5: {
    model_type: 'ACTOR',
    version: '5.0',
    domain: '合同全生命周期管理系统',
    actors: [
      {
        id: 'ACT-01',
        name: '商务合同专员',
        actorType: 'HUMAN',
        roles: ['ROLE-CONTRACT-SPEC'],
        description: '负责合同起草、相对方核验、条款维护与提交审批。',
      },
      {
        id: 'ACT-02',
        name: '法务与部门审批主管',
        actorType: 'HUMAN',
        roles: ['ROLE-DEPT-MGR'],
        description: '负责审核合同条款风险、资信合规与审批放行。',
      },
      {
        id: 'ACT-EXT-ESIGN',
        name: '电子签章服务网关',
        actorType: 'EXTERNAL_ENTITY',
        roles: [],
        description: '提供具有法律效力的 CA 数字证书电子签章服务。',
        externalContract: {
          protocol: 'REST',
          format: 'JSON',
          authType: 'HMAC_SHA256',
          timeoutMs: 5000,
          retryPolicy: 'EXPONENTIAL_BACKOFF_3',
        },
      },
    ],
    roles: [
      {
        id: 'ROLE-CONTRACT-SPEC',
        name: '合同专员角色',
        code: 'CONTRACT_SPECIALIST',
        inheritsFrom: [],
        permissions: ['PERM-CONTRACT-READ', 'PERM-CONTRACT-WRITE', 'PERM-CONTRACT-SUBMIT'],
        dataScope: 'DEPARTMENT',
        description: '可查看并维护本部门合同草稿及台账',
      },
      {
        id: 'ROLE-DEPT-MGR',
        name: '法务审批主管角色',
        code: 'LEGAL_APPROVER',
        inheritsFrom: ['ROLE-CONTRACT-SPEC'],
        permissions: [
          'PERM-CONTRACT-READ',
          'PERM-CONTRACT-APPROVE',
          'PERM-SETTLEMENT-MANAGE',
        ],
        dataScope: 'ALL',
        description: '拥有全公司合同查阅、审批放行及结算单管理权限',
      },
    ],
    permissions: [
      {
        id: 'PERM-CONTRACT-READ',
        name: '合同台账查阅权限',
        code: 'contract:read',
        targetAggregate: 'Contract',
        allowedBehaviors: ['BHV-05', 'BHV-06'],
        uiControlledElements: ['EL-BTN-SEARCH'],
      },
      {
        id: 'PERM-CONTRACT-WRITE',
        name: '合同起草编辑权限',
        code: 'contract:write',
        targetAggregate: 'Contract',
        allowedBehaviors: ['BHV-01'],
        uiControlledElements: ['EL-BTN-SAVE-DRAFT'],
      },
      {
        id: 'PERM-CONTRACT-SUBMIT',
        name: '合同提交审批权限',
        code: 'contract:submit',
        targetAggregate: 'Contract',
        allowedBehaviors: ['BHV-02'],
        uiControlledElements: ['EL-BTN-SUBMIT-APPROVAL'],
      },
      {
        id: 'PERM-CONTRACT-APPROVE',
        name: '合同终审放行权限',
        code: 'contract:approve',
        targetAggregate: 'Contract',
        allowedBehaviors: ['BHV-03'],
        uiControlledElements: ['EL-BTN-APPROVE'],
      },
      {
        id: 'PERM-SETTLEMENT-MANAGE',
        name: '结算单生成与核销权限',
        code: 'settlement:manage',
        targetAggregate: 'SettlementOrder',
        allowedBehaviors: ['BHV-04'],
        uiControlledElements: [],
      },
    ],
  },
  M6: {
    model_type: 'FLOW',
    version: '5.0',
    domain: '合同全生命周期管理系统',
    flows: [
      {
        id: 'FLW-01',
        name: '合同起草与风险分级审批主流程',
        flowType: 'APPROVAL',
        primaryAggregate: 'Contract',
        roleRefs: ['ROLE-CONTRACT-SPEC', 'ROLE-DEPT-MGR'],
        description: '覆盖合同专员起草、提交审批、风险网关路由及法务终审生效的标准流程。',
        trigger: {
          triggerType: 'USER_ACTION',
          refId: 'BHV-02',
          description: '合同专员点击提交合同审批触发流程',
        },
        activities: [
          {
            id: 'ACTV-START',
            name: '流程开始',
            activityType: 'START',
            nextActivity: 'ACTV-DRAFT',
            branches: [],
          },
          {
            id: 'ACTV-DRAFT',
            name: '合同专员起草与补全条款',
            activityType: 'USER_TASK',
            roleRef: 'ROLE-CONTRACT-SPEC',
            behaviorRef: 'BHV-01',
            screenRef: 'SCR-CONTRACT-EDIT',
            nextActivity: 'ACTV-RISK-GW',
            branches: [],
          },
          {
            id: 'ACTV-RISK-GW',
            name: '合同金额与风险等级路由网关',
            activityType: 'XOR_GATEWAY',
            branches: [
              {
                targetActivity: 'ACTV-LEGAL-APPROVE',
                condition: "Contract.riskLevel == 'HIGH' || Contract.totalAmount >= 500000",
                isDefault: false,
                label: '中/高风险合同法务会签',
              },
              {
                targetActivity: 'ACTV-AUTO-EFFECT',
                condition: "Contract.riskLevel == 'LOW'",
                isDefault: true,
                label: '低风险标准合同快速通道',
              },
            ],
          },
          {
            id: 'ACTV-LEGAL-APPROVE',
            name: '法务与部门主管审批',
            activityType: 'APPROVAL_TASK',
            roleRef: 'ROLE-DEPT-MGR',
            behaviorRef: 'BHV-03',
            screenRef: 'SCR-CONTRACT-APPROVAL',
            approvalOutcomes: ['APPROVED', 'REJECTED'],
            nextActivity: 'ACTV-AUTO-EFFECT',
            branches: [],
          },
          {
            id: 'ACTV-AUTO-EFFECT',
            name: '执行生效与首期结算联动场景',
            activityType: 'SCENARIO_CALL',
            scenarioRef: 'SCN-01',
            nextActivity: 'ACTV-END',
            branches: [],
          },
          {
            id: 'ACTV-END',
            name: '流程结束',
            activityType: 'END',
            branches: [],
          },
        ],
      },
    ],
  },
  M7: {
    model_type: 'QUERY_REPORT',
    version: '5.0',
    domain: '合同全生命周期管理系统',
    query_reports: [
      {
        id: 'QRY-01',
        name: 'ContractLedgerDetailQuery',
        alias: '合同全量台账分页查询',
        queryType: 'DETAIL_QUERY',
        behaviorRef: 'BHV-05',
        description: '联表查询合同主表、相对方资信信息及累计已结算金额，用于合同管理主列表。',
        primarySource: {
          aggregateRef: 'Contract',
          alias: 'c',
        },
        joins: [
          {
            joinType: 'LEFT',
            aggregateRef: 'Counterparty',
            alias: 'cp',
            onCondition: 'c.counterparty_id = cp.id',
          },
        ],
        parameters: [
          { name: 'keyword', label: '关键字', type: 'String', required: false },
          { name: 'contractType', label: '合同类型', type: 'String', required: false },
          { name: 'status', label: '合同状态', type: 'String', required: false },
        ],
        conditions: [
          { field: 'c.title', operator: 'LIKE', parameterRef: 'keyword' },
          { field: 'c.contract_type', operator: '=', parameterRef: 'contractType' },
          { field: 'c.status', operator: '=', parameterRef: 'status' },
        ],
        resultColumns: [
          {
            name: 'contractNo',
            label: '合同编号',
            sourceExpr: 'c.contract_no',
            dataType: 'String',
          },
          { name: 'title', label: '合同名称', sourceExpr: 'c.title', dataType: 'String' },
          {
            name: 'companyName',
            label: '签约相对方',
            sourceExpr: 'cp.company_name',
            dataType: 'String',
          },
          {
            name: 'totalAmount',
            label: '合同总金额',
            sourceExpr: 'c.total_amount',
            dataType: 'Money',
          },
          { name: 'status', label: '当前状态', sourceExpr: 'c.status', dataType: 'String' },
        ],
        groupBy: [],
        orderBy: [{ field: 'c.contract_no', direction: 'DESC' }],
        pagination: { enabled: true, defaultPageSize: 20, maxPageSize: 100 },
        referenceSql: {
          dialect: 'SQLite',
          sql: 'SELECT c.contract_no AS contractNo, c.title AS title, cp.company_name AS companyName, c.total_amount AS totalAmount, c.status AS status FROM t_contract c LEFT JOIN t_counterparty cp ON c.counterparty_id = cp.id WHERE (:keyword IS NULL OR c.title LIKE :keyword) AND (:contractType IS NULL OR c.contract_type = :contractType) AND (:status IS NULL OR c.status = :status) ORDER BY c.contract_no DESC',
          parameterMappings: ['keyword', 'contractType', 'status'],
          resultMappings: ['contractNo', 'title', 'companyName', 'totalAmount', 'status'],
        },
        uiScreenRefs: ['SCR-CONTRACT-LIST'],
      },
      {
        id: 'RPT-02',
        name: 'ContractRiskAndSettlementReport',
        alias: '合同风险分级与履约结算统计报表',
        queryType: 'REPORT',
        behaviorRef: 'BHV-06',
        description: '按合同类型与风险等级聚合统计签约份数、合同总额及结算完成率。',
        primarySource: {
          aggregateRef: 'Contract',
          alias: 'c',
        },
        joins: [
          {
            joinType: 'LEFT',
            aggregateRef: 'SettlementOrder',
            alias: 'so',
            onCondition: 'c.id = so.contract_ref',
            preAggregated: true,
          },
        ],
        parameters: [{ name: 'riskLevel', label: '风险等级', type: 'String', required: false }],
        conditions: [{ field: 'c.risk_level', operator: '=', parameterRef: 'riskLevel' }],
        resultColumns: [
          {
            name: 'contractType',
            label: '合同类型',
            sourceExpr: 'c.contract_type',
            dataType: 'String',
          },
          {
            name: 'riskLevel',
            label: '风险等级',
            sourceExpr: 'c.risk_level',
            dataType: 'String',
          },
          {
            name: 'contractCount',
            label: '合同份数',
            sourceExpr: 'COUNT(c.id)',
            dataType: 'Integer',
            aggregation: 'COUNT',
          },
          {
            name: 'sumContractAmount',
            label: '签约总金额',
            sourceExpr: 'SUM(c.total_amount)',
            dataType: 'Money',
            aggregation: 'SUM',
          },
        ],
        groupBy: ['c.contract_type', 'c.risk_level'],
        orderBy: [{ field: 'sumContractAmount', direction: 'DESC' }],
        reportOptions: {
          exportFormats: ['XLSX', 'CSV', 'PDF'],
          summaryRow: true,
          groupHeaders: ['合同类型', '风险等级'],
        },
        referenceSql: {
          dialect: 'SQLite',
          sql: 'SELECT c.contract_type AS contractType, c.risk_level AS riskLevel, COUNT(c.id) AS contractCount, SUM(c.total_amount) AS sumContractAmount FROM t_contract c WHERE (:riskLevel IS NULL OR c.risk_level = :riskLevel) GROUP BY c.contract_type, c.risk_level ORDER BY sumContractAmount DESC',
          parameterMappings: ['riskLevel'],
          resultMappings: ['contractType', 'riskLevel', 'contractCount', 'sumContractAmount'],
        },
        uiScreenRefs: ['SCR-CONTRACT-LIST'],
      },
    ],
  },
  MU: {
    model_type: 'UI',
    version: '5.0',
    domain: '合同全生命周期管理系统',
    screens: [
      {
        screenId: 'SCR-CONTRACT-LIST',
        name: '合同台账与风险监控工作台',
        screenType: 'LIST',
        route: '/contracts/ledger',
        roleRefs: ['ROLE-CONTRACT-SPEC', 'ROLE-DEPT-MGR'],
        layout: [
          '+--------------------------------------------------------------------------+',
          '| 合同台账与风险监控工作台 (SCR-CONTRACT-LIST)                             |',
          '+--------------------------------------------------------------------------+',
          '| [EL-FILTER-KEYWORD] [EL-FILTER-TYPE] [EL-FILTER-STATUS] [EL-BTN-SEARCH]  |',
          '+--------------------------------------------------------------------------+',
          '| [EL-LEDGER-TABLE]                                                        |',
          '+--------------------------------------------------------------------------+',
        ].join('\n'),
        elements: [
          {
            elementId: 'EL-FILTER-KEYWORD',
            name: 'keywordInput',
            label: '合同名称/编号检索',
            elementType: 'INPUT',
            io: 'IN',
            required: false,
            dataBinding: 'Contract.contractNo',
          },
          {
            elementId: 'EL-FILTER-TYPE',
            name: 'contractTypeSelect',
            label: '合同类型筛选',
            elementType: 'SELECT',
            io: 'IN',
            required: false,
            dataBinding: 'Contract.contractType',
            dictionaryRef: 'DICT-CONTRACT',
          },
          {
            elementId: 'EL-FILTER-STATUS',
            name: 'statusSelect',
            label: '状态筛选',
            elementType: 'SELECT',
            io: 'IN',
            required: false,
            dataBinding: 'Contract.status',
          },
          {
            elementId: 'EL-BTN-SEARCH',
            name: 'searchButton',
            label: '查询合同台账',
            elementType: 'BUTTON',
            io: 'ACTION',
            required: false,
            permissionRef: 'PERM-CONTRACT-READ',
          },
          {
            elementId: 'EL-LEDGER-TABLE',
            name: 'contractLedgerTable',
            label: '合同台账数据表格',
            elementType: 'TABLE',
            io: 'OUT',
            required: false,
            dataSource: 'QRY-01',
          },
        ],
        events: [
          {
            eventId: 'UIE-SEARCH-LEDGER',
            name: '点击查询合同台账',
            triggerElementId: 'EL-BTN-SEARCH',
            triggerAction: 'CLICK',
            permissions: ['PERM-CONTRACT-READ'],
            callChain: [
              {
                stepOrder: 1,
                stepType: 'BEHAVIOR_CALL',
                refId: 'BHV-05',
                description: '调用查询合同台账行为',
              },
              {
                stepOrder: 2,
                stepType: 'REPORT_CALL',
                refId: 'QRY-01',
                description: '加载 QRY-01 台账数据集',
              },
            ],
          },
        ],
      },
      {
        screenId: 'SCR-CONTRACT-EDIT',
        name: '合同起草与条款配置页',
        screenType: 'FORM',
        route: '/contracts/edit',
        roleRefs: ['ROLE-CONTRACT-SPEC'],
        layout: [
          '+--------------------------------------------------------------------------+',
          '| 合同起草与条款配置页 (SCR-CONTRACT-EDIT)                                 |',
          '+--------------------------------------------------------------------------+',
          '| [EL-CONTRACT-NO]     [EL-CONTRACT-TITLE]     [EL-CONTRACT-TYPE]          |',
          '| [EL-COUNTERPARTY-REF] [EL-TOTAL-AMOUNT]      [EL-RISK-LEVEL]             |',
          '| [EL-SIGN-PERIOD]     [EL-CONTRACT-STATUS]                                |',
          '+--------------------------------------------------------------------------+',
          '| [EL-BTN-SAVE-DRAFT]  [EL-BTN-SUBMIT-APPROVAL]                            |',
          '+--------------------------------------------------------------------------+',
        ].join('\n'),
        elements: [
          {
            elementId: 'EL-CONTRACT-NO',
            name: 'contractNoField',
            label: '合同编号',
            elementType: 'INPUT',
            io: 'IN_OUT',
            required: true,
            dataBinding: 'Contract.contractNo',
          },
          {
            elementId: 'EL-CONTRACT-TITLE',
            name: 'titleField',
            label: '合同名称',
            elementType: 'INPUT',
            io: 'IN_OUT',
            required: true,
            dataBinding: 'Contract.title',
          },
          {
            elementId: 'EL-CONTRACT-TYPE',
            name: 'contractTypeField',
            label: '合同类型',
            elementType: 'SELECT',
            io: 'IN_OUT',
            required: true,
            dataBinding: 'Contract.contractType',
            dictionaryRef: 'DICT-CONTRACT',
          },
          {
            elementId: 'EL-COUNTERPARTY-REF',
            name: 'counterpartySelect',
            label: '签约相对方',
            elementType: 'SELECT',
            io: 'IN_OUT',
            required: true,
            dataBinding: 'Contract.counterpartyId',
          },
          {
            elementId: 'EL-TOTAL-AMOUNT',
            name: 'totalAmountField',
            label: '合同总金额(元)',
            elementType: 'NUMBER',
            io: 'IN_OUT',
            required: true,
            dataBinding: 'Contract.totalAmount',
          },
          {
            elementId: 'EL-RISK-LEVEL',
            name: 'riskLevelBadge',
            label: '风险定级',
            elementType: 'BADGE',
            io: 'OUT',
            required: false,
            dataBinding: 'Contract.riskLevel',
          },
          {
            elementId: 'EL-SIGN-PERIOD',
            name: 'signPeriodPicker',
            label: '履约起止期限',
            elementType: 'DATE_PICKER',
            io: 'IN_OUT',
            required: true,
            dataBinding: 'Contract.signPeriod',
          },
          {
            elementId: 'EL-CONTRACT-STATUS',
            name: 'contractStatusBadge',
            label: '合同状态',
            elementType: 'BADGE',
            io: 'OUT',
            required: false,
            dataBinding: 'Contract.status',
          },
          {
            elementId: 'EL-BTN-SAVE-DRAFT',
            name: 'saveDraftBtn',
            label: '保存合同草稿',
            elementType: 'BUTTON',
            io: 'ACTION',
            required: false,
            permissionRef: 'PERM-CONTRACT-WRITE',
          },
          {
            elementId: 'EL-BTN-SUBMIT-APPROVAL',
            name: 'submitApprovalBtn',
            label: '提交合同审批',
            elementType: 'BUTTON',
            io: 'ACTION',
            required: false,
            permissionRef: 'PERM-CONTRACT-SUBMIT',
          },
        ],
        events: [
          {
            eventId: 'UIE-SAVE-DRAFT',
            name: '点击保存合同草稿',
            triggerElementId: 'EL-BTN-SAVE-DRAFT',
            triggerAction: 'CLICK',
            permissions: ['PERM-CONTRACT-WRITE'],
            callChain: [
              {
                stepOrder: 1,
                stepType: 'VALIDATE',
                refId: 'RULE-01',
                description: '校验相对方资信额度准入规则',
              },
              {
                stepOrder: 2,
                stepType: 'BEHAVIOR_CALL',
                refId: 'BHV-01',
                description: '调用起草合同命令',
              },
              {
                stepOrder: 3,
                stepType: 'EVENT_EMIT',
                refId: 'EVT-01',
                description: '发射合同草稿已创建事件',
              },
            ],
          },
          {
            eventId: 'UIE-SUBMIT-APPROVAL',
            name: '点击提交合同审批',
            triggerElementId: 'EL-BTN-SUBMIT-APPROVAL',
            triggerAction: 'CLICK',
            permissions: ['PERM-CONTRACT-SUBMIT'],
            callChain: [
              {
                stepOrder: 1,
                stepType: 'VALIDATE',
                refId: 'RULE-02',
                description: '评估合同金额与风险分级规则',
              },
              {
                stepOrder: 2,
                stepType: 'BEHAVIOR_CALL',
                refId: 'BHV-02',
                description: '执行提交合同审批行为',
              },
              {
                stepOrder: 3,
                stepType: 'EVENT_EMIT',
                refId: 'EVT-02',
                description: '发布合同已提交审批事件',
              },
            ],
          },
        ],
      },
      {
        screenId: 'SCR-CONTRACT-APPROVAL',
        name: '法务风险会签与审批工作台',
        screenType: 'APPROVAL',
        route: '/contracts/approval',
        roleRefs: ['ROLE-DEPT-MGR'],
        layout: [
          '+--------------------------------------------------------------------------+',
          '| 法务风险会签与审批工作台 (SCR-CONTRACT-APPROVAL)                         |',
          '+--------------------------------------------------------------------------+',
          '| [EL-APPROVAL-OPINION]                                                    |',
          '| [EL-BTN-APPROVE]                                                         |',
          '+--------------------------------------------------------------------------+',
        ].join('\n'),
        elements: [
          {
            elementId: 'EL-APPROVAL-OPINION',
            name: 'approvalOpinionInput',
            label: '法务会签审批意见',
            elementType: 'INPUT',
            io: 'IN',
            required: true,
          },
          {
            elementId: 'EL-BTN-APPROVE',
            name: 'approveContractBtn',
            label: '审批通过并触发签章结算',
            elementType: 'BUTTON',
            io: 'ACTION',
            required: false,
            permissionRef: 'PERM-CONTRACT-APPROVE',
          },
        ],
        events: [
          {
            eventId: 'UIE-APPROVE-CONTRACT',
            name: '点击审批通过合同',
            triggerElementId: 'EL-BTN-APPROVE',
            triggerAction: 'CLICK',
            permissions: ['PERM-CONTRACT-APPROVE'],
            callChain: [
              {
                stepOrder: 1,
                stepType: 'VALIDATE',
                refId: 'RULE-03',
                description: '核验结算总额度守恒规则',
              },
              {
                stepOrder: 2,
                stepType: 'BEHAVIOR_CALL',
                refId: 'BHV-03',
                description: '调用审批通过合同行为',
              },
              {
                stepOrder: 3,
                stepType: 'EVENT_EMIT',
                refId: 'EVT-03',
                description: '触发合同审批生效事件',
              },
            ],
          },
        ],
      },
    ],
    navigation_edges: [
      {
        id: 'NAV-01',
        fromScreen: 'SCR-CONTRACT-LIST',
        toScreen: 'SCR-CONTRACT-EDIT',
        mode: 'PUSH',
      },
      {
        id: 'NAV-02',
        fromScreen: 'SCR-CONTRACT-EDIT',
        toScreen: 'SCR-CONTRACT-APPROVAL',
        triggerEventId: 'UIE-SUBMIT-APPROVAL',
        mode: 'PUSH',
      },
    ],
    cross_cutting_ui: [
      {
        id: 'CC-UI-01',
        name: '高风险合同法务红线提示横幅',
        type: 'GLOBAL_GUARD',
        scopeScreens: ['SCR-CONTRACT-EDIT', 'SCR-CONTRACT-APPROVAL'],
        description: '当 riskLevel == HIGH 时顶部常驻显示法务合规审查清单提示。',
      },
    ],
  },
  MM: {
    model_type: 'MAPPING',
    version: '1.0',
    domain: '合同全生命周期管理系统',
    mappings: [
      {
        id: 'MAP-CONTRACT-01',
        objectRef: 'AGG-01',
        objectRole: 'AGGREGATE_ROOT',
        objectName: 'Contract',
        tableMappings: [
          {
            tableName: 't_contract',
            tableRole: 'MASTER',
            primaryKey: 'id',
            foreignKeys: [
              {
                fkName: 'fk_contract_counterparty',
                localColumn: 'counterparty_id',
                targetTable: 't_counterparty',
                targetColumn: 'id',
              },
            ],
            columnMappings: [
              {
                attributeRef: 'Contract.contractNo',
                column: 'contract_no',
                columnType: 'VARCHAR(32)',
              },
              {
                attributeRef: 'Contract.title',
                column: 'title',
                columnType: 'VARCHAR(128)',
              },
              {
                attributeRef: 'Contract.contractType',
                column: 'contract_type',
                columnType: 'VARCHAR(32)',
              },
              {
                attributeRef: 'Contract.counterpartyId',
                column: 'counterparty_id',
                columnType: 'VARCHAR(36)',
                isForeignKey: true,
                fkTargetTable: 't_counterparty',
                fkTargetColumn: 'id',
              },
              {
                attributeRef: 'Contract.totalAmount',
                column: 'total_amount',
                columnType: 'DECIMAL(18,2)',
              },
              {
                attributeRef: 'Contract.status',
                column: 'status',
                columnType: 'VARCHAR(24)',
              },
              {
                attributeRef: 'Contract.signPeriod',
                column: 'sign_period_json',
                columnType: 'TEXT',
                valueObjectStrategy: 'JSON_COLUMN',
              },
              {
                attributeRef: 'Contract.riskLevel',
                column: 'risk_level',
                columnType: 'VARCHAR(16)',
              },
            ],
          },
        ],
      },
      {
        id: 'MAP-COUNTERPARTY-02',
        objectRef: 'AGG-02',
        objectRole: 'AGGREGATE_ROOT',
        objectName: 'Counterparty',
        tableMappings: [
          {
            tableName: 't_counterparty',
            tableRole: 'MASTER',
            primaryKey: 'id',
            foreignKeys: [],
            columnMappings: [
              {
                attributeRef: 'Counterparty.creditCode',
                column: 'credit_code',
                columnType: 'CHAR(18)',
              },
              {
                attributeRef: 'Counterparty.companyName',
                column: 'company_name',
                columnType: 'VARCHAR(128)',
              },
              {
                attributeRef: 'Counterparty.creditRating',
                column: 'credit_rating',
                columnType: 'VARCHAR(8)',
              },
              {
                attributeRef: 'Counterparty.status',
                column: 'status',
                columnType: 'VARCHAR(16)',
              },
            ],
          },
        ],
      },
      {
        id: 'MAP-SETTLEMENT-03',
        objectRef: 'AGG-03',
        objectRole: 'AGGREGATE_ROOT',
        objectName: 'SettlementOrder',
        tableMappings: [
          {
            tableName: 't_settlement_order',
            tableRole: 'MASTER',
            primaryKey: 'id',
            foreignKeys: [
              {
                fkName: 'fk_settlement_contract',
                localColumn: 'contract_ref',
                targetTable: 't_contract',
                targetColumn: 'id',
              },
            ],
            columnMappings: [
              {
                attributeRef: 'SettlementOrder.settlementNo',
                column: 'settlement_no',
                columnType: 'VARCHAR(32)',
              },
              {
                attributeRef: 'SettlementOrder.contractRef',
                column: 'contract_ref',
                columnType: 'VARCHAR(36)',
                isForeignKey: true,
                fkTargetTable: 't_contract',
                fkTargetColumn: 'id',
              },
              {
                attributeRef: 'SettlementOrder.settlementAmount',
                column: 'settlement_amount',
                columnType: 'DECIMAL(18,2)',
              },
              {
                attributeRef: 'SettlementOrder.settlementStatus',
                column: 'settlement_status',
                columnType: 'VARCHAR(16)',
              },
            ],
          },
        ],
      },
    ],
  },
  MI: {
    model_type: 'INTERFACE',
    version: '1.0',
    domain: '合同全生命周期管理系统',
    interfaces: [
      {
        interfaceId: 'IF-01',
        name: '起草并保存商务合同接口',
        direction: 'PROVIDED',
        interfaceCategory: 'COMMAND',
        protocol: 'REST',
        format: 'JSON',
        authMethod: 'BEARER_JWT',
        description: '对外及前端提供标准化合同起草命令接口，映射 BHV-01 行为。',
        relatedBehaviorRef: 'BHV-01',
        relatedEntityRef: 'Contract',
        inputFields: [
          {
            name: 'title',
            label: '合同名称',
            type: 'String',
            required: true,
            mappedRef: 'Contract.title',
          },
          {
            name: 'contractType',
            label: '合同类型',
            type: 'String',
            required: true,
            mappedRef: 'Contract.contractType',
          },
          {
            name: 'counterpartyId',
            label: '相对方ID',
            type: 'String',
            required: true,
            mappedRef: 'Contract.counterpartyId',
          },
          {
            name: 'totalAmount',
            label: '合同总金额',
            type: 'Money',
            required: true,
            mappedRef: 'Contract.totalAmount',
          },
        ],
        outputFields: [
          {
            name: 'contractNo',
            label: '合同编号',
            type: 'String',
            required: true,
            mappedRef: 'Contract.contractNo',
          },
          {
            name: 'status',
            label: '合同状态',
            type: 'String',
            required: true,
            mappedRef: 'Contract.status',
          },
        ],
        returnRules: [
          {
            code: 'CONTRACT_200',
            scenario: '合同草稿创建成功',
            httpStatus: 200,
            message: '合同起草成功',
          },
          {
            code: 'RULE_01_CREDIT_VIOLATION',
            scenario: '大额合同相对方资信不足 AA 级',
            httpStatus: 422,
            message: '超过 100 万元的大额合同仅允许与 AA/AAA 级资信相对方签署',
          },
        ],
      },
      {
        interfaceId: 'IF-02',
        name: '合同台账分页查询服务接口',
        direction: 'PROVIDED',
        interfaceCategory: 'QUERY',
        protocol: 'REST',
        format: 'JSON',
        authMethod: 'BEARER_JWT',
        description: '暴露 QRY-01 合同台账与履约进度的统一查询接口。',
        relatedBehaviorRef: 'BHV-05',
        relatedReportRef: 'QRY-01',
        inputFields: [
          { name: 'keyword', label: '搜索关键字', type: 'String', required: false },
          { name: 'status', label: '合同状态', type: 'String', required: false },
        ],
        outputFields: [
          { name: 'items', label: '合同台账列表', type: 'Array', required: true },
        ],
        returnRules: [
          {
            code: 'QUERY_200',
            scenario: '查询成功',
            httpStatus: 200,
            message: 'OK',
          },
        ],
      },
      {
        interfaceId: 'IF-EXT-ESIGN-03',
        name: '调用外部CA电子签章服务接口',
        direction: 'DEPENDENT',
        interfaceCategory: 'COMMAND',
        protocol: 'REST',
        format: 'JSON',
        authMethod: 'HMAC_SHA256',
        description: '合同审批通过时调用外部电子签章网关完成双方签章固化。',
        relatedBehaviorRef: 'BHV-03',
        relatedExternalEntityRef: 'ACT-EXT-ESIGN',
        inputFields: [
          {
            name: 'contractNo',
            label: '合同编号',
            type: 'String',
            required: true,
            mappedRef: 'Contract.contractNo',
          },
          {
            name: 'creditCode',
            label: '相对方信用代码',
            type: 'String',
            required: true,
            mappedRef: 'Counterparty.creditCode',
          },
        ],
        outputFields: [
          { name: 'sealSerialNo', label: '电子签章流水号', type: 'String', required: true },
        ],
        returnRules: [
          {
            code: 'ESIGN_OK',
            scenario: '签章成功',
            httpStatus: 200,
            message: '电子签章已完成',
          },
        ],
      },
    ],
  },
};

export const CONTRACT_PROTOTYPE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>合同全生命周期管理系统 · 交互原型</title>
  <style>
    :root {
      --bg: #f3f2ee;
      --surface: #fdfdfb;
      --ink: #1a1a18;
      --muted: #5a5953;
      --line: #d5d3cb;
      --accent: #4c50c4;
      --ok: #287452;
      --warn: #a86416;
    }
    body {
      margin: 0;
      padding: 20px;
      font-family: "IBM Plex Sans", "Noto Sans SC", system-ui, sans-serif;
      background: var(--bg);
      color: var(--ink);
    }
    .proto-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 14px;
      margin-bottom: 18px;
      border-bottom: 1px solid var(--line);
    }
    .proto-tabs {
      display: flex;
      gap: 8px;
    }
    .proto-tab {
      padding: 6px 14px;
      border: 1px solid var(--line);
      background: var(--surface);
      border-radius: 5px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    }
    .proto-tab.active {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }
    .screen-card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 18px;
      margin-bottom: 18px;
    }
    .screen-title {
      font-size: 16px;
      font-weight: 600;
      margin: 0 0 12px 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .tag {
      font-family: monospace;
      font-size: 11px;
      padding: 2px 8px;
      background: rgba(76, 80, 196, 0.1);
      color: var(--accent);
      border-radius: 4px;
    }
    .toolbar, .form-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-bottom: 14px;
    }
    label {
      display: block;
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 4px;
    }
    input, select {
      width: 100%;
      box-sizing: border-box;
      padding: 7px 10px;
      border: 1px solid var(--line);
      border-radius: 4px;
      background: #fff;
      font-size: 13px;
    }
    button {
      padding: 8px 14px;
      border-radius: 4px;
      border: 1px solid var(--accent);
      background: var(--accent);
      color: #fff;
      font-size: 13px;
      cursor: pointer;
    }
    button.secondary {
      background: transparent;
      color: var(--accent);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      text-align: left;
      padding: 9px 10px;
      border-bottom: 1px solid var(--line);
    }
    th {
      color: var(--muted);
      font-weight: 500;
      background: #f8f7f4;
    }
  </style>
</head>
<body>
  <div class="proto-header">
    <div>
      <strong>合同全生命周期管理系统 (Contract Lifecycle Management)</strong>
      <span class="tag">MU 语义原型锚点已绑定</span>
    </div>
  </div>

  <section
    class="screen-card"
    data-screen-id="SCR-CONTRACT-LIST"
    data-screen-name="合同台账与风险监控工作台"
    data-screen-type="LIST"
    data-route="/contracts/ledger"
  >
    <div class="screen-title">
      <span>1. 合同台账与风险监控工作台</span>
      <span class="tag">SCR-CONTRACT-LIST · QRY-01</span>
    </div>
    <div class="toolbar">
      <div>
        <label>合同名称/编号检索</label>
        <input
          data-element-id="EL-FILTER-KEYWORD"
          data-element-name="keywordInput"
          data-element-label="合同名称/编号检索"
          data-element-type="INPUT"
          data-binding="Contract.contractNo"
          placeholder="例如：CT-2026-0001"
        />
      </div>
      <div>
        <label>合同类型筛选</label>
        <select
          data-element-id="EL-FILTER-TYPE"
          data-element-name="contractTypeSelect"
          data-element-label="合同类型筛选"
          data-element-type="SELECT"
          data-binding="Contract.contractType"
        >
          <option value="">全部类型</option>
          <option value="SALES">销售合同</option>
          <option value="PROCUREMENT">采购合同</option>
          <option value="OUTSOURCING">技术服务外包合同</option>
        </select>
      </div>
      <div>
        <label>状态筛选</label>
        <select
          data-element-id="EL-FILTER-STATUS"
          data-element-name="statusSelect"
          data-element-label="状态筛选"
          data-element-type="SELECT"
          data-binding="Contract.status"
        >
          <option value="">全部状态</option>
          <option value="DRAFT">草稿 (DRAFT)</option>
          <option value="PENDING_APPROVAL">待审批 (PENDING_APPROVAL)</option>
          <option value="EXECUTING">履约执行中 (EXECUTING)</option>
        </select>
      </div>
    </div>
    <div style="margin-bottom: 12px;">
      <button
        data-element-id="EL-BTN-SEARCH"
        data-element-name="searchButton"
        data-element-label="查询合同台账"
        data-element-type="BUTTON"
        data-permission-ref="PERM-CONTRACT-READ"
        data-event-id="UIE-SEARCH-LEDGER"
        data-event-name="点击查询合同台账"
        data-behavior-ref="BHV-05"
        data-report-ref="QRY-01"
      >查询合同台账 (BHV-05 -> QRY-01)</button>
    </div>
    <table
      data-element-id="EL-LEDGER-TABLE"
      data-element-name="contractLedgerTable"
      data-element-label="合同台账数据表格"
      data-element-type="TABLE"
      data-source="QRY-01"
    >
      <thead>
        <tr>
          <th>合同编号</th>
          <th>合同名称</th>
          <th>签约相对方</th>
          <th>资信等级</th>
          <th>合同总金额</th>
          <th>风险等级</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>CT-2026-0001</td>
          <td>云原生算力底座年度采购合同</td>
          <td>星河智算科技有限公司</td>
          <td>AAA</td>
          <td>¥ 2,400,000.00</td>
          <td>HIGH</td>
          <td>EXECUTING</td>
        </tr>
        <tr>
          <td>CT-2026-0002</td>
          <td>企业本体知识图谱咨询服务合同</td>
          <td>远景数智咨询集团</td>
          <td>AA</td>
          <td>¥ 680,000.00</td>
          <td>MEDIUM</td>
          <td>PENDING_APPROVAL</td>
        </tr>
      </tbody>
    </table>
  </section>

  <section
    class="screen-card"
    data-screen-id="SCR-CONTRACT-EDIT"
    data-screen-name="合同起草与条款配置页"
    data-screen-type="FORM"
    data-route="/contracts/edit"
  >
    <div class="screen-title">
      <span>2. 合同起草与条款配置页</span>
      <span class="tag">SCR-CONTRACT-EDIT · BHV-01 / BHV-02</span>
    </div>
    <div class="form-grid">
      <div>
        <label>合同编号</label>
        <input
          data-element-id="EL-CONTRACT-NO"
          data-element-name="contractNoField"
          data-element-label="合同编号"
          data-element-type="INPUT"
          data-binding="Contract.contractNo"
          data-required="true"
          value="CT-2026-0003"
        />
      </div>
      <div>
        <label>合同名称</label>
        <input
          data-element-id="EL-CONTRACT-TITLE"
          data-element-name="titleField"
          data-element-label="合同名称"
          data-element-type="INPUT"
          data-binding="Contract.title"
          data-required="true"
          value="智能仓储AGV设备供货及维保合同"
        />
      </div>
      <div>
        <label>合同类型</label>
        <select
          data-element-id="EL-CONTRACT-TYPE"
          data-element-name="contractTypeField"
          data-element-label="合同类型"
          data-element-type="SELECT"
          data-binding="Contract.contractType"
          data-required="true"
        >
          <option value="PROCUREMENT">采购合同 (PROCUREMENT)</option>
          <option value="SALES">销售合同 (SALES)</option>
        </select>
      </div>
      <div>
        <label>签约相对方</label>
        <select
          data-element-id="EL-COUNTERPARTY-REF"
          data-element-name="counterpartySelect"
          data-element-label="签约相对方"
          data-element-type="SELECT"
          data-binding="Contract.counterpartyId"
          data-required="true"
        >
          <option value="CP-001">星河智算科技有限公司 (AAA)</option>
          <option value="CP-002">远景数智咨询集团 (AA)</option>
        </select>
      </div>
      <div>
        <label>合同总金额(元)</label>
        <input
          type="number"
          data-element-id="EL-TOTAL-AMOUNT"
          data-element-name="totalAmountField"
          data-element-label="合同总金额(元)"
          data-element-type="NUMBER"
          data-binding="Contract.totalAmount"
          data-required="true"
          value="1250000"
        />
      </div>
      <div>
        <label>风险定级</label>
        <input
          data-element-id="EL-RISK-LEVEL"
          data-element-name="riskLevelBadge"
          data-element-label="风险定级"
          data-element-type="BADGE"
          data-binding="Contract.riskLevel"
          value="MEDIUM (部门+法务会签)"
          readonly
        />
      </div>
      <div>
        <label>履约起止期限</label>
        <input
          data-element-id="EL-SIGN-PERIOD"
          data-element-name="signPeriodPicker"
          data-element-label="履约起止期限"
          data-element-type="DATE_PICKER"
          data-binding="Contract.signPeriod"
          data-required="true"
          value="2026-04-01 ~ 2027-03-31"
        />
      </div>
      <div>
        <label>合同状态</label>
        <input
          data-element-id="EL-CONTRACT-STATUS"
          data-element-name="contractStatusBadge"
          data-element-label="合同状态"
          data-element-type="BADGE"
          data-binding="Contract.status"
          value="DRAFT"
          readonly
        />
      </div>
    </div>
    <div style="display: flex; gap: 10px;">
      <button
        class="secondary"
        data-element-id="EL-BTN-SAVE-DRAFT"
        data-element-name="saveDraftBtn"
        data-element-label="保存合同草稿"
        data-element-type="BUTTON"
        data-permission-ref="PERM-CONTRACT-WRITE"
        data-event-id="UIE-SAVE-DRAFT"
        data-event-name="点击保存合同草稿"
        data-rule-ref="RULE-01"
        data-behavior-ref="BHV-01"
        data-emit-event-ref="EVT-01"
      >保存合同草稿 (RULE-01 -> BHV-01 -> EVT-01)</button>
      <button
        data-element-id="EL-BTN-SUBMIT-APPROVAL"
        data-element-name="submitApprovalBtn"
        data-element-label="提交合同审批"
        data-element-type="BUTTON"
        data-permission-ref="PERM-CONTRACT-SUBMIT"
        data-event-id="UIE-SUBMIT-APPROVAL"
        data-event-name="点击提交合同审批"
        data-rule-ref="RULE-02"
        data-behavior-ref="BHV-02"
        data-emit-event-ref="EVT-02"
      >提交合同审批 (RULE-02 -> BHV-02 -> EVT-02)</button>
    </div>
  </section>

  <section
    class="screen-card"
    data-screen-id="SCR-CONTRACT-APPROVAL"
    data-screen-name="法务风险会签与审批工作台"
    data-screen-type="APPROVAL"
    data-route="/contracts/approval"
  >
    <div class="screen-title">
      <span>3. 法务风险会签与审批工作台</span>
      <span class="tag">SCR-CONTRACT-APPROVAL · SCN-01</span>
    </div>
    <div style="margin-bottom: 12px;">
      <label>法务会签审批意见</label>
      <input
        data-element-id="EL-APPROVAL-OPINION"
        data-element-name="approvalOpinionInput"
        data-element-label="法务会签审批意见"
        data-element-type="INPUT"
        data-required="true"
        value="相对方资信AAA，违约责任与知识产权条款合规，同意签署并触发首期结算。"
      />
    </div>
    <button
      data-element-id="EL-BTN-APPROVE"
      data-element-name="approveContractBtn"
      data-element-label="审批通过并触发签章结算"
      data-element-type="BUTTON"
      data-permission-ref="PERM-CONTRACT-APPROVE"
      data-event-id="UIE-APPROVE-CONTRACT"
      data-event-name="点击审批通过合同"
      data-rule-ref="RULE-03"
      data-behavior-ref="BHV-03"
      data-emit-event-ref="EVT-03"
    >审批通过并触发签章结算 (RULE-03 -> BHV-03 -> EVT-03)</button>
  </section>
</body>
</html>`;

export const MFT_ENTERPRISE_SUITE: OntologySuite = {
  M1: {
    model_type: 'OBJECT',
    version: '5.0',
    domain: '企业文件安全传输系统 (MFT)',
    aggregates: [
      {
        id: 'AGG-MFT-01',
        name: 'TransferTask',
        alias: '文件传输任务',
        aggregateType: 'AGGREGATE_ROOT',
        description: '跨安全域大文件加密传输任务聚合根，支持断点续传、SHA256校验与病毒扫描。',
        lifecycle: ['QUEUED', 'SCANNING', 'TRANSFERRING', 'COMPLETED', 'QUARANTINED'],
        tags: ['MFT', 'SECURITY'],
        attributes: [
          { name: 'taskNo', label: '传输单号', type: 'String', required: true },
          { name: 'fileName', label: '文件名称', type: 'String', required: true },
          { name: 'fileSizeMb', label: '文件大小(MB)', type: 'Decimal', required: true },
          { name: 'sha256Digest', label: 'SHA256摘要', type: 'String', required: true },
          {
            name: 'status',
            label: '传输状态',
            type: 'Enum',
            required: true,
            enumValues: ['QUEUED', 'SCANNING', 'TRANSFERRING', 'COMPLETED', 'QUARANTINED'],
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
  M2: {
    model_type: 'BEHAVIOR',
    version: '5.0',
    domain: '企业文件安全传输系统 (MFT)',
    behaviors: [
      {
        id: 'BHV-MFT-01',
        name: 'dispatchSecureTransfer',
        alias: '发起跨网安全传输',
        ownerEntity: 'TransferTask',
        behaviorType: 'COMMAND',
        triggerType: 'USER_ACTION',
        description: '校验文件脱敏合规后发起跨网加密通道传输。',
        inputParameters: [
          { name: 'fileName', label: '文件名称', type: 'String', required: true },
          { name: 'fileSizeMb', label: '文件大小(MB)', type: 'Decimal', required: true },
        ],
        outputParameters: [{ name: 'taskNo', label: '传输单号', type: 'String', required: true }],
        preconditions: [],
        stateChanges: [],
        invokedRules: ['RULE-MFT-01'],
        producedEvents: ['EVT-MFT-01'],
        requiredPermissions: ['PERM-MFT-DISPATCH'],
      },
    ],
  },
  M3: {
    model_type: 'RULE',
    version: '5.0',
    domain: '企业文件安全传输系统 (MFT)',
    rules: [
      {
        id: 'RULE-MFT-01',
        name: 'SingleFileMaxSizeRule',
        alias: '单文件跨网传输体积上限规则',
        ruleType: 'VALIDATION',
        scope: 'CROSS_OBJECT',
        version: '1.0',
        referencedObjects: ['TransferTask'],
        parameters: [],
        expression: 'TransferTask.fileSizeMb <= 10240',
        violationMessage: '单次跨网传输文件不得超过 10GB (10240MB)',
        triggeredByEvents: [],
        producedEvents: [],
        triggeredBehaviors: [],
      },
    ],
  },
  ME: {
    model_type: 'EVENT',
    version: '5.0',
    domain: '企业文件安全传输系统 (MFT)',
    events: [
      {
        id: 'EVT-MFT-01',
        name: 'TransferTask.Dispatched',
        label: '文件传输已调度事件',
        producerType: 'BEHAVIOR',
        producerBehaviorRef: 'BHV-MFT-01',
        sourceAggregate: 'TransferTask',
        orderingSemantic: 'AT_LEAST_ONCE',
        payload: [{ name: 'taskNo', label: '传输单号', type: 'String', required: true }],
        subscribers: [],
      },
    ],
  },
  M5: {
    model_type: 'ACTOR',
    version: '5.0',
    domain: '企业文件安全传输系统 (MFT)',
    actors: [
      {
        id: 'ACT-MFT-OPS',
        name: '安全传输管理员',
        actorType: 'HUMAN',
        roles: ['ROLE-MFT-ADMIN'],
      },
    ],
    roles: [
      {
        id: 'ROLE-MFT-ADMIN',
        name: '传输管理员角色',
        code: 'MFT_ADMIN',
        inheritsFrom: [],
        permissions: ['PERM-MFT-DISPATCH'],
        dataScope: 'ALL',
      },
    ],
    permissions: [
      {
        id: 'PERM-MFT-DISPATCH',
        name: '发起安全传输权限',
        code: 'mft:dispatch',
        targetAggregate: 'TransferTask',
        allowedBehaviors: ['BHV-MFT-01'],
        uiControlledElements: [],
      },
    ],
  },
};
