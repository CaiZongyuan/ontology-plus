import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  applyPrototypeBuildEvent,
  emptyPrototypeBuildState,
  prototypeBuildScreen,
  splitPrototypeDocument,
  type PrototypeBuildEvent,
  type PrototypeBuildState,
} from '../../ontology-core/index.js';
import { createWorkspaceStore } from '../../workspace-store/index.js';
import {
  collectUnifiedAgentTurn,
  createPrototypeBuildRun,
  createPrototypeScreenshotter,
  editPrototypeScreen,
  getToolsForAgentKind,
  initPrototypeShell,
  REPORT_REVIEW_OPENAI_TOOL,
  shutdownPrototypeScreenshotter,
  upsertPrototypeScreen,
  type UnifiedAgentSseEvent,
} from '../index.js';

afterAll(async () => {
  await shutdownPrototypeScreenshotter();
});

function sampleMultiScreenDocument(): string {
  const shell = initPrototypeShell({
    appTitle: '禾木烘焙 · 门店订货',
    screens: [
      { screenId: 'SCR-HOME', screenName: '工作台首页', screenType: 'DASHBOARD' },
      { screenId: 'SCR-ORDERS', screenName: '订货单列表', screenType: 'LIST' },
    ],
  });
  const withHome = upsertPrototypeScreen(shell.nextHtml, {
    screenId: 'SCR-HOME',
    screenName: '工作台首页',
    screenType: 'DASHBOARD',
    screenHtml: `<section class="page" data-element-id="EL-HOME-HEAD" data-element-type="CONTAINER">
  <h1>早上好，王店长</h1>
  <button class="btn primary" data-element-id="EL-HOME-NEW" data-element-type="BUTTON">新建订单</button>
</section>`,
  });
  const withOrders = upsertPrototypeScreen(withHome.nextHtml, {
    screenId: 'SCR-ORDERS',
    screenName: '订货单列表',
    screenType: 'LIST',
    screenHtml: `<section class="page" data-element-id="EL-ORDERS-FILTER" data-element-type="CONTAINER">
  <span class="tag">配送中</span>
  <input class="input" data-element-id="EL-ORDERS-KW" data-element-type="INPUT" data-binding="StoreOrder.orderNo" />
</section>
<section class="page too-wide" data-element-id="EL-ORDERS-TABLE" data-element-type="CONTAINER">
  <table data-element-id="EL-ORDERS-GRID" data-element-type="TABLE" data-binding="StoreOrder">
    <tr><td>DH-1025</td><td><span class="tag">配送中</span></td></tr>
  </table>
</section>`,
  });
  return withOrders.nextHtml;
}

describe('report_review & edit_screen tools (#93): schema ordering, unique match, and own-screen scope', () => {
  it('keeps report_review off the lead toolset and puts short fields before long ones', () => {
    const leadTools = getToolsForAgentKind('PROTOTYPE_CO_DESIGN', {
      codeMode: false,
      multiAgentConcurrency: 3,
    });
    const reportTool = leadTools.find((t) => t.name === 'report_review');
    const editTool = leadTools.find((t) => t.name === 'edit_screen');
    expect(reportTool).toBeUndefined();
    expect(editTool).toBeDefined();

    const reportKeys = Object.keys((REPORT_REVIEW_OPENAI_TOOL.function.parameters as { properties: object }).properties);
    expect(reportKeys).toEqual(['screenId', 'findings']);

    const editKeys = Object.keys((editTool!.parameters as { properties: object }).properties);
    expect(editKeys).toEqual(['screenId', 'elementId', 'note', 'find', 'replace']);
  });

  it('replaces a uniquely matched snippet inside the target screen while leaving other screens and shell untouched', () => {
    const before = sampleMultiScreenDocument();
    const res = editPrototypeScreen(before, {
      screenId: 'SCR-ORDERS',
      elementId: 'EL-ORDERS-TABLE',
      note: '收窄订货单表格宽度，让状态列完整显示',
      find: '<section class="page too-wide" data-element-id="EL-ORDERS-TABLE"',
      replace: '<section class="page" data-element-id="EL-ORDERS-TABLE"',
    });

    expect(res.isError).toBe(false);
    expect(res.nextHtml).not.toContain('too-wide');
    expect(res.nextHtml).toContain('<section class="page" data-element-id="EL-ORDERS-TABLE"');
    expect(res.targetAnchor).toMatchObject({
      screenId: 'SCR-ORDERS',
      elementId: 'EL-ORDERS-TABLE',
    });

    // SCR-HOME and shared shell are byte-for-byte untouched.
    const homeStart = before.indexOf('<section id="screen-SCR-HOME"');
    const homeEnd = before.indexOf('</section>', before.indexOf('EL-HOME-NEW')) + '</section>'.length;
    expect(res.nextHtml.slice(homeStart, homeEnd)).toBe(before.slice(homeStart, homeEnd));
  });

  it('rejects 0 matches and >1 matches without mutating the document', () => {
    const before = sampleMultiScreenDocument();

    // 0 matches (including a snippet that lives in SCR-HOME rather than SCR-ORDERS!)
    const zeroInScreen = editPrototypeScreen(before, {
      screenId: 'SCR-ORDERS',
      note: '尝试修改别的屏里的标题',
      find: '<h1>早上好，王店长</h1>',
      replace: '<h1>下午好</h1>',
    });
    expect(zeroInScreen.isError).toBe(true);
    expect(zeroInScreen.nextHtml).toBe(before);
    expect(zeroInScreen.diagnostic).toContain('0');

    // >1 matches (`<span class="tag">配送中</span>` appears twice in SCR-ORDERS)
    const ambiguous = editPrototypeScreen(before, {
      screenId: 'SCR-ORDERS',
      note: '修改状态标签',
      find: '<span class="tag">配送中</span>',
      replace: '<span class="tag warn">配送中</span>',
    });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.nextHtml).toBe(before);
    expect(ambiguous.diagnostic).toContain('2');
  });

  it('strips <style>, <link>, and inline --proto-* overrides, and rejects dropped anchors, unanchored controls, or blocking dialogs', () => {
    const before = sampleMultiScreenDocument();

    // Strips smuggled <style>, <link>, and inline --proto-accent override
    const sanitized = editPrototypeScreen(before, {
      screenId: 'SCR-ORDERS',
      elementId: 'EL-ORDERS-TABLE',
      note: '调整卡片内边距',
      find: '<section class="page too-wide" data-element-id="EL-ORDERS-TABLE" data-element-type="CONTAINER">',
      replace:
        '<style>body{background:#000}</style><link rel="stylesheet" href="https://evil.example/x.css"><section class="page" style="--proto-accent: #ff0000; padding: 16px" data-element-id="EL-ORDERS-TABLE" data-element-type="CONTAINER">',
    });
    expect(sanitized.isError).toBe(false);
    expect(sanitized.nextHtml).not.toMatch(/<style>body|<link|--proto-accent:\s*#ff0000/i);
    expect(sanitized.nextHtml).toContain('padding: 16px');

    // Rejects dropping an existing data-element-id / data-binding
    const droppedAnchor = editPrototypeScreen(before, {
      screenId: 'SCR-ORDERS',
      note: '误删表格锚点',
      find: '<table data-element-id="EL-ORDERS-GRID" data-element-type="TABLE" data-binding="StoreOrder">',
      replace: '<table>',
    });
    expect(droppedAnchor.isError).toBe(true);
    expect(droppedAnchor.nextHtml).toBe(before);

    // Rejects adding an unanchored <button>
    const unanchoredBtn = editPrototypeScreen(before, {
      screenId: 'SCR-ORDERS',
      note: '加一个没有锚点的按钮',
      find: '<td>DH-1025</td>',
      replace: '<td>DH-1025 <button>详情</button></td>',
    });
    expect(unanchoredBtn.isError).toBe(true);
    expect(unanchoredBtn.nextHtml).toBe(before);

    // Rejects window.alert/confirm/prompt
    const dialogAttempt = editPrototypeScreen(before, {
      screenId: 'SCR-ORDERS',
      note: '违规弹窗',
      find: '<td>DH-1025</td>',
      replace: '<td onclick="alert(1)">DH-1025</td>',
    });
    expect(dialogAttempt.isError).toBe(true);
    expect(dialogAttempt.nextHtml).toBe(before);

    // Rejects smuggling a second <section data-screen-id="SCR-HACK">
    const extraScreenAttempt = editPrototypeScreen(before, {
      screenId: 'SCR-ORDERS',
      note: '越界新增屏幕',
      find: '<td>DH-1025</td>',
      replace: '<td>DH-1025</td></section><section data-screen-id="SCR-HACK">hack',
    });
    expect(extraScreenAttempt.isError).toBe(true);
    expect(extraScreenAttempt.nextHtml).toBe(before);

    // Matches snippets starting at outer `<section id="screen-SCR-ORDERS" ...>` (as shown in review prompt)
    // while preserving literal `$100` / `$&` characters and rejecting attempts to alter `data-screen-id`.
    const ordersOuterOpen = before.slice(
      before.indexOf('<section id="screen-SCR-ORDERS"'),
      before.indexOf('>', before.indexOf('<section id="screen-SCR-ORDERS"')) + 1,
    );
    const outerMatchEdit = editPrototypeScreen(before, {
      screenId: 'SCR-ORDERS',
      elementId: 'EL-ORDERS-FILTER',
      note: '外层 section 起点匹配并测试 $ 符号字面替换',
      find: `${ordersOuterOpen}\n<section class="page" data-element-id="EL-ORDERS-FILTER"`,
      replace: `${ordersOuterOpen}\n<section class="page" data-note="客单价 $100 &amp; $&amp;" data-element-id="EL-ORDERS-FILTER"`,
    });
    expect(outerMatchEdit.isError).toBe(false);
    expect(outerMatchEdit.nextHtml).toContain('客单价 $100 &amp; $&amp;');

    const hijackOuterId = editPrototypeScreen(before, {
      screenId: 'SCR-ORDERS',
      note: '尝试篡改外层 data-screen-id',
      find: 'data-screen-id="SCR-ORDERS"',
      replace: 'data-screen-id="SCR-HIJACK"',
    });
    expect(hijackOuterId.isError).toBe(true);
    expect(hijackOuterId.nextHtml).toBe(before);
  });
});

describe('createPrototypeBuildRun review lifecycle & <= 1 round hard cap (#93)', () => {
  it('allows a planned change before review but cannot mark an unwritten screen visually passed', () => {
    const run = createPrototypeBuildRun({ locale: 'en-US', emit: () => undefined });
    run.commitPlan({ screens: [{ screenId: 'SCR-ORDERS', screenName: 'Orders', purpose: 'Change the filter' }] });

    expect(run.checkEditScreenAllowed('SCR-ORDERS', 'change')).toBeNull();
    expect(run.checkEditScreenAllowed('SCR-ORDERS', 'review')).not.toBeNull();
    expect(run.beginScreenReview('SCR-ORDERS')).toBe(false);
    expect(run.commitReportReview({ screenId: 'SCR-ORDERS', findings: [] }).isError).toBe(true);
    expect(prototypeBuildScreen(run.snapshot()!, 'SCR-ORDERS')).toMatchObject({ status: 'queued' });
    expect(run.snapshot()?.log.some((line) => line.kind === 'review_passed')).toBe(false);
  });

  it('allows fixing >=2 findings reported in 1 review round, blocks pre-review main-loop bypasses, and blocks a 2nd review round', () => {
    const events: PrototypeBuildEvent[] = [];
    const run = createPrototypeBuildRun({ locale: 'zh-CN', emit: (e) => events.push(e) });
    run.commitPlan({
      screens: [{ screenId: 'SCR-ORDERS', screenName: '订货单列表', purpose: '查订单' }],
    });
    run.observeLeadScreenWritten(
      'SCR-ORDERS',
      '<section data-screen-id="SCR-ORDERS"><div data-element-id="EL-1"></div><div data-element-id="EL-2"></div></section>',
    );

    // Pre-review `edit_screen` during a Build Plan run is rejected (cannot bypass review cap in main loop)
    expect(run.checkEditScreenAllowed('SCR-ORDERS')).not.toBeNull();

    // Start single review round with 2 reported findings -> both can be fixed in this round!
    expect(run.beginScreenReview('SCR-ORDERS')).toBe(true);
    const report2 = run.commitReportReview({
      screenId: 'SCR-ORDERS',
      findings: [
        { elementId: 'EL-1', issue: '筛选栏间距过挤' },
        { elementId: 'EL-2', issue: '表格右侧状态列被裁切' },
      ],
    });
    expect(report2.isError).toBe(false);
    expect(report2.findings).toHaveLength(2);

    // Fix #1 of 2 -> allowed, screen remains `fixing` for finding #2
    expect(run.checkEditScreenAllowed('SCR-ORDERS')).toBeNull();
    run.commitEditScreen('SCR-ORDERS', {
      elementId: 'EL-1',
      note: '拉开筛选栏间距',
      html: '<section data-screen-id="SCR-ORDERS"><div data-element-id="EL-1"></div><div data-element-id="EL-2"></div></section>',
    });
    expect(prototypeBuildScreen(run.snapshot()!, 'SCR-ORDERS').status).toBe('fixing');
    expect(prototypeBuildScreen(run.snapshot()!, 'SCR-ORDERS').fixActivity).toMatchObject({
      elementId: 'EL-2',
      issue: '表格右侧状态列被裁切',
      state: 'fixing',
    });

    // Fix #2 of 2 -> allowed, completes the 1-round fix quota (`status: 'done'`)
    expect(run.checkEditScreenAllowed('SCR-ORDERS')).toBeNull();
    run.commitEditScreen('SCR-ORDERS', {
      elementId: 'EL-2',
      note: '收窄表格列宽',
      html: '<section data-screen-id="SCR-ORDERS"><div data-element-id="EL-1"></div><div data-element-id="EL-2"></div></section>',
    });
    expect(prototypeBuildScreen(run.snapshot()!, 'SCR-ORDERS')).toMatchObject({
      status: 'done',
      reviewed: 'fixed',
    });

    // 3rd edit_screen or 2nd review round is strictly blocked!
    expect(run.checkEditScreenAllowed('SCR-ORDERS')).not.toBeNull();
    expect(run.canReviewScreen('SCR-ORDERS')).toBe(false);
    expect(run.beginScreenReview('SCR-ORDERS')).toBe(false);
    expect(run.commitReportReview({ screenId: 'SCR-ORDERS', findings: [] }).isError).toBe(true);
  });
  it('enforces at most 1 review + targeted-fix round per screen and overlaps screens and review phases', () => {
    const events: PrototypeBuildEvent[] = [];
    const run = createPrototypeBuildRun({ locale: 'zh-CN', emit: (e) => events.push(e) });
    run.commitPlan({
      screens: [
        { screenId: 'SCR-HOME', screenName: '首页', purpose: '看今日待办' },
        { screenId: 'SCR-ORDERS', screenName: '订货单列表', purpose: '查订单' },
      ],
    });
    run.observeLane({
      laneId: 'l1',
      workerIndex: 1,
      workerLabel: { zh: '', en: '' },
      taskTitle: { zh: '首页', en: 'Home' },
      targetAnchor: { screenId: 'SCR-HOME' },
      status: 'RUNNING',
      startedAt: '',
    });
    run.observeLane({
      laneId: 'l2',
      workerIndex: 2,
      workerLabel: { zh: '', en: '' },
      taskTitle: { zh: '订货单列表', en: 'Orders' },
      targetAnchor: { screenId: 'SCR-ORDERS' },
      status: 'RUNNING',
      startedAt: '',
    });
    run.observeLane({
      laneId: 'l1',
      workerIndex: 1,
      workerLabel: { zh: '', en: '' },
      taskTitle: { zh: '首页', en: 'Home' },
      targetAnchor: { screenId: 'SCR-HOME' },
      status: 'DONE',
      wroteScreen: true,
      startedAt: '',
    });

    // SCR-HOME starts reviewing while SCR-ORDERS is still writing: both `screens` and `review` phases are `now`!
    expect(run.beginScreenReview('SCR-HOME')).toBe(true);
    const mid = run.snapshot()!;
    expect(mid.phases.screens.status).toBe('now');
    expect(mid.phases.review.status).toBe('now');
    expect(prototypeBuildScreen(mid, 'SCR-HOME').status).toBe('reviewing');
    expect(prototypeBuildScreen(mid, 'SCR-ORDERS').status).toBe('writing');

    // Clean pass on SCR-HOME -> status `done`, `reviewed: 'pass'`, and NO second review or edit allowed.
    const passRes = run.commitReportReview({ screenId: 'SCR-HOME', findings: [] });
    expect(passRes.isError).toBe(false);
    expect(prototypeBuildScreen(run.snapshot()!, 'SCR-HOME')).toMatchObject({
      status: 'done',
      agent: 1,
      reviewed: 'pass',
    });
    expect(run.beginScreenReview('SCR-HOME')).toBe(false);
    expect(run.commitReportReview({ screenId: 'SCR-HOME', findings: [] }).isError).toBe(true);
    expect(run.checkEditScreenAllowed('SCR-HOME')).not.toBeNull();

    // SCR-ORDERS finishes writing, gets 1 finding, streams fix narration, applies 1 fix, and blocks any 2nd fix/review!
    run.observeLane({
      laneId: 'l2',
      workerIndex: 2,
      workerLabel: { zh: '', en: '' },
      taskTitle: { zh: '订货单列表', en: 'Orders' },
      targetAnchor: { screenId: 'SCR-ORDERS' },
      status: 'DONE',
      wroteScreen: true,
      startedAt: '',
    });
    expect(run.beginScreenReview('SCR-ORDERS')).toBe(true);
    const findingRes = run.commitReportReview({
      screenId: 'SCR-ORDERS',
      findings: [{ elementId: 'EL-ORDERS-TABLE', issue: '表格右侧超出画板宽度，「状态」列被裁切' }],
    });
    expect(findingRes.isError).toBe(false);
    expect(prototypeBuildScreen(run.snapshot()!, 'SCR-ORDERS')).toMatchObject({
      status: 'fixing',
      finding: '表格右侧超出画板宽度，「状态」列被裁切',
    });

    run.observeEditScreenStream({
      screenId: 'SCR-ORDERS',
      elementId: 'EL-ORDERS-TABLE',
      note: '收窄表格列宽以完整显示状态列',
    });
    expect(prototypeBuildScreen(run.snapshot()!, 'SCR-ORDERS').fixActivity).toMatchObject({
      elementId: 'EL-ORDERS-TABLE',
      state: 'fixing',
    });
    expect(run.checkEditScreenAllowed('SCR-ORDERS')).toBeNull();

    run.commitEditScreen('SCR-ORDERS', {
      elementId: 'EL-ORDERS-TABLE',
      note: '收窄表格列宽以完整显示状态列',
      html: '<section data-screen-id="SCR-ORDERS"><table data-element-id="EL-ORDERS-GRID"></table></section>',
    });
    expect(prototypeBuildScreen(run.snapshot()!, 'SCR-ORDERS')).toMatchObject({
      status: 'done',
      agent: 2,
      reviewed: 'fixed',
      writtenElements: 1,
    });
    expect(run.checkEditScreenAllowed('SCR-ORDERS')).not.toBeNull();
    expect(run.commitReportReview({ screenId: 'SCR-ORDERS', findings: [] }).isError).toBe(true);

    run.finish('succeeded');
    const finalState = run.snapshot()!;
    expect(finalState.phases.screens.status).toBe('done');
    expect(finalState.phases.review.status).toBe('done');
  });
});

const BUILD_EVENT_NAMES = new Set([
  'prototype_build_start',
  'prototype_plan',
  'prototype_build_screen',
  'prototype_phase',
  'prototype_build_log',
]);

function foldBuildEvents(events: UnifiedAgentSseEvent[]): PrototypeBuildState {
  return events
    .filter((e) => BUILD_EVENT_NAMES.has(e.event))
    .map((e) => e.data as unknown as PrototypeBuildEvent)
    .reduce(applyPrototypeBuildEvent, emptyPrototypeBuildState());
}

describe('Server-side Playwright Chromium artboard screenshotter & engine pipeline (#93)', () => {
  it('captures a real 1280x860 PNG screenshot of the active screen in Node and shuts down cleanly', async () => {
    const screenshotter = createPrototypeScreenshotter({ idleCloseMs: 500 });
    try {
      expect(await screenshotter.available()).toBe(true);
      const doc = sampleMultiScreenDocument();
      const capture = await screenshotter.captureScreen({
        documentHtml: doc,
        screenId: 'SCR-ORDERS',
      });
      expect(capture).not.toBeNull();
      expect(capture!.mimeType).toBe('image/png');
      expect(capture!.width).toBe(1280);
      expect(capture!.height).toBe(860);

      const png = Buffer.from(capture!.dataBase64, 'base64');
      // PNG magic header + IHDR width (bytes 16..19) & height (bytes 20..23)
      expect(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
      expect(png.readUInt32BE(16)).toBe(1280);
      expect(png.readUInt32BE(20)).toBe(860);

      // Verifies `[data-screen-id="SCR-ORDERS"]` receives `.is-active` during artboard capture (#93)
      const styledActiveDoc = doc.replace(
        '</head>',
        '<style>[data-screen-id="SCR-ORDERS"].is-active { background: #1e40af !important; min-height: 860px; }</style></head>',
      );
      const activeCapture = await screenshotter.captureScreen({
        documentHtml: styledActiveDoc,
        screenId: 'SCR-ORDERS',
      });
      expect(activeCapture).not.toBeNull();
      expect(activeCapture!.dataBase64).not.toBe(capture!.dataBase64);
    } finally {
      await screenshotter.shutdown();
    }
  });

  it('skips visual check gracefully and records 未做视觉检查 when no browser is available', async () => {
    const unavailable = createPrototypeScreenshotter({
      resolveExecutablePath: () => null,
    });
    expect(await unavailable.available()).toBe(false);

    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    const session = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'PROTOTYPE_CO_DESIGN',
      title: '无浏览器跳过视觉检查',
    });

    const turn = await collectUnifiedAgentTurn(store, {
      sessionId: session.id,
      prompt: '按已确认需求生成首版原型',
      prototypeName: '无浏览器原型',
      mockMode: true,
      screenshotter: unavailable,
    });

    expect(turn.events.some((e) => e.event === 'run_error')).toBe(false);
    const build = foldBuildEvents(turn.events);
    expect(build.phases.review.status).toBe('skipped');
    expect(build.log.some((l) => l.kind === 'phase_skipped' && l.phase === 'review')).toBe(true);
    expect(
      turn.events.some(
        (e) => e.event === 'tool_call' && (e.data.toolName === 'report_review' || e.data.toolName === 'edit_screen'),
      ),
    ).toBe(false);
  });

  it('emits ZERO fake review_started logs or reviewing states when Chromium launch fails, recording 未做视觉检查 honestly', async () => {
    const brokenLauncher = createPrototypeScreenshotter({
      resolveExecutablePath: () => '/nonexistent/chromium-binary-for-issue-93',
    });
    try {
      const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
      store.updateSystemSettings({ mockLlmMode: true });
      const session = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'PROTOTYPE_CO_DESIGN',
        title: '浏览器启动失败跳过检查',
      });

      const turn = await collectUnifiedAgentTurn(store, {
        sessionId: session.id,
        prompt: '按已确认需求生成首版原型',
        prototypeName: '浏览器失败原型',
        mockMode: true,
        screenshotter: brokenLauncher,
      });

      expect(turn.events.some((e) => e.event === 'run_error')).toBe(false);
      const build = foldBuildEvents(turn.events);
      expect(build.phases.review.status).toBe('skipped');
      expect(build.log.some((l) => l.kind === 'review_started')).toBe(false);
      expect(
        turn.events.some(
          (e) =>
            e.event === 'prototype_build_screen' &&
            (e.data.screen as { status?: string } | undefined)?.status === 'reviewing',
        ),
      ).toBe(false);
      expect(build.log.some((l) => l.kind === 'phase_skipped' && l.phase === 'review')).toBe(true);
    } finally {
      await brokenLauncher.shutdown();
    }
  });

  it('sends transient vision screenshot to model, applies <=1 targeted fix round, and stores ZERO screenshot bytes in 界面原型.html or SQLite', async () => {
    const FAKE_SCREENSHOT_MARKER = Buffer.from('transient-review-screenshot-bytes-93-never-persist').toString('base64');
    const seenRequests: Record<string, unknown>[] = [];
    let reviewStep = 0;

    const llmServer = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => {
        raw += String(c);
      });
      req.on('end', () => {
        const body = JSON.parse(raw) as { messages?: unknown[] };
        seenRequests.push(body);
        const msgJson = JSON.stringify(body.messages ?? []);

        let toolCalls: { id: string; name: string; args: Record<string, unknown> }[] | undefined;
        let text: string | undefined;

        if (msgJson.includes('Prototype Screen Visual Check') || msgJson.includes('原型分屏截图视觉检查')) {
          if (msgJson.includes('`SCR-HOME`')) {
            toolCalls = [
              {
                id: 'tc-rev-home',
                name: 'report_review',
                args: { screenId: 'SCR-HOME', findings: [] },
              },
            ];
          } else {
            reviewStep += 1;
            if (reviewStep === 1) {
              toolCalls = [
                {
                  id: 'tc-rev-1',
                  name: 'report_review',
                  args: {
                    screenId: 'SCR-ORDERS',
                    findings: [{ elementId: 'EL-ORDERS-TABLE', issue: '表格右侧超出画板宽度' }],
                  },
                },
              ];
            } else if (reviewStep === 2) {
              // Counterexample check (#1): model tries to mutate SCR-HOME during SCR-ORDERS's review -> MUST be blocked!
              toolCalls = [
                {
                  id: 'tc-fix-rogue-cross-screen',
                  name: 'edit_screen',
                  args: {
                    screenId: 'SCR-HOME',
                    note: '偷改首页标题',
                    find: '<div class="card" data-element-id="EL-HOME-BOX" data-element-type="CONTAINER">首页原貌',
                    replace: '<div class="card" data-element-id="EL-HOME-BOX" data-element-type="CONTAINER">被篡改',
                  },
                },
              ];
            } else if (reviewStep === 3) {
              toolCalls = [
                {
                  id: 'tc-fix-1',
                  name: 'edit_screen',
                  args: {
                    screenId: 'SCR-ORDERS',
                    elementId: 'EL-ORDERS-TABLE',
                    note: '收窄表格宽度',
                    find: '<div class="card too-wide" data-element-id="EL-ORDERS-TABLE" data-element-type="CONTAINER">',
                    replace: '<div class="card" data-element-id="EL-ORDERS-TABLE" data-element-type="CONTAINER">',
                  },
                },
              ];
            } else {
              text = '修正完成。';
            }
          }
        } else if (seenRequests.length === 1) {
          toolCalls = [
            {
              id: 'tc-plan',
              name: 'plan_screens',
              args: {
                screens: [
                  { screenId: 'SCR-HOME', screenName: '首页', purpose: '看总览', screenType: 'DASHBOARD' },
                  { screenId: 'SCR-ORDERS', screenName: '订货单列表', purpose: '查订单', screenType: 'LIST' },
                ],
              },
            },
            {
              id: 'tc-style',
              name: 'define_style',
              args: {
                direction: '简洁暖白台账',
                values: { accent: '#2e6a4e' },
                componentCss: '.card { padding: var(--proto-pad); } .too-wide { min-width: 1600px; }',
                sampleHtml: '<div class="card">样张</div>',
              },
            },
            {
              id: 'tc-scr-home',
              name: 'upsert_prototype_screen',
              args: {
                screenId: 'SCR-HOME',
                screenName: '首页',
                screenType: 'DASHBOARD',
                screenHtml:
                  '<div class="card" data-element-id="EL-HOME-BOX" data-element-type="CONTAINER">首页原貌<button data-element-id="EL-HOME-BTN" data-element-type="BUTTON">查看</button></div>',
              },
            },
            {
              id: 'tc-scr',
              name: 'upsert_prototype_screen',
              args: {
                screenId: 'SCR-ORDERS',
                screenName: '订货单列表',
                screenType: 'LIST',
                screenHtml:
                  '<div class="card too-wide" data-element-id="EL-ORDERS-TABLE" data-element-type="CONTAINER"><button data-element-id="EL-ORD-BTN" data-element-type="BUTTON">导出</button></div>',
              },
            },
          ];
        } else {
          text = '首版原型已生成。';
        }

        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        if (toolCalls) {
          res.write(
            `data: ${JSON.stringify({
              id: `cmpl-${seenRequests.length}`,
              object: 'chat.completion.chunk',
              choices: [
                {
                  index: 0,
                  delta: {
                    role: 'assistant',
                    tool_calls: toolCalls.map((tc, index) => ({
                      index,
                      id: tc.id,
                      type: 'function',
                      function: { name: tc.name, arguments: JSON.stringify(tc.args) },
                    })),
                  },
                  finish_reason: 'tool_calls',
                },
              ],
            })}\n\n`,
          );
        } else {
          res.write(
            `data: ${JSON.stringify({
              id: `cmpl-${seenRequests.length}`,
              object: 'chat.completion.chunk',
              choices: [{ index: 0, delta: { role: 'assistant', content: text ?? '完成。' }, finish_reason: 'stop' }],
            })}\n\n`,
          );
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });

    await new Promise<void>((resolve) => llmServer.listen(0, '127.0.0.1', resolve));
    const port = (llmServer.address() as { port: number }).port;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onto-review-93-'));
    const dbPath = path.join(tmpDir, 'review-93.db');
    let store: ReturnType<typeof createWorkspaceStore> | undefined;

    try {
      store = createWorkspaceStore({ dbPath, enableFileMirror: false });
      for (const p of store.listLlmProviders()) store.saveLlmProvider({ ...p, enabled: false });
      store.saveLlmProvider({
        id: 'llm-vision-93',
        name: 'Vision 93 Gateway',
        providerType: 'OPENAI_COMPATIBLE',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: 'test-key',
        defaultModel: 'auto/glm-5.3-flash',
        availableModels: ['auto/glm-5.3-flash'],
        supportsVision: true,
        enabled: true,
      });

      const session = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'PROTOTYPE_CO_DESIGN',
        title: '视觉检查与局部修正测试',
        providerId: 'llm-vision-93',
        multiAgentConcurrency: 1,
      });

      const turn = await collectUnifiedAgentTurn(store, {
        sessionId: session.id,
        prompt: '生成订货单原型',
        mockMode: false,
        screenshotter: {
          available: () => true,
          captureScreen: async () => ({
            mimeType: 'image/png',
            dataBase64: FAKE_SCREENSHOT_MARKER,
            width: 1280,
            height: 860,
          }),
        },
      });

      expect(turn.events.some((e) => e.event === 'run_error')).toBe(false);
      // Screenshot was sent as vision input on the review request
      const reviewWireJson = JSON.stringify(seenRequests);
      expect(reviewWireJson).toContain(FAKE_SCREENSHOT_MARKER);
      // Cross-screen `edit_screen` attempt (`tc-fix-rogue-cross-screen`) was rejected as an error!
      const rogueResult = turn.events.find(
        (e) => e.event === 'tool_result' && (e.data.trace as { id?: string }).id === 'tc-fix-rogue-cross-screen',
      );
      expect(rogueResult).toBeDefined();
      expect((rogueResult!.data.trace as { isError: boolean }).isError).toBe(true);

      const proto = store.getPrototype(turn.session.targetId!)!;
      const slices = splitPrototypeDocument(proto.htmlContent).screens;
      // SCR-HOME stayed untouched ("首页原貌"), while SCR-ORDERS got its targeted fix (no `too-wide`)!
      const homeSlice = slices.find((s) => s.screenId === 'SCR-HOME')!;
      expect(homeSlice.html).toContain('首页原貌');
      expect(homeSlice.html).not.toContain('被篡改');
      const ordersSlice = slices.find((s) => s.screenId === 'SCR-ORDERS')!;
      expect(ordersSlice.html).not.toContain('too-wide');
      expect(ordersSlice.html).toContain('data-element-id="EL-ORDERS-TABLE"');

      // Screenshot is NEVER stored in 界面原型.html or SQLite
      expect(proto.htmlContent).not.toContain(FAKE_SCREENSHOT_MARKER);
      expect(proto.htmlContent).not.toContain('data:image/');

      const req = createRequire(import.meta.url);
      const { DatabaseSync } = req('node:sqlite') as {
        DatabaseSync: new (p: string) => {
          prepare: (sql: string) => { all: () => Record<string, unknown>[] };
          close: () => void;
        };
      };
      // Visual review Model Calls record Context Snapshots (ADR 0017) without persisting screenshot bytes
      const recordedCalls = store.listModelCalls(session.projectId, session.id);
      const reviewCalls = recordedCalls.filter(
        (c) => c.purpose === 'SUBAGENT' && c.laneLabel?.zh.startsWith('视觉检查'),
      );
      expect(reviewCalls.length).toBeGreaterThanOrEqual(2);
      const firstReviewDetail = store.getModelCall(session.projectId, reviewCalls[0]!.id);
      expect(firstReviewDetail?.included.some((i) => i.content.includes('[image: image/png'))).toBe(true);
      expect(JSON.stringify(firstReviewDetail)).not.toContain(FAKE_SCREENSHOT_MARKER);

      const rawDb = new DatabaseSync(dbPath);
      try {
        const dump = JSON.stringify({
          entities: rawDb.prepare('SELECT payload_json FROM workspace_entities').all(),
          checkpoints: rawDb.prepare('SELECT state_json FROM agent_checkpoints').all(),
        });
        expect(dump).not.toContain(FAKE_SCREENSHOT_MARKER);
        expect(dump).not.toContain('data:image/');
      } finally {
        rawDb.close();
      }
    } finally {
      await new Promise<void>((resolve) => llmServer.close(() => resolve()));
      store?.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('Mock replay includes a real 发现问题 -> 局部修正 round on SCR-ORDERS (#93)', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    const session = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'PROTOTYPE_CO_DESIGN',
      title: '模拟回放检查修正',
    });

    const turn = await collectUnifiedAgentTurn(store, {
      sessionId: session.id,
      prompt: '按已确认的需求生成首版原型',
      prototypeName: '门店订货回放原型',
      mockMode: true,
    });

    expect(turn.events.some((e) => e.event === 'run_error')).toBe(false);
    const build = foldBuildEvents(turn.events);
    expect(build.phases.review.status).toBe('done');
    expect(prototypeBuildScreen(build, 'SCR-ORDERS')).toMatchObject({
      status: 'done',
      reviewed: 'fixed',
    });
    expect(prototypeBuildScreen(build, 'SCR-HOME')).toMatchObject({
      status: 'done',
      reviewed: 'pass',
    });
    expect(build.log.some((l) => l.kind === 'review_finding' && l.screenId === 'SCR-ORDERS')).toBe(true);
    expect(build.log.some((l) => l.kind === 'screen_fixed' && l.screenId === 'SCR-ORDERS')).toBe(true);

    // Saved prototype has the fixed SCR-ORDERS (no `too-wide` on its table section) and zero embedded screenshots
    const proto = store.listPrototypes('proj-contract').find((p) => p.name === '门店订货回放原型')!;
    const ordersHtml = splitPrototypeDocument(proto.htmlContent).screens.find((s) => s.screenId === 'SCR-ORDERS')!.html;
    expect(ordersHtml).not.toContain('class="page too-wide"');
    expect(ordersHtml).toContain('class="page" data-element-id="EL-ORDERS-TABLE"');
    expect(proto.htmlContent).not.toContain('data:image/');
  });
});

