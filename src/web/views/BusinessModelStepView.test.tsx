import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkBusinessViewMarkup,
  formatBusinessViewViolations,
} from '../../packages/business-vocabulary/index.js';
import {
  CONTRACT_LIFECYCLE_SUITE,
  DEFAULT_COLLAPSED_OBJECT_SECTIONS,
  DEFAULT_EXPANDED_OBJECT_SECTIONS,
  MFT_ENTERPRISE_SUITE,
  buildKnowledgeGraph,
  projectByBusinessObject,
  validateOntologySuite,
  type OntologySuite,
} from '../../packages/ontology-core/index.js';
import {
  computeOntologySuiteHash,
  type ProjectStepConfirmations,
} from '../../packages/workspace-store/index.js';
import { useWorkbenchStore, type BootstrapPayload } from '../api.js';
import { PreferencesProvider } from '../i18n.js';
import { readStepViewMode, writeStepViewMode } from '../navigation/index.js';
import {
  BUSINESS_MODEL_CROSS_VIEW_IDS,
  BusinessModelStepView,
  navigateToBusinessModelObject,
  resolveBusinessModelPageId,
} from './BusinessModelStepView.js';

function createMemoryStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

function makeSuiteBootstrap(
  suite: OntologySuite,
  opts?: {
    id?: string;
    name?: string;
    domain?: string;
    confirmedPrototype?: boolean;
    stepConfirmations?: ProjectStepConfirmations;
  },
): BootstrapPayload {
  const id = opts?.id ?? 'proj-contract';
  const name = opts?.name ?? '合同全生命周期管理系统';
  const domain = opts?.domain ?? '合同全生命周期管理系统';
  const validation = validateOntologySuite(suite);
  const knowledgeGraph = buildKnowledgeGraph(suite);
  const hasConfirmedProto = opts?.confirmedPrototype ?? true;

  return {
    projects: [
      {
        id,
        name,
        code: 'PROJ-01',
        center: 'APPLICATION',
        domain,
        description: name,
        currentStage: validation.presentModels.length,
        createdAt: '2026-11-17T00:00:00Z',
        updatedAt: '2026-11-17T00:00:00Z',
      },
    ],
    activeProject: {
      id,
      name,
      code: 'PROJ-01',
      center: 'APPLICATION',
      domain,
      description: name,
      currentStage: validation.presentModels.length,
      suite,
      changelog: '',
      createdAt: '2026-11-17T00:00:00Z',
      updatedAt: '2026-11-17T00:00:00Z',
      validation,
      knowledgeGraph,
    },
    projectSnapshots: [],
    agentSessions: [],
    requirementSessions: [],
    requirementDocs: hasConfirmedProto
      ? [
          {
            id: 'doc-1',
            projectId: id,
            title: '需求规格书',
            version: 'v1.0',
            status: 'CONFIRMED',
            content: '# 需求',
            updatedAt: '2026-11-17T00:00:00Z',
          },
        ]
      : [],
    prototypes: hasConfirmedProto
      ? [
          {
            id: 'proto-1',
            projectId: id,
            name: '系统工作台原型',
            version: 'v1',
            htmlContent: '<div>proto</div>',
            extractedScreenCount: 1,
            currentRevisionId: 'rev-1',
            revisions: [],
            updatedAt: '2026-11-17T00:00:00Z',
          } as unknown as BootstrapPayload['prototypes'][number],
        ]
      : [],
    confirmedPrototypeRevision: hasConfirmedProto
      ? ({
          projectId: id,
          prototypeId: 'proto-1',
          revisionId: 'rev-1',
          confirmedAt: '2026-11-17T00:00:00Z',
          prototypeName: '系统工作台原型',
          revisionNumber: 1,
          revisionTitle: '初版',
          htmlContent: '<div>proto</div>',
        } as unknown as BootstrapPayload['confirmedPrototypeRevision'])
      : null,
    ...(opts?.stepConfirmations ? { stepConfirmations: opts.stepConfirmations } : {}),
    fourLayerAssets: [],
    assembledApplications: [],
    generatedSkills: [],
    legacySystems: [],
    extractionJobs: [],
    mcpServers: [],
    capabilityAgents: [],
    capabilityChatSessions: [],
    crossSystemFlows: [],
    knowledgeEntries: [],
    databaseResources: [],
    dataDocuments: [],
    dataMappings: [],
    metrics: [],
    analyticsScenarios: [],
    analyticsReports: [],
    reasoningSessions: [],
    writebackInterfaces: [],
    llmProviders: [],
    systemSettings: {
      activeProviderId: 'prov-1',
      mockLlmMode: true,
      defaultCenter: 'APPLICATION',
      enableAutoSaveMirror: false,
    } as unknown as BootstrapPayload['systemSettings'],
  };
}

function extractSubtreeByTestId(html: string, testId: string): string {
  const marker = `data-testid="${testId}"`;
  const idx = html.indexOf(marker);
  if (idx < 0) return '';
  const openStart = html.lastIndexOf('<', idx);
  const tagMatch = /^<([A-Za-z0-9-]+)/.exec(html.slice(openStart));
  if (!tagMatch) return '';
  const tag = tagMatch[1]!;
  const closeToken = `</${tag}>`;
  const openToken = `<${tag}`;
  let depth = 0;
  let pos = openStart;
  while (pos < html.length) {
    const nextOpen = html.indexOf(openToken, pos);
    const nextClose = html.indexOf(closeToken, pos);
    if (nextClose < 0) break;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1;
      pos = nextOpen + openToken.length;
    } else {
      depth -= 1;
      pos = nextClose + closeToken.length;
      if (depth <= 0) {
        return html.slice(openStart, pos);
      }
    }
  }
  return html.slice(openStart);
}

function assertCleanBusinessView(html: string, contextLabel: string) {
  const violations = checkBusinessViewMarkup(html);
  expect(
    violations,
    `${contextLabel}\n${formatBusinessViewViolations(violations)}`,
  ).toEqual([]);

  // Spec #37 §5 Rule 1: at most 1 primary action button on any Business View screen
  const primaryMatches =
    html.match(
      /<button[^>]*\b(?:bui-btn-accent|bg-primary border-primary text-primary-foreground)\b[^>]*>/g,
    ) ?? [];
  expect(
    primaryMatches.length,
    `${contextLabel} must have at most 1 primary action button`,
  ).toBeLessThanOrEqual(1);
}

describe('BusinessModelStepView (#68)', () => {
  const initialSnapshot = { ...useWorkbenchStore.getInitialState() };

  function seedStore(patch: Partial<ReturnType<typeof useWorkbenchStore.getState>>) {
    useWorkbenchStore.setState(patch);
    Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    useWorkbenchStore.setState({
      data: initialSnapshot.data,
      loading: initialSnapshot.loading,
      activeNav: initialSnapshot.activeNav,
      activeItemId: initialSnapshot.activeItemId,
      selectedModel: initialSnapshot.selectedModel,
      selectedElementId: initialSnapshot.selectedElementId,
    });
    Object.assign(useWorkbenchStore.getInitialState(), initialSnapshot);
  });

  it('passes checkBusinessViewMarkup with 0 violations across every Business Object page and all 3 Cross-Object Views for CONTRACT_LIFECYCLE_SUITE and MFT_ENTERPRISE_SUITE in zh-CN and en-US', () => {
    const suites = [
      {
        label: 'CONTRACT_LIFECYCLE_SUITE',
        suite: CONTRACT_LIFECYCLE_SUITE,
        id: 'proj-contract',
        name: '合同全生命周期管理系统',
      },
      {
        label: 'MFT_ENTERPRISE_SUITE',
        suite: MFT_ENTERPRISE_SUITE,
        id: 'proj-mft',
        name: '企业文件安全传输系统',
      },
    ] as const;

    for (const locale of ['zh-CN', 'en-US'] as const) {
      const storage = createMemoryStorage({ onto_locale: locale });
      vi.stubGlobal('localStorage', storage);
      vi.stubGlobal('window', { localStorage: storage });

      for (const entry of suites) {
        const projection = projectByBusinessObject(entry.suite);
        seedStore({
          loading: false,
          activeNav: 'app-ontology',
          data: makeSuiteBootstrap(entry.suite, {
            id: entry.id,
            name: entry.name,
            domain: entry.name,
          }),
        });

        // Every Business Object page
        for (const obj of projection.objects) {
          const html = renderToStaticMarkup(
            <PreferencesProvider>
              <BusinessModelStepView activePageId={obj.id} viewModeOverride="business" />
            </PreferencesProvider>,
          );
          expect(html).toContain('data-testid="business-object-page"');
          expect(html).toContain(obj.displayName);
          assertCleanBusinessView(html, `${entry.label} [${locale}] object=${obj.name}`);
        }

        // All 3 Cross-Object Views
        for (const crossId of BUSINESS_MODEL_CROSS_VIEW_IDS) {
          const html = renderToStaticMarkup(
            <PreferencesProvider>
              <BusinessModelStepView activePageId={crossId} viewModeOverride="business" />
            </PreferencesProvider>,
          );
          assertCleanBusinessView(html, `${entry.label} [${locale}] view=${crossId}`);
        }
      }
    }
  });

  it('renders the Other fallback group without dropping unowned elements and passes checkBusinessViewMarkup in zh-CN and en-US', () => {
    const suiteWithOther: OntologySuite = JSON.parse(JSON.stringify(CONTRACT_LIFECYCLE_SUITE));
    suiteWithOther.M1!.data_dictionaries.push({
      id: 'DICT-GLOBAL-CURRENCY',
      name: '全局币种字典',
      description: '跨业务通用的结算币种目录',
      types: [
        {
          typeCode: 'CURRENCY',
          typeName: '币种',
          items: [{ code: 'CNY', label: '人民币', enabled: true, sortOrder: 10 }],
        },
      ],
    });
    suiteWithOther.MM!.mappings.push({
      id: 'MAP-ORPHAN-99',
      objectRef: 'AGG-UNOWNED',
      objectRole: 'AGGREGATE_ROOT',
      objectName: 'GlobalAuditLog',
      tableMappings: [
        {
          tableName: 't_global_audit_log',
          tableRole: 'MASTER',
          primaryKey: 'id',
          foreignKeys: [],
          columnMappings: [
            { attributeRef: 'GlobalAuditLog.action', column: 'action_name', columnType: 'VARCHAR(64)' },
          ],
        },
      ],
    });

    const projection = projectByBusinessObject(suiteWithOther);
    expect(projection.other.length).toBeGreaterThan(0);

    for (const locale of ['zh-CN', 'en-US'] as const) {
      const storage = createMemoryStorage({ onto_locale: locale });
      vi.stubGlobal('localStorage', storage);
      vi.stubGlobal('window', { localStorage: storage });

      seedStore({
        loading: false,
        activeNav: 'app-ontology',
        data: makeSuiteBootstrap(suiteWithOther),
      });

      const html = renderToStaticMarkup(
        <PreferencesProvider>
          <BusinessModelStepView activePageId="view:other" viewModeOverride="business" />
        </PreferencesProvider>,
      );

      expect(html).toContain('data-testid="bm-nav-other"');
      expect(html).toContain('data-testid="cross-view-other"');
      expect(html).toContain('全局币种字典');
      assertCleanBusinessView(html, `Other fallback [${locale}]`);
    }
  });

  it('expands fields, actions, businessRules, and authorizedRoles by default while keeping events, automations, screens, integrations, and dataStorage collapsed', () => {
    const storage = createMemoryStorage({ onto_locale: 'zh-CN' });
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { localStorage: storage });

    seedStore({
      loading: false,
      activeNav: 'app-ontology',
      data: makeSuiteBootstrap(CONTRACT_LIFECYCLE_SUITE),
    });

    const html = renderToStaticMarkup(
      <PreferencesProvider>
        <BusinessModelStepView activePageId="AGG-01" viewModeOverride="business" />
      </PreferencesProvider>,
    );

    // No "其他" nav item when projection.other is empty
    expect(html).not.toContain('data-testid="bm-nav-other"');

    for (const section of DEFAULT_EXPANDED_OBJECT_SECTIONS) {
      const toggle = extractSubtreeByTestId(html, `object-section-toggle-${section}`);
      expect(toggle, `Expected ${section} to be expanded by default`).toContain(
        'aria-expanded="true"',
      );
    }

    for (const section of DEFAULT_COLLAPSED_OBJECT_SECTIONS) {
      const toggle = extractSubtreeByTestId(html, `object-section-toggle-${section}`);
      expect(toggle, `Expected ${section} to be collapsed by default`).toContain(
        'aria-expanded="false"',
      );
    }

    // Human-readable field types in Fields section
    const fieldsSection = extractSubtreeByTestId(html, 'object-section-fields');
    expect(fieldsSection).toContain('合同编号');
    expect(fieldsSection).toContain('文本');
    expect(fieldsSection).toContain('合同总金额');
    expect(fieldsSection).toContain('金额');
  });

  it('renders a cross-object M3 rule as the exact same rule on every related Business Object page with links to the other objects', () => {
    const storage = createMemoryStorage({ onto_locale: 'zh-CN' });
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { localStorage: storage });

    seedStore({
      loading: false,
      activeNav: 'app-ontology',
      data: makeSuiteBootstrap(CONTRACT_LIFECYCLE_SUITE),
    });

    const contractHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <BusinessModelStepView activePageId="AGG-01" viewModeOverride="business" />
      </PreferencesProvider>,
    );
    const counterpartyHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <BusinessModelStepView activePageId="AGG-02" viewModeOverride="business" />
      </PreferencesProvider>,
    );
    const settlementHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <BusinessModelStepView activePageId="AGG-03" viewModeOverride="business" />
      </PreferencesProvider>,
    );

    const ruleOnContract = extractSubtreeByTestId(contractHtml, 'business-rule-text-RULE-03');
    const ruleOnSettlement = extractSubtreeByTestId(settlementHtml, 'business-rule-text-RULE-03');
    const ruleOnCounterparty = extractSubtreeByTestId(
      counterpartyHtml,
      'business-rule-text-RULE-03',
    );

    expect(ruleOnContract).toContain('累计结算不超合同总额守恒规则');
    expect(ruleOnContract).toBe(ruleOnSettlement);
    expect(ruleOnCounterparty).toBe('');

    const sharedOnContract = extractSubtreeByTestId(contractHtml, 'shared-rule-links-RULE-03');
    const sharedOnSettlement = extractSubtreeByTestId(settlementHtml, 'shared-rule-links-RULE-03');
    expect(sharedOnContract).toContain('履约结算单');
    expect(sharedOnSettlement).toContain('合同');
  });

  it('renders clean empty states when suite has no models yet and passes checkBusinessViewMarkup', () => {
    const storage = createMemoryStorage({ onto_locale: 'zh-CN' });
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { localStorage: storage });

    // 1. Prototype confirmed -> offers single primary action to organize business model
    seedStore({
      loading: false,
      activeNav: 'app-ontology',
      data: makeSuiteBootstrap({}, { confirmedPrototype: true }),
    });
    const readyEmptyHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <BusinessModelStepView viewModeOverride="business" />
      </PreferencesProvider>,
    );
    expect(readyEmptyHtml).toContain('data-testid="business-model-empty-state"');
    expect(readyEmptyHtml).toContain('data-testid="organize-business-model-btn"');
    assertCleanBusinessView(readyEmptyHtml, 'Empty state with confirmed prototype');

    // 2. Prototype not yet confirmed -> calm guidance with 0 duplicate primary buttons
    seedStore({
      loading: false,
      activeNav: 'app-ontology',
      data: makeSuiteBootstrap({}, { confirmedPrototype: false }),
    });
    const blockedEmptyHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <BusinessModelStepView viewModeOverride="business" />
      </PreferencesProvider>,
    );
    expect(blockedEmptyHtml).toContain('data-testid="business-model-empty-state"');
    expect(blockedEmptyHtml).not.toContain('data-testid="organize-business-model-btn"');
    assertCleanBusinessView(blockedEmptyHtml, 'Empty state without confirmed prototype');

    // 3. Prototype confirmed synced MU only (before Business Model synthesis) -> still renders clean organize empty state
    seedStore({
      loading: false,
      activeNav: 'app-ontology',
      data: makeSuiteBootstrap(
        { MU: CONTRACT_LIFECYCLE_SUITE.MU! },
        { confirmedPrototype: true },
      ),
    });
    const muOnlyEmptyHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <BusinessModelStepView viewModeOverride="business" />
      </PreferencesProvider>,
    );
    expect(muOnlyEmptyHtml).toContain('data-testid="business-model-empty-state"');
    expect(muOnlyEmptyHtml).toContain('data-testid="organize-business-model-btn"');
    assertCleanBusinessView(muOnlyEmptyHtml, 'MU-only pre-synthesis state');
  });

  it('remembers Technical Details per step in localStorage and renders all 3 Technical Details sub-tabs plus element focus', () => {
    const storage = createMemoryStorage({ onto_locale: 'zh-CN' });
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { localStorage: storage });

    writeStepViewMode('BUSINESS_MODEL', 'technical');
    expect(readStepViewMode('BUSINESS_MODEL')).toBe('technical');
    expect(readStepViewMode('REQUIREMENTS')).toBe('business');
    expect(readStepViewMode('PROTOTYPE')).toBe('business');
    expect(readStepViewMode('DELIVERY')).toBe('business');

    seedStore({
      loading: false,
      activeNav: 'app-ontology',
      selectedModel: 'M1',
      selectedElementId: 'AGG-02',
      data: makeSuiteBootstrap(CONTRACT_LIFECYCLE_SUITE),
    });

    const techHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <BusinessModelStepView />
      </PreferencesProvider>,
    );

    expect(techHtml).toContain('data-testid="business-model-technical-view"');
    expect(techHtml).toContain('data-testid="back-to-business-view-btn"');
    expect(techHtml).toContain('data-testid="tech-tab-editor"');
    expect(techHtml).toContain('data-testid="tech-tab-files"');
    expect(techHtml).toContain('data-testid="tech-tab-graph"');
    expect(techHtml).toContain('data-testid="validation-error-badge"');
    expect(techHtml).toContain('data-testid="model-nav-M1"');
    expect(techHtml).toContain('data-testid="model-nav-MI"');
    expect(techHtml).toContain('AGG-02');

    // Legacy URL deep-link to Model Files opens Technical Details on the files sub-tab
    writeStepViewMode('BUSINESS_MODEL', 'business');
    const legacyFilesHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <BusinessModelStepView legacyTechTab="files" />
      </PreferencesProvider>,
    );
    expect(legacyFilesHtml).toContain('data-testid="business-model-technical-view"');
    expect(legacyFilesHtml).toContain('data-testid="export-owl-btn"');
  });

  it('resolves Business Object pages by aggregate id, technical name, or business name and supports direct navigation', () => {
    const storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', {
      localStorage: storage,
      location: new URL('http://127.0.0.1:4352/?projectId=proj-contract'),
      history: { replaceState: () => undefined },
    });

    const projection = projectByBusinessObject(CONTRACT_LIFECYCLE_SUITE);
    expect(resolveBusinessModelPageId(projection, 'AGG-02')).toBe('AGG-02');
    expect(resolveBusinessModelPageId(projection, 'Counterparty')).toBe('AGG-02');
    expect(resolveBusinessModelPageId(projection, '签约相对方')).toBe('AGG-02');
    expect(resolveBusinessModelPageId(projection, 'flows')).toBe('view:flows');
    expect(resolveBusinessModelPageId(projection, 'roles')).toBe('view:roles');
    expect(resolveBusinessModelPageId(projection, 'reports')).toBe('view:reports');
    expect(resolveBusinessModelPageId(projection, 'unknown-target')).toBe('AGG-01');

    writeStepViewMode('BUSINESS_MODEL', 'technical');
    navigateToBusinessModelObject('AGG-03');
    expect(readStepViewMode('BUSINESS_MODEL')).toBe('business');
    expect(useWorkbenchStore.getState().activeNav).toBe('app-ontology');
    expect(useWorkbenchStore.getState().activeItemId).toBe('AGG-03');
  });

  it('renders inline rename/description controls, active inline editor, and calm consistency-error rejection banner with 0 checkBusinessViewMarkup violations in zh-CN and en-US (#69)', () => {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const storage = createMemoryStorage({ onto_locale: locale });
      vi.stubGlobal('localStorage', storage);
      vi.stubGlobal('window', { localStorage: storage });

      seedStore({
        loading: false,
        activeNav: 'app-ontology',
        data: makeSuiteBootstrap(CONTRACT_LIFECYCLE_SUITE),
      });

      // 1. Resting state exposes inline edit triggers for Business Object, fields, actions, and rules
      const restingHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <BusinessModelStepView activePageId="AGG-01" viewModeOverride="business" />
        </PreferencesProvider>,
      );
      expect(restingHtml).toContain('data-testid="business-object-title"');
      expect(restingHtml).toContain('data-testid="inline-edit-trigger-object-name-AGG-01"');
      expect(restingHtml).toContain('data-testid="inline-edit-trigger-object-desc-AGG-01"');
      expect(restingHtml).toContain('data-testid="inline-edit-trigger-field-name-AGG-01-title"');
      expect(restingHtml).toContain('data-testid="inline-edit-trigger-action-name-BHV-01"');
      expect(restingHtml).toContain('data-testid="inline-edit-trigger-rule-name-RULE-03"');
      assertCleanBusinessView(restingHtml, `Resting inline controls [${locale}]`);

      // 2. Active inline editor state passes checkBusinessViewMarkup and keeps <= 1 primary button
      const editingHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <BusinessModelStepView
            activePageId="AGG-01"
            viewModeOverride="business"
            initialInlineEditState={{
              slotKey: 'object-name-AGG-01',
              draftValue: locale === 'en-US' ? 'Commercial Contract' : '商务合同',
            }}
          />
        </PreferencesProvider>,
      );
      expect(editingHtml).toContain('data-testid="business-inline-editor"');
      expect(editingHtml).toContain('data-testid="business-inline-input"');
      expect(editingHtml).toContain('data-testid="business-inline-save-btn"');
      expect(editingHtml).toContain('data-testid="business-inline-cancel-btn"');
      assertCleanBusinessView(editingHtml, `Active inline editor [${locale}]`);

      // 3. Rejected inline edit banner renders business-language explanation + "让 AI 助手处理" + Cancel with 0 violations
      const rejectedHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <BusinessModelStepView
            activePageId="AGG-02"
            viewModeOverride="business"
            initialRejectionState={{
              slotKey: 'object-name-AGG-02',
              reasonZh:
                '已经存在同名的「合同」，直接改成相同名称会产生需要修正的问题；如需合并这两项，请交给 AI 助手同步调整关联内容。',
              reasonEn:
                'Another item is already named "Contract", so renaming directly would create problems to fix; let AI Assistant merge them and update linked items together.',
              assistantPromptZh:
                '我想把业务对象「签约相对方」改名为「合同」，请帮我同步调整所有关联内容。',
              assistantPromptEn:
                'I want to rename the business object "Counterparty" to "Contract"; please coordinate all linked updates.',
            }}
          />
        </PreferencesProvider>,
      );
      expect(rejectedHtml).toContain('data-testid="business-edit-rejected-banner"');
      expect(rejectedHtml).toContain('data-testid="business-edit-ask-assistant-btn"');
      expect(rejectedHtml).toContain('data-testid="business-edit-cancel-btn"');
      expect(rejectedHtml).toContain(
        locale === 'en-US' ? 'Let AI Assistant handle it' : '让 AI 助手处理',
      );
      assertCleanBusinessView(rejectedHtml, `Rejected inline edit banner [${locale}]`);
    }
  });

  it('renders associations, screen navigationEdges & crossCuttingUi, and rolesAndPermissions actors/permissionGroups/standalone permissions with 0 checkBusinessViewMarkup violations', () => {
    const suiteWithFullRoles: OntologySuite = JSON.parse(
      JSON.stringify(CONTRACT_LIFECYCLE_SUITE),
    );
    suiteWithFullRoles.M5!.permissionGroups = [
      {
        id: 'PG-CONTRACT-OPS',
        name: '合同日常经办权限组',
        description: '覆盖合同台账查询与草稿起草的常用权限组合',
        permissions: ['PERM-CONTRACT-READ', 'PERM-CONTRACT-WRITE'],
      },
    ];
    suiteWithFullRoles.M5!.permissions.push({
      id: 'PERM-COUNTERPARTY-FREEZE',
      name: '相对方冻结管控权限',
      code: 'counterparty:freeze',
      targetAggregate: 'Counterparty',
      allowedBehaviors: [],
      uiControlledElements: [],
    });

    for (const locale of ['zh-CN', 'en-US'] as const) {
      const storage = createMemoryStorage({ onto_locale: locale });
      vi.stubGlobal('localStorage', storage);
      vi.stubGlobal('window', { localStorage: storage });

      seedStore({
        loading: false,
        activeNav: 'app-ontology',
        data: makeSuiteBootstrap(suiteWithFullRoles),
      });

      // 1. Business Object page with all collapsed sections expanded (associations + screens navigationEdges & crossCuttingUi)
      const expandedObjectHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <BusinessModelStepView
            activePageId="AGG-01"
            viewModeOverride="business"
            defaultExpandedSections={[...DEFAULT_COLLAPSED_OBJECT_SECTIONS]}
          />
        </PreferencesProvider>,
      );
      expect(expandedObjectHtml).toContain('data-testid="object-associations-list"');
      expect(expandedObjectHtml).toContain('每份合同必须绑定一个准入状态正常的签约相对方');
      expect(expandedObjectHtml).toContain('data-testid="object-screen-navigations"');
      expect(expandedObjectHtml).toContain(
        '合同台账与风险监控工作台 → 合同起草与条款配置页',
      );
      expect(expandedObjectHtml).toContain('data-testid="object-screen-crosscutting"');
      expect(expandedObjectHtml).toContain('高风险合同法务红线提示横幅');
      assertCleanBusinessView(expandedObjectHtml, `Expanded object page [${locale}]`);

      // 2. Roles & Permissions cross-view renders matrix + actors + permissionGroups + standalone permissions
      const rolesHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <BusinessModelStepView activePageId="view:roles" viewModeOverride="business" />
        </PreferencesProvider>,
      );
      expect(rolesHtml).toContain('data-testid="roles-actors-section"');
      expect(rolesHtml).toContain('商务合同专员');
      expect(rolesHtml).toContain('电子签章服务网关');
      expect(rolesHtml).toContain('data-testid="roles-permission-groups-section"');
      expect(rolesHtml).toContain('合同日常经办权限组');
      expect(rolesHtml).toContain('data-testid="roles-standalone-permissions-section"');
      expect(rolesHtml).toContain('相对方冻结管控权限');
      assertCleanBusinessView(rolesHtml, `Full roles cross-view [${locale}]`);
    }
  });

  it('renders status banner & confirmation controls across NOT_STARTED, IN_PROGRESS, UNCONFIRMED_CHANGES, CONFIRMED, and OUTDATED in zh-CN and en-US with 0 Business View violations (#71)', () => {
    const cleanSuite: OntologySuite = structuredClone(CONTRACT_LIFECYCLE_SUITE);
    const cleanHash = computeOntologySuiteHash(cleanSuite);

    const editedSuite: OntologySuite = structuredClone(CONTRACT_LIFECYCLE_SUITE);
    editedSuite.M1!.aggregates[0]!.alias = '集团采购合同';

    for (const locale of ['zh-CN', 'en-US'] as const) {
      const storage = createMemoryStorage({ onto_locale: locale });
      vi.stubGlobal('localStorage', storage);
      vi.stubGlobal('window', { localStorage: storage });

      // 1. NOT_STARTED (blocked when Prototype unconfirmed)
      seedStore({
        loading: false,
        activeNav: 'app-ontology',
        data: makeSuiteBootstrap({}, { confirmedPrototype: false }),
      });
      const blockedHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <BusinessModelStepView viewModeOverride="business" onNavigate={() => undefined} />
        </PreferencesProvider>,
      );
      expect(blockedHtml).toContain('data-testid="business-model-status-banner"');
      expect(blockedHtml).toContain('data-step-state="NOT_STARTED"');
      assertCleanBusinessView(blockedHtml, `NOT_STARTED blocked [${locale}]`);

      // 2. IN_PROGRESS (Prototype confirmed, suite clean, not yet confirmed) -> confirm-business-model-btn enabled
      seedStore({
        loading: false,
        activeNav: 'app-ontology',
        data: makeSuiteBootstrap(cleanSuite, {
          confirmedPrototype: true,
          stepConfirmations: {
            requirements: null,
            prototype: {
              id: 'sconf-proto-v1',
              projectId: 'proj-contract',
              step: 'PROTOTYPE',
              prototypeId: 'proto-1',
              revisionId: 'rev-1',
              basedOnConfirmationId: null,
              confirmedAt: '2026-11-17T00:00:00Z',
            },
            businessModel: null,
          },
        }),
      });
      const inProgressHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <BusinessModelStepView viewModeOverride="business" onNavigate={() => undefined} />
        </PreferencesProvider>,
      );
      expect(inProgressHtml).toContain('data-testid="business-model-status-banner"');
      expect(inProgressHtml).toContain('data-step-state="IN_PROGRESS"');
      const confirmBtnInProg = extractSubtreeByTestId(inProgressHtml, 'confirm-business-model-btn');
      expect(confirmBtnInProg).toContain(
        locale === 'en-US' ? 'Confirm Business Model' : '确认业务模型',
      );
      expect(confirmBtnInProg).not.toContain('disabled=""');
      assertCleanBusinessView(inProgressHtml, `IN_PROGRESS clean [${locale}]`);

      // 3. UNCONFIRMED_CHANGES (edited after confirmation, clean) -> confirm-business-model-btn enabled
      seedStore({
        loading: false,
        activeNav: 'app-ontology',
        data: makeSuiteBootstrap(editedSuite, {
          confirmedPrototype: true,
          stepConfirmations: {
            requirements: null,
            prototype: {
              id: 'sconf-proto-v1',
              projectId: 'proj-contract',
              step: 'PROTOTYPE',
              prototypeId: 'proto-1',
              revisionId: 'rev-1',
              basedOnConfirmationId: null,
              confirmedAt: '2026-11-17T00:00:00Z',
            },
            businessModel: {
              id: 'sconf-model-v1',
              projectId: 'proj-contract',
              step: 'BUSINESS_MODEL',
              suite: cleanSuite,
              suiteSnapshot: cleanSuite,
              suiteHash: cleanHash,
              presentModels: ['M1', 'M2', 'M3', 'ME', 'M4', 'M5', 'M6', 'M7', 'MU', 'MM', 'MI'],
              basedOnConfirmationId: 'sconf-proto-v1',
              confirmedAt: '2026-11-17T01:00:00Z',
            },
          },
        }),
      });
      const unconfirmedHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <BusinessModelStepView viewModeOverride="business" onNavigate={() => undefined} />
        </PreferencesProvider>,
      );
      expect(unconfirmedHtml).toContain('data-testid="business-model-status-banner"');
      expect(unconfirmedHtml).toContain('data-step-state="UNCONFIRMED_CHANGES"');
      expect(unconfirmedHtml).toContain('data-testid="confirm-business-model-btn"');
      assertCleanBusinessView(unconfirmedHtml, `UNCONFIRMED_CHANGES clean [${locale}]`);

      // 4. CONFIRMED -> states Business Model is confirmed and offers going to Delivery
      seedStore({
        loading: false,
        activeNav: 'app-ontology',
        data: makeSuiteBootstrap(cleanSuite, {
          confirmedPrototype: true,
          stepConfirmations: {
            requirements: null,
            prototype: {
              id: 'sconf-proto-v1',
              projectId: 'proj-contract',
              step: 'PROTOTYPE',
              prototypeId: 'proto-1',
              revisionId: 'rev-1',
              basedOnConfirmationId: null,
              confirmedAt: '2026-11-17T00:00:00Z',
            },
            businessModel: {
              id: 'sconf-model-v1',
              projectId: 'proj-contract',
              step: 'BUSINESS_MODEL',
              suite: cleanSuite,
              suiteSnapshot: cleanSuite,
              suiteHash: cleanHash,
              presentModels: ['M1', 'M2', 'M3', 'ME', 'M4', 'M5', 'M6', 'M7', 'MU', 'MM', 'MI'],
              basedOnConfirmationId: 'sconf-proto-v1',
              confirmedAt: '2026-11-17T01:00:00Z',
            },
          },
        }),
      });
      const confirmedHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <BusinessModelStepView viewModeOverride="business" onNavigate={() => undefined} />
        </PreferencesProvider>,
      );
      expect(confirmedHtml).toContain('data-testid="business-model-status-banner"');
      expect(confirmedHtml).toContain('data-step-state="CONFIRMED"');
      expect(confirmedHtml).toContain('data-testid="go-to-delivery-btn"');
      expect(confirmedHtml).not.toContain('data-testid="confirm-business-model-btn"');
      assertCleanBusinessView(confirmedHtml, `CONFIRMED clean [${locale}]`);

      // 5. OUTDATED (Prototype re-confirmed to sconf-proto-v2) -> intact Business Model + outdated banner + primary Update + secondary Confirm as is
      seedStore({
        loading: false,
        activeNav: 'app-ontology',
        data: makeSuiteBootstrap(cleanSuite, {
          confirmedPrototype: true,
          stepConfirmations: {
            requirements: null,
            prototype: {
              id: 'sconf-proto-v2',
              projectId: 'proj-contract',
              step: 'PROTOTYPE',
              prototypeId: 'proto-1',
              revisionId: 'rev-2',
              basedOnConfirmationId: null,
              confirmedAt: '2026-11-17T02:00:00Z',
            },
            businessModel: {
              id: 'sconf-model-v1',
              projectId: 'proj-contract',
              step: 'BUSINESS_MODEL',
              suite: cleanSuite,
              suiteSnapshot: cleanSuite,
              suiteHash: cleanHash,
              presentModels: ['M1', 'M2', 'M3', 'ME', 'M4', 'M5', 'M6', 'M7', 'MU', 'MM', 'MI'],
              basedOnConfirmationId: 'sconf-proto-v1',
              confirmedAt: '2026-11-17T01:00:00Z',
            },
          },
        }),
      });
      const outdatedHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <BusinessModelStepView viewModeOverride="business" onNavigate={() => undefined} />
        </PreferencesProvider>,
      );
      expect(outdatedHtml).toContain('data-testid="business-object-page"');
      expect(outdatedHtml).toContain('data-testid="business-model-outdated-banner"');
      expect(outdatedHtml).toContain('data-testid="business-model-status-banner"');
      expect(outdatedHtml).toContain('data-testid="business-model-ask-assistant-update-btn"');
      expect(outdatedHtml).toContain(
        locale === 'en-US' ? 'Update with AI Assistant' : '让 AI 助手更新',
      );
      const confirmAsIsBtn = extractSubtreeByTestId(
        outdatedHtml,
        'business-model-confirm-as-is-btn',
      );
      expect(confirmAsIsBtn).toContain(
        locale === 'en-US' ? 'Confirm as is without changes' : '不需要改动，按现状确认',
      );
      expect(confirmAsIsBtn).not.toContain('disabled=""');
      assertCleanBusinessView(outdatedHtml, `OUTDATED clean [${locale}]`);
    }
  });

  it('renders plain-language "需要修正的问题" (open by default, blocking confirm & confirm-as-is) and "尚未完成的部分" (collapsed by default) with 0 Business View violations in zh-CN and en-US (#71)', () => {
    const suiteWithIssues: OntologySuite = structuredClone(CONTRACT_LIFECYCLE_SUITE);
    // Remove MM & MI so there are 2 Stage Warnings ("数据存储", "对外接口")
    delete suiteWithIssues.MM;
    delete suiteWithIssues.MI;
    // Introduce Consistency Errors on M2 (dangling ownerEntity) and M1 (missing dictionaryRef)
    suiteWithIssues.M2!.behaviors[0]!.ownerEntity = 'GhostMissingObject';
    suiteWithIssues.M1!.aggregates[0]!.attributes.push({
      name: 'brokenDictAttr',
      label: '结算方式选项',
      type: 'DictionaryRef',
      dictionaryRef: { dictionaryId: 'DICT-MISSING-99', typeCode: 'SETTLE_WAY' },
      required: true,
      refRules: [],
    });

    const checkReport = validateOntologySuite(suiteWithIssues);
    expect(checkReport.errorCount).toBeGreaterThanOrEqual(2);
    expect(checkReport.warningCount).toBe(2);

    for (const locale of ['zh-CN', 'en-US'] as const) {
      const storage = createMemoryStorage({ onto_locale: locale });
      vi.stubGlobal('localStorage', storage);
      vi.stubGlobal('window', { localStorage: storage });

      // 1. IN_PROGRESS with both Consistency Errors & Stage Warnings
      seedStore({
        loading: false,
        activeNav: 'app-ontology',
        data: makeSuiteBootstrap(suiteWithIssues, {
          confirmedPrototype: true,
          stepConfirmations: {
            requirements: null,
            prototype: {
              id: 'sconf-proto-v1',
              projectId: 'proj-contract',
              step: 'PROTOTYPE',
              prototypeId: 'proto-1',
              revisionId: 'rev-1',
              basedOnConfirmationId: null,
              confirmedAt: '2026-11-17T00:00:00Z',
            },
            businessModel: null,
          },
        }),
      });

      const defaultHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <BusinessModelStepView viewModeOverride="business" onNavigate={() => undefined} />
        </PreferencesProvider>,
      );

      // Confirm button is blocked/disabled when errorCount > 0
      const blockedConfirmBtn = extractSubtreeByTestId(defaultHtml, 'confirm-business-model-btn');
      expect(blockedConfirmBtn).toContain('disabled=""');

      // "需要修正的问题" card is OPEN by default with "让 AI 助手处理"
      const problemsCard = extractSubtreeByTestId(defaultHtml, 'business-model-problems-card');
      expect(problemsCard).toContain(locale === 'en-US' ? 'Problems to fix' : '需要修正的问题');
      expect(problemsCard).toContain('data-testid="fix-problems-with-assistant-btn"');
      expect(problemsCard).toContain('起草合同');

      // "尚未完成的部分" card is COLLAPSED by default
      const incompleteCardCollapsed = extractSubtreeByTestId(
        defaultHtml,
        'business-model-incomplete-card',
      );
      expect(incompleteCardCollapsed).toContain(
        locale === 'en-US' ? 'Not yet completed' : '尚未完成的部分',
      );
      expect(incompleteCardCollapsed).toContain('aria-expanded="false"');
      expect(incompleteCardCollapsed).not.toContain(
        'data-testid="complete-missing-with-assistant-btn"',
      );
      assertCleanBusinessView(defaultHtml, `Problems open + Incomplete collapsed [${locale}]`);

      // Expand "尚未完成的部分" -> shows MODEL_BUSINESS_NAMES + "让 AI 助手补全" with 0 violations
      const expandedIncompleteHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <BusinessModelStepView
            viewModeOverride="business"
            onNavigate={() => undefined}
            defaultShowIncomplete
          />
        </PreferencesProvider>,
      );
      const incompleteCardExpanded = extractSubtreeByTestId(
        expandedIncompleteHtml,
        'business-model-incomplete-card',
      );
      expect(incompleteCardExpanded).toContain('aria-expanded="true"');
      expect(incompleteCardExpanded).toContain('data-testid="complete-missing-with-assistant-btn"');
      expect(incompleteCardExpanded).toContain(
        locale === 'en-US' ? 'Data Storage' : '数据存储',
      );
      expect(incompleteCardExpanded).toContain(
        locale === 'en-US' ? 'Integrations' : '对外接口',
      );
      assertCleanBusinessView(
        expandedIncompleteHtml,
        `Problems open + Incomplete expanded [${locale}]`,
      );

      // 2. OUTDATED + errorCount > 0 -> "不需要改动，按现状确认" is disabled while single primary action rule holds!
      seedStore({
        loading: false,
        activeNav: 'app-ontology',
        data: makeSuiteBootstrap(suiteWithIssues, {
          confirmedPrototype: true,
          stepConfirmations: {
            requirements: null,
            prototype: {
              id: 'sconf-proto-v2',
              projectId: 'proj-contract',
              step: 'PROTOTYPE',
              prototypeId: 'proto-1',
              revisionId: 'rev-2',
              basedOnConfirmationId: null,
              confirmedAt: '2026-11-17T02:00:00Z',
            },
            businessModel: {
              id: 'sconf-model-v1',
              projectId: 'proj-contract',
              step: 'BUSINESS_MODEL',
              suite: CONTRACT_LIFECYCLE_SUITE,
              suiteSnapshot: CONTRACT_LIFECYCLE_SUITE,
              suiteHash: computeOntologySuiteHash(CONTRACT_LIFECYCLE_SUITE),
              presentModels: ['M1', 'M2', 'M3', 'ME', 'M4', 'M5', 'M6', 'M7', 'MU', 'MM', 'MI'],
              basedOnConfirmationId: 'sconf-proto-v1',
              confirmedAt: '2026-11-17T01:00:00Z',
            },
          },
        }),
      });
      const outdatedWithErrorsHtml = renderToStaticMarkup(
        <PreferencesProvider>
          <BusinessModelStepView viewModeOverride="business" onNavigate={() => undefined} />
        </PreferencesProvider>,
      );
      const disabledConfirmAsIs = extractSubtreeByTestId(
        outdatedWithErrorsHtml,
        'business-model-confirm-as-is-btn',
      );
      expect(disabledConfirmAsIs).toContain('disabled=""');
      assertCleanBusinessView(outdatedWithErrorsHtml, `OUTDATED with errors [${locale}]`);
    }
  });
});
