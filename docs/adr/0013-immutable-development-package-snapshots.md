# Immutable Development Package Snapshots

Each generation produces an immutable Package Snapshot from fixed application inputs: requirements, the confirmed prototype revision, an Ontology Suite snapshot, the selected Technology Profile and standards, and application-specific instructions. The package retains its source identities and revisions so that the material handed to a coding agent can be traced back to the reviewed inputs.

Preview and download use the same generated snapshot rather than recompiling the current workspace during download. Later source changes are shown as changes awaiting regeneration; an explicit generation creates a new snapshot while the previous package remains unchanged. This replaces the current live-export behavior, where download can silently incorporate inputs that differ from those previously previewed.
