import type { Hono } from 'hono';
import {
  BusinessModelConfirmError,
  RequirementsConfirmError,
  type DevelopmentPackageSnapshot,
  type WorkspaceStore,
} from '../packages/workspace-store/index.js';
import { normalizeAgentLocale, type AgentLocale } from '../packages/agent-runtime/index.js';
import {
  deriveProjectSteps,
  type ProjectStepStatusView,
} from '../web/navigation/projectSteps.js';

export function listProjectPackageSnapshots(
  store: WorkspaceStore,
  projectId: string,
): DevelopmentPackageSnapshot[] {
  const apps = store.listAssembledApplications().filter((app) => app.projectId === projectId);
  const snapshots: DevelopmentPackageSnapshot[] = [];
  for (const app of apps) {
    snapshots.push(...store.listDevelopmentPackageSnapshots(app.id));
  }
  return snapshots;
}

export function deriveProjectStepsForStoreProject(
  store: WorkspaceStore,
  projectId: string,
): readonly ProjectStepStatusView[] {
  const project = store.getProject(projectId);
  if (!project) return [];
  return deriveProjectSteps({
    project,
    agentSessions: store.listAgentSessions({ projectId }),
    requirementSessions: store.listRequirementSessions(projectId),
    requirementDocs: store.listRequirementDocs(projectId),
    prototypes: store.listPrototypes(projectId),
    confirmedPrototypeRevision: store.getConfirmedPrototypeRevision(projectId) ?? null,
    stepConfirmations: store.getProjectStepConfirmations(projectId),
    assembledApplications: store.listAssembledApplications(),
    packageSnapshots: listProjectPackageSnapshots(store, projectId),
    generatedSkills: store.listGeneratedSkills(projectId),
  });
}

function resolveRouteLocale(c: {
  req: { header: (name: string) => string | undefined };
}): AgentLocale {
  return normalizeAgentLocale(c.req.header('x-onto-locale') ?? undefined) ?? 'zh-CN';
}

export function registerStepConfirmationRoutes(app: Hono, store: WorkspaceStore): void {
  app.get('/api/projects/:id/step-confirmations', (c) => {
    const projectId = c.req.param('id');
    const project = store.getProject(projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json({
      stepConfirmations: store.getProjectStepConfirmations(projectId),
      confirmationsHistory: store.listStepConfirmations(projectId),
      steps: deriveProjectStepsForStoreProject(store, projectId),
    });
  });

  app.post('/api/projects/:id/steps/requirements/confirm', async (c) => {
    const projectId = c.req.param('id');
    const locale = resolveRouteLocale(c);
    const project = store.getProject(projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const body = await c.req
      .json<{ docId?: string }>()
      .catch((): { docId?: string } => ({}));
    try {
      const result = store.confirmRequirementsStep(
        projectId,
        body.docId ? { docId: body.docId } : undefined,
      );
      return c.json({
        confirmation: result.confirmation,
        doc: result.doc,
        docs: store.listRequirementDocs(projectId),
        stepConfirmations: result.stepConfirmations,
        steps: deriveProjectStepsForStoreProject(store, projectId),
      });
    } catch (err) {
      if (err instanceof RequirementsConfirmError) {
        return c.json(
          {
            error: locale === 'en-US' ? err.messageEn : err.messageZh,
            code: err.code,
            messageZh: err.messageZh,
            messageEn: err.messageEn,
          },
          409,
        );
      }
      throw err;
    }
  });

  app.post('/api/projects/:id/steps/business-model/confirm', (c) => {
    const projectId = c.req.param('id');
    const locale = resolveRouteLocale(c);
    const project = store.getProject(projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    try {
      const result = store.confirmBusinessModelStep(projectId);
      return c.json({
        confirmation: result.confirmation,
        project: result.project,
        stepConfirmations: result.stepConfirmations,
        steps: deriveProjectStepsForStoreProject(store, projectId),
      });
    } catch (err) {
      if (err instanceof BusinessModelConfirmError) {
        return c.json(
          {
            error: locale === 'en-US' ? err.messageEn : err.messageZh,
            code: err.code,
            errorCount: err.errorCount,
            messageZh: err.messageZh,
            messageEn: err.messageEn,
          },
          409,
        );
      }
      throw err;
    }
  });
}
