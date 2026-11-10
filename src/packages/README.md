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

