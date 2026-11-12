import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceStore } from '../../../packages/workspace-store/index.js';
import { createApiApp } from '../../../server/app.js';
import {
  apiConfirmPrototypeRevision,
  apiRestorePrototypeRevision,
  apiUpdatePrototypeRevisionMeta,
} from '../../api.js';
import { PreferencesProvider } from '../../i18n.js';
import {
  ConfirmRevisionMuDiffModal,
  PrototypeConfirmedStatusBadge,
  PrototypeRevisionHistoryDrawer,
  createInitialRevisionHistoryViewState,
  hasNonMuOntologyModels,
  revisionHistoryViewReducer,
} from './PrototypeRevisionHistory.js';

const noop = () => {};

function stubLocale(locale: 'zh-CN' | 'en-US') {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'onto_locale' ? locale : null),
    setItem: noop,
    removeItem: noop,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PrototypeConfirmedStatusBadge', () => {
  it('shows Unconfirmed, Confirmed Revision, and N ahead of confirmed states accurately in zh-CN and en-US', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const proj = store.createProject({
      name: '状态徽标测试工程',
      code: 'BADGE-TEST',
      domain: '供应链协同',
      template: 'EMPTY',
    });

    const created = store.createPrototype(proj.id, {
      name: '工作台方向 A',
      htmlContent: '<section data-screen-id="SCR-1" data-screen-name="首页"></section>',
      source: 'GENERATED',
    });

    // 1. Before any confirmation -> Unconfirmed ("未确认" / "Unconfirmed")
    stubLocale('zh-CN');
    const unconfirmedZh = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeConfirmedStatusBadge
          prototype={created.prototype}
          confirmedRevision={null}
          onOpenHistory={noop}
          onOpenConfirm={noop}
        />
      </PreferencesProvider>,
    );
    expect(unconfirmedZh).toContain('data-confirmation-state="UNCONFIRMED"');
    expect(unconfirmedZh).toContain('未确认');
    expect(unconfirmedZh).toContain('确认此修订');
    expect(unconfirmedZh).toContain('data-testid="open-revision-history-btn"');

    stubLocale('en-US');
    const unconfirmedEn = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeConfirmedStatusBadge
          prototype={created.prototype}
          confirmedRevision={null}
          onOpenHistory={noop}
          onOpenConfirm={noop}
        />
      </PreferencesProvider>,
    );
    expect(unconfirmedEn).toContain('Unconfirmed');
    expect(unconfirmedEn).toContain('Confirm This Revision');

    // 2. Confirm revision #1 -> Confirmed Revision ("已确认修订" / "Confirmed Revision")
    const conf = store.confirmPrototypeRevision(proj.id, created.revision.id);
    stubLocale('zh-CN');
    const confirmedZh = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeConfirmedStatusBadge
          prototype={conf.prototype}
          confirmedRevision={conf.confirmed}
          onOpenHistory={noop}
          onOpenConfirm={noop}
        />
      </PreferencesProvider>,
    );
    expect(confirmedZh).toContain('data-confirmation-state="CONFIRMED"');
    expect(confirmedZh).toContain('已确认修订');

    // 3. Append 2 new revisions (#2, #3) without confirming -> "领先已确认 2 条" / "2 ahead of confirmed"
    store.appendPrototypeRevision(created.prototype.id, {
      htmlContent: '<section data-screen-id="SCR-1" data-screen-name="首页v2"></section>',
      instruction: '优化筛选栏',
      source: 'REFINED',
    });
    const afterRev3 = store.appendPrototypeRevision(created.prototype.id, {
      htmlContent:
        '<section data-screen-id="SCR-1" data-screen-name="首页v2"></section><section data-screen-id="SCR-2" data-screen-name="详情抽屉"></section>',
      instruction: '增加详情抽屉',
      source: 'REFINED',
    });

    stubLocale('zh-CN');
    const aheadZh = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeConfirmedStatusBadge
          prototype={afterRev3.prototype}
          confirmedRevision={store.getConfirmedPrototypeRevision(proj.id)}
          onOpenHistory={noop}
          onOpenConfirm={noop}
        />
      </PreferencesProvider>,
    );
    expect(aheadZh).toContain('data-confirmation-state="AHEAD"');
    expect(aheadZh).toContain('data-ahead-count="2"');
    expect(aheadZh).toContain('领先已确认 2 条');
    expect(aheadZh).toContain('确认此修订');

    stubLocale('en-US');
    const aheadEn = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeConfirmedStatusBadge
          prototype={afterRev3.prototype}
          confirmedRevision={store.getConfirmedPrototypeRevision(proj.id)}
          onOpenHistory={noop}
          onOpenConfirm={noop}
        />
      </PreferencesProvider>,
    );
    expect(aheadEn).toContain('2 ahead of confirmed');
    expect(aheadEn).toContain('Confirm This Revision');
  });
});

describe('PrototypeRevisionHistoryDrawer timeline, rename, star, preview & restore', () => {
  it('renders timeline revisions with auto-summary titles, source badges, inline rename form, and star toggle/filter persisted without altering HTML or order', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const proj = store.createProject({
      name: '时间线测试工程',
      code: 'TIMELINE-TEST',
      domain: '仓储管理',
      template: 'EMPTY',
    });

    const html1 = '<section data-screen-id="SCR-WMS-1" data-screen-name="入库单列表"></section>';
    const html2 =
      '<section data-screen-id="SCR-WMS-1" data-screen-name="入库单列表"></section><section data-screen-id="SCR-WMS-2" data-screen-name="上架作业"></section>';

    const c1 = store.createPrototype(proj.id, {
      name: '仓储台账方向',
      htmlContent: html1,
      instruction: '生成首版入库单列表界面',
      source: 'GENERATED',
    });
    const c2 = store.appendPrototypeRevision(c1.prototype.id, {
      htmlContent: html2,
      instruction: '增加扫码上架作业分栏',
      source: 'REFINED',
    });
    const conf = store.confirmPrototypeRevision(proj.id, c1.revision.id);

    // Initial timeline rendering (zh-CN)
    stubLocale('zh-CN');
    let viewState = createInitialRevisionHistoryViewState(conf.prototype);
    const initialHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeRevisionHistoryDrawer
          prototype={conf.prototype}
          confirmedRevision={conf.confirmed}
          viewState={viewState}
          onSelectPreviewRevision={noop}
          onRestoreRevision={noop}
          onRenameRevision={noop}
          onToggleStarRevision={noop}
          onRequestConfirmRevision={noop}
        />
      </PreferencesProvider>,
    );

    expect(initialHtml).toContain('data-testid="revision-timeline-item-1"');
    expect(initialHtml).toContain('data-testid="revision-timeline-item-2"');
    expect(initialHtml).toContain('生成首版入库单列表界面');
    expect(initialHtml).toContain('增加扫码上架作业分栏');
    expect(initialHtml).toContain('data-testid="revision-confirmed-badge-1"');
    expect(initialHtml).toContain('已确认修订');
    expect(initialHtml).toContain('领先已确认 1 条');

    // Start inline rename on revision #1 (no window.prompt!)
    viewState = revisionHistoryViewReducer(viewState, {
      type: 'START_RENAME',
      revisionId: c1.revision.id,
      currentTitle: c1.revision.title,
    });
    viewState = revisionHistoryViewReducer(viewState, {
      type: 'CHANGE_RENAME_DRAFT',
      draft: '入库单基线里程碑 v1',
    });

    const renamingHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeRevisionHistoryDrawer
          prototype={conf.prototype}
          confirmedRevision={conf.confirmed}
          viewState={viewState}
          onSelectPreviewRevision={noop}
          onRestoreRevision={noop}
          onRenameRevision={noop}
          onToggleStarRevision={noop}
          onRequestConfirmRevision={noop}
        />
      </PreferencesProvider>,
    );
    expect(renamingHtml).toContain('data-testid="revision-rename-input-1"');
    expect(renamingHtml).toContain('value="入库单基线里程碑 v1"');

    // Persist rename + star toggle in real WorkspaceStore
    store.updatePrototypeRevisionMeta(c1.prototype.id, c1.revision.id, {
      title: viewState.renameDraft,
      starred: true,
    });
    viewState = revisionHistoryViewReducer(viewState, { type: 'FINISH_RENAME' });

    const updatedProto = store.getPrototype(c1.prototype.id)!;
    expect(updatedProto.revisions.map((r) => r.revisionNumber)).toEqual([1, 2]);
    expect(updatedProto.revisions[0]?.title).toBe('入库单基线里程碑 v1');
    expect(updatedProto.revisions[0]?.starred).toBe(true);
    expect(updatedProto.revisions[0]?.htmlContent).toBe(html1);
    expect(updatedProto.revisions[1]?.id).toBe(c2.revision.id);
    expect(updatedProto.revisions[1]?.htmlContent).toBe(html2);

    // Filter to starred-only shows revision #1 and hides unstarred revision #2
    viewState = revisionHistoryViewReducer(viewState, { type: 'TOGGLE_STARRED_FILTER' });
    const starredOnlyHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeRevisionHistoryDrawer
          prototype={updatedProto}
          confirmedRevision={store.getConfirmedPrototypeRevision(proj.id)}
          viewState={viewState}
          onSelectPreviewRevision={noop}
          onRestoreRevision={noop}
          onRenameRevision={noop}
          onToggleStarRevision={noop}
          onRequestConfirmRevision={noop}
        />
      </PreferencesProvider>,
    );
    expect(starredOnlyHtml).toContain('入库单基线里程碑 v1');
    expect(starredOnlyHtml).toContain('data-testid="revision-timeline-item-1"');
    expect(starredOnlyHtml).not.toContain('data-testid="revision-timeline-item-2"');
  });

  it('distinguishes non-destructive Preview of an older revision from Restore (which appends revision #N+1 and leaves Confirmed Revision untouched)', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const proj = store.createProject({
      name: '预览恢复测试工程',
      code: 'RESTORE-TEST',
      domain: '采购管理',
      template: 'EMPTY',
    });

    const htmlRev1 = '<section data-screen-id="SCR-PO-1" data-screen-name="采购单列表v1"></section>';
    const htmlRev2 =
      '<section data-screen-id="SCR-PO-1" data-screen-name="采购单列表v2"></section><section data-screen-id="SCR-PO-APPROVE" data-screen-name="采购审批"></section>';

    const c1 = store.createPrototype(proj.id, {
      name: '采购协同原型',
      htmlContent: htmlRev1,
      source: 'GENERATED',
    });
    const c2 = store.appendPrototypeRevision(c1.prototype.id, {
      htmlContent: htmlRev2,
      instruction: '补充采购审批屏幕',
      source: 'REFINED',
    });
    // Confirm revision #2
    const conf = store.confirmPrototypeRevision(proj.id, c2.revision.id);
    expect(conf.prototype.revisions).toHaveLength(2);
    expect(conf.prototype.aheadOfConfirmedCount).toBe(0);

    // 1. Previewing older revision #1 does NOT mutate store history or currentRevisionId
    stubLocale('zh-CN');
    const previewHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeRevisionHistoryDrawer
          prototype={conf.prototype}
          confirmedRevision={conf.confirmed}
          previewRevisionId={c1.revision.id}
          onSelectPreviewRevision={noop}
          onRestoreRevision={noop}
          onRenameRevision={noop}
          onToggleStarRevision={noop}
          onRequestConfirmRevision={noop}
        />
      </PreferencesProvider>,
    );
    expect(previewHtml).toContain('data-testid="revision-preview-banner"');
    expect(previewHtml).toContain('#1');
    expect(store.getPrototype(c1.prototype.id)!.revisions).toHaveLength(2);
    expect(store.getPrototype(c1.prototype.id)!.currentRevisionId).toBe(c2.revision.id);

    // 2. Restoring older revision #1 appends revision #3 at head; Confirmed Revision stays at #2!
    const restored = store.restorePrototypeRevision(c1.prototype.id, c1.revision.id);
    expect(restored.prototype.revisions).toHaveLength(3);
    expect(restored.revision.revisionNumber).toBe(3);
    expect(restored.revision.source).toBe('RESTORED');
    expect(restored.revision.htmlContent).toBe(htmlRev1);
    expect(restored.prototype.confirmedRevisionId).toBe(c2.revision.id);
    expect(restored.prototype.aheadOfConfirmedCount).toBe(1);

    stubLocale('en-US');
    const afterRestoreEn = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeRevisionHistoryDrawer
          prototype={restored.prototype}
          confirmedRevision={store.getConfirmedPrototypeRevision(proj.id)}
          onSelectPreviewRevision={noop}
          onRestoreRevision={noop}
          onRenameRevision={noop}
          onToggleStarRevision={noop}
          onRequestConfirmRevision={noop}
        />
      </PreferencesProvider>,
    );
    expect(afterRestoreEn).toContain('data-testid="revision-timeline-item-3"');
    expect(afterRestoreEn).toContain('data-testid="revision-confirmed-badge-2"');
    expect(afterRestoreEn).toContain('1 ahead of confirmed');
  });

  it('opens Side-by-Side Compare for any two revisions with sandboxed iframes and toggleable MU / HTML diff summary', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const proj = store.createProject({
      name: '并排对比测试工程',
      code: 'COMPARE-TEST',
      domain: '销售订单',
      template: 'EMPTY',
    });

    const html1 =
      '<section data-screen-id="SCR-SO-LIST" data-screen-name="订单列表"><input data-element-id="EL-CUST" data-element-label="客户名称" /></section>';
    const html2 =
      '<section data-screen-id="SCR-SO-LIST" data-screen-name="订单列表"><input data-element-id="EL-CUST" data-element-label="签约客户" /></section>';
    const html3 =
      '<section data-screen-id="SCR-SO-LIST" data-screen-name="订单列表"><input data-element-id="EL-CUST" data-element-label="签约客户" /></section><section data-screen-id="SCR-SO-DETAIL" data-screen-name="订单履约详情"><button data-element-id="EL-SHIP" data-element-type="BUTTON">发货</button></section>';

    const r1 = store.createPrototype(proj.id, {
      name: '销售订单原型',
      htmlContent: html1,
      title: '首版订单列表',
      source: 'GENERATED',
    });
    store.appendPrototypeRevision(r1.prototype.id, {
      htmlContent: html2,
      title: '调整客户搜索标签',
      source: 'REFINED',
    });
    const r3 = store.appendPrototypeRevision(r1.prototype.id, {
      htmlContent: html3,
      title: '新增订单履约详情与发货按钮',
      source: 'REFINED',
    });

    // User opens compare and selects non-adjacent revisions #1 and #3
    let viewState = createInitialRevisionHistoryViewState(r3.prototype);
    viewState = revisionHistoryViewReducer(viewState, {
      type: 'OPEN_COMPARE',
      leftRevisionId: r1.revision.id,
      rightRevisionId: r3.revision.id,
    });

    stubLocale('zh-CN');
    const compareHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeRevisionHistoryDrawer
          prototype={r3.prototype}
          domain={proj.domain}
          viewState={viewState}
          onSelectPreviewRevision={noop}
          onRestoreRevision={noop}
          onRenameRevision={noop}
          onToggleStarRevision={noop}
          onRequestConfirmRevision={noop}
        />
      </PreferencesProvider>,
    );

    expect(compareHtml).toContain('data-testid="revision-side-by-side-compare"');
    expect(compareHtml).toContain('data-testid="compare-left-revision-select"');
    expect(compareHtml).toContain('data-testid="compare-right-revision-select"');
    expect(compareHtml).toContain('data-testid="compare-left-iframe"');
    expect(compareHtml).toContain('data-testid="compare-right-iframe"');
    expect(compareHtml).toContain('sandbox="allow-scripts"');
    expect(compareHtml).toContain('data-testid="compare-mu-diff-section"');
    expect(compareHtml).toContain('SCR-SO-DETAIL');
    expect(compareHtml).toContain('签约客户');

    // Toggle compare inspector to HTML source comparison
    viewState = revisionHistoryViewReducer(viewState, {
      type: 'SET_COMPARE_TAB',
      tab: 'HTML',
    });
    const htmlTabMarkup = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeRevisionHistoryDrawer
          prototype={r3.prototype}
          domain={proj.domain}
          viewState={viewState}
          onSelectPreviewRevision={noop}
          onRestoreRevision={noop}
          onRenameRevision={noop}
          onToggleStarRevision={noop}
          onRequestConfirmRevision={noop}
        />
      </PreferencesProvider>,
    );
    expect(htmlTabMarkup).toContain('data-testid="compare-html-diff-section"');
  });
});

describe('ConfirmRevisionMuDiffModal & M1-M7 ontology preservation on confirmation', () => {
  it('displays structured MU diff (added/removed/modified screens & elements, plus empty-diff notice when identical) BEFORE mutating suite.MU, and leaves suite untouched on cancel', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const proj = store.createProject({
      name: 'MU差异确认工程',
      code: 'CONFIRM-DIFF',
      domain: '费用报销',
      template: 'EMPTY',
    });

    const htmlRev1 = `
      <section data-screen-id="SCR-EXP-LIST" data-screen-name="报销单列表" data-screen-type="LIST">
        <input data-element-id="EL-EXP-NO" data-element-label="单据号" data-binding="Expense.no" />
      </section>
      <section data-screen-id="SCR-OLD-PRINT" data-screen-name="旧打印预览" data-screen-type="MODAL">
        <button data-element-id="EL-PRINT" data-element-type="BUTTON">打印</button>
      </section>
    `;
    const htmlRev2 = `
      <section data-screen-id="SCR-EXP-LIST" data-screen-name="报销单台账" data-screen-type="LIST">
        <input data-element-id="EL-EXP-NO" data-element-label="报销单编号" data-binding="Expense.expenseNo" data-required="true" />
      </section>
      <section data-screen-id="SCR-EXP-CREATE" data-screen-name="发起报销" data-screen-type="FORM">
        <button data-element-id="EL-EXP-SUBMIT" data-element-label="提交审批" data-element-type="BUTTON" data-action-type="SUBMIT" data-event-id="UIE-EXP-SUBMIT" data-behavior-ref="BHV-SUBMIT-EXP">提交</button>
      </section>
    `;

    const c1 = store.createPrototype(proj.id, {
      name: '费用报销原型',
      htmlContent: htmlRev1,
      source: 'GENERATED',
    });
    const conf1 = store.confirmPrototypeRevision(proj.id, c1.revision.id);
    const muSnapshotAfterConf1 = structuredClone(conf1.project.suite.MU);

    const c2 = store.appendPrototypeRevision(c1.prototype.id, {
      htmlContent: htmlRev2,
      instruction: '改版台账与新增发起报销页',
      source: 'REFINED',
    });

    // Modal closed -> renders nothing
    const closedMarkup = renderToStaticMarkup(
      <PreferencesProvider>
        <ConfirmRevisionMuDiffModal
          open={false}
          revision={c2.revision}
          currentMu={store.getProject(proj.id)!.suite.MU}
          domain={proj.domain}
          onConfirm={noop}
          onClose={noop}
        />
      </PreferencesProvider>,
    );
    expect(closedMarkup).toBe('');

    // Clicking "确认此修订" opens modal and previews MU diff BEFORE any store write
    stubLocale('zh-CN');
    const modalZh = renderToStaticMarkup(
      <PreferencesProvider>
        <ConfirmRevisionMuDiffModal
          open={true}
          revision={c2.revision}
          confirmedRevision={store.getConfirmedPrototypeRevision(proj.id)}
          currentMu={store.getProject(proj.id)!.suite.MU}
          domain={proj.domain}
          onConfirm={noop}
          onClose={noop}
        />
      </PreferencesProvider>,
    );

    expect(modalZh).toContain('data-testid="confirm-revision-mu-diff-modal"');
    expect(modalZh).toContain('data-testid="mu-diff-screen-SCR-EXP-CREATE"');
    expect(modalZh).toContain('data-testid="mu-diff-screen-SCR-OLD-PRINT"');
    expect(modalZh).toContain('data-testid="mu-diff-screen-SCR-EXP-LIST"');
    expect(modalZh).toContain('data-testid="mu-diff-element-EL-EXP-NO"');
    expect(modalZh).toContain('报销单编号');
    expect(modalZh).toContain('data-testid="confirm-revision-approve-btn"');
    expect(modalZh).toContain('data-testid="confirm-revision-cancel-btn"');

    // Verify suite.MU has NOT been mutated merely by opening/inspecting or cancelling the modal!
    expect(store.getProject(proj.id)!.suite.MU).toEqual(muSnapshotAfterConf1);
    expect(store.getConfirmedPrototypeRevision(proj.id)?.revisionId).toBe(c1.revision.id);

    // Also verify empty-diff indication when a new revision only changes CSS styling
    const c3VisualOnly = store.appendPrototypeRevision(c1.prototype.id, {
      htmlContent: `<div class="p-6">${htmlRev1}</div>`,
      title: '仅调色与边距微调',
      source: 'REFINED',
    });
    stubLocale('en-US');
    const emptyDiffEn = renderToStaticMarkup(
      <PreferencesProvider>
        <ConfirmRevisionMuDiffModal
          open={true}
          revision={c3VisualOnly.revision}
          currentMu={store.getProject(proj.id)!.suite.MU}
          domain={proj.domain}
          onConfirm={noop}
          onClose={noop}
        />
      </PreferencesProvider>,
    );
    expect(emptyDiffEn).toContain('data-testid="mu-diff-empty-state"');
    expect(emptyDiffEn).toContain('No MU semantic changes');
  });

  it('updates ONLY suite.MU on approval when M1-M7 are already synthesized, keeping M1-M7, ME, MM, and MI completely untouched', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const proj = store.createProject({
      name: '已合成全套本体工程',
      code: 'SYNTH-PRESERVE',
      domain: '合同全生命周期管理系统',
      template: 'CONTRACT',
    });

    // Inject custom manual edits into M1..M7 so any accidental re-synthesis would wipe them
    const initialSuite = structuredClone(store.getProject(proj.id)!.suite);
    expect(hasNonMuOntologyModels(initialSuite)).toBe(true);
    initialSuite.M1!.aggregates[0]!.description = 'MANUAL_M1_AGG_DESC_KEEP';
    initialSuite.M2!.behaviors[0]!.description = 'MANUAL_M2_BEH_DESC_KEEP';
    initialSuite.M3!.rules[0]!.description = 'MANUAL_M3_RULE_DESC_KEEP';
    initialSuite.M7!.query_reports[0]!.description = 'MANUAL_M7_REPORT_DESC_KEEP';
    store.updateSuite(proj.id, initialSuite, 'Manual edits across M1-M7');

    const beforeConfirmProject = store.getProject(proj.id)!;
    const snapM1 = structuredClone(beforeConfirmProject.suite.M1);
    const snapM2 = structuredClone(beforeConfirmProject.suite.M2);
    const snapM3 = structuredClone(beforeConfirmProject.suite.M3);
    const snapME = structuredClone(beforeConfirmProject.suite.ME);
    const snapM4 = structuredClone(beforeConfirmProject.suite.M4);
    const snapM5 = structuredClone(beforeConfirmProject.suite.M5);
    const snapM6 = structuredClone(beforeConfirmProject.suite.M6);
    const snapM7 = structuredClone(beforeConfirmProject.suite.M7);
    const snapMM = structuredClone(beforeConfirmProject.suite.MM);
    const snapMI = structuredClone(beforeConfirmProject.suite.MI);

    const newProto = store.createPrototype(proj.id, {
      name: '全新双栏合同审阅原型',
      htmlContent: `
        <section data-screen-id="SCR-CLM-COCKPIT" data-screen-name="合同审阅驾驶舱" data-screen-type="DASHBOARD">
          <table data-element-id="EL-CLM-GRID" data-element-label="待审合同表" data-element-type="TABLE" data-binding="Contract"></table>
          <button data-element-id="EL-CLM-SEAL" data-element-label="发起用印" data-element-type="BUTTON" data-action-type="SUBMIT" data-event-id="UIE-SEAL">发起用印</button>
        </section>
      `,
      source: 'GENERATED',
    });

    // Render ConfirmRevisionMuDiffModal with suite -> displays MU-only safeguard notice
    stubLocale('zh-CN');
    const safeguardHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <ConfirmRevisionMuDiffModal
          open={true}
          revision={newProto.revision}
          suite={beforeConfirmProject.suite}
          domain={proj.domain}
          onConfirm={noop}
          onClose={noop}
        />
      </PreferencesProvider>,
    );
    expect(safeguardHtml).toContain('data-testid="confirm-mu-only-safeguard"');
    expect(safeguardHtml).toContain('M1–M7');

    // User clicks Confirm -> execute store.confirmPrototypeRevision
    let approvedRevisionId: string | null = null;
    const handleConfirm = (revisionId: string) => {
      approvedRevisionId = revisionId;
      store.confirmPrototypeRevision(proj.id, revisionId);
    };
    handleConfirm(newProto.revision.id);

    expect(approvedRevisionId).toBe(newProto.revision.id);
    const afterConfirmProject = store.getProject(proj.id)!;

    // suite.MU is updated to the newly confirmed revision's screens
    expect(afterConfirmProject.suite.MU?.screens.map((s) => s.screenId)).toEqual([
      'SCR-CLM-COCKPIT',
    ]);
    expect(afterConfirmProject.suite.MU?.screens[0]?.elements.map((e) => e.elementId)).toEqual([
      'EL-CLM-GRID',
      'EL-CLM-SEAL',
    ]);

    // Every non-MU model (M1-M7, ME, MM, MI) is 100% untouched!
    expect(afterConfirmProject.suite.M1).toEqual(snapM1);
    expect(afterConfirmProject.suite.M2).toEqual(snapM2);
    expect(afterConfirmProject.suite.M3).toEqual(snapM3);
    expect(afterConfirmProject.suite.ME).toEqual(snapME);
    expect(afterConfirmProject.suite.M4).toEqual(snapM4);
    expect(afterConfirmProject.suite.M5).toEqual(snapM5);
    expect(afterConfirmProject.suite.M6).toEqual(snapM6);
    expect(afterConfirmProject.suite.M7).toEqual(snapM7);
    expect(afterConfirmProject.suite.MM).toEqual(snapMM);
    expect(afterConfirmProject.suite.MI).toEqual(snapMI);
  });

  it('executes full HTTP round-trip for rename, star, restore, MU diff preview, and confirm via web/api.ts + Hono createApiApp', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? `http://localhost${input}` : input.toString();
      return app.request(url, init);
    });

    const proj = store.createProject({
      name: 'HTTP全链路确认测试',
      code: 'HTTP-REV-TEST',
      domain: '供应商协同',
      template: 'CONTRACT',
    });
    const m2Before = structuredClone(store.getProject(proj.id)!.suite.M2);

    const p1 = store.createPrototype(proj.id, {
      name: '供应商门户原型',
      htmlContent:
        '<section data-screen-id="SCR-SUP-LIST" data-screen-name="供应商列表"><input data-element-id="EL-SUP-NAME" data-element-label="供应商名称" /></section>',
      source: 'GENERATED',
    });
    const p2 = store.appendPrototypeRevision(p1.prototype.id, {
      htmlContent:
        '<section data-screen-id="SCR-SUP-LIST" data-screen-name="供应商准入台账"><input data-element-id="EL-SUP-NAME" data-element-label="企业全称" data-required="true" /></section>',
      instruction: '完善准入字段',
      source: 'REFINED',
    });

    // 1. Rename & star revision #1 via HTTP PATCH
    const patched = await apiUpdatePrototypeRevisionMeta(p1.prototype.id, p1.revision.id, {
      title: '准入列表首版里程碑',
      starred: true,
    });
    expect(patched.revision.title).toBe('准入列表首版里程碑');
    expect(patched.revision.starred).toBe(true);
    expect(patched.prototype.revisions.map((r) => r.revisionNumber)).toEqual([1, 2]);

    // 2. Confirm revision #1 via HTTP POST
    const conf1 = await apiConfirmPrototypeRevision(proj.id, p1.revision.id);
    expect(conf1.confirmed.revisionId).toBe(p1.revision.id);
    expect(conf1.prototype.aheadOfConfirmedCount).toBe(1);
    expect(conf1.project.suite.MU?.screens[0]?.name).toBe('供应商列表');

    // 3. Restore revision #1 via HTTP POST -> appends revision #3; Confirmed Revision stays #1 (now 2 ahead)
    const restored = await apiRestorePrototypeRevision(p1.prototype.id, p1.revision.id);
    expect(restored.revision.revisionNumber).toBe(3);
    expect(restored.prototype.revisions).toHaveLength(3);
    expect(restored.prototype.confirmedRevisionId).toBe(p1.revision.id);
    expect(restored.prototype.aheadOfConfirmedCount).toBe(2);

    // 4. Preview confirming revision #2 in ConfirmRevisionMuDiffModal BEFORE approving
    stubLocale('zh-CN');
    const previewModalHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <ConfirmRevisionMuDiffModal
          open={true}
          revision={p2.revision}
          confirmedRevision={restored.confirmedRevision}
          suite={store.getProject(proj.id)!.suite}
          domain={proj.domain}
          onConfirm={noop}
          onClose={noop}
        />
      </PreferencesProvider>,
    );
    expect(previewModalHtml).toContain('供应商准入台账');
    expect(previewModalHtml).toContain('企业全称');
    // Still unmutated before approval
    expect(store.getProject(proj.id)!.suite.MU?.screens[0]?.name).toBe('供应商列表');

    // 5. Approve revision #2 via HTTP POST -> updates ONLY MU, M2 remains identical
    const conf2 = await apiConfirmPrototypeRevision(proj.id, p2.revision.id);
    expect(conf2.confirmed.revisionId).toBe(p2.revision.id);
    expect(conf2.project.suite.MU?.screens[0]?.name).toBe('供应商准入台账');
    expect(conf2.project.suite.M2).toEqual(m2Before);
  });
});
