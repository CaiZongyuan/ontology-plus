import type {
  ImpactAnalysisReport,
  ImpactReference,
  ModelCode,
  OntologySuite,
} from './types.js';

function cloneSuite(suite: OntologySuite): OntologySuite {
  return JSON.parse(JSON.stringify(suite)) as OntologySuite;
}

function locateTargetInfo(
  suite: OntologySuite,
  targetId: string,
): { model: ModelCode; name: string } {
  if (suite.M1) {
    for (const agg of suite.M1.aggregates) {
      if (agg.id === targetId || agg.name === targetId) {
        return { model: 'M1', name: `${agg.name} (${agg.alias})` };
      }
      for (const ent of agg.entities) {
        if (ent.name === targetId || `${agg.name}.${ent.name}` === targetId) {
          return { model: 'M1', name: `${agg.name}.${ent.name} (${ent.alias})` };
        }
      }
      for (const vo of agg.valueObjects) {
        if (vo.name === targetId || `${agg.name}.${vo.name}` === targetId) {
          return { model: 'M1', name: `${agg.name}.${vo.name} (${vo.alias})` };
        }
      }
    }
    for (const dict of suite.M1.data_dictionaries) {
      if (dict.id === targetId) {
        return { model: 'M1', name: dict.name };
      }
    }
  }
  if (suite.M2) {
    for (const beh of suite.M2.behaviors) {
      if (beh.id === targetId || beh.name === targetId) {
        return { model: 'M2', name: `${beh.name} (${beh.alias})` };
      }
    }
  }
  if (suite.M3) {
    for (const rule of suite.M3.rules) {
      if (rule.id === targetId || rule.name === targetId) {
        return { model: 'M3', name: `${rule.name} (${rule.alias})` };
      }
    }
  }
  if (suite.ME) {
    for (const ev of suite.ME.events) {
      if (ev.id === targetId || ev.name === targetId) {
        return { model: 'ME', name: `${ev.name} (${ev.label})` };
      }
    }
  }
  if (suite.M4) {
    for (const sc of suite.M4.event_scenarios) {
      if (sc.id === targetId || sc.name === targetId) {
        return { model: 'M4', name: sc.name };
      }
    }
  }
  if (suite.M5) {
    for (const act of suite.M5.actors) {
      if (act.id === targetId) return { model: 'M5', name: act.name };
    }
    for (const role of suite.M5.roles) {
      if (role.id === targetId || role.code === targetId) return { model: 'M5', name: role.name };
    }
    for (const perm of suite.M5.permissions) {
      if (perm.id === targetId || perm.code === targetId) return { model: 'M5', name: perm.name };
    }
  }
  if (suite.M6) {
    for (const fl of suite.M6.flows) {
      if (fl.id === targetId || fl.name === targetId) return { model: 'M6', name: fl.name };
    }
  }
  if (suite.M7) {
    for (const rp of suite.M7.query_reports) {
      if (rp.id === targetId || rp.name === targetId) {
        return { model: 'M7', name: `${rp.name} (${rp.alias})` };
      }
    }
  }
  if (suite.MU) {
    for (const sc of suite.MU.screens) {
      if (sc.screenId === targetId) return { model: 'MU', name: sc.name };
      for (const el of sc.elements) {
        if (el.elementId === targetId) return { model: 'MU', name: `${sc.name}.${el.label}` };
      }
      for (const ev of sc.events) {
        if (ev.eventId === targetId) return { model: 'MU', name: `${sc.name}.${ev.name}` };
      }
    }
  }
  if (suite.MM) {
    for (const mp of suite.MM.mappings) {
      if (mp.id === targetId) return { model: 'MM', name: mp.objectName };
    }
  }
  if (suite.MI) {
    for (const iface of suite.MI.interfaces) {
      if (iface.interfaceId === targetId) return { model: 'MI', name: iface.name };
    }
  }
  return { model: 'M1', name: targetId };
}

function matchesSymbol(candidate: string | undefined, targetId: string): boolean {
  if (!candidate) return false;
  if (candidate === targetId) return true;
  if (candidate.startsWith(`${targetId}.`)) return true;
  return false;
}

export function analyzeImpact(suite: OntologySuite, targetId: string): ImpactAnalysisReport {
  const info = locateTargetInfo(suite, targetId);
  const references: ImpactReference[] = [];

  const pushRef = (
    model: ModelCode,
    elementId: string,
    elementName: string,
    fieldPath: string,
    descriptionZh: string,
    descriptionEn: string,
  ) => {
    references.push({
      model,
      elementId,
      elementName,
      fieldPath,
      descriptionZh,
      descriptionEn,
    });
  };

  // M1 internal references
  if (suite.M1) {
    for (const agg of suite.M1.aggregates) {
      for (const attr of agg.attributes) {
        if (matchesSymbol(attr.targetAggregate, targetId)) {
          pushRef(
            'M1',
            agg.id,
            agg.name,
            `aggregates[${agg.name}].attributes[${attr.name}].targetAggregate`,
            `聚合根 ${agg.name} 属性 ${attr.name} 引用目标聚合根`,
            `Aggregate ${agg.name} attribute ${attr.name} references target aggregate`,
          );
        }
        if (matchesSymbol(attr.valueObjectRef, targetId)) {
          pushRef(
            'M1',
            agg.id,
            agg.name,
            `aggregates[${agg.name}].attributes[${attr.name}].valueObjectRef`,
            `聚合根 ${agg.name} 属性 ${attr.name} 引用值对象`,
            `Aggregate ${agg.name} attribute ${attr.name} references value object`,
          );
        }
        if (attr.dictionaryRef && matchesSymbol(attr.dictionaryRef.dictionaryId, targetId)) {
          pushRef(
            'M1',
            agg.id,
            agg.name,
            `aggregates[${agg.name}].attributes[${attr.name}].dictionaryRef`,
            `聚合根 ${agg.name} 属性 ${attr.name} 引用数据字典`,
            `Aggregate ${agg.name} attribute ${attr.name} references data dictionary`,
          );
        }
        for (const uiBind of attr.uiBindings ?? []) {
          if (matchesSymbol(uiBind, targetId)) {
            pushRef(
              'M1',
              agg.id,
              agg.name,
              `aggregates[${agg.name}].attributes[${attr.name}].uiBindings`,
              `聚合根 ${agg.name} 属性 ${attr.name} 绑定 UI 控件`,
              `Aggregate ${agg.name} attribute ${attr.name} binds UI element`,
            );
          }
        }
      }
      for (const uiBind of agg.uiBindings ?? []) {
        if (matchesSymbol(uiBind, targetId)) {
          pushRef(
            'M1',
            agg.id,
            agg.name,
            `aggregates[${agg.name}].uiBindings`,
            `聚合根 ${agg.name} 绑定 UI 屏幕`,
            `Aggregate ${agg.name} binds UI screen`,
          );
        }
      }
    }

    for (const assoc of suite.M1.aggregate_associations) {
      if (matchesSymbol(assoc.sourceAggregate, targetId)) {
        pushRef(
          'M1',
          assoc.id,
          assoc.id,
          `aggregate_associations[${assoc.id}].sourceAggregate`,
          `关联关系 ${assoc.id} 源聚合根`,
          `Association ${assoc.id} source aggregate`,
        );
      }
      if (matchesSymbol(assoc.targetAggregate, targetId)) {
        pushRef(
          'M1',
          assoc.id,
          assoc.id,
          `aggregate_associations[${assoc.id}].targetAggregate`,
          `关联关系 ${assoc.id} 目标聚合根`,
          `Association ${assoc.id} target aggregate`,
        );
      }
    }
  }

  // M2 references
  if (suite.M2) {
    for (const beh of suite.M2.behaviors) {
      if (matchesSymbol(beh.ownerEntity, targetId)) {
        pushRef(
          'M2',
          beh.id,
          beh.name,
          `behaviors[${beh.id}].ownerEntity`,
          `行为 ${beh.name} 归属对象`,
          `Behavior ${beh.name} ownerEntity`,
        );
      }
      for (const ruleId of beh.invokedRules) {
        if (matchesSymbol(ruleId, targetId)) {
          pushRef(
            'M2',
            beh.id,
            beh.name,
            `behaviors[${beh.id}].invokedRules`,
            `行为 ${beh.name} 调用规则 ${ruleId}`,
            `Behavior ${beh.name} invokes rule ${ruleId}`,
          );
        }
      }
      for (const evRef of beh.producedEvents) {
        const id = typeof evRef === 'string' ? evRef : evRef.eventRef;
        if (matchesSymbol(id, targetId)) {
          pushRef(
            'M2',
            beh.id,
            beh.name,
            `behaviors[${beh.id}].producedEvents`,
            `行为 ${beh.name} 产生事件 ${id}`,
            `Behavior ${beh.name} produces event ${id}`,
          );
        }
      }
      for (const permId of beh.requiredPermissions) {
        if (matchesSymbol(permId, targetId)) {
          pushRef(
            'M2',
            beh.id,
            beh.name,
            `behaviors[${beh.id}].requiredPermissions`,
            `行为 ${beh.name} 要求权限 ${permId}`,
            `Behavior ${beh.name} requires permission ${permId}`,
          );
        }
      }
      if (matchesSymbol(beh.queryReportRef, targetId)) {
        pushRef(
          'M2',
          beh.id,
          beh.name,
          `behaviors[${beh.id}].queryReportRef`,
          `查询行为 ${beh.name} 关联报表模型 ${beh.queryReportRef}`,
          `Query behavior ${beh.name} links report ${beh.queryReportRef}`,
        );
      }
    }
  }

  // M3 references
  if (suite.M3) {
    for (const rule of suite.M3.rules) {
      for (const objRef of rule.referencedObjects) {
        if (matchesSymbol(objRef, targetId)) {
          pushRef(
            'M3',
            rule.id,
            rule.name,
            `rules[${rule.id}].referencedObjects`,
            `规则 ${rule.name} 引用对象 ${objRef}`,
            `Rule ${rule.name} references object ${objRef}`,
          );
        }
      }
      for (const evId of rule.triggeredByEvents) {
        if (matchesSymbol(evId, targetId)) {
          pushRef(
            'M3',
            rule.id,
            rule.name,
            `rules[${rule.id}].triggeredByEvents`,
            `规则 ${rule.name} 由事件 ${evId} 触发`,
            `Rule ${rule.name} triggered by event ${evId}`,
          );
        }
      }
      for (const evId of rule.producedEvents) {
        if (matchesSymbol(evId, targetId)) {
          pushRef(
            'M3',
            rule.id,
            rule.name,
            `rules[${rule.id}].producedEvents`,
            `规则 ${rule.name} 产生事件 ${evId}`,
            `Rule ${rule.name} produces event ${evId}`,
          );
        }
      }
      for (const tb of rule.triggeredBehaviors) {
        if (matchesSymbol(tb.behaviorRef, targetId)) {
          pushRef(
            'M3',
            rule.id,
            rule.name,
            `rules[${rule.id}].triggeredBehaviors`,
            `规则 ${rule.name} 触发行为 ${tb.behaviorRef}`,
            `Rule ${rule.name} triggers behavior ${tb.behaviorRef}`,
          );
        }
      }
    }
  }

  // ME references
  if (suite.ME) {
    for (const ev of suite.ME.events) {
      if (matchesSymbol(ev.producerBehaviorRef, targetId)) {
        pushRef(
          'ME',
          ev.id,
          ev.name,
          `events[${ev.id}].producerBehaviorRef`,
          `事件 ${ev.name} 生产者引用 ${ev.producerBehaviorRef}`,
          `Event ${ev.name} producer reference ${ev.producerBehaviorRef}`,
        );
      }
      if (matchesSymbol(ev.sourceAggregate, targetId)) {
        pushRef(
          'ME',
          ev.id,
          ev.name,
          `events[${ev.id}].sourceAggregate`,
          `事件 ${ev.name} 源聚合根 ${ev.sourceAggregate}`,
          `Event ${ev.name} source aggregate ${ev.sourceAggregate}`,
        );
      }
      for (const sub of ev.subscribers) {
        if (matchesSymbol(sub.subscriberRef, targetId)) {
          pushRef(
            'ME',
            ev.id,
            ev.name,
            `events[${ev.id}].subscribers`,
            `事件 ${ev.name} 订阅者 ${sub.subscriberRef}`,
            `Event ${ev.name} subscriber ${sub.subscriberRef}`,
          );
        }
      }
    }
  }

  // M4 references
  if (suite.M4) {
    for (const sc of suite.M4.event_scenarios) {
      if (matchesSymbol(sc.triggerBehaviorRef, targetId)) {
        pushRef(
          'M4',
          sc.id,
          sc.name,
          `event_scenarios[${sc.id}].triggerBehaviorRef`,
          `场景 ${sc.name} 触发行为 ${sc.triggerBehaviorRef}`,
          `Scenario ${sc.name} trigger behavior ${sc.triggerBehaviorRef}`,
        );
      }
      if (matchesSymbol(sc.triggerEventRef, targetId)) {
        pushRef(
          'M4',
          sc.id,
          sc.name,
          `event_scenarios[${sc.id}].triggerEventRef`,
          `场景 ${sc.name} 触发事件 ${sc.triggerEventRef}`,
          `Scenario ${sc.name} trigger event ${sc.triggerEventRef}`,
        );
      }
      for (const agg of sc.involvedAggregates) {
        if (matchesSymbol(agg, targetId)) {
          pushRef(
            'M4',
            sc.id,
            sc.name,
            `event_scenarios[${sc.id}].involvedAggregates`,
            `场景 ${sc.name} 涉及聚合根 ${agg}`,
            `Scenario ${sc.name} involves aggregate ${agg}`,
          );
        }
      }
      for (const step of sc.steps) {
        if (matchesSymbol(step.refId, targetId) || matchesSymbol(step.targetAggregate, targetId)) {
          pushRef(
            'M4',
            sc.id,
            sc.name,
            `event_scenarios[${sc.id}].steps[${step.stepOrder}]`,
            `场景 ${sc.name} 步骤 ${step.stepOrder} 引用 ${step.refId}`,
            `Scenario ${sc.name} step ${step.stepOrder} references ${step.refId}`,
          );
        }
      }
    }
  }

  // M5 references
  if (suite.M5) {
    for (const act of suite.M5.actors) {
      for (const r of act.roles) {
        if (matchesSymbol(r, targetId)) {
          pushRef(
            'M5',
            act.id,
            act.name,
            `actors[${act.id}].roles`,
            `参与者 ${act.name} 绑定角色 ${r}`,
            `Actor ${act.name} binds role ${r}`,
          );
        }
      }
    }
    for (const role of suite.M5.roles) {
      for (const p of role.permissions) {
        if (matchesSymbol(p, targetId)) {
          pushRef(
            'M5',
            role.id,
            role.name,
            `roles[${role.id}].permissions`,
            `角色 ${role.name} 包含权限 ${p}`,
            `Role ${role.name} includes permission ${p}`,
          );
        }
      }
    }
    for (const perm of suite.M5.permissions) {
      if (matchesSymbol(perm.targetAggregate, targetId)) {
        pushRef(
          'M5',
          perm.id,
          perm.name,
          `permissions[${perm.id}].targetAggregate`,
          `权限 ${perm.name} 受控聚合根 ${perm.targetAggregate}`,
          `Permission ${perm.name} target aggregate ${perm.targetAggregate}`,
        );
      }
      for (const beh of perm.allowedBehaviors) {
        if (matchesSymbol(beh, targetId)) {
          pushRef(
            'M5',
            perm.id,
            perm.name,
            `permissions[${perm.id}].allowedBehaviors`,
            `权限 ${perm.name} 授权行为 ${beh}`,
            `Permission ${perm.name} allows behavior ${beh}`,
          );
        }
      }
    }
  }

  // M6 references
  if (suite.M6) {
    for (const fl of suite.M6.flows) {
      if (matchesSymbol(fl.primaryAggregate, targetId)) {
        pushRef(
          'M6',
          fl.id,
          fl.name,
          `flows[${fl.id}].primaryAggregate`,
          `流程 ${fl.name} 主聚合根 ${fl.primaryAggregate}`,
          `Flow ${fl.name} primary aggregate ${fl.primaryAggregate}`,
        );
      }
      for (const r of fl.roleRefs) {
        if (matchesSymbol(r, targetId)) {
          pushRef(
            'M6',
            fl.id,
            fl.name,
            `flows[${fl.id}].roleRefs`,
            `流程 ${fl.name} 参与角色 ${r}`,
            `Flow ${fl.name} participant role ${r}`,
          );
        }
      }
      for (const act of fl.activities) {
        if (
          matchesSymbol(act.roleRef, targetId) ||
          matchesSymbol(act.behaviorRef, targetId) ||
          matchesSymbol(act.scenarioRef, targetId) ||
          matchesSymbol(act.subFlowRef, targetId) ||
          matchesSymbol(act.screenRef, targetId)
        ) {
          pushRef(
            'M6',
            fl.id,
            fl.name,
            `flows[${fl.id}].activities[${act.id}]`,
            `流程 ${fl.name} 节点 ${act.name} 引用目标元素`,
            `Flow ${fl.name} activity ${act.name} references target`,
          );
        }
      }
    }
  }

  // M7 references
  if (suite.M7) {
    for (const rp of suite.M7.query_reports) {
      if (matchesSymbol(rp.behaviorRef, targetId)) {
        pushRef(
          'M7',
          rp.id,
          rp.name,
          `query_reports[${rp.id}].behaviorRef`,
          `报表 ${rp.name} 关联查询行为 ${rp.behaviorRef}`,
          `Report ${rp.name} links query behavior ${rp.behaviorRef}`,
        );
      }
      if (matchesSymbol(rp.primarySource.aggregateRef, targetId)) {
        pushRef(
          'M7',
          rp.id,
          rp.name,
          `query_reports[${rp.id}].primarySource.aggregateRef`,
          `报表 ${rp.name} 主数据源引用 ${rp.primarySource.aggregateRef}`,
          `Report ${rp.name} primarySource references ${rp.primarySource.aggregateRef}`,
        );
      }
      for (const jn of rp.joins) {
        if (matchesSymbol(jn.aggregateRef, targetId)) {
          pushRef(
            'M7',
            rp.id,
            rp.name,
            `query_reports[${rp.id}].joins[${jn.alias}].aggregateRef`,
            `报表 ${rp.name} 关联数据源引用 ${jn.aggregateRef}`,
            `Report ${rp.name} join ${jn.alias} references ${jn.aggregateRef}`,
          );
        }
      }
    }
  }

  // MU references
  if (suite.MU) {
    for (const sc of suite.MU.screens) {
      for (const el of sc.elements) {
        if (matchesSymbol(el.dataBinding, targetId) || matchesSymbol(el.dataSource, targetId)) {
          pushRef(
            'MU',
            sc.screenId,
            sc.name,
            `screens[${sc.screenId}].elements[${el.elementId}].dataBinding`,
            `界面 ${sc.name} 控件 ${el.label} 绑定 ${el.dataBinding ?? el.dataSource}`,
            `Screen ${sc.name} element ${el.label} binds ${el.dataBinding ?? el.dataSource}`,
          );
        }
      }
      for (const ev of sc.events) {
        if (matchesSymbol(ev.triggerElementId, targetId)) {
          pushRef(
            'MU',
            sc.screenId,
            sc.name,
            `screens[${sc.screenId}].events[${ev.eventId}].triggerElementId`,
            `界面事件 ${ev.name} 绑定触发控件 ${ev.triggerElementId}`,
            `UI event ${ev.name} binds trigger element ${ev.triggerElementId}`,
          );
        }
        for (const step of ev.callChain) {
          if (matchesSymbol(step.refId, targetId)) {
            pushRef(
              'MU',
              sc.screenId,
              sc.name,
              `screens[${sc.screenId}].events[${ev.eventId}].callChain[${step.stepOrder}]`,
              `界面事件 ${ev.name} 调用链步骤 ${step.stepOrder} 引用 ${step.refId}`,
              `UI event ${ev.name} callChain step ${step.stepOrder} references ${step.refId}`,
            );
          }
        }
      }
    }
  }

  // MM references
  if (suite.MM) {
    for (const mp of suite.MM.mappings) {
      if (matchesSymbol(mp.objectRef, targetId) || matchesSymbol(mp.objectName, targetId)) {
        pushRef(
          'MM',
          mp.id,
          mp.objectName,
          `mappings[${mp.id}].objectRef`,
          `数据表映射 ${mp.id} 映射对象 ${mp.objectName}`,
          `Table mapping ${mp.id} maps object ${mp.objectName}`,
        );
      }
    }
  }

  // MI references
  if (suite.MI) {
    for (const iface of suite.MI.interfaces) {
      if (
        matchesSymbol(iface.relatedBehaviorRef, targetId) ||
        matchesSymbol(iface.relatedEntityRef, targetId) ||
        matchesSymbol(iface.relatedReportRef, targetId) ||
        matchesSymbol(iface.relatedEventRef, targetId) ||
        matchesSymbol(iface.relatedExternalEntityRef, targetId)
      ) {
        pushRef(
          'MI',
          iface.interfaceId,
          iface.name,
          `interfaces[${iface.interfaceId}].relatedRef`,
          `接口 ${iface.name} 关联引用目标元素`,
          `Interface ${iface.name} links target element`,
        );
      }
    }
  }

  return {
    targetId,
    targetModel: info.model,
    targetName: info.name,
    canDeleteSafely: references.length === 0,
    references,
  };
}

function replacePrefixOrExact(val: string | undefined, oldId: string, newId: string): string | undefined {
  if (!val) return val;
  if (val === oldId) return newId;
  if (val.startsWith(`${oldId}.`)) {
    return `${newId}.${val.slice(oldId.length + 1)}`;
  }
  return val;
}

export function renameOntologySymbol(
  suite: OntologySuite,
  oldId: string,
  newId: string,
): {
  suite: OntologySuite;
  changedReferences: ImpactReference[];
  changelogEntry: string;
} {
  const impactBefore = analyzeImpact(suite, oldId);
  const next = cloneSuite(suite);

  // Rename primary definitions + all references across M1..MI
  if (next.M1) {
    for (const agg of next.M1.aggregates) {
      if (agg.id === oldId) agg.id = newId;
      if (agg.name === oldId) agg.name = newId;
      for (const ent of agg.entities) {
        if (ent.name === oldId) ent.name = newId;
      }
      for (const vo of agg.valueObjects) {
        if (vo.name === oldId) vo.name = newId;
      }
      for (const attr of agg.attributes) {
        attr.targetAggregate = replacePrefixOrExact(attr.targetAggregate, oldId, newId);
        attr.valueObjectRef = replacePrefixOrExact(attr.valueObjectRef, oldId, newId);
        if (attr.dictionaryRef && attr.dictionaryRef.dictionaryId === oldId) {
          attr.dictionaryRef.dictionaryId = newId;
        }
        if (attr.uiBindings) {
          attr.uiBindings = attr.uiBindings.map((b) => replacePrefixOrExact(b, oldId, newId) ?? b);
        }
      }
      if (agg.uiBindings) {
        agg.uiBindings = agg.uiBindings.map((b) => replacePrefixOrExact(b, oldId, newId) ?? b);
      }
    }
    for (const dict of next.M1.data_dictionaries) {
      if (dict.id === oldId) dict.id = newId;
    }
    for (const assoc of next.M1.aggregate_associations) {
      if (assoc.id === oldId) assoc.id = newId;
      assoc.sourceAggregate = replacePrefixOrExact(assoc.sourceAggregate, oldId, newId) ?? assoc.sourceAggregate;
      assoc.targetAggregate = replacePrefixOrExact(assoc.targetAggregate, oldId, newId) ?? assoc.targetAggregate;
    }
  }

  if (next.M2) {
    for (const beh of next.M2.behaviors) {
      if (beh.id === oldId) beh.id = newId;
      if (beh.name === oldId) beh.name = newId;
      beh.ownerEntity = replacePrefixOrExact(beh.ownerEntity, oldId, newId) ?? beh.ownerEntity;
      beh.invokedRules = beh.invokedRules.map((r) => replacePrefixOrExact(r, oldId, newId) ?? r);
      beh.producedEvents = beh.producedEvents.map((ev) => {
        if (typeof ev === 'string') {
          return replacePrefixOrExact(ev, oldId, newId) ?? ev;
        }
        return {
          ...ev,
          eventRef: replacePrefixOrExact(ev.eventRef, oldId, newId) ?? ev.eventRef,
        };
      });
      beh.requiredPermissions = beh.requiredPermissions.map(
        (p) => replacePrefixOrExact(p, oldId, newId) ?? p,
      );
      beh.queryReportRef = replacePrefixOrExact(beh.queryReportRef, oldId, newId);
    }
  }

  if (next.M3) {
    for (const rule of next.M3.rules) {
      if (rule.id === oldId) rule.id = newId;
      if (rule.name === oldId) rule.name = newId;
      rule.referencedObjects = rule.referencedObjects.map(
        (o) => replacePrefixOrExact(o, oldId, newId) ?? o,
      );
      rule.triggeredByEvents = rule.triggeredByEvents.map(
        (e) => replacePrefixOrExact(e, oldId, newId) ?? e,
      );
      rule.producedEvents = rule.producedEvents.map(
        (e) => replacePrefixOrExact(e, oldId, newId) ?? e,
      );
      for (const tb of rule.triggeredBehaviors) {
        tb.behaviorRef = replacePrefixOrExact(tb.behaviorRef, oldId, newId) ?? tb.behaviorRef;
      }
    }
  }

  if (next.ME) {
    for (const ev of next.ME.events) {
      if (ev.id === oldId) ev.id = newId;
      if (ev.name === oldId) ev.name = newId;
      ev.producerBehaviorRef =
        replacePrefixOrExact(ev.producerBehaviorRef, oldId, newId) ?? ev.producerBehaviorRef;
      ev.sourceAggregate =
        replacePrefixOrExact(ev.sourceAggregate, oldId, newId) ?? ev.sourceAggregate;
      for (const sub of ev.subscribers) {
        sub.subscriberRef =
          replacePrefixOrExact(sub.subscriberRef, oldId, newId) ?? sub.subscriberRef;
      }
    }
  }

  if (next.M4) {
    for (const sc of next.M4.event_scenarios) {
      if (sc.id === oldId) sc.id = newId;
      sc.triggerBehaviorRef = replacePrefixOrExact(sc.triggerBehaviorRef, oldId, newId);
      sc.triggerEventRef =
        replacePrefixOrExact(sc.triggerEventRef, oldId, newId) ?? sc.triggerEventRef;
      sc.involvedAggregates = sc.involvedAggregates.map(
        (a) => replacePrefixOrExact(a, oldId, newId) ?? a,
      );
      for (const st of sc.steps) {
        st.refId = replacePrefixOrExact(st.refId, oldId, newId) ?? st.refId;
        st.targetAggregate = replacePrefixOrExact(st.targetAggregate, oldId, newId);
      }
    }
  }

  if (next.M5) {
    for (const act of next.M5.actors) {
      if (act.id === oldId) act.id = newId;
      act.roles = act.roles.map((r) => replacePrefixOrExact(r, oldId, newId) ?? r);
    }
    for (const role of next.M5.roles) {
      if (role.id === oldId) role.id = newId;
      role.permissions = role.permissions.map((p) => replacePrefixOrExact(p, oldId, newId) ?? p);
    }
    for (const perm of next.M5.permissions) {
      if (perm.id === oldId) perm.id = newId;
      perm.targetAggregate =
        replacePrefixOrExact(perm.targetAggregate, oldId, newId) ?? perm.targetAggregate;
      perm.allowedBehaviors = perm.allowedBehaviors.map(
        (b) => replacePrefixOrExact(b, oldId, newId) ?? b,
      );
    }
  }

  if (next.M6) {
    for (const fl of next.M6.flows) {
      if (fl.id === oldId) fl.id = newId;
      fl.primaryAggregate =
        replacePrefixOrExact(fl.primaryAggregate, oldId, newId) ?? fl.primaryAggregate;
      fl.roleRefs = fl.roleRefs.map((r) => replacePrefixOrExact(r, oldId, newId) ?? r);
      if (fl.trigger.refId) {
        fl.trigger.refId = replacePrefixOrExact(fl.trigger.refId, oldId, newId);
      }
      for (const act of fl.activities) {
        act.roleRef = replacePrefixOrExact(act.roleRef, oldId, newId);
        act.behaviorRef = replacePrefixOrExact(act.behaviorRef, oldId, newId);
        act.scenarioRef = replacePrefixOrExact(act.scenarioRef, oldId, newId);
        act.subFlowRef = replacePrefixOrExact(act.subFlowRef, oldId, newId);
        act.screenRef = replacePrefixOrExact(act.screenRef, oldId, newId);
      }
    }
  }

  if (next.M7) {
    for (const rp of next.M7.query_reports) {
      if (rp.id === oldId) rp.id = newId;
      rp.behaviorRef = replacePrefixOrExact(rp.behaviorRef, oldId, newId) ?? rp.behaviorRef;
      rp.primarySource.aggregateRef =
        replacePrefixOrExact(rp.primarySource.aggregateRef, oldId, newId) ??
        rp.primarySource.aggregateRef;
      for (const jn of rp.joins) {
        jn.aggregateRef = replacePrefixOrExact(jn.aggregateRef, oldId, newId) ?? jn.aggregateRef;
      }
    }
  }

  if (next.MU) {
    for (const sc of next.MU.screens) {
      if (sc.screenId === oldId) sc.screenId = newId;
      if (sc.layout && sc.layout.includes(`[${oldId}]`)) {
        sc.layout = sc.layout.split(`[${oldId}]`).join(`[${newId}]`);
      }
      for (const el of sc.elements) {
        if (el.elementId === oldId) el.elementId = newId;
        el.dataBinding = replacePrefixOrExact(el.dataBinding, oldId, newId);
        el.dataSource = replacePrefixOrExact(el.dataSource, oldId, newId);
        el.permissionRef = replacePrefixOrExact(el.permissionRef, oldId, newId);
      }
      for (const ev of sc.events) {
        if (ev.eventId === oldId) ev.eventId = newId;
        ev.triggerElementId =
          replacePrefixOrExact(ev.triggerElementId, oldId, newId) ?? ev.triggerElementId;
        for (const step of ev.callChain) {
          step.refId = replacePrefixOrExact(step.refId, oldId, newId) ?? step.refId;
        }
      }
    }
    for (const edge of next.MU.navigation_edges) {
      edge.fromScreen = replacePrefixOrExact(edge.fromScreen, oldId, newId) ?? edge.fromScreen;
      edge.toScreen = replacePrefixOrExact(edge.toScreen, oldId, newId) ?? edge.toScreen;
    }
  }

  if (next.MM) {
    for (const mp of next.MM.mappings) {
      if (mp.id === oldId) mp.id = newId;
      mp.objectRef = replacePrefixOrExact(mp.objectRef, oldId, newId) ?? mp.objectRef;
      mp.objectName = replacePrefixOrExact(mp.objectName, oldId, newId) ?? mp.objectName;
      for (const tm of mp.tableMappings) {
        for (const cm of tm.columnMappings) {
          cm.attributeRef = replacePrefixOrExact(cm.attributeRef, oldId, newId) ?? cm.attributeRef;
        }
      }
    }
  }

  if (next.MI) {
    for (const iface of next.MI.interfaces) {
      if (iface.interfaceId === oldId) iface.interfaceId = newId;
      iface.relatedBehaviorRef = replacePrefixOrExact(iface.relatedBehaviorRef, oldId, newId);
      iface.relatedEntityRef = replacePrefixOrExact(iface.relatedEntityRef, oldId, newId);
      iface.relatedReportRef = replacePrefixOrExact(iface.relatedReportRef, oldId, newId);
      iface.relatedEventRef = replacePrefixOrExact(iface.relatedEventRef, oldId, newId);
      iface.relatedExternalEntityRef = replacePrefixOrExact(
        iface.relatedExternalEntityRef,
        oldId,
        newId,
      );
      for (const f of iface.inputFields) {
        f.mappedRef = replacePrefixOrExact(f.mappedRef, oldId, newId);
      }
      for (const f of iface.outputFields) {
        f.mappedRef = replacePrefixOrExact(f.mappedRef, oldId, newId);
      }
    }
  }

  const timestamp = new Date().toISOString();
  const changelogEntry = [
    `## [${timestamp}] Cascade Rename \`${oldId}\` -> \`${newId}\``,
    `- Target Model: \`${impactBefore.targetModel}\` (${impactBefore.targetName})`,
    `- Updated Cross-Model References: ${impactBefore.references.length}`,
    ...impactBefore.references.map(
      (ref) => `  - [${ref.model}] \`${ref.elementId}\` (${ref.fieldPath}): ${ref.descriptionZh}`,
    ),
    '',
  ].join('\n');

  return {
    suite: next,
    changedReferences: impactBefore.references,
    changelogEntry,
  };
}

