# Derived Read-Only Knowledge Graph Canvas and Bidirectional Tiptap Markdown

We render the 11-model Ontology Knowledge Graph with `@xyflow/react`, `elkjs` (compound model-stage swimlanes with port-based orthogonal obstacle-avoiding edge routing), and `d3-force` (1–2 hop ego neighborhood subgraphs), keeping the graph strictly as a derived visualization, impact-tracing, and navigation projection rather than allowing direct untyped edge drawing on the canvas, because cross-model edges in Ontology Plus are projections of typed AST fields (`ownerEntity`, `producedEvents`, `referencedObjects`, `boundBehaviorId`) enforced by `ontology-core`.

Document-centric Markdown assets (SRS specifications, Four-Layer Architecture specs, Knowledge Center entries, Data documents, Analytics reports, and post-compilation `SKILL.md` refinements) use browser-side `@tiptap/react` v3 with `@tiptap/markdown` for bidirectional rich-text and raw `.md` editing, while streaming agent transcripts and compiled development-package guides use a lightweight GFM, syntax-highlight, and Mermaid renderer.

