# TypeScript Deep-Module Monorepo with Hono, Drizzle, TanStack, and Pi Durable

We will build `ontology-plus` as a single TypeScript monorepo (`pnpm` workspace) structured around **deep modules** (`src/packages/<name>/` with root entry points, private `lib/` implementations, and `tests/` enforced by `dependency-cruiser`). The stack uses Hono for the HTTP/RPC layer, Drizzle ORM + Zod for persistence and schema validation, `@earendil-works/pi-durable` (`@earendil-works/pi-ai` / `@mariozechner/pi-agent-core`) for lightweight crash-resumable agent loops, and React + TanStack Router + TanStack Query + Zustand + `shadcn/ui` (`@base-ui/react`) on the frontend.

Sharing a single TypeScript `ontology-core` deep module across client and server guarantees that the 11-model YAML parser, AST validator, cross-model reference checker, and knowledge-graph builder execute identical logic in browser editors and server/edge gates without dual-language drift.

