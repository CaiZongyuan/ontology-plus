# Two-Tier Progressive Validation for the 11-Model Ontology Suite

Although §14.3 of the framework document mentions checking all 12 fixed files upon import, §14.1 prescribes a 12-stage progressive modeling workflow where `MU`, `MM`, and `MI` are authored last, and existing reference projects often contain only the original 8 or 9 models. We therefore split ontology validation into two tiers: **Consistency Errors** (broken cross-model references, schema violations, or invalid `callChain` ordering among present models, which block save/export) and **Stage Warnings** (unauthored late-stage model files such as `MM` or `MI`, which allow importing, editing, and saving while surfacing readiness gaps before Four-Layer Application Assembly).

