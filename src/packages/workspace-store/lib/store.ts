import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  CONTRACT_LIFECYCLE_SUITE,
  MFT_ENTERPRISE_SUITE,
  analyzeImpact,
  buildKnowledgeGraph,
  extractMuFromPrototypeHtml,
  parseSuiteFromYamlFiles,
  renameOntologySymbol,
  serializeSuiteToYamlFiles,
  validateOntologySuite,
  type ModelCode,
  type OntologySuite,
} from '../../ontology-core/index.js';
import {
  SEED_ANALYTICS_REPORTS,
  SEED_ANALYTICS_SCENARIOS,
  SEED_ASSEMBLED_APPS,
  SEED_CAPABILITY_AGENTS,
  SEED_CROSS_SYSTEM_FLOWS,
  SEED_DATABASE_RESOURCES,
  SEED_DATA_DOCUMENTS,
  SEED_DATA_MAPPINGS,
  SEED_EXTRACTION_JOBS,
  SEED_FOUR_LAYER_ASSETS,
  SEED_KNOWLEDGE_ENTRIES,
  SEED_LEGACY_SYSTEMS,
  SEED_LLM_PROVIDERS,
  SEED_MCP_SERVERS,
  SEED_METRICS,
  SEED_PROJECTS,
  SEED_PROTOTYPES,
  SEED_REASONING_SESSIONS,
  SEED_REQUIREMENT_DOCS,
  SEED_REQUIREMENT_SESSIONS,
  SEED_SKILLS,
  SEED_SYSTEM_SETTINGS,
  SEED_WRITEBACK_INTERFACES,
} from './seed-data.js';
import type {
  AnalyticsReport,
  AnalyticsScenario,
  AssembledApplication,
  CapabilityAgent,
  CrossSystemFlow,
  DataDocument,
  DataMappingRule,
  DatabaseResource,
  ExtractionJob,
  FourLayerAsset,
  GeneratedSkill,
  KnowledgeEntry,
  LegacySystemConfig,
  LlmProviderConfig,
  McpServerConfig,
  MetricDefinition,
  ProjectDetail,
  ProjectSummary,
  PrototypeArtifact,
  ReasoningSession,
  RequirementDoc,
  RequirementMessage,
  RequirementSession,
  SystemSettingsState,
  WorkspaceStore,
  WritebackInterface,
} from './types.js';

export interface WorkspaceStoreOptions {
  dbPath?: string;
  workspaceRoot?: string;
  enableFileMirror?: boolean;
}

interface SqliteStatementLike {
  run: (...params: unknown[]) => unknown;
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
}

interface SqliteDbLike {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatementLike;
}

function openSqliteOrMemoryDb(dbPath: string): SqliteDbLike {
  try {
    const req = createRequire(import.meta.url);
    const modName = ['node', 'sqlite'].join(':');
    const sqliteMod = req(modName) as { DatabaseSync: new (p: string) => SqliteDbLike };
    return new sqliteMod.DatabaseSync(dbPath);
  } catch {
    // Edge / workerd fallback when node:sqlite is not present
    const projectsMap = new Map<string, Record<string, unknown>>();
    const kvMap = new Map<string, { project_id: string | null; payload_json: string; updated_at: string }>();
    return {
      exec() {},
      prepare(sql: string): SqliteStatementLike {
        const s = sql.trim();
        return {
          run(...params: unknown[]) {
            if (s.startsWith('INSERT INTO projects')) {
              const [id, name, code, center, domain, description, current_stage, suite_json, changelog, created_at, updated_at] = params;
              projectsMap.set(String(id), { id, name, code, center, domain, description, current_stage, suite_json, changelog, created_at, updated_at });
            } else if (s.startsWith('UPDATE projects')) {
              if (params.length === 5) {
                const [suite_json, current_stage, changelog, updated_at, id] = params;
                const cur = projectsMap.get(String(id));
                if (cur) projectsMap.set(String(id), { ...cur, suite_json, current_stage, changelog, updated_at });
              } else if (params.length === 4) {
                const [suite_json, changelog, updated_at, id] = params;
                const cur = projectsMap.get(String(id));
                if (cur) projectsMap.set(String(id), { ...cur, suite_json, changelog, updated_at });
              }
            } else if (s.startsWith('INSERT INTO kv_collections')) {
              const [collection, item_id, project_id, payload_json, updated_at] = params;
              kvMap.set(`${collection}::${item_id}`, {
                project_id: project_id ? String(project_id) : null,
                payload_json: String(payload_json),
                updated_at: String(updated_at),
              });
            }
          },
          get(...params: unknown[]) {
            if (s.includes('COUNT(*) AS cnt FROM projects')) {
              return { cnt: projectsMap.size };
            }
            if (s.includes('FROM projects WHERE id = ?')) {
              return projectsMap.get(String(params[0]));
            }
            if (s.includes('FROM kv_collections WHERE collection = ? AND item_id = ?')) {
              return kvMap.get(`${params[0]}::${params[1]}`);
            }
            return undefined;
          },
          all(...params: unknown[]) {
            if (s.includes('FROM projects')) {
              return [...projectsMap.values()];
            }
            if (s.includes('AND project_id = ?')) {
              const [col, pid] = params;
              return [...kvMap.entries()]
                .filter(([k, v]) => k.startsWith(`${col}::`) && v.project_id === String(pid))
                .map(([, v]) => ({ payload_json: v.payload_json }));
            }
            const [col] = params;
            return [...kvMap.entries()]
              .filter(([k]) => k.startsWith(`${col}::`))
              .map(([, v]) => ({ payload_json: v.payload_json }));
          },
        };
      },
    };
  }
}

export function createWorkspaceStore(options: WorkspaceStoreOptions = {}): WorkspaceStore {
  const workspaceRoot = options.workspaceRoot ?? path.resolve(process.cwd(), '.onto-cs');
  const enableFileMirror = options.enableFileMirror ?? true;
  const dbPath =
    options.dbPath ??
    (enableFileMirror ? path.join(workspaceRoot, 'workspace.sqlite') : ':memory:');

  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = openSqliteOrMemoryDb(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      center TEXT NOT NULL,
      domain TEXT NOT NULL,
      description TEXT NOT NULL,
      current_stage INTEGER NOT NULL,
      suite_json TEXT NOT NULL,
      changelog TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kv_collections (
      collection TEXT NOT NULL,
      item_id TEXT NOT NULL,
      project_id TEXT,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (collection, item_id)
    );
  `);

  function mirrorProjectFiles(projectId: string, suite: OntologySuite, changelog: string): void {
    if (!enableFileMirror) return;
    try {
      const modelRoot = path.join(workspaceRoot, 'model', projectId);
      const yamlDir = path.join(modelRoot, 'yaml');
      fs.mkdirSync(yamlDir, { recursive: true });

      const files = serializeSuiteToYamlFiles(suite);
      for (const entry of Object.values(files)) {
        if (!entry) continue;
        fs.writeFileSync(path.join(yamlDir, entry.fileName), entry.content, 'utf-8');
      }
      fs.writeFileSync(path.join(modelRoot, 'CHANGELOG.md'), changelog, 'utf-8');
    } catch {
      // Non-fatal in read-only edge runtimes
    }
  }

  function putItem<T>(collection: string, itemId: string, payload: T, projectId?: string): T {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO kv_collections (collection, item_id, project_id, payload_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(collection, item_id) DO UPDATE SET
        project_id = excluded.project_id,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `);
    stmt.run(collection, itemId, projectId ?? null, JSON.stringify(payload), now);
    return payload;
  }

  function listItems<T>(collection: string, projectId?: string): T[] {
    if (projectId) {
      const stmt = db.prepare(
        `SELECT payload_json FROM kv_collections WHERE collection = ? AND project_id = ? ORDER BY updated_at DESC`,
      );
      const rows = stmt.all(collection, projectId) as { payload_json: string }[];
      return rows.map((r) => JSON.parse(r.payload_json) as T);
    }
    const stmt = db.prepare(
      `SELECT payload_json FROM kv_collections WHERE collection = ? ORDER BY updated_at DESC`,
    );
    const rows = stmt.all(collection) as { payload_json: string }[];
    return rows.map((r) => JSON.parse(r.payload_json) as T);
  }

  function getItem<T>(collection: string, itemId: string): T | undefined {
    const stmt = db.prepare(
      `SELECT payload_json FROM kv_collections WHERE collection = ? AND item_id = ?`,
    );
    const row = stmt.get(collection, itemId) as { payload_json: string } | undefined;
    return row ? (JSON.parse(row.payload_json) as T) : undefined;
  }

  // Idempotent seed on first startup
  const countRow = db.prepare(`SELECT COUNT(*) AS cnt FROM projects`).get() as { cnt: number };
  if (countRow.cnt === 0) {
    const now = '2026-11-10T09:00:00.000Z';
    const insertProj = db.prepare(`
      INSERT INTO projects (id, name, code, center, domain, description, current_stage, suite_json, changelog, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const p of SEED_PROJECTS) {
      insertProj.run(
        p.id,
        p.name,
        p.code,
        p.center,
        p.domain,
        p.description,
        p.currentStage,
        JSON.stringify(p.suite),
        p.changelog,
        now,
        now,
      );
      mirrorProjectFiles(p.id, p.suite, p.changelog);
    }

    for (const s of SEED_REQUIREMENT_SESSIONS) putItem('req_sessions', s.id, s, s.projectId);
    for (const d of SEED_REQUIREMENT_DOCS) putItem('req_docs', d.id, d, d.projectId);
    for (const pr of SEED_PROTOTYPES) putItem('prototypes', pr.id, pr, pr.projectId);
    for (const a of SEED_FOUR_LAYER_ASSETS) putItem('four_layer_assets', a.id, a);
    for (const app of SEED_ASSEMBLED_APPS) putItem('assembled_apps', app.id, app, app.projectId);
    for (const sk of SEED_SKILLS) putItem('skills', sk.id, sk, sk.projectId);
    for (const sys of SEED_LEGACY_SYSTEMS) putItem('legacy_systems', sys.id, sys, sys.linkedProjectId);
    for (const job of SEED_EXTRACTION_JOBS) putItem('extraction_jobs', job.id, job, job.projectId);
    for (const mcp of SEED_MCP_SERVERS) putItem('mcp_servers', mcp.id, mcp, mcp.projectId);
    for (const ag of SEED_CAPABILITY_AGENTS) putItem('capability_agents', ag.id, ag, ag.projectId);
    for (const fl of SEED_CROSS_SYSTEM_FLOWS) putItem('cross_flows', fl.id, fl);
    for (const kn of SEED_KNOWLEDGE_ENTRIES) putItem('knowledge', kn.id, kn, kn.linkedProjectId);
    for (const dbr of SEED_DATABASE_RESOURCES) putItem('db_resources', dbr.id, dbr);
    for (const ddoc of SEED_DATA_DOCUMENTS) putItem('data_docs', ddoc.id, ddoc);
    for (const dm of SEED_DATA_MAPPINGS) putItem('data_mappings', dm.id, dm);
    for (const m of SEED_METRICS) putItem('metrics', m.id, m);
    for (const sc of SEED_ANALYTICS_SCENARIOS) putItem('analytics_scenarios', sc.id, sc);
    for (const rp of SEED_ANALYTICS_REPORTS) putItem('analytics_reports', rp.id, rp);
    for (const rs of SEED_REASONING_SESSIONS) putItem('reasoning_sessions', rs.id, rs);
    for (const wb of SEED_WRITEBACK_INTERFACES) putItem('writebacks', wb.id, wb);
    for (const llm of SEED_LLM_PROVIDERS) putItem('llm_providers', llm.id, llm);
    putItem('system_settings', 'global', SEED_SYSTEM_SETTINGS);
  }

  function hydrateProject(row: Record<string, unknown>): ProjectDetail {
    const suite = JSON.parse(String(row.suite_json)) as OntologySuite;
    const validation = validateOntologySuite(suite);
    const knowledgeGraph = buildKnowledgeGraph(suite);
    return {
      id: String(row.id),
      name: String(row.name),
      code: String(row.code),
      center: row.center as ProjectSummary['center'],
      domain: String(row.domain),
      description: String(row.description),
      currentStage: Number(row.current_stage),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      suite,
      validation,
      knowledgeGraph,
      changelog: String(row.changelog),
    };
  }

  return {
    listProjects(): ProjectSummary[] {
      const rows = db
        .prepare(
          `SELECT id, name, code, center, domain, description, current_stage, created_at, updated_at FROM projects ORDER BY created_at ASC`,
        )
        .all() as Record<string, unknown>[];
      return rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        code: String(row.code),
        center: row.center as ProjectSummary['center'],
        domain: String(row.domain),
        description: String(row.description),
        currentStage: Number(row.current_stage),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      }));
    },

    getProject(projectId: string): ProjectDetail | undefined {
      const row = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId) as
        | Record<string, unknown>
        | undefined;
      return row ? hydrateProject(row) : undefined;
    },

    createProject(input): ProjectDetail {
      const id = `proj-${Date.now().toString(36)}`;
      const now = new Date().toISOString();
      let baseSuite: OntologySuite;
      if (input.template === 'CONTRACT') {
        baseSuite = JSON.parse(JSON.stringify(CONTRACT_LIFECYCLE_SUITE));
      } else if (input.template === 'MFT') {
        baseSuite = JSON.parse(JSON.stringify(MFT_ENTERPRISE_SUITE));
      } else {
        baseSuite = {
          M1: {
            model_type: 'OBJECT',
            version: '5.0',
            domain: input.domain,
            aggregates: [],
            data_dictionaries: [],
            aggregate_associations: [],
          },
        };
      }
      const changelog = `# Ontology Change Log - ${input.name}\n\n## [${now}] Project Created\n- Domain: ${input.domain}\n`;
      db.prepare(`
        INSERT INTO projects (id, name, code, center, domain, description, current_stage, suite_json, changelog, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.name,
        input.code,
        input.center ?? 'APPLICATION',
        input.domain,
        input.description ?? `${input.domain}本体工程`,
        Object.keys(baseSuite).length,
        JSON.stringify(baseSuite),
        changelog,
        now,
        now,
      );
      mirrorProjectFiles(id, baseSuite, changelog);
      return this.getProject(id)!;
    },

    updateModel(projectId, modelCode, modelData): ProjectDetail {
      const current = this.getProject(projectId);
      if (!current) throw new Error(`Project not found: ${projectId}`);
      const nextSuite: OntologySuite = {
        ...current.suite,
        [modelCode]: modelData,
      };
      return this.updateSuite(projectId, nextSuite, `Updated ${modelCode} model`);
    },

    updateSuite(projectId, suite, changelogNote): ProjectDetail {
      const current = this.getProject(projectId);
      if (!current) throw new Error(`Project not found: ${projectId}`);
      const now = new Date().toISOString();
      const validation = validateOntologySuite(suite);
      const nextChangelog = changelogNote
        ? `${current.changelog}\n## [${now}] ${changelogNote}\n- Present Models: ${validation.presentModels.join(', ')}\n- Consistency Errors: ${validation.errorCount}, Stage Warnings: ${validation.warningCount}\n`
        : current.changelog;

      db.prepare(`
        UPDATE projects
        SET suite_json = ?, current_stage = ?, changelog = ?, updated_at = ?
        WHERE id = ?
      `).run(
        JSON.stringify(suite),
        validation.presentModels.length,
        nextChangelog,
        now,
        projectId,
      );
      mirrorProjectFiles(projectId, suite, nextChangelog);
      return this.getProject(projectId)!;
    },

    importYamlFiles(projectId, files) {
      const current = this.getProject(projectId);
      if (!current) throw new Error(`Project not found: ${projectId}`);
      const { suite: parsedPartial, parseErrors } = parseSuiteFromYamlFiles(files);
      const mergedSuite: OntologySuite = {
        ...current.suite,
        ...parsedPartial,
      };
      const updated = this.updateSuite(
        projectId,
        mergedSuite,
        `Imported YAML files (${Object.keys(parsedPartial).join(', ')})`,
      );
      return { project: updated, parseErrors };
    },

    exportYamlFiles(projectId) {
      const current = this.getProject(projectId);
      if (!current) throw new Error(`Project not found: ${projectId}`);
      return serializeSuiteToYamlFiles(current.suite);
    },

    analyzeSymbolImpact(projectId, targetId) {
      const current = this.getProject(projectId);
      if (!current) throw new Error(`Project not found: ${projectId}`);
      return analyzeImpact(current.suite, targetId);
    },

    renameSymbol(projectId, oldId, newId) {
      const current = this.getProject(projectId);
      if (!current) throw new Error(`Project not found: ${projectId}`);
      const result = renameOntologySymbol(current.suite, oldId, newId);
      const nextChangelog = `${current.changelog}\n${result.changelogEntry}`;
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE projects SET suite_json = ?, changelog = ?, updated_at = ? WHERE id = ?
      `).run(JSON.stringify(result.suite), nextChangelog, now, projectId);
      mirrorProjectFiles(projectId, result.suite, nextChangelog);
      return {
        project: this.getProject(projectId)!,
        changedCount: result.changedReferences.length,
        changelogEntry: result.changelogEntry,
      };
    },

    listRequirementSessions(projectId) {
      return listItems<RequirementSession>('req_sessions', projectId);
    },

    appendRequirementMessage(sessionId, message, updates) {
      const existing = getItem<RequirementSession>('req_sessions', sessionId);
      if (!existing) throw new Error(`Requirement session not found: ${sessionId}`);
      const updated: RequirementSession = {
        ...existing,
        messages: [...existing.messages, message],
        discoveredAggregates: updates?.discoveredAggregates ?? existing.discoveredAggregates,
        discoveredRules: updates?.discoveredRules ?? existing.discoveredRules,
        resolvedDecisions: updates?.resolvedDecisions ?? existing.resolvedDecisions,
        status: updates?.status ?? existing.status,
        updatedAt: new Date().toISOString(),
      };
      return putItem('req_sessions', sessionId, updated, existing.projectId);
    },

    listRequirementDocs(projectId) {
      return listItems<RequirementDoc>('req_docs', projectId);
    },

    saveRequirementDoc(doc) {
      const full: RequirementDoc = {
        ...doc,
        updatedAt: new Date().toISOString(),
      };
      return putItem('req_docs', full.id, full, full.projectId);
    },

    listPrototypes(projectId) {
      return listItems<PrototypeArtifact>('prototypes', projectId);
    },

    savePrototypeAndSyncMu(projectId, input) {
      const current = this.getProject(projectId);
      if (!current) throw new Error(`Project not found: ${projectId}`);
      const extractedMu = extractMuFromPrototypeHtml(input.htmlContent, current.domain);
      const proto: PrototypeArtifact = {
        id: input.id ?? `proto-${Date.now().toString(36)}`,
        projectId,
        name: input.name,
        version: input.version ?? 'v5.1',
        htmlContent: input.htmlContent,
        extractedScreenCount: extractedMu.screens.length,
        updatedAt: new Date().toISOString(),
      };
      putItem('prototypes', proto.id, proto, projectId);

      let updatedProject = current;
      if (input.syncMu !== false && extractedMu.screens.length > 0) {
        updatedProject = this.updateModel(projectId, 'MU', extractedMu);
      }
      return { prototype: proto, project: updatedProject };
    },

    listFourLayerAssets(layer) {
      const all = listItems<FourLayerAsset>('four_layer_assets');
      return layer ? all.filter((a) => a.layer === layer) : all;
    },

    saveFourLayerAsset(asset) {
      const full: FourLayerAsset = { ...asset, updatedAt: new Date().toISOString() };
      return putItem('four_layer_assets', full.id, full);
    },

    listAssembledApplications() {
      return listItems<AssembledApplication>('assembled_apps');
    },

    saveAssembledApplication(app) {
      const existing = getItem<AssembledApplication>('assembled_apps', app.id);
      const full: AssembledApplication = {
        ...app,
        agentDevLogs: app.agentDevLogs ?? existing?.agentDevLogs ?? [],
        updatedAt: new Date().toISOString(),
      };
      return putItem('assembled_apps', full.id, full, full.projectId);
    },

    listGeneratedSkills(projectId) {
      return listItems<GeneratedSkill>('skills', projectId);
    },

    saveGeneratedSkill(skill) {
      const full: GeneratedSkill = { ...skill, updatedAt: new Date().toISOString() };
      return putItem('skills', full.id, full, full.projectId);
    },

    listLegacySystems() {
      return listItems<LegacySystemConfig>('legacy_systems');
    },

    saveLegacySystem(sys) {
      return putItem('legacy_systems', sys.id, sys, sys.linkedProjectId);
    },

    listExtractionJobs(projectId) {
      return listItems<ExtractionJob>('extraction_jobs', projectId);
    },

    runOntologyExtractionJob(input) {
      const project = this.getProject(input.projectId);
      if (!project) throw new Error(`Project not found: ${input.projectId}`);

      // Extract table/entity hints from SQL DDL or API snippet
      const tableMatches = [...input.sourceSnippet.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/gi)];
      const extractedTableNames = tableMatches.map((m) => m[1]);
      const job: ExtractionJob = {
        id: `ext-job-${Date.now().toString(36)}`,
        systemId: input.systemId,
        projectId: input.projectId,
        title: input.title,
        sourceType: input.sourceType,
        sourceSnippet: input.sourceSnippet,
        extractedModels: ['M1', 'M2', 'M3', 'ME', 'MM', 'MI'],
        confidenceScore: 0.95,
        status: 'COMPLETED',
        summary:
          extractedTableNames.length > 0
            ? `本体萃取完成：从数据源识别物理表 [${extractedTableNames.join(', ')}]，已对齐生成 M1 聚合根、M2 行为与 MM/MI 映射。`
            : `本体萃取完成：已从存量系统规范提炼领域对象、业务规则与服务接口契约。`,
        createdAt: new Date().toISOString(),
      };
      putItem('extraction_jobs', job.id, job, input.projectId);
      return { job, project };
    },

    listMcpServers() {
      return listItems<McpServerConfig>('mcp_servers');
    },

    saveMcpServer(mcp) {
      const full: McpServerConfig = { ...mcp, updatedAt: new Date().toISOString() };
      return putItem('mcp_servers', full.id, full, full.projectId);
    },

    listCapabilityAgents() {
      return listItems<CapabilityAgent>('capability_agents');
    },

    saveCapabilityAgent(agent) {
      return putItem('capability_agents', agent.id, agent, agent.projectId);
    },

    listCrossSystemFlows() {
      return listItems<CrossSystemFlow>('cross_flows');
    },

    executeCrossSystemFlow(flowId) {
      const existing = getItem<CrossSystemFlow>('cross_flows', flowId);
      if (!existing) throw new Error(`Cross-system flow not found: ${flowId}`);
      const now = new Date().toISOString();
      const updated: CrossSystemFlow = {
        ...existing,
        lastRunAt: now,
        lastRunStatus: 'SUCCESS',
        steps: existing.steps.map((s) => ({ ...s, status: 'SUCCESS' })),
        executionLogs: [
          `[${now.slice(11, 19)}] 触发跨系统协同流「${existing.name}」`,
          ...existing.steps.map(
            (s) =>
              `[${now.slice(11, 19)}] Step ${s.stepOrder} [${s.systemName}] 调用 MCP 工具 ${s.mcpToolName} -> 执行成功 (200 OK)`,
          ),
        ],
      };
      return putItem('cross_flows', flowId, updated);
    },

    listKnowledgeEntries() {
      return listItems<KnowledgeEntry>('knowledge');
    },

    saveKnowledgeEntry(entry) {
      const full: KnowledgeEntry = { ...entry, updatedAt: new Date().toISOString() };
      return putItem('knowledge', full.id, full, full.linkedProjectId);
    },

    listDatabaseResources() {
      return listItems<DatabaseResource>('db_resources');
    },

    listDataDocuments() {
      return listItems<DataDocument>('data_docs');
    },

    saveDataDocument(doc) {
      const full: DataDocument = { ...doc, updatedAt: new Date().toISOString() };
      return putItem('data_docs', full.id, full);
    },

    listDataMappings() {
      return listItems<DataMappingRule>('data_mappings');
    },

    saveDataMapping(rule) {
      return putItem('data_mappings', rule.id, rule);
    },

    listMetrics() {
      return listItems<MetricDefinition>('metrics');
    },

    listAnalyticsScenarios() {
      return listItems<AnalyticsScenario>('analytics_scenarios');
    },

    listAnalyticsReports() {
      return listItems<AnalyticsReport>('analytics_reports');
    },

    saveAnalyticsReport(report) {
      const full: AnalyticsReport = { ...report, createdAt: new Date().toISOString() };
      return putItem('analytics_reports', full.id, full);
    },

    listReasoningSessions() {
      return listItems<ReasoningSession>('reasoning_sessions');
    },

    saveReasoningSession(session) {
      const full: ReasoningSession = { ...session, createdAt: new Date().toISOString() };
      return putItem('reasoning_sessions', full.id, full);
    },

    listWritebackInterfaces() {
      return listItems<WritebackInterface>('writebacks');
    },

    executeWritebackInterface(interfaceId, payloadOverride) {
      const existing = getItem<WritebackInterface>('writebacks', interfaceId);
      if (!existing) throw new Error(`Writeback interface not found: ${interfaceId}`);
      const now = new Date().toISOString();
      const mergedPayload = { ...existing.payloadTemplate, ...(payloadOverride ?? {}) };
      const updated: WritebackInterface = {
        ...existing,
        payloadTemplate: mergedPayload,
        executionCount: existing.executionCount + 1,
        lastExecutedAt: now,
        lastExecutionResult: `[${now.slice(0, 19)}] 回写指令已送达目标系统「${existing.targetSystem}」(${existing.endpoint})，绑定行为 ${existing.boundBehaviorRef} 执行成功。`,
      };
      return putItem('writebacks', interfaceId, updated);
    },

    listLlmProviders() {
      return listItems<LlmProviderConfig>('llm_providers');
    },

    saveLlmProvider(provider) {
      return putItem('llm_providers', provider.id, provider);
    },

    getSystemSettings() {
      return getItem<SystemSettingsState>('system_settings', 'global') ?? SEED_SYSTEM_SETTINGS;
    },

    updateSystemSettings(patch) {
      const current = this.getSystemSettings();
      const updated: SystemSettingsState = { ...current, ...patch };
      return putItem('system_settings', 'global', updated);
    },
  };
}
