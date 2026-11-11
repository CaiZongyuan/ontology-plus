import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  exportToOwl,
  parseModelYaml,
  type ModelCode,
  type OntologySuite,
} from '../packages/ontology-core/index.js';
import {
  createWorkspaceStore,
  type AnalyticsScenario,
  type DataDocument,
  type DataMappingRule,
  type DatabaseResource,
  type LegacySystemConfig,
  type MetricDefinition,
  type WorkspaceStore,
} from '../packages/workspace-store/index.js';
import {
  SSE_RESPONSE_HEADERS,
  buildTurnSseEvents,
  createSseEventStream,
  generateMetricInsight,
  generatePrototypeFromDoc,
  generateTechArchitectureDoc,
  refinePrototypeWithAi,
  runAppCodingAgentTurn,
  runCapabilitySmartChatTurn,
  runDataOntologyReasoning,
  runOntologyCopilotTurn,
  runRequirementGrillingTurn,
  runScenarioAttributionTurn,
  synthesizeOntologyFromPrototype,
  synthesizeRequirementDocFromSession,
  testLlmGatewayConnection,
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

  app.get('/api/health', (c) => {
    return c.json({ ok: true, service: 'ontology-plus', version: '5.0.0' });
  });

  app.get('/api/bootstrap', (c) => {
    const projects = store.listProjects();
    const requestedProjectId = c.req.query('projectId') || projects[0]?.id || 'proj-contract';
    const activeProject = store.getProject(requestedProjectId) ?? store.getProject(projects[0].id)!;

    return c.json({
      projects,
      activeProject,
      requirementSessions: store.listRequirementSessions(activeProject.id),
      requirementDocs: store.listRequirementDocs(activeProject.id),
      prototypes: store.listPrototypes(activeProject.id),
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
    return c.json({ project });
  });

  app.get('/api/projects/:id', (c) => {
    const project = store.getProject(c.req.param('id'));
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json({
      project,
      requirementSessions: store.listRequirementSessions(project.id),
      requirementDocs: store.listRequirementDocs(project.id),
      prototypes: store.listPrototypes(project.id),
      extractionJobs: store.listExtractionJobs(project.id),
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
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        400,
      );
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

  app.post('/api/projects/:id/copilot', async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req.json<{ prompt: string; activeModel?: ModelCode }>();
    const result = await runOntologyCopilotTurn(store, {
      projectId,
      prompt: body.prompt,
      activeModel: body.activeModel,
    });
    return c.json(result);
  });

  app.post('/api/projects/:id/copilot/stream', async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req.json<{ prompt: string; activeModel?: ModelCode }>();
    const result = await runOntologyCopilotTurn(store, {
      projectId,
      prompt: body.prompt,
      activeModel: body.activeModel,
    });
    const events = buildTurnSseEvents({
      sessionId: `copilot-${projectId}-${Date.now()}`,
      reply: result.reply,
      toolCalls: result.toolCalls,
      renderPayload: {
        project: result.project,
        modelUsed: result.modelUsed,
        latencyMs: result.latencyMs,
      },
    });
    return new Response(createSseEventStream(events), { headers: SSE_RESPONSE_HEADERS });
  });

  app.post('/api/projects/:id/generate-skill', (c) => {
    const project = store.getProject(c.req.param('id'));
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const compiled = compileOntologySkill(project);
    const saved = store.saveGeneratedSkill(compiled);
    return c.json({ skill: saved, skills: store.listGeneratedSkills() });
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

  app.post('/api/requirements/:sessionId/grill', async (c) => {
    const sessionId = c.req.param('sessionId');
    const body = await c.req.json<{ userMessage: string }>();
    const result = await runRequirementGrillingTurn(store, {
      sessionId,
      userMessage: body.userMessage,
    });
    return c.json({
      ...result,
      requirementSessions: store.listRequirementSessions(result.session.projectId),
    });
  });

  app.post('/api/requirements/:sessionId/synthesize-doc', async (c) => {
    const sessionId = c.req.param('sessionId');
    const body = await c.req
      .json<{ title?: string; version?: string }>()
      .catch(() => ({ title: undefined, version: undefined }));
    const result = await synthesizeRequirementDocFromSession(store, {
      sessionId,
      title: body.title,
      version: body.version,
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

  app.post('/api/projects/:id/prototypes', async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req.json<{
      id?: string;
      name: string;
      version?: string;
      htmlContent: string;
      syncMu?: boolean;
    }>();
    const result = store.savePrototypeAndSyncMu(projectId, body);
    return c.json({
      ...result,
      prototypes: store.listPrototypes(projectId),
    });
  });

  app.post('/api/projects/:id/prototypes/generate', async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req
      .json<{ docId?: string; prompt?: string }>()
      .catch(() => ({ docId: undefined, prompt: undefined }));
    const result = await generatePrototypeFromDoc(store, {
      projectId,
      docId: body.docId,
      prompt: body.prompt,
    });
    return c.json(result);
  });

  app.post('/api/projects/:id/prototypes/:prototypeId/refine', async (c) => {
    const projectId = c.req.param('id');
    const prototypeId = c.req.param('prototypeId');
    const body = await c.req.json<{ instruction: string }>();
    const result = await refinePrototypeWithAi(store, {
      projectId,
      prototypeId,
      instruction: body.instruction,
    });
    return c.json(result);
  });

  app.post('/api/projects/:id/prototypes/synthesize-ontology', async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req
      .json<{ prototypeId?: string; docId?: string }>()
      .catch(() => ({ prototypeId: undefined, docId: undefined }));
    const result = await synthesizeOntologyFromPrototype(store, {
      projectId,
      prototypeId: body.prototypeId,
      docId: body.docId,
    });
    return c.json(result);
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

  app.post('/api/assets/generate-tech-arch', async (c) => {
    const body = await c.req.json<{
      name: string;
      stackTags?: string[];
      prompt?: string;
    }>();
    const result = await generateTechArchitectureDoc(store, body);
    return c.json(result);
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
    return c.json({ application: appItem, assembledApplications: store.listAssembledApplications() });
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
    const proto = store.listPrototypes(project.id)[0];

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
        requirementDoc: reqDoc,
        prototype: proto,
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
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        422,
      );
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
        requirementDoc: reqDoc,
        prototype: proto,
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
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        422,
      );
    }
  });

  app.post('/api/applications/:appId/coding-agent', async (c) => {
    const appId = c.req.param('appId');
    const body = await c.req.json<{ instruction: string }>();
    const res = await runAppCodingAgentTurn(store, {
      appId,
      instruction: body.instruction,
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

    const nextVersion = body.version || `v${(appItem.agentDevLogs.length + 1)}.0.0`;
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

  app.post('/api/capability/extraction-jobs', async (c) => {
    const body = await c.req.json<{
      systemId: string;
      projectId: string;
      title: string;
      sourceType: 'DDL_AND_OPENAPI' | 'SOURCE_CODE' | 'LOG_AND_DOC';
      sourceSnippet: string;
      applyImmediately?: boolean;
    }>();
    const res = store.runOntologyExtractionJob(body);
    return c.json({
      ...res,
      extractionJobs: store.listExtractionJobs(),
    });
  });

  app.post('/api/capability/extraction-jobs/:jobId/apply', (c) => {
    const res = store.applyExtractionJobToProject(c.req.param('jobId'));
    return c.json({
      ...res,
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

  app.get('/api/capability/chat-sessions', (c) => {
    const agentId = c.req.query('agentId');
    return c.json({ sessions: store.listCapabilityChatSessions(agentId) });
  });

  app.post('/api/capability/agents/:agentId/chat', async (c) => {
    const agentId = c.req.param('agentId');
    const body = await c.req.json<{ sessionId?: string; userMessage: string }>();
    const res = await runCapabilitySmartChatTurn(store, {
      agentId,
      sessionId: body.sessionId,
      userMessage: body.userMessage,
    });
    return c.json({
      ...res,
      capabilityChatSessions: store.listCapabilityChatSessions(),
    });
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

  app.post('/api/analytics/documents', async (c) => {
    const body = await c.req.json<Omit<DataDocument, 'updatedAt'>>();
    const document = store.saveDataDocument(body);
    return c.json({ document, dataDocuments: store.listDataDocuments() });
  });

  app.post('/api/analytics/mappings', async (c) => {
    const body = await c.req.json<DataMappingRule>();
    const mapping = store.saveDataMapping(body);
    return c.json({ mapping, dataMappings: store.listDataMappings() });
  });

  app.post('/api/analytics/metrics', async (c) => {
    const body = await c.req.json<MetricDefinition>();
    const metric = store.saveMetric(body);
    return c.json({ metric, metrics: store.listMetrics() });
  });

  app.post('/api/analytics/metrics/:metricId/insight', async (c) => {
    const metricId = c.req.param('metricId');
    const res = await generateMetricInsight(store, { metricId });
    return c.json(res);
  });

  app.post('/api/analytics/scenarios', async (c) => {
    const body = await c.req.json<AnalyticsScenario>();
    const scenario = store.saveAnalyticsScenario(body);
    return c.json({ scenario, analyticsScenarios: store.listAnalyticsScenarios() });
  });

  app.post('/api/analytics/scenarios/:scenarioId/attribute', async (c) => {
    const scenarioId = c.req.param('scenarioId');
    const body = await c.req
      .json<{ question?: string; saveAsReport?: boolean }>()
      .catch(() => ({ question: undefined, saveAsReport: undefined }));
    const res = await runScenarioAttributionTurn(store, {
      scenarioId,
      question: body.question,
      saveAsReport: body.saveAsReport,
    });
    return c.json({
      ...res,
      analyticsReports: store.listAnalyticsReports(),
    });
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
    }>();
    const session = await runDataOntologyReasoning(store, body);
    return c.json({
      session,
      reasoningSessions: store.listReasoningSessions(),
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
    const body = await c.req.json<{
      id: string;
      name: string;
      providerType: 'OPENAI_COMPATIBLE' | 'ANTHROPIC' | 'CLOUDFLARE_AI';
      baseUrl: string;
      apiKey: string;
      defaultModel: string;
      availableModels: string[];
      enabled: boolean;
    }>();
    const provider = store.saveLlmProvider(body);
    return c.json({ provider, llmProviders: store.listLlmProviders() });
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

  return app;
}
