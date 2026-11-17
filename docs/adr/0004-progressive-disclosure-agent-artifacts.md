# Progressive-Disclosure Agent Artifacts and Validated Ontology Tool Calls

Exported agent artifacts (`SKILL.md` and the Development Package's `AGENTS.md`, `docs/implementation.md`, and `docs/acceptance.md`) are compiled as concise router documents with context pointers and checkable completion criteria pointing to disclosed `M1`–`MI` YAML files, rather than concatenating all 11 YAML files into a single monolithic prompt. ADR 0011 defines the Development Package's English file organisation, replacing the legacy Chinese development-guide paths while preserving progressive disclosure. Similarly, inside the platform's `pi-durable` runtime, the Ontology Architect Agent mutates models exclusively through structured tools gated by `ontology-core` validation instead of raw text replacement.

