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

describe('Briefing Stage: Unbound Initial Generation (R1), Brief Restyle (R2), Non-Mock Failure & Clone (Issue #31)', () => {
  it('runs an unbound PROTOTYPE_CO_DESIGN session in Mock mode to create Revision #1 with persisted DesignBrief, links session.targetId, emits PROTOTYPE_REVISION, and leaves MU untouched even when other prototypes exist', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    // Seed an existing prototype in the project to prove unbound session creates a NEW prototype instead of mutating list[0]
    const existingProto = store.createPrototype('proj-contract', {
      name: '既有原型草稿',
      htmlContent: MULTI_SCREEN_PROTOTYPE_HTML,
      source: 'UPLOADED',
    });
    const muBefore = JSON.stringify(store.getProject('proj-contract')!.suite.MU);
    const confirmedBefore = store.getConfirmedPrototypeRevision('proj-contract');

    const unboundSession = store.createAgentSession({
      projectId: 'proj-contract',
      agentKind: 'PROTOTYPE_CO_DESIGN',
      title: '设计简报首版原型生成',
    });
    expect(unboundSession.targetId).toBeUndefined();

    const sampleBrief = {
      items: [
        {
          id: 'brief-tone',
          category: 'tone_palette',
          statement: '主参考 Linear 深色高密度风格（背景 #0f172a，强调色 #5e6ad2）。',
        },
        {
          id: 'brief-feel',
          category: 'user_feel',
          statement: '想要像银行内部台账那样稳重紧凑、一眼看清待审批金额。',
        },
      ],
      userFeelNote: '想要像银行内部台账那样稳重紧凑、一眼看清待审批金额。',
      primaryReferenceId: 'linear-app',
      primaryReferenceTitle: 'Linear',
      primaryReferenceSourceUrl: 'https://linear.app',
      borrowedReferences: [
        {
          referenceId: 'stripe-billing',
          aspect: 'dataClarity',
          title: 'Stripe Billing',
          sourceUrl: 'https://stripe.com/billing',
        },
      ],
      motionSchematicIds: ['DRAWER', 'COMPACT_LEDGER', 'STEPPER_CORNER_TOAST'],
      approvedAt: '2026-11-12T10:00:00.000Z',
      updatedAt: '2026-11-12T10:00:00.000Z',
    };

    const result = await collectUnifiedAgentTurn(store, {
      sessionId: unboundSession.id,
      prompt: '请按照已确认设计简报生成响应式采购合同台账原型（1440px / 768px / 390px）',
      designBrief: sampleBrief,
      prototypeName: '采购合同简报原型 V1',
      mockMode: true,
    });

    expect(result.events.some((e) => e.event === 'run_error')).toBe(false);
    expect(result.events.some((e) => e.event === 'message_end')).toBe(true);

    // Existing prototype must NOT have been mutated
    expect(store.getPrototype(existingProto.prototype.id)?.revisions).toHaveLength(1);
    expect(store.getPrototype(existingProto.prototype.id)?.htmlContent).toBe(
      MULTI_SCREEN_PROTOTYPE_HTML,
    );

    const revEvent = result.events.find(
      (e) =>
        e.event === 'artifact' &&
        (e.data.artifact as { kind?: string } | undefined)?.kind === 'PROTOTYPE_REVISION',
    );
    expect(revEvent).toBeDefined();
    const artifact = revEvent!.data.artifact as {
      kind: 'PROTOTYPE_REVISION';
      prototypeId: string;
      revisionId: string;
      revisionNumber: number;
    };
    expect(artifact.revisionNumber).toBe(1);
    expect(artifact.prototypeId).not.toBe(existingProto.prototype.id);

    const createdProto = store.getPrototype(artifact.prototypeId);
    expect(createdProto).toBeDefined();
    expect(createdProto!.name).toBe('采购合同简报原型 V1');
    expect(createdProto!.revisions).toHaveLength(1);
    expect(createdProto!.revisions[0]!.revisionNumber).toBe(1);
    expect(createdProto!.revisions[0]!.source).toBe('AGENT_RUN');
    expect(createdProto!.coDesignSessionId).toBe(unboundSession.id);
    expect(createdProto!.designBrief?.userFeelNote).toBe(sampleBrief.userFeelNote);
    expect(createdProto!.designBrief?.primaryReferenceId).toBe('linear-app');
    expect(createdProto!.htmlContent).toContain('data-screen-id=');
    expect(createdProto!.htmlContent).toContain('data-element-id=');

    // Unbound session is now bound to the newly created prototype
    const updatedSession = store.getAgentSession(unboundSession.id);
    expect(updatedSession?.targetId).toBe(createdProto!.id);

    // ADR 0010: MU model and confirmed pointer must remain untouched prior to explicit Confirmation
    const muAfter = JSON.stringify(store.getProject('proj-contract')!.suite.MU);
    expect(muAfter).toBe(muBefore);
    expect(store.getConfirmedPrototypeRevision('proj-contract')?.revisionId).toBe(
      confirmedBefore?.revisionId,
    );
    expect(store.getConfirmedPrototypeRevision('proj-contract')?.prototypeId).not.toBe(
      createdProto!.id,
    );
  });

  it('supports Live HTTP unbound generation (Revision #1) and subsequent Brief Restyle (Revision #2), and NEVER fabricates template HTML when non-Mock gateway fails', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: false });
    let shouldFailGateway = false;
    let callStep = 0;

    const generatedR1Html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Live Brief R1</title>
  <style>
    :root { --bg: #faf8f5; --accent: #2563eb; }
    .grid-shell { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    @media (max-width: 768px) { .grid-shell { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 390px) { .grid-shell { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <section data-screen-id="SCR-LEDGER" data-screen-name="采购台账" data-screen-type="LIST" class="grid-shell">
    <input type="search" placeholder="检索合同" data-element-id="EL-SEARCH" data-element-type="INPUT" data-binding="Contract.contractNo" />
    <button type="button" data-element-id="EL-CREATE" data-element-type="BUTTON" data-event-id="UIE-CREATE">新建合同</button>
  </section>
</body>
</html>`;

    const restyledR2Html = generatedR1Html
      .replace('--bg: #faf8f5; --accent: #2563eb;', '--bg: #0b1120; --accent: #38bdf8;')
      .replace('Live Brief R1', 'Live Brief R2 Dark Trading');

    const server = http.createServer(async (req, res) => {
      for await (const _chunk of req) {
        // drain
      }
      if (shouldFailGateway) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Upstream gateway unavailable' } }));
        return;
      }

      callStep += 1;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
      });

      if (callStep === 1) {
        const chunk = {
          id: 'chatcmpl-r1-tool',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'live-brief-model',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_r1_rewrite',
                    type: 'function',
                    function: {
                      name: 'rewrite_prototype_page',
                      arguments: JSON.stringify({
                        htmlContent: generatedR1Html,
                        allowAnchorReset: true,
                      }),
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      if (callStep === 2) {
        const chunk = {
          id: 'chatcmpl-r1-done',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'live-brief-model',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: '已按确认简报生成首版响应式原型 R1。' },
              finish_reason: 'stop',
            },
          ],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      if (callStep === 3) {
        const chunk = {
          id: 'chatcmpl-r2-tool',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'live-brief-model',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_r2_restyle',
                    type: 'function',
                    function: {
                      name: 'rewrite_prototype_page',
                      arguments: JSON.stringify({
                        htmlContent: restyledR2Html,
                        allowAnchorReset: false,
                      }),
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const chunk = {
        id: 'chatcmpl-r2-done',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'live-brief-model',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: '已按更新后的简报重做整页深色高密度风格 R2。' },
            finish_reason: 'stop',
          },
        ],
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Failed to bind test server');

    try {
      for (const p of store.listLlmProviders()) {
        store.saveLlmProvider({ ...p, enabled: false });
      }
      store.saveLlmProvider({
        id: 'llm-live-brief',
        name: 'Live Brief Gateway',
        providerType: 'OPENAI_COMPATIBLE',
        baseUrl: `http://127.0.0.1:${addr.port}/v1`,
        apiKey: 'live-key',
        defaultModel: 'live-brief-model',
        availableModels: ['live-brief-model'],
        supportsVision: true,
        enabled: true,
      });

      // 1) Non-Mock gateway failure MUST report run_error and create ZERO fake prototypes
      const preCount = store.listPrototypes('proj-contract').length;
      shouldFailGateway = true;
      const failedSession = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'PROTOTYPE_CO_DESIGN',
        title: '失败时不伪造模板测试',
      });
      const failedRun = await collectUnifiedAgentTurn(store, {
        sessionId: failedSession.id,
        prompt: '确认简报生成原型',
        designBrief: {
          items: [{ id: 'i1', category: 'tone_palette', statement: '清爽白底台账' }],
          updatedAt: '2026-11-12T10:00:00.000Z',
        },
        mockMode: false,
      });
      expect(failedRun.events.some((e) => e.event === 'run_error')).toBe(true);
      expect(store.listPrototypes('proj-contract')).toHaveLength(preCount);
      expect(store.getAgentSession(failedSession.id)?.targetId).toBeUndefined();

      // 2) Live HTTP unbound session -> Revision #1
      shouldFailGateway = false;
      const liveSession = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'PROTOTYPE_CO_DESIGN',
        title: '真实网关首版生成',
      });
      const r1Run = await collectUnifiedAgentTurn(store, {
        sessionId: liveSession.id,
        prompt: '按简报生成首版原型',
        prototypeName: '合同审批原型 Live',
        designBrief: {
          items: [{ id: 'i1', category: 'tone_palette', statement: '温暖纸感浅色风格' }],
          primaryReferenceId: 'amie-so',
          updatedAt: '2026-11-12T10:05:00.000Z',
        },
        mockMode: false,
      });
      expect(r1Run.events.some((e) => e.event === 'run_error')).toBe(false);
      const boundProtoId = store.getAgentSession(liveSession.id)?.targetId;
      expect(boundProtoId).toBeTruthy();
      const protoAfterR1 = store.getPrototype(boundProtoId!)!;
      expect(protoAfterR1.revisions).toHaveLength(1);
      expect(protoAfterR1.revisions[0]!.revisionNumber).toBe(1);
      expect(protoAfterR1.designBrief?.primaryReferenceId).toBe('amie-so');

      // 3) Returning to Brief & running "按新简报重做风格" updates designBrief and appends Revision #2
      const updatedBrief = {
        items: [{ id: 'i1', category: 'tone_palette', statement: '深色高密度交易风 (#0b1120)' }],
        userFeelNote: '改成深色高密度交易风',
        primaryReferenceId: 'linear-app',
        updatedAt: '2026-11-12T10:15:00.000Z',
      };
      const r2Run = await collectUnifiedAgentTurn(store, {
        sessionId: liveSession.id,
        prompt: '[PROTOTYPE_BRIEF_RESTYLE] 按新简报重做风格：深色高密度交易风',
        designBrief: updatedBrief,
        mockMode: false,
      });
      expect(r2Run.events.some((e) => e.event === 'run_error')).toBe(false);
      const protoAfterR2 = store.getPrototype(boundProtoId!)!;
      expect(protoAfterR2.revisions).toHaveLength(2);
      expect(protoAfterR2.revisions.at(-1)!.revisionNumber).toBe(2);
      expect(protoAfterR2.htmlContent).toContain('--bg: #0b1120');
      expect(protoAfterR2.designBrief?.userFeelNote).toBe('改成深色高密度交易风');
      expect(protoAfterR2.designBrief?.primaryReferenceId).toBe('linear-app');

      // 4) Cloning prototype ("另存为新原型") copies designBrief and forks coDesignSessionId
      const cloned = store.clonePrototype(boundProtoId!, { name: '合同审批原型分支 B' });
      expect(cloned.id).not.toBe(boundProtoId);
      expect(cloned.designBrief).toEqual(updatedBrief);
      expect(cloned.coDesignSessionId).toBeTruthy();
      expect(cloned.coDesignSessionId).not.toBe(liveSession.id);
      const forkedSess = store.getAgentSession(cloned.coDesignSessionId!);
      expect(forkedSess?.agentKind).toBe('PROTOTYPE_CO_DESIGN');
      expect(forkedSess?.targetId).toBe(cloned.id);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('supports Mock mode whole-page Brief Restyle (Revision #2) preserving semantic anchors while updating style tokens', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    const created = store.createPrototype('proj-contract', {
      name: '待重做风格原型',
      htmlContent: MULTI_SCREEN_PROTOTYPE_HTML,
      source: 'AGENT_RUN',
      designBrief: {
        items: [{ id: 'b1', category: 'tone_palette', statement: '浅色默认风格' }],
        updatedAt: '2026-11-12T09:00:00.000Z',
      },
    });
    const ensuredSession = ensurePrototypeCoDesignSession(
      store,
      'proj-contract',
      created.prototype.id,
    );

    const restyledBrief = {
      items: [
        {
          id: 'b1',
          category: 'tone_palette',
          statement: '深色高密度交易风（画布 #0b1120，强调色 #38bdf8）',
        },
      ],
      userFeelNote: '改成深色高密度交易风',
      primaryReferenceId: 'linear-app',
      updatedAt: '2026-11-12T09:30:00.000Z',
    };

    const restyleTurn = await collectUnifiedAgentTurn(store, {
      sessionId: ensuredSession.id,
      prompt: '[PROTOTYPE_BRIEF_RESTYLE] 按新简报重做风格：画布 #0b1120，强调色 #38bdf8',
      designBrief: restyledBrief,
      mockMode: true,
    });

    expect(restyleTurn.events.some((e) => e.event === 'run_error')).toBe(false);
    const updatedProto = store.getPrototype(created.prototype.id)!;
    expect(updatedProto.revisions).toHaveLength(2);
    expect(updatedProto.revisions.at(-1)!.revisionNumber).toBe(2);
    expect(updatedProto.designBrief?.userFeelNote).toBe('改成深色高密度交易风');
    // Preserves semantic anchors from original screens
    expect(updatedProto.htmlContent).toContain('data-screen-id="SCR-CONTRACT-LIST"');
    expect(updatedProto.htmlContent).toContain('data-screen-id="SCR-CONTRACT-APPROVAL"');
    expect(updatedProto.htmlContent).toContain('data-element-id="EL-BTN-APPROVE"');
    expect(updatedProto.htmlContent).toContain('data-brief-restyle="true"');
  });
});


