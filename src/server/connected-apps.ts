import type { Context, Hono } from 'hono';
import {
  ConnectionError,
  checkManifestAgainstModel,
  createConnectionClient,
  fingerprintManifest,
  type ConnectionClient,
  type ConnectionManifest,
  type FetchLike,
} from '../packages/application-runtime/index.js';
import type { ConnectedAppRecord, WorkspaceStore } from '../packages/workspace-store/index.js';

/**
 * Connecting a project's Runnable System and serving the Operations Console (TeaCo spec v0.3.1
 * §11.1, §11.3). There is no credential: the console sends the chosen Acting Identity, the server
 * forwards it, and the application decides what that identity may see. Every console read first
 * re-reads the Connection Manifest, so a changed application or a re-confirmed Business Model is
 * reported as Drifted instead of being shown with stale meaning.
 */
export interface ConnectedAppRouteOptions {
  /** Used to reach connected applications; tests pass an in-process application here. */
  readonly fetch?: FetchLike;
}

interface ConfirmedModel {
  readonly hash: string;
  readonly objects: { id: string; name: string; alias: string }[];
}

function confirmedModel(store: WorkspaceStore, projectId: string): ConfirmedModel | null {
  const confirmation = store.getProjectStepConfirmations(projectId).businessModel;
  if (!confirmation) return null;
  const suite = confirmation.suiteSnapshot ?? confirmation.suite;
  return {
    hash: confirmation.suiteHash,
    objects: (suite.M1?.aggregates ?? []).map((a) => ({ id: a.id, name: a.name, alias: a.alias })),
  };
}

function errorBody(err: ConnectionError) {
  return { error: { code: err.code, message: err.message, problems: err.problems } };
}

function statusFor(err: ConnectionError): 422 | 502 {
  return err.code === 'INVALID_ADDRESS' || err.code === 'INVALID_MANIFEST' ? 422 : 502;
}

export function registerConnectedAppRoutes(app: Hono, store: WorkspaceStore, options: ConnectedAppRouteOptions = {}): void {
  const clientFor = (baseUrl: string): ConnectionClient => createConnectionClient({ baseUrl, ...(options.fetch ? { fetch: options.fetch } : {}) });

  async function verify(projectId: string, baseUrl: string, connectedAt?: string): Promise<ConnectedAppRecord> {
    const client = clientFor(baseUrl);
    const manifest = await client.readManifest();
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

  app.delete('/api/projects/:id/connected-app', (c) => {
    const removed = store.deleteConnectedApp(c.req.param('id'));
    return c.json({ removed });
  });

  /**
   * Opens a console read: re-reads the manifest, marks drift, resolves the Acting Identity.
   * Returns either a ready client or the response to send.
   */
  async function openConsole(c: Context) {
    const projectId = c.req.param('id')!;
    const record = store.getConnectedApp(projectId);
    if (!record) return { response: c.json({ error: { code: 'NOT_CONNECTED', message: 'This project has no connected application' } }, 404) };
    if (record.status === 'DRIFTED') return { response: c.json({ error: { code: 'DRIFTED', reason: record.driftReason }, connectedApp: record }, 409) };
    const client = clientFor(record.baseUrl);
    let manifest: ConnectionManifest;
    try {
      manifest = await client.readManifest();
    } catch (err) {
      if (err instanceof ConnectionError) return { response: c.json({ ...errorBody(err), connectedApp: record }, 502) };
      throw err;
    }
    const model = confirmedModel(store, projectId);
    const reason = (await fingerprintManifest(manifest)) !== record.manifestFingerprint
      ? 'MANIFEST_CHANGED'
      : (model?.hash ?? null) !== record.modelHash
        ? 'MODEL_CHANGED'
        : null;
    if (reason) {
      const drifted = store.saveConnectedApp({ ...record, status: 'DRIFTED', driftReason: reason, checkedAt: new Date().toISOString() });
      return { response: c.json({ error: { code: 'DRIFTED', reason }, connectedApp: drifted }, 409) };
    }
    const requested = c.req.query('actor');
    const actor = requested ? manifest.actors.find((a) => a.id === requested) : manifest.actors[0];
    if (!actor) return { response: c.json({ error: { code: 'UNKNOWN_ACTOR', message: `"${requested}" is not an identity this application declares` } }, 400) };
    return { client, manifest, actor: actor.id, record };
  }

  async function consoleRead(c: Context, read: (client: ConnectionClient, actor: string, manifest: ConnectionManifest) => Promise<unknown>) {
    const opened = await openConsole(c);
    if ('response' in opened) return opened.response;
    try {
      return c.json({ actor: opened.actor, data: await read(opened.client, opened.actor, opened.manifest) });
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
}
