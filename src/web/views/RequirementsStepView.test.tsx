import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
} from '../../packages/business-vocabulary/index.js';
import { createWorkspaceStore } from '../../packages/workspace-store/index.js';
import { createApiApp } from '../../server/app.js';
import { useWorkbenchStore, type BootstrapPayload } from '../api.js';
import { ApprovalCard } from '../components/beautifui/ApprovalCard.js';
import { PreferencesProvider } from '../i18n.js';
import { RequirementsStepView } from './ApplicationCenterViews.js';

function stubBrowserStorage(entries: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(entries));
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, val: string) => {
        map.set(key, val);
      },
      removeItem: (key: string) => {
        map.delete(key);
      },
    },
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

async function fetchBootstrap(
  store: ReturnType<typeof createWorkspaceStore>,
  projectId: string,
): Promise<BootstrapPayload> {
  const app = createApiApp(store);
  const res = await app.request(`/api/bootstrap?projectId=${encodeURIComponent(projectId)}`);
  return (await res.json()) as BootstrapPayload;
}

describe('RequirementsStepView & collapsing ApprovalCard (#64)', () => {
  const initialSnapshot = { ...useWorkbenchStore.getInitialState() };

  afterEach(() => {
    vi.unstubAllGlobals();
    useWorkbenchStore.setState({
      data: initialSnapshot.data,
      loading: initialSnapshot.loading,
      activeNav: initialSnapshot.activeNav,
    });
    Object.assign(useWorkbenchStore.getInitialState(), initialSnapshot);
  });

  it('renders Business View on seeded proj-contract with collapsed confirmed sections, single primary action, and zero Business View violations in zh-CN and en-US', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    try {
      const bootstrap = await fetchBootstrap(store, 'proj-contract');
      useWorkbenchStore.setState({ loading: false, data: bootstrap });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

      for (const locale of ['zh-CN', 'en-US'] as const) {
        stubBrowserStorage({ onto_locale: locale });
        const html = renderToStaticMarkup(
          <PreferencesProvider>
            <RequirementsStepView onNavigate={() => {}} />
          </PreferencesProvider>,
        );
        const violations = checkBusinessViewMarkup(html);
        expect(violations, formatBusinessViewViolations(violations)).toEqual([]);
        expect(html).toContain('data-testid="requirements-step-canvas"');
        expect(html).toContain('data-testid="go-to-prototype-btn"');
        expect(html).toContain('data-testid="requirements-view-mode-toggle"');
        // Confirmed sections collapse by default (Business View Rule 4)
        expect(html).toContain('aria-expanded="false"');
      }
    } finally {
      store.close();
    }
  });

  it('renders NOT_STARTED, IN_PROGRESS (forming outline & draft doc), UNCONFIRMED_CHANGES, and Technical Details cleanly with zero Business View violations', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    try {
      const proj = store.createProject({
        name: '园区访客通行系统',
        code: 'VISITOR-PASS',
        domain: '智慧园区通行',
        template: 'EMPTY',
      });

      // 1. NOT_STARTED
      stubBrowserStorage({ onto_locale: 'zh-CN' });
      const emptyBoot = await fetchBootstrap(store, proj.id);
      useWorkbenchStore.setState({ loading: false, data: emptyBoot });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

      const notStartedHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <RequirementsStepView onNavigate={() => {}} />
        </PreferencesProvider>,
      );
      expect(checkBusinessViewMarkup(notStartedHtml)).toEqual([]);
      expect(notStartedHtml).toContain('描述你想做的系统');

      // 2. IN_PROGRESS (conversation signals recorded, no RequirementDoc synthesized yet)
      store.createAgentSession({
        projectId: proj.id,
        agentKind: 'REQUIREMENT',
        title: '访客通行需求对话',
        initialMessages: [
          {
            id: 'm1',
            role: 'user',
            content: '访客预约需要被访员工审批，高密区域需要安全主管二次审批',
            timestamp: '2026-11-17T08:00:00Z',
          },
          {
            id: 'm2',
            role: 'assistant',
            content: '已为你记录核心业务对象与审批要点。',
            timestamp: '2026-11-17T08:00:05Z',
            artifacts: [
              {
                kind: 'REQUIREMENT_HINTS',
                aggregates: ['访客通行单 VisitorPass (AGG-01)'],
                rules: ['RULE-01: 进入高密研发楼需安全主管二次审批'],
                decisions: ['[已确认] 普通访客由被访员工审批即可放行'],
                openQuestions: ['[待确认] 临时车辆进园是否共用同一张通行单？'],
              },
            ],
          },
        ],
      });
      const conversingBoot = await fetchBootstrap(store, proj.id);
      useWorkbenchStore.setState({ loading: false, data: conversingBoot });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

      const conversingHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <RequirementsStepView onNavigate={() => {}} />
        </PreferencesProvider>,
      );
      const conversingViolations = checkBusinessViewMarkup(conversingHtml);
      expect(conversingViolations, formatBusinessViewViolations(conversingViolations)).toEqual([]);
      expect(conversingHtml).toContain('data-testid="synthesize-srs-btn"');
      expect(conversingHtml).toContain('访客通行单');

      // 3. IN_PROGRESS (synthesized draft doc with raw technical references inside -> sanitized cleanly in Business View!)
      store.saveRequirementDoc({
        id: 'rdoc-visitor-1',
        projectId: proj.id,
        title: '园区访客通行系统 — 需求规格说明书 (需求规格说明书.md v5.0)',
        version: 'v5.0',
        status: 'DRAFT',
        content: [
          '# 园区访客通行系统 — 需求规格说明书',
          '',
          '## 1. 业务目标与范围',
          '- 建设园区访客预约、审批与门禁核销闭环。',
          '',
          '## 2. 核心领域对象 (对应 M1 对象模型)',
          '- **访客通行单 (`VisitorPass` / `AGG-01`)**：记录来访人、被访员工与通行时段。',
        ].join('\n'),
      });
      const draftDocBoot = await fetchBootstrap(store, proj.id);
      useWorkbenchStore.setState({ loading: false, data: draftDocBoot });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

      const draftDocHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <RequirementsStepView onNavigate={() => {}} />
        </PreferencesProvider>,
      );
      const draftViolations = checkBusinessViewMarkup(draftDocHtml);
      expect(draftViolations, formatBusinessViewViolations(draftViolations)).toEqual([]);
      expect(draftDocHtml).toContain('data-testid="confirm-requirements-btn"');
      expect(draftDocHtml).toContain('确认需求文档');
      expect(draftDocHtml).toContain('aria-expanded="true"');

      // 4. Confirm, then edit Section 2 -> UNCONFIRMED_CHANGES expands only the modified section
      store.confirmRequirementsStep(proj.id, { docId: 'rdoc-visitor-1' });
      store.saveRequirementDoc({
        id: 'rdoc-visitor-1',
        projectId: proj.id,
        title: '园区访客通行系统需求文档',
        version: 'v5.1',
        status: 'DRAFT',
        content: [
          '# 园区访客通行系统需求文档',
          '',
          '## 1. 业务目标与范围',
          '- 建设园区访客预约、审批与门禁核销闭环。',
          '',
          '## 2. 核心业务对象',
          '- **访客通行单**：记录来访人、被访员工、同行车辆车牌与通行时段。',
        ].join('\n'),
      });
      const revisedBoot = await fetchBootstrap(store, proj.id);
      useWorkbenchStore.setState({ loading: false, data: revisedBoot });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

      const revisedHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <RequirementsStepView onNavigate={() => {}} />
        </PreferencesProvider>,
      );
      expect(checkBusinessViewMarkup(revisedHtml)).toEqual([]);
      expect(revisedHtml).toContain('有未确认的修改');
      expect(revisedHtml).toContain('重新确认需求文档');
      expect(revisedHtml).toContain('同行车辆车牌');

      // 5. Technical Details mode persisted in localStorage (`onto_step_view_mode_REQUIREMENTS`)
      stubBrowserStorage({
        onto_locale: 'zh-CN',
        onto_step_view_mode_REQUIREMENTS: 'technical',
      });
      const technicalHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <RequirementsStepView onNavigate={() => {}} />
        </PreferencesProvider>,
      );
      expect(technicalHtml).toContain('data-testid="requirements-technical-details"');
      expect(technicalHtml).toContain('返回业务视图');
    } finally {
      store.close();
    }
  });

  it('renders ApprovalCard as clickable options + freeform when unanswered, and collapses into a single-line question+answer summary when answered', () => {
    stubBrowserStorage({ onto_locale: 'zh-CN' });

    const openHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <ApprovalCard
          prompt={{
            id: 'ask-1',
            question: '金额超过 100 万元的采购合同，希望由谁最终审批？',
            options: ['法务总监单独终审', '法务总监与财务总监共同审批'],
            answered: false,
          }}
          onSubmit={() => {}}
        />
      </PreferencesProvider>,
    );
    expect(checkBusinessViewMarkup(openHtml)).toEqual([]);
    expect(openHtml).toContain('data-testid="agent-hitl-card"');
    expect(openHtml).toContain('data-testid="agent-hitl-option-0"');
    expect(openHtml).toContain('data-testid="agent-hitl-option-1"');
    expect(openHtml).toContain('data-testid="agent-hitl-freeform-input"');
    expect(openHtml).toContain('data-testid="agent-hitl-submit-btn"');

    const answeredHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <ApprovalCard
          prompt={{
            id: 'ask-1',
            question: '金额超过 100 万元的采购合同，希望由谁最终审批？',
            options: ['法务总监单独终审', '法务总监与财务总监共同审批'],
            answered: true,
            selectedAnswers: ['法务总监与财务总监共同审批'],
          }}
        />
      </PreferencesProvider>,
    );
    expect(checkBusinessViewMarkup(answeredHtml)).toEqual([]);
    expect(answeredHtml).toContain('data-testid="agent-hitl-answered-summary"');
    expect(answeredHtml).not.toContain('data-testid="agent-hitl-card"');
    expect(answeredHtml).toContain('whitespace-nowrap');
    expect(answeredHtml).toContain('金额超过 100 万元的采购合同，希望由谁最终审批？');
    expect(answeredHtml).toContain('法务总监与财务总监共同审批');
  });
});
