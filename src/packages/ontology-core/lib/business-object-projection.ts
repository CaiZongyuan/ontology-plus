import type {
  ActorItem,
  AggregateAssociation,
  AggregateRoot,
  Attribute,
  BehaviorItem,
  DataDictionary,
  EventItem,
  FlowActivity,
  FlowItem,
  InterfaceFieldSpec,
  InterfaceItem,
  ModelCode,
  MUUiModel,
  ObjectTableMapping,
  OntologySuite,
  PermissionGroupItem,
  PermissionItem,
  QueryReportItem,
  RoleItem,
  RuleItem,
  ScenarioItem,
  ScreenItem,
  SubEntity,
  ValueObject,
} from './types.js';

export type NavigationEdge = MUUiModel['navigation_edges'][number];
export type CrossCuttingUI = MUUiModel['cross_cutting_ui'][number];
export type AttributeRule = NonNullable<Attribute['refRules']>[number];
export type AggregateInvariant = AggregateRoot['invariants'][number];
export type DictionaryItem = DataDictionary['types'][number]['items'][number];

export const DEFAULT_EXPANDED_OBJECT_SECTIONS = [
  'fields',
  'actions',
  'businessRules',
  'authorizedRoles',
] as const;

export const DEFAULT_COLLAPSED_OBJECT_SECTIONS = [
  'events',
  'automations',
  'screens',
  'integrations',
  'dataStorage',
] as const;

export type DefaultExpandedObjectSection = (typeof DEFAULT_EXPANDED_OBJECT_SECTIONS)[number];
export type DefaultCollapsedObjectSection = (typeof DEFAULT_COLLAPSED_OBJECT_SECTIONS)[number];

export interface TechnicalLocator {
  model: ModelCode;
  elementId: string;
  path?: string;
}

export interface BusinessObjectSummary {
  id: string;
  name: string;
  alias: string;
  displayName: string;
  locator: TechnicalLocator;
}

export interface ProjectedDictionaryBinding {
  dictionaryId: string;
  dictionaryName: string;
  typeCode: string;
  typeName: string;
  items: DictionaryItem[];
  locator: TechnicalLocator;
}

export interface ProjectedField {
  id: string;
  name: string;
  label: string;
  displayName: string;
  type: Attribute['type'];
  required: boolean;
  unique?: boolean;
  defaultValue?: unknown;
  description?: string;
  enumValues?: string[];
  ownerKind: 'AGGREGATE' | 'SUB_ENTITY' | 'VALUE_OBJECT';
  ownerName: string;
  ownerDisplayName: string;
  targetObject?: BusinessObjectSummary;
  dictionary?: ProjectedDictionaryBinding;
  valueObject?: ProjectedValueObject;
  attribute: Attribute;
  locator: TechnicalLocator;
}

export interface ProjectedSubEntity {
  id: string;
  localId: string;
  name: string;
  alias: string;
  displayName: string;
  description?: string;
  cardinality: SubEntity['cardinality'];
  cascadeDelete: boolean;
  fields: ProjectedField[];
  subEntity: SubEntity;
  locator: TechnicalLocator;
}

export interface ProjectedValueObject {
  id: string;
  name: string;
  alias: string;
  displayName: string;
  description?: string;
  immutable: boolean;
  equalityFields: string[];
  fields: ProjectedField[];
  valueObject: ValueObject;
  locator: TechnicalLocator;
}

export interface ProjectedAssociation {
  id: string;
  associationType: AggregateAssociation['associationType'];
  cardinality: AggregateAssociation['cardinality'];
  direction: 'OUTGOING' | 'INCOMING' | 'SELF';
  sourceRole: string;
  targetRole: string;
  referenceField: string;
  description?: string;
  sourceObject?: BusinessObjectSummary;
  targetObject?: BusinessObjectSummary;
  association: AggregateAssociation;
  locator: TechnicalLocator;
}

export interface ProjectedDictionary {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  dictionary: DataDictionary;
  locator: TechnicalLocator;
}

export interface ProjectedAction {
  id: string;
  name: string;
  alias: string;
  displayName: string;
  description?: string;
  behaviorType: BehaviorItem['behaviorType'];
  triggerType: BehaviorItem['triggerType'];
  isAutomatic: boolean;
  authorizedRoleIds: string[];
  behavior: BehaviorItem;
  locator: TechnicalLocator;
}

export interface ProjectedAttributeRule {
  id: string;
  kind: 'ATTRIBUTE_RULE';
  name: string;
  displayName: string;
  description: string;
  expression: string;
  violationMessage: string;
  enforcedAt: AttributeRule['enforcedAt'];
  fieldName: string;
  fieldDisplayName: string;
  relatedObjectIds: string[];
  relatedObjects: BusinessObjectSummary[];
  isCrossObject: false;
  attributeRule: AttributeRule;
  locator: TechnicalLocator;
}

export interface ProjectedInvariantRule {
  id: string;
  kind: 'INVARIANT';
  name: string;
  displayName: string;
  description: string;
  expression: string;
  violationMessage: string;
  enforcedAt: AggregateInvariant['enforcedAt'];
  relatedObjectIds: string[];
  relatedObjects: BusinessObjectSummary[];
  isCrossObject: false;
  invariant: AggregateInvariant;
  locator: TechnicalLocator;
}

export interface ProjectedM3Rule {
  id: string;
  kind: 'M3_RULE';
  name: string;
  alias: string;
  displayName: string;
  description?: string;
  expression: string;
  violationMessage?: string;
  ruleType: RuleItem['ruleType'];
  scope: RuleItem['scope'];
  relatedObjectIds: string[];
  relatedObjects: BusinessObjectSummary[];
  isCrossObject: boolean;
  rule: RuleItem;
  locator: TechnicalLocator;
}

export type ProjectedBusinessRule =
  | ProjectedAttributeRule
  | ProjectedInvariantRule
  | ProjectedM3Rule;

export interface ProjectedActorSummary {
  id: string;
  name: string;
  displayName: string;
  actorType: ActorItem['actorType'];
  description?: string;
  actor: ActorItem;
  locator: TechnicalLocator;
}

export interface ProjectedObjectRoleAuth {
  roleId: string;
  name: string;
  displayName: string;
  code: string;
  description?: string;
  dataScope: RoleItem['dataScope'];
  actors: ProjectedActorSummary[];
  actions: ProjectedAction[];
  directActionIds: string[];
  inheritedActionIds: string[];
  permissions: PermissionItem[];
  role: RoleItem;
  locator: TechnicalLocator;
}

export interface ProjectedEvent {
  id: string;
  name: string;
  label: string;
  displayName: string;
  description?: string;
  relation: 'PRODUCED' | 'SUBSCRIBED' | 'BOTH';
  sourceObject?: BusinessObjectSummary;
  subscriberObjects: BusinessObjectSummary[];
  event: EventItem;
  locator: TechnicalLocator;
}

export interface ProjectedAutomation {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  involvedObjects: BusinessObjectSummary[];
  scenario: ScenarioItem;
  locator: TechnicalLocator;
}

export interface ProjectedScreen {
  id: string;
  screenId: string;
  name: string;
  displayName: string;
  description?: string;
  screenType: ScreenItem['screenType'];
  route?: string;
  relatedObjects: BusinessObjectSummary[];
  navigationEdges: NavigationEdge[];
  crossCuttingUi: CrossCuttingUI[];
  screen: ScreenItem;
  locator: TechnicalLocator;
}

export interface ProjectedIntegration {
  id: string;
  interfaceId: string;
  name: string;
  displayName: string;
  description?: string;
  direction: InterfaceItem['direction'];
  interfaceCategory: InterfaceItem['interfaceCategory'];
  externalActor?: ProjectedActorSummary;
  relatedObjects: BusinessObjectSummary[];
  interfaceItem: InterfaceItem;
  locator: TechnicalLocator;
}

export interface ProjectedDataStorage {
  id: string;
  objectName: string;
  displayName: string;
  description?: string;
  tableNames: string[];
  relatedObjects: BusinessObjectSummary[];
  mapping: ObjectTableMapping;
  locator: TechnicalLocator;
}

export interface BusinessObjectProjection {
  id: string;
  name: string;
  alias: string;
  displayName: string;
  description?: string;
  lifecycle: string[];
  tags: string[];
  aggregate: AggregateRoot;
  locator: TechnicalLocator;

  // Default-expanded sections
  fields: ProjectedField[];
  subEntities: ProjectedSubEntity[];
  valueObjects: ProjectedValueObject[];
  associations: ProjectedAssociation[];
  dictionaries: ProjectedDictionary[];
  actions: ProjectedAction[];
  businessRules: ProjectedBusinessRule[];
  authorizedRoles: ProjectedObjectRoleAuth[];
  automaticActions: ProjectedAction[];
  unauthorizedActions: ProjectedAction[];

  // Default-collapsed sections
  events: ProjectedEvent[];
  automations: ProjectedAutomation[];
  screens: ProjectedScreen[];
  integrations: ProjectedIntegration[];
  dataStorage: ProjectedDataStorage[];
}

export interface ProjectedRoleSummary {
  id: string;
  name: string;
  displayName: string;
  code: string;
  description?: string;
  role: RoleItem;
  locator: TechnicalLocator;
}

export interface ProjectedFlowActivity {
  id: string;
  name: string;
  displayName: string;
  activityType: FlowActivity['activityType'];
  role?: ProjectedRoleSummary;
  action?: ProjectedAction;
  screen?: ProjectedScreen;
  branches: FlowActivity['branches'];
  activity: FlowActivity;
  locator: TechnicalLocator;
}

export interface ProjectedFlow {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  flowType: FlowItem['flowType'];
  primaryObject?: BusinessObjectSummary;
  referencedObjects: BusinessObjectSummary[];
  participatingRoles: ProjectedRoleSummary[];
  activities: ProjectedFlowActivity[];
  flow: FlowItem;
  locator: TechnicalLocator;
}

export interface FlowsAndApprovalsView {
  flows: ProjectedFlow[];
}

export interface ProjectedPermission {
  id: string;
  name: string;
  displayName: string;
  code: string;
  targetObject?: BusinessObjectSummary;
  allowedActions: ProjectedAction[];
  permission: PermissionItem;
  locator: TechnicalLocator;
}

export interface ProjectedPermissionGroup {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  permissions: ProjectedPermission[];
  permissionGroup: PermissionGroupItem;
  locator: TechnicalLocator;
}

export interface ProjectedRoleObjectGrant {
  object: BusinessObjectSummary;
  actions: ProjectedAction[];
  directActionIds: string[];
  inheritedActionIds: string[];
  permissions: ProjectedPermission[];
}

export interface ProjectedRole {
  id: string;
  name: string;
  displayName: string;
  code: string;
  description?: string;
  dataScope: RoleItem['dataScope'];
  actors: ProjectedActorSummary[];
  directPermissions: ProjectedPermission[];
  effectivePermissions: ProjectedPermission[];
  objectGrants: ProjectedRoleObjectGrant[];
  role: RoleItem;
  locator: TechnicalLocator;
}

export interface RolesAndPermissionsView {
  roles: ProjectedRole[];
  actors: ProjectedActorSummary[];
  permissionGroups: ProjectedPermissionGroup[];
  permissions: ProjectedPermission[];
}

export interface ProjectedQueryReport {
  id: string;
  name: string;
  alias: string;
  displayName: string;
  description?: string;
  queryType: QueryReportItem['queryType'];
  category: 'QUERY' | 'REPORT';
  primaryObject?: BusinessObjectSummary;
  sourceObjects: BusinessObjectSummary[];
  boundAction?: ProjectedAction;
  screens: ProjectedScreen[];
  item: QueryReportItem;
  locator: TechnicalLocator;
}

export interface QueriesAndReportsView {
  items: ProjectedQueryReport[];
  queries: ProjectedQueryReport[];
  reports: ProjectedQueryReport[];
}

export type OtherElementKind =
  | 'DATA_DICTIONARY'
  | 'ASSOCIATION'
  | 'ACTION'
  | 'RULE'
  | 'EVENT'
  | 'AUTOMATION'
  | 'SCREEN'
  | 'NAVIGATION_EDGE'
  | 'CROSS_CUTTING_UI'
  | 'DATA_STORAGE'
  | 'INTEGRATION';

export type OtherElementPayload =
  | DataDictionary
  | AggregateAssociation
  | BehaviorItem
  | RuleItem
  | EventItem
  | ScenarioItem
  | ScreenItem
  | NavigationEdge
  | CrossCuttingUI
  | ObjectTableMapping
  | InterfaceItem;

export interface ProjectedOtherItem {
  id: string;
  kind: OtherElementKind;
  displayName: string;
  description?: string;
  element: OtherElementPayload;
  locator: TechnicalLocator;
}

export interface BusinessModelProjection {
  objects: BusinessObjectProjection[];
  sharedRules: ProjectedM3Rule[];
  flowsAndApprovals: FlowsAndApprovalsView;
  rolesAndPermissions: RolesAndPermissionsView;
  queriesAndReports: QueriesAndReportsView;
  other: ProjectedOtherItem[];
}

function nonEmpty(primary: string | undefined, fallback: string): string {
  const trimmed = primary?.trim();
  return trimmed ? trimmed : fallback;
}

function isAutomaticTrigger(triggerType: BehaviorItem['triggerType']): boolean {
  return triggerType === 'EVENT' || triggerType === 'SCHEDULE' || triggerType === 'SYSTEM';
}

function collectInterfaceMappedRefs(fields: InterfaceFieldSpec[], out: string[]): void {
  for (const field of fields) {
    if (field.mappedRef) out.push(field.mappedRef);
    if (field.fields) collectInterfaceMappedRefs(field.fields, out);
  }
}

function addToSetMap<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) {
    existing.add(value);
  } else {
    map.set(key, new Set([value]));
  }
}

export function projectByBusinessObject(suite: OntologySuite): BusinessModelProjection {
  const aggregates = suite.M1?.aggregates ?? [];
  const aggOrderIndex = new Map<string, number>();
  const summaryById = new Map<string, BusinessObjectSummary>();
  const directAggByKey = new Map<string, AggregateRoot>();
  const subKeyCandidates = new Map<string, AggregateRoot[]>();

  const registerSubKey = (key: string | undefined, agg: AggregateRoot) => {
    const k = key?.trim();
    if (!k) return;
    const list = subKeyCandidates.get(k) ?? [];
    if (!list.some((existing) => existing.id === agg.id)) {
      list.push(agg);
      subKeyCandidates.set(k, list);
    }
  };

  aggregates.forEach((agg, idx) => {
    aggOrderIndex.set(agg.id, idx);
    const displayName = nonEmpty(agg.alias, agg.name);
    summaryById.set(agg.id, {
      id: agg.id,
      name: agg.name,
      alias: agg.alias,
      displayName,
      locator: { model: 'M1', elementId: agg.id },
    });

    for (const key of [agg.id, agg.name, agg.alias]) {
      const trimmed = key.trim();
      if (trimmed && !directAggByKey.has(trimmed)) {
        directAggByKey.set(trimmed, agg);
      }
    }

    for (const ent of agg.entities) {
      registerSubKey(ent.name, agg);
      registerSubKey(ent.alias, agg);
      registerSubKey(ent.localId, agg);
    }
    for (const vo of agg.valueObjects) {
      registerSubKey(vo.name, agg);
      registerSubKey(vo.alias, agg);
    }
  });

  const resolveAggregate = (rawRef: string | undefined): AggregateRoot | undefined => {
    const trimmed = rawRef?.trim();
    if (!trimmed) return undefined;

    const direct = directAggByKey.get(trimmed);
    if (direct) return direct;

    const prefixMatch = /^([^.[\]]+)[.[]/.exec(trimmed);
    if (prefixMatch) {
      const prefix = prefixMatch[1]!.trim();
      const byPrefix = directAggByKey.get(prefix);
      if (byPrefix) return byPrefix;
      const subPrefix = subKeyCandidates.get(prefix);
      if (subPrefix?.length === 1) return subPrefix[0];
    }

    const unambiguousSub = subKeyCandidates.get(trimmed);
    if (unambiguousSub?.length === 1) return unambiguousSub[0];

    return undefined;
  };

  const sortObjectIds = (ids: Iterable<string>): string[] =>
    Array.from(new Set(ids)).sort(
      (a, b) => (aggOrderIndex.get(a) ?? Number.MAX_SAFE_INTEGER) - (aggOrderIndex.get(b) ?? Number.MAX_SAFE_INTEGER),
    );

  const toObjectSummaries = (ids: Iterable<string>): BusinessObjectSummary[] =>
    sortObjectIds(ids)
      .map((id) => summaryById.get(id))
      .filter((s): s is BusinessObjectSummary => Boolean(s));

  // ─── Dictionaries & Associations (M1) ───────────────────────────────────────
  const dictionaries = suite.M1?.data_dictionaries ?? [];
  const dictById = new Map<string, DataDictionary>(dictionaries.map((d) => [d.id, d]));
  const assignedDictIdsByAgg = new Map<string, Set<string>>(
    aggregates.map((a) => [a.id, new Set<string>()]),
  );
  const globallyAssignedDictIds = new Set<string>();

  const associations = suite.M1?.aggregate_associations ?? [];
  const assocById = new Map<string, AggregateAssociation>(associations.map((a) => [a.id, a]));
  const assignedAssocByAgg = new Map<string, ProjectedAssociation[]>(
    aggregates.map((a) => [a.id, []]),
  );
  const globallyAssignedAssocIds = new Set<string>();

  for (const assoc of associations) {
    const srcAgg = resolveAggregate(assoc.sourceAggregate);
    const tgtAgg = resolveAggregate(assoc.targetAggregate);
    const srcSummary = srcAgg ? summaryById.get(srcAgg.id) : undefined;
    const tgtSummary = tgtAgg ? summaryById.get(tgtAgg.id) : undefined;
    const buildProjectedAssoc = (
      direction: ProjectedAssociation['direction'],
    ): ProjectedAssociation => ({
      id: assoc.id,
      associationType: assoc.associationType,
      cardinality: assoc.cardinality,
      direction,
      sourceRole: assoc.sourceRole,
      targetRole: assoc.targetRole,
      referenceField: assoc.referenceField,
      description: assoc.description,
      sourceObject: srcSummary,
      targetObject: tgtSummary,
      association: assoc,
      locator: { model: 'M1', elementId: assoc.id },
    });

    if (srcAgg && tgtAgg && srcAgg.id === tgtAgg.id) {
      globallyAssignedAssocIds.add(assoc.id);
      assignedAssocByAgg.get(srcAgg.id)!.push(buildProjectedAssoc('SELF'));
    } else {
      if (srcAgg) {
        globallyAssignedAssocIds.add(assoc.id);
        assignedAssocByAgg.get(srcAgg.id)!.push(buildProjectedAssoc('OUTGOING'));
      }
      if (tgtAgg) {
        globallyAssignedAssocIds.add(assoc.id);
        assignedAssocByAgg.get(tgtAgg.id)!.push(buildProjectedAssoc('INCOMING'));
      }
    }
  }

  // ─── Actions (M2) ───────────────────────────────────────────────────────────
  const behaviors = suite.M2?.behaviors ?? [];
  const actionById = new Map<string, ProjectedAction>();
  const actionByKey = new Map<string, ProjectedAction>();
  const actionOwnerAggId = new Map<string, string>();
  const actionsByAgg = new Map<string, ProjectedAction[]>(aggregates.map((a) => [a.id, []]));
  const unassignedActions: BehaviorItem[] = [];

  for (const beh of behaviors) {
    const projected: ProjectedAction = {
      id: beh.id,
      name: beh.name,
      alias: beh.alias,
      displayName: nonEmpty(beh.alias, beh.name),
      description: beh.description,
      behaviorType: beh.behaviorType,
      triggerType: beh.triggerType,
      isAutomatic: isAutomaticTrigger(beh.triggerType),
      authorizedRoleIds: [],
      behavior: beh,
      locator: { model: 'M2', elementId: beh.id },
    };
    actionById.set(beh.id, projected);
    actionByKey.set(beh.id, projected);
    actionByKey.set(beh.name, projected);

    const ownerAgg = resolveAggregate(beh.ownerEntity);
    if (ownerAgg) {
      actionOwnerAggId.set(beh.id, ownerAgg.id);
      actionsByAgg.get(ownerAgg.id)!.push(projected);
    } else {
      unassignedActions.push(beh);
    }
  }

  // ─── Roles, Actors & Permissions (M5) ───────────────────────────────────────
  const actors = suite.M5?.actors ?? [];
  const roles = suite.M5?.roles ?? [];
  const permissionGroups = suite.M5?.permissionGroups ?? [];
  const permissions = suite.M5?.permissions ?? [];

  const roleSummaryByKey = new Map<string, ProjectedRoleSummary>();
  const roleItemById = new Map<string, RoleItem>();
  for (const r of roles) {
    roleItemById.set(r.id, r);
    const summary: ProjectedRoleSummary = {
      id: r.id,
      name: r.name,
      displayName: r.name,
      code: r.code,
      description: r.description,
      role: r,
      locator: { model: 'M5', elementId: r.id },
    };
    roleSummaryByKey.set(r.id, summary);
    roleSummaryByKey.set(r.code, summary);
  }

  const projectedActors: ProjectedActorSummary[] = actors.map((actor) => ({
    id: actor.id,
    name: actor.name,
    displayName: actor.name,
    actorType: actor.actorType,
    description: actor.description,
    actor,
    locator: { model: 'M5', elementId: actor.id },
  }));
  const actorById = new Map<string, ProjectedActorSummary>(
    projectedActors.map((a) => [a.id, a]),
  );

  const actorsByRoleId = new Map<string, ProjectedActorSummary[]>(roles.map((r) => [r.id, []]));
  for (const projActor of projectedActors) {
    for (const roleRef of projActor.actor.roles) {
      const targetRole = roleSummaryByKey.get(roleRef);
      if (targetRole) {
        const list = actorsByRoleId.get(targetRole.id)!;
        if (!list.some((a) => a.id === projActor.id)) {
          list.push(projActor);
        }
      }
    }
  }

  const projectedPermByKey = new Map<string, ProjectedPermission>();
  const projectedPermissions: ProjectedPermission[] = permissions.map((perm) => {
    const targetAgg =
      resolveAggregate(perm.targetAggregate) ??
      (perm.targetType === 'ENTITY' ? resolveAggregate(perm.targetRef) : undefined);

    const allowedActionSet = new Set<ProjectedAction>();
    for (const bRef of perm.allowedBehaviors) {
      const act = actionByKey.get(bRef);
      if (act) allowedActionSet.add(act);
    }
    if (perm.targetType === 'BEHAVIOR' && perm.targetRef) {
      const act = actionByKey.get(perm.targetRef);
      if (act) allowedActionSet.add(act);
    }
    for (const beh of behaviors) {
      if (beh.requiredPermissions.includes(perm.id) || beh.requiredPermissions.includes(perm.code)) {
        const act = actionById.get(beh.id);
        if (act) allowedActionSet.add(act);
      }
    }

    const projPerm: ProjectedPermission = {
      id: perm.id,
      name: perm.name,
      displayName: perm.name,
      code: perm.code,
      targetObject: targetAgg ? summaryById.get(targetAgg.id) : undefined,
      allowedActions: Array.from(allowedActionSet),
      permission: perm,
      locator: { model: 'M5', elementId: perm.id },
    };
    projectedPermByKey.set(perm.id, projPerm);
    projectedPermByKey.set(perm.code, projPerm);
    return projPerm;
  });

  const pgByKey = new Map<string, ProjectedPermissionGroup>();
  const projectedPermissionGroups: ProjectedPermissionGroup[] = permissionGroups.map((pg) => {
    const perms = pg.permissions
      .map((pRef) => projectedPermByKey.get(pRef))
      .filter((p): p is ProjectedPermission => Boolean(p));
    const projPg: ProjectedPermissionGroup = {
      id: pg.id,
      name: pg.name,
      displayName: pg.name,
      description: pg.description,
      permissions: perms,
      permissionGroup: pg,
      locator: { model: 'M5', elementId: pg.id },
    };
    pgByKey.set(pg.id, projPg);
    return projPg;
  });

  const getDirectPermsForRole = (role: RoleItem): ProjectedPermission[] => {
    const seen = new Set<string>();
    const out: ProjectedPermission[] = [];
    const pushPerm = (p: ProjectedPermission | undefined) => {
      if (p && !seen.has(p.id)) {
        seen.add(p.id);
        out.push(p);
      }
    };
    for (const pRef of role.permissions) {
      pushPerm(projectedPermByKey.get(pRef));
    }
    for (const pgRef of role.permissionGroups ?? []) {
      for (const p of pgByKey.get(pgRef)?.permissions ?? []) {
        pushPerm(p);
      }
    }
    return out;
  };

  const getEffectivePermsForRole = (role: RoleItem): ProjectedPermission[] => {
    const visitedRoles = new Set<string>();
    const seenPerms = new Set<string>();
    const out: ProjectedPermission[] = [];

    const visit = (cur: RoleItem) => {
      if (visitedRoles.has(cur.id)) return;
      visitedRoles.add(cur.id);
      for (const p of getDirectPermsForRole(cur)) {
        if (!seenPerms.has(p.id)) {
          seenPerms.add(p.id);
          out.push(p);
        }
      }
      for (const parentRef of cur.inheritsFrom) {
        const parentRole =
          roleItemById.get(parentRef) ?? roleSummaryByKey.get(parentRef)?.role;
        if (parentRole) visit(parentRole);
      }
    };

    visit(role);
    return out;
  };

  const roleDirectPermsMap = new Map<string, ProjectedPermission[]>();
  const roleEffectivePermsMap = new Map<string, ProjectedPermission[]>();
  for (const role of roles) {
    const directPerms = getDirectPermsForRole(role);
    const effectivePerms = getEffectivePermsForRole(role);
    roleDirectPermsMap.set(role.id, directPerms);
    roleEffectivePermsMap.set(role.id, effectivePerms);

    for (const perm of effectivePerms) {
      for (const act of perm.allowedActions) {
        if (!act.authorizedRoleIds.includes(role.id)) {
          act.authorizedRoleIds.push(role.id);
        }
      }
    }
  }

  // ─── Events (ME) preliminary lookup (needed for M3, M4, MU, MI) ─────────────
  const events = suite.ME?.events ?? [];
  const eventSourceAggId = new Map<string, string>();
  for (const ev of events) {
    const srcId =
      resolveAggregate(ev.sourceAggregate)?.id ??
      (ev.producerBehaviorRef ? actionOwnerAggId.get(ev.producerBehaviorRef) : undefined);
    if (srcId) {
      eventSourceAggId.set(ev.id, srcId);
    }
  }

  // ─── Rules (M3) — Shared Canonical Instances across Referenced Objects ──────
  const m3Rules = suite.M3?.rules ?? [];
  const sharedRuleById = new Map<string, ProjectedM3Rule>();
  const m3RulesByAgg = new Map<string, ProjectedM3Rule[]>(aggregates.map((a) => [a.id, []]));
  const sharedRules: ProjectedM3Rule[] = [];
  const unassignedRules: RuleItem[] = [];

  const reverseBehaviorRuleAggs = new Map<string, Set<string>>();
  for (const beh of behaviors) {
    const ownerId = actionOwnerAggId.get(beh.id);
    if (!ownerId) continue;
    for (const rId of beh.invokedRules) {
      addToSetMap(reverseBehaviorRuleAggs, rId, ownerId);
    }
    for (const st of beh.syncTriggers ?? []) {
      if (st.ruleRef) {
        addToSetMap(reverseBehaviorRuleAggs, st.ruleRef, ownerId);
      }
    }
  }
  for (const ev of events) {
    const evSrcId = eventSourceAggId.get(ev.id);
    if (ev.producerRuleRef && evSrcId) {
      addToSetMap(reverseBehaviorRuleAggs, ev.producerRuleRef, evSrcId);
    }
    for (const sub of ev.subscribers) {
      if (sub.subscriberType === 'RULE') {
        if (evSrcId) addToSetMap(reverseBehaviorRuleAggs, sub.subscriberRef, evSrcId);
        if (sub.subscriberEntityRef) {
          const subAgg = resolveAggregate(sub.subscriberEntityRef);
          if (subAgg) addToSetMap(reverseBehaviorRuleAggs, sub.subscriberRef, subAgg.id);
        }
      }
    }
  }

  for (const rule of m3Rules) {
    const aggIdSet = new Set<string>();

    for (const objRef of rule.referencedObjects) {
      const agg = resolveAggregate(objRef);
      if (agg) aggIdSet.add(agg.id);
    }
    for (const param of rule.parameters) {
      if (param.source) {
        const agg = resolveAggregate(param.source);
        if (agg) aggIdSet.add(agg.id);
      }
    }
    for (const tb of rule.triggeredBehaviors) {
      const ownerId = actionOwnerAggId.get(tb.behaviorRef);
      if (ownerId) aggIdSet.add(ownerId);
      for (const expr of Object.values(tb.parameterMapping ?? {})) {
        if (expr.includes('.') || expr.includes('[')) {
          const agg = resolveAggregate(expr);
          if (agg) aggIdSet.add(agg.id);
        }
      }
    }
    for (const bId of rule.reusedBy ?? []) {
      const ownerId = actionOwnerAggId.get(bId);
      if (ownerId) aggIdSet.add(ownerId);
    }
    for (const evId of rule.triggeredByEvents) {
      const srcId = eventSourceAggId.get(evId);
      if (srcId) aggIdSet.add(srcId);
    }
    for (const evId of rule.producedEvents) {
      const srcId = eventSourceAggId.get(evId);
      if (srcId) aggIdSet.add(srcId);
    }
    for (const invokerOwnerId of reverseBehaviorRuleAggs.get(rule.id) ?? []) {
      aggIdSet.add(invokerOwnerId);
    }

    const relatedObjectIds = sortObjectIds(aggIdSet);
    if (relatedObjectIds.length === 0) {
      unassignedRules.push(rule);
      continue;
    }

    const canonicalRule: ProjectedM3Rule = {
      id: rule.id,
      kind: 'M3_RULE',
      name: rule.name,
      alias: rule.alias,
      displayName: nonEmpty(rule.alias, rule.name),
      description: rule.description ?? rule.violationMessage,
      expression: rule.expression,
      violationMessage: rule.violationMessage,
      ruleType: rule.ruleType,
      scope: rule.scope,
      relatedObjectIds,
      relatedObjects: toObjectSummaries(relatedObjectIds),
      isCrossObject: relatedObjectIds.length > 1,
      rule,
      locator: { model: 'M3', elementId: rule.id },
    };

    sharedRuleById.set(rule.id, canonicalRule);
    sharedRules.push(canonicalRule);
    for (const aggId of relatedObjectIds) {
      m3RulesByAgg.get(aggId)!.push(canonicalRule);
    }
  }

  // ─── Events (ME) full projection (produced + subscribed) ────────────────────
  const eventsByAgg = new Map<string, ProjectedEvent[]>(aggregates.map((a) => [a.id, []]));
  const unassignedEvents: EventItem[] = [];

  const reverseBehaviorProducedEvents = new Map<string, Set<string>>();
  for (const beh of behaviors) {
    const ownerId = actionOwnerAggId.get(beh.id);
    if (!ownerId) continue;
    for (const pe of beh.producedEvents) {
      const evId = typeof pe === 'string' ? pe : pe.eventRef;
      addToSetMap(reverseBehaviorProducedEvents, evId, ownerId);
    }
  }

  for (const ev of events) {
    const producerAggIds = new Set<string>();
    const subscriberAggIds = new Set<string>();

    const srcAgg = resolveAggregate(ev.sourceAggregate);
    if (srcAgg) producerAggIds.add(srcAgg.id);

    if (ev.producerBehaviorRef) {
      const ownerId = actionOwnerAggId.get(ev.producerBehaviorRef);
      if (ownerId) producerAggIds.add(ownerId);
    }
    if (ev.producerRuleRef) {
      const r = sharedRuleById.get(ev.producerRuleRef);
      for (const objId of r?.relatedObjectIds ?? []) producerAggIds.add(objId);
    }
    for (const ownerId of reverseBehaviorProducedEvents.get(ev.id) ?? []) {
      producerAggIds.add(ownerId);
    }

    for (const sub of ev.subscribers) {
      if (sub.subscriberEntityRef) {
        const subAgg = resolveAggregate(sub.subscriberEntityRef);
        if (subAgg) subscriberAggIds.add(subAgg.id);
      }
      if (sub.subscriberType === 'BEHAVIOR') {
        const ownerId = actionOwnerAggId.get(sub.subscriberRef);
        if (ownerId) subscriberAggIds.add(ownerId);
      } else if (sub.subscriberType === 'RULE') {
        const r = sharedRuleById.get(sub.subscriberRef);
        for (const objId of r?.relatedObjectIds ?? []) {
          if (!producerAggIds.has(objId)) subscriberAggIds.add(objId);
        }
      }
    }

    const allEventAggIds = sortObjectIds([...producerAggIds, ...subscriberAggIds]);
    if (allEventAggIds.length === 0) {
      unassignedEvents.push(ev);
      continue;
    }

    const primarySourceId = srcAgg?.id ?? sortObjectIds(producerAggIds)[0];
    if (primarySourceId && !eventSourceAggId.has(ev.id)) {
      eventSourceAggId.set(ev.id, primarySourceId);
    }
    const sourceObject = primarySourceId ? summaryById.get(primarySourceId) : undefined;
    const subscriberObjects = toObjectSummaries(subscriberAggIds);

    for (const aggId of allEventAggIds) {
      const isProd = producerAggIds.has(aggId);
      const isSub = subscriberAggIds.has(aggId);
      const relation: ProjectedEvent['relation'] =
        isProd && isSub ? 'BOTH' : isProd ? 'PRODUCED' : 'SUBSCRIBED';

      eventsByAgg.get(aggId)!.push({
        id: ev.id,
        name: ev.name,
        label: ev.label,
        displayName: nonEmpty(ev.label, ev.name),
        description: ev.description,
        relation,
        sourceObject,
        subscriberObjects,
        event: ev,
        locator: { model: 'ME', elementId: ev.id },
      });
    }
  }

  // ─── Automations / Scenarios (M4) ───────────────────────────────────────────
  const scenarios = suite.M4?.event_scenarios ?? [];
  const scenarioById = new Map<string, ProjectedAutomation>();
  const automationsByAgg = new Map<string, ProjectedAutomation[]>(
    aggregates.map((a) => [a.id, []]),
  );
  const unassignedScenarios: ScenarioItem[] = [];

  for (const sc of scenarios) {
    const aggIdSet = new Set<string>();
    const addAggRef = (ref: string | undefined) => {
      const agg = resolveAggregate(ref);
      if (agg) aggIdSet.add(agg.id);
    };

    addAggRef(sc.sourceObjectRef);
    for (const tRef of sc.targetObjectRefs ?? []) addAggRef(tRef);
    for (const invRef of sc.involvedAggregates) addAggRef(invRef);
    if (sc.triggerBehaviorRef) {
      const ownerId = actionOwnerAggId.get(sc.triggerBehaviorRef);
      if (ownerId) aggIdSet.add(ownerId);
    }
    if (sc.triggerEventRef) {
      const srcId = eventSourceAggId.get(sc.triggerEventRef);
      if (srcId) aggIdSet.add(srcId);
    }
    for (const step of sc.steps) {
      addAggRef(step.targetAggregate);
      if (step.stepType === 'BEHAVIOR_CALL') {
        const ownerId = actionOwnerAggId.get(step.refId);
        if (ownerId) aggIdSet.add(ownerId);
      } else if (step.stepType === 'EVENT_EMIT') {
        const srcId = eventSourceAggId.get(step.refId);
        if (srcId) aggIdSet.add(srcId);
      } else if (step.stepType === 'RULE_EVALUATE') {
        for (const objId of sharedRuleById.get(step.refId)?.relatedObjectIds ?? []) {
          aggIdSet.add(objId);
        }
      }
    }

    const involvedIds = sortObjectIds(aggIdSet);
    if (involvedIds.length === 0) {
      unassignedScenarios.push(sc);
      continue;
    }

    const projScen: ProjectedAutomation = {
      id: sc.id,
      name: sc.name,
      displayName: sc.name,
      description: sc.description,
      involvedObjects: toObjectSummaries(involvedIds),
      scenario: sc,
      locator: { model: 'M4', elementId: sc.id },
    };
    scenarioById.set(sc.id, projScen);
    for (const aggId of involvedIds) {
      automationsByAgg.get(aggId)!.push(projScen);
    }
  }

  // ─── Queries & Reports (M7) preliminary resolution (needed for MU & MI) ─────
  const queryReports = suite.M7?.query_reports ?? [];
  const reportPrimaryAggIds = new Map<string, string[]>();
  const reportAllAggIds = new Map<string, string[]>();
  const reportBoundAction = new Map<string, ProjectedAction | undefined>();

  for (const qr of queryReports) {
    const primarySet = new Set<string>();
    const allSet = new Set<string>();

    const primAgg = resolveAggregate(qr.primarySource.aggregateRef);
    if (primAgg) {
      primarySet.add(primAgg.id);
      allSet.add(primAgg.id);
    }

    const boundAct =
      actionByKey.get(qr.behaviorRef) ??
      Array.from(actionById.values()).find((a) => a.behavior.queryReportRef === qr.id);
    reportBoundAction.set(qr.id, boundAct);
    if (boundAct) {
      const ownerId = actionOwnerAggId.get(boundAct.id);
      if (ownerId) {
        primarySet.add(ownerId);
        allSet.add(ownerId);
      }
    }

    for (const so of qr.sourceObjects ?? []) {
      const agg = resolveAggregate(so.objectRef);
      if (agg) {
        allSet.add(agg.id);
        if (so.primary) primarySet.add(agg.id);
      }
    }
    for (const jn of qr.joins) {
      const agg = resolveAggregate(jn.aggregateRef);
      if (agg) allSet.add(agg.id);
    }

    const allIds = sortObjectIds(allSet);
    const primIds = primarySet.size > 0 ? sortObjectIds(primarySet) : allIds;
    reportPrimaryAggIds.set(qr.id, primIds);
    reportAllAggIds.set(qr.id, allIds);
  }

  // ─── Screens, Navigation Edges & Cross-Cutting UI (MU) ──────────────────────
  const screens = suite.MU?.screens ?? [];
  const navEdges = suite.MU?.navigation_edges ?? [];
  const crossCuttingItems = suite.MU?.cross_cutting_ui ?? [];

  // Map M1 reverse uiBindings (both screen IDs and element IDs) -> aggregate IDs
  const m1UiRefToAggIds = new Map<string, Set<string>>();
  const recordUiBinding = (aggId: string, refs: string[] | undefined) => {
    for (const ref of refs ?? []) {
      addToSetMap(m1UiRefToAggIds, ref, aggId);
    }
  };
  for (const agg of aggregates) {
    recordUiBinding(agg.id, agg.uiBindings);
    for (const attr of agg.attributes) recordUiBinding(agg.id, attr.uiBindings);
    for (const ent of agg.entities) {
      for (const attr of ent.attributes) recordUiBinding(agg.id, attr.uiBindings);
    }
    for (const vo of agg.valueObjects) {
      for (const attr of vo.attributes) recordUiBinding(agg.id, attr.uiBindings);
    }
  }

  const screenRelatedAggIds = new Map<string, string[]>();
  for (const scr of screens) {
    const aggIdSet = new Set<string>();

    for (const id of m1UiRefToAggIds.get(scr.screenId) ?? []) aggIdSet.add(id);

    for (const el of scr.elements) {
      for (const id of m1UiRefToAggIds.get(el.elementId) ?? []) aggIdSet.add(id);
      if (el.dataBinding) {
        const agg = resolveAggregate(el.dataBinding);
        if (agg) aggIdSet.add(agg.id);
      }
      if (el.dataSource) {
        const dsAgg = resolveAggregate(el.dataSource);
        if (dsAgg) aggIdSet.add(dsAgg.id);
        for (const id of reportPrimaryAggIds.get(el.dataSource) ?? []) aggIdSet.add(id);
        const ownerId = actionOwnerAggId.get(el.dataSource);
        if (ownerId) aggIdSet.add(ownerId);
      }
    }

    for (const ev of scr.events) {
      for (const step of ev.callChain) {
        if (step.stepType === 'BEHAVIOR_CALL') {
          const ownerId = actionOwnerAggId.get(step.refId);
          if (ownerId) aggIdSet.add(ownerId);
        } else if (step.stepType === 'VALIDATE') {
          const ruleRefs = [
            ...(step.refId && step.refId !== 'VALIDATE' ? [step.refId] : []),
            ...(step.rules ?? []),
          ];
          for (const rId of ruleRefs) {
            for (const id of sharedRuleById.get(rId)?.relatedObjectIds ?? []) aggIdSet.add(id);
          }
        } else if (step.stepType === 'EVENT_EMIT') {
          const srcId = eventSourceAggId.get(step.refId);
          if (srcId) aggIdSet.add(srcId);
        } else if (step.stepType === 'SCENARIO_CALL') {
          for (const obj of scenarioById.get(step.refId)?.involvedObjects ?? []) {
            aggIdSet.add(obj.id);
          }
        } else if (step.stepType === 'REPORT_CALL' || step.stepType === 'QUERY_REPORT') {
          for (const id of reportPrimaryAggIds.get(step.refId) ?? []) aggIdSet.add(id);
          const ownerId = actionOwnerAggId.get(step.refId);
          if (ownerId) aggIdSet.add(ownerId);
        }
      }
    }

    // Fallback reverse references from M4 / M7 / M6 if screen has no direct bindings yet
    if (aggIdSet.size === 0) {
      for (const sc of scenarios) {
        if (sc.uiTriggerScreen === scr.screenId) {
          for (const obj of scenarioById.get(sc.id)?.involvedObjects ?? []) aggIdSet.add(obj.id);
        }
      }
      for (const qr of queryReports) {
        if (qr.uiScreenRefs?.includes(scr.screenId)) {
          for (const id of reportPrimaryAggIds.get(qr.id) ?? []) aggIdSet.add(id);
        }
      }
      for (const flow of suite.M6?.flows ?? []) {
        for (const act of flow.activities) {
          if (act.screenRef === scr.screenId) {
            const actOwner = act.behaviorRef ? actionOwnerAggId.get(act.behaviorRef) : undefined;
            const flowAgg = resolveAggregate(flow.primaryAggregate);
            if (actOwner) aggIdSet.add(actOwner);
            else if (flowAgg) aggIdSet.add(flowAgg.id);
          }
        }
      }
    }

    screenRelatedAggIds.set(scr.screenId, sortObjectIds(aggIdSet));
  }

  const assignedScreenIds = new Set<string>(
    Array.from(screenRelatedAggIds.entries())
      .filter(([, ids]) => ids.length > 0)
      .map(([scrId]) => scrId),
  );

  const assignedNavEdgeIds = new Set<string>();
  const navEdgesByScreen = new Map<string, NavigationEdge[]>(screens.map((s) => [s.screenId, []]));
  for (const edge of navEdges) {
    let attached = false;
    if (assignedScreenIds.has(edge.fromScreen)) {
      navEdgesByScreen.get(edge.fromScreen)?.push(edge);
      attached = true;
    }
    if (assignedScreenIds.has(edge.toScreen) && edge.toScreen !== edge.fromScreen) {
      navEdgesByScreen.get(edge.toScreen)?.push(edge);
      attached = true;
    }
    if (attached) assignedNavEdgeIds.add(edge.id);
  }

  const assignedCrossCuttingIds = new Set<string>();
  const crossCuttingByScreen = new Map<string, CrossCuttingUI[]>(
    screens.map((s) => [s.screenId, []]),
  );
  for (const cc of crossCuttingItems) {
    let attached = false;
    for (const sId of cc.scopeScreens) {
      if (sId !== '*' && assignedScreenIds.has(sId)) {
        crossCuttingByScreen.get(sId)?.push(cc);
        attached = true;
      }
    }
    if (attached) assignedCrossCuttingIds.add(cc.id);
  }

  const projectedScreenById = new Map<string, ProjectedScreen>();
  const screensByAgg = new Map<string, ProjectedScreen[]>(aggregates.map((a) => [a.id, []]));
  const unassignedScreens: ScreenItem[] = [];

  for (const scr of screens) {
    const relatedIds = screenRelatedAggIds.get(scr.screenId) ?? [];
    const projScr: ProjectedScreen = {
      id: scr.screenId,
      screenId: scr.screenId,
      name: scr.name,
      displayName: scr.name,
      description: scr.description,
      screenType: scr.screenType,
      route: scr.route,
      relatedObjects: toObjectSummaries(relatedIds),
      navigationEdges: navEdgesByScreen.get(scr.screenId) ?? [],
      crossCuttingUi: crossCuttingByScreen.get(scr.screenId) ?? [],
      screen: scr,
      locator: { model: 'MU', elementId: scr.screenId },
    };
    projectedScreenById.set(scr.screenId, projScr);

    if (relatedIds.length === 0) {
      unassignedScreens.push(scr);
    } else {
      for (const aggId of relatedIds) {
        screensByAgg.get(aggId)!.push(projScr);
        for (const el of scr.elements) {
          if (el.dictionaryRef) {
            const dictId = el.dictionaryRef.split('.')[0]!;
            if (dictById.has(dictId)) {
              assignedDictIdsByAgg.get(aggId)!.add(dictId);
              globallyAssignedDictIds.add(dictId);
            }
          }
        }
      }
    }
  }

  const unassignedNavEdges = navEdges.filter((e) => !assignedNavEdgeIds.has(e.id));
  const unassignedCrossCutting = crossCuttingItems.filter(
    (cc) => !assignedCrossCuttingIds.has(cc.id),
  );

  // ─── Integrations (MI) ──────────────────────────────────────────────────────
  const interfaces = suite.MI?.interfaces ?? [];
  const integrationsByAgg = new Map<string, ProjectedIntegration[]>(
    aggregates.map((a) => [a.id, []]),
  );
  const unassignedInterfaces: InterfaceItem[] = [];

  for (const intf of interfaces) {
    const aggIdSet = new Set<string>();
    const entAgg = resolveAggregate(intf.relatedEntityRef);
    if (entAgg) aggIdSet.add(entAgg.id);

    if (intf.relatedBehaviorRef) {
      const ownerId = actionOwnerAggId.get(intf.relatedBehaviorRef);
      if (ownerId) aggIdSet.add(ownerId);
    }
    if (intf.relatedEventRef) {
      const srcId = eventSourceAggId.get(intf.relatedEventRef);
      if (srcId) aggIdSet.add(srcId);
    }
    if (intf.relatedReportRef) {
      for (const id of reportPrimaryAggIds.get(intf.relatedReportRef) ?? []) {
        aggIdSet.add(id);
      }
    }

    const mappedRefs: string[] = [];
    collectInterfaceMappedRefs(intf.inputFields, mappedRefs);
    collectInterfaceMappedRefs(intf.outputFields, mappedRefs);
    for (const mRef of mappedRefs) {
      const agg = resolveAggregate(mRef);
      if (agg) aggIdSet.add(agg.id);
    }

    const relatedIds = sortObjectIds(aggIdSet);
    if (relatedIds.length === 0) {
      unassignedInterfaces.push(intf);
      continue;
    }

    const projIntf: ProjectedIntegration = {
      id: intf.interfaceId,
      interfaceId: intf.interfaceId,
      name: intf.name,
      displayName: intf.name,
      description: intf.description ?? intf.businessPurpose,
      direction: intf.direction,
      interfaceCategory: intf.interfaceCategory,
      externalActor: intf.relatedExternalEntityRef
        ? actorById.get(intf.relatedExternalEntityRef)
        : undefined,
      relatedObjects: toObjectSummaries(relatedIds),
      interfaceItem: intf,
      locator: { model: 'MI', elementId: intf.interfaceId },
    };

    for (const aggId of relatedIds) {
      integrationsByAgg.get(aggId)!.push(projIntf);
    }
  }

  // ─── Data Storage (MM) ──────────────────────────────────────────────────────
  const mappings = suite.MM?.mappings ?? [];
  const storageByAgg = new Map<string, ProjectedDataStorage[]>(aggregates.map((a) => [a.id, []]));
  const unassignedMappings: ObjectTableMapping[] = [];

  for (const mp of mappings) {
    const aggIdSet = new Set<string>();
    const byObjRef = resolveAggregate(mp.objectRef);
    const byObjName = resolveAggregate(mp.objectName);
    if (byObjRef) aggIdSet.add(byObjRef.id);
    else if (byObjName) aggIdSet.add(byObjName.id);

    if (aggIdSet.size === 0 && mp.objectRole === 'ASSOCIATION') {
      const assoc = assocById.get(mp.objectRef);
      if (assoc) {
        const sAgg = resolveAggregate(assoc.sourceAggregate);
        const tAgg = resolveAggregate(assoc.targetAggregate);
        if (sAgg) aggIdSet.add(sAgg.id);
        if (tAgg) aggIdSet.add(tAgg.id);
      }
    }

    if (aggIdSet.size === 0) {
      for (const tm of mp.tableMappings) {
        for (const cm of tm.columnMappings) {
          const agg = resolveAggregate(cm.attributeRef);
          if (agg) aggIdSet.add(agg.id);
        }
      }
    }

    const relatedIds = sortObjectIds(aggIdSet);
    if (relatedIds.length === 0) {
      unassignedMappings.push(mp);
      continue;
    }

    const tableNames = mp.tableMappings.map((t) => t.tableName);
    const projStorage: ProjectedDataStorage = {
      id: mp.id,
      objectName: mp.objectName,
      displayName: tableNames.length > 0 ? tableNames.join('、') : mp.objectName,
      description: mp.mappingNote,
      tableNames,
      relatedObjects: toObjectSummaries(relatedIds),
      mapping: mp,
      locator: { model: 'MM', elementId: mp.id },
    };

    for (const aggId of relatedIds) {
      storageByAgg.get(aggId)!.push(projStorage);
    }
  }

  // ─── Build Per-Business-Object Projections ──────────────────────────────────
  const projectAttribute = (
    agg: AggregateRoot,
    attr: Attribute,
    ownerKind: ProjectedField['ownerKind'],
    ownerName: string,
    ownerDisplayName: string,
    attrPath: string,
    voByKey: Map<string, ProjectedValueObject>,
    ownAttributeRules: ProjectedAttributeRule[],
  ): ProjectedField => {
    const targetAgg =
      attr.type === 'AggregateRootRef' && attr.targetAggregate
        ? resolveAggregate(attr.targetAggregate)
        : undefined;

    let dictionaryBinding: ProjectedDictionaryBinding | undefined;
    if (attr.dictionaryRef) {
      const dict = dictById.get(attr.dictionaryRef.dictionaryId);
      if (dict) {
        assignedDictIdsByAgg.get(agg.id)!.add(dict.id);
        globallyAssignedDictIds.add(dict.id);
        const dictType = dict.types.find((t) => t.typeCode === attr.dictionaryRef!.typeCode);
        dictionaryBinding = {
          dictionaryId: dict.id,
          dictionaryName: dict.name,
          typeCode: attr.dictionaryRef.typeCode,
          typeName: dictType?.typeName ?? attr.dictionaryRef.typeCode,
          items: (dictType?.items ?? []).filter((item) => item.enabled !== false),
          locator: { model: 'M1', elementId: dict.id },
        };
      }
    }

    const fieldDisplayName = nonEmpty(attr.label, attr.name);
    const thisSummary = summaryById.get(agg.id)!;

    for (const r of attr.refRules ?? []) {
      ownAttributeRules.push({
        id: `M1-ATTR-RULE:${agg.id}:${attrPath}:${r.name}`,
        kind: 'ATTRIBUTE_RULE',
        name: r.name,
        displayName: nonEmpty(r.description, nonEmpty(r.violationMessage, r.name)),
        description: r.violationMessage,
        expression: r.expression,
        violationMessage: r.violationMessage,
        enforcedAt: r.enforcedAt,
        fieldName: attr.name,
        fieldDisplayName,
        relatedObjectIds: [agg.id],
        relatedObjects: [thisSummary],
        isCrossObject: false,
        attributeRule: r,
        locator: {
          model: 'M1',
          elementId: agg.id,
          path: `${attrPath}.refRules.${r.name}`,
        },
      });
    }

    return {
      id: `${agg.id}:${attrPath}`,
      name: attr.name,
      label: attr.label,
      displayName: fieldDisplayName,
      type: attr.type,
      required: attr.required,
      unique: attr.unique,
      defaultValue: attr.defaultValue,
      description: attr.description,
      enumValues: attr.enumValues,
      ownerKind,
      ownerName,
      ownerDisplayName,
      targetObject: targetAgg ? summaryById.get(targetAgg.id) : undefined,
      dictionary: dictionaryBinding,
      valueObject: attr.valueObjectRef ? voByKey.get(attr.valueObjectRef) : undefined,
      attribute: attr,
      locator: {
        model: 'M1',
        elementId: agg.id,
        path: attrPath,
      },
    };
  };

  const objectProjections: BusinessObjectProjection[] = aggregates.map((agg) => {
    const aggDisplayName = nonEmpty(agg.alias, agg.name);
    const thisSummary = summaryById.get(agg.id)!;
    const ownAttributeRules: ProjectedAttributeRule[] = [];

    // 1. Value objects first so root/sub-entity attributes can reference them
    const voByKey = new Map<string, ProjectedValueObject>();
    const projectedValueObjects: ProjectedValueObject[] = agg.valueObjects.map((vo) => {
      const voDisplay = nonEmpty(vo.alias, vo.name);
      const voFields = vo.attributes.map((attr) =>
        projectAttribute(
          agg,
          attr,
          'VALUE_OBJECT',
          vo.name,
          voDisplay,
          `aggregates.${agg.id}.valueObjects.${vo.name}.attributes.${attr.name}`,
          voByKey,
          ownAttributeRules,
        ),
      );
      const projVo: ProjectedValueObject = {
        id: `${agg.id}:VO:${vo.name}`,
        name: vo.name,
        alias: vo.alias,
        displayName: voDisplay,
        description: vo.description,
        immutable: vo.immutable,
        equalityFields: vo.equalityFields,
        fields: voFields,
        valueObject: vo,
        locator: {
          model: 'M1',
          elementId: agg.id,
          path: `aggregates.${agg.id}.valueObjects.${vo.name}`,
        },
      };
      voByKey.set(vo.name, projVo);
      voByKey.set(vo.alias, projVo);
      return projVo;
    });

    // 2. Aggregate root direct fields (in authoring order)
    const rootAttrRules: ProjectedAttributeRule[] = [];
    const projectedFields: ProjectedField[] = agg.attributes.map((attr) =>
      projectAttribute(
        agg,
        attr,
        'AGGREGATE',
        agg.name,
        aggDisplayName,
        `aggregates.${agg.id}.attributes.${attr.name}`,
        voByKey,
        rootAttrRules,
      ),
    );

    // 3. Sub-entities
    const subEntAttrRules: ProjectedAttributeRule[] = [];
    const projectedSubEntities: ProjectedSubEntity[] = agg.entities.map((ent) => {
      const entDisplay = nonEmpty(ent.alias, ent.name);
      const entFields = ent.attributes.map((attr) =>
        projectAttribute(
          agg,
          attr,
          'SUB_ENTITY',
          ent.name,
          entDisplay,
          `aggregates.${agg.id}.entities.${ent.name}.attributes.${attr.name}`,
          voByKey,
          subEntAttrRules,
        ),
      );
      return {
        id: `${agg.id}:ENT:${ent.localId}`,
        localId: ent.localId,
        name: ent.name,
        alias: ent.alias,
        displayName: entDisplay,
        description: ent.description,
        cardinality: ent.cardinality,
        cascadeDelete: ent.cascadeDelete,
        fields: entFields,
        subEntity: ent,
        locator: {
          model: 'M1',
          elementId: agg.id,
          path: `aggregates.${agg.id}.entities.${ent.name}`,
        },
      };
    });

    // 4. Invariants + combined business rules
    const projectedInvariants: ProjectedInvariantRule[] = agg.invariants.map((inv) => ({
      id: `M1-INVARIANT:${agg.id}:${inv.name}`,
      kind: 'INVARIANT',
      name: inv.name,
      displayName: nonEmpty(inv.violationMessage, inv.name),
      description: inv.violationMessage,
      expression: inv.expression,
      violationMessage: inv.violationMessage,
      enforcedAt: inv.enforcedAt,
      relatedObjectIds: [agg.id],
      relatedObjects: [thisSummary],
      isCrossObject: false,
      invariant: inv,
      locator: {
        model: 'M1',
        elementId: agg.id,
        path: `aggregates.${agg.id}.invariants.${inv.name}`,
      },
    }));

    const businessRules: ProjectedBusinessRule[] = [
      ...rootAttrRules,
      ...subEntAttrRules,
      ...ownAttributeRules,
      ...projectedInvariants,
      ...(m3RulesByAgg.get(agg.id) ?? []),
    ];

    // 5. Actions & Authorized Roles ("谁能做")
    const objActions = actionsByAgg.get(agg.id) ?? [];
    const objActionIds = new Set(objActions.map((a) => a.id));

    const authorizedRoles: ProjectedObjectRoleAuth[] = [];
    for (const role of roles) {
      const directPerms = roleDirectPermsMap.get(role.id) ?? [];
      const effectivePerms = roleEffectivePermsMap.get(role.id) ?? [];

      const directAllowedIds = new Set<string>();
      for (const p of directPerms) {
        for (const act of p.allowedActions) {
          if (objActionIds.has(act.id)) directAllowedIds.add(act.id);
        }
      }

      const effectiveAllowedIds = new Set<string>();
      const relevantPerms: PermissionItem[] = [];
      for (const p of effectivePerms) {
        const targetsThisObj = p.targetObject?.id === agg.id;
        let grantsObjAction = false;
        for (const act of p.allowedActions) {
          if (objActionIds.has(act.id)) {
            effectiveAllowedIds.add(act.id);
            grantsObjAction = true;
          }
        }
        if (targetsThisObj || grantsObjAction) {
          relevantPerms.push(p.permission);
        }
      }

      if (effectiveAllowedIds.size === 0 && relevantPerms.length === 0) {
        continue;
      }

      const grantedActions = objActions.filter((a) => effectiveAllowedIds.has(a.id));
      const directActionIds = grantedActions
        .filter((a) => directAllowedIds.has(a.id))
        .map((a) => a.id);
      const inheritedActionIds = grantedActions
        .filter((a) => !directAllowedIds.has(a.id))
        .map((a) => a.id);

      authorizedRoles.push({
        roleId: role.id,
        name: role.name,
        displayName: role.name,
        code: role.code,
        description: role.description,
        dataScope: role.dataScope,
        actors: actorsByRoleId.get(role.id) ?? [],
        actions: grantedActions,
        directActionIds,
        inheritedActionIds,
        permissions: relevantPerms,
        role,
        locator: { model: 'M5', elementId: role.id },
      });
    }

    const automaticActions = objActions.filter((a) => a.isAutomatic);
    const unauthorizedActions = objActions.filter(
      (a) => !a.isAutomatic && a.authorizedRoleIds.length === 0,
    );

    const boundDictIds = assignedDictIdsByAgg.get(agg.id) ?? new Set<string>();
    const projectedDictionaries: ProjectedDictionary[] = dictionaries
      .filter((d) => boundDictIds.has(d.id))
      .map((d) => ({
        id: d.id,
        name: d.name,
        displayName: d.name,
        description: d.description,
        dictionary: d,
        locator: { model: 'M1', elementId: d.id },
      }));

    return {
      id: agg.id,
      name: agg.name,
      alias: agg.alias,
      displayName: aggDisplayName,
      description: agg.description,
      lifecycle: agg.lifecycle,
      tags: agg.tags,
      aggregate: agg,
      locator: { model: 'M1', elementId: agg.id },

      fields: projectedFields,
      subEntities: projectedSubEntities,
      valueObjects: projectedValueObjects,
      associations: assignedAssocByAgg.get(agg.id) ?? [],
      dictionaries: projectedDictionaries,
      actions: objActions,
      businessRules,
      authorizedRoles,
      automaticActions,
      unauthorizedActions,

      events: eventsByAgg.get(agg.id) ?? [],
      automations: automationsByAgg.get(agg.id) ?? [],
      screens: screensByAgg.get(agg.id) ?? [],
      integrations: integrationsByAgg.get(agg.id) ?? [],
      dataStorage: storageByAgg.get(agg.id) ?? [],
    };
  });

  // ─── Three Cross-Object Views (M6, M5, M7) ──────────────────────────────────
  const rawFlows = suite.M6?.flows ?? [];
  const directFlowObjIds = new Map<string, Set<string>>();
  const subFlowCallees = new Map<string, string[]>();
  const flowRoleSets = new Map<string, Map<string, ProjectedRoleSummary>>();
  const flowProjectedActivities = new Map<string, ProjectedFlowActivity[]>();

  for (const flow of rawFlows) {
    const objIdSet = new Set<string>();
    const callees: string[] = [];

    const primAgg = resolveAggregate(flow.primaryAggregate);
    if (primAgg) objIdSet.add(primAgg.id);
    for (const boRef of flow.businessObjectRefs ?? []) {
      const agg = resolveAggregate(boRef);
      if (agg) objIdSet.add(agg.id);
    }

    const trigBeh =
      flow.trigger.behaviorRef ??
      ((flow.trigger.triggerType === 'USER_ACTION' || flow.trigger.triggerType === 'BEHAVIOR')
        ? flow.trigger.refId
        : undefined);
    if (trigBeh && actionOwnerAggId.has(trigBeh)) {
      objIdSet.add(actionOwnerAggId.get(trigBeh)!);
    }
    const trigEv =
      flow.trigger.eventRef ??
      (flow.trigger.triggerType === 'EVENT' ? flow.trigger.refId : undefined);
    if (trigEv && eventSourceAggId.has(trigEv)) {
      objIdSet.add(eventSourceAggId.get(trigEv)!);
    }

    const roleSet = new Map<string, ProjectedRoleSummary>();
    for (const rRef of flow.roleRefs) {
      const r = roleSummaryByKey.get(rRef);
      if (r) roleSet.set(r.id, r);
    }

    const projActivities: ProjectedFlowActivity[] = flow.activities.map((act) => {
      const role = act.roleRef ? roleSummaryByKey.get(act.roleRef) : undefined;
      if (role) roleSet.set(role.id, role);

      const action = act.behaviorRef ? actionByKey.get(act.behaviorRef) : undefined;
      if (action && actionOwnerAggId.has(action.id)) {
        objIdSet.add(actionOwnerAggId.get(action.id)!);
      }
      if (act.scenarioRef) {
        for (const obj of scenarioById.get(act.scenarioRef)?.involvedObjects ?? []) {
          objIdSet.add(obj.id);
        }
      }
      if (act.ruleRef) {
        for (const id of sharedRuleById.get(act.ruleRef)?.relatedObjectIds ?? []) {
          objIdSet.add(id);
        }
      }
      if (act.eventRef && eventSourceAggId.has(act.eventRef)) {
        objIdSet.add(eventSourceAggId.get(act.eventRef)!);
      }
      if (act.subFlowRef) {
        callees.push(act.subFlowRef);
      }
      for (const br of act.branches) {
        if (br.ruleRef) {
          for (const id of sharedRuleById.get(br.ruleRef)?.relatedObjectIds ?? []) {
            objIdSet.add(id);
          }
        }
      }

      return {
        id: act.id,
        name: act.name,
        displayName: act.name,
        activityType: act.activityType,
        role,
        action,
        screen: act.screenRef ? projectedScreenById.get(act.screenRef) : undefined,
        branches: act.branches,
        activity: act,
        locator: {
          model: 'M6',
          elementId: flow.id,
          path: `flows.${flow.id}.activities.${act.id}`,
        },
      };
    });

    directFlowObjIds.set(flow.id, objIdSet);
    subFlowCallees.set(flow.id, callees);
    flowRoleSets.set(flow.id, roleSet);
    flowProjectedActivities.set(flow.id, projActivities);
  }

  const collectFlowObjIds = (flowId: string, visited = new Set<string>()): Set<string> => {
    const out = new Set<string>(directFlowObjIds.get(flowId) ?? []);
    if (visited.has(flowId)) return out;
    visited.add(flowId);
    for (const calleeId of subFlowCallees.get(flowId) ?? []) {
      for (const id of collectFlowObjIds(calleeId, visited)) {
        out.add(id);
      }
    }
    return out;
  };

  const projectedFlows: ProjectedFlow[] = rawFlows.map((flow) => {
    const primAgg = resolveAggregate(flow.primaryAggregate);
    return {
      id: flow.id,
      name: flow.name,
      displayName: flow.name,
      description: flow.description,
      flowType: flow.flowType,
      primaryObject: primAgg ? summaryById.get(primAgg.id) : undefined,
      referencedObjects: toObjectSummaries(collectFlowObjIds(flow.id)),
      participatingRoles: Array.from((flowRoleSets.get(flow.id) ?? new Map()).values()),
      activities: flowProjectedActivities.get(flow.id) ?? [],
      flow,
      locator: { model: 'M6', elementId: flow.id },
    };
  });

  const projectedRoles: ProjectedRole[] = roles.map((role) => {
    const directPerms = roleDirectPermsMap.get(role.id) ?? [];
    const effectivePerms = roleEffectivePermsMap.get(role.id) ?? [];

    const objectGrants: ProjectedRoleObjectGrant[] = [];
    for (const objProj of objectProjections) {
      const roleEntry = objProj.authorizedRoles.find((ar) => ar.roleId === role.id);
      if (!roleEntry) continue;
      const permIds = new Set(roleEntry.permissions.map((p) => p.id));
      objectGrants.push({
        object: summaryById.get(objProj.id)!,
        actions: roleEntry.actions,
        directActionIds: roleEntry.directActionIds,
        inheritedActionIds: roleEntry.inheritedActionIds,
        permissions: effectivePerms.filter((p) => permIds.has(p.id)),
      });
    }

    return {
      id: role.id,
      name: role.name,
      displayName: role.name,
      code: role.code,
      description: role.description,
      dataScope: role.dataScope,
      actors: actorsByRoleId.get(role.id) ?? [],
      directPermissions: directPerms,
      effectivePermissions: effectivePerms,
      objectGrants,
      role,
      locator: { model: 'M5', elementId: role.id },
    };
  });

  const projectedQueryReports: ProjectedQueryReport[] = queryReports.map((qr) => {
    const primAgg = resolveAggregate(qr.primarySource.aggregateRef);
    const allIds = reportAllAggIds.get(qr.id) ?? [];
    const screenSet = new Map<string, ProjectedScreen>();

    for (const sId of qr.uiScreenRefs ?? []) {
      const scr = projectedScreenById.get(sId);
      if (scr) screenSet.set(scr.id, scr);
    }
    for (const scr of screens) {
      const bindsReport =
        scr.elements.some((el) => el.dataSource === qr.id) ||
        scr.events.some((ev) =>
          ev.callChain.some(
            (st) =>
              (st.stepType === 'REPORT_CALL' || st.stepType === 'QUERY_REPORT') &&
              st.refId === qr.id,
          ),
        );
      if (bindsReport) {
        const projScr = projectedScreenById.get(scr.screenId);
        if (projScr) screenSet.set(projScr.id, projScr);
      }
    }

    return {
      id: qr.id,
      name: qr.name,
      alias: qr.alias,
      displayName: nonEmpty(qr.alias, qr.name),
      description: qr.description,
      queryType: qr.queryType,
      category: qr.queryType === 'REPORT' ? 'REPORT' : 'QUERY',
      primaryObject: primAgg ? summaryById.get(primAgg.id) : undefined,
      sourceObjects: toObjectSummaries(allIds),
      boundAction: reportBoundAction.get(qr.id),
      screens: Array.from(screenSet.values()),
      item: qr,
      locator: { model: 'M7', elementId: qr.id },
    };
  });

  // ─── Unassigned / "Other" Group ("不丢元素") ─────────────────────────────────
  const other: ProjectedOtherItem[] = [];

  for (const dict of dictionaries) {
    if (!globallyAssignedDictIds.has(dict.id)) {
      other.push({
        id: dict.id,
        kind: 'DATA_DICTIONARY',
        displayName: dict.name,
        description: dict.description,
        element: dict,
        locator: { model: 'M1', elementId: dict.id },
      });
    }
  }

  for (const assoc of associations) {
    if (!globallyAssignedAssocIds.has(assoc.id)) {
      other.push({
        id: assoc.id,
        kind: 'ASSOCIATION',
        displayName: `${assoc.sourceRole} → ${assoc.targetRole}`,
        description: assoc.description,
        element: assoc,
        locator: { model: 'M1', elementId: assoc.id },
      });
    }
  }

  for (const beh of unassignedActions) {
    other.push({
      id: beh.id,
      kind: 'ACTION',
      displayName: nonEmpty(beh.alias, beh.name),
      description: beh.description,
      element: beh,
      locator: { model: 'M2', elementId: beh.id },
    });
  }

  for (const rule of unassignedRules) {
    other.push({
      id: rule.id,
      kind: 'RULE',
      displayName: nonEmpty(rule.alias, rule.name),
      description: rule.description ?? rule.violationMessage,
      element: rule,
      locator: { model: 'M3', elementId: rule.id },
    });
  }

  for (const ev of unassignedEvents) {
    other.push({
      id: ev.id,
      kind: 'EVENT',
      displayName: nonEmpty(ev.label, ev.name),
      description: ev.description,
      element: ev,
      locator: { model: 'ME', elementId: ev.id },
    });
  }

  for (const sc of unassignedScenarios) {
    other.push({
      id: sc.id,
      kind: 'AUTOMATION',
      displayName: sc.name,
      description: sc.description,
      element: sc,
      locator: { model: 'M4', elementId: sc.id },
    });
  }

  for (const scr of unassignedScreens) {
    other.push({
      id: scr.screenId,
      kind: 'SCREEN',
      displayName: scr.name,
      description: scr.description,
      element: scr,
      locator: { model: 'MU', elementId: scr.screenId },
    });
  }

  for (const edge of unassignedNavEdges) {
    other.push({
      id: edge.id,
      kind: 'NAVIGATION_EDGE',
      displayName: `${edge.fromScreen} → ${edge.toScreen}`,
      description: edge.condition,
      element: edge,
      locator: { model: 'MU', elementId: edge.id },
    });
  }

  for (const cc of unassignedCrossCutting) {
    other.push({
      id: cc.id,
      kind: 'CROSS_CUTTING_UI',
      displayName: cc.name,
      description: cc.description,
      element: cc,
      locator: { model: 'MU', elementId: cc.id },
    });
  }

  for (const mp of unassignedMappings) {
    const tableNames = mp.tableMappings.map((t) => t.tableName);
    other.push({
      id: mp.id,
      kind: 'DATA_STORAGE',
      displayName: tableNames.length > 0 ? tableNames.join('、') : mp.objectName,
      description: mp.mappingNote,
      element: mp,
      locator: { model: 'MM', elementId: mp.id },
    });
  }

  for (const intf of unassignedInterfaces) {
    other.push({
      id: intf.interfaceId,
      kind: 'INTEGRATION',
      displayName: intf.name,
      description: intf.description ?? intf.businessPurpose,
      element: intf,
      locator: { model: 'MI', elementId: intf.interfaceId },
    });
  }

  return {
    objects: objectProjections,
    sharedRules,
    flowsAndApprovals: {
      flows: projectedFlows,
    },
    rolesAndPermissions: {
      roles: projectedRoles,
      actors: projectedActors,
      permissionGroups: projectedPermissionGroups,
      permissions: projectedPermissions,
    },
    queriesAndReports: {
      items: projectedQueryReports,
      queries: projectedQueryReports.filter((i) => i.category === 'QUERY'),
      reports: projectedQueryReports.filter((i) => i.category === 'REPORT'),
    },
    other,
  };
}
