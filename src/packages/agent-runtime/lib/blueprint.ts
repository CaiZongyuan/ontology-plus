import type { OntologySuite } from '../../ontology-core/index.js';
import { applyOntologyToolCall } from './tools.js';

export interface LlmSynthesizedDomainBlueprint {
  aggregates?: {
    sourceQuote?: string;
    id?: string;
    name: string;
    alias?: string;
    lifecycle?: string[];
    attributes?: { name: string; label?: string; type?: string; required?: boolean }[];
  }[];
  behaviors?: {
    sourceQuote?: string;
    id?: string;
    name: string;
    alias?: string;
    ownerEntity?: string;
    behaviorType?: 'COMMAND' | 'QUERY';
  }[];
  rules?: {
    sourceQuote?: string;
    id?: string;
    name?: string;
    alias?: string;
    ruleType?: 'VALIDATION' | 'CALCULATION' | 'STATE_TRANSITION' | 'COORDINATION';
    referencedObjects?: string[];
    expression?: string;
    violationMessage?: string;
  }[];
  events?: {
    sourceQuote?: string;
    id?: string;
    name: string;
    label?: string;
    sourceAggregate?: string;
  }[];
  actors?: {
    sourceQuote?: string;
    actorId?: string;
    actorName?: string;
    actorType?: 'HUMAN' | 'SYSTEM' | 'EXTERNAL_ENTITY' | 'TIMER';
    roleId?: string;
    roleName?: string;
    roleCode?: string;
  }[];
  flows?: {
    sourceQuote?: string;
    id?: string;
    name: string;
    flowType?: 'APPROVAL' | 'COLLABORATION' | 'SCHEDULED';
    primaryAggregate?: string;
  }[];
  interfaces?: {
    sourceQuote?: string;
    interfaceId?: string;
    name: string;
    direction?: 'PROVIDED' | 'DEPENDENT';
    interfaceCategory?: 'COMMAND' | 'QUERY' | 'EVENT_SUB' | 'EXTERNAL_GATEWAY';
    protocol?: 'REST' | 'RPC' | 'MQ' | 'MCP';
    relatedEntityRef?: string;
  }[];
}

export function applyLlmBlueprintToSuite(
  baseSuite: OntologySuite,
  blueprint: LlmSynthesizedDomainBlueprint,
  domain: string,
  options?: { nonCollidingDocIds?: boolean },
): OntologySuite {
  let working: OntologySuite = JSON.parse(JSON.stringify(baseSuite));
  const docMode = Boolean(options?.nonCollidingDocIds);
  const nextDocId = (prefix: string, usedIds: Set<string>): string => {
    let n = 1;
    while (usedIds.has(`${prefix}-${String(n).padStart(2, '0')}`)) n += 1;
    const id = `${prefix}-${String(n).padStart(2, '0')}`;
    usedIds.add(id);
    return id;
  };
  const usedAggIds = new Set((baseSuite.M1?.aggregates ?? []).map((a) => a.id));
  const usedActorIds = new Set((baseSuite.M5?.actors ?? []).map((a) => a.id));
  const usedRoleIds = new Set((baseSuite.M5?.roles ?? []).map((r) => r.id));
  const usedBehIds = new Set((baseSuite.M2?.behaviors ?? []).map((b) => b.id));
  const usedRuleIds = new Set((baseSuite.M3?.rules ?? []).map((r) => r.id));
  const usedEvtIds = new Set((baseSuite.ME?.events ?? []).map((e) => e.id));
  const usedFlwIds = new Set((baseSuite.M6?.flows ?? []).map((f) => f.id));
  const usedIfIds = new Set((baseSuite.MI?.interfaces ?? []).map((i) => i.interfaceId));

  for (const [idx, agg] of (blueprint.aggregates ?? []).slice(0, 8).entries()) {
    if (!agg?.name) continue;
    const cleanName = agg.name.replace(/[^A-Za-z0-9_]/g, '');
    let aggId = agg.id || `AGG-0${idx + 1}`;
    if (docMode) {
      const existingByName = baseSuite.M1?.aggregates.find((a) => a.name === cleanName);
      if (existingByName) {
        aggId = existingByName.id;
      } else if (agg.id && !usedAggIds.has(agg.id)) {
        aggId = agg.id;
        usedAggIds.add(aggId);
      } else {
        aggId = nextDocId('AGG-DOC', usedAggIds);
      }
    }
    try {
      working = applyOntologyToolCall(
        working,
        'upsert_aggregate',
        {
          id: aggId,
          name: cleanName,
          alias: agg.alias || agg.name,
          lifecycle: agg.lifecycle,
          attributes: agg.attributes,
        },
        domain,
      ).nextSuite;
    } catch {
      // Skip malformed item; validator gate guards final suite
    }
  }

  for (const [idx, act] of (blueprint.actors ?? []).slice(0, 6).entries()) {
    if (!act?.actorName && !act?.roleName) continue;
    const targetActorName = (act.actorName || act.roleName || '').trim();
    const targetRoleName = (act.roleName || act.actorName || '').trim();
    let actorId = act.actorId || `ACT-0${idx + 1}`;
    let roleId = act.roleId || `ROLE-0${idx + 1}`;
    if (docMode) {
      const existingActor = baseSuite.M5?.actors.find(
        (a) => a.name === targetActorName && (!act.actorId || a.id === act.actorId),
      );
      if (existingActor) {
        actorId = existingActor.id;
      } else if (act.actorId && !usedActorIds.has(act.actorId)) {
        actorId = act.actorId;
        usedActorIds.add(actorId);
      } else {
        actorId = nextDocId('ACT-DOC', usedActorIds);
      }

      const existingRole = baseSuite.M5?.roles.find(
        (r) => r.name === targetRoleName && (!act.roleId || r.id === act.roleId),
      );
      if (existingRole) {
        roleId = existingRole.id;
      } else if (act.roleId && !usedRoleIds.has(act.roleId)) {
        roleId = act.roleId;
        usedRoleIds.add(roleId);
      } else {
        roleId = nextDocId('ROLE-DOC', usedRoleIds);
      }
    }
    try {
      working = applyOntologyToolCall(
        working,
        'upsert_actor_role',
        {
          actorId,
          actorName: act.actorName || act.roleName,
          actorType: act.actorType || 'HUMAN',
          roleId,
          roleName: act.roleName || act.actorName,
          roleCode: act.roleCode,
        },
        domain,
      ).nextSuite;
    } catch {
      // Skip malformed item
    }
  }

  for (const [idx, beh] of (blueprint.behaviors ?? []).slice(0, 10).entries()) {
    if (!beh?.name) continue;
    const cleanBehName = beh.name.replace(/[^A-Za-z0-9_]/g, '');
    let behId = beh.id || `BHV-0${idx + 1}`;
    if (docMode) {
      const existingBeh = baseSuite.M2?.behaviors.find(
        (b) => b.name === cleanBehName && (!beh.id || b.id === beh.id),
      );
      if (existingBeh) {
        behId = existingBeh.id;
      } else if (beh.id && !usedBehIds.has(beh.id)) {
        behId = beh.id;
        usedBehIds.add(behId);
      } else {
        behId = nextDocId('BHV-DOC', usedBehIds);
      }
    }
    try {
      working = applyOntologyToolCall(
        working,
        'upsert_behavior',
        {
          id: behId,
          name: cleanBehName,
          alias: beh.alias || beh.name,
          ownerEntity: beh.ownerEntity,
          behaviorType: beh.behaviorType || 'COMMAND',
        },
        domain,
      ).nextSuite;
    } catch {
      // Skip malformed item
    }
  }

  for (const [idx, rl] of (blueprint.rules ?? []).slice(0, 10).entries()) {
    if (!rl?.alias && !rl?.name) continue;
    const cleanRuleName = (rl.name || `DomainRule0${idx + 1}`).replace(/[^A-Za-z0-9_]/g, '');
    let ruleId = rl.id || `RULE-0${idx + 1}`;
    if (docMode) {
      const existingRule = baseSuite.M3?.rules.find(
        (r) =>
          ((rl.name && r.name === cleanRuleName) || (rl.alias && r.alias === rl.alias)) &&
          (!rl.id || r.id === rl.id),
      );
      if (existingRule) {
        ruleId = existingRule.id;
      } else if (rl.id && !usedRuleIds.has(rl.id)) {
        ruleId = rl.id;
        usedRuleIds.add(ruleId);
      } else {
        ruleId = nextDocId('RULE-DOC', usedRuleIds);
      }
    }
    try {
      working = applyOntologyToolCall(
        working,
        'upsert_rule',
        {
          id: ruleId,
          name: cleanRuleName,
          alias: rl.alias || rl.name,
          ruleType: rl.ruleType || 'VALIDATION',
          referencedObjects: rl.referencedObjects,
          expression: rl.expression,
          violationMessage: rl.violationMessage,
        },
        domain,
      ).nextSuite;
    } catch {
      // Skip malformed item
    }
  }

  for (const [idx, ev] of (blueprint.events ?? []).slice(0, 8).entries()) {
    if (!ev?.name) continue;
    let evtId = ev.id || `EVT-0${idx + 1}`;
    if (docMode) {
      const existingEv = baseSuite.ME?.events.find(
        (e) => e.name === ev.name && (!ev.id || e.id === ev.id),
      );
      if (existingEv) {
        evtId = existingEv.id;
      } else if (ev.id && !usedEvtIds.has(ev.id)) {
        evtId = ev.id;
        usedEvtIds.add(evtId);
      } else {
        evtId = nextDocId('EVT-DOC', usedEvtIds);
      }
    }
    try {
      working = applyOntologyToolCall(
        working,
        'upsert_event',
        {
          id: evtId,
          name: ev.name,
          label: ev.label || ev.name,
          sourceAggregate: ev.sourceAggregate,
        },
        domain,
      ).nextSuite;
    } catch {
      // Skip malformed item
    }
  }

  for (const [idx, fl] of (blueprint.flows ?? []).slice(0, 4).entries()) {
    if (!fl?.name) continue;
    let flwId = fl.id || `FLW-0${idx + 1}`;
    if (docMode) {
      const existingFl = baseSuite.M6?.flows.find(
        (f) => f.name === fl.name && (!fl.id || f.id === fl.id),
      );
      if (existingFl) {
        flwId = existingFl.id;
      } else if (fl.id && !usedFlwIds.has(fl.id)) {
        flwId = fl.id;
        usedFlwIds.add(flwId);
      } else {
        flwId = nextDocId('FLW-DOC', usedFlwIds);
      }
    }
    try {
      working = applyOntologyToolCall(
        working,
        'upsert_flow',
        {
          id: flwId,
          name: fl.name,
          flowType: fl.flowType,
          primaryAggregate: fl.primaryAggregate,
        },
        domain,
      ).nextSuite;
    } catch {
      // Skip malformed item
    }
  }

  for (const [idx, itf] of (blueprint.interfaces ?? []).slice(0, 8).entries()) {
    if (!itf?.name) continue;
    let ifId = itf.interfaceId || `IF-0${idx + 1}`;
    if (docMode) {
      const existingItf = baseSuite.MI?.interfaces.find(
        (i) => i.name === itf.name && (!itf.interfaceId || i.interfaceId === itf.interfaceId),
      );
      if (existingItf) {
        ifId = existingItf.interfaceId;
      } else if (itf.interfaceId && !usedIfIds.has(itf.interfaceId)) {
        ifId = itf.interfaceId;
        usedIfIds.add(ifId);
      } else {
        ifId = nextDocId('IF-DOC', usedIfIds);
      }
    }
    try {
      working = applyOntologyToolCall(
        working,
        'upsert_interface',
        {
          interfaceId: ifId,
          name: itf.name,
          direction: itf.direction || 'PROVIDED',
          interfaceCategory: itf.interfaceCategory || 'COMMAND',
          protocol: itf.protocol || 'REST',
          relatedEntityRef: itf.relatedEntityRef,
        },
        domain,
      ).nextSuite;
    } catch {
      // Skip malformed item
    }
  }

  return working;
}
