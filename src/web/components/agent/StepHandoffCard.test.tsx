import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
} from '../../../packages/business-vocabulary/index.js';
import {
  createWorkspaceStore,
  type AgentSession,
  type StepHandoffProposal,
} from '../../../packages/workspace-store/index.js';
import { createApiApp } from '../../../server/app.js';
import { useWorkbenchStore, type BootstrapPayload } from '../../api.js';
import { PreferencesProvider } from '../../i18n.js';
import { AssistantReplyItem } from './conversation/AssistantReplyItem.js';
import { ShellAgentPanel, agentPanelSurfaceFor } from './ShellAgentPanel.js';
import { StepHandoffCard } from './StepHandoffCard.js';
import { agentRunsFromSession, type AgentRunView } from './agentRun.js';

const STARTED_AT = Date.UTC(2026, 10, 17, 10, 0, 0);
const noop = () => {};
const initialStoreSnapshot = { ...useWorkbenchStore.getInitialState() };

function useLocale(locale: 'zh-CN' | 'en-US') {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'onto_locale' ? locale : null),
    setItem: noop,
    removeItem: noop,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  useWorkbenchStore.setState({
    data: null,
    liveSessionDrafts: {},
    sessionQueues: {},
    activePrototypeIdByProject: {},
  });
  Object.assign(useWorkbenchStore.getInitialState(), initialStoreSnapshot);
});

describe('StepHandoffCard & AssistantReplyItem integration (#72)', () => {
  const baseProposal: StepHandoffProposal = {
    id: 'handoff-demo-1',
    sourceStep: 'PROTOTYPE',
    targetStep: 'BUSINESS_MODEL',
    request: '合同金额超过 50 万元必须由总经理审批',
    reason: '业务规则、审批条件与角色权限属于「业务模型」步骤的范围',
    status: 'PENDING',
  };

  it('renders PENDING, ACCEPTED, and DECLINED states in zh-CN and en-US with required testids and zero checkBusinessViewMarkup violations', () => {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      useLocale(locale);

      // 1. PENDING state
      const pendingHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <StepHandoffCard
            handoff={{
              ...baseProposal,
              reason:
                locale === 'en-US'
                  ? 'Business rules and approval thresholds belong in the Business Model step'
                  : baseProposal.reason,
            }}
            onAccept={noop}
            onDecline={noop}
          />
        </PreferencesProvider>,
      );

      expect(pendingHtml).toContain('data-testid="step-handoff-card"');
      expect(pendingHtml).toContain('data-handoff-status="PENDING"');
      expect(pendingHtml).toContain('data-testid="step-handoff-request"');
      expect(pendingHtml).toContain('data-testid="step-handoff-accept-btn"');
      expect(pendingHtml).toContain('data-testid="step-handoff-decline-btn"');
      expect(pendingHtml).not.toContain('data-testid="step-handoff-resolved"');

      if (locale === 'zh-CN') {
        expect(pendingHtml).toContain('业务模型');
        expect(pendingHtml).toContain('转到该步骤继续');
        expect(pendingHtml).toContain('留在这里');
      } else {
        expect(pendingHtml).toContain('Hand off to Business Model');
        expect(pendingHtml).toContain('Continue in Business Model');
        expect(pendingHtml).toContain('Stay here');
      }

      const pendingViolations = checkBusinessViewMarkup(pendingHtml);
      expect(
        pendingViolations,
        formatBusinessViewViolations(pendingViolations),
      ).toEqual([]);

      // 2. ACCEPTED state collapses to quiet 1-line summary
      const acceptedHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <StepHandoffCard
            handoff={{
              ...baseProposal,
              status: 'ACCEPTED',
              resolvedAt: '2026-11-17T10:02:00.000Z',
              targetSessionId: 'asess-bm-1',
            }}
            onOpenTargetStep={noop}
          />
        </PreferencesProvider>,
      );
      expect(acceptedHtml).toContain('data-testid="step-handoff-card"');
      expect(acceptedHtml).toContain('data-handoff-status="ACCEPTED"');
      expect(acceptedHtml).toContain('data-testid="step-handoff-resolved"');
      expect(acceptedHtml).not.toContain('data-testid="step-handoff-accept-btn"');

      const acceptedViolations = checkBusinessViewMarkup(acceptedHtml);
      expect(
        acceptedViolations,
        formatBusinessViewViolations(acceptedViolations),
      ).toEqual([]);

      // 3. DECLINED state collapses to quiet 1-line summary
      const declinedHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <StepHandoffCard
            handoff={{
              ...baseProposal,
              status: 'DECLINED',
              resolvedAt: '2026-11-17T10:02:00.000Z',
            }}
          />
        </PreferencesProvider>,
      );
      expect(declinedHtml).toContain('data-testid="step-handoff-card"');
      expect(declinedHtml).toContain('data-handoff-status="DECLINED"');
      expect(declinedHtml).toContain('data-testid="step-handoff-resolved"');
      expect(declinedHtml).not.toContain('data-testid="step-handoff-accept-btn"');

      const declinedViolations = checkBusinessViewMarkup(declinedHtml);
      expect(
        declinedViolations,
        formatBusinessViewViolations(declinedViolations),
      ).toEqual([]);
    }
  });

  it('sanitizes accidental model codes or technical IDs inside handoff reason/request so Business View stays 100% jargon-free', () => {
    useLocale('zh-CN');
    const html = renderToStaticMarkup(
      <PreferencesProvider>
        <StepHandoffCard
          handoff={{
            id: 'handoff-jargon-1',
            sourceStep: 'PROTOTYPE',
            targetStep: 'BUSINESS_MODEL',
            request: '为 AGG-01 补充 M3 审批规则 RULE-09',
            reason: 'M3 与 M5 规则由 Copilot 在 t_contract 上核对',
            status: 'PENDING',
          }}
          onAccept={noop}
          onDecline={noop}
        />
      </PreferencesProvider>,
    );
    const violations = checkBusinessViewMarkup(html);
    expect(violations, formatBusinessViewViolations(violations)).toEqual([]);
  });

  it('adapts stepHandoff and handoffFrom through agentRunsFromSession and renders cleanly inside AssistantReplyItem and ShellAgentPanel', async () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    store.updateSystemSettings({ mockLlmMode: true });
    const api = createApiApp(store);

    try {
      const proto = store.listPrototypes('proj-contract')[0]!;
      const sessRes = await api.request(
        `/api/projects/proj-contract/prototypes/${proto.id}/co-design-session`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      );
      const { session: protoSess } = (await sessRes.json()) as { session: AgentSession };

      const streamRes = await api.request(`/api/agent-sessions/${protoSess.id}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: '合同金额超过 50 万元要总经理审批',
          mockMode: true,
        }),
      });
      await streamRes.text();

      const bootRes = await api.request('/api/bootstrap?projectId=proj-contract');
      const bootData = (await bootRes.json()) as BootstrapPayload;
      const hydratedProtoSession = bootData.agentSessions.find((s) => s.id === protoSess.id)!;

      const runs: AgentRunView[] = agentRunsFromSession(hydratedProtoSession);
      expect(runs).toHaveLength(1);
      expect(runs[0]!.stepHandoff).toMatchObject({
        sourceStep: 'PROTOTYPE',
        targetStep: 'BUSINESS_MODEL',
        request: '合同金额超过 50 万元要总经理审批',
        status: 'PENDING',
      });

      for (const locale of ['zh-CN', 'en-US'] as const) {
        useLocale(locale);
        const replyHtml = renderToStaticMarkup(
          <PreferencesProvider>
            <AssistantReplyItem
              run={runs[0]!}
              now={STARTED_AT + 10_000}
              onAcceptStepHandoff={noop}
              onDeclineStepHandoff={noop}
            />
          </PreferencesProvider>,
        );
        expect(replyHtml).toContain('data-testid="step-handoff-card"');
        expect(replyHtml).toContain('data-testid="step-handoff-accept-btn"');
        const violations = checkBusinessViewMarkup(replyHtml);
        expect(violations, formatBusinessViewViolations(violations)).toEqual([]);
      }

      // Render full ShellAgentPanel on app-prototype
      useLocale('zh-CN');
      useWorkbenchStore.setState({
        data: bootData,
        activeNav: 'app-prototype',
        activeItemId: proto.id,
        activeSessionId: protoSess.id,
        activePrototypeIdByProject: { 'proj-contract': proto.id },
      });
      Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());

      const panelHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <ShellAgentPanel
            surface={agentPanelSurfaceFor('app-prototype')}
            overlay={false}
            side="left"
            closable={false}
            onClose={noop}
            onNavigate={noop}
          />
        </PreferencesProvider>,
      );
      expect(panelHtml).toContain('data-testid="step-handoff-card"');
      const panelViolations = checkBusinessViewMarkup(panelHtml);
      expect(panelViolations, formatBusinessViewViolations(panelViolations)).toEqual([]);
    } finally {
      store.close();
    }
  });
});
