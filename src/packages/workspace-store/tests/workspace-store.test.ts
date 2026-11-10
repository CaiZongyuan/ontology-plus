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
    expect(providers[0].baseUrl).toBe('http://127.0.0.1:3425/v1');
    expect(providers[0].defaultModel).toBe('auto/glm-5.3-flash');
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
});

