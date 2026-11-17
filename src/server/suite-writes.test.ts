import { describe, expect, it } from 'vitest';
import { serializeModelYaml } from '../packages/ontology-core/index.js';
import {
  createWorkspaceStore,
  type ExtractionJob,
  type ProjectDetail,
  type ProjectSnapshot,
  type SuiteCommitEvent,
} from '../packages/workspace-store/index.js';
import { createApiApp } from './app.js';

function createObservedApp() {
  const commits: SuiteCommitEvent[] = [];
  const store = createWorkspaceStore({
    dbPath: ':memory:',
    enableFileMirror: false,
    onSuiteCommit: (event) => commits.push(event),
  });
  const api = createApiApp(store);
  return { store, api, commits };
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('HTTP OntologySuite write endpoints (unified write seam)', () => {
  it('saves whole suite and single model with MANUAL source, allowing Consistency Errors in expert edits', async () => {
    const { store, api, commits } = createObservedApp();
    const contract = store.getProject('proj-contract')!;

    // Introduce a dangling ownerEntity reference in M2 -> Consistency Error
    const brokenM2 = {
      ...contract.suite.M2!,
      behaviors: [
        ...contract.suite.M2!.behaviors,
        {
          ...contract.suite.M2!.behaviors[0]!,
          id: 'BHV-DANGLING-99',
          name: 'orphanAction',
          alias: '悬空测试动作',
          ownerEntity: 'NonExistentAggregateRoot',
        },
      ],
    };

    const putSuiteRes = await api.request(
      '/api/projects/proj-contract/suite',
      jsonInit('PUT', {
        suite: { ...contract.suite, M2: brokenM2 },
        changelogNote: 'Expert whole-suite save with dangling ref',
      }),
    );
    expect(putSuiteRes.status).toBe(200);
    const putSuiteJson = (await putSuiteRes.json()) as { project: ProjectDetail };
    expect(putSuiteJson.project.validation.errorCount).toBeGreaterThan(0);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      projectId: 'proj-contract',
      source: { kind: 'MANUAL' },
      note: 'Expert whole-suite save with dangling ref',
    });

    // Single-model YAML save with Consistency Error must also succeed and record modelCode
    const brokenM2Yaml = serializeModelYaml('M2', brokenM2);
    const putModelRes = await api.request(
      '/api/projects/proj-contract/models/M2',
      jsonInit('PUT', { yamlText: brokenM2Yaml }),
    );
    expect(putModelRes.status).toBe(200);
    const putModelJson = (await putModelRes.json()) as { project: ProjectDetail };
    expect(putModelJson.project.validation.errorCount).toBeGreaterThan(0);
    expect(commits).toHaveLength(2);
    expect(commits[1]).toMatchObject({
      projectId: 'proj-contract',
      source: { kind: 'MANUAL', modelCode: 'M2' },
    });

    // Malformed YAML syntax is still rejected with 400 and does NOT commit
    const badYamlRes = await api.request(
      '/api/projects/proj-contract/models/M2',
      jsonInit('PUT', { yamlText: '::invalid: [yaml' }),
    );
    expect(badYamlRes.status).toBe(400);
    expect(commits).toHaveLength(2);
  });

  it('imports YAML files, renames symbols, restores snapshots, and confirms prototype revisions through commitSuite', async () => {
    const { store, api, commits } = createObservedApp();
    const contract = store.getProject('proj-contract')!;

    // 1. Create a baseline snapshot first
    const snapRes = await api.request(
      '/api/projects/proj-contract/snapshots',
      jsonInit('POST', { label: 'Baseline v1' }),
    );
    expect(snapRes.status).toBe(200);
    const { snapshot } = (await snapRes.json()) as { snapshot: ProjectSnapshot };
    expect(commits).toHaveLength(0);

    // 2. Import YAML files (introducing a dangling reference to prove YAML import allows Consistency Errors)
    const brokenM3 = {
      ...contract.suite.M3!,
      rules: [
        ...contract.suite.M3!.rules,
        {
          ...contract.suite.M3!.rules[0]!,
          id: 'RUL-IMPORT-BROKEN',
          name: 'ImportedBrokenRule',
          referencedObjects: ['MissingAggregateFromImport'],
        },
      ],
    };
    const importRes = await api.request(
      '/api/projects/proj-contract/yaml/import',
      jsonInit('POST', { files: { M3: serializeModelYaml('M3', brokenM3) } }),
    );
    expect(importRes.status).toBe(200);
    const importJson = (await importRes.json()) as { project: ProjectDetail; parseErrors: unknown[] };
    expect(importJson.parseErrors).toEqual([]);
    expect(importJson.project.validation.errorCount).toBeGreaterThan(0);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      projectId: 'proj-contract',
      source: { kind: 'YAML_IMPORT', models: ['M3'] },
    });

    // 3. Restore snapshot
    const restoreRes = await api.request(
      `/api/projects/proj-contract/snapshots/${snapshot.id}/restore`,
      { method: 'POST' },
    );
    expect(restoreRes.status).toBe(200);
    const restoreJson = (await restoreRes.json()) as { project: ProjectDetail };
    expect(restoreJson.project.validation.errorCount).toBe(0);
    expect(commits).toHaveLength(2);
    expect(commits[1]).toMatchObject({
      projectId: 'proj-contract',
      source: { kind: 'SNAPSHOT_RESTORE', snapshotId: snapshot.id },
    });

    // 4. Cascade symbol rename
    const renameRes = await api.request(
      '/api/projects/proj-contract/rename',
      jsonInit('POST', { oldId: 'SettlementOrder', newId: 'PaymentSettlement' }),
    );
    expect(renameRes.status).toBe(200);
    const renameJson = (await renameRes.json()) as {
      project: ProjectDetail;
      changedCount: number;
      changelogEntry: string;
    };
    expect(renameJson.changedCount).toBeGreaterThan(3);
    expect(renameJson.project.changelog).toContain(renameJson.changelogEntry);
    expect(commits).toHaveLength(3);
    expect(commits[2]).toMatchObject({
      projectId: 'proj-contract',
      source: {
        kind: 'SYMBOL_RENAME',
        oldId: 'SettlementOrder',
        newId: 'PaymentSettlement',
      },
    });

    // 5. Confirm prototype revision
    const proto = store.listPrototypes('proj-contract')[0]!;
    const revId = proto.currentRevisionId;
    const confirmRes = await api.request(
      '/api/projects/proj-contract/prototypes/confirm-revision',
      jsonInit('POST', { revisionId: revId }),
    );
    expect(confirmRes.status).toBe(200);
    expect(commits).toHaveLength(4);
    expect(commits[3]).toMatchObject({
      projectId: 'proj-contract',
      source: {
        kind: 'PROTOTYPE_CONFIRM',
        prototypeId: proto.id,
        revisionId: revId,
      },
    });
  });

  it('commits extraction jobs with EXTRACTION_APPLY source both on immediate apply and reviewed apply, skipping unmerged or blocked jobs', async () => {
    const { store, api, commits } = createObservedApp();

    // 1. Immediate extraction apply (applyImmediately defaults to true)
    const immediateRes = await api.request(
      '/api/capability/extraction-jobs',
      jsonInit('POST', {
        systemId: 'sys-mft-transfer',
        projectId: 'proj-mft',
        title: 'Immediate DDL extraction',
        sourceType: 'DDL_AND_OPENAPI',
        sourceSnippet: 'CREATE TABLE t_mft_partner (id VARCHAR(36) PRIMARY KEY, partner_code VARCHAR(64) NOT NULL);',
      }),
    );
    expect(immediateRes.status).toBe(200);
    const immediateJson = (await immediateRes.json()) as { job: ExtractionJob; project: ProjectDetail };
    expect(immediateJson.job.appliedToProject).toBe(true);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      projectId: 'proj-mft',
      source: { kind: 'EXTRACTION_APPLY', jobId: immediateJson.job.id },
    });

    // 2. Staged extraction (applyImmediately: false) does NOT commit until /apply
    const stagedRes = await api.request(
      '/api/capability/extraction-jobs',
      jsonInit('POST', {
        systemId: 'sys-mft-transfer',
        projectId: 'proj-mft',
        title: 'Reviewed DDL extraction',
        sourceType: 'DDL_AND_OPENAPI',
        sourceSnippet: 'CREATE TABLE t_mft_channel (id VARCHAR(36) PRIMARY KEY, channel_name VARCHAR(64) NOT NULL);',
        applyImmediately: false,
      }),
    );
    expect(stagedRes.status).toBe(200);
    const stagedJson = (await stagedRes.json()) as { job: ExtractionJob };
    expect(stagedJson.job.appliedToProject).toBe(false);
    expect(commits).toHaveLength(1);

    const decisions = Object.fromEntries(
      stagedJson.job.candidates.map((cand) => [cand.key, 'ACCEPTED' as const]),
    );
    await api.request(
      `/api/capability/extraction-jobs/${stagedJson.job.id}/decisions`,
      jsonInit('PUT', { decisions }),
    );

    const applyRes = await api.request(
      `/api/capability/extraction-jobs/${stagedJson.job.id}/apply`,
      { method: 'POST' },
    );
    expect(applyRes.status).toBe(200);
    expect(commits).toHaveLength(2);
    expect(commits[1]).toMatchObject({
      projectId: 'proj-mft',
      source: { kind: 'EXTRACTION_APPLY', jobId: stagedJson.job.id },
    });

    // 3. Blocked merge (accepting behaviors while rejecting their aggregate -> new Consistency Errors) returns 409 and does NOT call commitSuite
    const blockedCreateRes = await api.request(
      '/api/capability/extraction-jobs',
      jsonInit('POST', {
        systemId: 'sys-mft-transfer',
        projectId: 'proj-mft',
        title: 'Partial DDL extraction',
        sourceType: 'DDL_AND_OPENAPI',
        sourceSnippet:
          'CREATE TABLE t_sales_order (id VARCHAR(36) PRIMARY KEY, order_no VARCHAR(32) NOT NULL);',
        applyImmediately: false,
      }),
    );
    expect(blockedCreateRes.status).toBe(200);
    const blockedCreated = (await blockedCreateRes.json()) as { job: ExtractionJob };
    const partialDecisions = Object.fromEntries(
      blockedCreated.job.candidates.map((cand) => [
        cand.key,
        cand.collection === 'aggregates' ? ('REJECTED' as const) : ('ACCEPTED' as const),
      ]),
    );
    await api.request(
      `/api/capability/extraction-jobs/${blockedCreated.job.id}/decisions`,
      jsonInit('PUT', { decisions: partialDecisions }),
    );
    const blockedApplyRes = await api.request(
      `/api/capability/extraction-jobs/${blockedCreated.job.id}/apply`,
      { method: 'POST' },
    );
    expect(blockedApplyRes.status).toBe(409);
    expect(await blockedApplyRes.json()).toMatchObject({ code: 'MERGE_BLOCKED' });
    expect(commits).toHaveLength(2);
  });

  it('attributes Copilot ontology tools, synthesize_ontology_suite, and immediate agent extraction to AGENT_RUN with the turn user message runId', async () => {
    const { store, api, commits } = createObservedApp();

    const runAgentTurn = async (
      projectId: string,
      agentKind: 'COPILOT' | 'CAPABILITY',
      prompt: string,
    ) => {
      const createRes = await api.request(
        '/api/agent-sessions',
        jsonInit('POST', { projectId, agentKind, title: `${agentKind} Suite Write Test` }),
      );
      expect(createRes.status).toBe(200);
      const { session } = (await createRes.json()) as { session: { id: string } };

      const streamRes = await api.request(
        `/api/agent-sessions/${session.id}/stream`,
        jsonInit('POST', { prompt, mockMode: true }),
      );
      expect(streamRes.status).toBe(200);
      const sseText = await streamRes.text();
      expect(sseText).toContain('event: message_end');

      const savedSession = store.getAgentSession(session.id)!;
      const userMsg = savedSession.messages.find((m) => m.role === 'user')!;
      return { sessionId: session.id, runId: userMsg.id };
    };

    // 1. Copilot ontology mutation tool (upsert_rule)
    const copilotTurn = await runAgentTurn(
      'proj-contract',
      'COPILOT',
      '请新增一条跨境大额合同双签审批规则',
    );
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      projectId: 'proj-contract',
      source: {
        kind: 'AGENT_RUN',
        runId: copilotTurn.runId,
        sessionId: copilotTurn.sessionId,
        toolName: 'upsert_rule',
      },
    });

    // 2. synthesize_ontology_suite in COPILOT session
    const emptyProj = store.createProject({
      name: '仓储拣货测试工程',
      code: 'WMS_PICK',
      domain: '智能仓储',
      template: 'EMPTY',
    });
    const createdProto = store.createPrototype(emptyProj.id, {
      name: '拣货工作台',
      htmlContent:
        '<section data-screen-id="SCR-PICK" data-screen-name="拣货台"><input data-element-id="EL-TASK-NO" data-binding="PickTask.taskNo" /><button data-element-id="EL-COMPLETE" data-event-id="EVT-PICK-DONE">完成拣货</button></section>',
      source: 'GENERATED',
    });
    store.confirmPrototypeRevision(emptyProj.id, createdProto.revision.id);
    const commitsAfterConfirm = commits.length;

    const synthTurn = await runAgentTurn(
      emptyProj.id,
      'COPILOT',
      `[ACTION:SYNTHESIZE_ONTOLOGY_SUITE {"prototypeId":"${createdProto.prototype.id}"}]\n请合成 11 模型本体套件`,
    );
    expect(commits).toHaveLength(commitsAfterConfirm + 1);
    expect(commits.at(-1)).toMatchObject({
      projectId: emptyProj.id,
      source: {
        kind: 'AGENT_RUN',
        runId: synthTurn.runId,
        sessionId: synthTurn.sessionId,
        toolName: 'synthesize_ontology_suite',
      },
    });

    // 3. run_ontology_extraction with applyImmediately: true in CAPABILITY session
    const extractTurn = await runAgentTurn(
      'proj-mft',
      'CAPABILITY',
      `[ACTION:RUN_ONTOLOGY_EXTRACTION ${JSON.stringify({
        systemId: 'sys-mft-transfer',
        sourceType: 'DDL_AND_OPENAPI',
        sourceSnippet:
          'CREATE TABLE t_mft_audit_entry (id VARCHAR(36) PRIMARY KEY, trace_no VARCHAR(64) NOT NULL);',
        applyImmediately: true,
      })}]\n立即执行本体萃取并合入工程`,
    );
    expect(commits).toHaveLength(commitsAfterConfirm + 2);
    expect(commits.at(-1)).toMatchObject({
      projectId: 'proj-mft',
      source: {
        kind: 'AGENT_RUN',
        runId: extractTurn.runId,
        sessionId: extractTurn.sessionId,
        toolName: 'run_ontology_extraction',
      },
    });
  });

  it('does not commit agent mutations blocked by the consistency validator, and leaves project creation/clone out of commitSuite', async () => {
    const { store, api, commits } = createObservedApp();

    // 1. Creating or cloning a project inserts a new row and must not trigger suite mutation commits
    const createProjRes = await api.request(
      '/api/projects',
      jsonInit('POST', {
        name: '新工程',
        code: 'NEW_PROJ',
        domain: '测试域',
        template: 'EMPTY',
      }),
    );
    expect(createProjRes.status).toBe(200);
    const cloneProjRes = await api.request(
      '/api/projects/proj-mft/clone',
      jsonInit('POST', { name: '克隆工程', code: 'MFT_CLONE' }),
    );
    expect(cloneProjRes.status).toBe(200);
    expect(commits).toHaveLength(0);

    // 2. Copilot validator gate blocks delete_element(AGG-01) (0 commits) and commits only the self-repaired upsert_scenario
    const sessRes = await api.request(
      '/api/agent-sessions',
      jsonInit('POST', {
        projectId: 'proj-contract',
        agentKind: 'COPILOT',
        title: 'Validator Gate Test',
      }),
    );
    const { session } = (await sessRes.json()) as { session: { id: string } };
    const streamRes = await api.request(
      `/api/agent-sessions/${session.id}/stream`,
      jsonInit('POST', { prompt: '执行悬空自修复测试', mockMode: true }),
    );
    expect(streamRes.status).toBe(200);
    const sseText = await streamRes.text();
    expect(sseText).toContain('delete_element');
    expect(sseText).toContain('upsert_scenario');

    const savedSession = store.getAgentSession(session.id)!;
    const userMsg = savedSession.messages.find((m) => m.role === 'user')!;

    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      projectId: 'proj-contract',
      source: {
        kind: 'AGENT_RUN',
        runId: userMsg.id,
        sessionId: session.id,
        toolName: 'upsert_scenario',
      },
    });
    expect(store.getProject('proj-contract')!.suite.M1?.aggregates.some((a) => a.id === 'AGG-01')).toBe(
      true,
    );
  });
});
