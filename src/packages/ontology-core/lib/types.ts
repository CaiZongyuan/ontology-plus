import { z } from 'zod';

export const MODEL_FILE_NAMES = {
  M1: 'm1-object-model.yaml',
  M2: 'm2-behavior-model.yaml',
  M3: 'm3-rule-model.yaml',
  ME: 'me-event-model.yaml',
  M4: 'm4-scenario-model.yaml',
  M5: 'm5-actor-model.yaml',
  M6: 'm6-flow-model.yaml',
  M7: 'm7-report-model.yaml',
  MU: 'mu-ui-model.yaml',
  MM: 'm-mapping-model.yaml',
  MI: 'mi-interface-model.yaml',
} as const;

export type ModelCode = keyof typeof MODEL_FILE_NAMES;

export const MODEL_CODES: ModelCode[] = [
  'M1',
  'M2',
  'M3',
  'ME',
  'M4',
  'M5',
  'M6',
  'M7',
  'MU',
  'MM',
  'MI',
];

export const MODEL_STAGE_ORDER: { stage: number; code: ModelCode; labelZh: string; labelEn: string }[] = [
  { stage: 1, code: 'M1', labelZh: 'M1 对象模型', labelEn: 'M1 Object Model' },
  { stage: 2, code: 'M5', labelZh: 'M5 主体模型', labelEn: 'M5 Actor Model' },
  { stage: 3, code: 'M3', labelZh: 'M3 规则模型', labelEn: 'M3 Rule Model' },
  { stage: 4, code: 'M2', labelZh: 'M2 行为模型', labelEn: 'M2 Behavior Model' },
  { stage: 5, code: 'M7', labelZh: 'M7 查询与报表模型', labelEn: 'M7 Query & Report Model' },
  { stage: 6, code: 'ME', labelZh: 'ME 事件模型', labelEn: 'ME Event Model' },
  { stage: 7, code: 'M4', labelZh: 'M4 场景模型', labelEn: 'M4 Scenario Model' },
  { stage: 8, code: 'M6', labelZh: 'M6 流程模型', labelEn: 'M6 Flow Model' },
  { stage: 9, code: 'MU', labelZh: 'MU UI 模型', labelEn: 'MU UI Model' },
  { stage: 10, code: 'MM', labelZh: 'MM 数据表映射模型', labelEn: 'MM Mapping Model' },
  { stage: 11, code: 'MI', labelZh: 'MI 接口模型', labelEn: 'MI Interface Model' },
];

// ─── Manifest Schema (§14.3: strictly relative paths) ─────────────────────────
export function isRelativeManifestPath(p: string): boolean {
  if (!p || !p.trim()) return false;
  const trimmed = p.trim();
  if (trimmed.startsWith('/')) return false;
  if (trimmed.includes('\\')) return false;
  if (/^[A-Za-z]:/.test(trimmed)) return false;
  const segments = trimmed.split('/');
  if (segments.some((s) => s === '..')) return false;
  return true;
}

export const ManifestSchema = z
  .object({
    version: z.string().default('1.0'),
    projectId: z.string(),
    domain: z.string(),
    models: z.record(z.string(), z.string()).default({}),
  })
  .superRefine((val, ctx) => {
    for (const [key, relPath] of Object.entries(val.models)) {
      if (!isRelativeManifestPath(relPath)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['models', key],
          message: `Manifest path "${relPath}" for "${key}" must be a relative path (no leading "/", "\\", "..", or Windows drive prefix per §14.3).`,
        });
      }
    }
  });

export type OntologyManifest = z.infer<typeof ManifestSchema>;

// ─── M1 Object Model ──────────────────────────────────────────────────────────
export const AttributeRuleSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  expression: z.string(),
  violationMessage: z.string(),
  enforcedAt: z.enum(['ON_CREATE', 'ON_UPDATE', 'ON_DELETE', 'ALWAYS']).default('ALWAYS'),
});

export const AttributeSchema = z.object({
  name: z.string(),
  label: z.string(),
  type: z.enum([
    'String',
    'Integer',
    'Decimal',
    'Date',
    'DateTime',
    'Boolean',
    'Enum',
    'Money',
    'ValueObject',
    'AggregateRootRef',
    'DictionaryRef',
  ]),
  required: z.boolean().default(false),
  unique: z.boolean().optional(),
  defaultValue: z.any().optional(),
  enumValues: z.array(z.string()).optional(),
  valueObjectRef: z.string().optional(),
  targetAggregate: z.string().optional(),
  dictionaryRef: z
    .object({
      dictionaryId: z.string(),
      typeCode: z.string(),
    })
    .optional(),
  refRules: z.array(AttributeRuleSchema).optional(),
  description: z.string().optional(),
  uiBindings: z.array(z.string()).optional(),
});

export const SubEntitySchema = z.object({
  name: z.string(),
  alias: z.string(),
  description: z.string().optional(),
  localId: z.string(),
  cardinality: z
    .enum([
      'ONE',
      'ZERO_OR_ONE',
      'ONE_OR_MORE',
      'ZERO_OR_MORE',
      'ONE_TO_MANY',
      'ONE_TO_ONE',
      'MANY_TO_MANY',
    ])
    .default('ONE_OR_MORE'),
  cascadeDelete: z.boolean().default(true),
  attributes: z.array(AttributeSchema).default([]),
});

export const ValueObjectSchema = z.object({
  name: z.string(),
  alias: z.string(),
  description: z.string().optional(),
  immutable: z.boolean().default(true),
  equalityFields: z.array(z.string()).default([]),
  attributes: z.array(AttributeSchema).default([]),
});

export const InvariantSchema = z.object({
  name: z.string(),
  expression: z.string(),
  violationMessage: z.string(),
  enforcedAt: z.enum(['ON_CREATE', 'ON_UPDATE', 'ON_DELETE', 'ALWAYS']).default('ALWAYS'),
});

export const AggregateRootSchema = z.object({
  id: z.string(),
  name: z.string(),
  alias: z.string(),
  aggregateType: z.literal('AGGREGATE_ROOT').default('AGGREGATE_ROOT'),
  description: z.string().optional(),
  lifecycle: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  attributes: z.array(AttributeSchema).default([]),
  entities: z.array(SubEntitySchema).default([]),
  valueObjects: z.array(ValueObjectSchema).default([]),
  invariants: z.array(InvariantSchema).default([]),
  uiBindings: z.array(z.string()).optional(),
});

export const DictionaryItemSchema = z.object({
  code: z.string(),
  label: z.string(),
  enabled: z.boolean().default(true),
  sortOrder: z.number().default(10),
  description: z.string().optional(),
});

export const DictionaryTypeSchema = z.object({
  typeCode: z.string(),
  typeName: z.string(),
  description: z.string().optional(),
  items: z.array(DictionaryItemSchema).default([]),
});

export const DataDictionarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  types: z.array(DictionaryTypeSchema).default([]),
});

export const AggregateAssociationSchema = z.object({
  id: z.string(),
  sourceAggregate: z.string(),
  targetAggregate: z.string(),
  associationType: z.enum(['REFERENCE', 'DEPENDENCY']).default('REFERENCE'),
  sourceRole: z.string(),
  targetRole: z.string(),
  cardinality: z.enum(['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY']),
  referenceField: z.string(),
  description: z.string().optional(),
});

export const M1ObjectModelSchema = z.object({
  model_type: z.literal('OBJECT').default('OBJECT'),
  version: z.string().default('5.0'),
  domain: z.string(),
  aggregates: z.array(AggregateRootSchema).default([]),
  data_dictionaries: z.array(DataDictionarySchema).default([]),
  aggregate_associations: z.array(AggregateAssociationSchema).default([]),
});

// ─── M2 Behavior Model ────────────────────────────────────────────────────────
export const BehaviorParameterSchema = z.object({
  name: z.string(),
  label: z.string().optional(),
  type: z.string(),
  required: z.boolean().default(false),
  description: z.string().optional(),
});

export const BehaviorConditionSchema = z.object({
  name: z.string(),
  expression: z.string(),
  violationMessage: z.string().optional(),
});

export const StateChangeSchema = z.object({
  targetField: z.string(),
  changeType: z.enum(['SET', 'TRANSITION', 'APPEND', 'REMOVE', 'COMPUTE']).default('SET'),
  expression: z.string(),
  description: z.string().optional(),
});

export const ProducedEventRefSchema = z.union([
  z.string(),
  z.object({
    eventRef: z.string(),
    triggerCondition: z.string().optional(),
  }),
]);

export const SyncTriggerSchema = z.object({
  ruleRef: z.string().optional(),
  behaviorRef: z.string(),
  parameterMapping: z.record(z.string(), z.string()).optional(),
  description: z.string().optional(),
});

export const BehaviorItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  alias: z.string(),
  ownerEntity: z.string(),
  behaviorType: z.enum(['COMMAND', 'QUERY', 'EVENT_HANDLER', 'EXTERNAL_CALL']),
  triggerType: z
    .enum(['USER_ACTION', 'EVENT', 'SCHEDULE', 'EXTERNAL', 'SYSTEM', 'FLOW'])
    .default('USER_ACTION'),
  description: z.string().optional(),
  inputParameters: z.array(BehaviorParameterSchema).default([]),
  outputParameters: z.array(BehaviorParameterSchema).default([]),
  preconditions: z.array(BehaviorConditionSchema).default([]),
  stateChanges: z.array(StateChangeSchema).default([]),
  invokedRules: z.array(z.string()).default([]),
  producedEvents: z.array(ProducedEventRefSchema).default([]),
  syncTriggers: z.array(SyncTriggerSchema).optional(),
  requiredPermissions: z.array(z.string()).default([]),
  queryReportRef: z.string().optional(),
  uiEventRefs: z.array(z.string()).optional(),
});

export const M2BehaviorModelSchema = z.object({
  model_type: z.literal('BEHAVIOR').default('BEHAVIOR'),
  version: z.string().default('5.0'),
  domain: z.string(),
  behaviors: z.array(BehaviorItemSchema).default([]),
});

// ─── M3 Rule Model ────────────────────────────────────────────────────────────
export const RuleItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  alias: z.string(),
  ruleType: z
    .enum([
      'VALIDATION',
      'CALCULATION',
      'DECISION_TABLE',
      'EVENT_RULE',
      'POLICY',
      'DERIVATION',
      'TRANSFORMATION',
      'RISK',
      'RISK_CONTROL',
      'EVENT_DRIVEN',
    ])
    .default('VALIDATION'),
  scope: z
    .enum(['CROSS_OBJECT', 'CROSS_BEHAVIOR', 'EVENT_DRIVEN', 'EXTERNAL_DECISION', 'REUSABLE'])
    .default('CROSS_OBJECT'),
  version: z.string().default('1.0'),
  description: z.string().optional(),
  referencedObjects: z.array(z.string()).default([]),
  parameters: z
    .array(
      z.object({
        name: z.string(),
        type: z.string(),
        source: z.string().optional(),
        sourceField: z.string().optional(),
        required: z.boolean().optional(),
        description: z.string().optional(),
      }),
    )
    .default([]),
  outputType: z.string().optional(),
  expression: z.string(),
  violationMessage: z.string().optional(),
  reusedBy: z.array(z.string()).optional(),
  externalEngine: z.string().optional(),
  triggerType: z.enum(['BEHAVIOR', 'EVENT', 'MANUAL', 'SYSTEM']).optional(),
  conditionExpression: z.string().optional(),
  eventTriggerCondition: z.string().optional(),
  executionMode: z.enum(['SYNC', 'ASYNC']).optional(),
  timeout: z.string().optional(),
  triggeredByEvents: z.array(z.string()).default([]),
  producedEvents: z.array(z.string()).default([]),
  triggeredBehaviors: z
    .array(
      z.object({
        behaviorRef: z.string(),
        parameterMapping: z.record(z.string(), z.string()).optional(),
      }),
    )
    .default([]),
  idempotencyKey: z.string().optional(),
  uiValidationRefs: z.array(z.string()).optional(),
});

export const M3RuleModelSchema = z.object({
  model_type: z.literal('RULE').default('RULE'),
  version: z.string().default('5.0'),
  domain: z.string(),
  rules: z.array(RuleItemSchema).default([]),
});

// ─── ME Event Model ───────────────────────────────────────────────────────────
export const EventPayloadFieldSchema = z.object({
  name: z.string(),
  label: z.string().optional(),
  type: z.string(),
  required: z.boolean().default(true),
  sourceField: z.string().optional(),
  description: z.string().optional(),
});

export const EventSubscriberSchema = z.object({
  subscriberType: z.enum(['BEHAVIOR', 'RULE']),
  subscriberRef: z.string(),
  subscriberEntityRef: z.string().optional(),
  priority: z.number().optional(),
  deliveryMode: z.enum(['ASYNC', 'SYNC']).default('ASYNC'),
  condition: z.string().optional(),
  idempotencyStrategy: z.string().optional(),
  description: z.string().optional(),
});

export const EventItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  label: z.string(),
  description: z.string().optional(),
  producerType: z.enum(['BEHAVIOR', 'RULE']).default('BEHAVIOR'),
  producerBehaviorRef: z.string().default(''),
  producerRuleRef: z.string().optional(),
  sourceAggregate: z.string(),
  triggerCondition: z.string().optional(),
  version: z.string().optional(),
  orderingSemantic: z
    .enum(['AT_LEAST_ONCE', 'EXACTLY_ONCE', 'BEST_EFFORT', 'FIFO'])
    .default('AT_LEAST_ONCE'),
  idempotencyKey: z.string().optional(),
  payload: z.array(EventPayloadFieldSchema).default([]),
  subscribers: z.array(EventSubscriberSchema).default([]),
  uiEventPath: z.union([z.string(), z.array(z.string())]).optional(),
});

export const MEEventModelSchema = z.object({
  model_type: z.literal('EVENT').default('EVENT'),
  version: z.string().default('5.0'),
  domain: z.string(),
  events: z.array(EventItemSchema).default([]),
});

// ─── M4 Scenario Model ────────────────────────────────────────────────────────
export const ScenarioStepSchema = z.object({
  stepOrder: z.number(),
  stepId: z.string().optional(),
  stepType: z.enum(['BEHAVIOR_CALL', 'EVENT_EMIT', 'RULE_EVALUATE']),
  refId: z.string(),
  nextSteps: z.array(z.string()).optional(),
  targetAggregate: z.string().optional(),
  description: z.string().optional(),
});

export const ScenarioItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  sourceObjectRef: z.string().optional(),
  targetObjectRefs: z.array(z.string()).optional(),
  triggerBehaviorRef: z.string().optional(),
  triggerEventRef: z.string(),
  involvedAggregates: z.array(z.string()).default([]),
  preconditions: z.array(z.string()).default([]),
  postconditions: z.array(z.string()).default([]),
  steps: z.array(ScenarioStepSchema).default([]),
  uiTriggerScreen: z.string().optional(),
});

export const M4ScenarioModelSchema = z.object({
  model_type: z.literal('SCENARIO').default('SCENARIO'),
  version: z.string().default('5.0'),
  domain: z.string(),
  event_scenarios: z.array(ScenarioItemSchema).default([]),
});

// ─── M5 Actor Model ───────────────────────────────────────────────────────────
export const ActorItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  actorType: z.enum(['HUMAN', 'SYSTEM', 'EXTERNAL_ENTITY']).default('HUMAN'),
  roles: z.array(z.string()).default([]),
  attributes: z.record(z.string(), z.string()).optional(),
  description: z.string().optional(),
  externalContract: z
    .object({
      protocol: z.string(),
      format: z.string().default('JSON'),
      authType: z.string().default('BEARER_TOKEN'),
      timeoutMs: z.number().default(5000),
      retryPolicy: z.string().optional(),
    })
    .optional(),
});

export const RoleItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  inheritsFrom: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([]),
  permissionGroups: z.array(z.string()).optional(),
  dataScope: z.enum(['ALL', 'DEPARTMENT', 'DEPT', 'SELF', 'OWN', 'CUSTOM']).default('ALL'),
  abacCondition: z.string().optional(),
  description: z.string().optional(),
});

export const PermissionGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  permissions: z.array(z.string()).default([]),
  description: z.string().optional(),
});

export const PermissionItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  targetType: z.enum(['BEHAVIOR', 'ENTITY']).optional(),
  targetRef: z.string().optional(),
  dataScope: z.enum(['ALL', 'DEPARTMENT', 'DEPT', 'SELF', 'OWN', 'CUSTOM']).optional(),
  targetAggregate: z.string(),
  allowedBehaviors: z.array(z.string()).default([]),
  abacCondition: z.string().optional(),
  uiControlledElements: z.array(z.string()).default([]),
});

export const M5ActorModelSchema = z.object({
  model_type: z.literal('ACTOR').default('ACTOR'),
  version: z.string().default('5.0'),
  domain: z.string(),
  actors: z.array(ActorItemSchema).default([]),
  roles: z.array(RoleItemSchema).default([]),
  permissionGroups: z.array(PermissionGroupSchema).optional(),
  permissions: z.array(PermissionItemSchema).default([]),
});

// ─── M6 Flow Model ────────────────────────────────────────────────────────────
export const FlowBranchSchema = z.object({
  branchName: z.string().optional(),
  targetActivity: z.string(),
  condition: z.string().optional(),
  conditionExpression: z.string().optional(),
  ruleRef: z.string().optional(),
  approvalOutcome: z.string().optional(),
  isDefault: z.boolean().default(false),
  label: z.string().optional(),
});

export const FlowActivitySchema = z.object({
  id: z.string(),
  name: z.string(),
  activityType: z.enum([
    'START',
    'END',
    'USER_TASK',
    'APPROVAL_TASK',
    'SYSTEM_TASK',
    'BEHAVIOR_CALL',
    'SCENARIO_CALL',
    'SUB_FLOW_CALL',
    'XOR_GATEWAY',
    'GATEWAY',
    'AND_JOIN',
    'EVENT_WAIT',
  ]),
  roleRef: z.string().optional(),
  behaviorRef: z.string().optional(),
  scenarioRef: z.string().optional(),
  subFlowRef: z.string().optional(),
  screenRef: z.string().optional(),
  ruleRef: z.string().optional(),
  conditionExpression: z.string().optional(),
  eventRef: z.string().optional(),
  timeout: z.string().optional(),
  approvalOutcomes: z.array(z.string()).optional(),
  nextActivity: z.string().optional(),
  nextActivities: z.array(z.string()).optional(),
  branches: z.array(FlowBranchSchema).default([]),
});

export const FlowItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  flowType: z.enum(['COLLABORATION', 'APPROVAL']),
  primaryAggregate: z.string(),
  businessObjectRefs: z.array(z.string()).optional(),
  roleRefs: z.array(z.string()).default([]),
  description: z.string().optional(),
  preconditions: z.array(z.string()).optional(),
  postconditions: z.array(z.string()).optional(),
  startActivity: z.string().optional(),
  endActivities: z.array(z.string()).optional(),
  version: z.string().optional(),
  trigger: z.object({
    triggerType: z
      .enum(['USER_ACTION', 'EVENT', 'SUB_FLOW', 'MANUAL', 'BEHAVIOR', 'SCHEDULE'])
      .default('USER_ACTION'),
    refId: z.string().optional(),
    behaviorRef: z.string().optional(),
    eventRef: z.string().optional(),
    scheduleExpression: z.string().optional(),
    description: z.string().optional(),
  }),
  activities: z.array(FlowActivitySchema).default([]),
});

export const M6FlowModelSchema = z.object({
  model_type: z.literal('FLOW').default('FLOW'),
  version: z.string().default('5.0'),
  domain: z.string(),
  flows: z.array(FlowItemSchema).default([]),
});

// ─── M7 Query & Report Model ──────────────────────────────────────────────────
export const QueryReportSourceObjectSchema = z.object({
  objectRef: z.string(),
  alias: z.string(),
  primary: z.boolean().optional(),
  entityPath: z.string().optional(),
  preAggregation: z
    .object({
      groupBy: z.array(z.string()).default([]),
      columns: z
        .array(
          z.object({
            name: z.string(),
            sourceExpression: z.string(),
            aggregateFunction: z.string(),
          }),
        )
        .default([]),
    })
    .optional(),
});

export const QueryReportItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  alias: z.string(),
  queryType: z.enum(['DETAIL_QUERY', 'LIST_QUERY', 'QUERY', 'STATISTICAL_QUERY', 'REPORT']),
  behaviorRef: z.string(),
  description: z.string().optional(),
  sourceObjects: z.array(QueryReportSourceObjectSchema).optional(),
  primarySource: z.object({
    aggregateRef: z.string(),
    alias: z.string(),
  }),
  joins: z
    .array(
      z.object({
        joinId: z.string().optional(),
        joinType: z.enum(['INNER', 'LEFT', 'RIGHT', 'FULL']).default('LEFT'),
        leftSource: z.string().optional(),
        rightSource: z.string().optional(),
        relationRef: z.string().optional(),
        aggregateRef: z.string(),
        alias: z.string(),
        onCondition: z.string(),
        preAggregated: z.boolean().optional(),
      }),
    )
    .default([]),
  parameters: z
    .array(
      z.object({
        name: z.string(),
        label: z.string(),
        type: z.string(),
        required: z.boolean().default(false),
        defaultValue: z.any().optional(),
      }),
    )
    .default([]),
  conditions: z
    .array(
      z.object({
        conditionId: z.string().optional(),
        field: z.string(),
        operator: z.string(),
        parameterRef: z.string().optional(),
        expression: z.string().optional(),
        logicalConnector: z.string().optional(),
        skipWhenParameterEmpty: z.boolean().optional(),
      }),
    )
    .default([]),
  resultColumns: z
    .array(
      z.object({
        name: z.string(),
        label: z.string(),
        sourceExpr: z.string(),
        dataType: z.string(),
        aggregation: z
          .enum(['SUM', 'COUNT', 'COUNT_DISTINCT', 'AVG', 'MIN', 'MAX', 'NONE'])
          .optional(),
      }),
    )
    .default([]),
  groupBy: z.array(z.string()).default([]),
  having: z.array(z.any()).optional(),
  orderBy: z
    .array(
      z.object({
        field: z.string(),
        direction: z.enum(['ASC', 'DESC']).default('DESC'),
      }),
    )
    .default([]),
  pagination: z
    .object({
      enabled: z.boolean().default(true),
      defaultPageSize: z.number().default(20),
      maxPageSize: z.number().default(100),
    })
    .optional(),
  reportOptions: z
    .object({
      title: z.string().optional(),
      layout: z.string().optional(),
      groupFields: z.array(z.string()).optional(),
      subtotalFields: z.array(z.string()).optional(),
      totalFields: z.array(z.string()).optional(),
      emptyValueDisplay: z.string().optional(),
      exportFormats: z.array(z.enum(['XLSX', 'CSV', 'PDF'])).default(['XLSX', 'CSV']),
      summaryRow: z.boolean().default(true),
      groupHeaders: z.array(z.string()).default([]),
    })
    .optional(),
  referenceSql: z.object({
    dialect: z.string().default('SQLite'),
    sql: z.string(),
    parameterMappings: z.array(z.string()).default([]),
    resultMappings: z.array(z.string()).default([]),
  }),
  uiScreenRefs: z.array(z.string()).optional(),
});

export const M7ReportModelSchema = z.object({
  model_type: z.enum(['QUERY_REPORT', 'REPORT']).default('QUERY_REPORT'),
  version: z.string().default('5.0'),
  domain: z.string(),
  query_reports: z.array(QueryReportItemSchema).default([]),
});

// ─── MU UI Model ──────────────────────────────────────────────────────────────
export const UIElementSchema = z.object({
  elementId: z.string(),
  name: z.string(),
  label: z.string(),
  elementType: z.enum([
    'INPUT',
    'SELECT',
    'DATE_PICKER',
    'DATEPICKER',
    'NUMBER',
    'TABLE',
    'BUTTON',
    'TAB',
    'BADGE',
    'VIEWER',
    'REPORT_VIEWER',
    'CONTAINER',
    'TEXTBOX',
    'TEXTAREA',
    'COMBO',
    'POPUP_SELECT',
    'CHECKBOX',
    'RADIO',
    'SWITCH',
    'TOOLBAR',
    'MENU',
    'LISTVIEW',
    'GRID',
    'TREEVIEW',
    'TREE',
    'TIMER',
    'MODAL',
    'LABEL',
    'IMAGE',
    'FRAME',
    'OTHER',
  ]),
  io: z.enum(['IN', 'OUT', 'IN_OUT', 'ACTION']).default('IN_OUT'),
  actionType: z.enum(['DRAFT', 'SUBMIT', 'DEFAULT', 'QUERY', 'DELETE', 'NAVIGATE']).optional(),
  required: z.boolean().default(false),
  enabled: z.boolean().optional(),
  dataBinding: z.string().optional(),
  dictionaryRef: z.string().optional(),
  dataSource: z.string().optional(),
  permissionRef: z.string().optional(),
  refRules: z.array(z.any()).optional(),
});

export const CallChainStepSchema = z.object({
  stepOrder: z.number(),
  stepType: z.enum([
    'VALIDATE',
    'BEHAVIOR_CALL',
    'EVENT_EMIT',
    'SCENARIO_CALL',
    'REPORT_CALL',
    'QUERY_REPORT',
    'NAVIGATE',
    'CLOSE_MODAL',
    'EXIT',
    'DEVICE_SETUP',
    'TOGGLE_INPUT',
  ]),
  refId: z.string(),
  rules: z.array(z.string()).optional(),
  targets: z.array(z.string()).optional(),
  description: z.string().optional(),
});

export const UIEventSchema = z.object({
  eventId: z.string(),
  name: z.string(),
  source: z.string().optional(),
  preConditions: z.array(z.string()).optional(),
  triggerElementId: z.string(),
  triggerAction: z.enum(['CLICK', 'CHANGE', 'SUBMIT', 'LOAD']).default('CLICK'),
  permissions: z.array(z.string()).default([]),
  callChain: z.array(CallChainStepSchema).default([]),
});

export const ScreenItemSchema = z.object({
  screenId: z.string(),
  name: z.string(),
  screenType: z
    .enum([
      'LIST',
      'FORM',
      'DETAIL',
      'APPROVAL',
      'REPORT',
      'DASHBOARD',
      'MODAL',
      'SINGLE_FORM',
      'LIST_MAINTENANCE',
      'MASTER_DETAIL_FORM',
      'QUERY_LIST',
    ])
    .default('LIST'),
  route: z.string().optional(),
  screenRef: z.string().optional(),
  description: z.string().optional(),
  roleRefs: z.array(z.string()).default([]),
  layout: z.string().optional(),
  elements: z.array(UIElementSchema).default([]),
  events: z.array(UIEventSchema).default([]),
});

export const NavigationEdgeSchema = z.object({
  id: z.string(),
  fromScreen: z.string(),
  toScreen: z.string(),
  triggerEventId: z.string().optional(),
  condition: z.string().optional(),
  mode: z.enum(['PUSH', 'MODAL', 'REPLACE', 'BACK']).default('PUSH'),
});

export const CrossCuttingUISchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['SHORTCUT', 'TIMEOUT', 'GLOBAL_GUARD', 'NOTIFICATION']).default('GLOBAL_GUARD'),
  scopeScreens: z.array(z.string()).default([]),
  rules: z.array(z.string()).optional(),
  target: z.string().optional(),
  shortcuts: z.array(z.any()).optional(),
  description: z.string().optional(),
});

export const MUUiModelSchema = z.object({
  model_type: z.literal('UI').default('UI'),
  version: z.string().default('5.0'),
  domain: z.string(),
  application: z.any().optional(),
  screens: z.array(ScreenItemSchema).default([]),
  navigation_edges: z.array(NavigationEdgeSchema).default([]),
  cross_cutting_ui: z.array(CrossCuttingUISchema).default([]),
});

// ─── MM Mapping Model ─────────────────────────────────────────────────────────
export const ColumnMappingSchema = z.object({
  attributeRef: z.string(),
  column: z.string(),
  columnType: z.string(),
  nullable: z.boolean().optional(),
  unique: z.boolean().optional(),
  defaultValue: z.any().optional(),
  isPrimaryKey: z.boolean().optional(),
  isForeignKey: z.boolean().optional(),
  fkTargetTable: z.string().optional(),
  fkTargetColumn: z.string().optional(),
  valueObjectStrategy: z.enum(['FLATTEN_PREFIX', 'JSON_COLUMN']).optional(),
  isRedundant: z.boolean().optional(),
  isDerived: z.boolean().optional(),
  mappingNote: z.string().optional(),
});

export const TableMappingSchema = z.object({
  tableName: z.string(),
  tableRole: z
    .enum(['MASTER', 'DETAIL', 'EXT', 'ASSOC', 'LOG', 'SNAPSHOT', 'VIEW'])
    .default('MASTER'),
  primaryKey: z.string(),
  tableNote: z.string().optional(),
  foreignKeys: z
    .array(
      z.object({
        fkName: z.string(),
        localColumn: z.string(),
        targetTable: z.string(),
        targetColumn: z.string(),
        associationRef: z.string().optional(),
      }),
    )
    .default([]),
  columnMappings: z.array(ColumnMappingSchema).default([]),
});

export const ObjectTableMappingSchema = z.object({
  id: z.string(),
  objectRef: z.string(),
  objectRole: z
    .enum(['AGGREGATE_ROOT', 'ENTITY', 'VALUE_OBJECT', 'ASSOCIATION'])
    .default('AGGREGATE_ROOT'),
  objectName: z.string(),
  mappingNote: z.string().optional(),
  tableMappings: z.array(TableMappingSchema).default([]),
});

export const MMMappingModelSchema = z.object({
  model_type: z.literal('MAPPING').default('MAPPING'),
  version: z.string().default('1.0'),
  domain: z.string(),
  mappings: z.array(ObjectTableMappingSchema).default([]),
});

// ─── MI Interface Model ───────────────────────────────────────────────────────
export interface InterfaceFieldSpec {
  name: string;
  label: string;
  type: string;
  required: boolean;
  mappedRef?: string;
  allowedValues?: string[];
  fields?: InterfaceFieldSpec[];
  description?: string;
}

export interface InterfaceFieldSpecInput {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  mappedRef?: string;
  allowedValues?: string[];
  fields?: InterfaceFieldSpecInput[];
  description?: string;
}

export const InterfaceFieldSpecSchema: z.ZodType<
  InterfaceFieldSpec,
  z.ZodTypeDef,
  InterfaceFieldSpecInput
> = z.lazy(() =>
  z.object({
    name: z.string(),
    label: z.string(),
    type: z.string(),
    required: z.boolean().default(false),
    mappedRef: z.string().optional(),
    allowedValues: z.array(z.string()).optional(),
    fields: z.array(InterfaceFieldSpecSchema).optional(),
    description: z.string().optional(),
  }),
);

export const InterfaceReturnRuleSchema = z.object({
  code: z.string(),
  scenario: z.string(),
  httpStatus: z.number().optional(),
  message: z.string(),
  handlingStrategy: z.string().optional(),
});

export const InterfaceItemSchema = z.object({
  interfaceId: z.string(),
  name: z.string(),
  direction: z.enum(['PROVIDED', 'DEPENDENT']),
  providerSystem: z.string().optional(),
  consumerSystem: z.string().optional(),
  interfaceCategory: z.enum(['COMMAND', 'QUERY', 'EVENT', 'NOTIFICATION']).default('COMMAND'),
  businessPurpose: z.string().optional(),
  invokeScenario: z.string().optional(),
  protocol: z
    .enum(['REST', 'GRAPHQL', 'RPC', 'MQ', 'WEBHOOK', 'SOAP', 'gRPC', 'SFTP', 'FILE'])
    .default('REST'),
  format: z.enum(['JSON', 'XML', 'PROTOBUF', 'CSV', 'Binary', 'BINARY']).default('JSON'),
  authMethod: z.string().optional(),
  timeoutMs: z.number().optional(),
  idempotency: z.enum(['IDEMPOTENT', 'NON_IDEMPOTENT']).optional(),
  contractNote: z.string().optional(),
  description: z.string().optional(),
  relatedBehaviorRef: z.string().optional(),
  relatedEntityRef: z.string().optional(),
  relatedReportRef: z.string().optional(),
  relatedEventRef: z.string().optional(),
  relatedExternalEntityRef: z.string().optional(),
  inputFields: z.array(InterfaceFieldSpecSchema).default([]),
  outputFields: z.array(InterfaceFieldSpecSchema).default([]),
  returnRules: z.array(InterfaceReturnRuleSchema).default([]),
});

export const MIInterfaceModelSchema = z.object({
  model_type: z.literal('INTERFACE').default('INTERFACE'),
  version: z.string().default('1.0'),
  domain: z.string(),
  interfaces: z.array(InterfaceItemSchema).default([]),
});

// ─── Complete Ontology Suite AST ──────────────────────────────────────────────
export const OntologySuiteSchema = z.object({
  M1: M1ObjectModelSchema.optional(),
  M2: M2BehaviorModelSchema.optional(),
  M3: M3RuleModelSchema.optional(),
  ME: MEEventModelSchema.optional(),
  M4: M4ScenarioModelSchema.optional(),
  M5: M5ActorModelSchema.optional(),
  M6: M6FlowModelSchema.optional(),
  M7: M7ReportModelSchema.optional(),
  MU: MUUiModelSchema.optional(),
  MM: MMMappingModelSchema.optional(),
  MI: MIInterfaceModelSchema.optional(),
});

export type M1ObjectModel = z.infer<typeof M1ObjectModelSchema>;
export type AggregateRoot = z.infer<typeof AggregateRootSchema>;
export type SubEntity = z.infer<typeof SubEntitySchema>;
export type ValueObject = z.infer<typeof ValueObjectSchema>;
export type Attribute = z.infer<typeof AttributeSchema>;
export type DataDictionary = z.infer<typeof DataDictionarySchema>;
export type AggregateAssociation = z.infer<typeof AggregateAssociationSchema>;

export type M2BehaviorModel = z.infer<typeof M2BehaviorModelSchema>;
export type BehaviorItem = z.infer<typeof BehaviorItemSchema>;
export type SyncTrigger = z.infer<typeof SyncTriggerSchema>;

export type M3RuleModel = z.infer<typeof M3RuleModelSchema>;
export type RuleItem = z.infer<typeof RuleItemSchema>;

export type MEEventModel = z.infer<typeof MEEventModelSchema>;
export type EventItem = z.infer<typeof EventItemSchema>;

export type M4ScenarioModel = z.infer<typeof M4ScenarioModelSchema>;
export type ScenarioItem = z.infer<typeof ScenarioItemSchema>;

export type M5ActorModel = z.infer<typeof M5ActorModelSchema>;
export type ActorItem = z.infer<typeof ActorItemSchema>;
export type RoleItem = z.infer<typeof RoleItemSchema>;
export type PermissionGroupItem = z.infer<typeof PermissionGroupSchema>;
export type PermissionItem = z.infer<typeof PermissionItemSchema>;

export type M6FlowModel = z.infer<typeof M6FlowModelSchema>;
export type FlowItem = z.infer<typeof FlowItemSchema>;
export type FlowActivity = z.infer<typeof FlowActivitySchema>;

export type M7ReportModel = z.infer<typeof M7ReportModelSchema>;
export type QueryReportItem = z.infer<typeof QueryReportItemSchema>;

export type MUUiModel = z.infer<typeof MUUiModelSchema>;
export type ScreenItem = z.infer<typeof ScreenItemSchema>;
export type UIElement = z.infer<typeof UIElementSchema>;
export type UIEvent = z.infer<typeof UIEventSchema>;

export type MMMappingModel = z.infer<typeof MMMappingModelSchema>;
export type ObjectTableMapping = z.infer<typeof ObjectTableMappingSchema>;

export type MIInterfaceModel = z.infer<typeof MIInterfaceModelSchema>;
export type InterfaceItem = z.infer<typeof InterfaceItemSchema>;

export type OntologySuite = z.infer<typeof OntologySuiteSchema>;

export interface ValidationDiagnostic {
  id: string;
  tier: 'ERROR' | 'STAGE_WARNING';
  code: string;
  model: ModelCode;
  elementId?: string;
  path?: string;
  messageZh: string;
  messageEn: string;
}

export interface ValidationReport {
  valid: boolean;
  errorCount: number;
  warningCount: number;
  diagnostics: ValidationDiagnostic[];
  presentModels: ModelCode[];
  missingModels: ModelCode[];
}

export interface ImpactReference {
  model: ModelCode;
  elementId: string;
  elementName: string;
  fieldPath: string;
  descriptionZh: string;
  descriptionEn: string;
}

export interface ImpactAnalysisReport {
  targetId: string;
  targetModel: ModelCode;
  targetName: string;
  canDeleteSafely: boolean;
  references: ImpactReference[];
}

export interface KnowledgeGraphNode {
  id: string;
  label: string;
  subLabel?: string;
  model: ModelCode;
  category: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeGraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  labelZh: string;
  labelEn: string;
}

export interface KnowledgeGraphData {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
}
