# Staged Ontology Synthesis from Confirmed Requirements and Prototype

In the `Business Model` step, `Ontology Synthesis` (`生成业务模型`) used to ask the `COPILOT` session to emit a flat 7-model blueprint in one tool call without injecting the confirmed requirements specification, then padded missing models (`M4`, `M6`, `M7`, `MM`, `MI`) with hardcoded templates and forced every prototype `data-binding` onto `M1` attributes. As a result, requirements-only domain concepts (such as inventory or recipes without prototype screens) were invisible, UI search filters polluted domain tables, inapplicable models (such as external interfaces in a standalone system) were fabricated, and single-aggregate mutations deadlocked against pre-extracted `MU` bindings.

We decided that `Ontology Synthesis` reads a deterministic dual-source digest of both the confirmed requirements specification and the `Confirmed Revision` prototype anchors (`MU`), authors the `Ontology Suite` progressively in dependency waves (`M1`/`M5` -> `M3`/`M2`/`M7` -> `ME`/`M4`/`M6` -> `MU`/`MM`/`MI`), normalizes aggregate binding prefixes case-insensitively while allowing search/filter bindings to map to `M2`/`M7` query parameters, leaves genuinely inapplicable late-stage models (`M4`, `M6`, `MI`) empty rather than fabricating placeholders, and preserves existing authored elements during `Outdated` incremental updates (`mode="update"`).

## Considered Options

- **Expand `synthesize_ontology_suite` into a single 11-model JSON schema.** Rejected: generating all 11 cross-referenced models in one completion overflows output budgets, hides progress until the end, and rolls back the entire suite on a single reference typo.
- **Scope synthesis strictly to screens drawn in the `Confirmed Revision`.** Rejected: prototypes often illustrate core user journeys while leaving backend or secondary modules in the confirmed requirements document, which downstream `Development Package` assembly still needs.

## Consequences

- Progressive `upsert_*` mutations evaluate newly introduced `Consistency Errors` against an initialized baseline so authoring the first `M1` aggregate is not blocked by remaining unauthored `MU` screen bindings, while finalization still verifies full `MU` binding resolution and zero `Consistency Errors`.
- Confirming a `Business Model` requires zero `Consistency Errors` (`ADR 0002`), not artificial population of all 11 model slots when a domain has no external interfaces or cross-aggregate event scenarios.
