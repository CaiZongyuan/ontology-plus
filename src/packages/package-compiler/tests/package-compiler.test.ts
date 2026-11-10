import { describe, expect, it } from 'vitest';
import { createWorkspaceStore } from '../../workspace-store/index.js';
import {
  compileDevelopmentPackage,
  compileOntologySkill,
  handleOntologyMcpRequest,
  inspectOntologyMcpCapabilities,
} from '../index.js';

describe('package-compiler deep module', () => {
  it('compiles a complete 4-layer Development Package with progressive-disclosure guides and 11 YAML files', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const project = store.getProject('proj-contract')!;
    const app = store.listAssembledApplications()[0];
    const uiAsset = store.listFourLayerAssets('UI_UE')[0];
    const foundationAsset = store.listFourLayerAssets('TECH_FOUNDATION')[0];
    const archAsset = store.listFourLayerAssets('TECH_ARCH')[0];
    const reqDoc = store.listRequirementDocs('proj-contract')[0];
    const proto = store.listPrototypes('proj-contract')[0];

    const compiled = compileDevelopmentPackage({
      app,
      project,
      uiUeAsset: uiAsset,
      techFoundationAsset: foundationAsset,
      techArchAsset: archAsset,
      requirementDoc: reqDoc,
      prototype: proto,
      writeToDisk: false,
    });

    const paths = compiled.files.map((f) => f.relativePath);
    expect(paths).toContain('开发指导书.md');
    expect(paths).toContain('本体模型业务功能开发指导书.md');
    expect(paths).toContain('开发资料清单.json');
    expect(paths).toContain('参考资料/UI-UE界面设计规范.md');
    expect(paths).toContain('参考资料/界面原型.html');
    expect(paths).toContain('参考资料/本体模型/m1-object-model.yaml');
    expect(paths).toContain('参考资料/本体模型/mi-interface-model.yaml');

    const skill = compileOntologySkill(project);
    expect(skill.skillMarkdown).toContain('name: contract-clm-ontology-skill');
    expect(skill.skillMarkdown).toContain('RULE-01');
  });

  it('dynamically serves JSON-RPC 2.0 MCP tools and resources mapped from M2, M7, MI, and YAML files', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const project = store.getProject('proj-contract')!;

    const caps = inspectOntologyMcpCapabilities(project);
    expect(caps.tools.length).toBeGreaterThanOrEqual(9);
    expect(caps.resources).toHaveLength(11);

    const listRes = handleOntologyMcpRequest(project, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    expect((listRes.result as { tools: unknown[] }).tools.length).toBe(caps.tools.length);

    const callOk = handleOntologyMcpRequest(project, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'm2_draftContract',
        arguments: {
          title: '核心交换机采购合同',
          contractType: 'PROCUREMENT',
          counterpartyId: 'CP-001',
          totalAmount: 1800000,
          creditRating: 'AAA',
        },
      },
    });
    const okResult = callOk.result as { isError: boolean; content: { text: string }[] };
    expect(okResult.isError).toBe(false);
    expect(okResult.content[0].text).toContain('SUCCESS');

    const callViolation = handleOntologyMcpRequest(project, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'm2_draftContract',
        arguments: {
          title: '违规大额合同',
          totalAmount: 2500000,
          creditRating: 'B',
        },
      },
    });
    const badResult = callViolation.result as { isError: boolean; content: { text: string }[] };
    expect(badResult.isError).toBe(true);
    expect(badResult.content[0].text).toContain('RULE-01');
  });
});

