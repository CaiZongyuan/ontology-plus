import {
  MODEL_CODES,
  MODEL_STAGE_ORDER,
  type ModelCode,
  type OntologySuite,
  type ValidationDiagnostic,
  type ValidationReport,
} from './types';

const CALL_CHAIN_STEP_RANK: Record<string, number> = {
  VALIDATE: 1,
  BEHAVIOR_CALL: 2,
  EVENT_EMIT: 3,
  SCENARIO_CALL: 4,
  REPORT_CALL: 5,
  QUERY_REPORT: 5,
  NAVIGATE: 6,
};

export function extractLayoutElementIds(layout: string): {
  elementId: string;
  requiredInLayout: boolean;
}[] {
  const results: { elementId: string; requiredInLayout: boolean }[] = [];
  const seen = new Set<string>();
  // Matches [elementId], [elementId*], [elementId Label...], @grdName, {tbrName}
  const bracketRegex = /\[([a-zA-Z0-9_-]+)(\*)?(?:\s+[^\]]*)?\]/g;
  let match: RegExpExecArray | null;
  while ((match = bracketRegex.exec(layout)) !== null) {
    const id = match[1];
    const req = Boolean(match[2]);
    if (!seen.has(id)) {
      seen.add(id);
      results.push({ elementId: id, requiredInLayout: req });
    }
  }
  const gridRegex = /@([a-zA-Z0-9_-]+)/g;
  while ((match = gridRegex.exec(layout)) !== null) {
    const id = match[1];
    if (!seen.has(id)) {
      seen.add(id);
      results.push({ elementId: id, requiredInLayout: false });
    }
  }
  return results;
}

export function validateOntologySuite(suite: OntologySuite): ValidationReport {
  const diagnostics: ValidationDiagnostic[] = [];
  const presentModels: ModelCode[] = [];
  const missingModels: ModelCode[] = [];

  for (const stageInfo of MODEL_STAGE_ORDER) {
    const code = stageInfo.code;
    if (suite[code]) {
      presentModels.push(code);
    } else {
      missingModels.push(code);
      diagnostics.push({
        id: `STAGE-MISSING-${code}`,
        tier: 'STAGE_WARNING',
        code: 'STAGE_MODEL_MISSING',
        model: code,
        messageZh: `阶段 ${stageInfo.stage}（${stageInfo.labelZh}）尚未创建，可按渐进式建模顺序后续补齐。`,
        messageEn: `Stage ${stageInfo.stage} (${stageInfo.labelEn}) is not yet authored; can be completed progressively.`,
      });
    }
  }

  // Build lookup indexes across present models
  const aggregateIds = new Set<string>();
  const aggregateAliases = new Map<string, string>(); // alias -> id
  const aggregateAttributes = new Map<string, Set<string>>(); // aggId -> Set<attrName>
  const dictionaryTypes = new Map<string, Set<string>>(); // dictId -> Set<typeCode>

  if (suite.M1) {
    for (const dict of suite.M1.data_dictionaries) {
      const typeSet = new Set<string>();
      for (const t of dict.types) {
        typeSet.add(t.typeCode);
      }
      dictionaryTypes.set(dict.id, typeSet);
    }

    for (const agg of suite.M1.aggregates) {
      aggregateIds.add(agg.id);
      aggregateIds.add(agg.name);
      aggregateIds.add(agg.alias);
      aggregateAliases.set(agg.alias, agg.id);
      aggregateAliases.set(agg.name, agg.id);
      const attrs = new Set<string>();
      const voNames = new Set(agg.valueObjects.map((vo) => vo.alias || vo.name));
      for (const vo of agg.valueObjects) {
        voNames.add(vo.name);
        voNames.add(vo.alias);
      }

      for (const attr of agg.attributes) {
        attrs.add(attr.name);
        if (attr.type === 'AggregateRootRef' && !attr.targetAggregate) {
          diagnostics.push({
            id: `M1-AGG-REF-EMPTY-${agg.id}-${attr.name}`,
            tier: 'ERROR',
            code: 'M1_MISSING_TARGET_AGGREGATE',
            model: 'M1',
            elementId: agg.id,
            path: `aggregates.${agg.id}.attributes.${attr.name}`,
            messageZh: `聚合「${agg.name}」的属性「${attr.name}」类型为 AggregateRootRef，必须声明 targetAggregate。`,
            messageEn: `Attribute "${attr.name}" on aggregate "${agg.name}" is AggregateRootRef and must declare targetAggregate.`,
          });
        }
        if (attr.type === 'DictionaryRef') {
          if (attr.enumValues && attr.enumValues.length > 0) {
            diagnostics.push({
              id: `M1-DICT-ENUM-CONFLICT-${agg.id}-${attr.name}`,
              tier: 'ERROR',
              code: 'M1_DICT_ENUM_CONFLICT',
              model: 'M1',
              elementId: agg.id,
              path: `aggregates.${agg.id}.attributes.${attr.name}`,
              messageZh: `属性「${attr.name}」类型为 DictionaryRef，不得同时声明 enumValues。`,
              messageEn: `Attribute "${attr.name}" of type DictionaryRef must not also declare enumValues.`,
            });
          }
          if (!attr.dictionaryRef) {
            diagnostics.push({
              id: `M1-DICT-REF-MISSING-${agg.id}-${attr.name}`,
              tier: 'ERROR',
              code: 'M1_DICT_REF_MISSING',
              model: 'M1',
              elementId: agg.id,
              path: `aggregates.${agg.id}.attributes.${attr.name}`,
              messageZh: `属性「${attr.name}」类型为 DictionaryRef，必须提供 dictionaryRef。`,
              messageEn: `Attribute "${attr.name}" of type DictionaryRef must provide dictionaryRef.`,
            });
          } else {
            const typesForDict = dictionaryTypes.get(attr.dictionaryRef.dictionaryId);
            if (!typesForDict || !typesForDict.has(attr.dictionaryRef.typeCode)) {
              diagnostics.push({
                id: `M1-DICT-DANGLING-${agg.id}-${attr.name}`,
                tier: 'ERROR',
                code: 'M1_DANGLING_DICTIONARY_REF',
                model: 'M1',
                elementId: agg.id,
                path: `aggregates.${agg.id}.attributes.${attr.name}`,
                messageZh: `属性「${attr.name}」引用了不存在的数据字典项 ${attr.dictionaryRef.dictionaryId}.${attr.dictionaryRef.typeCode}。`,
                messageEn: `Attribute "${attr.name}" references non-existent dictionary ${attr.dictionaryRef.dictionaryId}.${attr.dictionaryRef.typeCode}.`,
              });
            }
          }
        }
        if (attr.type === 'ValueObject' && attr.valueObjectRef && !voNames.has(attr.valueObjectRef)) {
          diagnostics.push({
            id: `M1-VO-DANGLING-${agg.id}-${attr.name}`,
            tier: 'ERROR',
            code: 'M1_DANGLING_VALUE_OBJECT_REF',
            model: 'M1',
            elementId: agg.id,
            path: `aggregates.${agg.id}.attributes.${attr.name}`,
            messageZh: `属性「${attr.name}」引用了不存在的值对象「${attr.valueObjectRef}」。`,
            messageEn: `Attribute "${attr.name}" references non-existent ValueObject "${attr.valueObjectRef}".`,
          });
        }
        for (const rule of attr.refRules ?? []) {
          if (!/\bvalue\b/.test(rule.expression)) {
            diagnostics.push({
              id: `M1-REFRULE-VALUE-${agg.id}-${attr.name}-${rule.name}`,
              tier: 'ERROR',
              code: 'M1_REFRULE_INVALID_EXPRESSION',
              model: 'M1',
              elementId: agg.id,
              path: `aggregates.${agg.id}.attributes.${attr.name}.refRules.${rule.name}`,
              messageZh: `属性「${attr.name}」的扩展规则「${rule.name}」表达式必须使用 value 引用当前属性值。`,
              messageEn: `Attribute rule "${rule.name}" on "${attr.name}" must reference "value" in its expression.`,
            });
          }
        }
      }

      for (const ent of agg.entities) {
        for (const attr of ent.attributes) {
          attrs.add(`${ent.alias}.${attr.name}`);
          attrs.add(`items[].${attr.name}`);
          attrs.add(attr.name);
        }
      }
      aggregateAttributes.set(agg.id, attrs);
    }

    // Second pass on M1 for cross-aggregate refs
    for (const agg of suite.M1.aggregates) {
      for (const attr of agg.attributes) {
        if (attr.type === 'AggregateRootRef' && attr.targetAggregate && !aggregateIds.has(attr.targetAggregate)) {
          diagnostics.push({
            id: `M1-DANGLING-AGG-REF-${agg.id}-${attr.name}`,
            tier: 'ERROR',
            code: 'M1_DANGLING_AGGREGATE_REF',
            model: 'M1',
            elementId: agg.id,
            path: `aggregates.${agg.id}.attributes.${attr.name}`,
            messageZh: `聚合「${agg.name}」的属性「${attr.name}」引用了不存在的目标聚合根「${attr.targetAggregate}」。`,
            messageEn: `Attribute "${attr.name}" on "${agg.name}" references unknown aggregate "${attr.targetAggregate}".`,
          });
        }
      }
    }

    for (const assoc of suite.M1.aggregate_associations) {
      if (!aggregateIds.has(assoc.sourceAggregate)) {
        diagnostics.push({
          id: `M1-ASSOC-SRC-${assoc.id}`,
          tier: 'ERROR',
          code: 'M1_DANGLING_ASSOCIATION_SOURCE',
          model: 'M1',
          elementId: assoc.id,
          messageZh: `聚合关联「${assoc.id}」的来源聚合「${assoc.sourceAggregate}」不存在。`,
          messageEn: `Association "${assoc.id}" sourceAggregate "${assoc.sourceAggregate}" does not exist.`,
        });
      }
      if (!aggregateIds.has(assoc.targetAggregate)) {
        diagnostics.push({
          id: `M1-ASSOC-TGT-${assoc.id}`,
          tier: 'ERROR',
          code: 'M1_DANGLING_ASSOCIATION_TARGET',
          model: 'M1',
          elementId: assoc.id,
          messageZh: `聚合关联「${assoc.id}」的目标聚合「${assoc.targetAggregate}」不存在。`,
          messageEn: `Association "${assoc.id}" targetAggregate "${assoc.targetAggregate}" does not exist.`,
        });
      }
    }
  }

  const behaviorIds = new Set<string>();
  const behaviorById = new Map<string, NonNullable<OntologySuite['M2']>['behaviors'][number]>();
  if (suite.M2) {
    for (const b of suite.M2.behaviors) {
      behaviorIds.add(b.id);
      behaviorById.set(b.id, b);
    }
  }

  const ruleIds = new Set<string>();
  if (suite.M3) {
    for (const r of suite.M3.rules) {
      ruleIds.add(r.id);
    }
  }

  const eventIds = new Set<string>();
  const eventById = new Map<string, NonNullable<OntologySuite['ME']>['events'][number]>();
  if (suite.ME) {
    for (const ev of suite.ME.events) {
      eventIds.add(ev.id);
      eventById.set(ev.id, ev);
    }
  }

  const scenarioIds = new Set<string>();
  const scenarioById = new Map<string, NonNullable<OntologySuite['M4']>['event_scenarios'][number]>();
  if (suite.M4) {
    for (const sc of suite.M4.event_scenarios) {
      scenarioIds.add(sc.id);
      scenarioById.set(sc.id, sc);
    }
  }

  const actorIds = new Set<string>();
  const externalActorIds = new Set<string>();
  const roleIds = new Set<string>();
  const permissionIds = new Set<string>();
  if (suite.M5) {
    for (const a of suite.M5.actors) {
      actorIds.add(a.id);
      if (a.actorType === 'EXTERNAL_ENTITY') externalActorIds.add(a.id);
    }
    for (const r of suite.M5.roles) roleIds.add(r.id);
    for (const p of suite.M5.permissions) permissionIds.add(p.id);
  }

  const flowIds = new Set<string>();
  if (suite.M6) {
    for (const f of suite.M6.flows) flowIds.add(f.id);
  }

  const reportIds = new Set<string>();
  const reportById = new Map<string, NonNullable<OntologySuite['M7']>['query_reports'][number]>();
  if (suite.M7) {
    for (const qr of suite.M7.query_reports) {
      reportIds.add(qr.id);
      reportById.set(qr.id, qr);
    }
  }

  const screenIds = new Set<string>();
  if (suite.MU) {
    for (const s of suite.MU.screens) screenIds.add(s.screenId);
  }

  // ─── M2 Validation ──────────────────────────────────────────────────────────
  if (suite.M2) {
    for (const b of suite.M2.behaviors) {
      if (suite.M1 && !aggregateIds.has(b.ownerEntity)) {
        diagnostics.push({
          id: `M2-OWNER-${b.id}`,
          tier: 'ERROR',
          code: 'M2_DANGLING_OWNER_ENTITY',
          model: 'M2',
          elementId: b.id,
          messageZh: `行为「${b.name} (${b.id})」所属对象「${b.ownerEntity}」在 M1 中不存在。`,
          messageEn: `Behavior "${b.name} (${b.id})" ownerEntity "${b.ownerEntity}" does not exist in M1.`,
        });
      }
      if (b.queryReportRef && b.behaviorType !== 'QUERY') {
        diagnostics.push({
          id: `M2-QUERY-REF-TYPE-${b.id}`,
          tier: 'ERROR',
          code: 'M2_QUERY_REPORT_REF_ON_NON_QUERY',
          model: 'M2',
          elementId: b.id,
          messageZh: `行为「${b.name} (${b.id})」声明了 queryReportRef，但 behaviorType 不是 QUERY。`,
          messageEn: `Behavior "${b.id}" declares queryReportRef but behaviorType is not QUERY.`,
        });
      }
      if (b.queryReportRef && suite.M7) {
        const targetReport = reportById.get(b.queryReportRef);
        if (!targetReport) {
          diagnostics.push({
            id: `M2-DANGLING-REPORT-${b.id}`,
            tier: 'ERROR',
            code: 'M2_DANGLING_QUERY_REPORT_REF',
            model: 'M2',
            elementId: b.id,
            messageZh: `查询行为「${b.id}」引用的 M7 报表「${b.queryReportRef}」不存在。`,
            messageEn: `Query behavior "${b.id}" references non-existent M7 report "${b.queryReportRef}".`,
          });
        } else if (targetReport.behaviorRef !== b.id) {
          diagnostics.push({
            id: `M2-M7-MISMATCH-${b.id}`,
            tier: 'ERROR',
            code: 'M2_M7_ONE_TO_ONE_MISMATCH',
            model: 'M2',
            elementId: b.id,
            messageZh: `M2 查询行为「${b.id}」与 M7 报表「${targetReport.id}」未保持严格双向一对一绑定。`,
            messageEn: `M2 query behavior "${b.id}" and M7 report "${targetReport.id}" break 1-to-1 bidirectional binding.`,
          });
        }
      }
      if (suite.M3) {
        for (const rId of b.invokedRules) {
          if (!ruleIds.has(rId)) {
            diagnostics.push({
              id: `M2-RULE-REF-${b.id}-${rId}`,
              tier: 'ERROR',
              code: 'M2_DANGLING_RULE_REF',
              model: 'M2',
              elementId: b.id,
              messageZh: `行为「${b.id}」调用了不存在的 M3 规则「${rId}」。`,
              messageEn: `Behavior "${b.id}" invokes non-existent M3 rule "${rId}".`,
            });
          }
        }
      }
      if (suite.ME) {
        for (const pe of b.producedEvents) {
          const evId = typeof pe === 'string' ? pe : pe.eventRef;
          if (!eventIds.has(evId)) {
            diagnostics.push({
              id: `M2-EVENT-REF-${b.id}-${evId}`,
              tier: 'ERROR',
              code: 'M2_DANGLING_EVENT_REF',
              model: 'M2',
              elementId: b.id,
              messageZh: `行为「${b.id}」产生了未在 ME 中定义的事件「${evId}」。`,
              messageEn: `Behavior "${b.id}" produces event "${evId}" not defined in ME.`,
            });
          }
        }
      }
      if (suite.M5) {
        for (const permId of b.requiredPermissions) {
          if (!permissionIds.has(permId)) {
            diagnostics.push({
              id: `M2-PERM-REF-${b.id}-${permId}`,
              tier: 'ERROR',
              code: 'M2_DANGLING_PERMISSION_REF',
              model: 'M2',
              elementId: b.id,
              messageZh: `行为「${b.id}」引用了不存在的 M5 权限「${permId}」。`,
              messageEn: `Behavior "${b.id}" references non-existent M5 permission "${permId}".`,
            });
          }
        }
      }
    }
  }

  // ─── M3 Validation ──────────────────────────────────────────────────────────
  if (suite.M3) {
    for (const r of suite.M3.rules) {
      if (suite.M1) {
        for (const objId of r.referencedObjects) {
          if (!aggregateIds.has(objId)) {
            diagnostics.push({
              id: `M3-OBJ-REF-${r.id}-${objId}`,
              tier: 'ERROR',
              code: 'M3_DANGLING_OBJECT_REF',
              model: 'M3',
              elementId: r.id,
              messageZh: `规则「${r.id}」引用了不存在的 M1 聚合根「${objId}」。`,
              messageEn: `Rule "${r.id}" references non-existent M1 aggregate "${objId}".`,
            });
          }
        }
      }
      if (suite.M2) {
        for (const tb of r.triggeredBehaviors) {
          if (!behaviorIds.has(tb.behaviorRef)) {
            diagnostics.push({
              id: `M3-BEH-REF-${r.id}-${tb.behaviorRef}`,
              tier: 'ERROR',
              code: 'M3_DANGLING_BEHAVIOR_REF',
              model: 'M3',
              elementId: r.id,
              messageZh: `事件规则「${r.id}」触发了不存在的 M2 行为「${tb.behaviorRef}」。`,
              messageEn: `Event rule "${r.id}" triggers non-existent M2 behavior "${tb.behaviorRef}".`,
            });
          }
        }
      }
    }
  }

  // ─── ME Validation ──────────────────────────────────────────────────────────
  if (suite.ME) {
    for (const ev of suite.ME.events) {
      if (!/^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/.test(ev.name)) {
        diagnostics.push({
          id: `ME-NAME-FORMAT-${ev.id}`,
          tier: 'ERROR',
          code: 'ME_INVALID_EVENT_NAME',
          model: 'ME',
          elementId: ev.id,
          messageZh: `事件「${ev.id}」名称「${ev.name}」必须采用 <对象>.<过去分词> 格式（如 Contract.Approved）。`,
          messageEn: `Event "${ev.id}" name "${ev.name}" must follow <Object>.<PastParticiple> format.`,
        });
      }
      if (suite.M1 && !aggregateIds.has(ev.sourceAggregate)) {
        diagnostics.push({
          id: `ME-SRC-AGG-${ev.id}`,
          tier: 'ERROR',
          code: 'ME_DANGLING_SOURCE_AGGREGATE',
          model: 'ME',
          elementId: ev.id,
          messageZh: `事件「${ev.id}」的来源聚合「${ev.sourceAggregate}」在 M1 中不存在。`,
          messageEn: `Event "${ev.id}" sourceAggregate "${ev.sourceAggregate}" does not exist in M1.`,
        });
      }
      if (ev.producerType === 'BEHAVIOR' && suite.M2 && !behaviorIds.has(ev.producerBehaviorRef)) {
        diagnostics.push({
          id: `ME-PRODUCER-${ev.id}`,
          tier: 'ERROR',
          code: 'ME_DANGLING_PRODUCER',
          model: 'ME',
          elementId: ev.id,
          messageZh: `事件「${ev.id}」的生产者行为「${ev.producerBehaviorRef}」在 M2 中不存在。`,
          messageEn: `Event "${ev.id}" producerBehaviorRef "${ev.producerBehaviorRef}" does not exist in M2.`,
        });
      }
      for (const sub of ev.subscribers) {
        if (sub.subscriberType === 'BEHAVIOR' && suite.M2 && !behaviorIds.has(sub.subscriberRef)) {
          diagnostics.push({
            id: `ME-SUB-BEH-${ev.id}-${sub.subscriberRef}`,
            tier: 'ERROR',
            code: 'ME_DANGLING_SUBSCRIBER_BEHAVIOR',
            model: 'ME',
            elementId: ev.id,
            messageZh: `事件「${ev.id}」的订阅行为「${sub.subscriberRef}」在 M2 中不存在。`,
            messageEn: `Event "${ev.id}" subscriber behavior "${sub.subscriberRef}" does not exist in M2.`,
          });
        }
        if (sub.subscriberType === 'RULE' && suite.M3 && !ruleIds.has(sub.subscriberRef)) {
          diagnostics.push({
            id: `ME-SUB-RULE-${ev.id}-${sub.subscriberRef}`,
            tier: 'ERROR',
            code: 'ME_DANGLING_SUBSCRIBER_RULE',
            model: 'ME',
            elementId: ev.id,
            messageZh: `事件「${ev.id}」的订阅规则「${sub.subscriberRef}」在 M3 中不存在。`,
            messageEn: `Event "${ev.id}" subscriber rule "${sub.subscriberRef}" does not exist in M3.`,
          });
        }
      }
    }
  }

  // ─── M4 Validation ──────────────────────────────────────────────────────────
  if (suite.M4) {
    for (const sc of suite.M4.event_scenarios) {
      if (suite.ME && !eventIds.has(sc.triggerEventRef)) {
        diagnostics.push({
          id: `M4-TRIG-EV-${sc.id}`,
          tier: 'ERROR',
          code: 'M4_DANGLING_TRIGGER_EVENT',
          model: 'M4',
          elementId: sc.id,
          messageZh: `场景「${sc.id}」的触发事件「${sc.triggerEventRef}」在 ME 中不存在。`,
          messageEn: `Scenario "${sc.id}" triggerEventRef "${sc.triggerEventRef}" does not exist in ME.`,
        });
      }
      for (const step of sc.steps) {
        if (step.stepType === 'BEHAVIOR_CALL' && suite.M2 && !behaviorIds.has(step.refId)) {
          diagnostics.push({
            id: `M4-STEP-BEH-${sc.id}-${step.stepOrder}`,
            tier: 'ERROR',
            code: 'M4_DANGLING_STEP_BEHAVIOR',
            model: 'M4',
            elementId: sc.id,
            messageZh: `场景「${sc.id}」步骤 ${step.stepOrder} 引用的行为「${step.refId}」不存在。`,
            messageEn: `Scenario "${sc.id}" step ${step.stepOrder} references unknown behavior "${step.refId}".`,
          });
        }
        if (step.stepType === 'EVENT_EMIT' && suite.ME && !eventIds.has(step.refId)) {
          diagnostics.push({
            id: `M4-STEP-EV-${sc.id}-${step.stepOrder}`,
            tier: 'ERROR',
            code: 'M4_DANGLING_STEP_EVENT',
            model: 'M4',
            elementId: sc.id,
            messageZh: `场景「${sc.id}」步骤 ${step.stepOrder} 引用的事件「${step.refId}」不存在。`,
            messageEn: `Scenario "${sc.id}" step ${step.stepOrder} references unknown event "${step.refId}".`,
          });
        }
        if (step.stepType === 'RULE_EVALUATE' && suite.M3 && !ruleIds.has(step.refId)) {
          diagnostics.push({
            id: `M4-STEP-RULE-${sc.id}-${step.stepOrder}`,
            tier: 'ERROR',
            code: 'M4_DANGLING_STEP_RULE',
            model: 'M4',
            elementId: sc.id,
            messageZh: `场景「${sc.id}」步骤 ${step.stepOrder} 引用的规则「${step.refId}」不存在。`,
            messageEn: `Scenario "${sc.id}" step ${step.stepOrder} references unknown rule "${step.refId}".`,
          });
        }
      }
    }
  }

  // ─── M5 Validation ──────────────────────────────────────────────────────────
  if (suite.M5) {
    for (const actor of suite.M5.actors) {
      if (actor.actorType === 'EXTERNAL_ENTITY' && !actor.externalContract) {
        diagnostics.push({
          id: `M5-EXT-CONTRACT-${actor.id}`,
          tier: 'ERROR',
          code: 'M5_MISSING_EXTERNAL_CONTRACT',
          model: 'M5',
          elementId: actor.id,
          messageZh: `外部参与方「${actor.name} (${actor.id})」必须定义 externalContract。`,
          messageEn: `External entity "${actor.name} (${actor.id})" must define externalContract.`,
        });
      }
    }
    for (const perm of suite.M5.permissions) {
      if (suite.M1 && !aggregateIds.has(perm.targetAggregate)) {
        diagnostics.push({
          id: `M5-PERM-AGG-${perm.id}`,
          tier: 'ERROR',
          code: 'M5_DANGLING_PERMISSION_AGGREGATE',
          model: 'M5',
          elementId: perm.id,
          messageZh: `权限「${perm.id}」引用的目标聚合「${perm.targetAggregate}」不存在。`,
          messageEn: `Permission "${perm.id}" targetAggregate "${perm.targetAggregate}" does not exist.`,
        });
      }
      if (suite.M2) {
        for (const bId of perm.allowedBehaviors) {
          if (!behaviorIds.has(bId)) {
            diagnostics.push({
              id: `M5-PERM-BEH-${perm.id}-${bId}`,
              tier: 'ERROR',
              code: 'M5_DANGLING_PERMISSION_BEHAVIOR',
              model: 'M5',
              elementId: perm.id,
              messageZh: `权限「${perm.id}」绑定的行为「${bId}」在 M2 中不存在。`,
              messageEn: `Permission "${perm.id}" allowedBehavior "${bId}" does not exist in M2.`,
            });
          }
        }
      }
    }
  }

  // ─── M6 Validation ──────────────────────────────────────────────────────────
  if (suite.M6) {
    for (const flow of suite.M6.flows) {
      const starts = flow.activities.filter((a) => a.activityType === 'START');
      const ends = flow.activities.filter((a) => a.activityType === 'END');
      if (starts.length !== 1 || ends.length < 1) {
        diagnostics.push({
          id: `M6-START-END-${flow.id}`,
          tier: 'ERROR',
          code: 'M6_INVALID_START_END',
          model: 'M6',
          elementId: flow.id,
          messageZh: `流程「${flow.name} (${flow.id})」必须有且仅有一个开始节点，且至少有一个结束节点。`,
          messageEn: `Flow "${flow.id}" must have exactly 1 START activity and at least 1 END activity.`,
        });
      }

      const flowRoleSet = new Set(flow.roleRefs);
      for (const act of flow.activities) {
        if (act.activityType === 'USER_TASK' || act.activityType === 'APPROVAL_TASK') {
          if (!act.roleRef || (suite.M5 && !roleIds.has(act.roleRef))) {
            diagnostics.push({
              id: `M6-ACT-ROLE-${flow.id}-${act.id}`,
              tier: 'ERROR',
              code: 'M6_INVALID_ACTIVITY_ROLE',
              model: 'M6',
              elementId: flow.id,
              messageZh: `流程「${flow.id}」的人工活动「${act.id}」必须引用已存在的 M5 roleId。`,
              messageEn: `Human task "${act.id}" in flow "${flow.id}" must reference an existing M5 roleId.`,
            });
          } else if (!flowRoleSet.has(act.roleRef)) {
            diagnostics.push({
              id: `M6-ACT-ROLE-NOT-IN-FLOW-${flow.id}-${act.id}`,
              tier: 'ERROR',
              code: 'M6_ACTIVITY_ROLE_NOT_DECLARED_ON_FLOW',
              model: 'M6',
              elementId: flow.id,
              messageZh: `流程「${flow.id}」活动「${act.id}」的 roleRef「${act.roleRef}」未包含在流程 roleRefs 中。`,
              messageEn: `Activity "${act.id}" roleRef "${act.roleRef}" is not listed in flow "${flow.id}" roleRefs.`,
            });
          }
        }
        if (act.activityType === 'BEHAVIOR_CALL' && act.behaviorRef && suite.M2 && !behaviorIds.has(act.behaviorRef)) {
          diagnostics.push({
            id: `M6-ACT-BEH-${flow.id}-${act.id}`,
            tier: 'ERROR',
            code: 'M6_DANGLING_BEHAVIOR_CALL',
            model: 'M6',
            elementId: flow.id,
            messageZh: `流程「${flow.id}」活动「${act.id}」引用的 M2 行为「${act.behaviorRef}」不存在。`,
            messageEn: `Flow "${flow.id}" activity "${act.id}" references unknown M2 behavior "${act.behaviorRef}".`,
          });
        }
        if (act.activityType === 'SCENARIO_CALL' && act.scenarioRef && suite.M4 && !scenarioIds.has(act.scenarioRef)) {
          diagnostics.push({
            id: `M6-ACT-SCEN-${flow.id}-${act.id}`,
            tier: 'ERROR',
            code: 'M6_DANGLING_SCENARIO_CALL',
            model: 'M6',
            elementId: flow.id,
            messageZh: `流程「${flow.id}」活动「${act.id}」引用的 M4 场景「${act.scenarioRef}」不存在。`,
            messageEn: `Flow "${flow.id}" activity "${act.id}" references unknown M4 scenario "${act.scenarioRef}".`,
          });
        }
        if (act.activityType === 'SUB_FLOW_CALL' && act.subFlowRef && !flowIds.has(act.subFlowRef)) {
          diagnostics.push({
            id: `M6-ACT-SUBFLOW-${flow.id}-${act.id}`,
            tier: 'ERROR',
            code: 'M6_DANGLING_SUB_FLOW_CALL',
            model: 'M6',
            elementId: flow.id,
            messageZh: `流程「${flow.id}」活动「${act.id}」引用的子流程「${act.subFlowRef}」不存在。`,
            messageEn: `Flow "${flow.id}" activity "${act.id}" references unknown sub-flow "${act.subFlowRef}".`,
          });
        }
        if (act.activityType === 'XOR_GATEWAY') {
          const defaultBranches = act.branches.filter((b) => b.isDefault);
          if (act.branches.length < 2 || defaultBranches.length > 1) {
            diagnostics.push({
              id: `M6-GATEWAY-${flow.id}-${act.id}`,
              tier: 'ERROR',
              code: 'M6_INVALID_XOR_GATEWAY',
              model: 'M6',
              elementId: flow.id,
              messageZh: `流程「${flow.id}」网关「${act.id}」必须至少包含 2 个分支且最多 1 个默认分支。`,
              messageEn: `Gateway "${act.id}" in flow "${flow.id}" must have >= 2 branches and <= 1 default branch.`,
            });
          }
        }
      }
    }
  }

  // ─── M7 Validation ──────────────────────────────────────────────────────────
  if (suite.M7) {
    const boundBehaviors = new Set<string>();
    for (const qr of suite.M7.query_reports) {
      if (boundBehaviors.has(qr.behaviorRef)) {
        diagnostics.push({
          id: `M7-DUP-BEH-${qr.id}`,
          tier: 'ERROR',
          code: 'M7_DUPLICATE_BEHAVIOR_BINDING',
          model: 'M7',
          elementId: qr.id,
          messageZh: `M7 查询报表「${qr.id}」重复绑定了已被占用的 M2 行为「${qr.behaviorRef}」。`,
          messageEn: `M7 report "${qr.id}" binds already-used M2 behavior "${qr.behaviorRef}".`,
        });
      }
      boundBehaviors.add(qr.behaviorRef);

      if (suite.M2) {
        const b = behaviorById.get(qr.behaviorRef);
        if (!b || b.behaviorType !== 'QUERY') {
          diagnostics.push({
            id: `M7-BEH-REF-${qr.id}`,
            tier: 'ERROR',
            code: 'M7_INVALID_BEHAVIOR_REF',
            model: 'M7',
            elementId: qr.id,
            messageZh: `M7 对象「${qr.id}」绑定的行为「${qr.behaviorRef}」不存在或不是 QUERY 类型。`,
            messageEn: `M7 report "${qr.id}" behaviorRef "${qr.behaviorRef}" is missing or not of type QUERY.`,
          });
        }
      }
      if (qr.queryType === 'REPORT' && !qr.reportOptions) {
        diagnostics.push({
          id: `M7-REPORT-OPT-${qr.id}`,
          tier: 'ERROR',
          code: 'M7_MISSING_REPORT_OPTIONS',
          model: 'M7',
          elementId: qr.id,
          messageZh: `M7 固定报表「${qr.id}」类型为 REPORT，必须定义 reportOptions。`,
          messageEn: `M7 object "${qr.id}" is of type REPORT and must define reportOptions.`,
        });
      }
      if (qr.queryType !== 'REPORT' && qr.reportOptions) {
        diagnostics.push({
          id: `M7-NONREPORT-OPT-${qr.id}`,
          tier: 'ERROR',
          code: 'M7_UNEXPECTED_REPORT_OPTIONS',
          model: 'M7',
          elementId: qr.id,
          messageZh: `M7 对象「${qr.id}」不是 REPORT 类型，不得携带 reportOptions。`,
          messageEn: `M7 object "${qr.id}" is not REPORT and must not carry reportOptions.`,
        });
      }

      // Check referenceSql :param bindings
      const declaredParams = new Set(qr.parameters.map((p) => p.name));
      const sqlParamRegex = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
      let match: RegExpExecArray | null;
      while ((match = sqlParamRegex.exec(qr.referenceSql.sql)) !== null) {
        const paramName = match[1];
        if (!declaredParams.has(paramName)) {
          diagnostics.push({
            id: `M7-SQL-PARAM-${qr.id}-${paramName}`,
            tier: 'ERROR',
            code: 'M7_UNDECLARED_SQL_PARAMETER',
            model: 'M7',
            elementId: qr.id,
            messageZh: `M7「${qr.id}」参考 SQL 中使用了未在 parameters 中声明的参数 :${paramName}。`,
            messageEn: `M7 "${qr.id}" referenceSql uses undeclared parameter :${paramName}.`,
          });
        }
      }
    }
  }

  // ─── MU Validation ──────────────────────────────────────────────────────────
  if (suite.MU) {
    const referencedUserActionBehaviors = new Set<string>();

    for (const screen of suite.MU.screens) {
      const elementMap = new Map(screen.elements.map((e) => [e.elementId, e]));

      // ASCII layout consistency (§10.6.5)
      if (screen.layout) {
        const layoutElements = extractLayoutElementIds(screen.layout);
        for (const le of layoutElements) {
          const def = elementMap.get(le.elementId);
          if (!def) {
            diagnostics.push({
              id: `MU-LAYOUT-EL-${screen.screenId}-${le.elementId}`,
              tier: 'ERROR',
              code: 'MU_LAYOUT_UNKNOWN_ELEMENT',
              model: 'MU',
              elementId: screen.screenId,
              messageZh: `屏幕「${screen.screenId}」ASCII 布局中引用的控件「${le.elementId}」未在 elements 中声明。`,
              messageEn: `Screen "${screen.screenId}" ASCII layout references undeclared element "${le.elementId}".`,
            });
          } else if (le.requiredInLayout && !def.required) {
            diagnostics.push({
              id: `MU-LAYOUT-REQ-${screen.screenId}-${le.elementId}`,
              tier: 'ERROR',
              code: 'MU_LAYOUT_REQUIRED_MISMATCH',
              model: 'MU',
              elementId: screen.screenId,
              messageZh: `屏幕「${screen.screenId}」布局将「${le.elementId}*」标为必填，但 elements 中 required 为 false。`,
              messageEn: `Screen "${screen.screenId}" layout marks "[${le.elementId}*]" required, but element.required is false.`,
            });
          }
        }
      }

      for (const ev of screen.events) {
        if (!elementMap.has(ev.triggerElementId)) {
          diagnostics.push({
            id: `MU-EV-TRIG-${screen.screenId}-${ev.eventId}`,
            tier: 'ERROR',
            code: 'MU_DANGLING_TRIGGER_ELEMENT',
            model: 'MU',
            elementId: screen.screenId,
            messageZh: `UI 事件「${ev.eventId}」触发控件「${ev.triggerElementId}」在该屏幕 elements 中不存在。`,
            messageEn: `UI event "${ev.eventId}" triggerElementId "${ev.triggerElementId}" does not exist on screen "${screen.screenId}".`,
          });
        }

        let prevRank = 0;
        const calledBehaviorsInChain = new Set<string>();

        for (const step of ev.callChain) {
          const rank = CALL_CHAIN_STEP_RANK[step.stepType] ?? 99;
          if (rank < prevRank) {
            diagnostics.push({
              id: `MU-CHAIN-ORDER-${screen.screenId}-${ev.eventId}-${step.stepOrder}`,
              tier: 'ERROR',
              code: 'MU_INVALID_CALL_CHAIN_ORDER',
              model: 'MU',
              elementId: ev.eventId,
              messageZh: `UI 事件「${ev.eventId}」调用链步骤 ${step.stepOrder}（${step.stepType}）违反了 VALIDATE → BEHAVIOR → EVENT → SCENARIO → REPORT → NAVIGATE 顺序约束。`,
              messageEn: `UI event "${ev.eventId}" step ${step.stepOrder} (${step.stepType}) violates callChain ordering.`,
            });
          }
          prevRank = rank;

          if (step.stepType === 'VALIDATE' && suite.M3 && !ruleIds.has(step.refId)) {
            diagnostics.push({
              id: `MU-CHAIN-RULE-${ev.eventId}-${step.refId}`,
              tier: 'ERROR',
              code: 'MU_DANGLING_VALIDATE_RULE',
              model: 'MU',
              elementId: ev.eventId,
              messageZh: `UI 事件「${ev.eventId}」前置校验引用了不存在的 M3 规则「${step.refId}」。`,
              messageEn: `UI event "${ev.eventId}" VALIDATE step references unknown M3 rule "${step.refId}".`,
            });
          }
          if (step.stepType === 'BEHAVIOR_CALL') {
            calledBehaviorsInChain.add(step.refId);
            referencedUserActionBehaviors.add(step.refId);
            if (suite.M2 && !behaviorIds.has(step.refId)) {
              diagnostics.push({
                id: `MU-CHAIN-BEH-${ev.eventId}-${step.refId}`,
                tier: 'ERROR',
                code: 'MU_DANGLING_BEHAVIOR_CALL',
                model: 'MU',
                elementId: ev.eventId,
                messageZh: `UI 事件「${ev.eventId}」调用了不存在的 M2 行为「${step.refId}」。`,
                messageEn: `UI event "${ev.eventId}" BEHAVIOR_CALL references unknown M2 behavior "${step.refId}".`,
              });
            }
          }
          if (step.stepType === 'EVENT_EMIT' && suite.ME) {
            const targetEv = eventById.get(step.refId);
            if (!targetEv) {
              diagnostics.push({
                id: `MU-CHAIN-EV-${ev.eventId}-${step.refId}`,
                tier: 'ERROR',
                code: 'MU_DANGLING_EVENT_EMIT',
                model: 'MU',
                elementId: ev.eventId,
                messageZh: `UI 事件「${ev.eventId}」发出了不存在的 ME 事件「${step.refId}」。`,
                messageEn: `UI event "${ev.eventId}" EVENT_EMIT references unknown ME event "${step.refId}".`,
              });
            } else if (!calledBehaviorsInChain.has(targetEv.producerBehaviorRef)) {
              diagnostics.push({
                id: `MU-CHAIN-PRODUCER-${ev.eventId}-${step.refId}`,
                tier: 'ERROR',
                code: 'MU_EVENT_EMIT_WITHOUT_PRODUCER_BEHAVIOR',
                model: 'MU',
                elementId: ev.eventId,
                messageZh: `UI 事件「${ev.eventId}」发出事件「${step.refId}」前未调用其生产者行为「${targetEv.producerBehaviorRef}」（违反 §1.4 约束 1）。`,
                messageEn: `UI event "${ev.eventId}" emits "${step.refId}" before calling its producerBehaviorRef "${targetEv.producerBehaviorRef}".`,
              });
            }
          }
          if (step.stepType === 'SCENARIO_CALL' && suite.M4 && !scenarioIds.has(step.refId)) {
            diagnostics.push({
              id: `MU-CHAIN-SCEN-${ev.eventId}-${step.refId}`,
              tier: 'ERROR',
              code: 'MU_DANGLING_SCENARIO_CALL',
              model: 'MU',
              elementId: ev.eventId,
              messageZh: `UI 事件「${ev.eventId}」调用了不存在的 M4 场景「${step.refId}」。`,
              messageEn: `UI event "${ev.eventId}" SCENARIO_CALL references unknown M4 scenario "${step.refId}".`,
            });
          }
          if (
            (step.stepType === 'REPORT_CALL' || step.stepType === 'QUERY_REPORT') &&
            suite.M7 &&
            !reportIds.has(step.refId) &&
            !behaviorIds.has(step.refId)
          ) {
            diagnostics.push({
              id: `MU-CHAIN-REP-${ev.eventId}-${step.refId}`,
              tier: 'ERROR',
              code: 'MU_DANGLING_REPORT_CALL',
              model: 'MU',
              elementId: ev.eventId,
              messageZh: `UI 事件「${ev.eventId}」引用了不存在的 M7 查询报表「${step.refId}」。`,
              messageEn: `UI event "${ev.eventId}" references unknown M7 report "${step.refId}".`,
            });
          }
          if (step.stepType === 'QUERY_REPORT' && suite.M2 && suite.M7) {
            const rep = reportById.get(step.refId);
            if (rep) referencedUserActionBehaviors.add(rep.behaviorRef);
            if (behaviorIds.has(step.refId)) referencedUserActionBehaviors.add(step.refId);
          }
          if (step.stepType === 'NAVIGATE' && !screenIds.has(step.refId)) {
            diagnostics.push({
              id: `MU-CHAIN-NAV-${ev.eventId}-${step.refId}`,
              tier: 'ERROR',
              code: 'MU_DANGLING_NAVIGATE_SCREEN',
              model: 'MU',
              elementId: ev.eventId,
              messageZh: `UI 事件「${ev.eventId}」跳转的目标屏幕「${step.refId}」不存在。`,
              messageEn: `UI event "${ev.eventId}" NAVIGATE target screen "${step.refId}" does not exist.`,
            });
          }
        }
      }
    }

    // Reverse traceability check: every M2 USER_ACTION behavior must be referenced by at least one MU event
    if (suite.M2) {
      for (const b of suite.M2.behaviors) {
        if (b.triggerType === 'USER_ACTION' && !referencedUserActionBehaviors.has(b.id)) {
          diagnostics.push({
            id: `MU-UNTRACED-BEH-${b.id}`,
            tier: 'ERROR',
            code: 'MU_UNTRACED_USER_ACTION_BEHAVIOR',
            model: 'MU',
            elementId: b.id,
            messageZh: `M2 中 triggerType=USER_ACTION 的行为「${b.name} (${b.id})」未被任何 MU UI 事件调用链追溯（违反 §1.3 决策 7）。`,
            messageEn: `M2 USER_ACTION behavior "${b.id}" is not traced by any MU UI event callChain.`,
          });
        }
      }
    }
  }

  // ─── MM Validation ──────────────────────────────────────────────────────────
  if (suite.MM && suite.M1) {
    for (const mapping of suite.MM.mappings) {
      const aggId = aggregateIds.has(mapping.objectRef)
        ? mapping.objectRef
        : aggregateAliases.get(mapping.objectRef);
      if (!aggId) {
        diagnostics.push({
          id: `MM-OBJ-REF-${mapping.id}`,
          tier: 'ERROR',
          code: 'MM_DANGLING_OBJECT_REF',
          model: 'MM',
          elementId: mapping.id,
          messageZh: `数据表映射「${mapping.id}」的 objectRef「${mapping.objectRef}」无法解析到 M1 聚合根。`,
          messageEn: `Mapping "${mapping.id}" objectRef "${mapping.objectRef}" does not resolve to an M1 aggregate.`,
        });
      }
      const masterTables = mapping.tableMappings.filter((t) => t.tableRole === 'MASTER');
      if (masterTables.length === 0) {
        diagnostics.push({
          id: `MM-NO-MASTER-${mapping.id}`,
          tier: 'ERROR',
          code: 'MM_MISSING_MASTER_TABLE',
          model: 'MM',
          elementId: mapping.id,
          messageZh: `数据表映射「${mapping.id}」必须至少包含一张 tableRole=MASTER 的主表。`,
          messageEn: `Mapping "${mapping.id}" must contain at least one MASTER table.`,
        });
      }
    }
  }

  // ─── MI Validation ──────────────────────────────────────────────────────────
  if (suite.MI) {
    for (const intf of suite.MI.interfaces) {
      if (intf.direction === 'PROVIDED' && suite.M2) {
        if (!intf.relatedBehaviorRef || !behaviorIds.has(intf.relatedBehaviorRef)) {
          diagnostics.push({
            id: `MI-PROVIDED-BEH-${intf.interfaceId}`,
            tier: 'ERROR',
            code: 'MI_PROVIDED_MISSING_BEHAVIOR',
            model: 'MI',
            elementId: intf.interfaceId,
            messageZh: `对外提供接口「${intf.interfaceId}」必须关联有效的 M2 承接行为 relatedBehaviorRef。`,
            messageEn: `PROVIDED interface "${intf.interfaceId}" must reference a valid M2 relatedBehaviorRef.`,
          });
        }
      }
      if (intf.direction === 'DEPENDENT' && suite.M5) {
        if (!intf.relatedExternalEntityRef || !externalActorIds.has(intf.relatedExternalEntityRef)) {
          diagnostics.push({
            id: `MI-DEPENDENT-EXT-${intf.interfaceId}`,
            tier: 'ERROR',
            code: 'MI_DEPENDENT_MISSING_EXTERNAL_ENTITY',
            model: 'MI',
            elementId: intf.interfaceId,
            messageZh: `依赖外部接口「${intf.interfaceId}」必须关联 M5 中的外部参与方（EXTERNAL_ENTITY）。`,
            messageEn: `DEPENDENT interface "${intf.interfaceId}" must reference an M5 EXTERNAL_ENTITY in relatedExternalEntityRef.`,
          });
        }
      }
      if (intf.interfaceCategory === 'EVENT' && suite.ME) {
        if (!intf.relatedEventRef || !eventIds.has(intf.relatedEventRef)) {
          diagnostics.push({
            id: `MI-EVENT-REF-${intf.interfaceId}`,
            tier: 'ERROR',
            code: 'MI_EVENT_MISSING_EVENT_REF',
            model: 'MI',
            elementId: intf.interfaceId,
            messageZh: `事件型接口「${intf.interfaceId}」必须通过 relatedEventRef 关联已存在的 ME 事件。`,
            messageEn: `EVENT interface "${intf.interfaceId}" must reference an existing ME event via relatedEventRef.`,
          });
        }
      }
    }
  }

  const errorCount = diagnostics.filter((d) => d.tier === 'ERROR').length;
  const warningCount = diagnostics.filter((d) => d.tier === 'STAGE_WARNING').length;

  return {
    valid: errorCount === 0,
    errorCount,
    warningCount,
    diagnostics,
    presentModels,
    missingModels,
  };
}
