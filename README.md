<div align="center">

# 🧬 ontology-plus

**An ontology-driven software modeling, application assembly, capability extraction, and data reasoning workbench.**

Describe the business system you want to build in plain language, refine it with one **AI Assistant** across four **Project Steps**, and derive interactive prototypes, a validated **11-model Ontology Suite**, immutable **Development Packages**, **MCP servers**, and **Ontology Skills** from one source of truth.

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

**ontology-plus** turns plain-language business intent into a formal domain ontology — and derives everything downstream from that single source of truth:

- 🖥 **Business-first conversation + canvas workbench**: Start from one sentence on **Home**, collaborate with a single **AI Assistant** on the left, and inspect results on the right across four **Project Steps** (**Requirements**, **Prototype**, **Business Model**, **Delivery**). Every canvas opens in a plain-language **Business View** and discloses **Technical Details** (structured form editors, YAML/OWL files, knowledge graph, four-layer architecture standards) on demand.
- 🧠 **One 11-model Ontology Suite** (`M1`–`M7`, `ME`, `MU`, `MM`, `MI`) typed in code, validated in two tiers (`Consistency Error` vs. `Stage Warning`), and projected around **Business Objects**.
- 🛡 **Accountable AI changes**: Every mutating **Agent Run** and manual edit is recorded in server-persisted linear **Artifact History** with a deterministic **Change Summary**, one-click undo on the latest change, append-only restore to earlier points, explicit **Step Confirmations**, and non-destructive cascading **Outdated** states.
- 📦 **Specification-first delivery & compilers**: Exports immutable **Development Package** snapshots (`AGENTS.md`, architecture/implementation/acceptance guides, repository-owned engineering standards, confirmed prototype & ontology references), **Ontology MCP Servers**, and progressive-disclosure **Ontology Skills** (`SKILL.md`).
- 🗄 **SQLite everywhere**: One schema via `drizzle-orm/sqlite-core` across local SQLite, Cloudflare D1, and Durable Object SQLite.

## 🧬 The Ontology Suite — 11 models, one source of truth

| # | Model | Shown in Business View as | Answers | Highlights |
|---|-------|---------------------------|---------|------------|
| `M1` | **Object Model** | Business Objects (`业务对象`) | What exists | Aggregate roots, entities, value objects, dictionaries, attribute & invariant rules |
| `M2` | **Behavior Model** | Actions (`业务操作`) | How objects act | Atomic commands, queries, event handlers, external calls, pre/postconditions |
| `M3` | **Rule Model** | Business Rules (`业务规则`) | Why decisions hold | Cross-aggregate, event-driven, reusable decision logic |
| `ME` | **Event Model** | Business Events (`业务事件`) | What happened | Past-tense business facts, producer behaviors, payload & subscribers |
| `M4` | **Scenario Model** | Automations (`自动联动`) | How things collaborate | Event-decoupled cross-aggregate reactive chains |
| `M5` | **Actor Model** | Roles & Permissions (`角色与权限`) | Who does what | Human roles, external systems, RBAC/ABAC action & UI bindings |
| `M6` | **Flow Model** | Flows & Approvals (`流程与审批`) | How work flows | End-to-end collaboration & human approval flows with gateways |
| `M7` | **Query & Report Model** | Queries & Reports (`查询与报表`) | How to read | Cross-aggregate queries, statistical aggregations, reference SQL |
| `MU` | **UI Model** | Screens (`界面`) | What users see | Semantic HTML prototype screens, elements, navigation, event call chains |
| `MM` | **Mapping Model** | Data Storage (`数据存储`) | How it persists | Aggregate/entity→table and attribute→column mappings |
| `MI` | **Interface Model** | Integrations (`对外接口`) | What crosses the boundary | Provided & dependent system-boundary contracts |

Every mutation — from inline Business View edits, Technical Details structured/YAML editors, or an `AI Assistant` tool call — passes through `ontology-core`'s typed AST and its **two-tier validator**: hard `Consistency Errors` (`Problems to fix`) block Business Model confirmation and snapshot export, while soft `Stage Warnings` (`Not yet completed`) permit progressive modeling.

## 🏛 Architecture

```text
                    ┌──────────────────────────────────────────────────────┐
                    │                  Browser Workbench                   │
                    │  Home · 4 Project Steps (Chat + Business/Tech View)  │
                    │  React 19 · Base UI / shadcn · Knowledge Graph · i18n│
                    └──────────────────────────┬───────────────────────────┘
                                               │ SSE (streaming) / REST
                    ┌──────────────────────────▼───────────────────────────┐
                    │               Hono API (Workers / Node)              │
                    ├──────────────────┬───────────────────┬───────────────┤
                    │  agent-runtime   │ package-compiler  │ workspace-    │
                    │  7 specialists   │ Dev Packages, MCP │ store, step   │
                    │  on pi-durable   │ & SKILL.md        │ history & undo│
                    └──────────────────┴─────────┬─────────┴───────────────┘
                                                 │ drizzle-orm/sqlite-core
                        ┌────────────────────────┼────────────────────────┐
                        ▼                        ▼                        ▼
                  local SQLite             Cloudflare D1       Durable Object SQLite
                         ───── all sharing ontology-core & business-vocabulary ─────
```

## 📦 Deep modules

Each package under `src/packages/` is a **deep module**: one public entry point (`index.ts`), private `lib/`, co-located `tests/` — enforced by `dependency-cruiser` (`pnpm lint:boundaries`), with zero circular dependencies.

| Package | Responsibility |
|---------|----------------|
| `ontology-core` | Typed AST for the 11 models, two-tier validator (`Consistency Error` vs. `Stage Warning`), Business-Object-centred projection, and typed suite/UI-model diff |
| `workspace-store` | SQLite-everywhere persistence: projects, `Agent Sessions`, `Step Confirmations`, linear `Artifact History` (undo & append-only restore), and immutable `Package Snapshots` |
| `agent-runtime` | Persistent multi-turn `Agent Sessions` on `pi-durable`: SSE streaming, thinking traces, validated tool execution with self-repair, `Step Hand-off`, scoped `ask_user`, fork & compact |
| `architecture-assets` | Repository-owned `Architecture Assets` and `Technology Profiles` catalog for `Four-Layer Application Assembly` |
| `package-compiler` | Compiles confirmed `Ontology Suites` and `Four-Layer Application Assemblies` into immutable `Development Packages`, `Ontology MCP Servers`, and progressive-disclosure `Ontology Skills` |
| `workbench-theme` | Versioned `Workbench Theme` token contract, built-in `Default` and `Warm Paper` themes (light & dark), CSS/contract-doc generator, and completeness/contrast/source guards |
| `business-vocabulary` | Canonical 1-to-1 mapping between `GLOSSARY.md` terms/codes and bilingual `Business View` copy, tool-progress phrasing, and automated Business View vocabulary guard |

## 🖥 The workbench

| Surface | What happens here |
|---------|-------------------|
| **Home (`overview`)** | One-sentence project creation ("What system do you want to build?"), three clickable starter examples on first use, and the project list with step progress |
| **1. Requirements (`需求`)** | Conversational grilling with selectable single-question option cards (collapsing to a 1-line summary once answered), live requirements document chapters, and Requirements `Step Confirmation` |
| **2. Prototype (`原型`)** | Visual References (Primary + Borrowed), plain-language Design Brief, Style Tile, Motion Schematics, runnable HTML prototype canvas, business-worded screen diff before confirmation, and Confirmed Revision sync to `MU` |
| **3. Business Model (`业务模型`)** | Business-Object-centred pages (fields, actions, rules, permissions open by default; events, automations, screens, integrations, storage collapsible), three cross-object views (`Flows & Approvals`, `Roles & Permissions`, `Queries & Reports`), Technical Details locator (`11-model editor`, `Model YAML & OWL`, `Knowledge Graph`), and Business Model `Step Confirmation` |
| **4. Delivery (`交付`)** | Readiness check, immutable `Development Package` snapshot generation & download, `Ontology Skills`, `App Releases`, `Runnable System` endpoint slot (`"Blueprint ready to hand over for development"`), and Technical Details for `Four-Layer Application Assembly` & repository-owned `Architecture Assets` |
| **More Menu (`更多`)** | Secondary specialist areas: **Capability Center** (existing systems, `Ontology Extraction`, MCP hub, capability chat, cross-system flows, knowledge), **Data Analytics Center** (DB docs, `MM` mappings, metrics/reports, `Data Reasoning`, write-back), and **Platform Governance** (`LLM Center` & `System Settings`) |

Colours, fonts, radii, shadows, and texture come exclusively from the active **Workbench Theme** (ADR 0015): the neutral Attio-inspired **Default** theme (`默认`) or the `spatial-sync` **Warm Paper** theme (`暖纸`, ADR 0006). Each has light and dark modes chosen independently per device. Desktop-first (`1280px+` split Conversation + Canvas; `<1280px` segmented Conversation / Canvas toggle), fully bilingual (`zh-CN` / `en-US`), with zero blocking browser dialogs.

## 🤖 Single AI Assistant & accountable runs

Users talk to one **AI Assistant** throughout the workbench. Behind it, seven specialist `AgentSessionKind`s handle each surface with dedicated tools and conversation history (ADR 0009):

- **Project Steps & Technical Details**: `REQUIREMENT` (Requirements), `PROTOTYPE_CO_DESIGN` (Prototype, bound 1-to-1 per prototype), `COPILOT` (Business Model & Home), `CODING` (Delivery), and `ARCHITECTURE` (Delivery Technical Details — `Architecture Assets`).
- **Secondary Areas**: `CAPABILITY` (Capability Center) and `REASONING` (Data Analytics Reasoning).
- **Step Hand-off**: Cross-step requests produce an accept/decline `Step Hand-off` card instead of mutating across sessions silently.
- **Computed Change Summary & Undo**: Mutating runs end with a system-computed `Change Summary` worded in business names (with click-to-locate links, one-click undo on the latest change, and append-only restore from the History drawer).
- **Explicit provider diagnostics**: Unconfigured or unreachable LLM gateways surface `"AI service is temporarily unavailable; contact whoever set this up"` with a direct link to Platform Settings and collapsible technical diagnostics — never silent template fallbacks outside explicit Mock mode (ADR 0007, ADR 0016).

## 🚀 Quickstart

```bash
# Prerequisites: Node.js 20+, pnpm 9+
pnpm install

# Develop: API + web with hot reload
pnpm dev

# Web only / API only
pnpm dev:web
pnpm dev:server

# Production build (typecheck + vite build) & start on http://127.0.0.1:4310
pnpm build
pnpm start

# Optional: launch a clean first-use empty Home (3 starter examples, 0 seeded projects)
ONTOLOGY_WORKSPACE_ROOT=/tmp/onto-fresh ONTOLOGY_SEED_PROJECTS=0 pnpm start
```

### Deploy to Cloudflare

```bash
pnpm build
wrangler deploy        # uses wrangler.jsonc: Workers + static assets + D1 binding
```

## 🧪 Quality gates

| Command | What it does |
|---------|--------------|
| `pnpm check` | TypeScript typecheck + deep-module boundary lint (`lint:boundaries`) + Workbench Theme token guard (`lint:theme`) |
| `pnpm test` | Vitest unit & integration suites across all packages, server routes, and views |
| `pnpm test:e2e` | Playwright end-to-end coverage of the full business journey, themes, history/undo, and workbench |
| `pnpm themes:generate` | Regenerates `docs/workbench-theme-contract.md` and built-in theme stylesheets from `workbench-theme` |

## 🗂 Project structure

```text
src/
  packages/                 # 7 deep modules (enforced by pnpm lint:boundaries)
    ontology-core/
    workspace-store/
    agent-runtime/
    architecture-assets/
    package-compiler/
    workbench-theme/
    business-vocabulary/
  server/                   # Hono app: REST + SSE, Workers & Node entry points
  web/                      # React workbench: shell, 4 step canvases, components, theme tokens
docs/
  adr/                      # Architecture Decision Records (0001–0016)
  walkthrough/              # Facilitated business-user walkthrough script & self-check screenshots
  workbench-theme-contract.md
  Ontology-Modeling-Framework/
GLOSSARY.md                 # Canonical domain vocabulary & business-facing names
e2e/                        # Playwright end-to-end specs
```

## 📚 Documentation

- **[Framework specification](docs/Ontology-Modeling-Framework/ontology-plus-framework.md)** — the complete 11-model ontology methodology (in Chinese).
- **[Glossary](GLOSSARY.md)** — canonical domain terms, anti-terms, and 1-to-1 `"Shown to business users as"` mappings.
- **[Workbench Theme Contract](docs/workbench-theme-contract.md)** — generated semantic token specification (v1).
- **[Business User Walkthrough](docs/walkthrough/WALKTHROUGH.md)** — facilitated usability walkthrough script on the real application.
- **[ADRs](docs/adr/)** — architecture decisions (`0001`–`0016`):
  1. TypeScript deep-module monorepo
  2. Two-tier progressive model validation
  3. SQLite everywhere behind one store seam
  4. Progressive-disclosure agent artifacts
  5. AST as source of truth + semantic prototype anchors
  6. `spatial-sync` design system & bilingual i18n
  7. Durable streaming agent sessions & explicit mock boundary
  8. Derived knowledge graph & bidirectional markdown
  9. Every agent action is an Agent Run in one Agent Panel (amended for single `AI Assistant` & 7 specialists)
  10. Prototype revisions sync the UI Model only on confirmation
  11. Specification-first application delivery
  12. Repository-owned architecture standards
  13. Immutable development package snapshots
  14. The workbench is designed for the business user: conversation and canvas
  15. Workbench themes behind a versioned token contract
  16. Agent changes are accountable: computed Change Summary, run-level undo, Step Confirmation

## 🙏 References

The modeling methodology draws on prior ontology-driven development explorations:
[Onto-Model](https://github.com/sharptoolbox/Onto-Model) · [ontology-driven-dev](https://github.com/sharptoolbox/ontology-driven-dev) · [WorkBuddy-AppBuilderSkill](https://github.com/sharptoolbox/WorkBuddy-AppBuilderSkill) · [LLM-knowledgeBase](https://github.com/sharptoolbox/LLM-knowledgeBase)

---

<div align="center">

*Model the domain. Derive everything else.*

</div>
