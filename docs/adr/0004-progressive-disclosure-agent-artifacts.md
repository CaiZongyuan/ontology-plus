# Progressive-Disclosure Agent Artifacts and Validated Ontology Tool Calls

Exported agent artifacts (`SKILL.md`, `开发指导书.md`, and `本体模型业务功能开发指导书.md`) are compiled as concise router documents with context pointers and checkable completion criteria pointing to disclosed `M1`–`MI` YAML files, rather than concatenating all 11 YAML files into a single monolithic prompt. Similarly, inside the platform's `pi-durable` runtime, the Ontology Architect Agent mutates models exclusively through structured tools gated by `ontology-core` validation instead of raw text replacement.

