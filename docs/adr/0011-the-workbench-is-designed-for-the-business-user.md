# The Workbench Is Designed for the Business User: Conversation and Canvas

The workbench had grown as a modeler's tool: 25 navigation entries in five centers, form editors as the way to change things, and model codes, identifiers, and file formats in everyday copy. A person who knows the business but not the technology could not get through it, and a palette swap (the Hex shell rejected in ADR 0006) had already shown that the colours were not the problem. We decided that there is one interface and that its default is designed for that business person. Inside an `Ontology Project` the user works by talking to one `AI Assistant` beside a canvas that shows the result of the current `Project Step` (Requirements, Prototype, Business Model, Delivery). The canvas opens in a `Business View`, written in business names and organised around Business Objects; `Technical Details` (the existing structured editors, YAML, and knowledge graph) open on demand from the same object.

The redesign is judged by how much each screen shows, whether a business person can finish the steps unaided, and whether they trust the assistant. Resemblance to a visual reference comes second.

## Considered Options

- **A Business mode and an Expert mode behind a global switch.** Rejected: every screen would be designed, tested, and maintained twice, and the simple mode becomes the second-class one. With one interface both kinds of user look at the same object.
- **Keep the form workbench and improve the side assistant.** Rejected: the forms are the part a business person cannot operate. What they can do is say what they want and check the result.
- **A model-centred Business View: eleven lists under friendlier names.** Rejected: business people think in "Contract" and "Supplier", not in "Behavior Model". The eleven-model organisation stays in Technical Details.
- **Rebuild expert editing inside the Business View.** Rejected: the existing editors work, and reusing them as Technical Details keeps expert capability at low cost.

## Consequences

- Every Business View screen is reviewed against five rules: it answers one question and has one primary action; it shows no codes, identifiers, or file-format names; content nests at most two levels; only what the user must judge is open by default; every state says in one sentence what is the case and what to do next.
- Business names map one-to-one to glossary terms (the "Shown to business users as" lines in `GLOSSARY.md`). No model is merged or renamed in the suite.
- The four Project Steps replace the ten Application Center entries. The Capability Center, the Data Analytics Center, and Platform Governance keep their current pages behind a secondary entry until each gets its own spec.
- The Delivery step ends in a slot. Today it says the blueprint is ready to hand over; a runnable system is a separate capability that will fill the same place.
- The workbench is desktop first (1280px and up). On narrower screens the conversation and the canvas alternate.
- The presentation of ADR 0009 changes (see its amendment); its engine does not.
