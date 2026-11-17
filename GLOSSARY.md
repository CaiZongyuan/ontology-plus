# Ontology Plus

An ontology-driven software modeling and application assembly workbench that turns business requirements into formal 11-model specifications, interactive prototypes, and development specifications for coding agents.

## Core Ontology Suite

**Ontology Suite (本体套件)**:
The complete set of 11 orthogonal meta-models (`M1`–`M7`, `ME`, `MU`, `MM`, `MI`) that together define a business domain's existence, behavior, rules, events, scenarios, actors, workflows, read queries, UI call chains, persistence mapping, and external contracts.
_Avoid_: Schema bundle, config files, YAML set

**Object Model (`M1` 对象模型)**:
The structural foundation defining domain Aggregate Roots, internal Entities, immutable Value Objects, Data Dictionaries, attribute constraints (`refRules`),aggregate invariants (`invariants`), and ID-based cross-aggregate associations.
_Avoid_: Database schema, ER diagram, table model

**Behavior Model (`M2` 行为模型)**:
The catalog of atomic operations (`COMMAND`, `QUERY`, `EVENT_HANDLER`, `EXTERNAL_CALL`) that each act on a single Aggregate Root with explicit preconditions, postconditions, required permissions, and emitted event references.
_Avoid_: Controller method, API endpoint, service method

**Rule Model (`M3` 规则模型)**:
Side-effect-free decision logic that spans multiple aggregates, behaviors, or events, or is reused across behaviors. Single-attribute (`refRules`) and single-aggregate (`invariants`) rules belong to `M1`, never `M3`.
_Avoid_: Validator, constraint

**Event Model (`ME` 事件模型)**:
The contract for past-tense business facts (`<Object>.<PastParticiple>`), declaring a single producer behavior, payload fields, delivery ordering semantics, and downstream subscribers (behaviors or event rules).
_Avoid_: Command, webhook, message queue config

**Scenario Model (`M4` 场景模型)**:
A cross-aggregate, event-decoupled semantic chain (`BEHAVIOR_CALL` → `EVENT_EMIT` → `RULE_EVALUATE` → downstream `BEHAVIOR_CALL`) that captures reactive domain collaboration without human tasks or approval gateways.
_Avoid_: Use case, business process, workflow

**Actor Model (`M5` 主体模型)**:
The definition of human participants, internal roles (`Role`), external systems (`ExternalEntity`), permissions, and RBAC/ABAC authorization bindings to `M2` behaviors and `MU` UI elements.
_Avoid_: User table, account list

**Flow Model (`M6` 流程模型)**:
End-to-end business collaboration flows (`COLLABORATION`) and human approval flows (`APPROVAL`) composed of role-bound tasks (`roleRef`), gateways, behavior/scenario invocations, and acyclic sub-flow calls.
_Avoid_: Scenario (`M4`), state machine

**Query & Report Model (`M7` 查询统计与报表模型)**:
The read-side specification for cross-aggregate queries, statistical aggregations, and fixed business reports (`REPORT`), strictly bound 1-to-1 with an `M2` `QUERY` behavior and accompanied by a verifiable reference SQL.
_Avoid_: BI cube, data warehouse model, ad-hoc SQL

**UI Model (`MU` UI 模型)**:
The interaction and traceability layer defining screens, data-bound elements, navigation edges, ASCII layouts, and ordered UI event call chains (`VALIDATE` → `BEHAVIOR_CALL` → `EVENT_EMIT` → `SCENARIO_CALL` → `REPORT_CALL` → `NAVIGATE`).
_Avoid_: Visual theme, CSS spec, wireframe image

**Mapping Model (`MM` 对象-数据表映射模型)**:
The persistence correspondence mapping `M1` aggregates, sub-entities, and value objects to physical database tables (`MASTER`, `DETAIL`, `EXT`) and columns, without physical index or migration script details.
_Avoid_: DDL script, ORM entity class

**Interface Model (`MI` 接口模型)**:
The system-boundary contract catalog specifying `PROVIDED` (inbound, backed by `M2` `EXTERNAL_CALL`) and `DEPENDENT` (outbound, linked to `M5` `ExternalEntity`) interfaces, their I/O field specs aligned with `M1`/`M7`, and return rules.
_Avoid_: Gateway config, OpenAPI file

## Validation & Lifecycle

**Consistency Error (一致性错误)**:
A blocking model defect—such as a dangling ID reference, broken `M2`/`M7` 1-to-1 binding, or invalid `MU` call-chain order—that prevents saving or exporting a model snapshot.
_Avoid_: Warning, lint hint

**Stage Warning (阶段缺失警告)**:
A non-blocking indicator showing that a late-stage model in the 12-stage modeling sequence (such as `MM` or `MI`) has not yet been authored, permitting progressive modeling and legacy 8/9-model imports.
_Avoid_: Validation failure, broken model

## Workspace & Agent Collaboration

**Ontology Project (本体工程)**:
The top-level domain workspace container that owns one evolving Ontology Suite alongside its requirement specifications, interactive prototypes, snapshots, and assembled deliverables.
_Avoid_: Project session,工程会话, chat workspace

**Agent Session (智能体会话)**:
A persistent, multi-turn conversation thread between a user and a specialized domain agent (such as Requirement Exploration, Prototype Co-Design, Ontology Copilot, Architecture Asset Authoring, Application Development, Capability Chat, or Data Reasoning) scoped to an Ontology Project.
_Avoid_: Project session, stateless prompt, one-shot turn

**Agent Run (智能体运行)**:
One bounded piece of agent work inside an Agent Session, from a user turn or a triggered action through to the resulting artifact change, that the user can watch, cancel, and retry.
_Avoid_: Background task, pipeline task, one-shot call

**Agent Panel (智能体面板)**:
The single place in the workbench where the user talks to agents and watches every Agent Run, showing the Agent Session that belongs to the module in view.
_Avoid_: Chat drawer, task drawer, assistant sidebar

## Application Center & Delivery

**Requirement Exploration (需求探索)**:
An interactive AI grilling session that stress-tests raw user requirements to reach alignment and synthesize a structured Software Requirements Specification (SRS).
_Avoid_: Chat session, prompt log

**Interactive Prototype (界面原型)**:
One runnable HTML/UI design direction for an Ontology Project, generated from the confirmed requirements document and evolved through Prototype Revisions before the formal Ontology Suite is extracted.
_Avoid_: Static mockup, prototype version

**Prototype Revision (原型修订)**:
An immutable saved state of one Interactive Prototype, produced by a single Agent Run or manual edit, forming that prototype's linear history.
_Avoid_: Version, clone, copy

**Confirmed Revision (已确认修订)**:
The single Prototype Revision in an Ontology Project that the user has approved as the source for UI Model extraction and Ontology Suite synthesis.
_Avoid_: Latest version, active prototype

**Visual Reference (视觉参考)**:
A screenshot of a real production interface that the user picks or supplies to show the agent the look they want.
_Avoid_: Inspo, inspiration image, mockup

**Primary Reference (主参考)**:
The one Visual Reference whose overall visual language the prototype follows.
_Avoid_: Main inspo, base style

**Borrowed Reference (借鉴参考)**:
An additional Visual Reference from which exactly one named aspect is taken.
_Avoid_: Secondary reference, mixed reference

**Design Brief (设计简报)**:
The agent's plain-language reading of what the user wants an Interactive Prototype to look and behave like, derived from the Visual References, Motion Schematics, and the user's own words, which the user corrects and approves before generation.
_Avoid_: Prompt, visual DNA, compiled context

**Motion Schematic (动态示意)**:
A small playable demonstration of one interaction or motion pattern that the user picks to state how the prototype should behave.
_Avoid_: Animation demo, 交互动效图

**Style Tile (风格样张)**:
A live sample sheet of colors, type, and representative components that shows the chosen visual language without pretending to be the user's application.
_Avoid_: Composite preview, reference draft, 合成预览

**Four-Layer Application Assembly (四层应用装配)**:
The binding of four concerns—UI/UE design, Ontology Suite, technical foundation, and technical architecture—into an application implementation blueprint, using the project's confirmed UI source and explicitly selected engineering standards.
_Avoid_: Project template, app config

**Architecture Asset (架构资产)**:
A reusable specification of UI standards, technical foundation conventions, or technical architecture constraints that an application explicitly selects.
_Avoid_: Interactive Prototype, technology tag

**Technology Profile (技术方案)**:
A coherent choice of frontend, backend, persistence, deployment approach, and compatible development standards selected together for an application.
_Avoid_: Technology tag list, framework label

**Development Package (开发资料包 / 开发包)**:
A self-contained implementation specification exported from a Four-Layer Application Assembly, giving a coding agent the requirements, confirmed prototype, Ontology Suite, selected engineering standards, and acceptance criteria needed to build the target application.
_Avoid_: Source zip, release build

**Package Snapshot (开发包快照)**:
An immutable Development Package produced from one fixed set of application inputs, retaining their source revisions so that preview and download refer to the same content.
_Avoid_: Latest project state, live export

**Architecture Asset Agent (架构资产智能体)**:
A specialist that helps users create, refine, and maintain reusable architecture assets and development standards.
_Avoid_: Application Coding Agent, package compiler

**Application Development Agent (应用开发智能体)**:
A specialist that helps users inspect application assembly inputs, resolve missing or conflicting information, and refine the target application's implementation specification.
_Avoid_: Architecture Asset Agent, package compiler

**Ontology Skill (本体技能)**:
An agent-consumable skill (`SKILL.md` plus disclosed YAML references) compiled from an Ontology Suite using context pointers and checkable completion criteria.
_Avoid_: System prompt dump

**Ontology MCP Server (本体 MCP 服务)**:
A Model Context Protocol capability published from an Ontology Suite that exposes its `M1` aggregates, `M2` behaviors, `M7` queries, and `MI` contracts as structured tools and resources.
_Avoid_: Custom webhook, REST wrapper

**Ontology Extraction (本体萃取 / 存量系统本体化)**:
The process of distilling an Ontology Suite from an existing business system's documentation, schemas, and interfaces to upgrade legacy capabilities into Agent-native Skills, MCP tools, and intelligent workflows.
_Avoid_: 逆向工程, 本体逆向, 逆向建模, Reverse engineering

**Extraction Candidate (萃取候选)**:
A single model element proposed by an Ontology Extraction that has not yet entered the Ontology Suite.
_Avoid_: Candidate suite, draft model, 候选套件

**Evidence (证据)**:
The excerpt of source material an Extraction Candidate rests on, together with how it was derived: read off the source by the structural scan, or inferred by semantic alignment.
_Avoid_: Confidence score, 置信度, provenance chain

**Confirmation (确认)**:
A person's decision to accept or reject one Extraction Candidate; only accepted candidates are merged into the Ontology Suite.
_Avoid_: Certification, 认证 (collides with `M5` authentication), approval
