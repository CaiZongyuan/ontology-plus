import yaml from 'js-yaml';
import {
  M1ObjectModelSchema,
  M2BehaviorModelSchema,
  M3RuleModelSchema,
  MEEventModelSchema,
  M4ScenarioModelSchema,
  M5ActorModelSchema,
  M6FlowModelSchema,
  M7ReportModelSchema,
  MUUiModelSchema,
  MMMappingModelSchema,
  MIInterfaceModelSchema,
  ManifestSchema,
  MODEL_CODES,
  MODEL_FILE_NAMES,
  type InterfaceFieldSpecInput,
  type ModelCode,
  type OntologyManifest,
  type OntologySuite,
} from './types.js';

const MODEL_SCHEMAS = {
  M1: M1ObjectModelSchema,
  M2: M2BehaviorModelSchema,
  M3: M3RuleModelSchema,
  ME: MEEventModelSchema,
  M4: M4ScenarioModelSchema,
  M5: M5ActorModelSchema,
  M6: M6FlowModelSchema,
  M7: M7ReportModelSchema,
  MU: MUUiModelSchema,
  MM: MMMappingModelSchema,
  MI: MIInterfaceModelSchema,
} as const;

const MODEL_HEADERS: Record<ModelCode, string> = {
  M1: '# M1 对象模型元文件 - m1-object-model.yaml\n',
  M2: '# M2 行为模型元文件 - m2-behavior-model.yaml\n',
  M3: '# M3 规则模型元文件 - m3-rule-model.yaml\n',
  ME: '# ME 事件模型元文件 - me-event-model.yaml\n',
  M4: '# M4 场景模型元文件 - m4-scenario-model.yaml\n',
  M5: '# M5 主体模型元文件 - m5-actor-model.yaml\n',
  M6: '# M6 流程模型元文件 - m6-flow-model.yaml\n',
  M7: '# M7 查询统计与报表模型元文件 - m7-report-model.yaml\n',
  MU: '# MU UI 模型元文件 - mu-ui-model.yaml\n',
  MM: '# MM 对象-数据表映射模型元文件 - m-mapping-model.yaml\n',
  MI: '# MI 接口模型元文件 - mi-interface-model.yaml\n',
};

type AnyRec = Record<string, any>;

function unwrapRef(val: unknown): string | undefined {
  if (Array.isArray(val)) {
    return val.length > 0 && val[0] != null ? String(val[0]) : undefined;
  }
  return val != null ? String(val) : undefined;
}

function normalizeM1Attribute(attr: AnyRec, dicts: AnyRec[]): AnyRec {
  if (typeof attr === 'string') {
    return { name: attr, label: attr, type: 'String', required: false };
  }
  const out: AnyRec = { ...attr };
  out.name = String(attr.name ?? '');
  out.label = String(attr.label ?? attr.name ?? '');
  if (out.type === 'Reference') {
    out.type = 'AggregateRootRef';
    if (!out.targetAggregate && attr.refEntity) {
      out.targetAggregate = String(attr.refEntity);
    }
  }
  if (out.type === 'DictionaryRef' && !out.dictionaryRef && typeof attr.dictType === 'string') {
    const typeCode = attr.dictType;
    const matchedDict = dicts.find((d) =>
      Array.isArray(d.types) && d.types.some((t: AnyRec) => t.typeCode === typeCode),
    );
    out.dictionaryRef = {
      dictionaryId: String(matchedDict?.id ?? dicts[0]?.id ?? 'DICT-DEFAULT'),
      typeCode,
    };
  }
  if (Array.isArray(out.refRules)) {
    out.refRules = out.refRules.map((r: AnyRec, idx: number) => ({
      ...r,
      name: String(r.name ?? `Rule_${idx + 1}`),
      violationMessage: String(r.violationMessage ?? r.name ?? 'Attribute rule violated'),
      enforcedAt: r.enforcedAt === 'PERSIST' ? 'ALWAYS' : (r.enforcedAt ?? 'ALWAYS'),
    }));
  }
  return out;
}

function normalizeMiField(rawField: AnyRec): InterfaceFieldSpecInput {
  const out: InterfaceFieldSpecInput = {
    name: String(rawField.name ?? ''),
    label: String(rawField.label ?? rawField.name ?? ''),
    type: String(rawField.type ?? rawField.dataType ?? 'String'),
    required: Boolean(rawField.required ?? false),
  };
  const mappedRef = rawField.mappedRef ?? rawField.sourceField;
  if (mappedRef != null) out.mappedRef = String(mappedRef);
  if (Array.isArray(rawField.allowedValues)) {
    out.allowedValues = rawField.allowedValues.map((v: unknown) => String(v));
  }
  if (rawField.description != null) {
    out.description = String(rawField.description);
  }
  if (Array.isArray(rawField.fields)) {
    out.fields = rawField.fields.map((child: AnyRec) => normalizeMiField(child));
  }
  return out;
}

/**
 * Normalizes canonical upstream YAML structures from `ontology-plus-framework.md`
 * (Chapters 2–12) and `references/Onto-Model/sample/*.yaml` into our typed AST shape.
 */
export function normalizeRawModelYaml(
  modelCode: ModelCode,
  rawObj: Record<string, unknown>,
): Record<string, unknown> {
  const raw: AnyRec = JSON.parse(JSON.stringify(rawObj));
  if (raw.version != null) {
    raw.version = String(raw.version);
  }

  switch (modelCode) {
    case 'M1': {
      if (raw.model_type === 'AGGREGATE_OBJECT' || !raw.model_type) {
        raw.model_type = 'OBJECT';
      }
      const dicts: AnyRec[] = Array.isArray(raw.data_dictionaries)
        ? raw.data_dictionaries.map((d: AnyRec) => ({
            ...d,
            id: String(d.id ?? d.dictId ?? ''),
            name: String(d.name ?? d.dictName ?? d.id ?? d.dictId ?? ''),
          }))
        : [];
      raw.data_dictionaries = dicts;

      const aggs: AnyRec[] = Array.isArray(raw.aggregates)
        ? raw.aggregates.map((agg: AnyRec) => {
            const out: AnyRec = { ...agg };
            if (agg.rootEntity && typeof agg.rootEntity === 'object') {
              const root = agg.rootEntity as AnyRec;
              out.name = String(agg.alias ?? root.alias ?? agg.name ?? agg.id);
              out.alias = String(agg.name ?? root.name ?? out.name);
              out.lifecycle = Array.isArray(agg.lifecycle)
                ? agg.lifecycle
                : Array.isArray(root.lifecycle)
                  ? root.lifecycle.map(String)
                  : [];
              out.attributes = Array.isArray(agg.attributes)
                ? agg.attributes
                : Array.isArray(root.attributes)
                  ? root.attributes
                  : [];
              const compMap = new Map<string, AnyRec>();
              if (Array.isArray(root.compositions)) {
                for (const c of root.compositions) {
                  if (c?.targetEntity) compMap.set(String(c.targetEntity), c);
                }
              }
              if (!Array.isArray(out.entities) && Array.isArray(agg.internalEntities)) {
                out.entities = agg.internalEntities.map((ie: AnyRec) => {
                  const comp = compMap.get(String(ie.alias ?? ie.name));
                  return {
                    ...ie,
                    name: String(ie.alias ?? ie.name),
                    alias: String(ie.name ?? ie.alias),
                    cardinality: comp?.cardinality ?? ie.cardinality ?? 'ONE_OR_MORE',
                  };
                });
              }
            } else {
              out.name = String(agg.name ?? agg.alias ?? agg.id);
              out.alias = String(agg.alias ?? agg.name ?? agg.id);
            }

            out.attributes = Array.isArray(out.attributes)
              ? out.attributes.map((a: AnyRec) => normalizeM1Attribute(a, dicts))
              : [];

            out.entities = Array.isArray(out.entities)
              ? out.entities.map((ent: AnyRec) => {
                  const normAttrs = Array.isArray(ent.attributes)
                    ? ent.attributes.map((a: AnyRec) => normalizeM1Attribute(a, dicts))
                    : [];
                  return {
                    ...ent,
                    name: String(ent.name ?? ent.alias ?? ''),
                    alias: String(ent.alias ?? ent.name ?? ''),
                    localId: String(ent.localId ?? normAttrs[0]?.name ?? 'id'),
                    attributes: normAttrs,
                  };
                })
              : [];

            out.valueObjects = Array.isArray(out.valueObjects)
              ? out.valueObjects.map((vo: AnyRec) => ({
                  ...vo,
                  name: String(vo.name ?? vo.alias ?? ''),
                  alias: String(vo.alias ?? vo.name ?? ''),
                  attributes: Array.isArray(vo.attributes)
                    ? vo.attributes.map((a: AnyRec) => normalizeM1Attribute(a, dicts))
                    : [],
                }))
              : [];

            const rawInvs = Array.isArray(out.invariants)
              ? out.invariants
              : Array.isArray(agg.aggregateConstraints)
                ? agg.aggregateConstraints
                : [];
            out.invariants = rawInvs.map((inv: AnyRec, idx: number) => ({
              ...inv,
              name: String(inv.name ?? `Invariant_${idx + 1}`),
              violationMessage: String(inv.violationMessage ?? inv.name ?? 'Invariant violated'),
              enforcedAt: inv.enforcedAt === 'PERSIST' ? 'ALWAYS' : (inv.enforcedAt ?? 'ALWAYS'),
            }));

            return out;
          })
        : [];

      if (Array.isArray(raw.masterEntities)) {
        const existingNames = new Set(aggs.flatMap((a) => [a.id, a.name, a.alias]));
        for (const me of raw.masterEntities) {
          const alias = String(me.alias ?? me.name ?? '');
          if (!alias || existingNames.has(alias)) continue;
          aggs.push({
            id: String(me.id ?? `AGG-${alias.toUpperCase()}`),
            name: alias,
            alias: String(me.name ?? alias),
            aggregateType: 'AGGREGATE_ROOT',
            attributes: Array.isArray(me.attributes)
              ? me.attributes.map((a: AnyRec) => normalizeM1Attribute(a, dicts))
              : [],
            entities: [],
            valueObjects: [],
            invariants: [],
          });
        }
      }
      raw.aggregates = aggs;
      return raw;
    }

    case 'M2': {
      if (Array.isArray(raw.behaviors)) {
        raw.behaviors = raw.behaviors.map((b: AnyRec) => {
          const out: AnyRec = { ...b };
          out.id = String(b.id ?? b.behaviorId ?? '');
          out.ownerEntity = String(b.ownerEntity ?? b.owner ?? b.ownerObject ?? '');
          out.alias = String(b.alias ?? b.name ?? out.id);

          if (out.invokedRules === undefined && Array.isArray(b.appliedRules)) {
            out.invokedRules = b.appliedRules.map(String);
          }

          if (out.producedEvents === undefined && Array.isArray(b.emittedEvents)) {
            out.producedEvents = b.emittedEvents.map((e: unknown) =>
              typeof e === 'string' ? e : e,
            );
          }

          if (out.inputParameters === undefined && Array.isArray(b.inputParams)) {
            out.inputParameters = b.inputParams.map((p: AnyRec) => {
              if (Array.isArray(p)) {
                return { name: String(p[0]), type: String(p[1] ?? 'String'), required: false };
              }
              return {
                name: String(p.name),
                label: p.label != null ? String(p.label) : undefined,
                type: String(p.type ?? 'String'),
                required: Boolean(p.required ?? false),
                description: p.description != null ? String(p.description) : undefined,
              };
            });
          }

          if (out.outputParameters === undefined && Array.isArray(b.outputParams)) {
            out.outputParameters = b.outputParams.map((p: AnyRec) => {
              if (Array.isArray(p)) {
                return { name: String(p[0]), type: String(p[1] ?? 'String'), required: false };
              }
              return {
                name: String(p.name),
                label: p.label != null ? String(p.label) : undefined,
                type: String(p.type ?? 'String'),
                required: Boolean(p.required ?? false),
              };
            });
          }

          if (Array.isArray(b.preconditions)) {
            out.preconditions = b.preconditions.map((pre: unknown, idx: number) => {
              if (typeof pre === 'string') {
                return { name: `Precondition_${idx + 1}`, expression: pre };
              }
              return pre;
            });
          }

          if (out.stateChanges === undefined && Array.isArray(b.postconditions)) {
            out.stateChanges = b.postconditions.map((post: AnyRec) => {
              if (typeof post === 'string') {
                return {
                  targetField: String(b.ownerEntity ?? 'state'),
                  changeType: 'SET',
                  expression: post,
                };
              }
              return {
                targetField: String(post.targetField ?? post.field ?? ''),
                changeType: post.changeType ?? 'SET',
                expression: String(post.expression ?? post.setValue ?? ''),
                ...(post.description != null ? { description: String(post.description) } : {}),
              };
            });
          }

          return out;
        });
      }
      return raw;
    }

    case 'M3': {
      if (Array.isArray(raw.rules)) {
        raw.rules = raw.rules.map((r: AnyRec) => {
          const out: AnyRec = { ...r };
          out.id = String(r.id ?? r.ruleId ?? '');
          out.alias = String(r.alias ?? r.name ?? out.id);
          if (out.version != null) out.version = String(out.version);

          if (out.parameters === undefined && Array.isArray(r.inputParams)) {
            out.parameters = r.inputParams.map((p: AnyRec) => ({
              name: String(p.name),
              type: String(p.type ?? 'String'),
              ...(p.source != null || p.sourceField != null
                ? { source: String(p.source ?? p.sourceField) }
                : {}),
              ...(p.sourceField != null ? { sourceField: String(p.sourceField) } : {}),
              ...(p.required != null ? { required: Boolean(p.required) } : {}),
              ...(p.description != null ? { description: String(p.description) } : {}),
            }));
          }

          if (out.triggeredByEvents === undefined && Array.isArray(r.subscribedEvents)) {
            out.triggeredByEvents = r.subscribedEvents.map(String);
          }

          if (Array.isArray(r.triggeredBehaviors)) {
            out.triggeredBehaviors = r.triggeredBehaviors.map((tb: unknown) => {
              if (typeof tb === 'string') {
                return { behaviorRef: tb };
              }
              return tb;
            });
          }

          if (out.expression === undefined) {
            out.expression = String(
              r.conditionExpression ??
                (r.externalEngine ? `EXTERNAL(${String(r.externalEngine)})` : ''),
            );
          }

          if (out.ruleType === 'EVENT_DRIVEN' && out.scope === undefined) {
            out.scope = 'EVENT_DRIVEN';
          }

          return out;
        });
      }
      return raw;
    }

    case 'ME': {
      if (Array.isArray(raw.events)) {
        raw.events = raw.events.map((ev: AnyRec) => {
          const out: AnyRec = { ...ev };
          const id = String(ev.id ?? ev.eventId ?? '');
          const candidateName =
            ev.name != null
              ? String(ev.name)
              : ev.eventId != null && String(ev.eventId).includes('.')
                ? String(ev.eventId)
                : undefined;
          const srcAgg = String(
            ev.sourceAggregate ??
              ev.sourceObject ??
              ev.producerEntityRef ??
              (candidateName ? candidateName.split('.')[0] : 'Domain'),
          );
          const name = candidateName ?? `${srcAgg}.${id.replace(/[^A-Za-z0-9_]/g, '_')}`;
          out.id = id;
          out.name = name;
          out.label = String(ev.label ?? ev.alias ?? ev.eventName ?? name);
          out.sourceAggregate = srcAgg;
          out.producerBehaviorRef = String(ev.producerBehaviorRef ?? '');
          if (ev.version != null) out.version = String(ev.version);
          if (out.orderingSemantic === undefined && ev.ordering != null) {
            out.orderingSemantic = String(ev.ordering);
          }

          if (Array.isArray(ev.payload)) {
            out.payload = ev.payload.map((f: AnyRec) => {
              if (typeof f === 'string') {
                return { name: f, label: f, type: 'String', required: true };
              }
              return {
                ...f,
                name: String(f.name),
                type: String(f.type ?? f.dataType ?? 'String'),
              };
            });
          }

          if (out.subscribers === undefined && Array.isArray(ev.subscriberBehaviorRefs)) {
            out.subscribers = ev.subscriberBehaviorRefs.map((bRef: unknown) => ({
              subscriberType: 'BEHAVIOR',
              subscriberRef: String(bRef),
              deliveryMode: 'ASYNC',
            }));
          } else if (Array.isArray(ev.subscribers)) {
            out.subscribers = ev.subscribers.map((sub: AnyRec) => {
              const sOut: AnyRec = { ...sub };
              sOut.subscriberType =
                sub.subscriberType ?? (sub.subscriberRuleRef ? 'RULE' : 'BEHAVIOR');
              sOut.subscriberRef = String(
                sub.subscriberRef ?? sub.subscriberBehaviorRef ?? sub.subscriberRuleRef ?? '',
              );
              if (sOut.condition === undefined && sub.filterCondition != null) {
                sOut.condition = String(sub.filterCondition);
              }
              return sOut;
            });
          }

          return out;
        });
      }
      return raw;
    }

    case 'M4': {
      const rawScenarios: AnyRec[] = Array.isArray(raw.event_scenarios)
        ? raw.event_scenarios
        : Array.isArray(raw.use_cases)
          ? raw.use_cases
          : [];
      raw.event_scenarios = rawScenarios.map((sc: AnyRec) => {
        const out: AnyRec = { ...sc };
        out.id = String(sc.id ?? sc.scenarioId ?? '');
        const rawSteps: AnyRec[] = Array.isArray(sc.steps)
          ? sc.steps
          : Array.isArray(sc.primaryFlow)
            ? sc.primaryFlow
            : [];
        const steps = rawSteps.map((st: AnyRec, idx: number) => {
          const stOut: AnyRec = { ...st };
          stOut.stepOrder = typeof st.stepOrder === 'number' ? st.stepOrder : idx + 1;
          stOut.stepType = st.stepType === 'EVENT_WAIT' ? 'EVENT_EMIT' : st.stepType;
          stOut.refId = String(
            st.refId ?? st.behaviorRef ?? st.eventRef ?? st.ruleRef ?? st.waitForEvent ?? '',
          );
          if (Array.isArray(st.nextSteps)) {
            stOut.nextSteps = st.nextSteps.map(String);
          }
          return stOut;
        });
        out.steps = steps;

        if (
          (!Array.isArray(out.involvedAggregates) || out.involvedAggregates.length === 0) &&
          (sc.sourceObjectRef || Array.isArray(sc.targetObjectRefs))
        ) {
          const aggs = new Set<string>();
          if (sc.sourceObjectRef) aggs.add(String(sc.sourceObjectRef));
          if (Array.isArray(sc.targetObjectRefs)) {
            for (const t of sc.targetObjectRefs) {
              if (t != null) aggs.add(String(t));
            }
          }
          out.involvedAggregates = [...aggs];
        }

        if (!out.triggerEventRef) {
          const firstEventStep = steps.find((s) => s.stepType === 'EVENT_EMIT');
          out.triggerEventRef = firstEventStep?.refId ?? '';
        }

        return out;
      });
      return raw;
    }

    case 'M5': {
      if (Array.isArray(raw.actors)) {
        raw.actors = raw.actors.map((a: AnyRec) => {
          const out: AnyRec = { ...a };
          out.id = String(a.id ?? a.actorId ?? '');
          if (out.actorType === 'EXTERNAL') {
            out.actorType = 'EXTERNAL_ENTITY';
          }
          if (a.attributes && typeof a.attributes === 'object') {
            const attrMap: Record<string, string> = {};
            for (const [k, v] of Object.entries(a.attributes)) {
              if (v != null) attrMap[k] = String(v);
            }
            out.attributes = attrMap;
          }
          if (a.externalContract && typeof a.externalContract === 'object') {
            const ec: AnyRec = { ...a.externalContract };
            if (ec.format === undefined && ec.dataFormat != null) {
              ec.format = String(ec.dataFormat);
            }
            if (ec.authType === undefined && ec.authMethod != null) {
              ec.authType = String(ec.authMethod);
            }
            out.externalContract = ec;
          }
          return out;
        });
      }

      if (Array.isArray(raw.roles)) {
        raw.roles = raw.roles.map((r: AnyRec) => {
          const out: AnyRec = { ...r };
          out.id = String(r.id ?? r.roleId ?? '');
          out.code = String(r.code ?? out.id);
          if (out.dataScope === 'DEPT') out.dataScope = 'DEPARTMENT';
          if (out.dataScope === 'OWN') out.dataScope = 'SELF';
          return out;
        });
      }

      if (Array.isArray(raw.permissionGroups)) {
        raw.permissionGroups = raw.permissionGroups.map((pg: AnyRec) => ({
          ...pg,
          id: String(pg.id ?? pg.groupId ?? ''),
          name: String(pg.name ?? pg.id ?? pg.groupId ?? ''),
        }));
      }

      if (Array.isArray(raw.permissions)) {
        raw.permissions = raw.permissions.map((p: AnyRec) => {
          const out: AnyRec = { ...p };
          out.id = String(p.id ?? p.permissionId ?? '');
          out.name = String(p.name ?? out.id);
          out.code = String(p.code ?? out.id);
          if (out.dataScope === 'DEPT') out.dataScope = 'DEPARTMENT';
          if (out.dataScope === 'OWN') out.dataScope = 'SELF';
          if (out.allowedBehaviors === undefined) {
            out.allowedBehaviors =
              p.targetType === 'BEHAVIOR' && p.targetRef ? [String(p.targetRef)] : [];
          }
          if (!out.targetAggregate) {
            if (p.targetType === 'ENTITY' && p.targetRef) {
              out.targetAggregate = String(p.targetRef);
            } else if (p.targetRef) {
              out.targetAggregate = String(p.targetRef).split('_')[0];
            } else {
              out.targetAggregate = '';
            }
          }
          return out;
        });
      }
      return raw;
    }

    case 'M6': {
      if (Array.isArray(raw.flows)) {
        raw.flows = raw.flows.map((f: AnyRec) => {
          const out: AnyRec = { ...f };
          out.id = String(f.id ?? f.flowId ?? '');
          if (!out.primaryAggregate) {
            out.primaryAggregate = String(f.businessObjectRefs?.[0] ?? '');
          }
          if (f.version != null) out.version = String(f.version);
          const trig: AnyRec =
            f.trigger && typeof f.trigger === 'object'
              ? { ...f.trigger }
              : { triggerType: 'USER_ACTION' };
          if (!trig.refId && (trig.behaviorRef || trig.eventRef)) {
            trig.refId = String(trig.behaviorRef ?? trig.eventRef);
          }
          out.trigger = trig;

          if (Array.isArray(f.activities)) {
            out.activities = f.activities.map((act: AnyRec) => {
              const aOut: AnyRec = { ...act };
              aOut.id = String(act.id ?? act.activityId ?? '');
              if (
                aOut.nextActivity === undefined &&
                Array.isArray(act.nextActivities) &&
                act.nextActivities.length === 1
              ) {
                aOut.nextActivity = String(act.nextActivities[0]);
              }
              if (act.conditionExpression === null) {
                delete aOut.conditionExpression;
              }
              if (Array.isArray(act.branches)) {
                aOut.branches = act.branches.map((br: AnyRec) => {
                  const bOut: AnyRec = { ...br };
                  if (br.conditionExpression === null) {
                    delete bOut.conditionExpression;
                  } else if (bOut.condition === undefined && typeof br.conditionExpression === 'string') {
                    bOut.condition = br.conditionExpression;
                  }
                  if (bOut.label === undefined && br.branchName != null) {
                    bOut.label = String(br.branchName);
                  }
                  return bOut;
                });
              }
              return aOut;
            });
          }
          return out;
        });
      }
      return raw;
    }

    case 'M7': {
      const rawReports: AnyRec[] | undefined = Array.isArray(raw.query_reports)
        ? raw.query_reports
        : Array.isArray(raw.reports)
          ? raw.reports
          : undefined;
      if (rawReports) {
        raw.query_reports = rawReports.map((qr: AnyRec) => {
          const out: AnyRec = { ...qr };
          out.id = String(qr.id ?? qr.reportId ?? qr.queryId ?? '');
          out.alias = String(qr.alias ?? qr.name ?? out.id);
          if (!out.queryType && (qr.reportType || qr.objectType)) {
            const rawQt = String(qr.reportType ?? qr.objectType);
            out.queryType = rawQt === 'QUERY' ? 'LIST_QUERY' : rawQt;
          }

          const srcMap = new Map<string, AnyRec>();
          if (Array.isArray(qr.sourceObjects)) {
            for (const s of qr.sourceObjects) {
              if (s?.alias) srcMap.set(String(s.alias), s);
            }
          }

          if (!out.primarySource && Array.isArray(qr.sourceObjects) && qr.sourceObjects.length > 0) {
            const primary =
              qr.sourceObjects.find((s: AnyRec) => s.primary === true) ?? qr.sourceObjects[0];
            out.primarySource = {
              aggregateRef: String(primary.objectRef ?? ''),
              alias: String(primary.alias ?? 't0'),
            };
          }

          if (Array.isArray(qr.joins)) {
            out.joins = qr.joins.map((j: AnyRec) => {
              const jOut: AnyRec = { ...j };
              if (typeof j.joinType === 'string') {
                jOut.joinType = j.joinType.replace(/_JOIN$/i, '').toUpperCase();
              }
              const alias = String(j.alias ?? j.rightSource ?? j.joinId ?? 'j');
              const srcObj = srcMap.get(alias);
              jOut.alias = alias;
              jOut.aggregateRef = String(j.aggregateRef ?? srcObj?.objectRef ?? j.rightSource ?? '');
              jOut.onCondition = String(j.onCondition ?? j.conditionExpression ?? '');
              if (jOut.preAggregated === undefined && srcObj?.preAggregation) {
                jOut.preAggregated = true;
              }
              return jOut;
            });
          }

          if (Array.isArray(qr.parameters)) {
            out.parameters = qr.parameters.map((p: AnyRec) => ({
              ...p,
              name: String(p.name),
              label: String(p.label ?? p.name),
              type: String(p.type ?? p.dataType ?? 'String'),
            }));
          }

          if (Array.isArray(qr.conditions)) {
            out.conditions = qr.conditions.map((c: AnyRec) => ({
              ...c,
              field: String(c.field ?? c.leftExpression ?? ''),
              operator: String(c.operator ?? '='),
              ...(c.parameterRef == null ? { parameterRef: undefined } : {}),
            }));
          }

          const rawCols: AnyRec[] | undefined = Array.isArray(qr.resultColumns)
            ? qr.resultColumns
            : Array.isArray(qr.selectFields)
              ? qr.selectFields
              : undefined;
          if (rawCols) {
            out.resultColumns = rawCols.map((col: AnyRec) => {
              const colName = String(col.name ?? col.fieldName ?? '');
              return {
                ...col,
                name: colName,
                label: String(col.label ?? colName),
                sourceExpr: String(
                  col.sourceExpr ?? col.sourceExpression ?? col.expression ?? colName,
                ),
                dataType: String(col.dataType ?? col.type ?? 'String'),
                ...(col.aggregation === undefined && col.aggregateFunction != null
                  ? { aggregation: String(col.aggregateFunction) }
                  : {}),
              };
            });
          }

          if (Array.isArray(qr.orderBy)) {
            out.orderBy = qr.orderBy.map((o: AnyRec) => ({
              field: String(o.field ?? o.expression ?? ''),
              direction: o.direction ?? 'DESC',
            }));
          }

          if (qr.reportOptions === null) {
            delete out.reportOptions;
          } else if (qr.reportOptions && typeof qr.reportOptions === 'object') {
            const ro: AnyRec = { ...qr.reportOptions };
            for (const k of Object.keys(ro)) {
              if (ro[k] === null) delete ro[k];
            }
            out.reportOptions = ro;
          }

          if (qr.referenceSql && typeof qr.referenceSql === 'object') {
            const rs: AnyRec = { ...qr.referenceSql };
            if (rs.parameterMappings === undefined && Array.isArray(rs.parameterBindings)) {
              rs.parameterMappings = rs.parameterBindings.map((pb: AnyRec) =>
                typeof pb === 'string' ? pb : String(pb.parameter ?? ''),
              );
            }
            if (Array.isArray(rs.resultMappings)) {
              rs.resultMappings = rs.resultMappings.map((rm: AnyRec) =>
                typeof rm === 'string' ? rm : String(rm.resultColumn ?? rm.sqlColumn ?? ''),
              );
            }
            out.referenceSql = rs;
          } else if (!out.referenceSql && typeof qr.sqlTemplate === 'string') {
            out.referenceSql = {
              dialect: 'SQLite',
              sql: qr.sqlTemplate,
              parameterMappings: [],
              resultMappings: [],
            };
          }

          return out;
        });
      }
      return raw;
    }

    case 'MU': {
      const navEdges: AnyRec[] = Array.isArray(raw.navigation_edges)
        ? [...raw.navigation_edges]
        : [];
      if (Array.isArray(raw.screens)) {
        raw.screens = raw.screens.map((sc: AnyRec) => {
          const sOut: AnyRec = { ...sc };
          const elements: AnyRec[] = Array.isArray(sc.elements)
            ? sc.elements.map((el: AnyRec) => {
                const eOut: AnyRec = { ...el };
                const elementId = String(el.elementId ?? el.id ?? '');
                eOut.elementId = elementId;
                eOut.name = String(el.name ?? elementId);
                eOut.label = String(el.label ?? el.name ?? elementId);
                eOut.elementType = String(el.elementType ?? el.type ?? 'INPUT');
                if (el.io === 'I') eOut.io = 'IN';
                else if (el.io === 'O' || el.io === 'STATIC') eOut.io = 'OUT';
                else if (el.io === 'I_O') eOut.io = 'IN_OUT';
                if (Array.isArray(el.permissionRef)) {
                  eOut.permissionRef = unwrapRef(el.permissionRef);
                }
                return eOut;
              })
            : [];
          sOut.elements = elements;

          if (Array.isArray(sc.navigation)) {
            sc.navigation.forEach((nav: AnyRec, idx: number) => {
              navEdges.push({
                id: String(nav.id ?? `NAV-${sc.screenId}-${idx + 1}`),
                fromScreen: String(sc.screenId),
                toScreen: String(nav.to ?? nav.toScreen ?? ''),
                ...(nav.condition != null ? { condition: String(nav.condition) } : {}),
                mode: nav.mode ?? 'PUSH',
              });
            });
          }

          if (Array.isArray(sc.events)) {
            sOut.events = sc.events.map((ev: AnyRec) => {
              const evOut: AnyRec = { ...ev };
              if (!evOut.triggerElementId) {
                const evParts = String(ev.eventId ?? '').split('.');
                const guessedFromId =
                  evParts.length >= 2 ? evParts[1].split('_')[0] : undefined;
                const matchedEl = elements.find((e) => e.elementId === guessedFromId);
                evOut.triggerElementId = String(
                  matchedEl?.elementId ?? elements[0]?.elementId ?? '',
                );
              }
              if (Array.isArray(ev.callChain)) {
                evOut.callChain = ev.callChain.map((st: AnyRec, idx: number) => {
                  const stOut: AnyRec = { ...st };
                  const stepType = String(st.stepType ?? st.step ?? 'BEHAVIOR_CALL');
                  const rules = Array.isArray(st.rules) ? st.rules.map(String) : undefined;
                  const targets = Array.isArray(st.targets) ? st.targets.map(String) : undefined;
                  stOut.stepOrder = typeof st.stepOrder === 'number' ? st.stepOrder : idx + 1;
                  stOut.stepType = stepType;
                  stOut.refId = String(
                    st.refId ??
                      rules?.[0] ??
                      st.behaviorRef ??
                      st.eventRef ??
                      st.scenarioRef ??
                      st.reportRef ??
                      st.queryRef ??
                      st.to ??
                      targets?.[0] ??
                      stepType,
                  );
                  if (rules) stOut.rules = rules;
                  if (targets) stOut.targets = targets;
                  return stOut;
                });
              }
              return evOut;
            });
          }
          return sOut;
        });
      }
      raw.navigation_edges = navEdges;

      if (raw.cross_cutting_ui === undefined && Array.isArray(raw.cross_cutting)) {
        raw.cross_cutting_ui = raw.cross_cutting.map((cc: AnyRec) => ({
          ...cc,
          type:
            cc.type ??
            (Array.isArray(cc.shortcuts)
              ? 'SHORTCUT'
              : String(cc.id ?? '').includes('IDLE') || String(cc.id ?? '').includes('TIMEOUT')
                ? 'TIMEOUT'
                : 'GLOBAL_GUARD'),
          scopeScreens: Array.isArray(cc.scopeScreens)
            ? cc.scopeScreens.map(String)
            : Array.isArray(cc.appliesTo)
              ? cc.appliesTo.map(String)
              : [],
        }));
      }
      return raw;
    }

    case 'MM': {
      if (Array.isArray(raw.mappings)) {
        raw.mappings = raw.mappings.map((mp: AnyRec) => ({
          ...mp,
          id: String(mp.id ?? mp.mappingId ?? ''),
        }));
      }
      return raw;
    }

    case 'MI': {
      if (Array.isArray(raw.interfaces)) {
        raw.interfaces = raw.interfaces.map((intf: AnyRec) => {
          const out: AnyRec = { ...intf };
          const contract =
            intf.contract && typeof intf.contract === 'object' ? (intf.contract as AnyRec) : {};
          out.direction = String(intf.direction ?? intf.interfaceType ?? 'PROVIDED');
          if (!out.interfaceCategory && intf.category) {
            out.interfaceCategory = String(intf.category);
          }
          if (!out.protocol && contract.protocol) out.protocol = String(contract.protocol);
          if (!out.format && (intf.dataFormat || contract.dataFormat)) {
            out.format = String(intf.dataFormat ?? contract.dataFormat);
          }
          if (!out.authMethod && contract.authMethod) out.authMethod = String(contract.authMethod);
          if (out.timeoutMs === undefined && typeof contract.timeoutMs === 'number') {
            out.timeoutMs = contract.timeoutMs;
          }
          if (!out.idempotency && contract.idempotency) {
            out.idempotency = String(contract.idempotency);
          }

          if (intf.relatedBehaviorRef !== undefined) {
            out.relatedBehaviorRef = unwrapRef(intf.relatedBehaviorRef);
          }
          if (intf.relatedEntityRef !== undefined) {
            out.relatedEntityRef = unwrapRef(intf.relatedEntityRef);
          }
          if (intf.relatedReportRef !== undefined) {
            out.relatedReportRef = unwrapRef(intf.relatedReportRef);
          }
          if (intf.relatedEventRef !== undefined) {
            out.relatedEventRef = unwrapRef(intf.relatedEventRef);
          }
          if (intf.relatedExternalEntityRef !== undefined) {
            out.relatedExternalEntityRef = unwrapRef(intf.relatedExternalEntityRef);
          }

          if (out.inputFields === undefined && Array.isArray(intf.inputParameters)) {
            out.inputFields = intf.inputParameters.map((f: AnyRec) => normalizeMiField(f));
          } else if (Array.isArray(out.inputFields)) {
            out.inputFields = out.inputFields.map((f: AnyRec) => normalizeMiField(f));
          }

          if (out.outputFields === undefined && Array.isArray(intf.outputResult)) {
            out.outputFields = intf.outputResult.map((f: AnyRec) => normalizeMiField(f));
          } else if (Array.isArray(out.outputFields)) {
            out.outputFields = out.outputFields.map((f: AnyRec) => normalizeMiField(f));
          }

          if (out.returnRules === undefined && Array.isArray(intf.returnRule)) {
            out.returnRules = intf.returnRule.map((r: AnyRec, idx: number) => {
              if (typeof r === 'string') {
                return { code: `RET_${idx + 1}`, scenario: r, message: r };
              }
              return r;
            });
          }

          return out;
        });
      }
      return raw;
    }
  }
}

export function parseModelYaml<K extends ModelCode>(
  code: K,
  yamlText: string,
): NonNullable<OntologySuite[K]> {
  const raw = yaml.load(yamlText);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Invalid YAML object for model ${code}`);
  }
  const normalized = normalizeRawModelYaml(code, raw as Record<string, unknown>);
  const schema = MODEL_SCHEMAS[code];
  return schema.parse(normalized) as NonNullable<OntologySuite[K]>;
}

export function serializeModelYaml<K extends ModelCode>(
  code: K,
  modelData: NonNullable<OntologySuite[K]>,
): string {
  const header = MODEL_HEADERS[code] ?? '';
  const body = yaml.dump(modelData, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    quotingType: '"',
  });
  return `${header}${body}`;
}

export function parseSuiteFromYamlFiles(
  files: Partial<Record<ModelCode | string, string | { fileName: string; content: string }>>,
): { suite: OntologySuite; parseErrors: { model: ModelCode; message: string }[] } {
  const suite: OntologySuite = {};
  const parseErrors: { model: ModelCode; message: string }[] = [];

  for (const code of MODEL_CODES) {
    const fileName = MODEL_FILE_NAMES[code];
    const rawEntry = files[code] ?? files[fileName];
    const content = typeof rawEntry === 'string' ? rawEntry : rawEntry?.content;
    if (!content || !content.trim()) continue;
    try {
      (suite as Record<string, unknown>)[code] = parseModelYaml(code, content);
    } catch (err) {
      parseErrors.push({
        model: code,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { suite, parseErrors };
}

export function serializeSuiteToYamlFiles(
  suite: OntologySuite,
): Partial<Record<ModelCode, { fileName: string; content: string }>> {
  const out: Partial<Record<ModelCode, { fileName: string; content: string }>> = {};
  for (const code of MODEL_CODES) {
    const modelData = suite[code];
    if (!modelData) continue;
    out[code] = {
      fileName: MODEL_FILE_NAMES[code],
      content: serializeModelYaml(code, modelData as never),
    };
  }
  return out;
}

export function parseManifestJson(jsonText: string): OntologyManifest {
  const parsed = JSON.parse(jsonText) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid manifest.json object');
  }
  return ManifestSchema.parse(parsed);
}

export function serializeManifestJson(manifest: OntologyManifest): string {
  const validated = ManifestSchema.parse(manifest);
  return `${JSON.stringify(validated, null, 2)}\n`;
}
