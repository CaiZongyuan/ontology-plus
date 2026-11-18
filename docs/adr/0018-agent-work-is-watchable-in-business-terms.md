# Agent Work Is Watchable in Business Terms

The people who use the workbench know the business but not the technology, and the project lives or dies on whether they trust what the `AI Assistant` produces. Waiting in front of a spinner and then receiving a finished result asks for blind trust; showing them HTML, tool logs, or model reasoning asks them to read something they cannot judge. We decided that agent work must be **visible while it happens** and **understandable without technical knowledge**: a running `Agent Run` shows its plan and its progress as the result itself taking shape (a prototype screen drawn section by section, a document written paragraph by paragraph), narrated in business language, and never as generated code. Every on-screen sign of activity comes from something the agent is actually doing; nothing is scripted to look busy. ADR 0014 named trust as a measure of the redesign; this decision makes it a rule for how every Agent Run presents itself.

The Prototype step is the first place this applies: an `Interactive Prototype` is generated as a visible `Build Plan`, then a `Style Tile`, then screens that grow live on the canvas, and the finished prototype carries `Prototype Notes` and `Demo Tours` so the user can understand and replay it without reading the screens' source.

## Considered Options

- **Show the code or tool log as it streams.** Rejected: it proves activity but not understanding, and the people we build for cannot judge it.
- **A progress bar or percentage with a finished result at the end.** Rejected: it is a black box with a clock on it; the user still has to trust a result they did not see being made.
- **Simulated activity (scripted cursors, canned status lines) to make waiting feel shorter.** Rejected: the first time a user notices a cursor that was not real, every other signal loses its credibility.

## Consequences

- Narration lines are derived from what the agent writes (element and section notes, plan entries), not guessed from its reasoning text.
- An Agent Run's plan is shown before its work starts, and each planned item reports its own state, including failure, in one business-language sentence with a way to continue.
- Technical views (Technical Details, the `Context Inspector`) remain available on demand; this decision governs the default view, not what an expert may open.
