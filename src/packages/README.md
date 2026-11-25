# Deep Modules (`src/packages/`)

Every directory under `src/packages/<name>/` is a **deep module** enforced by `pnpm lint:boundaries` (`dependency-cruiser`):

```text
src/packages/
  <name>/
    index.ts        ← entry point (public). Import this from outside.
    lib/            ← implementation: private to this package.
    tests/          ← co-located tests + fixtures: import only entry points (`../index`).
```

## Four Rules

1. **Entry-point boundary**: App code (`src/web/`, `src/server/`) and other packages may import only a package's root files (`src/packages/<name>/index.ts`), never anything inside its subfolders (`lib/`, `tests/`).
2. **Intra-package freedom**: Files inside a package's own `lib/` may import each other freely.
3. **Tests through the entry points**: Files under `src/packages/<name>/tests/` must import `../index` (the public entry point) and their own `tests/` fixtures, never `../lib/*`.
4. **No cycles**: Zero circular dependencies across modules.

Avoid giant barrel files that blindly re-export internal helpers; keep entry points small, cohesive, and high-leverage.

## Package Directory

| Package | Responsibility |
| --- | --- |
| `ontology-core` | Typed AST for the 11-model `Ontology Suite`, two-tier validator (`Consistency Error` vs. `Stage Warning`), Business-Object-centred projection (`projectByBusinessObject`), and typed suite/UI-model diff (`diffOntologySuites`) |
| `workspace-store` | SQLite-everywhere persistence (`drizzle-orm/sqlite-core` across local SQLite, Cloudflare D1, and Durable Object SQLite): projects, `Agent Sessions`, deduplicated `Context Snapshots` (`Model Calls` & compaction events, ADR 0017), `Step Confirmations`, linear `Artifact History` (undo & restore), and immutable `Package Snapshots` |
| `agent-runtime` | Persistent multi-turn `Agent Sessions` on `pi-durable`: SSE streaming, thinking traces, per-`Model Call` `Context Snapshot` capture (including parallel subagents), validated tool execution with self-repair, `Step Hand-off`, scoped `ask_user` cards, fork & compact |
| `architecture-assets` | Repository-owned `Architecture Assets` and `Technology Profiles` catalog for `Four-Layer Application Assembly` |
| `package-compiler` | Compiles confirmed `Ontology Suites` and `Four-Layer Application Assemblies` into immutable `Development Packages`, `Ontology MCP Servers`, and progressive-disclosure `Ontology Skills` (`SKILL.md`) |
| `workbench-theme` | Versioned `Workbench Theme` token contract, built-in `Default` and `Warm Paper` themes (light & dark), CSS/doc compiler, and completeness/contrast/source guards |
| `business-vocabulary` | Canonical 1-to-1 mapping between `GLOSSARY.md` terms/model codes and bilingual `Business View` names, tool-progress phrasing, and automated Business View vocabulary guard (`checkBusinessViewMarkup`) |
| `application-runtime` | Connection contract v1 (TeaCo spec §11.3): `Connection Manifest` schema and fingerprint, a typed client for a connected application's runtime reads (sent as the user's `Acting Identity`), and the check of a manifest against the confirmed Business Model |
| `runtime-gateway` | The one path between Ontology Plus and a connected application (TeaCo spec §8–§10, ADR 0020): every call re-checks the Connection Manifest (Drifted stops it) and uses the person's `Acting Identity`; changes are prepared, approved by a person (bound to arguments, target version, identity and manifest for ten minutes), invoked with one request key and read back, and an unconfirmed result is reconciled by that key. Used by the Operations Console routes and the AI Assistant's runtime tools |
| `data-management` | Knowledge from attached sources (TeaCo spec §10.4–§10.5): exact table parsing and typing, row-level `Provenance Record`s, and `Knowledge Claim`s on two time axes (valid time and recorded time) with supersession within a source, disputes across sources, review and retirement. Pure TypeScript; claims never change the application |


