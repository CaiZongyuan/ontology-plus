import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  initPrototypeShell,
  previewPartialPrototypeScreen,
  upsertPrototypeScreen,
} from '../../../packages/agent-runtime/index.js';
import { checkBusinessViewMarkup } from '../../../packages/business-vocabulary/index.js';
import {
  createWorkspaceStore,
  type AgentSubagentLaneTrace,
} from '../../../packages/workspace-store/index.js';
import { createApiApp } from '../../../server/app.js';
import { PreferencesProvider } from '../../i18n.js';
import { AgentRunCard } from '../agent/AgentRunCard.js';
import { ShellAgentPanel } from '../agent/ShellAgentPanel.js';
import { agentPanelSurfaceFor } from '../../navigation/index.js';
import { useWorkbenchStore, type BootstrapPayload } from '../../api.js';
import { PrototypeArtboardGrid } from './PrototypeArtboardGrid.js';

const noop = () => {};

function stubLocale(locale: 'zh-CN' | 'en-US') {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'onto_locale' ? locale : null),
    setItem: noop,
    removeItem: noop,
  });
}

describe('Variant A Multi-Artboard Canvas & Pi Agent Code Mode / 3-Way Multi-Agent UI', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders 0-second skeleton artboards, then streams 3 concurrent subagent cursors across real artboards, and exposes per-screen resume on interrupted screens with 0 Business View violations', () => {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      stubLocale(locale);

      // 1. 0-second skeleton state before HTML arrives
      const skeletonMarkup = renderToStaticMarkup(
        <PreferencesProvider>
          <PrototypeArtboardGrid
            htmlContent=""
            projectName="咖啡店管理系统"
            busy
            liveStreamedChars={420}
            viewMode="business"
          />
        </PreferencesProvider>,
      );
      expect(skeletonMarkup).toContain('data-testid="prototype-skeleton-artboards"');
      expect(skeletonMarkup).toContain('data-testid="artboard-live-cursor-lead-coordinator-cursor"');
      expect(checkBusinessViewMarkup(skeletonMarkup)).toHaveLength(0);

      // 2. Shell initialized with 4 screens; 2 screens completed, 2 screens actively built by 3 parallel subagents
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
      const withPartialStreaming = previewPartialPrototypeScreen(withFirstDone.nextHtml, {
        screenId: 'SCR-DRAWER',
        screenName: '储值录入抽屉',
        partialScreenHtml: `<div class="kpi-grid"><div class="card"><strong>充300赠40档位</strong><button type="button" data-element-label="立即入账"`,
      });

      const activeLanes: AgentSubagentLaneTrace[] = [
        {
          laneId: 'lane-1',
          workerIndex: 1,
          workerLabel: { zh: '1 号助手', en: 'Assistant #1' },
          taskTitle: { zh: '绘制会员储值台账', en: 'Build member ledger' },
          targetAnchor: { screenId: 'SCR-MEMBER', label: '会员储值台账' },
          status: 'DONE',
          phase: 'DONE',
          progressChars: 1420,
          startedAt: '2026-11-18T04:00:00.000Z',
          completedAt: '2026-11-18T04:00:08.000Z',
        },
        {
          laneId: 'lane-2',
          workerIndex: 2,
          workerLabel: { zh: '2 号助手', en: 'Assistant #2' },
          taskTitle: { zh: '绘制储值录入抽屉', en: 'Build top-up drawer' },
          targetAnchor: { screenId: 'SCR-DRAWER', label: '储值录入抽屉' },
          status: 'RUNNING',
          phase: 'STREAMING',
          cursorZone: 'kpi',
          liveAction: { zh: '正在绘制 · 充300赠40档位', en: 'Painting · Top-up Tier' },
          progressChars: 860,
          startedAt: '2026-11-18T04:00:00.000Z',
        },
        {
          laneId: 'lane-3',
          workerIndex: 3,
          workerLabel: { zh: '3 号助手', en: 'Assistant #3' },
          taskTitle: { zh: '绘制现磨点单收银', en: 'Build POS screen' },
          targetAnchor: { screenId: 'SCR-POS', label: '现磨点单收银' },
          status: 'RUNNING',
          phase: 'THINKING',
          cursorZone: 'toolbar',
          liveAction: { zh: '布局筛选工具栏与快捷操作…', en: 'Laying out filter toolbar…' },
          progressChars: 910,
          startedAt: '2026-11-18T04:00:00.000Z',
        },
      ];

      const streamingMarkup = renderToStaticMarkup(
        <PreferencesProvider>
          <PrototypeArtboardGrid
            htmlContent={withPartialStreaming}
            projectName="咖啡店管理系统"
            busy
            liveStreamedChars={3190}
            subagentLanes={activeLanes}
            onFocusScreen={noop}
            onRetryScreen={noop}
            viewMode="business"
          />
        </PreferencesProvider>,
      );

      expect(streamingMarkup).toContain('data-testid="prototype-artboard-card-SCR-MEMBER"');
      expect(streamingMarkup).toContain('data-testid="prototype-artboard-card-SCR-DRAWER"');
      expect(streamingMarkup).toContain('data-artboard-status="streaming"');
      expect(streamingMarkup).toContain('data-cursor-phase="STREAMING"');
      expect(streamingMarkup).toContain('data-testid="prototype-artboard-card-SCR-POS"');
      expect(streamingMarkup).toContain('data-testid="prototype-artboard-card-SCR-SETTLE"');
      expect(streamingMarkup).toContain('data-testid="artboard-live-cursor-lane-2"');
      expect(streamingMarkup).toContain('data-testid="artboard-live-cursor-lane-3"');
      expect(checkBusinessViewMarkup(streamingMarkup)).toHaveLength(0);

      // 3. Interrupted state (busy=false, SCR-MEMBER is ready, SCR-SETTLE is still queued -> shows Resume button!)
      const interruptedMarkup = renderToStaticMarkup(
        <PreferencesProvider>
          <PrototypeArtboardGrid
            htmlContent={withFirstDone.nextHtml}
            projectName="咖啡店管理系统"
            busy={false}
            onFocusScreen={noop}
            onRetryScreen={noop}
            viewMode="business"
          />
        </PreferencesProvider>,
      );
      expect(interruptedMarkup).toContain('data-testid="artboard-retry-btn-SCR-SETTLE"');
      expect(interruptedMarkup).not.toContain('data-testid="artboard-retry-btn-SCR-MEMBER"');
      expect(checkBusinessViewMarkup(interruptedMarkup)).toHaveLength(0);
    }
  });

  it('defaults Code Mode ON and Multi-Agent ×3 in ShellAgentPanel and renders parallel subagent lanes in AgentRunCard with 0 Business View violations', async () => {
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

      expect(panelHtml).toContain('data-testid="agent-execution-mode-bar"');
      expect(panelHtml).toContain('data-testid="agent-codemode-toggle"');
      expect(panelHtml).toMatch(/data-testid="agent-codemode-toggle"[^>]*aria-pressed="true"/);
      expect(panelHtml).toMatch(/data-testid="agent-concurrency-btn-3"[^>]*aria-pressed="true"/);
      expect(checkBusinessViewMarkup(panelHtml)).toHaveLength(0);

      const cardHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <AgentRunCard
            now={1_700_000_012_000}
            run={{
              id: 'run-parallel-1',
              title: { zh: '生成咖啡店交互原型', en: 'Generate coffee shop prototype' },
              status: 'RUNNING',
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
                  status: 'RUNNING',
                  progressChars: 920,
                  startedAt: '2026-11-18T04:00:00.000Z',
                },
                {
                  laneId: 'l2',
                  workerIndex: 2,
                  workerLabel: { zh: '2 号助手', en: 'Assistant #2' },
                  taskTitle: { zh: '绘制储值录入抽屉', en: 'Build top-up drawer' },
                  status: 'RUNNING',
                  progressChars: 810,
                  startedAt: '2026-11-18T04:00:00.000Z',
                },
                {
                  laneId: 'l3',
                  workerIndex: 3,
                  workerLabel: { zh: '3 号助手', en: 'Assistant #3' },
                  taskTitle: { zh: '绘制现磨点单收银', en: 'Build POS screen' },
                  status: 'RUNNING',
                  progressChars: 750,
                  startedAt: '2026-11-18T04:00:00.000Z',
                },
              ],
              steps: [],
            }}
          />
        </PreferencesProvider>,
      );

      expect(cardHtml).toContain('data-testid="agent-run-subagent-lanes"');
      expect(cardHtml).toContain('data-testid="agent-run-stream-chars"');
      expect(cardHtml).toContain('data-testid="agent-run-codemode-script"');
      expect(checkBusinessViewMarkup(cardHtml)).toHaveLength(0);
    }
  });
});
