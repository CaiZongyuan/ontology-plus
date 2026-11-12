import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { createWorkspaceStore } from '../../workspace-store/index.js';
import {
  abortActiveAgentSessionAsync,
  attachUnifiedAgentSessionLiveStream,
  collectUnifiedAgentTurn,
  editPrototypeAnchor,
  ensurePrototypeCoDesignSession,
  formatSelectionsForPrompt,
  getLiveAgentSessionStatus,
  listPrototypeAnchors,
  readPrototypeAnchor,
  rewritePrototypePage,
  runUnifiedAgentSessionStream,
  type UnifiedAgentSseEvent,
} from '../index.js';

const MULTI_SCREEN_PROTOTYPE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>合同共创原型</title>
  <style>
    /* Untouched custom spacing & comment */
    .ledger-card { padding: 14px   18px; border: 1px solid #d8d4ca; }
  </style>
</head>
<body>
  <!-- Screen 1: Ledger (must stay byte-for-byte identical when Screen 2 is edited) -->
  <section data-screen-id="SCR-CONTRACT-LIST" data-screen-name="合同台账" data-screen-type="LIST" class="ledger-card">
    <header class="hdr"   data-custom='keep-single-quotes'>
      <h2>合同台账总览</h2>
      <input type="text" placeholder="按编号筛选" data-element-id="EL-FILTER-CODE" data-element-type="INPUT" data-element-label="合同编号筛选" data-binding="Contract.contractNo" />
      <button type="button" data-element-id="EL-BTN-QUERY" data-element-type="BUTTON" data-element-label="检索台账" data-event-id="UIE-QUERY-CONTRACT">立即检索</button>
    </header>
  </section>

  <!-- Screen 2: Approval -->
  <section data-screen-id="SCR-CONTRACT-APPROVAL" data-screen-name="合同审批工作台" data-screen-type="APPROVAL">
    <div class="approval-panel">
      <textarea rows="3" data-element-id="EL-APPROVAL-OPINION" data-element-type="TEXTAREA" data-element-label="审批意见" data-binding="Contract.approvalNote"></textarea>
      <div class="action-bar">
        <button type="button" class="btn-primary" data-element-id="EL-BTN-APPROVE" data-element-type="BUTTON" data-element-label="审批通过" data-event-id="UIE-APPROVE-CONTRACT">审批通过并归档</button>
      </div>
    </div>
  </section>

  <script>
    const thresholdCheck = (amt) => amt > 100000 && amt < 500000;
  </script>
</body>
</html>`;

describe('Prototype Semantic-Anchor Tools (Slice 1)', () => {
  it('lists all screens and anchored elements and reads only the targeted anchor fragment without dumping other screens', () => {
    const overview = listPrototypeAnchors(MULTI_SCREEN_PROTOTYPE_HTML);
    expect(overview.screens).toEqual([
      {
        screenId: 'SCR-CONTRACT-LIST',
        screenName: '合同台账',
        screenType: 'LIST',
        elementCount: 2,
      },
      {
        screenId: 'SCR-CONTRACT-APPROVAL',
        screenName: '合同审批工作台',
        screenType: 'APPROVAL',
        elementCount: 2,
      },
    ]);
    expect(overview.elements.map((e) => e.elementId)).toEqual([
      'EL-FILTER-CODE',
      'EL-BTN-QUERY',
      'EL-APPROVAL-OPINION',
      'EL-BTN-APPROVE',
    ]);
    expect(overview.elements[0]).toMatchObject({
      elementId: 'EL-FILTER-CODE',
      screenId: 'SCR-CONTRACT-LIST',
      elementType: 'INPUT',
      label: '合同编号筛选',
      binding: 'Contract.contractNo',
    });

    const readBtn = readPrototypeAnchor(MULTI_SCREEN_PROTOTYPE_HTML, {
      elementId: 'EL-BTN-APPROVE',
    });
    expect(readBtn.isError).toBe(false);
    expect(readBtn.fragment).toBe(
      '<button type="button" class="btn-primary" data-element-id="EL-BTN-APPROVE" data-element-type="BUTTON" data-element-label="审批通过" data-event-id="UIE-APPROVE-CONTRACT">审批通过并归档</button>',
    );
    expect(readBtn.targetAnchor).toMatchObject({
      screenId: 'SCR-CONTRACT-APPROVAL',
      elementId: 'EL-BTN-APPROVE',
    });
    // Must NOT dump Screen 1 markup
    expect(readBtn.fragment).not.toContain('SCR-CONTRACT-LIST');
    expect(readBtn.fragment).not.toContain('EL-FILTER-CODE');

    const readBySelector = readPrototypeAnchor(MULTI_SCREEN_PROTOTYPE_HTML, {
      cssSelector: 'section[data-screen-id="SCR-CONTRACT-APPROVAL"] .action-bar > button',
    });
    expect(readBySelector.isError).toBe(false);
    expect(readBySelector.targetAnchor?.elementId).toBe('EL-BTN-APPROVE');
  });

  it('edits only the targeted anchor while keeping untouched screens, sibling elements, whitespace, and scripts byte-for-byte identical', () => {
    const screen1Start = MULTI_SCREEN_PROTOTYPE_HTML.indexOf('<!-- Screen 1:');
    const screen2Start = MULTI_SCREEN_PROTOTYPE_HTML.indexOf('<!-- Screen 2:');
    const beforeScreen1Prefix = MULTI_SCREEN_PROTOTYPE_HTML.slice(0, screen2Start);
    const scriptSuffix = MULTI_SCREEN_PROTOTYPE_HTML.slice(
      MULTI_SCREEN_PROTOTYPE_HTML.indexOf('<script>'),
    );
    const opinionOriginal = readPrototypeAnchor(MULTI_SCREEN_PROTOTYPE_HTML, {
      elementId: 'EL-APPROVAL-OPINION',
    }).fragment;

    // 1. insert_after_element on EL-BTN-APPROVE
    const inserted = editPrototypeAnchor(MULTI_SCREEN_PROTOTYPE_HTML, {
      elementId: 'EL-BTN-APPROVE',
      operation: 'insert_after_element',
      htmlFragment:
        '<button type="button" class="btn-secondary" data-element-id="EL-BTN-REJECT" data-element-type="BUTTON" data-element-label="退回重审" data-event-id="UIE-REJECT-CONTRACT">退回修改</button>',
    });
    expect(inserted.isError).toBe(false);
    expect(screen1Start).toBeGreaterThan(0);

    // Prefix including <head>, <style>, and entire Screen 1 (with single quotes & triple spaces) is byte-for-byte identical!
    expect(inserted.nextHtml.slice(0, screen2Start)).toBe(beforeScreen1Prefix);
    // Trailing <script> block is byte-for-byte identical!
    expect(inserted.nextHtml.slice(inserted.nextHtml.indexOf('<script>'))).toBe(scriptSuffix);
    // Untouched sibling element inside Screen 2 is byte-for-byte identical!
    expect(
      readPrototypeAnchor(inserted.nextHtml, { elementId: 'EL-APPROVAL-OPINION' }).fragment,
    ).toBe(opinionOriginal);
    expect(inserted.nextHtml).toContain('data-element-id="EL-BTN-REJECT"');

    // 2. update_attributes on EL-BTN-APPROVE preserves inner text and all other markup byte-for-byte
    const updatedAttrs = editPrototypeAnchor(inserted.nextHtml, {
      elementId: 'EL-BTN-APPROVE',
      operation: 'update_attributes',
      attributes: {
        'data-element-label': '法务终审通过',
        class: 'btn-primary btn-emphasized',
      },
    });
    expect(updatedAttrs.isError).toBe(false);
    expect(updatedAttrs.nextHtml.slice(0, screen2Start)).toBe(beforeScreen1Prefix);
    expect(
      readPrototypeAnchor(updatedAttrs.nextHtml, { elementId: 'EL-BTN-APPROVE' }).fragment,
    ).toContain('data-element-label="法务终审通过"');
    expect(
      readPrototypeAnchor(updatedAttrs.nextHtml, { elementId: 'EL-BTN-APPROVE' }).fragment,
    ).toContain('data-event-id="UIE-APPROVE-CONTRACT"');

    // 3. append_to_screen on SCR-CONTRACT-APPROVAL leaves SCR-CONTRACT-LIST untouched
    const appendedToScreen = editPrototypeAnchor(updatedAttrs.nextHtml, {
      screenId: 'SCR-CONTRACT-APPROVAL',
      operation: 'append_to_screen',
      htmlFragment:
        '<div class="audit-tip" data-element-id="EL-AUDIT-BADGE" data-element-type="BADGE" data-element-label="双签提醒">大额合同需财务双签</div>',
    });
    expect(appendedToScreen.isError).toBe(false);
    expect(appendedToScreen.nextHtml.slice(0, screen2Start)).toBe(beforeScreen1Prefix);
    expect(appendedToScreen.nextHtml).toContain('data-element-id="EL-AUDIT-BADGE"');
  });

  it('rejects edits that drop existing semantic anchors, add unanchored interactive controls, or use blocking browser dialogs', () => {
    // 1. Dropping existing data-event-id or data-element-id on replace_element is rejected
    const droppedEvent = editPrototypeAnchor(MULTI_SCREEN_PROTOTYPE_HTML, {
      elementId: 'EL-BTN-APPROVE',
      operation: 'replace_element',
      htmlFragment:
        '<button type="button" data-element-id="EL-BTN-APPROVE" data-element-type="BUTTON">审批通过（丢失了 data-event-id）</button>',
    });
    expect(droppedEvent.isError).toBe(true);
    expect(droppedEvent.diagnostic).toContain('UIE-APPROVE-CONTRACT');
    expect(droppedEvent.nextHtml).toBe(MULTI_SCREEN_PROTOTYPE_HTML);

    // 2. Dropping existing data-binding on replace_element is rejected
    const droppedBinding = editPrototypeAnchor(MULTI_SCREEN_PROTOTYPE_HTML, {
      elementId: 'EL-FILTER-CODE',
      operation: 'replace_element',
      htmlFragment:
        '<input type="text" data-element-id="EL-FILTER-CODE" data-element-type="INPUT" />',
    });
    expect(droppedBinding.isError).toBe(true);
    expect(droppedBinding.diagnostic).toContain('Contract.contractNo');

    // 3. Adding a new <button> or <select> without valid data-element-id + data-element-type is rejected
    const unanchoredBtn = editPrototypeAnchor(MULTI_SCREEN_PROTOTYPE_HTML, {
      screenId: 'SCR-CONTRACT-APPROVAL',
      operation: 'append_to_screen',
      htmlFragment: '<div class="extra"><button type="button">无锚点按钮</button></div>',
    });
    expect(unanchoredBtn.isError).toBe(true);
    expect(unanchoredBtn.diagnostic).toContain('data-element-id');

    const invalidElementType = editPrototypeAnchor(MULTI_SCREEN_PROTOTYPE_HTML, {
      screenId: 'SCR-CONTRACT-APPROVAL',
      operation: 'append_to_screen',
      htmlFragment:
        '<select data-element-id="EL-RISK-LEVEL" data-element-type="NOT_A_VALID_TYPE"><option>高</option></select>',
    });
    expect(invalidElementType.isError).toBe(true);
    expect(invalidElementType.diagnostic).toContain('data-element-type');

    // 4. Blocking window.alert / confirm / prompt is rejected
    const blockingAlert = editPrototypeAnchor(MULTI_SCREEN_PROTOTYPE_HTML, {
      elementId: 'EL-BTN-APPROVE',
      operation: 'replace_element',
      htmlFragment:
        '<button type="button" onclick="window.alert(\'ok\')" data-element-id="EL-BTN-APPROVE" data-element-type="BUTTON" data-event-id="UIE-APPROVE-CONTRACT">审批通过</button>',
    });
    expect(blockingAlert.isError).toBe(true);
    expect(blockingAlert.diagnostic).toMatch(/alert|confirm|prompt/i);

    // 5. Valid replacement preserving anchors and adding a valid anchored control succeeds
    const validReplace = editPrototypeAnchor(MULTI_SCREEN_PROTOTYPE_HTML, {
      elementId: 'EL-BTN-APPROVE',
      operation: 'replace_element',
      htmlFragment:
        '<button type="button" class="btn-primary is-refined" data-element-id="EL-BTN-APPROVE" data-element-type="BUTTON" data-element-label="审批通过并签章" data-event-id="UIE-APPROVE-CONTRACT">审批通过并签章</button>',
    });
    expect(validReplace.isError).toBe(false);
    expect(validReplace.nextHtml).toContain('is-refined');

    // 6. Full-page rewrite validates screen anchors, control anchors, and zero alert/confirm/prompt
    const badRewrite = rewritePrototypePage(
      MULTI_SCREEN_PROTOTYPE_HTML,
      '<div>No screen id and <button onclick="confirm(\'sure?\')">Bad</button></div>',
    );
    expect(badRewrite.isError).toBe(true);
  });
});

describe('PROTOTYPE_CO_DESIGN Session Turn, Revisions & Non-Mock Failure (Slice 2)', () => {
  it('links one PROTOTYPE_CO_DESIGN session per prototype, executes read+edit anchor tools in Mock mode, appends one AGENT_RUN revision, and never mutates suite.MU', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });

    const beforeMu = JSON.stringify(store.getProject('proj-contract')!.suite.MU);
    const createdProto = store.createPrototype('proj-contract', {
      name: '合同共创方向 A',
      htmlContent: MULTI_SCREEN_PROTOTYPE_HTML,
      source: 'GENERATED',
    });

    const session = ensurePrototypeCoDesignSession(
      store,
      'proj-contract',
      createdProto.prototype.id,
    );
    expect(session.agentKind).toBe('PROTOTYPE_CO_DESIGN');
    expect(session.targetId).toBe(createdProto.prototype.id);
    expect(store.getPrototype(createdProto.prototype.id)?.coDesignSessionId).toBe(session.id);

    // Cloned prototype gets a forked co-design session bound to the clone
    const cloned = store.clonePrototype(createdProto.prototype.id, { name: '合同共创方向 B' });
    expect(cloned.coDesignSessionId).toBeTruthy();
    expect(cloned.coDesignSessionId).not.toBe(session.id);
    expect(store.getAgentSession(cloned.coDesignSessionId!)?.targetId).toBe(cloned.id);

    const selectionBlock = formatSelectionsForPrompt(
      [
        {
          kind: 'ELEMENT',
          cssSelector: 'button[data-element-id="EL-BTN-APPROVE"]',
          tagName: 'button',
          label: '审批通过',
          screenId: 'SCR-CONTRACT-APPROVAL',
          elementId: 'EL-BTN-APPROVE',
          eventId: 'UIE-APPROVE-CONTRACT',
          note: '在此按钮旁补充法务退回修改按钮',
        },
      ],
      'zh-CN',
    );

    const screen1Before = readPrototypeAnchor(MULTI_SCREEN_PROTOTYPE_HTML, {
      screenId: 'SCR-CONTRACT-LIST',
    }).fragment;

    const { events, session: completedSession } = await collectUnifiedAgentTurn(store, {
      sessionId: session.id,
      prompt: `${selectionBlock}请在审批通过按钮后增加退回重审按钮`,
      mockMode: true,
    });

    expect(completedSession.status).toBe('IDLE');
    const lastAssistant = completedSession.messages.filter((m) => m.role === 'assistant').at(-1)!;
    expect(lastAssistant.errorDiagnostic).toBeUndefined();

    const toolNames = (lastAssistant.toolCalls ?? []).map((t) => t.toolName);
    expect(toolNames).toContain('read_prototype_anchor');
    expect(toolNames).toContain('edit_prototype_anchor');

    const editTrace = lastAssistant.toolCalls!.find((t) => t.toolName === 'edit_prototype_anchor')!;
    expect(editTrace.isError).toBe(false);
    expect(editTrace.targetAnchor).toMatchObject({
      screenId: 'SCR-CONTRACT-APPROVAL',
      elementId: 'EL-BTN-APPROVE',
    });

    // Appended exactly ONE new revision (1 initial + 1 AGENT_RUN = 2)
    const updatedProto = store.getPrototype(createdProto.prototype.id)!;
    expect(updatedProto.revisions).toHaveLength(2);
    expect(updatedProto.revisions[1]!.source).toBe('AGENT_RUN');
    expect(updatedProto.htmlContent).not.toContain('AI 微调已生效');
    expect(updatedProto.htmlContent).not.toContain('AI Refinement Applied');

    // Screen 1 remained byte-for-byte identical!
    expect(
      readPrototypeAnchor(updatedProto.htmlContent, { screenId: 'SCR-CONTRACT-LIST' }).fragment,
    ).toBe(screen1Before);

    // Attached PROTOTYPE_REVISION artifact
    const revArtifact = (lastAssistant.artifacts ?? []).find(
      (a) => a.kind === 'PROTOTYPE_REVISION',
    );
    expect(revArtifact).toMatchObject({
      kind: 'PROTOTYPE_REVISION',
      prototypeId: createdProto.prototype.id,
      revisionId: updatedProto.revisions[1]!.id,
      revisionNumber: 2,
    });
    expect(events.some((ev) => ev.event === 'artifact')).toBe(true);

    // suite.MU was NOT mutated by prototype co-design refinement (ADR 0010)
    expect(JSON.stringify(store.getProject('proj-contract')!.suite.MU)).toBe(beforeMu);
  });

  it('self-repairs in the same turn when an anchored edit initially omits semantic anchors', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    const createdProto = store.createPrototype('proj-contract', {
      name: '自修复验证原型',
      htmlContent: MULTI_SCREEN_PROTOTYPE_HTML,
      source: 'GENERATED',
    });
    const session = ensurePrototypeCoDesignSession(
      store,
      'proj-contract',
      createdProto.prototype.id,
    );

    const { session: completed } = await collectUnifiedAgentTurn(store, {
      sessionId: session.id,
      prompt: '[TEST_ANCHOR_SELF_REPAIR] 在 SCR-CONTRACT-APPROVAL 增加加急催办按钮',
      mockMode: true,
    });

    const lastAssistant = completed.messages.filter((m) => m.role === 'assistant').at(-1)!;
    const editCalls = (lastAssistant.toolCalls ?? []).filter(
      (t) => t.toolName === 'edit_prototype_anchor',
    );
    expect(editCalls.length).toBeGreaterThanOrEqual(2);
    expect(editCalls[0]!.isError).toBe(true);
    expect(editCalls[1]!.isError).toBe(false);
    expect(editCalls[1]!.validatorRepair).toBe(true);
    expect(store.getPrototype(createdProto.prototype.id)!.revisions).toHaveLength(2);
  });

  it('marks the run FAILED with real diagnostic on empty or errored model response in non-Mock mode and NEVER injects fake badges', async () => {
    // Fake OpenAI-compatible HTTP server returning empty content on 1st call and 502 error on 2nd call
    let callCount = 0;
    const server = http.createServer((req, res) => {
      if (req.url?.endsWith('/chat/completions')) {
        callCount += 1;
        if (callCount === 1) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
          });
          // Stream empty assistant delta and [DONE]
          res.write(
            `data: ${JSON.stringify({
              id: 'chatcmpl-empty',
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: 'empty-live-model',
              choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
            })}\n\n`,
          );
          res.end('data: [DONE]\n\n');
          return;
        }
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Upstream gateway bad gateway 502' } }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };

    try {
      const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
      store.updateSystemSettings({ mockLlmMode: false });
      for (const p of store.listLlmProviders()) {
        store.saveLlmProvider({ ...p, enabled: false });
      }
      store.saveLlmProvider({
        id: 'llm-live-test',
        name: 'Test Live Gateway',
        providerType: 'OPENAI_COMPATIBLE',
        baseUrl: `http://127.0.0.1:${addr.port}/v1`,
        apiKey: 'test-key',
        defaultModel: 'empty-live-model',
        availableModels: ['empty-live-model'],
        enabled: true,
      });

      const createdProto = store.createPrototype('proj-contract', {
        name: '非 Mock 失败测试原型',
        htmlContent: MULTI_SCREEN_PROTOTYPE_HTML,
        source: 'GENERATED',
      });
      const session = ensurePrototypeCoDesignSession(
        store,
        'proj-contract',
        createdProto.prototype.id,
      );

      // 1. Empty model response -> FAILED with real diagnostic, zero revisions appended, HTML untouched!
      const emptyTurn = await collectUnifiedAgentTurn(store, {
        sessionId: session.id,
        prompt: '在台账顶部增加导出按钮',
        mockMode: false,
      });
      expect(emptyTurn.events.some((ev) => ev.event === 'run_error')).toBe(true);
      expect(emptyTurn.session.status).toBe('ERROR');
      const emptyAssistant = emptyTurn.session.messages
        .filter((m) => m.role === 'assistant')
        .at(-1)!;
      expect(emptyAssistant.errorDiagnostic).toBeDefined();
      expect(emptyAssistant.errorDiagnostic!.message).toMatch(/空响应|empty/i);

      const protoAfterEmpty = store.getPrototype(createdProto.prototype.id)!;
      expect(protoAfterEmpty.revisions).toHaveLength(1);
      expect(protoAfterEmpty.htmlContent).toBe(MULTI_SCREEN_PROTOTYPE_HTML);
      expect(protoAfterEmpty.htmlContent).not.toContain('AI 微调已生效');
      expect(protoAfterEmpty.htmlContent).not.toContain('AI Refined');

      // 2. Upstream 502 error -> FAILED with real cause, HTML still untouched!
      const errTurn = await collectUnifiedAgentTurn(store, {
        sessionId: session.id,
        prompt: '再次尝试精修',
        mockMode: false,
      });
      expect(errTurn.events.some((ev) => ev.event === 'run_error')).toBe(true);
      expect(errTurn.session.status).toBe('ERROR');
      const errAssistant = errTurn.session.messages.filter((m) => m.role === 'assistant').at(-1)!;
      expect(errAssistant.errorDiagnostic?.message).toBeTruthy();
      expect(store.getPrototype(createdProto.prototype.id)!.revisions).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('Durable Background Session Runner, SSE Re-Attach, USER_ABORT & Queue (Slice 3)', () => {
  it('continues running in the background when SSE disconnects, saves checkpoints, and replays+streams via attachUnifiedAgentSessionLiveStream', async () => {
    let llmRound = 0;
    const server = http.createServer(async (req, res) => {
      if (req.url?.endsWith('/chat/completions')) {
        llmRound += 1;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        });
        await new Promise((r) => setTimeout(r, 80));
        if (llmRound === 1) {
          res.write(
            `data: ${JSON.stringify({
              id: 'chatcmpl-bg-1',
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: 'bg-live-model',
              choices: [
                {
                  index: 0,
                  delta: {
                    role: 'assistant',
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_bg_edit_1',
                        type: 'function',
                        function: {
                          name: 'edit_prototype_anchor',
                          arguments: JSON.stringify({
                            elementId: 'EL-BTN-APPROVE',
                            operation: 'insert_after_element',
                            htmlFragment:
                              '<button type="button" data-element-id="EL-BTN-BG-SAVE" data-element-type="BUTTON" data-element-label="暂存草稿">暂存草稿</button>',
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

        await new Promise((r) => setTimeout(r, 80));
        res.write(
          `data: ${JSON.stringify({
            id: 'chatcmpl-bg-2',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'bg-live-model',
            choices: [
              {
                index: 0,
                delta: { role: 'assistant', content: '已在后台完成暂存草稿按钮的局部挂载。' },
                finish_reason: 'stop',
              },
            ],
          })}\n\n`,
        );
        res.end('data: [DONE]\n\n');
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };

    try {
      const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
      store.updateSystemSettings({ mockLlmMode: false });
      for (const p of store.listLlmProviders()) {
        store.saveLlmProvider({ ...p, enabled: false });
      }
      store.saveLlmProvider({
        id: 'llm-bg-test',
        name: 'BG Test Gateway',
        providerType: 'OPENAI_COMPATIBLE',
        baseUrl: `http://127.0.0.1:${addr.port}/v1`,
        apiKey: 'test-key',
        defaultModel: 'bg-live-model',
        availableModels: ['bg-live-model'],
        enabled: true,
      });

      const createdProto = store.createPrototype('proj-contract', {
        name: '后台存活原型',
        htmlContent: MULTI_SCREEN_PROTOTYPE_HTML,
        source: 'GENERATED',
      });
      const session = ensurePrototypeCoDesignSession(
        store,
        'proj-contract',
        createdProto.prototype.id,
      );

      // 1. Start stream and immediately disconnect HTTP client after first event
      const disconnectCtrl = new AbortController();
      const firstStreamEvents: UnifiedAgentSseEvent[] = [];
      for await (const ev of runUnifiedAgentSessionStream(store, {
        sessionId: session.id,
        prompt: '在审批通过后增加暂存草稿按钮',
        mockMode: false,
        signal: disconnectCtrl.signal,
      })) {
        firstStreamEvents.push(ev);
        if (ev.event === 'session_meta') {
          disconnectCtrl.abort();
        }
      }

      // First SSE reader detached, while background runner is STILL active!
      expect(firstStreamEvents[0]?.event).toBe('session_meta');
      expect(getLiveAgentSessionStatus(store, session.id).active).toBe(true);

      // 2. Re-attach via attachUnifiedAgentSessionLiveStream and collect replayed + live events
      const reattachedEvents: UnifiedAgentSseEvent[] = [];
      for await (const ev of attachUnifiedAgentSessionLiveStream(store, session.id)) {
        reattachedEvents.push(ev);
      }

      expect(reattachedEvents.some((e) => e.event === 'session_meta')).toBe(true);
      expect(reattachedEvents.some((e) => e.event === 'tool_result')).toBe(true);
      expect(reattachedEvents.some((e) => e.event === 'artifact')).toBe(true);
      expect(reattachedEvents.some((e) => e.event === 'message_end')).toBe(true);

      const finalSession = store.getAgentSession(session.id)!;
      expect(finalSession.status).toBe('IDLE');
      const lastAssistant = finalSession.messages.filter((m) => m.role === 'assistant').at(-1)!;
      expect(lastAssistant.cancelled).toBeUndefined();
      expect(lastAssistant.content).toContain('暂存草稿');

      // Checkpoint was saved!
      const checkpoint = store.loadAgentCheckpoint(session.id);
      expect(checkpoint).toBeDefined();

      // Prototype revision was appended!
      const finalProto = store.getPrototype(createdProto.prototype.id)!;
      expect(finalProto.revisions).toHaveLength(2);
      expect(finalProto.htmlContent).toContain('EL-BTN-BG-SAVE');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('marks the turn cancelled (cancelled: true) ONLY on explicit USER_ABORT without appending partial prototype revisions', async () => {
    const server = http.createServer(async (req, res) => {
      if (req.url?.endsWith('/chat/completions')) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        });
        // Hold stream open until aborted
        await new Promise((r) => setTimeout(r, 600));
        if (!res.destroyed) {
          res.end('data: [DONE]\n\n');
        }
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };

    try {
      const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
      store.updateSystemSettings({ mockLlmMode: false });
      for (const p of store.listLlmProviders()) {
        store.saveLlmProvider({ ...p, enabled: false });
      }
      store.saveLlmProvider({
        id: 'llm-abort-test',
        name: 'Abort Test Gateway',
        providerType: 'OPENAI_COMPATIBLE',
        baseUrl: `http://127.0.0.1:${addr.port}/v1`,
        apiKey: 'test-key',
        defaultModel: 'abort-live-model',
        availableModels: ['abort-live-model'],
        enabled: true,
      });

      const createdProto = store.createPrototype('proj-contract', {
        name: '手动中止原型',
        htmlContent: MULTI_SCREEN_PROTOTYPE_HTML,
        source: 'GENERATED',
      });
      const session = ensurePrototypeCoDesignSession(
        store,
        'proj-contract',
        createdProto.prototype.id,
      );

      const streamIter = runUnifiedAgentSessionStream(store, {
        sessionId: session.id,
        prompt: '执行一个稍后会被用户手动取消的精修任务',
        mockMode: false,
      })[Symbol.asyncIterator]();

      const first = await streamIter.next();
      expect(first.value?.event).toBe('session_meta');

      const abortedResult = await abortActiveAgentSessionAsync(store, session.id);
      expect(abortedResult.aborted).toBe(true);
      expect(abortedResult.session?.status).toBe('IDLE');

      const lastAssistant = abortedResult.session?.messages
        .filter((m) => m.role === 'assistant')
        .at(-1);
      expect(lastAssistant?.cancelled).toBe(true);
      expect(store.getPrototype(createdProto.prototype.id)!.revisions).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('queues turns FIFO within a single session (1 active run per session) while running different sessions concurrently', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let replySeq = 0;

    const server = http.createServer(async (req, res) => {
      if (req.url?.endsWith('/chat/completions')) {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const mySeq = ++replySeq;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        });
        await new Promise((r) => setTimeout(r, 90));
        inFlight -= 1;
        res.write(
          `data: ${JSON.stringify({
            id: `chatcmpl-q-${mySeq}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'queue-live-model',
            choices: [
              {
                index: 0,
                delta: { role: 'assistant', content: `Reply #${mySeq}` },
                finish_reason: 'stop',
              },
            ],
          })}\n\n`,
        );
        res.end('data: [DONE]\n\n');
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };

    try {
      const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
      store.updateSystemSettings({ mockLlmMode: false });
      for (const p of store.listLlmProviders()) {
        store.saveLlmProvider({ ...p, enabled: false });
      }
      store.saveLlmProvider({
        id: 'llm-queue-test',
        name: 'Queue Test Gateway',
        providerType: 'OPENAI_COMPATIBLE',
        baseUrl: `http://127.0.0.1:${addr.port}/v1`,
        apiKey: 'test-key',
        defaultModel: 'queue-live-model',
        availableModels: ['queue-live-model'],
        enabled: true,
      });

      const s1 = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'COPILOT',
        title: '单会话排队测试',
      });

      // Part A: Same session -> serialized FIFO (maxInFlight === 1)
      maxInFlight = 0;
      const [turn1, turn2] = await Promise.all([
        collectUnifiedAgentTurn(store, {
          sessionId: s1.id,
          prompt: 'Prompt One',
          mockMode: false,
        }),
        collectUnifiedAgentTurn(store, {
          sessionId: s1.id,
          prompt: 'Prompt Two',
          mockMode: false,
        }),
      ]);
      expect(maxInFlight).toBe(1);
      expect(turn1.events.some((e) => e.event === 'message_end')).toBe(true);
      expect(turn2.events.some((e) => e.event === 'message_end')).toBe(true);

      const finalS1 = store.getAgentSession(s1.id)!;
      expect(finalS1.messages.map((m) => `${m.role}:${m.content}`)).toEqual([
        'user:Prompt One',
        'assistant:Reply #1',
        'user:Prompt Two',
        'assistant:Reply #2',
      ]);

      // Part B: Different sessions -> run concurrently in parallel (maxInFlight >= 2)
      const sA = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'COPILOT',
        title: '并行会话 A',
      });
      const sB = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'COPILOT',
        title: '并行会话 B',
      });
      maxInFlight = 0;
      await Promise.all([
        collectUnifiedAgentTurn(store, {
          sessionId: sA.id,
          prompt: 'Parallel A',
          mockMode: false,
        }),
        collectUnifiedAgentTurn(store, {
          sessionId: sB.id,
          prompt: 'Parallel B',
          mockMode: false,
        }),
      ]);
      expect(maxInFlight).toBeGreaterThanOrEqual(2);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

