import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  ArtifactHistoryConflictError,
  computeRequirementDocDiff,
  createWorkspaceStore,
} from '../index.js';

describe('workspace-store: unified ArtifactHistory & RequirementDoc section diff (#65)', () => {
  it('computes deterministic section-level ADDED, MODIFIED, and REMOVED diffs with Business View-safe titles and jump headings', () => {
    const before = {
      id: 'rdoc-1',
      projectId: 'proj-1',
      title: '智慧仓储需求书',
      version: 'v1.0',
      status: 'DRAFT' as const,
      content: [
        '# 智慧仓储需求书',
        '',
        '## 1. 业务目标与范围',
        '- 支持多仓库入库与盘点闭环。',
        '',
        '## 2. 核心领域对象 (对应 M1 对象模型)',
        '- **入库单 (`InboundOrder` / `AGG-01`)**：记录供应商送货明细。',
        '',
        '## 3. 旧版纸质交接流程',
        '- 仓管员手工抄写三联单。',
      ].join('\n'),
    };

    const after = {
      ...before,
      version: 'v1.1',
      content: [
        '# 智慧仓储需求书',
        '',
        '## 1. 业务目标与范围',
        '- 支持多仓库入库与盘点闭环。',
        '',
        '## 2. 核心领域对象 (对应 M1 对象模型)',
        '- **入库单 (`InboundOrder` / `AGG-01`)**：记录供应商送货明细与批次温控。',
        '- **库位 (`StorageBin` / `AGG-02`)**：记录冷链温区限制。',
        '',
        '## 4. 异常温控预警规则',
        '- 实测温度超标超过 15 分钟自动冻结上架操作。',
      ].join('\n'),
    };

    const diff = computeRequirementDocDiff(before, after);
    expect(diff.hasChanges).toBe(true);
    expect(diff.addedCount).toBe(1);
    expect(diff.modifiedCount).toBe(1);
    expect(diff.removedCount).toBe(1);

    const modified = diff.sections.find((s) => s.changeType === 'MODIFIED');
    expect(modified).toBeDefined();
    expect(modified!.sectionHeading).toBe('2. 核心领域对象 (对应 M1 对象模型)');
    // Business View summary strips M1 / AGG-01 jargon
    expect(modified!.summary.zh).toContain('2. 核心领域对象');
    expect(modified!.summary.zh).not.toContain('M1');
    expect(modified!.summary.zh).not.toContain('AGG-01');
    expect(modified!.addedLines).toBeGreaterThanOrEqual(2);
    expect(modified!.removedLines).toBeGreaterThanOrEqual(1);

    const added = diff.sections.find((s) => s.changeType === 'ADDED');
    expect(added).toBeDefined();
    expect(added!.sectionHeading).toBe('4. 异常温控预警规则');
    expect(added!.summary.zh).toContain('4. 异常温控预警规则');

    const removed = diff.sections.find((s) => s.changeType === 'REMOVED');
    expect(removed).toBeDefined();
    expect(removed!.sectionHeading).toBe('3. 旧版纸质交接流程');

    // Identical content produces hasChanges === false
    const noopDiff = computeRequirementDocDiff(after, { ...after });
    expect(noopDiff.hasChanges).toBe(false);
    expect(noopDiff.sections).toEqual([]);
  });

  it(
    'stores one row per history entry in workspace_entities, suppresses no-op runs, and supports 1-click Undo & append-only Restore across store reloads',
    { timeout: 20_000 },
    () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onto-hist-65-'));
    const dbPath = path.join(tmpDir, 'workspace.db');

    const store1 = createWorkspaceStore({ dbPath, enableFileMirror: false });
    let projectId = '';
    try {
      const proj = store1.createProject({
        name: '设备巡检工单系统',
        code: 'EQUIP-INSP',
        domain: '工业设备运维',
        template: 'EMPTY',
      });
      projectId = proj.id;

      // 1. Agent Run #1 synthesizes initial SRS ( saves twice in the same run -> coalesced into ONE entry!)
      store1.beginArtifactRunCapture({
        projectId,
        artifactKind: 'REQUIREMENTS_DOC',
        runId: 'run-srs-1',
        sessionId: 'sess-req-1',
      });
      store1.saveRequirementDoc({
        id: 'rdoc-equip',
        projectId,
        title: '设备巡检需求文档',
        version: 'v1.0',
        status: 'DRAFT',
        content: '# 设备巡检需求\n\n## 1. 业务目标\n- 初稿',
      });
      store1.saveRequirementDoc({
        id: 'rdoc-equip',
        projectId,
        title: '设备巡检需求文档',
        version: 'v1.0',
        status: 'DRAFT',
        content: [
          '# 设备巡检需求',
          '',
          '## 1. 业务目标',
          '- 实现点检计划与隐患闭环派单。',
          '',
          '## 2. 业务对象',
          '- 巡检工单：记录巡检人、设备与缺陷等级。',
        ].join('\n'),
      });
      const run1Entry = store1.finishArtifactRunCapture({
        projectId,
        artifactKind: 'REQUIREMENTS_DOC',
        runId: 'run-srs-1',
        sessionId: 'sess-req-1',
        reason: '根据沟通要点整理了首版需求文档。',
      });

      expect(run1Entry).toBeTruthy();
      expect(run1Entry!.sequence).toBe(1);
      expect(run1Entry!.source).toEqual({
        kind: 'AGENT_RUN',
        runId: 'run-srs-1',
        sessionId: 'sess-req-1',
        reason: '根据沟通要点整理了首版需求文档。',
      });

      // 2. No-op Agent Run #2 (does not touch RequirementDoc) -> records NO history entry!
      store1.beginArtifactRunCapture({
        projectId,
        artifactKind: 'REQUIREMENTS_DOC',
        runId: 'run-noop-2',
        sessionId: 'sess-req-1',
      });
      const noopEntry = store1.finishArtifactRunCapture({
        projectId,
        artifactKind: 'REQUIREMENTS_DOC',
        runId: 'run-noop-2',
        sessionId: 'sess-req-1',
      });
      expect(noopEntry).toBeNull();
      expect(store1.listArtifactHistory(projectId, { artifactKind: 'REQUIREMENTS_DOC' })).toHaveLength(1);

      // 3. Manual edit outside any Agent Run -> records { kind: 'MANUAL' } entry #2
      store1.saveRequirementDoc({
        id: 'rdoc-equip',
        projectId,
        title: '设备巡检需求文档',
        version: 'v1.1',
        status: 'DRAFT',
        content: [
          '# 设备巡检需求',
          '',
          '## 1. 业务目标',
          '- 实现点检计划与隐患闭环派单。',
          '',
          '## 2. 业务对象',
          '- 巡检工单：记录巡检人、设备与缺陷等级。',
          '',
          '## 3. 紧急停机上报规则',
          '- 一级缺陷立即推送值班厂长确认。',
        ].join('\n'),
      });

      const viewsBeforeReload = store1.listArtifactHistoryViews(projectId, {
        artifactKind: 'REQUIREMENTS_DOC',
      });
      expect(viewsBeforeReload).toHaveLength(2);
      // Newest first: manual edit is canUndo=true; earlier run-srs-1 is canUndo=false!
      expect(viewsBeforeReload[0]!.source.kind).toBe('MANUAL');
      expect(viewsBeforeReload[0]!.changeSummary.canUndo).toBe(true);
      expect(viewsBeforeReload[1]!.id).toBe(run1Entry!.id);
      expect(viewsBeforeReload[1]!.changeSummary.canUndo).toBe(false);
    } finally {
      store1.close();
    }

    // 4. Reopen store from disk (simulating server/browser restart) and verify SQLite one-row-per-entry
    const rawDb = new DatabaseSync(dbPath);
    try {
      const rows = rawDb
        .prepare(
          `SELECT item_id, payload_json FROM workspace_entities WHERE collection = 'artifact_history' AND project_id = ?`,
        )
        .all(projectId) as { item_id: string; payload_json: string }[];
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        const parsed = JSON.parse(row.payload_json) as { id: string };
        expect(parsed.id).toBe(row.item_id);
      }
    } finally {
      rawDb.close();
    }

    const store2 = createWorkspaceStore({ dbPath, enableFileMirror: false });
    try {
      const views = store2.listArtifactHistoryViews(projectId, {
        artifactKind: 'REQUIREMENTS_DOC',
      });
      expect(views).toHaveLength(2);
      const manualEntryId = views[0]!.id;
      const run1EntryId = views[1]!.id;

      // Attempting 1-click Undo with stale expectedEntryId (run1EntryId) throws ArtifactHistoryConflictError
      expect(() =>
        store2.undoLatestArtifactChange(projectId, 'REQUIREMENTS_DOC', {
          expectedEntryId: run1EntryId,
        }),
      ).toThrow(ArtifactHistoryConflictError);

      // 5. 1-click Undo of latest change (manual edit) restores exact content from Run #1
      const undone = store2.undoLatestArtifactChange(projectId, 'REQUIREMENTS_DOC', {
        expectedEntryId: manualEntryId,
      });
      expect(undone.entry.source).toEqual({
        kind: 'UNDO',
        undoneEntryId: manualEntryId,
      });
      expect(store2.listRequirementDocs(projectId)[0]!.content).not.toContain('紧急停机上报规则');
      expect(store2.listRequirementDocs(projectId)[0]!.content).toContain('隐患闭环派单');

      // 6. Append-only Restore to BEFORE Run #1 (when no doc existed!) preserves intermediate entries
      const restored = store2.restoreArtifactBeforeEntry(
        projectId,
        'REQUIREMENTS_DOC',
        run1EntryId,
      );
      expect(restored.entry.source).toEqual({
        kind: 'RESTORE',
        restoredFromEntryId: run1EntryId,
      });
      expect(store2.listRequirementDocs(projectId)).toEqual([]);
      expect(
        store2.listArtifactHistory(projectId, { artifactKind: 'REQUIREMENTS_DOC' }),
      ).toHaveLength(4);

      // 7. And the Restore itself is now the latest change and can be undone via 1-click Undo!
      const undoRestore = store2.undoLatestArtifactChange(projectId, 'REQUIREMENTS_DOC', {
        expectedEntryId: restored.entry.id,
      });
      expect(undoRestore.entry.source).toEqual({
        kind: 'UNDO',
        undoneEntryId: restored.entry.id,
      });
      expect(store2.listRequirementDocs(projectId)[0]!.content).toContain('隐患闭环派单');
    } finally {
      store2.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('caps retained linear history at 50 entries by default while keeping sequences strictly monotonic', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    try {
      const proj = store.createProject({
        name: '多轮需求演进压测',
        code: 'HIST-CAP-50',
        domain: '仓储履约',
        template: 'EMPTY',
      });
      for (let i = 1; i <= 55; i += 1) {
        store.saveRequirementDoc({
          id: 'rdoc-cap',
          projectId: proj.id,
          title: '需求规格文档',
          version: `v2.${i}`,
          status: 'DRAFT',
          content: `# 需求规格文档\n\n## 1. 业务目标\n- 第 ${i} 次迭代修订`,
        });
      }
      const capped = store.listArtifactHistory(proj.id, {
        artifactKind: 'REQUIREMENTS_DOC',
      });
      expect(capped).toHaveLength(50);
      expect(capped[0]!.sequence).toBe(55);
      expect(capped[49]!.sequence).toBe(6);
    } finally {
      store.close();
    }
  });
});
