import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  createWorkspaceStore,
  type ArtifactHistoryEntryView,
  type RequirementDoc,
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

describe('HTTP Artifact History, RequirementDoc Change Summary, Undo & Append-Only Restore (#65)', () => {
  it(
    'captures pre-run & pre-manual-save states one-row-per-entry, suppresses no-op runs, enforces latest-only 1-click Undo, supports append-only Restore + Undo of Restore, and survives store/HTTP reload',
    { timeout: 20_000 },
    async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onto-http-hist-65-'));
    const dbPath = path.join(tmpDir, 'workspace.db');

    const store1 = createWorkspaceStore({ dbPath, enableFileMirror: false });
    store1.updateSystemSettings({ mockLlmMode: true });
    const api1 = createApiApp(store1);

    let projectId = '';
    let run1EntryId = '';
    let manualEntryId = '';

    try {
      // 1. Create a clean empty project and REQUIREMENT session
      const createProjRes = await api1.request(
        '/api/projects',
        jsonInit('POST', {
          name: '冷链医药签收系统',
          code: 'COLD_MED_65',
          domain: '医药冷链物流',
          template: 'EMPTY',
        }),
      );
      expect(createProjRes.status).toBe(200);
      const { project } = (await createProjRes.json()) as { project: { id: string } };
      projectId = project.id;

      const createSessRes = await api1.request(
        '/api/agent-sessions',
        jsonInit('POST', { projectId, agentKind: 'REQUIREMENT' }),
      );
      expect(createSessRes.status).toBe(200);
      const { session } = (await createSessRes.json()) as { session: { id: string } };

      // 2. No-op run (exploratory conversation turn that records insights, without changing RequirementDoc)
      const noopStreamRes = await api1.request(
        `/api/agent-sessions/${session.id}/stream`,
        jsonInit('POST', {
          prompt: '收货员扫码核验冷链箱温控探头，记录全程温度曲线',
          mockMode: true,
        }),
      );
      expect(noopStreamRes.status).toBe(200);
      expect(await noopStreamRes.text()).toContain('event: message_end');

      const histAfterNoopRes = await api1.request(
        `/api/projects/${projectId}/history?kind=REQUIREMENTS_DOC`,
      );
      expect(histAfterNoopRes.status).toBe(200);
      const histAfterNoop = (await histAfterNoopRes.json()) as {
        entries: ArtifactHistoryEntryView[];
      };
      expect(histAfterNoop.entries).toEqual([]);

      // 3. Agent Run synthesizing SRS -> records ONE AGENT_RUN entry with computed section diff & 1-sentence reason
      const srsStreamRes = await api1.request(
        `/api/agent-sessions/${session.id}/stream`,
        jsonInit('POST', {
          prompt: '[ACTION:SYNTHESIZE_SRS {}]\n请合成九章节软件需求规格说明书',
          mockMode: true,
        }),
      );
      expect(srsStreamRes.status).toBe(200);
      const srsSseText = await srsStreamRes.text();
      expect(srsSseText).toContain('event: message_end');

      const updatedSess = store1.getAgentSession(session.id)!;
      const srsUserMsg = [...updatedSess.messages].reverse().find((m) => m.role === 'user')!;

      const histAfterRunRes = await api1.request(
        `/api/projects/${projectId}/history?kind=REQUIREMENTS_DOC`,
      );
      expect(histAfterRunRes.status).toBe(200);
      const histAfterRun = (await histAfterRunRes.json()) as {
        entries: ArtifactHistoryEntryView[];
        latestEntryId: string | null;
      };
      expect(histAfterRun.entries).toHaveLength(1);
      const runEntry = histAfterRun.entries[0]!;
      run1EntryId = runEntry.id;
      expect(histAfterRun.latestEntryId).toBe(run1EntryId);
      expect(runEntry.source.kind).toBe('AGENT_RUN');
      if (runEntry.source.kind === 'AGENT_RUN') {
        expect(runEntry.source.runId).toBe(srsUserMsg.id);
      }
      expect(runEntry.changeSummary.canUndo).toBe(true);
      expect(runEntry.changeSummary.reason?.zh).toBeTruthy();
      expect(runEntry.changeSummary.items.length).toBeGreaterThanOrEqual(5);
      expect(runEntry.requirementsDiff?.hasChanges).toBe(true);
      expect(runEntry.requirementsDiff?.addedCount).toBeGreaterThanOrEqual(5);

      const synthesizedDoc = store1.listRequirementDocs(projectId)[0]!;
      expect(synthesizedDoc.content).toContain('## 1.');

      // 4. Manual edit via POST /api/requirements/docs -> records MANUAL entry & flips earlier run canUndo to false
      const editedMarkdown = `${synthesizedDoc.content}\n\n## 10. 冷链签收双人复核补充\n- 麻醉与高值冷链药品须由执业药师双人扫码复核。\n`;
      const manualSaveRes = await api1.request(
        '/api/requirements/docs',
        jsonInit('POST', {
          id: synthesizedDoc.id,
          projectId,
          title: synthesizedDoc.title,
          version: 'v5.1',
          status: 'DRAFT',
          content: editedMarkdown,
        }),
      );
      expect(manualSaveRes.status).toBe(200);
      const manualSaveJson = (await manualSaveRes.json()) as {
        doc: RequirementDoc;
        artifactHistory?: ArtifactHistoryEntryView[];
      };
      expect(manualSaveJson.artifactHistory).toBeDefined();

      const histAfterManualRes = await api1.request(
        `/api/projects/${projectId}/history?kind=REQUIREMENTS_DOC`,
      );
      const histAfterManual = (await histAfterManualRes.json()) as {
        entries: ArtifactHistoryEntryView[];
      };
      expect(histAfterManual.entries).toHaveLength(2);
      expect(histAfterManual.entries[0]!.source.kind).toBe('MANUAL');
      expect(histAfterManual.entries[0]!.changeSummary.canUndo).toBe(true);
      expect(histAfterManual.entries[1]!.id).toBe(run1EntryId);
      expect(histAfterManual.entries[1]!.changeSummary.canUndo).toBe(false);
      manualEntryId = histAfterManual.entries[0]!.id;

      const addedSecItem = histAfterManual.entries[0]!.changeSummary.items.find((it) =>
        it.label.zh.includes('10. 冷链签收双人复核补充'),
      );
      expect(addedSecItem).toBeDefined();
      expect(addedSecItem!.jumpTarget).toEqual({
        kind: 'REQUIREMENTS_SECTION',
        docId: synthesizedDoc.id,
        sectionHeading: '10. 冷链签收双人复核补充',
      });
    } finally {
      store1.close();
    }

    // 5. Verify SQLite stores one row per entry in workspace_entities
    const rawDb = new DatabaseSync(dbPath);
    try {
      const rows = rawDb
        .prepare(
          `SELECT item_id FROM workspace_entities WHERE collection = 'artifact_history' AND project_id = ?`,
        )
        .all(projectId) as { item_id: string }[];
      expect(rows.map((r) => r.item_id).sort()).toEqual([manualEntryId, run1EntryId].sort());
    } finally {
      rawDb.close();
    }

    // 6. Simulate browser/server reload on fresh store + Hono app
    const store2 = createWorkspaceStore({ dbPath, enableFileMirror: false });
    const api2 = createApiApp(store2);
    try {
      const bootRes = await api2.request(`/api/bootstrap?projectId=${encodeURIComponent(projectId)}`);
      expect(bootRes.status).toBe(200);
      const bootJson = (await bootRes.json()) as {
        artifactHistory: ArtifactHistoryEntryView[];
      };
      expect(bootJson.artifactHistory).toHaveLength(2);
      expect(bootJson.artifactHistory[0]!.id).toBe(manualEntryId);
      expect(bootJson.artifactHistory[0]!.changeSummary.canUndo).toBe(true);

      // Stale expectedEntryId (run1EntryId) is rejected with 409 Conflict
      const staleUndoRes = await api2.request(
        `/api/projects/${projectId}/history/REQUIREMENTS_DOC/undo`,
        jsonInit('POST', { expectedEntryId: run1EntryId }),
      );
      expect(staleUndoRes.status).toBe(409);
      const staleBody = (await staleUndoRes.json()) as { code: string };
      expect(staleBody.code).toBe('STALE_LATEST_ENTRY');

      // 7. 1-click Undo of latest change (manualEntryId) succeeds after reload!
      const undoRes = await api2.request(
        `/api/projects/${projectId}/history/REQUIREMENTS_DOC/undo`,
        jsonInit('POST', { expectedEntryId: manualEntryId }),
      );
      expect(undoRes.status).toBe(200);
      const undoJson = (await undoRes.json()) as {
        undoneEntryId: string;
        requirementDocs: RequirementDoc[];
        entries: ArtifactHistoryEntryView[];
      };
      expect(undoJson.undoneEntryId).toBe(manualEntryId);
      expect(undoJson.requirementDocs[0]!.content).not.toContain('冷链签收双人复核补充');
      expect(undoJson.requirementDocs[0]!.content).toContain('## 1.');
      expect(undoJson.entries).toHaveLength(3);

      // 8. Append-only Restore to BEFORE run1EntryId (empty state before SRS synthesis!) preserves all intermediate entries
      const restoreRes = await api2.request(
        `/api/projects/${projectId}/history/REQUIREMENTS_DOC/${run1EntryId}/restore`,
        jsonInit('POST', {}),
      );
      expect(restoreRes.status).toBe(200);
      const restoreJson = (await restoreRes.json()) as {
        entry: ArtifactHistoryEntryView;
        restoredBeforeEntryId: string;
        requirementDocs: RequirementDoc[];
        entries: ArtifactHistoryEntryView[];
      };
      expect(restoreJson.restoredBeforeEntryId).toBe(run1EntryId);
      expect(restoreJson.requirementDocs).toEqual([]);
      expect(restoreJson.entries).toHaveLength(4);
      expect(restoreJson.entry.changeSummary.canUndo).toBe(true);

      // 9. And 1-click Undo of that Restore brings back the SRS document right before the restore!
      const undoRestoreRes = await api2.request(
        `/api/projects/${projectId}/history/REQUIREMENTS_DOC/undo`,
        jsonInit('POST', { expectedEntryId: restoreJson.entry.id }),
      );
      expect(undoRestoreRes.status).toBe(200);
      const undoRestoreJson = (await undoRestoreRes.json()) as {
        requirementDocs: RequirementDoc[];
        entries: ArtifactHistoryEntryView[];
      };
      expect(undoRestoreJson.requirementDocs).toHaveLength(1);
      expect(undoRestoreJson.requirementDocs[0]!.content).toContain('## 1.');
      expect(undoRestoreJson.entries).toHaveLength(5);
    } finally {
      store2.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('caps HTTP manual history entries at 50 per (projectId, artifactKind)', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const api = createApiApp(store);
    try {
      const proj = store.createProject({
        name: '冷链签收高频保存压测',
        code: 'HTTP-CAP-50',
        domain: '医药冷链',
        template: 'EMPTY',
      });
      for (let i = 1; i <= 54; i += 1) {
        const res = await api.request(
          '/api/requirements/docs',
          jsonInit('POST', {
            id: 'rdoc-http-cap',
            projectId: proj.id,
            title: '冷链医药签收需求书',
            version: `v6.${i}`,
            status: 'DRAFT',
            content: `# 冷链医药签收需求书\n\n## 1. 业务目标\n- 第 ${i} 版温控规范修订`,
          }),
        );
        expect(res.status).toBe(200);
      }
      const cappedRes = await api.request(
        `/api/projects/${proj.id}/history?kind=REQUIREMENTS_DOC`,
      );
      expect(cappedRes.status).toBe(200);
      const cappedJson = (await cappedRes.json()) as { entries: ArtifactHistoryEntryView[] };
      expect(cappedJson.entries).toHaveLength(50);
      expect(cappedJson.entries[0]!.sequence).toBe(54);
      expect(cappedJson.entries[49]!.sequence).toBe(5);
    } finally {
      store.close();
    }
  });
});
