import type { Context, Hono } from 'hono';
import {
  ConnectionError,
  checkManifestAgainstModel,
  fingerprintManifest,
  type ConnectionClient,
  type ConnectionManifest,
  type FetchLike,
} from '../packages/application-runtime/index.js';
import type { ConnectedAppRecord, WorkspaceStore } from '../packages/workspace-store/index.js';
import {
  approveInvocation,
  clientFor,
  confirmedModel,
  declineInvocation,
  listInvocations,
  openConnection,
  prepareInvocation,
  reconcileInvocation,
  type GatewayDeps,
  type GatewayFailure,
} from '../packages/runtime-gateway/index.js';

/**
 * Connecting a project's Runnable System and serving the Operations Console (TeaCo spec v0.3.1
 * §11.1, §11.3). There is no credential: the console sends the chosen Acting Identity, the server
 * forwards it, and the application decides what that identity may see. Reads and approved actions
 * go through the runtime gateway, which reports a changed application or Business Model as Drifted.
 */
export interface ConnectedAppRouteOptions {
  /** Used to reach connected applications; tests pass an in-process application here. */
  readonly fetch?: FetchLike;
}

function errorBody(err: ConnectionError) {
  return { error: { code: err.code, message: err.message, problems: err.problems } };
}

function statusFor(err: ConnectionError): 422 | 502 {
  return err.code === 'INVALID_ADDRESS' || err.code === 'INVALID_MANIFEST' ? 422 : 502;
}

function failureResponse(c: Context, f: GatewayFailure) {
  return c.json(
    {
      error: { code: f.code, message: f.message, ...(f.code === 'DRIFTED' ? { reason: f.message } : {}) },
      ...(f.connectedApp ? { connectedApp: f.connectedApp } : {}),
      ...(f.invocation ? { invocation: f.invocation } : {}),
    },
    f.status,
  );
}

export function registerConnectedAppRoutes(app: Hono, store: WorkspaceStore, options: ConnectedAppRouteOptions = {}): void {
  const deps: GatewayDeps = { store, ...(options.fetch ? { fetch: options.fetch } : {}) };

  async function verify(projectId: string, baseUrl: string, connectedAt?: string): Promise<ConnectedAppRecord> {
    const client = clientFor(deps, baseUrl);
    const manifest = await client.readManifest();
    const previous = store.getConnectedApp(projectId);
    const model = confirmedModel(store, projectId);
    const now = new Date().toISOString();
    return store.saveConnectedApp({
      projectId,
      baseUrl: client.baseUrl,
      status: 'CONNECTED',
      driftReason: null,
      manifest: manifest as unknown as Record<string, unknown>,
      manifestFingerprint: await fingerprintManifest(manifest),
      modelHash: model?.hash ?? null,
      hints: checkManifestAgainstModel(manifest, model?.objects ?? null),
      connectedAt: connectedAt ?? now,
      checkedAt: now,
      // Keep the chosen identity while the application still declares it.
      actingIdentity: manifest.actors.some((a) => a.id === previous?.actingIdentity) ? previous!.actingIdentity! : null,
    });
  }

  app.get('/api/projects/:id/connected-app', (c) => {
    const projectId = c.req.param('id');
    if (!store.getProject(projectId)) return c.json({ error: 'Project not found' }, 404);
    return c.json({ connectedApp: store.getConnectedApp(projectId) ?? null });
  });

  app.post('/api/projects/:id/connected-app', async (c) => {
    const projectId = c.req.param('id');
    if (!store.getProject(projectId)) return c.json({ error: 'Project not found' }, 404);
    const body = await c.req.json<{ baseUrl?: string }>().catch(() => ({} as { baseUrl?: string }));
    if (!body.baseUrl?.trim()) return c.json({ error: { code: 'INVALID_ADDRESS', message: 'baseUrl is required', problems: [] } }, 422);
    try {
      return c.json({ connectedApp: await verify(projectId, body.baseUrl) }, 201);
    } catch (err) {
      if (err instanceof ConnectionError) return c.json(errorBody(err), statusFor(err));
      throw err;
    }
  });

  /** Re-check an application and accept what it now declares (the console's "重新核对"). */
  app.post('/api/projects/:id/connected-app/check', async (c) => {
    const projectId = c.req.param('id');
    const record = store.getConnectedApp(projectId);
    if (!record) return c.json({ error: { code: 'NOT_CONNECTED', message: 'This project has no connected application' } }, 404);
    try {
      return c.json({ connectedApp: await verify(projectId, record.baseUrl, record.connectedAt) });
    } catch (err) {
      if (err instanceof ConnectionError) return c.json(errorBody(err), statusFor(err));
      throw err;
    }
  });

  /** The console's identity switch; the AI Assistant acts as this identity (spec §8.1). */
  app.post('/api/projects/:id/connected-app/acting-identity', async (c) => {
    const projectId = c.req.param('id');
    const record = store.getConnectedApp(projectId);
    if (!record) return c.json({ error: { code: 'NOT_CONNECTED', message: 'This project has no connected application' } }, 404);
    const body = await c.req.json<{ actor?: string }>().catch(() => ({}) as { actor?: string });
    const actors = (record.manifest as { actors?: { id: string }[] }).actors ?? [];
    if (!body.actor || !actors.some((a) => a.id === body.actor)) {
      return c.json({ error: { code: 'UNKNOWN_ACTOR', message: `"${body.actor ?? ''}" is not an identity this application declares` } }, 400);
    }
    return c.json({ connectedApp: store.saveConnectedApp({ ...record, actingIdentity: body.actor }) });
  });

  app.delete('/api/projects/:id/connected-app', (c) => {
    const removed = store.deleteConnectedApp(c.req.param('id'));
    return c.json({ removed });
  });

  async function consoleRead(c: Context, read: (client: ConnectionClient, actor: string, manifest: ConnectionManifest) => Promise<unknown>) {
    const opened = await openConnection(deps, c.req.param('id')!, c.req.query('actor') || undefined);
    if (!opened.ok) return failureResponse(c, opened);
    try {
      return c.json({ actor: opened.value.actor, data: await read(opened.value.client, opened.value.actor, opened.value.manifest) });
    } catch (err) {
      if (err instanceof ConnectionError) return c.json(errorBody(err), err.code === 'NOT_FOUND' ? 404 : 502);
      throw err;
    }
  }

  app.get('/api/projects/:id/console/overview', (c) =>
    consoleRead(c, async (client, actor, manifest) => {
      const [metrics, dataIssues, activity] = await Promise.all([
        client.metrics(actor),
        manifest.dataIssues ? client.dataIssues(actor) : Promise.resolve(null),
        manifest.activity ? client.activity(actor) : Promise.resolve(null),
      ]);
      return { metrics, dataIssues, activity };
    }),
  );

  app.get('/api/projects/:id/console/objects/:objectId', (c) => {
    const limit = c.req.query('limit');
    const offset = c.req.query('offset');
    const filter = c.req.query('filter');
    return consoleRead(c, (client, actor) =>
      client.listObjects(c.req.param('objectId'), actor, {
        ...(filter ? { filter } : {}),
        ...(limit ? { limit: Number(limit) } : {}),
        ...(offset ? { offset: Number(offset) } : {}),
      }),
    );
  });

  app.get('/api/projects/:id/console/objects/:objectId/:key', (c) =>
    consoleRead(c, (client, actor) => client.getObject(c.req.param('objectId'), c.req.param('key'), actor)),
  );

  app.get('/api/projects/:id/console/reports/:reportId', (c) =>
    consoleRead(c, (client, actor) => client.report(c.req.param('reportId'), actor)),
  );

  // ─── Approved runtime changes (spec §10.1, ADR 0020) ───

  app.get('/api/projects/:id/console/invocations', (c) => c.json({ invocations: listInvocations(deps, c.req.param('id')) }));

  app.post('/api/projects/:id/console/actions/:actionId/prepare', async (c) => {
    const body = await c.req
      .json<{ actor?: string; target?: string; params?: Record<string, unknown> }>()
      .catch(() => ({}) as { actor?: string; target?: string; params?: Record<string, unknown> });
    const result = await prepareInvocation(deps, c.req.param('id'), {
      actionId: c.req.param('actionId'), actor: body.actor, target: body.target, params: body.params, requestedBy: 'user',
    });
    return result.ok ? c.json({ invocation: result.value }, 201) : failureResponse(c, result);
  });

  app.post('/api/projects/:id/console/invocations/:invId/approve', async (c) => {
    const result = await approveInvocation(deps, c.req.param('id'), c.req.param('invId'));
    return result.ok ? c.json({ invocation: result.value }) : failureResponse(c, result);
  });

  app.post('/api/projects/:id/console/invocations/:invId/decline', (c) => {
    const result = declineInvocation(deps, c.req.param('id'), c.req.param('invId'));
    return result.ok ? c.json({ invocation: result.value }) : failureResponse(c, result);
  });

  app.post('/api/projects/:id/console/invocations/:invId/reconcile', async (c) => {
    const result = await reconcileInvocation(deps, c.req.param('id'), c.req.param('invId'));
    return result.ok ? c.json({ invocation: result.value }) : failureResponse(c, result);
  });
}
