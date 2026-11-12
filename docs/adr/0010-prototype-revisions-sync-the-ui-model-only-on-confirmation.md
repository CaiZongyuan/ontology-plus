# Prototype Revisions Sync the UI Model Only on Confirmation

Every save of an `Interactive Prototype` used to re-extract the `MU` UI Model, so each AI refinement experiment mutated the `Ontology Suite`, and going back to an earlier prototype could not undo what it had done to the suite. We decided that saving produces only an immutable `Prototype Revision` and never touches the suite; `MU` is extracted only when the user confirms a revision, after seeing the `MU` changes that confirmation would make. Each `Ontology Project` has exactly one `Confirmed Revision`, and it is the only prototype state that `MU` extraction and Ontology Suite synthesis read.

Restoring an older revision appends a new revision with the same content instead of rewriting history, and leaves the `Confirmed Revision` where it is until the user confirms again.

## Considered Options

- **Keep syncing `MU` on every save.** Rejected: the suite is the single source of truth, and it should not change because the user tried something in the prototype.
- **Sync automatically from the newest revision when synthesis starts.** Rejected: the user would not know which prototype state the suite was built from, and an unfinished experiment could become the source.

## Consequences

- The prototype on screen can be ahead of the `Confirmed Revision`, so the interface has to show how far ahead it is.
- Confirming a newer revision after the suite has been synthesized re-extracts `MU` only. Re-synthesizing the other models stays a separate explicit action, because it could overwrite manual edits made in the ontology workbench.
- A prototype that holds the `Confirmed Revision` cannot be deleted until another revision is confirmed.
