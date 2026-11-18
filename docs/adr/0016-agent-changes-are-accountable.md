# Agent Changes Are Accountable: Computed Change Summary, Run-Level Undo, Step Confirmation

ADR 0007 lets agents act without asking, guarded by the validator and undo snapshots. To a business person that guard was invisible: undo was a stack over the whole suite held in browser memory, it was not offered where the agent reported its work, and what a run had changed could only be read from tool traces. We considered Attio's pattern of accepting or rejecting each suggestion and kept autonomy instead, making it accountable. Every `Agent Run` that changes something ends with a `Change Summary` computed from the difference between the result before and after the run and worded in business names. The run can be undone from that summary. Each `Project Step` ends with a `Step Confirmation`. A change upstream marks later results `Outdated` and never rewrites them.

## Considered Options

- **Accept or reject each change.** Rejected: a business person cannot evaluate a single model edit, so approval turns into a reflex. What they can judge is whether the result is right and whether they can go back.
- **Tiered approval: small changes apply, large ones need an approved plan.** Rejected for now: the confirmations at step boundaries already gate what moves forward, and a tier adds a judgment about "large" that the user cannot check.
- **A Change Summary written by the agent.** Rejected: one omission or wrong statement destroys trust, while a computed list can be relied on. The agent may add one sentence saying why.
- **Undo any earlier run in place.** Rejected: it needs merge logic, and a wrong merge is the failure that costs the most trust.

## Consequences

- Undo is linear. One-click undo is offered on the most recent change to a result. An earlier point is reached by restoring to before a given change, which appends a new state as ADR 0010 does for prototypes, so later work is kept and the restore can itself be undone. Manual edits and agent runs share one history.
- The state before each run or manual save is persisted on the server (one row per entry, retaining the most recent 50 entries per artifact), so undo and restore survive a reload.
- `ontology-core` provides a typed difference computation across the whole `Ontology Suite` alongside the UI Model diff and markdown section diff for requirements documents, powering deterministic `Change Summaries` grouped by Business Object.
- The Business Model step gains a Step Confirmation, allowed only when there are no Consistency Errors. Only a confirmed result is the input of the next step.
- The rule of ADR 0010 now covers every step: no result is rewritten because an earlier step changed. `Outdated` propagates one direct step at a time (re-confirming `Requirements` marks `Prototype` `Outdated`; `Business Model` becomes `Outdated` once `Prototype` is re-confirmed; `Delivery` derives `Not started`, `In progress`, `Confirmed`, and `Outdated` from the `Business Model` confirmation and `Package Snapshot`). An `Outdated` step offers both "Ask AI Assistant to update" as its primary action and "Confirm as-is without changes" as a secondary action (#48).
- While a run is in progress the Business View shows progress in business language; tool calls, thinking, and counts sit under details. A platform problem such as an unconfigured LLM gateway is reported as "the AI service is unavailable; contact whoever set this up", and the link required by ADR 0007 is kept.
