import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BUSINESS_VOCABULARY,
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
  type BusinessLocale,
} from '../../../../packages/business-vocabulary/index.js';
import { createWorkspaceStore } from '../../../../packages/workspace-store/index.js';
import { createApiApp } from '../../../../server/app.js';
import {
  apiPatchAgentSession,
  useWorkbenchStore,
  type BootstrapPayload,
} from '../../../api.js';
import { PreferencesProvider } from '../../../i18n.js';
import {
  resetLocalImageStoreForTests,
  storeUploadedOrPastedImage,
} from '../../../lib/localImageStore.js';
import { agentPanelSurfaceFor } from '../../../navigation/index.js';
import { AgentPanel } from '../AgentPanel.js';
import { ShellAgentPanel } from '../ShellAgentPanel.js';
import { AGENT_PANEL_DEFAULT_WIDTH } from '../agentPanelStore.js';
import type { AgentRunView } from '../agentRun.js';
import { ConversationComposer } from './ConversationComposer.js';
import {
  clearConversationDraftMemoryForTests,
  writeSessionDraft,
} from './draftStore.js';
import { isEditableElementFocused } from './quotedSelection.js';

const noop = () => undefined;
const FIXED_NOW = Date.UTC(2026, 10, 18, 10, 30, 0);

function stubStorage(locale: BusinessLocale) {
  const entries = new Map<string, string>([['onto_locale', locale]]);
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, val: string) => {
      entries.set(key, val);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
  vi.stubGlobal('localStorage', storage);
  return storage;
}

describe('ConversationComposer & AgentPanel conversation actions (#81)', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    clearConversationDraftMemoryForTests();
    await resetLocalImageStoreForTests();
  });

  it('renders Stop button alongside Queue action, queued prompt withdraw strip, attach button, quote chips, and rightAccessorySlot in zh-CN and en-US', () => {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubStorage(locale);

      const html = renderToStaticMarkup(
        <PreferencesProvider>
          <ConversationComposer
            draft={locale === 'en-US' ? 'Add seal custody rule' : '补充印章保管制度'}
            onDraftChange={noop}
            quotes={[
              locale === 'en-US'
                ? 'Contracts above 1M require legal and finance sign-off.'
                : '超过 100 万元的合同需要法务与财务双签。',
            ]}
            onQuotesChange={noop}
            onSubmitPrompt={noop}
            onCancelActiveRun={noop}
            runningCount={1}
            queuedPrompts={[
              {
                id: 'q-1',
                label: locale === 'en-US' ? 'Check multi-currency clause' : '核对外币汇率条款',
              },
            ]}
            onRemoveQueuedPrompt={noop}
            rightAccessorySlot={<span data-testid="wave3-ring-slot">42%</span>}
          />
        </PreferencesProvider>,
      );

      expect(html).toContain('data-testid="agent-panel-queue"');
      expect(html).toContain('data-testid="agent-panel-queue-remove-btn"');
      expect(html).toContain('data-testid="composer-quote-chip"');
      expect(html).toContain('data-testid="composer-attach-image-btn"');
      expect(html).toContain('data-testid="composer-stop-btn"');
      expect(html).toContain(locale === 'en-US' ? '>Stop<' : '>停止<');
      expect(html).toContain('data-testid="agent-panel-send-btn"');
      expect(html).toContain(locale === 'en-US' ? 'Queue' : '排队发送');
      expect(html).toContain('data-testid="wave3-ring-slot"');

      const violations = checkBusinessViewMarkup(html);
      expect(violations, formatBusinessViewViolations(violations)).toEqual([]);
    }
  });

  it('restores per-session unsent text, quote chips, and image attachment refs from draftStore across session switch and simulated reload', async () => {
    const storage = stubStorage('zh-CN');
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    const { ref } = await storeUploadedOrPastedImage(blob, {
      name: 'unsent-wireframe.png',
      role: 'user_upload',
    });

    writeSessionDraft(
      'sess-alpha',
      {
        text: '这是会话 Alpha 未发送的草稿',
        quotes: ['资质初审时限为 2 个工作日'],
        attachments: [ref],
      },
      storage,
    );
    writeSessionDraft(
      'sess-beta',
      {
        text: '这是会话 Beta 独立草稿',
        quotes: [],
      },
      storage,
    );

    // Simulate reload
    clearConversationDraftMemoryForTests();

    const alphaHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <AgentPanel
          title={BUSINESS_VOCABULARY.AI_ASSISTANT}
          runs={[]}
          activeSessionId="sess-alpha"
          width={AGENT_PANEL_DEFAULT_WIDTH}
          onSubmitPrompt={noop}
          onClose={noop}
          onResize={noop}
        />
      </PreferencesProvider>,
    );
    expect(alphaHtml).toContain('这是会话 Alpha 未发送的草稿');
    expect(alphaHtml).toContain('data-testid="composer-quote-chip"');
    expect(alphaHtml).toContain('资质初审时限为 2 个工作日');
    expect(alphaHtml).toContain('data-testid="composer-image-strip"');
    expect(alphaHtml).toContain('unsent-wireframe.png');

    const betaHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <AgentPanel
          title={BUSINESS_VOCABULARY.AI_ASSISTANT}
          runs={[]}
          activeSessionId="sess-beta"
          width={AGENT_PANEL_DEFAULT_WIDTH}
          onSubmitPrompt={noop}
          onClose={noop}
          onResize={noop}
        />
      </PreferencesProvider>,
    );
    expect(betaHtml).toContain('这是会话 Beta 独立草稿');
    expect(betaHtml).not.toContain('这是会话 Alpha 未发送的草稿');
    expect(betaHtml).not.toContain('data-testid="composer-quote-chip"');
    expect(betaHtml).not.toContain('data-testid="composer-image-strip"');
  });

  it('renders attached local image thumbnails and shows VisionCapabilityBanner when visionSupported is false', async () => {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    const { ref } = await storeUploadedOrPastedImage(blob, {
      name: 'approval-flow.png',
      role: 'user_upload',
    });

    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubStorage(locale);
      const html = renderToStaticMarkup(
        <PreferencesProvider>
          <ConversationComposer
            draft=""
            onDraftChange={noop}
            attachments={[ref]}
            onAttachmentsChange={noop}
            visionSupported={false}
            visionProviderLabel="Internal Gateway"
            visionModelLabel="text-only-v1"
            onOpenPlatformSettings={noop}
            onSubmitPrompt={noop}
            runningCount={0}
          />
        </PreferencesProvider>,
      );

      expect(html).toContain('data-testid="composer-image-strip"');
      expect(html).toContain('data-testid="local-image-thumbnail"');
      expect(html).toContain('approval-flow.png');
      expect(html).toContain('data-testid="vision-fallback-banner"');
      const violations = checkBusinessViewMarkup(html);
      expect(violations, formatBusinessViewViolations(violations)).toEqual([]);
    }
  });

  it('wires Copy Reply on all completed replies, Edit & Retry ONLY on latest turn (including failed/cancelled replies), and preserves PROTOTYPE_CO_DESIGN session guard', () => {
    const runs: AgentRunView[] = [
      {
        id: 'turn-1',
        userPrompt: '第一轮：明确供应商资质初审角色',
        title: { zh: '资质初审', en: 'Qualification review' },
        status: 'FAILED',
        liveStatus: { zh: '失败', en: 'Failed' },
        startedAt: FIXED_NOW - 10_000,
        completedAt: FIXED_NOW - 8_000,
        steps: [],
        text: '资质初审由**采购专员**在 2 个工作日内完成。',
        failure: {
          code: 'AGENT_RUNTIME_ERROR',
          message: 'Upstream temporary error',
        },
      },
      {
        id: 'turn-2',
        userPrompt: '第二轮：补充大额合同会签要求',
        title: { zh: '大额会签', en: 'Dual sign-off' },
        status: 'CANCELLED',
        liveStatus: { zh: '已取消', en: 'Cancelled' },
        startedAt: FIXED_NOW - 4_000,
        completedAt: FIXED_NOW - 1_000,
        steps: [],
        text: '超过 100 万元的合同由**法务与财务负责人**双签。',
      },
    ];

    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubStorage(locale);

      const convHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <AgentPanel
            title={BUSINESS_VOCABULARY.AI_ASSISTANT}
            runs={runs}
            activeSessionId="sess-proto-1"
            sessions={[
              {
                id: 'sess-proto-1',
                title: locale === 'en-US' ? 'Contract Prototype' : '合同管理原型',
                turnCount: 2,
              },
            ]}
            sessionsOwnedByArtifact={true}
            defaultHistoryOpen={true}
            onCreateSession={noop}
            onDeleteSession={noop}
            onRenameSession={noop}
            onSelectSession={noop}
            onRetryRun={noop}
            onEditLatestTurn={noop}
            onRetryLatestTurn={noop}
            onSubmitPrompt={noop}
            width={AGENT_PANEL_DEFAULT_WIDTH}
            onClose={noop}
            onResize={noop}
            now={FIXED_NOW}
          />
        </PreferencesProvider>,
      );

      // Copy button on BOTH completed assistant replies with text
      expect(convHtml.match(/data-testid="reply-copy-btn"/g)).toHaveLength(2);
      // Edit & Retry ONLY once (on latest user message), and ONLY ONE agent-run-retry-btn (on latest cancelled reply, NOT on earlier failed reply!)
      expect(convHtml.match(/data-testid="user-msg-edit-btn"/g)).toHaveLength(1);
      expect(convHtml.match(/data-testid="user-msg-retry-btn"/g)).toHaveLength(1);
      expect(convHtml.match(/data-testid="agent-run-retry-btn"/g)).toHaveLength(1);
      expect(convHtml.match(/data-testid="earlier-msg-locked-hint"/g)).toHaveLength(1);

      // PROTOTYPE_CO_DESIGN guard: NO manual create or delete buttons even if callbacks passed
      expect(convHtml).toContain('data-testid="assistant-history-menu"');
      expect(convHtml).not.toContain('data-testid="assistant-new-session-btn"');
      expect(convHtml).not.toContain('data-testid="assistant-delete-session-btn"');
      expect(convHtml).toContain('data-testid="assistant-rename-session-btn"');

      const convViolations = checkBusinessViewMarkup(convHtml);
      expect(convViolations, formatBusinessViewViolations(convViolations)).toEqual([]);
    }
  });

  it('replaces ONLY the latest turn via replaceLatestSessionTurnAndRun and wires ShellAgentPanel edit/retry without touching ArtifactHistory', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    try {
      store.saveRequirementDoc({
        id: 'rdoc-hist-81',
        projectId: 'proj-contract',
        title: '合同管理需求规格书',
        version: 'v1.1',
        status: 'DRAFT',
        content: '# 1. 业务目标\n\n全流程审批。\n',
      });
      const historyBefore = store.listArtifactHistoryViews('proj-contract');
      expect(historyBefore.length).toBeGreaterThan(0);

      const sess = store.createAgentSession({
        projectId: 'proj-contract',
        agentKind: 'REQUIREMENT',
        title: '编辑重发集成验证',
        initialMessages: [
          {
            id: 'u-int-1',
            role: 'user',
            content: '第一轮：明确采购专员初审职责',
            timestamp: '2026-11-18T09:00:00.000Z',
          },
          {
            id: 'a-int-1',
            role: 'assistant',
            content: '已记录采购专员资质初审职责。',
            timestamp: '2026-11-18T09:00:03.000Z',
          },
          {
            id: 'u-int-2',
            role: 'user',
            content: '第二轮（旧版）：超过 200 万双签',
            timestamp: '2026-11-18T09:02:00.000Z',
          },
          {
            id: 'a-int-2',
            role: 'assistant',
            content: '已按 200 万门槛记录。',
            timestamp: '2026-11-18T09:02:04.000Z',
          },
        ],
      });

      vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
        app.request(typeof input === 'string' ? input : input.toString(), init),
      );

      const boot = (await (
        await app.request('/api/bootstrap?projectId=proj-contract')
      ).json()) as BootstrapPayload;
      useWorkbenchStore.setState({
        loading: false,
        data: boot,
        activeNav: 'app-requirements',
        activeSessionId: sess.id,
      });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

      stubStorage('zh-CN');
      const shellBeforeHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <ShellAgentPanel
            surface={agentPanelSurfaceFor('app-requirements')}
            overlay={false}
            side="left"
            closable={false}
            onClose={noop}
            onNavigate={noop}
          />
        </PreferencesProvider>,
      );
      expect(shellBeforeHtml.match(/data-testid="user-msg-edit-btn"/g)).toHaveLength(1);
      expect(shellBeforeHtml.match(/data-testid="user-msg-retry-btn"/g)).toHaveLength(1);
      expect(shellBeforeHtml.match(/data-testid="earlier-msg-locked-hint"/g)).toHaveLength(1);
      expect(shellBeforeHtml.match(/data-testid="reply-copy-btn"/g)).toHaveLength(2);

      // Replace the latest turn via store action against in-memory Hono app (mockMode: true)
      await useWorkbenchStore.getState().replaceLatestSessionTurnAndRun({
        sessionId: sess.id,
        prompt: '第二轮（已修改）：超过 50 万合同即需法务与财务双签',
        truncateFromUserMessageId: 'u-int-2',
        mockMode: true,
      });

      const updatedSess = store.getAgentSession(sess.id)!;
      const userContents = updatedSess.messages
        .filter((m) => m.role === 'user')
        .map((m) => m.content);
      expect(userContents).toEqual([
        '第一轮：明确采购专员初审职责',
        '第二轮（已修改）：超过 50 万合同即需法务与财务双签',
      ]);
      expect(userContents).not.toContain('第二轮（旧版）：超过 200 万双签');

      // ArtifactHistory before edit was never deleted or altered in-place
      const historyAfter = store.listArtifactHistoryViews('proj-contract');
      expect(historyAfter.length).toBeGreaterThanOrEqual(historyBefore.length);
      expect(historyAfter.some((h) => h.id === historyBefore[0]!.id)).toBe(true);

      // Localized bilingual error messages on SESSION_RUNNING & ONLY_LATEST_TURN_ALLOWED
      stubStorage('zh-CN');
      await expect(
        apiPatchAgentSession(sess.id, { truncateFromUserMessageId: 'u-int-1' }),
      ).rejects.toThrow('仅支持修改或重发最后一条消息');

      stubStorage('en-US');
      await expect(
        apiPatchAgentSession(sess.id, { truncateFromUserMessageId: 'u-int-1' }),
      ).rejects.toThrow('Only the latest message can be edited or retried.');
    } finally {
      store.close();
    }
  });

  it('blocks selection quote activation whenever focus is inside input, textarea, select, or contenteditable (#85)', () => {
    expect(isEditableElementFocused({ activeElement: null })).toBe(false);
    expect(
      isEditableElementFocused({
        activeElement: { tagName: 'DIV', closest: () => null } as unknown as Element,
      }),
    ).toBe(false);
    expect(
      isEditableElementFocused({
        activeElement: { tagName: 'INPUT', closest: () => null } as unknown as Element,
      }),
    ).toBe(true);
    expect(
      isEditableElementFocused({
        activeElement: { tagName: 'TEXTAREA', closest: () => null } as unknown as Element,
      }),
    ).toBe(true);
    expect(
      isEditableElementFocused({
        activeElement: {
          tagName: 'DIV',
          isContentEditable: true,
          closest: () => null,
        } as unknown as Element,
      }),
    ).toBe(true);
    expect(
      isEditableElementFocused({
        activeElement: {
          tagName: 'SPAN',
          closest: (sel: string) => (sel.includes('[contenteditable="true"]') ? ({} as Element) : null),
        } as unknown as Element,
      }),
    ).toBe(true);
    // Composer textarea with collapsed caret (after quoting snippet #1) allows quoting snippet #2,
    // while active text selection inside composer textarea blocks quote button:
    expect(
      isEditableElementFocused({
        activeElement: {
          tagName: 'TEXTAREA',
          selectionStart: 0,
          selectionEnd: 0,
          closest: (sel: string) =>
            sel === '[data-testid="agent-panel-composer"]' ? ({} as Element) : null,
        } as unknown as Element,
      }),
    ).toBe(false);
    expect(
      isEditableElementFocused({
        activeElement: {
          tagName: 'TEXTAREA',
          selectionStart: 0,
          selectionEnd: 5,
          closest: (sel: string) =>
            sel === '[data-testid="agent-panel-composer"]' ? ({} as Element) : null,
        } as unknown as Element,
      }),
    ).toBe(true);
  });
});
