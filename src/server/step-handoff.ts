import type { Hono } from 'hono';
import type { ProjectStepId } from '../packages/business-vocabulary/index.js';
import {
  ensurePrototypeCoDesignSession,
  normalizeAgentLocale,
  startUnifiedAgentSessionTurn,
  type AgentLocale,
} from '../packages/agent-runtime/index.js';
import {
  getDefaultStepTargetView,
  type AgentSession,
  type ProjectStepTargetView,
  type StepHandoffProposal,
  type WorkspaceStore,
} from '../packages/workspace-store/index.js';
import { deriveProjectStepsForStoreProject } from './step-confirmations.js';

export interface AcceptStepHandoffRequestBody {
  preferredTargetSessionId?: string;
  preferredPrototypeId?: string;
  preferredApplicationId?: string;
  runInBackground?: boolean;
  mockMode?: boolean;
  locale?: string;
}

interface LocatedStepHandoff {
  session: AgentSession;
  messageIndex: number;
  handoff: StepHandoffProposal;
}

function resolveRouteLocale(
  c: { req: { header: (name: string) => string | undefined } },
  bodyLocale?: string,
): AgentLocale {
  return normalizeAgentLocale(bodyLocale ?? c.req.header('x-onto-locale') ?? undefined) ?? 'zh-CN';
}

function findStepHandoff(
  store: WorkspaceStore,
  criteria: { sessionId?: string; projectId?: string; handoffId: string },
): LocatedStepHandoff | null {
  const candidates: AgentSession[] = criteria.sessionId
    ? (() => {
        const one = store.getAgentSession(criteria.sessionId);
        return one ? [one] : [];
      })()
    : store.listAgentSessions(criteria.projectId ? { projectId: criteria.projectId } : undefined);

  for (const session of candidates) {
    if (criteria.projectId && session.projectId !== criteria.projectId) continue;
    for (let i = session.messages.length - 1; i >= 0; i -= 1) {
      const msg = session.messages[i]!;
      if (msg.stepHandoff && msg.stepHandoff.id === criteria.handoffId) {
        return {
          session,
          messageIndex: i,
          handoff: msg.stepHandoff,
        };
      }
    }
  }
  return null;
}

function resolveTargetSessionForStep(
  store: WorkspaceStore,
  projectId: string,
  targetStep: ProjectStepId,
  locale: AgentLocale,
  opts?: {
    preferredTargetSessionId?: string;
    preferredPrototypeId?: string;
    preferredApplicationId?: string;
  },
): {
  session: AgentSession;
  targetNavView: ProjectStepTargetView;
  targetItemId?: string;
} {
  const targetNavView = getDefaultStepTargetView(targetStep);
  const allProjectSessions = store
    .listAgentSessions({ projectId })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  switch (targetStep) {
    case 'REQUIREMENTS': {
      const matching = allProjectSessions.filter((s) => s.agentKind === 'REQUIREMENT');
      const session =
        (opts?.preferredTargetSessionId
          ? matching.find((s) => s.id === opts.preferredTargetSessionId)
          : undefined) ??
        matching[0] ??
        store.createAgentSession({
          projectId,
          agentKind: 'REQUIREMENT',
          title: locale === 'en-US' ? 'Requirements conversation' : '需求梳理对话',
        });
      return {
        session,
        targetNavView,
      };
    }

    case 'PROTOTYPE': {
      const prototypes = store.listPrototypes(projectId);
      const confirmed = store.getConfirmedPrototypeRevision(projectId);
      const targetProto =
        (opts?.preferredPrototypeId
          ? prototypes.find((p) => p.id === opts.preferredPrototypeId)
          : undefined) ??
        (confirmed ? prototypes.find((p) => p.id === confirmed.prototypeId) : undefined) ??
        prototypes[0];

      if (targetProto) {
        const session = ensurePrototypeCoDesignSession(store, projectId, targetProto.id);
        return {
          session,
          targetNavView,
          targetItemId: targetProto.id,
        };
      }

      // When PROTOTYPE has no prototype yet (e.g. blocked because Requirements are unconfirmed),
      // use or create a clean unbound PROTOTYPE_CO_DESIGN session so the request is never lost.
      const unbound = allProjectSessions.filter(
        (s) => s.agentKind === 'PROTOTYPE_CO_DESIGN' && !s.targetId,
      );
      const session =
        (opts?.preferredTargetSessionId
          ? unbound.find((s) => s.id === opts.preferredTargetSessionId)
          : undefined) ??
        unbound[0] ??
        store.createAgentSession({
          projectId,
          agentKind: 'PROTOTYPE_CO_DESIGN',
          title: locale === 'en-US' ? 'Prototype conversation' : '原型共创对话',
        });
      return {
        session,
        targetNavView,
      };
    }

    case 'BUSINESS_MODEL': {
      const matching = allProjectSessions.filter((s) => s.agentKind === 'COPILOT');
      const session =
        (opts?.preferredTargetSessionId
          ? matching.find((s) => s.id === opts.preferredTargetSessionId)
          : undefined) ??
        matching[0] ??
        store.createAgentSession({
          projectId,
          agentKind: 'COPILOT',
          title: locale === 'en-US' ? 'Business model conversation' : '业务模型对话',
        });
      return {
        session,
        targetNavView,
      };
    }

    case 'DELIVERY': {
      const projectApps = store
        .listAssembledApplications()
        .filter((app) => app.projectId === projectId);
      const targetApp =
        (opts?.preferredApplicationId
          ? projectApps.find((app) => app.id === opts.preferredApplicationId)
          : undefined) ?? projectApps[0];
      const matching = allProjectSessions.filter(
        (s) => s.agentKind === 'CODING' && (!s.targetId || s.targetId === targetApp?.id),
      );
      const session =
        (opts?.preferredTargetSessionId
          ? matching.find((s) => s.id === opts.preferredTargetSessionId)
          : undefined) ??
        matching[0] ??
        store.createAgentSession({
          projectId,
          agentKind: 'CODING',
          ...(targetApp ? { targetId: targetApp.id } : {}),
          title: locale === 'en-US' ? 'Delivery conversation' : '应用交付对话',
        });
      return {
        session,
        targetNavView,
        ...(targetApp ? { targetItemId: targetApp.id } : {}),
      };
    }
  }
}

function updateSourceSessionHandoff(
  store: WorkspaceStore,
  sessionId: string,
  handoffId: string,
  patch: Partial<StepHandoffProposal>,
): { session: AgentSession; handoff: StepHandoffProposal } | null {
  const fresh = store.getAgentSession(sessionId);
  if (!fresh) return null;
  let updatedHandoff: StepHandoffProposal | undefined;
  const nextMessages = fresh.messages.map((msg) => {
    if (!msg.stepHandoff || msg.stepHandoff.id !== handoffId) return msg;
    updatedHandoff = {
      ...msg.stepHandoff,
      ...patch,
    };
    return {
      ...msg,
      stepHandoff: updatedHandoff,
    };
  });
  if (!updatedHandoff) return null;
  const saved = store.saveAgentSession({
    ...fresh,
    messages: nextMessages,
    updatedAt: new Date().toISOString(),
  });
  return { session: saved, handoff: updatedHandoff };
}

export function registerStepHandoffRoutes(app: Hono, store: WorkspaceStore): void {
  const inFlightHandoffIds = new Set<string>();

  const requirePendingHandoff = (
    c: { json: (data: unknown, status?: 404 | 409) => Response },
    scope: { sessionId?: string; projectId?: string; handoffId: string },
    locale: AgentLocale,
  ): { ok: true; located: LocatedStepHandoff } | { ok: false; response: Response } => {
    const located = findStepHandoff(store, scope);
    if (!located) {
      return {
        ok: false,
        response: c.json(
          {
            error:
              locale === 'en-US'
                ? 'Step hand-off proposal not found.'
                : '未找到对应的步骤转交提议。',
            code: 'HANDOFF_NOT_FOUND',
          },
          404,
        ),
      };
    }

    if (located.handoff.status !== 'PENDING' || inFlightHandoffIds.has(located.handoff.id)) {
      return {
        ok: false,
        response: c.json(
          {
            error:
              locale === 'en-US'
                ? 'This step hand-off proposal has already been resolved.'
                : '该步骤转交提议已处理，不能重复执行。',
            code: 'HANDOFF_ALREADY_RESOLVED',
            handoff: located.handoff,
          },
          409,
        ),
      };
    }

    return { ok: true, located };
  };

  const handleAccept = async (
    c: {
      req: {
        param: (name: string) => string | undefined;
        header: (name: string) => string | undefined;
        json: <T>() => Promise<T>;
      };
      json: (data: unknown, status?: 200 | 400 | 404 | 409) => Response;
    },
    scope: { sessionId?: string; projectId?: string; handoffId: string },
  ): Promise<Response> => {
    const body = await c.req
      .json<AcceptStepHandoffRequestBody>()
      .catch((): AcceptStepHandoffRequestBody => ({}));
    const locale = resolveRouteLocale(c, body.locale);

    const check = requirePendingHandoff(c, scope, locale);
    if (!check.ok) return check.response;
    const { session: sourceSession, handoff } = check.located;

    const projectId = scope.projectId ?? sourceSession.projectId;
    if (!projectId || !store.getProject(projectId)) {
      return c.json(
        {
          error: locale === 'en-US' ? 'Project not found.' : '未找到对应项目。',
          code: 'PROJECT_NOT_FOUND',
        },
        404,
      );
    }

    inFlightHandoffIds.add(handoff.id);
    try {
      const resolvedTarget = resolveTargetSessionForStep(
        store,
        projectId,
        handoff.targetStep,
        locale,
        {
          ...(body.preferredTargetSessionId
            ? { preferredTargetSessionId: body.preferredTargetSessionId }
            : {}),
          ...(body.preferredPrototypeId
            ? { preferredPrototypeId: body.preferredPrototypeId }
            : {}),
          ...(body.preferredApplicationId
            ? { preferredApplicationId: body.preferredApplicationId }
            : {}),
        },
      );

      const resolvedAt = new Date().toISOString();
      updateSourceSessionHandoff(store, sourceSession.id, handoff.id, {
        status: 'ACCEPTED',
        resolvedAt,
        targetSessionId: resolvedTarget.session.id,
      });

      const started = await startUnifiedAgentSessionTurn(
        store,
        {
          sessionId: resolvedTarget.session.id,
          prompt: handoff.request,
          handoffFrom: {
            handoffId: handoff.id,
            sourceStep: handoff.sourceStep ?? null,
            sourceSessionId: sourceSession.id,
          },
          ...(body.mockMode !== undefined ? { mockMode: body.mockMode } : {}),
          locale,
        },
        { awaitCompletion: body.runInBackground !== true },
      );

      const finalizedSource = updateSourceSessionHandoff(store, sourceSession.id, handoff.id, {
        status: 'ACCEPTED',
        resolvedAt,
        targetSessionId: started.session.id,
        ...(started.runId ? { targetRunId: started.runId } : {}),
      });

      return c.json(
        {
          handoff: finalizedSource?.handoff ?? {
            ...handoff,
            status: 'ACCEPTED',
            resolvedAt,
            targetSessionId: started.session.id,
            ...(started.runId ? { targetRunId: started.runId } : {}),
          },
          sourceSession: finalizedSource?.session ?? store.getAgentSession(sourceSession.id),
          targetSession: started.session,
          targetStep: handoff.targetStep,
          targetNavView: resolvedTarget.targetNavView,
          targetSessionId: started.session.id,
          targetRunId: started.runId,
          ...(resolvedTarget.targetItemId ? { targetItemId: resolvedTarget.targetItemId } : {}),
          agentSessions: store.listAgentSessions(),
          project: store.getProject(projectId),
          stepConfirmations: store.getProjectStepConfirmations(projectId),
          steps: deriveProjectStepsForStoreProject(store, projectId),
        },
        200,
      );
    } finally {
      inFlightHandoffIds.delete(handoff.id);
    }
  };

  const handleDecline = async (
    c: {
      req: {
        header: (name: string) => string | undefined;
        json: <T>() => Promise<T>;
      };
      json: (data: unknown, status?: 200 | 404 | 409) => Response;
    },
    scope: { sessionId?: string; projectId?: string; handoffId: string },
  ): Promise<Response> => {
    const body = await c.req
      .json<{ locale?: string }>()
      .catch((): { locale?: string } => ({}));
    const locale = resolveRouteLocale(c, body.locale);

    const check = requirePendingHandoff(c, scope, locale);
    if (!check.ok) return check.response;
    const { session: sourceSession, handoff } = check.located;

    const updated = updateSourceSessionHandoff(store, sourceSession.id, handoff.id, {
      status: 'DECLINED',
      resolvedAt: new Date().toISOString(),
    });

    return c.json(
      {
        handoff: updated?.handoff ?? { ...handoff, status: 'DECLINED' },
        sourceSession: updated?.session ?? store.getAgentSession(sourceSession.id),
        agentSessions: store.listAgentSessions(),
      },
      200,
    );
  };

  app.post('/api/agent-sessions/:sessionId/handoffs/:handoffId/accept', (c) =>
    handleAccept(c, {
      sessionId: c.req.param('sessionId'),
      handoffId: c.req.param('handoffId'),
    }),
  );

  app.post('/api/agent-sessions/:sessionId/handoffs/:handoffId/decline', (c) =>
    handleDecline(c, {
      sessionId: c.req.param('sessionId'),
      handoffId: c.req.param('handoffId'),
    }),
  );

  app.post('/api/projects/:projectId/step-handoffs/:handoffId/accept', (c) =>
    handleAccept(c, {
      projectId: c.req.param('projectId'),
      handoffId: c.req.param('handoffId'),
    }),
  );

  app.post('/api/projects/:projectId/step-handoffs/:handoffId/decline', (c) =>
    handleDecline(c, {
      projectId: c.req.param('projectId'),
      handoffId: c.req.param('handoffId'),
    }),
  );
}
