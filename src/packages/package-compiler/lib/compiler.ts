import fs from 'node:fs';
import path from 'node:path';
import {
  serializeSuiteToYamlFiles,
  type ModelCode,
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

export function compileDevelopmentPackage(input: {
  app: AssembledApplication;
  project: ProjectDetail;
  uiUeAsset: FourLayerAsset;
  techFoundationAsset: FourLayerAsset;
  techArchAsset: FourLayerAsset;
  requirementDoc?: RequirementDoc;
  prototype?: PrototypeArtifact;
  workspaceRoot?: string;
  writeToDisk?: boolean;
}): CompiledDevelopmentPackage {
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
  const yamlFileList = Object.entries(yamlFiles).map(
    ([code, info]) => `- \`参考资料/本体模型/${info!.fileName}\` (${code})`,
  );

  // 1. 开发指导书.md (Progressive Disclosure Root Entry Point)
  const devGuideMd = `# 开发指导书 — ${app.name}

> **生成时间**：\`${compiledAt}\`
> **所属本体工程**：\`${project.name} (${project.code})\`
> **一致性门禁状态**：✅ 通过（0 Consistency Errors · ${project.validation.presentModels.length}/11 模型就绪）

## 1. 工程定位与四层架构装配件
本开发资料包由 **Ontology Plus** 平台自动编译生成，采用 **渐进式披露（Progressive Disclosure）** 组织结构。编码智能体（Coding Agent）应首先阅读本文件建立全局上下文，再按需查阅子目录文件。

| 架构层级 | 选用资产名称 | 版本 | 对应规范路径 |
| :--- | :--- | :--- | :--- |
| **业务本体层** | ${project.name} | v5.0 | \`本体模型业务功能开发指导书.md\` + \`参考资料/本体模型/*.yaml\` |
| **UI/UE 原型层** | ${uiUeAsset.name} | ${uiUeAsset.version} | \`参考资料/UI-UE界面设计规范.md\` + \`参考资料/界面原型.html\` |
| **技术底座层** | ${techFoundationAsset.name} | ${techFoundationAsset.version} | \`技术底座/README.md\` |
| **技术架构层** | ${techArchAsset.name} | ${techArchAsset.version} | \`参考资料/技术架构设计文档.md\` |

## 2. 按需上下文指针 (Context Pointers)
- 实现领域聚合根、值对象与数据表持久化前，必须阅读：
  - \`参考资料/本体模型/m1-object-model.yaml\`
  - \`参考资料/本体模型/m-mapping-model.yaml\`
- 实现应用服务命令、前置规则与事件发布前，必须阅读：
  - \`参考资料/本体模型/m2-behavior-model.yaml\`
  - \`参考资料/本体模型/m3-rule-model.yaml\`
  - \`参考资料/本体模型/me-event-model.yaml\`
  - \`参考资料/本体模型/m4-scenario-model.yaml\`
- 实现工作流编排、角色权限与复杂报表前，必须阅读：
  - \`参考资料/本体模型/m5-actor-model.yaml\`
  - \`参考资料/本体模型/m6-flow-model.yaml\`
  - \`参考资料/本体模型/m7-report-model.yaml\`
- 实现前端页面、控件数据绑定与 REST 接口前，必须阅读：
  - \`参考资料/本体模型/mu-ui-model.yaml\`
  - \`参考资料/本体模型/mi-interface-model.yaml\`
  - \`参考资料/界面原型.html\`

## 3. 可核查交付完成标准 (Completion Criteria)
- [ ] **M1 & MM 零漂移**：所有聚合根（${(project.suite.M1?.aggregates ?? []).map((a) => `\`${a.name}\``).join('、')}）的属性、不变量与物理表字段 100% 对应。
- [ ] **M2 & M3 规则强门禁**：所有行为（${(project.suite.M2?.behaviors ?? []).map((b) => `\`${b.id}:${b.name}\``).join('、')}）在执行状态变更前必须强制执行关联的 \`invokedRules\`。
- [ ] **M7 双向契约**：所有查询与统计报表严格执行 \`referenceSql\` 参数绑定。
- [ ] **MU 界面调用链**：所有前端交互按钮严格按照 \`VALIDATE -> BEHAVIOR_CALL -> EVENT_EMIT\` 顺序触发。
`;
  addFile('开发指导书.md', 'GUIDE', devGuideMd);

  // 2. 本体模型业务功能开发指导书.md
  const aggregatesSection = (project.suite.M1?.aggregates ?? [])
    .map(
      (agg) =>
        `### 聚合根 \`${agg.name}\` (${agg.alias} · \`${agg.id}\`)\n- **生命周期状态**：\`${agg.lifecycle.join(' -> ')}\`\n- **核心属性**：${agg.attributes.map((a) => `\`${a.name}\`(${a.label}:${a.type})`).join(', ')}\n- **子实体**：${agg.entities.map((e) => `\`${e.name}\`(${e.alias})`).join(', ') || '无'}\n- **聚合不变量**：${agg.invariants.map((inv) => `\`${inv.name}\`: \`${inv.expression}\``).join('; ') || '无'}`,
    )
    .join('\n\n');

  const behaviorsSection = (project.suite.M2?.behaviors ?? [])
    .map(
      (b) =>
        `- **\`${b.id}\` ${b.name} (${b.alias})**：归属 \`${b.ownerEntity}\`，类型 \`${b.behaviorType}\`，调用规则 \`[${b.invokedRules.join(', ')}]\`，产生事件 \`[${b.producedEvents.map((e) => (typeof e === 'string' ? e : e.eventRef)).join(', ')}]\``,
    )
    .join('\n');

  const ontologyFuncGuideMd = `# 本体模型业务功能开发指导书 — ${project.domain}

## 1. M1 领域对象与聚合根实现清单
${aggregatesSection}

## 2. M2 领域行为与应用服务实现清单
${behaviorsSection}

## 3. M3 业务规则引擎清单
${(project.suite.M3?.rules ?? []).map((r) => `- **\`${r.id}\` ${r.alias} (\`${r.name}\`)**：表达式 \`${r.expression}\` — 违背提示：「${r.violationMessage}」`).join('\n')}

## 4. MU 屏幕与调用链实现清单
${(project.suite.MU?.screens ?? []).map((s) => `- **\`${s.screenId}\` ${s.name}** (\`${s.route}\`)：包含 ${s.elements.length} 个控件、${s.events.length} 个交互事件`).join('\n')}

## 5. 本体模型文件索引
${yamlFileList.join('\n')}
`;
  addFile('本体模型业务功能开发指导书.md', 'GUIDE', ontologyFuncGuideMd);

  // 3. 参考资料/*
  addFile('参考资料/UI-UE界面设计规范.md', 'REFERENCE', uiUeAsset.specMarkdown);
  addFile(
    '参考资料/本体建模规范.md',
    'REFERENCE',
    `# Ontology Plus 11 元模型建模规范 (v5.0)\n\n包含 M1 对象、M2 行为、M3 规则、ME 事件、M4 场景、M5 主体、M6 流程、M7 报表、MU 界面、MM 映射、MI 接口共 11 个强类型 YAML 元模型。`,
  );
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

  // 4. 参考资料/本体模型/*.yaml
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
  const manifestJson = {
    packageVersion: '5.0.0',
    appId: app.id,
    appName: app.name,
    projectId: project.id,
    domain: project.domain,
    compiledAt,
    layers: {
      ontology: { projectId: project.id, presentModels: project.validation.presentModels },
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
  const aggList = (project.suite.M1?.aggregates ?? [])
    .map((a) => `- \`${a.name}\` (${a.alias} · \`${a.id}\`): ${a.description ?? ''}`)
    .join('\n');
  const behList = (project.suite.M2?.behaviors ?? [])
    .map(
      (b) =>
        `- \`${b.name}\` (\`${b.id}\` · ${b.alias}): [${b.behaviorType}] 归属 \`${b.ownerEntity}\`，关联规则 \`[${b.invokedRules.join(', ')}]\``,
    )
    .join('\n');
  const ruleList = (project.suite.M3?.rules ?? [])
    .map((r) => `- \`${r.id}\` (${r.alias}): \`${r.expression}\` -> ${r.violationMessage}`)
    .join('\n');

  const skillMarkdown = `---
name: ${slug}
description: ${project.name}（${project.domain}）业务本体技能包。当智能体需要查询或执行“${project.domain}”领域的对象、业务行为、合规规则或报表统计时调用。
---

# ${project.name} — 渐进式披露业务本体技能 (SKILL.md)

## 1. 领域聚合根索引 (M1 Object Model)
${aggList || '- 暂无聚合根'}

## 2. 领域行为与 MCP 工具契约 (M2 Behavior Model)
${behList || '- 暂无行为'}

## 3. 刚性业务规则门禁 (M3 Rule Model)
${ruleList || '- 暂无规则'}

## 4. 渐进式模型文件指针 (Progressive Disclosure Pointers)
${(project.validation.presentModels as ModelCode[])
  .map((code) => `- **${code}**: \`.onto-cs/model/${project.id}/yaml/${code.toLowerCase()}.yaml\``)
  .join('\n')}
`;

  return {
    id: `skill-${project.id}`,
    projectId: project.id,
    name: `${project.name}业务本体技能 (${slug})`,
    slug,
    version: '5.0.0',
    description: `自动从工程「${project.name}」的 ${project.validation.presentModels.length} 个本体模型编译生成的 Agent 技能包。`,
    skillMarkdown,
    updatedAt: new Date().toISOString(),
  };
}

