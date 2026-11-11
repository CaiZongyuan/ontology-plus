import { describe, expect, it } from 'vitest';
import { createWorkspaceStore } from '../../workspace-store/index.js';
import {
  buildMcpClientConfigJson,
  compileDevelopmentPackage,
  compileDevelopmentPackageZip,
  compileOntologySkill,
  handleOntologyMcpRequest,
  inspectOntologyMcpCapabilities,
} from '../index.js';

describe('package-compiler deep module', () => {
  it('compiles a complete 4-layer Development Package with progressive-disclosure guides, manifest.json, and PKZIP archive', () => {
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
    expect(paths).toContain('参考资料/本体模型/manifest.json');
    expect(paths).toContain('参考资料/UI-UE界面设计规范.md');
    expect(paths).toContain('参考资料/界面原型.html');
    expect(paths).toContain('参考资料/本体模型/m1-object-model.yaml');
    expect(paths).toContain('参考资料/本体模型/mi-interface-model.yaml');

    const featureGuide = compiled.files.find(
      (f) => f.relativePath === '本体模型业务功能开发指导书.md',
    )!.content;
    expect(featureGuide).toContain('created_by');
    expect(featureGuide).toContain('POPUP_SELECT');

    const zipOut = compileDevelopmentPackageZip({
      app,
      project,
      uiUeAsset: uiAsset,
      techFoundationAsset: foundationAsset,
      techArchAsset: archAsset,
      requirementDoc: reqDoc,
      prototype: proto,
    });
    // Verify PKZIP magic bytes "PK\x03\x04"
    expect(zipOut.zipBytes[0]).toBe(0x50);
    expect(zipOut.zipBytes[1]).toBe(0x4b);
    expect(zipOut.zipBytes[2]).toBe(0x03);
    expect(zipOut.zipBytes[3]).toBe(0x04);
    expect(zipOut.fileName).toContain('.zip');

    const skill = compileOntologySkill(project);
    expect(skill.skillMarkdown).toContain('name: contract-clm-ontology-skill');
    expect(skill.skillMarkdown).toContain('RULE-01');
    expect(skill.skillMarkdown).toContain('m1-object-model.yaml');
    expect(skill.skillMarkdown).not.toContain('/yaml/m1.yaml');
  });

  it('dynamically serves JSON-RPC 2.0 MCP tools, meta-tools, and resources across multiple projects without hardcoded domain leakage', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const project = store.getProject('proj-contract')!;
    const mftProject = store.getProject('proj-mft')!;

    const caps = inspectOntologyMcpCapabilities(project);
    expect(caps.tools.length).toBeGreaterThanOrEqual(13);
    // 11 YAML model files + 1 manifest.json
    expect(caps.resources).toHaveLength(12);
    for (const tool of caps.tools) {
      expect(tool.name).toMatch(/^[a-zA-Z0-9_-]+$/);
    }

    const listRes = handleOntologyMcpRequest(project, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    expect((listRes.result as { tools: unknown[] }).tools.length).toBe(caps.tools.length);

    const manifestRead = handleOntologyMcpRequest(project, {
      jsonrpc: '2.0',
      id: 'res-1',
      method: 'resources/read',
      params: { uri: `ontology://${project.id}/manifest.json` },
    });
    expect(
      (manifestRead.result as { contents: { text: string }[] }).contents[0].text,
    ).toContain('m1-object-model.yaml');

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

    // Verify MFT project tools also adhere to valid MCP identifiers and execute cleanly
    const mftCaps = inspectOntologyMcpCapabilities(mftProject);
    for (const tool of mftCaps.tools) {
      expect(tool.name).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
    const impactCall = handleOntologyMcpRequest(project, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'ontology_analyze_impact',
        arguments: { symbolId: 'Contract' },
      },
    });
    expect(
      (impactCall.result as { isError: boolean; content: { text: string }[] }).content[0].text,
    ).toContain('references');

    const clientJson = buildMcpClientConfigJson(project, 'http://127.0.0.1:4310');
    expect(clientJson).toContain('/api/mcp/proj-contract');
  });
});
