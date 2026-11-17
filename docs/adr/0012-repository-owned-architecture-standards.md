# Repository-Owned Architecture Standards

Reusable architecture specifications and development standards are maintained as version-controlled files in the `ontology-plus` source repository, and applications explicitly select the standards they consume. Personal or team online standards-library management is deferred for this stage so that the standards can be reviewed, maintained, and delivered alongside the platform source.

The repository files are the authoritative source for these standards. Runtime catalogs or database projections must retain that source relationship; saving an unrelated database copy is not sufficient to maintain a repository-owned standard. This replaces the current seed-only relationship, where source changes do not reach an existing workspace and runtime edits do not update source files.

Applications select a Technology Profile covering frontend, backend, persistence, deployment guidance, and the matching development standards. The first profile is:

| Concern | Selection |
| --- | --- |
| Frontend | React + Vite |
| Routing | TanStack Router |
| Client state | Zustand |
| UI components | shadcn/ui with Base UI primitives |
| HTTP backend | Hono |
| Persistence | Drizzle ORM + SQLite |
| Runtime and deployment | Node.js, with a complete local development and Node.js deployment path |

Additional profiles extend the repository catalog. Cloudflare Workers/D1 is deferred to a separate future profile. These profiles organise the implementation specification for a coding agent, consistent with the specification-first delivery boundary in ADR 0011.
