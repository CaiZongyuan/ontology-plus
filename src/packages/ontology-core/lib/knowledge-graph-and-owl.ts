import type {
  Attribute,
  KnowledgeGraphData,
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  MUUiModel,
  NavigationEdgeSchema,
  OntologySuite,
  ScreenItem,
  UIElement,
  UIEvent,
} from './types.js';
import type { z } from 'zod';

type NavigationEdge = z.infer<typeof NavigationEdgeSchema>;

const VALID_SCREEN_TYPES = new Set<ScreenItem['screenType']>([
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
]);

const VALID_ELEMENT_TYPES = new Set<UIElement['elementType']>([
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
]);

const VALID_ACTION_TYPES = new Set<NonNullable<UIElement['actionType']>>([
  'DRAFT',
  'SUBMIT',
  'DEFAULT',
  'QUERY',
  'DELETE',
  'NAVIGATE',
]);

export function buildKnowledgeGraph(suite: OntologySuite): KnowledgeGraphData {
  const nodes: KnowledgeGraphNode[] = [];
  const nodeIds = new Set<string>();
  const canonicalNodeAlias = new Map<string, string>();
  const pendingEdges: {
    source: string | undefined;
    target: string | undefined;
    relation: string;
    labelZh: string;
    labelEn: string;
  }[] = [];

  const addNode = (node: KnowledgeGraphNode) => {
    if (!nodeIds.has(node.id)) {
      nodeIds.add(node.id);
      canonicalNodeAlias.set(node.id, node.id);
      nodes.push(node);
    }
  };

  const queueEdge = (
    source: string | undefined,
    target: string | undefined,
    relation: string,
    labelZh: string,
    labelEn: string,
  ) => {
    if (!source || !target) return;
    pendingEdges.push({ source, target, relation, labelZh, labelEn });
  };

  const resolveNodeId = (rawRef: string | undefined): string | undefined => {
    if (!rawRef) return undefined;
    const direct = canonicalNodeAlias.get(rawRef);
    if (direct && nodeIds.has(direct)) return direct;
    if (rawRef.includes('.')) {
      const rootPart = rawRef.split('.')[0];
      const rootResolved = canonicalNodeAlias.get(rootPart);
      if (rootResolved && nodeIds.has(rootResolved)) return rootResolved;
    }
    return nodeIds.has(rawRef) ? rawRef : undefined;
  };

  // ─── M1 Nodes & Edges ───────────────────────────────────────────────────────
  if (suite.M1) {
    for (const dict of suite.M1.data_dictionaries) {
      addNode({
        id: dict.id,
        label: dict.name,
        subLabel: `${dict.id} · DICTIONARY`,
        model: 'M1',
        category: 'DATA_DICTIONARY',
        metadata: { typeCount: dict.types.length },
      });
    }

    for (const agg of suite.M1.aggregates) {
      const canonicalAggId = agg.name || agg.id;
      addNode({
        id: canonicalAggId,
        label: agg.alias || agg.name,
        subLabel: agg.name,
        model: 'M1',
        category: 'AGGREGATE_ROOT',
        metadata: { id: agg.id, lifecycle: agg.lifecycle, attributeCount: agg.attributes.length },
      });
      canonicalNodeAlias.set(agg.id, canonicalAggId);
      canonicalNodeAlias.set(agg.name, canonicalAggId);
      if (agg.alias) canonicalNodeAlias.set(agg.alias, canonicalAggId);

      for (const attr of agg.attributes) {
        if (attr.type === 'AggregateRootRef' && attr.targetAggregate) {
          queueEdge(
            canonicalAggId,
            attr.targetAggregate,
            'REFERENCES_AGGREGATE',
            `引用 (${attr.name})`,
            `Refs (${attr.name})`,
          );
        }
        if (attr.type === 'DictionaryRef' && attr.dictionaryRef) {
          queueEdge(
            canonicalAggId,
            attr.dictionaryRef.dictionaryId,
            'USES_DICTIONARY',
            '引用字典',
            'Uses Dictionary',
          );
        }
      }

      for (const ent of agg.entities) {
        const entId = `${canonicalAggId}.${ent.name}`;
        addNode({
          id: entId,
          label: ent.alias || ent.name,
          subLabel: entId,
          model: 'M1',
          category: 'SUB_ENTITY',
          metadata: { localId: ent.localId, cardinality: ent.cardinality },
        });
        canonicalNodeAlias.set(`${agg.id}.${ent.name}`, entId);
        queueEdge(canonicalAggId, entId, 'CONTAINS_ENTITY', '包含子实体', 'Contains Sub-Entity');
      }

      for (const vo of agg.valueObjects) {
        const voId = `${canonicalAggId}.${vo.name}`;
        addNode({
          id: voId,
          label: vo.alias || vo.name,
          subLabel: voId,
          model: 'M1',
          category: 'VALUE_OBJECT',
          metadata: { immutable: vo.immutable },
        });
        canonicalNodeAlias.set(`${agg.id}.${vo.name}`, voId);
        queueEdge(canonicalAggId, voId, 'HAS_VALUE_OBJECT', '使用值对象', 'Uses Value Object');
      }
    }

    for (const assoc of suite.M1.aggregate_associations) {
      queueEdge(
        assoc.sourceAggregate,
        assoc.targetAggregate,
        assoc.associationType,
        `关联 (${assoc.cardinality})`,
        `Assocs (${assoc.cardinality})`,
      );
    }
  }

  // ─── M2 Nodes & Edges ───────────────────────────────────────────────────────
  if (suite.M2) {
    for (const beh of suite.M2.behaviors) {
      addNode({
        id: beh.id,
        label: beh.alias || beh.name,
        subLabel: `${beh.id} · ${beh.behaviorType}`,
        model: 'M2',
        category: beh.behaviorType,
        metadata: { name: beh.name, ownerEntity: beh.ownerEntity, triggerType: beh.triggerType },
      });
      canonicalNodeAlias.set(beh.name, beh.id);

      queueEdge(beh.ownerEntity, beh.id, 'OWNS_BEHAVIOR', '拥有行为', 'Owns Behavior');
      for (const ruleId of beh.invokedRules) {
        queueEdge(beh.id, ruleId, 'INVOKES_RULE', '调用规则', 'Invokes Rule');
      }
      for (const evRef of beh.producedEvents) {
        const evId = typeof evRef === 'string' ? evRef : evRef.eventRef;
        queueEdge(beh.id, evId, 'PRODUCES_EVENT', '产生事件', 'Produces Event');
      }
      for (const permId of beh.requiredPermissions) {
        queueEdge(beh.id, permId, 'REQUIRES_PERMISSION', '需要权限', 'Requires Permission');
      }
      for (const st of beh.syncTriggers ?? []) {
        queueEdge(beh.id, st.behaviorRef, 'SYNC_TRIGGERS', '同步触发', 'Sync Triggers');
      }
      if (beh.queryReportRef) {
        queueEdge(beh.id, beh.queryReportRef, 'MAPS_REPORT', '关联查询报表', 'Links Report');
      }
    }
  }

  // ─── M3 Nodes & Edges ───────────────────────────────────────────────────────
  if (suite.M3) {
    for (const rule of suite.M3.rules) {
      addNode({
        id: rule.id,
        label: rule.alias || rule.name,
        subLabel: `${rule.id} · ${rule.ruleType}`,
        model: 'M3',
        category: rule.ruleType,
        metadata: { name: rule.name, scope: rule.scope },
      });
      canonicalNodeAlias.set(rule.name, rule.id);

      for (const obj of rule.referencedObjects) {
        queueEdge(rule.id, obj, 'CONSTRAINS_OBJECT', '约束对象', 'Constrains Object');
      }
      for (const evId of rule.triggeredByEvents) {
        queueEdge(evId, rule.id, 'TRIGGERS_RULE', '触发规则', 'Triggers Rule');
      }
      for (const evId of rule.producedEvents) {
        queueEdge(rule.id, evId, 'PRODUCES_EVENT', '触发事件', 'Produces Event');
      }
      for (const tb of rule.triggeredBehaviors) {
        queueEdge(rule.id, tb.behaviorRef, 'RULE_TRIGGERS_BEHAVIOR', '规则触发行为', 'Triggers Behavior');
      }
    }
  }

  // ─── ME Nodes & Edges ───────────────────────────────────────────────────────
  if (suite.ME) {
    for (const ev of suite.ME.events) {
      addNode({
        id: ev.id,
        label: ev.label || ev.name,
        subLabel: ev.id,
        model: 'ME',
        category: 'DOMAIN_EVENT',
        metadata: { name: ev.name, producerType: ev.producerType },
      });
      canonicalNodeAlias.set(ev.name, ev.id);

      queueEdge(ev.id, ev.sourceAggregate, 'EVENT_SOURCE', '源聚合根', 'Source Aggregate');
      if (ev.producerType === 'BEHAVIOR' && ev.producerBehaviorRef) {
        queueEdge(ev.producerBehaviorRef, ev.id, 'PRODUCES_EVENT', '产生事件', 'Produces Event');
      } else if (ev.producerType === 'RULE') {
        const rRef = ev.producerRuleRef || ev.producerBehaviorRef;
        if (rRef) queueEdge(rRef, ev.id, 'PRODUCES_EVENT', '产生事件', 'Produces Event');
      }
      for (const sub of ev.subscribers) {
        queueEdge(ev.id, sub.subscriberRef, 'TRIGGERS_SUBSCRIBER', '触发订阅方', 'Triggers Subscriber');
      }
    }
  }

  // ─── M4 Nodes & Edges ───────────────────────────────────────────────────────
  if (suite.M4) {
    for (const sc of suite.M4.event_scenarios) {
      addNode({
        id: sc.id,
        label: sc.name,
        subLabel: sc.id,
        model: 'M4',
        category: 'SCENARIO',
        metadata: { stepCount: sc.steps.length },
      });
      queueEdge(sc.triggerEventRef, sc.id, 'TRIGGERS_SCENARIO', '触发场景', 'Triggers Scenario');
      if (sc.triggerBehaviorRef) {
        queueEdge(sc.triggerBehaviorRef, sc.id, 'INITIATES_SCENARIO', '发起场景', 'Initiates Scenario');
      }
      for (const agg of sc.involvedAggregates) {
        queueEdge(sc.id, agg, 'INVOLVES_AGGREGATE', '涉及聚合根', 'Involves Aggregate');
      }
      for (const st of sc.steps) {
        queueEdge(sc.id, st.refId, 'SCENARIO_STEP', `步骤 ${st.stepOrder}`, `Step ${st.stepOrder}`);
      }
    }
  }

  // ─── M5 Nodes & Edges ───────────────────────────────────────────────────────
  if (suite.M5) {
    for (const act of suite.M5.actors) {
      addNode({
        id: act.id,
        label: act.name,
        subLabel: `${act.id} · ${act.actorType}`,
        model: 'M5',
        category: act.actorType,
      });
      for (const rId of act.roles) {
        queueEdge(act.id, rId, 'ASSUMES_ROLE', '担任角色', 'Assumes Role');
      }
    }

    for (const pg of suite.M5.permissionGroups ?? []) {
      addNode({
        id: pg.id,
        label: pg.name,
        subLabel: pg.id,
        model: 'M5',
        category: 'PERMISSION_GROUP',
      });
      for (const permId of pg.permissions) {
        queueEdge(pg.id, permId, 'CONTAINS_PERMISSION', '包含权限', 'Contains Permission');
      }
    }

    for (const role of suite.M5.roles) {
      addNode({
        id: role.id,
        label: role.name,
        subLabel: role.code,
        model: 'M5',
        category: 'ROLE',
        metadata: { dataScope: role.dataScope },
      });
      canonicalNodeAlias.set(role.code, role.id);

      for (const parentId of role.inheritsFrom) {
        queueEdge(role.id, parentId, 'INHERITS_ROLE', '继承角色', 'Inherits Role');
      }
      for (const permId of role.permissions) {
        queueEdge(role.id, permId, 'GRANTS_PERMISSION', '授予权限', 'Grants Permission');
      }
      for (const pgId of role.permissionGroups ?? []) {
        queueEdge(role.id, pgId, 'GRANTS_PERMISSION_GROUP', '授予权限组', 'Grants Permission Group');
      }
    }

    for (const perm of suite.M5.permissions) {
      addNode({
        id: perm.id,
        label: perm.name,
        subLabel: perm.code,
        model: 'M5',
        category: 'PERMISSION',
      });
      canonicalNodeAlias.set(perm.code, perm.id);

      queueEdge(perm.id, perm.targetAggregate, 'GOVERNS_AGGREGATE', '管控聚合根', 'Governs Aggregate');
      for (const behId of perm.allowedBehaviors) {
        queueEdge(perm.id, behId, 'ALLOWS_BEHAVIOR', '允许行为', 'Allows Behavior');
      }
    }
  }

  // ─── M6 Nodes & Edges ───────────────────────────────────────────────────────
  if (suite.M6) {
    for (const fl of suite.M6.flows) {
      addNode({
        id: fl.id,
        label: fl.name,
        subLabel: `${fl.id} · ${fl.flowType}`,
        model: 'M6',
        category: fl.flowType,
        metadata: { activityCount: fl.activities.length },
      });
      queueEdge(fl.id, fl.primaryAggregate, 'ORCHESTRATES', '编排主聚合根', 'Orchestrates');
      for (const rId of fl.roleRefs) {
        queueEdge(rId, fl.id, 'PARTICIPATES_IN_FLOW', '参与流程', 'Participates in Flow');
      }
      const trigRef = fl.trigger.behaviorRef || fl.trigger.eventRef || fl.trigger.refId;
      if (trigRef) {
        queueEdge(trigRef, fl.id, 'TRIGGERS_FLOW', '触发流程', 'Triggers Flow');
      }
      for (const act of fl.activities) {
        if (act.behaviorRef) {
          queueEdge(fl.id, act.behaviorRef, 'FLOW_CALLS_BEHAVIOR', '调用行为', 'Calls Behavior');
        }
        if (act.scenarioRef) {
          queueEdge(fl.id, act.scenarioRef, 'FLOW_CALLS_SCENARIO', '调用场景', 'Calls Scenario');
        }
        if (act.subFlowRef) {
          queueEdge(fl.id, act.subFlowRef, 'FLOW_CALLS_SUBFLOW', '调用子流程', 'Calls Sub-Flow');
        }
        if (act.screenRef) {
          queueEdge(fl.id, act.screenRef, 'FLOW_BINDS_SCREEN', '绑定界面', 'Binds Screen');
        }
      }
    }
  }

  // ─── M7 Nodes & Edges ───────────────────────────────────────────────────────
  if (suite.M7) {
    for (const rp of suite.M7.query_reports) {
      addNode({
        id: rp.id,
        label: rp.alias || rp.name,
        subLabel: `${rp.id} · ${rp.queryType}`,
        model: 'M7',
        category: rp.queryType,
        metadata: { behaviorRef: rp.behaviorRef },
      });
      canonicalNodeAlias.set(rp.name, rp.id);

      queueEdge(rp.id, rp.primarySource.aggregateRef, 'QUERIES_AGGREGATE', '查询主对象', 'Queries Aggregate');
      for (const jn of rp.joins) {
        queueEdge(rp.id, jn.aggregateRef, 'JOINS_AGGREGATE', '关联查询对象', 'Joins Aggregate');
      }
    }
  }

  // ─── MU Nodes & Edges ───────────────────────────────────────────────────────
  if (suite.MU) {
    for (const sc of suite.MU.screens) {
      addNode({
        id: sc.screenId,
        label: sc.name,
        subLabel: `${sc.screenId} · ${sc.screenType}`,
        model: 'MU',
        category: sc.screenType,
        metadata: { elementCount: sc.elements.length, eventCount: sc.events.length },
      });
      for (const rId of sc.roleRefs) {
        queueEdge(rId, sc.screenId, 'ACCESSES_SCREEN', '访问界面', 'Accesses Screen');
      }
      for (const el of sc.elements) {
        if (el.dataBinding) {
          queueEdge(sc.screenId, el.dataBinding, 'UI_BINDS_OBJECT', '绑定领域对象', 'Binds Object');
        }
        if (el.dataSource) {
          queueEdge(sc.screenId, el.dataSource, 'UI_BINDS_DATASOURCE', '绑定数据源', 'Binds DataSource');
        }
      }
      for (const ev of sc.events) {
        for (const step of ev.callChain) {
          if (step.refId !== 'EXIT') {
            queueEdge(sc.screenId, step.refId, 'UI_INVOKES', '界面触发', 'UI Invokes');
          }
          for (const rId of step.rules ?? []) {
            queueEdge(sc.screenId, rId, 'UI_INVOKES', '界面校验规则', 'UI Validates Rule');
          }
        }
      }
    }
    for (const nav of suite.MU.navigation_edges) {
      if (nav.toScreen !== 'EXIT') {
        queueEdge(nav.fromScreen, nav.toScreen, 'UI_NAVIGATES_TO', '页面导航', 'Navigates To');
      }
    }
  }

  // ─── MM Nodes & Edges ───────────────────────────────────────────────────────
  if (suite.MM) {
    for (const mp of suite.MM.mappings) {
      addNode({
        id: mp.id,
        label: `${mp.objectName} 映射`,
        subLabel: mp.tableMappings.map((t) => t.tableName).join(', '),
        model: 'MM',
        category: 'TABLE_MAPPING',
        metadata: { tableCount: mp.tableMappings.length },
      });
      queueEdge(
        mp.id,
        mp.objectRef || mp.objectName,
        'MAPS_TO_TABLE',
        '持久化映射',
        'Persists',
      );
    }
  }

  // ─── MI Nodes & Edges ───────────────────────────────────────────────────────
  if (suite.MI) {
    for (const iface of suite.MI.interfaces) {
      addNode({
        id: iface.interfaceId,
        label: iface.name,
        subLabel: `${iface.interfaceId} · ${iface.direction}`,
        model: 'MI',
        category: iface.direction,
        metadata: { protocol: iface.protocol, interfaceCategory: iface.interfaceCategory },
      });
      if (iface.relatedBehaviorRef) {
        queueEdge(
          iface.interfaceId,
          iface.relatedBehaviorRef,
          'EXPOSES_BEHAVIOR',
          '暴露/调用行为',
          'Links Behavior',
        );
      }
      if (iface.relatedEntityRef) {
        queueEdge(
          iface.interfaceId,
          iface.relatedEntityRef,
          'EXPOSES_ENTITY',
          '关联领域对象',
          'Links Entity',
        );
      }
      if (iface.relatedReportRef) {
        queueEdge(
          iface.interfaceId,
          iface.relatedReportRef,
          'EXPOSES_REPORT',
          '暴露查询报表',
          'Exposes Report',
        );
      }
      if (iface.relatedEventRef) {
        queueEdge(
          iface.interfaceId,
          iface.relatedEventRef,
          'EXPOSES_EVENT',
          '关联领域事件',
          'Links Event',
        );
      }
      if (iface.relatedExternalEntityRef) {
        queueEdge(
          iface.interfaceId,
          iface.relatedExternalEntityRef,
          'CALLS_EXTERNAL_ACTOR',
          '对接外部系统',
          'Calls External Actor',
        );
      }
    }
  }

  // ─── Finalize Deduplicated Non-Dangling Edges & Populate Node Degrees ──────
  const edges: KnowledgeGraphEdge[] = [];
  const seenEdgeIds = new Set<string>();
  const degreeByNodeId = new Map<string, number>();

  for (const cand of pendingEdges) {
    const src = resolveNodeId(cand.source);
    const tgt = resolveNodeId(cand.target);
    if (!src || !tgt) continue;
    const edgeId = `${src}--${cand.relation}-->${tgt}`;
    if (seenEdgeIds.has(edgeId)) continue;
    seenEdgeIds.add(edgeId);
    edges.push({
      id: edgeId,
      source: src,
      target: tgt,
      relation: cand.relation,
      labelZh: cand.labelZh,
      labelEn: cand.labelEn,
    });
    degreeByNodeId.set(src, (degreeByNodeId.get(src) ?? 0) + 1);
    degreeByNodeId.set(tgt, (degreeByNodeId.get(tgt) ?? 0) + 1);
  }

  for (const node of nodes) {
    node.metadata = {
      ...(node.metadata ?? {}),
      degree: degreeByNodeId.get(node.id) ?? 0,
    };
  }

  return { nodes, edges };
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Produces a valid XML NCName suitable for `rdf:ID` and `#fragment` IRIs.
 * Preserves standard ASCII identifiers like `Contract`, `BHV-01`, `SCR-CONTRACT-LIST` verbatim.
 */
function sanitizeOwlNcName(raw: string): string {
  const trimmed = raw.trim();
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(trimmed)) {
    return trimmed;
  }
  let out = '';
  for (const ch of trimmed) {
    if (/[A-Za-z0-9_-]/.test(ch)) {
      out += ch;
    } else if (ch === '.' || ch === ':' || ch === '/' || /\s/.test(ch)) {
      out += '_';
    } else {
      const cp = ch.codePointAt(0);
      out += cp !== undefined ? `_u${cp.toString(16).toUpperCase()}_` : '_';
    }
  }
  if (!out || !/^[A-Za-z_]/.test(out)) {
    out = `id_${out}`;
  }
  return out;
}

export function exportToOwl(suite: OntologySuite): string {
  const domain =
    suite.M1?.domain ||
    suite.M2?.domain ||
    suite.M3?.domain ||
    suite.MU?.domain ||
    'OntologyPlusDomain';
  const baseIri = `http://ontology-plus.org/ontologies/${encodeURIComponent(domain)}`;
  const usedIds = new Set<string>();

  const uniqueOwlId = (rawId: string, modelPrefix?: string): string => {
    const base = sanitizeOwlNcName(rawId);
    if (!usedIds.has(base)) {
      usedIds.add(base);
      return base;
    }
    const prefixed = modelPrefix ? `${modelPrefix}_${base}` : `${base}_dup`;
    let candidate = prefixed;
    let seq = 2;
    while (usedIds.has(candidate)) {
      candidate = `${prefixed}_${seq++}`;
    }
    usedIds.add(candidate);
    return candidate;
  };

  const aggOwlIdMap = new Map<string, string>();

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rdf:RDF',
    `  xmlns="${baseIri}#"`,
    `  xml:base="${baseIri}"`,
    '  xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"',
    '  xmlns:owl="http://www.w3.org/2002/07/owl#"',
    '  xmlns:xsd="http://www.w3.org/2001/XMLSchema#"',
    '  xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"',
    '  xmlns:onto="http://ontology-plus.org/meta/v5#">',
    '',
    `  <owl:Ontology rdf:about="${escapeXml(baseIri)}">`,
    `    <rdfs:label>${escapeXml(domain)}</rdfs:label>`,
    '    <owl:versionInfo>5.0</owl:versionInfo>',
    '  </owl:Ontology>',
    '',
  ];

  const emitOwlAttributes = (domainClassId: string, attrs: Attribute[]) => {
    for (const attr of attrs) {
      const propId = uniqueOwlId(`${domainClassId}_${attr.name}`, 'M1');
      lines.push(`  <owl:DatatypeProperty rdf:ID="${escapeXml(propId)}">`);
      lines.push(`    <rdfs:domain rdf:resource="#${escapeXml(domainClassId)}"/>`);
      lines.push(`    <rdfs:label xml:lang="zh">${escapeXml(attr.label)}</rdfs:label>`);
      lines.push(`    <onto:dataType>${escapeXml(attr.type)}</onto:dataType>`);
      lines.push(`    <onto:required>${attr.required ? 'true' : 'false'}</onto:required>`);
      for (const rr of attr.refRules ?? []) {
        lines.push(`    <onto:refRule>${escapeXml(`${rr.name}: ${rr.expression}`)}</onto:refRule>`);
      }
      lines.push('  </owl:DatatypeProperty>');
    }
  };

  // ─── M1 Object Model ────────────────────────────────────────────────────────
  if (suite.M1) {
    for (const agg of suite.M1.aggregates) {
      const aggClassId = uniqueOwlId(agg.name || agg.id, 'M1');
      aggOwlIdMap.set(agg.id, aggClassId);
      aggOwlIdMap.set(agg.name, aggClassId);
      if (agg.alias) aggOwlIdMap.set(agg.alias, aggClassId);

      lines.push(`  <owl:Class rdf:ID="${escapeXml(aggClassId)}">`);
      lines.push(`    <rdfs:label xml:lang="zh">${escapeXml(agg.alias)}</rdfs:label>`);
      lines.push('    <onto:modelCode>M1</onto:modelCode>');
      lines.push('    <onto:entityCategory>AGGREGATE_ROOT</onto:entityCategory>');
      lines.push(`    <onto:elementId>${escapeXml(agg.id)}</onto:elementId>`);
      if (agg.lifecycle.length > 0) {
        lines.push(`    <onto:lifecycle>${escapeXml(agg.lifecycle.join(','))}</onto:lifecycle>`);
      }
      for (const inv of agg.invariants) {
        lines.push(`    <onto:invariant>${escapeXml(`${inv.name}: ${inv.expression}`)}</onto:invariant>`);
      }
      if (agg.description) {
        lines.push(`    <rdfs:comment>${escapeXml(agg.description)}</rdfs:comment>`);
      }
      lines.push('  </owl:Class>');

      emitOwlAttributes(aggClassId, agg.attributes);

      for (const ent of agg.entities) {
        const entClassId = uniqueOwlId(`${aggClassId}_${ent.name}`, 'M1');
        lines.push(`  <owl:Class rdf:ID="${escapeXml(entClassId)}">`);
        lines.push(`    <rdfs:label xml:lang="zh">${escapeXml(ent.alias)}</rdfs:label>`);
        lines.push('    <onto:modelCode>M1</onto:modelCode>');
        lines.push('    <onto:entityCategory>SUB_ENTITY</onto:entityCategory>');
        lines.push(`    <onto:partOfAggregate rdf:resource="#${escapeXml(aggClassId)}"/>`);
        lines.push(`    <onto:cardinality>${escapeXml(ent.cardinality)}</onto:cardinality>`);
        lines.push('  </owl:Class>');
        emitOwlAttributes(entClassId, ent.attributes);
      }

      for (const vo of agg.valueObjects) {
        const voClassId = uniqueOwlId(`${aggClassId}_${vo.name}`, 'M1');
        lines.push(`  <owl:Class rdf:ID="${escapeXml(voClassId)}">`);
        lines.push(`    <rdfs:label xml:lang="zh">${escapeXml(vo.alias)}</rdfs:label>`);
        lines.push('    <onto:modelCode>M1</onto:modelCode>');
        lines.push('    <onto:entityCategory>VALUE_OBJECT</onto:entityCategory>');
        lines.push(`    <onto:partOfAggregate rdf:resource="#${escapeXml(aggClassId)}"/>`);
        lines.push('  </owl:Class>');
        emitOwlAttributes(voClassId, vo.attributes);
      }
    }

    for (const dict of suite.M1.data_dictionaries) {
      const dictId = uniqueOwlId(dict.id, 'M1');
      lines.push(`  <owl:NamedIndividual rdf:ID="${escapeXml(dictId)}">`);
      lines.push('    <rdf:type rdf:resource="http://ontology-plus.org/meta/v5#DataDictionary"/>');
      lines.push('    <onto:modelCode>M1</onto:modelCode>');
      lines.push(`    <rdfs:label xml:lang="zh">${escapeXml(dict.name)}</rdfs:label>`);
      for (const t of dict.types) {
        lines.push(`    <onto:dictionaryType>${escapeXml(t.typeCode)}</onto:dictionaryType>`);
      }
      lines.push('  </owl:NamedIndividual>');
    }

    for (const assoc of suite.M1.aggregate_associations) {
      const assocId = uniqueOwlId(assoc.id, 'M1');
      const srcId = aggOwlIdMap.get(assoc.sourceAggregate) ?? sanitizeOwlNcName(assoc.sourceAggregate);
      const tgtId = aggOwlIdMap.get(assoc.targetAggregate) ?? sanitizeOwlNcName(assoc.targetAggregate);
      lines.push(`  <owl:ObjectProperty rdf:ID="${escapeXml(assocId)}">`);
      lines.push('    <onto:modelCode>M1</onto:modelCode>');
      lines.push(`    <rdfs:domain rdf:resource="#${escapeXml(srcId)}"/>`);
      lines.push(`    <rdfs:range rdf:resource="#${escapeXml(tgtId)}"/>`);
      lines.push(`    <onto:cardinality>${escapeXml(assoc.cardinality)}</onto:cardinality>`);
      lines.push(`    <onto:referenceField>${escapeXml(assoc.referenceField)}</onto:referenceField>`);
      lines.push('  </owl:ObjectProperty>');
    }
  }

  // ─── M2 Behavior Model ──────────────────────────────────────────────────────
  if (suite.M2) {
    for (const beh of suite.M2.behaviors) {
      const bId = uniqueOwlId(beh.id, 'M2');
      lines.push(`  <owl:NamedIndividual rdf:ID="${escapeXml(bId)}">`);
      lines.push('    <rdf:type rdf:resource="http://ontology-plus.org/meta/v5#Behavior"/>');
      lines.push('    <onto:modelCode>M2</onto:modelCode>');
      lines.push(`    <rdfs:label xml:lang="zh">${escapeXml(beh.alias)}</rdfs:label>`);
      lines.push(`    <onto:behaviorName>${escapeXml(beh.name)}</onto:behaviorName>`);
      lines.push(`    <onto:behaviorType>${escapeXml(beh.behaviorType)}</onto:behaviorType>`);
      lines.push(`    <onto:triggerType>${escapeXml(beh.triggerType)}</onto:triggerType>`);
      lines.push(`    <onto:ownerEntity>${escapeXml(beh.ownerEntity)}</onto:ownerEntity>`);
      if (beh.queryReportRef) {
        lines.push(`    <onto:queryReportRef>${escapeXml(beh.queryReportRef)}</onto:queryReportRef>`);
      }
      lines.push('  </owl:NamedIndividual>');
    }
  }

  // ─── M3 Rule Model ──────────────────────────────────────────────────────────
  if (suite.M3) {
    for (const rule of suite.M3.rules) {
      const rId = uniqueOwlId(rule.id, 'M3');
      lines.push(`  <owl:NamedIndividual rdf:ID="${escapeXml(rId)}">`);
      lines.push('    <rdf:type rdf:resource="http://ontology-plus.org/meta/v5#BusinessRule"/>');
      lines.push('    <onto:modelCode>M3</onto:modelCode>');
      lines.push(`    <rdfs:label xml:lang="zh">${escapeXml(rule.alias)}</rdfs:label>`);
      lines.push(`    <onto:ruleType>${escapeXml(rule.ruleType)}</onto:ruleType>`);
      lines.push(`    <onto:scope>${escapeXml(rule.scope)}</onto:scope>`);
      lines.push(`    <onto:expression>${escapeXml(rule.expression)}</onto:expression>`);
      lines.push('  </owl:NamedIndividual>');
    }
  }

  // ─── ME Event Model ─────────────────────────────────────────────────────────
  if (suite.ME) {
    for (const ev of suite.ME.events) {
      const evId = uniqueOwlId(ev.id, 'ME');
      lines.push(`  <owl:NamedIndividual rdf:ID="${escapeXml(evId)}">`);
      lines.push('    <rdf:type rdf:resource="http://ontology-plus.org/meta/v5#DomainEvent"/>');
      lines.push('    <onto:modelCode>ME</onto:modelCode>');
      lines.push(`    <rdfs:label xml:lang="zh">${escapeXml(ev.label)}</rdfs:label>`);
      lines.push(`    <onto:eventName>${escapeXml(ev.name)}</onto:eventName>`);
      lines.push(`    <onto:producerType>${escapeXml(ev.producerType)}</onto:producerType>`);
      lines.push(
        `    <onto:producerRef>${escapeXml(ev.producerRuleRef || ev.producerBehaviorRef)}</onto:producerRef>`,
      );
      lines.push(`    <onto:sourceAggregate>${escapeXml(ev.sourceAggregate)}</onto:sourceAggregate>`);
      lines.push('  </owl:NamedIndividual>');
    }
  }

  // ─── M4 Scenario Model ──────────────────────────────────────────────────────
  if (suite.M4) {
    for (const sc of suite.M4.event_scenarios) {
      const scId = uniqueOwlId(sc.id, 'M4');
      lines.push(`  <owl:NamedIndividual rdf:ID="${escapeXml(scId)}">`);
      lines.push('    <rdf:type rdf:resource="http://ontology-plus.org/meta/v5#EventScenario"/>');
      lines.push('    <onto:modelCode>M4</onto:modelCode>');
      lines.push(`    <rdfs:label xml:lang="zh">${escapeXml(sc.name)}</rdfs:label>`);
      lines.push(`    <onto:triggerEventRef>${escapeXml(sc.triggerEventRef)}</onto:triggerEventRef>`);
      for (const agg of sc.involvedAggregates) {
        lines.push(`    <onto:involvedAggregate>${escapeXml(agg)}</onto:involvedAggregate>`);
      }
      lines.push('  </owl:NamedIndividual>');
    }
  }

  // ─── M5 Actor Model ─────────────────────────────────────────────────────────
  if (suite.M5) {
    for (const actor of suite.M5.actors) {
      const aId = uniqueOwlId(actor.id, 'M5');
      lines.push(`  <owl:NamedIndividual rdf:ID="${escapeXml(aId)}">`);
      lines.push('    <rdf:type rdf:resource="http://ontology-plus.org/meta/v5#Actor"/>');
      lines.push('    <onto:modelCode>M5</onto:modelCode>');
      lines.push(`    <rdfs:label xml:lang="zh">${escapeXml(actor.name)}</rdfs:label>`);
      lines.push(`    <onto:actorType>${escapeXml(actor.actorType)}</onto:actorType>`);
      lines.push('  </owl:NamedIndividual>');
    }
    for (const role of suite.M5.roles) {
      const rId = uniqueOwlId(role.id, 'M5');
      lines.push(`  <owl:NamedIndividual rdf:ID="${escapeXml(rId)}">`);
      lines.push('    <rdf:type rdf:resource="http://ontology-plus.org/meta/v5#Role"/>');
      lines.push('    <onto:modelCode>M5</onto:modelCode>');
      lines.push(`    <rdfs:label xml:lang="zh">${escapeXml(role.name)}</rdfs:label>`);
      lines.push(`    <onto:roleCode>${escapeXml(role.code)}</onto:roleCode>`);
      lines.push(`    <onto:dataScope>${escapeXml(role.dataScope)}</onto:dataScope>`);
      for (const parentId of role.inheritsFrom) {
        lines.push(`    <onto:inheritsFrom>${escapeXml(parentId)}</onto:inheritsFrom>`);
      }
      lines.push('  </owl:NamedIndividual>');
    }
    for (const perm of suite.M5.permissions) {
      const pId = uniqueOwlId(perm.id, 'M5');
      lines.push(`  <owl:NamedIndividual rdf:ID="${escapeXml(pId)}">`);
      lines.push('    <rdf:type rdf:resource="http://ontology-plus.org/meta/v5#Permission"/>');
      lines.push('    <onto:modelCode>M5</onto:modelCode>');
      lines.push(`    <rdfs:label xml:lang="zh">${escapeXml(perm.name)}</rdfs:label>`);
      lines.push(`    <onto:permissionCode>${escapeXml(perm.code)}</onto:permissionCode>`);
      lines.push(`    <onto:targetAggregate>${escapeXml(perm.targetAggregate)}</onto:targetAggregate>`);
      lines.push('  </owl:NamedIndividual>');
    }
  }

  // ─── M6 Flow Model ──────────────────────────────────────────────────────────
  if (suite.M6) {
    for (const fl of suite.M6.flows) {
      const flId = uniqueOwlId(fl.id, 'M6');
      lines.push(`  <owl:NamedIndividual rdf:ID="${escapeXml(flId)}">`);
      lines.push('    <rdf:type rdf:resource="http://ontology-plus.org/meta/v5#BusinessFlow"/>');
      lines.push('    <onto:modelCode>M6</onto:modelCode>');
      lines.push(`    <rdfs:label xml:lang="zh">${escapeXml(fl.name)}</rdfs:label>`);
      lines.push(`    <onto:flowType>${escapeXml(fl.flowType)}</onto:flowType>`);
      lines.push(`    <onto:primaryAggregate>${escapeXml(fl.primaryAggregate)}</onto:primaryAggregate>`);
      for (const act of fl.activities) {
        lines.push(`    <onto:flowActivity>${escapeXml(`${act.id}:${act.activityType}`)}</onto:flowActivity>`);
      }
      lines.push('  </owl:NamedIndividual>');
    }
  }

  // ─── M7 Query & Report Model ────────────────────────────────────────────────
  if (suite.M7) {
    for (const qr of suite.M7.query_reports) {
      const qrId = uniqueOwlId(qr.id, 'M7');
      lines.push(`  <owl:NamedIndividual rdf:ID="${escapeXml(qrId)}">`);
      lines.push('    <rdf:type rdf:resource="http://ontology-plus.org/meta/v5#QueryReport"/>');
      lines.push('    <onto:modelCode>M7</onto:modelCode>');
      lines.push(`    <rdfs:label xml:lang="zh">${escapeXml(qr.alias || qr.name)}</rdfs:label>`);
      lines.push(`    <onto:queryType>${escapeXml(qr.queryType)}</onto:queryType>`);
      lines.push(`    <onto:behaviorRef>${escapeXml(qr.behaviorRef)}</onto:behaviorRef>`);
      lines.push(
        `    <onto:primarySource>${escapeXml(qr.primarySource.aggregateRef)}</onto:primarySource>`,
      );
      lines.push(`    <onto:referenceSql>${escapeXml(qr.referenceSql.sql)}</onto:referenceSql>`);
      lines.push('  </owl:NamedIndividual>');
    }
  }

  // ─── MU UI Model ────────────────────────────────────────────────────────────
  if (suite.MU) {
    for (const sc of suite.MU.screens) {
      const scId = uniqueOwlId(sc.screenId, 'MU');
      lines.push(`  <owl:NamedIndividual rdf:ID="${escapeXml(scId)}">`);
      lines.push('    <rdf:type rdf:resource="http://ontology-plus.org/meta/v5#UIScreen"/>');
      lines.push('    <onto:modelCode>MU</onto:modelCode>');
      lines.push(`    <rdfs:label xml:lang="zh">${escapeXml(sc.name)}</rdfs:label>`);
      lines.push(`    <onto:screenType>${escapeXml(sc.screenType)}</onto:screenType>`);
      if (sc.route) {
        lines.push(`    <onto:route>${escapeXml(sc.route)}</onto:route>`);
      }
      lines.push('  </owl:NamedIndividual>');
    }
  }

  // ─── MM Mapping Model ───────────────────────────────────────────────────────
  if (suite.MM) {
    for (const mp of suite.MM.mappings) {
      const mpId = uniqueOwlId(mp.id, 'MM');
      lines.push(`  <owl:NamedIndividual rdf:ID="${escapeXml(mpId)}">`);
      lines.push('    <rdf:type rdf:resource="http://ontology-plus.org/meta/v5#ObjectTableMapping"/>');
      lines.push('    <onto:modelCode>MM</onto:modelCode>');
      lines.push(`    <rdfs:label xml:lang="zh">${escapeXml(mp.objectName)}</rdfs:label>`);
      lines.push(`    <onto:objectRef>${escapeXml(mp.objectRef)}</onto:objectRef>`);
      for (const tm of mp.tableMappings) {
        lines.push(`    <onto:tableName>${escapeXml(tm.tableName)}</onto:tableName>`);
      }
      lines.push('  </owl:NamedIndividual>');
    }
  }

  // ─── MI Interface Model ─────────────────────────────────────────────────────
  if (suite.MI) {
    for (const iface of suite.MI.interfaces) {
      const ifId = uniqueOwlId(iface.interfaceId, 'MI');
      lines.push(`  <owl:NamedIndividual rdf:ID="${escapeXml(ifId)}">`);
      lines.push('    <rdf:type rdf:resource="http://ontology-plus.org/meta/v5#ServiceInterface"/>');
      lines.push('    <onto:modelCode>MI</onto:modelCode>');
      lines.push(`    <rdfs:label xml:lang="zh">${escapeXml(iface.name)}</rdfs:label>`);
      lines.push(`    <onto:direction>${escapeXml(iface.direction)}</onto:direction>`);
      lines.push(
        `    <onto:interfaceCategory>${escapeXml(iface.interfaceCategory)}</onto:interfaceCategory>`,
      );
      lines.push(`    <onto:protocol>${escapeXml(iface.protocol)}</onto:protocol>`);
      lines.push('  </owl:NamedIndividual>');
    }
  }

  lines.push('</rdf:RDF>');
  return lines.join('\n');
}

function getAttr(tagHtml: string, attrName: string): string | undefined {
  const regex = new RegExp(`\\b${attrName}\\s*=\\s*["']([^"']+)["']`, 'i');
  const match = tagHtml.match(regex);
  return match ? match[1] : undefined;
}

export function extractMuFromPrototypeHtml(html: string, domain: string): MUUiModel {
  const screens: ScreenItem[] = [];
  const navigationEdges: NavigationEdge[] = [];
  let navSeq = 1;

  const screenRegex =
    /<([a-z0-9]+)\b[^>]*data-screen-id\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)(?=<[a-z0-9]+\b[^>]*data-screen-id|$)/gi;

  let screenMatch: RegExpExecArray | null;
  while ((screenMatch = screenRegex.exec(html)) !== null) {
    const openingTag = screenMatch[0].slice(0, screenMatch[0].indexOf('>') + 1);
    const screenBody = screenMatch[0];
    const screenId = screenMatch[2];
    const screenRef = getAttr(openingTag, 'data-screen-ref') || screenId;
    const screenName = getAttr(openingTag, 'data-screen-name') || screenId;
    const rawType = (getAttr(openingTag, 'data-screen-type') || 'LIST').toUpperCase() as ScreenItem['screenType'];
    const screenType: ScreenItem['screenType'] = VALID_SCREEN_TYPES.has(rawType) ? rawType : 'LIST';
    const route = getAttr(openingTag, 'data-route') || `/${screenId.toLowerCase()}`;
    const rawRoleRefs = getAttr(openingTag, 'data-role-refs');
    const roleRefs = rawRoleRefs
      ? rawRoleRefs
          .split(',')
          .map((r) => r.trim())
          .filter(Boolean)
      : [];

    const elements: UIElement[] = [];
    const events: UIEvent[] = [];

    const elRegex = /<([a-z0-9]+)\b[^>]*data-element-id\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let elMatch: RegExpExecArray | null;
    while ((elMatch = elRegex.exec(screenBody)) !== null) {
      const elTag = elMatch[0];
      const elementId = elMatch[2];
      const label = getAttr(elTag, 'data-element-label') || elementId;
      const name = getAttr(elTag, 'data-element-name') || elementId.toLowerCase().replace(/-/g, '_');
      const rawElType = (getAttr(elTag, 'data-element-type') || 'INPUT').toUpperCase() as UIElement['elementType'];
      const elementType: UIElement['elementType'] = VALID_ELEMENT_TYPES.has(rawElType)
        ? rawElType
        : 'INPUT';

      const rawActionType = getAttr(elTag, 'data-action-type')?.toUpperCase() as
        | NonNullable<UIElement['actionType']>
        | undefined;
      const actionType =
        rawActionType && VALID_ACTION_TYPES.has(rawActionType) ? rawActionType : undefined;

      const isRequired =
        getAttr(elTag, 'data-required') === 'true' || /\srequired(?:\s|=|>|\/)/i.test(elTag);
      const dataBinding = getAttr(elTag, 'data-binding');
      const dictionaryRef = getAttr(elTag, 'data-dictionary-ref');
      const dataSource = getAttr(elTag, 'data-source');
      const permissionRef = getAttr(elTag, 'data-permission-ref');

      elements.push({
        elementId,
        name,
        label,
        elementType,
        io:
          elementType === 'BUTTON' || elementType === 'TOOLBAR' || elementType === 'MENU'
            ? 'ACTION'
            : elementType === 'TABLE' ||
                elementType === 'GRID' ||
                elementType === 'BADGE' ||
                elementType === 'REPORT_VIEWER' ||
                elementType === 'VIEWER'
              ? 'OUT'
              : 'IN_OUT',
        ...(actionType ? { actionType } : {}),
        required: isRequired,
        ...(dataBinding ? { dataBinding } : {}),
        ...(dictionaryRef ? { dictionaryRef } : {}),
        ...(dataSource ? { dataSource } : {}),
        ...(permissionRef ? { permissionRef } : {}),
      });

      const explicitEventId = getAttr(elTag, 'data-event-id');
      const navigateTo = getAttr(elTag, 'data-navigate-to');
      const eventId =
        explicitEventId || (navigateTo ? `UIE-NAV-${elementId}` : undefined);

      if (eventId) {
        const eventName = getAttr(elTag, 'data-event-name') || `${label}事件`;
        const validateRefsRaw =
          getAttr(elTag, 'data-validate-ref') || getAttr(elTag, 'data-rule-ref');
        const behaviorRef = getAttr(elTag, 'data-behavior-ref');
        const emitEventRef = getAttr(elTag, 'data-emit-event-ref');
        const scenarioRef = getAttr(elTag, 'data-scenario-ref');
        const reportRef = getAttr(elTag, 'data-report-ref');

        // Strictly ordered per §10.4.3:
        // VALIDATE (1) -> BEHAVIOR_CALL (2) -> EVENT_EMIT (3) -> SCENARIO_CALL (4) -> REPORT_CALL (5) -> NAVIGATE (6)
        const callChain: UIEvent['callChain'] = [];
        let order = 1;

        if (validateRefsRaw) {
          const ruleList = validateRefsRaw
            .split(',')
            .map((r) => r.trim())
            .filter(Boolean);
          for (const rId of ruleList) {
            callChain.push({ stepOrder: order++, stepType: 'VALIDATE', refId: rId });
          }
        }
        if (behaviorRef) {
          callChain.push({ stepOrder: order++, stepType: 'BEHAVIOR_CALL', refId: behaviorRef });
        }
        if (emitEventRef) {
          callChain.push({ stepOrder: order++, stepType: 'EVENT_EMIT', refId: emitEventRef });
        }
        if (scenarioRef) {
          callChain.push({ stepOrder: order++, stepType: 'SCENARIO_CALL', refId: scenarioRef });
        }
        if (reportRef) {
          callChain.push({ stepOrder: order++, stepType: 'REPORT_CALL', refId: reportRef });
        }
        if (navigateTo) {
          callChain.push({ stepOrder: order++, stepType: 'NAVIGATE', refId: navigateTo });
          const rawNavMode = (getAttr(elTag, 'data-navigate-mode') || 'PUSH').toUpperCase();
          const mode: NavigationEdge['mode'] =
            rawNavMode === 'MODAL' || rawNavMode === 'REPLACE' || rawNavMode === 'BACK'
              ? rawNavMode
              : 'PUSH';
          navigationEdges.push({
            id: `NAV-${String(navSeq++).padStart(2, '0')}`,
            fromScreen: screenId,
            toScreen: navigateTo,
            triggerEventId: eventId,
            mode,
          });
        }

        events.push({
          eventId,
          name: eventName,
          triggerElementId: elementId,
          triggerAction: elementType === 'BUTTON' ? 'CLICK' : 'CHANGE',
          permissions: permissionRef ? [permissionRef] : [],
          callChain,
        });
      }
    }

    // Build deterministic ASCII wireframe layout marking required inputs with [elementId*]
    const layoutLines: string[] = [
      '+------------------------------------------------------------------+',
      `| ${screenName} (${screenId})`,
      '+------------------------------------------------------------------+',
    ];
    for (const el of elements) {
      const reqStar = el.required ? '*' : '';
      layoutLines.push(`| [${el.elementId}${reqStar}] ${el.label} — ${el.elementType}`);
    }
    layoutLines.push('+------------------------------------------------------------------+');

    screens.push({
      screenId,
      screenRef,
      name: screenName,
      screenType,
      route,
      roleRefs,
      layout: layoutLines.join('\n'),
      elements,
      events,
    });
  }

  return {
    model_type: 'UI',
    version: '5.0',
    domain,
    screens,
    navigation_edges: navigationEdges,
    cross_cutting_ui: [],
  };
}
