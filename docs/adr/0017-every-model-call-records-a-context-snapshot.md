# Every Model Call Records a Context Snapshot

The conversation showed token counts that the engine invented (an estimate split 65/35 into input and output), and nothing recorded what a `Model Call` actually sent: the session engine silently keeps only the last 8 or 18 messages plus a compacted summary, so neither a developer nor a curious business user could tell what the `AI Assistant` remembered. We decided that every `Model Call` persists a `Context Snapshot` on the server through `workspace-store`: the assembled instructions, tool definitions, injected business context, and the messages it included and those it left out, each stored once per content hash and tagged with the session message it came from (compaction deletes session messages, so a reference alone would not survive), together with the usage the provider reported, including cache reads. The `Context Inspector` reads only these snapshots; a figure the provider did not report is shown as an estimate and labelled so. This is visible to everyone behind a closed-by-default drawer rather than behind an expert mode, which ADR 0014 rejected.

## Considered Options

- **Estimate in the browser from session messages.** Rejected: the browser cannot see the system prompt, tool schemas, sliding window, or cache usage, so the view would explain a context that never existed.
- **Store the full prompt text for every call.** Rejected: instructions and tool schemas repeat on nearly every call, multiplying storage by the call count for no extra information.
- **Show the inspector only in development builds.** Rejected: the people who most need to know why the assistant "forgot" something are the users of a deployed workbench.

## Consequences

- Messages a compaction removes are archived with the compaction event, so they stay inspectable after the session forgets them.
- Each session keeps full snapshots for its most recent 200 Model Calls; older calls keep only their usage figures.
- Subagent Model Calls record snapshots under the parent Agent Run so the inspector can show them as separate lanes.
- In the Mock mode of ADR 0007, snapshots are recorded as usual and their usage is labelled simulated, never presented as provider-reported.
- The engine's existing message window (the last 8 or 18 messages) is unchanged by this decision; the inspector makes it visible by listing what each Model Call left out.
- Snapshots hold project content, so they follow the same project scoping and deletion as the Agent Session they belong to.
