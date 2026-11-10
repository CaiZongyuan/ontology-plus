# Typed AST Source of Truth and Semantic Prototype Anchors

In the ontology workbench, the parsed 11-model typed AST in `ontology-core` serves as the single in-memory source of truth across the structured form editor, relationship graph, YAML editor, and AI Ontology Assistant, enabling atomic cross-model cascade renames and impact analysis (`analyzeImpact`) before serializing back to YAML. To bridge interactive UI prototyping with formal modeling, generated `界面原型.html` artifacts embed semantic `data-onto-*` attributes (`data-screen-id`, `data-element-id`, `data-binding`, `data-event-id`), allowing `ontology-core` to deterministically extract the `MU` UI Model skeleton rather than relying on an LLM to re-infer screen and element IDs from raw HTML.

