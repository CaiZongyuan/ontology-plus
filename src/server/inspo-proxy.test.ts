import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceStore, type VisualReferenceItem } from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';
import { buildSanitizedRecommendBrief } from './inspo-proxy.js';

const tempDirs: string[] = [];

function createIsolatedDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onto-inspo-proxy-'));
  tempDirs.push(dir);
  return path.join(dir, 'test.db');
}

afterEach(() => {
  vi.unstubAllGlobals();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('Inspo MCP proxy, privacy-safe recommend desensitization, and offline fallback', () => {
  it('strips all SRS raw clauses, project name, project code, customer names, and numbers from outbound recommend requests and parses exemplars', async () => {
    const store = createWorkspaceStore({ dbPath: createIsolatedDbPath(), enableFileMirror: false });

    const secretProject = store.createProject({
      name: '华泰星辰核心清结算工作台',
      code: 'PROJ-HTXC-9921',
      domain: '企业金融清结算与对账风控',
      description: '面向恒远海运集团的机密资金清分系统',
      template: 'EMPTY',
    });

    const sensitiveSrsContent = [
      '# 华泰星辰核心清结算工作台（PROJ-HTXC-9921）需求规格说明书',
      '1. 客户主体：恒远海运集团（统一社会信用代码 91310000MA1FL8829X）与 DeepVault Holdings。',
      '2. 机密规则：当单笔跨境结算单金额超过 3,580,000 元，或命中内部密钥 SEC-TOKEN-88412 时，自动冻结监管专户 62220219998812 并通知财务总监林晓峰。',
      '3. 页面需要高密度台账表格，浅色严谨风格。',
    ].join('\n');

    store.saveRequirementDoc({
      id: 'doc-secret-srs',
      projectId: secretProject.id,
      title: '恒远海运集团机密清结算 SRS v1.0',
      version: 'v1.0',
      status: 'CONFIRMED',
      content: sensitiveSrsContent,
    });

    // Direct unit check on buildSanitizedRecommendBrief
    const sanitized = buildSanitizedRecommendBrief({
      projectName: secretProject.name,
      projectCode: secretProject.code,
      domain: secretProject.domain,
      srsText: sensitiveSrsContent,
    });
    expect(sanitized.industry).toBe('fintech');
    expect(sanitized.mode).toBe('light');
    expect(sanitized.keywords).toEqual(expect.arrayContaining(['serious', 'tabular', 'high-density']));

    const outboundBodies: string[] = [];
    const mockFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = String(init?.body ?? '');
      outboundBodies.push(rawBody);
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  brief: sanitized.brief,
                  filters: { inferredMode: 'light' },
                  pick: {
                    macrostructure: { slug: 'index-first', label: 'Index-First' },
                    rationale: 'Structured ledger hierarchy.',
                  },
                  exemplars: [
                    {
                      slug: 'increase-com',
                      title: 'Increase',
                      northstar: 'Banking precision',
                      palette: ['#04b2f2', '#1d445a'],
                      fonts: ['IBM Plex Sans'],
                      mode: 'light',
                      macro: 'index-first',
                      tags: 'fintech, banking',
                    },
                    {
                      slug: 'ramp-com--cards',
                      title: 'Ramp Corporate Cards',
                      northstar: 'Clean spend ledger',
                      palette: ['#e4f222', '#1c1b17'],
                      fonts: ['Inter'],
                      mode: 'light',
                      macro: 'stat-led',
                      sourceUrl: 'https://ramp.com/cards',
                    },
                  ],
                }),
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', mockFetch);

    const app = createApiApp(store);
    const res = await app.request('/api/prototype-inspo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'recommend',
        projectId: secretProject.id,
        projectName: secretProject.name,
        projectCode: secretProject.code,
        srsText: sensitiveSrsContent,
        brief: sensitiveSrsContent,
      }),
    });

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const sentBody = outboundBodies[0]!;
    const forbiddenSubstrings = [
      '华泰星辰',
      'PROJ-HTXC-9921',
      'HTXC',
      '恒远海运',
      '91310000MA1FL8829X',
      'DeepVault',
      '3,580,000',
      '3580000',
      'SEC-TOKEN-88412',
      '62220219998812',
      '林晓峰',
      '监管专户',
    ];
    for (const secret of forbiddenSubstrings) {
      expect(sentBody).not.toContain(secret);
    }

    const parsedRpc = JSON.parse(sentBody) as {
      params: { name: string; arguments: Record<string, unknown> };
    };
    expect(parsedRpc.params.name).toBe('recommend');
    expect(parsedRpc.params.arguments.industry).toBe('fintech');
    expect(parsedRpc.params.arguments.mode).toBe('light');

    const json = (await res.json()) as {
      ok: boolean;
      attributedTo: string;
      items: VisualReferenceItem[];
      pick?: { macrostructure?: { slug: string } };
    };
    expect(json.ok).toBe(true);
    expect(json.attributedTo).toBe('Inspo');
    expect(json.items).toHaveLength(2);
    expect(json.items[0]?.slug).toBe('increase-com');
    expect(json.items[0]?.sourceDomain).toBe('increase.com');
    expect(json.items[0]?.sourceUrl).toBe('https://increase.com');
    expect(json.items[1]?.slug).toBe('ramp-com--cards');
    expect(json.items[1]?.sourceDomain).toBe('ramp.com');
    expect(json.items[1]?.sourceUrl).toBe('https://ramp.com/cards');
    expect(json.pick?.macrostructure?.slug).toBe('index-first');
  });

  it('caches search, recommend, design_system, and filters in workspace-store across separate app instances without re-calling upstream fetch', async () => {
    const store = createWorkspaceStore({ dbPath: createIsolatedDbPath(), enableFileMirror: false });

    const mockFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const rpcReq = JSON.parse(String(init?.body ?? '{}')) as {
        params?: { name?: string };
      };
      const toolName = rpcReq.params?.name;

      if (toolName === 'get_design_system') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {
              content: [{ type: 'text', text: '# Linear Design System\n\n- Accent: `#5e6ad2`' }],
            },
          }),
          { status: 200 },
        );
      }

      if (toolName === 'get_filters') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {
              content: [{ type: 'text', text: JSON.stringify({ modes: ['light', 'dark'] }) }],
            },
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  results: [
                    {
                      slug: 'linear-app',
                      title: 'Linear',
                      northstar: 'Precision issue tracking',
                      palette: ['#5e6ad2', '#08090a'],
                      fonts: ['Inter'],
                      mode: 'dark',
                      macro: 'split-studio',
                    },
                  ],
                }),
              },
            ],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', mockFetch);

    // First app instance populates workspace-store cache
    const app1 = createApiApp(store);

    const searchRes1 = await app1.request('/api/prototype-inspo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'search', query: '深色研发工作台', mode: 'dark' }),
    });
    const searchJson1 = (await searchRes1.json()) as { ok: boolean; items: VisualReferenceItem[] };
    expect(searchJson1.ok).toBe(true);
    expect(searchJson1.items[0]?.slug).toBe('linear-app');
    expect(searchJson1.items[0]?.sourceDomain).toBe('linear.app');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const mdRes1 = await app1.request('/api/prototype-inspo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'design_system', slug: 'linear-app' }),
    });
    const mdJson1 = (await mdRes1.json()) as { ok: boolean; markdown: string };
    expect(mdJson1.ok).toBe(true);
    expect(mdJson1.markdown).toContain('# Linear Design System');
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const filtersRes1 = await app1.request('/api/prototype-inspo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'filters' }),
    });
    expect(filtersRes1.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Second app instance has NO shared in-memory Map — must hit workspace-store SQLite cache!
    const app2 = createApiApp(store);

    const searchRes2 = await app2.request('/api/prototype-inspo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'search', query: '深色研发工作台', mode: 'dark' }),
    });
    const searchJson2 = (await searchRes2.json()) as {
      ok: boolean;
      source: string;
      items: VisualReferenceItem[];
    };
    expect(searchJson2.ok).toBe(true);
    expect(searchJson2.source).toBe('cache');
    expect(searchJson2.items[0]?.slug).toBe('linear-app');

    const mdRes2 = await app2.request('/api/prototype-inspo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'design_system', slug: 'linear-app' }),
    });
    const mdJson2 = (await mdRes2.json()) as { ok: boolean; source: string; markdown: string };
    expect(mdJson2.ok).toBe(true);
    expect(mdJson2.source).toBe('cache');
    expect(mdJson2.markdown).toContain('# Linear Design System');

    const filtersRes2 = await app2.request('/api/prototype-inspo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'filters' }),
    });
    const filtersJson2 = (await filtersRes2.json()) as { ok: boolean; source: string };
    expect(filtersJson2.ok).toBe(true);
    expect(filtersJson2.source).toBe('cache');

    // Upstream fetch was NEVER called again!
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('falls back cleanly to CURATED_INSPO_CATALOG when Inspo MCP times out or is unreachable', async () => {
    const store = createWorkspaceStore({ dbPath: createIsolatedDbPath(), enableFileMirror: false });

    const failingFetch = vi.fn(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    vi.stubGlobal('fetch', failingFetch);

    const app = createApiApp(store);

    const recRes = await app.request('/api/prototype-inspo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'recommend', industry: 'fintech', mode: 'light' }),
    });
    expect(recRes.status).toBe(200);
    const recJson = (await recRes.json()) as {
      ok: boolean;
      fallback: boolean;
      source: string;
      items: VisualReferenceItem[];
    };
    expect(recJson.ok).toBe(true);
    expect(recJson.fallback).toBe(true);
    expect(recJson.source).toBe('curated');
    expect(recJson.items.length).toBeGreaterThanOrEqual(3);
    expect(recJson.items.every((i) => Boolean(i.sourceDomain && i.sourceUrl))).toBe(true);

    const mdRes = await app.request('/api/prototype-inspo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'design_system', slug: 'increase-com' }),
    });
    expect(mdRes.status).toBe(200);
    const mdJson = (await mdRes.json()) as {
      ok: boolean;
      fallback: boolean;
      markdown: string;
    };
    expect(mdJson.ok).toBe(true);
    expect(mdJson.fallback).toBe(true);
    expect(mdJson.markdown).toContain('Increase');
  });
});
