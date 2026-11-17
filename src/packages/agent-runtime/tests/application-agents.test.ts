import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspaceStore, DEFAULT_TECHNOLOGY_PROFILE_ID } from '../../workspace-store/index.js';
import { collectUnifiedAgentTurn, executeDomainRunToolCall, runAppCodingAgentTurn } from '../index.js';

const directories: string[] = [];
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'application-agents-'));
  directories.push(directory);
  const architectureAssetsRoot = path.join(directory, 'catalog');
  const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false, architectureAssetsRoot });
  store.updateSystemSettings({ mockLlmMode: true });
  return { store, architectureAssetsRoot };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (path.dirname(directory) !== os.tmpdir()) throw new Error('Unexpected fixture directory');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('architecture authoring and application specification agents', () => {
  it('authors repository standards in ARCHITECTURE without rebinding an application', async () => {
    const { store, architectureAssetsRoot } = fixture();
    const applicationBefore = store.listAssembledApplications();
    const session = store.createAgentSession({ projectId: 'proj-contract', agentKind: 'ARCHITECTURE' });
    const saved = await executeDomainRunToolCall(store, session, 'save-standard', 'save_tech_architecture_spec', {
      name: 'Reviewed architecture standard',
      specMarkdown: '# Architecture\n\nUse explicit module contracts.',
      applicationId: 'app-contract-clm',
    }, 'en-US');
    expect(saved?.isError).toBe(false);
    const asset = JSON.parse(saved!.toolResultContent);
    expect(asset.technologyProfileId).toBe(DEFAULT_TECHNOLOGY_PROFILE_ID);
    expect(asset.sourceRevision).toMatch(/^sha256:/);
    const sourcePath = path.join(architectureAssetsRoot, 'assets', `${asset.id}.json`);
    expect(JSON.parse(fs.readFileSync(sourcePath, 'utf8')).specMarkdown).toContain('explicit module contracts');
    const revised = await executeDomainRunToolCall(store, session, 'revise-standard', 'save_architecture_asset', {
      assetId: asset.id, layer: 'TECH_ARCH', name: asset.name,
      specMarkdown: '# Architecture\n\nKeep dependencies acyclic.',
    }, 'en-US');
    expect(JSON.parse(revised!.toolResultContent).sourceRevision).not.toBe(asset.sourceRevision);
    expect(JSON.parse(fs.readFileSync(sourcePath, 'utf8')).specMarkdown).toContain('acyclic');
    const read = await executeDomainRunToolCall(store, session, 'read-standard', 'read_architecture_assets', { assetId: asset.id }, 'en-US');
    expect(JSON.parse(read!.toolResultContent).specMarkdown).toContain('acyclic');
    expect(store.listAssembledApplications()).toEqual(applicationBefore);
    const wrongRole = await executeDomainRunToolCall(store, session, 'wrong-role', 'save_application_instructions', {
      applicationId: 'app-contract-clm', developmentInstructions: '# Unrelated application change',
    }, 'en-US');
    expect(wrongRole?.isError).toBe(true);
  });

  it('writes only explicitly scoped application instructions and rejects missing, foreign and mismatched targets', async () => {
    const { store } = fixture();
    const application = store.listAssembledApplications().find((app) => app.id === 'app-contract-clm')!;
    const otherProject = store.createProject({ name: 'Another project', code: 'OTHER', domain: 'Other', template: 'EMPTY' });
    const foreignApplication = store.saveAssembledApplication({ ...application, id: 'foreign-app', projectId: otherProject.id });
    const otherApplication = store.saveAssembledApplication({ ...application, id: 'other-owned-app' });
    const session = store.createAgentSession({ projectId: application.projectId, agentKind: 'CODING' });
    const before = store.listAssembledApplications();
    for (const applicationId of [undefined, 'missing-app', foreignApplication.id]) {
      const result = await executeDomainRunToolCall(store, session, 'invalid-target', 'save_application_instructions', {
        applicationId, developmentInstructions: '# Do not save this',
      }, 'en-US');
      expect(result?.isError).toBe(true);
    }
    expect(store.listAssembledApplications()).toEqual(before);
    const boundSession = store.createAgentSession({ projectId: application.projectId, agentKind: 'CODING', targetId: application.id });
    const mismatch = await executeDomainRunToolCall(store, boundSession, 'mismatch', 'save_application_instructions', {
      applicationId: otherApplication.id, developmentInstructions: '# Wrong conversation',
    }, 'en-US');
    expect(mismatch?.isError).toBe(true);
    const saved = await executeDomainRunToolCall(store, session, 'save-app', 'save_application_instructions', {
      applicationId: application.id, developmentInstructions: '# Implementation\n\n## Acceptance\n\n- Preserve approved UI intent.',
    }, 'en-US');
    expect(saved?.isError).toBe(false);
    expect(store.listAssembledApplications().find((app) => app.id === application.id)?.developmentInstructions).toContain('## Acceptance');
    expect(store.listAssembledApplications().find((app) => app.id === foreignApplication.id)).toEqual(foreignApplication);
    expect(store.listAssembledApplications().find((app) => app.id === otherApplication.id)).toEqual(otherApplication);
    expect(store.listDevelopmentPackageSnapshots(application.id)).toHaveLength(0);
    const standardsBefore = store.listFourLayerAssets();
    const forbidden = await executeDomainRunToolCall(store, boundSession, 'global-change', 'save_tech_architecture_spec', {
      name: 'Forbidden', specMarkdown: '# Global change',
    }, 'en-US');
    expect(forbidden?.isError).toBe(true);
    expect(store.listFourLayerAssets()).toEqual(standardsBefore);
  });

  it('discloses missing selected inputs instead of substituting standards or another application', async () => {
    const { store } = fixture();
    const project = store.createProject({ name: 'Empty assembly', code: 'EMPTY_SPEC', domain: 'Retail', template: 'EMPTY' });
    const app = store.saveAssembledApplication({
      id: 'empty-spec-app', projectId: project.id, name: 'Empty specification',
      uiUeAssetId: 'missing-ui', techFoundationAssetId: 'missing-foundation', techArchAssetId: 'missing-architecture',
      technologyProfileId: DEFAULT_TECHNOLOGY_PROFILE_ID, developmentInstructions: '# Existing decisions', status: 'ASSEMBLED', agentDevLogs: [],
    });
    const session = store.createAgentSession({ projectId: project.id, agentKind: 'CODING', targetId: app.id });
    const result = await executeDomainRunToolCall(store, session, 'read-inputs', 'read_application_inputs', {}, 'en-US');
    const inputs = JSON.parse(result!.toolResultContent);
    expect(inputs.application.id).toBe(app.id);
    expect(inputs.application.developmentInstructions).toContain('Existing decisions');
    expect(inputs.selectedStandards.every((selected: { asset: unknown }) => selected.asset === null)).toBe(true);
    expect(inputs.selectedTechnologyProfile.id).toBe(DEFAULT_TECHNOLOGY_PROFILE_ID);
    expect(inputs.diagnostics.join('\n')).toMatch(/missing-ui/);
    expect(inputs.diagnostics.join('\n')).toMatch(/confirmed requirements document is missing/);
    expect(inputs.diagnostics.join('\n')).toMatch(/Confirmed prototype revision is missing/);
    expect(inputs.diagnostics.join('\n')).toMatch(/Ontology Suite is missing/);
    const unbound = store.createAgentSession({ projectId: project.id, agentKind: 'CODING' });
    const unboundInputs = await executeDomainRunToolCall(store, unbound, 'unbound-inputs', 'read_application_inputs', {}, 'en-US');
    expect(unboundInputs?.isError).toBe(true);
    expect(JSON.parse(unboundInputs!.toolResultContent).applications).toEqual([{ id: app.id, name: app.name }]);
    const turn = await collectUnifiedAgentTurn(store, { sessionId: unbound.id, prompt: 'Inspect the specification', mockMode: true });
    expect(turn.session.messages.at(-1)?.askUser?.options).toEqual([`${app.name} (${app.id})`]);
    const legacy = await runAppCodingAgentTurn(store, { appId: app.id, instruction: 'Inspect missing inputs' });
    expect(legacy.generatedFilesCount).toBe(0);
    expect(store.listDevelopmentPackageSnapshots(app.id)).toHaveLength(0);
    expect(legacy.reply).not.toContain('Generated executable');
  });

  it('persists explicit contradictions and preserves them during ordinary specification edits', async () => {
    const { store } = fixture();
    const application = store.listAssembledApplications().find((app) => app.id === 'app-contract-clm')!;
    const session = store.createAgentSession({ projectId: application.projectId, agentKind: 'CODING', targetId: application.id });
    const save = (args: Record<string, unknown>, currentSession = session) => executeDomainRunToolCall(
      store, currentSession, 'save-blockers', 'save_application_instructions', args, 'en-US',
    );
    const conflict = 'The selected UI standard contradicts the confirmed prototype navigation.';
    const first = await save({ developmentInstructions: '# Implementation\n\nResolve the UI contradiction.', developmentBlockers: [conflict] });
    expect(first?.isError).toBe(false);
    expect(JSON.parse(first!.toolResultContent).application.developmentBlockers).toEqual([conflict]);
    await save({ developmentInstructions: '# Implementation\n\nKeep the existing UI decision pending.' });
    expect(store.listAssembledApplications().find((app) => app.id === application.id)).toMatchObject({ developmentBlockers: [conflict] });
    const read = await executeDomainRunToolCall(store, session, 'read-blockers', 'read_application_inputs', {}, 'en-US');
    expect(JSON.parse(read!.toolResultContent).application.developmentBlockers).toEqual([conflict]);
    const malformed = await save({ developmentInstructions: '# Invalid blocker edit', developmentBlockers: [' '] });
    expect(malformed?.isError).toBe(true);
    expect(store.listAssembledApplications().find((app) => app.id === application.id)).toMatchObject({ developmentBlockers: [conflict] });
    const confirmedSession = store.saveAgentSession({ ...session, messages: [{
      id: 'resolved-choice', role: 'user', timestamp: new Date().toISOString(),
      content: 'Keep the confirmed prototype navigation. We have updated the selected standard to match it; clear the resolved contradiction.',
    }] });
    const resolved = await save({ developmentInstructions: '# Implementation\n\nThe selected UI standard now matches the confirmed prototype.', developmentBlockers: [] }, confirmedSession);
    expect(resolved?.isError).toBe(false);
    expect(JSON.parse(resolved!.toolResultContent).application.developmentBlockers).toEqual([]);
    expect(store.listDevelopmentPackageSnapshots(application.id)).toHaveLength(0);
  });

  it('authors English mock directives while preserving Chinese business requests as quoted source', async () => {
    const { store } = fixture();
    const application = store.listAssembledApplications().find((app) => app.id === 'app-contract-clm')!;
    store.saveAssembledApplication({ ...application, developmentInstructions: '# 已有业务决定\n保留已确认原型中的导航。' });
    const session = store.createAgentSession({ projectId: application.projectId, agentKind: 'CODING', targetId: application.id });
    const request = '补充验收条件：审批金额超过一百万元时必须复核。\n保留原始业务术语。';
    const turn = await collectUnifiedAgentTurn(store, { sessionId: session.id, prompt: request, locale: 'zh-CN', mockMode: true });
    const instructions = store.listAssembledApplications().find((app) => app.id === application.id)!.developmentInstructions!;
    expect(instructions).toContain('# Application Implementation Specification');
    expect(instructions).toContain('Use the quoted business source to refine implementation steps and acceptance criteria');
    expect(instructions).toContain('## Existing instructions (quoted source)\n\n> # 已有业务决定\n> 保留已确认原型中的导航。');
    expect(instructions).toContain('### Original user business request (quoted source)\n\n> 补充验收条件：审批金额超过一百万元时必须复核。\n> 保留原始业务术语。');
    expect(instructions.split('\n').filter((line) => /[\u3400-\u9fff]/.test(line)).every((line) => line.startsWith('> '))).toBe(true);
    expect(turn.session.messages.at(-1)?.content).toContain('已保存应用专属开发规格');
  });

  const providerCases: { locale: 'en-US' | 'zh-CN'; prompt: string }[] = [
    { locale: 'en-US', prompt: 'Review target implementation specification' },
    { locale: 'zh-CN', prompt: '请检查当前应用的实施规格。' },
  ];
  it.each(providerCases)('advertises distinct tools and context in the $locale provider request and refuses an out-of-scope model tool call', async ({ locale, prompt }) => {
    const { store } = fixture();
    const requests: Array<{
      tools: Array<{ function: { name: string; parameters?: { properties?: { developmentInstructions?: { description?: string } } } } }>;
      messages: Array<{ role: string; content?: string }>;
    }> = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += String(chunk); });
      req.on('end', () => {
        const request = JSON.parse(body);
        requests.push(request);
        const coding = request.tools.some((tool: { function: { name: string } }) => tool.function.name === 'read_application_inputs');
        const hasToolResult = request.messages.some((message: { role: string }) => message.role === 'tool');
        const delta = coding && !hasToolResult
          ? { tool_calls: [{ index: 0, id: 'forbidden-standard', type: 'function', function: { name: 'save_tech_architecture_spec', arguments: JSON.stringify({ name: 'Forbidden', specMarkdown: '# Must not be written' }) } }] }
          : { content: '# Specification review\n\nSelected inputs are available for inspection.' };
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(`data: ${JSON.stringify({ id: 'response', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: coding && !hasToolResult ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Gateway port is unavailable');
    store.saveLlmProvider({ id: 'role-provider', name: 'Role Test Gateway', providerType: 'OPENAI_COMPATIBLE', baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'test', defaultModel: 'auto/glm-5.3-flash', availableModels: ['auto/glm-5.3-flash'], enabled: true });
    try {
      const architecture = store.createAgentSession({ projectId: 'proj-contract', agentKind: 'ARCHITECTURE', providerId: 'role-provider' });
      const coding = store.createAgentSession({ projectId: 'proj-contract', agentKind: 'CODING', providerId: 'role-provider', targetId: 'app-contract-clm' });
      const assetsBefore = store.listFourLayerAssets();
      await collectUnifiedAgentTurn(store, { sessionId: architecture.id, prompt: 'Review reusable standards', locale: 'en-US', mockMode: false });
      const turn = await collectUnifiedAgentTurn(store, { sessionId: coding.id, prompt, locale, mockMode: false });
      const architectureTools = requests[0]!.tools.map((tool) => tool.function.name);
      const codingRequest = requests.find((request) => request.tools.some((tool) => tool.function.name === 'read_application_inputs'))!;
      const codingTools = codingRequest.tools.map((tool) => tool.function.name);
      expect(architectureTools).toEqual(expect.arrayContaining(['read_architecture_assets', 'save_architecture_asset', 'save_tech_architecture_spec']));
      expect(architectureTools).not.toContain('save_application_instructions');
      expect(codingTools).toEqual(expect.arrayContaining(['read_application_inputs', 'save_application_instructions', 'ask_user']));
      expect(codingTools).not.toContain('save_tech_architecture_spec');
      expect(codingTools).not.toContain('compile_dev_package');
      expect(codingTools).not.toContain('upsert_rule');
      expect(requests[0]!.messages[0]!.content).toContain('Write platform-generated development standards in English');
      expect(codingRequest.messages[0]!.content).toContain('app-contract-clm');
      const systemPrompt = codingRequest.messages[0]!.content;
      if (locale === 'zh-CN') {
        expect(systemPrompt).toContain('对话跟随用户语言。');
        expect(systemPrompt).toContain('通过 save_application_instructions 编写并保存的应用实施指令必须使用英文');
        expect(systemPrompt).toContain('原始中文业务材料可保留为明确标注的引用来源');
      } else {
        expect(systemPrompt).toContain("Conversation follows the user's language.");
        expect(systemPrompt).toContain('Author application implementation instructions saved via save_application_instructions in English');
        expect(systemPrompt).toContain('original Chinese business material may remain only as clearly quoted source');
        expect(systemPrompt).toContain('Diagnose missing inputs and explicit contradictions');
      }
      const saveInstructions = codingRequest.tools.find((tool) => tool.function.name === 'save_application_instructions')!;
      const instructionDescription = saveInstructions.function.parameters?.properties?.developmentInstructions?.description;
      expect(instructionDescription).toContain('English Markdown');
      expect(instructionDescription).toContain('Original Chinese business material may remain as clearly quoted source');
      expect(turn.session.messages.at(-1)?.toolCalls?.[0]).toMatchObject({ toolName: 'save_tech_architecture_spec', isError: true });
      expect(store.listFourLayerAssets()).toEqual(assetsBefore);
      expect(store.getAgentSession(architecture.id)?.messages).toHaveLength(2);
      expect(store.getAgentSession(coding.id)?.messages).toHaveLength(2);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 15000);
});
