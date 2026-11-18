import type { Hono } from 'hono';
import type { WorkspaceStore } from '../packages/workspace-store/index.js';

/**
 * Read-only access to Context Snapshots (ADR 0017). Every route is scoped by project: a session,
 * Model Call, or context event that belongs to another project answers 404.
 */
export function registerContextSnapshotRoutes(app: Hono, store: WorkspaceStore): void {
  app.get('/api/projects/:projectId/agent-sessions/:sessionId/model-calls', (c) => {
    const projectId = c.req.param('projectId');
    const session = store.getAgentSession(c.req.param('sessionId'));
    if (!session || session.projectId !== projectId) {
      return c.json({ error: 'Agent session not found' }, 404);
    }
    return c.json({
      modelCalls: store.listModelCalls(projectId, session.id),
      contextEvents: store.listContextEvents(projectId, session.id),
    });
  });

  app.get('/api/projects/:projectId/model-calls/:callId', (c) => {
    const modelCall = store.getModelCall(c.req.param('projectId'), c.req.param('callId'));
    if (!modelCall) return c.json({ error: 'Model call not found' }, 404);
    return c.json({ modelCall });
  });

  app.get('/api/projects/:projectId/context-events/:eventId', (c) => {
    const contextEvent = store.getContextEvent(c.req.param('projectId'), c.req.param('eventId'));
    if (!contextEvent) return c.json({ error: 'Context event not found' }, 404);
    return c.json({ contextEvent });
  });
}
