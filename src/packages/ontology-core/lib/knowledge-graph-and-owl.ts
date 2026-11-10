import type {
  KnowledgeGraphData,
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  MUUiModel,
  OntologySuite,
  ScreenItem,
  UIElement,
  UIEvent,
} from './types.js';

export function buildKnowledgeGraph(suite: OntologySuite): KnowledgeGraphData {
  const nodes: KnowledgeGraphNode[] = [];
  const edges: KnowledgeGraphEdge[] = [];
  const nodeIds = new Set<string>();

  const addNode = (node: KnowledgeGraphNode) => {
    if (!nodeIds.has(node.id)) {
      nodeIds.add(node.id);
      nodes.push(node);
    }
  };

  const addEdge = (
    source: string,
    target: string,
    relation: string,
    labelZh: string,
    labelEn: string,
  ) => {
    if (!source || !target) return;
    const id = `${source}--${relation}-->${target}`;
    if (!edges.some((e) => e.id === id)) {
      edges.push({ id, source, target, relation, labelZh, labelEn });
    }
  };

  // M1
  if (suite.M1) {
    for (const agg of suite.M1.aggregates) {
      addNode({
        id: agg.name,
        label: agg.alias || agg.name,
        subLabel: agg.name,
        model: 'M1',
        category: 'AGGREGATE_ROOT',
        metadata: { id: agg.id, lifecycle: agg.lifecycle, attributeCount: agg.attributes.length },
      });
      for (const ent of agg.entities) {
        const entId = `${agg.name}.${ent.name}`;
        addNode({
          id: entId,
          label: ent.alias || ent.name,
          subLabel: entId,
          model: 'M1',
          category: 'SUB_ENTITY',
        });
        addEdge(agg.name, entId, 'CONTAINS_ENTITY', '包含子实体', 'Contains Sub-Entity');
      }
      for (const vo of agg.valueObjects) {
        const voId = `${agg.name}.${vo.name}`;
        addNode({
          id: voId,
          label: vo.alias || vo.name,
          subLabel: voId,
          model: 'M1',
          category: 'VALUE_OBJECT',
        });
        addEdge(agg.name, voId, 'HAS_VALUE_OBJECT', '使用值对象', 'Uses Value Object');
      }
    }
    for (const assoc of suite.M1.aggregate_associations) {
      addEdge(
        assoc.sourceAggregate,
        assoc.targetAggregate,
        assoc.associationType,
        `关联 (${assoc.cardinality})`,
        `Assocs (${assoc.cardinality})`,
      );
    }
  }

  // M2
  if (suite.M2) {
    for (const beh of suite.M2.behaviors) {
      addNode({
        id: beh.id,
        label: beh.alias || beh.name,
        subLabel: `${beh.id} · ${beh.behaviorType}`,
        model: 'M2',
        category: beh.behaviorType,
        metadata: { name: beh.name, ownerEntity: beh.ownerEntity },
      });
      const ownerAgg = beh.ownerEntity.split('.')[0];
      addEdge(ownerAgg, beh.id, 'OWNS_BEHAVIOR', '拥有行为', 'Owns Behavior');
      for (const ruleId of beh.invokedRules) {
        addEdge(beh.id, ruleId, 'INVOKES_RULE', '调用规则', 'Invokes Rule');
      }
      for (const evRef of beh.producedEvents) {
        const evId = typeof evRef === 'string' ? evRef : evRef.eventRef;
        addEdge(beh.id, evId, 'PRODUCES_EVENT', '产生事件', 'Produces Event');
      }
      if (beh.queryReportRef) {
        addEdge(beh.id, beh.queryReportRef, 'MAPS_REPORT', '关联查询报表', 'Links Report');
      }
    }
  }

  // M3
  if (suite.M3) {
    for (const rule of suite.M3.rules) {
      addNode({
        id: rule.id,
        label: rule.alias || rule.name,
        subLabel: `${rule.id} · ${rule.ruleType}`,
        model: 'M3',
        category: rule.ruleType,
      });
      for (const obj of rule.referencedObjects) {
        addEdge(rule.id, obj.split('.')[0], 'CONSTRAINS_OBJECT', '约束对象', 'Constrains Object');
      }
      for (const evId of rule.producedEvents) {
        addEdge(rule.id, evId, 'PRODUCES_EVENT', '触发事件', 'Produces Event');
      }
    }
  }

  // ME
  if (suite.ME) {
    for (const ev of suite.ME.events) {
      addNode({
        id: ev.id,
        label: ev.label || ev.name,
        subLabel: ev.id,
        model: 'ME',
        category: 'DOMAIN_EVENT',
      });
      addEdge(ev.id, ev.sourceAggregate, 'EVENT_SOURCE', '源聚合根', 'Source Aggregate');
      for (const sub of ev.subscribers) {
        addEdge(ev.id, sub.subscriberRef, 'TRIGGERS_SUBSCRIBER', '触发订阅方', 'Triggers Subscriber');
      }
    }
  }

  // M4
  if (suite.M4) {
    for (const sc of suite.M4.event_scenarios) {
      addNode({
        id: sc.id,
        label: sc.name,
        subLabel: sc.id,
        model: 'M4',
        category: 'SCENARIO',
      });
      addEdge(sc.triggerEventRef, sc.id, 'TRIGGERS_SCENARIO', '触发场景', 'Triggers Scenario');
      for (const st of sc.steps) {
        addEdge(sc.id, st.refId, 'SCENARIO_STEP', `步骤 ${st.stepOrder}`, `Step ${st.stepOrder}`);
      }
    }
  }

  // M5
  if (suite.M5) {
    for (const role of suite.M5.roles) {
      addNode({
        id: role.id,
        label: role.name,
        subLabel: role.code,
        model: 'M5',
        category: 'ROLE',
      });
      for (const permId of role.permissions) {
        addEdge(role.id, permId, 'GRANTS_PERMISSION', '授予权限', 'Grants Permission');
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
      addEdge(perm.id, perm.targetAggregate, 'GOVERNS_AGGREGATE', '管控聚合根', 'Governs Aggregate');
      for (const behId of perm.allowedBehaviors) {
        addEdge(perm.id, behId, 'ALLOWS_BEHAVIOR', '允许行为', 'Allows Behavior');
      }
    }
  }

  // M6
  if (suite.M6) {
    for (const fl of suite.M6.flows) {
      addNode({
        id: fl.id,
        label: fl.name,
        subLabel: `${fl.id} · ${fl.flowType}`,
        model: 'M6',
        category: fl.flowType,
      });
      addEdge(fl.id, fl.primaryAggregate, 'ORCHESTRATES', '编排主聚合根', 'Orchestrates');
      for (const act of fl.activities) {
        if (act.behaviorRef) {
          addEdge(fl.id, act.behaviorRef, 'FLOW_CALLS_BEHAVIOR', '调用行为', 'Calls Behavior');
        }
        if (act.scenarioRef) {
          addEdge(fl.id, act.scenarioRef, 'FLOW_CALLS_SCENARIO', '调用场景', 'Calls Scenario');
        }
      }
    }
  }

  // M7
  if (suite.M7) {
    for (const rp of suite.M7.query_reports) {
      addNode({
        id: rp.id,
        label: rp.alias || rp.name,
        subLabel: `${rp.id} · ${rp.queryType}`,
        model: 'M7',
        category: rp.queryType,
      });
      addEdge(rp.id, rp.primarySource.aggregateRef, 'QUERIES_AGGREGATE', '查询主对象', 'Queries Aggregate');
    }
  }

  // MU
  if (suite.MU) {
    for (const sc of suite.MU.screens) {
      addNode({
        id: sc.screenId,
        label: sc.name,
        subLabel: `${sc.screenId} · ${sc.screenType}`,
        model: 'MU',
        category: sc.screenType,
      });
      for (const ev of sc.events) {
        for (const step of ev.callChain) {
          addEdge(sc.screenId, step.refId, 'UI_INVOKES', '界面触发', 'UI Invokes');
        }
      }
    }
  }

  // MM
  if (suite.MM) {
    for (const mp of suite.MM.mappings) {
      addNode({
        id: mp.id,
        label: `${mp.objectName} 映射`,
        subLabel: mp.tableMappings.map((t) => t.tableName).join(', '),
        model: 'MM',
        category: 'TABLE_MAPPING',
      });
      addEdge(mp.id, mp.objectName.split('.')[0], 'MAPS_TO_TABLE', '持久化映射', 'Persists');
    }
  }

  // MI
  if (suite.MI) {
    for (const iface of suite.MI.interfaces) {
      addNode({
        id: iface.interfaceId,
        label: iface.name,
        subLabel: `${iface.interfaceId} · ${iface.direction}`,
        model: 'MI',
        category: iface.direction,
      });
      if (iface.relatedBehaviorRef) {
        addEdge(iface.interfaceId, iface.relatedBehaviorRef, 'EXPOSES_BEHAVIOR', '暴露/调用行为', 'Links Behavior');
      }
      if (iface.relatedReportRef) {
        addEdge(iface.interfaceId, iface.relatedReportRef, 'EXPOSES_REPORT', '暴露查询报表', 'Exposes Report');
      }
    }
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

export function exportToOwl(suite: OntologySuite): string {
  const domain = suite.M1?.domain || 'OntologyPlusDomain';
  const baseIri = `http://ontology-plus.org/ontologies/${encodeURIComponent(domain)}`;
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
    `  <owl:Ontology rdf:about="${baseIri}">`,
    `    <rdfs:label>${escapeXml(domain)}</rdfs:label>`,
    '    <owl:versionInfo>5.0</owl:versionInfo>',
    '  </owl:Ontology>',
    '',
  ];

  // M1 Aggregates, Entities, ValueObjects, Attributes
  if (suite.M1) {
    for (const agg of suite.M1.aggregates) {
      lines.push(`  <owl:Class rdf:ID="${escapeXml(agg.name)}">`);
      lines.push(`    <rdfs:label xml:lang="zh">${escapeXml(agg.alias)}</rdfs:label>`);
      lines.push(`    <onto:modelCode>M1</onto:modelCode>`);
      lines.push(`    <onto:elementId>${escapeXml(agg.id)}</onto:elementId>`);
      if (agg.description) {
        lines.push(`    <rdfs:comment>${escapeXml(agg.description)}</rdfs:comment>`);
      }
      lines.push('  </owl:Class>');

      for (const attr of agg.attributes) {
        lines.push(`  <owl:DatatypeProperty rdf:ID="${escapeXml(agg.name)}_${escapeXml(attr.name)}">`);
        lines.push(`    <rdfs:domain rdf:resource="#${escapeXml(agg.name)}"/>`);
        lines.push(`    <rdfs:label xml:lang="zh">${escapeXml(attr.label)}</rdfs:label>`);
        lines.push(`    <onto:dataType>${escapeXml(attr.type)}</onto:dataType>`);
        lines.push('  </owl:DatatypeProperty>');
      }
    }

    for (const assoc of suite.M1.aggregate_associations) {
      lines.push(`  <owl:ObjectProperty rdf:ID="${escapeXml(assoc.id)}">`);
      lines.push(`    <rdfs:domain rdf:resource="#${escapeXml(assoc.sourceAggregate)}"/>`);
      lines.push(`    <rdfs:range rdf:resource="#${escapeXml(assoc.targetAggregate)}"/>`);
      lines.push(`    <onto:cardinality>${escapeXml(assoc.cardinality)}</onto:cardinality>`);
      lines.push('  </owl:ObjectProperty>');
    }
  }

  // M2 Behaviors as owl:NamedIndividual of onto:Behavior
  if (suite.M2) {
    for (const beh of suite.M2.behaviors) {
      lines.push(`  <owl:NamedIndividual rdf:ID="${escapeXml(beh.id)}">`);
      lines.push('    <rdf:type rdf:resource="http://ontology-plus.org/meta/v5#Behavior"/>');
      lines.push(`    <rdfs:label xml:lang="zh">${escapeXml(beh.alias)}</rdfs:label>`);
      lines.push(`    <onto:behaviorName>${escapeXml(beh.name)}</onto:behaviorName>`);
      lines.push(`    <onto:behaviorType>${escapeXml(beh.behaviorType)}</onto:behaviorType>`);
      lines.push(`    <onto:ownerEntity>${escapeXml(beh.ownerEntity)}</onto:ownerEntity>`);
      lines.push('  </owl:NamedIndividual>');
    }
  }

  // M3 Rules
  if (suite.M3) {
    for (const rule of suite.M3.rules) {
      lines.push(`  <owl:NamedIndividual rdf:ID="${escapeXml(rule.id)}">`);
      lines.push('    <rdf:type rdf:resource="http://ontology-plus.org/meta/v5#BusinessRule"/>');
      lines.push(`    <rdfs:label xml:lang="zh">${escapeXml(rule.alias)}</rdfs:label>`);
      lines.push(`    <onto:expression>${escapeXml(rule.expression)}</onto:expression>`);
      lines.push('  </owl:NamedIndividual>');
    }
  }

  // ME Events
  if (suite.ME) {
    for (const ev of suite.ME.events) {
      lines.push(`  <owl:NamedIndividual rdf:ID="${escapeXml(ev.id)}">`);
      lines.push('    <rdf:type rdf:resource="http://ontology-plus.org/meta/v5#DomainEvent"/>');
      lines.push(`    <rdfs:label xml:lang="zh">${escapeXml(ev.label)}</rdfs:label>`);
      lines.push(`    <onto:producerRef>${escapeXml(ev.producerBehaviorRef)}</onto:producerRef>`);
      lines.push('  </owl:NamedIndividual>');
    }
  }

  lines.push('</rdf:RDF>');
  return lines.join('\n');
}

function getAttr(tagHtml: string, attrName: string): string | undefined {
  const regex = new RegExp(`${attrName}\\s*=\\s*["']([^"']+)["']`, 'i');
  const match = tagHtml.match(regex);
  return match ? match[1] : undefined;
}

export function extractMuFromPrototypeHtml(html: string, domain: string): MUUiModel {
  const screens: ScreenItem[] = [];
  const screenRegex = /<([a-z0-9]+)\b[^>]*data-screen-id\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)(?=<[a-z0-9]+\b[^>]*data-screen-id|$)/gi;

  let screenMatch: RegExpExecArray | null;
  while ((screenMatch = screenRegex.exec(html)) !== null) {
    const openingTag = screenMatch[0].slice(0, screenMatch[0].indexOf('>') + 1);
    const screenBody = screenMatch[0];
    const screenId = screenMatch[2];
    const screenName = getAttr(openingTag, 'data-screen-name') || screenId;
    const rawType = (getAttr(openingTag, 'data-screen-type') || 'LIST').toUpperCase();
    const screenType = (
      ['LIST', 'FORM', 'DETAIL', 'APPROVAL', 'REPORT', 'DASHBOARD', 'MODAL'].includes(rawType)
        ? rawType
        : 'LIST'
    ) as ScreenItem['screenType'];
    const route = getAttr(openingTag, 'data-route') || `/${screenId.toLowerCase()}`;

    const elements: UIElement[] = [];
    const events: UIEvent[] = [];

    const elRegex = /<([a-z0-9]+)\b[^>]*data-element-id\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let elMatch: RegExpExecArray | null;
    while ((elMatch = elRegex.exec(screenBody)) !== null) {
      const elTag = elMatch[0];
      const elementId = elMatch[2];
      const label = getAttr(elTag, 'data-element-label') || elementId;
      const name = getAttr(elTag, 'data-element-name') || elementId.toLowerCase().replace(/-/g, '_');
      const rawElType = (getAttr(elTag, 'data-element-type') || 'INPUT').toUpperCase();
      const elementType = (
        [
          'INPUT',
          'SELECT',
          'DATE_PICKER',
          'NUMBER',
          'TABLE',
          'BUTTON',
          'TAB',
          'BADGE',
          'VIEWER',
          'CONTAINER',
        ].includes(rawElType)
          ? rawElType
          : 'INPUT'
      ) as UIElement['elementType'];
      const dataBinding = getAttr(elTag, 'data-binding');
      const dataSource = getAttr(elTag, 'data-source');
      const permissionRef = getAttr(elTag, 'data-permission-ref');

      elements.push({
        elementId,
        name,
        label,
        elementType,
        io: elementType === 'BUTTON' ? 'ACTION' : elementType === 'TABLE' ? 'OUT' : 'IN_OUT',
        required: getAttr(elTag, 'data-required') === 'true',
        dataBinding,
        dataSource,
        permissionRef,
      });

      const eventId = getAttr(elTag, 'data-event-id');
      if (eventId) {
        const eventName = getAttr(elTag, 'data-event-name') || `${label}事件`;
        const behaviorRef = getAttr(elTag, 'data-behavior-ref');
        const reportRef = getAttr(elTag, 'data-report-ref');
        const ruleRef = getAttr(elTag, 'data-rule-ref');
        const emitEventRef = getAttr(elTag, 'data-emit-event-ref');

        const callChain: UIEvent['callChain'] = [];
        let order = 1;
        if (ruleRef) {
          callChain.push({ stepOrder: order++, stepType: 'VALIDATE', refId: ruleRef });
        }
        if (behaviorRef) {
          callChain.push({ stepOrder: order++, stepType: 'BEHAVIOR_CALL', refId: behaviorRef });
        }
        if (reportRef) {
          callChain.push({ stepOrder: order++, stepType: 'REPORT_CALL', refId: reportRef });
        }
        if (emitEventRef) {
          callChain.push({ stepOrder: order++, stepType: 'EVENT_EMIT', refId: emitEventRef });
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

    // Build deterministic ASCII wireframe layout containing every [elementId]
    const layoutLines: string[] = [
      `+------------------------------------------------------------------+`,
      `| ${screenName} (${screenId})`,
      `+------------------------------------------------------------------+`,
    ];
    for (const el of elements) {
      layoutLines.push(`| [${el.elementId}] ${el.label} (${el.elementType})`);
    }
    layoutLines.push(`+------------------------------------------------------------------+`);

    screens.push({
      screenId,
      name: screenName,
      screenType,
      route,
      roleRefs: ['ROLE-CONTRACT-SPEC', 'ROLE-DEPT-MGR'],
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
    navigation_edges:
      screens.length >= 2
        ? [
            {
              id: 'NAV-AUTO-01',
              fromScreen: screens[0].screenId,
              toScreen: screens[1].screenId,
              mode: 'PUSH',
            },
          ]
        : [],
    cross_cutting_ui: [],
  };
}

