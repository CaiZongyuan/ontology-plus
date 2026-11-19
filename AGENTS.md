# ontology-plus

An ontology-driven software modeling, application assembly, capability extraction, and data reasoning workbench. The 11-model **Ontology Suite** (`M1`–`M7`, `ME`, `MU`, `MM`, `MI`) in `src/packages/ontology-core` is the single source of truth shared across the browser workbench, the Hono/Cloudflare Worker backend, the `pi-durable` agent harness, and the MCP/Skill compiler.

## Where things live

- Framework specification: `docs/Ontology-Modeling-Framework/ontology-plus-framework.md`.
- Domain vocabulary: `GLOSSARY.md`. Architecture decisions: `docs/adr/`.
- Deep modules: `src/packages/README.md`. Packages under `src/packages/<name>/` expose only root entry points (`index.ts`), hide implementation in `lib/`, and keep tests in `tests/`, enforced by `pnpm lint:boundaries` (`dependency-cruiser`).
- Feature specs and tracer-bullet tickets: GitHub Issues (a spec issue with its tickets as sub-issues).

## Contracts

- Every ontology mutation—whether from the structured form editor, YAML editor, or `AI Assistant` tool call—passes through `src/packages/ontology-core`'s typed AST and two-tier validator (`Consistency Error` vs. `Stage Warning`).
- All environments share the SQLite dialect (`drizzle-orm/sqlite-core` across local SQLite, Cloudflare D1, and Durable Object SQLite) behind `src/packages/workspace-store`.
- Inside an `Ontology Project`, the user moves through four `Project Steps` (`需求` / `Requirements`, `原型` / `Prototype`, `业务模型` / `Business Model`, `交付` / `Delivery`) by talking to one `AI Assistant` (backed by the seven specialist `AgentSessionKind`s, ADR 0009) in a continuous desktop conversation—streamed prose with thinking and tool calls folded inline under `工作过程` / `Work process`, latest-turn-only edit/retry, and an inline `Change Summary` strip on mutating replies—beside a canvas that defaults to a `Business View` (`src/packages/business-vocabulary`, five Business View rules, ADR 0014) and opens `Technical Details` on demand.
- Every `Model Call` (including parallel subagent lanes) persists a content-addressed `Context Snapshot` and provider-reported usage (or explicitly labelled simulated/estimated usage) in `src/packages/workspace-store`, surfaced to everyone through the closed-by-default `Context Inspector` (`对话记忆` / `Conversation memory`, ADR 0017).
- Every mutating `Agent Run` and manual save records server-persisted linear `Artifact History` with a computed `Change Summary`, one-click undo on the latest change, and append-only restore; upstream re-confirmations mark downstream steps `Outdated` one step at a time without auto-rewriting them (ADR 0016).
- Agent work is watchable in business terms (ADR 0019): a running `Agent Run` shows its plan and the result taking shape live, narrated in business language, never generated code, and every activity signal is real (no scripted cursors or canned status).
- Interactive HTML prototypes (`界面原型.html`) carry semantic `data-screen-id`, `data-element-id`, `data-binding`, and `data-event-id` anchors for deterministic `MU` UI Model extraction.
- Exported agent artifacts (`SKILL.md`, Development Package guides under `docs/`, `本体模型业务功能开发指导书.md`) use progressive disclosure (context pointers + checkable completion criteria) rather than monolithic YAML concatenation (ADRs 0004, 0011–0013).
- UI takes colours, fonts, radii, shadows, and texture only from Workbench Theme contract tokens (`src/packages/workbench-theme`, `docs/workbench-theme-contract.md`, ADR 0015), guarded by `pnpm lint:theme` (`pnpm check`); regenerate generated theme artifacts with `pnpm themes:generate`. Built-in themes: 默认 / Default (what a device gets until it chooses) and 暖纸 / Warm Paper (the `spatial-sync` identity of ADR 0006), each with light and dark; the theme is chosen per device, independently of light and dark. Bilingual (`zh-CN` / `en-US`) i18n and zero blocking browser dialogs (`window.alert/confirm/prompt` are forbidden).

## Agent skills

### Issue tracker

Issues and specs live as GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

