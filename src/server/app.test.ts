import { describe, expect, it } from 'vitest';
import { createWorkspaceStore } from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';
import workerEntry, { type CloudflareD1Database } from './worker.js';

describe('server API & Cloudflare Worker integration', () => {
  it('serves health, bootstrap, security headers, ZIP package download, MCP SQL tools, and read-only SQL sandbox', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);

    const healthRes = await app.request('/api/health');
    expect(healthRes.status).toBe(200);
    expect(healthRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(healthRes.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');

    const bootRes = await app.request('/api/bootstrap');
    expect(bootRes.status).toBe(200);
    const bootJson = (await bootRes.json()) as {
      activeProject: { id: string; validation: { errorCount: number } };
      capabilityChatSessions: unknown[];
    };
    expect(bootJson.activeProject.id).toBe('proj-contract');
    expect(bootJson.activeProject.validation.errorCount).toBe(0);
    expect(Array.isArray(bootJson.capabilityChatSessions)).toBe(true);

    // Verify PKZIP development package HTTP download
    const zipRes = await app.request('/api/applications/app-contract-clm/package.zip');
    expect(zipRes.status).toBe(200);
    expect(zipRes.headers.get('Content-Type')).toBe('application/zip');
    const zipBuf = new Uint8Array(await zipRes.arrayBuffer());
    expect(zipBuf[0]).toBe(0x50);
    expect(zipBuf[1]).toBe(0x4b);

    // Verify read-only SQL endpoint enriches __label and blocks DDL/DML
    const sqlOk = await app.request('/api/analytics/sql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: 'SELECT contract_no, status, total_amount FROM t_contract LIMIT 3',
      }),
    });
    expect(sqlOk.status).toBe(200);
    const sqlData = (await sqlOk.json()) as { rows: Record<string, unknown>[] };
    expect(sqlData.rows.length).toBeGreaterThan(0);
    expect(sqlData.rows[0].status__label).toBeTruthy();

    const sqlBlocked = await app.request('/api/analytics/sql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: 'DROP TABLE t_contract' }),
    });
    expect(sqlBlocked.status).toBe(400);

    // Verify MCP server executes real SQLite rows on M7 query tools
    const capsRes = await app.request('/api/mcp/proj-contract/capabilities');
    const capsJson = (await capsRes.json()) as {
      tools: { name: string; sourceModel: string }[];
    };
    const m7Tool = capsJson.tools.find((t) => t.sourceModel === 'M7' && t.name.startsWith('m7_'))!;
    expect(m7Tool).toBeTruthy();

    const mcpRes = await app.request('/api/mcp/proj-contract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'q-1',
        method: 'tools/call',
        params: {
          name: m7Tool.name,
          arguments: {},
        },
      }),
    });
    expect(mcpRes.status).toBe(200);
    const mcpJson = (await mcpRes.json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(mcpJson.result.isError).toBe(false);
    expect(mcpJson.result.content[0].text).toContain('t_contract');
  });

  it('executes Cloudflare Worker fetch handler with simulated D1 binding cleanly', async () => {
    const executedQueries: string[] = [];
    const mockD1: CloudflareD1Database = {
      async exec(query: string) {
        executedQueries.push(query);
        return {};
      },
      prepare(query: string) {
        executedQueries.push(query);
        return {
          bind() {
            return this;
          },
          async run() {
            return {};
          },
          async all<T>() {
            return { results: [] as T[] };
          },
          async first<T>() {
            return null as T | null;
          },
        };
      },
    };

    const res = await workerEntry.fetch(
      new Request('https://ontology-plus.workers.dev/api/health'),
      { ONTOLOGY_DB: mockD1 },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe('ontology-plus');
    expect(executedQueries.length).toBeGreaterThan(0);
  });
});
