# TeaCo reference application

The order system of the TeaCo spec (`docs/ontology-plus-teaco-spec-v0.3.md`), built against the
Business Bench `order-management` case. It is the canonical application that Ontology Plus connects to.

- `domain/` — pure TypeScript business rules (import normalisation, pricing, metrics, scope). No Node APIs.
- `app/` — local process: SQLite repository (async port), connection contract v1 runtime interface
  (spec §11.3), seed import from `benchmark/datasets/bb-seed0`.
- `tests/` — the published Business Bench figures and contract conformance.

```bash
pnpm teaco:dev                      # http://127.0.0.1:4320, requirement v1
TEACO_REVISION=v2 pnpm teaco:dev     # adds the monthly sales report
```

Data lives in `examples/teaco/.data/teaco.sqlite` (git-ignored); delete it to re-import the seed.
The runtime interface carries no authentication and listens on loopback only (spec v0.3.1, ADR 0020
amendment). Milestone M1 serves reads; staff screens and approved actions follow in later milestones.
