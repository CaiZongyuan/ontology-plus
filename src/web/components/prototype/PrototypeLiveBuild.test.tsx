import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initPrototypeShell, upsertPrototypeScreen } from '../../../packages/agent-runtime/index.js';
import {
  applyPrototypeLiveEvent,
  createPrototypeLiveTracker,
  emptyPrototypeLiveState,
} from '../../../packages/ontology-core/index.js';
import { checkBusinessViewMarkup } from '../../../packages/business-vocabulary/index.js';
import { createWorkspaceStore } from '../../../packages/workspace-store/index.js';
import { createApiApp } from '../../../server/app.js';
import { PreferencesProvider } from '../../i18n.js';
import { AssistantReplyItem } from '../agent/conversation/AssistantReplyItem.js';
import { ShellAgentPanel } from '../agent/ShellAgentPanel.js';
import { agentPanelSurfaceFor } from '../../navigation/index.js';
import { useWorkbenchStore, type BootstrapPayload } from '../../api.js';
import { PrototypeLiveCanvas } from './live-canvas/PrototypeLiveCanvas.js';

const noop = () => {};

function stubLocale(locale: 'zh-CN' | 'en-US') {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'onto_locale' ? locale : null),
    setItem: noop,
    removeItem: noop,
  });
}

describe('Live prototype build canvas & Pi Agent Code Mode / 3-Way Multi-Agent UI', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the empty build canvas, then per-screen streamed artboards, and offers per-screen resume on unfinished screens, with 0 Business View violations in both languages', () => {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubLocale(locale);

      // 1. Before the shell exists: the layout D skeleton with no scripted activity
      const emptyMarkup = renderToStaticMarkup(
        <PreferencesProvider>
          <PrototypeLiveCanvas documentHtml="" live={null} busy viewMode="business" />
        </PreferencesProvider>,
      );
      expect(emptyMarkup).toContain('data-testid="prototype-phase-bar"');
      expect(emptyMarkup).toContain('data-testid="prototype-canvas-dock"');
      expect(emptyMarkup).not.toContain('data-testid="prototype-build-log"');
      expect(emptyMarkup).toContain('data-testid="prototype-screen-strip"');
      expect(emptyMarkup).not.toContain('data-testid="prototype-artboard-');
      expect(checkBusinessViewMarkup(emptyMarkup)).toHaveLength(0);

      // 2. Shell with 4 screens; 1 landed, 1 streaming from its tool-call arguments
      const shell = initPrototypeShell({
        appTitle: '咖啡店管理系统',
        screens: [
          { screenId: 'SCR-MEMBER', screenName: '会员储值台账', screenType: 'LIST' },
          { screenId: 'SCR-DRAWER', screenName: '储值录入抽屉', screenType: 'FORM' },
          { screenId: 'SCR-POS', screenName: '现磨点单收银', screenType: 'LIST' },
          { screenId: 'SCR-SETTLE', screenName: '门市日结对账', screenType: 'REPORT' },
        ],
      });
      const withFirstDone = upsertPrototypeScreen(shell.nextHtml, {
        screenId: 'SCR-MEMBER',
        screenName: '会员储值台账',
        screenHtml: `<div class="proto-card"><button type="button" data-element-id="EL-M1" data-element-type="BUTTON" data-element-label="储值">储值</button></div>`,
      });
      const tracker = createPrototypeLiveTracker();
      let live = emptyPrototypeLiveState();
      for (const ev of tracker.observeDocument(withFirstDone.nextHtml)) live = applyPrototypeLiveEvent(live, ev);
      live = applyPrototypeLiveEvent(
        live,
        tracker.observePartialScreen({
          screenId: 'SCR-DRAWER',
          screenName: '储值录入抽屉',
          partialHtml: `<div class="kpi-grid"><div class="card"><strong>充300赠40档位</strong><button type="button" data-element-label="立即入账"`,
        })!,
      );

      const streamingMarkup = renderToStaticMarkup(
        <PreferencesProvider>
          <PrototypeLiveCanvas documentHtml="" live={live} busy onRetryScreen={noop} viewMode="business" />
        </PreferencesProvider>,
      );
      for (const sid of ['SCR-MEMBER', 'SCR-DRAWER', 'SCR-POS', 'SCR-SETTLE']) {
        expect(streamingMarkup).toContain(`data-testid="prototype-artboard-${sid}"`);
        expect(streamingMarkup).toContain(`data-testid="prototype-strip-card-${sid}"`);
      }
      expect(streamingMarkup).toMatch(/data-testid="prototype-artboard-SCR-DRAWER"[^>]*data-screen-status="streaming"/);
      expect(streamingMarkup).toMatch(/data-testid="prototype-artboard-SCR-MEMBER"[^>]*data-screen-status="ready"/);
      // nothing scripted: no fake cursors, no resume while the run is still going
      expect(streamingMarkup).not.toContain('artboard-live-cursor');
      expect(streamingMarkup).not.toContain('artboard-retry-btn');
      expect(checkBusinessViewMarkup(streamingMarkup)).toHaveLength(0);

      // 3. The run ended with two screens never written: those (and only those) can be resumed
      const interruptedMarkup = renderToStaticMarkup(
        <PreferencesProvider>
          <PrototypeLiveCanvas documentHtml={withFirstDone.nextHtml} busy={false} onRetryScreen={noop} viewMode="business" />
        </PreferencesProvider>,
      );
      expect(interruptedMarkup).toContain('data-testid="artboard-retry-btn-SCR-SETTLE"');
      expect(interruptedMarkup).not.toContain('data-testid="artboard-retry-btn-SCR-MEMBER"');
      expect(checkBusinessViewMarkup(interruptedMarkup)).toHaveLength(0);
    }
  });

  it('defaults Code Mode ON and Multi-Agent ×3 in ShellAgentPanel and renders parallel subagent lanes & orchestration script in AssistantReplyItem with 0 Business View violations', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const app = createApiApp(store);
    const resp = await app.request('http://localhost/api/bootstrap?projectId=proj-contract');
    const bootstrapData = (await resp.json()) as BootstrapPayload;

    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubLocale(locale);

      useWorkbenchStore.setState({
        loading: false,
        data: {
          ...bootstrapData,
          agentSessions: [],
          prototypes: [],
        },
      });

      const panelHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <ShellAgentPanel
            surface={agentPanelSurfaceFor('app-prototype')}
            overlay={false}
            onClose={noop}
            onNavigate={noop}
          />
        </PreferencesProvider>,
      );

      expect(panelHtml).toContain('data-testid="conversation-thread"');
      expect(panelHtml).toContain('data-testid="session-execution-settings"');
      expect(panelHtml).not.toContain('data-testid="agent-execution-mode-bar"');
      expect(panelHtml).not.toContain('data-testid="agent-codemode-toggle"');
      expect(panelHtml).toMatch(/data-testid="session-execution-settings"[^>]+title="[^"]*×3"/);
      expect(checkBusinessViewMarkup(panelHtml)).toHaveLength(0);

      const sampleParallelRun = {
        id: 'run-parallel-1',
        title: { zh: '生成咖啡店交互原型', en: 'Generate coffee shop prototype' },
        status: 'RUNNING' as const,
        liveStatus: { zh: '正在并行推进 3 路子任务…', en: 'Running 3 parallel tasks…' },
        startedAt: 1_700_000_000_000,
        liveStreamedChars: 2480,
        codeModeScript: 'await Promise.all([tools.upsert_prototype_screen({ screenId: "SCR-1" })]);',
        subagentLanes: [
          {
            laneId: 'l1',
            workerIndex: 1,
            workerLabel: { zh: '1 号助手', en: 'Assistant #1' },
            taskTitle: { zh: '绘制会员储值台账', en: 'Build member ledger' },
            status: 'RUNNING' as const,
            progressChars: 920,
            startedAt: '2026-11-18T04:00:00.000Z',
          },
          {
            laneId: 'l2',
            workerIndex: 2,
            workerLabel: { zh: '2 号助手', en: 'Assistant #2' },
            taskTitle: { zh: '绘制储值录入抽屉', en: 'Build top-up drawer' },
            status: 'RUNNING' as const,
            progressChars: 810,
            startedAt: '2026-11-18T04:00:00.000Z',
          },
          {
            laneId: 'l3',
            workerIndex: 3,
            workerLabel: { zh: '3 号助手', en: 'Assistant #3' },
            taskTitle: { zh: '绘制现磨点单收银', en: 'Build POS screen' },
            status: 'RUNNING' as const,
            progressChars: 750,
            startedAt: '2026-11-18T04:00:00.000Z',
          },
        ],
        steps: [],
      };

      // Collapsed live reply shows subagent lanes & streamed chars with 0 Business View violations
      const replyCollapsedHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <AssistantReplyItem now={1_700_000_012_000} run={sampleParallelRun} />
        </PreferencesProvider>,
      );

      expect(replyCollapsedHtml).toContain('data-testid="agent-run-subagent-lanes"');
      expect(replyCollapsedHtml).toContain('data-testid="agent-run-stream-chars"');
      expect(checkBusinessViewMarkup(replyCollapsedHtml)).toHaveLength(0);

      // Expanded work process exposes the orchestration script details with 0 Business View violations
      const replyExpandedHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <AssistantReplyItem
            now={1_700_000_012_000}
            defaultWorkExpanded
            run={sampleParallelRun}
          />
        </PreferencesProvider>,
      );
      expect(replyExpandedHtml).toContain('data-testid="agent-run-codemode-script"');
      expect(checkBusinessViewMarkup(replyExpandedHtml)).toHaveLength(0);
    }
  });
});
