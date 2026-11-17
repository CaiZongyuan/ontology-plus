import type { Hono } from 'hono';
import {
  BUSINESS_VOCABULARY,
  getModelBusinessName,
  pickBusinessText,
  sanitizeBusinessText,
  type BusinessLocale,
} from '../packages/business-vocabulary/index.js';
import {
  type Attribute,
  type ModelCode,
  type OntologySuite,
  type ValidationDiagnostic,
} from '../packages/ontology-core/index.js';
import {
  SuiteValidationRejectedError,
  type BusinessModelInlineEditTarget,
  type BusinessModelIntentSummary,
  type ProjectDetail,
  type ProjectSummary,
  type WorkspaceStore,
} from '../packages/workspace-store/index.js';

export type {
  BusinessModelInlineEditTarget,
  BusinessModelIntentSummary,
} from '../packages/workspace-store/index.js';

export interface PatchBusinessModelRequest {
  edit?: BusinessModelInlineEditTarget;
  suite?: OntologySuite;
  note?: string;
  intentSummary?: BusinessModelIntentSummary;
}

export interface BusinessModelEditRejectedPayload {
  code: 'SUITE_VALIDATION_REJECTED';
  reasonZh: string;
  reasonEn: string;
  assistantPromptZh: string;
  assistantPromptEn: string;
  newErrorCount: number;
}

export interface BusinessModelEditSuccessPayload {
  project: ProjectDetail;
  projects: ProjectSummary[];
}

class BusinessModelTargetError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 = 404,
  ) {
    super(message);
  }
}

interface EditIntentContext {
  conceptZh: string;
  conceptEn: string;
  beforeLabel: string;
  desiredName?: string;
  desiredDescription?: string;
}

function sanitizeBusinessPhrase(raw: string | undefined, locale: BusinessLocale): string {
  return sanitizeBusinessText(raw, locale, {
    elementIdFallback: { zh: '条目', en: 'item' },
  });
}

function updateAliasOrNamePair(
  item: { name: string; alias: string },
  rawNext: string,
): void {
  const next = rawNext.trim();
  if (!next) {
    item.name = '';
    item.alias = '';
    return;
  }
  if (!item.alias.trim() || item.alias === item.name) {
    item.name = next;
    item.alias = next;
  } else {
    item.alias = next;
  }
}

function findOwnerAttributes(
  agg: NonNullable<OntologySuite['M1']>['aggregates'][number],
  ownerKind?: 'AGGREGATE' | 'SUB_ENTITY' | 'VALUE_OBJECT',
  ownerName?: string,
): Attribute[] {
  if (ownerKind === 'SUB_ENTITY' && ownerName) {
    const ent = agg.entities.find((e) => e.name === ownerName || e.alias === ownerName);
    if (!ent) throw new BusinessModelTargetError(`Sub-entity not found: ${ownerName}`);
    return ent.attributes;
  }
  if (ownerKind === 'VALUE_OBJECT' && ownerName) {
    const vo = agg.valueObjects.find((v) => v.name === ownerName || v.alias === ownerName);
    if (!vo) throw new BusinessModelTargetError(`Value object not found: ${ownerName}`);
    return vo.attributes;
  }
  return agg.attributes;
}

export function applyBusinessModelInlineEdit(
  currentSuite: OntologySuite,
  edit: BusinessModelInlineEditTarget,
): {
  nextSuite: OntologySuite;
  modelCode: ModelCode;
  defaultNote: string;
  intent: EditIntentContext;
} {
  const nextSuite: OntologySuite = JSON.parse(JSON.stringify(currentSuite));

  const findAggregate = (objectId: string) => {
    const agg = nextSuite.M1?.aggregates.find(
      (a) => a.id === objectId || a.name === objectId || a.alias === objectId,
    );
    if (!agg) throw new BusinessModelTargetError(`Business Object not found: ${objectId}`);
    return agg;
  };

  switch (edit.kind) {
    case 'BUSINESS_OBJECT': {
      const agg = findAggregate(edit.objectId);
      const beforeLabel = agg.alias.trim() || agg.name.trim() || agg.id;
      if (edit.name !== undefined) {
        updateAliasOrNamePair(agg, edit.name);
      }
      if (edit.description !== undefined) {
        agg.description = edit.description.trim();
      }
      return {
        nextSuite,
        modelCode: 'M1',
        defaultNote: `Updated Business Object "${beforeLabel}"`,
        intent: {
          conceptZh: '业务对象',
          conceptEn: 'business object',
          beforeLabel,
          ...(edit.name !== undefined ? { desiredName: edit.name.trim() } : {}),
          ...(edit.description !== undefined
            ? { desiredDescription: edit.description.trim() }
            : {}),
        },
      };
    }

    case 'FIELD': {
      const agg = findAggregate(edit.objectId);
      const attrs = findOwnerAttributes(agg, edit.ownerKind, edit.ownerName);
      const attr = attrs.find((f) => f.name === edit.fieldName || f.label === edit.fieldName);
      if (!attr) throw new BusinessModelTargetError(`Field not found: ${edit.fieldName}`);
      const beforeLabel = attr.label.trim() || attr.name.trim();
      if (edit.name !== undefined) {
        const trimmed = edit.name.trim();
        if (!trimmed) {
          attr.name = '';
          attr.label = '';
        } else if (!attr.label.trim() || attr.label === attr.name) {
          attr.name = trimmed;
          attr.label = trimmed;
        } else {
          attr.label = trimmed;
        }
      }
      if (edit.description !== undefined) {
        const cleanDesc = edit.description.trim();
        if (cleanDesc) attr.description = cleanDesc;
        else delete attr.description;
      }
      return {
        nextSuite,
        modelCode: 'M1',
        defaultNote: `Updated field "${beforeLabel}" on "${agg.alias || agg.name}"`,
        intent: {
          conceptZh: `「${agg.alias || agg.name}」的字段`,
          conceptEn: `field on "${agg.alias || agg.name}"`,
          beforeLabel,
          ...(edit.name !== undefined ? { desiredName: edit.name.trim() } : {}),
          ...(edit.description !== undefined
            ? { desiredDescription: edit.description.trim() }
            : {}),
        },
      };
    }

    case 'SUB_ENTITY': {
      const agg = findAggregate(edit.objectId);
      const ent = agg.entities.find(
        (e) => e.name === edit.entityName || e.alias === edit.entityName,
      );
      if (!ent) throw new BusinessModelTargetError(`Detail list not found: ${edit.entityName}`);
      const beforeLabel = ent.alias.trim() || ent.name.trim();
      if (edit.name !== undefined) {
        updateAliasOrNamePair(ent, edit.name);
      }
      if (edit.description !== undefined) {
        const cleanDesc = edit.description.trim();
        if (cleanDesc) ent.description = cleanDesc;
        else delete ent.description;
      }
      return {
        nextSuite,
        modelCode: 'M1',
        defaultNote: `Updated detail list "${beforeLabel}"`,
        intent: {
          conceptZh: '明细列表',
          conceptEn: 'detail items group',
          beforeLabel,
          ...(edit.name !== undefined ? { desiredName: edit.name.trim() } : {}),
          ...(edit.description !== undefined
            ? { desiredDescription: edit.description.trim() }
            : {}),
        },
      };
    }

    case 'VALUE_OBJECT': {
      const agg = findAggregate(edit.objectId);
      const vo = agg.valueObjects.find(
        (v) => v.name === edit.valueObjectName || v.alias === edit.valueObjectName,
      );
      if (!vo) {
        throw new BusinessModelTargetError(`Grouped info not found: ${edit.valueObjectName}`);
      }
      const beforeLabel = vo.alias.trim() || vo.name.trim();
      if (edit.name !== undefined) {
        updateAliasOrNamePair(vo, edit.name);
      }
      if (edit.description !== undefined) {
        const cleanDesc = edit.description.trim();
        if (cleanDesc) vo.description = cleanDesc;
        else delete vo.description;
      }
      return {
        nextSuite,
        modelCode: 'M1',
        defaultNote: `Updated grouped info "${beforeLabel}"`,
        intent: {
          conceptZh: '组合信息',
          conceptEn: 'grouped info',
          beforeLabel,
          ...(edit.name !== undefined ? { desiredName: edit.name.trim() } : {}),
          ...(edit.description !== undefined
            ? { desiredDescription: edit.description.trim() }
            : {}),
        },
      };
    }

    case 'ACTION': {
      const beh = nextSuite.M2?.behaviors.find((b) => b.id === edit.actionId);
      if (!beh) throw new BusinessModelTargetError(`Action not found: ${edit.actionId}`);
      const beforeLabel = beh.alias.trim() || beh.name.trim() || beh.id;
      if (edit.name !== undefined) {
        updateAliasOrNamePair(beh, edit.name);
      }
      if (edit.description !== undefined) {
        beh.description = edit.description.trim();
      }
      return {
        nextSuite,
        modelCode: 'M2',
        defaultNote: `Updated action "${beforeLabel}"`,
        intent: {
          conceptZh: '业务操作',
          conceptEn: 'action',
          beforeLabel,
          ...(edit.name !== undefined ? { desiredName: edit.name.trim() } : {}),
          ...(edit.description !== undefined
            ? { desiredDescription: edit.description.trim() }
            : {}),
        },
      };
    }

    case 'M3_RULE': {
      const rule = nextSuite.M3?.rules.find((r) => r.id === edit.ruleId);
      if (!rule) throw new BusinessModelTargetError(`Business rule not found: ${edit.ruleId}`);
      const beforeLabel = rule.alias.trim() || rule.name.trim() || rule.id;
      if (edit.name !== undefined) {
        updateAliasOrNamePair(rule, edit.name);
      }
      if (edit.description !== undefined) {
        rule.description = edit.description.trim();
      }
      return {
        nextSuite,
        modelCode: 'M3',
        defaultNote: `Updated business rule "${beforeLabel}"`,
        intent: {
          conceptZh: '业务规则',
          conceptEn: 'business rule',
          beforeLabel,
          ...(edit.name !== undefined ? { desiredName: edit.name.trim() } : {}),
          ...(edit.description !== undefined
            ? { desiredDescription: edit.description.trim() }
            : {}),
        },
      };
    }

    case 'INVARIANT': {
      const agg = findAggregate(edit.objectId);
      const inv = agg.invariants.find((i) => i.name === edit.invariantName);
      if (!inv) {
        throw new BusinessModelTargetError(`Invariant rule not found: ${edit.invariantName}`);
      }
      const beforeLabel = inv.violationMessage.trim() || inv.name.trim();
      if (edit.description !== undefined) {
        inv.violationMessage = edit.description.trim();
      }
      return {
        nextSuite,
        modelCode: 'M1',
        defaultNote: `Updated business rule "${beforeLabel}"`,
        intent: {
          conceptZh: '业务规则',
          conceptEn: 'business rule',
          beforeLabel,
          ...(edit.description !== undefined
            ? { desiredName: edit.description.trim() }
            : {}),
        },
      };
    }

    case 'ATTRIBUTE_RULE': {
      const agg = findAggregate(edit.objectId);
      const attrs = findOwnerAttributes(agg, edit.ownerKind, edit.ownerName);
      const attr = attrs.find((f) => f.name === edit.fieldName);
      const refRule = attr?.refRules?.find((r) => r.name === edit.ruleName);
      if (!attr || !refRule) {
        throw new BusinessModelTargetError(`Attribute rule not found: ${edit.ruleName}`);
      }
      const beforeLabel = refRule.violationMessage.trim() || refRule.name.trim();
      if (edit.description !== undefined) {
        const trimmed = edit.description.trim();
        if (!trimmed) {
          refRule.violationMessage = '';
          refRule.expression = '';
        } else {
          refRule.violationMessage = trimmed;
        }
      }
      return {
        nextSuite,
        modelCode: 'M1',
        defaultNote: `Updated field rule "${beforeLabel}"`,
        intent: {
          conceptZh: '字段业务规则',
          conceptEn: 'field rule',
          beforeLabel,
          ...(edit.description !== undefined
            ? { desiredName: edit.description.trim() }
            : {}),
        },
      };
    }

    case 'EVENT': {
      const ev = nextSuite.ME?.events.find((e) => e.id === edit.eventId);
      if (!ev) throw new BusinessModelTargetError(`Business event not found: ${edit.eventId}`);
      const beforeLabel = ev.label.trim() || ev.name.trim() || ev.id;
      if (edit.name !== undefined) {
        const trimmed = edit.name.trim();
        if (!trimmed) {
          ev.label = '';
          ev.name = '';
        } else if (!ev.label.trim() || ev.label === ev.name) {
          ev.name = trimmed;
          ev.label = trimmed;
        } else {
          ev.label = trimmed;
        }
      }
      if (edit.description !== undefined) {
        ev.description = edit.description.trim();
      }
      return {
        nextSuite,
        modelCode: 'ME',
        defaultNote: `Updated business event "${beforeLabel}"`,
        intent: {
          conceptZh: '业务事件',
          conceptEn: 'business event',
          beforeLabel,
          ...(edit.name !== undefined ? { desiredName: edit.name.trim() } : {}),
          ...(edit.description !== undefined
            ? { desiredDescription: edit.description.trim() }
            : {}),
        },
      };
    }

    case 'AUTOMATION': {
      const sc = nextSuite.M4?.event_scenarios.find((s) => s.id === edit.scenarioId);
      if (!sc) throw new BusinessModelTargetError(`Automation not found: ${edit.scenarioId}`);
      const beforeLabel = sc.name.trim() || sc.id;
      if (edit.name !== undefined) {
        sc.name = edit.name.trim();
      }
      if (edit.description !== undefined) {
        sc.description = edit.description.trim();
      }
      return {
        nextSuite,
        modelCode: 'M4',
        defaultNote: `Updated automation "${beforeLabel}"`,
        intent: {
          conceptZh: '自动联动',
          conceptEn: 'automation',
          beforeLabel,
          ...(edit.name !== undefined ? { desiredName: edit.name.trim() } : {}),
          ...(edit.description !== undefined
            ? { desiredDescription: edit.description.trim() }
            : {}),
        },
      };
    }

    case 'SCREEN': {
      const scr = nextSuite.MU?.screens.find((s) => s.screenId === edit.screenId);
      if (!scr) throw new BusinessModelTargetError(`Screen not found: ${edit.screenId}`);
      const beforeLabel = scr.name.trim() || scr.screenId;
      if (edit.name !== undefined) {
        scr.name = edit.name.trim();
      }
      if (edit.description !== undefined) {
        scr.description = edit.description.trim();
      }
      return {
        nextSuite,
        modelCode: 'MU',
        defaultNote: `Updated screen "${beforeLabel}"`,
        intent: {
          conceptZh: '界面',
          conceptEn: 'screen',
          beforeLabel,
          ...(edit.name !== undefined ? { desiredName: edit.name.trim() } : {}),
          ...(edit.description !== undefined
            ? { desiredDescription: edit.description.trim() }
            : {}),
        },
      };
    }

    case 'INTEGRATION': {
      const intf = nextSuite.MI?.interfaces.find((i) => i.interfaceId === edit.interfaceId);
      if (!intf) {
        throw new BusinessModelTargetError(`Integration not found: ${edit.interfaceId}`);
      }
      const beforeLabel = intf.name.trim() || intf.interfaceId;
      if (edit.name !== undefined) {
        intf.name = edit.name.trim();
      }
      if (edit.description !== undefined) {
        intf.description = edit.description.trim();
      }
      return {
        nextSuite,
        modelCode: 'MI',
        defaultNote: `Updated integration "${beforeLabel}"`,
        intent: {
          conceptZh: '对外接口',
          conceptEn: 'integration',
          beforeLabel,
          ...(edit.name !== undefined ? { desiredName: edit.name.trim() } : {}),
          ...(edit.description !== undefined
            ? { desiredDescription: edit.description.trim() }
            : {}),
        },
      };
    }

    case 'FLOW': {
      const flow = nextSuite.M6?.flows.find((f) => f.id === edit.flowId);
      if (!flow) throw new BusinessModelTargetError(`Flow not found: ${edit.flowId}`);
      const beforeLabel = flow.name.trim() || flow.id;
      if (edit.name !== undefined) {
        flow.name = edit.name.trim();
      }
      if (edit.description !== undefined) {
        flow.description = edit.description.trim();
      }
      return {
        nextSuite,
        modelCode: 'M6',
        defaultNote: `Updated flow "${beforeLabel}"`,
        intent: {
          conceptZh: '流程与审批',
          conceptEn: 'flow',
          beforeLabel,
          ...(edit.name !== undefined ? { desiredName: edit.name.trim() } : {}),
          ...(edit.description !== undefined
            ? { desiredDescription: edit.description.trim() }
            : {}),
        },
      };
    }

    case 'ROLE': {
      const role = nextSuite.M5?.roles.find((r) => r.id === edit.roleId);
      if (!role) throw new BusinessModelTargetError(`Role not found: ${edit.roleId}`);
      const beforeLabel = role.name.trim() || role.id;
      if (edit.name !== undefined) {
        role.name = edit.name.trim();
      }
      if (edit.description !== undefined) {
        role.description = edit.description.trim();
      }
      return {
        nextSuite,
        modelCode: 'M5',
        defaultNote: `Updated role "${beforeLabel}"`,
        intent: {
          conceptZh: '角色',
          conceptEn: 'role',
          beforeLabel,
          ...(edit.name !== undefined ? { desiredName: edit.name.trim() } : {}),
          ...(edit.description !== undefined
            ? { desiredDescription: edit.description.trim() }
            : {}),
        },
      };
    }

    case 'QUERY_REPORT': {
      const qr = nextSuite.M7?.query_reports.find((q) => q.id === edit.reportId);
      if (!qr) throw new BusinessModelTargetError(`Query/report not found: ${edit.reportId}`);
      const beforeLabel = qr.alias.trim() || qr.name.trim() || qr.id;
      if (edit.name !== undefined) {
        updateAliasOrNamePair(qr, edit.name);
      }
      if (edit.description !== undefined) {
        qr.description = edit.description.trim();
      }
      return {
        nextSuite,
        modelCode: 'M7',
        defaultNote: `Updated query/report "${beforeLabel}"`,
        intent: {
          conceptZh: '查询与报表',
          conceptEn: 'query or report',
          beforeLabel,
          ...(edit.name !== undefined ? { desiredName: edit.name.trim() } : {}),
          ...(edit.description !== undefined
            ? { desiredDescription: edit.description.trim() }
            : {}),
        },
      };
    }

    case 'DATA_DICTIONARY': {
      const dict = nextSuite.M1?.data_dictionaries.find((d) => d.id === edit.dictionaryId);
      if (!dict) {
        throw new BusinessModelTargetError(`Option dictionary not found: ${edit.dictionaryId}`);
      }
      const beforeLabel = dict.name.trim() || dict.id;
      if (edit.name !== undefined) {
        dict.name = edit.name.trim();
      }
      if (edit.description !== undefined) {
        dict.description = edit.description.trim();
      }
      return {
        nextSuite,
        modelCode: 'M1',
        defaultNote: `Updated option dictionary "${beforeLabel}"`,
        intent: {
          conceptZh: '业务选项字典',
          conceptEn: 'option dictionary',
          beforeLabel,
          ...(edit.name !== undefined ? { desiredName: edit.name.trim() } : {}),
          ...(edit.description !== undefined
            ? { desiredDescription: edit.description.trim() }
            : {}),
        },
      };
    }

    case 'ASSOCIATION': {
      const assoc = nextSuite.M1?.aggregate_associations.find(
        (a) => a.id === edit.associationId,
      );
      if (!assoc) {
        throw new BusinessModelTargetError(`Association not found: ${edit.associationId}`);
      }
      const beforeLabel =
        assoc.description?.trim() || `${assoc.sourceRole}-${assoc.targetRole}` || assoc.id;
      if (edit.description !== undefined) {
        const cleanDesc = edit.description.trim();
        if (cleanDesc) assoc.description = cleanDesc;
        else delete assoc.description;
      }
      return {
        nextSuite,
        modelCode: 'M1',
        defaultNote: `Updated object relation "${beforeLabel}"`,
        intent: {
          conceptZh: '对象关联',
          conceptEn: 'object relation',
          beforeLabel,
          ...(edit.description !== undefined
            ? { desiredDescription: edit.description.trim() }
            : {}),
        },
      };
    }

    case 'CROSS_CUTTING_UI': {
      const cc = nextSuite.MU?.cross_cutting_ui.find((item) => item.id === edit.crossCuttingId);
      if (!cc) {
        throw new BusinessModelTargetError(
          `Shared screen element not found: ${edit.crossCuttingId}`,
        );
      }
      const beforeLabel = cc.name.trim() || cc.id;
      if (edit.name !== undefined) {
        cc.name = edit.name.trim();
      }
      if (edit.description !== undefined) {
        const cleanDesc = edit.description.trim();
        if (cleanDesc) cc.description = cleanDesc;
        else delete cc.description;
      }
      return {
        nextSuite,
        modelCode: 'MU',
        defaultNote: `Updated shared screen element "${beforeLabel}"`,
        intent: {
          conceptZh: '全局界面元素',
          conceptEn: 'shared screen element',
          beforeLabel,
          ...(edit.name !== undefined ? { desiredName: edit.name.trim() } : {}),
          ...(edit.description !== undefined
            ? { desiredDescription: edit.description.trim() }
            : {}),
        },
      };
    }

    case 'ACTOR': {
      const actor = nextSuite.M5?.actors.find((a) => a.id === edit.actorId);
      if (!actor) throw new BusinessModelTargetError(`Actor not found: ${edit.actorId}`);
      const beforeLabel = actor.name.trim() || actor.id;
      if (edit.name !== undefined) {
        actor.name = edit.name.trim();
      }
      if (edit.description !== undefined) {
        const cleanDesc = edit.description.trim();
        if (cleanDesc) actor.description = cleanDesc;
        else delete actor.description;
      }
      return {
        nextSuite,
        modelCode: 'M5',
        defaultNote: `Updated actor "${beforeLabel}"`,
        intent: {
          conceptZh: '参与主体',
          conceptEn: 'actor',
          beforeLabel,
          ...(edit.name !== undefined ? { desiredName: edit.name.trim() } : {}),
          ...(edit.description !== undefined
            ? { desiredDescription: edit.description.trim() }
            : {}),
        },
      };
    }

    case 'PERMISSION_GROUP': {
      const group = nextSuite.M5?.permissionGroups?.find((g) => g.id === edit.groupId);
      if (!group) {
        throw new BusinessModelTargetError(`Permission group not found: ${edit.groupId}`);
      }
      const beforeLabel = group.name.trim() || group.id;
      if (edit.name !== undefined) {
        group.name = edit.name.trim();
      }
      if (edit.description !== undefined) {
        const cleanDesc = edit.description.trim();
        if (cleanDesc) group.description = cleanDesc;
        else delete group.description;
      }
      return {
        nextSuite,
        modelCode: 'M5',
        defaultNote: `Updated permission group "${beforeLabel}"`,
        intent: {
          conceptZh: '权限分组',
          conceptEn: 'permission group',
          beforeLabel,
          ...(edit.name !== undefined ? { desiredName: edit.name.trim() } : {}),
          ...(edit.description !== undefined
            ? { desiredDescription: edit.description.trim() }
            : {}),
        },
      };
    }

    case 'PERMISSION': {
      const perm = nextSuite.M5?.permissions.find((p) => p.id === edit.permissionId);
      if (!perm) {
        throw new BusinessModelTargetError(`Permission not found: ${edit.permissionId}`);
      }
      const beforeLabel = perm.name.trim() || perm.id;
      if (edit.name !== undefined) {
        perm.name = edit.name.trim();
      }
      return {
        nextSuite,
        modelCode: 'M5',
        defaultNote: `Updated permission "${beforeLabel}"`,
        intent: {
          conceptZh: '权限项',
          conceptEn: 'permission',
          beforeLabel,
          ...(edit.name !== undefined ? { desiredName: edit.name.trim() } : {}),
        },
      };
    }
  }
}

function collectAffectedAreas(
  newErrors: readonly ValidationDiagnostic[],
  locale: BusinessLocale,
): string {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const diag of newErrors) {
    const label = getModelBusinessName(diag.model, locale);
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  if (labels.length === 0) {
    return locale === 'en-US' ? 'related items' : '关联内容';
  }
  return locale === 'en-US' ? labels.join(', ') : labels.join('、');
}

function buildRejectionPayload(
  newErrors: readonly ValidationDiagnostic[],
  intent: EditIntentContext | undefined,
  intentSummary: BusinessModelIntentSummary | undefined,
): BusinessModelEditRejectedPayload {
  const hasEmptyName = newErrors.some((d) => d.code.includes('_EMPTY_'));
  const hasDuplicateName = newErrors.some((d) => d.code.includes('_DUPLICATE_'));

  const beforeZh =
    sanitizeBusinessPhrase(
      intent?.beforeLabel ?? intentSummary?.targetLabelZh,
      'zh-CN',
    ) || '当前条目';
  const beforeEn =
    sanitizeBusinessPhrase(
      intent?.beforeLabel ?? intentSummary?.targetLabelEn ?? intentSummary?.targetLabelZh,
      'en-US',
    ) || 'this item';

  const desiredZh = sanitizeBusinessPhrase(
    intent?.desiredName ?? intentSummary?.desiredChangeZh,
    'zh-CN',
  );
  const desiredEn = sanitizeBusinessPhrase(
    intent?.desiredName ?? intentSummary?.desiredChangeEn ?? intentSummary?.desiredChangeZh,
    'en-US',
  );

  const conceptZh = sanitizeBusinessPhrase(intent?.conceptZh, 'zh-CN') || '内容';
  const conceptEn = sanitizeBusinessPhrase(intent?.conceptEn, 'en-US') || 'item';

  const affectedZh = collectAffectedAreas(newErrors, 'zh-CN');
  const affectedEn = collectAffectedAreas(newErrors, 'en-US');

  let reasonZh: string;
  let reasonEn: string;
  let assistantPromptZh: string;
  let assistantPromptEn: string;

  if (hasEmptyName) {
    reasonZh = `名称或规则说明不能为空，否则会产生${BUSINESS_VOCABULARY.CONSISTENCY_ERROR.zh}；如需移除或合并「${beforeZh}」，请交给 ${BUSINESS_VOCABULARY.AI_ASSISTANT.zh}处理。`;
    reasonEn = `A blank name or rule text would create ${BUSINESS_VOCABULARY.CONSISTENCY_ERROR.en.toLowerCase()}; if you want to remove or merge "${beforeEn}", let ${BUSINESS_VOCABULARY.AI_ASSISTANT.en} handle it.`;
    assistantPromptZh = `我想移除或重新整理${conceptZh}「${beforeZh}」，请帮我检查并同步调整所有关联的业务对象、业务操作、业务规则与界面，确保没有需要修正的问题。`;
    assistantPromptEn = `I want to remove or reorganize the ${conceptEn} "${beforeEn}". Please inspect and update all linked business objects, actions, business rules, and screens so there are no problems to fix.`;
  } else if (hasDuplicateName) {
    const dupLabelZh = desiredZh || beforeZh;
    const dupLabelEn = desiredEn || beforeEn;
    reasonZh = `已经存在同名的「${dupLabelZh}」，直接改成相同名称会产生${BUSINESS_VOCABULARY.CONSISTENCY_ERROR.zh}；如需合并这两项，请交给 ${BUSINESS_VOCABULARY.AI_ASSISTANT.zh}同步调整关联内容。`;
    reasonEn = `Another item is already named "${dupLabelEn}", so renaming directly would create ${BUSINESS_VOCABULARY.CONSISTENCY_ERROR.en.toLowerCase()}; let ${BUSINESS_VOCABULARY.AI_ASSISTANT.en} merge them and update linked items together.`;
    assistantPromptZh = `我想把${conceptZh}「${beforeZh}」改名为「${dupLabelZh}」（或与现有的「${dupLabelZh}」整合），请帮我同步调整所有关联的字段、业务操作、业务规则、角色权限与界面，确保业务模型保持一致。`;
    assistantPromptEn = `I want to rename the ${conceptEn} "${beforeEn}" to "${dupLabelEn}" (or merge it with the existing "${dupLabelEn}"). Please update all related fields, actions, business rules, role permissions, and screens so the business model stays consistent.`;
  } else {
    reasonZh = `这项修改会影响关联的${affectedZh}，单独修改会产生${BUSINESS_VOCABULARY.CONSISTENCY_ERROR.zh}；请交给 ${BUSINESS_VOCABULARY.AI_ASSISTANT.zh}一并更新所有关联处。`;
    reasonEn = `This change affects linked ${affectedEn} and would create ${BUSINESS_VOCABULARY.CONSISTENCY_ERROR.en.toLowerCase()} if saved alone; let ${BUSINESS_VOCABULARY.AI_ASSISTANT.en} update every linked item together.`;
    if (desiredZh) {
      assistantPromptZh = `我想对「${beforeZh}」完成调整（${desiredZh}），请帮我同步更新所有关联的${affectedZh}，确保业务模型没有需要修正的问题。`;
      assistantPromptEn = `I want to update "${beforeEn}" (${desiredEn || desiredZh}). Please coordinate updates across all linked ${affectedEn} so the business model has no problems to fix.`;
    } else {
      assistantPromptZh = `我想调整「${beforeZh}」，但这会影响关联的${affectedZh}，请帮我协调更新所有关联内容，确保业务模型保持一致。`;
      assistantPromptEn = `I want to update "${beforeEn}", which affects linked ${affectedEn}. Please coordinate all related updates so the business model remains consistent.`;
    }
  }

  return {
    code: 'SUITE_VALIDATION_REJECTED',
    reasonZh: sanitizeBusinessPhrase(reasonZh, 'zh-CN'),
    reasonEn: sanitizeBusinessPhrase(reasonEn, 'en-US'),
    assistantPromptZh: sanitizeBusinessPhrase(assistantPromptZh, 'zh-CN'),
    assistantPromptEn: sanitizeBusinessPhrase(assistantPromptEn, 'en-US'),
    newErrorCount: newErrors.length,
  };
}

export function registerBusinessModelEditRoutes(app: Hono, store: WorkspaceStore): void {
  app.patch('/api/projects/:id/business-model', async (c) => {
    const projectId = c.req.param('id');
    const current = store.getProject(projectId);
    if (!current) {
      return c.json({ error: 'Project not found.' }, 404);
    }

    const body = await c.req
      .json<PatchBusinessModelRequest>()
      .catch(() => ({} as PatchBusinessModelRequest));

    if (!body.edit && !body.suite) {
      return c.json(
        { error: 'Either `edit` or `suite` must be provided.' },
        400,
      );
    }

    let candidateSuite: OntologySuite;
    let modelCode: ModelCode | undefined;
    let defaultNote = 'Updated Business Model from Business View';
    let intent: EditIntentContext | undefined;

    try {
      if (body.edit) {
        const applied = applyBusinessModelInlineEdit(current.suite, body.edit);
        candidateSuite = applied.nextSuite;
        modelCode = applied.modelCode;
        defaultNote = applied.defaultNote;
        intent = applied.intent;
      } else {
        candidateSuite = body.suite!;
      }
    } catch (err) {
      if (err instanceof BusinessModelTargetError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }

    try {
      const project = store.commitSuite(projectId, candidateSuite, {
        source: {
          kind: 'MANUAL',
          ...(modelCode ? { modelCode } : {}),
        },
        note: body.note?.trim() || defaultNote,
        rejectOnNewErrors: true,
      });

      const payload: BusinessModelEditSuccessPayload = {
        project,
        projects: store.listProjects(),
      };
      return c.json(payload, 200);
    } catch (err) {
      if (err instanceof SuiteValidationRejectedError) {
        const payload = buildRejectionPayload(err.newErrors, intent, body.intentSummary);
        return c.json(payload, 422);
      }
      throw err;
    }
  });
}
