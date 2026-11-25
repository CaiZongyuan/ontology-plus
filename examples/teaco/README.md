# TeaCo reference application

The order system of the TeaCo spec (`docs/ontology-plus-teaco-spec-v0.3.md`), built against the
Business Bench `order-management` case. It is the canonical application that Ontology Plus connects to.

- `domain/` — pure TypeScript business rules (import normalisation, pricing, metrics, scope, and
  `commands.ts`: every business command planned without side effects). No Node APIs.
- `app/` — local process: SQLite repository (async port), connection contract v1 runtime interface
  (spec §11.3), seed import from `benchmark/datasets/bb-seed0`.
- `tests/` — the published Business Bench figures, contract conformance, and the approved actions
  (BB 18, 21, 23–25, 33–35; atomicity across two connections; request-key replay; stale approvals).

```bash
pnpm teaco:dev                      # http://127.0.0.1:4320, requirement v1
TEACO_REVISION=v2 pnpm teaco:dev     # adds the monthly sales report
TEACO_REVISION=v4 pnpm teaco:dev     # adds holding and releasing orders
```

Data lives in `examples/teaco/.data/teaco.sqlite` (git-ignored); delete it to re-import the seed.
The runtime interface carries no authentication and listens on loopback only (spec v0.3.1, ADR 0020
amendment). Reads arrived in M1. Since M2 every change is an approved action: `prepare` previews it in
business words without changing anything; `invoke` re-plans it inside one `BEGIN IMMEDIATE`
transaction, refuses a record that moved past the approved version, and writes the status, stock,
inventory movement, audit record, outbox event and receipt together; `GET /runtime/invocations/:key`
answers whether a request key committed. Older databases gain the new columns on start.

Since M4 the four requirement versions are releases of the same application: the manifest declares
`releases`, any version can be previewed read-only with `X-Ontology-Plus-Release`, and
`POST /runtime/releases/:version/activate` puts one in use (stored in the database; `TEACO_REVISION`
only sets the first one). Going back before v4 is refused while orders are on hold. `changes/`
holds the requirement changes v2–v4 with acceptance checks transcribed from Business Bench #27–35;
`pnpm teaco:changes -- --project <id>` records them in an Ontology Plus project.
