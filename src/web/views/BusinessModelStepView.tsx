import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Code2,
  FileCode2,
  History,
  Info,
  Link2,
  Network,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import {
  BUSINESS_VOCABULARY,
  MODEL_BUSINESS_NAMES,
  checkBusinessViewMarkup,
  getModelBusinessName,
  pickBusinessText,
  sanitizeBusinessText as sanitizeSharedBusinessText,
  type BusinessLocale,
  type ProjectStepStateId,
} from '../../packages/business-vocabulary/index.js';
import {
  DEFAULT_COLLAPSED_OBJECT_SECTIONS,
  DEFAULT_EXPANDED_OBJECT_SECTIONS,
  projectByBusinessObject,
  type ActorItem,
  type AggregateAssociation,
  type Attribute,
  type BusinessModelProjection,
  type BusinessObjectProjection,
  type CrossCuttingUI,
  type DefaultCollapsedObjectSection,
  type DefaultExpandedObjectSection,
  type ModelCode,
  type NavigationEdge,
  type OntologySuite,
  type OtherElementKind,
  type ProjectedBusinessRule,
  type ProjectedDataStorage,
  type ProjectedField,
  type ProjectedOtherItem,
  type TechnicalLocator,
  type ValidationDiagnostic,
} from '../../packages/ontology-core/index.js';
import {
  getProjectLifecycleState,
  useWorkbenchStore,
  type ArtifactHistoryEntryView,
  type ArtifactJumpTarget,
  type BusinessModelInlineEditTarget,
} from '../api.js';
import { useAgentPanelStore } from '../components/agent/agentPanelStore.js';
import { ArtifactHistoryDrawer } from '../components/history/index.js';
import { usePreferences, type NavViewId } from '../i18n.js';
import {
  getProjectStepsFromBootstrap,
  resolveLegacyBusinessModelTechTab,
  useStepViewMode,
  writeStepViewMode,
  type BusinessModelTechTab,
  type StepViewMode,
} from '../navigation/index.js';
import { Button } from '../components/beautifui/index.js';
import { ModelFilesView } from './application-center/ModelFilesView.js';
import { KnowledgeGraphWorkbenchView } from './KnowledgeGraphWorkbenchView.js';
import {
  OntologyWorkbenchView,
  type OntologyWorkbenchFocusTarget,
} from './OntologyWorkbenchView.js';
import './business-model-step.css';

export type { OntologyWorkbenchFocusTarget };

export const BUSINESS_MODEL_CROSS_VIEW_IDS = [
  'view:flows',
  'view:roles',
  'view:reports',
] as const;

export type BusinessModelCrossViewId = (typeof BUSINESS_MODEL_CROSS_VIEW_IDS)[number];

export type BusinessModelPageId =
  | string
  | BusinessModelCrossViewId
  | 'view:other';

export interface InlineEditDraftState {
  readonly slotKey: string;
  readonly draftValue: string;
}

export interface InlineRejectionState {
  readonly slotKey: string;
  readonly reasonZh: string;
  readonly reasonEn: string;
  readonly assistantPromptZh: string;
  readonly assistantPromptEn: string;
}

export interface BusinessModelStepViewProps {
  readonly onNavigate?: (view: NavViewId) => void;
  readonly activePageId?: string | null;
  readonly onSelectPage?: (pageId: BusinessModelPageId) => void;
  readonly viewModeOverride?: StepViewMode;
  readonly legacyTechTab?: BusinessModelTechTab | null;
  readonly headerActions?: React.ReactNode;
  readonly flashTarget?: { readonly anchorId: string; readonly at: number } | null;
  readonly initialInlineEditState?: InlineEditDraftState | null;
  readonly initialRejectionState?: InlineRejectionState | null;
  readonly defaultExpandedSections?: readonly (
    | DefaultExpandedObjectSection
    | DefaultCollapsedObjectSection
  )[];
  readonly defaultShowIncomplete?: boolean;
}

export function resolveBusinessModelPageId(
  projection: BusinessModelProjection,
  rawTarget?: string | null,
): BusinessModelPageId {
  const fallback: BusinessModelPageId = projection.objects[0]?.id ?? 'view:flows';
  const cleaned = rawTarget?.trim();
  if (!cleaned) return fallback;

  const stripped = cleaned.startsWith('obj:') ? cleaned.slice(4).trim() : cleaned;
  const lower = stripped.toLowerCase();

  if (lower === 'view:flows' || lower === 'flows' || lower === 'flowsandapprovals') {
    return 'view:flows';
  }
  if (lower === 'view:roles' || lower === 'roles' || lower === 'rolesandpermissions') {
    return 'view:roles';
  }
  if (lower === 'view:reports' || lower === 'reports' || lower === 'queriesandreports') {
    return 'view:reports';
  }
  if ((lower === 'view:other' || lower === 'other') && projection.other.length > 0) {
    return 'view:other';
  }

  const matchedObject = projection.objects.find(
    (obj) =>
      obj.id === stripped ||
      obj.name === stripped ||
      obj.alias === stripped ||
      obj.displayName === stripped ||
      obj.id.toLowerCase() === lower ||
      obj.name.toLowerCase() === lower,
  );
  if (matchedObject) return matchedObject.id;

  return fallback;
}

/**
 * Navigates to the Business Model step in Business View (`'business'`) and
 * selects the given Business Object (by aggregate id, technical name, or business name)
 * or cross-object view. Shared by Command Palette (#68) and Change Summary (#70).
 */
export function navigateToBusinessModelObject(objectOrPageId: string): void {
  writeStepViewMode('BUSINESS_MODEL', 'business');
  useWorkbenchStore.getState().setActiveNav('app-ontology', { itemId: objectOrPageId });
}

/* ─── Business-Language Formatting & Sanitization ─── */

const FIELD_TYPE_LABELS: Readonly<
  Record<Attribute['type'], { readonly zh: string; readonly en: string }>
> = {
  String: { zh: '文本', en: 'Text' },
  Integer: { zh: '整数', en: 'Whole number' },
  Decimal: { zh: '数字', en: 'Number' },
  Date: { zh: '日期', en: 'Date' },
  DateTime: { zh: '日期时间', en: 'Date & time' },
  Boolean: { zh: '是 / 否', en: 'Yes / No' },
  Enum: { zh: '选项', en: 'Option' },
  Money: { zh: '金额', en: 'Amount' },
  ValueObject: { zh: '组合信息', en: 'Grouped info' },
  AggregateRootRef: { zh: '关联对象', en: 'Linked object' },
  DictionaryRef: { zh: '选项', en: 'Option' },
};

const LIFECYCLE_STATE_LABELS: Readonly<
  Record<string, { readonly zh: string; readonly en: string }>
> = {
  DRAFT: { zh: '草稿', en: 'Draft' },
  PENDING_APPROVAL: { zh: '待审批', en: 'Pending approval' },
  APPROVED: { zh: '已批准', en: 'Approved' },
  REJECTED: { zh: '已驳回', en: 'Rejected' },
  SIGNED: { zh: '已签署', en: 'Signed' },
  EXECUTING: { zh: '履约中', en: 'Executing' },
  ARCHIVED: { zh: '已归档', en: 'Archived' },
  TERMINATED: { zh: '已终止', en: 'Terminated' },
  ACTIVE: { zh: '启用', en: 'Active' },
  INACTIVE: { zh: '停用', en: 'Inactive' },
  BLACKLISTED: { zh: '黑名单', en: 'Blacklisted' },
  SUSPENDED: { zh: '已暂停', en: 'Suspended' },
  CREATED: { zh: '已创建', en: 'Created' },
  VERIFIED: { zh: '已核验', en: 'Verified' },
  PAID: { zh: '已结算', en: 'Paid' },
  CLOSED: { zh: '已关闭', en: 'Closed' },
  QUEUED: { zh: '排队中', en: 'Queued' },
  TRANSFERRING: { zh: '传输中', en: 'Transferring' },
  COMPLETED: { zh: '已完成', en: 'Completed' },
  FAILED: { zh: '失败', en: 'Failed' },
  QUARANTINED: { zh: '已隔离', en: 'Quarantined' },
};

const SCREEN_TYPE_LABELS: Readonly<
  Record<string, { readonly zh: string; readonly en: string }>
> = {
  LIST: { zh: '列表页面', en: 'List screen' },
  FORM: { zh: '编辑表单', en: 'Form screen' },
  DETAIL: { zh: '详情页面', en: 'Detail screen' },
  APPROVAL: { zh: '审批页面', en: 'Approval screen' },
  DASHBOARD: { zh: '看板页面', en: 'Dashboard screen' },
  MODAL: { zh: '弹窗界面', en: 'Dialog screen' },
  WORKSPACE: { zh: '工作台界面', en: 'Workspace screen' },
};

const OTHER_KIND_LABELS: Readonly<
  Record<OtherElementKind, { readonly zh: string; readonly en: string }>
> = {
  DATA_DICTIONARY: { zh: '业务选项字典', en: 'Option dictionary' },
  ASSOCIATION: { zh: '对象关联', en: 'Object relation' },
  ACTION: { zh: '业务操作', en: 'Action' },
  RULE: { zh: '业务规则', en: 'Business rule' },
  EVENT: { zh: '业务事件', en: 'Business event' },
  AUTOMATION: { zh: '自动联动', en: 'Automation' },
  SCREEN: { zh: '界面', en: 'Screen' },
  NAVIGATION_EDGE: { zh: '界面跳转', en: 'Screen navigation' },
  CROSS_CUTTING_UI: { zh: '全局界面元素', en: 'Shared screen element' },
  DATA_STORAGE: { zh: '数据存储', en: 'Data storage' },
  INTEGRATION: { zh: '对外接口', en: 'Integration' },
};

const ASSOCIATION_CARDINALITY_LABELS: Readonly<
  Record<AggregateAssociation['cardinality'], { readonly zh: string; readonly en: string }>
> = {
  ONE_TO_ONE: { zh: '一对一', en: 'One-to-one' },
  ONE_TO_MANY: { zh: '一对多', en: 'One-to-many' },
  MANY_TO_ONE: { zh: '多对一', en: 'Many-to-one' },
  MANY_TO_MANY: { zh: '多对多', en: 'Many-to-many' },
};

const NAV_MODE_LABELS: Readonly<
  Record<NavigationEdge['mode'], { readonly zh: string; readonly en: string }>
> = {
  PUSH: { zh: '进入页面', en: 'Opens screen' },
  MODAL: { zh: '弹窗打开', en: 'Opens dialog' },
  REPLACE: { zh: '切换页面', en: 'Replaces screen' },
  BACK: { zh: '返回上一页', en: 'Returns to previous screen' },
};

const CROSS_CUTTING_TYPE_LABELS: Readonly<
  Record<CrossCuttingUI['type'], { readonly zh: string; readonly en: string }>
> = {
  GLOBAL_GUARD: { zh: '全局守卫提示', en: 'Global guard' },
  SHORTCUT: { zh: '快捷操作', en: 'Shortcut' },
  TIMEOUT: { zh: '超时控制', en: 'Timeout rule' },
  NOTIFICATION: { zh: '全局通知', en: 'Global notification' },
};

const ACTOR_TYPE_LABELS: Readonly<
  Record<ActorItem['actorType'], { readonly zh: string; readonly en: string }>
> = {
  HUMAN: { zh: '业务人员', en: 'Person' },
  SYSTEM: { zh: '内部系统', en: 'Internal system' },
  EXTERNAL_ENTITY: { zh: '外部协作方', en: 'External partner' },
};

function quoteTerm(label: string, locale: BusinessLocale): string {
  return locale === 'en-US' ? `"${label}"` : `「${label}」`;
}

function buildElementDisplayMap(
  suite: OntologySuite,
  locale: BusinessLocale,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  const register = (id: string | undefined, rawLabel: string | undefined) => {
    const key = id?.trim();
    const val = rawLabel?.trim();
    if (!key || !val) return;
    if (checkBusinessViewMarkup(val, { plainText: true }).length === 0) {
      map.set(key, quoteTerm(val, locale));
    }
  };

  for (const agg of suite.M1?.aggregates ?? []) {
    register(agg.id, agg.alias || agg.name);
  }
  for (const dict of suite.M1?.data_dictionaries ?? []) {
    register(dict.id, dict.name);
  }
  for (const assoc of suite.M1?.aggregate_associations ?? []) {
    register(assoc.id, assoc.description || `${assoc.sourceRole}-${assoc.targetRole}`);
  }
  for (const beh of suite.M2?.behaviors ?? []) {
    register(beh.id, beh.alias || beh.name);
  }
  for (const rule of suite.M3?.rules ?? []) {
    register(rule.id, rule.alias || rule.name);
  }
  for (const ev of suite.ME?.events ?? []) {
    register(ev.id, ev.label || ev.name);
  }
  for (const sc of suite.M4?.event_scenarios ?? []) {
    register(sc.id, sc.name);
  }
  for (const actor of suite.M5?.actors ?? []) {
    register(actor.id, actor.name);
  }
  for (const role of suite.M5?.roles ?? []) {
    register(role.id, role.name);
  }
  for (const pg of suite.M5?.permissionGroups ?? []) {
    register(pg.id, pg.name);
  }
  for (const perm of suite.M5?.permissions ?? []) {
    register(perm.id, perm.name);
  }
  for (const flow of suite.M6?.flows ?? []) {
    register(flow.id, flow.name);
    for (const act of flow.activities) {
      register(act.id, act.name);
    }
  }
  for (const qr of suite.M7?.query_reports ?? []) {
    register(qr.id, qr.alias || qr.name);
  }
  for (const scr of suite.MU?.screens ?? []) {
    register(scr.screenId, scr.name);
    for (const el of scr.elements ?? []) {
      register(el.elementId, el.label || el.name);
    }
    for (const uie of scr.events ?? []) {
      register(uie.eventId, uie.name);
    }
  }
  for (const cc of suite.MU?.cross_cutting_ui ?? []) {
    register(cc.id, cc.name);
  }
  for (const mp of suite.MM?.mappings ?? []) {
    const ownerAgg = (suite.M1?.aggregates ?? []).find(
      (a) => a.id === mp.objectRef || a.name === mp.objectName,
    );
    const ownerLabel = ownerAgg ? ownerAgg.alias || ownerAgg.name : mp.objectName;
    register(mp.id, ownerLabel);
    for (const tm of mp.tableMappings) {
      map.set(
        tm.tableName,
        locale === 'en-US' ? `${ownerLabel} record` : `${ownerLabel}数据记录`,
      );
    }
  }
  for (const intf of suite.MI?.interfaces ?? []) {
    register(intf.interfaceId, intf.name);
  }
  return map;
}

function sanitizeBusinessText(
  raw: string | undefined,
  elementDisplayMap: ReadonlyMap<string, string>,
  locale: BusinessLocale,
): string {
  return sanitizeSharedBusinessText(raw, locale, { elementDisplayMap });
}

function formatLifecycleState(rawState: string, locale: BusinessLocale): string {
  const known = LIFECYCLE_STATE_LABELS[rawState.trim().toUpperCase()];
  if (known) return pickBusinessText(known, locale);
  const cleaned = rawState.replace(/_/g, ' ').trim();
  return checkBusinessViewMarkup(cleaned, { plainText: true }).length === 0
    ? cleaned
    : locale === 'en-US'
      ? 'State'
      : '业务状态';
}

function formatDataStorageSummary(
  ds: ProjectedDataStorage,
  ownerTitle: string,
  locale: BusinessLocale,
): { title: string; note: string } {
  const masterCount = ds.mapping.tableMappings.filter((tm) => tm.tableRole === 'MASTER').length;
  const detailCount = Math.max(0, ds.mapping.tableMappings.length - masterCount);
  const columnCount = ds.mapping.tableMappings.reduce(
    (sum, tm) => sum + tm.columnMappings.length,
    0,
  );
  if (locale === 'en-US') {
    const parts = [
      masterCount > 0
        ? `${masterCount} primary record ${masterCount === 1 ? 'group' : 'groups'}`
        : 'Business record storage',
      detailCount > 0
        ? `${detailCount} detail ${detailCount === 1 ? 'group' : 'groups'}`
        : '',
      `${columnCount} saved ${columnCount === 1 ? 'field' : 'fields'}`,
    ].filter(Boolean);
    return {
      title: `${ownerTitle} storage`,
      note: parts.join(', '),
    };
  }
  const parts = [
    masterCount > 0 ? `${masterCount} 组主记录` : '业务记录存储',
    detailCount > 0 ? `${detailCount} 组明细记录` : '',
    `共保存 ${columnCount} 项字段`,
  ].filter(Boolean);
  return {
    title: `${ownerTitle}存储记录`,
    note: parts.join('、'),
  };
}

function humanizeStageWarning(
  diag: ValidationDiagnostic,
  elementDisplayMap: ReadonlyMap<string, string>,
  locale: BusinessLocale,
): string {
  const modelName = getModelBusinessName(diag.model, locale);
  if (diag.code.startsWith('STAGE_') && diag.code.endsWith('_MISSING')) {
    return locale === 'en-US'
      ? `Not yet completed: ${modelName} details.`
      : `尚未补充「${modelName}」说明。`;
  }
  const rawMsg = locale === 'en-US' ? diag.messageEn : diag.messageZh;
  return sanitizeBusinessText(rawMsg, elementDisplayMap, locale);
}

function summarizeIncompleteModels(
  warnings: readonly ValidationDiagnostic[],
  locale: BusinessLocale,
): string {
  const names: string[] = [];
  for (const diag of warnings) {
    const name = getModelBusinessName(diag.model, locale);
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }
  if (names.length === 0) return '';
  if (locale === 'en-US') {
    const preview = names.slice(0, 3).join(', ');
    return names.length > 3
      ? `Missing ${preview} and ${names.length - 3} more`
      : `Missing ${preview} details`;
  }
  const preview = names.slice(0, 3).join('与');
  return names.length > 3
    ? `尚未补充${names.slice(0, 3).join('、')}等 ${names.length} 项说明`
    : `尚未补充${preview}说明`;
}

function humanizeConsistencyProblem(
  diag: ValidationDiagnostic,
  elementDisplayMap: ReadonlyMap<string, string>,
  locale: BusinessLocale,
): string {
  const itemLabel = diag.elementId ? elementDisplayMap.get(diag.elementId) : undefined;
  const partName = getModelBusinessName(diag.model, locale, { singular: true });
  const subject = itemLabel
    ? locale === 'en-US'
      ? `${partName} ${itemLabel}`
      : `${partName}${itemLabel}`
    : partName;

  switch (diag.code) {
    case 'M1_EMPTY_AGGREGATE_NAME':
      return locale === 'en-US'
        ? `A business object is missing its name; give it a clear business name.`
        : `${subject}缺少名称，请补充清晰的业务名称。`;
    case 'M1_DUPLICATE_AGGREGATE_NAME':
    case 'M1_DUPLICATE_AGGREGATE_ID':
      return locale === 'en-US'
        ? `${subject} shares the same name with another business object; keep each business object uniquely named.`
        : `${subject}与其他业务对象重名，请调整名称或合并重复项。`;
    case 'M1_DANGLING_DICTIONARY_REF':
    case 'M1_DICT_REF_MISSING':
    case 'M1_INVALID_DICTIONARY_DEFAULT':
      return locale === 'en-US'
        ? `An option field on ${subject} refers to an option dictionary that has not been defined yet.`
        : `${subject}中的选项字段引用了尚未定义的业务选项字典，请补充字典或调整字段类型。`;
    case 'M1_DANGLING_AGGREGATE_REF':
    case 'M1_MISSING_TARGET_AGGREGATE':
      return locale === 'en-US'
        ? `A linked field on ${subject} refers to a business object that does not exist.`
        : `${subject}中的关联字段指向了不存在的业务对象，请重新指定关联目标。`;
    case 'M2_DANGLING_OWNER_ENTITY':
      return locale === 'en-US'
        ? `${subject} is linked to a business object that does not exist; assign it to a valid business object.`
        : `${subject}关联的所属业务对象不存在，请重新指定有效的业务对象。`;
    case 'M2_DANGLING_RULE_REF':
      return locale === 'en-US'
        ? `${subject} refers to a business rule that does not exist; update or remove that rule link.`
        : `${subject}引用了不存在的业务规则，请更新或移除该规则关联。`;
    case 'M2_DANGLING_EVENT_REF':
      return locale === 'en-US'
        ? `${subject} refers to a business event that does not exist.`
        : `${subject}引用了不存在的业务事件，请同步补齐或调整关联。`;
    case 'M2_DANGLING_PERMISSION_REF':
      return locale === 'en-US'
        ? `${subject} refers to a role permission that does not exist.`
        : `${subject}引用了不存在的权限项，请同步更新角色与权限。`;
    case 'M2_DANGLING_QUERY_REPORT_REF':
    case 'M2_M7_ONE_TO_ONE_MISMATCH':
      return locale === 'en-US'
        ? `${subject} and its paired query or report do not match.`
        : `${subject}与配对的查询报表未保持一致，请同步对齐。`;
    case 'M3_DANGLING_OBJECT_REF':
      return locale === 'en-US'
        ? `${subject} refers to a business object that does not exist.`
        : `${subject}引用了不存在的业务对象，请更新适用对象范围。`;
    case 'M3_DANGLING_BEHAVIOR_REF':
      return locale === 'en-US'
        ? `${subject} refers to an action that does not exist.`
        : `${subject}引用了不存在的业务操作，请同步调整联动操作。`;
    case 'M3_DANGLING_EVENT_REF':
      return locale === 'en-US'
        ? `${subject} refers to a business event that does not exist.`
        : `${subject}引用了不存在的业务事件，请同步调整触发或产生的事件。`;
    case 'MU_INVALID_DATA_BINDING':
      return locale === 'en-US'
        ? `A screen control on ${subject} binds to a field that has not been added to the business object yet.`
        : `${subject}上的界面控件绑定了尚未添加到业务对象的字段，请同步补齐字段。`;
    case 'MU_DANGLING_BEHAVIOR_REF':
      return locale === 'en-US'
        ? `A screen button on ${subject} triggers an action that has not been added to the business model yet.`
        : `${subject}上的界面按钮关联了尚未定义的业务操作，请同步补齐该业务操作。`;
    case 'MM_DANGLING_OBJECT_REF':
    case 'MM_DANGLING_ATTRIBUTE_REF':
      return locale === 'en-US'
        ? `${subject} references a business object or field that no longer exists.`
        : `${subject}关联了已变更或不存在的业务对象字段，请同步更新数据存储说明。`;
    case 'MI_PROVIDED_MISSING_BEHAVIOR':
    case 'MI_DEPENDENT_MISSING_EXTERNAL_ENTITY':
      return locale === 'en-US'
        ? `${subject} is missing its paired action or external partner.`
        : `${subject}缺少对应的业务操作或外部协作方说明，请同步补齐。`;
    default: {
      const raw = (locale === 'en-US' ? diag.messageEn : diag.messageZh)
        .replace(/聚合根|聚合/g, '业务对象')
        .replace(/\baggregate\s+roots?\b|\baggregates?\b/gi, 'business object')
        .replace(/领域行为|承接行为/g, '业务操作')
        .replace(/领域事件/g, '业务事件')
        .replace(/物理表|数据表/g, '数据存储记录')
        .replace(
          /\b(?:relatedBehaviorRef|relatedExternalEntityRef|relatedEventRef|queryReportRef|ownerEntity|interfaceId|EXTERNAL_ENTITY|PROVIDED|DEPENDENT|MASTER|DETAIL)\b/g,
          locale === 'en-US' ? 'linked item' : '关联项',
        );
      return sanitizeBusinessText(raw, elementDisplayMap, locale);
    }
  }
}

function revealConversationPane(): void {
  const panel = useAgentPanelStore.getState();
  panel.revealPanel();
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 1279px)').matches
  ) {
    panel.setOverlayOpen(true);
  }
}

/* ─── Main Step View Component ─── */

export function BusinessModelStepView({
  onNavigate,
  activePageId: controlledPageId,
  onSelectPage,
  viewModeOverride,
  legacyTechTab: legacyTechTabProp,
  headerActions,
  flashTarget,
  initialInlineEditState = null,
  initialRejectionState = null,
  defaultExpandedSections,
  defaultShowIncomplete = false,
}: BusinessModelStepViewProps = {}) {
  const { locale, t } = usePreferences();
  const businessLocale: BusinessLocale = locale === 'en-US' ? 'en-US' : 'zh-CN';

  const {
    data,
    activeNav,
    activeItemId,
    liveSessionDrafts,
    highlightedBusinessModelTarget,
    historyDrawerArtifactKind,
    setActiveItemId,
    setSelectedModel,
    openArtifactHistoryDrawer,
    closeArtifactHistoryDrawer,
    undoArtifactChange,
    restoreArtifactBeforeChange,
    focusBusinessModelTarget,
    applyBusinessModelEdit,
    confirmBusinessModelStep,
    showToast,
    startOntologySynthesisRun,
    startOntologyCopilotRun,
  } = useWorkbenchStore();

  const [historyBusyEntryId, setHistoryBusyEntryId] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [updatedForProtoConfId, setUpdatedForProtoConfId] = useState<string | null>(null);

  const [activeInlineEdit, setActiveInlineEdit] = useState<InlineEditDraftState | null>(
    () => initialInlineEditState,
  );
  const [savingInlineSlotKey, setSavingInlineSlotKey] = useState<string | null>(null);
  const [activeRejection, setActiveRejection] = useState<InlineRejectionState | null>(
    () => initialRejectionState,
  );

  const [storedMode, setStoredMode] = useStepViewMode('BUSINESS_MODEL');
  const inferredLegacyTab =
    legacyTechTabProp ?? resolveLegacyBusinessModelTechTab(activeNav);
  const [legacyTabDismissed, setLegacyTabDismissed] = useState(false);

  useEffect(() => {
    setLegacyTabDismissed(false);
  }, [inferredLegacyTab]);

  const effectiveLegacyTab = legacyTabDismissed ? null : inferredLegacyTab;
  const effectiveMode: StepViewMode =
    viewModeOverride ?? (effectiveLegacyTab ? 'technical' : storedMode);

  const [techTab, setTechTab] = useState<BusinessModelTechTab>(
    () => effectiveLegacyTab ?? 'editor',
  );
  const [focusTarget, setFocusTarget] = useState<OntologyWorkbenchFocusTarget | null>(null);
  const [showStageWarnings, setShowStageWarnings] = useState<boolean>(
    () => defaultShowIncomplete,
  );

  useEffect(() => {
    if (effectiveLegacyTab) {
      setTechTab(effectiveLegacyTab);
    }
  }, [effectiveLegacyTab]);

  const project = data?.activeProject;
  const suite = project?.suite;
  const projection = useMemo(
    () => (suite ? projectByBusinessObject(suite) : null),
    [suite],
  );
  const elementDisplayMap = useMemo(
    () => (suite ? buildElementDisplayMap(suite, businessLocale) : new Map<string, string>()),
    [suite, businessLocale],
  );
  const screenNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const scr of suite?.MU?.screens ?? []) {
      map.set(scr.screenId, scr.name || scr.screenId);
    }
    return map;
  }, [suite]);
  const humanize = useCallback(
    (raw: string | undefined) => {
      const cleaned = sanitizeBusinessText(raw, elementDisplayMap, businessLocale);
      if (!cleaned) return '';
      return businessLocale === 'en-US'
        ? cleaned
            .replace(/\baggregate\s+roots?\b/gi, 'business object')
            .replace(/\binvariants?\b/gi, 'business rules')
        : cleaned.replace(/聚合根/g, '').replace(/不变量/g, '业务规则');
    },
    [elementDisplayMap, businessLocale],
  );

  const [internalPageId, setInternalPageId] = useState<string | null>(null);

  useEffect(() => {
    setInternalPageId(null);
    setActiveInlineEdit(initialInlineEditState);
    setActiveRejection(initialRejectionState);
    setConfirmError(null);
  }, [project?.id, initialInlineEditState, initialRejectionState]);

  useEffect(() => {
    setConfirmError(null);
  }, [project?.updatedAt, data?.stepConfirmations?.businessModel?.id]);

  const resolvedPageId: BusinessModelPageId = useMemo(() => {
    if (!projection) return 'view:flows';
    const candidate = controlledPageId ?? activeItemId ?? internalPageId;
    return resolveBusinessModelPageId(projection, candidate);
  }, [projection, controlledPageId, activeItemId, internalPageId]);

  const handleSelectPage = useCallback(
    (nextPageId: BusinessModelPageId) => {
      setActiveInlineEdit(null);
      setActiveRejection(null);
      setInternalPageId(nextPageId);
      setActiveItemId(nextPageId);
      onSelectPage?.(nextPageId);
    },
    [setActiveItemId, onSelectPage],
  );

  const handleStartInlineEdit = useCallback((slotKey: string, initialValue: string) => {
    setActiveRejection(null);
    setActiveInlineEdit({ slotKey, draftValue: initialValue });
  }, []);

  const handleChangeInlineDraft = useCallback((slotKey: string, nextValue: string) => {
    setActiveInlineEdit((prev) =>
      prev && prev.slotKey === slotKey ? { ...prev, draftValue: nextValue } : prev,
    );
  }, []);

  const handleCancelInlineEdit = useCallback(() => {
    setActiveInlineEdit(null);
    setActiveRejection(null);
  }, []);

  const handleCommitInlineEdit = useCallback(
    async (
      slotKey: string,
      initialValue: string,
      buildEdit: (nextValue: string) => BusinessModelInlineEditTarget,
    ) => {
      const currentDraft =
        activeInlineEdit?.slotKey === slotKey ? activeInlineEdit.draftValue : initialValue;
      if (currentDraft.trim() === initialValue.trim() && currentDraft.trim() !== '') {
        setActiveInlineEdit(null);
        return;
      }

      setSavingInlineSlotKey(slotKey);
      try {
        const result = await applyBusinessModelEdit({
          edit: buildEdit(currentDraft),
        });
        if (result.ok) {
          setActiveInlineEdit(null);
          setActiveRejection(null);
        } else {
          setActiveInlineEdit(null);
          setActiveRejection({
            slotKey,
            reasonZh: result.rejection.reasonZh,
            reasonEn: result.rejection.reasonEn,
            assistantPromptZh: result.rejection.assistantPromptZh,
            assistantPromptEn: result.rejection.assistantPromptEn,
          });
        }
      } finally {
        setSavingInlineSlotKey(null);
      }
    },
    [activeInlineEdit, applyBusinessModelEdit],
  );

  const handleAskAssistantFromRejection = useCallback(
    (rejection: InlineRejectionState) => {
      const prompt =
        businessLocale === 'en-US'
          ? rejection.assistantPromptEn || rejection.assistantPromptZh
          : rejection.assistantPromptZh || rejection.assistantPromptEn;
      setActiveRejection(null);
      setActiveInlineEdit(null);
      revealConversationPane();
      if (prompt.trim()) {
        void startOntologyCopilotRun(prompt);
      }
    },
    [businessLocale, startOntologyCopilotRun],
  );

  const inlineEditCtx = useMemo<InlineEditContextValue>(
    () => ({
      activeEdit: activeInlineEdit,
      savingSlotKey: savingInlineSlotKey,
      activeRejection,
      onStartEdit: handleStartInlineEdit,
      onChangeDraft: handleChangeInlineDraft,
      onCancel: handleCancelInlineEdit,
      onCommit: handleCommitInlineEdit,
      onAskAssistant: handleAskAssistantFromRejection,
    }),
    [
      activeInlineEdit,
      savingInlineSlotKey,
      activeRejection,
      handleStartInlineEdit,
      handleChangeInlineDraft,
      handleCancelInlineEdit,
      handleCommitInlineEdit,
      handleAskAssistantFromRejection,
    ],
  );

  const handleOpenTechnicalDetails = useCallback(
    (locator?: TechnicalLocator) => {
      const targetModel: ModelCode = locator?.model ?? 'M1';
      const targetElementId: string | null = locator?.elementId ?? null;
      setSelectedModel(targetModel, targetElementId);
      setFocusTarget({
        model: targetModel,
        elementId: targetElementId,
        nonce: Date.now(),
      });
      setTechTab('editor');
      setStoredMode('technical');
    },
    [setSelectedModel, setStoredMode],
  );

  const handleBackToBusinessView = useCallback(() => {
    setLegacyTabDismissed(true);
    setStoredMode('business');
    if (activeNav === 'app-model-files' || activeNav === 'app-knowledge-graph') {
      onNavigate?.('app-ontology');
    }
  }, [activeNav, onNavigate, setStoredMode]);

  if (!data || !project || !projection) return null;

  const lifecycle = getProjectLifecycleState(data);
  const projectSteps = getProjectStepsFromBootstrap(data);
  const bmStep = projectSteps.find((s) => s.id === 'BUSINESS_MODEL') ?? null;
  const stepState: ProjectStepStateId =
    bmStep?.state ?? (lifecycle.hasOntology ? 'IN_PROGRESS' : 'NOT_STARTED');
  const validation = project.validation;
  const effectiveFlashTarget =
    flashTarget ??
    (highlightedBusinessModelTarget
      ? {
          anchorId: highlightedBusinessModelTarget.anchorId,
          at: highlightedBusinessModelTarget.seq,
        }
      : null);

  const ontHistoryEntries = (data.artifactHistory ?? []).filter(
    (entry) => entry.artifactKind === 'ONTOLOGY_SUITE',
  );
  const historyDrawerOpen = historyDrawerArtifactKind === 'ONTOLOGY_SUITE';

  const handleHistoryDrawerOpenChange = (open: boolean) => {
    if (open) {
      openArtifactHistoryDrawer('ONTOLOGY_SUITE');
    } else {
      closeArtifactHistoryDrawer();
    }
  };

  const handleUndoLatestFromDrawer = async (entry: ArtifactHistoryEntryView) => {
    setHistoryBusyEntryId(entry.id);
    try {
      await undoArtifactChange('ONTOLOGY_SUITE', entry.id);
    } finally {
      setHistoryBusyEntryId(null);
    }
  };

  const handleRestoreBeforeFromDrawer = async (entry: ArtifactHistoryEntryView) => {
    setHistoryBusyEntryId(entry.id);
    try {
      await restoreArtifactBeforeChange('ONTOLOGY_SUITE', entry.id);
    } finally {
      setHistoryBusyEntryId(null);
    }
  };

  const handleJumpFromDrawer = (target: ArtifactJumpTarget) => {
    if (target.kind === 'BUSINESS_OBJECT') {
      focusBusinessModelTarget(target);
      if (target.pageId || target.objectId) {
        handleSelectPage((target.pageId ?? target.objectId)!);
      }
    }
  };

  const historyDrawerNode = (
    <ArtifactHistoryDrawer
      open={historyDrawerOpen}
      onOpenChange={handleHistoryDrawerOpenChange}
      artifactLabel={BUSINESS_VOCABULARY.ONTOLOGY_SUITE}
      entries={ontHistoryEntries}
      busyEntryId={historyBusyEntryId}
      onUndoLatest={handleUndoLatestFromDrawer}
      onRestoreBefore={handleRestoreBeforeFromDrawer}
      onJumpToTarget={handleJumpFromDrawer}
    />
  );

  const historyTriggerButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-testid="business-model-history-btn"
      onClick={() => openArtifactHistoryDrawer('ONTOLOGY_SUITE')}
    >
      <History size={13} aria-hidden="true" />
      <span>{t('历史与恢复', 'History')}</span>
    </Button>
  );

  const isCopilotBusy = (data.agentSessions ?? []).some(
    (s) =>
      s.projectId === project.id &&
      s.agentKind === 'COPILOT' &&
      (s.status === 'RUNNING' || Boolean(liveSessionDrafts[s.id])),
  );

  /* ─── Technical Details Mode (`mode === 'technical'`) ─── */
  if (effectiveMode === 'technical') {
    const safeNavigate = onNavigate ?? (() => undefined);
    return (
      <div className="bm-tech-root" data-testid="business-model-technical-view">
        <div className="bm-tech-bar" data-testid="business-model-tech-bar">
          <div
            className="bm-tech-tabs"
            role="tablist"
            aria-label={t('技术细节视图', 'Technical Details views')}
          >
            <button
              type="button"
              role="tab"
              data-testid="tech-tab-editor"
              className="bm-tech-tab"
              aria-selected={techTab === 'editor'}
              onClick={() => setTechTab('editor')}
            >
              <Code2 size={14} aria-hidden="true" />
              <span>{t('结构化与 YAML 编辑器', 'Structured & YAML Editor')}</span>
            </button>
            <button
              type="button"
              role="tab"
              data-testid="tech-tab-files"
              className="bm-tech-tab"
              aria-selected={techTab === 'files'}
              onClick={() => setTechTab('files')}
            >
              <FileCode2 size={14} aria-hidden="true" />
              <span>{t('模型文件', 'Model Files')}</span>
            </button>
            <button
              type="button"
              role="tab"
              data-testid="tech-tab-graph"
              className="bm-tech-tab"
              aria-selected={techTab === 'graph'}
              onClick={() => setTechTab('graph')}
            >
              <Network size={14} aria-hidden="true" />
              <span>{t('知识图谱', 'Knowledge Graph')}</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {historyTriggerButton}
            <button
              type="button"
              className="bm-ghost-btn"
              data-testid="back-to-business-view-btn"
              onClick={handleBackToBusinessView}
            >
              <ArrowLeft size={14} aria-hidden="true" />
              <span>
                {t(
                  `返回${BUSINESS_VOCABULARY.BUSINESS_VIEW.zh}`,
                  `Back to ${BUSINESS_VOCABULARY.BUSINESS_VIEW.en}`,
                )}
              </span>
            </button>
          </div>
        </div>

        <div className="bm-tech-body">
          {techTab === 'editor' && (
            <OntologyWorkbenchView onNavigate={safeNavigate} focusTarget={focusTarget} />
          )}
          {techTab === 'files' && (
            <div className="bm-tech-scroll-pane">
              <ModelFilesView onNavigate={safeNavigate} />
            </div>
          )}
          {techTab === 'graph' && (
            <div className="bm-tech-scroll-pane">
              <KnowledgeGraphWorkbenchView
                onNavigate={safeNavigate}
                onSelectElementInEditor={(model, elementId) => {
                  handleOpenTechnicalDetails({
                    model,
                    elementId,
                  });
                }}
              />
            </div>
          )}
        </div>
        {historyDrawerNode}
      </div>
    );
  }

  /* ─── Business View Empty State (no core M1–MI models yet, including MU-only right after Prototype confirmation) ─── */
  const hasCoreBusinessModel = validation.presentModels.some((m) => m !== 'MU');
  if (!hasCoreBusinessModel) {
    const canOrganizeFromPrototype = lifecycle.hasConfirmedPrototype;
    return (
      <div className="bm-step-root" data-testid="business-model-business-view">
        <div className="bm-empty-wrap" data-testid="business-model-empty-state">
          <div className="bm-empty-card">
            <span className="bm-empty-icon" aria-hidden="true">
              {isCopilotBusy ? <CircleDot size={22} /> : <Sparkles size={22} />}
            </span>
            <h1 className="bm-empty-title">
              {isCopilotBusy
                ? t('正在整理业务模型', 'Organizing business model')
                : canOrganizeFromPrototype
                  ? t('业务模型还没有整理', 'Business model not yet organized')
                  : t('等待已确认的原型', 'Waiting for a confirmed prototype')}
            </h1>
            <p
              className="bm-empty-copy"
              data-testid="business-model-status-banner"
              data-step-state={stepState}
            >
              {isCopilotBusy
                ? t(
                    'AI 助手正在依据已确认的原型找出业务对象、业务规则和角色权限，实时进度显示在左侧对话中。',
                    'AI Assistant is identifying business objects, business rules, and role permissions from your confirmed prototype; see live progress in the conversation.',
                  )
                : canOrganizeFromPrototype
                  ? t(
                      '原型已确认。点击下方按钮，AI 助手会依据已确认的原型自动整理出业务对象、业务操作、业务规则与角色权限。',
                      'Prototype confirmed. Click below so AI Assistant can organize business objects, actions, business rules, and role permissions from your confirmed prototype.',
                    )
                  : t(
                      '先完成并确认界面原型后，AI 助手即可在这里整理出完整的业务模型。',
                      'Confirm an interactive prototype first so AI Assistant can organize your business model here.',
                    )}
            </p>
            <div className="bm-empty-actions">
              {canOrganizeFromPrototype && !isCopilotBusy && (
                <Button
                  type="button"
                  variant="accent"
                  size="md"
                  data-testid="organize-business-model-btn"
                  onClick={() => {
                    revealConversationPane();
                    void startOntologySynthesisRun();
                  }}
                >
                  <span>{t('整理业务模型', 'Organize Business Model')}</span>
                </Button>
              )}
              {!canOrganizeFromPrototype && onNavigate && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="business-model-go-to-prototype-btn"
                  onClick={() => onNavigate('app-prototype')}
                >
                  <span>{t('去确认原型', 'Go to Prototype')}</span>
                  <ArrowRight size={14} aria-hidden="true" />
                </Button>
              )}
              {ontHistoryEntries.length > 0 && historyTriggerButton}
              <button
                type="button"
                className="bm-ghost-btn"
                data-testid="open-technical-details-btn"
                onClick={() => handleOpenTechnicalDetails({ model: 'M1', elementId: '' })}
              >
                <Code2 size={14} aria-hidden="true" />
                <span>
                  {t(
                    BUSINESS_VOCABULARY.TECHNICAL_DETAILS.zh,
                    BUSINESS_VOCABULARY.TECHNICAL_DETAILS.en,
                  )}
                </span>
              </button>
            </div>
          </div>
        </div>
        {historyDrawerNode}
      </div>
    );
  }

  /* ─── Populated Business View (`mode === 'business'`) ─── */
  const activeObject = projection.objects.find((o) => o.id === resolvedPageId) ?? null;
  const consistencyProblems = validation.diagnostics.filter((d) => d.tier === 'ERROR');
  const stageWarnings = validation.diagnostics.filter((d) => d.tier === 'STAGE_WARNING');
  const isOutdated = stepState === 'OUTDATED';
  const canConfirmCleanly =
    lifecycle.hasConfirmedPrototype &&
    validation.presentModels.length > 0 &&
    validation.errorCount === 0;

  const handleConfirmBusinessModel = async () => {
    if (isConfirming || isCopilotBusy) return;
    setIsConfirming(true);
    setConfirmError(null);
    try {
      const confirmed = await confirmBusinessModelStep();
      if (confirmed) {
        showToast(t('已确认当前业务模型', 'Confirmed current Business Model'));
      }
    } catch (err) {
      const rawErr = err instanceof Error ? err.message : String(err);
      const cleaned = humanize(rawErr) || t('暂时无法确认业务模型，请先检查是否存在需要修正的问题。', 'Unable to confirm the Business Model; check for problems to fix first.');
      setConfirmError(cleaned);
      showToast(cleaned);
    } finally {
      setIsConfirming(false);
    }
  };

  const handleFixProblemsWithAssistant = (singleProblem?: ValidationDiagnostic) => {
    revealConversationPane();
    const targetList = singleProblem ? [singleProblem] : consistencyProblems.slice(0, 6);
    const descriptions = targetList.map((d) =>
      humanizeConsistencyProblem(d, elementDisplayMap, businessLocale),
    );
    const instruction =
      businessLocale === 'en-US'
        ? `Please fix the following problems in the Business Model so all business objects, actions, business rules, and role permissions stay consistent: ${descriptions.join(' ')}`
        : `请帮我处理当前业务模型中需要修正的问题，使各业务对象、业务操作、业务规则与角色权限保持一致：${descriptions.join(' ')}`;
    if (lifecycle.hasConfirmedPrototype) {
      void startOntologySynthesisRun({
        mode: 'fix_problems',
        instruction,
      });
    } else {
      void startOntologyCopilotRun(instruction);
    }
  };

  const handleCompleteMissingWithAssistant = () => {
    revealConversationPane();
    const missingSummary = summarizeIncompleteModels(stageWarnings, businessLocale);
    const instruction =
      businessLocale === 'en-US'
        ? `Please complete the parts not yet completed in the Business Model (${missingSummary || 'remaining details'}) based on the confirmed prototype.`
        : `请依据已确认的原型，补全当前业务模型中尚未完成的部分（${missingSummary || '剩余关联说明'}）。`;
    if (lifecycle.hasConfirmedPrototype) {
      void startOntologySynthesisRun({
        mode: 'complete_missing',
        instruction,
      });
    } else {
      void startOntologyCopilotRun(instruction);
    }
  };

  const handleUpdateFromConfirmedPrototype = () => {
    revealConversationPane();
    const currentProtoConfId = data.stepConfirmations?.prototype?.id ?? null;
    const confirmedProtoId =
      data.stepConfirmations?.prototype?.prototypeId ??
      data.confirmedPrototypeRevision?.prototypeId;
    const confirmedProtoEntity = confirmedProtoId
      ? data.prototypes.find((p) => p.id === confirmedProtoId)
      : data.prototypes[0];
    const protoTitle = humanize(confirmedProtoEntity?.name) || t('已确认的原型', 'confirmed prototype');
    const instruction =
      businessLocale === 'en-US'
        ? `The prototype (${protoTitle}) has a new confirmation. Please align and update the Business Model from the newly confirmed prototype while preserving existing business rules and permissions where appropriate.`
        : `界面原型（${protoTitle}）有了新的确认。请依据最新已确认的原型同步更新业务模型，同时保留仍然适用的业务规则与角色权限。`;
    void startOntologySynthesisRun({
      ...(confirmedProtoId ? { prototypeId: confirmedProtoId } : {}),
      mode: 'update',
      instruction,
    }).then((res) => {
      if (res && currentProtoConfId) {
        setUpdatedForProtoConfId(currentProtoConfId);
      }
    });
  };

  const currentProtoConf = data.stepConfirmations?.prototype ?? null;
  const hasUpdatedAfterProtoConf =
    isOutdated &&
    Boolean(currentProtoConf) &&
    (updatedForProtoConfId === currentProtoConf?.id ||
      (Boolean(currentProtoConf?.confirmedAt) &&
        ontHistoryEntries.some(
          (entry) =>
            entry.source.kind === 'AGENT_RUN' &&
            entry.createdAt >= currentProtoConf!.confirmedAt,
        )));

  const statusBanner: {
    tone: 'ok' | 'warn' | 'error' | 'info';
    text: string;
  } = confirmError
    ? {
        tone: 'error',
        text: confirmError,
      }
    : isCopilotBusy
      ? {
          tone: 'info',
          text: t(
            'AI 助手正在修改业务模型，完成后会在左侧对话列出改了什么。',
            'AI Assistant is updating the Business Model and will list what changed in the conversation.',
          ),
        }
      : validation.errorCount > 0
        ? {
            tone: 'error',
            text: t(
              `还有 ${validation.errorCount} 个${BUSINESS_VOCABULARY.CONSISTENCY_ERROR.zh}，处理完后才能确认业务模型。`,
              `${validation.errorCount} ${validation.errorCount === 1 ? 'problem to fix' : 'problems to fix'} must be resolved before confirming the Business Model.`,
            ),
          }
        : !lifecycle.hasConfirmedPrototype
          ? {
              tone: 'warn',
              text: t(
                '需要先在「原型」步骤确认界面原型，之后即可确认业务模型。',
                'Confirm an interactive prototype in the Prototype step first before confirming the Business Model.',
              ),
            }
          : stepState === 'CONFIRMED'
            ? {
                tone: 'ok',
                text: t(
                  '业务模型已确认，没有需要修正的问题；下一步可以前往交付生成开发资料包。',
                  'Business Model is confirmed with no problems to fix; continue to Delivery to generate the development package.',
                ),
              }
            : stepState === 'UNCONFIRMED_CHANGES'
              ? {
                  tone: 'warn',
                  text: t(
                    '业务模型有未确认的修改，交付仍依据上次确认的版本；核对无误后请确认业务模型。',
                    'Business Model has unconfirmed changes while Delivery still uses the last confirmed version; confirm when ready.',
                  ),
                }
              : {
                  tone: 'info',
                  text: t(
                    '没有需要修正的问题。逐个核对业务对象、规则与权限后，请确认业务模型。',
                    'No problems to fix. Review your business objects, rules, and permissions, then confirm the Business Model.',
                  ),
                };

  const defaultHeaderCta = isOutdated ? null : stepState === 'CONFIRMED' &&
    validation.errorCount === 0 ? (
    onNavigate ? (
      <Button
        type="button"
        variant="accent"
        size="sm"
        data-testid="go-to-delivery-btn"
        onClick={() => onNavigate('app-assembly-dev')}
      >
        <span>{t('去交付', 'Go to Delivery')}</span>
        <ArrowRight size={14} aria-hidden="true" />
      </Button>
    ) : null
  ) : !lifecycle.hasConfirmedPrototype ? (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        data-testid="confirm-business-model-btn"
        disabled
      >
        <CheckCircle2 size={13.5} aria-hidden="true" />
        <span>{t('确认业务模型', 'Confirm Business Model')}</span>
      </Button>
      {onNavigate && validation.errorCount === 0 && (
        <Button
          type="button"
          variant="accent"
          size="sm"
          data-testid="business-model-go-to-prototype-btn"
          onClick={() => onNavigate('app-prototype')}
        >
          <span>{t('去确认原型', 'Go to Prototype')}</span>
          <ArrowRight size={14} aria-hidden="true" />
        </Button>
      )}
    </>
  ) : (
    <Button
      type="button"
      variant={canConfirmCleanly ? 'accent' : 'secondary'}
      size="sm"
      data-testid="confirm-business-model-btn"
      disabled={!canConfirmCleanly || isConfirming || isCopilotBusy}
      onClick={() => void handleConfirmBusinessModel()}
    >
      <CheckCircle2 size={13.5} aria-hidden="true" />
      <span>{t('确认业务模型', 'Confirm Business Model')}</span>
    </Button>
  );

  const incompleteSummaryText = summarizeIncompleteModels(stageWarnings, businessLocale);

  return (
    <div className="bm-step-root" data-testid="business-model-business-view">
      <header className="bm-head" data-testid="business-model-header">
        <div className="bm-title-row">
          <h1 className="bm-title">
            {t(
              BUSINESS_VOCABULARY.ONTOLOGY_SUITE.zh,
              BUSINESS_VOCABULARY.ONTOLOGY_SUITE.en,
            )}
          </h1>
          <div className="bm-head-actions">
            {historyTriggerButton}
            {headerActions ?? defaultHeaderCta}
          </div>
        </div>

        {isOutdated ? (
          <section
            className="bm-outdated-banner"
            data-testid="business-model-outdated-banner"
            data-step-state="OUTDATED"
            role="region"
            aria-label={t('业务模型待更新提示', 'Business Model update notice')}
          >
            <p
              className="bm-outdated-copy"
              data-testid="business-model-status-banner"
              data-step-state="OUTDATED"
            >
              <Info size={15} aria-hidden="true" />
              <span>
                {validation.errorCount > 0
                  ? t(
                      `原型有了新的确认，且当前还有 ${validation.errorCount} 个${BUSINESS_VOCABULARY.CONSISTENCY_ERROR.zh}；点击「让 AI 助手更新」可一并对齐处理。`,
                      `The prototype was re-confirmed and ${validation.errorCount} ${validation.errorCount === 1 ? 'problem to fix exists' : 'problems to fix exist'}; click Update with AI Assistant to align and resolve them.`,
                    )
                  : hasUpdatedAfterProtoConf
                    ? t(
                        'AI 助手已依据最新确认的原型更新业务模型；核对无误后请确认业务模型。',
                        'AI Assistant updated the Business Model from the confirmed prototype; review and confirm when ready.',
                      )
                    : t(
                        '原型有了新的确认；业务模型更新确认后，交付也会提示更新。',
                        'The prototype was re-confirmed; once the Business Model is updated and confirmed, Delivery will also prompt for an update.',
                      )}
              </span>
            </p>
            <div className="bm-outdated-actions">
              {hasUpdatedAfterProtoConf && canConfirmCleanly ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid="business-model-ask-assistant-update-btn"
                    disabled={isConfirming || isCopilotBusy}
                    onClick={handleUpdateFromConfirmedPrototype}
                  >
                    <Sparkles size={13.5} aria-hidden="true" />
                    <span>{t('让 AI 助手更新', 'Update with AI Assistant')}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="accent"
                    size="sm"
                    data-testid="confirm-business-model-btn"
                    disabled={isConfirming || isCopilotBusy}
                    onClick={() => void handleConfirmBusinessModel()}
                  >
                    <CheckCircle2 size={13.5} aria-hidden="true" />
                    <span>{t('确认业务模型', 'Confirm Business Model')}</span>
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid="business-model-confirm-as-is-btn"
                    disabled={!canConfirmCleanly || isConfirming || isCopilotBusy}
                    onClick={() => void handleConfirmBusinessModel()}
                  >
                    <CheckCircle2 size={13.5} aria-hidden="true" />
                    <span>{t('不需要改动，按现状确认', 'Confirm as is without changes')}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="accent"
                    size="sm"
                    data-testid="business-model-ask-assistant-update-btn"
                    disabled={isConfirming || isCopilotBusy}
                    onClick={handleUpdateFromConfirmedPrototype}
                  >
                    <Sparkles size={13.5} aria-hidden="true" />
                    <span>{t('让 AI 助手更新', 'Update with AI Assistant')}</span>
                  </Button>
                </>
              )}
            </div>
          </section>
        ) : (
          <p
            className="bm-status-banner"
            data-testid="business-model-status-banner"
            data-step-state={stepState}
            data-tone={statusBanner.tone}
          >
            {statusBanner.tone === 'ok' ? (
              <CheckCircle2 size={15} aria-hidden="true" />
            ) : statusBanner.tone === 'error' || statusBanner.tone === 'warn' ? (
              <TriangleAlert size={15} aria-hidden="true" />
            ) : (
              <Info size={15} aria-hidden="true" />
            )}
            <span>{statusBanner.text}</span>
          </p>
        )}

        {consistencyProblems.length > 0 && (
          <section
            className="bm-diag-card is-problems"
            data-testid="business-model-problems-card"
            aria-label={t(
              BUSINESS_VOCABULARY.CONSISTENCY_ERROR.zh,
              BUSINESS_VOCABULARY.CONSISTENCY_ERROR.en,
            )}
          >
            <div className="bm-diag-head">
              <span className="bm-diag-title is-error">
                <TriangleAlert size={14} aria-hidden="true" />
                <span>
                  {t(
                    `${BUSINESS_VOCABULARY.CONSISTENCY_ERROR.zh} · ${consistencyProblems.length}`,
                    `${BUSINESS_VOCABULARY.CONSISTENCY_ERROR.en} · ${consistencyProblems.length}`,
                  )}
                </span>
              </span>
              <Button
                type="button"
                variant={isOutdated ? 'secondary' : 'accent'}
                size="sm"
                data-testid="fix-problems-with-assistant-btn"
                disabled={isCopilotBusy || isConfirming}
                onClick={() => handleFixProblemsWithAssistant()}
              >
                <Sparkles size={13.5} aria-hidden="true" />
                <span>{t('让 AI 助手处理', 'Let AI Assistant fix')}</span>
              </Button>
            </div>
            <ul className="bm-diag-list" data-testid="business-model-problems-list">
              {consistencyProblems.map((diag, idx) => (
                <li
                  key={diag.id}
                  className="bm-diag-item"
                  data-testid="business-model-problem-item"
                >
                  <span className="bm-diag-item-text">
                    {humanizeConsistencyProblem(diag, elementDisplayMap, businessLocale)}
                  </span>
                  <span className="bm-diag-item-actions">
                    <button
                      type="button"
                      className="bm-item-tech-btn"
                      data-testid={`fix-problem-item-btn-${idx}`}
                      disabled={isCopilotBusy || isConfirming}
                      onClick={() => handleFixProblemsWithAssistant(diag)}
                    >
                      <span>{t('让 AI 助手处理', 'Let AI Assistant fix')}</span>
                    </button>
                    <button
                      type="button"
                      className="bm-item-tech-btn"
                      data-testid={`locate-problem-tech-btn-${idx}`}
                      onClick={() =>
                        handleOpenTechnicalDetails({
                          model: diag.model,
                          elementId: diag.elementId ?? '',
                        })
                      }
                    >
                      <Code2 size={12} aria-hidden="true" />
                      <span>
                        {t(
                          BUSINESS_VOCABULARY.TECHNICAL_DETAILS.zh,
                          BUSINESS_VOCABULARY.TECHNICAL_DETAILS.en,
                        )}
                      </span>
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {stageWarnings.length > 0 && (
          <section
            className="bm-diag-card is-incomplete"
            data-testid="business-model-incomplete-card"
            aria-label={t(
              BUSINESS_VOCABULARY.STAGE_WARNING.zh,
              BUSINESS_VOCABULARY.STAGE_WARNING.en,
            )}
          >
            <div className="bm-diag-head">
              <button
                type="button"
                className="bm-diag-toggle"
                data-testid="toggle-incomplete-parts-btn"
                aria-expanded={showStageWarnings}
                onClick={() => setShowStageWarnings((prev) => !prev)}
              >
                {showStageWarnings ? (
                  <ChevronDown size={14} aria-hidden="true" />
                ) : (
                  <ChevronRight size={14} aria-hidden="true" />
                )}
                <span>
                  {t(
                    `${BUSINESS_VOCABULARY.STAGE_WARNING.zh} · ${stageWarnings.length}`,
                    `${BUSINESS_VOCABULARY.STAGE_WARNING.en} · ${stageWarnings.length}`,
                  )}
                </span>
                {incompleteSummaryText && (
                  <span className="bm-diag-summary">· {incompleteSummaryText}</span>
                )}
              </button>
              {showStageWarnings && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="complete-missing-with-assistant-btn"
                  disabled={isCopilotBusy || isConfirming}
                  onClick={handleCompleteMissingWithAssistant}
                >
                  <Sparkles size={13.5} aria-hidden="true" />
                  <span>{t('让 AI 助手补全', 'Ask AI Assistant to complete')}</span>
                </Button>
              )}
            </div>
            {showStageWarnings && (
              <ul className="bm-diag-list" data-testid="business-model-incomplete-list">
                {stageWarnings.map((diag) => (
                  <li key={diag.id} className="bm-diag-item">
                    <span className="bm-diag-item-text">
                      {humanizeStageWarning(diag, elementDisplayMap, businessLocale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </header>

      <div className="bm-body">
        <nav
          className="bm-nav"
          data-testid="business-model-nav"
          aria-label={t('业务模型目录', 'Business model directory')}
        >
          <div className="bm-nav-group-label">
            {t(MODEL_BUSINESS_NAMES.M1.zh, MODEL_BUSINESS_NAMES.M1.en)}
          </div>
          {projection.objects.map((obj) => (
            <button
              key={obj.id}
              type="button"
              data-testid={`bm-nav-object-${obj.id}`}
              data-object-name={obj.name}
              className="bm-nav-item"
              aria-current={resolvedPageId === obj.id ? 'page' : undefined}
              onClick={() => handleSelectPage(obj.id)}
            >
              <span className="truncate">{humanize(obj.displayName)}</span>
              <span className="bm-nav-count">{obj.fields.length}</span>
            </button>
          ))}

          <div className="bm-nav-group-label">
            {t('跨对象视图', 'Cross-object views')}
          </div>
          <button
            type="button"
            data-testid="bm-nav-flows"
            className="bm-nav-item"
            aria-current={resolvedPageId === 'view:flows' ? 'page' : undefined}
            onClick={() => handleSelectPage('view:flows')}
          >
            <span className="truncate">
              {t(MODEL_BUSINESS_NAMES.M6.zh, MODEL_BUSINESS_NAMES.M6.en)}
            </span>
            <span className="bm-nav-count">
              {projection.flowsAndApprovals.flows.length}
            </span>
          </button>
          <button
            type="button"
            data-testid="bm-nav-roles"
            className="bm-nav-item"
            aria-current={resolvedPageId === 'view:roles' ? 'page' : undefined}
            onClick={() => handleSelectPage('view:roles')}
          >
            <span className="truncate">
              {t(MODEL_BUSINESS_NAMES.M5.zh, MODEL_BUSINESS_NAMES.M5.en)}
            </span>
            <span className="bm-nav-count">
              {projection.rolesAndPermissions.roles.length}
            </span>
          </button>
          <button
            type="button"
            data-testid="bm-nav-reports"
            className="bm-nav-item"
            aria-current={resolvedPageId === 'view:reports' ? 'page' : undefined}
            onClick={() => handleSelectPage('view:reports')}
          >
            <span className="truncate">
              {t(MODEL_BUSINESS_NAMES.M7.zh, MODEL_BUSINESS_NAMES.M7.en)}
            </span>
            <span className="bm-nav-count">
              {projection.queriesAndReports.items.length}
            </span>
          </button>

          {projection.other.length > 0 && (
            <>
              <div className="bm-nav-group-label">{t('补充内容', 'Additional')}</div>
              <button
                type="button"
                data-testid="bm-nav-other"
                className="bm-nav-item"
                aria-current={resolvedPageId === 'view:other' ? 'page' : undefined}
                onClick={() => handleSelectPage('view:other')}
              >
                <span className="truncate">{t('其他', 'Other')}</span>
                <span className="bm-nav-count">{projection.other.length}</span>
              </button>
            </>
          )}
        </nav>

        <InlineEditContext.Provider value={inlineEditCtx}>
          <div className="bm-page-scroller">
            {activeObject ? (
              <BusinessObjectPage
                key={activeObject.id}
                object={activeObject}
                businessLocale={businessLocale}
                screenNameById={screenNameById}
                humanize={humanize}
                onSelectObject={(objId) => handleSelectPage(objId)}
                onOpenTechnicalDetails={handleOpenTechnicalDetails}
                flashTarget={effectiveFlashTarget}
                {...(defaultExpandedSections ? { defaultExpandedSections } : {})}
              />
            ) : resolvedPageId === 'view:flows' ? (
              <FlowsCrossView
                projection={projection}
                humanize={humanize}
                onOpenTechnicalDetails={handleOpenTechnicalDetails}
                flashTarget={effectiveFlashTarget}
              />
            ) : resolvedPageId === 'view:roles' ? (
              <RolesCrossView
                projection={projection}
                businessLocale={businessLocale}
                humanize={humanize}
                onSelectObject={(objId) => handleSelectPage(objId)}
                onOpenTechnicalDetails={handleOpenTechnicalDetails}
                flashTarget={effectiveFlashTarget}
              />
            ) : resolvedPageId === 'view:reports' ? (
              <ReportsCrossView
                projection={projection}
                humanize={humanize}
                onSelectObject={(objId) => handleSelectPage(objId)}
                onOpenTechnicalDetails={handleOpenTechnicalDetails}
                flashTarget={effectiveFlashTarget}
              />
            ) : (
              <OtherFallbackView
                items={projection.other}
                businessLocale={businessLocale}
                humanize={humanize}
                onOpenTechnicalDetails={handleOpenTechnicalDetails}
                flashTarget={effectiveFlashTarget}
              />
            )}
          </div>
        </InlineEditContext.Provider>
      </div>
      {historyDrawerNode}
    </div>
  );
}

/* ─── Shared Internal Building Blocks ─── */

interface InlineEditContextValue {
  readonly activeEdit: InlineEditDraftState | null;
  readonly savingSlotKey: string | null;
  readonly activeRejection: InlineRejectionState | null;
  readonly onStartEdit: (slotKey: string, initialValue: string) => void;
  readonly onChangeDraft: (slotKey: string, nextValue: string) => void;
  readonly onCancel: () => void;
  readonly onCommit: (
    slotKey: string,
    initialValue: string,
    buildEdit: (nextValue: string) => BusinessModelInlineEditTarget,
  ) => Promise<void>;
  readonly onAskAssistant: (rejection: InlineRejectionState) => void;
}

const InlineEditContext = createContext<InlineEditContextValue>({
  activeEdit: null,
  savingSlotKey: null,
  activeRejection: null,
  onStartEdit: () => undefined,
  onChangeDraft: () => undefined,
  onCancel: () => undefined,
  onCommit: async () => undefined,
  onAskAssistant: () => undefined,
});

function InlineEditableText({
  slotKey,
  displayValue,
  initialEditValue,
  placeholder,
  ariaLabel,
  multiline = false,
  isPlaceholder = false,
  buildEdit,
}: {
  slotKey: string;
  displayValue: string;
  initialEditValue: string;
  placeholder: string;
  ariaLabel: string;
  multiline?: boolean;
  isPlaceholder?: boolean;
  buildEdit: (nextValue: string) => BusinessModelInlineEditTarget;
}) {
  const { t } = usePreferences();
  const ctx = useContext(InlineEditContext);
  const isEditing = ctx.activeEdit?.slotKey === slotKey;
  const isSaving = ctx.savingSlotKey === slotKey;

  if (isEditing) {
    const draft = ctx.activeEdit?.draftValue ?? initialEditValue;
    const submit = () => {
      void ctx.onCommit(slotKey, initialEditValue, buildEdit);
    };
    return (
      <span
        className={`bm-inline-editor${multiline ? ' is-block' : ''}`}
        data-testid="business-inline-editor"
      >
        {multiline ? (
          <textarea
            className="bm-inline-input"
            data-testid="business-inline-input"
            aria-label={ariaLabel}
            placeholder={placeholder}
            rows={2}
            autoFocus
            disabled={isSaving}
            value={draft}
            onChange={(e) => ctx.onChangeDraft(slotKey, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                ctx.onCancel();
              } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                submit();
              }
            }}
          />
        ) : (
          <input
            type="text"
            className="bm-inline-input"
            data-testid="business-inline-input"
            aria-label={ariaLabel}
            placeholder={placeholder}
            autoFocus
            disabled={isSaving}
            value={draft}
            onChange={(e) => ctx.onChangeDraft(slotKey, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                ctx.onCancel();
              } else if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
          />
        )}
        <button
          type="button"
          className="bm-inline-save-btn"
          data-testid="business-inline-save-btn"
          disabled={isSaving}
          onClick={submit}
        >
          <span>{t('保存', 'Save')}</span>
        </button>
        <button
          type="button"
          className="bm-inline-cancel-btn"
          data-testid="business-inline-cancel-btn"
          disabled={isSaving}
          onClick={ctx.onCancel}
        >
          <span>{t('取消', 'Cancel')}</span>
        </button>
      </span>
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      className={isPlaceholder ? 'bm-editable-placeholder' : 'bm-editable'}
      data-testid={`inline-edit-trigger-${slotKey}`}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        ctx.onStartEdit(slotKey, initialEditValue);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          ctx.onStartEdit(slotKey, initialEditValue);
        }
      }}
    >
      {displayValue}
    </span>
  );
}

function InlineOptionalDescription({
  slotKey,
  value,
  itemTitle,
  leadingSeparator = ' · ',
  emptySeparator = ' ',
  buildEdit,
}: {
  slotKey: string;
  value: string;
  itemTitle: string;
  leadingSeparator?: string;
  emptySeparator?: string;
  buildEdit: (nextDesc: string) => BusinessModelInlineEditTarget;
}) {
  const { t } = usePreferences();
  const placeholder = t('输入说明', 'Enter description');

  if (value) {
    return (
      <>
        {leadingSeparator}
        <InlineEditableText
          slotKey={slotKey}
          displayValue={value}
          initialEditValue={value}
          placeholder={placeholder}
          ariaLabel={t(`修改说明：${itemTitle}`, `Edit description: ${itemTitle}`)}
          buildEdit={buildEdit}
        />
      </>
    );
  }

  return (
    <>
      {emptySeparator}
      <InlineEditableText
        slotKey={slotKey}
        displayValue={t('添加说明', 'Add description')}
        initialEditValue=""
        placeholder={placeholder}
        ariaLabel={t(`添加说明：${itemTitle}`, `Add description: ${itemTitle}`)}
        isPlaceholder
        buildEdit={buildEdit}
      />
    </>
  );
}

function InlineRejectionSlot({ slotKeys }: { slotKeys: readonly string[] }) {
  const { locale, t } = usePreferences();
  const ctx = useContext(InlineEditContext);
  const rejection = ctx.activeRejection;
  if (!rejection || !slotKeys.includes(rejection.slotKey)) {
    return null;
  }

  const reason = locale === 'en-US' ? rejection.reasonEn : rejection.reasonZh;
  return (
    <div
      className="bm-reject-banner"
      data-testid="business-edit-rejected-banner"
      role="status"
      aria-live="polite"
    >
      <p className="bm-reject-reason">
        <TriangleAlert size={14} aria-hidden="true" />
        <span>{reason}</span>
      </p>
      <div className="bm-reject-actions">
        <button
          type="button"
          className="bm-reject-assist-btn"
          data-testid="business-edit-ask-assistant-btn"
          onClick={() => ctx.onAskAssistant(rejection)}
        >
          <Sparkles size={12} aria-hidden="true" />
          <span>{t('让 AI 助手处理', 'Let AI Assistant handle it')}</span>
        </button>
        <button
          type="button"
          className="bm-inline-cancel-btn"
          data-testid="business-edit-cancel-btn"
          onClick={ctx.onCancel}
        >
          <span>{t('取消', 'Cancel')}</span>
        </button>
      </div>
    </div>
  );
}

function ItemTechButton({
  itemId,
  locator,
  onOpenTechnicalDetails,
}: {
  itemId: string;
  locator: TechnicalLocator;
  onOpenTechnicalDetails: (locator: TechnicalLocator) => void;
}) {
  const { t } = usePreferences();
  return (
    <button
      type="button"
      className="bm-item-tech-btn"
      data-testid={`open-tech-locator-${itemId}`}
      onClick={() => onOpenTechnicalDetails(locator)}
    >
      <Code2 size={12} aria-hidden="true" />
      <span>
        {t(
          BUSINESS_VOCABULARY.TECHNICAL_DETAILS.zh,
          BUSINESS_VOCABULARY.TECHNICAL_DETAILS.en,
        )}
      </span>
    </button>
  );
}

function CrossViewHeader({
  title,
  description,
  locator,
  onOpenTechnicalDetails,
}: {
  title: string;
  description: string;
  locator: TechnicalLocator;
  onOpenTechnicalDetails: (locator: TechnicalLocator) => void;
}) {
  const { t } = usePreferences();
  return (
    <header className="bm-article-head">
      <div className="bm-article-title-row">
        <h2 className="bm-article-title">{title}</h2>
        <button
          type="button"
          className="bm-ghost-btn"
          data-testid="open-technical-details-btn"
          onClick={() => onOpenTechnicalDetails(locator)}
        >
          <Code2 size={14} aria-hidden="true" />
          <span>
            {t(
              BUSINESS_VOCABULARY.TECHNICAL_DETAILS.zh,
              BUSINESS_VOCABULARY.TECHNICAL_DETAILS.en,
            )}
          </span>
        </button>
      </div>
      <p className="bm-article-desc">{description}</p>
    </header>
  );
}

/* ─── Business Object Page (`M1` Aggregate-Centered Projection) ─── */

function findSectionForFlashAnchor(
  object: BusinessObjectProjection,
  anchorId: string | undefined,
): DefaultExpandedObjectSection | DefaultCollapsedObjectSection | null {
  if (!anchorId) return null;
  if (object.actions.some((a) => a.id === anchorId)) return 'actions';
  if (object.businessRules.some((r) => r.id === anchorId)) return 'businessRules';
  if (object.associations.some((a) => a.id === anchorId)) return 'fields';
  if (object.events.some((e) => e.id === anchorId)) return 'events';
  if (object.automations.some((a) => a.id === anchorId)) return 'automations';
  if (
    object.screens.some(
      (s) =>
        s.id === anchorId ||
        s.screenId === anchorId ||
        s.navigationEdges.some((e) => e.id === anchorId) ||
        s.crossCuttingUi.some((c) => c.id === anchorId),
    )
  ) {
    return 'screens';
  }
  if (object.integrations.some((i) => i.id === anchorId || i.interfaceId === anchorId)) {
    return 'integrations';
  }
  if (object.dataStorage.some((d) => d.id === anchorId)) return 'dataStorage';
  return null;
}

function BusinessObjectPage({
  object,
  businessLocale,
  screenNameById,
  humanize,
  onSelectObject,
  onOpenTechnicalDetails,
  flashTarget,
  defaultExpandedSections,
}: {
  object: BusinessObjectProjection;
  businessLocale: BusinessLocale;
  screenNameById: ReadonlyMap<string, string>;
  humanize: (raw: string | undefined) => string;
  onSelectObject: (objectId: string) => void;
  onOpenTechnicalDetails: (locator: TechnicalLocator) => void;
  flashTarget: { readonly anchorId: string; readonly at: number } | null;
  defaultExpandedSections?: readonly (
    | DefaultExpandedObjectSection
    | DefaultCollapsedObjectSection
  )[];
}) {
  const { t } = usePreferences();
  const listSep = businessLocale === 'en-US' ? ', ' : '、';

  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const sec of DEFAULT_EXPANDED_OBJECT_SECTIONS) initial[sec] = true;
    for (const sec of DEFAULT_COLLAPSED_OBJECT_SECTIONS) initial[sec] = false;
    for (const sec of defaultExpandedSections ?? []) initial[sec] = true;
    const flashedSec = findSectionForFlashAnchor(object, flashTarget?.anchorId);
    if (flashedSec) initial[flashedSec] = true;
    return initial;
  });

  useEffect(() => {
    if (!flashTarget?.anchorId) return;
    const flashedSec = findSectionForFlashAnchor(object, flashTarget.anchorId);
    if (flashedSec) {
      setExpandedMap((prev) => (prev[flashedSec] ? prev : { ...prev, [flashedSec]: true }));
    }
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      window.requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>('[data-flash="true"]');
        el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      });
    }
  }, [object, flashTarget?.anchorId, flashTarget?.at]);

  const isExpanded = (
    sec: DefaultExpandedObjectSection | DefaultCollapsedObjectSection,
  ): boolean => Boolean(expandedMap[sec]);

  const toggleSection = (
    sec: DefaultExpandedObjectSection | DefaultCollapsedObjectSection,
  ) => {
    setExpandedMap((prev) => ({ ...prev, [sec]: !prev[sec] }));
  };

  const objectTitle = humanize(object.displayName);
  const objectDesc =
    humanize(object.description) ||
    t('承载该业务对象的关键字段、操作、规则与权限。', 'Holds fields, actions, rules, and permissions for this business object.');

  const boundVoNames = new Set(
    object.fields.map((f) => f.valueObject?.name).filter((v): v is string => Boolean(v)),
  );
  const standaloneValueObjects = object.valueObjects.filter((vo) => !boundVoNames.has(vo.name));

  const fieldRowCount =
    object.fields.length + object.subEntities.length + standaloneValueObjects.length;

  const whoRowCount =
    object.authorizedRoles.length +
    (object.automaticActions.length > 0 ? 1 : 0) +
    (object.unauthorizedActions.length > 0 ? 1 : 0);

  return (
    <article className="bm-article" data-testid="business-object-page">
      <header
        className="bm-article-head"
        data-flash={flashTarget?.anchorId === object.id ? 'true' : undefined}
      >
        <div className="bm-article-title-row">
          <h2 className="bm-article-title" data-testid="business-object-title">
            <InlineEditableText
              slotKey={`object-name-${object.id}`}
              displayValue={objectTitle}
              initialEditValue={objectTitle}
              placeholder={t('输入业务对象名称', 'Enter business object name')}
              ariaLabel={t(`修改业务对象名称：${objectTitle}`, `Edit business object name: ${objectTitle}`)}
              buildEdit={(nextName) => ({
                kind: 'BUSINESS_OBJECT',
                objectId: object.id,
                name: nextName,
              })}
            />
          </h2>
          <button
            type="button"
            className="bm-ghost-btn"
            data-testid="open-technical-details-btn"
            onClick={() => onOpenTechnicalDetails(object.locator)}
          >
            <Code2 size={14} aria-hidden="true" />
            <span>
              {t(
                BUSINESS_VOCABULARY.TECHNICAL_DETAILS.zh,
                BUSINESS_VOCABULARY.TECHNICAL_DETAILS.en,
              )}
            </span>
          </button>
        </div>
        <div className="bm-article-desc" data-testid="business-object-description">
          <InlineEditableText
            slotKey={`object-desc-${object.id}`}
            displayValue={objectDesc}
            initialEditValue={humanize(object.description)}
            placeholder={t('输入业务对象的职责说明', 'Describe what this business object holds')}
            ariaLabel={t(`修改业务对象说明：${objectTitle}`, `Edit description for ${objectTitle}`)}
            multiline
            buildEdit={(nextDesc) => ({
              kind: 'BUSINESS_OBJECT',
              objectId: object.id,
              description: nextDesc,
            })}
          />
        </div>
        <InlineRejectionSlot
          slotKeys={[`object-name-${object.id}`, `object-desc-${object.id}`]}
        />
        {object.lifecycle.length > 0 && (
          <div className="bm-lifecycle-row">
            <span>{t('流转状态：', 'States:')}</span>
            {object.lifecycle.map((stateCode, idx) => (
              <span key={`${stateCode}-${idx}`} className="bm-lifecycle-chip">
                {formatLifecycleState(stateCode, businessLocale)}
              </span>
            ))}
          </div>
        )}
      </header>

      {/* 1. 字段 (Fields) — Default Expanded */}
      <section className="bm-sec" data-testid="object-section-fields">
        <button
          type="button"
          className="bm-sec-head"
          data-testid="object-section-toggle-fields"
          aria-expanded={isExpanded('fields')}
          onClick={() => toggleSection('fields')}
        >
          {isExpanded('fields') ? (
            <ChevronDown size={14} aria-hidden="true" />
          ) : (
            <ChevronRight size={14} aria-hidden="true" />
          )}
          <span className="bm-sec-title">{t('字段', 'Fields')}</span>
          <span className="bm-sec-count">{fieldRowCount}</span>
        </button>
        {isExpanded('fields') &&
          (fieldRowCount > 0 || object.associations.length > 0 ? (
            <>
              {fieldRowCount > 0 && (
                <table className="bm-table">
                  <tbody>
                    {object.fields.map((field) => (
                      <FieldRow
                        key={field.id}
                        objectId={object.id}
                        field={field}
                        businessLocale={businessLocale}
                        humanize={humanize}
                        onSelectObject={onSelectObject}
                      />
                    ))}
                    {object.subEntities.map((se) => {
                      const subFieldNames = se.fields
                        .map((f) => humanize(f.displayName))
                        .join(listSep);
                      const seTitle = humanize(se.displayName);
                      const seDesc = humanize(se.description);
                      const nameSlot = `subentity-name-${object.id}-${se.name}`;
                      const descSlot = `subentity-desc-${object.id}-${se.name}`;
                      return (
                        <tr key={se.id}>
                          <td className="bm-cell-name">
                            <InlineEditableText
                              slotKey={nameSlot}
                              displayValue={seTitle}
                              initialEditValue={seTitle}
                              placeholder={t('输入明细列表名称', 'Enter detail list name')}
                              ariaLabel={t(`修改名称：${seTitle}`, `Rename: ${seTitle}`)}
                              buildEdit={(nextName) => ({
                                kind: 'SUB_ENTITY',
                                objectId: object.id,
                                entityName: se.name,
                                name: nextName,
                              })}
                            />
                          </td>
                          <td className="bm-cell-kind">{t('明细列表', 'Detail items')}</td>
                          <td className="bm-cell-note">
                            {subFieldNames
                              ? t(`包含：${subFieldNames}`, `Includes: ${subFieldNames}`)
                              : ''}
                            <InlineOptionalDescription
                              slotKey={descSlot}
                              value={seDesc}
                              itemTitle={seTitle}
                              leadingSeparator={subFieldNames ? ' · ' : ''}
                              emptySeparator={subFieldNames ? ' ' : ''}
                              buildEdit={(nextDesc) => ({
                                kind: 'SUB_ENTITY',
                                objectId: object.id,
                                entityName: se.name,
                                description: nextDesc,
                              })}
                            />
                            <InlineRejectionSlot slotKeys={[nameSlot, descSlot]} />
                          </td>
                        </tr>
                      );
                    })}
                    {standaloneValueObjects.map((vo) => {
                      const voFieldNames = vo.fields
                        .map((f) => humanize(f.displayName))
                        .join(listSep);
                      const voTitle = humanize(vo.displayName);
                      const voDesc = humanize(vo.description);
                      const nameSlot = `vo-name-${object.id}-${vo.name}`;
                      const descSlot = `vo-desc-${object.id}-${vo.name}`;
                      return (
                        <tr key={vo.id}>
                          <td className="bm-cell-name">
                            <InlineEditableText
                              slotKey={nameSlot}
                              displayValue={voTitle}
                              initialEditValue={voTitle}
                              placeholder={t('输入组合信息名称', 'Enter grouped info name')}
                              ariaLabel={t(`修改名称：${voTitle}`, `Rename: ${voTitle}`)}
                              buildEdit={(nextName) => ({
                                kind: 'VALUE_OBJECT',
                                objectId: object.id,
                                valueObjectName: vo.name,
                                name: nextName,
                              })}
                            />
                          </td>
                          <td className="bm-cell-kind">{t('组合信息', 'Grouped info')}</td>
                          <td className="bm-cell-note">
                            {voFieldNames
                              ? t(`包含：${voFieldNames}`, `Includes: ${voFieldNames}`)
                              : ''}
                            {voDesc ? (
                              <>
                                {voFieldNames ? ' · ' : ''}
                                <InlineEditableText
                                  slotKey={descSlot}
                                  displayValue={voDesc}
                                  initialEditValue={voDesc}
                                  placeholder={t('输入说明', 'Enter description')}
                                  ariaLabel={t(`修改说明：${voTitle}`, `Edit description: ${voTitle}`)}
                                  buildEdit={(nextDesc) => ({
                                    kind: 'VALUE_OBJECT',
                                    objectId: object.id,
                                    valueObjectName: vo.name,
                                    description: nextDesc,
                                  })}
                                />
                              </>
                            ) : null}
                            <InlineRejectionSlot slotKeys={[nameSlot, descSlot]} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {object.associations.length > 0 && (
                <div className="bm-subsec" data-testid="object-associations-list">
                  <div className="bm-subsec-title">
                    {t(
                      `对象关联 · ${object.associations.length}`,
                      `Object relationships · ${object.associations.length}`,
                    )}
                  </div>
                  <ul className="bm-list">
                    {object.associations.map((assoc) => {
                      const counterpart =
                        assoc.direction === 'OUTGOING'
                          ? assoc.targetObject
                          : assoc.direction === 'INCOMING'
                            ? assoc.sourceObject
                            : assoc.targetObject ?? assoc.sourceObject;
                      const roleLabel =
                        humanize(
                          assoc.direction === 'OUTGOING' ? assoc.targetRole : assoc.sourceRole,
                        ) ||
                        humanize(counterpart?.displayName) ||
                        t('关联对象', 'Related object');
                      const cardLabel = pickBusinessText(
                        ASSOCIATION_CARDINALITY_LABELS[assoc.cardinality],
                        businessLocale,
                      );
                      const assocDesc = humanize(assoc.description);
                      const descSlot = `assoc-desc-${assoc.id}`;
                      return (
                        <li key={`${assoc.id}-${assoc.direction}`}>
                          <span className="bm-item-name">{roleLabel}</span>
                          <span className="bm-item-note">
                            {counterpart ? (
                              <>
                                <button
                                  type="button"
                                  className="bm-inline-link"
                                  onClick={() => onSelectObject(counterpart.id)}
                                >
                                  {assoc.direction === 'INCOMING'
                                    ? t(
                                        `被「${humanize(counterpart.displayName)}」关联`,
                                        `Referenced by "${humanize(counterpart.displayName)}"`,
                                      )
                                    : t(
                                        `关联「${humanize(counterpart.displayName)}」`,
                                        `Links to "${humanize(counterpart.displayName)}"`,
                                      )}
                                </button>
                                {' · '}
                              </>
                            ) : null}
                            {cardLabel}
                            <InlineOptionalDescription
                              slotKey={descSlot}
                              value={assocDesc}
                              itemTitle={roleLabel}
                              buildEdit={(nextDesc) => ({
                                kind: 'ASSOCIATION',
                                associationId: assoc.id,
                                description: nextDesc,
                              })}
                            />
                            <InlineRejectionSlot slotKeys={[descSlot]} />
                          </span>
                          <ItemTechButton
                            itemId={assoc.id}
                            locator={assoc.locator}
                            onOpenTechnicalDetails={onOpenTechnicalDetails}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p className="bm-empty-note">{t('暂未定义字段。', 'No fields defined yet.')}</p>
          ))}
      </section>

      {/* 2. 业务操作 (Actions) — Default Expanded */}
      <section className="bm-sec" data-testid="object-section-actions">
        <button
          type="button"
          className="bm-sec-head"
          data-testid="object-section-toggle-actions"
          aria-expanded={isExpanded('actions')}
          onClick={() => toggleSection('actions')}
        >
          {isExpanded('actions') ? (
            <ChevronDown size={14} aria-hidden="true" />
          ) : (
            <ChevronRight size={14} aria-hidden="true" />
          )}
          <span className="bm-sec-title">
            {t(MODEL_BUSINESS_NAMES.M2.zh, MODEL_BUSINESS_NAMES.M2.en)}
          </span>
          <span className="bm-sec-count">{object.actions.length}</span>
        </button>
        {isExpanded('actions') &&
          (object.actions.length > 0 ? (
            <ul className="bm-list">
              {object.actions.map((act) => {
                const actTitle = humanize(act.displayName);
                const actDesc = humanize(act.description);
                const defaultActDesc = act.isAutomatic
                  ? t('由系统自动执行', 'Triggered automatically')
                  : t('人工发起的业务操作', 'User-initiated action');
                const nameSlot = `action-name-${act.id}`;
                const descSlot = `action-desc-${act.id}`;
                return (
                  <li
                    key={act.id}
                    data-flash={flashTarget?.anchorId === act.id ? 'true' : undefined}
                  >
                    <span className="bm-item-name">
                      <InlineEditableText
                        slotKey={nameSlot}
                        displayValue={actTitle}
                        initialEditValue={actTitle}
                        placeholder={t('输入业务操作名称', 'Enter action name')}
                        ariaLabel={t(`修改业务操作名称：${actTitle}`, `Rename action: ${actTitle}`)}
                        buildEdit={(nextName) => ({
                          kind: 'ACTION',
                          actionId: act.id,
                          name: nextName,
                        })}
                      />
                    </span>
                    <span className="bm-item-note">
                      <InlineEditableText
                        slotKey={descSlot}
                        displayValue={actDesc || defaultActDesc}
                        initialEditValue={actDesc}
                        placeholder={t('输入业务操作说明', 'Describe what this action does')}
                        ariaLabel={t(`修改业务操作说明：${actTitle}`, `Edit action description: ${actTitle}`)}
                        buildEdit={(nextDesc) => ({
                          kind: 'ACTION',
                          actionId: act.id,
                          description: nextDesc,
                        })}
                      />
                      <InlineRejectionSlot slotKeys={[nameSlot, descSlot]} />
                    </span>
                    <ItemTechButton
                      itemId={act.id}
                      locator={act.locator}
                      onOpenTechnicalDetails={onOpenTechnicalDetails}
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="bm-empty-note">
              {t('暂未定义业务操作。', 'No actions defined yet.')}
            </p>
          ))}
      </section>

      {/* 3. 业务规则 (Business Rules) — Default Expanded */}
      <section className="bm-sec" data-testid="object-section-businessRules">
        <button
          type="button"
          className="bm-sec-head"
          data-testid="object-section-toggle-businessRules"
          aria-expanded={isExpanded('businessRules')}
          onClick={() => toggleSection('businessRules')}
        >
          {isExpanded('businessRules') ? (
            <ChevronDown size={14} aria-hidden="true" />
          ) : (
            <ChevronRight size={14} aria-hidden="true" />
          )}
          <span className="bm-sec-title">
            {t(MODEL_BUSINESS_NAMES.M3.zh, MODEL_BUSINESS_NAMES.M3.en)}
          </span>
          <span className="bm-sec-count">{object.businessRules.length}</span>
        </button>
        {isExpanded('businessRules') &&
          (object.businessRules.length > 0 ? (
            <ul className="bm-list">
              {object.businessRules.map((rule) => (
                <BusinessRuleRow
                  key={rule.id}
                  rule={rule}
                  currentObjectId={object.id}
                  flashed={flashTarget?.anchorId === rule.id}
                  humanize={humanize}
                  onSelectObject={onSelectObject}
                  onOpenTechnicalDetails={onOpenTechnicalDetails}
                />
              ))}
            </ul>
          ) : (
            <p className="bm-empty-note">
              {t('暂未定义业务规则。', 'No business rules defined yet.')}
            </p>
          ))}
      </section>

      {/* 4. 谁能做 (Who can do what) — Default Expanded */}
      <section className="bm-sec" data-testid="object-section-authorizedRoles">
        <button
          type="button"
          className="bm-sec-head"
          data-testid="object-section-toggle-authorizedRoles"
          aria-expanded={isExpanded('authorizedRoles')}
          onClick={() => toggleSection('authorizedRoles')}
        >
          {isExpanded('authorizedRoles') ? (
            <ChevronDown size={14} aria-hidden="true" />
          ) : (
            <ChevronRight size={14} aria-hidden="true" />
          )}
          <span className="bm-sec-title">{t('谁能做', 'Who can do what')}</span>
          <span className="bm-sec-count">{whoRowCount}</span>
        </button>
        {isExpanded('authorizedRoles') &&
          (whoRowCount > 0 ? (
            <ul className="bm-list">
              {object.authorizedRoles.map((auth) => (
                <li key={auth.roleId}>
                  <span className="bm-item-name">{humanize(auth.displayName)}</span>
                  <span className="bm-item-note">
                    {auth.actions.map((a) => humanize(a.displayName)).join(listSep)}
                  </span>
                  <ItemTechButton
                    itemId={auth.roleId}
                    locator={auth.locator}
                    onOpenTechnicalDetails={onOpenTechnicalDetails}
                  />
                </li>
              ))}
              {object.automaticActions.length > 0 && (
                <li>
                  <span className="bm-item-name">{t('系统自动', 'System automatic')}</span>
                  <span className="bm-item-note">
                    {object.automaticActions.map((a) => humanize(a.displayName)).join(listSep)}
                  </span>
                  <span />
                </li>
              )}
              {object.unauthorizedActions.length > 0 && (
                <li>
                  <span className="bm-item-name is-warn">
                    {t('尚未分配角色', 'No role assigned yet')}
                  </span>
                  <span className="bm-item-note">
                    {object.unauthorizedActions
                      .map((a) => humanize(a.displayName))
                      .join(listSep)}
                  </span>
                  <span />
                </li>
              )}
            </ul>
          ) : (
            <p className="bm-empty-note">
              {t('尚未配置角色授权。', 'No role permissions configured yet.')}
            </p>
          ))}
      </section>

      {/* 5. 业务事件 (Business Events) — Default Collapsed */}
      <CollapsedSection
        sectionKey="events"
        title={t(MODEL_BUSINESS_NAMES.ME.zh, MODEL_BUSINESS_NAMES.ME.en)}
        count={object.events.length}
        open={isExpanded('events')}
        onToggle={() => toggleSection('events')}
        summary={object.events.map((ev) => humanize(ev.displayName)).join(listSep)}
        emptyText={t('暂无业务事件。', 'No business events yet.')}
      >
        <ul className="bm-list">
          {object.events.map((ev) => {
            const evTitle = humanize(ev.displayName);
            const evDesc = humanize(ev.description);
            const nameSlot = `event-name-${ev.id}`;
            const descSlot = `event-desc-${ev.id}`;
            const relText =
              ev.relation === 'SUBSCRIBED'
                ? t('响应此事件', 'Responds to this event')
                : ev.relation === 'BOTH'
                  ? t('发出并响应此事件', 'Produces and responds to this event')
                  : t('操作完成后发出', 'Emitted after action');
            return (
              <li
                key={ev.id}
                data-flash={flashTarget?.anchorId === ev.id ? 'true' : undefined}
              >
                <span className="bm-item-name">
                  <InlineEditableText
                    slotKey={nameSlot}
                    displayValue={evTitle}
                    initialEditValue={evTitle}
                    placeholder={t('输入业务事件名称', 'Enter business event name')}
                    ariaLabel={t(`修改业务事件名称：${evTitle}`, `Rename business event: ${evTitle}`)}
                    buildEdit={(nextName) => ({
                      kind: 'EVENT',
                      eventId: ev.id,
                      name: nextName,
                    })}
                  />
                </span>
                <span className="bm-item-note">
                  {relText}
                  <InlineOptionalDescription
                    slotKey={descSlot}
                    value={evDesc}
                    itemTitle={evTitle}
                    buildEdit={(nextDesc) => ({
                      kind: 'EVENT',
                      eventId: ev.id,
                      description: nextDesc,
                    })}
                  />
                  <InlineRejectionSlot slotKeys={[nameSlot, descSlot]} />
                </span>
                <ItemTechButton
                  itemId={ev.id}
                  locator={ev.locator}
                  onOpenTechnicalDetails={onOpenTechnicalDetails}
                />
              </li>
            );
          })}
        </ul>
      </CollapsedSection>

      {/* 6. 自动联动 (Automations) — Default Collapsed */}
      <CollapsedSection
        sectionKey="automations"
        title={t(MODEL_BUSINESS_NAMES.M4.zh, MODEL_BUSINESS_NAMES.M4.en)}
        count={object.automations.length}
        open={isExpanded('automations')}
        onToggle={() => toggleSection('automations')}
        summary={object.automations.map((au) => humanize(au.displayName)).join(listSep)}
        emptyText={t('暂无自动联动。', 'No automations yet.')}
      >
        <ul className="bm-list">
          {object.automations.map((au) => {
            const auTitle = humanize(au.displayName);
            const auDesc = humanize(au.description);
            const nameSlot = `automation-name-${au.id}`;
            const descSlot = `automation-desc-${au.id}`;
            return (
              <li
                key={au.id}
                data-flash={flashTarget?.anchorId === au.id ? 'true' : undefined}
              >
                <span className="bm-item-name">
                  <InlineEditableText
                    slotKey={nameSlot}
                    displayValue={auTitle}
                    initialEditValue={auTitle}
                    placeholder={t('输入自动联动名称', 'Enter automation name')}
                    ariaLabel={t(`修改自动联动名称：${auTitle}`, `Rename automation: ${auTitle}`)}
                    buildEdit={(nextName) => ({
                      kind: 'AUTOMATION',
                      scenarioId: au.id,
                      name: nextName,
                    })}
                  />
                </span>
                <span className="bm-item-note">
                  <InlineEditableText
                    slotKey={descSlot}
                    displayValue={
                      auDesc || t('跨业务对象的自动协同动作', 'Cross-object automated workflow')
                    }
                    initialEditValue={auDesc}
                    placeholder={t('输入自动联动说明', 'Enter automation description')}
                    ariaLabel={t(`修改自动联动说明：${auTitle}`, `Edit automation description: ${auTitle}`)}
                    buildEdit={(nextDesc) => ({
                      kind: 'AUTOMATION',
                      scenarioId: au.id,
                      description: nextDesc,
                    })}
                  />
                  <InlineRejectionSlot slotKeys={[nameSlot, descSlot]} />
                </span>
                <ItemTechButton
                  itemId={au.id}
                  locator={au.locator}
                  onOpenTechnicalDetails={onOpenTechnicalDetails}
                />
              </li>
            );
          })}
        </ul>
      </CollapsedSection>

      {/* 7. 界面 (Screens) — Default Collapsed */}
      <CollapsedSection
        sectionKey="screens"
        title={t(MODEL_BUSINESS_NAMES.MU.zh, MODEL_BUSINESS_NAMES.MU.en)}
        count={object.screens.length}
        open={isExpanded('screens')}
        onToggle={() => toggleSection('screens')}
        summary={object.screens.map((sc) => humanize(sc.displayName)).join(listSep)}
        emptyText={t('暂无关联界面。', 'No linked screens yet.')}
      >
        <ul className="bm-list">
          {object.screens.map((sc) => {
            const typeSpec = SCREEN_TYPE_LABELS[sc.screenType];
            const typeText = typeSpec
              ? pickBusinessText(typeSpec, businessLocale)
              : t('业务界面', 'Screen');
            const scTitle = humanize(sc.displayName);
            const desc = humanize(sc.description);
            const nameSlot = `screen-name-${sc.id}`;
            const descSlot = `screen-desc-${sc.id}`;
            return (
              <li
                key={sc.id}
                data-flash={
                  flashTarget?.anchorId === sc.id || flashTarget?.anchorId === sc.screenId
                    ? 'true'
                    : undefined
                }
              >
                <span className="bm-item-name">
                  <InlineEditableText
                    slotKey={nameSlot}
                    displayValue={scTitle}
                    initialEditValue={scTitle}
                    placeholder={t('输入界面名称', 'Enter screen name')}
                    ariaLabel={t(`修改界面名称：${scTitle}`, `Rename screen: ${scTitle}`)}
                    buildEdit={(nextName) => ({
                      kind: 'SCREEN',
                      screenId: sc.screenId,
                      name: nextName,
                    })}
                  />
                </span>
                <span className="bm-item-note">
                  {typeText}
                  <InlineOptionalDescription
                    slotKey={descSlot}
                    value={desc}
                    itemTitle={scTitle}
                    buildEdit={(nextDesc) => ({
                      kind: 'SCREEN',
                      screenId: sc.screenId,
                      description: nextDesc,
                    })}
                  />
                  <InlineRejectionSlot slotKeys={[nameSlot, descSlot]} />
                </span>
                <ItemTechButton
                  itemId={sc.id}
                  locator={sc.locator}
                  onOpenTechnicalDetails={onOpenTechnicalDetails}
                />
              </li>
            );
          })}
        </ul>
        {(() => {
          const seenEdgeIds = new Set<string>();
          const uniqueEdges: NavigationEdge[] = [];
          const seenCcIds = new Set<string>();
          const uniqueCrossCutting: CrossCuttingUI[] = [];
          for (const sc of object.screens) {
            for (const edge of sc.navigationEdges) {
              if (!seenEdgeIds.has(edge.id)) {
                seenEdgeIds.add(edge.id);
                uniqueEdges.push(edge);
              }
            }
            for (const cc of sc.crossCuttingUi) {
              if (!seenCcIds.has(cc.id)) {
                seenCcIds.add(cc.id);
                uniqueCrossCutting.push(cc);
              }
            }
          }
          return (
            <>
              {uniqueEdges.length > 0 && (
                <div className="bm-subsec" data-testid="object-screen-navigations">
                  <div className="bm-subsec-title">
                    {t(
                      `页面流转 · ${uniqueEdges.length}`,
                      `Screen navigation · ${uniqueEdges.length}`,
                    )}
                  </div>
                  <ul className="bm-list">
                    {uniqueEdges.map((edge) => {
                      const fromLabel =
                        humanize(screenNameById.get(edge.fromScreen) ?? edge.fromScreen) ||
                        t('起始页面', 'Source screen');
                      const toLabel =
                        humanize(screenNameById.get(edge.toScreen) ?? edge.toScreen) ||
                        t('目标页面', 'Target screen');
                      const modeText = pickBusinessText(
                        NAV_MODE_LABELS[edge.mode],
                        businessLocale,
                      );
                      const condText = humanize(edge.condition);
                      return (
                        <li key={edge.id}>
                          <span className="bm-item-name">{`${fromLabel} → ${toLabel}`}</span>
                          <span className="bm-item-note">
                            {modeText}
                            {condText ? ` · ${condText}` : ''}
                          </span>
                          <ItemTechButton
                            itemId={edge.id}
                            locator={{ model: 'MU', elementId: edge.id }}
                            onOpenTechnicalDetails={onOpenTechnicalDetails}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {uniqueCrossCutting.length > 0 && (
                <div className="bm-subsec" data-testid="object-screen-crosscutting">
                  <div className="bm-subsec-title">
                    {t(
                      `全局界面元素 · ${uniqueCrossCutting.length}`,
                      `Shared screen elements · ${uniqueCrossCutting.length}`,
                    )}
                  </div>
                  <ul className="bm-list">
                    {uniqueCrossCutting.map((cc) => {
                      const ccTitle =
                        humanize(cc.name) || t('全局界面元素', 'Shared screen element');
                      const ccType = pickBusinessText(
                        CROSS_CUTTING_TYPE_LABELS[cc.type],
                        businessLocale,
                      );
                      const scopeLabels = cc.scopeScreens
                        .filter((s) => s !== '*')
                        .map((s) => humanize(screenNameById.get(s) ?? s))
                        .filter(Boolean)
                        .join(listSep);
                      const ccDesc = humanize(cc.description);
                      const nameSlot = `cc-name-${cc.id}`;
                      const descSlot = `cc-desc-${cc.id}`;
                      return (
                        <li key={cc.id}>
                          <span className="bm-item-name">
                            <InlineEditableText
                              slotKey={nameSlot}
                              displayValue={ccTitle}
                              initialEditValue={ccTitle}
                              placeholder={t('输入全局界面元素名称', 'Enter element name')}
                              ariaLabel={t(`修改名称：${ccTitle}`, `Rename: ${ccTitle}`)}
                              buildEdit={(nextName) => ({
                                kind: 'CROSS_CUTTING_UI',
                                crossCuttingId: cc.id,
                                name: nextName,
                              })}
                            />
                          </span>
                          <span className="bm-item-note">
                            {ccType}
                            {scopeLabels
                              ? t(` · 适用于：${scopeLabels}`, ` · Applies to: ${scopeLabels}`)
                              : ''}
                            <InlineOptionalDescription
                              slotKey={descSlot}
                              value={ccDesc}
                              itemTitle={ccTitle}
                              buildEdit={(nextDesc) => ({
                                kind: 'CROSS_CUTTING_UI',
                                crossCuttingId: cc.id,
                                description: nextDesc,
                              })}
                            />
                            <InlineRejectionSlot slotKeys={[nameSlot, descSlot]} />
                          </span>
                          <ItemTechButton
                            itemId={cc.id}
                            locator={{ model: 'MU', elementId: cc.id }}
                            onOpenTechnicalDetails={onOpenTechnicalDetails}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          );
        })()}
      </CollapsedSection>

      {/* 8. 对外接口 (Integrations) — Default Collapsed */}
      <CollapsedSection
        sectionKey="integrations"
        title={t(MODEL_BUSINESS_NAMES.MI.zh, MODEL_BUSINESS_NAMES.MI.en)}
        count={object.integrations.length}
        open={isExpanded('integrations')}
        onToggle={() => toggleSection('integrations')}
        summary={object.integrations.map((it) => humanize(it.displayName)).join(listSep)}
        emptyText={t('暂无对外接口。', 'No external integrations yet.')}
      >
        <ul className="bm-list">
          {object.integrations.map((it) => {
            const dirLabel =
              it.direction === 'DEPENDENT'
                ? t('调用外部系统', 'Calls external system')
                : t('对外提供能力', 'Provided to external callers');
            const itTitle = humanize(it.displayName);
            const desc = humanize(it.description);
            const nameSlot = `integration-name-${it.id}`;
            const descSlot = `integration-desc-${it.id}`;
            return (
              <li
                key={it.id}
                data-flash={
                  flashTarget?.anchorId === it.id || flashTarget?.anchorId === it.interfaceId
                    ? 'true'
                    : undefined
                }
              >
                <span className="bm-item-name">
                  <InlineEditableText
                    slotKey={nameSlot}
                    displayValue={itTitle}
                    initialEditValue={itTitle}
                    placeholder={t('输入对外接口名称', 'Enter integration name')}
                    ariaLabel={t(`修改对外接口名称：${itTitle}`, `Rename integration: ${itTitle}`)}
                    buildEdit={(nextName) => ({
                      kind: 'INTEGRATION',
                      interfaceId: it.interfaceId,
                      name: nextName,
                    })}
                  />
                </span>
                <span className="bm-item-note">
                  {dirLabel}
                  <InlineOptionalDescription
                    slotKey={descSlot}
                    value={desc}
                    itemTitle={itTitle}
                    buildEdit={(nextDesc) => ({
                      kind: 'INTEGRATION',
                      interfaceId: it.interfaceId,
                      description: nextDesc,
                    })}
                  />
                  <InlineRejectionSlot slotKeys={[nameSlot, descSlot]} />
                </span>
                <ItemTechButton
                  itemId={it.id}
                  locator={it.locator}
                  onOpenTechnicalDetails={onOpenTechnicalDetails}
                />
              </li>
            );
          })}
        </ul>
      </CollapsedSection>

      {/* 9. 数据存储 (Data Storage) — Default Collapsed */}
      <CollapsedSection
        sectionKey="dataStorage"
        title={t(MODEL_BUSINESS_NAMES.MM.zh, MODEL_BUSINESS_NAMES.MM.en)}
        count={object.dataStorage.length}
        open={isExpanded('dataStorage')}
        onToggle={() => toggleSection('dataStorage')}
        summary={object.dataStorage
          .map((ds) => formatDataStorageSummary(ds, objectTitle, businessLocale).note)
          .join(listSep)}
        emptyText={t('尚未整理数据存储。', 'Data storage not yet organized.')}
      >
        <ul className="bm-list">
          {object.dataStorage.map((ds) => {
            const summary = formatDataStorageSummary(ds, objectTitle, businessLocale);
            return (
              <li
                key={ds.id}
                data-flash={flashTarget?.anchorId === ds.id ? 'true' : undefined}
              >
                <span className="bm-item-name">{summary.title}</span>
                <span className="bm-item-note">{summary.note}</span>
                <ItemTechButton
                  itemId={ds.id}
                  locator={ds.locator}
                  onOpenTechnicalDetails={onOpenTechnicalDetails}
                />
              </li>
            );
          })}
        </ul>
      </CollapsedSection>
    </article>
  );
}

function FieldRow({
  objectId,
  field,
  businessLocale,
  humanize,
  onSelectObject,
}: {
  objectId: string;
  field: ProjectedField;
  businessLocale: BusinessLocale;
  humanize: (raw: string | undefined) => string;
  onSelectObject: (objectId: string) => void;
}) {
  const { t } = usePreferences();
  const listSep = businessLocale === 'en-US' ? ', ' : '、';
  const kindLabel = pickBusinessText(
    FIELD_TYPE_LABELS[field.type] ?? FIELD_TYPE_LABELS.String,
    businessLocale,
  );

  const metaParts: string[] = [];
  if (field.required) metaParts.push(t('必填', 'Required'));
  if (field.unique) metaParts.push(t('唯一', 'Unique'));
  if (field.dictionary && field.dictionary.items.length > 0) {
    const opts = field.dictionary.items.map((item) => humanize(item.label)).join(listSep);
    metaParts.push(t(`可选：${opts}`, `Options: ${opts}`));
  } else if (field.enumValues && field.enumValues.length > 0) {
    const opts = field.enumValues
      .map((val) => formatLifecycleState(val, businessLocale))
      .join(listSep);
    metaParts.push(t(`可选：${opts}`, `Options: ${opts}`));
  }
  if (field.valueObject && field.valueObject.fields.length > 0) {
    const subFields = field.valueObject.fields
      .map((vf) => humanize(vf.displayName))
      .join(listSep);
    metaParts.push(t(`包含：${subFields}`, `Includes: ${subFields}`));
  }

  const fieldTitle = humanize(field.displayName);
  const cleanDesc = humanize(field.description);
  const ownerPrefix =
    field.ownerKind === 'AGGREGATE' ? objectId : `${objectId}-${field.ownerName}`;
  const nameSlot = `field-name-${ownerPrefix}-${field.name}`;
  const descSlot = `field-desc-${ownerPrefix}-${field.name}`;

  const hasPrefixContent = Boolean(field.targetObject) || metaParts.length > 0;

  return (
    <tr>
      <td className="bm-cell-name">
        <InlineEditableText
          slotKey={nameSlot}
          displayValue={fieldTitle}
          initialEditValue={fieldTitle}
          placeholder={t('输入字段名称', 'Enter field name')}
          ariaLabel={t(`修改字段名称：${fieldTitle}`, `Rename field: ${fieldTitle}`)}
          buildEdit={(nextName) => ({
            kind: 'FIELD',
            objectId,
            fieldName: field.name,
            ownerKind: field.ownerKind,
            ownerName: field.ownerName,
            name: nextName,
          })}
        />
      </td>
      <td className="bm-cell-kind">{kindLabel}</td>
      <td className="bm-cell-note">
        {field.targetObject && (
          <>
            <button
              type="button"
              className="bm-inline-link"
              onClick={() => onSelectObject(field.targetObject!.id)}
            >
              {t(
                `关联「${humanize(field.targetObject.displayName)}」`,
                `Links to "${humanize(field.targetObject.displayName)}"`,
              )}
            </button>
            {metaParts.length > 0 ? ' · ' : ''}
          </>
        )}
        {metaParts.join(' · ')}
        <InlineOptionalDescription
          slotKey={descSlot}
          value={cleanDesc}
          itemTitle={fieldTitle}
          leadingSeparator={hasPrefixContent ? ' · ' : ''}
          emptySeparator={hasPrefixContent ? ' ' : ''}
          buildEdit={(nextDesc) => ({
            kind: 'FIELD',
            objectId,
            fieldName: field.name,
            ownerKind: field.ownerKind,
            ownerName: field.ownerName,
            description: nextDesc,
          })}
        />
        <InlineRejectionSlot slotKeys={[nameSlot, descSlot]} />
      </td>
    </tr>
  );
}

function BusinessRuleRow({
  rule,
  currentObjectId,
  flashed = false,
  humanize,
  onSelectObject,
  onOpenTechnicalDetails,
}: {
  rule: ProjectedBusinessRule;
  currentObjectId: string;
  flashed?: boolean;
  humanize: (raw: string | undefined) => string;
  onSelectObject: (objectId: string) => void;
  onOpenTechnicalDetails: (locator: TechnicalLocator) => void;
}) {
  const { t } = usePreferences();

  const otherObjects =
    rule.kind === 'M3_RULE' && rule.isCrossObject
      ? rule.relatedObjects.filter((obj) => obj.id !== currentObjectId)
      : [];

  const nameSlot = `rule-name-${rule.id}`;
  const descSlot = `rule-desc-${rule.id}`;

  return (
    <li className="bm-rule-row" data-flash={flashed ? 'true' : undefined}>
      <div className="bm-rule-top">
        <div data-testid={`business-rule-text-${rule.id}`}>
          {rule.kind === 'ATTRIBUTE_RULE' ? (
            <span className="bm-item-name">
              {humanize(rule.fieldDisplayName)}：
              <InlineEditableText
                slotKey={nameSlot}
                displayValue={humanize(rule.violationMessage || rule.description)}
                initialEditValue={humanize(rule.violationMessage || rule.description)}
                placeholder={t('输入字段规则说明', 'Enter field rule text')}
                ariaLabel={t(
                  `修改规则说明：${humanize(rule.fieldDisplayName)}`,
                  `Edit rule for ${humanize(rule.fieldDisplayName)}`,
                )}
                buildEdit={(nextText) => ({
                  kind: 'ATTRIBUTE_RULE',
                  objectId: currentObjectId,
                  fieldName: rule.fieldName,
                  ruleName: rule.name,
                  description: nextText,
                })}
              />
            </span>
          ) : rule.kind === 'INVARIANT' ? (
            <span className="bm-item-name">
              <InlineEditableText
                slotKey={nameSlot}
                displayValue={humanize(rule.violationMessage || rule.description)}
                initialEditValue={humanize(rule.violationMessage || rule.description)}
                placeholder={t('输入业务规则说明', 'Enter business rule text')}
                ariaLabel={t(
                  `修改业务规则：${humanize(rule.violationMessage || rule.description)}`,
                  `Edit business rule: ${humanize(rule.violationMessage || rule.description)}`,
                )}
                buildEdit={(nextText) => ({
                  kind: 'INVARIANT',
                  objectId: currentObjectId,
                  invariantName: rule.name,
                  description: nextText,
                })}
              />
            </span>
          ) : (
            <>
              <span className="bm-item-name">
                <InlineEditableText
                  slotKey={nameSlot}
                  displayValue={humanize(rule.displayName)}
                  initialEditValue={humanize(rule.displayName)}
                  placeholder={t('输入业务规则名称', 'Enter business rule name')}
                  ariaLabel={t(
                    `修改业务规则名称：${humanize(rule.displayName)}`,
                    `Rename business rule: ${humanize(rule.displayName)}`,
                  )}
                  buildEdit={(nextName) => ({
                    kind: 'M3_RULE',
                    ruleId: rule.id,
                    name: nextName,
                  })}
                />
              </span>
              {humanize(rule.description || rule.violationMessage) ? (
                <span className="bm-item-note">
                  {' — '}
                  <InlineEditableText
                    slotKey={descSlot}
                    displayValue={humanize(rule.description || rule.violationMessage)}
                    initialEditValue={humanize(rule.description || rule.violationMessage)}
                    placeholder={t('输入业务规则说明', 'Enter business rule description')}
                    ariaLabel={t(
                      `修改业务规则说明：${humanize(rule.displayName)}`,
                      `Edit rule description: ${humanize(rule.displayName)}`,
                    )}
                    buildEdit={(nextDesc) => ({
                      kind: 'M3_RULE',
                      ruleId: rule.id,
                      description: nextDesc,
                    })}
                  />
                </span>
              ) : (
                <>
                  {' '}
                  <InlineEditableText
                    slotKey={descSlot}
                    displayValue={t('添加说明', 'Add description')}
                    initialEditValue=""
                    placeholder={t('输入业务规则说明', 'Enter business rule description')}
                    ariaLabel={t(
                      `添加业务规则说明：${humanize(rule.displayName)}`,
                      `Add rule description: ${humanize(rule.displayName)}`,
                    )}
                    isPlaceholder
                    buildEdit={(nextDesc) => ({
                      kind: 'M3_RULE',
                      ruleId: rule.id,
                      description: nextDesc,
                    })}
                  />
                </>
              )}
            </>
          )}
        </div>
        <ItemTechButton
          itemId={rule.id}
          locator={rule.locator}
          onOpenTechnicalDetails={onOpenTechnicalDetails}
        />
      </div>
      <InlineRejectionSlot slotKeys={[nameSlot, descSlot]} />
      {otherObjects.length > 0 && (
        <div className="bm-rule-shared" data-testid={`shared-rule-links-${rule.id}`}>
          <Link2 size={12} aria-hidden="true" />
          <span>{t('同一条规则也适用于', 'Same rule also applies to')}</span>
          {otherObjects.map((other) => (
            <button
              key={other.id}
              type="button"
              className="bm-inline-link"
              onClick={() => onSelectObject(other.id)}
            >
              {t(
                `「${humanize(other.displayName)}」`,
                `"${humanize(other.displayName)}"`,
              )}
            </button>
          ))}
          <span>{t('，改一处同步生效', ' — editing once updates everywhere')}</span>
        </div>
      )}
    </li>
  );
}

function CollapsedSection({
  sectionKey,
  title,
  count,
  open,
  onToggle,
  summary,
  emptyText,
  children,
}: {
  sectionKey: DefaultCollapsedObjectSection;
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  summary: string;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bm-sec is-folded" data-testid={`object-section-${sectionKey}`}>
      <button
        type="button"
        className="bm-sec-head"
        data-testid={`object-section-toggle-${sectionKey}`}
        aria-expanded={open}
        onClick={onToggle}
      >
        {open ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
        <span className="bm-sec-title">{title}</span>
        <span className="bm-sec-count">{count || '—'}</span>
        {!open && count > 0 && summary && (
          <span className="bm-sec-summary">{summary}</span>
        )}
      </button>
      {open && (count > 0 ? children : <p className="bm-empty-note">{emptyText}</p>)}
    </section>
  );
}

/* ─── Cross-Object Views & Other Fallback ─── */

function FlowsCrossView({
  projection,
  humanize,
  onOpenTechnicalDetails,
  flashTarget,
}: {
  projection: BusinessModelProjection;
  humanize: (raw: string | undefined) => string;
  onOpenTechnicalDetails: (locator: TechnicalLocator) => void;
  flashTarget?: { readonly anchorId: string; readonly at: number } | null;
}) {
  const { t } = usePreferences();
  const flows = projection.flowsAndApprovals.flows;
  const headerLocator: TechnicalLocator = flows[0]?.locator ?? {
    model: 'M6',
    elementId: '',
  };

  return (
    <article className="bm-article" data-testid="cross-view-flows">
      <CrossViewHeader
        title={t(MODEL_BUSINESS_NAMES.M6.zh, MODEL_BUSINESS_NAMES.M6.en)}
        description={t(
          '跨越多个业务对象、需要多角色协同完成的审批与业务流转，每一步写明由谁执行。',
          'Multi-step workflows and approvals across business objects, showing who performs each step.',
        )}
        locator={headerLocator}
        onOpenTechnicalDetails={onOpenTechnicalDetails}
      />

      {flows.length === 0 ? (
        <p className="bm-empty-note">
          {t(
            '暂未配置流程与审批，可在左侧对话中让 AI 助手补充。',
            'No flows or approvals configured yet; ask AI Assistant in the conversation to add them.',
          )}
        </p>
      ) : (
        flows.map((flow) => {
          const flowTitle = humanize(flow.displayName);
          const flowDesc = humanize(flow.description);
          const nameSlot = `flow-name-${flow.id}`;
          const descSlot = `flow-desc-${flow.id}`;
          return (
            <section
              key={flow.id}
              className="bm-sec"
              data-flash={flashTarget?.anchorId === flow.id ? 'true' : undefined}
            >
              <div className="bm-sec-head is-static">
                <div>
                  <span className="bm-sec-title">
                    <InlineEditableText
                      slotKey={nameSlot}
                      displayValue={flowTitle}
                      initialEditValue={flowTitle}
                      placeholder={t('输入流程名称', 'Enter flow name')}
                      ariaLabel={t(`修改流程名称：${flowTitle}`, `Rename flow: ${flowTitle}`)}
                      buildEdit={(nextName) => ({
                        kind: 'FLOW',
                        flowId: flow.id,
                        name: nextName,
                      })}
                    />
                  </span>
                  {flowDesc ? (
                    <span className="bm-item-note">
                      {' — '}
                      <InlineEditableText
                        slotKey={descSlot}
                        displayValue={flowDesc}
                        initialEditValue={flowDesc}
                        placeholder={t('输入流程说明', 'Enter flow description')}
                        ariaLabel={t(`修改流程说明：${flowTitle}`, `Edit flow description: ${flowTitle}`)}
                        buildEdit={(nextDesc) => ({
                          kind: 'FLOW',
                          flowId: flow.id,
                          description: nextDesc,
                        })}
                      />
                    </span>
                  ) : (
                    <>
                      {' '}
                      <InlineEditableText
                        slotKey={descSlot}
                        displayValue={t('添加说明', 'Add description')}
                        initialEditValue=""
                        placeholder={t('输入流程说明', 'Enter flow description')}
                        ariaLabel={t(`添加流程说明：${flowTitle}`, `Add flow description: ${flowTitle}`)}
                        isPlaceholder
                        buildEdit={(nextDesc) => ({
                          kind: 'FLOW',
                          flowId: flow.id,
                          description: nextDesc,
                        })}
                      />
                    </>
                  )}
                </div>
                <ItemTechButton
                  itemId={flow.id}
                  locator={flow.locator}
                  onOpenTechnicalDetails={onOpenTechnicalDetails}
                />
              </div>
              <InlineRejectionSlot slotKeys={[nameSlot, descSlot]} />
              <ol className="bm-flow-steps">
                {flow.activities.map((step, idx) => (
                  <li key={step.id} className="bm-flow-step">
                    <span className="bm-flow-index">{idx + 1}</span>
                    <span className="bm-flow-text">
                      {humanize(step.displayName)}
                      {step.branches.length > 0 && (
                        <span className="bm-flow-branches">
                          {step.branches
                            .map((b) => humanize(b.label || b.condition))
                            .filter(Boolean)
                            .join('；')}
                        </span>
                      )}
                    </span>
                    <span className="bm-flow-role">
                      {step.role
                        ? humanize(step.role.displayName)
                        : t('系统自动', 'System automatic')}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          );
        })
      )}
    </article>
  );
}

function RolesCrossView({
  projection,
  businessLocale,
  humanize,
  onSelectObject,
  onOpenTechnicalDetails,
  flashTarget,
}: {
  projection: BusinessModelProjection;
  businessLocale: BusinessLocale;
  humanize: (raw: string | undefined) => string;
  onSelectObject: (objectId: string) => void;
  onOpenTechnicalDetails: (locator: TechnicalLocator) => void;
  flashTarget?: { readonly anchorId: string; readonly at: number } | null;
}) {
  const { locale, t } = usePreferences();
  const listSep = locale === 'en-US' ? ', ' : '、';
  const { roles, actors, permissionGroups, permissions } = projection.rolesAndPermissions;
  const objects = projection.objects;
  const headerLocator: TechnicalLocator =
    roles[0]?.locator ??
    actors[0]?.locator ??
    permissionGroups[0]?.locator ??
    permissions[0]?.locator ?? {
      model: 'M5',
      elementId: '',
    };

  const roleNameById = new Map<string, string>(
    roles.map((r) => [r.id, humanize(r.displayName)]),
  );
  const grantedPermIds = new Set<string>();
  for (const r of roles) {
    for (const g of r.objectGrants) {
      for (const p of g.permissions) {
        grantedPermIds.add(p.id);
      }
    }
  }
  const standalonePermissions = permissions.filter((p) => !grantedPermIds.has(p.id));
  const hasAnyContent =
    roles.length > 0 ||
    actors.length > 0 ||
    permissionGroups.length > 0 ||
    standalonePermissions.length > 0;

  return (
    <article className="bm-article" data-testid="cross-view-roles">
      <CrossViewHeader
        title={t(MODEL_BUSINESS_NAMES.M5.zh, MODEL_BUSINESS_NAMES.M5.en)}
        description={t(
          '核对每个岗位角色分别能对哪些业务对象执行什么业务操作。',
          'Verify what actions each role is authorized to perform on each business object.',
        )}
        locator={headerLocator}
        onOpenTechnicalDetails={onOpenTechnicalDetails}
      />

      {!hasAnyContent ? (
        <p className="bm-empty-note">
          {t('暂未配置角色与权限。', 'No roles or permissions configured yet.')}
        </p>
      ) : (
        <>
          {roles.length > 0 && (
            <div className="bm-matrix-wrap">
              <table className="bm-matrix">
                <thead>
                  <tr>
                    <th>{t('角色', 'Role')}</th>
                    {objects.map((obj) => (
                      <th key={obj.id}>{humanize(obj.displayName)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {roles.map((role) => {
                    const roleTitle = humanize(role.displayName);
                    const roleDesc = humanize(role.description);
                    const nameSlot = `role-name-${role.id}`;
                    const descSlot = `role-desc-${role.id}`;
                    return (
                      <tr
                        key={role.id}
                        data-flash={flashTarget?.anchorId === role.id ? 'true' : undefined}
                      >
                        <th>
                          <InlineEditableText
                            slotKey={nameSlot}
                            displayValue={roleTitle}
                            initialEditValue={roleTitle}
                            placeholder={t('输入角色名称', 'Enter role name')}
                            ariaLabel={t(`修改角色名称：${roleTitle}`, `Rename role: ${roleTitle}`)}
                            buildEdit={(nextName) => ({
                              kind: 'ROLE',
                              roleId: role.id,
                              name: nextName,
                            })}
                          />
                          {roleDesc ? (
                            <span className="bm-matrix-desc">
                              <InlineEditableText
                                slotKey={descSlot}
                                displayValue={roleDesc}
                                initialEditValue={roleDesc}
                                placeholder={t('输入角色说明', 'Enter role description')}
                                ariaLabel={t(`修改角色说明：${roleTitle}`, `Edit role description: ${roleTitle}`)}
                                buildEdit={(nextDesc) => ({
                                  kind: 'ROLE',
                                  roleId: role.id,
                                  description: nextDesc,
                                })}
                              />
                            </span>
                          ) : (
                            <span className="bm-matrix-desc">
                              <InlineEditableText
                                slotKey={descSlot}
                                displayValue={t('添加说明', 'Add description')}
                                initialEditValue=""
                                placeholder={t('输入角色说明', 'Enter role description')}
                                ariaLabel={t(`添加角色说明：${roleTitle}`, `Add role description: ${roleTitle}`)}
                                isPlaceholder
                                buildEdit={(nextDesc) => ({
                                  kind: 'ROLE',
                                  roleId: role.id,
                                  description: nextDesc,
                                })}
                              />
                            </span>
                          )}
                          <InlineRejectionSlot slotKeys={[nameSlot, descSlot]} />
                        </th>
                        {objects.map((obj) => {
                          const grant = role.objectGrants.find((g) => g.object.id === obj.id);
                          const actionsText = grant
                            ? grant.actions.map((a) => humanize(a.displayName)).join(listSep)
                            : '';
                          return <td key={obj.id}>{actionsText || '—'}</td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {actors.length > 0 && (
            <section className="bm-sec bm-roles-extra" data-testid="roles-actors-section">
              <div className="bm-sec-head is-static">
                <span className="bm-sec-title">
                  {t(`参与主体 · ${actors.length}`, `Actors & participants · ${actors.length}`)}
                </span>
              </div>
              <ul className="bm-list">
                {actors.map((act) => {
                  const actTitle = humanize(act.displayName);
                  const actType = pickBusinessText(
                    ACTOR_TYPE_LABELS[act.actorType],
                    businessLocale,
                  );
                  const assignedRoleLabels = act.actor.roles
                    .map((rId) => roleNameById.get(rId) ?? humanize(rId))
                    .filter(Boolean)
                    .join(listSep);
                  const actDesc = humanize(act.description);
                  const nameSlot = `actor-name-${act.id}`;
                  const descSlot = `actor-desc-${act.id}`;
                  return (
                    <li key={act.id}>
                      <span className="bm-item-name">
                        <InlineEditableText
                          slotKey={nameSlot}
                          displayValue={actTitle}
                          initialEditValue={actTitle}
                          placeholder={t('输入主体名称', 'Enter actor name')}
                          ariaLabel={t(`修改主体名称：${actTitle}`, `Rename actor: ${actTitle}`)}
                          buildEdit={(nextName) => ({
                            kind: 'ACTOR',
                            actorId: act.id,
                            name: nextName,
                          })}
                        />
                      </span>
                      <span className="bm-item-note">
                        {actType}
                        {assignedRoleLabels
                          ? t(` · 角色：${assignedRoleLabels}`, ` · Roles: ${assignedRoleLabels}`)
                          : ''}
                        <InlineOptionalDescription
                          slotKey={descSlot}
                          value={actDesc}
                          itemTitle={actTitle}
                          buildEdit={(nextDesc) => ({
                            kind: 'ACTOR',
                            actorId: act.id,
                            description: nextDesc,
                          })}
                        />
                        <InlineRejectionSlot slotKeys={[nameSlot, descSlot]} />
                      </span>
                      <ItemTechButton
                        itemId={act.id}
                        locator={act.locator}
                        onOpenTechnicalDetails={onOpenTechnicalDetails}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {permissionGroups.length > 0 && (
            <section
              className="bm-sec bm-roles-extra"
              data-testid="roles-permission-groups-section"
            >
              <div className="bm-sec-head is-static">
                <span className="bm-sec-title">
                  {t(
                    `权限分组 · ${permissionGroups.length}`,
                    `Permission groups · ${permissionGroups.length}`,
                  )}
                </span>
              </div>
              <ul className="bm-list">
                {permissionGroups.map((pg) => {
                  const pgTitle = humanize(pg.displayName);
                  const pgDesc = humanize(pg.description);
                  const permLabels = pg.permissions
                    .map((p) => humanize(p.displayName))
                    .filter(Boolean)
                    .join(listSep);
                  const nameSlot = `permgroup-name-${pg.id}`;
                  const descSlot = `permgroup-desc-${pg.id}`;
                  return (
                    <li key={pg.id}>
                      <span className="bm-item-name">
                        <InlineEditableText
                          slotKey={nameSlot}
                          displayValue={pgTitle}
                          initialEditValue={pgTitle}
                          placeholder={t('输入权限分组名称', 'Enter permission group name')}
                          ariaLabel={t(`修改名称：${pgTitle}`, `Rename: ${pgTitle}`)}
                          buildEdit={(nextName) => ({
                            kind: 'PERMISSION_GROUP',
                            groupId: pg.id,
                            name: nextName,
                          })}
                        />
                      </span>
                      <span className="bm-item-note">
                        {permLabels
                          ? t(`包含：${permLabels}`, `Includes: ${permLabels}`)
                          : t('未关联具体权限项', 'No permissions attached yet')}
                        <InlineOptionalDescription
                          slotKey={descSlot}
                          value={pgDesc}
                          itemTitle={pgTitle}
                          buildEdit={(nextDesc) => ({
                            kind: 'PERMISSION_GROUP',
                            groupId: pg.id,
                            description: nextDesc,
                          })}
                        />
                        <InlineRejectionSlot slotKeys={[nameSlot, descSlot]} />
                      </span>
                      <ItemTechButton
                        itemId={pg.id}
                        locator={pg.locator}
                        onOpenTechnicalDetails={onOpenTechnicalDetails}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {standalonePermissions.length > 0 && (
            <section
              className="bm-sec bm-roles-extra"
              data-testid="roles-standalone-permissions-section"
            >
              <div className="bm-sec-head is-static">
                <span className="bm-sec-title">
                  {t(
                    `独立权限项 · ${standalonePermissions.length}`,
                    `Standalone permissions · ${standalonePermissions.length}`,
                  )}
                </span>
              </div>
              <ul className="bm-list">
                {standalonePermissions.map((perm) => {
                  const permTitle = humanize(perm.displayName);
                  const actionNames = perm.allowedActions
                    .map((a) => humanize(a.displayName))
                    .filter(Boolean)
                    .join(listSep);
                  const nameSlot = `perm-name-${perm.id}`;
                  return (
                    <li key={perm.id}>
                      <span className="bm-item-name">
                        <InlineEditableText
                          slotKey={nameSlot}
                          displayValue={permTitle}
                          initialEditValue={permTitle}
                          placeholder={t('输入权限名称', 'Enter permission name')}
                          ariaLabel={t(`修改权限名称：${permTitle}`, `Rename permission: ${permTitle}`)}
                          buildEdit={(nextName) => ({
                            kind: 'PERMISSION',
                            permissionId: perm.id,
                            name: nextName,
                          })}
                        />
                      </span>
                      <span className="bm-item-note">
                        {perm.targetObject ? (
                          <button
                            type="button"
                            className="bm-inline-link"
                            onClick={() => onSelectObject(perm.targetObject!.id)}
                          >
                            {t(
                              `对象「${humanize(perm.targetObject.displayName)}」`,
                              `Object "${humanize(perm.targetObject.displayName)}"`,
                            )}
                          </button>
                        ) : (
                          t('尚未分配角色', 'Not assigned to a role yet')
                        )}
                        {actionNames
                          ? `${perm.targetObject ? ' · ' : ''}${actionNames}`
                          : perm.targetObject
                            ? ` · ${t('尚未分配角色', 'Not assigned to a role yet')}`
                            : ''}
                        <InlineRejectionSlot slotKeys={[nameSlot]} />
                      </span>
                      <ItemTechButton
                        itemId={perm.id}
                        locator={perm.locator}
                        onOpenTechnicalDetails={onOpenTechnicalDetails}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </article>
  );
}

function ReportsCrossView({
  projection,
  humanize,
  onSelectObject,
  onOpenTechnicalDetails,
  flashTarget,
}: {
  projection: BusinessModelProjection;
  humanize: (raw: string | undefined) => string;
  onSelectObject: (objectId: string) => void;
  onOpenTechnicalDetails: (locator: TechnicalLocator) => void;
  flashTarget?: { readonly anchorId: string; readonly at: number } | null;
}) {
  const { t } = usePreferences();
  const { queries, reports, items } = projection.queriesAndReports;
  const headerLocator: TechnicalLocator = items[0]?.locator ?? {
    model: 'M7',
    elementId: '',
  };

  const groups = [
    { key: 'queries', label: t('查询', 'Queries'), list: queries },
    { key: 'reports', label: t('统计与报表', 'Reports'), list: reports },
  ];

  return (
    <article className="bm-article" data-testid="cross-view-reports">
      <CrossViewHeader
        title={t(MODEL_BUSINESS_NAMES.M7.zh, MODEL_BUSINESS_NAMES.M7.en)}
        description={t(
          '需要跨业务对象检索、筛选或汇总统计的查询与报表定义。',
          'Cross-object searches, lists, and aggregated reports.',
        )}
        locator={headerLocator}
        onOpenTechnicalDetails={onOpenTechnicalDetails}
      />

      {items.length === 0 ? (
        <p className="bm-empty-note">
          {t(
            '暂未整理查询与报表，可在左侧对话中让 AI 助手补充。',
            'No queries or reports organized yet; ask AI Assistant in the conversation to add them.',
          )}
        </p>
      ) : (
        groups.map((grp) => (
          <section key={grp.key} className="bm-sec">
            <div className="bm-sec-head is-static">
              <span className="bm-sec-title">
                {grp.label} · {grp.list.length}
              </span>
            </div>
            {grp.list.length === 0 ? (
              <p className="bm-empty-note">{t('暂无条目。', 'No items yet.')}</p>
            ) : (
              <ul className="bm-list">
                {grp.list.map((qr) => {
                  const qrTitle = humanize(qr.displayName);
                  const qrDesc = humanize(qr.description);
                  const nameSlot = `report-name-${qr.id}`;
                  const descSlot = `report-desc-${qr.id}`;
                  return (
                    <li
                      key={qr.id}
                      data-flash={flashTarget?.anchorId === qr.id ? 'true' : undefined}
                    >
                      <span className="bm-item-name">
                        <InlineEditableText
                          slotKey={nameSlot}
                          displayValue={qrTitle}
                          initialEditValue={qrTitle}
                          placeholder={t('输入查询或报表名称', 'Enter query or report name')}
                          ariaLabel={t(`修改名称：${qrTitle}`, `Rename: ${qrTitle}`)}
                          buildEdit={(nextName) => ({
                            kind: 'QUERY_REPORT',
                            reportId: qr.id,
                            name: nextName,
                          })}
                        />
                      </span>
                      <span className="bm-item-note">
                        {qrDesc ? (
                          <InlineEditableText
                            slotKey={descSlot}
                            displayValue={qrDesc}
                            initialEditValue={qrDesc}
                            placeholder={t('输入说明', 'Enter description')}
                            ariaLabel={t(`修改说明：${qrTitle}`, `Edit description: ${qrTitle}`)}
                            buildEdit={(nextDesc) => ({
                              kind: 'QUERY_REPORT',
                              reportId: qr.id,
                              description: nextDesc,
                            })}
                          />
                        ) : (
                          <InlineEditableText
                            slotKey={descSlot}
                            displayValue={t('添加说明', 'Add description')}
                            initialEditValue=""
                            placeholder={t('输入说明', 'Enter description')}
                            ariaLabel={t(`添加说明：${qrTitle}`, `Add description: ${qrTitle}`)}
                            isPlaceholder
                            buildEdit={(nextDesc) => ({
                              kind: 'QUERY_REPORT',
                              reportId: qr.id,
                              description: nextDesc,
                            })}
                          />
                        )}
                        {qr.sourceObjects.length > 0 && (
                          <>
                            {qrDesc ? ' · ' : ' '}
                            {t('用到：', 'Uses: ')}
                            {qr.sourceObjects.map((src) => (
                              <button
                                key={src.id}
                                type="button"
                                className="bm-inline-link"
                                onClick={() => onSelectObject(src.id)}
                              >
                                {t(
                                  `「${humanize(src.displayName)}」`,
                                  `"${humanize(src.displayName)}"`,
                                )}
                              </button>
                            ))}
                          </>
                        )}
                        <InlineRejectionSlot slotKeys={[nameSlot, descSlot]} />
                      </span>
                      <ItemTechButton
                        itemId={qr.id}
                        locator={qr.locator}
                        onOpenTechnicalDetails={onOpenTechnicalDetails}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))
      )}
    </article>
  );
}

function OtherFallbackView({
  items,
  businessLocale,
  humanize,
  onOpenTechnicalDetails,
  flashTarget,
}: {
  items: ProjectedOtherItem[];
  businessLocale: BusinessLocale;
  humanize: (raw: string | undefined) => string;
  onOpenTechnicalDetails: (locator: TechnicalLocator) => void;
  flashTarget?: { readonly anchorId: string; readonly at: number } | null;
}) {
  const { t } = usePreferences();
  const headerLocator: TechnicalLocator = items[0]?.locator ?? {
    model: 'M1',
    elementId: '',
  };

  return (
    <article className="bm-article" data-testid="cross-view-other">
      <CrossViewHeader
        title={t('其他', 'Other')}
        description={t(
          '不属于单一业务对象的全局字典与补充定义放在这里，确保业务模型里的每一项内容都能找到。',
          'Shared dictionaries and unowned definitions live here so nothing in the business model is ever hidden.',
        )}
        locator={headerLocator}
        onOpenTechnicalDetails={onOpenTechnicalDetails}
      />

      {items.length === 0 ? (
        <p className="bm-empty-note">{t('暂无其他条目。', 'No unowned items.')}</p>
      ) : (
        <section className="bm-sec">
          <ul className="bm-list">
            {items.map((item) => {
              const kindLabel = pickBusinessText(
                OTHER_KIND_LABELS[item.kind],
                businessLocale,
              );
              const itemTitle =
                item.kind === 'DATA_STORAGE'
                  ? t('通用数据存储记录', 'Shared data storage record')
                  : humanize(item.displayName) || kindLabel;
              const itemDesc = humanize(item.description);
              const isEditableDict = item.kind === 'DATA_DICTIONARY';
              const nameSlot = `other-name-${item.kind}-${item.id}`;
              const descSlot = `other-desc-${item.kind}-${item.id}`;
              return (
                <li
                  key={`${item.kind}-${item.id}`}
                  data-flash={flashTarget?.anchorId === item.id ? 'true' : undefined}
                >
                  <span className="bm-item-name">
                    {isEditableDict ? (
                      <InlineEditableText
                        slotKey={nameSlot}
                        displayValue={itemTitle}
                        initialEditValue={itemTitle}
                        placeholder={t('输入名称', 'Enter name')}
                        ariaLabel={t(`修改名称：${itemTitle}`, `Rename: ${itemTitle}`)}
                        buildEdit={(nextName) => ({
                          kind: 'DATA_DICTIONARY',
                          dictionaryId: item.id,
                          name: nextName,
                        })}
                      />
                    ) : (
                      itemTitle
                    )}
                  </span>
                  <span className="bm-item-note">
                    {kindLabel}
                    {isEditableDict && itemDesc ? (
                      <>
                        {' · '}
                        <InlineEditableText
                          slotKey={descSlot}
                          displayValue={itemDesc}
                          initialEditValue={itemDesc}
                          placeholder={t('输入说明', 'Enter description')}
                          ariaLabel={t(`修改说明：${itemTitle}`, `Edit description: ${itemTitle}`)}
                          buildEdit={(nextDesc) => ({
                            kind: 'DATA_DICTIONARY',
                            dictionaryId: item.id,
                            description: nextDesc,
                          })}
                        />
                      </>
                    ) : itemDesc ? (
                      ` · ${itemDesc}`
                    ) : null}
                    {isEditableDict && <InlineRejectionSlot slotKeys={[nameSlot, descSlot]} />}
                  </span>
                  <ItemTechButton
                    itemId={item.id}
                    locator={item.locator}
                    onOpenTechnicalDetails={onOpenTechnicalDetails}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </article>
  );
}
