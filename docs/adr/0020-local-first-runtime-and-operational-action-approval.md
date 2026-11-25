# Local-First Dual Runtime and Operational Action Approval Regime

We run both the Ontology Plus control plane and connected reference applications (starting with TeaCo) local-first on Node and local SQLite through P0–P4, deferring Cloudflare Workers/D1/Durable Object deployment smoke and any control-plane SQLite DO migration to P5 rather than rewriting the synchronous `workspace-store` and `agent-runtime` seams into async D1 upfront. At the same time, we split agent tool execution into two explicit regimes: design-time modeling tools inside the four `Project Steps` remain autonomous ("YOLO") with `Artifact History` undo per ADR 0007, whereas any runtime mutation against a connected business application must pass `prepare → explicit human approval (bound to action, argument hash, target entity version, actor, and expiry) → invoke → authoritative readback verification`.

## Considered Options

- **Rewrite `workspace-store` and `agent-runtime` to async Cloudflare D1 in P0.** Rejected: roughly 13k LOC of synchronous `node:sqlite` callers would be refactored before validating the live operational loop, and Cloudflare Free runtime limits would block early product progress.
- **Extend ADR 0007's YOLO mode to live external business actions.** Rejected: unlike workspace modeling drafts backed by `Artifact History` undo, external business mutations (such as shipping inventory or repairing imported records) create irreversible real-world side effects and require server-verified authorization, idempotency, and version-bound human sign-off.
- **Build multi-user IAM inside Ontology Plus before connecting TeaCo.** Rejected: Ontology Plus remains a single-user local workbench for now; multi-role authorization is enforced by the business application (TeaCo), while Ontology Plus's server-side Capability Gateway binds scoped delegated credentials per role without ever exposing secrets or role self-assertion to the LLM context.

## Consequences

- Both processes stay strictly on the SQLite dialect (`drizzle-orm/sqlite-core`), avoid paid cloud services, graph databases, vector stores, and resident Python services, and keep TeaCo's domain logic free of Node-only APIs so P5 Cloudflare Workers + D1 portability remains intact.
- When Ontology Plus later targets Cloudflare Free, control-plane state migrates to a SQLite-backed Durable Object (`ctx.storage.sql` is synchronous) rather than rewriting every store caller to async D1.
- Runtime approvals automatically invalidate whenever arguments, target entity version, actor authorization, or confirmed `Ontology Suite` revision changes; execution timeouts enter `UNKNOWN` and reconcile by idempotency key instead of blindly retrying.
- Amends ADR 0007's single-regime autonomous tool policy for connected runtime mutations.

## Amendments

- **2026-11-25: no authentication between the control plane and a connected application (TeaCo spec v0.3.1).** While running local-first, Ontology Plus connects to an application by its address and reads its `Connection Manifest`; there is no login handshake, token, or managed credential. The application declares the identities one may act as; the user picks one in the Operations Console, and the server sends it with every request (`X-Ontology-Plus-Actor`), so the AI can neither choose nor change it. The application enforces scope and write permissions for that identity, and its runtime interface listens on loopback by default; external deployment (P5) must revisit this. The approval regime is unchanged except that the preauthorized path is removed: every runtime write needs explicit approval.
