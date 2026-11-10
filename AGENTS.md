# ontology-plus

An ontology-driven software modeling, application assembly, capability extraction, and data reasoning workbench. The 11-model **Ontology Suite** (`M1`–`M7`, `ME`, `MU`, `MM`, `MI`) in `src/packages/ontology-core` is the single source of truth shared across the browser workbench, the Hono/Cloudflare Worker backend, the `pi-durable` agent harness, and the MCP/Skill compiler.

## Where things live

- Framework specification: `docs/Ontology-Modeling-Framework/ontology-plus-framework.md`.
- Domain vocabulary: `GLOSSARY.md`. Architecture decisions: `docs/adr/`.
- Deep modules: `src/packages/README.md`. Packages under `src/packages/<name>/` expose only root entry points (`index.ts`), hide implementation in `lib/`, and keep tests in `tests/`, enforced by `pnpm lint:boundaries` (`dependency-cruiser`).
- Feature specs and tracer-bullet tickets: `.scratch/ontology-plus/spec.md` and `.scratch/ontology-plus/issues/`.

## Contracts

- Every ontology mutation—whether from the structured form editor, YAML editor, or AI Ontology Assistant tool call—passes through `src/packages/ontology-core`'s typed AST and two-tier validator (`Consistency Error` vs. `Stage Warning`).
- All environments share the SQLite dialect (`drizzle-orm/sqlite-core` across local SQLite, Cloudflare D1, and Durable Object SQLite) behind `src/packages/workspace-store`.
- Interactive HTML prototypes (`界面原型.html`) carry semantic `data-screen-id`, `data-element-id`, `data-binding`, and `data-event-id` anchors for deterministic `MU` UI Model extraction.
- Exported agent artifacts (`SKILL.md`, `开发指导书.md`, `本体模型业务功能开发指导书.md`) use progressive disclosure (context pointers + checkable completion criteria) rather than monolithic YAML concatenation.
- UI follows the `spatial-sync` warm-paper (light) and film-grain (dark) token system (`src/web/tokens.css`, `src/web/shell.css`) with bilingual (`zh-CN` / `en-US`) i18n and zero blocking browser dialogs (`window.alert/confirm/prompt` are forbidden).

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

