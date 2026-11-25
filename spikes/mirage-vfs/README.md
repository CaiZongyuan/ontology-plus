# Mirage VFS spike (TeaCo spec §9.1, ADR 0021)

A reproducible check that Mirage works with `@earendil-works/pi-durable` 1.5.2, from published
packages pinned to exact versions with this folder's own lockfile — never from `references/mirage/`.

```bash
cd spikes/mirage-vfs && pnpm install && pnpm spike
```

No language model is needed: Pi AI's deterministic faux model asks for a tool and Mirage runs it.
It checks that

1. a TeaCo snapshot (Business Bench `order_lines.csv`) mounted read-only at `/teaco` can be read by
   the Mirage shell and refuses writes (`Read-only file system`);
2. a scratch mount `/work` accepts writes;
3. Pi Durable's `ExecutionEnv` over the workspace (`MirageExecutionEnv`) runs commands inside Mirage
   and cannot write the snapshot;
4. a real Pi Durable `Harness` with `CodingTools` and `mirageExtension` runs its `bash` tool inside
   Mirage (it sees `/teaco` and `/work`, not this machine) and completes the turn.

Result on 2026-11-26 (Node 24, Linux): 7/7 passed. Versions: pi-durable 1.5.2, pi-ai 1.5.2,
chord 1.5.2, @struktoai/mirage-node 0.1.0, @struktoai/mirage-pi-durable 0.1.0.

Not covered here: Mirage on Cloudflare (`@struktoai/mirage-cloudflare`, spec P5) and the runtime
query sessions that would use this environment in Ontology Plus itself.
