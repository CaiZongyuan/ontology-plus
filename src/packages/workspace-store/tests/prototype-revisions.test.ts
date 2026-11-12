import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PrototypeConfirmedDeleteError,
  createWorkspaceStore,
  type DesignBrief,
} from '../index.js';

describe('prototype-revisions: two-tier prototype & linear immutable revisions', () => {
  it('creates an InteractivePrototype with 1-based linear revisions, never mutates suite.MU on save/append, and supports metadata rename/star and cloning', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const proj = store.createProject({
      name: '工单协同平台',
      code: 'TICKET-OPS',
      domain: '运维工单协同',
      template: 'EMPTY',
    });

    const coDesignSession = store.createAgentSession({
      projectId: proj.id,
      agentKind: 'CODING',
      title: '极简工单台共创会话',
    });

    const brief: DesignBrief = {
      items: [
        { id: 'bi-1', category: '视觉基调', statement: '高密度暖白工作台，左侧紧凑分组导航' },
        { id: 'bi-2', category: '主交互', statement: '点击工单行在右侧抽屉查看处理流转' },
      ],
      userFeelNote: '像 Linear 一样干净利落，不要花哨渐变',
      primaryReferenceId: 'ref-linear-inbox',
      motionSchematicIds: ['drawer-detail', 'inline-row-actions'],
      updatedAt: '2026-11-12T10:00:00.000Z',
    };

    const htmlRev1 =
      '<section data-screen-id="SCR-TICKET-LIST" data-screen-name="工单列表"><button data-element-id="EL-NEW" data-event-id="UIE-NEW">新建工单</button></section>';
    const created = store.createPrototype(proj.id, {
      name: 'Linear 风极简工单方向',
      htmlContent: htmlRev1,
      title: '按已确认设计简报生成首版三栏工单列表界面与状态筛选器',
      source: 'GENERATED',
      designBrief: brief,
      coDesignSessionId: coDesignSession.id,
    });

    // Saving a prototype MUST NOT populate or mutate suite.MU
    expect(created.project.suite.MU).toBeUndefined();
    expect(store.getProject(proj.id)!.suite.MU).toBeUndefined();
    expect(store.getConfirmedPrototypeRevision(proj.id)).toBeUndefined();

    expect(created.revision.revisionNumber).toBe(1);
    expect(created.revision.prototypeId).toBe(created.prototype.id);
    expect(created.revision.projectId).toBe(proj.id);
    expect(created.revision.htmlContent).toBe(htmlRev1);
    expect(created.revision.extractedScreenCount).toBe(1);
    expect(created.prototype.currentRevisionId).toBe(created.revision.id);
    expect(created.prototype.htmlContent).toBe(htmlRev1);
    expect(created.prototype.isConfirmed).toBe(false);
    expect(created.prototype.aheadOfConfirmedCount).toBe(0);
    expect(created.prototype.designBrief?.userFeelNote).toBe('像 Linear 一样干净利落，不要花哨渐变');

    // Appending revision 2 adds to linear history without mutating revision 1 or suite.MU
    const htmlRev2 =
      '<section data-screen-id="SCR-TICKET-LIST" data-screen-name="工单列表"><button data-element-id="EL-NEW" data-event-id="UIE-NEW">新建工单</button></section><section data-screen-id="SCR-TICKET-DRAWER" data-screen-name="工单详情抽屉"><button data-element-id="EL-CLOSE" data-event-id="UIE-CLOSE">关单</button></section>';
    const appended = store.appendPrototypeRevision(created.prototype.id, {
      htmlContent: htmlRev2,
      instruction: '增加右侧工单详情抽屉与一键关单操作按钮，需要醒目状态标签',
      source: 'REFINED',
    });

    expect(store.getProject(proj.id)!.suite.MU).toBeUndefined();
    expect(appended.revision.revisionNumber).toBe(2);
    expect(appended.revision.title).toContain('增加右侧工单详情抽屉');
    expect(appended.prototype.revisions).toHaveLength(2);
    expect(appended.prototype.revisions.map((r) => r.revisionNumber)).toEqual([1, 2]);
    expect(appended.prototype.currentRevisionId).toBe(appended.revision.id);
    expect(appended.prototype.htmlContent).toBe(htmlRev2);
    expect(appended.prototype.extractedScreenCount).toBe(2);
    expect(appended.prototype.revisions[0]!.htmlContent).toBe(htmlRev1);

    // Renaming and starring revision 1 keeps HTML and linear order immutable
    const metaUpdated = store.updatePrototypeRevisionMeta(created.prototype.id, created.revision.id, {
      title: '首版工单列表基线',
      starred: true,
    });
    expect(metaUpdated.revision.title).toBe('首版工单列表基线');
    expect(metaUpdated.revision.starred).toBe(true);
    expect(metaUpdated.revision.htmlContent).toBe(htmlRev1);
    expect(metaUpdated.prototype.revisions.map((r) => r.revisionNumber)).toEqual([1, 2]);
    expect(metaUpdated.prototype.currentRevisionId).toBe(appended.revision.id);

    // Save-as-new-prototype (clonePrototype) copies current revision, designBrief, and forks co-design session
    const cloned = store.clonePrototype(created.prototype.id);
    expect(cloned.id).not.toBe(created.prototype.id);
    expect(cloned.revisions).toHaveLength(1);
    expect(cloned.revisions[0]!.revisionNumber).toBe(1);
    expect(cloned.revisions[0]!.htmlContent).toBe(htmlRev2);
    expect(cloned.designBrief?.primaryReferenceId).toBe('ref-linear-inbox');
    expect(cloned.coDesignSessionId).toBeTruthy();
    expect(cloned.coDesignSessionId).not.toBe(coDesignSession.id);
    expect(store.getAgentSession(cloned.coDesignSessionId!)?.projectId).toBe(proj.id);
  });

  it('confirms at most one revision per project (syncing ONLY suite.MU) and restores older revisions by appending without moving confirmation', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const proj = store.createProject({
      name: '采购寻源测试工程',
      code: 'SRM-TEST',
      domain: '采购与供应商寻源',
      template: 'CONTRACT',
    });

    // Make a manual ontology edit on M1 & M3 to verify confirmation ONLY touches suite.MU
    const baseSuite = store.getProject(proj.id)!.suite;
    const customM3Note = 'MANUAL_WORKBENCH_RULE_PRESERVED';
    const editedSuite = structuredClone(baseSuite);
    editedSuite.M3!.rules[0]!.description = customM3Note;
    store.updateSuite(proj.id, editedSuite, 'Manual M3 edit');

    const htmlA1 =
      '<section data-screen-id="SCR-RFQ-LIST" data-screen-name="询价单台账"><input data-element-id="EL-RFQ-NO" data-element-label="询价单号" /></section>';
    const htmlA2 =
      '<section data-screen-id="SCR-RFQ-LIST" data-screen-name="询价单台账"><input data-element-id="EL-RFQ-NO" data-element-label="询价单号" /></section><section data-screen-id="SCR-RFQ-CREATE" data-screen-name="发起询价"><button data-element-id="EL-SUBMIT-RFQ" data-element-type="BUTTON">提交询价</button></section>';
    const htmlB1 =
      '<section data-screen-id="SCR-BID-COMPARE" data-screen-name="供应商比价看板"><table data-element-id="EL-BID-TABLE" data-element-type="TABLE"></table></section>';

    const protoA = store.createPrototype(proj.id, {
      name: '方向 A：列表+抽屉',
      htmlContent: htmlA1,
      source: 'GENERATED',
    });
    const protoARev2 = store.appendPrototypeRevision(protoA.prototype.id, {
      htmlContent: htmlA2,
      instruction: '新增发起询价表单屏幕',
      source: 'REFINED',
    });
    const protoB = store.createPrototype(proj.id, {
      name: '方向 B：比价看板',
      htmlContent: htmlB1,
      source: 'GENERATED',
    });

    // Confirm revision 1 of Prototype A (while Prototype A already has revision 2 ahead of it!)
    const confA1 = store.confirmPrototypeRevision(proj.id, protoA.revision.id);
    expect(confA1.confirmed.prototypeId).toBe(protoA.prototype.id);
    expect(confA1.confirmed.revisionId).toBe(protoA.revision.id);
    expect(confA1.confirmed.htmlContent).toBe(htmlA1);
    expect(confA1.prototype.isConfirmed).toBe(true);
    expect(confA1.prototype.confirmedRevisionId).toBe(protoA.revision.id);
    expect(confA1.prototype.aheadOfConfirmedCount).toBe(1);
    // suite.MU reflects SCR-RFQ-LIST (1 screen from rev 1, NOT 2 screens from rev 2), and M3 manual edit is intact!
    expect(confA1.project.suite.MU?.screens.map((s) => s.screenId)).toEqual(['SCR-RFQ-LIST']);
    expect(confA1.project.suite.M3?.rules[0]?.description).toBe(customM3Note);

    // Confirming Prototype B's revision 1 moves the single project confirmation from A -> B
    const confB1 = store.confirmPrototypeRevision(proj.id, protoB.revision.id);
    expect(confB1.confirmed.prototypeId).toBe(protoB.prototype.id);
    expect(confB1.confirmed.revisionId).toBe(protoB.revision.id);
    expect(store.getConfirmedPrototypeRevision(proj.id)?.revisionId).toBe(protoB.revision.id);
    expect(confB1.project.suite.MU?.screens.map((s) => s.screenId)).toEqual(['SCR-BID-COMPARE']);
    expect(confB1.project.suite.M3?.rules[0]?.description).toBe(customM3Note);

    const refreshedA = store.getPrototype(protoA.prototype.id)!;
    const refreshedB = store.getPrototype(protoB.prototype.id)!;
    expect(refreshedA.isConfirmed).toBe(false);
    expect(refreshedA.confirmedRevisionId).toBeUndefined();
    expect(refreshedA.aheadOfConfirmedCount).toBe(0);
    expect(refreshedB.isConfirmed).toBe(true);
    expect(refreshedB.aheadOfConfirmedCount).toBe(0);

    // Confirm A's rev 2, then restore A's rev 1: restoration appends rev 3, keeps rev 2 as Confirmed Revision!
    store.confirmPrototypeRevision(proj.id, protoARev2.revision.id);
    expect(store.getProject(proj.id)!.suite.MU?.screens.map((s) => s.screenId)).toEqual([
      'SCR-RFQ-LIST',
      'SCR-RFQ-CREATE',
    ]);

    const restored = store.restorePrototypeRevision(protoA.prototype.id, protoA.revision.id);
    expect(restored.revision.revisionNumber).toBe(3);
    expect(restored.revision.source).toBe('RESTORED');
    expect(restored.revision.restoredFromRevisionId).toBe(protoA.revision.id);
    expect(restored.revision.htmlContent).toBe(htmlA1);
    expect(restored.prototype.revisions.map((r) => r.revisionNumber)).toEqual([1, 2, 3]);
    expect(restored.prototype.currentRevisionId).toBe(restored.revision.id);
    expect(restored.prototype.htmlContent).toBe(htmlA1);

    // Confirmed Revision stays at rev 2 (1 revision behind current rev 3), and suite.MU is NOT mutated!
    expect(restored.prototype.isConfirmed).toBe(true);
    expect(restored.prototype.confirmedRevisionId).toBe(protoARev2.revision.id);
    expect(restored.prototype.aheadOfConfirmedCount).toBe(1);
    expect(store.getConfirmedPrototypeRevision(proj.id)?.revisionId).toBe(protoARev2.revision.id);
    expect(store.getConfirmedPrototypeRevision(proj.id)?.htmlContent).toBe(htmlA2);
    expect(store.getProject(proj.id)!.suite.MU?.screens.map((s) => s.screenId)).toEqual([
      'SCR-RFQ-LIST',
      'SCR-RFQ-CREATE',
    ]);
  });

  it('refuses deleting a prototype that holds the Confirmed Revision with PrototypeConfirmedDeleteError until another revision is confirmed', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const proj = store.createProject({
      name: '仓储盘点工程',
      code: 'WMS-COUNT',
      domain: '仓储盘点与库位管理',
      template: 'EMPTY',
    });

    const protoA = store.createPrototype(proj.id, {
      name: '盘点台方向 A',
      htmlContent: '<section data-screen-id="SCR-WMS-A" data-screen-name="盘点台A"></section>',
    });
    const protoB = store.createPrototype(proj.id, {
      name: '盘点台方向 B',
      htmlContent: '<section data-screen-id="SCR-WMS-B" data-screen-name="盘点台B"></section>',
    });

    store.confirmPrototypeRevision(proj.id, protoA.revision.id);

    let caught: unknown;
    try {
      store.deletePrototype(protoA.prototype.id);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PrototypeConfirmedDeleteError);
    const typedErr = caught as PrototypeConfirmedDeleteError;
    expect(typedErr.code).toBe('PROTOTYPE_HOLDS_CONFIRMED_REVISION');
    expect(typedErr.prototypeId).toBe(protoA.prototype.id);
    expect(typedErr.confirmedRevisionId).toBe(protoA.revision.id);
    expect(typedErr.messageZh).toContain('盘点台方向 A');
    expect(typedErr.messageEn).toContain('盘点台方向 A');
    expect(store.getPrototype(protoA.prototype.id)).toBeDefined();

    // Unconfirmed prototype B can be deleted freely if needed, or if B is confirmed first, A can then be deleted
    store.confirmPrototypeRevision(proj.id, protoB.revision.id);
    store.deletePrototype(protoA.prototype.id);
    expect(store.getPrototype(protoA.prototype.id)).toBeUndefined();
    expect(store.getConfirmedPrototypeRevision(proj.id)?.prototypeId).toBe(protoB.prototype.id);
  });

  it('migrates legacy flat PrototypeArtifact rows into independent single-revision prototypes (never grouping by name or -rN) and confirms the newest row per project', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onto-proto-mig-'));
    try {
      const bootStore = createWorkspaceStore({ workspaceRoot: tmpDir, enableFileMirror: false });
      // Seed prototype for proj-contract is confirmed out of the box
      const seedConfirmed = bootStore.getConfirmedPrototypeRevision('proj-contract');
      expect(seedConfirmed?.prototypeId).toBe('proto-contract-v1');
      expect(seedConfirmed?.revision.revisionNumber).toBe(1);
      expect(bootStore.getConfirmedPrototypeRevision('proj-mft')).toBeUndefined();

      const customProj = bootStore.createProject({
        name: '遗留迁移工程',
        code: 'LEGACY-MIG',
        domain: '存量原型迁移验证',
        template: 'EMPTY',
      });

      // Write flat legacy PrototypeArtifact rows (without `revisions`) directly into SQLite
      const req = createRequire(import.meta.url);
      const { DatabaseSync } = req('node:sqlite') as {
        DatabaseSync: new (p: string) => {
          prepare(sql: string): { run(...args: unknown[]): unknown };
          close(): void;
        };
      };
      const raw = new DatabaseSync(path.join(tmpDir, 'onto-cs.db'));
      const insertLegacyRow = (row: {
        id: string;
        projectId: string;
        name: string;
        version: string;
        htmlContent: string;
        extractedScreenCount: number;
        updatedAt: string;
      }) => {
        raw
          .prepare(
            `INSERT INTO workspace_entities (collection, item_id, project_id, payload_json, updated_at) VALUES (?, ?, ?, ?, ?)`,
          )
          .run('prototypes', row.id, row.projectId, JSON.stringify(row), row.updatedAt);
      };

      // Same name + -r1 / -r2 suffixes MUST NOT be grouped together!
      insertLegacyRow({
        id: 'legacy-mft-base',
        projectId: 'proj-mft',
        name: 'MFT 传输工单交互原型',
        version: 'v5.0',
        htmlContent: '<section data-screen-id="SCR-MFT-1" data-screen-name="工单页v0"></section>',
        extractedScreenCount: 1,
        updatedAt: '2026-11-01T08:00:00.000Z',
      });
      insertLegacyRow({
        id: 'legacy-mft-r2',
        projectId: 'proj-mft',
        name: 'MFT 传输工单交互原型',
        version: 'v5.0-r2',
        htmlContent:
          '<section data-screen-id="SCR-MFT-1" data-screen-name="工单页v2"></section><section data-screen-id="SCR-MFT-AUDIT" data-screen-name="审计页"></section>',
        extractedScreenCount: 2,
        updatedAt: '2026-11-03T10:00:00.000Z',
      });
      insertLegacyRow({
        id: 'legacy-mft-r1',
        projectId: 'proj-mft',
        name: 'MFT 传输工单交互原型',
        version: 'v5.0-r1',
        htmlContent: '<section data-screen-id="SCR-MFT-1" data-screen-name="工单页v1"></section>',
        extractedScreenCount: 1,
        updatedAt: '2026-11-02T09:00:00.000Z',
      });
      insertLegacyRow({
        id: 'legacy-custom-only',
        projectId: customProj.id,
        name: '单行旧原型',
        version: 'v4.2',
        htmlContent: '<section data-screen-id="SCR-LEGACY-ONLY" data-screen-name="旧版单屏"></section>',
        extractedScreenCount: 1,
        updatedAt: '2026-11-04T12:00:00.000Z',
      });
      raw.close();

      // Re-open store: bootstrap migration upgrades all legacy rows and sets newest row per project as Confirmed Revision
      const reopened = createWorkspaceStore({ workspaceRoot: tmpDir, enableFileMirror: false });

      const mftProtos = reopened.listPrototypes('proj-mft');
      expect(mftProtos).toHaveLength(3);
      expect(mftProtos.map((p) => p.id)).toEqual([
        'legacy-mft-r2',
        'legacy-mft-r1',
        'legacy-mft-base',
      ]);
      for (const p of mftProtos) {
        expect(p.revisions).toHaveLength(1);
        expect(p.revisions[0]!.revisionNumber).toBe(1);
        expect(p.revisions[0]!.source).toBe('MIGRATED');
      }

      const mftConfirmed = reopened.getConfirmedPrototypeRevision('proj-mft');
      expect(mftConfirmed?.prototypeId).toBe('legacy-mft-r2');
      expect(mftConfirmed?.htmlContent).toContain('SCR-MFT-AUDIT');
      expect(mftProtos[0]!.isConfirmed).toBe(true);
      expect(mftProtos[1]!.isConfirmed).toBe(false);
      expect(mftProtos[2]!.isConfirmed).toBe(false);

      const customConfirmed = reopened.getConfirmedPrototypeRevision(customProj.id);
      expect(customConfirmed?.prototypeId).toBe('legacy-custom-only');

      // Confirmed migrated row is protected from deletion; unconfirmed migrated row can be deleted
      expect(() => reopened.deletePrototype('legacy-mft-r2')).toThrow(
        PrototypeConfirmedDeleteError,
      );
      reopened.deletePrototype('legacy-mft-base');
      expect(reopened.listPrototypes('proj-mft').map((p) => p.id)).toEqual([
        'legacy-mft-r2',
        'legacy-mft-r1',
      ]);
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore open file lock cleanup on exit
      }
    }
  });
});
