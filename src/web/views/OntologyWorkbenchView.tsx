import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  MODEL_FILE_NAMES,
  MODEL_STAGE_ORDER,
  analyzeImpact,
  extractLayoutElementIds,
  serializeModelYaml,
  type Attribute,
  type ImpactAnalysisReport,
  type InterfaceFieldSpec,
  type ModelCode,
  type OntologySuite,
} from '../../packages/ontology-core/index.js';
import {
  apiAnalyzeImpact,
  apiRenameSymbol,
  useWorkbenchStore,
} from '../api.js';
import { AgentSessionWorkbench } from '../components/agent/AgentSessionWorkbench.js';
import { usePreferences } from '../i18n.js';
import { KnowledgeGraphCanvas } from './KnowledgeGraphCanvas.js';
import './ontology-workbench.css';
import { Button } from '../components/beautifui/index.js';

interface TreeElementSummary {
  id: string;
  label: string;
  subLabel?: string;
  impactSymbol: string;
}

function getModelTreeElements(suite: OntologySuite, code: ModelCode): TreeElementSummary[] {
  switch (code) {
    case 'M1':
      return (suite.M1?.aggregates ?? []).map((a) => ({
        id: a.id,
        label: a.name,
        subLabel: a.alias,
        impactSymbol: a.name,
      }));
    case 'M2':
      return (suite.M2?.behaviors ?? []).map((b) => ({
        id: b.id,
        label: b.name,
        subLabel: b.alias,
        impactSymbol: b.id,
      }));
    case 'M3':
      return (suite.M3?.rules ?? []).map((r) => ({
        id: r.id,
        label: r.alias || r.name,
        subLabel: r.ruleType,
        impactSymbol: r.id,
      }));
    case 'ME':
      return (suite.ME?.events ?? []).map((ev) => ({
        id: ev.id,
        label: ev.name,
        subLabel: ev.label,
        impactSymbol: ev.id,
      }));
    case 'M4':
      return (suite.M4?.event_scenarios ?? []).map((sc) => ({
        id: sc.id,
        label: sc.name,
        subLabel: sc.triggerEventRef,
        impactSymbol: sc.id,
      }));
    case 'M5':
      return [
        ...(suite.M5?.roles ?? []).map((r) => ({
          id: r.id,
          label: r.name,
          subLabel: r.code,
          impactSymbol: r.id,
        })),
        ...(suite.M5?.permissions ?? []).map((p) => ({
          id: p.id,
          label: p.name,
          subLabel: p.targetAggregate,
          impactSymbol: p.id,
        })),
      ];
    case 'M6':
      return (suite.M6?.flows ?? []).map((fl) => ({
        id: fl.id,
        label: fl.name,
        subLabel: fl.flowType,
        impactSymbol: fl.id,
      }));
    case 'M7':
      return (suite.M7?.query_reports ?? []).map((qr) => ({
        id: qr.id,
        label: qr.alias || qr.name,
        subLabel: qr.queryType,
        impactSymbol: qr.id,
      }));
    case 'MU':
      return (suite.MU?.screens ?? []).map((sc) => ({
        id: sc.screenId,
        label: sc.name,
        subLabel: sc.route || sc.screenType,
        impactSymbol: sc.screenId,
      }));
    case 'MM':
      return (suite.MM?.mappings ?? []).map((mp) => ({
        id: mp.id,
        label: mp.objectName,
        subLabel: mp.tableMappings.map((tm) => tm.tableName).join(','),
        impactSymbol: mp.id,
      }));
    case 'MI':
      return (suite.MI?.interfaces ?? []).map((intf) => ({
        id: intf.interfaceId,
        label: intf.name,
        subLabel: `${intf.direction}/${intf.protocol}`,
        impactSymbol: intf.interfaceId,
      }));
  }
}

function nextUniqueId(prefix: string, existingIds: Iterable<string>, pad = 2): string {
  const set = new Set(existingIds);
  let idx = set.size + 1;
  while (set.has(`${prefix}${String(idx).padStart(pad, '0')}`)) {
    idx += 1;
  }
  return `${prefix}${String(idx).padStart(pad, '0')}`;
}

function splitCsv(raw: string): string[] {
  return raw
    .split(/[,，→]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Textarea that grows with its content (falls back to JS sizing where `field-sizing` is unsupported). */
function AutoGrowTextarea({
  className = '',
  value,
  minRows = 1,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string; minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={minRows}
      className={`owb-autogrow ${className}`}
      value={value}
      {...rest}
    />
  );
}

/** Renders a lifecycle state machine as wrapping chips joined by arrows. */
function LifecycleFlow({ states, label }: { states: string[]; label: string }) {
  return (
    <div className="owb-lifecycle" aria-label={label}>
      <span className="owb-lifecycle-label">{label}</span>
      {states.length === 0 ? (
        <span className="owb-empty-hint">—</span>
      ) : (
        states.map((s, i) => (
          <React.Fragment key={`${s}-${i}`}>
            {i > 0 && (
              <span className="owb-state-arrow" aria-hidden="true">
                →
              </span>
            )}
            <span
              className={`owb-state-chip ${i === 0 ? 'is-initial' : ''} ${
                i === states.length - 1 && states.length > 1 ? 'is-final' : ''
              }`}
            >
              {s}
            </span>
          </React.Fragment>
        ))
      )}
    </div>
  );
}

export function OntologyWorkbenchView() {
  const { t } = usePreferences();
  const {
    data,
    selectedModel,
    selectedElementId,
    setSelectedModel,
    saveSuiteWithUndo,
    pushUndoSnapshot,
    undo,
    redo,
    undoStack,
    redoStack,
    patchData,
    showToast,
  } = useWorkbenchStore();

  const [activeTab, setActiveTab] = useState<'STRUCTURED' | 'GRAPH' | 'YAML'>('STRUCTURED');
  const [treeSearch, setTreeSearch] = useState('');
  const [yamlText, setYamlText] = useState('');

  // Non-blocking Cascade Rename, Impact Analysis & Referenced-Delete Guard Modal
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [targetSymbol, setTargetSymbol] = useState('Contract');
  const [newSymbolName, setNewSymbolName] = useState('CommercialContract');
  const [impactReport, setImpactReport] = useState<ImpactAnalysisReport | null>(null);
  const [pendingDeleteAction, setPendingDeleteAction] = useState<{
    elementId: string;
    label: string;
    execute: () => Promise<void>;
  } | null>(null);
  const [showDiagnosticsDrawer, setShowDiagnosticsDrawer] = useState(false);

  const project = data?.activeProject;

  useEffect(() => {
    if (!project) return;
    const modelData = project.suite[selectedModel];
    if (modelData) {
      setYamlText(serializeModelYaml(selectedModel, modelData as never));
    } else {
      setYamlText(`# ${selectedModel} (${MODEL_FILE_NAMES[selectedModel]}) not yet authored\n`);
    }
  }, [project, selectedModel]);

  if (!project) return null;

  const suite = project.suite;
  const validation = project.validation;
  const domainCode = project.domain || 'enterprise';

  const getModelElementCount = (code: ModelCode): number => {
    switch (code) {
      case 'M1':
        return suite.M1?.aggregates.length ?? 0;
      case 'M2':
        return suite.M2?.behaviors.length ?? 0;
      case 'M3':
        return suite.M3?.rules.length ?? 0;
      case 'ME':
        return suite.ME?.events.length ?? 0;
      case 'M4':
        return suite.M4?.event_scenarios.length ?? 0;
      case 'M5':
        return (suite.M5?.roles.length ?? 0) + (suite.M5?.permissions.length ?? 0);
      case 'M6':
        return suite.M6?.flows.length ?? 0;
      case 'M7':
        return suite.M7?.query_reports.length ?? 0;
      case 'MU':
        return suite.MU?.screens.length ?? 0;
      case 'MM':
        return suite.MM?.mappings.length ?? 0;
      case 'MI':
        return suite.MI?.interfaces.length ?? 0;
    }
  };

  const handleSaveYaml = async () => {
    const res = await fetch(`/api/projects/${project.id}/models/${selectedModel}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yamlText }),
    });
    const json = await res.json();
    if (!res.ok) {
      showToast(`YAML 校验失败: ${json.error}`);
      return;
    }
    pushUndoSnapshot(suite);
    patchData({ activeProject: json.project });
    showToast(
      `${MODEL_FILE_NAMES[selectedModel]} 已保存并通过语法与两级一致性校验（支持撤销）`,
    );
  };

  const handleQuickAddItem = async () => {
    const next: OntologySuite = JSON.parse(JSON.stringify(suite));
    let createdId = '';
    let note = '';

    switch (selectedModel) {
      case 'M1': {
        if (!next.M1) {
          next.M1 = {
            model_type: 'OBJECT',
            version: '5.0',
            domain: domainCode,
            aggregates: [],
            data_dictionaries: [],
            aggregate_associations: [],
          };
        }
        createdId = nextUniqueId(
          'AGG-',
          next.M1.aggregates.map((a) => a.id),
        );
        const suffix = createdId.replace('AGG-', '');
        let aggName = `DomainEntity${suffix}`;
        const existingNames = new Set(next.M1.aggregates.map((a) => a.name));
        while (existingNames.has(aggName)) aggName = `${aggName}X`;

        next.M1.aggregates.push({
          id: createdId,
          name: aggName,
          alias: `新增领域聚合${suffix}`,
          aggregateType: 'AGGREGATE_ROOT',
          description: '通过结构化工作台新增的领域聚合根',
          lifecycle: ['DRAFT', 'ACTIVE', 'ARCHIVED'],
          tags: ['CUSTOM'],
          attributes: [
            {
              name: 'code',
              label: '业务编码',
              type: 'String',
              required: true,
            },
            {
              name: 'status',
              label: '状态',
              type: 'String',
              required: true,
            },
          ],
          entities: [],
          valueObjects: [],
          invariants: [],
        });
        note = `Added M1 aggregate ${createdId}`;
        break;
      }

      case 'M2': {
        if (!next.M2) {
          next.M2 = {
            model_type: 'BEHAVIOR',
            version: '5.0',
            domain: domainCode,
            behaviors: [],
          };
        }
        createdId = nextUniqueId(
          'BHV-',
          next.M2.behaviors.map((b) => b.id),
        );
        const suffix = createdId.replace('BHV-', '');
        const owner = next.M1?.aggregates[0]?.name ?? 'Contract';
        const firstRule = next.M3?.rules[0]?.id;
        next.M2.behaviors.push({
          id: createdId,
          name: `executeDomainAction${suffix}`,
          alias: `新增领域命令行为${suffix}`,
          ownerEntity: owner,
          behaviorType: 'COMMAND',
          triggerType: 'SYSTEM',
          description: '通过结构化工作台新增的领域命令行为',
          inputParameters: [
            {
              name: 'operatorId',
              label: '操作人标识',
              type: 'String',
              required: true,
            },
          ],
          outputParameters: [],
          preconditions: [],
          stateChanges: [],
          invokedRules: firstRule ? [firstRule] : [],
          producedEvents: [],
          requiredPermissions: [],
        });
        note = `Added M2 behavior ${createdId}`;
        break;
      }

      case 'M3': {
        if (!next.M3) {
          next.M3 = {
            model_type: 'RULE',
            version: '5.0',
            domain: domainCode,
            rules: [],
          };
        }
        createdId = nextUniqueId(
          'RULE-',
          next.M3.rules.map((r) => r.id),
        );
        const suffix = createdId.replace('RULE-', '');
        const refObj = next.M1?.aggregates[0]?.name ?? 'Contract';
        next.M3.rules.push({
          id: createdId,
          name: `CustomValidationRule${suffix}`,
          alias: `新增业务校验规则${suffix}`,
          ruleType: 'VALIDATION',
          scope: 'CROSS_OBJECT',
          version: '1.0',
          description: '通过结构化工作台新增的业务规则约束',
          referencedObjects: next.M1?.aggregates[0] ? [refObj] : [],
          parameters: [],
          expression: `${refObj}.id != null`,
          violationMessage: '关键业务约束校验未通过',
          triggeredByEvents: [],
          producedEvents: [],
          triggeredBehaviors: [],
        });
        note = `Added M3 rule ${createdId}`;
        break;
      }

      case 'ME': {
        if (!next.ME) {
          next.ME = {
            model_type: 'EVENT',
            version: '5.0',
            domain: domainCode,
            events: [],
          };
        }
        createdId = nextUniqueId(
          'EVT-',
          next.ME.events.map((e) => e.id),
        );
        const suffix = createdId.replace('EVT-', '');
        const srcAgg = next.M1?.aggregates[0]?.name ?? 'Contract';
        const prodBhv =
          next.M2?.behaviors.find((b) => b.behaviorType === 'COMMAND')?.id ??
          next.M2?.behaviors[0]?.id ??
          'BHV-01';
        next.ME.events.push({
          id: createdId,
          name: `${srcAgg}.Updated${suffix}`,
          label: `对象状态变更事件${suffix}`,
          description: '领域行为执行成功后发出的标准领域事件',
          producerType: 'BEHAVIOR',
          producerBehaviorRef: prodBhv,
          sourceAggregate: srcAgg,
          orderingSemantic: 'AT_LEAST_ONCE',
          payload: [
            {
              name: 'entityId',
              label: '业务实体ID',
              type: 'String',
              required: true,
            },
          ],
          subscribers: [],
        });
        note = `Added ME event ${createdId}`;
        break;
      }

      case 'M4': {
        if (!next.M4) {
          next.M4 = {
            model_type: 'SCENARIO',
            version: '5.0',
            domain: domainCode,
            event_scenarios: [],
          };
        }
        createdId = nextUniqueId(
          'SCN-',
          next.M4.event_scenarios.map((s) => s.id),
        );
        const suffix = createdId.replace('SCN-', '');
        // M4 scenarios must span >= 2 distinct aggregates (§6.2)
        if (next.M1 && next.M1.aggregates.length === 1) {
          const auxId = nextUniqueId(
            'AGG-',
            next.M1.aggregates.map((a) => a.id),
          );
          next.M1.aggregates.push({
            id: auxId,
            name: 'AuditRecord',
            alias: '审计留痕聚合',
            aggregateType: 'AGGREGATE_ROOT',
            lifecycle: ['CREATED'],
            tags: ['AUDIT'],
            attributes: [{ name: 'refCode', label: '关联单号', type: 'String', required: true }],
            entities: [],
            valueObjects: [],
            invariants: [],
          });
        }
        const agg1 = next.M1?.aggregates[0]?.name ?? 'Contract';
        const agg2 = next.M1?.aggregates[1]?.name ?? 'Settlement';
        const trigEvent = next.ME?.events[0]?.id ?? 'EVT-01';
        const stepBehavior = next.M2?.behaviors[0]?.id;

        next.M4.event_scenarios.push({
          id: createdId,
          name: `跨对象联动场景${suffix}`,
          description: '由领域事件驱动的跨聚合协同业务场景',
          triggerEventRef: trigEvent,
          involvedAggregates: [agg1, agg2],
          preconditions: [],
          postconditions: [],
          steps: stepBehavior
            ? [
                {
                  stepOrder: 1,
                  stepType: 'BEHAVIOR_CALL',
                  refId: stepBehavior,
                  targetAggregate: agg2,
                  description: '触发下游聚合协同处理动作',
                },
              ]
            : [
                {
                  stepOrder: 1,
                  stepType: 'EVENT_EMIT',
                  refId: trigEvent,
                  targetAggregate: agg2,
                  description: '广播跨聚合通知事件',
                },
              ],
        });
        note = `Added M4 scenario ${createdId}`;
        break;
      }

      case 'M5': {
        if (!next.M5) {
          next.M5 = {
            model_type: 'ACTOR',
            version: '5.0',
            domain: domainCode,
            actors: [],
            roles: [],
            permissions: [],
          };
        }
        createdId = nextUniqueId(
          'ROLE-',
          next.M5.roles.map((r) => r.id),
        );
        const suffix = createdId.replace('ROLE-', '');
        const firstPerm = next.M5.permissions[0]?.id;
        next.M5.roles.push({
          id: createdId,
          name: `业务协同专员${suffix}`,
          code: `BIZ_ROLE_${suffix}`,
          inheritsFrom: [],
          permissions: firstPerm ? [firstPerm] : [],
          dataScope: 'DEPARTMENT',
          description: '通过结构化工作台新增的岗位角色与数据范围约束',
        });
        note = `Added M5 role ${createdId}`;
        break;
      }

      case 'M6': {
        if (!next.M6) {
          next.M6 = {
            model_type: 'FLOW',
            version: '5.0',
            domain: domainCode,
            flows: [],
          };
        }
        createdId = nextUniqueId(
          'FLOW-',
          next.M6.flows.map((f) => f.id),
        );
        const suffix = createdId.replace('FLOW-', '');
        const primAgg = next.M1?.aggregates[0]?.name ?? 'Contract';
        const firstRole = next.M5?.roles[0]?.id;

        next.M6.flows.push({
          id: createdId,
          name: `标准业务协同流程${suffix}`,
          flowType: 'COLLABORATION',
          primaryAggregate: primAgg,
          roleRefs: firstRole ? [firstRole] : [],
          description: '包含完整 START -> TASK -> END 可达性拓扑的业务流程',
          startActivity: 'ACT-START',
          endActivities: ['ACT-END'],
          trigger: {
            triggerType: 'MANUAL',
            description: '人工或外部编排发起流程',
          },
          activities: [
            {
              id: 'ACT-START',
              name: '流程开始',
              activityType: 'START',
              nextActivity: 'ACT-TASK-01',
              branches: [],
            },
            {
              id: 'ACT-TASK-01',
              name: '经办协同处理',
              activityType: firstRole ? 'USER_TASK' : 'SYSTEM_TASK',
              ...(firstRole ? { roleRef: firstRole } : {}),
              nextActivity: 'ACT-END',
              branches: [],
            },
            {
              id: 'ACT-END',
              name: '流程结束',
              activityType: 'END',
              branches: [],
            },
          ],
        });
        note = `Added M6 flow ${createdId}`;
        break;
      }

      case 'M7': {
        if (!next.M7) {
          next.M7 = {
            model_type: 'QUERY_REPORT',
            version: '5.0',
            domain: domainCode,
            query_reports: [],
          };
        }
        createdId = nextUniqueId(
          'QRY-',
          next.M7.query_reports.map((q) => q.id),
        );
        const suffix = createdId.replace('QRY-', '');
        const primAgg = next.M1?.aggregates[0]?.name ?? 'Contract';
        let pairedBehaviorId = `BHV-QRY-${suffix}`;

        // Maintain strict 1:1 M2 QUERY behavior <-> M7 QueryReport binding
        if (next.M2) {
          pairedBehaviorId = nextUniqueId(
            'BHV-QRY-',
            next.M2.behaviors.map((b) => b.id),
          );
          next.M2.behaviors.push({
            id: pairedBehaviorId,
            name: `queryCustomList${suffix}`,
            alias: `配对查询行为${suffix}`,
            ownerEntity: primAgg,
            behaviorType: 'QUERY',
            triggerType: 'SYSTEM',
            description: `与 ${createdId} 一对一双向绑定的 M2 查询行为`,
            inputParameters: [],
            outputParameters: [],
            preconditions: [],
            stateChanges: [],
            invokedRules: [],
            producedEvents: [],
            requiredPermissions: [],
            queryReportRef: createdId,
          });
        }

        next.M7.query_reports.push({
          id: createdId,
          name: `CustomListQuery${suffix}`,
          alias: `新增业务列表查询${suffix}`,
          queryType: 'LIST_QUERY',
          behaviorRef: pairedBehaviorId,
          description: '自动配对 M2 查询行为的结构化查询与 SQL 定义',
          primarySource: {
            aggregateRef: primAgg,
            alias: 't0',
          },
          joins: [],
          parameters: [],
          conditions: [],
          resultColumns: [
            {
              name: 'id',
              label: '主键ID',
              sourceExpr: 't0.id',
              dataType: 'String',
            },
          ],
          groupBy: [],
          orderBy: [],
          referenceSql: {
            dialect: 'SQLite',
            sql: 'SELECT t0.id FROM t_domain_entity t0 ORDER BY t0.id DESC LIMIT 20',
            parameterMappings: [],
            resultMappings: [],
          },
        });
        note = `Added paired M2+M7 query report ${createdId}`;
        break;
      }

      case 'MU': {
        if (!next.MU) {
          next.MU = {
            model_type: 'UI',
            version: '5.0',
            domain: domainCode,
            screens: [],
            navigation_edges: [],
            cross_cutting_ui: [],
          };
        }
        createdId = nextUniqueId(
          'SCR-CUSTOM-',
          next.MU.screens.map((s) => s.screenId),
        );
        const suffix = createdId.replace('SCR-CUSTOM-', '');
        const firstRole = next.M5?.roles[0]?.id;
        const kwId = `txtKeyword${suffix}`;
        const btnId = `btnRefresh${suffix}`;
        const tblId = `grdList${suffix}`;
        const evId = nextUniqueId(
          'EV-UI-',
          next.MU.screens.flatMap((s) => s.events.map((ev) => ev.eventId)),
        );

        next.MU.screens.push({
          screenId: createdId,
          name: `新增业务工作台屏幕${suffix}`,
          screenType: 'LIST',
          route: `/workspace/custom-${suffix.toLowerCase()}`,
          description: '包含 ASCII 线框图与语义化控件绑定的 UI 视图',
          roleRefs: firstRole ? [firstRole] : [],
          layout: [
            '+--------------------------------------------------+',
            `| [${kwId}]                        [${btnId}]      |`,
            `| @${tblId}                                        |`,
            '+--------------------------------------------------+',
          ].join('\n'),
          elements: [
            {
              elementId: kwId,
              name: 'keywordInput',
              label: '检索关键词',
              elementType: 'INPUT',
              io: 'IN',
              required: false,
            },
            {
              elementId: btnId,
              name: 'refreshBtn',
              label: '查询刷新',
              elementType: 'BUTTON',
              io: 'ACTION',
              actionType: 'QUERY',
              required: false,
            },
            {
              elementId: tblId,
              name: 'mainDataTable',
              label: '业务数据列表',
              elementType: 'TABLE',
              io: 'OUT',
              required: false,
            },
          ],
          events: [
            {
              eventId: evId,
              name: '触发列表刷新',
              triggerElementId: btnId,
              triggerAction: 'CLICK',
              permissions: [],
              callChain: [
                {
                  stepOrder: 1,
                  stepType: 'NAVIGATE',
                  refId: createdId,
                  description: '刷新当前屏幕数据视图',
                },
              ],
            },
          ],
        });
        note = `Added MU screen ${createdId}`;
        break;
      }

      case 'MM': {
        if (!next.MM) {
          next.MM = {
            model_type: 'MAPPING',
            version: '1.0',
            domain: domainCode,
            mappings: [],
          };
        }
        createdId = nextUniqueId(
          'MAP-',
          next.MM.mappings.map((m) => m.id),
        );
        const suffix = createdId.replace('MAP-', '');
        const agg = next.M1?.aggregates[0];
        const objName = agg?.name ?? 'Contract';
        const firstAttr = agg?.attributes[0];

        next.MM.mappings.push({
          id: createdId,
          objectRef: agg?.id ?? objName,
          objectRole: 'AGGREGATE_ROOT',
          objectName: objName,
          mappingNote: '领域聚合根至 SQLite 关系表主表映射',
          tableMappings: [
            {
              tableName: `t_${objName.toLowerCase()}_${suffix.toLowerCase()}`,
              tableRole: 'MASTER',
              primaryKey: 'id',
              foreignKeys: [],
              columnMappings: [
                {
                  attributeRef: 'id',
                  column: 'id',
                  columnType: 'VARCHAR(64)',
                  isPrimaryKey: true,
                  nullable: false,
                },
                ...(firstAttr
                  ? [
                      {
                        attributeRef: firstAttr.name,
                        column: firstAttr.name
                          .replace(/([A-Z])/g, '_$1')
                          .toLowerCase(),
                        columnType: 'VARCHAR(128)',
                        nullable: !firstAttr.required,
                      },
                    ]
                  : []),
                {
                  attributeRef: 'updatedAt',
                  column: 'updated_at',
                  columnType: 'TIMESTAMP',
                  nullable: true,
                },
              ],
            },
          ],
        });
        note = `Added MM table mapping ${createdId}`;
        break;
      }

      case 'MI': {
        if (!next.MI) {
          next.MI = {
            model_type: 'INTERFACE',
            version: '1.0',
            domain: domainCode,
            interfaces: [],
          };
        }
        createdId = nextUniqueId(
          'IF-',
          next.MI.interfaces.map((i) => i.interfaceId),
        );
        const suffix = createdId.replace('IF-', '');
        const beh = next.M2?.behaviors[0];
        const agg = next.M1?.aggregates[0];

        next.MI.interfaces.push({
          interfaceId: createdId,
          name: `对外领域服务契约${suffix}`,
          direction: 'PROVIDED',
          interfaceCategory: beh?.behaviorType === 'QUERY' ? 'QUERY' : 'COMMAND',
          protocol: 'REST',
          format: 'JSON',
          authMethod: 'BEARER_TOKEN',
          idempotency: 'IDEMPOTENT',
          businessPurpose: '通过结构化工作台暴露的标准化服务接口',
          ...(beh ? { relatedBehaviorRef: beh.id } : {}),
          ...(agg ? { relatedEntityRef: agg.name } : {}),
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
              name: 'code',
              label: '响应状态码',
              type: 'String',
              required: true,
            },
            {
              name: 'message',
              label: '处理结果说明',
              type: 'String',
              required: false,
            },
          ],
          returnRules: [
            {
              code: 'SUCCESS',
              scenario: '业务处理成功',
              httpStatus: 200,
              message: 'OK',
            },
          ],
        });
        note = `Added MI interface ${createdId}`;
        break;
      }
    }

    await saveSuiteWithUndo(next, note);
    setSelectedModel(selectedModel, createdId);
    if (activeTab !== 'STRUCTURED') {
      setActiveTab('STRUCTURED');
    }
    showToast(`已在 ${selectedModel} 新增元素 ${createdId}`);
  };

  const handleOpenImpactModal = async (symbol = 'Contract') => {
    setPendingDeleteAction(null);
    setTargetSymbol(symbol);
    setNewSymbolName(`${symbol}V2`);
    setRenameModalOpen(true);
    const report = await apiAnalyzeImpact(project.id, symbol);
    setImpactReport(report);
  };

  const handleSafeDeleteElement = async (opts: {
    elementId: string;
    symbol?: string;
    label: string;
    mutate: (draft: OntologySuite) => void;
  }) => {
    const repById = analyzeImpact(suite, opts.elementId);
    const repBySym =
      opts.symbol && opts.symbol !== opts.elementId
        ? analyzeImpact(suite, opts.symbol)
        : null;

    const mergedRefs = [...repById.references];
    if (repBySym) {
      const seen = new Set(
        mergedRefs.map((r) => `${r.model}:${r.elementId}:${r.fieldPath}`),
      );
      for (const r of repBySym.references) {
        const key = `${r.model}:${r.elementId}:${r.fieldPath}`;
        if (!seen.has(key)) {
          seen.add(key);
          mergedRefs.push(r);
        }
      }
    }

    const doDelete = async () => {
      const next: OntologySuite = JSON.parse(JSON.stringify(suite));
      opts.mutate(next);
      await saveSuiteWithUndo(next, `Deleted ${selectedModel} element ${opts.elementId}`);
      if (selectedElementId === opts.elementId) {
        setSelectedModel(selectedModel, null);
      }
      setPendingDeleteAction(null);
      setRenameModalOpen(false);
      showToast(`已删除 ${opts.elementId}（支持一键撤销恢复）`);
    };

    if (mergedRefs.length > 0) {
      const sym = opts.symbol || opts.elementId;
      setTargetSymbol(sym);
      setNewSymbolName(`${sym}V2`);
      setImpactReport({
        targetId: sym,
        targetModel: selectedModel,
        targetName: opts.label,
        canDeleteSafely: false,
        references: mergedRefs,
      });
      setPendingDeleteAction({
        elementId: opts.elementId,
        label: opts.label,
        execute: doDelete,
      });
      setRenameModalOpen(true);
      return;
    }

    await doDelete();
  };

  const handleExecuteCascadeRename = async () => {
    if (!targetSymbol.trim() || !newSymbolName.trim()) return;
    pushUndoSnapshot(suite);
    const result = await apiRenameSymbol(project.id, targetSymbol.trim(), newSymbolName.trim());
    patchData({ activeProject: result.project });
    setPendingDeleteAction(null);
    setRenameModalOpen(false);
    showToast(
      `已完成级联重命名 ${targetSymbol} -> ${newSymbolName}（自动同步 ${result.changedCount} 处跨模型引用）`,
    );
  };

  const searchKeyword = treeSearch.trim().toLowerCase();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - var(--topbar-h, 48px))' }}>
      <div className="ontology-workbench">
        {/* ─── Left Pane: Hierarchical 11-Model Progressive Navigator + Searchable Tree ─── */}
        <div className="workbench-left">
          <div className="owb-pane-head">
            <div className="owb-pane-title-row">
              <span className="owb-pane-title">{t('11 元模型渐进导航', '11-Model Stages')}</span>
              <span className="badge badge-accent">{validation.presentModels.length}/11</span>
            </div>

            <div className="owb-search">
              <span className="owb-search-icon" aria-hidden="true">
                ⌕
              </span>
              <input
                className="input"
                style={{ paddingRight: treeSearch ? 28 : 10 }}
                placeholder={t(
                  '搜索 M1~MI 元素 ID / 名称...',
                  'Filter M1–MI elements...',
                )}
                value={treeSearch}
                onChange={(e) => setTreeSearch(e.target.value)}
              />
              {treeSearch && (
                <button
                  type="button"
                  className="owb-search-clear"
                  onClick={() => setTreeSearch('')}
                  title={t('清空过滤', 'Clear')}
                  aria-label={t('清空过滤', 'Clear')}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div className="owb-nav-list">
            {MODEL_STAGE_ORDER.map((item) => {
              const isSelected = selectedModel === item.code;
              const isPresent = Boolean(suite[item.code]);
              const modelErrors = validation.diagnostics.filter(
                (d) => d.model === item.code && d.tier === 'ERROR',
              ).length;
              const cnt = getModelElementCount(item.code);
              const allChildren = getModelTreeElements(suite, item.code);
              const filteredChildren = searchKeyword
                ? allChildren.filter(
                    (el) =>
                      el.id.toLowerCase().includes(searchKeyword) ||
                      el.label.toLowerCase().includes(searchKeyword) ||
                      (el.subLabel ?? '').toLowerCase().includes(searchKeyword),
                  )
                : allChildren;
              const showChildren =
                (isSelected && filteredChildren.length > 0) ||
                (Boolean(searchKeyword) && filteredChildren.length > 0);

              return (
                <div key={item.code} className="owb-nav-group">
                  <button
                    type="button"
                    data-testid={`model-nav-${item.code}`}
                    className={`nav-item ${isSelected ? 'active' : ''}`}
                    onClick={() => setSelectedModel(item.code, null)}
                    aria-current={isSelected ? 'true' : undefined}
                  >
                    <span className="nav-item-left" style={{ minWidth: 0 }}>
                      <span className="owb-nav-code">{item.code}</span>
                      <span className="owb-nav-label">
                        {t(item.labelZh.slice(3), item.labelEn.slice(3))}
                      </span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      {modelErrors > 0 ? (
                        <span className="badge badge-bad">{modelErrors}</span>
                      ) : isPresent ? (
                        <span className="badge badge-ok">{cnt}</span>
                      ) : (
                        <span className="badge badge-warn">{t('待建', 'Empty')}</span>
                      )}
                    </span>
                  </button>

                  {showChildren && (
                    <div className="owb-nav-children">
                      {filteredChildren.map((el) => {
                        const isElActive =
                          isSelected &&
                          (selectedElementId === el.id || selectedElementId === el.label);
                        return (
                          <div
                            key={`${item.code}-${el.id}`}
                            className={`tree-element-row ${isElActive ? 'selected' : ''}`}
                            onClick={() => {
                              setSelectedModel(item.code, el.id);
                            }}
                          >
                            <span className="owb-tree-text" title={`${el.id} ${el.label}`}>
                              <span className="owb-tree-id">{el.id}</span>
                              <span>{el.label}</span>
                            </span>
                            <Button
                              type="button"
                              variant="secondary" size="md" className="owb-impact-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenImpactModal(el.impactSymbol);
                              }}
                              title={t('扫描跨模型引用影响', 'Impact Analysis')}
                              aria-label={t('扫描跨模型引用影响', 'Impact Analysis')}
                            >
                              ⇄
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ─── Center Pane: 3-Tab Model Editor ─── */}
        <div className="workbench-center">
          <div className="owb-toolbar">
            <div className="owb-toolbar-row">
              <div className="owb-title-group">
                <span className="badge badge-accent">{selectedModel}</span>
                <strong className="owb-title">
                  {
                    MODEL_STAGE_ORDER.find((m) => m.code === selectedModel)?.[
                      t('labelZh', 'labelEn') as 'labelZh' | 'labelEn'
                    ]
                  }
                </strong>
                {selectedElementId && (
                  <button
                    type="button"
                    className="owb-selection-chip"
                    onClick={() => setSelectedModel(selectedModel, null)}
                    title={t('点击取消高亮筛选', 'Clear active selection')}
                  >
                    ⌖ {selectedElementId}
                    <span className="owb-selection-chip-x" aria-hidden="true">
                      ✕
                    </span>
                  </button>
                )}
              </div>

              <div
                className="owb-segmented"
                role="tablist"
                aria-label={t('视图切换', 'View switcher')}
              >
                {(
                  [
                    ['STRUCTURED', t('结构化视图', 'Structured')],
                    ['GRAPH', t('模型关系图', 'Graph')],
                    ['YAML', t('YAML 元文件', 'YAML Source')],
                  ] as const
                ).map(([tab, label]) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    className="owb-segment"
                    aria-selected={activeTab === tab}
                    onClick={() => setActiveTab(tab)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="owb-toolbar-row">
              <div className="owb-btn-group" role="group" aria-label={t('历史', 'History')}>
                <Button
                  type="button"
                  variant="secondary" size="sm"
                  data-testid="undo-btn"
                  disabled={undoStack.length === 0}
                  onClick={() => undo()}
                  title="Undo"
                >
                  ↶ {t('撤销', 'Undo')}
                </Button>
                <Button
                  type="button"
                  variant="secondary" size="sm"
                  data-testid="redo-btn"
                  disabled={redoStack.length === 0}
                  onClick={() => redo()}
                  title="Redo"
                >
                  ↷ {t('重做', 'Redo')}
                </Button>
              </div>

              <div className="owb-actions">
                <Button
                  type="button"
                  variant="secondary" size="sm"
                  data-testid="open-cascade-rename-btn"
                  onClick={() => handleOpenImpactModal('Contract')}
                >
                  ⇄ {t('级联重命名 / 影响分析', 'Cascade Rename')}
                </Button>
                <Button
                  type="button"
                  variant="accent" size="sm"
                  data-testid="add-model-item-btn"
                  onClick={handleQuickAddItem}
                >
                  + {t('新增模型项', 'Add Item')}
                </Button>
              </div>
            </div>
          </div>

          <div className="owb-center-body">
            {activeTab === 'GRAPH' && (
              <KnowledgeGraphCanvas
                graph={project.knowledgeGraph}
                preset="WORKBENCH_EGO"
                focusElementId={selectedElementId}
                height={470}
                onSelectElement={(m, id) => {
                  setSelectedModel(m, id);
                }}
                onNavigateToElement={(m, id) => {
                  setSelectedModel(m, id);
                  setActiveTab('STRUCTURED');
                }}
              />
            )}

            {activeTab === 'YAML' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
                    .onto-cs/model/{project.id}/yaml/{MODEL_FILE_NAMES[selectedModel]}
                  </span>
                  <Button
                    type="button"
                    variant="accent" size="sm"
                    onClick={handleSaveYaml}
                  >
                    {t('保存并校验 YAML', 'Save & Validate YAML')}
                  </Button>
                </div>
                <textarea
                  className="textarea mono"
                  style={{ flex: 1, minHeight: 440 }}
                  value={yamlText}
                  onChange={(e) => setYamlText(e.target.value)}
                />
              </div>
            )}

            {activeTab === 'STRUCTURED' && (
              <StructuredModelInspector
                modelCode={selectedModel}
                suite={suite}
                selectedElementId={selectedElementId}
                onInspectImpact={handleOpenImpactModal}
                onRequestDelete={handleSafeDeleteElement}
                onSaveSuite={async (nextSuite, note) => {
                  await saveSuiteWithUndo(nextSuite, note);
                  showToast(
                    t(
                      `${selectedModel} 结构化 AST 修改已保存并通过一致性校验`,
                      `${selectedModel} structured AST saved & validated`,
                    ),
                  );
                }}
                onQuickAdd={handleQuickAddItem}
              />
            )}
          </div>
        </div>

        {/* ─── Right Pane: Unified Live Streaming AI Ontology Copilot ─── */}
        <div className="workbench-right">
          <AgentSessionWorkbench
            agentKind="COPILOT"
            activeModelCode={selectedModel}
            compactRailByDefault
            height="100%"
            inputTestId="copilot-input"
            sendBtnTestId="copilot-send-btn"
            onJumpToOntology={(m, id) => {
              setSelectedModel(m, id ?? null);
              setActiveTab('STRUCTURED');
            }}
            className="rounded-none border-0 shadow-none"
          />
        </div>
      </div>

      {/* ─── Bottom Two-Tier Validation Status Bar ─── */}
      <div className="workbench-statusbar">
        <div className="owb-status-left">
          <span
            className={`badge ${validation.errorCount === 0 ? 'badge-ok' : 'badge-bad'}`}
            data-testid="validation-error-badge"
          >
            {validation.errorCount === 0
              ? t('✓ 一致性校验通过 (0 Errors)', '✓ Consistency Gate Passed (0 Errors)')
              : `${validation.errorCount} Consistency Errors`}
          </span>
          <span className="badge badge-warn" data-testid="validation-warning-badge">
            {validation.warningCount} {t('阶段提示 (Stage Warnings)', 'Stage Warnings')}
          </span>
          <span className="owb-status-sep" aria-hidden="true" />
          <span className="owb-status-models" title={validation.presentModels.join(' · ')}>
            <b>{t('已就绪模型', 'Models Ready')}</b>
            {validation.presentModels.join(' · ')}
          </span>
        </div>

        <Button
          type="button"
          variant="secondary" size="sm"
          data-testid="toggle-diagnostics-btn"
          aria-expanded={showDiagnosticsDrawer}
          onClick={() => setShowDiagnosticsDrawer((v) => !v)}
        >
          {showDiagnosticsDrawer
            ? t('收起校验详情', 'Hide Diagnostics')
            : t(
                `查看校验明细 (${validation.diagnostics.length})`,
                `Diagnostics (${validation.diagnostics.length})`,
              )}
        </Button>
      </div>

      {showDiagnosticsDrawer && (
        <div
          style={{
            position: 'fixed',
            bottom: 34,
            left: 224,
            right: 0,
            maxHeight: 230,
            overflowY: 'auto',
            background: 'var(--surface)',
            borderTop: '1px solid var(--line)',
            padding: 12,
            zIndex: 900,
            boxShadow: '0 -6px 20px rgba(0, 0, 0, 0.12)',
          }}
        >
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('级别', 'Tier')}</th>
                <th>{t('模型', 'Model')}</th>
                <th>{t('定位元素', 'Element')}</th>
                <th>{t('编码', 'Code')}</th>
                <th>{t('诊断说明 (点击直接跳转修复)', 'Message (Click to jump)')}</th>
              </tr>
            </thead>
            <tbody>
              {validation.diagnostics.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--ok)' }}>
                    {t(
                      '全套 11 个模型全部就绪且无任何跨模型引用错误。',
                      'All 11 models are authored with zero cross-model consistency errors.',
                    )}
                  </td>
                </tr>
              ) : (
                validation.diagnostics.map((d) => (
                  <tr
                    key={d.id}
                    className="diag-row-clickable"
                    onClick={() => {
                      setSelectedModel(d.model, d.elementId ?? null);
                      setActiveTab('STRUCTURED');
                    }}
                  >
                    <td>
                      <span
                        className={`badge ${d.tier === 'ERROR' ? 'badge-bad' : 'badge-warn'}`}
                      >
                        {d.tier}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{d.model}</td>
                    <td style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>
                      {d.elementId ?? '-'}
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>{d.code}</td>
                    <td>{t(d.messageZh, d.messageEn)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Non-Blocking Cascade Rename, Impact Analysis & Referenced Delete Modal ─── */}
      {renameModalOpen && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setPendingDeleteAction(null);
            setRenameModalOpen(false);
          }}
        >
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="card-header">
              <h3 className="card-title">
                {pendingDeleteAction
                  ? t(
                      `删除前跨模型引用影响检查: ${pendingDeleteAction.elementId}`,
                      `Cross-Model Reference Guard Before Deleting ${pendingDeleteAction.elementId}`,
                    )
                  : t(
                      '跨模型影响分析与级联重命名 (M1~MI)',
                      'Cross-Model Impact Analysis & Cascade Rename',
                    )}
              </h3>
              <Button
                type="button"
                variant="secondary" size="sm"
                onClick={() => {
                  setPendingDeleteAction(null);
                  setRenameModalOpen(false);
                }}
              >
                ✕
              </Button>
            </div>

            {pendingDeleteAction && (
              <div
                style={{
                  marginBottom: 12,
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: 'var(--warn-soft)',
                  color: 'var(--warn)',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                {t(
                  `检测到「${pendingDeleteAction.label} (${pendingDeleteAction.elementId})」仍被其他元模型引用。建议先解除引用或执行级联重命名；如确认移除，可点击底部「强制删除此元素」。`,
                  `"${pendingDeleteAction.label} (${pendingDeleteAction.elementId})" is still referenced across models. Review impacts below before forcing deletion.`,
                )}
              </div>
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr auto',
                gap: 8,
                marginBottom: 12,
                alignItems: 'end',
              }}
            >
              <div>
                <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  {t('原本体符号 / ID', 'Original Symbol / ID')}
                </label>
                <input
                  className="input"
                  value={targetSymbol}
                  onChange={(e) => setTargetSymbol(e.target.value)}
                />
              </div>
              <div>
                <label style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  {t('新本体符号 / ID', 'New Symbol / ID')}
                </label>
                <input
                  className="input"
                  data-testid="cascade-rename-new-input"
                  value={newSymbolName}
                  onChange={(e) => setNewSymbolName(e.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="secondary" size="md"
                onClick={async () => {
                  const rep = await apiAnalyzeImpact(project.id, targetSymbol);
                  setImpactReport(rep);
                }}
              >
                {t('重新扫描引用', 'Scan Impact')}
              </Button>
            </div>

            {impactReport && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ marginBottom: 8, fontSize: 12 }}>
                  {t('扫描到跨模型引用数', 'Cross-Model References Found')}:{' '}
                  <strong style={{ fontFamily: 'var(--mono)' }}>
                    {impactReport.references.length}
                  </strong>{' '}
                  ({t('直接删除安全性', 'Safe to delete directly')}:{' '}
                  <span
                    className={`badge ${impactReport.canDeleteSafely ? 'badge-ok' : 'badge-warn'}`}
                  >
                    {impactReport.canDeleteSafely ? 'SAFE' : 'REFERENCED'}
                  </span>
                  )
                </div>
                <div
                  style={{
                    maxHeight: 220,
                    overflowY: 'auto',
                    border: '1px solid var(--line)',
                    borderRadius: 5,
                  }}
                >
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t('模型', 'Model')}</th>
                        <th>{t('引用元素', 'Element')}</th>
                        <th>{t('路径说明', 'Description')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {impactReport.references.map((ref, idx) => (
                        <tr
                          key={`${ref.model}-${ref.elementId}-${idx}`}
                          className="diag-row-clickable"
                          onClick={() => {
                            setSelectedModel(ref.model, ref.elementId);
                            setActiveTab('STRUCTURED');
                            setPendingDeleteAction(null);
                            setRenameModalOpen(false);
                          }}
                        >
                          <td>
                            <span className="badge badge-accent">{ref.model}</span>
                          </td>
                          <td style={{ fontFamily: 'var(--mono)' }}>{ref.elementId}</td>
                          <td>{t(ref.descriptionZh, ref.descriptionEn)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button
                type="button"
                variant="secondary" size="md"
                onClick={() => {
                  setPendingDeleteAction(null);
                  setRenameModalOpen(false);
                }}
              >
                {t('取消', 'Cancel')}
              </Button>
              {pendingDeleteAction && (
                <Button
                  type="button"
                  variant="secondary" size="md"
                  style={{ color: 'var(--bad)', borderColor: 'var(--bad)' }}
                  onClick={() => pendingDeleteAction.execute()}
                >
                  {t('强制删除此元素', 'Force Delete Element')}
                </Button>
              )}
              <Button
                type="button"
                variant="accent" size="md"
                data-testid="confirm-cascade-rename-btn"
                onClick={handleExecuteCascadeRename}
              >
                {t('执行 11 模型原子级联重命名', 'Execute Atomic Cascade Rename')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Interactive Editable Structured Inspector across ALL 11 Models (M1–MI) ───

const M1_ATTRIBUTE_TYPES: Attribute['type'][] = [
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
];

function StructuredModelInspector({
  modelCode,
  suite,
  selectedElementId,
  onInspectImpact,
  onRequestDelete,
  onSaveSuite,
  onQuickAdd,
}: {
  modelCode: ModelCode;
  suite: OntologySuite;
  selectedElementId: string | null;
  onInspectImpact: (symbol: string) => void;
  onRequestDelete: (opts: {
    elementId: string;
    symbol?: string;
    label: string;
    mutate: (draft: OntologySuite) => void;
  }) => Promise<void>;
  onSaveSuite: (nextSuite: OntologySuite, note: string) => Promise<void>;
  onQuickAdd: () => Promise<void>;
}) {
  const { t } = usePreferences();
  const [draft, setDraft] = useState<OntologySuite>(() =>
    JSON.parse(JSON.stringify(suite)),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(JSON.parse(JSON.stringify(suite)));
    setDirty(false);
  }, [suite, modelCode]);

  useEffect(() => {
    if (!selectedElementId) return;
    const el = document.getElementById(`onto-card-${selectedElementId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedElementId, modelCode]);

  const mutateDraft = (fn: (next: OntologySuite) => void) => {
    setDraft((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as OntologySuite;
      fn(next);
      return next;
    });
    setDirty(true);
  };

  const handleSaveAst = async () => {
    setSaving(true);
    try {
      await onSaveSuite(draft, `Saved structured edits on ${modelCode}`);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const allAggNames = useMemo(
    () => (draft.M1?.aggregates ?? []).map((a) => a.name),
    [draft.M1],
  );
  const allRuleIds = useMemo(
    () => (draft.M3?.rules ?? []).map((r) => r.id),
    [draft.M3],
  );

  const cardHighlightStyle = (ids: (string | undefined)[]): React.CSSProperties => {
    const active = Boolean(selectedElementId && ids.includes(selectedElementId));
    return active
      ? {
          borderColor: 'var(--accent)',
          boxShadow: '0 0 0 2px var(--accent-soft)',
        }
      : {};
  };

  const renderEmptyModelBanner = (code: ModelCode) => (
    <div className="card" style={{ textAlign: 'center', padding: 28 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>
        {t(`${code} 元模型尚未初始化`, `${code} model is not yet authored`)}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
        {t(
          '点击下方按钮直接生成符合两级一致性校验规范的首个结构化元素。',
          'Click below to scaffold the first validated structured AST element.',
        )}
      </div>
      <Button type="button" variant="accent" size="md" onClick={onQuickAdd}>
        + {t(`创建首个 ${code} 模型项`, `Create First ${code} Item`)}
      </Button>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Sticky Structured AST Save Bar */}
      <div className="owb-savebar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span className={`badge ${dirty ? 'badge-warn' : 'badge-ok'}`}>
            {dirty
              ? t('● 待保存 AST 变更', '● Unsaved AST Edits')
              : t('✓ AST 已同步', '✓ AST Synced')}
          </span>
          <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 11 }}>
            {MODEL_FILE_NAMES[modelCode]}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {dirty && (
            <Button
              type="button"
              variant="secondary" size="sm"
              onClick={() => {
                setDraft(JSON.parse(JSON.stringify(suite)));
                setDirty(false);
              }}
            >
              {t('放弃更改', 'Reset')}
            </Button>
          )}
          <Button
            type="button"
            variant="accent" size="sm"
            data-testid="structured-save-btn"
            disabled={saving}
            onClick={handleSaveAst}
          >
            {saving
              ? t('校验保存中...', 'Saving...')
              : t('保存修改 (Save AST)', 'Save AST')}
          </Button>
        </div>
      </div>

      {/* ─── M1: Object Model ─── */}
      {modelCode === 'M1' &&
        (!draft.M1 ? (
          renderEmptyModelBanner('M1')
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {draft.M1.aggregates.map((agg, aggIdx) => (
              <div
                key={agg.id}
                id={`onto-card-${agg.id}`}
                className="card"
                style={cardHighlightStyle([agg.id, agg.name])}
              >
                <div className="card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="badge badge-accent">{agg.id}</span>
                    <strong className="owb-agg-title">
                      {agg.name}
                      <span className="owb-agg-alias">{agg.alias}</span>
                    </strong>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button
                      type="button"
                      variant="secondary" size="sm"
                      onClick={() => onInspectImpact(agg.name)}
                    >
                      {t('分析引用影响', 'Impact')}
                    </Button>
                    <Button
                      type="button"
                      variant="danger" size="sm"
                      onClick={() =>
                        onRequestDelete({
                          elementId: agg.id,
                          symbol: agg.name,
                          label: `${agg.name} (${agg.alias})`,
                          mutate: (nx) => {
                            if (nx.M1) {
                              nx.M1.aggregates = nx.M1.aggregates.filter((x) => x.id !== agg.id);
                            }
                          },
                        })
                      }
                    >
                      {t('删除', 'Delete')}
                    </Button>
                  </div>
                </div>

                <LifecycleFlow
                  states={agg.lifecycle}
                  label={t('生命周期状态机', 'Lifecycle')}
                />

                <div className="form-grid-2 owb-agg-grid" style={{ marginBottom: 10 }}>
                  <div className="form-field">
                    <label className="form-label">
                      {t('聚合根英文符号 (Name)', 'Aggregate Name')}
                    </label>
                    <input
                      className="input"
                      value={agg.name}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.M1?.aggregates[aggIdx]) {
                            nx.M1.aggregates[aggIdx].name = e.target.value;
                          }
                        })
                      }
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">{t('业务中文别名 (Alias)', 'Alias')}</label>
                    <input
                      className="input"
                      value={agg.alias}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.M1?.aggregates[aggIdx]) {
                            nx.M1.aggregates[aggIdx].alias = e.target.value;
                          }
                        })
                      }
                    />
                  </div>
                  <div className="form-field owb-span-all">
                    <label className="form-label">
                      {t('生命周期状态机 (逗号分隔)', 'Lifecycle States (CSV)')}
                    </label>
                    <input
                      className="input"
                      style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
                      value={agg.lifecycle.join(', ')}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.M1?.aggregates[aggIdx]) {
                            nx.M1.aggregates[aggIdx].lifecycle = splitCsv(e.target.value);
                          }
                        })
                      }
                    />
                  </div>
                </div>

                <div className="form-field" style={{ marginBottom: 12 }}>
                  <label className="form-label">{t('领域职责描述', 'Description')}</label>
                  <AutoGrowTextarea
                    className="textarea"
                    minRows={1}
                    value={agg.description ?? ''}
                    placeholder={t('描述该聚合根的领域职责...', 'Describe the domain responsibility...')}
                    onChange={(e) =>
                      mutateDraft((nx) => {
                        if (nx.M1?.aggregates[aggIdx]) {
                          nx.M1.aggregates[aggIdx].description = e.target.value;
                        }
                      })
                    }
                  />
                </div>

                <div className="owb-section-head">
                  <span className="owb-section-title">
                    {t('聚合根属性定义', 'Attributes')}
                    <span className="owb-count">{agg.attributes.length}</span>
                  </span>
                  <Button
                    type="button"
                    variant="secondary" size="sm"
                    onClick={() =>
                      mutateDraft((nx) => {
                        const target = nx.M1?.aggregates[aggIdx];
                        if (!target) return;
                        const n = target.attributes.length + 1;
                        target.attributes.push({
                          name: `customField${n}`,
                          label: `扩展属性${n}`,
                          type: 'String',
                          required: false,
                        });
                      })
                    }
                  >
                    + {t('新增属性', 'Add Attribute')}
                  </Button>
                </div>

                <div className="owb-attr-table-wrap">
                  <table className="owb-attr-table">
                    <colgroup>
                      <col className="c-name" />
                      <col className="c-label" />
                      <col className="c-type" />
                      <col className="c-req" />
                      <col className="c-del" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>{t('属性名', 'Attribute')}</th>
                        <th>{t('中文名', 'Label')}</th>
                        <th>{t('类型', 'Type')}</th>
                        <th className="is-center">{t('必填', 'Req')}</th>
                        <th aria-label={t('操作', 'Actions')} />
                      </tr>
                    </thead>
                    <tbody>
                      {agg.attributes.map((attr, attrIdx) => {
                        const ruleTags = [
                          ...(attr.targetAggregate
                            ? [{ kind: 'ref', text: `→ ${attr.targetAggregate}` }]
                            : []),
                          ...(attr.dictionaryRef
                            ? [
                                {
                                  kind: 'dict',
                                  text: `Dict:${attr.dictionaryRef.dictionaryId}.${attr.dictionaryRef.typeCode}`,
                                },
                              ]
                            : []),
                          ...(attr.refRules ?? []).map((r) => ({
                            kind: 'rule',
                            text: `${r.name}: ${r.expression}`,
                          })),
                        ];
                        return (
                          <React.Fragment key={`${agg.id}-attr-${attrIdx}`}>
                          <tr className={ruleTags.length > 0 ? 'has-rules' : undefined}>
                            <td>
                              <input
                                className="owb-cell-input is-mono"
                                aria-label={t('属性名', 'Attribute')}
                                title={attr.name}
                                value={attr.name}
                                onChange={(e) =>
                                  mutateDraft((nx) => {
                                    const a = nx.M1?.aggregates[aggIdx]?.attributes[attrIdx];
                                    if (a) a.name = e.target.value;
                                  })
                                }
                              />
                            </td>
                            <td>
                              <input
                                className="owb-cell-input"
                                aria-label={t('中文名', 'Label')}
                                title={attr.label}
                                value={attr.label}
                                onChange={(e) =>
                                  mutateDraft((nx) => {
                                    const a = nx.M1?.aggregates[aggIdx]?.attributes[attrIdx];
                                    if (a) a.label = e.target.value;
                                  })
                                }
                              />
                            </td>
                            <td>
                              <select
                                className="owb-cell-select"
                                aria-label={t('类型', 'Type')}
                                title={attr.type}
                                value={attr.type}
                                onChange={(e) =>
                                  mutateDraft((nx) => {
                                    const a = nx.M1?.aggregates[aggIdx]?.attributes[attrIdx];
                                    if (a) a.type = e.target.value as Attribute['type'];
                                  })
                                }
                              >
                                {M1_ATTRIBUTE_TYPES.map((tp) => (
                                  <option key={tp} value={tp}>
                                    {tp}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="is-center">
                              <input
                                type="checkbox"
                                className="owb-cell-check"
                                aria-label={t('必填', 'Required')}
                                checked={Boolean(attr.required)}
                                onChange={(e) =>
                                  mutateDraft((nx) => {
                                    const a = nx.M1?.aggregates[aggIdx]?.attributes[attrIdx];
                                    if (a) a.required = e.target.checked;
                                  })
                                }
                              />
                            </td>
                            <td className="is-center">
                              <button
                                type="button"
                                className="owb-row-del"
                                title={t('删除属性', 'Remove attribute')}
                                aria-label={t('删除属性', 'Remove attribute')}
                                onClick={() =>
                                  mutateDraft((nx) => {
                                    const target = nx.M1?.aggregates[aggIdx];
                                    if (target) {
                                      target.attributes.splice(attrIdx, 1);
                                    }
                                  })
                                }
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                          {ruleTags.length > 0 && (
                            <tr className="owb-rule-row">
                              <td colSpan={5}>
                                <div className="owb-rule-cell">
                                  <span className="owb-rule-label">
                                    ↳ {t('引用/约束规则', 'Ref & Rules')}
                                  </span>
                                  {ruleTags.map((tag, i) => (
                                    <span
                                      key={`${tag.kind}-${i}`}
                                      className={`owb-rule-tag ${
                                        tag.kind === 'ref'
                                          ? 'is-ref'
                                          : tag.kind === 'dict'
                                            ? 'is-dict'
                                            : ''
                                      }`}
                                    >
                                      {tag.text}
                                    </span>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {(agg.entities.length > 0 || agg.invariants.length > 0) && (
                  <div className="owb-tags">
                    {agg.entities.map((ent) => (
                      <span key={ent.name} className="badge">
                        SubEntity: {ent.name} ({ent.alias})
                      </span>
                    ))}
                    {agg.invariants.map((inv) => (
                      <span key={inv.name} className="badge badge-warn">
                        {inv.name}: {inv.expression}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}

      {/* ─── M2: Behavior Model ─── */}
      {modelCode === 'M2' &&
        (!draft.M2 ? (
          renderEmptyModelBanner('M2')
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {draft.M2.behaviors.map((b, bIdx) => (
              <div
                key={b.id}
                id={`onto-card-${b.id}`}
                className="card"
                style={cardHighlightStyle([b.id])}
              >
                <div className="card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="badge badge-accent">{b.id}</span>
                    <strong>
                      {b.alias} ({b.name})
                    </strong>
                    <span className="badge badge-ok">{b.behaviorType}</span>
                    <span className="badge">{b.triggerType}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button
                      type="button"
                      variant="secondary" size="sm"
                      onClick={() => onInspectImpact(b.id)}
                    >
                      {t('分析引用影响', 'Impact')}
                    </Button>
                    <Button
                      type="button"
                      variant="danger" size="sm"
                      onClick={() =>
                        onRequestDelete({
                          elementId: b.id,
                          label: `${b.alias} (${b.name})`,
                          mutate: (nx) => {
                            if (nx.M2) {
                              nx.M2.behaviors = nx.M2.behaviors.filter((x) => x.id !== b.id);
                            }
                          },
                        })
                      }
                    >
                      {t('删除', 'Delete')}
                    </Button>
                  </div>
                </div>

                <div className="form-grid-3" style={{ marginBottom: 10 }}>
                  <div className="form-field">
                    <label className="form-label">{t('行为方法名 (Name)', 'Method Name')}</label>
                    <input
                      className="input"
                      style={{ fontFamily: 'var(--mono)' }}
                      value={b.name}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.M2?.behaviors[bIdx]) nx.M2.behaviors[bIdx].name = e.target.value;
                        })
                      }
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">{t('行为中文名 (Alias)', 'Alias')}</label>
                    <input
                      className="input"
                      value={b.alias}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.M2?.behaviors[bIdx]) nx.M2.behaviors[bIdx].alias = e.target.value;
                        })
                      }
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">{t('归属对象 (M1 Owner)', 'Owner Entity')}</label>
                    <input
                      className="input"
                      list="m1-agg-datalist"
                      style={{ fontFamily: 'var(--mono)' }}
                      value={b.ownerEntity}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.M2?.behaviors[bIdx]) {
                            nx.M2.behaviors[bIdx].ownerEntity = e.target.value;
                          }
                        })
                      }
                    />
                  </div>
                </div>

                <div className="form-grid-3" style={{ marginBottom: 10 }}>
                  <div className="form-field">
                    <label className="form-label">{t('行为类型', 'Behavior Type')}</label>
                    <select
                      className="select"
                      value={b.behaviorType}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          const item = nx.M2?.behaviors[bIdx];
                          if (item) {
                            item.behaviorType = e.target.value as typeof item.behaviorType;
                          }
                        })
                      }
                    >
                      <option value="COMMAND">COMMAND</option>
                      <option value="QUERY">QUERY</option>
                      <option value="EVENT_HANDLER">EVENT_HANDLER</option>
                      <option value="EXTERNAL_CALL">EXTERNAL_CALL</option>
                    </select>
                  </div>
                  <div className="form-field">
                    <label className="form-label">{t('触发方式', 'Trigger Type')}</label>
                    <select
                      className="select"
                      value={b.triggerType}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          const item = nx.M2?.behaviors[bIdx];
                          if (item) {
                            item.triggerType = e.target.value as typeof item.triggerType;
                          }
                        })
                      }
                    >
                      <option value="USER_ACTION">USER_ACTION</option>
                      <option value="SYSTEM">SYSTEM</option>
                      <option value="EVENT">EVENT</option>
                      <option value="FLOW">FLOW</option>
                      <option value="SCHEDULE">SCHEDULE</option>
                      <option value="EXTERNAL">EXTERNAL</option>
                    </select>
                  </div>
                  <div className="form-field">
                    <label className="form-label">
                      {t('调用规则 (M3 Rule IDs)', 'Invoked M3 Rules')}
                    </label>
                    <input
                      className="input"
                      style={{ fontFamily: 'var(--mono)' }}
                      placeholder={allRuleIds.join(', ')}
                      value={b.invokedRules.join(', ')}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.M2?.behaviors[bIdx]) {
                            nx.M2.behaviors[bIdx].invokedRules = splitCsv(e.target.value);
                          }
                        })
                      }
                    />
                  </div>
                </div>

                {/* Parameters quick editor */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 4,
                  }}
                >
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)' }}>
                    {t('入参列表 (Input Parameters)', 'Input Parameters')} (
                    {b.inputParameters.length})
                  </span>
                  <Button
                    type="button"
                    variant="secondary" size="sm"
                    onClick={() =>
                      mutateDraft((nx) => {
                        const target = nx.M2?.behaviors[bIdx];
                        if (!target) return;
                        const pIdx = target.inputParameters.length + 1;
                        target.inputParameters.push({
                          name: `param${pIdx}`,
                          label: `参数${pIdx}`,
                          type: 'String',
                          required: false,
                        });
                      })
                    }
                  >
                    + {t('新增入参', 'Add Param')}
                  </Button>
                </div>

                {b.inputParameters.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {b.inputParameters.map((p, pIdx) => (
                      <div
                        key={`${b.id}-p-${pIdx}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '3px 6px',
                          borderRadius: 4,
                          background: 'var(--surface-2)',
                          border: '1px solid var(--line-2)',
                        }}
                      >
                        <input
                          className="input"
                          style={{ width: 95, height: 22, fontSize: 11, fontFamily: 'var(--mono)' }}
                          value={p.name}
                          onChange={(e) =>
                            mutateDraft((nx) => {
                              const param = nx.M2?.behaviors[bIdx]?.inputParameters[pIdx];
                              if (param) param.name = e.target.value;
                            })
                          }
                        />
                        <input
                          className="input"
                          style={{ width: 70, height: 22, fontSize: 11, fontFamily: 'var(--mono)' }}
                          value={p.type}
                          onChange={(e) =>
                            mutateDraft((nx) => {
                              const param = nx.M2?.behaviors[bIdx]?.inputParameters[pIdx];
                              if (param) param.type = e.target.value;
                            })
                          }
                        />
                        <Button
                          type="button"
                          variant="secondary" size="sm"
                          style={{ height: 20, padding: '0 4px' }}
                          onClick={() =>
                            mutateDraft((nx) => {
                              nx.M2?.behaviors[bIdx]?.inputParameters.splice(pIdx, 1);
                            })
                          }
                        >
                          ✕
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <datalist id="m1-agg-datalist">
              {allAggNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>
        ))}

      {/* ─── M3: Rule Model ─── */}
      {modelCode === 'M3' &&
        (!draft.M3 ? (
          renderEmptyModelBanner('M3')
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {draft.M3.rules.map((r, rIdx) => (
              <div
                key={r.id}
                id={`onto-card-${r.id}`}
                className="card"
                style={cardHighlightStyle([r.id])}
              >
                <div className="card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="badge badge-accent">{r.id}</span>
                    <strong>
                      {r.alias} ({r.name})
                    </strong>
                    <span className="badge badge-warn">{r.ruleType}</span>
                    <span className="badge">{r.scope}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button
                      type="button"
                      variant="secondary" size="sm"
                      onClick={() => onInspectImpact(r.id)}
                    >
                      {t('分析引用影响', 'Impact')}
                    </Button>
                    <Button
                      type="button"
                      variant="danger" size="sm"
                      onClick={() =>
                        onRequestDelete({
                          elementId: r.id,
                          label: `${r.alias} (${r.name})`,
                          mutate: (nx) => {
                            if (nx.M3) nx.M3.rules = nx.M3.rules.filter((x) => x.id !== r.id);
                          },
                        })
                      }
                    >
                      {t('删除', 'Delete')}
                    </Button>
                  </div>
                </div>

                <div className="form-grid-3" style={{ marginBottom: 10 }}>
                  <div className="form-field">
                    <label className="form-label">{t('规则符号 (Name)', 'Rule Name')}</label>
                    <input
                      className="input"
                      style={{ fontFamily: 'var(--mono)' }}
                      value={r.name}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.M3?.rules[rIdx]) nx.M3.rules[rIdx].name = e.target.value;
                        })
                      }
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">{t('规则中文名 (Alias)', 'Alias')}</label>
                    <input
                      className="input"
                      value={r.alias}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.M3?.rules[rIdx]) nx.M3.rules[rIdx].alias = e.target.value;
                        })
                      }
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">{t('规则类型', 'Rule Type')}</label>
                    <select
                      className="select"
                      value={r.ruleType}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          const item = nx.M3?.rules[rIdx];
                          if (item) item.ruleType = e.target.value as typeof item.ruleType;
                        })
                      }
                    >
                      <option value="VALIDATION">VALIDATION</option>
                      <option value="CALCULATION">CALCULATION</option>
                      <option value="DECISION_TABLE">DECISION_TABLE</option>
                      <option value="EVENT_RULE">EVENT_RULE</option>
                      <option value="POLICY">POLICY</option>
                      <option value="RISK_CONTROL">RISK_CONTROL</option>
                    </select>
                  </div>
                </div>

                <div className="form-grid-2" style={{ marginBottom: 10 }}>
                  <div className="form-field">
                    <label className="form-label">
                      {t('引用聚合对象 (M1 Objects)', 'Referenced M1 Objects')}
                    </label>
                    <input
                      className="input"
                      style={{ fontFamily: 'var(--mono)' }}
                      value={r.referencedObjects.join(', ')}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.M3?.rules[rIdx]) {
                            nx.M3.rules[rIdx].referencedObjects = splitCsv(e.target.value);
                          }
                        })
                      }
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">{t('违背拦截提示', 'Violation Message')}</label>
                    <input
                      className="input"
                      value={r.violationMessage ?? ''}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.M3?.rules[rIdx]) {
                            nx.M3.rules[rIdx].violationMessage = e.target.value;
                          }
                        })
                      }
                    />
                  </div>
                </div>

                <div className="form-field">
                  <label className="form-label">
                    {t('形式化规则表达式 (Expression)', 'Rule Expression')}
                  </label>
                  <textarea
                    className="textarea mono"
                    rows={2}
                    value={r.expression}
                    onChange={(e) =>
                      mutateDraft((nx) => {
                        if (nx.M3?.rules[rIdx]) nx.M3.rules[rIdx].expression = e.target.value;
                      })
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        ))}

      {/* ─── ME: Event Model ─── */}
      {modelCode === 'ME' &&
        (!draft.ME ? (
          renderEmptyModelBanner('ME')
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {draft.ME.events.map((ev, evIdx) => (
              <div
                key={ev.id}
                id={`onto-card-${ev.id}`}
                className="card"
                style={cardHighlightStyle([ev.id])}
              >
                <div className="card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="badge badge-accent">{ev.id}</span>
                    <strong style={{ fontFamily: 'var(--mono)' }}>{ev.name}</strong>
                    <span>({ev.label})</span>
                    <span className="badge badge-ok">{ev.orderingSemantic}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button
                      type="button"
                      variant="secondary" size="sm"
                      onClick={() => onInspectImpact(ev.id)}
                    >
                      {t('分析引用影响', 'Impact')}
                    </Button>
                    <Button
                      type="button"
                      variant="danger" size="sm"
                      onClick={() =>
                        onRequestDelete({
                          elementId: ev.id,
                          label: `${ev.name} (${ev.label})`,
                          mutate: (nx) => {
                            if (nx.ME) nx.ME.events = nx.ME.events.filter((x) => x.id !== ev.id);
                          },
                        })
                      }
                    >
                      {t('删除', 'Delete')}
                    </Button>
                  </div>
                </div>

                <div className="form-grid-3" style={{ marginBottom: 10 }}>
                  <div className="form-field">
                    <label className="form-label">
                      {t('事件名 (<Object>.<PastParticiple>)', 'Event Name')}
                    </label>
                    <input
                      className="input"
                      style={{ fontFamily: 'var(--mono)' }}
                      value={ev.name}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.ME?.events[evIdx]) nx.ME.events[evIdx].name = e.target.value;
                        })
                      }
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">{t('事件中文标签', 'Label')}</label>
                    <input
                      className="input"
                      value={ev.label}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.ME?.events[evIdx]) nx.ME.events[evIdx].label = e.target.value;
                        })
                      }
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">{t('投递序语义', 'Ordering Semantic')}</label>
                    <select
                      className="select"
                      value={ev.orderingSemantic}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          const item = nx.ME?.events[evIdx];
                          if (item) {
                            item.orderingSemantic = e.target.value as typeof item.orderingSemantic;
                          }
                        })
                      }
                    >
                      <option value="AT_LEAST_ONCE">AT_LEAST_ONCE</option>
                      <option value="EXACTLY_ONCE">EXACTLY_ONCE</option>
                      <option value="FIFO">FIFO</option>
                      <option value="BEST_EFFORT">BEST_EFFORT</option>
                    </select>
                  </div>
                </div>

                <div className="form-grid-2" style={{ marginBottom: 10 }}>
                  <div className="form-field">
                    <label className="form-label">{t('来源聚合根 (M1)', 'Source Aggregate')}</label>
                    <input
                      className="input"
                      style={{ fontFamily: 'var(--mono)' }}
                      value={ev.sourceAggregate}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.ME?.events[evIdx]) {
                            nx.ME.events[evIdx].sourceAggregate = e.target.value;
                          }
                        })
                      }
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">
                      {t('生产者行为 (M2 Behavior)', 'Producer Behavior Ref')}
                    </label>
                    <input
                      className="input"
                      style={{ fontFamily: 'var(--mono)' }}
                      value={ev.producerBehaviorRef}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.ME?.events[evIdx]) {
                            nx.ME.events[evIdx].producerBehaviorRef = e.target.value;
                          }
                        })
                      }
                    />
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 4,
                  }}
                >
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)' }}>
                    {t('事件载荷字段 (Payload)', 'Event Payload')} ({ev.payload.length})
                  </span>
                  <Button
                    type="button"
                    variant="secondary" size="sm"
                    onClick={() =>
                      mutateDraft((nx) => {
                        const item = nx.ME?.events[evIdx];
                        if (!item) return;
                        const k = item.payload.length + 1;
                        item.payload.push({
                          name: `field${k}`,
                          label: `载荷字段${k}`,
                          type: 'String',
                          required: true,
                        });
                      })
                    }
                  >
                    + {t('新增载荷字段', 'Add Payload Field')}
                  </Button>
                </div>

                {ev.payload.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {ev.payload.map((pf, pfIdx) => (
                      <div
                        key={`${ev.id}-pf-${pfIdx}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '3px 6px',
                          borderRadius: 4,
                          background: 'var(--surface-2)',
                          border: '1px solid var(--line-2)',
                        }}
                      >
                        <input
                          className="input"
                          style={{ width: 95, height: 22, fontSize: 11, fontFamily: 'var(--mono)' }}
                          value={pf.name}
                          onChange={(e) =>
                            mutateDraft((nx) => {
                              const f = nx.ME?.events[evIdx]?.payload[pfIdx];
                              if (f) f.name = e.target.value;
                            })
                          }
                        />
                        <input
                          className="input"
                          style={{ width: 70, height: 22, fontSize: 11, fontFamily: 'var(--mono)' }}
                          value={pf.type}
                          onChange={(e) =>
                            mutateDraft((nx) => {
                              const f = nx.ME?.events[evIdx]?.payload[pfIdx];
                              if (f) f.type = e.target.value;
                            })
                          }
                        />
                        <Button
                          type="button"
                          variant="secondary" size="sm"
                          style={{ height: 20, padding: '0 4px' }}
                          onClick={() =>
                            mutateDraft((nx) => {
                              nx.ME?.events[evIdx]?.payload.splice(pfIdx, 1);
                            })
                          }
                        >
                          ✕
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}

      {/* ─── M4: Scenario Model ─── */}
      {modelCode === 'M4' &&
        (!draft.M4 ? (
          renderEmptyModelBanner('M4')
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {draft.M4.event_scenarios.map((sc, scIdx) => (
              <div
                key={sc.id}
                id={`onto-card-${sc.id}`}
                className="card"
                style={cardHighlightStyle([sc.id])}
              >
                <div className="card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="badge badge-accent">{sc.id}</span>
                    <strong>{sc.name}</strong>
                    <span className="badge badge-ok">Trigger: {sc.triggerEventRef}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button
                      type="button"
                      variant="secondary" size="sm"
                      onClick={() => onInspectImpact(sc.id)}
                    >
                      {t('分析引用影响', 'Impact')}
                    </Button>
                    <Button
                      type="button"
                      variant="danger" size="sm"
                      onClick={() =>
                        onRequestDelete({
                          elementId: sc.id,
                          label: sc.name,
                          mutate: (nx) => {
                            if (nx.M4) {
                              nx.M4.event_scenarios = nx.M4.event_scenarios.filter(
                                (x) => x.id !== sc.id,
                              );
                            }
                          },
                        })
                      }
                    >
                      {t('删除', 'Delete')}
                    </Button>
                  </div>
                </div>

                <div className="form-grid-3" style={{ marginBottom: 10 }}>
                  <div className="form-field">
                    <label className="form-label">{t('场景名称', 'Scenario Name')}</label>
                    <input
                      className="input"
                      value={sc.name}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.M4?.event_scenarios[scIdx]) {
                            nx.M4.event_scenarios[scIdx].name = e.target.value;
                          }
                        })
                      }
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">
                      {t('触发事件 (ME Event ID)', 'Trigger Event Ref')}
                    </label>
                    <input
                      className="input"
                      style={{ fontFamily: 'var(--mono)' }}
                      value={sc.triggerEventRef}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.M4?.event_scenarios[scIdx]) {
                            nx.M4.event_scenarios[scIdx].triggerEventRef = e.target.value;
                          }
                        })
                      }
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">
                      {t('涉及聚合根 (>=2 个, 逗号分隔)', 'Involved Aggregates (>=2)')}
                    </label>
                    <input
                      className="input"
                      style={{ fontFamily: 'var(--mono)' }}
                      value={sc.involvedAggregates.join(', ')}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.M4?.event_scenarios[scIdx]) {
                            nx.M4.event_scenarios[scIdx].involvedAggregates = splitCsv(
                              e.target.value,
                            );
                          }
                        })
                      }
                    />
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 6,
                  }}
                >
                  <strong style={{ fontSize: 12 }}>
                    {t('跨聚合编排步骤 (Steps)', 'Scenario Steps')} ({sc.steps.length})
                  </strong>
                  <Button
                    type="button"
                    variant="secondary" size="sm"
                    onClick={() =>
                      mutateDraft((nx) => {
                        const target = nx.M4?.event_scenarios[scIdx];
                        if (!target) return;
                        target.steps.push({
                          stepOrder: target.steps.length + 1,
                          stepType: 'BEHAVIOR_CALL',
                          refId: nx.M2?.behaviors[0]?.id ?? 'BHV-01',
                          targetAggregate: target.involvedAggregates[0] ?? 'Contract',
                          description: '新增联动编排步骤',
                        });
                      })
                    }
                  >
                    + {t('新增步骤', 'Add Step')}
                  </Button>
                </div>

                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Step</th>
                      <th>Type</th>
                      <th>Ref ID</th>
                      <th>Aggregate</th>
                      <th>Description</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {sc.steps.map((st, stIdx) => (
                      <tr key={`${sc.id}-step-${stIdx}`}>
                        <td style={{ fontFamily: 'var(--mono)' }}>#{st.stepOrder}</td>
                        <td>
                          <select
                            className="select"
                            style={{ height: 26, fontSize: 11.5, fontFamily: 'var(--mono)' }}
                            value={st.stepType}
                            onChange={(e) =>
                              mutateDraft((nx) => {
                                const step = nx.M4?.event_scenarios[scIdx]?.steps[stIdx];
                                if (step) step.stepType = e.target.value as typeof step.stepType;
                              })
                            }
                          >
                            <option value="BEHAVIOR_CALL">BEHAVIOR_CALL</option>
                            <option value="RULE_EVALUATE">RULE_EVALUATE</option>
                            <option value="EVENT_EMIT">EVENT_EMIT</option>
                          </select>
                        </td>
                        <td>
                          <input
                            className="input"
                            style={{ height: 26, fontSize: 11.5, fontFamily: 'var(--mono)' }}
                            value={st.refId}
                            onChange={(e) =>
                              mutateDraft((nx) => {
                                const step = nx.M4?.event_scenarios[scIdx]?.steps[stIdx];
                                if (step) step.refId = e.target.value;
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="input"
                            style={{ height: 26, fontSize: 11.5, fontFamily: 'var(--mono)' }}
                            value={st.targetAggregate ?? ''}
                            onChange={(e) =>
                              mutateDraft((nx) => {
                                const step = nx.M4?.event_scenarios[scIdx]?.steps[stIdx];
                                if (step) step.targetAggregate = e.target.value;
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="input"
                            style={{ height: 26, fontSize: 11.5 }}
                            value={st.description ?? ''}
                            onChange={(e) =>
                              mutateDraft((nx) => {
                                const step = nx.M4?.event_scenarios[scIdx]?.steps[stIdx];
                                if (step) step.description = e.target.value;
                              })
                            }
                          />
                        </td>
                        <td>
                          <Button
                            type="button"
                            variant="secondary" size="sm"
                            onClick={() =>
                              mutateDraft((nx) => {
                                const target = nx.M4?.event_scenarios[scIdx];
                                if (!target) return;
                                target.steps.splice(stIdx, 1);
                                target.steps.forEach((s, i) => {
                                  s.stepOrder = i + 1;
                                });
                              })
                            }
                          >
                            ✕
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ))}

      {/* ─── M5: Actor, Role & Permission Model ─── */}
      {modelCode === 'M5' &&
        (!draft.M5 ? (
          renderEmptyModelBanner('M5')
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {draft.M5.roles.map((r, rIdx) => (
              <div
                key={r.id}
                id={`onto-card-${r.id}`}
                className="card"
                style={cardHighlightStyle([r.id])}
              >
                <div className="card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="badge badge-accent">{r.id}</span>
                    <strong>
                      {r.name} ({r.code})
                    </strong>
                    <span className="badge badge-ok">{r.dataScope}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button
                      type="button"
                      variant="secondary" size="sm"
                      onClick={() => onInspectImpact(r.id)}
                    >
                      {t('分析引用影响', 'Impact')}
                    </Button>
                    <Button
                      type="button"
                      variant="danger" size="sm"
                      onClick={() =>
                        onRequestDelete({
                          elementId: r.id,
                          label: r.name,
                          mutate: (nx) => {
                            if (nx.M5) nx.M5.roles = nx.M5.roles.filter((x) => x.id !== r.id);
                          },
                        })
                      }
                    >
                      {t('删除', 'Delete')}
                    </Button>
                  </div>
                </div>

                <div className="form-grid-3" style={{ marginBottom: 8 }}>
                  <div className="form-field">
                    <label className="form-label">{t('角色名称', 'Role Name')}</label>
                    <input
                      className="input"
                      value={r.name}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.M5?.roles[rIdx]) nx.M5.roles[rIdx].name = e.target.value;
                        })
                      }
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">{t('角色编码', 'Role Code')}</label>
                    <input
                      className="input"
                      style={{ fontFamily: 'var(--mono)' }}
                      value={r.code}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.M5?.roles[rIdx]) nx.M5.roles[rIdx].code = e.target.value;
                        })
                      }
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">{t('数据行级范围', 'Data Scope')}</label>
                    <select
                      className="select"
                      value={r.dataScope}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          const item = nx.M5?.roles[rIdx];
                          if (item) item.dataScope = e.target.value as typeof item.dataScope;
                        })
                      }
                    >
                      <option value="ALL">ALL</option>
                      <option value="DEPARTMENT">DEPARTMENT</option>
                      <option value="SELF">SELF</option>
                      <option value="CUSTOM">CUSTOM</option>
                    </select>
                  </div>
                </div>

                <div className="form-field">
                  <label className="form-label">
                    {t('绑定权限集 (Permission IDs)', 'Assigned Permissions')}
                  </label>
                  <input
                    className="input"
                    style={{ fontFamily: 'var(--mono)' }}
                    value={r.permissions.join(', ')}
                    onChange={(e) =>
                      mutateDraft((nx) => {
                        if (nx.M5?.roles[rIdx]) {
                          nx.M5.roles[rIdx].permissions = splitCsv(e.target.value);
                        }
                      })
                    }
                  />
                </div>
              </div>
            ))}

            {/* Permissions Matrix Card */}
            <div className="card">
              <div className="card-header">
                <h4 className="card-title">
                  {t('权限矩阵 (Permissions)', 'Permissions')} ({draft.M5.permissions.length})
                </h4>
                <Button
                  type="button"
                  variant="secondary" size="sm"
                  onClick={() =>
                    mutateDraft((nx) => {
                      if (!nx.M5) return;
                      const pid = nextUniqueId(
                        'PERM-',
                        nx.M5.permissions.map((p) => p.id),
                      );
                      nx.M5.permissions.push({
                        id: pid,
                        name: `扩展资源权限${pid}`,
                        code: pid.replace('-', '_'),
                        targetAggregate: nx.M1?.aggregates[0]?.name ?? 'Contract',
                        allowedBehaviors: nx.M2?.behaviors[0] ? [nx.M2.behaviors[0].id] : [],
                        uiControlledElements: [],
                      });
                    })
                  }
                >
                  + {t('新增权限项', 'Add Permission')}
                </Button>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>{t('权限名称', 'Name')}</th>
                    <th>{t('受控聚合根', 'Target Aggregate')}</th>
                    <th>{t('允许行为 (M2 CSV)', 'Allowed Behaviors')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {draft.M5.permissions.map((p, pIdx) => (
                    <tr key={p.id} id={`onto-card-${p.id}`}>
                      <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{p.id}</td>
                      <td>
                        <input
                          className="input"
                          style={{ height: 26, fontSize: 12 }}
                          value={p.name}
                          onChange={(e) =>
                            mutateDraft((nx) => {
                              if (nx.M5?.permissions[pIdx]) {
                                nx.M5.permissions[pIdx].name = e.target.value;
                              }
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          style={{ height: 26, fontSize: 12, fontFamily: 'var(--mono)' }}
                          value={p.targetAggregate}
                          onChange={(e) =>
                            mutateDraft((nx) => {
                              if (nx.M5?.permissions[pIdx]) {
                                nx.M5.permissions[pIdx].targetAggregate = e.target.value;
                              }
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          style={{ height: 26, fontSize: 12, fontFamily: 'var(--mono)' }}
                          value={p.allowedBehaviors.join(', ')}
                          onChange={(e) =>
                            mutateDraft((nx) => {
                              if (nx.M5?.permissions[pIdx]) {
                                nx.M5.permissions[pIdx].allowedBehaviors = splitCsv(
                                  e.target.value,
                                );
                              }
                            })
                          }
                        />
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <Button
                          type="button"
                          variant="secondary" size="sm"
                          onClick={() => onInspectImpact(p.id)}
                        >
                          ⇄
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

      {/* ─── M6: Flow Model ─── */}
      {modelCode === 'M6' &&
        (!draft.M6 ? (
          renderEmptyModelBanner('M6')
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {draft.M6.flows.map((fl, flIdx) => (
              <div
                key={fl.id}
                id={`onto-card-${fl.id}`}
                className="card"
                style={cardHighlightStyle([fl.id])}
              >
                <div className="card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="badge badge-accent">{fl.id}</span>
                    <strong>{fl.name}</strong>
                    <span className="badge badge-ok">{fl.flowType}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button
                      type="button"
                      variant="secondary" size="sm"
                      onClick={() => onInspectImpact(fl.id)}
                    >
                      {t('分析引用影响', 'Impact')}
                    </Button>
                    <Button
                      type="button"
                      variant="danger" size="sm"
                      onClick={() =>
                        onRequestDelete({
                          elementId: fl.id,
                          label: fl.name,
                          mutate: (nx) => {
                            if (nx.M6) nx.M6.flows = nx.M6.flows.filter((x) => x.id !== fl.id);
                          },
                        })
                      }
                    >
                      {t('删除', 'Delete')}
                    </Button>
                  </div>
                </div>

                {/* Visual Node Sequence Strip */}
                <div
                  style={{
                    padding: '8px 10px',
                    marginBottom: 10,
                    borderRadius: 5,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--line-2)',
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 6,
                  }}
                >
                  {fl.activities.map((a, idx) => (
                    <React.Fragment key={a.id}>
                      <span
                        className={`badge ${
                          a.activityType === 'START' || a.activityType === 'END'
                            ? 'badge-ok'
                            : a.activityType.includes('GATEWAY')
                              ? 'badge-warn'
                              : 'badge-accent'
                        }`}
                      >
                        {a.id}: {a.name} ({a.activityType})
                      </span>
                      {idx < fl.activities.length - 1 && (
                        <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                          →
                        </span>
                      )}
                    </React.Fragment>
                  ))}
                </div>

                <div className="form-grid-3" style={{ marginBottom: 10 }}>
                  <div className="form-field">
                    <label className="form-label">{t('流程名称', 'Flow Name')}</label>
                    <input
                      className="input"
                      value={fl.name}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.M6?.flows[flIdx]) nx.M6.flows[flIdx].name = e.target.value;
                        })
                      }
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">{t('流程分类', 'Flow Type')}</label>
                    <select
                      className="select"
                      value={fl.flowType}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          const item = nx.M6?.flows[flIdx];
                          if (item) item.flowType = e.target.value as typeof item.flowType;
                        })
                      }
                    >
                      <option value="COLLABORATION">COLLABORATION</option>
                      <option value="APPROVAL">APPROVAL</option>
                    </select>
                  </div>
                  <div className="form-field">
                    <label className="form-label">{t('主业务对象 (M1)', 'Primary Aggregate')}</label>
                    <input
                      className="input"
                      style={{ fontFamily: 'var(--mono)' }}
                      value={fl.primaryAggregate}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.M6?.flows[flIdx]) {
                            nx.M6.flows[flIdx].primaryAggregate = e.target.value;
                          }
                        })
                      }
                    />
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 6,
                  }}
                >
                  <strong style={{ fontSize: 12 }}>
                    {t('流程活动节点拓扑', 'Flow Activities')} ({fl.activities.length})
                  </strong>
                  <Button
                    type="button"
                    variant="secondary" size="sm"
                    onClick={() =>
                      mutateDraft((nx) => {
                        const target = nx.M6?.flows[flIdx];
                        if (!target) return;
                        const endAct = target.activities.find((a) => a.activityType === 'END');
                        if (!endAct) return;
                        const newActId = nextUniqueId(
                          'ACT-STEP-',
                          target.activities.map((a) => a.id),
                        );
                        // Rewire nodes pointing to endAct so new task sits cleanly before END
                        for (const act of target.activities) {
                          if (act.nextActivity === endAct.id) {
                            act.nextActivity = newActId;
                          }
                        }
                        const endIdx = target.activities.indexOf(endAct);
                        target.activities.splice(endIdx, 0, {
                          id: newActId,
                          name: `协同步骤${target.activities.length}`,
                          activityType: 'SYSTEM_TASK',
                          nextActivity: endAct.id,
                          branches: [],
                        });
                      })
                    }
                  >
                    + {t('在结束前插入节点', 'Insert Task Node')}
                  </Button>
                </div>

                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Activity ID</th>
                      <th>{t('节点名称', 'Name')}</th>
                      <th>{t('节点类型', 'Type')}</th>
                      <th>{t('绑定角色/行为', 'Bindings')}</th>
                      <th>{t('下一节点 / 分支', 'Next / Branches')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fl.activities.map((a, aIdx) => (
                      <tr key={a.id}>
                        <td style={{ fontFamily: 'var(--mono)' }}>{a.id}</td>
                        <td>
                          <input
                            className="input"
                            style={{ height: 26, fontSize: 12 }}
                            value={a.name}
                            onChange={(e) =>
                              mutateDraft((nx) => {
                                const act = nx.M6?.flows[flIdx]?.activities[aIdx];
                                if (act) act.name = e.target.value;
                              })
                            }
                          />
                        </td>
                        <td>
                          <span className="badge badge-accent">{a.activityType}</span>
                        </td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                          {[a.roleRef, a.behaviorRef, a.scenarioRef, a.screenRef]
                            .filter(Boolean)
                            .join(' · ') || '-'}
                        </td>
                        <td>
                          {a.branches.length > 0 ? (
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                              {a.branches
                                .map((b) => `${b.label || b.condition || 'default'} -> ${b.targetActivity}`)
                                .join(' | ')}
                            </span>
                          ) : (
                            <input
                              className="input"
                              style={{ height: 26, fontSize: 11.5, fontFamily: 'var(--mono)' }}
                              value={a.nextActivity ?? ''}
                              placeholder={a.activityType === 'END' ? '(END)' : 'Target Activity'}
                              disabled={a.activityType === 'END'}
                              onChange={(e) =>
                                mutateDraft((nx) => {
                                  const act = nx.M6?.flows[flIdx]?.activities[aIdx];
                                  if (act) act.nextActivity = e.target.value || undefined;
                                })
                              }
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ))}

      {/* ─── M7: Query & Report Model ─── */}
      {modelCode === 'M7' &&
        (!draft.M7 ? (
          renderEmptyModelBanner('M7')
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {draft.M7.query_reports.map((qr, qrIdx) => (
              <div
                key={qr.id}
                id={`onto-card-${qr.id}`}
                className="card"
                style={cardHighlightStyle([qr.id])}
              >
                <div className="card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="badge badge-accent">{qr.id}</span>
                    <strong>
                      {qr.alias} ({qr.name})
                    </strong>
                    <span className="badge badge-ok">1:1 M2 Behavior: {qr.behaviorRef}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button
                      type="button"
                      variant="secondary" size="sm"
                      onClick={() => onInspectImpact(qr.id)}
                    >
                      {t('分析引用影响', 'Impact')}
                    </Button>
                    <Button
                      type="button"
                      variant="danger" size="sm"
                      onClick={() =>
                        onRequestDelete({
                          elementId: qr.id,
                          label: `${qr.alias} (${qr.name})`,
                          mutate: (nx) => {
                            if (nx.M7) {
                              nx.M7.query_reports = nx.M7.query_reports.filter(
                                (x) => x.id !== qr.id,
                              );
                            }
                            if (nx.M2) {
                              nx.M2.behaviors = nx.M2.behaviors.filter(
                                (b) => b.id !== qr.behaviorRef,
                              );
                            }
                          },
                        })
                      }
                    >
                      {t('删除', 'Delete')}
                    </Button>
                  </div>
                </div>

                <div className="form-grid-3" style={{ marginBottom: 10 }}>
                  <div className="form-field">
                    <label className="form-label">{t('查询英文名 (Name)', 'Query Name')}</label>
                    <input
                      className="input"
                      style={{ fontFamily: 'var(--mono)' }}
                      value={qr.name}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.M7?.query_reports[qrIdx]) {
                            nx.M7.query_reports[qrIdx].name = e.target.value;
                          }
                        })
                      }
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">{t('查询中文别名 (Alias)', 'Alias')}</label>
                    <input
                      className="input"
                      value={qr.alias}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.M7?.query_reports[qrIdx]) {
                            nx.M7.query_reports[qrIdx].alias = e.target.value;
                          }
                        })
                      }
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">{t('查询类型', 'Query Type')}</label>
                    <select
                      className="select"
                      value={qr.queryType}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          const item = nx.M7?.query_reports[qrIdx];
                          if (!item) return;
                          const nextType = e.target.value as typeof item.queryType;
                          item.queryType = nextType;
                          if (nextType === 'REPORT' && !item.reportOptions) {
                            item.reportOptions = {
                              title: item.alias,
                              exportFormats: ['XLSX', 'CSV'],
                              summaryRow: true,
                              groupHeaders: [],
                            };
                          } else if (nextType !== 'REPORT') {
                            delete item.reportOptions;
                          }
                        })
                      }
                    >
                      <option value="LIST_QUERY">LIST_QUERY</option>
                      <option value="DETAIL_QUERY">DETAIL_QUERY</option>
                      <option value="STATISTICAL_QUERY">STATISTICAL_QUERY</option>
                      <option value="REPORT">REPORT</option>
                    </select>
                  </div>
                </div>

                <div className="form-field">
                  <label className="form-label">
                    {t('参考 SQLite 查询语句 (Reference SQL)', 'Reference SQLite SQL')}
                  </label>
                  <textarea
                    className="textarea mono"
                    rows={3}
                    value={qr.referenceSql.sql}
                    onChange={(e) =>
                      mutateDraft((nx) => {
                        if (nx.M7?.query_reports[qrIdx]) {
                          nx.M7.query_reports[qrIdx].referenceSql.sql = e.target.value;
                        }
                      })
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        ))}

      {/* ─── MU: UI Model ─── */}
      {modelCode === 'MU' &&
        (!draft.MU ? (
          renderEmptyModelBanner('MU')
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {draft.MU.screens.map((sc, scIdx) => {
              const layoutRefs = sc.layout ? extractLayoutElementIds(sc.layout) : [];
              const declaredIds = new Set(sc.elements.map((el) => el.elementId));
              const missingInElements = layoutRefs.filter(
                (lr) => !declaredIds.has(lr.elementId),
              );

              return (
                <div
                  key={sc.screenId}
                  id={`onto-card-${sc.screenId}`}
                  className="card"
                  style={cardHighlightStyle([sc.screenId])}
                >
                  <div className="card-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className="badge badge-accent">{sc.screenId}</span>
                      <strong>{sc.name}</strong>
                      <span className="badge badge-ok">
                        {sc.screenType} {sc.route ? `· ${sc.route}` : ''}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button
                        type="button"
                        variant="secondary" size="sm"
                        onClick={() => onInspectImpact(sc.screenId)}
                      >
                        {t('分析引用影响', 'Impact')}
                      </Button>
                      <Button
                        type="button"
                        variant="danger" size="sm"
                        onClick={() =>
                          onRequestDelete({
                            elementId: sc.screenId,
                            label: sc.name,
                            mutate: (nx) => {
                              if (nx.MU) {
                                nx.MU.screens = nx.MU.screens.filter(
                                  (x) => x.screenId !== sc.screenId,
                                );
                              }
                            },
                          })
                        }
                      >
                        {t('删除', 'Delete')}
                      </Button>
                    </div>
                  </div>

                  <div className="form-grid-3" style={{ marginBottom: 10 }}>
                    <div className="form-field">
                      <label className="form-label">{t('屏幕标题', 'Screen Name')}</label>
                      <input
                        className="input"
                        value={sc.name}
                        onChange={(e) =>
                          mutateDraft((nx) => {
                            if (nx.MU?.screens[scIdx]) nx.MU.screens[scIdx].name = e.target.value;
                          })
                        }
                      />
                    </div>
                    <div className="form-field">
                      <label className="form-label">{t('屏幕类型', 'Screen Type')}</label>
                      <select
                        className="select"
                        value={sc.screenType}
                        onChange={(e) =>
                          mutateDraft((nx) => {
                            const item = nx.MU?.screens[scIdx];
                            if (item) item.screenType = e.target.value as typeof item.screenType;
                          })
                        }
                      >
                        <option value="LIST">LIST</option>
                        <option value="FORM">FORM</option>
                        <option value="DETAIL">DETAIL</option>
                        <option value="APPROVAL">APPROVAL</option>
                        <option value="REPORT">REPORT</option>
                        <option value="DASHBOARD">DASHBOARD</option>
                      </select>
                    </div>
                    <div className="form-field">
                      <label className="form-label">{t('路由路径 (Route)', 'Route')}</label>
                      <input
                        className="input"
                        style={{ fontFamily: 'var(--mono)' }}
                        value={sc.route ?? ''}
                        onChange={(e) =>
                          mutateDraft((nx) => {
                            if (nx.MU?.screens[scIdx]) nx.MU.screens[scIdx].route = e.target.value;
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className="form-field" style={{ marginBottom: 10 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <label className="form-label">
                        {t(
                          'ASCII 语义线框布局 ([el] / @grid 实时一致性解析)',
                          'ASCII Wireframe Layout ([el] / @grid)',
                        )}
                      </label>
                      {missingInElements.length > 0 && (
                        <Button
                          type="button"
                          variant="secondary" size="sm"
                          onClick={() =>
                            mutateDraft((nx) => {
                              const s = nx.MU?.screens[scIdx];
                              if (!s) return;
                              for (const miss of missingInElements) {
                                s.elements.push({
                                  elementId: miss.elementId,
                                  name: miss.elementId,
                                  label: miss.elementId,
                                  elementType: miss.elementId.startsWith('btn')
                                    ? 'BUTTON'
                                    : miss.elementId.startsWith('grd')
                                      ? 'TABLE'
                                      : 'INPUT',
                                  io: miss.elementId.startsWith('btn') ? 'ACTION' : 'IN_OUT',
                                  required: miss.requiredInLayout,
                                });
                              }
                            })
                          }
                        >
                          + {t('自动注册未声明布局控件', 'Sync Layout Elements')} (
                          {missingInElements.length})
                        </Button>
                      )}
                    </div>
                    <textarea
                      className="textarea mono"
                      rows={4}
                      value={sc.layout ?? ''}
                      onChange={(e) =>
                        mutateDraft((nx) => {
                          if (nx.MU?.screens[scIdx]) nx.MU.screens[scIdx].layout = e.target.value;
                        })
                      }
                    />
                  </div>

                  {/* Semantic UI Elements */}
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                    {t('语义化控件绑定 (Semantic UI Elements)', 'Semantic Elements')} (
                    {sc.elements.length})
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 6,
                      marginBottom: 10,
                    }}
                  >
                    {sc.elements.map((el, elIdx) => (
                      <div
                        key={el.elementId}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '4px 8px',
                          borderRadius: 4,
                          background: 'var(--surface-2)',
                          border: '1px solid var(--line-2)',
                          fontSize: 11.5,
                        }}
                      >
                        <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>
                          [{el.elementId}]
                        </span>
                        <input
                          className="input"
                          style={{ width: 95, height: 22, fontSize: 11 }}
                          value={el.label}
                          onChange={(e) =>
                            mutateDraft((nx) => {
                              const elem = nx.MU?.screens[scIdx]?.elements[elIdx];
                              if (elem) elem.label = e.target.value;
                            })
                          }
                        />
                        <span className="badge">{el.elementType}</span>
                        {el.dataBinding && (
                          <span
                            style={{
                              fontFamily: 'var(--mono)',
                              fontSize: 10.5,
                              color: 'var(--accent)',
                            }}
                          >
                            {el.dataBinding}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* UI Event Call Chains */}
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                    {t('UI 事件调用链 (VALIDATE → BEHAVIOR → EVENT)', 'UI Event Call Chains')} (
                    {sc.events.length})
                  </div>
                  {sc.events.map((ev, evIdx) => (
                    <div
                      key={ev.eventId}
                      style={{
                        padding: '6px 10px',
                        background: 'var(--surface-2)',
                        borderRadius: 4,
                        marginBottom: 6,
                        fontFamily: 'var(--mono)',
                        fontSize: 11.5,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div>
                        <strong>{ev.eventId}</strong> (
                        <input
                          className="input"
                          style={{
                            width: 120,
                            height: 22,
                            fontSize: 11,
                            display: 'inline-block',
                          }}
                          value={ev.name}
                          onChange={(e) =>
                            mutateDraft((nx) => {
                              const uiEv = nx.MU?.screens[scIdx]?.events[evIdx];
                              if (uiEv) uiEv.name = e.target.value;
                            })
                          }
                        />
                        ) [{ev.triggerElementId} · {ev.triggerAction}]:{' '}
                        {ev.callChain
                          .map((s) => `${s.stepOrder}.${s.stepType}(${s.refId})`)
                          .join(' → ')}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}

      {/* ─── MM: Mapping Model ─── */}
      {modelCode === 'MM' &&
        (!draft.MM ? (
          renderEmptyModelBanner('MM')
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {draft.MM.mappings.map((mp, mpIdx) => (
              <div
                key={mp.id}
                id={`onto-card-${mp.id}`}
                className="card"
                style={cardHighlightStyle([mp.id])}
              >
                <div className="card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="badge badge-accent">{mp.id}</span>
                    <strong>
                      {mp.objectName} ({mp.objectRef})
                    </strong>
                    <span className="badge badge-ok">
                      {mp.tableMappings.map((tm) => tm.tableName).join(', ')}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button
                      type="button"
                      variant="secondary" size="sm"
                      onClick={() => onInspectImpact(mp.id)}
                    >
                      {t('分析引用影响', 'Impact')}
                    </Button>
                    <Button
                      type="button"
                      variant="danger" size="sm"
                      onClick={() =>
                        onRequestDelete({
                          elementId: mp.id,
                          label: mp.objectName,
                          mutate: (nx) => {
                            if (nx.MM) nx.MM.mappings = nx.MM.mappings.filter((x) => x.id !== mp.id);
                          },
                        })
                      }
                    >
                      {t('删除', 'Delete')}
                    </Button>
                  </div>
                </div>

                {mp.tableMappings.map((tm, tmIdx) => (
                  <div key={`${mp.id}-tm-${tmIdx}`} style={{ marginBottom: 10 }}>
                    <div
                      className="form-grid-3"
                      style={{
                        marginBottom: 8,
                        padding: 8,
                        borderRadius: 5,
                        background: 'var(--surface-2)',
                      }}
                    >
                      <div className="form-field">
                        <label className="form-label">{t('物理表名', 'Table Name')}</label>
                        <input
                          className="input"
                          style={{ fontFamily: 'var(--mono)' }}
                          value={tm.tableName}
                          onChange={(e) =>
                            mutateDraft((nx) => {
                              const tbl = nx.MM?.mappings[mpIdx]?.tableMappings[tmIdx];
                              if (tbl) tbl.tableName = e.target.value;
                            })
                          }
                        />
                      </div>
                      <div className="form-field">
                        <label className="form-label">{t('表角色', 'Table Role')}</label>
                        <select
                          className="select"
                          value={tm.tableRole}
                          onChange={(e) =>
                            mutateDraft((nx) => {
                              const tbl = nx.MM?.mappings[mpIdx]?.tableMappings[tmIdx];
                              if (tbl) tbl.tableRole = e.target.value as typeof tbl.tableRole;
                            })
                          }
                        >
                          <option value="MASTER">MASTER</option>
                          <option value="DETAIL">DETAIL</option>
                          <option value="EXT">EXT</option>
                          <option value="LOG">LOG</option>
                        </select>
                      </div>
                      <div className="form-field">
                        <label className="form-label">{t('主键列', 'Primary Key')}</label>
                        <input
                          className="input"
                          style={{ fontFamily: 'var(--mono)' }}
                          value={tm.primaryKey}
                          onChange={(e) =>
                            mutateDraft((nx) => {
                              const tbl = nx.MM?.mappings[mpIdx]?.tableMappings[tmIdx];
                              if (tbl) tbl.primaryKey = e.target.value;
                            })
                          }
                        />
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 4,
                      }}
                    >
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)' }}>
                        {t('对象属性 ↔ 物理字段映射', 'Column Mappings')} (
                        {tm.columnMappings.length})
                      </span>
                      <Button
                        type="button"
                        variant="secondary" size="sm"
                        onClick={() =>
                          mutateDraft((nx) => {
                            const tbl = nx.MM?.mappings[mpIdx]?.tableMappings[tmIdx];
                            if (!tbl) return;
                            tbl.columnMappings.push({
                              attributeRef: 'createdAt',
                              column: `col_${tbl.columnMappings.length + 1}`,
                              columnType: 'VARCHAR(64)',
                              nullable: true,
                            });
                          })
                        }
                      >
                        + {t('新增字段映射', 'Add Column')}
                      </Button>
                    </div>

                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>{t('对象属性 (M1)', 'Attribute Ref')}</th>
                          <th>{t('物理表字段', 'Column')}</th>
                          <th>{t('字段类型', 'Column Type')}</th>
                          <th>{t('外键/值对象策略', 'FK / Strategy')}</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {tm.columnMappings.map((cm, cmIdx) => (
                          <tr key={`${tm.tableName}-cm-${cmIdx}`}>
                            <td>
                              <input
                                className="input"
                                style={{ height: 25, fontSize: 11.5, fontFamily: 'var(--mono)' }}
                                value={cm.attributeRef}
                                onChange={(e) =>
                                  mutateDraft((nx) => {
                                    const col =
                                      nx.MM?.mappings[mpIdx]?.tableMappings[tmIdx]?.columnMappings[
                                        cmIdx
                                      ];
                                    if (col) col.attributeRef = e.target.value;
                                  })
                                }
                              />
                            </td>
                            <td>
                              <input
                                className="input"
                                style={{ height: 25, fontSize: 11.5, fontFamily: 'var(--mono)' }}
                                value={cm.column}
                                onChange={(e) =>
                                  mutateDraft((nx) => {
                                    const col =
                                      nx.MM?.mappings[mpIdx]?.tableMappings[tmIdx]?.columnMappings[
                                        cmIdx
                                      ];
                                    if (col) col.column = e.target.value;
                                  })
                                }
                              />
                            </td>
                            <td>
                              <input
                                className="input"
                                style={{ height: 25, fontSize: 11.5, fontFamily: 'var(--mono)' }}
                                value={cm.columnType}
                                onChange={(e) =>
                                  mutateDraft((nx) => {
                                    const col =
                                      nx.MM?.mappings[mpIdx]?.tableMappings[tmIdx]?.columnMappings[
                                        cmIdx
                                      ];
                                    if (col) col.columnType = e.target.value;
                                  })
                                }
                              />
                            </td>
                            <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                              {cm.fkTargetTable
                                ? `FK -> ${cm.fkTargetTable}.${cm.fkTargetColumn}`
                                : cm.valueObjectStrategy || (cm.isPrimaryKey ? 'PK' : '-')}
                            </td>
                            <td>
                              <Button
                                type="button"
                                variant="secondary" size="sm"
                                onClick={() =>
                                  mutateDraft((nx) => {
                                    nx.MM?.mappings[mpIdx]?.tableMappings[
                                      tmIdx
                                    ]?.columnMappings.splice(cmIdx, 1);
                                  })
                                }
                              >
                                ✕
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}

      {/* ─── MI: Interface Model ─── */}
      {modelCode === 'MI' &&
        (!draft.MI ? (
          renderEmptyModelBanner('MI')
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {draft.MI.interfaces.map((intf, iIdx) => {
              const renderFieldEditor = (
                kind: 'inputFields' | 'outputFields',
                fields: InterfaceFieldSpec[],
              ) => (
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)' }}>
                      {kind === 'inputFields'
                        ? t('入参契约字段 (Input)', 'Input Fields')
                        : t('出参契约字段 (Output)', 'Output Fields')}{' '}
                      ({fields.length})
                    </span>
                    <Button
                      type="button"
                      variant="secondary" size="sm"
                      onClick={() =>
                        mutateDraft((nx) => {
                          const target = nx.MI?.interfaces[iIdx];
                          if (!target) return;
                          const k = target[kind].length + 1;
                          target[kind].push({
                            name: `field${k}`,
                            label: `契约字段${k}`,
                            type: 'String',
                            required: false,
                          });
                        })
                      }
                    >
                      + {t('新增字段', 'Add Field')}
                    </Button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {fields.map((f, fIdx) => (
                      <div
                        key={`${intf.interfaceId}-${kind}-${fIdx}`}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr 90px auto',
                          gap: 4,
                          alignItems: 'center',
                        }}
                      >
                        <input
                          className="input"
                          style={{ height: 24, fontSize: 11, fontFamily: 'var(--mono)' }}
                          value={f.name}
                          onChange={(e) =>
                            mutateDraft((nx) => {
                              const fld = nx.MI?.interfaces[iIdx]?.[kind][fIdx];
                              if (fld) fld.name = e.target.value;
                            })
                          }
                        />
                        <input
                          className="input"
                          style={{ height: 24, fontSize: 11 }}
                          value={f.label}
                          onChange={(e) =>
                            mutateDraft((nx) => {
                              const fld = nx.MI?.interfaces[iIdx]?.[kind][fIdx];
                              if (fld) fld.label = e.target.value;
                            })
                          }
                        />
                        <input
                          className="input"
                          style={{ height: 24, fontSize: 11, fontFamily: 'var(--mono)' }}
                          value={f.type}
                          onChange={(e) =>
                            mutateDraft((nx) => {
                              const fld = nx.MI?.interfaces[iIdx]?.[kind][fIdx];
                              if (fld) fld.type = e.target.value;
                            })
                          }
                        />
                        <Button
                          type="button"
                          variant="secondary" size="sm"
                          style={{ height: 22, padding: '0 5px' }}
                          onClick={() =>
                            mutateDraft((nx) => {
                              nx.MI?.interfaces[iIdx]?.[kind].splice(fIdx, 1);
                            })
                          }
                        >
                          ✕
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              );

              return (
                <div
                  key={intf.interfaceId}
                  id={`onto-card-${intf.interfaceId}`}
                  className="card"
                  style={cardHighlightStyle([intf.interfaceId])}
                >
                  <div className="card-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className="badge badge-accent">{intf.interfaceId}</span>
                      <strong>{intf.name}</strong>
                      <span className="badge badge-ok">{intf.direction}</span>
                      <span className="badge">{intf.interfaceCategory}</span>
                      <span className="badge">{intf.protocol}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button
                        type="button"
                        variant="secondary" size="sm"
                        onClick={() => onInspectImpact(intf.interfaceId)}
                      >
                        {t('分析引用影响', 'Impact')}
                      </Button>
                      <Button
                        type="button"
                        variant="danger" size="sm"
                        onClick={() =>
                          onRequestDelete({
                            elementId: intf.interfaceId,
                            label: intf.name,
                            mutate: (nx) => {
                              if (nx.MI) {
                                nx.MI.interfaces = nx.MI.interfaces.filter(
                                  (x) => x.interfaceId !== intf.interfaceId,
                                );
                              }
                            },
                          })
                        }
                      >
                        {t('删除', 'Delete')}
                      </Button>
                    </div>
                  </div>

                  <div className="form-grid-3" style={{ marginBottom: 10 }}>
                    <div className="form-field">
                      <label className="form-label">{t('接口契约名称', 'Interface Name')}</label>
                      <input
                        className="input"
                        value={intf.name}
                        onChange={(e) =>
                          mutateDraft((nx) => {
                            if (nx.MI?.interfaces[iIdx]) {
                              nx.MI.interfaces[iIdx].name = e.target.value;
                            }
                          })
                        }
                      />
                    </div>
                    <div className="form-field">
                      <label className="form-label">{t('提供/依赖方向', 'Direction')}</label>
                      <select
                        className="select"
                        value={intf.direction}
                        onChange={(e) =>
                          mutateDraft((nx) => {
                            const item = nx.MI?.interfaces[iIdx];
                            if (item) item.direction = e.target.value as typeof item.direction;
                          })
                        }
                      >
                        <option value="PROVIDED">PROVIDED</option>
                        <option value="DEPENDENT">DEPENDENT</option>
                      </select>
                    </div>
                    <div className="form-field">
                      <label className="form-label">{t('通信协议', 'Protocol')}</label>
                      <select
                        className="select"
                        value={intf.protocol}
                        onChange={(e) =>
                          mutateDraft((nx) => {
                            const item = nx.MI?.interfaces[iIdx];
                            if (item) item.protocol = e.target.value as typeof item.protocol;
                          })
                        }
                      >
                        <option value="REST">REST</option>
                        <option value="GRAPHQL">GRAPHQL</option>
                        <option value="RPC">RPC</option>
                        <option value="gRPC">gRPC</option>
                        <option value="MQ">MQ</option>
                        <option value="WEBHOOK">WEBHOOK</option>
                        <option value="SFTP">SFTP</option>
                      </select>
                    </div>
                  </div>

                  <div className="form-grid-2" style={{ marginBottom: 10 }}>
                    <div className="form-field">
                      <label className="form-label">
                        {t('承接行为引用 (M2 Behavior)', 'Related M2 Behavior')}
                      </label>
                      <input
                        className="input"
                        style={{ fontFamily: 'var(--mono)' }}
                        value={intf.relatedBehaviorRef ?? ''}
                        onChange={(e) =>
                          mutateDraft((nx) => {
                            if (nx.MI?.interfaces[iIdx]) {
                              nx.MI.interfaces[iIdx].relatedBehaviorRef =
                                e.target.value || undefined;
                            }
                          })
                        }
                      />
                    </div>
                    <div className="form-field">
                      <label className="form-label">
                        {t('外部主体引用 (M5 External Entity)', 'Related External Entity')}
                      </label>
                      <input
                        className="input"
                        style={{ fontFamily: 'var(--mono)' }}
                        value={intf.relatedExternalEntityRef ?? ''}
                        onChange={(e) =>
                          mutateDraft((nx) => {
                            if (nx.MI?.interfaces[iIdx]) {
                              nx.MI.interfaces[iIdx].relatedExternalEntityRef =
                                e.target.value || undefined;
                            }
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className="form-grid-2">
                    {renderFieldEditor('inputFields', intf.inputFields)}
                    {renderFieldEditor('outputFields', intf.outputFields)}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
    </div>
  );
}
