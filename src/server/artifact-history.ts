import type { Hono } from 'hono';
import {
  ArtifactHistoryConflictError,
  ArtifactHistoryNotFoundError,
  sanitizeBusinessViewCopy,
  type ArtifactHistorySurfaceKind,
  type PersistedArtifactHistoryKind,
  type WorkspaceStore,
} from '../packages/workspace-store/index.js';
import {
  normalizeAgentLocale,
  registerAgentRunLifecycleHooks,
  type AgentLocale,
  type AgentRunLifecycleHooks,
} from '../packages/agent-runtime/index.js';
import { deriveProjectStepsForStoreProject } from './step-confirmations.js';

const hookedStores = new WeakSet<WorkspaceStore>();

const VALID_HISTORY_KINDS = new Set<ArtifactHistorySurfaceKind>([
  'REQUIREMENTS_DOC',
  'ONTOLOGY_SUITE',
  'PROTOTYPE',
]);

function isValidArtifactSurfaceKind(raw: string | undefined): raw is ArtifactHistorySurfaceKind {
  return Boolean(raw && VALID_HISTORY_KINDS.has(raw as ArtifactHistorySurfaceKind));
}

function resolveRouteLocale(c: {
  req: { header: (name: string) => string | undefined };
}): AgentLocale {
  return normalizeAgentLocale(c.req.header('x-onto-locale') ?? undefined) ?? 'zh-CN';
}

function extractConciseFirstSentence(raw: string): string | undefined {
  const cleaned = raw.trim();
  if (!cleaned) return undefined;
  const firstProseLine = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(
      (line) =>
        line.length > 0 &&
        !line.startsWith('#') &&
        !line.startsWith('>') &&
        !line.startsWith('```') &&
        !/^[-*+]\s+\*\*/.test(line),
    );
  if (!firstProseLine) return undefined;
  const sentenceMatch = /^(.+?[。！？.!?])(?:\s|$)/.exec(firstProseLine);
  const sentence = (sentenceMatch ? sentenceMatch[1]! : firstProseLine).trim();
  const safe = sanitizeBusinessViewCopy(sentence, 'zh-CN');
  if (!safe) return undefined;
  return safe.length > 120 ? `${safe.slice(0, 119)}…` : safe;
}

function extractAssistantChangeReason(
  store: WorkspaceStore,
  sessionId: string,
  assistantMessageId: string,
): string | undefined {
  const session = store.getAgentSession(sessionId);
  const msg = session?.messages.find((m) => m.id === assistantMessageId);
  if (!msg) return undefined;

  const toolCalls = [...(msg.toolCalls ?? [])].reverse();
  for (const tc of toolCalls) {
    if (tc.isError || !tc.arguments) continue;
    const candidate =
      (typeof tc.arguments.reason === 'string' && tc.arguments.reason.trim()) ||
      (typeof tc.arguments.changeReason === 'string' && tc.arguments.changeReason.trim()) ||
      (typeof tc.arguments.summary === 'string' && tc.arguments.summary.trim()) ||
      '';
    if (candidate) {
      return extractConciseFirstSentence(candidate) ?? candidate.slice(0, 120);
    }
  }

  return extractConciseFirstSentence(msg.content);
}

export function createArtifactHistoryRunHooks(): AgentRunLifecycleHooks {
  return {
    onRunStart: (event, store) => {
      if (!event.projectId) return;
      store.beginArtifactRunCapture({
        projectId: event.projectId,
        artifactKind: 'REQUIREMENTS_DOC',
        runId: event.runId,
        sessionId: event.sessionId,
      });
      store.beginArtifactRunCapture({
        projectId: event.projectId,
        artifactKind: 'ONTOLOGY_SUITE',
        runId: event.runId,
        sessionId: event.sessionId,
      });
    },
    onRunEnd: (event, store) => {
      if (!event.projectId) return;
      const reason = extractAssistantChangeReason(
        store,
        event.sessionId,
        event.assistantMessageId,
      );
      if (reason) {
        store.recordPrototypeRunReason(event.projectId, event.runId, reason);
      }
      store.finishArtifactRunCapture({
        projectId: event.projectId,
        artifactKind: 'REQUIREMENTS_DOC',
        runId: event.runId,
        sessionId: event.sessionId,
        ...(reason ? { reason } : {}),
      });
      store.finishArtifactRunCapture({
        projectId: event.projectId,
        artifactKind: 'ONTOLOGY_SUITE',
        runId: event.runId,
        sessionId: event.sessionId,
        ...(reason ? { reason } : {}),
      });
    },
  };
}

export function ensureArtifactHistoryRunHooksRegistered(store: WorkspaceStore): void {
  if (hookedStores.has(store)) return;
  hookedStores.add(store);
  registerAgentRunLifecycleHooks(store, createArtifactHistoryRunHooks());
}

export function registerArtifactHistoryRoutes(app: Hono, store: WorkspaceStore): void {
  ensureArtifactHistoryRunHooksRegistered(store);

  app.get('/api/projects/:id/history', (c) => {
    const projectId = c.req.param('id');
    const project = store.getProject(projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const rawKind = c.req.query('kind');
    if (rawKind !== undefined && rawKind !== '' && !isValidArtifactSurfaceKind(rawKind)) {
      return c.json(
        {
          error: `Unsupported artifact history kind: ${rawKind}`,
          code: 'INVALID_ARTIFACT_KIND',
        },
        400,
      );
    }
    const artifactKind = rawKind ? (rawKind as ArtifactHistorySurfaceKind) : undefined;
    const prototypeId = c.req.query('prototypeId')?.trim() || undefined;
    const includeStates =
      c.req.query('includeStates') === '1' || c.req.query('includeStates') === 'true';

    const entries = store.listArtifactHistoryViews(
      projectId,
      artifactKind || prototypeId
        ? {
            ...(artifactKind ? { artifactKind } : {}),
            ...(prototypeId ? { prototypeId } : {}),
          }
        : undefined,
    );

    return c.json({
      projectId,
      kind: artifactKind ?? null,
      ...(prototypeId ? { prototypeId } : {}),
      entries,
      latestEntryId: entries[0]?.id ?? null,
      ...(includeStates
        ? {
            rawEntries:
              artifactKind === 'PROTOTYPE'
                ? []
                : store.listArtifactHistory(
                    projectId,
                    artifactKind
                      ? { artifactKind: artifactKind as PersistedArtifactHistoryKind }
                      : undefined,
                  ),
          }
        : {}),
    });
  });

  app.post('/api/projects/:id/history/:artifactKind/undo', async (c) => {
    const projectId = c.req.param('id');
    const locale = resolveRouteLocale(c);
    const project = store.getProject(projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const rawKind = c.req.param('artifactKind');
    if (!isValidArtifactSurfaceKind(rawKind)) {
      return c.json(
        {
          error: `Unsupported artifact history kind: ${rawKind}`,
          code: 'INVALID_ARTIFACT_KIND',
        },
        400,
      );
    }

    const body = await c.req
      .json<{ expectedEntryId?: string; prototypeId?: string }>()
      .catch((): { expectedEntryId?: string; prototypeId?: string } => ({}));

    try {
      const result = store.undoLatestArtifactChange(
        projectId,
        rawKind,
        body.expectedEntryId || body.prototypeId
          ? {
              ...(body.expectedEntryId ? { expectedEntryId: body.expectedEntryId } : {}),
              ...(body.prototypeId ? { prototypeId: body.prototypeId } : {}),
            }
          : undefined,
      );
      const scopedProtoId = result.prototype?.id ?? body.prototypeId;
      return c.json({
        entry: result.entryView,
        undoneEntryId: result.undoneEntryId,
        entries: store.listArtifactHistoryViews(projectId, {
          artifactKind: rawKind,
          ...(rawKind === 'PROTOTYPE' && scopedProtoId ? { prototypeId: scopedProtoId } : {}),
        }),
        artifactHistory: store.listArtifactHistoryViews(projectId),
        project: store.getProject(projectId)!,
        requirementDocs: store.listRequirementDocs(projectId),
        prototypes: store.listPrototypes(projectId),
        confirmedPrototypeRevision: store.getConfirmedPrototypeRevision(projectId) ?? null,
        stepConfirmations: store.getProjectStepConfirmations(projectId),
        steps: deriveProjectStepsForStoreProject(store, projectId),
      });
    } catch (err) {
      if (err instanceof ArtifactHistoryConflictError) {
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

  app.post('/api/projects/:id/history/:artifactKind/:entryId/restore', (c) => {
    const projectId = c.req.param('id');
    const locale = resolveRouteLocale(c);
    const project = store.getProject(projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const rawKind = c.req.param('artifactKind');
    if (!isValidArtifactSurfaceKind(rawKind)) {
      return c.json(
        {
          error: `Unsupported artifact history kind: ${rawKind}`,
          code: 'INVALID_ARTIFACT_KIND',
        },
        400,
      );
    }
    const entryId = c.req.param('entryId');

    try {
      const result = store.restoreArtifactBeforeEntry(projectId, rawKind, entryId);
      const scopedProtoId = result.prototype?.id;
      return c.json({
        entry: result.entryView,
        restoredBeforeEntryId: result.restoredBeforeEntryId,
        entries: store.listArtifactHistoryViews(projectId, {
          artifactKind: rawKind,
          ...(rawKind === 'PROTOTYPE' && scopedProtoId ? { prototypeId: scopedProtoId } : {}),
        }),
        artifactHistory: store.listArtifactHistoryViews(projectId),
        project: store.getProject(projectId)!,
        requirementDocs: store.listRequirementDocs(projectId),
        prototypes: store.listPrototypes(projectId),
        confirmedPrototypeRevision: store.getConfirmedPrototypeRevision(projectId) ?? null,
        stepConfirmations: store.getProjectStepConfirmations(projectId),
        steps: deriveProjectStepsForStoreProject(store, projectId),
      });
    } catch (err) {
      if (err instanceof ArtifactHistoryNotFoundError) {
        return c.json({ error: err.message, code: err.code }, 404);
      }
      if (err instanceof ArtifactHistoryConflictError) {
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
}
