# Specification-First Application Delivery

The initial application-development deliverable is a Development Package: a coherent implementation specification that a coding agent can use to build the target application. Delivery quality is judged by the completeness and consistency of its requirements, confirmed prototype, ontology contracts, selected engineering standards, references, and checkable completion criteria.

For this stage, completing the entire target application inside Ontology Plus is deferred so that effort goes into the quality of the agent handoff. A runnable starter or completed business application is not a prerequisite for downloading the specification package; conventional English artifact organisation and progressive disclosure remain applicable to this deliverable.

The application-development workflow is: confirm the prototype and Ontology Suite, select development standards and a technical approach, inspect the assembled inputs, and export the Development Package. The architecture-assets area maintains reusable material; application development shows which inputs were selected and where they came from, with detailed four-layer configuration available beyond the main workflow.

Exported paths, file names, agent entry instructions, and platform-generated development documentation use English, with an optional `README.zh-CN.md`. Source business material, including original requirements, prototype UI copy, and ontology business labels, may retain its original Chinese text so that export does not change its meaning through translation.

The package uses this structure:

```text
README.md
README.zh-CN.md
AGENTS.md
manifest.json
docs/
  architecture.md
  implementation.md
  acceptance.md
standards/
references/
  requirements.md
  prototype/
  ontology/
```

`AGENTS.md` is the coding-agent entrypoint and reading index. The implementation guide specifies development order; acceptance criteria make completion checkable. Selected standards and original business references are included with valid package-local references. Any code examples are identified as examples, and package readiness describes the quality of the implementation handoff.

The Ontology Suite is authoritative for formal business semantics, the Confirmed Revision for UI design intent, and the selected Technology Profile and standards for engineering implementation. A generic UI standard conflicting with a confirmed prototype is surfaced for explicit adjustment of the selected standards; it does not silently replace the confirmed design. Explicit contradictions must be resolved before formal package generation, while the existing non-blocking Stage Warning policy remains in effect for progressive modeling. Missing or invalid inputs produce actionable diagnostics rather than unrelated asset substitutions or placeholder content.
