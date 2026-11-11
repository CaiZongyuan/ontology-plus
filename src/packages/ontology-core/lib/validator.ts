import {
  MODEL_STAGE_ORDER,
  type AggregateRoot,
  type Attribute,
  type ModelCode,
  type OntologySuite,
  type UIEvent,
  type ValidationDiagnostic,
  type ValidationReport,
} from './types.js';

const CALL_CHAIN_STEP_RANK: Record<string, number> = {
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

const LAYOUT_PAREN_IGNORE = new Set([
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
  'OPTIONAL',
  'REQUIRED',
  'READONLY',
  'DISABLED',
  'AUTO',
  'DEFAULT',
  'ASC',
  'DESC',
  'YES',
  'NO',
  'ID',
  'PK',
  'FK',
  'JSON',
  'CSV',
  'XLSX',
  'PDF',
  'MFT',
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'SIGNED',
  'EXECUTING',
  'ARCHIVED',
  'TERMINATED',
  'LOW',
  'MEDIUM',
  'HIGH',
  'AAA',
  'AA',
]);

const IMPLICIT_PERSISTENCE_ATTRS = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
  'deletedAt',
  'version',
  'tenantId',
  'sortOrder',
]);

export function extractLayoutElementIds(layout: string): {
  elementId: string;
  requiredInLayout: boolean;
}[] {
  const results: { elementId: string; requiredInLayout: boolean }[] = [];
  const seen = new Set<string>();

  const pushEl = (id: string, req: boolean) => {
    if (!id) return;
    if (!seen.has(id)) {
      seen.add(id);
      results.push({ elementId: id, requiredInLayout: req });
    } else if (req) {
      const existing = results.find((r) => r.elementId === id);
      if (existing) existing.requiredInLayout = true;
    }
  };

  let match: RegExpExecArray | null;

  // 1. [elementId], [elementId*], [elementId Label...]
  const bracketRegex = /\[([a-zA-Z][a-zA-Z0-9_-]*)(\*)?(?:\s+[^\]]*)?\]/g;
  while ((match = bracketRegex.exec(layout)) !== null) {
    pushEl(match[1], Boolean(match[2]));
  }

  // 2. {tbrId}, {tbrId*} (§10.6.5 toolbar notation)
  const braceRegex = /\{([a-zA-Z][a-zA-Z0-9_-]*)(\*)?(?:\s+[^}]*)?\}/g;
  while ((match = braceRegex.exec(layout)) !== null) {
    pushEl(match[1], Boolean(match[2]));
  }

  // 3. (cboId), (dtpId*) (§10.6.5 dropdown / combo / picker notation)
  const parenRegex = /\(([a-zA-Z][a-zA-Z0-9_-]*)(\*)?\)/g;
  while ((match = parenRegex.exec(layout)) !== null) {
    const candidate = match[1];
    if (/^(?:SCR|FRM)[-_]/i.test(candidate)) continue;
    if (LAYOUT_PAREN_IGNORE.has(candidate.toUpperCase())) continue;
    pushEl(candidate, Boolean(match[2]));
  }

  // 4. @grdName (§10.6.5 grid / table notation)
  const gridRegex = /@([a-zA-Z][a-zA-Z0-9_-]*)(\*)?/g;
  while ((match = gridRegex.exec(layout)) !== null) {
    pushEl(match[1], Boolean(match[2]));
  }

  return results;
}

function normalizeAttrPath(pathStr: string): string {
  return pathStr.replace(/\[\d+\]|\[\*\]/g, '[]').trim();
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

  // ─── Lookup Indexes across Present Models ──────────────────────────────────
  const aggregateIds = new Set<string>();
  const canonicalAggByKey = new Map<string, AggregateRoot>();
  const aggValidAttrPaths = new Map<string, Set<string>>();
  const dictionaryTypes = new Map<string, Map<string, Set<string>>>(); // dictId -> typeCode -> enabled item codes
  const associationIds = new Set<string>();

  const resolveCanonicalAgg = (ref: string | undefined): AggregateRoot | undefined => {
    if (!ref) return undefined;
    const direct = canonicalAggByKey.get(ref);
    if (direct) return direct;
    if (ref.includes('.')) {
      return canonicalAggByKey.get(ref.split('.')[0]);
    }
    return undefined;
  };

  if (suite.M1) {
    for (const dict of suite.M1.data_dictionaries) {
      const typeMap = new Map<string, Set<string>>();
      for (const t of dict.types) {
        const enabledCodes = new Set<string>();
        for (const item of t.items) {
          if (item.enabled !== false) {
            enabledCodes.add(item.code);
          }
        }
        typeMap.set(t.typeCode, enabledCodes);
      }
      dictionaryTypes.set(dict.id, typeMap);
    }

    for (const agg of suite.M1.aggregates) {
      aggregateIds.add(agg.id);
      aggregateIds.add(agg.name);
      aggregateIds.add(agg.alias);
      canonicalAggByKey.set(agg.id, agg);
      canonicalAggByKey.set(agg.name, agg);
      canonicalAggByKey.set(agg.alias, agg);
      for (const ent of agg.entities) {
        aggregateIds.add(`${agg.name}.${ent.name}`);
      }
    }

    const validateM1Attribute = (
      agg: AggregateRoot,
      attr: Attribute,
      pathPrefix: string,
      voNames: Set<string>,
    ) => {
      if (attr.type === 'AggregateRootRef') {
        if (!attr.targetAggregate) {
          diagnostics.push({
            id: `M1-AGG-REF-EMPTY-${agg.id}-${pathPrefix}`,
            tier: 'ERROR',
            code: 'M1_MISSING_TARGET_AGGREGATE',
            model: 'M1',
            elementId: agg.id,
            path: pathPrefix,
            messageZh: `聚合「${agg.name}」的属性「${attr.name}」类型为 AggregateRootRef，必须声明 targetAggregate。`,
            messageEn: `Attribute "${attr.name}" on aggregate "${agg.name}" is AggregateRootRef and must declare targetAggregate.`,
          });
        } else if (!aggregateIds.has(attr.targetAggregate)) {
          diagnostics.push({
            id: `M1-DANGLING-AGG-REF-${agg.id}-${pathPrefix}`,
            tier: 'ERROR',
            code: 'M1_DANGLING_AGGREGATE_REF',
            model: 'M1',
            elementId: agg.id,
            path: pathPrefix,
            messageZh: `聚合「${agg.name}」的属性「${attr.name}」引用了不存在的目标聚合根「${attr.targetAggregate}」。`,
            messageEn: `Attribute "${attr.name}" on "${agg.name}" references unknown aggregate "${attr.targetAggregate}".`,
          });
        }
      }

      if (attr.type === 'DictionaryRef') {
        if (attr.enumValues && attr.enumValues.length > 0) {
          diagnostics.push({
            id: `M1-DICT-ENUM-CONFLICT-${agg.id}-${pathPrefix}`,
            tier: 'ERROR',
            code: 'M1_DICT_ENUM_CONFLICT',
            model: 'M1',
            elementId: agg.id,
            path: pathPrefix,
            messageZh: `属性「${attr.name}」类型为 DictionaryRef，不得同时声明 enumValues。`,
            messageEn: `Attribute "${attr.name}" of type DictionaryRef must not also declare enumValues.`,
          });
        }
        if (!attr.dictionaryRef) {
          diagnostics.push({
            id: `M1-DICT-REF-MISSING-${agg.id}-${pathPrefix}`,
            tier: 'ERROR',
            code: 'M1_DICT_REF_MISSING',
            model: 'M1',
            elementId: agg.id,
            path: pathPrefix,
            messageZh: `属性「${attr.name}」类型为 DictionaryRef，必须提供 dictionaryRef。`,
            messageEn: `Attribute "${attr.name}" of type DictionaryRef must provide dictionaryRef.`,
          });
        } else {
          const typesForDict = dictionaryTypes.get(attr.dictionaryRef.dictionaryId);
          const enabledCodes = typesForDict?.get(attr.dictionaryRef.typeCode);
          if (!typesForDict || !enabledCodes) {
            diagnostics.push({
              id: `M1-DICT-DANGLING-${agg.id}-${pathPrefix}`,
              tier: 'ERROR',
              code: 'M1_DANGLING_DICTIONARY_REF',
              model: 'M1',
              elementId: agg.id,
              path: pathPrefix,
              messageZh: `属性「${attr.name}」引用了不存在的数据字典项 ${attr.dictionaryRef.dictionaryId}.${attr.dictionaryRef.typeCode}。`,
              messageEn: `Attribute "${attr.name}" references non-existent dictionary ${attr.dictionaryRef.dictionaryId}.${attr.dictionaryRef.typeCode}.`,
            });
          } else if (
            attr.defaultValue !== undefined &&
            attr.defaultValue !== null &&
            attr.defaultValue !== '' &&
            !enabledCodes.has(String(attr.defaultValue))
          ) {
            diagnostics.push({
              id: `M1-DICT-DEFAULT-${agg.id}-${pathPrefix}`,
              tier: 'ERROR',
              code: 'M1_INVALID_DICTIONARY_DEFAULT',
              model: 'M1',
              elementId: agg.id,
              path: pathPrefix,
              messageZh: `属性「${attr.name}」的默认值「${String(attr.defaultValue)}」不在数据字典 ${attr.dictionaryRef.dictionaryId}.${attr.dictionaryRef.typeCode} 的启用项中。`,
              messageEn: `Attribute "${attr.name}" defaultValue "${String(attr.defaultValue)}" is not an enabled code in dictionary ${attr.dictionaryRef.dictionaryId}.${attr.dictionaryRef.typeCode}.`,
            });
          }
        }
      }

      if (attr.type === 'ValueObject' && (!attr.valueObjectRef || !voNames.has(attr.valueObjectRef))) {
        diagnostics.push({
          id: `M1-VO-DANGLING-${agg.id}-${pathPrefix}`,
          tier: 'ERROR',
          code: 'M1_DANGLING_VALUE_OBJECT_REF',
          model: 'M1',
          elementId: agg.id,
          path: pathPrefix,
          messageZh: `属性「${attr.name}」引用了不存在的值对象「${attr.valueObjectRef ?? ''}」。`,
          messageEn: `Attribute "${attr.name}" references non-existent ValueObject "${attr.valueObjectRef ?? ''}".`,
        });
      }

      for (const rule of attr.refRules ?? []) {
        if (!/\bvalue\b/.test(rule.expression)) {
          diagnostics.push({
            id: `M1-REFRULE-VALUE-${agg.id}-${pathPrefix}-${rule.name}`,
            tier: 'ERROR',
            code: 'M1_REFRULE_INVALID_EXPRESSION',
            model: 'M1',
            elementId: agg.id,
            path: `${pathPrefix}.refRules.${rule.name}`,
            messageZh: `属性「${attr.name}」的扩展规则「${rule.name}」表达式必须使用 value 引用当前属性值。`,
            messageEn: `Attribute rule "${rule.name}" on "${attr.name}" must reference "value" in its expression.`,
          });
        }
      }
    };

    for (const agg of suite.M1.aggregates) {
      const attrs = new Set<string>(['id']);
      const voNames = new Set<string>();
      const voByKey = new Map<string, AggregateRoot['valueObjects'][number]>();

      for (const vo of agg.valueObjects) {
        voNames.add(vo.name);
        voNames.add(vo.alias);
        voByKey.set(vo.name, vo);
        voByKey.set(vo.alias, vo);
        attrs.add(vo.name);
        attrs.add(vo.alias);
        for (const voAttr of vo.attributes) {
          attrs.add(voAttr.name);
          attrs.add(`${vo.name}.${voAttr.name}`);
          attrs.add(`${vo.alias}.${voAttr.name}`);
          validateM1Attribute(
            agg,
            voAttr,
            `aggregates.${agg.id}.valueObjects.${vo.name}.attributes.${voAttr.name}`,
            voNames,
          );
        }
      }

      for (const attr of agg.attributes) {
        attrs.add(attr.name);
        if (attr.type === 'ValueObject' && attr.valueObjectRef) {
          const targetVo = voByKey.get(attr.valueObjectRef);
          if (targetVo) {
            for (const voAttr of targetVo.attributes) {
              attrs.add(`${attr.name}.${voAttr.name}`);
            }
          }
        }
        validateM1Attribute(
          agg,
          attr,
          `aggregates.${agg.id}.attributes.${attr.name}`,
          voNames,
        );
      }

      for (const ent of agg.entities) {
        attrs.add(ent.name);
        attrs.add(ent.alias);
        attrs.add(`${ent.name}[]`);
        attrs.add(`${ent.alias}[]`);
        attrs.add(ent.localId);
        attrs.add(`${ent.name}.${ent.localId}`);
        attrs.add(`${ent.name}[].${ent.localId}`);
        attrs.add(`${ent.alias}.${ent.localId}`);
        attrs.add(`${ent.alias}[].${ent.localId}`);
        attrs.add(`items[].${ent.localId}`);

        for (const entAttr of ent.attributes) {
          attrs.add(entAttr.name);
          attrs.add(`${ent.name}.${entAttr.name}`);
          attrs.add(`${ent.name}[].${entAttr.name}`);
          attrs.add(`${ent.alias}.${entAttr.name}`);
          attrs.add(`${ent.alias}[].${entAttr.name}`);
          attrs.add(`items[].${entAttr.name}`);
          attrs.add(`entities.${ent.name}.${entAttr.name}`);
          if (entAttr.type === 'ValueObject' && entAttr.valueObjectRef) {
            const targetVo = voByKey.get(entAttr.valueObjectRef);
            if (targetVo) {
              for (const voAttr of targetVo.attributes) {
                attrs.add(`${ent.name}.${entAttr.name}.${voAttr.name}`);
                attrs.add(`${ent.name}[].${entAttr.name}.${voAttr.name}`);
              }
            }
          }
          validateM1Attribute(
            agg,
            entAttr,
            `aggregates.${agg.id}.entities.${ent.name}.attributes.${entAttr.name}`,
            voNames,
          );
        }
      }

      aggValidAttrPaths.set(agg.id, attrs);
    }

    for (const assoc of suite.M1.aggregate_associations) {
      associationIds.add(assoc.id);
      const srcAgg = resolveCanonicalAgg(assoc.sourceAggregate);
      const tgtAgg = resolveCanonicalAgg(assoc.targetAggregate);
      if (!srcAgg) {
        diagnostics.push({
          id: `M1-ASSOC-SRC-${assoc.id}`,
          tier: 'ERROR',
          code: 'M1_DANGLING_ASSOCIATION_SOURCE',
          model: 'M1',
          elementId: assoc.id,
          messageZh: `聚合关联「${assoc.id}」的来源聚合「${assoc.sourceAggregate}」不存在。`,
          messageEn: `Association "${assoc.id}" sourceAggregate "${assoc.sourceAggregate}" does not exist.`,
        });
      } else if (assoc.referenceField) {
        const validPaths = aggValidAttrPaths.get(srcAgg.id);
        const normField = normalizeAttrPath(assoc.referenceField);
        if (validPaths && !validPaths.has(normField)) {
          diagnostics.push({
            id: `M1-ASSOC-FIELD-${assoc.id}`,
            tier: 'ERROR',
            code: 'M1_DANGLING_ASSOCIATION_FIELD',
            model: 'M1',
            elementId: assoc.id,
            messageZh: `聚合关联「${assoc.id}」的关联字段「${assoc.referenceField}」在来源聚合「${srcAgg.name}」中不存在。`,
            messageEn: `Association "${assoc.id}" referenceField "${assoc.referenceField}" does not exist on source aggregate "${srcAgg.name}".`,
          });
        }
      }
      if (!tgtAgg) {
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
  const ruleById = new Map<string, NonNullable<OntologySuite['M3']>['rules'][number]>();
  if (suite.M3) {
    for (const r of suite.M3.rules) {
      ruleIds.add(r.id);
      ruleById.set(r.id, r);
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
  if (suite.M4) {
    for (const sc of suite.M4.event_scenarios) {
      scenarioIds.add(sc.id);
    }
  }

  const actorIds = new Set<string>();
  const externalActorIds = new Set<string>();
  const roleIds = new Set<string>();
  const roleById = new Map<string, NonNullable<OntologySuite['M5']>['roles'][number]>();
  const permissionGroupIds = new Set<string>();
  const permissionIds = new Set<string>();
  if (suite.M5) {
    for (const a of suite.M5.actors) {
      actorIds.add(a.id);
      if (a.actorType === 'EXTERNAL_ENTITY') externalActorIds.add(a.id);
    }
    for (const r of suite.M5.roles) {
      roleIds.add(r.id);
      roleById.set(r.id, r);
    }
    for (const pg of suite.M5.permissionGroups ?? []) {
      permissionGroupIds.add(pg.id);
    }
    for (const p of suite.M5.permissions) {
      permissionIds.add(p.id);
    }
  }

  const flowIds = new Set<string>();
  const flowById = new Map<string, NonNullable<OntologySuite['M6']>['flows'][number]>();
  if (suite.M6) {
    for (const f of suite.M6.flows) {
      flowIds.add(f.id);
      flowById.set(f.id, f);
    }
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
  const allUiElementIds = new Set<string>();
  const allUiEventIds = new Set<string>();
  const uiEventById = new Map<string, { screenId: string; event: UIEvent }>();
  if (suite.MU) {
    for (const s of suite.MU.screens) {
      screenIds.add(s.screenId);
      for (const el of s.elements) {
        allUiElementIds.add(el.elementId);
      }
      for (const ev of s.events) {
        allUiEventIds.add(ev.eventId);
        uiEventById.set(ev.eventId, { screenId: s.screenId, event: ev });
      }
    }
  }

  // ─── M2 Validation ──────────────────────────────────────────────────────────
  const reportedM2M7Pairs = new Set<string>();
  if (suite.M2) {
    for (const b of suite.M2.behaviors) {
      if (suite.M1 && !resolveCanonicalAgg(b.ownerEntity)) {
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
      if (suite.M7) {
        if (b.queryReportRef) {
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
            reportedM2M7Pairs.add(`${b.id}:${targetReport.id}`);
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
        } else if (b.behaviorType === 'QUERY') {
          reportedM2M7Pairs.add(`${b.id}:MISSING`);
          diagnostics.push({
            id: `M2-M7-MISSING-REF-${b.id}`,
            tier: 'ERROR',
            code: 'M2_M7_ONE_TO_ONE_MISMATCH',
            model: 'M2',
            elementId: b.id,
            messageZh: `M2 查询行为「${b.id}」未声明一对一绑定的 queryReportRef。`,
            messageEn: `M2 query behavior "${b.id}" must declare queryReportRef for 1-to-1 M7 binding.`,
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
      for (const st of b.syncTriggers ?? []) {
        if (st.ruleRef && suite.M3 && !ruleIds.has(st.ruleRef)) {
          diagnostics.push({
            id: `M2-SYNCTRIG-RULE-${b.id}-${st.ruleRef}`,
            tier: 'ERROR',
            code: 'M2_DANGLING_RULE_REF',
            model: 'M2',
            elementId: b.id,
            messageZh: `行为「${b.id}」同步触发引用了不存在的 M3 规则「${st.ruleRef}」。`,
            messageEn: `Behavior "${b.id}" syncTrigger references non-existent M3 rule "${st.ruleRef}".`,
          });
        }
        if (!behaviorIds.has(st.behaviorRef)) {
          diagnostics.push({
            id: `M2-SYNCTRIG-BEH-${b.id}-${st.behaviorRef}`,
            tier: 'ERROR',
            code: 'M2_DANGLING_SYNC_BEHAVIOR_REF',
            model: 'M2',
            elementId: b.id,
            messageZh: `行为「${b.id}」同步触发引用了不存在的 M2 行为「${st.behaviorRef}」。`,
            messageEn: `Behavior "${b.id}" syncTrigger references non-existent M2 behavior "${st.behaviorRef}".`,
          });
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
          if (!resolveCanonicalAgg(objId)) {
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
        for (const bId of r.reusedBy ?? []) {
          if (!behaviorIds.has(bId)) {
            diagnostics.push({
              id: `M3-REUSE-BEH-${r.id}-${bId}`,
              tier: 'ERROR',
              code: 'M3_DANGLING_BEHAVIOR_REF',
              model: 'M3',
              elementId: r.id,
              messageZh: `规则「${r.id}」的 reusedBy 引用了不存在的 M2 行为「${bId}」。`,
              messageEn: `Rule "${r.id}" reusedBy references non-existent M2 behavior "${bId}".`,
            });
          }
        }
      }
      if (suite.ME) {
        for (const evId of r.triggeredByEvents) {
          if (!eventIds.has(evId)) {
            diagnostics.push({
              id: `M3-TRIG-EV-${r.id}-${evId}`,
              tier: 'ERROR',
              code: 'M3_DANGLING_EVENT_REF',
              model: 'M3',
              elementId: r.id,
              messageZh: `规则「${r.id}」订阅了未在 ME 中定义的事件「${evId}」。`,
              messageEn: `Rule "${r.id}" triggeredByEvents references unknown ME event "${evId}".`,
            });
          }
        }
        for (const evId of r.producedEvents) {
          if (!eventIds.has(evId)) {
            diagnostics.push({
              id: `M3-PROD-EV-${r.id}-${evId}`,
              tier: 'ERROR',
              code: 'M3_DANGLING_EVENT_REF',
              model: 'M3',
              elementId: r.id,
              messageZh: `规则「${r.id}」产生了未在 ME 中定义的事件「${evId}」。`,
              messageEn: `Rule "${r.id}" producedEvents references unknown ME event "${evId}".`,
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
      if (suite.M1 && !resolveCanonicalAgg(ev.sourceAggregate)) {
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
      if (ev.producerType === 'RULE' && suite.M3) {
        const ruleRef = ev.producerRuleRef || ev.producerBehaviorRef;
        if (!ruleRef || !ruleIds.has(ruleRef)) {
          diagnostics.push({
            id: `ME-PRODUCER-RULE-${ev.id}`,
            tier: 'ERROR',
            code: 'ME_DANGLING_PRODUCER_RULE',
            model: 'ME',
            elementId: ev.id,
            messageZh: `事件「${ev.id}」的生产者规则「${ruleRef ?? ''}」在 M3 中不存在。`,
            messageEn: `Event "${ev.id}" producerRuleRef "${ruleRef ?? ''}" does not exist in M3.`,
          });
        }
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
        if (sub.subscriberEntityRef && suite.M1 && !resolveCanonicalAgg(sub.subscriberEntityRef)) {
          diagnostics.push({
            id: `ME-SUB-ENT-${ev.id}-${sub.subscriberEntityRef}`,
            tier: 'ERROR',
            code: 'ME_DANGLING_SUBSCRIBER_ENTITY',
            model: 'ME',
            elementId: ev.id,
            messageZh: `事件「${ev.id}」订阅目标对象「${sub.subscriberEntityRef}」在 M1 中不存在。`,
            messageEn: `Event "${ev.id}" subscriberEntityRef "${sub.subscriberEntityRef}" does not exist in M1.`,
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
      if (sc.triggerBehaviorRef && suite.M2 && !behaviorIds.has(sc.triggerBehaviorRef)) {
        diagnostics.push({
          id: `M4-TRIG-BEH-${sc.id}`,
          tier: 'ERROR',
          code: 'M4_DANGLING_TRIGGER_BEHAVIOR',
          model: 'M4',
          elementId: sc.id,
          messageZh: `场景「${sc.id}」的触发行为「${sc.triggerBehaviorRef}」在 M2 中不存在。`,
          messageEn: `Scenario "${sc.id}" triggerBehaviorRef "${sc.triggerBehaviorRef}" does not exist in M2.`,
        });
      }

      const rawAggRefs = new Set<string>();
      for (const a of sc.involvedAggregates) if (a) rawAggRefs.add(a);
      if (sc.sourceObjectRef) rawAggRefs.add(sc.sourceObjectRef);
      for (const t of sc.targetObjectRefs ?? []) if (t) rawAggRefs.add(t);
      for (const st of sc.steps) {
        if (st.targetAggregate) rawAggRefs.add(st.targetAggregate);
      }

      const distinctCanonicalAggIds = new Set<string>();
      for (const aggRef of rawAggRefs) {
        if (suite.M1) {
          const resolved = resolveCanonicalAgg(aggRef);
          if (!resolved) {
            diagnostics.push({
              id: `M4-AGG-REF-${sc.id}-${aggRef}`,
              tier: 'ERROR',
              code: 'M4_DANGLING_AGGREGATE_REF',
              model: 'M4',
              elementId: sc.id,
              messageZh: `场景「${sc.id}」引用的对象「${aggRef}」在 M1 中不存在。`,
              messageEn: `Scenario "${sc.id}" references unknown M1 aggregate "${aggRef}".`,
            });
          } else {
            distinctCanonicalAggIds.add(resolved.id);
          }
        } else {
          distinctCanonicalAggIds.add(aggRef.split('.')[0]);
        }
      }

      if (distinctCanonicalAggIds.size < 2 && suite.M2) {
        for (const st of sc.steps) {
          if (st.stepType === 'BEHAVIOR_CALL') {
            const b = behaviorById.get(st.refId);
            if (b) {
              const resolved = suite.M1 ? resolveCanonicalAgg(b.ownerEntity) : undefined;
              distinctCanonicalAggIds.add(resolved ? resolved.id : b.ownerEntity.split('.')[0]);
            }
          }
        }
      }

      if (distinctCanonicalAggIds.size < 2) {
        diagnostics.push({
          id: `M4-SINGLE-AGG-${sc.id}`,
          tier: 'ERROR',
          code: 'M4_SINGLE_AGGREGATE_SCENARIO',
          model: 'M4',
          elementId: sc.id,
          messageZh: `场景「${sc.id}」仅涉及少于 2 个聚合根；跨对象联动场景必须至少跨越 2 个不同的 M1 聚合根（§6.2）。`,
          messageEn: `Scenario "${sc.id}" involves fewer than 2 distinct aggregates; M4 scenarios must span >= 2 aggregates (§6.2).`,
        });
      }

      const stepIdSet = new Set(sc.steps.map((s) => s.stepId || String(s.stepOrder)));
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
        for (const ns of step.nextSteps ?? []) {
          if (!stepIdSet.has(ns)) {
            diagnostics.push({
              id: `M4-STEP-NEXT-${sc.id}-${step.stepOrder}-${ns}`,
              tier: 'ERROR',
              code: 'M4_DANGLING_NEXT_STEP',
              model: 'M4',
              elementId: sc.id,
              messageZh: `场景「${sc.id}」步骤 ${step.stepOrder} 的后续步骤「${ns}」不存在。`,
              messageEn: `Scenario "${sc.id}" step ${step.stepOrder} nextStep "${ns}" does not exist.`,
            });
          }
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
      for (const rId of actor.roles) {
        if (!roleIds.has(rId)) {
          diagnostics.push({
            id: `M5-ACTOR-ROLE-${actor.id}-${rId}`,
            tier: 'ERROR',
            code: 'M5_DANGLING_ACTOR_ROLE',
            model: 'M5',
            elementId: actor.id,
            messageZh: `主体「${actor.name} (${actor.id})」关联的角色「${rId}」在 M5 中不存在。`,
            messageEn: `Actor "${actor.id}" references non-existent role "${rId}".`,
          });
        }
      }
    }

    for (const pg of suite.M5.permissionGroups ?? []) {
      for (const pId of pg.permissions) {
        if (!permissionIds.has(pId)) {
          diagnostics.push({
            id: `M5-PG-PERM-${pg.id}-${pId}`,
            tier: 'ERROR',
            code: 'M5_DANGLING_GROUP_PERMISSION',
            model: 'M5',
            elementId: pg.id,
            messageZh: `权限组「${pg.id}」包含的权限「${pId}」在 M5 中不存在。`,
            messageEn: `Permission group "${pg.id}" references unknown permission "${pId}".`,
          });
        }
      }
    }

    const cycleReportedRoles = new Set<string>();
    for (const role of suite.M5.roles) {
      for (const pId of role.permissions) {
        if (!permissionIds.has(pId)) {
          diagnostics.push({
            id: `M5-ROLE-PERM-${role.id}-${pId}`,
            tier: 'ERROR',
            code: 'M5_DANGLING_ROLE_PERMISSION',
            model: 'M5',
            elementId: role.id,
            messageZh: `角色「${role.name} (${role.id})」引用的权限「${pId}」在 M5 中不存在。`,
            messageEn: `Role "${role.id}" references non-existent permission "${pId}".`,
          });
        }
      }
      for (const pgId of role.permissionGroups ?? []) {
        if (!permissionGroupIds.has(pgId)) {
          diagnostics.push({
            id: `M5-ROLE-PG-${role.id}-${pgId}`,
            tier: 'ERROR',
            code: 'M5_DANGLING_PERMISSION_GROUP',
            model: 'M5',
            elementId: role.id,
            messageZh: `角色「${role.id}」引用的权限组「${pgId}」在 M5 中不存在。`,
            messageEn: `Role "${role.id}" references non-existent permissionGroup "${pgId}".`,
          });
        }
      }
      for (const parentId of role.inheritsFrom) {
        if (!roleIds.has(parentId)) {
          diagnostics.push({
            id: `M5-ROLE-INHERIT-${role.id}-${parentId}`,
            tier: 'ERROR',
            code: 'M5_DANGLING_ROLE_INHERITANCE',
            model: 'M5',
            elementId: role.id,
            messageZh: `角色「${role.id}」继承的父角色「${parentId}」在 M5 中不存在。`,
            messageEn: `Role "${role.id}" inheritsFrom unknown role "${parentId}".`,
          });
        }
      }

      // Detect role inheritance cycles via DFS
      const detectRoleCycle = (curId: string, stack: Set<string>): boolean => {
        if (stack.has(curId)) return true;
        const cur = roleById.get(curId);
        if (!cur) return false;
        stack.add(curId);
        for (const parentId of cur.inheritsFrom) {
          if (roleById.has(parentId) && detectRoleCycle(parentId, stack)) {
            return true;
          }
        }
        stack.delete(curId);
        return false;
      };

      if (!cycleReportedRoles.has(role.id) && detectRoleCycle(role.id, new Set())) {
        cycleReportedRoles.add(role.id);
        diagnostics.push({
          id: `M5-ROLE-CYCLE-${role.id}`,
          tier: 'ERROR',
          code: 'M5_ROLE_INHERITANCE_CYCLE',
          model: 'M5',
          elementId: role.id,
          messageZh: `角色「${role.name} (${role.id})」的继承链 inheritsFrom 存在循环继承。`,
          messageEn: `Role "${role.id}" has a cycle in its inheritsFrom hierarchy.`,
        });
      }
    }

    for (const perm of suite.M5.permissions) {
      if (suite.M1 && !resolveCanonicalAgg(perm.targetAggregate)) {
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
    const subFlowGraph = new Map<string, Set<string>>();

    for (const flow of suite.M6.flows) {
      subFlowGraph.set(flow.id, new Set());

      if (suite.M1 && !resolveCanonicalAgg(flow.primaryAggregate)) {
        diagnostics.push({
          id: `M6-PRIM-AGG-${flow.id}`,
          tier: 'ERROR',
          code: 'M6_DANGLING_AGGREGATE_REF',
          model: 'M6',
          elementId: flow.id,
          messageZh: `流程「${flow.id}」的主对象「${flow.primaryAggregate}」在 M1 中不存在。`,
          messageEn: `Flow "${flow.id}" primaryAggregate "${flow.primaryAggregate}" does not exist in M1.`,
        });
      }
      if (suite.M1) {
        for (const boRef of flow.businessObjectRefs ?? []) {
          if (!resolveCanonicalAgg(boRef)) {
            diagnostics.push({
              id: `M6-BO-REF-${flow.id}-${boRef}`,
              tier: 'ERROR',
              code: 'M6_DANGLING_AGGREGATE_REF',
              model: 'M6',
              elementId: flow.id,
              messageZh: `流程「${flow.id}」引用的业务对象「${boRef}」在 M1 中不存在。`,
              messageEn: `Flow "${flow.id}" businessObjectRef "${boRef}" does not exist in M1.`,
            });
          }
        }
      }
      if (suite.M5) {
        for (const rId of flow.roleRefs) {
          if (!roleIds.has(rId)) {
            diagnostics.push({
              id: `M6-FLOW-ROLE-${flow.id}-${rId}`,
              tier: 'ERROR',
              code: 'M6_DANGLING_FLOW_ROLE',
              model: 'M6',
              elementId: flow.id,
              messageZh: `流程「${flow.id}」声明的参与角色「${rId}」在 M5 中不存在。`,
              messageEn: `Flow "${flow.id}" roleRef "${rId}" does not exist in M5.`,
            });
          }
        }
      }

      const trigBeh =
        flow.trigger.behaviorRef ||
        ((flow.trigger.triggerType === 'USER_ACTION' || flow.trigger.triggerType === 'BEHAVIOR') &&
        flow.trigger.refId
          ? flow.trigger.refId
          : undefined);
      if (trigBeh && suite.M2 && !behaviorIds.has(trigBeh)) {
        diagnostics.push({
          id: `M6-TRIG-BEH-${flow.id}`,
          tier: 'ERROR',
          code: 'M6_DANGLING_TRIGGER_REF',
          model: 'M6',
          elementId: flow.id,
          messageZh: `流程「${flow.id}」触发器引用的 M2 行为「${trigBeh}」不存在。`,
          messageEn: `Flow "${flow.id}" trigger references unknown M2 behavior "${trigBeh}".`,
        });
      }
      const trigEv =
        flow.trigger.eventRef ||
        (flow.trigger.triggerType === 'EVENT' && flow.trigger.refId ? flow.trigger.refId : undefined);
      if (trigEv && suite.ME && !eventIds.has(trigEv)) {
        diagnostics.push({
          id: `M6-TRIG-EV-${flow.id}`,
          tier: 'ERROR',
          code: 'M6_DANGLING_TRIGGER_REF',
          model: 'M6',
          elementId: flow.id,
          messageZh: `流程「${flow.id}」触发器引用的 ME 事件「${trigEv}」不存在。`,
          messageEn: `Flow "${flow.id}" trigger references unknown ME event "${trigEv}".`,
        });
      }

      const activityById = new Map(flow.activities.map((a) => [a.id, a]));
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

      if (flow.startActivity && !activityById.has(flow.startActivity)) {
        diagnostics.push({
          id: `M6-START-REF-${flow.id}`,
          tier: 'ERROR',
          code: 'M6_DANGLING_ACTIVITY_TARGET',
          model: 'M6',
          elementId: flow.id,
          messageZh: `流程「${flow.id}」的 startActivity「${flow.startActivity}」不存在。`,
          messageEn: `Flow "${flow.id}" startActivity "${flow.startActivity}" does not exist.`,
        });
      }
      for (const endRef of flow.endActivities ?? []) {
        if (!activityById.has(endRef)) {
          diagnostics.push({
            id: `M6-END-REF-${flow.id}-${endRef}`,
            tier: 'ERROR',
            code: 'M6_DANGLING_ACTIVITY_TARGET',
            model: 'M6',
            elementId: flow.id,
            messageZh: `流程「${flow.id}」的 endActivities「${endRef}」不存在。`,
            messageEn: `Flow "${flow.id}" endActivities entry "${endRef}" does not exist.`,
          });
        }
      }

      const getOutgoingTargets = (act: (typeof flow.activities)[number]): string[] => {
        const targets = new Set<string>();
        if (act.nextActivity) targets.add(act.nextActivity);
        for (const na of act.nextActivities ?? []) {
          if (na) targets.add(na);
        }
        for (const br of act.branches) {
          if (br.targetActivity) targets.add(br.targetActivity);
        }
        return Array.from(targets);
      };

      const flowRoleSet = new Set(flow.roleRefs);
      const forwardEdges = new Map<string, string[]>();
      const reverseEdges = new Map<string, string[]>();
      for (const act of flow.activities) {
        forwardEdges.set(act.id, []);
        reverseEdges.set(act.id, []);
      }

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
        if (act.behaviorRef && suite.M2 && !behaviorIds.has(act.behaviorRef)) {
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
        if (act.scenarioRef && suite.M4 && !scenarioIds.has(act.scenarioRef)) {
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
        if (act.activityType === 'SUB_FLOW_CALL' && act.subFlowRef) {
          if (!flowIds.has(act.subFlowRef)) {
            diagnostics.push({
              id: `M6-ACT-SUBFLOW-${flow.id}-${act.id}`,
              tier: 'ERROR',
              code: 'M6_DANGLING_SUB_FLOW_CALL',
              model: 'M6',
              elementId: flow.id,
              messageZh: `流程「${flow.id}」活动「${act.id}」引用的子流程「${act.subFlowRef}」不存在。`,
              messageEn: `Flow "${flow.id}" activity "${act.id}" references unknown sub-flow "${act.subFlowRef}".`,
            });
          } else {
            subFlowGraph.get(flow.id)!.add(act.subFlowRef);
          }
        }
        if (act.ruleRef && suite.M3 && !ruleIds.has(act.ruleRef)) {
          diagnostics.push({
            id: `M6-ACT-RULE-${flow.id}-${act.id}`,
            tier: 'ERROR',
            code: 'M6_DANGLING_RULE_REF',
            model: 'M6',
            elementId: flow.id,
            messageZh: `流程「${flow.id}」活动「${act.id}」引用的 M3 规则「${act.ruleRef}」不存在。`,
            messageEn: `Flow "${flow.id}" activity "${act.id}" references unknown M3 rule "${act.ruleRef}".`,
          });
        }
        if (act.eventRef && suite.ME && !eventIds.has(act.eventRef)) {
          diagnostics.push({
            id: `M6-ACT-EV-${flow.id}-${act.id}`,
            tier: 'ERROR',
            code: 'M6_DANGLING_EVENT_REF',
            model: 'M6',
            elementId: flow.id,
            messageZh: `流程「${flow.id}」活动「${act.id}」引用的 ME 事件「${act.eventRef}」不存在。`,
            messageEn: `Flow "${flow.id}" activity "${act.id}" references unknown ME event "${act.eventRef}".`,
          });
        }

        if (act.activityType === 'XOR_GATEWAY' || act.activityType === 'GATEWAY') {
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
          for (const br of act.branches) {
            if (br.ruleRef && suite.M3 && !ruleIds.has(br.ruleRef)) {
              diagnostics.push({
                id: `M6-GW-RULE-${flow.id}-${act.id}-${br.ruleRef}`,
                tier: 'ERROR',
                code: 'M6_DANGLING_RULE_REF',
                model: 'M6',
                elementId: flow.id,
                messageZh: `流程「${flow.id}」网关「${act.id}」分支引用了不存在的规则「${br.ruleRef}」。`,
                messageEn: `Gateway "${act.id}" branch references unknown M3 rule "${br.ruleRef}".`,
              });
            }
            if (
              !br.isDefault &&
              !br.condition &&
              !br.conditionExpression &&
              !br.ruleRef &&
              !br.approvalOutcome
            ) {
              diagnostics.push({
                id: `M6-GW-COND-${flow.id}-${act.id}-${br.targetActivity}`,
                tier: 'ERROR',
                code: 'M6_GATEWAY_BRANCH_MISSING_CONDITION',
                model: 'M6',
                elementId: flow.id,
                messageZh: `流程「${flow.id}」网关「${act.id}」指向「${br.targetActivity}」的非默认分支必须声明路由条件。`,
                messageEn: `Non-default branch to "${br.targetActivity}" on gateway "${act.id}" in flow "${flow.id}" must declare a condition.`,
              });
            }
          }
        }

        const outgoing = getOutgoingTargets(act);
        for (const targetId of outgoing) {
          if (!activityById.has(targetId)) {
            diagnostics.push({
              id: `M6-ACT-TARGET-${flow.id}-${act.id}-${targetId}`,
              tier: 'ERROR',
              code: 'M6_DANGLING_ACTIVITY_TARGET',
              model: 'M6',
              elementId: flow.id,
              messageZh: `流程「${flow.id}」活动「${act.id}」流转指向了不存在的目标节点「${targetId}」。`,
              messageEn: `Flow "${flow.id}" activity "${act.id}" transitions to unknown activity "${targetId}".`,
            });
          } else {
            forwardEdges.get(act.id)!.push(targetId);
            reverseEdges.get(targetId)!.push(act.id);
          }
        }

        if (act.activityType === 'APPROVAL_TASK') {
          const hasDirectMultiPath = outgoing.length >= 2;
          const routesToDecisionGateway = outgoing.some((tId) => {
            const tgt = activityById.get(tId);
            return (
              tgt &&
              (tgt.activityType === 'XOR_GATEWAY' || tgt.activityType === 'GATEWAY') &&
              tgt.branches.length >= 2
            );
          });
          if (!hasDirectMultiPath && !routesToDecisionGateway) {
            diagnostics.push({
              id: `M6-APPROVAL-PATH-${flow.id}-${act.id}`,
              tier: 'ERROR',
              code: 'M6_APPROVAL_MISSING_REJECT_PATH',
              model: 'M6',
              elementId: flow.id,
              messageZh: `流程「${flow.id}」的审批节点「${act.id}」缺少驳回/退回分支路径（需直接声明多分支或连接至少 2 条分支的网关）。`,
              messageEn: `Approval task "${act.id}" in flow "${flow.id}" must provide a reject/return path via branches or a downstream gateway.`,
            });
          }
        }
      }

      // Graph reachability from START & dead-end check to END
      if (starts.length === 1 && ends.length >= 1) {
        const reachable = new Set<string>();
        const fwdQueue: string[] = [starts[0].id];
        reachable.add(starts[0].id);
        while (fwdQueue.length > 0) {
          const cur = fwdQueue.shift()!;
          for (const nxt of forwardEdges.get(cur) ?? []) {
            if (!reachable.has(nxt)) {
              reachable.add(nxt);
              fwdQueue.push(nxt);
            }
          }
        }

        for (const act of flow.activities) {
          if (!reachable.has(act.id)) {
            diagnostics.push({
              id: `M6-UNREACHABLE-${flow.id}-${act.id}`,
              tier: 'ERROR',
              code: 'M6_UNREACHABLE_ACTIVITY',
              model: 'M6',
              elementId: flow.id,
              messageZh: `流程「${flow.id}」的节点「${act.id}」无法从开始节点到达（不可达孤立节点）。`,
              messageEn: `Activity "${act.id}" in flow "${flow.id}" is unreachable from START.`,
            });
          }
        }

        const canReachEnd = new Set<string>();
        const revQueue: string[] = ends.map((e) => e.id);
        for (const e of ends) canReachEnd.add(e.id);
        while (revQueue.length > 0) {
          const cur = revQueue.shift()!;
          for (const prev of reverseEdges.get(cur) ?? []) {
            if (!canReachEnd.has(prev)) {
              canReachEnd.add(prev);
              revQueue.push(prev);
            }
          }
        }

        for (const act of flow.activities) {
          if (act.activityType !== 'END') {
            const validOut = forwardEdges.get(act.id) ?? [];
            if (validOut.length === 0 || !canReachEnd.has(act.id)) {
              diagnostics.push({
                id: `M6-DEAD-END-${flow.id}-${act.id}`,
                tier: 'ERROR',
                code: 'M6_DEAD_END_ACTIVITY',
                model: 'M6',
                elementId: flow.id,
                messageZh: `流程「${flow.id}」的非结束节点「${act.id}」无法到达任何 END 结束节点（死胡同或死循环）。`,
                messageEn: `Non-END activity "${act.id}" in flow "${flow.id}" cannot reach any END activity.`,
              });
            }
          }
        }
      }
    }

    // Sub-flow recursion / cycle check across M6 flows
    for (const flow of suite.M6.flows) {
      const detectSubFlowCycle = (curFlowId: string, stack: Set<string>): boolean => {
        if (stack.has(curFlowId)) return true;
        stack.add(curFlowId);
        for (const calleeId of subFlowGraph.get(curFlowId) ?? []) {
          if (flowById.has(calleeId) && detectSubFlowCycle(calleeId, stack)) {
            return true;
          }
        }
        stack.delete(curFlowId);
        return false;
      };

      if (detectSubFlowCycle(flow.id, new Set())) {
        diagnostics.push({
          id: `M6-SUBFLOW-CYCLE-${flow.id}`,
          tier: 'ERROR',
          code: 'M6_SUB_FLOW_CYCLE',
          model: 'M6',
          elementId: flow.id,
          messageZh: `流程「${flow.id}」的子流程调用链 SUB_FLOW_CALL 存在递归或循环调用。`,
          messageEn: `Flow "${flow.id}" has a recursive cycle in its SUB_FLOW_CALL chain.`,
        });
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
        } else if (
          b.queryReportRef !== qr.id &&
          !reportedM2M7Pairs.has(`${b.id}:${qr.id}`) &&
          !reportedM2M7Pairs.has(`${b.id}:MISSING`)
        ) {
          diagnostics.push({
            id: `M7-M2-MISMATCH-${qr.id}`,
            tier: 'ERROR',
            code: 'M2_M7_ONE_TO_ONE_MISMATCH',
            model: 'M7',
            elementId: qr.id,
            messageZh: `M7 查询报表「${qr.id}」绑定的行为「${b.id}」未反向声明 queryReportRef="${qr.id}"。`,
            messageEn: `M7 report "${qr.id}" binds behavior "${b.id}" whose queryReportRef does not point back to "${qr.id}".`,
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

      if (suite.M1) {
        if (!resolveCanonicalAgg(qr.primarySource.aggregateRef)) {
          diagnostics.push({
            id: `M7-PRIM-SRC-${qr.id}`,
            tier: 'ERROR',
            code: 'M7_DANGLING_PRIMARY_SOURCE',
            model: 'M7',
            elementId: qr.id,
            messageZh: `M7「${qr.id}」的主数据源「${qr.primarySource.aggregateRef}」在 M1 中不存在。`,
            messageEn: `M7 "${qr.id}" primarySource "${qr.primarySource.aggregateRef}" does not exist in M1.`,
          });
        }
        for (const so of qr.sourceObjects ?? []) {
          if (!resolveCanonicalAgg(so.objectRef)) {
            diagnostics.push({
              id: `M7-SRC-OBJ-${qr.id}-${so.alias}`,
              tier: 'ERROR',
              code: 'M7_DANGLING_SOURCE_OBJECT',
              model: 'M7',
              elementId: qr.id,
              messageZh: `M7「${qr.id}」的数据源「${so.objectRef}」在 M1 中不存在。`,
              messageEn: `M7 "${qr.id}" sourceObject "${so.objectRef}" does not exist in M1.`,
            });
          }
        }
        for (const jn of qr.joins) {
          if (!resolveCanonicalAgg(jn.aggregateRef)) {
            diagnostics.push({
              id: `M7-JOIN-AGG-${qr.id}-${jn.alias}`,
              tier: 'ERROR',
              code: 'M7_DANGLING_JOIN_AGGREGATE',
              model: 'M7',
              elementId: qr.id,
              messageZh: `M7「${qr.id}」的关联表「${jn.aggregateRef}」在 M1 中不存在。`,
              messageEn: `M7 "${qr.id}" join aggregateRef "${jn.aggregateRef}" does not exist in M1.`,
            });
          }
          if (jn.relationRef && !associationIds.has(jn.relationRef)) {
            diagnostics.push({
              id: `M7-JOIN-REL-${qr.id}-${jn.relationRef}`,
              tier: 'ERROR',
              code: 'M7_DANGLING_JOIN_RELATION',
              model: 'M7',
              elementId: qr.id,
              messageZh: `M7「${qr.id}」引用的聚合关联「${jn.relationRef}」在 M1 中不存在。`,
              messageEn: `M7 "${qr.id}" join relationRef "${jn.relationRef}" does not exist in M1.`,
            });
          }
        }
      }

      const declaredParams = new Set(qr.parameters.map((p) => p.name));
      for (const cond of qr.conditions) {
        if (cond.parameterRef && !declaredParams.has(cond.parameterRef)) {
          diagnostics.push({
            id: `M7-COND-PARAM-${qr.id}-${cond.parameterRef}`,
            tier: 'ERROR',
            code: 'M7_UNDECLARED_CONDITION_PARAMETER',
            model: 'M7',
            elementId: qr.id,
            messageZh: `M7「${qr.id}」过滤条件引用了未在 parameters 中声明的参数「${cond.parameterRef}」。`,
            messageEn: `M7 "${qr.id}" condition references undeclared parameter "${cond.parameterRef}".`,
          });
        }
      }

      // Multi-1:N join fan-out check (§9.3)
      if (qr.queryType === 'STATISTICAL_QUERY' || qr.queryType === 'REPORT') {
        const hasSumOrAvg = qr.resultColumns.some(
          (col) =>
            col.aggregation === 'SUM' ||
            col.aggregation === 'AVG' ||
            /\b(?:SUM|AVG)\s*\(/i.test(col.sourceExpr),
        );
        if (hasSumOrAvg) {
          const preAggAliases = new Set(
            (qr.sourceObjects ?? []).filter((so) => Boolean(so.preAggregation)).map((so) => so.alias),
          );
          const unaggregatedJoins = qr.joins.filter(
            (jn) => !jn.preAggregated && !preAggAliases.has(jn.alias),
          );
          if (unaggregatedJoins.length >= 2) {
            diagnostics.push({
              id: `M7-FANOUT-${qr.id}`,
              tier: 'ERROR',
              code: 'M7_MULTI_JOIN_FANOUT_RISK',
              model: 'M7',
              elementId: qr.id,
              messageZh: `M7 统计报表「${qr.id}」包含 SUM/AVG 聚合且存在 ${unaggregatedJoins.length} 个未预聚合 JOIN，会导致笛卡尔积扇出重复累加（§9.3）。`,
              messageEn: `M7 "${qr.id}" uses SUM/AVG with ${unaggregatedJoins.length} non-preAggregated joins, risking 1:N fan-out inflation (§9.3).`,
            });
          }
        }
      }

      // Check referenceSql :param bindings
      const sqlParamRegex = /(?:^|[^:]):([a-zA-Z_][a-zA-Z0-9_]*)/g;
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

  // ─── MU Validation & 8 Reverse-Traceability Checks ─────────────────────────
  if (suite.MU) {
    const referencedUserActionBehaviors = new Set<string>();
    const screenReferencedScenarios = new Map<string, Set<string>>();
    const screenReferencedReports = new Map<string, Set<string>>();

    for (const screen of suite.MU.screens) {
      const elementMap = new Map(screen.elements.map((e) => [e.elementId, e]));
      const scenSet = new Set<string>();
      const rptSet = new Set<string>();
      screenReferencedScenarios.set(screen.screenId, scenSet);
      screenReferencedReports.set(screen.screenId, rptSet);

      if (suite.M5) {
        for (const rId of screen.roleRefs) {
          if (!roleIds.has(rId)) {
            diagnostics.push({
              id: `MU-SCR-ROLE-${screen.screenId}-${rId}`,
              tier: 'ERROR',
              code: 'MU_DANGLING_ROLE_REF',
              model: 'MU',
              elementId: screen.screenId,
              messageZh: `屏幕「${screen.screenId}」引用的角色「${rId}」在 M5 中不存在。`,
              messageEn: `Screen "${screen.screenId}" roleRef "${rId}" does not exist in M5.`,
            });
          }
        }
      }

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

      for (const el of screen.elements) {
        if (el.dataBinding && suite.M1) {
          const normBind = normalizeAttrPath(el.dataBinding);
          if (normBind.includes('.')) {
            const dotIdx = normBind.indexOf('.');
            const aggPrefix = normBind.slice(0, dotIdx);
            const attrRest = normBind.slice(dotIdx + 1);
            const agg = resolveCanonicalAgg(aggPrefix);
            const validAttrs = agg ? aggValidAttrPaths.get(agg.id) : undefined;
            if (!agg || (validAttrs && !validAttrs.has(attrRest) && !IMPLICIT_PERSISTENCE_ATTRS.has(attrRest))) {
              diagnostics.push({
                id: `MU-EL-BIND-${screen.screenId}-${el.elementId}`,
                tier: 'ERROR',
                code: 'MU_DANGLING_DATA_BINDING',
                model: 'MU',
                elementId: screen.screenId,
                messageZh: `屏幕「${screen.screenId}」控件「${el.elementId}」的 dataBinding「${el.dataBinding}」在 M1 中不存在。`,
                messageEn: `Element "${el.elementId}" on "${screen.screenId}" has unknown M1 dataBinding "${el.dataBinding}".`,
              });
            }
          } else if (!resolveCanonicalAgg(normBind)) {
            diagnostics.push({
              id: `MU-EL-BIND-${screen.screenId}-${el.elementId}`,
              tier: 'ERROR',
              code: 'MU_DANGLING_DATA_BINDING',
              model: 'MU',
              elementId: screen.screenId,
              messageZh: `屏幕「${screen.screenId}」控件「${el.elementId}」的 dataBinding「${el.dataBinding}」在 M1 中不存在。`,
              messageEn: `Element "${el.elementId}" on "${screen.screenId}" has unknown M1 dataBinding "${el.dataBinding}".`,
            });
          }
        }

        if (el.dictionaryRef && suite.M1) {
          const dictId = el.dictionaryRef.split('.')[0];
          if (!dictionaryTypes.has(dictId)) {
            diagnostics.push({
              id: `MU-EL-DICT-${screen.screenId}-${el.elementId}`,
              tier: 'ERROR',
              code: 'MU_DANGLING_DICTIONARY_REF',
              model: 'MU',
              elementId: screen.screenId,
              messageZh: `屏幕「${screen.screenId}」控件「${el.elementId}」引用的数据字典「${el.dictionaryRef}」不存在。`,
              messageEn: `Element "${el.elementId}" on "${screen.screenId}" references unknown dictionary "${el.dictionaryRef}".`,
            });
          }
        }

        if (el.dataSource) {
          if (reportIds.has(el.dataSource)) {
            rptSet.add(el.dataSource);
          } else if (suite.M7 && suite.M1) {
            const isM1 = Boolean(resolveCanonicalAgg(el.dataSource)) || dictionaryTypes.has(el.dataSource.split('.')[0]);
            if (!isM1 && !behaviorIds.has(el.dataSource)) {
              diagnostics.push({
                id: `MU-EL-DS-${screen.screenId}-${el.elementId}`,
                tier: 'ERROR',
                code: 'MU_DANGLING_DATA_SOURCE',
                model: 'MU',
                elementId: screen.screenId,
                messageZh: `屏幕「${screen.screenId}」控件「${el.elementId}」的 dataSource「${el.dataSource}」在 M7/M1 中不存在。`,
                messageEn: `Element "${el.elementId}" on "${screen.screenId}" references unknown dataSource "${el.dataSource}".`,
              });
            }
          }
        }

        if (el.permissionRef && suite.M5 && !permissionIds.has(el.permissionRef)) {
          diagnostics.push({
            id: `MU-EL-PERM-${screen.screenId}-${el.elementId}`,
            tier: 'ERROR',
            code: 'MU_DANGLING_PERMISSION_REF',
            model: 'MU',
            elementId: screen.screenId,
            messageZh: `屏幕「${screen.screenId}」控件「${el.elementId}」引用的权限「${el.permissionRef}」在 M5 中不存在。`,
            messageEn: `Element "${el.elementId}" on "${screen.screenId}" references unknown M5 permission "${el.permissionRef}".`,
          });
        }
      }

      for (const ev of screen.events) {
        if (
          !elementMap.has(ev.triggerElementId) &&
          !(ev.triggerAction === 'LOAD' && ev.triggerElementId === screen.screenId)
        ) {
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

        if (suite.M5) {
          for (const permId of ev.permissions) {
            if (!permissionIds.has(permId)) {
              diagnostics.push({
                id: `MU-EV-PERM-${ev.eventId}-${permId}`,
                tier: 'ERROR',
                code: 'MU_DANGLING_PERMISSION_REF',
                model: 'MU',
                elementId: ev.eventId,
                messageZh: `UI 事件「${ev.eventId}」引用的权限「${permId}」在 M5 中不存在。`,
                messageEn: `UI event "${ev.eventId}" references unknown M5 permission "${permId}".`,
              });
            }
          }
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

          if (step.stepType === 'VALIDATE' && suite.M3) {
            const candidateRuleIds = Array.from(
              new Set([
                ...(step.refId && step.refId !== 'VALIDATE' ? [step.refId] : []),
                ...(step.rules ?? []),
              ]),
            );
            for (const rId of candidateRuleIds) {
              const targetRule = ruleById.get(rId);
              if (!targetRule) {
                diagnostics.push({
                  id: `MU-CHAIN-RULE-${ev.eventId}-${rId}`,
                  tier: 'ERROR',
                  code: 'MU_DANGLING_VALIDATE_RULE',
                  model: 'MU',
                  elementId: ev.eventId,
                  messageZh: `UI 事件「${ev.eventId}」前置校验引用了不存在的 M3 规则「${rId}」。`,
                  messageEn: `UI event "${ev.eventId}" VALIDATE step references unknown M3 rule "${rId}".`,
                });
              } else if (
                targetRule.triggeredBehaviors.length > 0 ||
                targetRule.producedEvents.length > 0
              ) {
                diagnostics.push({
                  id: `MU-VALIDATE-SIDEEFFECT-${ev.eventId}-${rId}`,
                  tier: 'ERROR',
                  code: 'MU_VALIDATE_RULE_HAS_SIDE_EFFECTS',
                  model: 'MU',
                  elementId: ev.eventId,
                  messageZh: `UI 事件「${ev.eventId}」的 VALIDATE 步骤引用了带有触发行为或产生事件副作用的规则「${rId}」（违反 §10.4.3 纯校验约束）。`,
                  messageEn: `UI event "${ev.eventId}" VALIDATE step references rule "${rId}" which has side effects (§10.4.3).`,
                });
              }
            }
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
            } else if (
              targetEv.producerType === 'BEHAVIOR' &&
              !calledBehaviorsInChain.has(targetEv.producerBehaviorRef)
            ) {
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

          if (step.stepType === 'SCENARIO_CALL') {
            scenSet.add(step.refId);
            if (suite.M4 && !scenarioIds.has(step.refId)) {
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
          }

          if (step.stepType === 'REPORT_CALL' || step.stepType === 'QUERY_REPORT') {
            if (reportIds.has(step.refId)) {
              rptSet.add(step.refId);
              const rep = reportById.get(step.refId);
              if (rep) referencedUserActionBehaviors.add(rep.behaviorRef);
            }
            if (behaviorIds.has(step.refId)) {
              referencedUserActionBehaviors.add(step.refId);
              const beh = behaviorById.get(step.refId);
              if (beh?.queryReportRef) rptSet.add(beh.queryReportRef);
            }
            if (suite.M7 && !reportIds.has(step.refId) && !behaviorIds.has(step.refId)) {
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
          }

          if (step.stepType === 'NAVIGATE' && step.refId !== 'EXIT' && !screenIds.has(step.refId)) {
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

    for (const edge of suite.MU.navigation_edges) {
      if (!screenIds.has(edge.fromScreen)) {
        diagnostics.push({
          id: `MU-NAV-FROM-${edge.id}`,
          tier: 'ERROR',
          code: 'MU_DANGLING_NAVIGATE_SCREEN',
          model: 'MU',
          elementId: edge.id,
          messageZh: `导航边「${edge.id}」的来源屏幕「${edge.fromScreen}」不存在。`,
          messageEn: `Navigation edge "${edge.id}" fromScreen "${edge.fromScreen}" does not exist.`,
        });
      }
      if (edge.toScreen !== 'EXIT' && !screenIds.has(edge.toScreen)) {
        diagnostics.push({
          id: `MU-NAV-TO-${edge.id}`,
          tier: 'ERROR',
          code: 'MU_DANGLING_NAVIGATE_SCREEN',
          model: 'MU',
          elementId: edge.id,
          messageZh: `导航边「${edge.id}」的目标屏幕「${edge.toScreen}」不存在。`,
          messageEn: `Navigation edge "${edge.id}" toScreen "${edge.toScreen}" does not exist.`,
        });
      }
      if (edge.triggerEventId && !allUiEventIds.has(edge.triggerEventId)) {
        diagnostics.push({
          id: `MU-NAV-EV-${edge.id}`,
          tier: 'ERROR',
          code: 'MU_DANGLING_NAVIGATION_EVENT',
          model: 'MU',
          elementId: edge.id,
          messageZh: `导航边「${edge.id}」关联的触发事件「${edge.triggerEventId}」不存在。`,
          messageEn: `Navigation edge "${edge.id}" triggerEventId "${edge.triggerEventId}" does not exist.`,
        });
      }
    }

    for (const cc of suite.MU.cross_cutting_ui) {
      for (const sId of cc.scopeScreens) {
        if (sId !== '*' && !screenIds.has(sId)) {
          diagnostics.push({
            id: `MU-CC-SCR-${cc.id}-${sId}`,
            tier: 'ERROR',
            code: 'MU_DANGLING_NAVIGATE_SCREEN',
            model: 'MU',
            elementId: cc.id,
            messageZh: `全局 UI 规则「${cc.id}」的适用屏幕「${sId}」不存在。`,
            messageEn: `Cross-cutting UI "${cc.id}" scopeScreen "${sId}" does not exist.`,
          });
        }
      }
      if (cc.target && cc.target !== 'EXIT' && !screenIds.has(cc.target)) {
        diagnostics.push({
          id: `MU-CC-TGT-${cc.id}`,
          tier: 'ERROR',
          code: 'MU_DANGLING_NAVIGATE_SCREEN',
          model: 'MU',
          elementId: cc.id,
          messageZh: `全局 UI 规则「${cc.id}」的目标屏幕「${cc.target}」不存在。`,
          messageEn: `Cross-cutting UI "${cc.id}" target screen "${cc.target}" does not exist.`,
        });
      }
      if (suite.M3) {
        for (const rId of cc.rules ?? []) {
          if (!ruleIds.has(rId)) {
            diagnostics.push({
              id: `MU-CC-RULE-${cc.id}-${rId}`,
              tier: 'ERROR',
              code: 'MU_DANGLING_VALIDATE_RULE',
              model: 'MU',
              elementId: cc.id,
              messageZh: `全局 UI 规则「${cc.id}」引用了不存在的 M3 规则「${rId}」。`,
              messageEn: `Cross-cutting UI "${cc.id}" references unknown M3 rule "${rId}".`,
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

    // ─── 8 Reverse-Traceability Optional Field Verifications (§1.3 / §10.7) ───
    // 1. M1.uiBindings
    if (suite.M1) {
      const checkM1UiBindings = (ownerId: string, bindings: string[] | undefined, label: string) => {
        for (const bindRef of bindings ?? []) {
          if (!screenIds.has(bindRef) && !allUiElementIds.has(bindRef)) {
            diagnostics.push({
              id: `M1-UI-BIND-${ownerId}-${label}-${bindRef}`,
              tier: 'ERROR',
              code: 'M1_DANGLING_UI_BINDING',
              model: 'M1',
              elementId: ownerId,
              messageZh: `M1「${label}」的反向追溯 uiBindings「${bindRef}」在 MU 中不存在。`,
              messageEn: `M1 "${label}" uiBindings reference "${bindRef}" does not exist in MU.`,
            });
          }
        }
      };
      for (const agg of suite.M1.aggregates) {
        checkM1UiBindings(agg.id, agg.uiBindings, agg.name);
        for (const attr of agg.attributes) {
          checkM1UiBindings(agg.id, attr.uiBindings, `${agg.name}.${attr.name}`);
        }
        for (const ent of agg.entities) {
          for (const attr of ent.attributes) {
            checkM1UiBindings(agg.id, attr.uiBindings, `${agg.name}.${ent.name}.${attr.name}`);
          }
        }
        for (const vo of agg.valueObjects) {
          for (const attr of vo.attributes) {
            checkM1UiBindings(agg.id, attr.uiBindings, `${agg.name}.${vo.name}.${attr.name}`);
          }
        }
      }
    }

    // 2. M2.uiEventRefs
    if (suite.M2) {
      for (const b of suite.M2.behaviors) {
        for (const uiEvId of b.uiEventRefs ?? []) {
          const entry = uiEventById.get(uiEvId);
          const callsBehavior = entry?.event.callChain.some(
            (s) =>
              (s.stepType === 'BEHAVIOR_CALL' && s.refId === b.id) ||
              ((s.stepType === 'REPORT_CALL' || s.stepType === 'QUERY_REPORT') &&
                (s.refId === b.id || (b.queryReportRef !== undefined && s.refId === b.queryReportRef))),
          );
          if (!entry || !callsBehavior) {
            diagnostics.push({
              id: `M2-UI-EV-REF-${b.id}-${uiEvId}`,
              tier: 'ERROR',
              code: 'M2_DANGLING_UI_EVENT_REF',
              model: 'M2',
              elementId: b.id,
              messageZh: `M2 行为「${b.id}」的反向追溯 uiEventRefs「${uiEvId}」在 MU 中不存在或未调用该行为。`,
              messageEn: `M2 behavior "${b.id}" uiEventRefs "${uiEvId}" does not exist in MU or does not call "${b.id}".`,
            });
          }
        }
      }
    }

    // 3. M3.uiValidationRefs
    if (suite.M3) {
      for (const r of suite.M3.rules) {
        for (const uiEvId of r.uiValidationRefs ?? []) {
          const entry = uiEventById.get(uiEvId);
          const validatesRule = entry?.event.callChain.some(
            (s) =>
              s.stepType === 'VALIDATE' &&
              (s.refId === r.id || (s.rules !== undefined && s.rules.includes(r.id))),
          );
          if (!entry || !validatesRule) {
            diagnostics.push({
              id: `M3-UI-VAL-REF-${r.id}-${uiEvId}`,
              tier: 'ERROR',
              code: 'M3_DANGLING_UI_VALIDATION_REF',
              model: 'M3',
              elementId: r.id,
              messageZh: `M3 规则「${r.id}」的反向追溯 uiValidationRefs「${uiEvId}」不是有效的 MU 校验事件引用。`,
              messageEn: `M3 rule "${r.id}" uiValidationRefs "${uiEvId}" is not a valid MU UIEvent VALIDATE reference.`,
            });
          }
        }
      }
    }

    // 4. ME.uiEventPath
    if (suite.ME) {
      for (const ev of suite.ME.events) {
        if (ev.uiEventPath !== undefined) {
          const rawPaths = Array.isArray(ev.uiEventPath) ? ev.uiEventPath : [ev.uiEventPath];
          for (const rawPath of rawPaths) {
            const tokens = rawPath
              .split(/\s*(?:->|→|\/)\s*/)
              .map((t) => t.trim())
              .filter(Boolean);
            const hasMuAnchor = tokens.some(
              (t) => screenIds.has(t) || allUiEventIds.has(t) || allUiElementIds.has(t),
            );
            const allTokensKnown = tokens.every(
              (t) =>
                screenIds.has(t) ||
                allUiEventIds.has(t) ||
                allUiElementIds.has(t) ||
                behaviorIds.has(t) ||
                eventIds.has(t),
            );
            if (!hasMuAnchor || !allTokensKnown) {
              diagnostics.push({
                id: `ME-UI-PATH-${ev.id}-${rawPath}`,
                tier: 'ERROR',
                code: 'ME_DANGLING_UI_EVENT_PATH',
                model: 'ME',
                elementId: ev.id,
                messageZh: `ME 事件「${ev.id}」的反向追溯 uiEventPath「${rawPath}」包含未在 MU 中定义的屏幕或事件节点。`,
                messageEn: `ME event "${ev.id}" uiEventPath "${rawPath}" references unknown MU screen/event/element.`,
              });
            }
          }
        }
      }
    }

    // 5. M4.uiTriggerScreen
    if (suite.M4) {
      for (const sc of suite.M4.event_scenarios) {
        if (sc.uiTriggerScreen) {
          const scenOnScreen = screenReferencedScenarios.get(sc.uiTriggerScreen);
          if (!screenIds.has(sc.uiTriggerScreen) || !scenOnScreen?.has(sc.id)) {
            diagnostics.push({
              id: `M4-UI-SCR-${sc.id}-${sc.uiTriggerScreen}`,
              tier: 'ERROR',
              code: 'M4_DANGLING_UI_TRIGGER_SCREEN',
              model: 'M4',
              elementId: sc.id,
              messageZh: `M4 场景「${sc.id}」的 uiTriggerScreen「${sc.uiTriggerScreen}」在 MU 中不存在或未通过 SCENARIO_CALL 调用该场景。`,
              messageEn: `M4 scenario "${sc.id}" uiTriggerScreen "${sc.uiTriggerScreen}" does not exist or does not invoke "${sc.id}".`,
            });
          }
        }
      }
    }

    // 6. M5.uiControlledElements
    if (suite.M5) {
      for (const perm of suite.M5.permissions) {
        for (const elId of perm.uiControlledElements) {
          if (!allUiElementIds.has(elId)) {
            diagnostics.push({
              id: `M5-UI-EL-${perm.id}-${elId}`,
              tier: 'ERROR',
              code: 'M5_DANGLING_UI_CONTROLLED_ELEMENT',
              model: 'M5',
              elementId: perm.id,
              messageZh: `M5 权限「${perm.id}」的 uiControlledElements「${elId}」在 MU 中不存在。`,
              messageEn: `M5 permission "${perm.id}" uiControlledElement "${elId}" does not exist in MU.`,
            });
          }
        }
      }
    }

    // 7. M6.screenRef
    if (suite.M6) {
      for (const flow of suite.M6.flows) {
        for (const act of flow.activities) {
          if (act.screenRef && !screenIds.has(act.screenRef)) {
            diagnostics.push({
              id: `M6-SCR-REF-${flow.id}-${act.id}`,
              tier: 'ERROR',
              code: 'M6_DANGLING_SCREEN_REF',
              model: 'M6',
              elementId: flow.id,
              messageZh: `M6 流程「${flow.id}」节点「${act.id}」的 screenRef「${act.screenRef}」在 MU 中不存在。`,
              messageEn: `M6 flow "${flow.id}" activity "${act.id}" screenRef "${act.screenRef}" does not exist in MU.`,
            });
          }
        }
      }
    }

    // 8. M7.uiScreenRefs
    if (suite.M7) {
      for (const qr of suite.M7.query_reports) {
        for (const scrId of qr.uiScreenRefs ?? []) {
          const rptsOnScreen = screenReferencedReports.get(scrId);
          if (!screenIds.has(scrId) || !rptsOnScreen?.has(qr.id)) {
            diagnostics.push({
              id: `M7-UI-SCR-${qr.id}-${scrId}`,
              tier: 'ERROR',
              code: 'M7_DANGLING_UI_SCREEN_REF',
              model: 'M7',
              elementId: qr.id,
              messageZh: `M7 查询报表「${qr.id}」的 uiScreenRefs「${scrId}」在 MU 中不存在或未绑定/调用该查询报表。`,
              messageEn: `M7 report "${qr.id}" uiScreenRef "${scrId}" does not exist or does not bind/call "${qr.id}".`,
            });
          }
        }
      }
    }
  }

  // ─── MM Validation ──────────────────────────────────────────────────────────
  if (suite.MM) {
    const allMasterTables = new Set<string>();
    for (const mp of suite.MM.mappings) {
      for (const tm of mp.tableMappings) {
        if (tm.tableRole === 'MASTER') {
          allMasterTables.add(tm.tableName);
        }
      }
    }

    for (const mapping of suite.MM.mappings) {
      const resolvedAgg = suite.M1
        ? resolveCanonicalAgg(mapping.objectRef) ?? resolveCanonicalAgg(mapping.objectName)
        : undefined;

      if (suite.M1 && !resolvedAgg) {
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
      if (mapping.objectRole === 'AGGREGATE_ROOT' && masterTables.length === 0) {
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

      const localMasterNames = new Set(masterTables.map((t) => t.tableName));
      for (const tm of mapping.tableMappings) {
        if (tm.tableRole === 'DETAIL' || tm.tableRole === 'EXT') {
          const hasMasterFk =
            tm.foreignKeys.some(
              (fk) => localMasterNames.has(fk.targetTable) || allMasterTables.has(fk.targetTable),
            ) ||
            tm.columnMappings.some(
              (cm) =>
                Boolean(cm.isForeignKey) &&
                Boolean(cm.fkTargetTable) &&
                (localMasterNames.has(cm.fkTargetTable!) || allMasterTables.has(cm.fkTargetTable!)),
            );
          if (!hasMasterFk) {
            diagnostics.push({
              id: `MM-DETAIL-FK-${mapping.id}-${tm.tableName}`,
              tier: 'ERROR',
              code: 'MM_DETAIL_MISSING_MASTER_FK',
              model: 'MM',
              elementId: mapping.id,
              messageZh: `数据表映射「${mapping.id}」的子表/扩展表「${tm.tableName}」（${tm.tableRole}）必须声明指向 MASTER 主表的外键。`,
              messageEn: `${tm.tableRole} table "${tm.tableName}" in mapping "${mapping.id}" must declare a foreign key to a MASTER table.`,
            });
          }
        }

        for (const fk of tm.foreignKeys) {
          if (fk.associationRef && suite.M1 && !associationIds.has(fk.associationRef)) {
            diagnostics.push({
              id: `MM-FK-ASSOC-${mapping.id}-${tm.tableName}-${fk.fkName}`,
              tier: 'ERROR',
              code: 'MM_DANGLING_ASSOCIATION_REF',
              model: 'MM',
              elementId: mapping.id,
              messageZh: `外键「${fk.fkName}」引用的关联「${fk.associationRef}」在 M1 中不存在。`,
              messageEn: `Foreign key "${fk.fkName}" associationRef "${fk.associationRef}" does not exist in M1.`,
            });
          }
        }

        if (suite.M1 && resolvedAgg) {
          const currentValidAttrs = aggValidAttrPaths.get(resolvedAgg.id);
          for (const cm of tm.columnMappings) {
            if (
              cm.isPrimaryKey ||
              cm.isForeignKey ||
              cm.isDerived ||
              IMPLICIT_PERSISTENCE_ATTRS.has(cm.attributeRef)
            ) {
              continue;
            }
            const normRef = normalizeAttrPath(cm.attributeRef);
            let isValid = false;
            if (normRef.includes('.')) {
              const dotIdx = normRef.indexOf('.');
              const prefix = normRef.slice(0, dotIdx);
              const rest = normRef.slice(dotIdx + 1);
              const prefixAgg = resolveCanonicalAgg(prefix);
              if (prefixAgg) {
                const prefixAttrs = aggValidAttrPaths.get(prefixAgg.id);
                isValid =
                  Boolean(prefixAttrs?.has(rest)) || IMPLICIT_PERSISTENCE_ATTRS.has(rest);
              }
              if (!isValid && currentValidAttrs?.has(normRef)) {
                isValid = true;
              }
            } else {
              isValid = Boolean(currentValidAttrs?.has(normRef));
            }

            if (!isValid) {
              diagnostics.push({
                id: `MM-ATTR-REF-${mapping.id}-${tm.tableName}-${cm.column}`,
                tier: 'ERROR',
                code: 'MM_DANGLING_ATTRIBUTE_REF',
                model: 'MM',
                elementId: mapping.id,
                messageZh: `数据表「${tm.tableName}」字段「${cm.column}」映射的属性「${cm.attributeRef}」在 M1 对象「${resolvedAgg.name}」中不存在。`,
                messageEn: `Column "${cm.column}" in "${tm.tableName}" maps unknown M1 attribute "${cm.attributeRef}".`,
              });
            }
          }
        }
      }
    }
  }

  // ─── MI Validation ──────────────────────────────────────────────────────────
  if (suite.MI) {
    const seenInterfaceIds = new Set<string>();
    for (const intf of suite.MI.interfaces) {
      if (seenInterfaceIds.has(intf.interfaceId)) {
        diagnostics.push({
          id: `MI-DUP-ID-${intf.interfaceId}`,
          tier: 'ERROR',
          code: 'MI_DUPLICATE_INTERFACE_ID',
          model: 'MI',
          elementId: intf.interfaceId,
          messageZh: `MI 接口模型中存在重复的 interfaceId「${intf.interfaceId}」。`,
          messageEn: `Duplicate interfaceId "${intf.interfaceId}" in MI Interface Model.`,
        });
      }
      seenInterfaceIds.add(intf.interfaceId);

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
      if (intf.direction === 'DEPENDENT') {
        if (suite.M5) {
          if (
            !intf.relatedExternalEntityRef ||
            !externalActorIds.has(intf.relatedExternalEntityRef)
          ) {
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
        if (intf.relatedBehaviorRef && suite.M2 && !behaviorIds.has(intf.relatedBehaviorRef)) {
          diagnostics.push({
            id: `MI-DEP-BEH-${intf.interfaceId}`,
            tier: 'ERROR',
            code: 'MI_DANGLING_BEHAVIOR_REF',
            model: 'MI',
            elementId: intf.interfaceId,
            messageZh: `接口「${intf.interfaceId}」关联的行为「${intf.relatedBehaviorRef}」在 M2 中不存在。`,
            messageEn: `Interface "${intf.interfaceId}" relatedBehaviorRef "${intf.relatedBehaviorRef}" does not exist in M2.`,
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
      } else if (intf.relatedEventRef && suite.ME && !eventIds.has(intf.relatedEventRef)) {
        diagnostics.push({
          id: `MI-OPT-EV-${intf.interfaceId}`,
          tier: 'ERROR',
          code: 'MI_DANGLING_EVENT_REF',
          model: 'MI',
          elementId: intf.interfaceId,
          messageZh: `接口「${intf.interfaceId}」关联的事件「${intf.relatedEventRef}」在 ME 中不存在。`,
          messageEn: `Interface "${intf.interfaceId}" relatedEventRef "${intf.relatedEventRef}" does not exist in ME.`,
        });
      }

      if (intf.relatedEntityRef && suite.M1 && !resolveCanonicalAgg(intf.relatedEntityRef)) {
        diagnostics.push({
          id: `MI-ENT-REF-${intf.interfaceId}`,
          tier: 'ERROR',
          code: 'MI_DANGLING_ENTITY_REF',
          model: 'MI',
          elementId: intf.interfaceId,
          messageZh: `接口「${intf.interfaceId}」关联的对象「${intf.relatedEntityRef}」在 M1 中不存在。`,
          messageEn: `Interface "${intf.interfaceId}" relatedEntityRef "${intf.relatedEntityRef}" does not exist in M1.`,
        });
      }

      if (intf.relatedReportRef && suite.M7 && !reportIds.has(intf.relatedReportRef)) {
        diagnostics.push({
          id: `MI-RPT-REF-${intf.interfaceId}`,
          tier: 'ERROR',
          code: 'MI_DANGLING_REPORT_REF',
          model: 'MI',
          elementId: intf.interfaceId,
          messageZh: `接口「${intf.interfaceId}」关联的查询报表「${intf.relatedReportRef}」在 M7 中不存在。`,
          messageEn: `Interface "${intf.interfaceId}" relatedReportRef "${intf.relatedReportRef}" does not exist in M7.`,
        });
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
