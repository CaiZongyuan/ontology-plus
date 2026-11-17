import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceStore } from '../../workspace-store/index.js';
import {
  buildMcpClientConfigJson,
  buildDevelopmentPackageZip,
  compileDevelopmentPackage,
  compileDevelopmentPackageZip,
  compileOntologySkill,
  fingerprintDevelopmentPackageInputs,
  handleOntologyMcpRequest,
  inspectOntologyMcpCapabilities,
  type CompileDevelopmentPackageInput,
} from '../index.js';

function confirmedPackageInput(): CompileDevelopmentPackageInput {
  const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
  const confirmed = store.getConfirmedPrototypeRevision('proj-contract')!;
  return {
    app: store.listAssembledApplications()[0],
    project: store.getProject('proj-contract')!,
    uiUeAsset: store.listFourLayerAssets('UI_UE')[0],
    techFoundationAsset: store.listFourLayerAssets('TECH_FOUNDATION')[0],
    techArchAsset: store.listFourLayerAssets('TECH_ARCH')[0],
    requirementDoc: store.listRequirementDocs('proj-contract')[0],
    prototype: { ...confirmed.prototype, currentRevisionId: confirmed.revision.id, htmlContent: confirmed.htmlContent },
    prototypeRevision: {
      id: confirmed.revision.id,
      prototypeId: confirmed.prototypeId,
      revisionNumber: confirmed.revision.revisionNumber,
      confirmedAt: confirmed.confirmedAt,
      createdAt: confirmed.revision.createdAt,
    },
    writeToDisk: false,
  };
}

describe('package-compiler deep module', () => {
  afterEach(() => vi.useRealTimers());

  it('downloads identical bytes from the retained snapshot despite later source edits and time changes', () => {
    const input = confirmedPackageInput();
    const fixedInputs = structuredClone(input);
    const compiled = compileDevelopmentPackage({ ...input, snapshotId: 'snapshot-zip', compiledAt: '2026-11-17T02:00:00.000Z' });
    const retained = JSON.stringify(compiled);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'));
    const original = buildDevelopmentPackageZip(compiled);
    input.requirementDoc!.content += '\nLater scope.';
    input.prototype!.htmlContent = '<html>Later prototype</html>';
    input.techArchAsset.specMarkdown = 'Later architecture';
    vi.setSystemTime(new Date('2030-01-01T01:00:00.000Z'));
    const downloaded = compileDevelopmentPackageZip(compiled);
    expect(downloaded.zipBytes).toEqual(original.zipBytes);
    expect(downloaded.pkg).toBe(compiled);
    expect(downloaded.fileName).toBe('app-contract-clm-dev-package.zip');
    expect(JSON.stringify(compiled)).toBe(retained);
    const regenerated = compileDevelopmentPackage({ ...fixedInputs, snapshotId: 'snapshot-zip', compiledAt: '2026-11-17T02:00:00.000Z' });
    expect(regenerated.files).toEqual(compiled.files);
  });

  it('revalidates actual ontology contracts and retains nonblocking Stage Warnings', () => {
    const input = confirmedPackageInput();
    input.project.suite.M2!.behaviors[0].ownerEntity = 'MissingAggregate';
    expect(input.project.validation.errorCount).toBe(0);
    expect(() => compileDevelopmentPackage(input)).toThrow(/Consistency Error/);
    const progressive = confirmedPackageInput();
    delete progressive.project.suite.MI;
    const compiled = compileDevelopmentPackage(progressive);
    expect(compiled.manifestJson.validation).toMatchObject({ errorCount: 0, missingModels: ['MI'], warningCount: expect.any(Number) });
    expect((compiled.manifestJson.validation as { warningCount: number }).warningCount).toBeGreaterThan(0);
    expect(compiled.files.some((file) => file.relativePath === 'references/ontology/MI.yaml')).toBe(false);
    expect(compiled.files.find((file) => file.relativePath === 'docs/implementation.md')!.content).toContain('MI (not authored; see the Stage Warnings');
  });

  it.each([
    ['missing requirements', (input: CompileDevelopmentPackageInput) => { input.requirementDoc = undefined; }, /requirements/i],
    ['draft requirements', (input: CompileDevelopmentPackageInput) => { input.requirementDoc!.status = 'DRAFT'; }, /confirm.*requirements/i],
    ['empty requirements', (input: CompileDevelopmentPackageInput) => { input.requirementDoc!.content = ' '; }, /requirements.*content/i],
    ['missing prototype', (input: CompileDevelopmentPackageInput) => { input.prototype = undefined; }, /confirmed prototype/i],
    ['unconfirmed prototype', (input: CompileDevelopmentPackageInput) => { input.prototype!.isConfirmed = false; }, /confirmed prototype/i],
    ['different prototype HTML', (input: CompileDevelopmentPackageInput) => { input.prototype!.htmlContent += '<!-- unconfirmed change -->'; }, /confirmed revision.*content/i],
    ['wrong revision identity', (input: CompileDevelopmentPackageInput) => { input.prototypeRevision!.id = 'other-revision'; }, /revision.*match/i],
    ['empty selected standard', (input: CompileDevelopmentPackageInput) => { input.techFoundationAsset.specMarkdown = ''; }, /standard.*content/i],
    ['unrelated asset', (input: CompileDevelopmentPackageInput) => { input.uiUeAsset.id = 'unrelated'; }, /selected.*asset/i],
  ])('blocks %s with an actionable diagnostic', (_description, invalidate, expected) => {
    const input = confirmedPackageInput();
    invalidate(input);
    expect(() => compileDevelopmentPackage(input)).toThrow(expected);
  });

  it('includes the complete default Node technology profile and repository standard origins', () => {
    const compiled = compileDevelopmentPackage(confirmedPackageInput());
    expect(compiled.manifestJson.technologyProfile).toMatchObject({
      id: 'profile-react-hono-sqlite-node',
      frontend: ['React', 'Vite', 'TanStack Router', 'Zustand', 'shadcn/ui with Base UI'],
      backend: ['Hono', 'Node.js'],
      persistence: ['Drizzle ORM', 'SQLite'],
    });
    const architecture = compiled.files.find((file) => file.relativePath === 'docs/architecture.md')!.content;
    for (const technology of ['React', 'Vite', 'TanStack Router', 'Zustand', 'shadcn/ui with Base UI', 'Hono', 'Drizzle ORM', 'SQLite', 'Node.js']) {
      expect(architecture).toContain(technology);
    }
    const manifest = compiled.manifestJson as { sources: { standards: { sourcePath: string; sourceRevision: string }[] } };
    expect(manifest.sources.standards).toHaveLength(3);
    for (const standard of manifest.sources.standards) {
      expect(standard.sourcePath).toMatch(/^src\/packages\/architecture-assets\/lib\/catalog\/assets\/.+\.json$/);
      expect(standard.sourceRevision).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
  });

  it('retains a traceable fixed snapshot after source edits and exposes every package-local reference', () => {
    const input = confirmedPackageInput();
    input.applicationInstructions = 'Keep contract approval decisions auditable.';
    const fingerprint = fingerprintDevelopmentPackageInputs(input);
    const compiled = compileDevelopmentPackage({
      ...input,
      snapshotId: 'snapshot-reviewed',
      inputFingerprint: fingerprint,
      compiledAt: '2026-11-17T02:00:00.000Z',
    });
    const retained = JSON.stringify(compiled);
    expect(compiled.snapshotId).toBe('snapshot-reviewed');
    expect(compiled.inputFingerprint).toBe(fingerprint);
    expect(compiled.manifestJson).toMatchObject({
      snapshotId: 'snapshot-reviewed',
      compiledAt: '2026-11-17T02:00:00.000Z',
      sources: {
        requirements: { id: input.requirementDoc!.id, version: input.requirementDoc!.version },
        prototype: { revisionId: input.prototypeRevision!.id, confirmedAt: input.prototypeRevision!.confirmedAt },
        ontology: { projectId: 'proj-contract', revision: input.project.updatedAt },
      },
    });
    const paths = new Set(compiled.files.map((file) => file.relativePath));
    for (const file of compiled.files.filter((entry) => entry.category === 'GUIDE')) {
      for (const [, target] of file.content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        expect(paths.has(path.posix.normalize(path.posix.join(path.posix.dirname(file.relativePath), target)))).toBe(true);
      }
    }
    const ontologyManifest = JSON.parse(compiled.files.find((file) => file.relativePath === 'references/ontology/manifest.json')!.content);
    for (const target of Object.values(ontologyManifest.models)) {
      expect(paths.has(`references/ontology/${target}`)).toBe(true);
    }
    input.requirementDoc!.content += '\nNew scope after review.';
    input.prototype!.htmlContent += '<!-- later revision -->';
    input.project.suite.M1!.aggregates[0].alias = 'later label';
    input.uiUeAsset.specMarkdown += '\nChanged standard.';
    input.app.agentDevLogs.push({ timestamp: 'later', phase: 'EDIT', detail: 'later' });
    expect(fingerprintDevelopmentPackageInputs(input)).not.toBe(fingerprint);
    expect(JSON.stringify(compiled)).toBe(retained);
  });

  it('exports an English specification package with original business references and no pretend implementation', () => {
    const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
    const project = store.getProject('proj-contract')!;
    const app = store.listAssembledApplications()[0];
    const uiAsset = store.listFourLayerAssets('UI_UE')[0];
    const foundationAsset = store.listFourLayerAssets('TECH_FOUNDATION')[0];
    const archAsset = store.listFourLayerAssets('TECH_ARCH')[0];
    const reqDoc = store.listRequirementDocs('proj-contract')[0];
    const confirmedProto = store.getConfirmedPrototypeRevision('proj-contract')!;
    const proto = {
      ...confirmedProto.prototype,
      htmlContent: confirmedProto.htmlContent,
    };

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
    expect(paths).toEqual(expect.arrayContaining([
      'README.md', 'AGENTS.md', 'manifest.json',
      'docs/architecture.md', 'docs/implementation.md', 'docs/acceptance.md',
      'references/requirements.md', 'references/prototype/index.html',
      'references/ontology/manifest.json', 'references/ontology/M1.yaml',
      'references/ontology/MI.yaml',
    ]));
    expect(paths.every((filePath) => /^[a-zA-Z0-9./_-]+$/.test(filePath))).toBe(true);
    expect(paths.some((filePath) => /\.(?:ts|tsx|sql)$/.test(filePath))).toBe(false);
    expect(paths.some((filePath) => filePath.startsWith('.onto-cs/'))).toBe(false);

    const read = (filePath: string) => compiled.files.find((file) => file.relativePath === filePath)!.content;
    expect(read('AGENTS.md')).toContain('[Implementation sequence](docs/implementation.md)');
    expect(read('docs/acceptance.md')).toContain('RULE-01');
    expect(read('docs/acceptance.md')).toContain('BHV-01');
    for (const scenario of project.suite.M4!.event_scenarios) expect(read('docs/acceptance.md')).toContain(scenario.id);
    for (const contract of project.suite.MI!.interfaces) expect(read('docs/acceptance.md')).toContain(contract.interfaceId);
    expect(read('docs/acceptance.md')).not.toContain('`undefined`');
    expect(read('references/requirements.md')).toBe(reqDoc.content);
    expect(read('references/prototype/index.html')).toBe(proto.htmlContent);
    expect(read('references/ontology/M1.yaml')).toContain('合同');

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
