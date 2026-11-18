import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { checkBusinessViewMarkup } from '../packages/business-vocabulary/index.js';
import { serializeModelYaml, type OntologySuite } from '../packages/ontology-core/index.js';
import {
  createWorkspaceStore,
  type ArtifactHistoryEntryView,
  type ProjectDetail,
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

describe('HTTP ONTOLOGY_SUITE History, Multi-Tool Coalescing, Business Summary, Undo/Redo & Restore (#70)', () => {
  it(
    'suppresses no-op COPILOT runs, coalesces multi-tool COPILOT runs into one AGENT_RUN entry with Business-Object-grouped diff items, unifies Business View & Technical Details manual edits, and supports Undo, Redo, and Restore across reloads',
    { timeout: 25_000 },
    async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onto-http-suite-hist-70-'));
      const dbPath = path.join(tmpDir, 'workspace.db');

      let llmCallIndex = 0;
      const mockLlmServer = http.createServer(async (req, res) => {
        for await (const _chunk of req) {
          // drain request body
        }
        if (req.url?.endsWith('/chat/completions')) {
          llmCallIndex += 1;
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
          });

          if (llmCallIndex === 1) {
            res.write(
              `data: ${JSON.stringify({
                id: 'chatcmpl-70-1',
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: 'hist-70-model',
                choices: [
                  {
                    index: 0,
                    delta: {
                      role: 'assistant',
                      tool_calls: [
                        {
                          index: 0,
                          id: 'call_agg_70',
                          type: 'function',
                          function: {
                            name: 'upsert_aggregate',
                            arguments: JSON.stringify({
                              id: 'AGG-BOND-70',
                              name: 'GuaranteeBond',
                              alias: '履约保函',
                              description: '大额采购合同银行履约保函',
                            }),
                          },
                        },
                        {
                          index: 1,
                          id: 'call_bhv_70',
                          type: 'function',
                          function: {
                            name: 'upsert_behavior',
                            arguments: JSON.stringify({
                              id: 'BHV-APPROVE-70',
                              name: 'SubmitForApproval',
                              alias: '提交审批',
                              ownerEntity: 'Contract',
                              behaviorType: 'COMMAND',
                              triggerType: 'USER_ACTION',
                            }),
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

          if (llmCallIndex === 2) {
            res.write(
              `data: ${JSON.stringify({
                id: 'chatcmpl-70-2',
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: 'hist-70-model',
                choices: [
                  {
                    index: 0,
                    delta: {
                      role: 'assistant',
                      tool_calls: [
                        {
                          index: 0,
                          id: 'call_rule_70',
                          type: 'function',
                          function: {
                            name: 'upsert_rule',
                            arguments: JSON.stringify({
                              id: 'RULE-BOND-70',
                              name: 'DualSignOffRule',
                              alias: '大额合同双签规则',
                              ruleType: 'VALIDATION',
                              referencedObjects: ['Contract', 'GuaranteeBond'],
                              expression: 'Contract.id != null && GuaranteeBond.id != null',
                              violationMessage: '大额合同须绑定有效履约保函并完成双签',
                            }),
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
              id: 'chatcmpl-70-3',
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: 'hist-70-model',
              choices: [
                {
                  index: 0,
                  delta: {
                    role: 'assistant',
                    content: '根据大额采购内控要求补充了提交审批操作、履约保函对象与双签规则。',
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

      await new Promise<void>((resolve) => mockLlmServer.listen(0, '127.0.0.1', () => resolve()));
      const port = (mockLlmServer.address() as AddressInfo).port;

      const store1 = createWorkspaceStore({ dbPath, enableFileMirror: false });
      const api1 = createApiApp(store1);

      let projectId = '';
      let multiToolEntryId = '';
      let renameEntryId = '';

      try {
        const createProjRes = await api1.request(
          '/api/projects',
          jsonInit('POST', {
            name: '合同履约审批系统',
            code: 'CONTRACT_HIST_HTTP_70',
            domain: 'contract_lifecycle',
            template: 'CONTRACT',
          }),
        );
        expect(createProjRes.status).toBe(200);
        const { project } = (await createProjRes.json()) as { project: ProjectDetail };
        projectId = project.id;

        const createSessRes = await api1.request(
          '/api/agent-sessions',
          jsonInit('POST', { projectId, agentKind: 'COPILOT' }),
        );
        expect(createSessRes.status).toBe(200);
        const { session } = (await createSessRes.json()) as { session: { id: string } };

        // 1. No-op COPILOT run (mockMode inspection turn) -> records NO ONTOLOGY_SUITE history entry
        const noopRes = await api1.request(
          `/api/agent-sessions/${session.id}/stream`,
          jsonInit('POST', {
            prompt: '请检查当前业务模型的结构状态',
            mockMode: true,
          }),
        );
        expect(noopRes.status).toBe(200);
        expect(await noopRes.text()).toContain('event: message_end');

        const histAfterNoop = (await (
          await api1.request(`/api/projects/${projectId}/history?kind=ONTOLOGY_SUITE`)
        ).json()) as { entries: ArtifactHistoryEntryView[] };
        expect(histAfterNoop.entries).toEqual([]);

        // 2. Multi-tool COPILOT run via live OpenAI-compatible gateway -> records ONE coalesced AGENT_RUN entry
        for (const p of store1.listLlmProviders()) {
          store1.saveLlmProvider({ ...p, enabled: false });
        }
        store1.saveLlmProvider({
          id: 'prov-hist-70',
          name: 'Local Multi-Tool Test Provider',
          providerType: 'OPENAI_COMPATIBLE',
          baseUrl: `http://127.0.0.1:${port}/v1`,
          apiKey: 'sk-test-70',
          defaultModel: 'hist-70-model',
          availableModels: ['hist-70-model'],
          enabled: true,
        });
        store1.updateSystemSettings({
          mockLlmMode: false,
        });

        const runRes = await api1.request(
          `/api/agent-sessions/${session.id}/stream`,
          jsonInit('POST', {
            prompt: '请在合同上新增提交审批操作，并补充履约保函及大额合同双签规则',
            mockMode: false,
          }),
        );
        expect(runRes.status).toBe(200);
        expect(await runRes.text()).toContain('event: message_end');

        const histAfterRun = (await (
          await api1.request(`/api/projects/${projectId}/history?kind=ONTOLOGY_SUITE`)
        ).json()) as { entries: ArtifactHistoryEntryView[] };
        expect(histAfterRun.entries).toHaveLength(1);
        const agentEntry = histAfterRun.entries[0]!;
        multiToolEntryId = agentEntry.id;
        expect(agentEntry.source.kind).toBe('AGENT_RUN');
        expect(agentEntry.changeSummary.canUndo).toBe(true);
        expect(agentEntry.changeSummary.reason?.zh).toContain('补充了提交审批操作');
        expect(
          agentEntry.changeSummary.items.some(
            (i) => i.label.zh === '在『合同』上新增业务操作『提交审批』',
          ),
        ).toBe(true);
        expect(
          agentEntry.changeSummary.items.some(
            (i) => i.label.zh === '新增业务对象『履约保函』',
          ),
        ).toBe(true);
        expect(
          agentEntry.changeSummary.items.some(
            (i) => i.label.zh === '在『合同』与『履约保函』上新增业务规则『大额合同双签规则』',
          ),
        ).toBe(true);

        for (const item of agentEntry.changeSummary.items) {
          expect(checkBusinessViewMarkup(item.label.zh, { plainText: true })).toEqual([]);
          expect(checkBusinessViewMarkup(item.label.en, { plainText: true })).toEqual([]);
        }

        // 3. Manual edit #1: Business View PATCH /business-model
        const patchBmRes = await api1.request(
          `/api/projects/${projectId}/business-model`,
          jsonInit('PATCH', {
            edit: {
              kind: 'ACTION',
              actionId: 'BHV-APPROVE-70',
              description: '提交法务与财务负责人线上会签',
            },
          }),
        );
        expect(patchBmRes.status).toBe(200);
        const patchBmJson = (await patchBmRes.json()) as {
          project: ProjectDetail;
          artifactHistory: ArtifactHistoryEntryView[];
        };
        expect(patchBmJson.artifactHistory.filter((e) => e.artifactKind === 'ONTOLOGY_SUITE')).toHaveLength(2);

        // 4. Manual edit #2: Technical Details PUT /suite
        const suiteAfterBm = structuredClone(patchBmJson.project.suite) as OntologySuite;
        suiteAfterBm.M3!.rules.find((r) => r.id === 'RULE-BOND-70')!.violationMessage =
          '大额采购合同须上传银行履约保函并双签';
        const putSuiteRes = await api1.request(
          `/api/projects/${projectId}/suite`,
          jsonInit('PUT', { suite: suiteAfterBm, changelogNote: 'Updated RULE-BOND-70' }),
        );
        expect(putSuiteRes.status).toBe(200);
        const putSuiteJson = (await putSuiteRes.json()) as {
          project: ProjectDetail;
          artifactHistory: ArtifactHistoryEntryView[];
        };
        expect(putSuiteJson.artifactHistory.filter((e) => e.artifactKind === 'ONTOLOGY_SUITE')).toHaveLength(3);

        // 5. Manual edit #3: Technical Details PUT /models/:modelCode (YAML save)
        const m1Modified = structuredClone(putSuiteJson.project.suite.M1!);
        m1Modified.aggregates.find((a) => a.id === 'AGG-BOND-70')!.description =
          '经银企直连核验的银行履约保函';
        const yamlText = serializeModelYaml('M1', m1Modified);
        const putModelRes = await api1.request(
          `/api/projects/${projectId}/models/M1`,
          jsonInit('PUT', { yamlText }),
        );
        expect(putModelRes.status).toBe(200);
        const putModelJson = (await putModelRes.json()) as {
          project: ProjectDetail;
          artifactHistory: ArtifactHistoryEntryView[];
        };
        expect(putModelJson.artifactHistory.filter((e) => e.artifactKind === 'ONTOLOGY_SUITE')).toHaveLength(4);

        // 6. Manual edit #4: Technical Details POST /rename
        const renameRes = await api1.request(
          `/api/projects/${projectId}/rename`,
          jsonInit('POST', { oldId: 'GuaranteeBond', newId: 'PerformanceBond' }),
        );
        expect(renameRes.status).toBe(200);
        const renameJson = (await renameRes.json()) as {
          project: ProjectDetail;
          artifactHistory: ArtifactHistoryEntryView[];
        };
        const ontAfterRename = renameJson.artifactHistory.filter(
          (e) => e.artifactKind === 'ONTOLOGY_SUITE',
        );
        expect(ontAfterRename).toHaveLength(5);
        renameEntryId = ontAfterRename[0]!.id;
        expect(ontAfterRename[0]!.changeSummary.canUndo).toBe(true);
        expect(ontAfterRename[4]!.id).toBe(multiToolEntryId);
        expect(ontAfterRename[4]!.changeSummary.canUndo).toBe(false);
      } finally {
        store1.close();
        mockLlmServer.closeAllConnections?.();
        await new Promise<void>((resolve) => mockLlmServer.close(() => resolve()));
      }

      // 7. Verify SQLite stores 5 compact rows in workspace_entities
      const rawDb = new DatabaseSync(dbPath);
      try {
        const rows = rawDb
          .prepare(
            `SELECT item_id FROM workspace_entities WHERE collection = 'artifact_history' AND project_id = ?`,
          )
          .all(projectId) as { item_id: string }[];
        expect(rows).toHaveLength(5);
      } finally {
        rawDb.close();
      }

      // 8. Reload on fresh store + Hono app: Undo latest (rename), Redo it, Restore to before multi-tool run, and Undo the Restore!
      const store2 = createWorkspaceStore({ dbPath, enableFileMirror: false });
      const api2 = createApiApp(store2);
      try {
        const bootRes = await api2.request(`/api/bootstrap?projectId=${encodeURIComponent(projectId)}`);
        expect(bootRes.status).toBe(200);
        const bootJson = (await bootRes.json()) as {
          activeProject: ProjectDetail;
          artifactHistory: ArtifactHistoryEntryView[];
        };
        expect(
          bootJson.activeProject.suite.M1!.aggregates.some((a) => a.name === 'PerformanceBond'),
        ).toBe(true);

        // Undo rename
        const undoRes = await api2.request(
          `/api/projects/${projectId}/history/ONTOLOGY_SUITE/undo`,
          jsonInit('POST', { expectedEntryId: renameEntryId }),
        );
        expect(undoRes.status).toBe(200);
        const undoJson = (await undoRes.json()) as {
          entry: ArtifactHistoryEntryView;
          project: ProjectDetail;
          entries: ArtifactHistoryEntryView[];
        };
        expect(
          undoJson.project.suite.M1!.aggregates.some((a) => a.name === 'GuaranteeBond'),
        ).toBe(true);
        expect(undoJson.entries).toHaveLength(6);

        // Redo rename by undoing the UNDO entry
        const redoRes = await api2.request(
          `/api/projects/${projectId}/history/ONTOLOGY_SUITE/undo`,
          jsonInit('POST', { expectedEntryId: undoJson.entry.id }),
        );
        expect(redoRes.status).toBe(200);
        const redoJson = (await redoRes.json()) as {
          entry: ArtifactHistoryEntryView;
          project: ProjectDetail;
          entries: ArtifactHistoryEntryView[];
        };
        expect(
          redoJson.project.suite.M1!.aggregates.some((a) => a.name === 'PerformanceBond'),
        ).toBe(true);
        expect(redoJson.entries).toHaveLength(7);

        // Append-only Restore to BEFORE multiToolEntryId (initial CONTRACT template state!)
        const restoreRes = await api2.request(
          `/api/projects/${projectId}/history/ONTOLOGY_SUITE/${multiToolEntryId}/restore`,
          jsonInit('POST', {}),
        );
        expect(restoreRes.status).toBe(200);
        const restoreJson = (await restoreRes.json()) as {
          entry: ArtifactHistoryEntryView;
          project: ProjectDetail;
          entries: ArtifactHistoryEntryView[];
        };
        expect(
          restoreJson.project.suite.M2!.behaviors.some((b) => b.id === 'BHV-APPROVE-70'),
        ).toBe(false);
        expect(
          restoreJson.project.suite.M1!.aggregates.some((a) => a.id === 'AGG-BOND-70'),
        ).toBe(false);
        expect(restoreJson.entries).toHaveLength(8);

        // Undo the Restore itself -> brings back PerformanceBond & BHV-APPROVE-70!
        const undoRestoreRes = await api2.request(
          `/api/projects/${projectId}/history/ONTOLOGY_SUITE/undo`,
          jsonInit('POST', { expectedEntryId: restoreJson.entry.id }),
        );
        expect(undoRestoreRes.status).toBe(200);
        const undoRestoreJson = (await undoRestoreRes.json()) as {
          project: ProjectDetail;
          entries: ArtifactHistoryEntryView[];
        };
        expect(
          undoRestoreJson.project.suite.M1!.aggregates.some((a) => a.name === 'PerformanceBond'),
        ).toBe(true);
        expect(
          undoRestoreJson.project.suite.M2!.behaviors.some((b) => b.id === 'BHV-APPROVE-70'),
        ).toBe(true);
        expect(undoRestoreJson.entries).toHaveLength(9);
      } finally {
        store2.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );
});
