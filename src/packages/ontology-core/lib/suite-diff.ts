import { formatCallChainSummary } from './mu-diff.js';
import { MODEL_CODES, type ModelCode, type OntologySuite, type UIEvent } from './types.js';

export type SuiteDiffStatus = 'ADDED' | 'REMOVED' | 'MODIFIED';

export type OntologyElementCollection =
  | 'aggregates'
  | 'data_dictionaries'
  | 'aggregate_associations'
  | 'behaviors'
  | 'rules'
  | 'events'
  | 'event_scenarios'
  | 'actors'
  | 'roles'
  | 'permissionGroups'
  | 'permissions'
  | 'flows'
  | 'query_reports'
  | 'screens'
  | 'navigation_edges'
  | 'cross_cutting_ui'
  | 'mappings'
  | 'interfaces';

export type OntologyElementKind =
  | 'aggregate'
  | 'data_dictionary'
  | 'aggregate_association'
  | 'behavior'
  | 'rule'
  | 'event'
  | 'scenario'
  | 'actor'
  | 'role'
  | 'permission_group'
  | 'permission'
  | 'flow'
  | 'query_report'
  | 'screen'
  | 'navigation_edge'
  | 'cross_cutting_ui'
  | 'mapping'
  | 'interface';

export interface SuiteFieldChange {
  field: string;
  before: string;
  after: string;
}

export interface RelatedAggregateRef {
  aggregateId: string;
  name: string;
  displayName: string;
}

export interface OntologyElementDiff {
  modelCode: ModelCode;
  collection: OntologyElementCollection;
  elementKind: OntologyElementKind;
  elementId: string;
  name: string;
  previousName?: string;
  displayName: string;
  previousDisplayName?: string;
  status: SuiteDiffStatus;
  changedFields: SuiteFieldChange[];
  relatedAggregates: RelatedAggregateRef[];
}

export interface OntologyModelDiffSummary {
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  totalChanges: number;
  hasChanges: boolean;
}

export interface OntologyModelDiff {
  modelCode: ModelCode;
  added: OntologyElementDiff[];
  removed: OntologyElementDiff[];
  modified: OntologyElementDiff[];
  changes: OntologyElementDiff[];
  summary: OntologyModelDiffSummary;
}

export interface OntologySuiteDiffSummary {
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  totalChanges: number;
  changedModels: ModelCode[];
  hasChanges: boolean;
}

export interface OntologySuiteDiff {
  hasChanges: boolean;
  summary: OntologySuiteDiffSummary;
  models: Record<ModelCode, OntologyModelDiff>;
  changes: OntologyElementDiff[];
}

type LooseRecord = Record<string, unknown>;

interface CollectionSpec {
  modelCode: ModelCode;
  collection: OntologyElementCollection;
  elementKind: OntologyElementKind;
  idKey: 'id' | 'screenId' | 'interfaceId';
}

const SUITE_COLLECTION_SPECS: readonly CollectionSpec[] = [
  { modelCode: 'M1', collection: 'aggregates', elementKind: 'aggregate', idKey: 'id' },
  { modelCode: 'M1', collection: 'data_dictionaries', elementKind: 'data_dictionary', idKey: 'id' },
  {
    modelCode: 'M1',
    collection: 'aggregate_associations',
    elementKind: 'aggregate_association',
    idKey: 'id',
  },
  { modelCode: 'M2', collection: 'behaviors', elementKind: 'behavior', idKey: 'id' },
  { modelCode: 'M3', collection: 'rules', elementKind: 'rule', idKey: 'id' },
  { modelCode: 'ME', collection: 'events', elementKind: 'event', idKey: 'id' },
  { modelCode: 'M4', collection: 'event_scenarios', elementKind: 'scenario', idKey: 'id' },
  { modelCode: 'M5', collection: 'actors', elementKind: 'actor', idKey: 'id' },
  { modelCode: 'M5', collection: 'roles', elementKind: 'role', idKey: 'id' },
  { modelCode: 'M5', collection: 'permissionGroups', elementKind: 'permission_group', idKey: 'id' },
  { modelCode: 'M5', collection: 'permissions', elementKind: 'permission', idKey: 'id' },
  { modelCode: 'M6', collection: 'flows', elementKind: 'flow', idKey: 'id' },
  { modelCode: 'M7', collection: 'query_reports', elementKind: 'query_report', idKey: 'id' },
  { modelCode: 'MU', collection: 'screens', elementKind: 'screen', idKey: 'screenId' },
  { modelCode: 'MU', collection: 'navigation_edges', elementKind: 'navigation_edge', idKey: 'id' },
  { modelCode: 'MU', collection: 'cross_cutting_ui', elementKind: 'cross_cutting_ui', idKey: 'id' },
  { modelCode: 'MM', collection: 'mappings', elementKind: 'mapping', idKey: 'id' },
  { modelCode: 'MI', collection: 'interfaces', elementKind: 'interface', idKey: 'interfaceId' },
];

const ORDERED_NESTED_ARRAY_FIELDS = new Set<string>([
  'steps',
  'callChain',
  'orderBy',
  'branches',
  'resultColumns',
]);

interface SuiteContextLookup {
  aggregatesByToken: Map<string, RelatedAggregateRef>;
  subObjectOwnerByToken: Map<string, RelatedAggregateRef>;
  subObjectDisplayByToken: Map<string, string>;
  screenNameById: Map<string, string>;
  behaviorOwnerById: Map<string, string>;
  eventSourceById: Map<string, string>;
  reportPrimaryAggById: Map<string, string>;
  scenarioSourceAggById: Map<string, string>;
  uiBoundAggregatesByTarget: Map<string, RelatedAggregateRef[]>;
}

function buildSuiteContextLookup(
  primarySuite: OntologySuite | undefined,
  fallbackSuite: OntologySuite | undefined,
): SuiteContextLookup {
  const aggregatesByToken = new Map<string, RelatedAggregateRef>();
  const subObjectOwnerByToken = new Map<string, RelatedAggregateRef>();
  const subObjectDisplayByToken = new Map<string, string>();
  const screenNameById = new Map<string, string>();
  const behaviorOwnerById = new Map<string, string>();
  const eventSourceById = new Map<string, string>();
  const reportPrimaryAggById = new Map<string, string>();
  const scenarioSourceAggById = new Map<string, string>();
  const uiBoundAggregatesByTarget = new Map<string, RelatedAggregateRef[]>();

  const addUiBound = (targetId: string, ref: RelatedAggregateRef): void => {
    const list = uiBoundAggregatesByTarget.get(targetId) ?? [];
    if (!list.some((item) => item.aggregateId === ref.aggregateId)) {
      list.push(ref);
      uiBoundAggregatesByTarget.set(targetId, list);
    }
  };

  // Index fallback first so primarySuite overwrites with current names when present
  for (const suite of [fallbackSuite, primarySuite]) {
    if (!suite) continue;
    for (const agg of suite.M1?.aggregates ?? []) {
      const ref: RelatedAggregateRef = {
        aggregateId: agg.id,
        name: agg.name,
        displayName: agg.alias || agg.name,
      };
      aggregatesByToken.set(agg.id, ref);
      aggregatesByToken.set(agg.name, ref);

      for (const sub of [...(agg.entities ?? []), ...(agg.valueObjects ?? [])]) {
        const subDisplay = sub.alias || sub.name;
        const qualifiedKey = `${agg.name}.${sub.name}`;
        subObjectOwnerByToken.set(sub.name, ref);
        subObjectOwnerByToken.set(qualifiedKey, ref);
        subObjectDisplayByToken.set(sub.name, subDisplay);
        subObjectDisplayByToken.set(qualifiedKey, subDisplay);
      }
    }
    for (const screen of suite.MU?.screens ?? []) {
      screenNameById.set(screen.screenId, screen.name || screen.screenId);
    }
    for (const beh of suite.M2?.behaviors ?? []) {
      if (beh.ownerEntity) behaviorOwnerById.set(beh.id, beh.ownerEntity);
    }
    for (const ev of suite.ME?.events ?? []) {
      if (ev.sourceAggregate) eventSourceById.set(ev.id, ev.sourceAggregate);
    }
    for (const qr of suite.M7?.query_reports ?? []) {
      if (qr.primarySource?.aggregateRef) {
        reportPrimaryAggById.set(qr.id, qr.primarySource.aggregateRef);
      }
    }
    for (const sc of suite.M4?.event_scenarios ?? []) {
      const src = sc.sourceObjectRef || sc.involvedAggregates?.[0];
      if (src) scenarioSourceAggById.set(sc.id, src);
    }
  }

  // Populate M1 -> UI reverse bindings using primarySuite first (then fallback)
  for (const suite of [primarySuite, fallbackSuite]) {
    for (const agg of suite?.M1?.aggregates ?? []) {
      const ref = aggregatesByToken.get(agg.id) ?? {
        aggregateId: agg.id,
        name: agg.name,
        displayName: agg.alias || agg.name,
      };
      for (const target of agg.uiBindings ?? []) {
        addUiBound(target, ref);
      }
      for (const attr of agg.attributes ?? []) {
        for (const target of attr.uiBindings ?? []) {
          addUiBound(target, ref);
        }
      }
    }
  }

  return {
    aggregatesByToken,
    subObjectOwnerByToken,
    subObjectDisplayByToken,
    screenNameById,
    behaviorOwnerById,
    eventSourceById,
    reportPrimaryAggById,
    scenarioSourceAggById,
    uiBoundAggregatesByTarget,
  };
}

function resolveAggregateToken(
  ctx: SuiteContextLookup,
  rawToken: unknown,
  allowUnresolvedFallback = true,
): RelatedAggregateRef | undefined {
  if (typeof rawToken !== 'string') return undefined;
  const trimmed = rawToken.trim();
  if (!trimmed) return undefined;

  const direct = ctx.aggregatesByToken.get(trimmed) ?? ctx.subObjectOwnerByToken.get(trimmed);
  if (direct) return direct;

  const root = trimmed.split(/[.[]/)[0]?.trim() ?? '';
  if (!root) return undefined;

  const byRoot = ctx.aggregatesByToken.get(root) ?? ctx.subObjectOwnerByToken.get(root);
  if (byRoot) return byRoot;

  return allowUnresolvedFallback
    ? { aggregateId: root, name: root, displayName: root }
    : undefined;
}

function collectInterfaceFieldMappedRefs(fields: unknown, out: string[]): void {
  if (!Array.isArray(fields)) return;
  for (const f of fields) {
    if (!isPlainObject(f)) continue;
    if (typeof f.mappedRef === 'string' && /[.[]/.test(f.mappedRef)) {
      out.push(f.mappedRef);
    }
    if (Array.isArray(f.fields)) {
      collectInterfaceFieldMappedRefs(f.fields, out);
    }
  }
}

function resolveRelatedAggregates(
  el: LooseRecord,
  spec: CollectionSpec,
  elementId: string,
  ctx: SuiteContextLookup,
): RelatedAggregateRef[] {
  const result: RelatedAggregateRef[] = [];
  const seenIds = new Set<string>();

  const pushRef = (ref: RelatedAggregateRef | undefined): void => {
    if (!ref || seenIds.has(ref.aggregateId)) return;
    seenIds.add(ref.aggregateId);
    result.push(ref);
  };

  const pushToken = (token: unknown, allowUnresolved = true): void => {
    pushRef(resolveAggregateToken(ctx, token, allowUnresolved));
  };

  const pushTokenList = (tokens: unknown): void => {
    if (!Array.isArray(tokens)) return;
    for (const token of tokens) pushToken(token);
  };

  switch (spec.elementKind) {
    case 'aggregate': {
      const name = String(el.name ?? elementId);
      pushRef(
        ctx.aggregatesByToken.get(elementId) ?? {
          aggregateId: elementId,
          name,
          displayName: String(el.alias || name),
        },
      );
      break;
    }
    case 'aggregate_association': {
      pushToken(el.sourceAggregate);
      pushToken(el.targetAggregate);
      break;
    }
    case 'behavior': {
      pushToken(el.ownerEntity);
      break;
    }
    case 'rule': {
      pushTokenList(el.referencedObjects);
      break;
    }
    case 'event': {
      pushToken(el.sourceAggregate);
      if (Array.isArray(el.subscribers)) {
        for (const sub of el.subscribers) {
          if (isPlainObject(sub) && sub.subscriberEntityRef) {
            pushToken(sub.subscriberEntityRef);
          }
        }
      }
      break;
    }
    case 'scenario': {
      pushToken(el.sourceObjectRef);
      pushTokenList(el.targetObjectRefs);
      pushTokenList(el.involvedAggregates);
      if (Array.isArray(el.steps)) {
        for (const step of el.steps) {
          if (isPlainObject(step)) pushToken(step.targetAggregate);
        }
      }
      break;
    }
    case 'permission': {
      pushToken(el.targetAggregate);
      break;
    }
    case 'flow': {
      pushToken(el.primaryAggregate);
      pushTokenList(el.businessObjectRefs);
      break;
    }
    case 'query_report': {
      if (isPlainObject(el.primarySource)) {
        pushToken(el.primarySource.aggregateRef);
      }
      if (Array.isArray(el.sourceObjects)) {
        for (const src of el.sourceObjects) {
          if (isPlainObject(src)) pushToken(src.objectRef);
        }
      }
      if (Array.isArray(el.joins)) {
        for (const join of el.joins) {
          if (isPlainObject(join)) pushToken(join.aggregateRef);
        }
      }
      break;
    }
    case 'screen': {
      for (const bound of ctx.uiBoundAggregatesByTarget.get(elementId) ?? []) {
        pushRef(bound);
      }
      if (Array.isArray(el.elements)) {
        for (const uiEl of el.elements) {
          if (!isPlainObject(uiEl)) continue;
          const uiElId = nonEmptyString(uiEl.elementId);
          if (uiElId) {
            for (const bound of ctx.uiBoundAggregatesByTarget.get(uiElId) ?? []) {
              pushRef(bound);
            }
          }
          if (typeof uiEl.dataBinding === 'string' && /[.[]/.test(uiEl.dataBinding)) {
            pushToken(uiEl.dataBinding);
          }
        }
      }
      if (Array.isArray(el.events)) {
        for (const ev of el.events) {
          if (!isPlainObject(ev) || !Array.isArray(ev.callChain)) continue;
          for (const step of ev.callChain) {
            if (!isPlainObject(step)) continue;
            const refId = nonEmptyString(step.refId);
            if (!refId) continue;
            if (step.stepType === 'BEHAVIOR_CALL') {
              pushToken(ctx.behaviorOwnerById.get(refId));
            } else if (step.stepType === 'EVENT_EMIT') {
              pushToken(ctx.eventSourceById.get(refId));
            } else if (step.stepType === 'REPORT_CALL' || step.stepType === 'QUERY_REPORT') {
              pushToken(ctx.reportPrimaryAggById.get(refId));
            } else if (step.stepType === 'SCENARIO_CALL') {
              pushToken(ctx.scenarioSourceAggById.get(refId));
            }
          }
        }
      }
      break;
    }
    case 'mapping': {
      const resolved =
        resolveAggregateToken(ctx, el.objectRef, false) ??
        resolveAggregateToken(ctx, el.objectName, false);
      if (resolved) {
        pushRef(resolved);
      } else {
        const fallbackId = nonEmptyString(el.objectRef) ?? nonEmptyString(el.objectName);
        const fallbackName = nonEmptyString(el.objectName) ?? fallbackId;
        if (fallbackId && fallbackName) {
          pushRef({ aggregateId: fallbackId, name: fallbackName, displayName: fallbackName });
        }
      }
      break;
    }
    case 'interface': {
      pushToken(el.relatedEntityRef);
      const behRef = nonEmptyString(el.relatedBehaviorRef);
      if (behRef) pushToken(ctx.behaviorOwnerById.get(behRef));
      const evtRef = nonEmptyString(el.relatedEventRef);
      if (evtRef) pushToken(ctx.eventSourceById.get(evtRef));
      const rptRef = nonEmptyString(el.relatedReportRef);
      if (rptRef) pushToken(ctx.reportPrimaryAggById.get(rptRef));

      const mappedRefs: string[] = [];
      collectInterfaceFieldMappedRefs(el.inputFields, mappedRefs);
      collectInterfaceFieldMappedRefs(el.outputFields, mappedRefs);
      for (const mapped of mappedRefs) {
        pushToken(mapped, false);
      }
      break;
    }
    default:
      break;
  }

  return result;
}

function resolveElementNames(
  el: LooseRecord,
  spec: CollectionSpec,
  elementId: string,
  ctx: SuiteContextLookup,
): { name: string; displayName: string } {
  const lookupAggDisplay = (token: string): string =>
    ctx.aggregatesByToken.get(token)?.displayName ?? token;

  const lookupScreenName = (screenId: string): string =>
    ctx.screenNameById.get(screenId) ?? screenId;

  switch (spec.elementKind) {
    case 'aggregate':
    case 'behavior':
    case 'rule':
    case 'query_report': {
      const name = String(el.name ?? elementId);
      const displayName = String(el.alias || el.name || elementId);
      return { name, displayName };
    }
    case 'event': {
      const name = String(el.name ?? elementId);
      const displayName = String(el.label || el.name || elementId);
      return { name, displayName };
    }
    case 'aggregate_association': {
      const src = String(el.sourceAggregate ?? '');
      const tgt = String(el.targetAggregate ?? '');
      return {
        name: `${src} -> ${tgt}`,
        displayName: `${lookupAggDisplay(src)} → ${lookupAggDisplay(tgt)}`,
      };
    }
    case 'navigation_edge': {
      const from = String(el.fromScreen ?? '');
      const to = String(el.toScreen ?? '');
      return {
        name: `${from} -> ${to}`,
        displayName: `${lookupScreenName(from)} → ${lookupScreenName(to)}`,
      };
    }
    case 'mapping': {
      const objectName = String(el.objectName ?? el.objectRef ?? elementId);
      const objectRef = String(el.objectRef ?? objectName);
      const displayName =
        ctx.aggregatesByToken.get(objectRef)?.displayName ??
        ctx.aggregatesByToken.get(objectName)?.displayName ??
        ctx.subObjectDisplayByToken.get(objectRef) ??
        ctx.subObjectDisplayByToken.get(objectName) ??
        objectName;
      return { name: objectName, displayName };
    }
    default: {
      const name = String(el.name ?? el.code ?? elementId);
      const displayName = String(el.name ?? el.alias ?? el.label ?? elementId);
      return { name, displayName };
    }
  }
}

function isPlainObject(value: unknown): value is LooseRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isEffectivelyEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) {
    return Object.values(value).every((v) => isEffectivelyEmpty(v));
  }
  return false;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function deepEqualNormalized(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (isEffectivelyEmpty(a) && isEffectivelyEmpty(b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqualNormalized(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (!deepEqualNormalized(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

function nonEmptyString(val: unknown): string | undefined {
  return typeof val === 'string' && val.length > 0 ? val : undefined;
}

function extractNestedItemKey(item: LooseRecord, arrayFieldName: string): string | undefined {
  switch (arrayFieldName) {
    case 'elements':
      return nonEmptyString(item.elementId);
    case 'events':
      return nonEmptyString(item.eventId);
    case 'activities':
      return nonEmptyString(item.id);
    case 'branches':
      return nonEmptyString(item.branchName) ?? nonEmptyString(item.targetActivity);
    case 'types':
      return nonEmptyString(item.typeCode);
    case 'items':
    case 'returnRules':
      return nonEmptyString(item.code);
    case 'tableMappings':
      return nonEmptyString(item.tableName);
    case 'foreignKeys':
      return nonEmptyString(item.fkName);
    case 'columnMappings':
      return nonEmptyString(item.column) ?? nonEmptyString(item.attributeRef);
    case 'subscribers': {
      const subType = nonEmptyString(item.subscriberType);
      const subRef = nonEmptyString(item.subscriberRef);
      return subType && subRef ? `${subType}:${subRef}` : subRef;
    }
    case 'steps':
    case 'callChain':
      return (
        nonEmptyString(item.stepId) ??
        (typeof item.stepOrder === 'number' ? String(item.stepOrder) : undefined)
      );
    case 'joins':
      return (
        nonEmptyString(item.joinId) ??
        nonEmptyString(item.alias) ??
        nonEmptyString(item.aggregateRef)
      );
    case 'sourceObjects':
      return nonEmptyString(item.alias) ?? nonEmptyString(item.objectRef);
    case 'conditions':
      return nonEmptyString(item.conditionId) ?? nonEmptyString(item.field);
    case 'orderBy':
      return nonEmptyString(item.field);
    case 'stateChanges':
      return nonEmptyString(item.targetField);
    case 'syncTriggers':
    case 'triggeredBehaviors':
      return nonEmptyString(item.behaviorRef);
    default:
      return (
        nonEmptyString(item.name) ??
        nonEmptyString(item.id) ??
        nonEmptyString(item.code) ??
        nonEmptyString(item.elementId) ??
        nonEmptyString(item.eventId)
      );
  }
}

function tryBuildUniqueKeyedList(
  items: LooseRecord[],
  arrayFieldName: string,
): { keys: string[]; map: Map<string, LooseRecord> } | undefined {
  const keys: string[] = [];
  const map = new Map<string, LooseRecord>();
  for (const item of items) {
    const key = extractNestedItemKey(item, arrayFieldName);
    if (!key || map.has(key)) return undefined;
    keys.push(key);
    map.set(key, item);
  }
  return { keys, map };
}

function summarizeNestedItem(item: LooseRecord): string {
  if ('elementId' in item && 'elementType' in item) {
    return `${String(item.label || item.name || item.elementId)} (${String(item.elementType)})`;
  }
  if ('eventId' in item && 'callChain' in item) {
    const chain = formatCallChainSummary(item as unknown as UIEvent);
    return `${String(item.name || item.eventId)} [${chain}]`;
  }
  if ('tableName' in item && 'tableRole' in item) {
    return `${String(item.tableName)} (${String(item.tableRole)})`;
  }
  if ('column' in item && 'columnType' in item) {
    return `${String(item.column)}: ${String(item.columnType)}`;
  }
  if ('activityType' in item && 'name' in item) {
    return `${String(item.name)} (${String(item.activityType)})`;
  }
  if ('stepType' in item && 'refId' in item) {
    return `${String(item.stepType)}:${String(item.refId)}`;
  }
  if ('expression' in item && 'name' in item) {
    return `${String(item.name)}: ${String(item.expression)}`;
  }
  if ('type' in item && ('label' in item || 'name' in item)) {
    const label = String(item.label || item.name);
    const reqSuffix = item.required ? ', required' : '';
    return `${label} (${String(item.type)}${reqSuffix})`;
  }
  if ('alias' in item && 'name' in item) {
    return `${String(item.alias)} (${String(item.name)})`;
  }
  if ('label' in item) return String(item.label);
  if ('name' in item) return String(item.name);
  return canonicalJson(item);
}

function formatScalar(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return canonicalJson(value);
}

function formatPrimitiveOrMixedArray(arr: unknown[]): string {
  if (arr.length === 0) return '—';
  return arr
    .map((item) => {
      if (isPlainObject(item)) {
        if ('eventRef' in item) {
          const cond = nonEmptyString(item.triggerCondition);
          return cond ? `${String(item.eventRef)} (${cond})` : String(item.eventRef);
        }
        return summarizeNestedItem(item);
      }
      return String(item);
    })
    .join(', ');
}

function pushFieldChange(
  changes: SuiteFieldChange[],
  field: string,
  rawBefore: unknown,
  rawAfter: unknown,
  formattedBefore: string,
  formattedAfter: string,
): void {
  if (formattedBefore !== formattedAfter) {
    changes.push({ field, before: formattedBefore, after: formattedAfter });
    return;
  }
  const jsonBefore = canonicalJson(rawBefore);
  const jsonAfter = canonicalJson(rawAfter);
  if (jsonBefore !== jsonAfter) {
    changes.push({ field, before: jsonBefore, after: jsonAfter });
  }
}

function compareFieldValues(
  changes: SuiteFieldChange[],
  path: string,
  fieldKey: string,
  prevVal: unknown,
  nextVal: unknown,
): void {
  if (deepEqualNormalized(prevVal, nextVal)) return;

  if (fieldKey === 'callChain' && (Array.isArray(prevVal) || Array.isArray(nextVal))) {
    const prevChain = Array.isArray(prevVal) ? prevVal : [];
    const nextChain = Array.isArray(nextVal) ? nextVal : [];
    const prevSummary = formatCallChainSummary({ callChain: prevChain } as unknown as UIEvent);
    const nextSummary = formatCallChainSummary({ callChain: nextChain } as unknown as UIEvent);
    if (prevSummary !== nextSummary) {
      changes.push({ field: path, before: prevSummary, after: nextSummary });
      return;
    }
  }

  if (Array.isArray(prevVal) || Array.isArray(nextVal)) {
    const prevArr = Array.isArray(prevVal) ? prevVal : [];
    const nextArr = Array.isArray(nextVal) ? nextVal : [];
    if (prevArr.length === 0 && nextArr.length === 0) return;

    const allPlainObjects =
      prevArr.every((item) => isPlainObject(item)) &&
      nextArr.every((item) => isPlainObject(item)) &&
      (prevArr.length > 0 || nextArr.length > 0);

    if (allPlainObjects) {
      const prevKeyed = tryBuildUniqueKeyedList(prevArr as LooseRecord[], fieldKey);
      const nextKeyed = tryBuildUniqueKeyedList(nextArr as LooseRecord[], fieldKey);
      if (prevKeyed && nextKeyed) {
        const beforeLen = changes.length;
        for (const key of nextKeyed.keys) {
          const prevItem = prevKeyed.map.get(key);
          const nextItem = nextKeyed.map.get(key)!;
          if (!prevItem) {
            changes.push({
              field: `${path}[${key}]`,
              before: '—',
              after: summarizeNestedItem(nextItem),
            });
          } else {
            compareObjectFields(changes, `${path}[${key}]`, prevItem, nextItem);
          }
        }
        for (const key of prevKeyed.keys) {
          if (!nextKeyed.map.has(key)) {
            const prevItem = prevKeyed.map.get(key)!;
            changes.push({
              field: `${path}[${key}]`,
              before: summarizeNestedItem(prevItem),
              after: '—',
            });
          }
        }
        if (
          changes.length === beforeLen &&
          ORDERED_NESTED_ARRAY_FIELDS.has(fieldKey) &&
          prevKeyed.keys.join('\0') !== nextKeyed.keys.join('\0')
        ) {
          changes.push({
            field: path,
            before: prevKeyed.keys.join(' -> '),
            after: nextKeyed.keys.join(' -> '),
          });
        }
        return;
      }
    }

    pushFieldChange(
      changes,
      path,
      prevArr,
      nextArr,
      formatPrimitiveOrMixedArray(prevArr),
      formatPrimitiveOrMixedArray(nextArr),
    );
    return;
  }

  if (isPlainObject(prevVal) && isPlainObject(nextVal)) {
    compareObjectFields(changes, path, prevVal, nextVal);
    return;
  }
  if (isPlainObject(prevVal) || isPlainObject(nextVal)) {
    const beforeStr = isPlainObject(prevVal) ? summarizeNestedItem(prevVal) : formatScalar(prevVal);
    const afterStr = isPlainObject(nextVal) ? summarizeNestedItem(nextVal) : formatScalar(nextVal);
    pushFieldChange(changes, path, prevVal, nextVal, beforeStr, afterStr);
    return;
  }

  pushFieldChange(
    changes,
    path,
    prevVal,
    nextVal,
    formatScalar(prevVal),
    formatScalar(nextVal),
  );
}

function compareObjectFields(
  changes: SuiteFieldChange[],
  prefix: string,
  prevObj: LooseRecord,
  nextObj: LooseRecord,
  skipKey?: string,
): void {
  const keys = new Set<string>([...Object.keys(prevObj), ...Object.keys(nextObj)]);
  for (const key of keys) {
    if (key === skipKey) continue;
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    compareFieldValues(changes, fieldPath, key, prevObj[key], nextObj[key]);
  }
}

function getCollectionElements(
  suite: OntologySuite | undefined,
  spec: CollectionSpec,
): LooseRecord[] {
  const model = suite?.[spec.modelCode] as LooseRecord | undefined;
  const raw = model?.[spec.collection];
  return Array.isArray(raw) ? (raw as LooseRecord[]) : [];
}

function createEmptyModelDiff(modelCode: ModelCode): OntologyModelDiff {
  return {
    modelCode,
    added: [],
    removed: [],
    modified: [],
    changes: [],
    summary: {
      addedCount: 0,
      removedCount: 0,
      modifiedCount: 0,
      totalChanges: 0,
      hasChanges: false,
    },
  };
}

function recordElementDiff(
  modelDiff: OntologyModelDiff,
  allChanges: OntologyElementDiff[],
  item: OntologyElementDiff,
): void {
  if (item.status === 'ADDED') modelDiff.added.push(item);
  else if (item.status === 'REMOVED') modelDiff.removed.push(item);
  else modelDiff.modified.push(item);
  modelDiff.changes.push(item);
  allChanges.push(item);
}

function buildUnpairedElementDiff(
  el: LooseRecord,
  spec: CollectionSpec,
  elementId: string,
  status: 'ADDED' | 'REMOVED',
  ctx: SuiteContextLookup,
): OntologyElementDiff {
  const { name, displayName } = resolveElementNames(el, spec, elementId, ctx);
  return {
    modelCode: spec.modelCode,
    collection: spec.collection,
    elementKind: spec.elementKind,
    elementId,
    name,
    displayName,
    status,
    changedFields: [],
    relatedAggregates: resolveRelatedAggregates(el, spec, elementId, ctx),
  };
}

export function diffOntologySuites(
  previousSuite: OntologySuite | undefined,
  nextSuite: OntologySuite | undefined,
): OntologySuiteDiff {
  const models = {} as Record<ModelCode, OntologyModelDiff>;
  for (const code of MODEL_CODES) {
    models[code] = createEmptyModelDiff(code);
  }

  const prevCtx = buildSuiteContextLookup(previousSuite, nextSuite);
  const nextCtx = buildSuiteContextLookup(nextSuite, previousSuite);
  const allChanges: OntologyElementDiff[] = [];

  for (const spec of SUITE_COLLECTION_SPECS) {
    const prevElements = getCollectionElements(previousSuite, spec);
    const nextElements = getCollectionElements(nextSuite, spec);

    const prevById = new Map<string, LooseRecord>();
    for (const prevEl of prevElements) {
      prevById.set(String(prevEl[spec.idKey] ?? ''), prevEl);
    }
    const nextIds = new Set<string>();
    for (const nextEl of nextElements) {
      nextIds.add(String(nextEl[spec.idKey] ?? ''));
    }

    const modelDiff = models[spec.modelCode];

    for (const nextEl of nextElements) {
      const elementId = String(nextEl[spec.idKey] ?? '');
      const prevEl = prevById.get(elementId);
      if (!prevEl) {
        recordElementDiff(
          modelDiff,
          allChanges,
          buildUnpairedElementDiff(nextEl, spec, elementId, 'ADDED', nextCtx),
        );
        continue;
      }

      const changedFields: SuiteFieldChange[] = [];
      compareObjectFields(changedFields, '', prevEl, nextEl, spec.idKey);
      if (changedFields.length === 0) continue;

      const prevNames = resolveElementNames(prevEl, spec, elementId, prevCtx);
      const nextNames = resolveElementNames(nextEl, spec, elementId, nextCtx);

      recordElementDiff(modelDiff, allChanges, {
        modelCode: spec.modelCode,
        collection: spec.collection,
        elementKind: spec.elementKind,
        elementId,
        name: nextNames.name,
        ...(prevNames.name !== nextNames.name ? { previousName: prevNames.name } : {}),
        displayName: nextNames.displayName,
        ...(prevNames.displayName !== nextNames.displayName
          ? { previousDisplayName: prevNames.displayName }
          : {}),
        status: 'MODIFIED',
        changedFields,
        relatedAggregates: resolveRelatedAggregates(nextEl, spec, elementId, nextCtx),
      });
    }

    for (const prevEl of prevElements) {
      const elementId = String(prevEl[spec.idKey] ?? '');
      if (!nextIds.has(elementId)) {
        recordElementDiff(
          modelDiff,
          allChanges,
          buildUnpairedElementDiff(prevEl, spec, elementId, 'REMOVED', prevCtx),
        );
      }
    }
  }

  let addedCount = 0;
  let removedCount = 0;
  let modifiedCount = 0;
  const changedModels: ModelCode[] = [];

  for (const code of MODEL_CODES) {
    const m = models[code];
    m.summary = {
      addedCount: m.added.length,
      removedCount: m.removed.length,
      modifiedCount: m.modified.length,
      totalChanges: m.changes.length,
      hasChanges: m.changes.length > 0,
    };
    if (m.summary.hasChanges) {
      changedModels.push(code);
    }
    addedCount += m.summary.addedCount;
    removedCount += m.summary.removedCount;
    modifiedCount += m.summary.modifiedCount;
  }

  const totalChanges = allChanges.length;
  const hasChanges = totalChanges > 0;

  return {
    hasChanges,
    summary: {
      addedCount,
      removedCount,
      modifiedCount,
      totalChanges,
      changedModels,
      hasChanges,
    },
    models,
    changes: allChanges,
  };
}
