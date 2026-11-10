# SQLite Dialect Everywhere Behind a Workspace Store Seam

We standardize on the SQLite dialect (`drizzle-orm/sqlite-core`) across all environments—Cloudflare D1 and Durable Object SQLite at the edge, and local SQLite (`wrangler dev` / `libsql`) on the developer machine—rather than PGlite (PostgreSQL dialect), avoiding schema and query split between local and Cloudflare deployments. Because Cloudflare Workers lack a host filesystem, authoritative 11-model YAML snapshots and metadata live behind the `workspace-store` seam in SQLite, with adapters that mirror to `onto-cs/model/{projectId}/yaml/*.yaml` on local disk or export/sync via browser File System Access API and ZIP bundles.

