<div align="center">

# 🧬 ontology-plus

**An ontology-driven software modeling, application assembly, capability extraction, and data reasoning workbench.**

Model your domain once as an **11-model Ontology Suite** — then let the browser workbench, streaming agent sessions, compiled MCP servers, and skills all speak the same language.

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

## ✨ What is this?

**ontology-plus** is a workbench where a business domain is modeled as an ontology — and everything downstream is *derived* from that single source of truth:

- 🧠 **One Ontology Suite** (`M1`–`M7`, `ME`, `MU`, `MM`, `MI`) typed in code, validated in two tiers, shared by every environment.
- 🖥 **A browser workbench** to author models, assemble applications, explore capabilities, and reason over data.
- 🤖 **Streaming agent sessions** — five domain agents (Requirement Exploration, Ontology Copilot, Application Coding, Capability Chat, Data Reasoning) that read and *mutate* the ontology through validated tool calls.
- 📦 **A compiler** that turns the ontology into development packages, MCP servers, and agent `SKILL.md` artifacts.
- 🗄 **SQLite everywhere** — one schema via `drizzle-orm` across local SQLite, Cloudflare D1, and Durable Object SQLite.

## 🧬 The Ontology Suite — 11 models, one source of truth

| # | Model | Answers | Highlights |
|---|-------|---------|------------|
| `M1` | **Object Model** | What exists | Entities, attributes, bidirectional relations, referential integrity |
| `M2` | **Behavior Model** | How objects act | Atomic behaviors, trigger conditions, pre/post constraints |
| `M3` | **Rule Model** | Why decisions hold | Cross-object, event-driven, reusable business rules |
| `ME` | **Event Model** | What happened | Events, producers, subscribers, event chains |
| `M4` | **Scenario Model** | How things collaborate | Event-decoupled cross-object collaboration scenes |
| `M5` | **Actor Model** | Who does what | Participants, roles, permission boundaries |
| `M6` | **Flow Model** | How work flows | End-to-end collaboration & approval flows with gateways |
| `M7` | **Query & Report Model** | How to read | Cross-object queries, analytics, fixed reports |
| `MU` | **UI Model** | What users see | Screens, elements, navigation, UI-event call chains |
| `MM` | **Mapping Model** | How it persists | Object→table, attribute→column mapping |
| `MI` | **Interface Model** | What crosses the boundary | Provided & consumed API contracts |

Every mutation — from the structured form editor, the YAML editor, or an AI tool call — passes through `ontology-core`'s typed AST and its **two-tier validator**: hard `Consistency Errors` block, soft `Stage Warnings` permit progressive modeling.

## 🏛 Architecture

```text
                    ┌──────────────────────────────────────────────┐
                    │              Browser Workbench               │
                    │   React 19 · TanStack Router/Query · Vite    │
                    │  knowledge graph · Tiptap markdown · i18n    │
                    └───────────────┬──────────────────────────────┘
                                    │ SSE (streaming) / REST
                    ┌───────────────▼──────────────────────────────┐
                    │        Hono API (Workers / Node)             │
                    ├──────────────────────────────────────────────┤
                    │ agent-runtime │ package-compiler │ workspace- │
                    │ pi-durable    │ MCP + SKILL.md    │ store     │
                    │ sessions      │ generation        │ snapshots │
                    └───────────────┬──────────────────────────────┘
                                    │ drizzle-orm/sqlite-core
              ┌─────────────────────┼──────────────────────────┐
              ▼                     ▼                          ▼
        local SQLite           Cloudflare D1          Durable Object SQLite
                    ───── all sharing ontology-core AST ─────
```

## 📦 Deep modules

Each package under `src/packages/` is a **deep module**: one public entry point, private `lib/`, co-located `tests/` — enforced by `dependency-cruiser` (`pnpm lint:boundaries`), with zero circular dependencies.

| Package | Responsibility |
|---------|----------------|
| `ontology-core` | Typed AST for the 11 models + two-tier validator (`Error` vs `Warning`) — the single source of truth |
| `agent-runtime` | Persistent multi-turn agent sessions on `pi-durable`: SSE streaming, thinking traces, multi-step tool execution with validator self-repair, scoped HITL `ask_user`, fork & compact |
| `package-compiler` | Compiles ontologies into development packages, MCP servers, and progressive-disclosure agent artifacts (`SKILL.md`, development guides) |
| `workspace-store` | SQLite-everywhere persistence: projects, sessions, snapshots, undo — one dialect across Node, D1, and DO |

## 🖥 The workbench

| Area | Screens |
|------|---------|
| **Overview** | Workspace dashboard and LLM Center (provider configuration & diagnostics) |
| **Ontology** | Structured form editor + YAML editor, 12-stage modeling sequence, knowledge graph canvas (swimlanes via `elkjs`, ego subgraphs via `d3-force`) |
| **Capability Center** | Systems, agents, MCP tools, capability knowledge, capability extraction, cross-flow analysis |
| **Data Center** | Data resources, object↔table mappings, metrics & reports, data reasoning chat, writeback |
| **Application Center** | Requirement exploration (agent-driven), SRS documents, application assembly, four-layer architecture assets, publishing, skills |

Design follows the **`spatial-sync`** token system (warm-paper light / film-grain dark), fully bilingual (`zh-CN` / `en-US`), with zero blocking browser dialogs.

## 🤖 Agent sessions

All five domain agents run as persistent, multi-turn sessions with live streaming deltas, thinking traces, and visible multi-step tool execution. Key properties:

- **Validator in the loop** — tool calls that mutate the ontology are validated in the same turn; errors feed back for self-correction.
- **Autonomous by default** — tools execute without permission gating, safeguarded by the validator and workspace undo snapshots; interactive cards are reserved strictly for *missing user inputs*, not approvals.
- **No silent fallbacks** — when no LLM gateway is configured, the UI surfaces actionable provider diagnostics instead of quietly degrading to templates. Deterministic mocks live only behind explicit test/Demo flags.

See [ADR 0007](docs/adr/0007-pi-durable-streaming-and-explicit-mock-boundary.md).

## 🚀 Quickstart

```bash
# Prerequisites: Node.js 20+, pnpm 9+
pnpm install

# Develop: API + web with hot reload
pnpm dev

# Web only / API only
pnpm dev:web
pnpm dev:server

# Production build (typecheck + vite build)
pnpm build
pnpm start
```

### Deploy to Cloudflare

```bash
pnpm build
wrangler deploy        # uses wrangler.jsonc: Workers + static assets + D1 binding
```

## 🧪 Quality gates

| Command | What it does |
|---------|--------------|
| `pnpm check` | TypeScript typecheck + deep-module boundary lint (entry-point rule, no cycles) |
| `pnpm test` | Vitest unit suites across all packages |
| `pnpm test:e2e` | Playwright end-to-end coverage of the workbench |

## 🗂 Project structure

```text
src/
  packages/            # deep modules (see table above)
    ontology-core/
    agent-runtime/
    package-compiler/
    workspace-store/
  server/              # Hono app: REST + SSE, Workers & Node entry points
  web/                 # React workbench: views, components, design tokens
docs/
  adr/                 # architecture decision records (0001–0008)
  Ontology-Modeling-Framework/   # full framework specification
GLOSSARY.md            # domain vocabulary — the words we agree on
e2e/                   # Playwright end-to-end specs
```

## 📚 Documentation

- **[Framework specification](docs/Ontology-Modeling-Framework/ontology-plus-framework.md)** — the complete modeling methodology (in Chinese).
- **[Glossary](GLOSSARY.md)** — canonical domain terms and anti-terms.
- **[ADRs](docs/adr/)** — key decisions:
  1. TypeScript deep-module monorepo
  2. Two-tier progressive model validation
  3. SQLite everywhere behind one store seam
  4. Progressive-disclosure agent artifacts
  5. AST as source of truth + semantic prototype anchors
  6. `spatial-sync` design system & bilingual i18n
  7. Durable streaming agent sessions & explicit mock boundary
  8. Derived knowledge graph & bidirectional markdown

## 🙏 References

The modeling methodology draws on prior ontology-driven development explorations:
[Onto-Model](https://github.com/sharptoolbox/Onto-Model) · [ontology-driven-dev](https://github.com/sharptoolbox/ontology-driven-dev) · [WorkBuddy-AppBuilderSkill](https://github.com/sharptoolbox/WorkBuddy-AppBuilderSkill) · [LLM-knowledgeBase](https://github.com/sharptoolbox/LLM-knowledgeBase)

---

<div align="center">

*Model the domain. Derive everything else.*

</div>
