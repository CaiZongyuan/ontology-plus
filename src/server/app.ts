import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  exportToOwl,
  parseModelYaml,
  type ModelCode,
  type OntologySuite,
} from '../packages/ontology-core/index.js';
import {
  PrototypeConfirmedDeleteError,
  createWorkspaceStore,
  type AgentSessionKind,
  type AnalyticsScenario,
  type AppendPrototypeRevisionInput,
  type CreatePrototypeInput,
  type CrossSystemFlow,
  type DataDocument,
  type DataMappingRule,
  type DatabaseResource,
  type DesignBrief,
  type GeneratedSkill,
  type LegacySystemConfig,
  type LlmProviderConfig,
  type McpServerConfig,
  type MetricDefinition,
  type WorkspaceStore,
  type WritebackInterface,
} from '../packages/workspace-store/index.js';
import {
  LlmGatewayError,
  SSE_RESPONSE_HEADERS,
  abortActiveAgentSession,
  abortActiveAgentSessionAsync,
  attachUnifiedAgentSessionLiveStream,
  buildTurnSseEvents,
  cancelServerPipelineTask,
  compactAgentSessionWithLlm,
  createPipelineTaskSseStream,
  createSseEventStream,
  createUnifiedSseStream,
  dismissServerPipelineTask,
  ensurePrototypeCoDesignSession,
  generatePrototypeFromDoc,
  getLiveAgentSessionStatus,
  getServerPipelineTask,
  listServerPipelineTasks,
  markServerPipelineTaskRead,
  normalizeAgentLocale,
  resumeServerPipelineTask,
  runAppCodingAgentTurn,
  runCapabilitySmartChatTurn,
  runDataOntologyReasoning,
  runRequirementGrillingTurn,
  runSmartOntologyExtractionJob,
  runUnifiedAgentSessionStream,
  startServerPipelineTask,
  testLlmGatewayConnection,
  type AgentLocale,
  type PipelineTaskKind,
  type TransientTurnImageInput,
} from '../packages/agent-runtime/index.js';
import {
  buildMcpClientConfigJson,
  compileDevelopmentPackage,
  compileDevelopmentPackageZip,
  compileOntologySkill,
  handleOntologyMcpRequest,
  inspectOntologyMcpCapabilities,
  type JsonRpcRequest,
} from '../packages/package-compiler/index.js';
import { handleInspoProxyRequest, type InspoProxyRequestBody } from './inspo-proxy.js';

export function createApiApp(customStore?: WorkspaceStore): Hono {
  const store = customStore ?? createWorkspaceStore();
  const app = new Hono();

  // Baseline security headers (nosniff, clickjacking & referrer protection)
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'SAMEORIGIN');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  });

  app.use('/api/*', cors());

  const getReqLocale = (
    c: { req: { header: (name: string) => string | undefined } },
    body?: { locale?: string },
  ): AgentLocale | undefined =>
    normalizeAgentLocale(body?.locale ?? c.req.header('x-onto-locale') ?? undefined);

  app.onError((err, c) => {
    const reqLocale = getReqLocale(c);
    if (err instanceof LlmGatewayError) {
      return c.json(
        {
          error: err.message,
          diagnostic: err.toDiagnostic(reqLocale),
        },
        503,
      );
    }
    const errCode = (err as { code?: string } | null)?.code;
    const msg = err instanceof Error ? err.message : String(err);
    if (errCode === 'ALREADY_MERGED' || msg.includes('already merged')) {
      return c.json({ error: msg, code: 'ALREADY_MERGED' }, 409);
    }
    if (errCode === 'NOTHING_ACCEPTED' || msg.includes('No accepted candidates')) {
      return c.json({ error: msg, code: 'NOTHING_ACCEPTED' }, 400);
    }
    if (
      msg.includes('Cannot delete') ||
      msg.includes('referenced by') ||
      msg.includes('at least one Ontology Project')
    ) {
      return c.json({ error: msg, code: 'REFERENCE_CONFLICT' }, 409);
    }
    if (msg.includes('not found')) {
      return c.json({ error: msg }, 404);
    }
    return c.json({ error: msg }, 500);
  });

  app.get('/api/health', (c) => {
    return c.json({ ok: true, service: 'ontology-plus', version: '5.1.0' });
  });

  app.get('/api/bootstrap', (c) => {
    const projects = store.listProjects();
    const requestedProjectId = c.req.query('projectId') || projects[0]?.id || 'proj-contract';
    const activeProject =
      store.getProject(requestedProjectId) ?? store.getProject(projects[0]!.id)!;

    return c.json({
      projects,
      activeProject,
      projectSnapshots: store.listProjectSnapshots(activeProject.id),
      agentSessions: store.listAgentSessions(),
      requirementSessions: store.listRequirementSessions(activeProject.id),
      requirementDocs: store.listRequirementDocs(activeProject.id),
      prototypes: store.listPrototypes(activeProject.id),
      confirmedPrototypeRevision: store.getConfirmedPrototypeRevision(activeProject.id) ?? null,
      fourLayerAssets: store.listFourLayerAssets(),
      assembledApplications: store.listAssembledApplications(),
      generatedSkills: store.listGeneratedSkills(),
      legacySystems: store.listLegacySystems(),
      extractionJobs: store.listExtractionJobs(),
      mcpServers: store.listMcpServers(),
      capabilityAgents: store.listCapabilityAgents(),
      capabilityChatSessions: store.listCapabilityChatSessions(),
      crossSystemFlows: store.listCrossSystemFlows(),
      knowledgeEntries: store.listKnowledgeEntries(),
      databaseResources: store.listDatabaseResources(),
      dataDocuments: store.listDataDocuments(),
      dataMappings: store.listDataMappings(),
      metrics: store.listMetrics(),
      analyticsScenarios: store.listAnalyticsScenarios(),
      analyticsReports: store.listAnalyticsReports(),
      reasoningSessions: store.listReasoningSessions(),
      writebackInterfaces: store.listWritebackInterfaces(),
      llmProviders: store.listLlmProviders(),
      systemSettings: store.getSystemSettings(),
      pipelineTasks: listServerPipelineTasks(store),
    });
  });

  // ─── Durable Background Pipeline Tasks (Detached from HTTP socket) ─────────

  app.get('/api/pipeline-tasks', (c) => {
    const projectId = c.req.query('projectId') || undefined;
    return c.json({ pipelineTasks: listServerPipelineTasks(store, projectId) });
  });

  app.get('/api/pipeline-tasks/:taskId', (c) => {
    const task = getServerPipelineTask(store, c.req.param('taskId'));
    if (!task) return c.json({ error: 'Pipeline task not found' }, 404);
    return c.json({ task });
  });

  app.post('/api/pipeline-tasks', async (c) => {
    const body = await c.req.json<{
      kind: PipelineTaskKind;
      projectId: string;
      sessionId?: string;
      docId?: string;
      prototypeId?: string;
      prompt?: string;
      title?: string;
      version?: string;
      locale?: string;
    }>();
    if (body.kind !== 'PROTOTYPE_GEN') {
      return c.json(
        {
          error: `Unsupported pipeline task kind "${String(body.kind)}". Use unified Agent Session runs instead.`,
        },
        400,
      );
    }
    const locale = getReqLocale(c, body);
    const { task, reusedRunning } = startServerPipelineTask(store, {
      kind: body.kind,
      projectId: body.projectId,
      ...(body.sessionId ? { sessionId: body.sessionId } : {}),
      ...(body.docId ? { docId: body.docId } : {}),
      ...(body.prototypeId ? { prototypeId: body.prototypeId } : {}),
      ...(body.prompt ? { prompt: body.prompt } : {}),
      ...(body.title ? { title: body.title } : {}),
      ...(body.version ? { version: body.version } : {}),
      ...(locale ? { locale } : {}),
    });
    return c.json({
      task,
      reusedRunning,
      pipelineTasks: listServerPipelineTasks(store),
    });
  });

  app.get('/api/pipeline-tasks/:taskId/stream', (c) => {
    const taskId = c.req.param('taskId');
    const stream = createPipelineTaskSseStream(store, taskId, c.req.raw.signal);
    return new Response(stream, {
      headers: SSE_RESPONSE_HEADERS,
    });
  });

  app.post('/api/pipeline-tasks/:taskId/cancel', (c) => {
    const task = cancelServerPipelineTask(store, c.req.param('taskId'));
    if (!task) return c.json({ error: 'Pipeline task not found' }, 404);
    return c.json({ task, pipelineTasks: listServerPipelineTasks(store) });
  });

  app.post('/api/pipeline-tasks/:taskId/dismiss', (c) => {
    const task = dismissServerPipelineTask(store, c.req.param('taskId'));
    if (!task) return c.json({ error: 'Pipeline task not found' }, 404);
    return c.json({ task, pipelineTasks: listServerPipelineTasks(store) });
  });

  app.post('/api/pipeline-tasks/:taskId/read', (c) => {
    const task = markServerPipelineTaskRead(store, c.req.param('taskId'));
    if (!task) return c.json({ error: 'Pipeline task not found' }, 404);
    return c.json({ task, pipelineTasks: listServerPipelineTasks(store) });
  });

  app.post('/api/pipeline-tasks/:taskId/resume', async (c) => {
    const body = await c.req
      .json<{ locale?: string }>()
      .catch(() => ({ locale: undefined }));
    const locale = getReqLocale(c, body);
    const resumed = resumeServerPipelineTask(store, c.req.param('taskId'), locale);
    if (!resumed) return c.json({ error: 'Pipeline task not found' }, 404);
    return c.json({
      task: resumed.task,
      reusedRunning: resumed.reusedRunning,
      pipelineTasks: listServerPipelineTasks(store),
    });
  });

  // ─── Unified Agent Sessions & Live SSE Streaming ───────────────────────────

  app.get('/api/agent-sessions', (c) => {
    const projectId = c.req.query('projectId') || undefined;
    const agentKind = (c.req.query('agentKind') as AgentSessionKind | undefined) || undefined;
    const targetId = c.req.query('targetId') || undefined;
    const agentSessions = store.listAgentSessions({
      ...(projectId ? { projectId } : {}),
      ...(agentKind ? { agentKind } : {}),
      ...(targetId ? { targetId } : {}),
    });
    return c.json({ agentSessions });
  });

  app.post('/api/agent-sessions', async (c) => {
    const body = await c.req.json<{
      id?: string;
      projectId: string;
      agentKind: AgentSessionKind;
      targetId?: string;
      title?: string;
      providerId?: string;
      modelOverride?: string;
      reasoningMode?: 'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY';
    }>();
    const session = store.createAgentSession(body);
    return c.json({
      session,
      agentSessions: store.listAgentSessions(),
    });
  });

  app.patch('/api/agent-sessions/:id', async (c) => {
    const id = c.req.param('id');
    const existing = store.getAgentSession(id);
    if (!existing) return c.json({ error: 'Agent session not found' }, 404);
    const body = await c.req.json<{
      title?: string;
      pinned?: boolean;
      providerId?: string;
      modelOverride?: string;
      reasoningMode?: 'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY';
      clearMessages?: boolean;
    }>();
    const updated = store.saveAgentSession({
      ...existing,
      ...(body.title !== undefined ? { title: body.title.trim() || existing.title } : {}),
      ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
      ...(body.providerId !== undefined ? { providerId: body.providerId } : {}),
      ...(body.modelOverride !== undefined ? { modelOverride: body.modelOverride } : {}),
      ...(body.reasoningMode !== undefined ? { reasoningMode: body.reasoningMode } : {}),
      ...(body.clearMessages
        ? { messages: [], compactedSummary: undefined, status: 'IDLE' as const }
        : {}),
      updatedAt: new Date().toISOString(),
    });
    return c.json({
      session: updated,
      agentSessions: store.listAgentSessions(),
    });
  });

  app.delete('/api/agent-sessions/:id', (c) => {
    const id = c.req.param('id');
    abortActiveAgentSession(id, 'USER_ABORT', store);
    store.deleteAgentSession(id);
    return c.json({
      deletedId: id,
      agentSessions: store.listAgentSessions(),
    });
  });

  app.post('/api/agent-sessions/:id/fork', async (c) => {
    const id = c.req.param('id');
    const body = await c.req
      .json<{ fromMessageId?: string; title?: string }>()
      .catch(() => ({ fromMessageId: undefined, title: undefined }));
    const session = store.forkAgentSession(id, body.fromMessageId, body.title);
    return c.json({
      session,
      agentSessions: store.listAgentSessions(),
    });
  });

  app.post('/api/agent-sessions/:id/abort', async (c) => {
    const id = c.req.param('id');
    const { aborted, session } = await abortActiveAgentSessionAsync(store, id);
    return c.json({
      aborted,
      session,
      agentSessions: store.listAgentSessions(),
    });
  });

  app.get('/api/agent-sessions/:id/live', (c) => {
    const id = c.req.param('id');
    const existing = store.getAgentSession(id);
    if (!existing) return c.json({ error: 'Agent session not found' }, 404);
    const afterEventId =
      c.req.query('afterEventId') || c.req.header('Last-Event-ID') || undefined;
    const generator = attachUnifiedAgentSessionLiveStream(store, id, {
      ...(afterEventId ? { afterEventId } : {}),
      signal: c.req.raw.signal,
    });
    return new Response(createUnifiedSseStream(generator), {
      headers: SSE_RESPONSE_HEADERS,
    });
  });

  app.get('/api/agent-sessions/:id/status', (c) => {
    const id = c.req.param('id');
    const existing = store.getAgentSession(id);
    if (!existing) return c.json({ error: 'Agent session not found' }, 404);
    return c.json({
      session: existing,
      live: getLiveAgentSessionStatus(store, id),
    });
  });

  app.post('/api/agent-sessions/:id/compact', async (c) => {
    const id = c.req.param('id');
    const locale = getReqLocale(c);
    const session = await compactAgentSessionWithLlm(store, id, locale);
    return c.json({
      session,
      agentSessions: store.listAgentSessions(),
    });
  });

  app.post('/api/agent-sessions/:id/stream', async (c) => {
    const id = c.req.param('id');
    const existing = store.getAgentSession(id);
    if (!existing) return c.json({ error: 'Agent session not found' }, 404);
    const body = await c.req
      .json<{
        prompt?: string;
        mode?: 'PROMPT' | 'STEER' | 'FOLLOW_UP' | 'CONTINUE';
        askUserAnswer?: {
          promptId: string;
          selectedAnswers: string[];
          freeformText?: string;
        };
        images?: TransientTurnImageInput[];
        activeModelCode?: ModelCode;
        reasoningMode?: 'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY';
        mockMode?: boolean;
        locale?: string;
      }>()
      .catch(() => ({} as { locale?: string }));
    const locale = getReqLocale(c, body);

    const generator = runUnifiedAgentSessionStream(store, {
      sessionId: id,
      ...body,
      ...(locale ? { locale } : {}),
      signal: c.req.raw.signal,
    });

    return new Response(createUnifiedSseStream(generator), {
      headers: SSE_RESPONSE_HEADERS,
    });
  });

  // ─── Projects & 11-Model Ontology Suite ─────────────────────────────────────

  app.get('/api/projects', (c) => {
    return c.json({ projects: store.listProjects() });
  });

  app.post('/api/projects', async (c) => {
    const body = await c.req.json<{
      name: string;
      code: string;
      center?: 'APPLICATION' | 'CAPABILITY' | 'ANALYTICS';
      domain: string;
      description?: string;
      template?: 'CONTRACT' | 'MFT' | 'EMPTY';
    }>();
    const project = store.createProject(body);
    return c.json({ project, projects: store.listProjects() });
  });

  app.get('/api/projects/:id', (c) => {
    const project = store.getProject(c.req.param('id'));
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json({
      project,
      projectSnapshots: store.listProjectSnapshots(project.id),
      agentSessions: store.listAgentSessions({ projectId: project.id }),
      requirementSessions: store.listRequirementSessions(project.id),
      requirementDocs: store.listRequirementDocs(project.id),
      prototypes: store.listPrototypes(project.id),
      confirmedPrototypeRevision: store.getConfirmedPrototypeRevision(project.id) ?? null,
      extractionJobs: store.listExtractionJobs(project.id),
      pipelineTasks: listServerPipelineTasks(store),
    });
  });

  app.patch('/api/projects/:id', async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req.json<{
      name?: string;
      code?: string;
      center?: 'APPLICATION' | 'CAPABILITY' | 'ANALYTICS';
      domain?: string;
      description?: string;
    }>();
    const project = store.updateProjectMeta(projectId, body);
    return c.json({ project, projects: store.listProjects() });
  });

  app.post('/api/projects/:id/clone', async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req
      .json<{ name?: string; code?: string }>()
      .catch(() => ({ name: undefined, code: undefined }));
    const project = store.cloneProject(projectId, body);
    return c.json({ project, projects: store.listProjects() });
  });

  app.delete('/api/projects/:id', (c) => {
    const projectId = c.req.param('id');
    const force = c.req.query('force') === '1' || c.req.query('force') === 'true';
    const result = store.deleteProject(projectId, force);
    return c.json({
      ...result,
      projects: store.listProjects(),
      assembledApplications: store.listAssembledApplications(),
    });
  });

  app.get('/api/projects/:id/snapshots', (c) => {
    const projectId = c.req.param('id');
    return c.json({ snapshots: store.listProjectSnapshots(projectId) });
  });

  app.post('/api/projects/:id/snapshots', async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req.json<{ label: string; note?: string }>();
    const snapshot = store.createProjectSnapshot(projectId, body);
    return c.json({
      snapshot,
      snapshots: store.listProjectSnapshots(projectId),
    });
  });

  app.post('/api/projects/:id/snapshots/:snapId/restore', (c) => {
    const projectId = c.req.param('id');
    const snapId = c.req.param('snapId');
    const project = store.restoreProjectSnapshot(projectId, snapId);
    return c.json({
      project,
      projects: store.listProjects(),
      snapshots: store.listProjectSnapshots(projectId),
    });
  });

  app.delete('/api/projects/:id/snapshots/:snapId', (c) => {
    const projectId = c.req.param('id');
    const snapId = c.req.param('snapId');
    store.deleteProjectSnapshot(snapId);
    return c.json({
      snapshots: store.listProjectSnapshots(projectId),
    });
  });

  app.put('/api/projects/:id/models/:modelCode', async (c) => {
    const projectId = c.req.param('id');
    const modelCode = c.req.param('modelCode') as ModelCode;
    const body = await c.req.json<{ yamlText?: string; modelData?: unknown }>();
    try {
      const parsed = body.yamlText
        ? parseModelYaml(modelCode, body.yamlText)
        : (body.modelData as NonNullable<OntologySuite[typeof modelCode]>);
      const project = store.updateModel(projectId, modelCode, parsed);
      return c.json({ project });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.put('/api/projects/:id/suite', async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req.json<{ suite: OntologySuite; changelogNote?: string }>();
    const project = store.updateSuite(projectId, body.suite, body.changelogNote);
    return c.json({ project });
  });

  app.get('/api/projects/:id/yaml/export', (c) => {
    const projectId = c.req.param('id');
    const files = store.exportYamlFiles(projectId);
    const manifestJson = store.exportManifestJson(projectId);
    return c.json({ files, manifestJson });
  });

  app.post('/api/projects/:id/yaml/import', async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req.json<{ files: Record<string, string> }>();
    const result = store.importYamlFiles(projectId, body.files);
    return c.json(result);
  });

  app.get('/api/projects/:id/owl', (c) => {
    const project = store.getProject(c.req.param('id'));
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const owlXml = exportToOwl(project.suite);
    return c.json({ owlXml, fileName: `${project.code.toLowerCase()}-ontology.owl` });
  });

  app.post('/api/projects/:id/impact', async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req.json<{ targetId: string }>();
    const impact = store.analyzeSymbolImpact(projectId, body.targetId);
    return c.json({ impact });
  });

  app.post('/api/projects/:id/rename', async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req.json<{ oldId: string; newId: string }>();
    const result = store.renameSymbol(projectId, body.oldId, body.newId);
    return c.json(result);
  });

  app.post('/api/projects/:id/generate-skill', (c) => {
    const project = store.getProject(c.req.param('id'));
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const compiled = compileOntologySkill(project);
    const saved = store.saveGeneratedSkill({ ...compiled, isCustomRefined: false });
    return c.json({ skill: saved, skills: store.listGeneratedSkills() });
  });

  app.put('/api/skills/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<Omit<GeneratedSkill, 'updatedAt'>>();
    const saved = store.saveGeneratedSkill({
      ...body,
      id,
      isCustomRefined: body.isCustomRefined ?? true,
    });
    return c.json({ skill: saved, skills: store.listGeneratedSkills() });
  });

  app.delete('/api/skills/:id', (c) => {
    const id = c.req.param('id');
    const force = c.req.query('force') === '1' || c.req.query('force') === 'true';
    store.deleteGeneratedSkill(id, force);
    return c.json({ deletedId: id, skills: store.listGeneratedSkills() });
  });

  app.post('/api/projects/:id/publish-mcp', (c) => {
    const project = store.getProject(c.req.param('id'));
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const caps = inspectOntologyMcpCapabilities(project);
    const mcp = store.saveMcpServer({
      id: `mcp-${project.id}`,
      projectId: project.id,
      name: `${project.name} MCP Server`,
      endpoint: `/api/mcp/${project.id}`,
      transport: 'HTTP_JSON_RPC',
      status: 'ONLINE',
      toolsCount: caps.tools.length,
      resourcesCount: caps.resources.length,
    });
    return c.json({ mcp, mcpServers: store.listMcpServers(), capabilities: caps });
  });

  app.post('/api/mcp-servers', async (c) => {
    const body = await c.req.json<Omit<McpServerConfig, 'updatedAt'>>();
    const mcp = store.saveMcpServer(body);
    return c.json({ mcp, mcpServers: store.listMcpServers() });
  });

  app.delete('/api/mcp-servers/:id', (c) => {
    const id = c.req.param('id');
    const force = c.req.query('force') === '1' || c.req.query('force') === 'true';
    store.deleteMcpServer(id, force);
    return c.json({ deletedId: id, mcpServers: store.listMcpServers() });
  });

  // ─── Application Center Routes ──────────────────────────────────────────────

  app.post('/api/requirements/sessions', async (c) => {
    const body = await c.req.json<{
      projectId: string;
      title: string;
      initialPrompt?: string;
    }>();
    const session = store.createRequirementSession(body);
    return c.json({
      session,
      requirementSessions: store.listRequirementSessions(body.projectId),
    });
  });

  app.delete('/api/requirements/sessions/:id', (c) => {
    const id = c.req.param('id');
    const projectId = c.req.query('projectId') || store.listProjects()[0]?.id || 'proj-contract';
    store.deleteRequirementSession(id);
    return c.json({
      deletedId: id,
      requirementSessions: store.listRequirementSessions(projectId),
    });
  });

  app.post('/api/requirements/:sessionId/grill', async (c) => {
    const sessionId = c.req.param('sessionId');
    const body = await c.req.json<{ userMessage: string; locale?: string }>();
    const locale = getReqLocale(c, body);
    const result = await runRequirementGrillingTurn(store, {
      sessionId,
      userMessage: body.userMessage,
      ...(locale ? { locale } : {}),
    });
    return c.json({
      ...result,
      requirementSessions: store.listRequirementSessions(result.session.projectId),
    });
  });

  app.post('/api/requirements/docs', async (c) => {
    const body = await c.req.json<{
      id: string;
      projectId: string;
      title: string;
      version: string;
      status: 'DRAFT' | 'CONFIRMED' | 'PUBLISHED';
      content: string;
    }>();
    const doc = store.saveRequirementDoc(body);
    return c.json({ doc, docs: store.listRequirementDocs(body.projectId) });
  });

  app.post('/api/requirements/docs/:id/clone', (c) => {
    const id = c.req.param('id');
    const doc = store.cloneRequirementDoc(id);
    return c.json({ doc, docs: store.listRequirementDocs(doc.projectId) });
  });

  app.delete('/api/requirements/docs/:id', (c) => {
    const id = c.req.param('id');
    const projectId = c.req.query('projectId') || store.listProjects()[0]?.id || 'proj-contract';
    store.deleteRequirementDoc(id);
    return c.json({
      deletedId: id,
      docs: store.listRequirementDocs(projectId),
    });
  });

  app.get('/api/projects/:id/prototypes', (c) => {
    const projectId = c.req.param('id');
    const project = store.getProject(projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json({
      prototypes: store.listPrototypes(projectId),
      confirmedRevision: store.getConfirmedPrototypeRevision(projectId) ?? null,
    });
  });

  app.post('/api/projects/:id/prototypes', async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req.json<CreatePrototypeInput & { syncMu?: boolean }>();
    if (body.id) {
      const existing = store.getPrototype(body.id);
      if (existing && existing.projectId === projectId) {
        const appended = store.appendPrototypeRevision(body.id, {
          name: body.name,
          version: body.version,
          title: body.title,
          instruction: body.instruction,
          starred: body.starred,
          htmlContent: body.htmlContent,
          source: body.source ?? 'MANUAL_SAVE',
          agentRunId: body.agentRunId,
        });
        return c.json({
          ...appended,
          prototypes: store.listPrototypes(projectId),
          confirmedRevision: store.getConfirmedPrototypeRevision(projectId) ?? null,
        });
      }
    }
    const created = store.createPrototype(projectId, {
      ...body,
      source: body.source ?? 'MANUAL_SAVE',
    });
    return c.json({
      ...created,
      prototypes: store.listPrototypes(projectId),
      confirmedRevision: store.getConfirmedPrototypeRevision(projectId) ?? null,
    });
  });

  app.post('/api/prototypes/:id/revisions', async (c) => {
    const prototypeId = c.req.param('id');
    const existing = store.getPrototype(prototypeId);
    if (!existing) return c.json({ error: 'Prototype not found' }, 404);
    const body = await c.req.json<AppendPrototypeRevisionInput>();
    const appended = store.appendPrototypeRevision(prototypeId, body);
    return c.json({
      ...appended,
      prototypes: store.listPrototypes(existing.projectId),
      confirmedRevision: store.getConfirmedPrototypeRevision(existing.projectId) ?? null,
    });
  });

  app.post('/api/prototypes/:id/revisions/:revisionId/restore', async (c) => {
    const prototypeId = c.req.param('id');
    const revisionId = c.req.param('revisionId');
    const existing = store.getPrototype(prototypeId);
    if (!existing) return c.json({ error: 'Prototype not found' }, 404);
    const body = await c.req
      .json<{ title?: string }>()
      .catch(() => ({ title: undefined }));
    try {
      const restored = store.restorePrototypeRevision(prototypeId, revisionId, body.title);
      return c.json({
        ...restored,
        prototypes: store.listPrototypes(existing.projectId),
        confirmedRevision: store.getConfirmedPrototypeRevision(existing.projectId) ?? null,
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 404);
    }
  });

  app.patch('/api/prototypes/:id/revisions/:revisionId', async (c) => {
    const prototypeId = c.req.param('id');
    const revisionId = c.req.param('revisionId');
    const existing = store.getPrototype(prototypeId);
    if (!existing) return c.json({ error: 'Prototype not found' }, 404);
    const body = await c.req.json<{ title?: string; starred?: boolean }>();
    try {
      const updated = store.updatePrototypeRevisionMeta(prototypeId, revisionId, body);
      return c.json({
        ...updated,
        prototypes: store.listPrototypes(existing.projectId),
        confirmedRevision: store.getConfirmedPrototypeRevision(existing.projectId) ?? null,
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 404);
    }
  });

  app.patch('/api/prototypes/:id/design-brief', async (c) => {
    const prototypeId = c.req.param('id');
    const existing = store.getPrototype(prototypeId);
    if (!existing) return c.json({ error: 'Prototype not found' }, 404);
    const body = await c.req.json<{ designBrief: DesignBrief }>();
    const prototype = store.updatePrototypeDesignBrief(prototypeId, body.designBrief);
    return c.json({
      prototype,
      prototypes: store.listPrototypes(existing.projectId),
      confirmedRevision: store.getConfirmedPrototypeRevision(existing.projectId) ?? null,
    });
  });

  app.post('/api/projects/:id/prototypes/confirm-revision', async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req.json<{ revisionId: string }>();
    if (!body.revisionId) {
      return c.json({ error: 'revisionId is required' }, 400);
    }
    try {
      const res = store.confirmPrototypeRevision(projectId, body.revisionId);
      return c.json({
        confirmed: res.confirmed,
        confirmedRevision: res.confirmed,
        prototype: res.prototype,
        project: res.project,
        prototypes: store.listPrototypes(projectId),
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 404);
    }
  });

  app.post('/api/prototypes/:id/revisions/:revisionId/confirm', (c) => {
    const prototypeId = c.req.param('id');
    const revisionId = c.req.param('revisionId');
    const existing = store.getPrototype(prototypeId);
    if (!existing) return c.json({ error: 'Prototype not found' }, 404);
    try {
      const res = store.confirmPrototypeRevision(existing.projectId, revisionId);
      return c.json({
        confirmed: res.confirmed,
        confirmedRevision: res.confirmed,
        prototype: res.prototype,
        project: res.project,
        prototypes: store.listPrototypes(existing.projectId),
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 404);
    }
  });

  app.post('/api/prototypes/:id/clone', async (c) => {
    const id = c.req.param('id');
    const body = await c.req
      .json<{ name?: string }>()
      .catch(() => ({ name: undefined }));
    const prototype = store.clonePrototype(id, body.name ? { name: body.name } : undefined);
    return c.json({
      prototype,
      prototypes: store.listPrototypes(prototype.projectId),
      confirmedRevision: store.getConfirmedPrototypeRevision(prototype.projectId) ?? null,
    });
  });

  app.delete('/api/prototypes/:id', (c) => {
    const id = c.req.param('id');
    const locale = getReqLocale(c);
    const existing = store.getPrototype(id);
    const projectId =
      existing?.projectId ||
      c.req.query('projectId') ||
      store.listProjects()[0]?.id ||
      'proj-contract';
    try {
      store.deletePrototype(id);
      return c.json({
        deletedId: id,
        prototypes: store.listPrototypes(projectId),
        confirmedRevision: store.getConfirmedPrototypeRevision(projectId) ?? null,
      });
    } catch (err) {
      if (
        err instanceof PrototypeConfirmedDeleteError ||
        (err instanceof Error &&
          (err as { code?: string }).code === 'PROTOTYPE_HOLDS_CONFIRMED_REVISION')
      ) {
        const displayError =
          err instanceof PrototypeConfirmedDeleteError
            ? locale === 'en-US'
              ? err.messageEn
              : err.messageZh
            : err.message;
        return c.json(
          {
            error: displayError,
            code: 'PROTOTYPE_HOLDS_CONFIRMED_REVISION' as const,
            messageZh: err instanceof PrototypeConfirmedDeleteError ? err.messageZh : err.message,
            messageEn: err instanceof PrototypeConfirmedDeleteError ? err.messageEn : err.message,
          },
          409,
        );
      }
      throw err;
    }
  });

  app.post('/api/projects/:id/prototypes/generate', async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req
      .json<{ docId?: string; prompt?: string; locale?: string }>()
      .catch(() => ({ docId: undefined, prompt: undefined, locale: undefined }));
    const locale = getReqLocale(c, body);
    const result = await generatePrototypeFromDoc(store, {
      projectId,
      ...(body.docId ? { docId: body.docId } : {}),
      ...(body.prompt ? { prompt: body.prompt } : {}),
      ...(locale ? { locale } : {}),
    });
    return c.json(result);
  });

  app.post('/api/projects/:id/prototypes/:prototypeId/co-design-session', (c) => {
    const projectId = c.req.param('id');
    const prototypeId = c.req.param('prototypeId');
    try {
      const session = ensurePrototypeCoDesignSession(store, projectId, prototypeId);
      return c.json({
        session,
        prototype: store.getPrototype(prototypeId) ?? null,
        prototypes: store.listPrototypes(projectId),
        agentSessions: store.listAgentSessions(),
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 404);
    }
  });

  app.post('/api/prototype-inspo', async (c) => {
    const body = await c.req
      .json<InspoProxyRequestBody>()
      .catch((): InspoProxyRequestBody => ({ action: 'search' }));
    const payload = await handleInspoProxyRequest(store, body);
    return c.json(payload);
  });

  app.post('/api/assets', async (c) => {
    const body = await c.req.json<{
      id: string;
      layer: 'UI_UE' | 'TECH_FOUNDATION' | 'TECH_ARCH';
      name: string;
      version: string;
      summary: string;
      tags: string[];
      specMarkdown: string;
    }>();
    const asset = store.saveFourLayerAsset(body);
    return c.json({ asset, fourLayerAssets: store.listFourLayerAssets() });
  });

  app.delete('/api/assets/:id', (c) => {
    const id = c.req.param('id');
    const force = c.req.query('force') === '1' || c.req.query('force') === 'true';
    store.deleteFourLayerAsset(id, force);
    return c.json({ deletedId: id, fourLayerAssets: store.listFourLayerAssets() });
  });

  app.post('/api/applications', async (c) => {
    const body = await c.req.json<{
      id: string;
      name: string;
      projectId: string;
      uiUeAssetId: string;
      techFoundationAssetId: string;
      techArchAssetId: string;
      status: 'ASSEMBLED' | 'DEVELOPING' | 'PACKAGE_READY' | 'PUBLISHED';
      publishedEndpoint?: string;
      publishedVersion?: string;
      agentDevLogs?: { timestamp: string; phase: string; detail: string }[];
    }>();
    const appItem = store.saveAssembledApplication(body);
    return c.json({
      application: appItem,
      assembledApplications: store.listAssembledApplications(),
    });
  });

  app.post('/api/applications/:appId/clone', (c) => {
    const application = store.cloneAssembledApplication(c.req.param('appId'));
    return c.json({
      application,
      assembledApplications: store.listAssembledApplications(),
    });
  });

  app.delete('/api/applications/:appId', (c) => {
    const appId = c.req.param('appId');
    store.deleteAssembledApplication(appId);
    return c.json({
      deletedId: appId,
      assembledApplications: store.listAssembledApplications(),
    });
  });

  const resolveAppBundleInputs = (appId: string) => {
    const appItem = store.listAssembledApplications().find((a) => a.id === appId);
    if (!appItem) return { error: 'Application not found' as const, status: 404 as const };
    const project = store.getProject(appItem.projectId);
    if (!project) return { error: 'Project not found' as const, status: 404 as const };

    const assets = store.listFourLayerAssets();
    const uiAsset =
      assets.find((a) => a.id === appItem.uiUeAssetId) ??
      assets.find((a) => a.layer === 'UI_UE')!;
    const foundationAsset =
      assets.find((a) => a.id === appItem.techFoundationAssetId) ??
      assets.find((a) => a.layer === 'TECH_FOUNDATION')!;
    const archAsset =
      assets.find((a) => a.id === appItem.techArchAssetId) ??
      assets.find((a) => a.layer === 'TECH_ARCH')!;
    const reqDoc = store.listRequirementDocs(project.id)[0];
    const confirmedProto = store.getConfirmedPrototypeRevision(project.id);
    const proto = confirmedProto
      ? {
          ...confirmedProto.prototype,
          htmlContent: confirmedProto.htmlContent,
          extractedScreenCount: confirmedProto.revision.extractedScreenCount,
        }
      : undefined;

    return { appItem, project, uiAsset, foundationAsset, archAsset, reqDoc, proto };
  };

  app.post('/api/applications/:appId/compile-package', (c) => {
    const resolved = resolveAppBundleInputs(c.req.param('appId'));
    if ('error' in resolved) return c.json({ error: resolved.error }, resolved.status);
    const { appItem, project, uiAsset, foundationAsset, archAsset, reqDoc, proto } = resolved;

    try {
      const compiled = compileDevelopmentPackage({
        app: appItem,
        project,
        uiUeAsset: uiAsset,
        techFoundationAsset: foundationAsset,
        techArchAsset: archAsset,
        ...(reqDoc ? { requirementDoc: reqDoc } : {}),
        ...(proto ? { prototype: proto } : {}),
      });

      const updatedApp = store.saveAssembledApplication({
        ...appItem,
        status: appItem.status === 'PUBLISHED' ? 'PUBLISHED' : 'PACKAGE_READY',
        packageOutputDir: `.onto-cs/packages/${appItem.id}`,
        agentDevLogs: [
          ...appItem.agentDevLogs,
          {
            timestamp: new Date().toISOString(),
            phase: 'PACKAGE_COMPILE',
            detail: `已编译生成 ${compiled.files.length} 个开发资料包文件至 .onto-cs/packages/${appItem.id}`,
          },
        ],
      });

      return c.json({
        compiledPackage: compiled,
        application: updatedApp,
        assembledApplications: store.listAssembledApplications(),
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 422);
    }
  });

  app.get('/api/applications/:appId/package.zip', (c) => {
    const resolved = resolveAppBundleInputs(c.req.param('appId'));
    if ('error' in resolved) return c.json({ error: resolved.error }, resolved.status);
    const { appItem, project, uiAsset, foundationAsset, archAsset, reqDoc, proto } = resolved;

    try {
      const zipOut = compileDevelopmentPackageZip({
        app: appItem,
        project,
        uiUeAsset: uiAsset,
        techFoundationAsset: foundationAsset,
        techArchAsset: archAsset,
        ...(reqDoc ? { requirementDoc: reqDoc } : {}),
        ...(proto ? { prototype: proto } : {}),
      });
      return new Response(zipOut.zipBytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${zipOut.fileName}"`,
          'Content-Length': String(zipOut.zipBytes.byteLength),
        },
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 422);
    }
  });

  app.post('/api/applications/:appId/coding-agent', async (c) => {
    const appId = c.req.param('appId');
    const body = await c.req.json<{ instruction: string; locale?: string }>();
    const locale = getReqLocale(c, body);
    const res = await runAppCodingAgentTurn(store, {
      appId,
      instruction: body.instruction,
      ...(locale ? { locale } : {}),
    });
    return c.json({
      ...res,
      assembledApplications: store.listAssembledApplications(),
    });
  });

  app.post('/api/applications/:appId/publish', async (c) => {
    const appId = c.req.param('appId');
    const appItem = store.listAssembledApplications().find((a) => a.id === appId);
    if (!appItem) return c.json({ error: 'Application not found' }, 404);
    const body = await c.req
      .json<{ version?: string; endpoint?: string }>()
      .catch(() => ({ version: undefined, endpoint: undefined }));

    const nextVersion = body.version || `v${appItem.agentDevLogs.length + 1}.0.0`;
    const nextEndpoint = body.endpoint || appItem.publishedEndpoint || `/apps/${appItem.id}`;
    const updated = store.saveAssembledApplication({
      ...appItem,
      status: 'PUBLISHED',
      publishedVersion: nextVersion,
      publishedEndpoint: nextEndpoint,
      agentDevLogs: [
        ...appItem.agentDevLogs,
        {
          timestamp: new Date().toISOString(),
          phase: 'RELEASE_SMOKE_CHECK',
          detail: `完成 4A V-Model 门禁核验并发布版本 ${nextVersion} 至 ${nextEndpoint}`,
        },
      ],
    });
    return c.json({
      application: updated,
      assembledApplications: store.listAssembledApplications(),
    });
  });

  // ─── Capability Center & Dynamic MCP Routes ─────────────────────────────────

  app.post('/api/capability/systems', async (c) => {
    const body = await c.req.json<LegacySystemConfig>();
    const system = store.saveLegacySystem(body);
    return c.json({ system, legacySystems: store.listLegacySystems() });
  });

  app.delete('/api/capability/systems/:id', (c) => {
    const id = c.req.param('id');
    store.deleteLegacySystem(id);
    return c.json({ deletedId: id, legacySystems: store.listLegacySystems() });
  });

  app.post('/api/capability/extraction-jobs', async (c) => {
    const body = await c.req.json<{
      systemId: string;
      projectId: string;
      title: string;
      sourceType: 'DDL_AND_OPENAPI' | 'SOURCE_CODE' | 'LOG_AND_DOC';
      sourceSnippet: string;
      applyImmediately?: boolean;
      locale?: string;
    }>();
    const locale = getReqLocale(c, body);
    const res = await runSmartOntologyExtractionJob(store, {
      ...body,
      ...(locale ? { locale } : {}),
    });
    return c.json({
      ...res,
      extractionJobs: store.listExtractionJobs(),
    });
  });

  app.put('/api/capability/extraction-jobs/:jobId/decisions', async (c) => {
    const body = await c.req.json<{
      decisions: Record<string, 'ACCEPTED' | 'REJECTED' | null>;
    }>();
    const job = store.saveExtractionDecisions(c.req.param('jobId'), body.decisions ?? {});
    return c.json({ job, extractionJobs: store.listExtractionJobs() });
  });

  app.post('/api/capability/extraction-jobs/:jobId/apply', (c) => {
    const res = store.applyExtractionJobToProject(c.req.param('jobId'));
    return c.json(
      {
        ...res,
        ...(res.blockedBy.length > 0
          ? {
              code: 'MERGE_BLOCKED',
              error: 'Merge blocked: the accepted candidates would introduce new Consistency Errors.',
            }
          : {}),
        extractionJobs: store.listExtractionJobs(),
      },
      res.blockedBy.length > 0 ? 409 : 200,
    );
  });

  app.delete('/api/capability/extraction-jobs/:jobId', (c) => {
    const jobId = c.req.param('jobId');
    store.deleteExtractionJob(jobId);
    return c.json({
      deletedId: jobId,
      extractionJobs: store.listExtractionJobs(),
    });
  });

  app.post('/api/capability/agents', async (c) => {
    const body = await c.req.json<{
      id: string;
      name: string;
      role: string;
      projectId: string;
      mcpIds: string[];
      skillIds: string[];
      modelId: string;
      systemPrompt: string;
      status: 'ACTIVE' | 'DRAFT';
    }>();
    const agent = store.saveCapabilityAgent(body);
    return c.json({ agent, capabilityAgents: store.listCapabilityAgents() });
  });

  app.delete('/api/capability/agents/:id', (c) => {
    const id = c.req.param('id');
    store.deleteCapabilityAgent(id);
    return c.json({ deletedId: id, capabilityAgents: store.listCapabilityAgents() });
  });

  app.get('/api/capability/chat-sessions', (c) => {
    const agentId = c.req.query('agentId');
    return c.json({ sessions: store.listCapabilityChatSessions(agentId) });
  });

  app.delete('/api/capability/chat-sessions/:id', (c) => {
    const id = c.req.param('id');
    store.deleteCapabilityChatSession(id);
    return c.json({ deletedId: id, capabilityChatSessions: store.listCapabilityChatSessions() });
  });

  app.post('/api/capability/agents/:agentId/chat', async (c) => {
    const agentId = c.req.param('agentId');
    const body = await c.req.json<{ sessionId?: string; userMessage: string; locale?: string }>();
    const locale = getReqLocale(c, body);
    const res = await runCapabilitySmartChatTurn(store, {
      agentId,
      ...(body.sessionId ? { sessionId: body.sessionId } : {}),
      userMessage: body.userMessage,
      ...(locale ? { locale } : {}),
    });
    return c.json({
      ...res,
      capabilityChatSessions: store.listCapabilityChatSessions(),
    });
  });

  app.post('/api/capability/flows', async (c) => {
    const body = await c.req.json<CrossSystemFlow>();
    const flow = store.saveCrossSystemFlow(body);
    return c.json({ flow, crossSystemFlows: store.listCrossSystemFlows() });
  });

  app.delete('/api/capability/flows/:flowId', (c) => {
    const flowId = c.req.param('flowId');
    store.deleteCrossSystemFlow(flowId);
    return c.json({ deletedId: flowId, crossSystemFlows: store.listCrossSystemFlows() });
  });

  app.post('/api/capability/flows/:flowId/execute', (c) => {
    const flow = store.executeCrossSystemFlow(c.req.param('flowId'));
    return c.json({ flow, crossSystemFlows: store.listCrossSystemFlows() });
  });

  app.post('/api/knowledge', async (c) => {
    const body = await c.req.json<{
      id: string;
      title: string;
      category: 'DOMAIN_GLOSSARY' | 'MODELING_STANDARD' | 'BUSINESS_POLICY' | 'EXTRACTION_GUIDE';
      tags: string[];
      content: string;
      linkedProjectId?: string;
    }>();
    const entry = store.saveKnowledgeEntry(body);
    return c.json({ entry, knowledgeEntries: store.listKnowledgeEntries() });
  });

  app.delete('/api/knowledge/:id', (c) => {
    const id = c.req.param('id');
    store.deleteKnowledgeEntry(id);
    return c.json({ deletedId: id, knowledgeEntries: store.listKnowledgeEntries() });
  });

  app.get('/api/mcp/:projectId/capabilities', (c) => {
    const project = store.getProject(c.req.param('projectId'));
    if (!project) return c.json({ error: 'Project not found' }, 404);
    let origin = 'http://127.0.0.1:4310';
    try {
      origin = new URL(c.req.url).origin;
    } catch {
      // Keep default origin
    }
    return c.json({
      ...inspectOntologyMcpCapabilities(project),
      clientConfigJson: buildMcpClientConfigJson(project, origin),
    });
  });

  app.post('/api/mcp/:projectId', async (c) => {
    const project = store.getProject(c.req.param('projectId'));
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const rpcReq = await c.req.json<JsonRpcRequest>();
    const rpcRes = handleOntologyMcpRequest(project, rpcReq, {
      sqlExecutor: (sql, params) => store.executeReadOnlyAnalyticsSql(sql, params),
    });
    return c.json(rpcRes);
  });

  // ─── Data Analytics Center Routes ───────────────────────────────────────────

  app.post('/api/analytics/databases', async (c) => {
    const body = await c.req.json<DatabaseResource>();
    const database = store.saveDatabaseResource(body);
    return c.json({ database, databaseResources: store.listDatabaseResources() });
  });

  app.delete('/api/analytics/databases/:id', (c) => {
    const id = c.req.param('id');
    store.deleteDatabaseResource(id);
    return c.json({ deletedId: id, databaseResources: store.listDatabaseResources() });
  });

  app.post('/api/analytics/documents', async (c) => {
    const body = await c.req.json<Omit<DataDocument, 'updatedAt'>>();
    const document = store.saveDataDocument(body);
    return c.json({ document, dataDocuments: store.listDataDocuments() });
  });

  app.delete('/api/analytics/documents/:id', (c) => {
    const id = c.req.param('id');
    store.deleteDataDocument(id);
    return c.json({ deletedId: id, dataDocuments: store.listDataDocuments() });
  });

  app.post('/api/analytics/mappings', async (c) => {
    const body = await c.req.json<DataMappingRule>();
    const mapping = store.saveDataMapping(body);
    return c.json({ mapping, dataMappings: store.listDataMappings() });
  });

  app.delete('/api/analytics/mappings/:id', (c) => {
    const id = c.req.param('id');
    store.deleteDataMapping(id);
    return c.json({ deletedId: id, dataMappings: store.listDataMappings() });
  });

  app.post('/api/analytics/metrics', async (c) => {
    const body = await c.req.json<MetricDefinition>();
    const metric = store.saveMetric(body);
    return c.json({ metric, metrics: store.listMetrics() });
  });

  app.delete('/api/analytics/metrics/:id', (c) => {
    const id = c.req.param('id');
    store.deleteMetric(id);
    return c.json({ deletedId: id, metrics: store.listMetrics() });
  });

  app.post('/api/analytics/scenarios', async (c) => {
    const body = await c.req.json<AnalyticsScenario>();
    const scenario = store.saveAnalyticsScenario(body);
    return c.json({ scenario, analyticsScenarios: store.listAnalyticsScenarios() });
  });

  app.delete('/api/analytics/scenarios/:id', (c) => {
    const id = c.req.param('id');
    store.deleteAnalyticsScenario(id);
    return c.json({ deletedId: id, analyticsScenarios: store.listAnalyticsScenarios() });
  });

  app.post('/api/analytics/reports', async (c) => {
    const body = await c.req.json<{
      id: string;
      title: string;
      period: string;
      author: string;
      summary: string;
      markdownContent: string;
    }>();
    const report = store.saveAnalyticsReport(body);
    return c.json({ report, analyticsReports: store.listAnalyticsReports() });
  });

  app.delete('/api/analytics/reports/:id', (c) => {
    const id = c.req.param('id');
    store.deleteAnalyticsReport(id);
    return c.json({ deletedId: id, analyticsReports: store.listAnalyticsReports() });
  });

  app.post('/api/analytics/sql', async (c) => {
    const body = await c.req.json<{ sql: string; params?: Record<string, unknown> }>();
    try {
      const result = store.executeReadOnlyAnalyticsSql(body.sql, body.params);
      return c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.post('/api/analytics/reasoning', async (c) => {
    const body = await c.req.json<{
      question: string;
      mode: 'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY';
      projectId?: string;
      locale?: string;
    }>();
    const locale = getReqLocale(c, body);
    const session = await runDataOntologyReasoning(store, {
      ...body,
      ...(locale ? { locale } : {}),
    });
    return c.json({
      session,
      reasoningSessions: store.listReasoningSessions(),
    });
  });

  app.delete('/api/analytics/reasoning/:id', (c) => {
    const id = c.req.param('id');
    store.deleteReasoningSession(id);
    return c.json({ deletedId: id, reasoningSessions: store.listReasoningSessions() });
  });

  app.post('/api/analytics/writebacks', async (c) => {
    const body = await c.req.json<WritebackInterface>();
    const writeback = store.saveWritebackInterface(body);
    return c.json({ writeback, writebackInterfaces: store.listWritebackInterfaces() });
  });

  app.delete('/api/analytics/writebacks/:interfaceId', (c) => {
    const interfaceId = c.req.param('interfaceId');
    store.deleteWritebackInterface(interfaceId);
    return c.json({
      deletedId: interfaceId,
      writebackInterfaces: store.listWritebackInterfaces(),
    });
  });

  app.post('/api/analytics/writebacks/:interfaceId/execute', async (c) => {
    const interfaceId = c.req.param('interfaceId');
    const body = await c.req.json<{ payloadOverride?: Record<string, unknown> }>().catch(() => ({
      payloadOverride: undefined,
    }));
    const updated = store.executeWritebackInterface(interfaceId, body.payloadOverride);
    return c.json({
      writeback: updated,
      writebackInterfaces: store.listWritebackInterfaces(),
    });
  });

  // ─── LLM Center & System Settings Routes ────────────────────────────────────

  app.post('/api/llm/providers', async (c) => {
    const body = await c.req.json<LlmProviderConfig>();
    const provider = store.saveLlmProvider(body);
    return c.json({ provider, llmProviders: store.listLlmProviders() });
  });

  app.delete('/api/llm/providers/:id', (c) => {
    const id = c.req.param('id');
    store.deleteLlmProvider(id);
    return c.json({ deletedId: id, llmProviders: store.listLlmProviders() });
  });

  app.post('/api/llm/providers/:id/test', async (c) => {
    const id = c.req.param('id');
    const provider = store.listLlmProviders().find((p) => p.id === id);
    if (!provider) return c.json({ error: 'Provider not found' }, 404);
    const ping = await testLlmGatewayConnection(provider);
    store.saveLlmProvider({
      ...provider,
      availableModels:
        ping.discoveredModels.length > 0 ? ping.discoveredModels : provider.availableModels,
      lastTestedStatus: ping.ok ? 'OK' : 'ERROR',
      lastTestedMessage: ping.sampleReply || ping.errorMessage || 'Tested',
    });
    return c.json({
      ping,
      llmProviders: store.listLlmProviders(),
    });
  });

  app.put('/api/settings', async (c) => {
    const body = await c.req.json();
    const systemSettings = store.updateSystemSettings(body);
    return c.json({ systemSettings });
  });

  app.put('/api/system/settings', async (c) => {
    const body = await c.req.json();
    const systemSettings = store.updateSystemSettings(body);
    return c.json({ systemSettings });
  });

  return app;
}
