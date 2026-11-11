import fs from 'node:fs';
import path from 'node:path';
import {
  MODEL_CODES,
  MODEL_FILE_NAMES,
  MODEL_STAGE_ORDER,
  serializeManifestJson,
  serializeSuiteToYamlFiles,
  type ModelCode,
  type OntologyManifest,
} from '../../ontology-core/index.js';
import type {
  AssembledApplication,
  FourLayerAsset,
  GeneratedSkill,
  ProjectDetail,
  PrototypeArtifact,
  RequirementDoc,
} from '../../workspace-store/index.js';

export interface CompiledPackageFile {
  relativePath: string;
  category: 'GUIDE' | 'MANIFEST' | 'REFERENCE' | 'ONTOLOGY_YAML' | 'FOUNDATION' | 'SOURCE';
  sizeBytes: number;
  content: string;
}

export interface CompiledDevelopmentPackage {
  appId: string;
  appName: string;
  projectId: string;
  outputDir: string;
  compiledAt: string;
  files: CompiledPackageFile[];
  manifestJson: Record<string, unknown>;
}

export interface CompileDevelopmentPackageInput {
  app: AssembledApplication;
  project: ProjectDetail;
  uiUeAsset: FourLayerAsset;
  techFoundationAsset: FourLayerAsset;
  techArchAsset: FourLayerAsset;
  requirementDoc?: RequirementDoc;
  prototype?: PrototypeArtifact;
  workspaceRoot?: string;
  writeToDisk?: boolean;
}

function getPresentModelCodes(project: ProjectDetail): ModelCode[] {
  return MODEL_CODES.filter((code) => Boolean(project.suite[code]));
}

export function buildOntologySuiteManifest(project: ProjectDetail): OntologyManifest {
  const models: Record<string, string> = {};
  for (const code of getPresentModelCodes(project)) {
    models[code] = MODEL_FILE_NAMES[code];
  }
  return {
    version: '1.0',
    projectId: project.id,
    domain: project.domain || project.name,
    models,
  };
}

export function buildMasterDevelopmentGuide(input: {
  app: AssembledApplication;
  project: ProjectDetail;
  uiUeAsset: FourLayerAsset;
  techFoundationAsset: FourLayerAsset;
  techArchAsset: FourLayerAsset;
  compiledAt: string;
}): string {
  const { app, project, uiUeAsset, techFoundationAsset, techArchAsset, compiledAt } = input;
  const presentCodes = getPresentModelCodes(project);
  const presentSet = new Set<ModelCode>(presentCodes);

  const renderPointerGroup = (codes: ModelCode[], extraPaths: string[] = []): string => {
    const lines: string[] = [];
    for (const code of codes) {
      if (presentSet.has(code)) {
        const fileName = MODEL_FILE_NAMES[code];
        lines.push(
          `  - \`参考资料/本体模型/${fileName}\`（镜像路径：\`.onto-cs/model/${project.id}/yaml/${fileName}\`）`,
        );
      }
    }
    for (const extra of extraPaths) {
      lines.push(`  - \`${extra}\``);
    }
    return lines.length > 0 ? lines.join('\n') : '  - _当前工程阶段尚未裁剪该组元模型_';
  };

  const aggSummary =
    (project.suite.M1?.aggregates ?? []).map((a) => `\`${a.name}\``).join('、') || '暂无聚合根';
  const behSummary =
    (project.suite.M2?.behaviors ?? []).map((b) => `\`${b.id}:${b.name}\``).join('、') ||
    '暂无行为';
  const flowSummary =
    (project.suite.M6?.flows ?? []).map((f) => `\`${f.id}:${f.name}\``).join('、') ||
    '按需装配流程';
  const screenSummary =
    (project.suite.MU?.screens ?? []).map((s) => `\`${s.screenId}\``).join('、') ||
    '按原型语义锚点绑定';

  return `# 开发指导书 — ${app.name}

> **生成时间**：\`${compiledAt}\`
> **所属本体工程**：\`${project.name} (${project.code})\`
> **一致性门禁状态**：✅ 通过（Consistency Error === 0 · ${presentCodes.length}/11 模型就绪）

## 1. 工程定位与四层架构装配件矩阵 (4-Layer Asset Assembly Matrix)
本开发资料包由 **Ontology Plus** 平台自动编译生成，严格遵循 **渐进式披露（Progressive Disclosure）** 架构规范。编码智能体（Coding Agent）禁止一次性将全部 YAML 塞入上下文，必须先阅读本指导书与 \`manifest.json\` 建立全局索引，再按施工阶段按需加载目标元模型文件。

| 架构层级 | 选用资产标识 | 选用资产名称 | 版本 | 权威规范与产物路径 |
| :--- | :--- | :--- | :--- | :--- |
| **01 UI/UE 原型层** | \`${uiUeAsset.id}\` | ${uiUeAsset.name} | ${uiUeAsset.version} | \`参考资料/UI-UE界面设计规范.md\` + \`参考资料/界面原型.html\` |
| **02 业务本体层** | \`${project.id}\` | ${project.name} | v5.0 | \`本体模型业务功能开发指导书.md\` + \`参考资料/本体模型/manifest.json\` |
| **03 技术底座层** | \`${techFoundationAsset.id}\` | ${techFoundationAsset.name} | ${techFoundationAsset.version} | \`技术底座/README.md\` |
| **04 技术架构层** | \`${techArchAsset.id}\` | ${techArchAsset.name} | ${techArchAsset.version} | \`参考资料/技术架构设计文档.md\` |

## 2. 渐进式按需上下文指针 (Progressive Context Pointers)
- **Step 0 — 全局模型索引（必读入口）**：
  - \`参考资料/本体模型/manifest.json\`（工作区镜像：\`.onto-cs/model/${project.id}/yaml/manifest.json\`）
  - 已就绪元模型清单（${presentCodes.length} 个）：${presentCodes.map((c) => `\`${c}\` (\`${MODEL_FILE_NAMES[c]}\`)`).join('、')}
- **数据模型、字典与物理表持久化上下文（M1 / MM）**：
${renderPointerGroup(['M1', 'MM'])}
- **领域命令、前置规则门禁与跨聚合事件协同上下文（M2 / M3 / ME / M4）**：
${renderPointerGroup(['M2', 'M3', 'ME', 'M4'])}
- **组织权限、审批工作流与读写分离报表上下文（M5 / M6 / M7）**：
${renderPointerGroup(['M5', 'M6', 'M7'])}
- **前端屏幕、原型语义锚点与外部系统接口上下文（MU / MI）**：
${renderPointerGroup(['MU', 'MI'], ['参考资料/界面原型.html'])}

## 3. 五阶段标准施工序列 (5-Phase Execution Sequence)
1. **Phase 1 — 本体契约解析与物理建库**：读取 \`manifest.json\`、\`M1\` 与 \`MM\`，落地主从业务表、\`__dict\` 系统字典表及 5 个强制审计字段。
2. **Phase 2 — 规则门禁与 CQRS 领域服务**：依据 \`M3\` 与 \`M2\`/\`M7\` 实现事务内三级规则拦截（属性 \`refRules\` -> 聚合 \`invariants\` -> 跨对象 \`M3\` 规则）及 1:1 读写分离查询沙箱。
3. **Phase 3 — 事件编排、权限矩阵与审批引擎**：依据 \`ME\`、\`M4\`、\`M5\` 与 \`M6\` 装配领域事件订阅/同步触发器、RBAC+ABAC 数据范围拦截及流程节点图。
4. **Phase 4 — 语义化前端屏幕与边界接口装配**：依据 \`MU\`、\`界面原型.html\` 与 \`MI\` 绑定 \`data-screen-id\` / \`data-binding\` / \`data-event-id\` 控件契约与 REST/外部写回适配器。
5. **Phase 5 — 4A V-Model 闭环核验与冒烟联调**：逐项执行下方交付验收清单，确保模型、代码、数据库与界面零语义漂移。

## 4. 4A V-Model 可核查交付完成标准 (4A V-Model Verification Criteria)
- [ ] **Consistency Error === 0（本体双层校验零阻断错误）**：全套元模型通过双层校验器门禁（\`Consistency Error === 0\`），聚合根（${aggSummary}）无悬空引用或契约冲突。
- [ ] **M3 Pre-condition Interception（M3 前置规则刚性拦截）**：所有领域行为（${behSummary}）在变更聚合状态或落库前，强制执行关联的 \`invokedRules\` 与聚合不变量，违背时原样返回 \`violationMessage\` 并回滚事务。
- [ ] **M6 Approval Gate Reachability（M6 审批门禁可达性与双按钮契约）**：所有工作流与审批流（${flowSummary}）起点到终态 \`END\` 100% 可达、网关具备默认完备分支，且审批录入屏幕严格提供 \`DRAFT\`（保存草稿）与 \`SUBMIT\`（提交审批）双按钮。
- [ ] **MU \`data-screen-id\` / \`data-binding\` Traceability（MU 界面语义锚点全链路追溯）**：所有前端屏幕（${screenSummary}）完整保留 \`data-screen-id\`、\`data-element-id\`、\`data-binding\`、\`data-event-id\` 锚点，交互调用链严格遵循 \`VALIDATE -> BEHAVIOR_CALL -> EVENT_EMIT\` 顺序，\`M7\` 报表严格执行 \`referenceSql\` 参数化绑定。
- [ ] **MM Physical Persistence Audit Columns（MM 物理持久化零漂移与 5 审计列）**：所有 \`MM\` 物理表与 \`M1\` 属性 100% 映射对齐，且每张业务主从表强制注入 \`created_by\`、\`created_at\`、\`updated_by\`、\`updated_at\`、\`flag\` 五个系统审计列。
`;
}

export function buildBusinessOntologyFeatureGuide(project: ProjectDetail): string {
  const { suite } = project;
  const pointerFor = (code: ModelCode): string =>
    suite[code]
      ? `\`参考资料/本体模型/${MODEL_FILE_NAMES[code]}\`（镜像：\`.onto-cs/model/${project.id}/yaml/${MODEL_FILE_NAMES[code]}\`）`
      : `_当前阶段未裁剪 \`${MODEL_FILE_NAMES[code]}\`（Stage Warning 非阻断项）_`;

  // M1 Summary
  const m1Summary = suite.M1
    ? [
        `- **模型指针**：${pointerFor('M1')}`,
        `- **数据字典（${suite.M1.data_dictionaries.length} 组）**：${
          suite.M1.data_dictionaries
            .map((d) => `\`${d.id}\` ${d.name} (${d.types.map((t) => t.typeCode).join('/')})`)
            .join('、') || '无'
        }`,
        `- **跨聚合关联（${suite.M1.aggregate_associations.length} 条）**：${
          suite.M1.aggregate_associations
            .map((a) => `\`${a.id}\` \`${a.sourceAggregate}.${a.referenceField} -> ${a.targetAggregate}\` (${a.cardinality})`)
            .join('；') || '无'
        }`,
        ...suite.M1.aggregates.map(
          (agg) =>
            `### 聚合根 \`${agg.name}\` (${agg.alias} · \`${agg.id}\`)\n` +
            `- **生命周期状态机**：\`${agg.lifecycle.join(' -> ') || 'ACTIVE'}\`\n` +
            `- **核心属性（${agg.attributes.length} 项）**：${agg.attributes.map((a) => `\`${a.name}\`(${a.label}:${a.type}${a.required ? '*' : ''})`).join(', ')}\n` +
            `- **子实体**：${agg.entities.map((e) => `\`${e.name}\`(${e.alias}:${e.cardinality})`).join(', ') || '无'} · **值对象**：${agg.valueObjects.map((v) => `\`${v.name}\`(${v.alias})`).join(', ') || '无'}\n` +
            `- **聚合不变量**：${agg.invariants.map((inv) => `\`${inv.name}\` [\`${inv.expression}\`]`).join('；') || '无'}`,
        ),
      ].join('\n')
    : `- **模型指针**：${pointerFor('M1')}`;

  // M2 Summary
  const m2Summary = suite.M2
    ? [
        `- **模型指针**：${pointerFor('M2')}`,
        ...suite.M2.behaviors.map((b) => {
          const events = b.producedEvents.map((e) => (typeof e === 'string' ? e : e.eventRef));
          const syncs = (b.syncTriggers ?? []).map((s) => s.behaviorRef);
          return (
            `- **\`${b.id}\` \`${b.name}\` (${b.alias})**：归属 \`${b.ownerEntity}\` · 类型 \`${b.behaviorType}\` · 触发 \`${b.triggerType}\` · ` +
            `前置规则 \`[${b.invokedRules.join(', ')}]\` · 产生事件 \`[${events.join(', ')}]\`` +
            (b.queryReportRef ? ` · 绑定报表 \`${b.queryReportRef}\`` : '') +
            (syncs.length > 0 ? ` · 同步联动 \`[${syncs.join(', ')}]\`` : '')
          );
        }),
      ].join('\n')
    : `- **模型指针**：${pointerFor('M2')}`;

  // M3 Summary
  const m3Summary = suite.M3
    ? [
        `- **模型指针**：${pointerFor('M3')}`,
        ...suite.M3.rules.map(
          (r) =>
            `- **\`${r.id}\` ${r.alias} (\`${r.name}\` · \`${r.ruleType}\`)**：表达式 \`${r.expression}\` — 违背提示：「${r.violationMessage ?? '规则校验未通过'}」`,
        ),
      ].join('\n')
    : `- **模型指针**：${pointerFor('M3')}`;

  // ME Summary
  const meSummary = suite.ME
    ? [
        `- **模型指针**：${pointerFor('ME')}`,
        ...suite.ME.events.map(
          (ev) =>
            `- **\`${ev.id}\` \`${ev.name}\` (${ev.label})**：源聚合 \`${ev.sourceAggregate}\` · 生产者 \`${ev.producerBehaviorRef || ev.producerRuleRef || '-'}\` · 投递语义 \`${ev.orderingSemantic}\` · 订阅者 ${ev.subscribers.length} 个`,
        ),
      ].join('\n')
    : `- **模型指针**：${pointerFor('ME')}`;

  // M4 Summary
  const m4Summary = suite.M4
    ? [
        `- **模型指针**：${pointerFor('M4')}`,
        ...suite.M4.event_scenarios.map(
          (sc) =>
            `- **\`${sc.id}\` ${sc.name}**：触发事件 \`${sc.triggerEventRef}\` · 涉及聚合 \`[${sc.involvedAggregates.join(', ')}]\` · 编排步骤 \`${sc.steps.map((st) => `${st.stepOrder}.${st.stepType}(${st.refId})`).join(' -> ')}\``,
        ),
      ].join('\n')
    : `- **模型指针**：${pointerFor('M4')}`;

  // M5 Summary
  const m5Summary = suite.M5
    ? [
        `- **模型指针**：${pointerFor('M5')}`,
        `- **业务主体（${suite.M5.actors.length} 类）**：${suite.M5.actors.map((a) => `\`${a.id}\` ${a.name}(${a.actorType})`).join('、') || '无'}`,
        `- **角色与数据范围（${suite.M5.roles.length} 个）**：${suite.M5.roles.map((r) => `\`${r.id}\` ${r.name}[code=${r.code}, scope=${r.dataScope}]`).join('、') || '无'}`,
        `- **细粒度权限点（${suite.M5.permissions.length} 项）**：${suite.M5.permissions.map((p) => `\`${p.id}\` \`${p.code}\` -> \`${p.targetAggregate}\` [${p.allowedBehaviors.join(', ')}]${p.abacCondition ? ` (ABAC: \`${p.abacCondition}\`)` : ''}`).join('；') || '无'}`,
      ].join('\n')
    : `- **模型指针**：${pointerFor('M5')}`;

  // M6 Summary
  const m6Summary = suite.M6
    ? [
        `- **模型指针**：${pointerFor('M6')}`,
        ...suite.M6.flows.map(
          (fl) =>
            `- **\`${fl.id}\` ${fl.name} (\`${fl.flowType}\`)**：主聚合 \`${fl.primaryAggregate}\` · 触发 \`${fl.trigger.triggerType}(${fl.trigger.behaviorRef ?? fl.trigger.refId ?? '-'}) \` · 节点数 ${fl.activities.length} 个（参与角色：\`[${fl.roleRefs.join(', ')}]\`）`,
        ),
      ].join('\n')
    : `- **模型指针**：${pointerFor('M6')}`;

  // M7 Summary
  const m7Summary = suite.M7
    ? [
        `- **模型指针**：${pointerFor('M7')}`,
        ...suite.M7.query_reports.map(
          (qr) =>
            `- **\`${qr.id}\` \`${qr.name}\` (${qr.alias} · \`${qr.queryType}\`)**：1:1 绑定行为 \`${qr.behaviorRef}\` · 主数据源 \`${qr.primarySource.aggregateRef}\` · 入参 ${qr.parameters.length} 个 · 输出列 ${qr.resultColumns.length} 个 · SQL 方言 \`${qr.referenceSql.dialect}\``,
        ),
      ].join('\n')
    : `- **模型指针**：${pointerFor('M7')}`;

  // MU Summary
  const muSummary = suite.MU
    ? [
        `- **模型指针**：${pointerFor('MU')}`,
        ...suite.MU.screens.map(
          (sc) =>
            `- **\`${sc.screenId}\` ${sc.name} (\`${sc.screenType}\` · 路由 \`${sc.route ?? '/'}\`)**：包含 ${sc.elements.length} 个语义控件、${sc.events.length} 个交互事件（角色：\`[${sc.roleRefs.join(', ')}]\`）`,
        ),
      ].join('\n')
    : `- **模型指针**：${pointerFor('MU')}`;

  // MM Summary
  const mmSummary = suite.MM
    ? [
        `- **模型指针**：${pointerFor('MM')}`,
        ...suite.MM.mappings.map(
          (mp) =>
            `- **\`${mp.id}\` \`${mp.objectName}\` (\`${mp.objectRef}\`)**：映射物理表 ${mp.tableMappings.map((tm) => `\`${tm.tableName}\`(${tm.tableRole}, PK=\`${tm.primaryKey}\`, ${tm.columnMappings.length} 列)`).join('、')}`,
        ),
      ].join('\n')
    : `- **模型指针**：${pointerFor('MM')}`;

  // MI Summary
  const miSummary = suite.MI
    ? [
        `- **模型指针**：${pointerFor('MI')}`,
        ...suite.MI.interfaces.map(
          (iface) =>
            `- **\`${iface.interfaceId}\` ${iface.name}** (\`${iface.direction}\` · \`${iface.interfaceCategory}\` · \`${iface.protocol}/${iface.format}\`)：关联行为 \`${iface.relatedBehaviorRef ?? '-'}\` · 关联报表 \`${iface.relatedReportRef ?? '-'}\` · 返回码规则 ${iface.returnRules.length} 条`,
        ),
      ].join('\n')
    : `- **模型指针**：${pointerFor('MI')}`;

  return `# 本体模型业务功能开发指导书 — ${project.domain}

> **编译原则**：本指导书采用结构化摘要 + 精确 YAML 上下文指针，严禁将全量 YAML 拼接进单一提示词。编码实现任一模块前，请按对应章节指针读取权威元模型文件。

## 一、标准 10 步本体驱动工程流水线 (10-Step Engineering Pipeline · §15.5)

1. **Step 1 — Physical DDL & 5 Audit Fields（物理建表、5 审计字段与系统字典表）**：
   依据 \`M1\` 与 \`MM\` 生成 SQLite/D1 增量 DDL；自动创建 \`__dict\` 系统数据字典表（\`dict_id\`, \`type_code\`, \`code\`, \`label\`, \`enabled\`, \`sort_order\`），并向所有业务主从表强制注入 \`created_by\`、\`created_at\`、\`updated_by\`、\`updated_at\`、\`flag\`（逻辑有效标记 \`1/0\`）五个系统审计列。
2. **Step 2 — Auto-numbering（确定性业务流水号生成）**：
   聚合根单据编号统一遵循 \`前缀3大写字母 + 4位流水号\` 公式（例如 \`CON0001\`），必须在同一数据库写事务内原子取号自增，前端表单设为只读，严禁人工输入。
3. **Step 3 — Domain Entity & State Machine（M1 领域聚合根与生命周期状态机）**：
   严格按 \`M1\` 封装聚合根、内部子实体（\`ONE_OR_MORE\` 映射明细子表并维护单事务级联）、不可变值对象与生命周期状态跃迁守卫；含”作废/VOID”状态的对象优先执行逻辑作废，物理删除必须执行全库外键引用保护扫描。
4. **Step 4 — Rule Engine Interceptors（M3 多级规则引擎拦截器）**：
   在命令服务入口建立三级规则拦截链（属性级 \`refRules\` -> 聚合级 \`invariants\` -> \`M3\` 跨对象规则），完整覆盖 \`VALIDATION\`（布尔门禁）、\`CALCULATION\`（数值计价）、\`STATE_GUARD\`（状态流转守卫）与 \`SPLIT_MERGE\`（拆分合并守恒）。
5. **Step 5 — Command & Query Services（M2 <-> M7 1:1 读写分离服务）**：
   \`M2\` \`COMMAND\` 行为独占写事务并持久化状态变更；\`M2\` \`QUERY\` 行为与 \`M7\` 查询报表保持严格 1:1 双向绑定，通过只读 SQL 沙箱参数化执行 \`referenceSql\`，并自动补充外键/字典 \`<field>__label\` 显示标签。
6. **Step 6 — Event Bus & Saga Listeners（ME 领域事件总线与 M4 跨聚合协同）**：
   在 \`M2\` 命令提交后发布过去时态 \`ME\` 领域事件（或执行单体事务内 \`syncTriggers\`），驱动 \`M4\` 跨聚合协同场景按 \`BEHAVIOR_CALL -> EVENT_EMIT -> RULE_EVALUATE\` 顺序推进。
7. **Step 7 — Actor RBAC, ABAC & Row/Column Data Scope（M5 权限与行列级数据范围）**：
   幂等初始化 \`M5\` 主体、角色继承链与权限码，在服务层与查询层同时拦截操作功能点权限、行级 \`dataScope\`（\`ALL\` / \`DEPT\` / \`OWN\`）及动态 \`abacCondition\` 表达式。
8. **Step 8 — Process & Approval Engine（M6 流程审批引擎与双按钮铁律）**：
   将 \`M6\` \`COLLABORATION\` 与 \`APPROVAL\` 流程装配至工作流节点图；任何关联审批流的录入编辑页底部必须同时落实 **双按钮规则（Two-Button Rule）**：\`保存草稿 (DRAFT)\`（松校验、不入流）与 \`提交审批 (SUBMIT)\`（全量 \`M3\` 强校验并启动 \`M6\` 流程）。
9. **Step 9 — UI Screen Assembly（MU 屏幕控件映射与三类联动铁律）**：
   按 \`MU\` 与 \`界面原型.html\` 确定性映射控件——\`AggregateRootRef\` 强制渲染为弹窗跳选框（\`POPUP_SELECT\`），\`DictionaryRef\` 强制渲染为字典下拉框（\`COMBO\`）；严格遵守 **三层界面联动铁律（Query Form <-> Toolbar Action <-> Detail View）** 及前端/领域/流程三类联动边界（前端联动严禁直接篡改领域持久状态）。
10. **Step 10 — External System Adapters & Write-Back（MI 外部系统适配器与安全回写）**：
    按 \`MI\` 契约暴露 \`PROVIDED\` 入站接口并封装 \`DEPENDENT\` 外部网关适配器（含幂等键、超时重试与标准返回码映射），所有分析问策回写操作必须经由 \`MI\` 命令接口留痕审计。

---

## 二、11 元模型结构化实现清单与文件指针

### 1. M1 领域对象与聚合根模型 (\`${MODEL_FILE_NAMES.M1}\`)
${m1Summary}

### 2. M2 领域行为与应用服务模型 (\`${MODEL_FILE_NAMES.M2}\`)
${m2Summary}

### 3. M3 刚性业务规则模型 (\`${MODEL_FILE_NAMES.M3}\`)
${m3Summary}

### 4. ME 领域事件模型 (\`${MODEL_FILE_NAMES.ME}\`)
${meSummary}

### 5. M4 跨聚合事件协同场景模型 (\`${MODEL_FILE_NAMES.M4}\`)
${m4Summary}

### 6. M5 业务主体与权限模型 (\`${MODEL_FILE_NAMES.M5}\`)
${m5Summary}

### 7. M6 业务协同与审批流程模型 (\`${MODEL_FILE_NAMES.M6}\`)
${m6Summary}

### 8. M7 查询统计与报表模型 (\`${MODEL_FILE_NAMES.M7}\`)
${m7Summary}

### 9. MU 用户界面与调用链模型 (\`${MODEL_FILE_NAMES.MU}\`)
${muSummary}

### 10. MM 对象-关系数据表映射模型 (\`${MODEL_FILE_NAMES.MM}\`)
${mmSummary}

### 11. MI 系统边界接口契约模型 (\`${MODEL_FILE_NAMES.MI}\`)
${miSummary}

---

## 三、已打包元模型与索引清单
- \`参考资料/本体模型/manifest.json\`（工作区镜像：\`.onto-cs/model/${project.id}/yaml/manifest.json\`）
${getPresentModelCodes(project)
  .map((code) => `- \`参考资料/本体模型/${MODEL_FILE_NAMES[code]}\` (${code})`)
  .join('\n')}
`;
}

export function buildOntologyModelingReferenceDoc(): string {
  const stageRows = MODEL_STAGE_ORDER.map((item) => {
    const fileName = MODEL_FILE_NAMES[item.code];
    const meta: Record<ModelCode, { prefix: string; upstream: string; downstream: string }> = {
      M1: { prefix: 'AGG- / DICT- / ASSOC-', upstream: 'SRS 领域需求', downstream: 'M2, M3, M5, M6, M7, MU, MM, MI' },
      M5: { prefix: 'ACT- / ROLE- / PERM-', upstream: 'M1', downstream: 'M2, M6, MU' },
      M3: { prefix: 'RULE-', upstream: 'M1', downstream: 'M2, ME, M4, M6, MU' },
      M2: { prefix: 'BHV-', upstream: 'M1, M3, M5', downstream: 'ME, M4, M6, M7, MU, MI' },
      M7: { prefix: 'QRY- / RPT-', upstream: 'M1, M2', downstream: 'MU, MI' },
      ME: { prefix: 'EVT-', upstream: 'M1, M2, M3', downstream: 'M3, M4, M6, MU' },
      M4: { prefix: 'SCN-', upstream: 'M1, M2, M3, ME', downstream: 'M6, MU' },
      M6: { prefix: 'FLOW-', upstream: 'M1, M2, M3, M4, M5, ME', downstream: 'MU' },
      MU: { prefix: 'SCR- / EL- / UIE-', upstream: 'M1, M2, M3, ME, M4, M5, M7', downstream: '前端页面与原型提取' },
      MM: { prefix: 'MAP-', upstream: 'M1', downstream: 'SQLite/D1 DDL 与数据映射' },
      MI: { prefix: 'IF-', upstream: 'M1, M2, M5, M7, ME', downstream: 'REST/MCP 接口与外部回写' },
    };
    const m = meta[item.code];
    return `| Stage ${item.stage} | **${item.code}** (${item.labelZh}) | \`${fileName}\` | \`${m.prefix}\` | ${m.upstream} | ${m.downstream} |`;
  }).join('\n');

  return `# Ontology Plus 11 元模型建模规范 (v5.0)

## 1. 11 元模型依赖矩阵与标准文件命名 (11-Model Dependency Matrix)
所有本体工程元数据统一以 \`manifest.json\` 为相对路径注册入口，禁止硬编码绝对路径或非标文件名。

| 建模阶段 | 元模型代号与名称 | 标准 YAML 文件名 | 标准 ID 前缀 | 上游依赖模型 | 下游消费模型 |
| :--- | :--- | :--- | :--- | :--- | :--- |
${stageRows}

## 2. 权威标识符前缀规范表 (Canonical ID Prefix Table)
| 前缀符号 | 归属模型 | 语义说明 | 示例标识符 |
| :--- | :--- | :--- | :--- |
| \`AGG-\` | \`M1\` | 领域聚合根唯一标识 | \`AGG-01\`, \`AGG-MFT-01\` |
| \`BHV-\` | \`M2\` | 领域命令/查询/事件处理行为标识 | \`BHV-01\`, \`BHV-MFT-01\` |
| \`RULE-\` | \`M3\` | 跨对象校验/计算/状态守卫规则标识 | \`RULE-01\`, \`RULE-MFT-01\` |
| \`EVT-\` | \`ME\` | 过去时态领域事实事件标识 | \`EVT-01\`, \`EVT-MFT-01\` |
| \`SCN-\` | \`M4\` | 跨聚合事件协同场景标识 | \`SCN-01\` |
| \`ACT-\` / \`ROLE-\` / \`PERM-\` | \`M5\` | 参与者、角色与行为/界面权限标识 | \`ACT-01\`, \`ROLE-DEPT-MGR\`, \`PERM-CONTRACT-WRITE\` |
| \`FLOW-\` | \`M6\` | 业务协同流与多级审批流标识 | \`FLOW-01\` |
| \`QRY-\` / \`RPT-\` | \`M7\` | 实时查询与多维统计报表标识 | \`QRY-01\`, \`RPT-02\` |
| \`SCR-\` / \`EL-\` / \`UIE-\` | \`MU\` | 屏幕、界面控件锚点与交互事件标识 | \`SCR-CONTRACT-EDIT\`, \`EL-TOTAL-AMOUNT\`, \`UIE-SAVE-DRAFT\` |
| \`MAP-\` | \`MM\` | 领域对象到关系数据库表映射标识 | \`MAP-CONTRACT-01\` |
| \`IF-\` | \`MI\` | 对外提供或外部依赖边界接口标识 | \`IF-01\`, \`IF-EXT-ESIGN-03\` |

## 3. 双层校验门禁体系指南 (Two-Tier Validation Guide)
1. **Tier 1 — Consistency Error（一致性阻断错误 · 红色门禁）**：
   - **悬空引用阻断**：\`M2.ownerEntity\`、\`M2.invokedRules\`、\`ME.producerBehaviorRef\`、\`M5.permissions\`、\`MU.dataBinding\` 等引用不存在的目标标识符。
   - **M2 <-> M7 严格 1:1 绑定门禁**：每个分析/列表 \`QUERY\` 行为必须与唯一 \`M7\` 查询报表双向互指，严禁多对一或单向悬空。
   - **MU 调用链时序门禁**：交互事件 \`callChain\` 必须严格遵循 \`VALIDATE -> BEHAVIOR_CALL -> EVENT_EMIT -> SCENARIO_CALL -> NAVIGATE\` 顺序。
   - **M6 流程有向图可达性门禁**：流程必须具备有效起点、可达 \`END\` 节点与完备网关默认分支，禁止无等待死循环。
   - **打包与发布硬门禁**：当 \`Consistency Error > 0\` 时，禁止编译导出四层开发资料包。
2. **Tier 2 — Stage Warning（阶段性演进提示 · 琥珀色非阻断）**：
   - 在领域建模早期尚未编写 \`MM\`（物理表映射）或 \`MI\`（外部接口）等后置阶段模型，或存在暂未挂载 UI 事件的储备规则时，仅提示阶段完备度，不阻断增量迭代与技能预览。
`;
}

export function compileDevelopmentPackage(
  input: CompileDevelopmentPackageInput,
): CompiledDevelopmentPackage {
  const { app, project, uiUeAsset, techFoundationAsset, techArchAsset } = input;

  if (project.validation.errorCount > 0) {
    throw new Error(
      `Cannot compile Development Package: project "${project.name}" has ${project.validation.errorCount} consistency error(s).`,
    );
  }

  const compiledAt = new Date().toISOString();
  const workspaceRoot = input.workspaceRoot ?? path.resolve(process.cwd(), '.onto-cs');
  const outputDir = path.join(workspaceRoot, 'packages', app.id);
  const files: CompiledPackageFile[] = [];

  const addFile = (
    relativePath: string,
    category: CompiledPackageFile['category'],
    content: string,
  ) => {
    files.push({
      relativePath,
      category,
      sizeBytes: Buffer.byteLength(content, 'utf-8'),
      content,
    });
  };

  const yamlFiles = serializeSuiteToYamlFiles(project.suite);
  const suiteManifestContent = serializeManifestJson(buildOntologySuiteManifest(project));

  // 1. 开发指导书.md (Progressive Disclosure Root Entry Point)
  addFile(
    '开发指导书.md',
    'GUIDE',
    buildMasterDevelopmentGuide({
      app,
      project,
      uiUeAsset,
      techFoundationAsset,
      techArchAsset,
      compiledAt,
    }),
  );

  // 2. 本体模型业务功能开发指导书.md (All 11 Models + 10-Step Pipeline)
  addFile('本体模型业务功能开发指导书.md', 'GUIDE', buildBusinessOntologyFeatureGuide(project));

  // 3. 参考资料/*
  addFile('参考资料/UI-UE界面设计规范.md', 'REFERENCE', uiUeAsset.specMarkdown);
  addFile('参考资料/本体建模规范.md', 'REFERENCE', buildOntologyModelingReferenceDoc());
  addFile('参考资料/技术架构设计文档.md', 'REFERENCE', techArchAsset.specMarkdown);
  addFile(
    '参考资料/软件需求说明书.md',
    'REFERENCE',
    input.requirementDoc?.content ?? `# ${project.name} 软件需求说明书`,
  );
  addFile(
    '参考资料/界面原型.html',
    'REFERENCE',
    input.prototype?.htmlContent ?? '<!DOCTYPE html><html><body>Prototype</body></html>',
  );

  // 4. 参考资料/本体模型/manifest.json + *.yaml & mirrored .onto-cs/model/${project.id}/yaml/manifest.json
  addFile('参考资料/本体模型/manifest.json', 'MANIFEST', suiteManifestContent);
  addFile(`.onto-cs/model/${project.id}/yaml/manifest.json`, 'MANIFEST', suiteManifestContent);
  for (const [, info] of Object.entries(yamlFiles)) {
    if (!info) continue;
    addFile(`参考资料/本体模型/${info.fileName}`, 'ONTOLOGY_YAML', info.content);
  }

  // 5. 技术底座 & 应用源码
  addFile('技术底座/README.md', 'FOUNDATION', techFoundationAsset.specMarkdown);
  addFile(
    '应用源码/README.md',
    'SOURCE',
    `# ${app.name} — 应用源码工作区\n\n请基于根目录《开发指导书.md》与《本体模型业务功能开发指导书.md》在此目录生成并验证业务源码。`,
  );

  // 6. 开发资料清单.json
  const presentModels = getPresentModelCodes(project);
  const manifestJson = {
    packageVersion: '5.0.0',
    appId: app.id,
    appName: app.name,
    projectId: project.id,
    domain: project.domain,
    compiledAt,
    layers: {
      ontology: { projectId: project.id, presentModels },
      uiUe: { id: uiUeAsset.id, name: uiUeAsset.name, version: uiUeAsset.version },
      techFoundation: {
        id: techFoundationAsset.id,
        name: techFoundationAsset.name,
        version: techFoundationAsset.version,
      },
      techArch: { id: techArchAsset.id, name: techArchAsset.name, version: techArchAsset.version },
    },
    files: files.map((f) => ({
      path: f.relativePath,
      category: f.category,
      sizeBytes: f.sizeBytes,
    })),
  };
  addFile('开发资料清单.json', 'MANIFEST', JSON.stringify(manifestJson, null, 2));

  if (input.writeToDisk !== false) {
    try {
      for (const file of files) {
        const fullPath = path.join(outputDir, file.relativePath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, file.content, 'utf-8');
      }
    } catch {
      // Non-fatal in read-only edge environments
    }
  }

  return {
    appId: app.id,
    appName: app.name,
    projectId: project.id,
    outputDir,
    compiledAt,
    files,
    manifestJson,
  };
}

export function compileOntologySkill(project: ProjectDetail): GeneratedSkill {
  const slug = `${project.code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-ontology-skill`;
  const presentCodes = getPresentModelCodes(project);

  const aggList = (project.suite.M1?.aggregates ?? [])
    .map(
      (a) =>
        `- \`${a.name}\` (${a.alias} · \`${a.id}\` · 状态机 \`[${a.lifecycle.join(' -> ')}]\`): ${a.description ?? ''}`,
    )
    .join('\n');
  const behList = (project.suite.M2?.behaviors ?? [])
    .map(
      (b) =>
        `- \`${b.name}\` (\`${b.id}\` · ${b.alias}): [${b.behaviorType}] 归属 \`${b.ownerEntity}\`，关联规则 \`[${b.invokedRules.join(', ')}]\``,
    )
    .join('\n');
  const ruleList = (project.suite.M3?.rules ?? [])
    .map((r) => `- \`${r.id}\` (${r.alias} · \`${r.ruleType}\`): \`${r.expression}\` -> ${r.violationMessage ?? ''}`)
    .join('\n');

  const modelPointerLines = [
    `- **MANIFEST**: \`.onto-cs/model/${project.id}/yaml/manifest.json\``,
    ...presentCodes.map(
      (code) => `- **${code}**: \`.onto-cs/model/${project.id}/yaml/${MODEL_FILE_NAMES[code]}\``,
    ),
  ].join('\n');

  const skillMarkdown = `---
name: ${slug}
description: ${project.name}（${project.domain}）业务本体技能包。当智能体需要查询或执行“${project.domain}”领域的对象、业务行为、合规规则或报表统计时调用。
---

# ${project.name} — 渐进式披露业务本体技能 (SKILL.md)

## 1. 渐进式执行工作流 (Progressive Disclosure Workflow)
1. **读取总控清单**：首先读取 \`.onto-cs/model/${project.id}/yaml/manifest.json\` 确认当前工程已就绪的元模型集合，禁止假设未列出的元模型文件存在。
2. **核验对象与不变量门禁**：按需查阅 \`M1\` 聚合根属性、状态机与 \`M3\` 刚性规则，在任何写操作前优先验证前置条件与业务规则门禁。
3. **映射领域行为与审批流**：按需查阅 \`M2\` 命令/查询契约、\`ME\`/\`M4\` 事件协同链及 \`M5\`/\`M6\` 权限与多级审批门禁（严格区分 \`DRAFT\` 暂存与 \`SUBMIT\` 提交审批）。
4. **绑定屏幕契约与边界持久化**：涉及界面调整、落库或外部联调时，按需查阅 \`MU\` 语义锚点（\`data-screen-id\` / \`data-binding\` / \`data-event-id\`）、\`MM\` 物理表映射（含 5 个审计列）及 \`MI\` 接口规范。

## 2. 领域聚合根索引 (M1 Object Model)
${aggList || '- 暂无聚合根'}

## 3. 领域行为与 MCP 工具契约 (M2 Behavior Model)
${behList || '- 暂无行为'}

## 4. 刚性业务规则门禁 (M3 Rule Model)
${ruleList || '- 暂无规则'}

## 5. 渐进式模型文件指针 (Progressive Disclosure Pointers)
${modelPointerLines}

## 6. 完成度核查门禁 (Checkable Completion Criteria)
- [ ] 所有引用路径与 \`.onto-cs/model/${project.id}/yaml/manifest.json\` 中的标准文件名 100% 一致
- [ ] 执行任意 \`M2\` 命令前已完成关联 \`M3\` 规则求值且 \`Consistency Error === 0\`
- [ ] 查询统计严格遵循 \`M2 <-> M7\` 1:1 读写分离契约，不绕过规则直接修改持久化状态
`;

  return {
    id: `skill-${project.id}`,
    projectId: project.id,
    name: `${project.name}业务本体技能 (${slug})`,
    slug,
    version: '5.0.0',
    description: `自动从工程「${project.name}」的 ${presentCodes.length} 个本体模型编译生成的 Agent 技能包。`,
    skillMarkdown,
    updatedAt: new Date().toISOString(),
  };
}
