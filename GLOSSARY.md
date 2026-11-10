# Ontology Plus

An ontology-driven software modeling and application assembly workbench that turns business requirements into formal 11-model specifications, interactive prototypes, and executable development packages.

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

## Application Center & Delivery

**Requirement Exploration (需求探索)**:
An interactive AI grilling session that stress-tests raw user requirements to reach alignment and synthesize a structured Software Requirements Specification (SRS).
_Avoid_: Chat session, prompt log

**Interactive Prototype (界面原型)**:
A runnable HTML/UI preview generated from the confirmed requirements document and refined live with AI assistance before extracting the formal Ontology Suite.
_Avoid_: Static mockup

**Four-Layer Application Assembly (四层应用装配)**:
The explicit binding of four architectural assets—`01 UI/UE Specification`, `02 Ontology Suite`, `03 Tech Foundation`, and `04 Tech Architecture`—into a buildable application blueprint.
_Avoid_: Project template, app config

**Development Package (开发包)**:
A self-contained, deterministic bundle exported from a Four-Layer Application Assembly (containing compiled development guides, file verification manifests, ontology YAML files, prototype, and foundation source) consumed by an Agent Harness to implement the target system.
_Avoid_: Source zip, release build

**Ontology Skill (本体技能)**:
An agent-consumable skill (`SKILL.md` plus disclosed YAML references) compiled from an Ontology Suite using context pointers and checkable completion criteria.
_Avoid_: System prompt dump

**Ontology MCP Server (本体 MCP 服务)**:
A Model Context Protocol capability published from an Ontology Suite that exposes its `M1` aggregates, `M2` behaviors, `M7` queries, and `MI` contracts as structured tools and resources.
_Avoid_: Custom webhook, REST wrapper

**Ontology Extraction (本体萃取 / 存量系统本体化)**:
The process of distilling an Ontology Suite from an existing business system's documentation, schemas, and interfaces to upgrade legacy capabilities into Agent-native Skills, MCP tools, and intelligent workflows.
_Avoid_: 逆向工程, 本体逆向, 逆向建模, Reverse engineering



