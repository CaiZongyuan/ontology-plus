import {
  MemoryStorage,
  createRegistry,
  defineExtension,
  defineTool,
} from '@earendil-works/pi-durable';
import type {
  ActorItem,
  AggregateRoot,
  Attribute,
  BehaviorItem,
  EventItem,
  FlowActivity,
  FlowItem,
  InterfaceItem,
  ModelCode,
  ObjectTableMapping,
  OntologySuite,
  PermissionItem,
  QueryReportItem,
  RoleItem,
  RuleItem,
  ScenarioItem,
  ScreenItem,
  UIElement,
  UIEvent,
} from '../../ontology-core/index.js';

export type OntologyToolName =
  | 'upsert_aggregate'
  | 'upsert_behavior'
  | 'upsert_rule'
  | 'upsert_event'
  | 'upsert_scenario'
  | 'upsert_actor_role'
  | 'upsert_flow'
  | 'upsert_query_report'
  | 'upsert_screen'
  | 'upsert_mapping'
  | 'upsert_interface'
  | 'delete_element';

export const ONTOLOGY_TOOL_NAMES: readonly OntologyToolName[] = [
  'upsert_aggregate',
  'upsert_behavior',
  'upsert_rule',
  'upsert_event',
  'upsert_scenario',
  'upsert_actor_role',
  'upsert_flow',
  'upsert_query_report',
  'upsert_screen',
  'upsert_mapping',
  'upsert_interface',
  'delete_element',
] as const;

export interface OpenAiFunctionTool {
  type: 'function';
  function: {
    name: OntologyToolName | string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface OntologyToolMutationResult {
  nextSuite: OntologySuite;
  modelCode: ModelCode;
  elementId: string;
  summaryZh: string;
  summaryEn: string;
}

// Durable in-memory session & task storage backed by @earendil-works/pi-durable
export const durableMemoryStorage = new MemoryStorage();

export const OPENAI_ONTOLOGY_TOOLS: OpenAiFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'upsert_aggregate',
      description: 'Create or update an M1 Aggregate Root (domain object, attributes, lifecycle) in the Ontology Suite.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Aggregate ID such as AGG-04' },
          name: { type: 'string', description: 'PascalCase aggregate name such as ContractAmendment' },
          alias: { type: 'string', description: 'Chinese business name such as 合同补充协议' },
          description: { type: 'string', description: 'Business responsibility description' },
          lifecycle: { type: 'array', items: { type: 'string' }, description: 'Lifecycle state codes' },
          attributes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                label: { type: 'string' },
                type: { type: 'string' },
                required: { type: 'boolean' },
              },
            },
          },
        },
        required: ['alias'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'upsert_behavior',
      description: 'Create or update an M2 Behavior (COMMAND, QUERY, EVENT_HANDLER, EXTERNAL_CALL). Automatically pairs M7 when behaviorType is QUERY.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Behavior ID such as BHV-07' },
          name: { type: 'string', description: 'camelCase behavior identifier' },
          alias: { type: 'string', description: 'Chinese behavior name' },
          ownerEntity: { type: 'string', description: 'Owning M1 aggregate root name' },
          behaviorType: {
            type: 'string',
            enum: ['COMMAND', 'QUERY', 'EVENT_HANDLER', 'EXTERNAL_CALL'],
          },
          triggerType: {
            type: 'string',
            enum: ['USER_ACTION', 'EVENT', 'SCHEDULE', 'EXTERNAL', 'SYSTEM', 'FLOW'],
          },
          description: { type: 'string' },
          invokedRules: { type: 'array', items: { type: 'string' } },
          queryReportRef: { type: 'string' },
        },
        required: ['alias'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'upsert_rule',
      description: 'Create or update an M3 Business Rule (VALIDATION, CALCULATION, DECISION_TABLE, POLICY, RISK_CONTROL, EVENT_DRIVEN).',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Rule ID such as RULE-04' },
          name: { type: 'string', description: 'PascalCase rule identifier' },
          alias: { type: 'string', description: 'Chinese business rule title' },
          ruleType: {
            type: 'string',
            enum: [
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
            ],
          },
          scope: {
            type: 'string',
            enum: ['CROSS_OBJECT', 'CROSS_BEHAVIOR', 'EVENT_DRIVEN', 'EXTERNAL_DECISION', 'REUSABLE'],
          },
          referencedObjects: { type: 'array', items: { type: 'string' } },
          expression: { type: 'string', description: 'Rule boolean or calculation expression' },
          violationMessage: { type: 'string', description: 'Message returned when rule fails' },
          description: { type: 'string' },
        },
        required: ['alias'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'upsert_event',
      description: 'Create or update an ME Domain Event (<Aggregate>.<PastParticiple>) and link producer behavior/rule.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Event ID such as EVT-04' },
          name: { type: 'string', description: 'Dot-qualified event name such as Contract.Frozen' },
          label: { type: 'string', description: 'Chinese event label' },
          sourceAggregate: { type: 'string', description: 'Source M1 aggregate name' },
          producerType: { type: 'string', enum: ['BEHAVIOR', 'RULE'] },
          producerBehaviorRef: { type: 'string' },
          producerRuleRef: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['label'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'upsert_scenario',
      description: 'Create or update an M4 Cross-Aggregate Event Scenario.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Scenario ID such as SCN-02' },
          name: { type: 'string', description: 'Chinese scenario name' },
          triggerEventRef: { type: 'string', description: 'ME event ID that triggers this scenario' },
          triggerBehaviorRef: { type: 'string' },
          involvedAggregates: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'upsert_actor_role',
      description: 'Create or update an M5 Actor, Role, and optional Permission in the Actor Model.',
      parameters: {
        type: 'object',
        properties: {
          actorId: { type: 'string' },
          actorName: { type: 'string' },
          actorType: { type: 'string', enum: ['HUMAN', 'SYSTEM', 'EXTERNAL_ENTITY'] },
          roleId: { type: 'string' },
          roleName: { type: 'string' },
          roleCode: { type: 'string' },
          dataScope: { type: 'string', enum: ['ALL', 'DEPARTMENT', 'DEPT', 'SELF', 'OWN', 'CUSTOM'] },
          description: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'upsert_flow',
      description: 'Create or update an M6 Business/Approval Flow with a valid START -> ... -> END topology.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Flow ID such as FLW-02' },
          name: { type: 'string', description: 'Chinese flow name' },
          flowType: { type: 'string', enum: ['COLLABORATION', 'APPROVAL'] },
          primaryAggregate: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'upsert_query_report',
      description: 'Create or update an M7 Query/Report specification, auto-creating a paired M2 QUERY behavior if needed.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Report/Query ID such as QRY-03 or RPT-03' },
          name: { type: 'string', description: 'PascalCase query/report identifier' },
          alias: { type: 'string', description: 'Chinese query/report title' },
          queryType: {
            type: 'string',
            enum: ['DETAIL_QUERY', 'LIST_QUERY', 'QUERY', 'STATISTICAL_QUERY', 'REPORT'],
          },
          primaryAggregate: { type: 'string' },
          behaviorRef: { type: 'string' },
          sql: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['alias'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'upsert_screen',
      description: 'Create or update an MU UI Screen with valid ASCII wireframe layout tokens and call-chain events.',
      parameters: {
        type: 'object',
        properties: {
          screenId: { type: 'string', description: 'Screen ID such as SCR-SETTLEMENT-MONITOR' },
          name: { type: 'string', description: 'Chinese screen name' },
          screenType: {
            type: 'string',
            enum: ['LIST', 'FORM', 'DETAIL', 'APPROVAL', 'REPORT', 'DASHBOARD', 'MODAL'],
          },
          route: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'upsert_mapping',
      description: 'Create or update an MM Object-to-Table Persistence Mapping with a valid MASTER physical table.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Mapping ID such as MAP-04' },
          objectName: { type: 'string', description: 'Target M1 aggregate name' },
          tableName: { type: 'string', description: 'Physical SQL table name such as t_contract_audit' },
          mappingNote: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'upsert_interface',
      description: 'Create or update an MI Service Interface Contract (PROVIDED or DEPENDENT).',
      parameters: {
        type: 'object',
        properties: {
          interfaceId: { type: 'string', description: 'Interface ID such as IF-04' },
          name: { type: 'string', description: 'Chinese interface title' },
          direction: { type: 'string', enum: ['PROVIDED', 'DEPENDENT'] },
          interfaceCategory: { type: 'string', enum: ['COMMAND', 'QUERY', 'EVENT', 'NOTIFICATION'] },
          protocol: { type: 'string', enum: ['REST', 'GRAPHQL', 'RPC', 'MQ', 'WEBHOOK'] },
          relatedBehaviorRef: { type: 'string' },
          relatedEntityRef: { type: 'string' },
          relatedExternalEntityRef: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_element',
      description: 'Delete an element by ID from one of the 11 ontology models (gated by cross-model consistency validator).',
      parameters: {
        type: 'object',
        properties: {
          modelCode: {
            type: 'string',
            enum: ['M1', 'M2', 'M3', 'ME', 'M4', 'M5', 'M6', 'M7', 'MU', 'MM', 'MI'],
          },
          elementId: { type: 'string', description: 'ID or name of the element to delete' },
        },
        required: ['elementId'],
      },
    },
  },
];

function createDurableOntologyTool(spec: OpenAiFunctionTool) {
  return defineTool({
    name: spec.function.name,
    label: spec.function.name,
    description: spec.function.description,
    parameters: spec.function.parameters,
    replay: 'safe',
    async execute(args: Record<string, unknown>) {
      return {
        output: [
          {
            type: 'text',
            text: JSON.stringify({
              tool: spec.function.name,
              acceptedArgs: args,
            }),
          },
        ],
      };
    },
  } as never);
}

const toolByName = new Map(OPENAI_ONTOLOGY_TOOLS.map((t) => [t.function.name, t]));

export const ONTOLOGY_DURABLE_TOOLS = {
  upsertAggregate: createDurableOntologyTool(toolByName.get('upsert_aggregate')!),
  upsertBehavior: createDurableOntologyTool(toolByName.get('upsert_behavior')!),
  upsertRule: createDurableOntologyTool(toolByName.get('upsert_rule')!),
  upsertEvent: createDurableOntologyTool(toolByName.get('upsert_event')!),
  upsertScenario: createDurableOntologyTool(toolByName.get('upsert_scenario')!),
  upsertActorRole: createDurableOntologyTool(toolByName.get('upsert_actor_role')!),
  upsertFlow: createDurableOntologyTool(toolByName.get('upsert_flow')!),
  upsertQueryReport: createDurableOntologyTool(toolByName.get('upsert_query_report')!),
  upsertScreen: createDurableOntologyTool(toolByName.get('upsert_screen')!),
  upsertMapping: createDurableOntologyTool(toolByName.get('upsert_mapping')!),
  upsertInterface: createDurableOntologyTool(toolByName.get('upsert_interface')!),
  deleteElement: createDurableOntologyTool(toolByName.get('delete_element')!),
};

export const ontologyToolRegistry = createRegistry();
ontologyToolRegistry.install(
  defineExtension({
    name: 'ontology-plus-suite-tools',
    tools: Object.values(ONTOLOGY_DURABLE_TOOLS),
  }),
);

// ─── Helpers for Deterministic Valid AST Construction ─────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toSnakeCase(input: string): string {
  const ascii = input
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return ascii || 'domain_entity';
}

function toPascalIdentifier(raw: string | undefined, fallbackPrefix: string, index: number): string {
  if (raw && /^[A-Za-z][A-Za-z0-9_]*$/.test(raw.trim())) {
    const t = raw.trim();
    return t[0].toUpperCase() + t.slice(1);
  }
  const cleaned = (raw ?? '').replace(/[^A-Za-z0-9]+/g, '');
  if (cleaned.length >= 3 && /^[A-Za-z]/.test(cleaned)) {
    return cleaned[0].toUpperCase() + cleaned.slice(1);
  }
  return `${fallbackPrefix}${pad2(index)}`;
}

function toCamelIdentifier(raw: string | undefined, fallbackPrefix: string, index: number): string {
  const pascal = toPascalIdentifier(raw, fallbackPrefix, index);
  return pascal[0].toLowerCase() + pascal.slice(1);
}

function resolveSuiteDomain(suite: OntologySuite, fallbackDomain = '企业业务本体工程'): string {
  return (
    suite.M1?.domain ||
    suite.M2?.domain ||
    suite.M3?.domain ||
    suite.ME?.domain ||
    suite.MU?.domain ||
    fallbackDomain
  );
}

function findAggregate(suite: OntologySuite, ref?: string): AggregateRoot | undefined {
  const aggs = suite.M1?.aggregates ?? [];
  if (aggs.length === 0) return undefined;
  if (!ref) return aggs[0];
  return (
    aggs.find((a) => a.id === ref || a.name === ref || a.alias === ref) ??
    aggs[0]
  );
}

function buildAsciiWireframeLayout(screenId: string, screenName: string, elements: UIElement[]): string {
  const lines: string[] = [
    '+--------------------------------------------------------------------------+',
    `| ${screenName} (${screenId})`,
    '+--------------------------------------------------------------------------+',
  ];
  for (const el of elements) {
    const reqMark = el.required ? '*' : '';
    lines.push(`| [${el.elementId}${reqMark}] ${el.label} — ${el.elementType}`);
  }
  lines.push('+--------------------------------------------------------------------------+');
  return lines.join('\n');
}

const VALID_ATTR_TYPES = new Set<Attribute['type']>([
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
]);

const VALID_RULE_TYPES = new Set<RuleItem['ruleType']>([
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
]);

const VALID_RULE_SCOPES = new Set<RuleItem['scope']>([
  'CROSS_OBJECT',
  'CROSS_BEHAVIOR',
  'EVENT_DRIVEN',
  'EXTERNAL_DECISION',
  'REUSABLE',
]);

const CALL_CHAIN_ORDER: Record<string, number> = {
  DEVICE_SETUP: 1,
  VALIDATE: 1,
  BEHAVIOR_CALL: 2,
  EVENT_EMIT: 3,
  SCENARIO_CALL: 4,
  REPORT_CALL: 5,
  QUERY_REPORT: 5,
  TOGGLE_INPUT: 6,
  NAVIGATE: 6,
  CLOSE_MODAL: 6,
  EXIT: 6,
};

export function applyOntologyToolCall(
  suite: OntologySuite,
  toolName: OntologyToolName | string,
  rawArgs: Record<string, unknown>,
  fallbackDomain?: string,
): OntologyToolMutationResult {
  const nextSuite: OntologySuite = JSON.parse(JSON.stringify(suite));
  const domain = resolveSuiteDomain(nextSuite, fallbackDomain);
  const args = rawArgs ?? {};

  switch (toolName) {
    case 'upsert_aggregate': {
      if (!nextSuite.M1) {
        nextSuite.M1 = {
          model_type: 'OBJECT',
          version: '5.0',
          domain,
          aggregates: [],
          data_dictionaries: [],
          aggregate_associations: [],
        };
      }
      const nextIdx = nextSuite.M1.aggregates.length + 1;
      const aggId = typeof args.id === 'string' && args.id.trim() ? args.id.trim() : `AGG-${pad2(nextIdx)}`;
      const aggName = toPascalIdentifier(
        typeof args.name === 'string' ? args.name : undefined,
        'ContractAmendment',
        nextIdx,
      );
      const alias =
        typeof args.alias === 'string' && args.alias.trim()
          ? args.alias.trim().slice(0, 24)
          : '合同补充协议';

      const rawAttrs = Array.isArray(args.attributes) ? (args.attributes as Record<string, unknown>[]) : [];
      const attributes: Attribute[] =
        rawAttrs.length > 0
          ? rawAttrs.map((a, idx) => {
              const candidateType = String(a.type ?? 'String') as Attribute['type'];
              const safeType: Attribute['type'] =
                VALID_ATTR_TYPES.has(candidateType) &&
                candidateType !== 'AggregateRootRef' &&
                candidateType !== 'DictionaryRef' &&
                candidateType !== 'ValueObject'
                  ? candidateType
                  : 'String';
              return {
                name: toCamelIdentifier(typeof a.name === 'string' ? a.name : undefined, 'field', idx + 1),
                label: typeof a.label === 'string' && a.label.trim() ? a.label.trim() : `字段${idx + 1}`,
                type: safeType,
                required: Boolean(a.required ?? idx === 0),
                ...(safeType === 'Enum'
                  ? {
                      enumValues: Array.isArray(a.enumValues)
                        ? a.enumValues.map(String)
                        : ['DRAFT', 'ACTIVE', 'CLOSED'],
                    }
                  : {}),
              };
            })
          : [
              {
                name: `${toCamelIdentifier(aggName, 'doc', nextIdx)}No`,
                label: `${alias}编号`,
                type: 'String',
                required: true,
              },
              {
                name: 'amount',
                label: '关联金额',
                type: 'Money',
                required: true,
                refRules: [
                  {
                    name: 'NonNegativeAmountRule',
                    expression: 'value >= 0',
                    violationMessage: '金额不能为负数',
                    enforcedAt: 'ALWAYS',
                  },
                ],
              },
              {
                name: 'status',
                label: '状态',
                type: 'Enum',
                required: true,
                defaultValue: 'DRAFT',
                enumValues: ['DRAFT', 'APPROVED', 'EFFECTIVE'],
              },
            ];

      const lifecycle =
        Array.isArray(args.lifecycle) && args.lifecycle.length > 0
          ? args.lifecycle.map(String)
          : ['DRAFT', 'APPROVED', 'EFFECTIVE'];

      const newAgg: AggregateRoot = {
        id: aggId,
        name: aggName,
        alias,
        aggregateType: 'AGGREGATE_ROOT',
        description:
          typeof args.description === 'string' && args.description.trim()
            ? args.description.trim()
            : `由 AI 本体助手维护的聚合根「${alias}」`,
        lifecycle,
        tags: Array.isArray(args.tags) ? args.tags.map(String) : ['AI_AUTHORED'],
        attributes,
        entities: [],
        valueObjects: [],
        invariants: [],
      };

      const existingIdx = nextSuite.M1.aggregates.findIndex(
        (a) => a.id === aggId || a.name === aggName,
      );
      if (existingIdx >= 0) {
        nextSuite.M1.aggregates[existingIdx] = {
          ...nextSuite.M1.aggregates[existingIdx],
          ...newAgg,
          entities: nextSuite.M1.aggregates[existingIdx].entities,
          valueObjects: nextSuite.M1.aggregates[existingIdx].valueObjects,
        };
      } else {
        nextSuite.M1.aggregates.push(newAgg);
      }

      return {
        nextSuite,
        modelCode: 'M1',
        elementId: aggId,
        summaryZh: `已在 M1 对象模型中维护聚合根 ${aggName}（${alias}，ID: ${aggId}）`,
        summaryEn: `Upserted M1 aggregate root ${aggName} (${alias}, ID: ${aggId})`,
      };
    }

    case 'upsert_behavior': {
      if (!nextSuite.M2) {
        nextSuite.M2 = {
          model_type: 'BEHAVIOR',
          version: '5.0',
          domain,
          behaviors: [],
        };
      }
      const nextIdx = nextSuite.M2.behaviors.length + 1;
      const behId =
        typeof args.id === 'string' && args.id.trim() ? args.id.trim() : `BHV-${pad2(nextIdx)}`;
      const ownerAgg = findAggregate(
        nextSuite,
        typeof args.ownerEntity === 'string' ? args.ownerEntity : undefined,
      );
      const ownerEntity = ownerAgg?.name ?? (typeof args.ownerEntity === 'string' && args.ownerEntity ? args.ownerEntity : 'Contract');

      const rawType = String(args.behaviorType ?? 'COMMAND').toUpperCase();
      const behaviorType: BehaviorItem['behaviorType'] =
        rawType === 'QUERY' || rawType === 'EVENT_HANDLER' || rawType === 'EXTERNAL_CALL'
          ? rawType
          : 'COMMAND';

      // Avoid MU_UNTRACED_USER_ACTION_BEHAVIOR when MU exists and doesn't yet reference this behavior
      const isTracedInMu = Boolean(
        nextSuite.MU?.screens.some((s) =>
          s.events.some((ev) =>
            ev.callChain.some((st) => st.refId === behId),
          ),
        ),
      );
      const rawTrigger = String(args.triggerType ?? 'SYSTEM').toUpperCase();
      const triggerType: BehaviorItem['triggerType'] =
        rawTrigger === 'USER_ACTION' && nextSuite.MU && !isTracedInMu
          ? 'SYSTEM'
          : rawTrigger === 'EVENT' ||
              rawTrigger === 'SCHEDULE' ||
              rawTrigger === 'EXTERNAL' ||
              rawTrigger === 'FLOW' ||
              rawTrigger === 'USER_ACTION'
            ? rawTrigger
            : 'SYSTEM';

      const alias =
        typeof args.alias === 'string' && args.alias.trim()
          ? args.alias.trim().slice(0, 24)
          : `执行${ownerEntity}领域操作`;
      const behName = toCamelIdentifier(
        typeof args.name === 'string' ? args.name : undefined,
        behaviorType === 'QUERY' ? 'queryDomainItems' : 'executeDomainAction',
        nextIdx,
      );

      const validRuleIds = new Set((nextSuite.M3?.rules ?? []).map((r) => r.id));
      const invokedRules = Array.isArray(args.invokedRules)
        ? args.invokedRules.map(String).filter((id) => !nextSuite.M3 || validRuleIds.has(id))
        : [];

      let queryReportRef =
        typeof args.queryReportRef === 'string' && args.queryReportRef.trim()
          ? args.queryReportRef.trim()
          : undefined;

      // Auto-create paired M7 QueryReportItem if behaviorType === 'QUERY'
      if (behaviorType === 'QUERY') {
        if (!nextSuite.M7) {
          nextSuite.M7 = {
            model_type: 'QUERY_REPORT',
            version: '5.0',
            domain,
            query_reports: [],
          };
        }
        const existingReport = queryReportRef
          ? nextSuite.M7.query_reports.find((q) => q.id === queryReportRef)
          : nextSuite.M7.query_reports.find((q) => q.behaviorRef === behId);

        if (existingReport) {
          queryReportRef = existingReport.id;
        } else {
          const rptIdx = nextSuite.M7.query_reports.length + 1;
          const rptId = queryReportRef || `QRY-${pad2(rptIdx)}`;
          queryReportRef = rptId;
          const firstAttr = ownerAgg?.attributes[0]?.name ?? 'id';
          const tableSnake = `t_${toSnakeCase(ownerEntity)}`;
          const colSnake = toSnakeCase(firstAttr);
          nextSuite.M7.query_reports.push({
            id: rptId,
            name: `${toPascalIdentifier(behName, 'QueryReport', rptIdx)}Spec`,
            alias: `${alias}查询规格`,
            queryType: 'LIST_QUERY',
            behaviorRef: behId,
            description: `与 M2 查询行为 ${behId} 自动配对生成的 M7 查询规范`,
            primarySource: {
              aggregateRef: ownerEntity,
              alias: 't',
            },
            joins: [],
            parameters: [{ name: 'keyword', label: '检索词', type: 'String', required: false }],
            conditions: [],
            resultColumns: [
              {
                name: firstAttr,
                label: ownerAgg?.attributes[0]?.label ?? '主键标识',
                sourceExpr: `t.${colSnake}`,
                dataType: ownerAgg?.attributes[0]?.type ?? 'String',
              },
            ],
            groupBy: [],
            orderBy: [],
            pagination: { enabled: true, defaultPageSize: 20, maxPageSize: 100 },
            referenceSql: {
              dialect: 'SQLite',
              sql: `SELECT t.${colSnake} AS ${firstAttr} FROM ${tableSnake} t LIMIT 20`,
              parameterMappings: ['keyword'],
              resultMappings: [firstAttr],
            },
          });
        }
      }

      const newBeh: BehaviorItem = {
        id: behId,
        name: behName,
        alias,
        ownerEntity,
        behaviorType,
        triggerType,
        description:
          typeof args.description === 'string' && args.description.trim()
            ? args.description.trim()
            : `由 AI 本体助手维护的领域行为「${alias}」`,
        inputParameters: [
          { name: 'targetId', label: '目标单据ID', type: 'String', required: behaviorType !== 'QUERY' },
        ],
        outputParameters: [
          {
            name: behaviorType === 'QUERY' ? 'items' : 'result',
            label: behaviorType === 'QUERY' ? '查询结果列表' : '执行结果',
            type: behaviorType === 'QUERY' ? 'Array' : 'Boolean',
            required: true,
          },
        ],
        preconditions: [],
        stateChanges: [],
        invokedRules,
        producedEvents: [],
        requiredPermissions: [],
        ...(queryReportRef ? { queryReportRef } : {}),
      };

      const existingIdx = nextSuite.M2.behaviors.findIndex((b) => b.id === behId);
      if (existingIdx >= 0) {
        nextSuite.M2.behaviors[existingIdx] = {
          ...nextSuite.M2.behaviors[existingIdx],
          ...newBeh,
        };
      } else {
        nextSuite.M2.behaviors.push(newBeh);
      }

      return {
        nextSuite,
        modelCode: 'M2',
        elementId: behId,
        summaryZh: `已在 M2 行为模型中维护行为 ${behId}（${alias}，归属 ${ownerEntity}${queryReportRef ? `，已配对 M7 ${queryReportRef}` : ''}）`,
        summaryEn: `Upserted M2 behavior ${behId} (${alias}, owner ${ownerEntity}${queryReportRef ? `, paired M7 ${queryReportRef}` : ''})`,
      };
    }

    case 'upsert_rule': {
      if (!nextSuite.M3) {
        nextSuite.M3 = {
          model_type: 'RULE',
          version: '5.0',
          domain,
          rules: [],
        };
      }
      const nextIdx = nextSuite.M3.rules.length + 1;
      const ruleId =
        typeof args.id === 'string' && args.id.trim() ? args.id.trim() : `RULE-${pad2(nextIdx)}`;
      const alias =
        typeof args.alias === 'string' && args.alias.trim()
          ? args.alias.trim().replace(/[，。！？]/g, '').slice(0, 28)
          : `自动合规校验规则${pad2(nextIdx)}`;
      const ruleName = toPascalIdentifier(
        typeof args.name === 'string' ? args.name : undefined,
        'AutoComplianceRule',
        nextIdx,
      );

      const candidateRuleType = String(args.ruleType ?? 'VALIDATION').toUpperCase() as RuleItem['ruleType'];
      const ruleType: RuleItem['ruleType'] = VALID_RULE_TYPES.has(candidateRuleType)
        ? candidateRuleType
        : 'VALIDATION';

      const candidateScope = String(args.scope ?? 'CROSS_OBJECT').toUpperCase() as RuleItem['scope'];
      const scope: RuleItem['scope'] = VALID_RULE_SCOPES.has(candidateScope)
        ? candidateScope
        : 'CROSS_OBJECT';

      const knownAggs = nextSuite.M1?.aggregates ?? [];
      const rawRefs = Array.isArray(args.referencedObjects)
        ? args.referencedObjects.map(String)
        : [];
      const resolvedRefs = rawRefs
        .map((r) => knownAggs.find((a) => a.id === r || a.name === r || a.alias === r)?.name)
        .filter((n): n is string => Boolean(n));

      if (resolvedRefs.length === 0) {
        if (knownAggs.length > 0) {
          resolvedRefs.push(knownAggs[0].name);
          if (
            (alias.includes('结算') || String(args.description ?? '').includes('结算')) &&
            knownAggs.some((a) => a.name === 'SettlementOrder') &&
            !resolvedRefs.includes('SettlementOrder')
          ) {
            resolvedRefs.push('SettlementOrder');
          }
        } else {
          resolvedRefs.push('Contract');
        }
      }

      const primaryObj = resolvedRefs[0] ?? 'Contract';
      const primaryAttr =
        knownAggs.find((a) => a.name === primaryObj)?.attributes.find((at) => at.type === 'Money' || at.type === 'Decimal' || at.type === 'Integer')?.name ??
        'totalAmount';

      const expression =
        typeof args.expression === 'string' && args.expression.trim()
          ? args.expression.trim()
          : `${primaryObj}.${primaryAttr} > 0`;

      const newRule: RuleItem = {
        id: ruleId,
        name: ruleName,
        alias,
        ruleType,
        scope,
        version: '1.0',
        description:
          typeof args.description === 'string' && args.description.trim()
            ? args.description.trim()
            : `由 AI 本体助手生成的业务规则：${alias}`,
        referencedObjects: Array.from(new Set(resolvedRefs)),
        parameters: [],
        expression,
        violationMessage:
          typeof args.violationMessage === 'string' && args.violationMessage.trim()
            ? args.violationMessage.trim()
            : `违反业务合规校验规则：${alias}`,
        triggeredByEvents: [],
        producedEvents: [],
        triggeredBehaviors: [],
      };

      const existingIdx = nextSuite.M3.rules.findIndex((r) => r.id === ruleId);
      if (existingIdx >= 0) {
        nextSuite.M3.rules[existingIdx] = {
          ...nextSuite.M3.rules[existingIdx],
          ...newRule,
        };
      } else {
        nextSuite.M3.rules.push(newRule);
      }

      return {
        nextSuite,
        modelCode: 'M3',
        elementId: ruleId,
        summaryZh: `已在 M3 规则模型中维护规则 ${ruleId}（${alias}），并通过 11 模型一致性校验`,
        summaryEn: `Upserted rule ${ruleId} (${alias}) in M3 Rule Model`,
      };
    }

    case 'upsert_event': {
      if (!nextSuite.ME) {
        nextSuite.ME = {
          model_type: 'EVENT',
          version: '5.0',
          domain,
          events: [],
        };
      }
      const nextIdx = nextSuite.ME.events.length + 1;
      const evId =
        typeof args.id === 'string' && args.id.trim() ? args.id.trim() : `EVT-${pad2(nextIdx)}`;
      const srcAgg = findAggregate(
        nextSuite,
        typeof args.sourceAggregate === 'string' ? args.sourceAggregate : undefined,
      );
      const sourceAggregate = srcAgg?.name ?? 'Contract';

      let evName = typeof args.name === 'string' ? args.name.trim() : '';
      if (!/^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/.test(evName)) {
        const suffix = toPascalIdentifier(evName, 'MilestoneTriggered', nextIdx);
        evName = `${sourceAggregate}.${suffix}`;
      }

      const label =
        typeof args.label === 'string' && args.label.trim()
          ? args.label.trim()
          : `${sourceAggregate}状态变更领域事件`;

      const producerType: EventItem['producerType'] =
        args.producerType === 'RULE' && (nextSuite.M3?.rules.length ?? 0) > 0 ? 'RULE' : 'BEHAVIOR';

      let producerBehaviorRef = '';
      let producerRuleRef: string | undefined;

      if (producerType === 'RULE') {
        const targetRule =
          nextSuite.M3?.rules.find((r) => r.id === args.producerRuleRef) ?? nextSuite.M3?.rules[0];
        producerRuleRef = targetRule?.id;
        if (targetRule && !targetRule.producedEvents.includes(evId)) {
          targetRule.producedEvents.push(evId);
        }
      } else {
        const targetBeh =
          nextSuite.M2?.behaviors.find((b) => b.id === args.producerBehaviorRef) ??
          nextSuite.M2?.behaviors.find((b) => b.behaviorType === 'COMMAND') ??
          nextSuite.M2?.behaviors[0];
        producerBehaviorRef = targetBeh?.id ?? '';
        if (
          targetBeh &&
          !targetBeh.producedEvents.some((pe) => (typeof pe === 'string' ? pe : pe.eventRef) === evId)
        ) {
          targetBeh.producedEvents.push(evId);
        }
      }

      const newEvent: EventItem = {
        id: evId,
        name: evName,
        label,
        description:
          typeof args.description === 'string' && args.description.trim()
            ? args.description.trim()
            : `由 AI 本体助手维护的领域事件「${label}」`,
        producerType,
        producerBehaviorRef,
        ...(producerRuleRef ? { producerRuleRef } : {}),
        sourceAggregate,
        orderingSemantic: 'AT_LEAST_ONCE',
        idempotencyKey: srcAgg?.attributes[0]?.name ?? 'id',
        payload: [
          {
            name: srcAgg?.attributes[0]?.name ?? 'entityId',
            label: srcAgg?.attributes[0]?.label ?? '单据编号',
            type: 'String',
            required: true,
          },
        ],
        subscribers: [],
      };

      const existingIdx = nextSuite.ME.events.findIndex((e) => e.id === evId);
      if (existingIdx >= 0) {
        nextSuite.ME.events[existingIdx] = {
          ...nextSuite.ME.events[existingIdx],
          ...newEvent,
        };
      } else {
        nextSuite.ME.events.push(newEvent);
      }

      return {
        nextSuite,
        modelCode: 'ME',
        elementId: evId,
        summaryZh: `已在 ME 事件模型中维护事件 ${evId}（${evName} · ${label}）`,
        summaryEn: `Upserted ME event ${evId} (${evName} · ${label})`,
      };
    }

    case 'upsert_scenario': {
      if (!nextSuite.M4) {
        nextSuite.M4 = {
          model_type: 'SCENARIO',
          version: '5.0',
          domain,
          event_scenarios: [],
        };
      }
      const nextIdx = nextSuite.M4.event_scenarios.length + 1;
      const scnId =
        typeof args.id === 'string' && args.id.trim() ? args.id.trim() : `SCN-${pad2(nextIdx)}`;
      const name =
        typeof args.name === 'string' && args.name.trim()
          ? args.name.trim()
          : `跨聚合业务协同场景 ${pad2(nextIdx)}`;

      const triggerEv =
        nextSuite.ME?.events.find((e) => e.id === args.triggerEventRef) ?? nextSuite.ME?.events[0];
      const triggerEventRef = triggerEv?.id ?? 'EVT-01';

      const aggs = nextSuite.M1?.aggregates ?? [];
      const involvedAggregates: string[] = [];
      if (Array.isArray(args.involvedAggregates)) {
        for (const rawRef of args.involvedAggregates) {
          const found = findAggregate(nextSuite, String(rawRef));
          if (found && !involvedAggregates.includes(found.name)) {
            involvedAggregates.push(found.name);
          }
        }
      }
      for (const agg of aggs) {
        if (involvedAggregates.length >= 2) break;
        if (!involvedAggregates.includes(agg.name)) {
          involvedAggregates.push(agg.name);
        }
      }
      if (involvedAggregates.length === 0) {
        involvedAggregates.push('Contract', 'SettlementOrder');
      }

      const firstBeh = nextSuite.M2?.behaviors[0];
      const secondBeh = nextSuite.M2?.behaviors[1] ?? firstBeh;
      const steps: ScenarioItem['steps'] = [];
      let order = 1;
      if (firstBeh) {
        steps.push({
          stepOrder: order++,
          stepType: 'BEHAVIOR_CALL',
          refId: firstBeh.id,
          targetAggregate: involvedAggregates[0],
          description: `执行触发行为 ${firstBeh.alias}`,
        });
      }
      if (triggerEv) {
        steps.push({
          stepOrder: order++,
          stepType: 'EVENT_EMIT',
          refId: triggerEv.id,
          targetAggregate: involvedAggregates[0],
          description: `广播领域事件 ${triggerEv.label}`,
        });
      }
      if (secondBeh) {
        steps.push({
          stepOrder: order++,
          stepType: 'BEHAVIOR_CALL',
          refId: secondBeh.id,
          targetAggregate: involvedAggregates[involvedAggregates.length - 1],
          description: `联动执行下游行为 ${secondBeh.alias}`,
        });
      }

      const newScenario: ScenarioItem = {
        id: scnId,
        name,
        description:
          typeof args.description === 'string' && args.description.trim()
            ? args.description.trim()
            : `由 AI 本体助手编排的跨聚合事件场景「${name}」`,
        sourceObjectRef: involvedAggregates[0],
        targetObjectRefs: involvedAggregates.slice(1),
        ...(firstBeh ? { triggerBehaviorRef: firstBeh.id } : {}),
        triggerEventRef,
        involvedAggregates,
        preconditions: [],
        postconditions: [],
        steps,
      };

      const existingIdx = nextSuite.M4.event_scenarios.findIndex((s) => s.id === scnId);
      if (existingIdx >= 0) {
        nextSuite.M4.event_scenarios[existingIdx] = {
          ...nextSuite.M4.event_scenarios[existingIdx],
          ...newScenario,
        };
      } else {
        nextSuite.M4.event_scenarios.push(newScenario);
      }

      return {
        nextSuite,
        modelCode: 'M4',
        elementId: scnId,
        summaryZh: `已在 M4 场景模型中维护跨对象场景 ${scnId}（${name}）`,
        summaryEn: `Upserted M4 scenario ${scnId} (${name})`,
      };
    }

    case 'upsert_actor_role': {
      if (!nextSuite.M5) {
        nextSuite.M5 = {
          model_type: 'ACTOR',
          version: '5.0',
          domain,
          actors: [],
          roles: [],
          permissions: [],
        };
      }
      const roleIdx = nextSuite.M5.roles.length + 1;
      const actorIdx = nextSuite.M5.actors.length + 1;
      const actorType: ActorItem['actorType'] =
        args.actorType === 'SYSTEM' || args.actorType === 'EXTERNAL_ENTITY'
          ? args.actorType
          : 'HUMAN';

      const roleId =
        typeof args.roleId === 'string' && args.roleId.trim()
          ? args.roleId.trim()
          : `ROLE-CUSTOM-${pad2(roleIdx)}`;
      const roleName =
        typeof args.roleName === 'string' && args.roleName.trim()
          ? args.roleName.trim()
          : '合规风控专员角色';
      const roleCode =
        typeof args.roleCode === 'string' && args.roleCode.trim()
          ? args.roleCode.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
          : `RISK_AUDITOR_${pad2(roleIdx)}`;

      if (actorType !== 'EXTERNAL_ENTITY') {
        const newRole: RoleItem = {
          id: roleId,
          name: roleName,
          code: roleCode,
          inheritsFrom: [],
          permissions: nextSuite.M5.permissions.slice(0, 1).map((p) => p.id),
          dataScope:
            args.dataScope === 'DEPARTMENT' || args.dataScope === 'SELF' ? args.dataScope : 'ALL',
          description:
            typeof args.description === 'string' ? args.description : `由 AI 本体助手维护的角色 ${roleName}`,
        };
        const rIdx = nextSuite.M5.roles.findIndex((r) => r.id === roleId);
        if (rIdx >= 0) nextSuite.M5.roles[rIdx] = newRole;
        else nextSuite.M5.roles.push(newRole);
      }

      const actorId =
        typeof args.actorId === 'string' && args.actorId.trim()
          ? args.actorId.trim()
          : actorType === 'EXTERNAL_ENTITY'
            ? `ACT-EXT-${pad2(actorIdx)}`
            : `ACT-${pad2(actorIdx)}`;
      const actorName =
        typeof args.actorName === 'string' && args.actorName.trim()
          ? args.actorName.trim()
          : actorType === 'EXTERNAL_ENTITY'
            ? '外部风控征信服务网关'
            : roleName.replace(/角色$/, '');

      const newActor: ActorItem = {
        id: actorId,
        name: actorName,
        actorType,
        roles: actorType === 'EXTERNAL_ENTITY' ? [] : [roleId],
        description:
          typeof args.description === 'string' ? args.description : `由 AI 本体助手维护的参与主体 ${actorName}`,
        ...(actorType === 'EXTERNAL_ENTITY'
          ? {
              externalContract: {
                protocol: 'REST',
                format: 'JSON',
                authType: 'BEARER_TOKEN',
                timeoutMs: 5000,
              },
            }
          : {}),
      };
      const aIdx = nextSuite.M5.actors.findIndex((a) => a.id === actorId);
      if (aIdx >= 0) nextSuite.M5.actors[aIdx] = newActor;
      else nextSuite.M5.actors.push(newActor);

      if (args.permissionId && typeof args.permissionId === 'string') {
        const targetAgg = findAggregate(nextSuite)?.name ?? 'Contract';
        const perm: PermissionItem = {
          id: args.permissionId,
          name: `${roleName}访问权限`,
          code: `${roleCode.toLowerCase()}:access`,
          targetAggregate: targetAgg,
          allowedBehaviors: [],
          uiControlledElements: [],
        };
        const pIdx = nextSuite.M5.permissions.findIndex((p) => p.id === perm.id);
        if (pIdx >= 0) nextSuite.M5.permissions[pIdx] = perm;
        else nextSuite.M5.permissions.push(perm);
      }

      return {
        nextSuite,
        modelCode: 'M5',
        elementId: actorId,
        summaryZh: `已在 M5 主体模型中维护参与方 ${actorId}（${actorName}）及关联角色授权`,
        summaryEn: `Upserted M5 actor ${actorId} (${actorName}) and role bindings`,
      };
    }

    case 'upsert_flow': {
      if (!nextSuite.M6) {
        nextSuite.M6 = {
          model_type: 'FLOW',
          version: '5.0',
          domain,
          flows: [],
        };
      }
      const nextIdx = nextSuite.M6.flows.length + 1;
      const flowId =
        typeof args.id === 'string' && args.id.trim() ? args.id.trim() : `FLW-${pad2(nextIdx)}`;
      const name =
        typeof args.name === 'string' && args.name.trim()
          ? args.name.trim()
          : `业务协同与合规审批流程 ${pad2(nextIdx)}`;
      const flowType: FlowItem['flowType'] =
        args.flowType === 'COLLABORATION' ? 'COLLABORATION' : 'APPROVAL';
      const primaryAgg = findAggregate(
        nextSuite,
        typeof args.primaryAggregate === 'string' ? args.primaryAggregate : undefined,
      );
      const primaryAggregate = primaryAgg?.name ?? 'Contract';
      const validRoles = (nextSuite.M5?.roles ?? []).map((r) => r.id);
      const firstRole = validRoles[0];
      const secondRole = validRoles[1] ?? firstRole;
      const firstBeh = nextSuite.M2?.behaviors.find((b) => b.behaviorType === 'COMMAND') ?? nextSuite.M2?.behaviors[0];

      const activities: FlowActivity[] = [
        {
          id: 'ACTV-START',
          name: '流程启动',
          activityType: 'START',
          nextActivity: 'ACTV-SUBMIT-TASK',
          branches: [],
        },
        {
          id: 'ACTV-SUBMIT-TASK',
          name: '经办人发起与合规预检',
          activityType: 'USER_TASK',
          ...(firstRole ? { roleRef: firstRole } : {}),
          ...(firstBeh ? { behaviorRef: firstBeh.id } : {}),
          nextActivity: flowType === 'APPROVAL' ? 'ACTV-APPROVE-TASK' : 'ACTV-END',
          branches: [],
        },
        ...(flowType === 'APPROVAL'
          ? ([
              {
                id: 'ACTV-APPROVE-TASK',
                name: '主管审核放行',
                activityType: 'APPROVAL_TASK',
                ...(secondRole ? { roleRef: secondRole } : {}),
                approvalOutcomes: ['APPROVED', 'REJECTED'],
                nextActivity: 'ACTV-OUTCOME-GW',
                branches: [],
              },
              {
                id: 'ACTV-OUTCOME-GW',
                name: '审批结论路由网关',
                activityType: 'XOR_GATEWAY',
                branches: [
                  {
                    targetActivity: 'ACTV-END',
                    approvalOutcome: 'APPROVED',
                    condition: "approvalOutcome == 'APPROVED'",
                    isDefault: false,
                    label: '审批通过完成流程',
                  },
                  {
                    targetActivity: 'ACTV-END-REJECT',
                    approvalOutcome: 'REJECTED',
                    isDefault: true,
                    label: '审批驳回终止',
                  },
                ],
              },
              {
                id: 'ACTV-END-REJECT',
                name: '驳回结束',
                activityType: 'END',
                branches: [],
              },
            ] satisfies FlowActivity[])
          : []),
        {
          id: 'ACTV-END',
          name: '流程正常结束',
          activityType: 'END',
          branches: [],
        },
      ];

      const newFlow: FlowItem = {
        id: flowId,
        name,
        flowType,
        primaryAggregate,
        roleRefs: validRoles.slice(0, 2),
        description:
          typeof args.description === 'string' && args.description.trim()
            ? args.description.trim()
            : `由 AI 本体助手生成的端到端流程（含完整 START -> ... -> END 拓扑）`,
        trigger: {
          triggerType: firstBeh ? 'USER_ACTION' : 'MANUAL',
          ...(firstBeh ? { refId: firstBeh.id } : {}),
          description: `触发流程 ${name}`,
        },
        activities,
      };

      const existingIdx = nextSuite.M6.flows.findIndex((f) => f.id === flowId);
      if (existingIdx >= 0) nextSuite.M6.flows[existingIdx] = newFlow;
      else nextSuite.M6.flows.push(newFlow);

      return {
        nextSuite,
        modelCode: 'M6',
        elementId: flowId,
        summaryZh: `已在 M6 流程模型中维护流程 ${flowId}（${name}，含完整 START -> END 拓扑）`,
        summaryEn: `Upserted M6 flow ${flowId} (${name}) with valid START -> END topology`,
      };
    }

    case 'upsert_query_report': {
      if (!nextSuite.M7) {
        nextSuite.M7 = {
          model_type: 'QUERY_REPORT',
          version: '5.0',
          domain,
          query_reports: [],
        };
      }
      if (!nextSuite.M2) {
        nextSuite.M2 = {
          model_type: 'BEHAVIOR',
          version: '5.0',
          domain,
          behaviors: [],
        };
      }
      const nextIdx = nextSuite.M7.query_reports.length + 1;
      const rawQueryType = String(args.queryType ?? 'REPORT').toUpperCase();
      const queryType: QueryReportItem['queryType'] =
        rawQueryType === 'DETAIL_QUERY' ||
        rawQueryType === 'LIST_QUERY' ||
        rawQueryType === 'QUERY' ||
        rawQueryType === 'STATISTICAL_QUERY'
          ? rawQueryType
          : 'REPORT';

      const prefix = queryType === 'REPORT' ? 'RPT' : 'QRY';
      const rptId =
        typeof args.id === 'string' && args.id.trim() ? args.id.trim() : `${prefix}-${pad2(nextIdx + 2)}`;
      const alias =
        typeof args.alias === 'string' && args.alias.trim()
          ? args.alias.trim()
          : `合同履约分析统计报表 ${pad2(nextIdx)}`;
      const rptName = toPascalIdentifier(
        typeof args.name === 'string' ? args.name : undefined,
        'DomainAnalyticsReport',
        nextIdx,
      );

      const primaryAgg = findAggregate(
        nextSuite,
        typeof args.primaryAggregate === 'string' ? args.primaryAggregate : undefined,
      );
      const aggName = primaryAgg?.name ?? 'Contract';
      const firstAttr = primaryAgg?.attributes[0]?.name ?? 'id';
      const tableSnake = `t_${toSnakeCase(aggName)}`;
      const colSnake = toSnakeCase(firstAttr);

      // Pair with existing M2 QUERY behavior or auto-create a new paired M2 QUERY behavior
      let pairedBeh =
        typeof args.behaviorRef === 'string'
          ? nextSuite.M2.behaviors.find((b) => b.id === args.behaviorRef && b.behaviorType === 'QUERY')
          : nextSuite.M2.behaviors.find((b) => b.queryReportRef === rptId);

      if (!pairedBeh) {
        const behIdx = nextSuite.M2.behaviors.length + 1;
        const behId =
          typeof args.behaviorRef === 'string' && args.behaviorRef.trim()
            ? args.behaviorRef.trim()
            : `BHV-QRY-${pad2(behIdx)}`;
        pairedBeh = {
          id: behId,
          name: `query${rptName}`,
          alias: `查询${alias}`,
          ownerEntity: aggName,
          behaviorType: 'QUERY',
          triggerType: 'SYSTEM',
          description: `与 M7 ${rptId} 自动配对的查询行为`,
          inputParameters: [{ name: 'keyword', label: '筛选词', type: 'String', required: false }],
          outputParameters: [{ name: 'rows', label: '数据集', type: 'Array', required: true }],
          preconditions: [],
          stateChanges: [],
          invokedRules: [],
          producedEvents: [],
          requiredPermissions: [],
          queryReportRef: rptId,
        };
        nextSuite.M2.behaviors.push(pairedBeh);
      } else {
        pairedBeh.queryReportRef = rptId;
      }

      const sql =
        typeof args.sql === 'string' && args.sql.trim()
          ? args.sql.trim()
          : `SELECT t.${colSnake} AS ${firstAttr} FROM ${tableSnake} t ORDER BY t.${colSnake} DESC LIMIT 50`;

      const newReport: QueryReportItem = {
        id: rptId,
        name: rptName,
        alias,
        queryType,
        behaviorRef: pairedBeh.id,
        description:
          typeof args.description === 'string' && args.description.trim()
            ? args.description.trim()
            : `由 AI 本体助手维护的查询报表规格「${alias}」`,
        primarySource: {
          aggregateRef: aggName,
          alias: 't',
        },
        joins: [],
        parameters: [{ name: 'keyword', label: '筛选词', type: 'String', required: false }],
        conditions: [],
        resultColumns: [
          {
            name: firstAttr,
            label: primaryAgg?.attributes[0]?.label ?? '业务编号',
            sourceExpr: `t.${colSnake}`,
            dataType: primaryAgg?.attributes[0]?.type ?? 'String',
          },
        ],
        groupBy: [],
        orderBy: [],
        pagination: { enabled: true, defaultPageSize: 20, maxPageSize: 100 },
        ...(queryType === 'REPORT'
          ? {
              reportOptions: {
                exportFormats: ['XLSX', 'CSV', 'PDF'],
                summaryRow: true,
                groupHeaders: [primaryAgg?.attributes[0]?.label ?? '业务维度'],
              },
            }
          : {}),
        referenceSql: {
          dialect: 'SQLite',
          sql,
          parameterMappings: ['keyword'],
          resultMappings: [firstAttr],
        },
      };

      const existingIdx = nextSuite.M7.query_reports.findIndex((q) => q.id === rptId);
      if (existingIdx >= 0) nextSuite.M7.query_reports[existingIdx] = newReport;
      else nextSuite.M7.query_reports.push(newReport);

      return {
        nextSuite,
        modelCode: 'M7',
        elementId: rptId,
        summaryZh: `已在 M7 查询报表模型中维护 ${rptId}（${alias}，配对 M2 查询行为 ${pairedBeh.id}）`,
        summaryEn: `Upserted M7 query/report ${rptId} (${alias}, paired with M2 ${pairedBeh.id})`,
      };
    }

    case 'upsert_screen': {
      if (!nextSuite.MU) {
        nextSuite.MU = {
          model_type: 'UI',
          version: '5.0',
          domain,
          screens: [],
          navigation_edges: [],
          cross_cutting_ui: [],
        };
      }
      const nextIdx = nextSuite.MU.screens.length + 1;
      const screenId =
        typeof args.screenId === 'string' && args.screenId.trim()
          ? args.screenId.trim()
          : `SCR-WORKSPACE-${pad2(nextIdx)}`;
      const screenName =
        typeof args.name === 'string' && args.name.trim()
          ? args.name.trim()
          : `智能业务协同看板 ${pad2(nextIdx)}`;
      const rawScreenType = String(args.screenType ?? 'LIST').toUpperCase();
      const screenType: ScreenItem['screenType'] =
        rawScreenType === 'FORM' ||
        rawScreenType === 'DETAIL' ||
        rawScreenType === 'APPROVAL' ||
        rawScreenType === 'REPORT' ||
        rawScreenType === 'DASHBOARD' ||
        rawScreenType === 'MODAL'
          ? rawScreenType
          : 'LIST';

      const primaryAgg = findAggregate(nextSuite);
      const firstAttr = primaryAgg?.attributes[0];
      const firstReport = nextSuite.M7?.query_reports[0];
      const firstRoleIds = (nextSuite.M5?.roles ?? []).slice(0, 2).map((r) => r.id);

      const suffix = pad2(nextIdx);
      const elements: UIElement[] = [
        {
          elementId: `EL-KEYWORD-${suffix}`,
          name: `keywordInput${suffix}`,
          label: firstAttr?.label ?? '关键字检索',
          elementType: 'INPUT',
          io: 'IN',
          required: false,
          ...(primaryAgg && firstAttr ? { dataBinding: `${primaryAgg.name}.${firstAttr.name}` } : {}),
        },
        {
          elementId: `EL-BTN-ACTION-${suffix}`,
          name: `actionButton${suffix}`,
          label: '刷新数据视图',
          elementType: 'BUTTON',
          io: 'ACTION',
          required: false,
        },
        {
          elementId: `EL-DATA-TABLE-${suffix}`,
          name: `dataTable${suffix}`,
          label: `${screenName}数据列表`,
          elementType: 'TABLE',
          io: 'OUT',
          required: false,
          ...(firstReport ? { dataSource: firstReport.id } : {}),
        },
      ];

      const events: UIEvent[] = [];
      if (firstReport) {
        const callChain: UIEvent['callChain'] = [];
        let order = 1;
        if (firstReport.behaviorRef && nextSuite.M2?.behaviors.some((b) => b.id === firstReport.behaviorRef)) {
          callChain.push({
            stepOrder: order++,
            stepType: 'BEHAVIOR_CALL',
            refId: firstReport.behaviorRef,
            description: '调用配对查询行为',
          });
        }
        callChain.push({
          stepOrder: order++,
          stepType: 'REPORT_CALL',
          refId: firstReport.id,
          description: '加载查询报表数据',
        });
        callChain.sort(
          (a, b) => (CALL_CHAIN_ORDER[a.stepType] ?? 99) - (CALL_CHAIN_ORDER[b.stepType] ?? 99),
        );
        events.push({
          eventId: `UIE-REFRESH-${suffix}`,
          name: `点击刷新${screenName}`,
          triggerElementId: `EL-BTN-ACTION-${suffix}`,
          triggerAction: 'CLICK',
          permissions: [],
          callChain,
        });
      }

      const newScreen: ScreenItem = {
        screenId,
        name: screenName,
        screenType,
        route:
          typeof args.route === 'string' && args.route.trim()
            ? args.route.trim()
            : `/${toSnakeCase(screenId).replace(/_/g, '-')}`,
        roleRefs: firstRoleIds,
        description:
          typeof args.description === 'string' ? args.description : `由 AI 本体助手生成的屏幕 ${screenName}`,
        layout: buildAsciiWireframeLayout(screenId, screenName, elements),
        elements,
        events,
      };

      const existingIdx = nextSuite.MU.screens.findIndex((s) => s.screenId === screenId);
      if (existingIdx >= 0) nextSuite.MU.screens[existingIdx] = newScreen;
      else nextSuite.MU.screens.push(newScreen);

      return {
        nextSuite,
        modelCode: 'MU',
        elementId: screenId,
        summaryZh: `已在 MU UI 模型中维护屏幕 ${screenId}（${screenName}，含合法布局令牌与事件调用链）`,
        summaryEn: `Upserted MU screen ${screenId} (${screenName}) with valid layout tokens`,
      };
    }

    case 'upsert_mapping': {
      if (!nextSuite.MM) {
        nextSuite.MM = {
          model_type: 'MAPPING',
          version: '1.0',
          domain,
          mappings: [],
        };
      }
      const nextIdx = nextSuite.MM.mappings.length + 1;
      const targetAgg = findAggregate(
        nextSuite,
        typeof args.objectName === 'string' ? args.objectName : undefined,
      );
      const objectRef = targetAgg?.id ?? 'AGG-01';
      const objectName = targetAgg?.name ?? 'Contract';
      const mapId =
        typeof args.id === 'string' && args.id.trim()
          ? args.id.trim()
          : `MAP-${objectName.toUpperCase()}-${pad2(nextIdx)}`;
      const tableName =
        typeof args.tableName === 'string' && args.tableName.trim()
          ? args.tableName.trim()
          : `t_${toSnakeCase(objectName)}`;

      const columnMappings = (targetAgg?.attributes ?? []).slice(0, 8).map((attr) => ({
        attributeRef: `${objectName}.${attr.name}`,
        column: toSnakeCase(attr.name),
        columnType:
          attr.type === 'Money' || attr.type === 'Decimal'
            ? 'DECIMAL(18,2)'
            : attr.type === 'Integer'
              ? 'INTEGER'
              : attr.type === 'ValueObject'
                ? 'TEXT'
                : 'VARCHAR(128)',
        ...(attr.type === 'ValueObject' ? { valueObjectStrategy: 'JSON_COLUMN' as const } : {}),
      }));

      const newMapping: ObjectTableMapping = {
        id: mapId,
        objectRef,
        objectRole: 'AGGREGATE_ROOT',
        objectName,
        mappingNote:
          typeof args.mappingNote === 'string'
            ? args.mappingNote
            : `由 AI 本体助手生成的 ${objectName} -> ${tableName} 持久化主表映射`,
        tableMappings: [
          {
            tableName,
            tableRole: 'MASTER',
            primaryKey: 'id',
            foreignKeys: [],
            columnMappings,
          },
        ],
      };

      const existingIdx = nextSuite.MM.mappings.findIndex((m) => m.id === mapId);
      if (existingIdx >= 0) nextSuite.MM.mappings[existingIdx] = newMapping;
      else nextSuite.MM.mappings.push(newMapping);

      return {
        nextSuite,
        modelCode: 'MM',
        elementId: mapId,
        summaryZh: `已在 MM 数据映射模型中维护映射 ${mapId}（${objectName} -> ${tableName}）`,
        summaryEn: `Upserted MM persistence mapping ${mapId} (${objectName} -> ${tableName})`,
      };
    }

    case 'upsert_interface': {
      if (!nextSuite.MI) {
        nextSuite.MI = {
          model_type: 'INTERFACE',
          version: '1.0',
          domain,
          interfaces: [],
        };
      }
      const nextIdx = nextSuite.MI.interfaces.length + 1;
      const interfaceId =
        typeof args.interfaceId === 'string' && args.interfaceId.trim()
          ? args.interfaceId.trim()
          : `IF-${pad2(nextIdx + 2)}`;
      const name =
        typeof args.name === 'string' && args.name.trim()
          ? args.name.trim()
          : `合同领域服务接口 ${pad2(nextIdx)}`;
      const direction: InterfaceItem['direction'] =
        args.direction === 'DEPENDENT' ? 'DEPENDENT' : 'PROVIDED';

      const targetAgg = findAggregate(
        nextSuite,
        typeof args.relatedEntityRef === 'string' ? args.relatedEntityRef : undefined,
      );
      const targetBeh =
        nextSuite.M2?.behaviors.find((b) => b.id === args.relatedBehaviorRef) ??
        nextSuite.M2?.behaviors[0];

      let externalEntityRef: string | undefined;
      if (direction === 'DEPENDENT' && nextSuite.M5) {
        let extActor = nextSuite.M5.actors.find(
          (a) =>
            a.actorType === 'EXTERNAL_ENTITY' &&
            (!args.relatedExternalEntityRef || a.id === args.relatedExternalEntityRef),
        );
        if (!extActor) {
          extActor = {
            id: 'ACT-EXT-AUTO',
            name: '外部协同系统网关',
            actorType: 'EXTERNAL_ENTITY',
            roles: [],
            externalContract: {
              protocol: 'REST',
              format: 'JSON',
              authType: 'BEARER_TOKEN',
              timeoutMs: 5000,
            },
          };
          nextSuite.M5.actors.push(extActor);
        }
        externalEntityRef = extActor.id;
      }

      const rawCat = String(args.interfaceCategory ?? 'COMMAND').toUpperCase();
      const interfaceCategory: InterfaceItem['interfaceCategory'] =
        rawCat === 'QUERY' || rawCat === 'NOTIFICATION'
          ? rawCat
          : rawCat === 'EVENT' && (nextSuite.ME?.events.length ?? 0) > 0
            ? 'EVENT'
            : 'COMMAND';

      const newInterface: InterfaceItem = {
        interfaceId,
        name,
        direction,
        interfaceCategory,
        protocol:
          args.protocol === 'GRAPHQL' ||
          args.protocol === 'RPC' ||
          args.protocol === 'MQ' ||
          args.protocol === 'WEBHOOK'
            ? args.protocol
            : 'REST',
        format: 'JSON',
        authMethod: 'BEARER_JWT',
        description:
          typeof args.description === 'string' && args.description.trim()
            ? args.description.trim()
            : `由 AI 本体助手维护的服务接口契约「${name}」`,
        ...(direction === 'PROVIDED' && targetBeh ? { relatedBehaviorRef: targetBeh.id } : {}),
        ...(direction === 'DEPENDENT' && externalEntityRef
          ? { relatedExternalEntityRef: externalEntityRef }
          : {}),
        ...(interfaceCategory === 'EVENT' && nextSuite.ME?.events[0]
          ? { relatedEventRef: nextSuite.ME.events[0].id }
          : {}),
        ...(targetAgg ? { relatedEntityRef: targetAgg.name } : {}),
        inputFields: [
          {
            name: 'requestId',
            label: '请求幂等流水号',
            type: 'String',
            required: true,
          },
        ],
        outputFields: [
          {
            name: 'accepted',
            label: '受理结果',
            type: 'Boolean',
            required: true,
          },
        ],
        returnRules: [
          {
            code: 'OK_200',
            scenario: '服务调用成功',
            httpStatus: 200,
            message: 'OK',
          },
        ],
      };

      const existingIdx = nextSuite.MI.interfaces.findIndex((i) => i.interfaceId === interfaceId);
      if (existingIdx >= 0) nextSuite.MI.interfaces[existingIdx] = newInterface;
      else nextSuite.MI.interfaces.push(newInterface);

      return {
        nextSuite,
        modelCode: 'MI',
        elementId: interfaceId,
        summaryZh: `已在 MI 接口模型中维护${direction === 'PROVIDED' ? '提供方' : '依赖方'}接口 ${interfaceId}（${name}）`,
        summaryEn: `Upserted MI ${direction} interface ${interfaceId} (${name})`,
      };
    }

    case 'delete_element': {
      const elementId = String(args.elementId ?? '').trim();
      let deletedFromModel: ModelCode = (args.modelCode as ModelCode) || 'M1';

      if (nextSuite.M1 && (!args.modelCode || args.modelCode === 'M1')) {
        const before = nextSuite.M1.aggregates.length;
        nextSuite.M1.aggregates = nextSuite.M1.aggregates.filter(
          (a) => a.id !== elementId && a.name !== elementId,
        );
        if (nextSuite.M1.aggregates.length < before) deletedFromModel = 'M1';
      }
      if (nextSuite.M2 && (!args.modelCode || args.modelCode === 'M2')) {
        const before = nextSuite.M2.behaviors.length;
        nextSuite.M2.behaviors = nextSuite.M2.behaviors.filter(
          (b) => b.id !== elementId && b.name !== elementId,
        );
        if (nextSuite.M2.behaviors.length < before) deletedFromModel = 'M2';
      }
      if (nextSuite.M3 && (!args.modelCode || args.modelCode === 'M3')) {
        const before = nextSuite.M3.rules.length;
        nextSuite.M3.rules = nextSuite.M3.rules.filter(
          (r) => r.id !== elementId && r.name !== elementId,
        );
        if (nextSuite.M3.rules.length < before) deletedFromModel = 'M3';
      }
      if (nextSuite.ME && (!args.modelCode || args.modelCode === 'ME')) {
        const before = nextSuite.ME.events.length;
        nextSuite.ME.events = nextSuite.ME.events.filter(
          (e) => e.id !== elementId && e.name !== elementId,
        );
        if (nextSuite.ME.events.length < before) deletedFromModel = 'ME';
      }
      if (nextSuite.M4 && (!args.modelCode || args.modelCode === 'M4')) {
        const before = nextSuite.M4.event_scenarios.length;
        nextSuite.M4.event_scenarios = nextSuite.M4.event_scenarios.filter(
          (s) => s.id !== elementId && s.name !== elementId,
        );
        if (nextSuite.M4.event_scenarios.length < before) deletedFromModel = 'M4';
      }
      if (nextSuite.M5 && (!args.modelCode || args.modelCode === 'M5')) {
        nextSuite.M5.actors = nextSuite.M5.actors.filter((a) => a.id !== elementId);
        nextSuite.M5.roles = nextSuite.M5.roles.filter((r) => r.id !== elementId && r.code !== elementId);
        nextSuite.M5.permissions = nextSuite.M5.permissions.filter((p) => p.id !== elementId);
        if (args.modelCode === 'M5') deletedFromModel = 'M5';
      }
      if (nextSuite.M6 && (!args.modelCode || args.modelCode === 'M6')) {
        const before = nextSuite.M6.flows.length;
        nextSuite.M6.flows = nextSuite.M6.flows.filter((f) => f.id !== elementId);
        if (nextSuite.M6.flows.length < before) deletedFromModel = 'M6';
      }
      if (nextSuite.M7 && (!args.modelCode || args.modelCode === 'M7')) {
        const before = nextSuite.M7.query_reports.length;
        nextSuite.M7.query_reports = nextSuite.M7.query_reports.filter((q) => q.id !== elementId);
        if (nextSuite.M7.query_reports.length < before) deletedFromModel = 'M7';
      }
      if (nextSuite.MU && (!args.modelCode || args.modelCode === 'MU')) {
        const before = nextSuite.MU.screens.length;
        nextSuite.MU.screens = nextSuite.MU.screens.filter((s) => s.screenId !== elementId);
        if (nextSuite.MU.screens.length < before) deletedFromModel = 'MU';
      }
      if (nextSuite.MM && (!args.modelCode || args.modelCode === 'MM')) {
        const before = nextSuite.MM.mappings.length;
        nextSuite.MM.mappings = nextSuite.MM.mappings.filter((m) => m.id !== elementId);
        if (nextSuite.MM.mappings.length < before) deletedFromModel = 'MM';
      }
      if (nextSuite.MI && (!args.modelCode || args.modelCode === 'MI')) {
        const before = nextSuite.MI.interfaces.length;
        nextSuite.MI.interfaces = nextSuite.MI.interfaces.filter((i) => i.interfaceId !== elementId);
        if (nextSuite.MI.interfaces.length < before) deletedFromModel = 'MI';
      }

      return {
        nextSuite,
        modelCode: deletedFromModel,
        elementId,
        summaryZh: `已尝试从 ${deletedFromModel} 中移除元素 ${elementId}`,
        summaryEn: `Attempted deletion of ${elementId} from ${deletedFromModel}`,
      };
    }

    default:
      throw new Error(`Unsupported ontology tool: ${toolName}`);
  }
}
