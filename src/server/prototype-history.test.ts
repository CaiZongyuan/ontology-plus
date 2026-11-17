import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { checkBusinessViewMarkup } from '../packages/business-vocabulary/index.js';
import {
  createWorkspaceStore,
  type ArtifactHistoryEntryView,
  type InteractivePrototype,
} from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';

function jsonInit(method: string, body: unknown, locale = 'zh-CN'): RequestInit {
  return {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Onto-Locale': locale,
    },
    body: JSON.stringify(body),
  };
}

describe('HTTP Prototype Unified History, Business Screen Change Summary, Undo & Append-Only Restore (#67)', () => {
  it(
    'projects PROTOTYPE_CO_DESIGN revisions via computeMuDiff in clean business names, omits no-op runs, unifies manual saves, enforces latest-only 409 Undo across reloads, and supports append-only Restore + Undo of Restore without duplicating HTML',
    { timeout: 30_000 },
    async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onto-http-proto-hist-67-'));
      const dbPath = path.join(tmpDir, 'workspace.db');

      let gatewayStep = 0;
      const noopLlmServer = http.createServer(async (req, res) => {
        for await (const _chunk of req) {
          // drain request body
        }
        if (req.url?.endsWith('/chat/completions')) {
          gatewayStep += 1;
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
          });
          if (gatewayStep === 1) {
            res.write(
              `data: ${JSON.stringify({
                id: 'chatcmpl-proto-noop-1',
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: 'proto-hist-67-model',
                choices: [
                  {
                    index: 0,
                    delta: {
                      role: 'assistant',
                      tool_calls: [
                        {
                          index: 0,
                          id: 'call_inspect_anchors_67',
                          type: 'function',
                          function: {
                            name: 'list_prototype_anchors',
                            arguments: JSON.stringify({}),
                          },
                        },
                      ],
                    },
                    finish_reason: 'tool_calls',
                  },
                ],
              })}\n\n`,
            );
            res.end('data: [DONE]\n\n');
            return;
          }

          res.write(
            `data: ${JSON.stringify({
              id: 'chatcmpl-proto-noop-2',
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: 'proto-hist-67-model',
              choices: [
                {
                  index: 0,
                  delta: {
                    role: 'assistant',
                    content: '已为你检查当前原型的页面布局与筛选控件，无需做任何改动。',
                  },
                  finish_reason: 'stop',
                },
              ],
            })}\n\n`,
          );
          res.end('data: [DONE]\n\n');
          return;
        }
        res.writeHead(404).end();
      });

      await new Promise<void>((resolve) => noopLlmServer.listen(0, '127.0.0.1', () => resolve()));
      const noopPort = (noopLlmServer.address() as AddressInfo).port;

      const store1 = createWorkspaceStore({ dbPath, enableFileMirror: false });
      store1.updateSystemSettings({ mockLlmMode: true });
      const api1 = createApiApp(store1);

      let projectId = '';
      let prototypeId = '';
      let r1EntryId = '';
      let r2EntryId = '';
      let r3ManualEntryId = '';
      let htmlR1 = '';
      let htmlR2 = '';
      let htmlR3 = '';

      try {
        // 1. Create empty project & run a blocked/no-op PROTOTYPE_CO_DESIGN turn before Requirements is confirmed
        const createProjRes = await api1.request(
          '/api/projects',
          jsonInit('POST', {
            name: '资产盘点与调拨系统',
            code: 'ASSET_PROTO_67',
            domain: '固定资产盘点调拨',
            template: 'EMPTY',
          }),
        );
        expect(createProjRes.status).toBe(200);
        const { project } = (await createProjRes.json()) as { project: { id: string } };
        projectId = project.id;

        const unboundSessRes = await api1.request(
          '/api/agent-sessions',
          jsonInit('POST', { projectId, agentKind: 'PROTOTYPE_CO_DESIGN' }),
        );
        expect(unboundSessRes.status).toBe(200);
        const { session: protoSession } = (await unboundSessRes.json()) as {
          session: { id: string };
        };

        const blockedNoopRes = await api1.request(
          `/api/agent-sessions/${protoSession.id}/stream`,
          jsonInit('POST', {
            prompt: '先帮我看一下原型应该怎么布局',
            mockMode: true,
          }),
        );
        expect(blockedNoopRes.status).toBe(200);
        expect(await blockedNoopRes.text()).toContain('event: message_end');

        const histAfterBlockedRes = await api1.request(
          `/api/projects/${projectId}/history?kind=PROTOTYPE`,
        );
        expect(histAfterBlockedRes.status).toBe(200);
        const histAfterBlocked = (await histAfterBlockedRes.json()) as {
          entries: ArtifactHistoryEntryView[];
        };
        expect(histAfterBlocked.entries).toEqual([]);

        // 2. Save & confirm Requirements, then run PROTOTYPE_CO_DESIGN to generate initial R1
        const docSaveRes = await api1.request(
          '/api/requirements/docs',
          jsonInit('POST', {
            id: 'rdoc-asset-67',
            projectId,
            title: '固定资产盘点需求书',
            version: 'v1.0',
            status: 'DRAFT',
            content: [
              '# 固定资产盘点需求书',
              '',
              '## 1. 核心业务对象',
              '- 围绕**资产盘点单**与**资产调拨单**支持扫码盘点与跨部门调拨审批。',
            ].join('\n'),
          }),
        );
        expect(docSaveRes.status).toBe(200);
        const confirmReqRes = await api1.request(
          `/api/projects/${projectId}/steps/requirements/confirm`,
          jsonInit('POST', { docId: 'rdoc-asset-67' }),
        );
        expect(confirmReqRes.status).toBe(200);

        const r1StreamRes = await api1.request(
          `/api/agent-sessions/${protoSession.id}/stream`,
          jsonInit('POST', {
            prompt: '根据已确认需求生成资产盘点首版交互原型',
            mockMode: true,
          }),
        );
        expect(r1StreamRes.status).toBe(200);
        expect(await r1StreamRes.text()).toContain('event: message_end');

        const protosAfterR1 = store1.listPrototypes(projectId);
        expect(protosAfterR1).toHaveLength(1);
        prototypeId = protosAfterR1[0]!.id;
        htmlR1 = protosAfterR1[0]!.htmlContent;

        const histAfterR1Res = await api1.request(
          `/api/projects/${projectId}/history?kind=PROTOTYPE&prototypeId=${encodeURIComponent(prototypeId)}`,
        );
        expect(histAfterR1Res.status).toBe(200);
        const histAfterR1 = (await histAfterR1Res.json()) as {
          entries: ArtifactHistoryEntryView[];
        };
        expect(histAfterR1.entries).toHaveLength(1);
        r1EntryId = histAfterR1.entries[0]!.id;
        expect(histAfterR1.entries[0]!.changeSummary.canUndo).toBe(false);

        // Undo on R1-only prototype cleanly returns 409 NOTHING_TO_UNDO with Business View-safe copy
        const r1UndoRes = await api1.request(
          `/api/projects/${projectId}/history/PROTOTYPE/undo`,
          jsonInit('POST', { expectedEntryId: r1EntryId }),
        );
        expect(r1UndoRes.status).toBe(409);
        const r1UndoErr = (await r1UndoRes.json()) as { code: string; error: string };
        expect(r1UndoErr.code).toBe('NOTHING_TO_UNDO');
        expect(checkBusinessViewMarkup(r1UndoErr.error, { plainText: true })).toEqual([]);

        // 3. Read-only inspection PROTOTYPE_CO_DESIGN run on existing prototype -> produces NO new revision & NO ChangeSummaryView!
        for (const p of store1.listLlmProviders()) {
          store1.saveLlmProvider({ ...p, enabled: false });
        }
        store1.saveLlmProvider({
          id: 'prov-proto-67',
          name: 'Local Prototype Inspection Provider',
          providerType: 'OPENAI_COMPATIBLE',
          baseUrl: `http://127.0.0.1:${noopPort}/v1`,
          apiKey: 'sk-proto-67',
          defaultModel: 'proto-hist-67-model',
          availableModels: ['proto-hist-67-model'],
          enabled: true,
        });
        store1.updateSystemSettings({ mockLlmMode: false });

        const inspectStreamRes = await api1.request(
          `/api/agent-sessions/${protoSession.id}/stream`,
          jsonInit('POST', {
            prompt: '请只检查当前原型的屏幕与按钮结构，不要修改任何内容',
            mockMode: false,
          }),
        );
        expect(inspectStreamRes.status).toBe(200);
        expect(await inspectStreamRes.text()).toContain('event: message_end');

        const inspectSess = store1.getAgentSession(protoSession.id)!;
        const inspectUserMsg = [...inspectSess.messages].reverse().find((m) => m.role === 'user')!;
        const histAfterInspect = (await (
          await api1.request(`/api/projects/${projectId}/history?kind=PROTOTYPE`)
        ).json()) as { entries: ArtifactHistoryEntryView[] };
        expect(histAfterInspect.entries).toHaveLength(1);
        expect(
          histAfterInspect.entries.some(
            (e) => e.source.kind === 'AGENT_RUN' && e.source.runId === inspectUserMsg.id,
          ),
        ).toBe(false);

        // 4. Mutating AI refinement run (R2) -> emits PROTOTYPE ChangeSummaryView in clean business names with canUndo=true
        store1.updateSystemSettings({ mockLlmMode: true });
        const r2StreamRes = await api1.request(
          `/api/agent-sessions/${protoSession.id}/stream`,
          jsonInit('POST', {
            prompt: '增加盘点差异状态筛选框',
            mockMode: true,
          }),
        );
        expect(r2StreamRes.status).toBe(200);
        expect(await r2StreamRes.text()).toContain('event: message_end');

        htmlR2 = store1.getPrototype(prototypeId)!.htmlContent;
        expect(htmlR2).not.toBe(htmlR1);

        const afterR2Sess = store1.getAgentSession(protoSession.id)!;
        const r2UserMsg = [...afterR2Sess.messages].reverse().find((m) => m.role === 'user')!;

        const histAfterR2 = (await (
          await api1.request(`/api/projects/${projectId}/history?kind=PROTOTYPE`)
        ).json()) as { entries: ArtifactHistoryEntryView[]; latestEntryId: string | null };
        expect(histAfterR2.entries).toHaveLength(2);
        const r2Entry = histAfterR2.entries[0]!;
        r2EntryId = r2Entry.id;
        expect(histAfterR2.latestEntryId).toBe(r2EntryId);
        expect(r2Entry.source).toMatchObject({
          kind: 'AGENT_RUN',
          runId: r2UserMsg.id,
        });
        expect(r2Entry.changeSummary.canUndo).toBe(true);
        expect(r2Entry.changeSummary.reason?.zh).toBeTruthy();
        expect(r2Entry.changeSummary.compareRevisionPair).toEqual({
          prototypeId,
          leftRevisionId: r1EntryId,
          rightRevisionId: r2EntryId,
        });
        expect(r2Entry.changeSummary.items.length).toBeGreaterThanOrEqual(1);
        expect(
          r2Entry.changeSummary.items.some((it) => it.label.zh.includes('盘点差异状态筛选')),
        ).toBe(true);

        for (const item of r2Entry.changeSummary.items) {
          expect(item.jumpTarget?.kind).toBe('PROTOTYPE_ANCHOR');
          expect(checkBusinessViewMarkup(item.label.zh, { plainText: true })).toEqual([]);
          expect(checkBusinessViewMarkup(item.label.en, { plainText: true })).toEqual([]);
          if (item.groupLabel) {
            expect(checkBusinessViewMarkup(item.groupLabel.zh, { plainText: true })).toEqual([]);
            expect(checkBusinessViewMarkup(item.groupLabel.en, { plainText: true })).toEqual([]);
          }
        }
        if (r2Entry.changeSummary.reason) {
          expect(
            checkBusinessViewMarkup(r2Entry.changeSummary.reason.zh, { plainText: true }),
          ).toEqual([]);
          expect(
            checkBusinessViewMarkup(r2Entry.changeSummary.reason.en, { plainText: true }),
          ).toEqual([]);
        }

        // 5. Manual prototype save (POST /api/prototypes/:id/revisions) enters same linear history & invalidates R2 Undo
        htmlR3 = `${htmlR2}\n<!-- manual visual spacing adjustment -->\n<style>.manual-polish { letter-spacing: 0.01em; }</style>`;
        const manualRevRes = await api1.request(
          `/api/prototypes/${prototypeId}/revisions`,
          jsonInit('POST', {
            title: '手动微调卡片留白与行距',
            htmlContent: htmlR3,
            source: 'MANUAL_SAVE',
          }),
        );
        expect(manualRevRes.status).toBe(200);
        const manualRevJson = (await manualRevRes.json()) as {
          revision: { id: string };
          artifactHistory?: ArtifactHistoryEntryView[];
        };
        r3ManualEntryId = manualRevJson.revision.id;
        expect(manualRevJson.artifactHistory).toBeDefined();

        const histAfterManual = (await (
          await api1.request(`/api/projects/${projectId}/history?kind=PROTOTYPE`)
        ).json()) as { entries: ArtifactHistoryEntryView[] };
        expect(histAfterManual.entries).toHaveLength(3);
        expect(histAfterManual.entries[0]!.id).toBe(r3ManualEntryId);
        expect(histAfterManual.entries[0]!.source.kind).toBe('MANUAL');
        expect(histAfterManual.entries[0]!.changeSummary.canUndo).toBe(true);
        expect(histAfterManual.entries[1]!.id).toBe(r2EntryId);
        expect(histAfterManual.entries[1]!.changeSummary.canUndo).toBe(false);
      } finally {
        store1.close();
        noopLlmServer.closeAllConnections?.();
        await new Promise<void>((resolve) => noopLlmServer.close(() => resolve()));
      }

      // 6. Verify SQLite has ZERO duplicated HTML rows in `artifact_history` for PROTOTYPE!
      const rawDb = new DatabaseSync(dbPath);
      try {
        const protoHistRows = rawDb
          .prepare(
            `SELECT item_id, payload_json FROM workspace_entities WHERE collection = 'artifact_history' AND project_id = ?`,
          )
          .all(projectId) as { item_id: string; payload_json: string }[];
        const leakedProtoRows = protoHistRows.filter((r) =>
          r.payload_json.includes('"artifactKind":"PROTOTYPE"'),
        );
        expect(leakedProtoRows).toEqual([]);
      } finally {
        rawDb.close();
      }

      // 7. Reopen store + Hono app from disk: verify bootstrap, 409 stale Undo, latest Undo, Redo, Restore, and Undo of Restore!
      const store2 = createWorkspaceStore({ dbPath, enableFileMirror: false });
      const api2 = createApiApp(store2);
      try {
        const bootRes = await api2.request(
          `/api/bootstrap?projectId=${encodeURIComponent(projectId)}`,
        );
        expect(bootRes.status).toBe(200);
        const bootJson = (await bootRes.json()) as {
          artifactHistory: ArtifactHistoryEntryView[];
          prototypes: InteractivePrototype[];
        };
        const bootProtoEntries = bootJson.artifactHistory.filter(
          (e) => e.artifactKind === 'PROTOTYPE',
        );
        expect(bootProtoEntries).toHaveLength(3);
        expect(bootProtoEntries[0]!.id).toBe(r3ManualEntryId);
        expect(bootProtoEntries[0]!.changeSummary.canUndo).toBe(true);

        // Stale expectedEntryId (r2EntryId) rejected with 409 in both zh-CN and en-US
        for (const loc of ['zh-CN', 'en-US'] as const) {
          const staleRes = await api2.request(
            `/api/projects/${projectId}/history/PROTOTYPE/undo`,
            jsonInit('POST', { expectedEntryId: r2EntryId }, loc),
          );
          expect(staleRes.status).toBe(409);
          const staleJson = (await staleRes.json()) as { code: string; error: string };
          expect(staleJson.code).toBe('STALE_LATEST_ENTRY');
          expect(checkBusinessViewMarkup(staleJson.error, { plainText: true })).toEqual([]);
        }

        // 1-click Undo of latest change (r3ManualEntryId) -> appends R4 restoring htmlR2
        const undoRes = await api2.request(
          `/api/projects/${projectId}/history/PROTOTYPE/undo`,
          jsonInit('POST', { expectedEntryId: r3ManualEntryId }),
        );
        expect(undoRes.status).toBe(200);
        const undoJson = (await undoRes.json()) as {
          entry: ArtifactHistoryEntryView;
          undoneEntryId: string;
          prototypes: InteractivePrototype[];
          entries: ArtifactHistoryEntryView[];
        };
        expect(undoJson.undoneEntryId).toBe(r3ManualEntryId);
        expect(undoJson.prototypes[0]!.htmlContent).toBe(htmlR2);
        expect(undoJson.prototypes[0]!.revisions).toHaveLength(4);
        expect(undoJson.entries.find((e) => e.id === r3ManualEntryId)!.changeSummary.isUndone).toBe(
          true,
        );

        // Undo the Undo (Redo!) -> appends R5 restoring htmlR3
        const redoRes = await api2.request(
          `/api/projects/${projectId}/history/PROTOTYPE/undo`,
          jsonInit('POST', { expectedEntryId: undoJson.entry.id }),
        );
        expect(redoRes.status).toBe(200);
        const redoJson = (await redoRes.json()) as {
          entry: ArtifactHistoryEntryView;
          prototypes: InteractivePrototype[];
        };
        expect(redoJson.prototypes[0]!.htmlContent).toBe(htmlR3);
        expect(redoJson.prototypes[0]!.revisions).toHaveLength(5);

        // Append-only Restore to BEFORE r2EntryId -> appends R6 restoring htmlR1 while keeping R1..R5 intact!
        const restoreRes = await api2.request(
          `/api/projects/${projectId}/history/PROTOTYPE/${r2EntryId}/restore`,
          jsonInit('POST', {}),
        );
        expect(restoreRes.status).toBe(200);
        const restoreJson = (await restoreRes.json()) as {
          entry: ArtifactHistoryEntryView;
          restoredBeforeEntryId: string;
          prototypes: InteractivePrototype[];
          entries: ArtifactHistoryEntryView[];
        };
        expect(restoreJson.restoredBeforeEntryId).toBe(r2EntryId);
        expect(restoreJson.prototypes[0]!.htmlContent).toBe(htmlR1);
        expect(restoreJson.prototypes[0]!.revisions).toHaveLength(6);
        expect(restoreJson.entry.changeSummary.canUndo).toBe(true);

        // 1-click Undo of the Restore itself -> appends R7 restoring htmlR3!
        const undoRestoreRes = await api2.request(
          `/api/projects/${projectId}/history/PROTOTYPE/undo`,
          jsonInit('POST', { expectedEntryId: restoreJson.entry.id }),
        );
        expect(undoRestoreRes.status).toBe(200);
        const undoRestoreJson = (await undoRestoreRes.json()) as {
          prototypes: InteractivePrototype[];
          entries: ArtifactHistoryEntryView[];
        };
        expect(undoRestoreJson.prototypes[0]!.htmlContent).toBe(htmlR3);
        expect(undoRestoreJson.prototypes[0]!.revisions).toHaveLength(7);
        expect(undoRestoreJson.entries).toHaveLength(7);
      } finally {
        store2.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );
});
