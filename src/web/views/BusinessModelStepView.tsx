import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Code2,
  FileCode2,
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
  type BusinessLocale,
} from '../../packages/business-vocabulary/index.js';
import {
  DEFAULT_COLLAPSED_OBJECT_SECTIONS,
  DEFAULT_EXPANDED_OBJECT_SECTIONS,
  MODEL_CODES,
  projectByBusinessObject,
  type Attribute,
  type BusinessModelProjection,
  type BusinessObjectProjection,
  type DefaultCollapsedObjectSection,
  type DefaultExpandedObjectSection,
  type ModelCode,
  type OntologySuite,
  type OtherElementKind,
  type ProjectedBusinessRule,
  type ProjectedDataStorage,
  type ProjectedField,
  type ProjectedOtherItem,
  type TechnicalLocator,
  type ValidationDiagnostic,
} from '../../packages/ontology-core/index.js';
import { getProjectLifecycleState, useWorkbenchStore } from '../api.js';
import { useAgentPanelStore } from '../components/agent/agentPanelStore.js';
import { usePreferences, type NavViewId } from '../i18n.js';
import {
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

export interface BusinessModelStepViewProps {
  readonly onNavigate?: (view: NavViewId) => void;
  readonly activePageId?: string | null;
  readonly onSelectPage?: (pageId: BusinessModelPageId) => void;
  readonly viewModeOverride?: StepViewMode;
  readonly legacyTechTab?: BusinessModelTechTab | null;
  readonly headerActions?: React.ReactNode;
  readonly flashTarget?: { readonly anchorId: string; readonly at: number } | null;
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
  if (!raw) return '';
  let text = raw.trim();
  if (!text) return '';

  // Fast path: already clean
  if (checkBusinessViewMarkup(text, { plainText: true }).length === 0) {
    return text;
  }

  // 1. Replace known element IDs & table names with their business names
  for (const [id, businessLabel] of elementDisplayMap.entries()) {
    if (text.includes(id)) {
      text = text.split(id).join(businessLabel);
    }
  }

  if (checkBusinessViewMarkup(text, { plainText: true }).length === 0) {
    return text;
  }

  // 2. Replace canonical model codes (M1..MI) with their vocabulary names
  for (const code of MODEL_CODES) {
    const re = new RegExp(`(?<![A-Za-z0-9_])${code}(?![A-Za-z0-9_])`, 'g');
    if (re.test(text)) {
      text = text.replace(re, getModelBusinessName(code, locale, { singular: true }));
    }
  }

  // 3. Replace remaining technical identifiers, file formats, protocols, and internal terms
  text = text
    .replace(
      /(?<![A-Za-z0-9_-])(?:AGG|ENT|VO|DIC|DICT|ASSOC|BHV|BEH|RUL|RULE|EVT|SCN|ACT|ROL|ROLE|PERM|PGRP|FLW|FLOW|ACTV|QRY|RPT|SCR|EL|UIE|NAV|CC|MAP|INT|IF|MET|ASCN|WB)-[A-Z0-9]+(?:-[A-Z0-9]+)*(?![A-Za-z0-9_-])/g,
      locale === 'en-US' ? 'related item' : '关联项',
    )
    .replace(
      /(?<![A-Za-z0-9_])(?:M[1-7]|ME|MU|MM|MI|STAGE)_[A-Z0-9_]+(?![A-Za-z0-9_])/g,
      locale === 'en-US' ? 'check item' : '检查项',
    )
    .replace(
      /(?<![A-Za-z0-9_])t_[a-z][a-z0-9_]+(?![A-Za-z0-9_])/g,
      locale === 'en-US' ? 'data record' : '数据记录',
    )
    .replace(
      /\.(?:yaml|yml|json|owl|ddl|sql|md|html|css|zip)(?![A-Za-z0-9_])/gi,
      locale === 'en-US' ? ' file' : '文件',
    )
    .replace(
      /(?<![A-Za-z0-9_])(?:YAML|YML|JSON|OWL|DDL|SQLite|SQL|Markdown|HTML5?|CSS|ZIP)(?![A-Za-z0-9_])/gi,
      locale === 'en-US' ? 'document' : '模型内容',
    )
    .replace(
      /(?<![A-Za-z0-9_])(?:gRPC|RPC|MCP|SSE|REST|HTTPS?|RESTful|GraphQL|OpenAPI)(?![A-Za-z0-9_])/gi,
      locale === 'en-US' ? 'external service' : '外部服务',
    )
    .replace(
      /(?<![A-Za-z0-9_])(?:Agent\s+Session|Agent\s+Run|Agent\s+Panel|Copilot|PROTOTYPE_CO_DESIGN)(?![A-Za-z0-9_])|智能体会话|智能体运行|智能体面板/gi,
      pickBusinessText(BUSINESS_VOCABULARY.AI_ASSISTANT, locale),
    );

  return text.replace(/\s+/g, ' ').trim();
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
      ? `"${modelName}" has not been organized yet.`
      : `尚未整理「${modelName}」。`;
  }
  const rawMsg = locale === 'en-US' ? diag.messageEn : diag.messageZh;
  return sanitizeBusinessText(rawMsg, elementDisplayMap, locale);
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
}: BusinessModelStepViewProps = {}) {
  const { locale, t } = usePreferences();
  const businessLocale: BusinessLocale = locale === 'en-US' ? 'en-US' : 'zh-CN';

  const {
    data,
    activeNav,
    activeItemId,
    liveSessionDrafts,
    setActiveItemId,
    setSelectedModel,
    startOntologySynthesisRun,
    startOntologyCopilotRun,
  } = useWorkbenchStore();

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
  const [showStageWarnings, setShowStageWarnings] = useState(false);

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
  const humanize = useCallback(
    (raw: string | undefined) => sanitizeBusinessText(raw, elementDisplayMap, businessLocale),
    [elementDisplayMap, businessLocale],
  );

  const [internalPageId, setInternalPageId] = useState<string | null>(null);

  useEffect(() => {
    setInternalPageId(null);
  }, [project?.id]);

  const resolvedPageId: BusinessModelPageId = useMemo(() => {
    if (!projection) return 'view:flows';
    const candidate = controlledPageId ?? activeItemId ?? internalPageId;
    return resolveBusinessModelPageId(projection, candidate);
  }, [projection, controlledPageId, activeItemId, internalPageId]);

  const handleSelectPage = useCallback(
    (nextPageId: BusinessModelPageId) => {
      setInternalPageId(nextPageId);
      setActiveItemId(nextPageId);
      onSelectPage?.(nextPageId);
    },
    [setActiveItemId, onSelectPage],
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
  const validation = project.validation;

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
      </div>
    );
  }

  /* ─── Business View Empty State (`!lifecycle.hasOntology`) ─── */
  if (!lifecycle.hasOntology) {
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
            <p className="bm-empty-copy" data-testid="business-model-status-line">
              {isCopilotBusy
                ? t(
                    'AI 助手正在依据已确认的原型找出业务对象、业务规则和角色权限，实时进度显示在左侧对话中。',
                    'AI Assistant is identifying business objects, business rules, and role permissions from your confirmed prototype; see live progress in the conversation.',
                  )
                : canOrganizeFromPrototype
                  ? t(
                      'AI 助手会依据已确认的原型，自动整理出业务对象、业务操作、业务规则与角色权限。',
                      'AI Assistant will organize business objects, actions, business rules, and role permissions from your confirmed prototype.',
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
                    useAgentPanelStore.getState().revealPanel();
                    void startOntologySynthesisRun();
                  }}
                >
                  <span>{t('整理业务模型', 'Organize Business Model')}</span>
                </Button>
              )}
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
      </div>
    );
  }

  /* ─── Populated Business View (`mode === 'business'`) ─── */
  const activeObject = projection.objects.find((o) => o.id === resolvedPageId) ?? null;
  const stageWarnings = validation.diagnostics.filter((d) => d.tier === 'STAGE_WARNING');

  const statusLine: {
    tone: 'ok' | 'warn' | 'error' | 'info';
    text: string;
  } = isCopilotBusy
    ? {
        tone: 'info',
        text: t(
          'AI 助手正在修改业务模型，完成后会在对话里列出改了什么。',
          'AI Assistant is updating the business model and will list what changed in the conversation.',
        ),
      }
    : validation.errorCount > 0
      ? {
          tone: 'error',
          text: t(
            `有 ${validation.errorCount} 个${BUSINESS_VOCABULARY.CONSISTENCY_ERROR.zh}，处理后才能进入交付。`,
            `${validation.errorCount} ${validation.errorCount === 1 ? 'problem to fix' : 'problems to fix'} before continuing to delivery.`,
          ),
        }
      : {
          tone: 'ok',
          text: t(
            `没有${BUSINESS_VOCABULARY.CONSISTENCY_ERROR.zh}。逐个核对业务对象、规则与权限；没问题即可进入交付。`,
            'No problems to fix. Review each business object, rule, and permission, then continue to delivery.',
          ),
        };

  const defaultPrimaryAction =
    validation.errorCount > 0 ? (
      <Button
        type="button"
        variant="accent"
        size="sm"
        data-testid="ask-assistant-fix-btn"
        disabled={isCopilotBusy}
        onClick={() => {
          useAgentPanelStore.getState().revealPanel();
          void startOntologyCopilotRun(
            t(
              '请检查并修复当前业务模型中所有需要修正的问题，确保各业务对象、操作、规则与权限保持一致。',
              'Please inspect and fix all problems in the current business model so objects, actions, rules, and permissions are consistent.',
            ),
          );
        }}
      >
        <span>{t('让 AI 助手处理', 'Ask AI Assistant to fix')}</span>
      </Button>
    ) : onNavigate ? (
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
    ) : null;

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
          <div className="bm-head-actions">{headerActions ?? defaultPrimaryAction}</div>
        </div>

        <p
          className="bm-status-line"
          data-testid="business-model-status-line"
          data-tone={statusLine.tone}
        >
          {statusLine.tone === 'ok' ? (
            <CheckCircle2 size={14} aria-hidden="true" />
          ) : statusLine.tone === 'error' || statusLine.tone === 'warn' ? (
            <TriangleAlert size={14} aria-hidden="true" />
          ) : (
            <Info size={14} aria-hidden="true" />
          )}
          <span>{statusLine.text}</span>
        </p>

        {validation.warningCount > 0 && (
          <div>
            <button
              type="button"
              className="bm-fold-btn"
              data-testid="toggle-stage-warnings-btn"
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
                  `${BUSINESS_VOCABULARY.STAGE_WARNING.zh} · ${validation.warningCount}`,
                  `${BUSINESS_VOCABULARY.STAGE_WARNING.en} · ${validation.warningCount}`,
                )}
              </span>
            </button>
            {showStageWarnings && stageWarnings.length > 0 && (
              <ul className="bm-warning-list" data-testid="stage-warnings-list">
                {stageWarnings.map((diag) => (
                  <li key={diag.id}>
                    {humanizeStageWarning(diag, elementDisplayMap, businessLocale)}
                  </li>
                ))}
              </ul>
            )}
          </div>
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

        <div className="bm-page-scroller">
          {activeObject ? (
            <BusinessObjectPage
              key={activeObject.id}
              object={activeObject}
              businessLocale={businessLocale}
              humanize={humanize}
              onSelectObject={(objId) => handleSelectPage(objId)}
              onOpenTechnicalDetails={handleOpenTechnicalDetails}
              flashTarget={flashTarget ?? null}
            />
          ) : resolvedPageId === 'view:flows' ? (
            <FlowsCrossView
              projection={projection}
              humanize={humanize}
              onOpenTechnicalDetails={handleOpenTechnicalDetails}
            />
          ) : resolvedPageId === 'view:roles' ? (
            <RolesCrossView
              projection={projection}
              humanize={humanize}
              onOpenTechnicalDetails={handleOpenTechnicalDetails}
            />
          ) : resolvedPageId === 'view:reports' ? (
            <ReportsCrossView
              projection={projection}
              humanize={humanize}
              onSelectObject={(objId) => handleSelectPage(objId)}
              onOpenTechnicalDetails={handleOpenTechnicalDetails}
            />
          ) : (
            <OtherFallbackView
              items={projection.other}
              businessLocale={businessLocale}
              humanize={humanize}
              onOpenTechnicalDetails={handleOpenTechnicalDetails}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Shared Internal Building Blocks ─── */

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

function BusinessObjectPage({
  object,
  businessLocale,
  humanize,
  onSelectObject,
  onOpenTechnicalDetails,
  flashTarget,
}: {
  object: BusinessObjectProjection;
  businessLocale: BusinessLocale;
  humanize: (raw: string | undefined) => string;
  onSelectObject: (objectId: string) => void;
  onOpenTechnicalDetails: (locator: TechnicalLocator) => void;
  flashTarget: { readonly anchorId: string; readonly at: number } | null;
}) {
  const { t } = usePreferences();
  const listSep = businessLocale === 'en-US' ? ', ' : '、';

  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const sec of DEFAULT_EXPANDED_OBJECT_SECTIONS) initial[sec] = true;
    for (const sec of DEFAULT_COLLAPSED_OBJECT_SECTIONS) initial[sec] = false;
    return initial;
  });

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
            {objectTitle}
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
        <p className="bm-article-desc" data-testid="business-object-description">
          {objectDesc}
        </p>
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
          (fieldRowCount > 0 ? (
            <table className="bm-table">
              <tbody>
                {object.fields.map((field) => (
                  <FieldRow
                    key={field.id}
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
                  const seDesc = humanize(se.description);
                  return (
                    <tr key={se.id}>
                      <td className="bm-cell-name">{humanize(se.displayName)}</td>
                      <td className="bm-cell-kind">{t('明细列表', 'Detail items')}</td>
                      <td className="bm-cell-note">
                        {subFieldNames
                          ? t(`包含：${subFieldNames}`, `Includes: ${subFieldNames}`)
                          : ''}
                        {seDesc ? (subFieldNames ? ` · ${seDesc}` : seDesc) : ''}
                      </td>
                    </tr>
                  );
                })}
                {standaloneValueObjects.map((vo) => {
                  const voFieldNames = vo.fields
                    .map((f) => humanize(f.displayName))
                    .join(listSep);
                  return (
                    <tr key={vo.id}>
                      <td className="bm-cell-name">{humanize(vo.displayName)}</td>
                      <td className="bm-cell-kind">{t('组合信息', 'Grouped info')}</td>
                      <td className="bm-cell-note">
                        {voFieldNames
                          ? t(`包含：${voFieldNames}`, `Includes: ${voFieldNames}`)
                          : humanize(vo.description)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
                return (
                  <li key={act.id}>
                    <span className="bm-item-name">{actTitle}</span>
                    <span className="bm-item-note">
                      {actDesc ||
                        (act.isAutomatic
                          ? t('由系统自动执行', 'Triggered automatically')
                          : t('人工发起的业务操作', 'User-initiated action'))}
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
          {object.events.map((ev) => (
            <li key={ev.id}>
              <span className="bm-item-name">{humanize(ev.displayName)}</span>
              <span className="bm-item-note">
                {ev.relation === 'SUBSCRIBED'
                  ? t('响应此事件', 'Responds to this event')
                  : ev.relation === 'BOTH'
                    ? t('发出并响应此事件', 'Produces and responds to this event')
                    : t('操作完成后发出', 'Emitted after action')}
                {ev.description ? ` · ${humanize(ev.description)}` : ''}
              </span>
              <ItemTechButton
                itemId={ev.id}
                locator={ev.locator}
                onOpenTechnicalDetails={onOpenTechnicalDetails}
              />
            </li>
          ))}
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
          {object.automations.map((au) => (
            <li key={au.id}>
              <span className="bm-item-name">{humanize(au.displayName)}</span>
              <span className="bm-item-note">
                {humanize(au.description) ||
                  t('跨业务对象的自动协同动作', 'Cross-object automated workflow')}
              </span>
              <ItemTechButton
                itemId={au.id}
                locator={au.locator}
                onOpenTechnicalDetails={onOpenTechnicalDetails}
              />
            </li>
          ))}
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
            const desc = humanize(sc.description);
            return (
              <li key={sc.id}>
                <span className="bm-item-name">{humanize(sc.displayName)}</span>
                <span className="bm-item-note">
                  {desc ? `${typeText} · ${desc}` : typeText}
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
            const desc = humanize(it.description);
            return (
              <li key={it.id}>
                <span className="bm-item-name">{humanize(it.displayName)}</span>
                <span className="bm-item-note">
                  {desc ? `${dirLabel} · ${desc}` : dirLabel}
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
              <li key={ds.id}>
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
  field,
  businessLocale,
  humanize,
  onSelectObject,
}: {
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

  const noteParts: string[] = [];
  if (field.required) noteParts.push(t('必填', 'Required'));
  if (field.unique) noteParts.push(t('唯一', 'Unique'));
  if (field.dictionary && field.dictionary.items.length > 0) {
    const opts = field.dictionary.items.map((item) => humanize(item.label)).join(listSep);
    noteParts.push(t(`可选：${opts}`, `Options: ${opts}`));
  } else if (field.enumValues && field.enumValues.length > 0) {
    const opts = field.enumValues
      .map((val) => formatLifecycleState(val, businessLocale))
      .join(listSep);
    noteParts.push(t(`可选：${opts}`, `Options: ${opts}`));
  }
  if (field.valueObject && field.valueObject.fields.length > 0) {
    const subFields = field.valueObject.fields
      .map((vf) => humanize(vf.displayName))
      .join(listSep);
    noteParts.push(t(`包含：${subFields}`, `Includes: ${subFields}`));
  }
  if (field.description) {
    const cleanDesc = humanize(field.description);
    if (cleanDesc) noteParts.push(cleanDesc);
  }

  return (
    <tr>
      <td className="bm-cell-name">{humanize(field.displayName)}</td>
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
            {noteParts.length > 0 ? ' · ' : ''}
          </>
        )}
        {noteParts.join(' · ')}
      </td>
    </tr>
  );
}

function BusinessRuleRow({
  rule,
  currentObjectId,
  humanize,
  onSelectObject,
  onOpenTechnicalDetails,
}: {
  rule: ProjectedBusinessRule;
  currentObjectId: string;
  humanize: (raw: string | undefined) => string;
  onSelectObject: (objectId: string) => void;
  onOpenTechnicalDetails: (locator: TechnicalLocator) => void;
}) {
  const { t } = usePreferences();

  const title =
    rule.kind === 'ATTRIBUTE_RULE'
      ? `${humanize(rule.fieldDisplayName)}：${humanize(rule.violationMessage || rule.description)}`
      : rule.kind === 'INVARIANT'
        ? humanize(rule.violationMessage || rule.description)
        : humanize(rule.displayName);

  const detail =
    rule.kind === 'M3_RULE'
      ? humanize(rule.description || rule.violationMessage)
      : '';

  const otherObjects =
    rule.kind === 'M3_RULE' && rule.isCrossObject
      ? rule.relatedObjects.filter((obj) => obj.id !== currentObjectId)
      : [];

  return (
    <li className="bm-rule-row">
      <div className="bm-rule-top">
        <div data-testid={`business-rule-text-${rule.id}`}>
          <span className="bm-item-name">{title}</span>
          {detail && <span className="bm-item-note"> — {detail}</span>}
        </div>
        <ItemTechButton
          itemId={rule.id}
          locator={rule.locator}
          onOpenTechnicalDetails={onOpenTechnicalDetails}
        />
      </div>
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
}: {
  projection: BusinessModelProjection;
  humanize: (raw: string | undefined) => string;
  onOpenTechnicalDetails: (locator: TechnicalLocator) => void;
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
        flows.map((flow) => (
          <section key={flow.id} className="bm-sec">
            <div className="bm-sec-head is-static">
              <div>
                <span className="bm-sec-title">{humanize(flow.displayName)}</span>
                {flow.description && (
                  <span className="bm-item-note"> — {humanize(flow.description)}</span>
                )}
              </div>
              <ItemTechButton
                itemId={flow.id}
                locator={flow.locator}
                onOpenTechnicalDetails={onOpenTechnicalDetails}
              />
            </div>
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
        ))
      )}
    </article>
  );
}

function RolesCrossView({
  projection,
  humanize,
  onOpenTechnicalDetails,
}: {
  projection: BusinessModelProjection;
  humanize: (raw: string | undefined) => string;
  onOpenTechnicalDetails: (locator: TechnicalLocator) => void;
}) {
  const { locale, t } = usePreferences();
  const listSep = locale === 'en-US' ? ', ' : '、';
  const roles = projection.rolesAndPermissions.roles;
  const objects = projection.objects;
  const headerLocator: TechnicalLocator = roles[0]?.locator ?? {
    model: 'M5',
    elementId: '',
  };

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

      {roles.length === 0 ? (
        <p className="bm-empty-note">
          {t('暂未配置角色与权限。', 'No roles or permissions configured yet.')}
        </p>
      ) : (
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
              {roles.map((role) => (
                <tr key={role.id}>
                  <th>
                    {humanize(role.displayName)}
                    {role.description && (
                      <span className="bm-matrix-desc">{humanize(role.description)}</span>
                    )}
                  </th>
                  {objects.map((obj) => {
                    const grant = role.objectGrants.find((g) => g.object.id === obj.id);
                    const actionsText = grant
                      ? grant.actions.map((a) => humanize(a.displayName)).join(listSep)
                      : '';
                    return <td key={obj.id}>{actionsText || '—'}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

function ReportsCrossView({
  projection,
  humanize,
  onSelectObject,
  onOpenTechnicalDetails,
}: {
  projection: BusinessModelProjection;
  humanize: (raw: string | undefined) => string;
  onSelectObject: (objectId: string) => void;
  onOpenTechnicalDetails: (locator: TechnicalLocator) => void;
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
                {grp.list.map((qr) => (
                  <li key={qr.id}>
                    <span className="bm-item-name">{humanize(qr.displayName)}</span>
                    <span className="bm-item-note">
                      {humanize(qr.description)}
                      {qr.sourceObjects.length > 0 && (
                        <>
                          {qr.description ? ' · ' : ''}
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
                    </span>
                    <ItemTechButton
                      itemId={qr.id}
                      locator={qr.locator}
                      onOpenTechnicalDetails={onOpenTechnicalDetails}
                    />
                  </li>
                ))}
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
}: {
  items: ProjectedOtherItem[];
  businessLocale: BusinessLocale;
  humanize: (raw: string | undefined) => string;
  onOpenTechnicalDetails: (locator: TechnicalLocator) => void;
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
              return (
                <li key={`${item.kind}-${item.id}`}>
                  <span className="bm-item-name">{itemTitle}</span>
                  <span className="bm-item-note">
                    {itemDesc ? `${kindLabel} · ${itemDesc}` : kindLabel}
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
