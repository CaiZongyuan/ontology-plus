import type {
  Attribute,
  ImpactAnalysisReport,
  ImpactReference,
  InterfaceFieldSpec,
  ModelCode,
  OntologySuite,
} from './types.js';

function cloneSuite(suite: OntologySuite): OntologySuite {
  return JSON.parse(JSON.stringify(suite)) as OntologySuite;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
      for (const attr of agg.attributes) {
        if (`${agg.name}.${attr.name}` === targetId) {
          return { model: 'M1', name: `${agg.name}.${attr.name} (${attr.label})` };
        }
      }
      for (const ent of agg.entities) {
        if (ent.name === targetId || `${agg.name}.${ent.name}` === targetId) {
          return { model: 'M1', name: `${agg.name}.${ent.name} (${ent.alias})` };
        }
        for (const attr of ent.attributes) {
          if (
            `${ent.name}.${attr.name}` === targetId ||
            `${agg.name}.${ent.name}.${attr.name}` === targetId
          ) {
            return { model: 'M1', name: `${agg.name}.${ent.name}.${attr.name} (${attr.label})` };
          }
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
    for (const assoc of suite.M1.aggregate_associations) {
      if (assoc.id === targetId) {
        return { model: 'M1', name: assoc.id };
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
    for (const pg of suite.M5.permissionGroups ?? []) {
      if (pg.id === targetId) return { model: 'M5', name: pg.name };
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

/**
 * Matches exact symbol, dot-prefixed paths (`Contract.title`), bracket-qualified paths
 * (`ContractLineItem[].itemName`), or nested segment paths (`Contract.ContractLineItem[].itemName`).
 */
function transformSymbolRef(
  candidate: string | undefined,
  targetId: string,
  newId?: string,
): { matched: boolean; updated: string | undefined } {
  if (!candidate) return { matched: false, updated: candidate };

  if (candidate === targetId) {
    return { matched: true, updated: newId ?? candidate };
  }
  if (candidate.startsWith(`${targetId}.`)) {
    return {
      matched: true,
      updated: newId ? `${newId}.${candidate.slice(targetId.length + 1)}` : candidate,
    };
  }
  if (candidate.startsWith(`${targetId}[`)) {
    return {
      matched: true,
      updated: newId ? `${newId}${candidate.slice(targetId.length)}` : candidate,
    };
  }

  // Segment match for sub-entity/VO/attribute paths like `Contract.ContractLineItem[].itemName`
  if (!targetId.includes('.') && candidate.includes('.')) {
    const segments = candidate.split('.');
    let changed = false;
    const nextSegments = segments.map((seg, idx) => {
      if (idx === 0) return seg;
      const bracketIdx = seg.indexOf('[');
      const base = bracketIdx >= 0 ? seg.slice(0, bracketIdx) : seg;
      const suffix = bracketIdx >= 0 ? seg.slice(bracketIdx) : '';
      if (base === targetId) {
        changed = true;
        return newId ? `${newId}${suffix}` : seg;
      }
      return seg;
    });
    if (changed) {
      return { matched: true, updated: newId ? nextSegments.join('.') : candidate };
    }
  }

  return { matched: false, updated: candidate };
}

function transformLayoutSymbol(
  layout: string | undefined,
  targetId: string,
  newId?: string,
): { matched: boolean; updated: string | undefined } {
  if (!layout) return { matched: false, updated: layout };
  const esc = escapeRegExp(targetId);
  const bracketRe = new RegExp(`\\[${esc}(\\*)?(\\s+[^\\]]*)?\\]`, 'g');
  const braceRe = new RegExp(`\\{${esc}(\\*)?(\\s+[^}]*)?\\}`, 'g');
  const parenRe = new RegExp(`\\(${esc}(\\*)?\\)`, 'g');
  const gridRe = new RegExp(`@${esc}(\\*)?(?![a-zA-Z0-9_-])`, 'g');

  const matched =
    bracketRe.test(layout) || braceRe.test(layout) || parenRe.test(layout) || gridRe.test(layout);
  if (!matched) return { matched: false, updated: layout };
  if (!newId) return { matched: true, updated: layout };

  const updated = layout
    .replace(new RegExp(`\\[${esc}(\\*)?(\\s+[^\\]]*)?\\]`, 'g'), `[${newId}$1$2]`)
    .replace(new RegExp(`\\{${esc}(\\*)?(\\s+[^}]*)?\\}`, 'g'), `{${newId}$1$2}`)
    .replace(new RegExp(`\\(${esc}(\\*)?\\)`, 'g'), `(${newId}$1)`)
    .replace(new RegExp(`@${esc}(\\*)?(?![a-zA-Z0-9_-])`, 'g'), `@${newId}$1`);
  return { matched: true, updated };
}

function transformUiEventPath(
  pathVal: string,
  targetId: string,
  newId?: string,
): { matched: boolean; updated: string } {
  const parts = pathVal.split(/(\s*(?:->|→|\/)\s*)/);
  let matched = false;
  const nextParts = parts.map((part, idx) => {
    if (idx % 2 === 1) return part; // delimiter
    const trimmed = part.trim();
    if (trimmed === targetId) {
      matched = true;
      return newId ? part.replace(trimmed, newId) : part;
    }
    return part;
  });
  return { matched, updated: newId && matched ? nextParts.join('') : pathVal };
}

/**
 * Unified reference visitor and optional in-place mutator shared by `analyzeImpact` and
 * `renameOntologySymbol` so impact counts and cascade renames stay 100% synchronized.
 */
function visitAndTransformReferences(
  suite: OntologySuite,
  targetId: string,
  newId?: string,
): ImpactReference[] {
  const references: ImpactReference[] = [];
  const mutate = newId !== undefined;

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

  // ─── M1 References ──────────────────────────────────────────────────────────
  if (suite.M1) {
    const visitAttributeList = (
      aggId: string,
      aggName: string,
      attrs: Attribute[],
      pathPrefix: string,
    ) => {
      for (const attr of attrs) {
        const tgtRes = transformSymbolRef(attr.targetAggregate, targetId, newId);
        if (tgtRes.matched) {
          pushRef(
            'M1',
            aggId,
            aggName,
            `${pathPrefix}[${attr.name}].targetAggregate`,
            `对象 ${aggName} 属性 ${attr.name} 引用目标聚合根`,
            `Object ${aggName} attribute ${attr.name} references target aggregate`,
          );
          if (mutate) attr.targetAggregate = tgtRes.updated;
        }

        const voRes = transformSymbolRef(attr.valueObjectRef, targetId, newId);
        if (voRes.matched) {
          pushRef(
            'M1',
            aggId,
            aggName,
            `${pathPrefix}[${attr.name}].valueObjectRef`,
            `对象 ${aggName} 属性 ${attr.name} 引用值对象`,
            `Object ${aggName} attribute ${attr.name} references value object`,
          );
          if (mutate) attr.valueObjectRef = voRes.updated;
        }

        if (attr.dictionaryRef) {
          const dictRes = transformSymbolRef(attr.dictionaryRef.dictionaryId, targetId, newId);
          if (dictRes.matched) {
            pushRef(
              'M1',
              aggId,
              aggName,
              `${pathPrefix}[${attr.name}].dictionaryRef`,
              `对象 ${aggName} 属性 ${attr.name} 引用数据字典`,
              `Object ${aggName} attribute ${attr.name} references data dictionary`,
            );
            if (mutate && dictRes.updated) attr.dictionaryRef.dictionaryId = dictRes.updated;
          }
        }

        if (attr.uiBindings) {
          attr.uiBindings = attr.uiBindings.map((uiBind) => {
            const bindRes = transformSymbolRef(uiBind, targetId, newId);
            if (bindRes.matched) {
              pushRef(
                'M1',
                aggId,
                aggName,
                `${pathPrefix}[${attr.name}].uiBindings`,
                `对象 ${aggName} 属性 ${attr.name} 绑定 UI 控件 ${uiBind}`,
                `Object ${aggName} attribute ${attr.name} binds UI element ${uiBind}`,
              );
              return mutate && bindRes.updated ? bindRes.updated : uiBind;
            }
            return uiBind;
          });
        }
      }
    };

    for (const agg of suite.M1.aggregates) {
      visitAttributeList(agg.id, agg.name, agg.attributes, `aggregates[${agg.name}].attributes`);
      for (const ent of agg.entities) {
        visitAttributeList(
          agg.id,
          agg.name,
          ent.attributes,
          `aggregates[${agg.name}].entities[${ent.name}].attributes`,
        );
      }
      for (const vo of agg.valueObjects) {
        visitAttributeList(
          agg.id,
          agg.name,
          vo.attributes,
          `aggregates[${agg.name}].valueObjects[${vo.name}].attributes`,
        );
      }

      if (agg.uiBindings) {
        agg.uiBindings = agg.uiBindings.map((uiBind) => {
          const bindRes = transformSymbolRef(uiBind, targetId, newId);
          if (bindRes.matched) {
            pushRef(
              'M1',
              agg.id,
              agg.name,
              `aggregates[${agg.name}].uiBindings`,
              `聚合根 ${agg.name} 绑定 UI 屏幕 ${uiBind}`,
              `Aggregate ${agg.name} binds UI screen ${uiBind}`,
            );
            return mutate && bindRes.updated ? bindRes.updated : uiBind;
          }
          return uiBind;
        });
      }
    }

    for (const assoc of suite.M1.aggregate_associations) {
      const srcRes = transformSymbolRef(assoc.sourceAggregate, targetId, newId);
      if (srcRes.matched) {
        pushRef(
          'M1',
          assoc.id,
          assoc.id,
          `aggregate_associations[${assoc.id}].sourceAggregate`,
          `关联关系 ${assoc.id} 源聚合根`,
          `Association ${assoc.id} source aggregate`,
        );
        if (mutate && srcRes.updated) assoc.sourceAggregate = srcRes.updated;
      }

      const tgtRes = transformSymbolRef(assoc.targetAggregate, targetId, newId);
      if (tgtRes.matched) {
        pushRef(
          'M1',
          assoc.id,
          assoc.id,
          `aggregate_associations[${assoc.id}].targetAggregate`,
          `关联关系 ${assoc.id} 目标聚合根`,
          `Association ${assoc.id} target aggregate`,
        );
        if (mutate && tgtRes.updated) assoc.targetAggregate = tgtRes.updated;
      }

      const fldRes = transformSymbolRef(assoc.referenceField, targetId, newId);
      if (fldRes.matched) {
        pushRef(
          'M1',
          assoc.id,
          assoc.id,
          `aggregate_associations[${assoc.id}].referenceField`,
          `关联关系 ${assoc.id} 关联字段 ${assoc.referenceField}`,
          `Association ${assoc.id} referenceField ${assoc.referenceField}`,
        );
        if (mutate && fldRes.updated) assoc.referenceField = fldRes.updated;
      }
    }
  }

  // ─── M2 References ──────────────────────────────────────────────────────────
  if (suite.M2) {
    for (const beh of suite.M2.behaviors) {
      const ownerRes = transformSymbolRef(beh.ownerEntity, targetId, newId);
      if (ownerRes.matched) {
        pushRef(
          'M2',
          beh.id,
          beh.name,
          `behaviors[${beh.id}].ownerEntity`,
          `行为 ${beh.name} 归属对象`,
          `Behavior ${beh.name} ownerEntity`,
        );
        if (mutate && ownerRes.updated) beh.ownerEntity = ownerRes.updated;
      }

      for (const sc of beh.stateChanges) {
        const tfRes = transformSymbolRef(sc.targetField, targetId, newId);
        if (tfRes.matched) {
          pushRef(
            'M2',
            beh.id,
            beh.name,
            `behaviors[${beh.id}].stateChanges[${sc.targetField}]`,
            `行为 ${beh.name} 状态变更字段 ${sc.targetField}`,
            `Behavior ${beh.name} stateChange field ${sc.targetField}`,
          );
          if (mutate && tfRes.updated) sc.targetField = tfRes.updated;
        }
      }

      beh.invokedRules = beh.invokedRules.map((ruleId) => {
        const rRes = transformSymbolRef(ruleId, targetId, newId);
        if (rRes.matched) {
          pushRef(
            'M2',
            beh.id,
            beh.name,
            `behaviors[${beh.id}].invokedRules`,
            `行为 ${beh.name} 调用规则 ${ruleId}`,
            `Behavior ${beh.name} invokes rule ${ruleId}`,
          );
          return mutate && rRes.updated ? rRes.updated : ruleId;
        }
        return ruleId;
      });

      beh.producedEvents = beh.producedEvents.map((evRef) => {
        const id = typeof evRef === 'string' ? evRef : evRef.eventRef;
        const evRes = transformSymbolRef(id, targetId, newId);
        if (evRes.matched) {
          pushRef(
            'M2',
            beh.id,
            beh.name,
            `behaviors[${beh.id}].producedEvents`,
            `行为 ${beh.name} 产生事件 ${id}`,
            `Behavior ${beh.name} produces event ${id}`,
          );
          if (mutate && evRes.updated) {
            return typeof evRef === 'string' ? evRes.updated : { ...evRef, eventRef: evRes.updated };
          }
        }
        return evRef;
      });

      for (const st of beh.syncTriggers ?? []) {
        const srRes = transformSymbolRef(st.ruleRef, targetId, newId);
        if (srRes.matched) {
          pushRef(
            'M2',
            beh.id,
            beh.name,
            `behaviors[${beh.id}].syncTriggers.ruleRef`,
            `行为 ${beh.name} 同步触发规则 ${st.ruleRef}`,
            `Behavior ${beh.name} syncTrigger rule ${st.ruleRef}`,
          );
          if (mutate) st.ruleRef = srRes.updated;
        }
        const sbRes = transformSymbolRef(st.behaviorRef, targetId, newId);
        if (sbRes.matched) {
          pushRef(
            'M2',
            beh.id,
            beh.name,
            `behaviors[${beh.id}].syncTriggers.behaviorRef`,
            `行为 ${beh.name} 同步触发行为 ${st.behaviorRef}`,
            `Behavior ${beh.name} syncTrigger behavior ${st.behaviorRef}`,
          );
          if (mutate && sbRes.updated) st.behaviorRef = sbRes.updated;
        }
      }

      beh.requiredPermissions = beh.requiredPermissions.map((permId) => {
        const pRes = transformSymbolRef(permId, targetId, newId);
        if (pRes.matched) {
          pushRef(
            'M2',
            beh.id,
            beh.name,
            `behaviors[${beh.id}].requiredPermissions`,
            `行为 ${beh.name} 要求权限 ${permId}`,
            `Behavior ${beh.name} requires permission ${permId}`,
          );
          return mutate && pRes.updated ? pRes.updated : permId;
        }
        return permId;
      });

      const qrRes = transformSymbolRef(beh.queryReportRef, targetId, newId);
      if (qrRes.matched) {
        pushRef(
          'M2',
          beh.id,
          beh.name,
          `behaviors[${beh.id}].queryReportRef`,
          `查询行为 ${beh.name} 关联报表模型 ${beh.queryReportRef}`,
          `Query behavior ${beh.name} links report ${beh.queryReportRef}`,
        );
        if (mutate) beh.queryReportRef = qrRes.updated;
      }

      if (beh.uiEventRefs) {
        beh.uiEventRefs = beh.uiEventRefs.map((uiEv) => {
          const uRes = transformSymbolRef(uiEv, targetId, newId);
          if (uRes.matched) {
            pushRef(
              'M2',
              beh.id,
              beh.name,
              `behaviors[${beh.id}].uiEventRefs`,
              `行为 ${beh.name} 关联 UI 事件 ${uiEv}`,
              `Behavior ${beh.name} links UI event ${uiEv}`,
            );
            return mutate && uRes.updated ? uRes.updated : uiEv;
          }
          return uiEv;
        });
      }
    }
  }

  // ─── M3 References ──────────────────────────────────────────────────────────
  if (suite.M3) {
    for (const rule of suite.M3.rules) {
      rule.referencedObjects = rule.referencedObjects.map((objRef) => {
        const oRes = transformSymbolRef(objRef, targetId, newId);
        if (oRes.matched) {
          pushRef(
            'M3',
            rule.id,
            rule.name,
            `rules[${rule.id}].referencedObjects`,
            `规则 ${rule.name} 引用对象 ${objRef}`,
            `Rule ${rule.name} references object ${objRef}`,
          );
          return mutate && oRes.updated ? oRes.updated : objRef;
        }
        return objRef;
      });

      for (const param of rule.parameters) {
        const srcRes = transformSymbolRef(param.source, targetId, newId);
        if (srcRes.matched) {
          pushRef(
            'M3',
            rule.id,
            rule.name,
            `rules[${rule.id}].parameters[${param.name}].source`,
            `规则 ${rule.name} 参数 ${param.name} 来源 ${param.source}`,
            `Rule ${rule.name} parameter ${param.name} source ${param.source}`,
          );
          if (mutate) param.source = srcRes.updated;
        }
      }

      if (rule.reusedBy) {
        rule.reusedBy = rule.reusedBy.map((bId) => {
          const bRes = transformSymbolRef(bId, targetId, newId);
          if (bRes.matched) {
            pushRef(
              'M3',
              rule.id,
              rule.name,
              `rules[${rule.id}].reusedBy`,
              `规则 ${rule.name} 被行为 ${bId} 复用`,
              `Rule ${rule.name} reused by behavior ${bId}`,
            );
            return mutate && bRes.updated ? bRes.updated : bId;
          }
          return bId;
        });
      }

      rule.triggeredByEvents = rule.triggeredByEvents.map((evId) => {
        const eRes = transformSymbolRef(evId, targetId, newId);
        if (eRes.matched) {
          pushRef(
            'M3',
            rule.id,
            rule.name,
            `rules[${rule.id}].triggeredByEvents`,
            `规则 ${rule.name} 由事件 ${evId} 触发`,
            `Rule ${rule.name} triggered by event ${evId}`,
          );
          return mutate && eRes.updated ? eRes.updated : evId;
        }
        return evId;
      });

      rule.producedEvents = rule.producedEvents.map((evId) => {
        const eRes = transformSymbolRef(evId, targetId, newId);
        if (eRes.matched) {
          pushRef(
            'M3',
            rule.id,
            rule.name,
            `rules[${rule.id}].producedEvents`,
            `规则 ${rule.name} 产生事件 ${evId}`,
            `Rule ${rule.name} produces event ${evId}`,
          );
          return mutate && eRes.updated ? eRes.updated : evId;
        }
        return evId;
      });

      for (const tb of rule.triggeredBehaviors) {
        const bRes = transformSymbolRef(tb.behaviorRef, targetId, newId);
        if (bRes.matched) {
          pushRef(
            'M3',
            rule.id,
            rule.name,
            `rules[${rule.id}].triggeredBehaviors`,
            `规则 ${rule.name} 触发行为 ${tb.behaviorRef}`,
            `Rule ${rule.name} triggers behavior ${tb.behaviorRef}`,
          );
          if (mutate && bRes.updated) tb.behaviorRef = bRes.updated;
        }
        if (tb.parameterMapping) {
          for (const [paramKey, mapExpr] of Object.entries(tb.parameterMapping)) {
            const pmRes = transformSymbolRef(mapExpr, targetId, newId);
            if (pmRes.matched) {
              pushRef(
                'M3',
                rule.id,
                rule.name,
                `rules[${rule.id}].triggeredBehaviors.parameterMapping[${paramKey}]`,
                `规则 ${rule.name} 参数映射引用 ${mapExpr}`,
                `Rule ${rule.name} parameterMapping references ${mapExpr}`,
              );
              if (mutate && pmRes.updated) tb.parameterMapping[paramKey] = pmRes.updated;
            }
          }
        }
      }

      if (rule.uiValidationRefs) {
        rule.uiValidationRefs = rule.uiValidationRefs.map((uiEv) => {
          const uRes = transformSymbolRef(uiEv, targetId, newId);
          if (uRes.matched) {
            pushRef(
              'M3',
              rule.id,
              rule.name,
              `rules[${rule.id}].uiValidationRefs`,
              `规则 ${rule.name} 关联 UI 校验事件 ${uiEv}`,
              `Rule ${rule.name} links UI validation event ${uiEv}`,
            );
            return mutate && uRes.updated ? uRes.updated : uiEv;
          }
          return uiEv;
        });
      }
    }
  }

  // ─── ME References ──────────────────────────────────────────────────────────
  if (suite.ME) {
    for (const ev of suite.ME.events) {
      if (ev.name !== targetId && ev.name.startsWith(`${targetId}.`)) {
        const nRes = transformSymbolRef(ev.name, targetId, newId);
        if (nRes.matched) {
          pushRef(
            'ME',
            ev.id,
            ev.name,
            `events[${ev.id}].name`,
            `事件 ${ev.name} 命名前缀引用聚合根 ${targetId}`,
            `Event ${ev.name} name prefix references ${targetId}`,
          );
          if (mutate && nRes.updated) ev.name = nRes.updated;
        }
      }

      const pbRes = transformSymbolRef(ev.producerBehaviorRef, targetId, newId);
      if (pbRes.matched) {
        pushRef(
          'ME',
          ev.id,
          ev.name,
          `events[${ev.id}].producerBehaviorRef`,
          `事件 ${ev.name} 生产者行为引用 ${ev.producerBehaviorRef}`,
          `Event ${ev.name} producer behavior reference ${ev.producerBehaviorRef}`,
        );
        if (mutate && pbRes.updated) ev.producerBehaviorRef = pbRes.updated;
      }

      const prRes = transformSymbolRef(ev.producerRuleRef, targetId, newId);
      if (prRes.matched) {
        pushRef(
          'ME',
          ev.id,
          ev.name,
          `events[${ev.id}].producerRuleRef`,
          `事件 ${ev.name} 生产者规则引用 ${ev.producerRuleRef}`,
          `Event ${ev.name} producer rule reference ${ev.producerRuleRef}`,
        );
        if (mutate) ev.producerRuleRef = prRes.updated;
      }

      const saRes = transformSymbolRef(ev.sourceAggregate, targetId, newId);
      if (saRes.matched) {
        pushRef(
          'ME',
          ev.id,
          ev.name,
          `events[${ev.id}].sourceAggregate`,
          `事件 ${ev.name} 源聚合根 ${ev.sourceAggregate}`,
          `Event ${ev.name} source aggregate ${ev.sourceAggregate}`,
        );
        if (mutate && saRes.updated) ev.sourceAggregate = saRes.updated;
      }

      for (const sub of ev.subscribers) {
        const sRes = transformSymbolRef(sub.subscriberRef, targetId, newId);
        if (sRes.matched) {
          pushRef(
            'ME',
            ev.id,
            ev.name,
            `events[${ev.id}].subscribers`,
            `事件 ${ev.name} 订阅者 ${sub.subscriberRef}`,
            `Event ${ev.name} subscriber ${sub.subscriberRef}`,
          );
          if (mutate && sRes.updated) sub.subscriberRef = sRes.updated;
        }
        const seRes = transformSymbolRef(sub.subscriberEntityRef, targetId, newId);
        if (seRes.matched) {
          pushRef(
            'ME',
            ev.id,
            ev.name,
            `events[${ev.id}].subscribers.subscriberEntityRef`,
            `事件 ${ev.name} 订阅目标对象 ${sub.subscriberEntityRef}`,
            `Event ${ev.name} subscriberEntityRef ${sub.subscriberEntityRef}`,
          );
          if (mutate) sub.subscriberEntityRef = seRes.updated;
        }
      }

      if (ev.uiEventPath !== undefined) {
        if (typeof ev.uiEventPath === 'string') {
          const pRes = transformUiEventPath(ev.uiEventPath, targetId, newId);
          if (pRes.matched) {
            pushRef(
              'ME',
              ev.id,
              ev.name,
              `events[${ev.id}].uiEventPath`,
              `事件 ${ev.name} UI 路径引用 ${targetId}`,
              `Event ${ev.name} uiEventPath references ${targetId}`,
            );
            if (mutate) ev.uiEventPath = pRes.updated;
          }
        } else {
          ev.uiEventPath = ev.uiEventPath.map((p) => {
            const pRes = transformUiEventPath(p, targetId, newId);
            if (pRes.matched) {
              pushRef(
                'ME',
                ev.id,
                ev.name,
                `events[${ev.id}].uiEventPath`,
                `事件 ${ev.name} UI 路径引用 ${targetId}`,
                `Event ${ev.name} uiEventPath references ${targetId}`,
              );
              return mutate ? pRes.updated : p;
            }
            return p;
          });
        }
      }
    }
  }

  // ─── M4 References ──────────────────────────────────────────────────────────
  if (suite.M4) {
    for (const sc of suite.M4.event_scenarios) {
      const srcObjRes = transformSymbolRef(sc.sourceObjectRef, targetId, newId);
      if (srcObjRes.matched) {
        pushRef(
          'M4',
          sc.id,
          sc.name,
          `event_scenarios[${sc.id}].sourceObjectRef`,
          `场景 ${sc.name} 源对象 ${sc.sourceObjectRef}`,
          `Scenario ${sc.name} sourceObjectRef ${sc.sourceObjectRef}`,
        );
        if (mutate) sc.sourceObjectRef = srcObjRes.updated;
      }

      if (sc.targetObjectRefs) {
        sc.targetObjectRefs = sc.targetObjectRefs.map((tObj) => {
          const tRes = transformSymbolRef(tObj, targetId, newId);
          if (tRes.matched) {
            pushRef(
              'M4',
              sc.id,
              sc.name,
              `event_scenarios[${sc.id}].targetObjectRefs`,
              `场景 ${sc.name} 目标对象 ${tObj}`,
              `Scenario ${sc.name} targetObjectRef ${tObj}`,
            );
            return mutate && tRes.updated ? tRes.updated : tObj;
          }
          return tObj;
        });
      }

      const tbRes = transformSymbolRef(sc.triggerBehaviorRef, targetId, newId);
      if (tbRes.matched) {
        pushRef(
          'M4',
          sc.id,
          sc.name,
          `event_scenarios[${sc.id}].triggerBehaviorRef`,
          `场景 ${sc.name} 触发行为 ${sc.triggerBehaviorRef}`,
          `Scenario ${sc.name} trigger behavior ${sc.triggerBehaviorRef}`,
        );
        if (mutate) sc.triggerBehaviorRef = tbRes.updated;
      }

      const teRes = transformSymbolRef(sc.triggerEventRef, targetId, newId);
      if (teRes.matched) {
        pushRef(
          'M4',
          sc.id,
          sc.name,
          `event_scenarios[${sc.id}].triggerEventRef`,
          `场景 ${sc.name} 触发事件 ${sc.triggerEventRef}`,
          `Scenario ${sc.name} trigger event ${sc.triggerEventRef}`,
        );
        if (mutate && teRes.updated) sc.triggerEventRef = teRes.updated;
      }

      sc.involvedAggregates = sc.involvedAggregates.map((agg) => {
        const aRes = transformSymbolRef(agg, targetId, newId);
        if (aRes.matched) {
          pushRef(
            'M4',
            sc.id,
            sc.name,
            `event_scenarios[${sc.id}].involvedAggregates`,
            `场景 ${sc.name} 涉及聚合根 ${agg}`,
            `Scenario ${sc.name} involves aggregate ${agg}`,
          );
          return mutate && aRes.updated ? aRes.updated : agg;
        }
        return agg;
      });

      for (const step of sc.steps) {
        const refRes = transformSymbolRef(step.refId, targetId, newId);
        if (refRes.matched) {
          pushRef(
            'M4',
            sc.id,
            sc.name,
            `event_scenarios[${sc.id}].steps[${step.stepOrder}].refId`,
            `场景 ${sc.name} 步骤 ${step.stepOrder} 引用 ${step.refId}`,
            `Scenario ${sc.name} step ${step.stepOrder} references ${step.refId}`,
          );
          if (mutate && refRes.updated) step.refId = refRes.updated;
        }

        const taRes = transformSymbolRef(step.targetAggregate, targetId, newId);
        if (taRes.matched) {
          pushRef(
            'M4',
            sc.id,
            sc.name,
            `event_scenarios[${sc.id}].steps[${step.stepOrder}].targetAggregate`,
            `场景 ${sc.name} 步骤 ${step.stepOrder} 目标聚合根 ${step.targetAggregate}`,
            `Scenario ${sc.name} step ${step.stepOrder} targetAggregate ${step.targetAggregate}`,
          );
          if (mutate) step.targetAggregate = taRes.updated;
        }
      }

      const uiScrRes = transformSymbolRef(sc.uiTriggerScreen, targetId, newId);
      if (uiScrRes.matched) {
        pushRef(
          'M4',
          sc.id,
          sc.name,
          `event_scenarios[${sc.id}].uiTriggerScreen`,
          `场景 ${sc.name} 触发屏幕 ${sc.uiTriggerScreen}`,
          `Scenario ${sc.name} uiTriggerScreen ${sc.uiTriggerScreen}`,
        );
        if (mutate) sc.uiTriggerScreen = uiScrRes.updated;
      }
    }
  }

  // ─── M5 References ──────────────────────────────────────────────────────────
  if (suite.M5) {
    for (const act of suite.M5.actors) {
      act.roles = act.roles.map((r) => {
        const rRes = transformSymbolRef(r, targetId, newId);
        if (rRes.matched) {
          pushRef(
            'M5',
            act.id,
            act.name,
            `actors[${act.id}].roles`,
            `参与者 ${act.name} 绑定角色 ${r}`,
            `Actor ${act.name} binds role ${r}`,
          );
          return mutate && rRes.updated ? rRes.updated : r;
        }
        return r;
      });
    }

    for (const pg of suite.M5.permissionGroups ?? []) {
      pg.permissions = pg.permissions.map((p) => {
        const pRes = transformSymbolRef(p, targetId, newId);
        if (pRes.matched) {
          pushRef(
            'M5',
            pg.id,
            pg.name,
            `permissionGroups[${pg.id}].permissions`,
            `权限组 ${pg.name} 包含权限 ${p}`,
            `Permission group ${pg.name} includes permission ${p}`,
          );
          return mutate && pRes.updated ? pRes.updated : p;
        }
        return p;
      });
    }

    for (const role of suite.M5.roles) {
      role.inheritsFrom = role.inheritsFrom.map((parentId) => {
        const pRes = transformSymbolRef(parentId, targetId, newId);
        if (pRes.matched) {
          pushRef(
            'M5',
            role.id,
            role.name,
            `roles[${role.id}].inheritsFrom`,
            `角色 ${role.name} 继承父角色 ${parentId}`,
            `Role ${role.name} inherits from ${parentId}`,
          );
          return mutate && pRes.updated ? pRes.updated : parentId;
        }
        return parentId;
      });

      role.permissions = role.permissions.map((p) => {
        const pRes = transformSymbolRef(p, targetId, newId);
        if (pRes.matched) {
          pushRef(
            'M5',
            role.id,
            role.name,
            `roles[${role.id}].permissions`,
            `角色 ${role.name} 包含权限 ${p}`,
            `Role ${role.name} includes permission ${p}`,
          );
          return mutate && pRes.updated ? pRes.updated : p;
        }
        return p;
      });

      if (role.permissionGroups) {
        role.permissionGroups = role.permissionGroups.map((pgId) => {
          const pgRes = transformSymbolRef(pgId, targetId, newId);
          if (pgRes.matched) {
            pushRef(
              'M5',
              role.id,
              role.name,
              `roles[${role.id}].permissionGroups`,
              `角色 ${role.name} 关联权限组 ${pgId}`,
              `Role ${role.name} links permissionGroup ${pgId}`,
            );
            return mutate && pgRes.updated ? pgRes.updated : pgId;
          }
          return pgId;
        });
      }
    }

    for (const perm of suite.M5.permissions) {
      const taRes = transformSymbolRef(perm.targetAggregate, targetId, newId);
      if (taRes.matched) {
        pushRef(
          'M5',
          perm.id,
          perm.name,
          `permissions[${perm.id}].targetAggregate`,
          `权限 ${perm.name} 受控聚合根 ${perm.targetAggregate}`,
          `Permission ${perm.name} target aggregate ${perm.targetAggregate}`,
        );
        if (mutate && taRes.updated) perm.targetAggregate = taRes.updated;
      }

      const trRes = transformSymbolRef(perm.targetRef, targetId, newId);
      if (trRes.matched) {
        pushRef(
          'M5',
          perm.id,
          perm.name,
          `permissions[${perm.id}].targetRef`,
          `权限 ${perm.name} 目标引用 ${perm.targetRef}`,
          `Permission ${perm.name} targetRef ${perm.targetRef}`,
        );
        if (mutate) perm.targetRef = trRes.updated;
      }

      perm.allowedBehaviors = perm.allowedBehaviors.map((beh) => {
        const bRes = transformSymbolRef(beh, targetId, newId);
        if (bRes.matched) {
          pushRef(
            'M5',
            perm.id,
            perm.name,
            `permissions[${perm.id}].allowedBehaviors`,
            `权限 ${perm.name} 授权行为 ${beh}`,
            `Permission ${perm.name} allows behavior ${beh}`,
          );
          return mutate && bRes.updated ? bRes.updated : beh;
        }
        return beh;
      });

      perm.uiControlledElements = perm.uiControlledElements.map((elId) => {
        const elRes = transformSymbolRef(elId, targetId, newId);
        if (elRes.matched) {
          pushRef(
            'M5',
            perm.id,
            perm.name,
            `permissions[${perm.id}].uiControlledElements`,
            `权限 ${perm.name} 控制 UI 控件 ${elId}`,
            `Permission ${perm.name} controls UI element ${elId}`,
          );
          return mutate && elRes.updated ? elRes.updated : elId;
        }
        return elId;
      });
    }
  }

  // ─── M6 References ──────────────────────────────────────────────────────────
  if (suite.M6) {
    for (const fl of suite.M6.flows) {
      const paRes = transformSymbolRef(fl.primaryAggregate, targetId, newId);
      if (paRes.matched) {
        pushRef(
          'M6',
          fl.id,
          fl.name,
          `flows[${fl.id}].primaryAggregate`,
          `流程 ${fl.name} 主聚合根 ${fl.primaryAggregate}`,
          `Flow ${fl.name} primary aggregate ${fl.primaryAggregate}`,
        );
        if (mutate && paRes.updated) fl.primaryAggregate = paRes.updated;
      }

      if (fl.businessObjectRefs) {
        fl.businessObjectRefs = fl.businessObjectRefs.map((bo) => {
          const boRes = transformSymbolRef(bo, targetId, newId);
          if (boRes.matched) {
            pushRef(
              'M6',
              fl.id,
              fl.name,
              `flows[${fl.id}].businessObjectRefs`,
              `流程 ${fl.name} 关联业务对象 ${bo}`,
              `Flow ${fl.name} businessObjectRef ${bo}`,
            );
            return mutate && boRes.updated ? boRes.updated : bo;
          }
          return bo;
        });
      }

      fl.roleRefs = fl.roleRefs.map((r) => {
        const rRes = transformSymbolRef(r, targetId, newId);
        if (rRes.matched) {
          pushRef(
            'M6',
            fl.id,
            fl.name,
            `flows[${fl.id}].roleRefs`,
            `流程 ${fl.name} 参与角色 ${r}`,
            `Flow ${fl.name} participant role ${r}`,
          );
          return mutate && rRes.updated ? rRes.updated : r;
        }
        return r;
      });

      const tRefRes = transformSymbolRef(fl.trigger.refId, targetId, newId);
      if (tRefRes.matched) {
        pushRef(
          'M6',
          fl.id,
          fl.name,
          `flows[${fl.id}].trigger.refId`,
          `流程 ${fl.name} 触发引用 ${fl.trigger.refId}`,
          `Flow ${fl.name} trigger refId ${fl.trigger.refId}`,
        );
        if (mutate) fl.trigger.refId = tRefRes.updated;
      }

      const tBehRes = transformSymbolRef(fl.trigger.behaviorRef, targetId, newId);
      if (tBehRes.matched) {
        pushRef(
          'M6',
          fl.id,
          fl.name,
          `flows[${fl.id}].trigger.behaviorRef`,
          `流程 ${fl.name} 触发行为 ${fl.trigger.behaviorRef}`,
          `Flow ${fl.name} trigger behaviorRef ${fl.trigger.behaviorRef}`,
        );
        if (mutate) fl.trigger.behaviorRef = tBehRes.updated;
      }

      const tEvRes = transformSymbolRef(fl.trigger.eventRef, targetId, newId);
      if (tEvRes.matched) {
        pushRef(
          'M6',
          fl.id,
          fl.name,
          `flows[${fl.id}].trigger.eventRef`,
          `流程 ${fl.name} 触发事件 ${fl.trigger.eventRef}`,
          `Flow ${fl.name} trigger eventRef ${fl.trigger.eventRef}`,
        );
        if (mutate) fl.trigger.eventRef = tEvRes.updated;
      }

      for (const act of fl.activities) {
        const actFields: (
          | 'roleRef'
          | 'behaviorRef'
          | 'scenarioRef'
          | 'subFlowRef'
          | 'screenRef'
          | 'ruleRef'
          | 'eventRef'
        )[] = [
          'roleRef',
          'behaviorRef',
          'scenarioRef',
          'subFlowRef',
          'screenRef',
          'ruleRef',
          'eventRef',
        ];
        for (const key of actFields) {
          const fRes = transformSymbolRef(act[key], targetId, newId);
          if (fRes.matched) {
            pushRef(
              'M6',
              fl.id,
              fl.name,
              `flows[${fl.id}].activities[${act.id}].${key}`,
              `流程 ${fl.name} 节点 ${act.name} ${key} 引用 ${act[key]}`,
              `Flow ${fl.name} activity ${act.name} ${key} references ${act[key]}`,
            );
            if (mutate) act[key] = fRes.updated;
          }
        }
        for (const br of act.branches) {
          const brRuleRes = transformSymbolRef(br.ruleRef, targetId, newId);
          if (brRuleRes.matched) {
            pushRef(
              'M6',
              fl.id,
              fl.name,
              `flows[${fl.id}].activities[${act.id}].branches.ruleRef`,
              `流程 ${fl.name} 网关分支规则引用 ${br.ruleRef}`,
              `Flow ${fl.name} gateway branch ruleRef ${br.ruleRef}`,
            );
            if (mutate) br.ruleRef = brRuleRes.updated;
          }
        }
      }
    }
  }

  // ─── M7 References ──────────────────────────────────────────────────────────
  if (suite.M7) {
    for (const rp of suite.M7.query_reports) {
      const bRes = transformSymbolRef(rp.behaviorRef, targetId, newId);
      if (bRes.matched) {
        pushRef(
          'M7',
          rp.id,
          rp.name,
          `query_reports[${rp.id}].behaviorRef`,
          `报表 ${rp.name} 关联查询行为 ${rp.behaviorRef}`,
          `Report ${rp.name} links query behavior ${rp.behaviorRef}`,
        );
        if (mutate && bRes.updated) rp.behaviorRef = bRes.updated;
      }

      const psRes = transformSymbolRef(rp.primarySource.aggregateRef, targetId, newId);
      if (psRes.matched) {
        pushRef(
          'M7',
          rp.id,
          rp.name,
          `query_reports[${rp.id}].primarySource.aggregateRef`,
          `报表 ${rp.name} 主数据源引用 ${rp.primarySource.aggregateRef}`,
          `Report ${rp.name} primarySource references ${rp.primarySource.aggregateRef}`,
        );
        if (mutate && psRes.updated) rp.primarySource.aggregateRef = psRes.updated;
      }

      for (const so of rp.sourceObjects ?? []) {
        const soRes = transformSymbolRef(so.objectRef, targetId, newId);
        if (soRes.matched) {
          pushRef(
            'M7',
            rp.id,
            rp.name,
            `query_reports[${rp.id}].sourceObjects[${so.alias}].objectRef`,
            `报表 ${rp.name} 数据源引用 ${so.objectRef}`,
            `Report ${rp.name} sourceObject ${so.alias} references ${so.objectRef}`,
          );
          if (mutate && soRes.updated) so.objectRef = soRes.updated;
        }
      }

      for (const jn of rp.joins) {
        const jaRes = transformSymbolRef(jn.aggregateRef, targetId, newId);
        if (jaRes.matched) {
          pushRef(
            'M7',
            rp.id,
            rp.name,
            `query_reports[${rp.id}].joins[${jn.alias}].aggregateRef`,
            `报表 ${rp.name} 关联数据源引用 ${jn.aggregateRef}`,
            `Report ${rp.name} join ${jn.alias} references ${jn.aggregateRef}`,
          );
          if (mutate && jaRes.updated) jn.aggregateRef = jaRes.updated;
        }

        const jrRes = transformSymbolRef(jn.relationRef, targetId, newId);
        if (jrRes.matched) {
          pushRef(
            'M7',
            rp.id,
            rp.name,
            `query_reports[${rp.id}].joins[${jn.alias}].relationRef`,
            `报表 ${rp.name} 关联关系引用 ${jn.relationRef}`,
            `Report ${rp.name} join ${jn.alias} relationRef ${jn.relationRef}`,
          );
          if (mutate) jn.relationRef = jrRes.updated;
        }
      }

      if (rp.uiScreenRefs) {
        rp.uiScreenRefs = rp.uiScreenRefs.map((scrId) => {
          const sRes = transformSymbolRef(scrId, targetId, newId);
          if (sRes.matched) {
            pushRef(
              'M7',
              rp.id,
              rp.name,
              `query_reports[${rp.id}].uiScreenRefs`,
              `报表 ${rp.name} 关联 UI 屏幕 ${scrId}`,
              `Report ${rp.name} links UI screen ${scrId}`,
            );
            return mutate && sRes.updated ? sRes.updated : scrId;
          }
          return scrId;
        });
      }
    }
  }

  // ─── MU References ──────────────────────────────────────────────────────────
  if (suite.MU) {
    for (const sc of suite.MU.screens) {
      sc.roleRefs = sc.roleRefs.map((rId) => {
        const rRes = transformSymbolRef(rId, targetId, newId);
        if (rRes.matched) {
          pushRef(
            'MU',
            sc.screenId,
            sc.name,
            `screens[${sc.screenId}].roleRefs`,
            `界面 ${sc.name} 授权角色 ${rId}`,
            `Screen ${sc.name} roleRef ${rId}`,
          );
          return mutate && rRes.updated ? rRes.updated : rId;
        }
        return rId;
      });

      if (sc.screenRef && sc.screenId !== targetId) {
        const srRes = transformSymbolRef(sc.screenRef, targetId, newId);
        if (srRes.matched) {
          pushRef(
            'MU',
            sc.screenId,
            sc.name,
            `screens[${sc.screenId}].screenRef`,
            `界面 ${sc.name} screenRef ${sc.screenRef}`,
            `Screen ${sc.name} screenRef ${sc.screenRef}`,
          );
          if (mutate) sc.screenRef = srRes.updated;
        }
      }

      if (sc.layout) {
        const layRes = transformLayoutSymbol(sc.layout, targetId, newId);
        if (layRes.matched) {
          pushRef(
            'MU',
            sc.screenId,
            sc.name,
            `screens[${sc.screenId}].layout`,
            `界面 ${sc.name} ASCII 布局引用 ${targetId}`,
            `Screen ${sc.name} ASCII layout references ${targetId}`,
          );
          if (mutate) sc.layout = layRes.updated;
        }
      }

      for (const el of sc.elements) {
        const dbRes = transformSymbolRef(el.dataBinding, targetId, newId);
        if (dbRes.matched) {
          pushRef(
            'MU',
            sc.screenId,
            sc.name,
            `screens[${sc.screenId}].elements[${el.elementId}].dataBinding`,
            `界面 ${sc.name} 控件 ${el.label} 绑定 ${el.dataBinding}`,
            `Screen ${sc.name} element ${el.label} binds ${el.dataBinding}`,
          );
          if (mutate) el.dataBinding = dbRes.updated;
        }

        const dictRes = transformSymbolRef(el.dictionaryRef, targetId, newId);
        if (dictRes.matched) {
          pushRef(
            'MU',
            sc.screenId,
            sc.name,
            `screens[${sc.screenId}].elements[${el.elementId}].dictionaryRef`,
            `界面 ${sc.name} 控件 ${el.label} 引用字典 ${el.dictionaryRef}`,
            `Screen ${sc.name} element ${el.label} dictionaryRef ${el.dictionaryRef}`,
          );
          if (mutate) el.dictionaryRef = dictRes.updated;
        }

        const dsRes = transformSymbolRef(el.dataSource, targetId, newId);
        if (dsRes.matched) {
          pushRef(
            'MU',
            sc.screenId,
            sc.name,
            `screens[${sc.screenId}].elements[${el.elementId}].dataSource`,
            `界面 ${sc.name} 控件 ${el.label} 数据源 ${el.dataSource}`,
            `Screen ${sc.name} element ${el.label} dataSource ${el.dataSource}`,
          );
          if (mutate) el.dataSource = dsRes.updated;
        }

        const pmRes = transformSymbolRef(el.permissionRef, targetId, newId);
        if (pmRes.matched) {
          pushRef(
            'MU',
            sc.screenId,
            sc.name,
            `screens[${sc.screenId}].elements[${el.elementId}].permissionRef`,
            `界面 ${sc.name} 控件 ${el.label} 权限引用 ${el.permissionRef}`,
            `Screen ${sc.name} element ${el.label} permissionRef ${el.permissionRef}`,
          );
          if (mutate) el.permissionRef = pmRes.updated;
        }
      }

      for (const ev of sc.events) {
        const teRes = transformSymbolRef(ev.triggerElementId, targetId, newId);
        if (teRes.matched) {
          pushRef(
            'MU',
            sc.screenId,
            sc.name,
            `screens[${sc.screenId}].events[${ev.eventId}].triggerElementId`,
            `界面事件 ${ev.name} 绑定触发控件 ${ev.triggerElementId}`,
            `UI event ${ev.name} binds trigger element ${ev.triggerElementId}`,
          );
          if (mutate && teRes.updated) ev.triggerElementId = teRes.updated;
        }

        ev.permissions = ev.permissions.map((permId) => {
          const pRes = transformSymbolRef(permId, targetId, newId);
          if (pRes.matched) {
            pushRef(
              'MU',
              sc.screenId,
              sc.name,
              `screens[${sc.screenId}].events[${ev.eventId}].permissions`,
              `界面事件 ${ev.name} 引用权限 ${permId}`,
              `UI event ${ev.name} permission ${permId}`,
            );
            return mutate && pRes.updated ? pRes.updated : permId;
          }
          return permId;
        });

        for (const step of ev.callChain) {
          const sRes = transformSymbolRef(step.refId, targetId, newId);
          if (sRes.matched) {
            pushRef(
              'MU',
              sc.screenId,
              sc.name,
              `screens[${sc.screenId}].events[${ev.eventId}].callChain[${step.stepOrder}]`,
              `界面事件 ${ev.name} 调用链步骤 ${step.stepOrder} 引用 ${step.refId}`,
              `UI event ${ev.name} callChain step ${step.stepOrder} references ${step.refId}`,
            );
            if (mutate && sRes.updated) step.refId = sRes.updated;
          }

          if (step.rules) {
            step.rules = step.rules.map((rId) => {
              const rRes = transformSymbolRef(rId, targetId, newId);
              if (rRes.matched) {
                pushRef(
                  'MU',
                  sc.screenId,
                  sc.name,
                  `screens[${sc.screenId}].events[${ev.eventId}].callChain[${step.stepOrder}].rules`,
                  `界面事件 ${ev.name} 校验步骤规则 ${rId}`,
                  `UI event ${ev.name} VALIDATE rule ${rId}`,
                );
                return mutate && rRes.updated ? rRes.updated : rId;
              }
              return rId;
            });
          }

          if (step.targets) {
            step.targets = step.targets.map((tId) => {
              const tRes = transformSymbolRef(tId, targetId, newId);
              if (tRes.matched) {
                pushRef(
                  'MU',
                  sc.screenId,
                  sc.name,
                  `screens[${sc.screenId}].events[${ev.eventId}].callChain[${step.stepOrder}].targets`,
                  `界面事件 ${ev.name} 目标控件 ${tId}`,
                  `UI event ${ev.name} target element ${tId}`,
                );
                return mutate && tRes.updated ? tRes.updated : tId;
              }
              return tId;
            });
          }
        }
      }
    }

    for (const edge of suite.MU.navigation_edges) {
      const fromRes = transformSymbolRef(edge.fromScreen, targetId, newId);
      if (fromRes.matched) {
        pushRef(
          'MU',
          edge.id,
          edge.id,
          `navigation_edges[${edge.id}].fromScreen`,
          `导航边 ${edge.id} 来源屏幕 ${edge.fromScreen}`,
          `Navigation edge ${edge.id} fromScreen ${edge.fromScreen}`,
        );
        if (mutate && fromRes.updated) edge.fromScreen = fromRes.updated;
      }

      const toRes = transformSymbolRef(edge.toScreen, targetId, newId);
      if (toRes.matched) {
        pushRef(
          'MU',
          edge.id,
          edge.id,
          `navigation_edges[${edge.id}].toScreen`,
          `导航边 ${edge.id} 目标屏幕 ${edge.toScreen}`,
          `Navigation edge ${edge.id} toScreen ${edge.toScreen}`,
        );
        if (mutate && toRes.updated) edge.toScreen = toRes.updated;
      }

      const evRes = transformSymbolRef(edge.triggerEventId, targetId, newId);
      if (evRes.matched) {
        pushRef(
          'MU',
          edge.id,
          edge.id,
          `navigation_edges[${edge.id}].triggerEventId`,
          `导航边 ${edge.id} 触发事件 ${edge.triggerEventId}`,
          `Navigation edge ${edge.id} triggerEventId ${edge.triggerEventId}`,
        );
        if (mutate) edge.triggerEventId = evRes.updated;
      }
    }

    for (const cc of suite.MU.cross_cutting_ui) {
      cc.scopeScreens = cc.scopeScreens.map((sId) => {
        const sRes = transformSymbolRef(sId, targetId, newId);
        if (sRes.matched) {
          pushRef(
            'MU',
            cc.id,
            cc.name,
            `cross_cutting_ui[${cc.id}].scopeScreens`,
            `全局 UI 规则 ${cc.name} 适用屏幕 ${sId}`,
            `Cross-cutting UI ${cc.name} scopeScreen ${sId}`,
          );
          return mutate && sRes.updated ? sRes.updated : sId;
        }
        return sId;
      });

      const tgtRes = transformSymbolRef(cc.target, targetId, newId);
      if (tgtRes.matched) {
        pushRef(
          'MU',
          cc.id,
          cc.name,
          `cross_cutting_ui[${cc.id}].target`,
          `全局 UI 规则 ${cc.name} 目标屏幕 ${cc.target}`,
          `Cross-cutting UI ${cc.name} target ${cc.target}`,
        );
        if (mutate) cc.target = tgtRes.updated;
      }

      if (cc.rules) {
        cc.rules = cc.rules.map((rId) => {
          const rRes = transformSymbolRef(rId, targetId, newId);
          if (rRes.matched) {
            pushRef(
              'MU',
              cc.id,
              cc.name,
              `cross_cutting_ui[${cc.id}].rules`,
              `全局 UI 规则 ${cc.name} 引用规则 ${rId}`,
              `Cross-cutting UI ${cc.name} rule ${rId}`,
            );
            return mutate && rRes.updated ? rRes.updated : rId;
          }
          return rId;
        });
      }
    }
  }

  // ─── MM References ──────────────────────────────────────────────────────────
  if (suite.MM) {
    for (const mp of suite.MM.mappings) {
      const orRes = transformSymbolRef(mp.objectRef, targetId, newId);
      if (orRes.matched) {
        pushRef(
          'MM',
          mp.id,
          mp.objectName,
          `mappings[${mp.id}].objectRef`,
          `数据表映射 ${mp.id} objectRef 引用 ${mp.objectRef}`,
          `Table mapping ${mp.id} objectRef references ${mp.objectRef}`,
        );
        if (mutate && orRes.updated) mp.objectRef = orRes.updated;
      }

      const onRes = transformSymbolRef(mp.objectName, targetId, newId);
      if (onRes.matched) {
        pushRef(
          'MM',
          mp.id,
          mp.objectName,
          `mappings[${mp.id}].objectName`,
          `数据表映射 ${mp.id} 映射对象 ${mp.objectName}`,
          `Table mapping ${mp.id} maps object ${mp.objectName}`,
        );
        if (mutate && onRes.updated) mp.objectName = onRes.updated;
      }

      for (const tm of mp.tableMappings) {
        for (const fk of tm.foreignKeys) {
          const fkAssocRes = transformSymbolRef(fk.associationRef, targetId, newId);
          if (fkAssocRes.matched) {
            pushRef(
              'MM',
              mp.id,
              mp.objectName,
              `mappings[${mp.id}].tableMappings[${tm.tableName}].foreignKeys[${fk.fkName}].associationRef`,
              `外键 ${fk.fkName} 引用关联 ${fk.associationRef}`,
              `Foreign key ${fk.fkName} references association ${fk.associationRef}`,
            );
            if (mutate) fk.associationRef = fkAssocRes.updated;
          }
        }

        for (const cm of tm.columnMappings) {
          const cmRes = transformSymbolRef(cm.attributeRef, targetId, newId);
          if (cmRes.matched) {
            pushRef(
              'MM',
              mp.id,
              mp.objectName,
              `mappings[${mp.id}].tableMappings[${tm.tableName}].columnMappings[${cm.column}].attributeRef`,
              `字段映射 ${tm.tableName}.${cm.column} 引用属性 ${cm.attributeRef}`,
              `Column mapping ${tm.tableName}.${cm.column} references ${cm.attributeRef}`,
            );
            if (mutate && cmRes.updated) cm.attributeRef = cmRes.updated;
          }
        }
      }
    }
  }

  // ─── MI References ──────────────────────────────────────────────────────────
  if (suite.MI) {
    const visitInterfaceFields = (
      ifaceId: string,
      ifaceName: string,
      fields: InterfaceFieldSpec[],
      pathPrefix: string,
    ) => {
      for (const f of fields) {
        const mrRes = transformSymbolRef(f.mappedRef, targetId, newId);
        if (mrRes.matched) {
          pushRef(
            'MI',
            ifaceId,
            ifaceName,
            `${pathPrefix}[${f.name}].mappedRef`,
            `接口 ${ifaceName} 字段 ${f.name} 映射 ${f.mappedRef}`,
            `Interface ${ifaceName} field ${f.name} maps ${f.mappedRef}`,
          );
          if (mutate) f.mappedRef = mrRes.updated;
        }
        if (f.fields && f.fields.length > 0) {
          visitInterfaceFields(ifaceId, ifaceName, f.fields, `${pathPrefix}[${f.name}].fields`);
        }
      }
    };

    for (const iface of suite.MI.interfaces) {
      const relFields: (
        | 'relatedBehaviorRef'
        | 'relatedEntityRef'
        | 'relatedReportRef'
        | 'relatedEventRef'
        | 'relatedExternalEntityRef'
      )[] = [
        'relatedBehaviorRef',
        'relatedEntityRef',
        'relatedReportRef',
        'relatedEventRef',
        'relatedExternalEntityRef',
      ];
      for (const key of relFields) {
        const rRes = transformSymbolRef(iface[key], targetId, newId);
        if (rRes.matched) {
          pushRef(
            'MI',
            iface.interfaceId,
            iface.name,
            `interfaces[${iface.interfaceId}].${key}`,
            `接口 ${iface.name} ${key} 关联引用 ${iface[key]}`,
            `Interface ${iface.name} ${key} links ${iface[key]}`,
          );
          if (mutate) iface[key] = rRes.updated;
        }
      }

      visitInterfaceFields(
        iface.interfaceId,
        iface.name,
        iface.inputFields,
        `interfaces[${iface.interfaceId}].inputFields`,
      );
      visitInterfaceFields(
        iface.interfaceId,
        iface.name,
        iface.outputFields,
        `interfaces[${iface.interfaceId}].outputFields`,
      );
    }
  }

  return references;
}

export function analyzeImpact(suite: OntologySuite, targetId: string): ImpactAnalysisReport {
  const info = locateTargetInfo(suite, targetId);
  const references = visitAndTransformReferences(suite, targetId);

  return {
    targetId,
    targetModel: info.model,
    targetName: info.name,
    canDeleteSafely: references.length === 0,
    references,
  };
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
  const info = locateTargetInfo(suite, oldId);
  const next = cloneSuite(suite);

  // 1. Update all cross-model and intra-model references (synchronized with analyzeImpact)
  const changedReferences = visitAndTransformReferences(next, oldId, newId);

  // 2. Rename primary symbol definitions across M1..MI
  if (next.M1) {
    for (const agg of next.M1.aggregates) {
      const prevAggName = agg.name;
      if (agg.id === oldId) agg.id = newId;
      if (agg.name === oldId) agg.name = newId;
      for (const attr of agg.attributes) {
        if (`${prevAggName}.${attr.name}` === oldId) {
          attr.name = newId.includes('.') ? newId.split('.').pop()! : newId;
        }
      }
      for (const ent of agg.entities) {
        const prevEntName = ent.name;
        if (ent.name === oldId || `${prevAggName}.${ent.name}` === oldId) {
          ent.name = newId.includes('.') ? newId.split('.').pop()! : newId;
        }
        for (const attr of ent.attributes) {
          if (
            `${prevEntName}.${attr.name}` === oldId ||
            `${prevAggName}.${prevEntName}.${attr.name}` === oldId
          ) {
            attr.name = newId.includes('.') ? newId.split('.').pop()! : newId;
          }
        }
      }
      for (const vo of agg.valueObjects) {
        if (vo.name === oldId || `${prevAggName}.${vo.name}` === oldId) {
          vo.name = newId.includes('.') ? newId.split('.').pop()! : newId;
        }
      }
    }
    for (const dict of next.M1.data_dictionaries) {
      if (dict.id === oldId) dict.id = newId;
    }
    for (const assoc of next.M1.aggregate_associations) {
      if (assoc.id === oldId) assoc.id = newId;
    }
  }

  if (next.M2) {
    for (const beh of next.M2.behaviors) {
      if (beh.id === oldId) beh.id = newId;
      if (beh.name === oldId) beh.name = newId;
    }
  }

  if (next.M3) {
    for (const rule of next.M3.rules) {
      if (rule.id === oldId) rule.id = newId;
      if (rule.name === oldId) rule.name = newId;
    }
  }

  if (next.ME) {
    for (const ev of next.ME.events) {
      if (ev.id === oldId) ev.id = newId;
      if (ev.name === oldId) ev.name = newId;
    }
  }

  if (next.M4) {
    for (const sc of next.M4.event_scenarios) {
      if (sc.id === oldId) sc.id = newId;
      if (sc.name === oldId) sc.name = newId;
    }
  }

  if (next.M5) {
    for (const act of next.M5.actors) {
      if (act.id === oldId) act.id = newId;
    }
    for (const role of next.M5.roles) {
      if (role.id === oldId) role.id = newId;
      if (role.code === oldId) role.code = newId;
    }
    for (const pg of next.M5.permissionGroups ?? []) {
      if (pg.id === oldId) pg.id = newId;
    }
    for (const perm of next.M5.permissions) {
      if (perm.id === oldId) perm.id = newId;
      if (perm.code === oldId) perm.code = newId;
    }
  }

  if (next.M6) {
    for (const fl of next.M6.flows) {
      if (fl.id === oldId) fl.id = newId;
    }
  }

  if (next.M7) {
    for (const rp of next.M7.query_reports) {
      if (rp.id === oldId) rp.id = newId;
      if (rp.name === oldId) rp.name = newId;
    }
  }

  if (next.MU) {
    for (const sc of next.MU.screens) {
      if (sc.screenId === oldId) {
        if (sc.screenRef === sc.screenId) sc.screenRef = newId;
        sc.screenId = newId;
      }
      for (const el of sc.elements) {
        if (el.elementId === oldId) el.elementId = newId;
      }
      for (const ev of sc.events) {
        if (ev.eventId === oldId) ev.eventId = newId;
      }
    }
  }

  if (next.MM) {
    for (const mp of next.MM.mappings) {
      if (mp.id === oldId) mp.id = newId;
    }
  }

  if (next.MI) {
    for (const iface of next.MI.interfaces) {
      if (iface.interfaceId === oldId) iface.interfaceId = newId;
    }
  }

  const timestamp = new Date().toISOString();
  const changelogEntry = [
    `## [${timestamp}] Cascade Rename \`${oldId}\` -> \`${newId}\``,
    `- Target Model: \`${info.model}\` (${info.name})`,
    `- Updated Cross-Model References: ${changedReferences.length}`,
    ...changedReferences.map(
      (ref) => `  - [${ref.model}] \`${ref.elementId}\` (${ref.fieldPath}): ${ref.descriptionZh}`,
    ),
    '',
  ].join('\n');

  return {
    suite: next,
    changedReferences,
    changelogEntry,
  };
}
