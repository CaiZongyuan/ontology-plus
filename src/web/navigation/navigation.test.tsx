import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROJECT_STEP_IDS,
  checkBusinessViewMarkup,
} from '../../packages/business-vocabulary/index.js';
import type { AgentSessionKind } from '../../packages/workspace-store/index.js';
import {
  AGENT_PANEL_SURFACES,
  DEFAULT_NAV_VIEW,
  NAV_GROUPS,
  NAV_ICONS,
  NAV_ITEMS,
  PROJECT_STEP_VIEWS,
  SECONDARY_AREAS,
  agentPanelSurfaceFor,
  applyUrlNavState,
  defaultNavForSessionKind,
  getDefaultViewForStep,
  getNavGroupSpec,
  getNavItemSpec,
  getNavItemsByGroup,
  getProjectStepForView,
  getSecondaryAreaForView,
  isFlushNavView,
  isNavViewId,
  isRetiredNavEntry,
  parseUrlNavState,
  readHashView,
  readUrlNavState,
  resolveArtifactNavTarget,
  resolveLegacyBusinessModelTechTab,
  resolveNavViewId,
  resolveShellRouteContext,
  writeUrlNavState,
  type NavGroupId,
  type NavViewId,
} from './index.js';

const ALL_ACTIVE_NAV_ITEMS: NavViewId[] = [
  'overview',
  'app-requirements',
  'app-prototype',
  'app-ontology',
  'app-model-files',
  'app-knowledge-graph',
  'app-four-layer-assets',
  'app-assembly-dev',
  'app-skills',
  'app-publish',
  'cap-systems',
  'cap-extraction',
  'cap-mcp',
  'cap-agents',
  'cap-cross-flows',
  'cap-knowledge',
  'data-resources',
  'data-mappings',
  'data-metrics-reports',
  'data-reasoning',
  'data-writeback',
  'llm-center',
  'system-settings',
];

describe('navigation catalog and URL state', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retires legacy app-req-explore and app-req-docs entries from NAV_ITEMS in favor of unified app-requirements', () => {
    expect(NAV_GROUPS.map((g) => g.id)).toEqual<NavGroupId[]>([
      'OVERVIEW',
      'APPLICATION',
      'CAPABILITY',
      'ANALYTICS',
      'PLATFORM',
    ]);
    expect(NAV_ITEMS).toHaveLength(23);
    expect(NAV_ITEMS.map((item) => item.id)).toEqual(ALL_ACTIVE_NAV_ITEMS);
    expect(NAV_ITEMS.some((item) => String(item.id) === 'app-req-explore')).toBe(false);
    expect(NAV_ITEMS.some((item) => String(item.id) === 'app-req-docs')).toBe(false);

    for (const viewId of ALL_ACTIVE_NAV_ITEMS) {
      const spec = getNavItemSpec(viewId);
      expect(spec).toBeDefined();
      expect(spec!.labelZh.length).toBeGreaterThan(0);
      expect(spec!.labelEn.length).toBeGreaterThan(0);
      expect(getNavGroupSpec(spec!.group)).toBeDefined();
      expect(NAV_ICONS[viewId]).toBeTruthy();
      expect(isNavViewId(viewId)).toBe(true);
    }

    expect(getNavItemsByGroup('APPLICATION')).toHaveLength(9);
    expect(getNavItemsByGroup('CAPABILITY')).toHaveLength(6);
    expect(getNavItemsByGroup('ANALYTICS')).toHaveLength(5);
    expect(getNavItemsByGroup('PLATFORM')).toHaveLength(2);
    expect(isNavViewId('unknown-view')).toBe(false);
    expect(resolveNavViewId('unknown-view')).toBe(DEFAULT_NAV_VIEW);
    expect(isFlushNavView('app-ontology')).toBe(true);
    expect(isFlushNavView('overview')).toBe(false);
  });

  it('parses URL query params, redirects legacy app-req-explore/app-req-docs URLs cleanly to app-requirements, and round-trips patches', () => {
    expect(
      parseUrlNavState({
        search: '?projectId=proj-mft&mode=app-prototype&itemId=proto-2&sessionId=sess-9',
        hash: '#/app-prototype',
      }),
    ).toEqual({
      projectId: 'proj-mft',
      nav: 'app-prototype',
      itemId: 'proto-2',
      sessionId: 'sess-9',
    });

    // Legacy ?mode=app-req-explore, ?mode=app-req-docs, #/app-req-explore, #/app-req-docs redirect cleanly to app-requirements
    expect(readHashView({ search: '?mode=app-req-explore', hash: '' })).toBe('app-requirements');
    expect(readHashView({ search: '?mode=app-req-docs', hash: '#/app-ontology' })).toBe(
      'app-requirements',
    );
    expect(readHashView({ search: '', hash: '#/app-req-explore' })).toBe('app-requirements');
    expect(readHashView({ search: '', hash: '#/app-req-docs' })).toBe('app-requirements');
    expect(resolveNavViewId('app-req-explore')).toBe('app-requirements');
    expect(resolveNavViewId('app-req-docs')).toBe('app-requirements');

    // Round-trip serialization and clearing empty values
    const step1Href = applyUrlNavState('http://127.0.0.1:4342/', {
      projectId: 'proj-contract',
      nav: 'app-requirements',
      itemId: 'doc-1',
      sessionId: 'sess-1',
    });
    expect(step1Href).toBe(
      '/?projectId=proj-contract&mode=app-requirements&itemId=doc-1&sessionId=sess-1#/app-requirements',
    );
    const parsedStep1 = parseUrlNavState({
      search: step1Href.slice(1, step1Href.indexOf('#')),
      hash: step1Href.slice(step1Href.indexOf('#')),
    });
    expect(parsedStep1).toEqual({
      projectId: 'proj-contract',
      nav: 'app-requirements',
      itemId: 'doc-1',
      sessionId: 'sess-1',
    });

    const clearedHref = applyUrlNavState(`http://127.0.0.1:4342${step1Href}`, {
      itemId: '',
      sessionId: '',
    });
    expect(clearedHref).toBe('/?projectId=proj-contract&mode=app-requirements#/app-requirements');

    const clearedNavHref = applyUrlNavState(`http://127.0.0.1:4342${clearedHref}`, { nav: '' });
    expect(clearedNavHref).toBe('/?projectId=proj-contract');

    // Window integration for readUrlNavState / writeUrlNavState / readHashView
    let currentHref = 'http://127.0.0.1:4342/?projectId=proj-1#/cap-agents';
    const replaceState = vi.fn((_state: unknown, _unused: string, nextUrl?: string | URL | null) => {
      if (nextUrl) {
        currentHref = new URL(String(nextUrl), 'http://127.0.0.1:4342').href;
      }
    });
    vi.stubGlobal('window', {
      get location() {
        return new URL(currentHref);
      },
      history: { replaceState },
    });

    expect(readUrlNavState()).toEqual({ projectId: 'proj-1', nav: 'cap-agents' });
    expect(readHashView()).toBe('cap-agents');

    writeUrlNavState({ nav: 'app-assembly-dev', itemId: 'app-1' });
    expect(replaceState).toHaveBeenCalledOnce();
    expect(readHashView()).toBe('app-assembly-dev');

    // Unknown view falls back to default 'app-ontology'
    expect(readHashView({ search: '?mode=not-a-real-view', hash: '' })).toBe('app-ontology');
    expect(readHashView({ search: '', hash: '#/not-a-real-view' })).toBe('app-ontology');
  });

  it('maps every NavViewId (including legacy requirement aliases) to its specialist AgentPanelSurface and round-trips all 7 AgentSessionKinds', () => {
    for (const viewId of ALL_ACTIVE_NAV_ITEMS) {
      const surface = agentPanelSurfaceFor(viewId);
      expect(surface).toBeDefined();
      expect(surface.title.zh.length).toBeGreaterThan(0);
      expect(surface.title.en.length).toBeGreaterThan(0);
      expect(surface.placeholder?.zh.length).toBeGreaterThan(0);
      expect(surface.placeholder?.en.length).toBeGreaterThan(0);
    }
    expect(AGENT_PANEL_SURFACES['app-requirements']).toMatchObject({
      sessionKind: 'REQUIREMENT',
      conversationPrimary: true,
    });
    expect(agentPanelSurfaceFor('app-req-explore')).toMatchObject({
      sessionKind: 'REQUIREMENT',
      conversationPrimary: true,
    });
    expect(agentPanelSurfaceFor('app-req-docs')).toMatchObject({
      sessionKind: 'REQUIREMENT',
    });

    const allSessionKinds: AgentSessionKind[] = [
      'REQUIREMENT',
      'PROTOTYPE_CO_DESIGN',
      'COPILOT',
      'ARCHITECTURE',
      'CODING',
      'CAPABILITY',
      'REASONING',
    ];
    for (const kind of allSessionKinds) {
      const defaultView = defaultNavForSessionKind(kind);
      expect(isNavViewId(defaultView)).toBe(true);
      expect(agentPanelSurfaceFor(defaultView).sessionKind).toBe(kind);
    }
    expect(defaultNavForSessionKind('REQUIREMENT')).toBe('app-requirements');

    expect(
      resolveArtifactNavTarget({
        kind: 'REQUIREMENT_DOC',
        docId: 'doc-9',
        title: '需求文档',
        version: 'v1',
        status: 'DRAFT',
      }),
    ).toEqual({ view: 'app-requirements', itemId: 'doc-9' });
  });

  it('collapses PROJECT_STEP_VIEWS.REQUIREMENTS to a single view (no subview bar) and maps legacy aliases cleanly', () => {
    expect(Object.keys(PROJECT_STEP_VIEWS)).toEqual([...PROJECT_STEP_IDS]);
    expect(getDefaultViewForStep('REQUIREMENTS')).toBe('app-requirements');
    expect(PROJECT_STEP_VIEWS.REQUIREMENTS).toEqual({
      defaultView: 'app-requirements',
      views: ['app-requirements'],
    });
    expect(getDefaultViewForStep('PROTOTYPE')).toBe('app-prototype');
    expect(getDefaultViewForStep('BUSINESS_MODEL')).toBe('app-ontology');
    expect(getDefaultViewForStep('DELIVERY')).toBe('app-assembly-dev');

    expect(PROJECT_STEP_VIEWS.BUSINESS_MODEL).toEqual({
      defaultView: 'app-ontology',
      views: ['app-ontology'],
    });
    expect(isRetiredNavEntry('app-ontology')).toBe(true);
    expect(isRetiredNavEntry('app-model-files')).toBe(true);
    expect(isRetiredNavEntry('app-knowledge-graph')).toBe(true);
    expect(isRetiredNavEntry('cap-extraction')).toBe(false);
    expect(resolveLegacyBusinessModelTechTab('app-model-files')).toBe('files');
    expect(resolveLegacyBusinessModelTechTab('app-knowledge-graph')).toBe('graph');
    expect(resolveLegacyBusinessModelTechTab('app-ontology')).toBeNull();
    expect(isFlushNavView('app-model-files')).toBe(true);
    expect(isFlushNavView('app-knowledge-graph')).toBe(true);

    const stepAssignedViews = PROJECT_STEP_IDS.flatMap((id) => PROJECT_STEP_VIEWS[id].views);
    expect(new Set(stepAssignedViews).size).toBe(7);
    expect(
      [...stepAssignedViews, 'app-model-files', 'app-knowledge-graph'].sort(),
    ).toEqual(
      getNavItemsByGroup('APPLICATION')
        .map((item) => item.id)
        .sort(),
    );

    const secondaryAssignedViews = SECONDARY_AREAS.flatMap((area) => area.views);
    expect(new Set(secondaryAssignedViews).size).toBe(13);

    for (const area of SECONDARY_AREAS) {
      expect(checkBusinessViewMarkup(area.label.zh, { plainText: true })).toEqual([]);
      expect(checkBusinessViewMarkup(area.label.en, { plainText: true })).toEqual([]);
      expect(checkBusinessViewMarkup(area.hint.zh, { plainText: true })).toEqual([]);
      expect(checkBusinessViewMarkup(area.hint.en, { plainText: true })).toEqual([]);
    }

    expect(resolveShellRouteContext('overview')).toEqual({ kind: 'home', view: 'overview' });
    expect(resolveShellRouteContext('app-requirements')).toEqual({
      kind: 'project',
      step: 'REQUIREMENTS',
      view: 'app-requirements',
      stepViews: ['app-requirements'],
    });
    expect(resolveShellRouteContext('app-req-docs')).toEqual({
      kind: 'project',
      step: 'REQUIREMENTS',
      view: 'app-requirements',
      stepViews: ['app-requirements'],
    });
    expect(resolveShellRouteContext('app-knowledge-graph')).toEqual({
      kind: 'project',
      step: 'BUSINESS_MODEL',
      view: 'app-knowledge-graph',
      stepViews: ['app-ontology'],
    });
    expect(resolveShellRouteContext('app-model-files')).toEqual({
      kind: 'project',
      step: 'BUSINESS_MODEL',
      view: 'app-model-files',
      stepViews: ['app-ontology'],
    });
    expect(resolveShellRouteContext('cap-extraction')).toMatchObject({
      kind: 'secondary',
      area: 'CAPABILITY',
      view: 'cap-extraction',
    });
    expect(resolveShellRouteContext('system-settings')).toMatchObject({
      kind: 'secondary',
      area: 'GOVERNANCE',
      view: 'system-settings',
    });
    expect(getProjectStepForView('app-req-explore')).toBe('REQUIREMENTS');
    expect(getProjectStepForView('app-req-docs')).toBe('REQUIREMENTS');
  });

  it('resolves step/area URL routes cleanly', () => {
    expect(parseUrlNavState({ search: '?projectId=proj-mft&step=REQUIREMENTS', hash: '' })).toEqual(
      {
        projectId: 'proj-mft',
        nav: 'app-requirements',
      },
    );
    expect(parseUrlNavState({ search: '', hash: '#/p/proj-mft/requirements' })).toEqual({
      projectId: 'proj-mft',
      nav: 'app-requirements',
    });
    expect(parseUrlNavState({ search: '?step=prototype', hash: '' })).toEqual({
      nav: 'app-prototype',
    });
    expect(parseUrlNavState({ search: '?step=business-model', hash: '' })).toEqual({
      nav: 'app-ontology',
    });
    expect(parseUrlNavState({ search: '?step=delivery', hash: '' })).toEqual({
      nav: 'app-assembly-dev',
    });
  });
});
