<div align="center">

# 🧬 ontology-plus

**本体驱动的软件建模、应用组装、能力沉淀与数据推理工作台。**

将业务领域建模为一套 **11 模型本体套件** —— 浏览器工作台、流式智能体会话、编译产物 MCP 服务与 Skill 全部共享同一事实来源。

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

**ontology-plus** 是一个以「本体」为核心的工作台：先把业务领域建模成结构化的本体模型，再让下游的一切都从这个唯一事实来源**派生**出来：

- 🧠 **一套 11 模型本体套件**（`M1`–`M7`、`ME`、`MU`、`MM`、`MI`），以类型化代码承载、两级校验把关，被所有环境共享。
- 🖥 **浏览器工作台**：编辑模型、组装应用、沉淀能力、推理数据。
- 🤖 **流式智能体会话**：五个领域智能体（需求探索、本体 Copilot、应用编码、能力对话、数据推理）通过经过校验的工具调用读取并**变更**本体。
- 📦 **编译器**：把本体编译为开发指导包、MCP 服务和智能体 `SKILL.md` 产物。
- 🗄 **SQLite 无处不在**：通过 `drizzle-orm` 使用同一套 Schema，横跨本地 SQLite、Cloudflare D1 与 Durable Object SQLite。

## 🧬 本体套件 —— 11 个模型，唯一事实来源

| 编号 | 模型 | 回答的问题 | 要点 |
|------|------|-----------|------|
| `M1` | **对象模型** | 存在什么 | 实体、属性、双向关联、参照完整性 |
| `M2` | **行为模型** | 对象如何行动 | 原子行为、触发条件、前后置约束 |
| `M3` | **规则模型** | 决策为何成立 | 跨对象、事件驱动、可复用业务规则 |
| `ME` | **事件模型** | 发生了什么 | 业务事件、生产者、订阅者、事件链路 |
| `M4` | **场景模型** | 如何协同 | 事件解耦的跨对象协同场景 |
| `M5` | **主体模型** | 谁在做什么 | 参与者、角色、权限边界 |
| `M6` | **流程模型** | 工作如何流转 | 端到端协同流与审批流、网关条件 |
| `M7` | **查询统计与报表模型** | 如何读取 | 跨对象查询、统计分析、固定报表 |
| `MU` | **UI 模型** | 用户看到什么 | 屏幕、元素、导航、UI 事件调用链 |
| `MM` | **映射模型** | 如何持久化 | 对象→表、属性→字段映射 |
| `MI` | **接口模型** | 边界内外契约 | 系统对外提供与依赖的外部接口 |

每一次本体变更——无论来自结构化表单编辑器、YAML 编辑器，还是 AI 工具调用——都必须经过 `ontology-core` 的类型化 AST 与**两级校验器**：硬性「一致性错误」直接阻断，软性「阶段警告」允许渐进式建模。

## 🏛 架构

```text
                    ┌──────────────────────────────────────────────┐
                    │                浏览器工作台                   │
                    │   React 19 · TanStack Router/Query · Vite    │
                    │  知识图谱 · Tiptap Markdown · 双语 i18n       │
                    └───────────────┬──────────────────────────────┘
                                    │ SSE（流式）/ REST
                    ┌───────────────▼──────────────────────────────┐
                    │           Hono API（Workers / Node）          │
                    ├──────────────────────────────────────────────┤
                    │ agent-runtime │ package-compiler │ workspace- │
                    │ pi-durable    │ MCP + SKILL.md    │ store     │
                    │ 持久会话       │ 编译产物           │ 快照撤销  │
                    └───────────────┬──────────────────────────────┘
                                    │ drizzle-orm/sqlite-core
              ┌─────────────────────┼──────────────────────────┐
              ▼                     ▼                          ▼
         本地 SQLite            Cloudflare D1         Durable Object SQLite
                    ───── 全部共享 ontology-core AST ─────
```

## 📦 深模块

`src/packages/` 下的每个包都是**深模块**：唯一公开入口、私有的 `lib/`、就近的 `tests/` —— 由 `dependency-cruiser` 强制执行（`pnpm lint:boundaries`），零循环依赖。

| 包 | 职责 |
|----|------|
| `ontology-core` | 11 模型类型化 AST + 两级校验器（`Error` vs `Warning`）—— 唯一事实来源 |
| `agent-runtime` | 基于 `pi-durable` 的持久多轮智能体会话：SSE 流式输出、思考轨迹、多步工具执行与校验器自我修复、作用域受限的 HITL `ask_user`、fork 与 compact |
| `package-compiler` | 将本体编译为开发包、MCP 服务，以及渐进式披露的智能体产物（`SKILL.md`、开发指导书） |
| `workspace-store` | SQLite 无处不在的持久化：工程、会话、快照与撤销 —— Node / D1 / DO 共用一套方言 |

## 🖥 工作台

| 区域 | 页面 |
|------|------|
| **总览** | 工作台仪表盘与 LLM 中心（模型接入配置与诊断） |
| **本体** | 结构化表单 + YAML 双编辑器、12 阶段建模序列、知识图谱画布（`elkjs` 泳道布线、`d3-force` 邻域子图） |
| **能力中心** | 系统、智能体、MCP 工具、能力知识、能力抽取、跨流程分析 |
| **数据中心** | 数据资源、对象↔表映射、指标与报表、数据推理对话、数据回写 |
| **应用中心** | 需求探索（智能体驱动）、SRS 文档、应用组装、四层架构资产、发布、技能 |

视觉遵循 **`spatial-sync`** 令牌体系（暖纸浅色 / 胶片颗粒深色），全站双语（`zh-CN` / `en-US`），零阻断式浏览器弹窗。

## 🤖 智能体会话

五个领域智能体均以持久多轮会话运行，实时流式输出增量、思考轨迹与可见的多步工具执行。核心特性：

- **校验器在环** —— 变更本体的工具调用在同一轮完成校验；错误信息回喂给智能体进行自我修复。
- **默认自主执行** —— 工具调用不做权限审批门禁，由校验器与工作区撤销快照兜底；交互卡片严格保留给「补齐缺失的用户输入」，而非审批。
- **拒绝静默降级** —— 未配置 LLM 网关时，界面给出可操作的接入诊断指引，而不是悄悄回退到模板；确定性 mock 只存在于测试/演示开关之后。

详见 [ADR 0007](docs/adr/0007-pi-durable-streaming-and-explicit-mock-boundary.md)。

## 🚀 快速开始

```bash
# 前置要求：Node.js 20+，pnpm 9+
pnpm install

# 开发：API + Web 热更新
pnpm dev

# 仅 Web / 仅 API
pnpm dev:web
pnpm dev:server

# 生产构建（类型检查 + vite build）
pnpm build
pnpm start
```

### 部署到 Cloudflare

```bash
pnpm build
wrangler deploy        # 使用 wrangler.jsonc：Workers + 静态资源 + D1 绑定
```

## 🧪 质量门禁

| 命令 | 作用 |
|------|------|
| `pnpm check` | TypeScript 类型检查 + 深模块边界检查（入口规则、无环） |
| `pnpm test` | 全部包的 Vitest 单元测试 |
| `pnpm test:e2e` | Playwright 端到端覆盖 |

## 🗂 项目结构

```text
src/
  packages/            # 深模块（见上表）
    ontology-core/
    agent-runtime/
    package-compiler/
    workspace-store/
  server/              # Hono 应用：REST + SSE，Workers 与 Node 双入口
  web/                 # React 工作台：视图、组件、设计令牌
docs/
  adr/                 # 架构决策记录（0001–0008）
  Ontology-Modeling-Framework/   # 完整框架规范
GLOSSARY.md            # 领域词汇表 —— 我们约定的语言
e2e/                   # Playwright 端到端用例
```

## 📚 文档

- **[框架规范](docs/Ontology-Modeling-Framework/ontology-plus-framework.md)** —— 完整建模方法论。
- **[词汇表](GLOSSARY.md)** —— 领域术语与禁用词。
- **[ADR](docs/adr/)** —— 关键决策：
  1. TypeScript 深模块 Monorepo
  2. 两级渐进式模型校验
  3. SQLite 无处不在，统一存储缝隙
  4. 渐进式披露的智能体产物
  5. AST 为唯一事实来源 + 语义化原型锚点
  6. `spatial-sync` 设计体系与双语 i18n
  7. 持久流式智能体会话与显式 Mock 边界
  8. 派生知识图谱与双向 Markdown

## 🙏 参考资料

建模方法论借鉴了以下本体驱动开发的先行探索：
[Onto-Model](https://github.com/sharptoolbox/Onto-Model) · [ontology-driven-dev](https://github.com/sharptoolbox/ontology-driven-dev) · [WorkBuddy-AppBuilderSkill](https://github.com/sharptoolbox/WorkBuddy-AppBuilderSkill) · [LLM-knowledgeBase](https://github.com/sharptoolbox/LLM-knowledgeBase)

---

<div align="center">

*建模领域本体，派生其余一切。*

</div>
