<div align="center">

# 🧬 ontology-plus

**本体驱动的软件建模、应用组装、能力萃取与数据推理工作台。**

用日常业务语言描述你想做的系统，与同一个 **AI 助手** 协作走完四个**项目步骤**，从唯一事实来源派生交互原型、经过校验的 **11 模型本体套件**、不可变**开发资料包**、**MCP 服务**与**本体技能**。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)
[![Hono](https://img.shields.io/badge/Hono-4-E36002?style=flat-square&logo=hono&logoColor=white)](https://hono.dev/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20D1-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![SQLite](https://img.shields.io/badge/SQLite-003548?style=flat-square&logo=sqlite&logoColor=white)](https://sqlite.org/)
[![Drizzle](https://img.shields.io/badge/Drizzle_ORM-C5F74F?style=flat-square&logo=drizzle&logoColor=black)](https://orm.drizzle.team/)
[![pnpm](https://img.shields.io/badge/pnpm-F69220?style=flat-square&logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Vitest](https://img.shields.io/badge/Vitest-3-6E9F18?style=flat-square&logo=vitest&logoColor=white)](https://vitest.dev/)
[![Playwright](https://img.shields.io/badge/Playwright-E2E-2EAD33?style=flat-square&logo=playwright&logoColor=white)](https://playwright.dev/)

**[English](README.md)** · **[简体中文](README.zh-CN.md)**

</div>

---

## ✨ 这是什么？

**ontology-plus** 让懂业务的人用对话把系统设计出来，把业务领域沉淀为结构化的本体模型，并让下游产物全部从这一唯一事实来源**派生**：

- 🖥 **面向业务人员的「对话 + 画布」工作台**：从**首页**一句话开始创建项目，左侧与唯一的 **AI 助手**对话，右侧画布按四个**步骤**（**需求**、**原型**、**业务模型**、**交付**）展示成果。画布默认采用零代码的**业务视图**，专家能力（结构化表单、YAML/OWL 模型文件、知识图谱、四层架构规范）作为**技术细节**按需展开。
- 🧠 **一套 11 模型本体套件**（`M1`–`M7`、`ME`、`MU`、`MM`、`MI`）：以类型化 AST 承载、两级校验把关（`需要修正的问题` vs. `尚未完成的部分`），并支持以**业务对象**为中心的无损投影。
- 🛡 **可追责的 AI 改动**：每次产生改动的运行与手动保存都会写入服务端持久化的线性**成果历史**，自动对比生成业务语言的**变更说明**，支持最近一次改动**一键撤销**、更早节点**追加式恢复**、显式**步骤确认**，以及逐级传递且绝不静默改写下游成果的**待更新**机制。
- 📦 **规格优先的交付与编译产物**：从已确认的业务模型与四层装配导出不可变的**开发资料包快照**（含 `AGENTS.md`、架构/实施/验收指南、随仓工程规范及原型与本体引用）、**本体 MCP 服务**与渐进式披露的**本体技能**（`SKILL.md`）。
- 🗄 **SQLite 无处不在**：基于 `drizzle-orm/sqlite-core` 共用同一套方言，横跨本地 SQLite、Cloudflare D1 与 Durable Object SQLite。

## 🧬 本体套件 —— 11 个模型，唯一事实来源

| 编号 | 模型 | 业务视图名称 | 回答的问题 | 要点 |
|------|------|-------------|-----------|------|
| `M1` | **对象模型** | 业务对象 (`Business Objects`) | 存在什么 | 聚合根、内部实体、值对象、数据字典、属性约束与不变量 |
| `M2` | **行为模型** | 业务操作 (`Actions`) | 对象如何行动 | 原子命令、查询、事件处理、外部调用及前后置条件 |
| `M3` | **规则模型** | 业务规则 (`Business Rules`) | 决策为何成立 | 跨聚合、事件驱动、可复用的无副作用业务规则 |
| `ME` | **事件模型** | 业务事件 (`Business Events`) | 发生了什么 | 过去式业务事实、单一生产者行为、载荷与下游订阅者 |
| `M4` | **场景模型** | 自动联动 (`Automations`) | 如何自动协同 | 事件解耦的跨对象反应式调用链 |
| `M5` | **主体模型** | 角色与权限 (`Roles & Permissions`) | 谁能做什么 | 内部角色、外部系统及对业务操作和界面元素的授权绑定 |
| `M6` | **流程模型** | 流程与审批 (`Flows & Approvals`) | 工作如何流转 | 端到端业务协同流与人工审批流、网关条件 |
| `M7` | **查询统计与报表模型** | 查询与报表 (`Queries & Reports`) | 如何读取与统计 | 跨对象查询、统计聚合、固定报表及可验证参考 SQL |
| `MU` | **UI 模型** | 界面 (`Screens`) | 用户看到什么 | 语义锚点界面、数据绑定元素、页面跳转与事件调用链 |
| `MM` | **映射模型** | 数据存储 (`Data Storage`) | 如何持久化 | 聚合/实体→物理表、属性→列字段映射 |
| `MI` | **接口模型** | 对外接口 (`Integrations`) | 边界内外契约 | 系统对外提供与依赖的外部接口契约 |

每一次本体变更——无论来自业务视图直接改名、技术细节表单/YAML 编辑器，还是 `AI 助手` 工具调用——都必须经过 `ontology-core` 的类型化 AST 与**两级校验器**：硬性「一致性错误」（业务视图称**需要修正的问题**）阻止确认业务模型与导出快照；软性「阶段缺失警告」（业务视图称**尚未完成的部分**）允许渐进式建模。

## 🏛 架构

```text
                    ┌──────────────────────────────────────────────────────┐
                    │                     浏览器工作台                      │
                    │    首页 · 四步骤工作区（左对话 + 右业务视图/技术细节）   │
                    │  React 19 · Base UI / shadcn · 知识图谱 · 双语 i18n   │
                    └──────────────────────────┬───────────────────────────┘
                                               │ SSE（流式）/ REST
                    ┌──────────────────────────▼───────────────────────────┐
                    │               Hono API（Workers / Node）              │
                    ├──────────────────┬───────────────────┬───────────────┤
                    │  agent-runtime   │ package-compiler  │ workspace-    │
                    │  7 类专职智能体    │ 开发包、MCP 服务   │ store、步骤   │
                    │  pi-durable 引擎 │ 与 SKILL.md 产物  │ 确认与历史撤销 │
                    └──────────────────┴─────────┬─────────┴───────────────┘
                                                 │ drizzle-orm/sqlite-core
                        ┌────────────────────────┼────────────────────────┐
                        ▼                        ▼                        ▼
                   本地 SQLite             Cloudflare D1       Durable Object SQLite
                         ───── 共享 ontology-core 与 business-vocabulary ─────
```

## 📦 深模块

`src/packages/` 下的每个包都是**深模块**：唯一公开入口（`index.ts`）、私有的 `lib/`、就近的 `tests/` —— 由 `dependency-cruiser` 强制执行（`pnpm lint:boundaries`），零循环依赖。

| 包 | 职责 |
|----|------|
| `ontology-core` | 11 模型类型化 AST、两级校验器（`Consistency Error` vs. `Stage Warning`）、以业务对象为中心的投影，以及整套本体/UI 模型类型化差异计算 |
| `workspace-store` | SQLite 全环境持久化：项目、智能体会话、步骤确认记录、线性成果历史（一键撤销与追加式恢复）及不可变开发包快照 |
| `agent-runtime` | 基于 `pi-durable` 的持久多轮智能体会话：SSE 流式输出、思考轨迹、校验自修复工具执行、步骤转交、单问题可点选提问卡片、fork 与 compact |
| `architecture-assets` | 随仓维护的四层架构资产与技术方案（`Technology Profile`）目录 |
| `package-compiler` | 将已确认的业务模型与四层应用装配编译为不可变开发资料包、本体 MCP 服务与渐进式披露的本体技能（`SKILL.md`） |
| `workbench-theme` | 带版本号的工作台主题契约、内置「默认」与「暖纸」两套主题（浅色 + 深色）、样式与契约文档生成器，以及完整性/对比度/源码守卫 |
| `business-vocabulary` | `GLOSSARY.md` 规范术语/模型代号与中英业务名称的 1 对 1 唯一映射、运行进度业务文案，以及业务视图词汇自动守卫 |

## 🖥 工作台结构

| 区域 | 内容 |
|------|------|
| **首页（`overview`）** | 一句话创建项目（“你想做一个什么样的系统？”）、首次使用时的三个可点选示例描述，以及展示各项目当前步骤与状态的项目列表 |
| **1. 需求** | AI 助手单问题可点选卡片提问（回答后自动收起为一行摘要）、实时成形的需求文档章节、章节修改对比与「确认需求文档」 |
| **2. 原型** | 视觉参考（主参考 + 借鉴参考）、设计简报、风格样张、动态示意、可运行交互原型画布、确认前界面变化清单弹窗，以及确认后同步 `MU` |
| **3. 业务模型** | 按业务对象浏览（默认展开字段、业务操作、业务规则、谁能做；按需展开业务事件、自动联动、界面、对外接口、数据存储）、三个跨对象视图（流程与审批、角色与权限、查询与报表）、从当前对象一键打开技术细节（11 模型编辑器、模型文件、知识图谱）定位同一元素，以及零问题时「确认业务模型」 |
| **4. 交付** | 就绪检查、不可变开发资料包快照生成与下载、本体技能、已发布版本、可运行系统终点槽位（如实告知“蓝图已就绪，可交付开发”），以及四层装配与架构规范的技术细节 |
| **顶栏「更多」菜单** | 收纳三个次级专业区域：**能力中心**（系统配置、本体萃取、MCP 配置、智能体与对话、跨系统流程协同、知识中心）、**数据分析中心**（数据资源、数据映射、指标与报告、本体推理、回写接口）与**平台治理**（大模型中心、系统设置） |

配色、字体、圆角、阴影和纹理完全由当前**工作台主题**（ADR 0015）契约驱动：内置 Attio 式中性**默认**主题与 ADR 0006 的 `spatial-sync` **暖纸**主题，每套均支持浅色、深色与跟随系统，按设备独立保存。桌面优先（`1280px` 及以上左对话右画布并排；窄屏平板宽度切换显示对话与画布），全站中英双语（`zh-CN` / `en-US`），零阻断式浏览器弹窗。

## 🤖 单一 AI 助手与可追责改动

用户在界面上始终只面对一个 **AI 助手**；背后由 7 种专职 `AgentSessionKind` 按当前步骤或区域提供专属工具与独立会话（ADR 0009）：

- **四步骤与技术细节**：需求 → `REQUIREMENT`；原型 → `PROTOTYPE_CO_DESIGN`（与每个界面原型 1 对 1 绑定）；业务模型与首页 → `COPILOT`；交付 → `CODING`；交付技术细节（四层架构规范）→ `ARCHITECTURE`。
- **次级区域**：能力中心 → `CAPABILITY`；数据分析中心推理 → `REASONING`。
- **步骤转交（`Step Hand-off`）**：跨步骤请求会渲染为可接受或拒绝的转交卡片，绝不跨会话静默改写。
- **计算得出的变更说明与持久化撤销**：每次产生改动的运行结束时，按前后状态差异自动渲染业务名称清单（支持点击定位画布对象、最近一次改动一键撤销、在历史抽屉中恢复到更早某次改动之前且不丢后续工作）。
- **清晰的平台诊断提示**：当 AI 服务未配置或不可达时，业务视图提示「AI 服务暂不可用，请联系为你部署的人」并提供「前往平台设置」链接与折叠诊断详情，绝不在非 Mock 模式下用模板结果冒充助手输出（ADR 0007、ADR 0016）。

## 🚀 快速开始

```bash
# 前置要求：Node.js 20+，pnpm 9+
pnpm install

# 开发：API + Web 热更新
pnpm dev

# 仅 Web / 仅 API
pnpm dev:web
pnpm dev:server

# 生产构建（类型检查 + vite build）并在 http://127.0.0.1:4310 启动
pnpm build
pnpm start

# 可选：以空工作区启动首次使用首页（展示 3 个可点选示例、无预置项目，适合真人走查）
ONTOLOGY_WORKSPACE_ROOT=/tmp/onto-fresh ONTOLOGY_SEED_PROJECTS=0 pnpm start
```

### 部署到 Cloudflare

```bash
pnpm build
wrangler deploy        # 使用 wrangler.jsonc：Workers + 静态资源 + D1 绑定
```

## 🧪 质量门禁

| 命令 | 作用 |
|------|------|
| `pnpm check` | TypeScript 类型检查 + 深模块边界检查（`lint:boundaries`）+ 工作台主题契约守卫（`lint:theme`） |
| `pnpm test` | 全部包、服务端接口与前端视图的 Vitest 单元及集成测试 |
| `pnpm test:e2e` | Playwright 浏览器端到端测试（完整业务旅程、主题切换、历史撤销与工作台回归） |
| `pnpm themes:generate` | 从 `workbench-theme` 重新生成 `docs/workbench-theme-contract.md` 与内置主题样式表 |

## 🗂 项目结构

```text
src/
  packages/                 # 7 个深模块（由 pnpm lint:boundaries 强制守护）
    ontology-core/
    workspace-store/
    agent-runtime/
    architecture-assets/
    package-compiler/
    workbench-theme/
    business-vocabulary/
  server/                   # Hono 应用：REST + SSE，Workers 与 Node 双入口
  web/                      # React 工作台：外壳、四步骤画布、组件与主题契约令牌
docs/
  adr/                      # 架构决策记录（0001–0016）
  walkthrough/              # 真人业务用户走查脚本与逐屏自查截图
  workbench-theme-contract.md
  Ontology-Modeling-Framework/
GLOSSARY.md                 # 领域规范词汇表与业务界面名称映射
e2e/                        # Playwright 端到端用例
```

## 📚 文档

- **[框架规范](docs/Ontology-Modeling-Framework/ontology-plus-framework.md)** —— 完整的 11 模型本体建模方法论。
- **[词汇表](GLOSSARY.md)** —— 规范领域术语、禁用词与 1 对 1 业务界面名称（`Shown to business users as`）。
- **[工作台主题契约](docs/workbench-theme-contract.md)** —— 自动生成的语义 token 契约说明（v1）。
- **[真人走查脚本](docs/walkthrough/WALKTHROUGH.md)** —— 在真实应用上交由不懂技术的业务人员走查的主持脚本与记录表。
- **[ADR](docs/adr/)** —— 关键架构决策（`0001`–`0016`）：
  1. TypeScript 深模块 Monorepo
  2. 两级渐进式模型校验
  3. SQLite 无处不在，统一存储接缝
  4. 渐进式披露的智能体产物
  5. AST 为唯一事实来源 + 语义化原型锚点
  6. `spatial-sync` 设计体系与双语 i18n
  7. 持久流式智能体会话与显式 Mock 边界
  8. 派生知识图谱与双向 Markdown
  9. 每一次智能体动作都是单一面板内的一次运行（已修订支持单一 `AI 助手` 与 7 类专职映射）
  10. 原型修订仅在确认时同步 UI 模型
  11. 规格优先的应用交付
  12. 随仓维护的架构规范
  13. 不可变的开发资料包快照
  14. 工作台为业务人员设计：对话加画布
  15. 由带版本号 token 契约驱动的工作台主题
  16. 可追责的助手改动：计算的变更说明、运行级撤销与步骤确认

## 🙏 参考资料

建模方法论借鉴了以下本体驱动开发的先行探索：
[Onto-Model](https://github.com/sharptoolbox/Onto-Model) · [ontology-driven-dev](https://github.com/sharptoolbox/ontology-driven-dev) · [WorkBuddy-AppBuilderSkill](https://github.com/sharptoolbox/WorkBuddy-AppBuilderSkill) · [LLM-knowledgeBase](https://github.com/sharptoolbox/LLM-knowledgeBase)

---

<div align="center">

*建模领域本体，派生其余一切。*

</div>
