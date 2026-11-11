import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWorkspaceStore } from '../index.js';

describe('workspace-store deep module', () => {
  it('seeds complete Contract Lifecycle and MFT projects, 4-layer assets, capability center, analytics center, and local Pi LLM config', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });

    const projects = store.listProjects();
    expect(projects.length).toBeGreaterThanOrEqual(2);

    const contractProj = store.getProject('proj-contract');
    expect(contractProj).toBeDefined();
    expect(contractProj!.validation.valid).toBe(true);
    expect(contractProj!.validation.errorCount).toBe(0);
    expect(contractProj!.validation.presentModels).toHaveLength(11);

    const assets = store.listFourLayerAssets();
    expect(assets.length).toBeGreaterThanOrEqual(5);

    const providers = store.listLlmProviders();
    expect(providers[0].id).toBe('llm-pi-local');
    expect(providers[0].baseUrl).toBe('http://127.0.0.1:3425/v1');
    expect(providers[0].defaultModel).toBe('auto/glm-5.3-flash');

    const chatSessions = store.listCapabilityChatSessions('agent-contract-risk');
    expect(chatSessions.length).toBeGreaterThanOrEqual(1);
    expect(chatSessions[0].agentId).toBe('agent-contract-risk');
  });

  it('supports cascade symbol rename, extraction jobs, cross-system flow execution, and write-back execution', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });

    const renameResult = store.renameSymbol('proj-contract', 'SettlementOrder', 'PaymentSettlement');
    expect(renameResult.changedCount).toBeGreaterThan(3);
    expect(renameResult.project.validation.valid).toBe(true);
    expect(renameResult.project.changelog).toContain('SettlementOrder');

    const { job } = store.runOntologyExtractionJob({
      systemId: 'sys-mft-transfer',
      projectId: 'proj-mft',
      title: '增量表结构本体萃取',
      sourceType: 'DDL_AND_OPENAPI',
      sourceSnippet: 'CREATE TABLE mft_audit_log (id VARCHAR(36) PRIMARY KEY, action VARCHAR(64));',
    });
    expect(job.status).toBe('COMPLETED');
    expect(job.summary).toContain('mft_audit_log');

    const flow = store.executeCrossSystemFlow('xflow-contract-seal-archive');
    expect(flow.lastRunStatus).toBe('SUCCESS');

    const wb = store.executeWritebackInterface('WB-01', { operatorNote: '自动催收冻结' });
    expect(wb.executionCount).toBe(3);
    expect(wb.lastExecutionResult).toContain('BHV-03');
  });

  it('executes read-only analytics SQL with named params, dictionary __label enrichment, and strict DDL/DML blocking', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });

    const res = store.executeReadOnlyAnalyticsSql(
      `SELECT c.contract_no, c.status, c.risk_level, cp.credit_rating, c.overdue_days, c.created_by, c.flag
       FROM t_contract c
       JOIN t_counterparty cp ON c.counterparty_id = cp.id
       WHERE c.region = :region AND c.industry = :industry AND c.overdue_days > :minOverdue
       ORDER BY c.overdue_days DESC;`,
      { region: '华东区', industry: '半导体', minOverdue: 10 },
    );

    expect(res.rowCount).toBeGreaterThanOrEqual(3);
    expect(res.columns).toContain('status__label');
    expect(res.columns).toContain('risk_level__label');
    expect(res.columns).toContain('credit_rating__label');

    const topRow = res.rows[0];
    expect(topRow.status).toBe('EXECUTING');
    expect(topRow.status__label).toBe('履约执行中');
    expect(topRow.risk_level).toBe('HIGH');
    expect(topRow.risk_level__label).toBe('高风险');
    expect(topRow.credit_rating).toBe('A');
    expect(topRow.credit_rating__label).toContain('A级');
    expect(topRow.flag).toBe(1);

    // Block DML / DDL / comments / multi-statements
    expect(() =>
      store.executeReadOnlyAnalyticsSql('DELETE FROM t_contract WHERE 1 = 1'),
    ).toThrow(/Read-only analytics SQL violation/i);
    expect(() =>
      store.executeReadOnlyAnalyticsSql('DROP TABLE t_contract'),
    ).toThrow(/Read-only analytics SQL violation/i);
    expect(() =>
      store.executeReadOnlyAnalyticsSql('PRAGMA table_info(t_contract)'),
    ).toThrow(/Read-only analytics SQL violation/i);
    expect(() =>
      store.executeReadOnlyAnalyticsSql('SELECT * FROM t_contract; SELECT * FROM __dict'),
    ).toThrow(/Read-only analytics SQL violation/i);
    expect(() =>
      store.executeReadOnlyAnalyticsSql('SELECT * FROM t_contract -- inline comment'),
    ).toThrow(/Read-only analytics SQL violation/i);
  });

  it('supports two-step DDL + OpenAPI extraction and applyExtractionJobToProject with 0 consistency errors', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });

    const beforeProj = store.getProject('proj-mft')!;
    const beforeAggCount = beforeProj.suite.M1!.aggregates.length;

    const snippet = `
CREATE TABLE t_mft_node_cluster (
  id VARCHAR(36) PRIMARY KEY,
  cluster_code VARCHAR(32) NOT NULL UNIQUE,
  bandwidth_mbps INTEGER NOT NULL,
  active BOOLEAN NOT NULL
);
CREATE TABLE t_mft_route_policy (
  id VARCHAR(36) PRIMARY KEY,
  policy_name VARCHAR(128) NOT NULL,
  cluster_id VARCHAR(36) NOT NULL REFERENCES t_mft_node_cluster(id)
);
openapi: 3.0.0
paths:
  /api/v1/mft/clusters:
    get:
      operationId: listNodeClusters
      summary: 查询跨网传输节点集群列表
    post:
      operationId: registerNodeCluster
      summary: 注册跨网传输节点集群
`;

    const { job, project: unmutatedProj } = store.runOntologyExtractionJob({
      systemId: 'sys-mft-transfer',
      projectId: 'proj-mft',
      title: 'MFT 集群与路由策略两步萃取审阅',
      sourceType: 'DDL_AND_OPENAPI',
      sourceSnippet: snippet,
      applyImmediately: false,
    });

    expect(job.appliedToProject).toBe(false);
    expect(job.extractedTablesCount).toBe(2);
    expect(job.extractedEntitiesCount).toBe(2);
    expect(job.extractedInterfacesCount).toBe(2);
    const candidateOf = (collection: string, name: string) =>
      job.candidates.find(
        (c) => c.collection === collection && JSON.stringify(c.element).includes(`"${name}"`),
      );
    expect(candidateOf('aggregates', 'MftNodeCluster')).toBeDefined();
    expect(candidateOf('mappings', 'MftRoutePolicy')).toBeDefined();
    expect(job.candidates.filter((c) => c.collection === 'interfaces').length).toBeGreaterThanOrEqual(2);
    expect(unmutatedProj.suite.M1!.aggregates.length).toBe(beforeAggCount);

    // Nothing is merged until candidates are confirmed.
    expect(() => store.applyExtractionJobToProject(job.id)).toThrow(/No accepted candidates/);
    store.saveExtractionDecisions(
      job.id,
      Object.fromEntries(job.candidates.map((c) => [c.key, 'ACCEPTED' as const])),
    );

    const applied = store.applyExtractionJobToProject(job.id);
    expect(applied.blockedBy).toEqual([]);
    expect(applied.job.appliedToProject).toBe(true);
    expect(applied.job.appliedCandidateCount).toBe(job.candidates.length);
    expect(applied.job.status).toBe('REVIEWED');
    expect(applied.project.suite.M1!.aggregates.some((a) => a.name === 'MftNodeCluster')).toBe(true);
    expect(applied.project.validation.valid).toBe(true);
    expect(applied.project.validation.errorCount).toBe(0);
  });

  it('mirrors onto-cs.db and manifest.json, and persists requirement sessions, capability chats, analytics mutations, and durable checkpoints', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onto-cs-test-'));
    try {
      const store = createWorkspaceStore({
        workspaceRoot: tmpDir,
        enableFileMirror: true,
      });

      // Verify default onto-cs.db and mirrored manifest.json
      expect(fs.existsSync(path.join(tmpDir, 'onto-cs.db'))).toBe(true);
      const manifestPath = path.join(tmpDir, 'model', 'proj-contract', 'yaml', 'manifest.json');
      expect(fs.existsSync(manifestPath)).toBe(true);

      const exportedManifest = JSON.parse(store.exportManifestJson('proj-contract')) as {
        projectId: string;
        models: Record<string, string>;
      };
      expect(exportedManifest.projectId).toBe('proj-contract');
      expect(exportedManifest.models.M1).toBe('m1-object-model.yaml');
      expect(exportedManifest.models.MI).toBe('mi-interface-model.yaml');

      // Requirement session creation & lookup
      const reqSess = store.createRequirementSession({
        projectId: 'proj-contract',
        title: '合同归档与多币种结算补充需求',
        initialPrompt: '需要支持跨境美元合同汇率锁定与自动折算。',
      });
      expect(reqSess.status).toBe('EXPLORING');
      expect(reqSess.messages).toHaveLength(1);
      expect(store.getRequirementSession(reqSess.id)?.title).toBe('合同归档与多币种结算补充需求');

      // Capability chat session persistence
      const savedChat = store.saveCapabilityChatSession({
        id: 'cap-chat-test-02',
        agentId: 'agent-contract-risk',
        projectId: 'proj-contract',
        title: '履约里程碑催收测试会话',
        messages: [
          {
            id: 'm-1',
            role: 'user',
            content: '列出逾期超过 20 天的合同。',
            timestamp: '2026-11-10T12:00:00.000Z',
          },
        ],
      });
      expect(savedChat.updatedAt).toBeTruthy();
      expect(
        store.listCapabilityChatSessions('agent-contract-risk').some((s) => s.id === 'cap-chat-test-02'),
      ).toBe(true);

      // Analytics resource / metric / scenario persistence
      store.saveDatabaseResource({
        id: 'db-ext-clickhouse',
        name: '供应链实时风控 OLAP 备库',
        dialect: 'ClickHouse',
        connectionUri: 'clickhouse://127.0.0.1:8123/risk_dw',
        status: 'SYNCED',
        tables: [],
      });
      expect(store.listDatabaseResources().some((d) => d.id === 'db-ext-clickhouse')).toBe(true);

      store.saveMetric({
        id: 'MET-99',
        code: 'MFT_ARCHIVE_SLA_RATE',
        name: '合同定稿 MFT 加密归档及时率',
        category: '跨网协同',
        formula: 'COUNT(archived_within_1h) / COUNT(total_approved)',
        unit: '%',
        currentValue: '99.2%',
        yoYChange: '+1.5%',
        status: 'NORMAL',
        dimensions: ['安全域 (securityDomain)'],
        linkedAggregate: 'Contract',
      });
      expect(store.listMetrics().some((m) => m.id === 'MET-99')).toBe(true);

      store.saveAnalyticsScenario({
        id: 'ascn-99',
        name: '跨网归档延迟预警分析',
        domain: '企业文件安全传输系统 (MFT)',
        triggerCondition: 'MFT_ARCHIVE_SLA_RATE < 95%',
        relatedMetrics: ['MET-99'],
        causalFactors: ['大体积附件扫描队列堆积'],
        recommendedActions: ['扩容脱敏扫描节点'],
        writebackInterfaceId: 'WB-01',
      });
      expect(store.listAnalyticsScenarios().some((s) => s.id === 'ascn-99')).toBe(true);

      // Durable agent checkpoints
      store.saveAgentCheckpoint(
        'ckpt-sess-01',
        'ontology-assistant',
        JSON.stringify({ step: 2, pendingModel: 'M3' }),
      );
      const loadedCkpt = store.loadAgentCheckpoint('ckpt-sess-01');
      expect(loadedCkpt).toBeDefined();
      expect(loadedCkpt!.workflow).toBe('ontology-assistant');
      expect(JSON.parse(loadedCkpt!.stateJson)).toEqual({ step: 2, pendingModel: 'M3' });
      expect(store.listAgentCheckpoints('ontology-assistant')).toHaveLength(1);

      // Progressive lifecycle clean-slate project creation & YAML mirror hygiene
      const cleanProj = store.createProject({
        name: '咖啡店管理系统',
        code: 'COFFEE-POS',
        domain: '门店零售与饮品制作',
      });
      expect(cleanProj.currentStage).toBe(0);
      expect(cleanProj.validation.presentModels).toEqual([]);
      expect(cleanProj.validation.errorCount).toBe(0);
      expect(cleanProj.knowledgeGraph.nodes).toEqual([]);
      const cleanYamlDir = path.join(tmpDir, 'model', cleanProj.id, 'yaml');
      expect(fs.existsSync(cleanYamlDir)).toBe(false);

      // Resetting a pre-populated demo template project to {} removes mirrored yaml directory
      const demoClone = store.createProject({
        name: '临时模板验证工程',
        code: 'TMP-DEMO',
        domain: '临时模板测试',
        template: 'CONTRACT',
      });
      const demoYamlDir = path.join(tmpDir, 'model', demoClone.id, 'yaml');
      expect(fs.existsSync(path.join(demoYamlDir, 'm1-object-model.yaml'))).toBe(true);
      const resetDemo = store.updateSuite(demoClone.id, {}, 'Reset demo template to clean slate');
      expect(resetDemo.currentStage).toBe(0);
      expect(resetDemo.validation.presentModels).toEqual([]);
      expect(fs.existsSync(demoYamlDir)).toBe(false);
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore Windows file-handle lock on open SQLite temp file until process exit
      }
    }
  });
  it('upgrades a job stored as a whole-suite snapshot into candidates on first read', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onto-cs-legacy-'));
    try {
      const store = createWorkspaceStore({ workspaceRoot: tmpDir, enableFileMirror: false });
      const project = store.getProject('proj-mft')!;

      // What an older version persisted: the suite as extraction left it, and a score.
      const snapshot = JSON.parse(JSON.stringify(project.suite)) as typeof project.suite;
      snapshot.M1!.aggregates.push({
        ...snapshot.M1!.aggregates[0]!,
        id: 'AGG-LEGACY-01',
        name: 'LegacyAuditLog',
        alias: '旧版萃取出的审计日志',
      });
      const legacyJob = (id: string, appliedToProject: boolean) => ({
        id,
        systemId: 'sys-mft-transfer',
        projectId: 'proj-mft',
        title: '旧版任务',
        sourceType: 'DDL_AND_OPENAPI',
        sourceSnippet: 'CREATE TABLE legacy_audit_log (id INTEGER PRIMARY KEY);',
        extractedModels: ['M1'],
        confidenceScore: 0.95,
        status: 'COMPLETED',
        summary: '旧版任务',
        candidateSuite: snapshot,
        appliedToProject,
        createdAt: '2026-01-01T00:00:00.000Z',
      });

      const req = createRequire(import.meta.url);
      const { DatabaseSync } = req('node:sqlite') as {
        DatabaseSync: new (p: string) => {
          prepare(sql: string): { run(...args: unknown[]): unknown };
          close(): void;
        };
      };
      const raw = new DatabaseSync(path.join(tmpDir, 'onto-cs.db'));
      for (const job of [legacyJob('ext-legacy-open', false), legacyJob('ext-legacy-merged', true)]) {
        raw
          .prepare(
            `INSERT INTO workspace_entities (collection, item_id, project_id, payload_json, updated_at) VALUES (?, ?, ?, ?, ?)`,
          )
          .run('extraction_jobs', job.id, job.projectId, JSON.stringify(job), job.createdAt);
      }
      raw.close();

      const jobs = store.listExtractionJobs('proj-mft');
      const open = jobs.find((j) => j.id === 'ext-legacy-open')!;
      expect(open.candidates.map((c) => c.elementId)).toEqual(['AGG-LEGACY-01']);
      expect(open.decisions).toEqual({});
      expect(open.semanticAlignment).toEqual({ status: 'SKIPPED', reason: 'LEGACY_JOB' });
      expect('candidateSuite' in open).toBe(false);
      expect('confidenceScore' in open).toBe(false);

      const merged = jobs.find((j) => j.id === 'ext-legacy-merged')!;
      expect(merged.appliedToProject).toBe(true);
      expect(merged.candidates).toEqual([]);

      // The upgraded job goes through the ordinary confirm-then-merge path.
      store.saveExtractionDecisions(open.id, { 'M1/aggregates/AGG-LEGACY-01': 'ACCEPTED' });
      const applied = store.applyExtractionJobToProject(open.id);
      expect(applied.blockedBy).toEqual([]);
      expect(applied.project.suite.M1!.aggregates.some((a) => a.id === 'AGG-LEGACY-01')).toBe(true);
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore Windows file-handle lock on open SQLite temp file until process exit
      }
    }
  });
});
