import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentSessionKind } from '../../packages/workspace-store/index.js';
import {
  AGENT_PANEL_SURFACES,
  DEFAULT_NAV_VIEW,
  NAV_GROUPS,
  NAV_ICONS,
  NAV_ITEMS,
  agentPanelSurfaceFor,
  applyUrlNavState,
  defaultNavForSessionKind,
  getNavGroupSpec,
  getNavItemSpec,
  getNavItemsByGroup,
  isFlushNavView,
  isNavViewId,
  parseUrlNavState,
  readHashView,
  readUrlNavState,
  resolveArtifactNavTarget,
  resolveNavViewId,
  writeUrlNavState,
  type NavGroupId,
  type NavViewId,
} from './index.js';

const ALL_EXPECTED_VIEWS: NavViewId[] = [
  'overview',
  'app-req-explore',
  'app-req-docs',
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

  it('defines all 5 groups and all 24 unique navigation items with icons and bilingual labels', () => {
    expect(NAV_GROUPS.map((g) => g.id)).toEqual<NavGroupId[]>([
      'OVERVIEW',
      'APPLICATION',
      'CAPABILITY',
      'ANALYTICS',
      'PLATFORM',
    ]);
    expect(NAV_ITEMS).toHaveLength(24);
    expect(NAV_ITEMS.map((item) => item.id)).toEqual(ALL_EXPECTED_VIEWS);

    for (const viewId of ALL_EXPECTED_VIEWS) {
      const spec = getNavItemSpec(viewId);
      expect(spec).toBeDefined();
      expect(spec!.labelZh.length).toBeGreaterThan(0);
      expect(spec!.labelEn.length).toBeGreaterThan(0);
      expect(getNavGroupSpec(spec!.group)).toBeDefined();
      expect(NAV_ICONS[viewId]).toBeTruthy();
      expect(isNavViewId(viewId)).toBe(true);
    }

    expect(getNavItemsByGroup('APPLICATION')).toHaveLength(10);
    expect(getNavItemsByGroup('CAPABILITY')).toHaveLength(6);
    expect(getNavItemsByGroup('ANALYTICS')).toHaveLength(5);
    expect(getNavItemsByGroup('PLATFORM')).toHaveLength(2);
    expect(isNavViewId('unknown-view')).toBe(false);
    expect(resolveNavViewId('unknown-view')).toBe(DEFAULT_NAV_VIEW);
    expect(isFlushNavView('app-ontology')).toBe(true);
    expect(isFlushNavView('overview')).toBe(false);
  });

  it('parses URL query params, falls back to hash route, and round-trips patches cleanly', () => {
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

    // Hash fallback with or without leading slash
    expect(parseUrlNavState({ search: '', hash: '#/cap-mcp' })).toEqual({ nav: 'cap-mcp' });
    expect(parseUrlNavState({ search: '', hash: '#data-reasoning' })).toEqual({
      nav: 'data-reasoning',
    });

    // Explicit mode query overrides stale hash
    expect(
      parseUrlNavState({ search: '?mode=app-req-docs', hash: '#/app-ontology' }),
    ).toEqual({ nav: 'app-req-docs' });

    // Round-trip serialization and clearing empty values
    const step1Href = applyUrlNavState('http://127.0.0.1:4342/', {
      projectId: 'proj-contract',
      nav: 'app-req-explore',
      itemId: 'doc-1',
      sessionId: 'sess-1',
    });
    expect(step1Href).toBe(
      '/?projectId=proj-contract&mode=app-req-explore&itemId=doc-1&sessionId=sess-1#/app-req-explore',
    );
    const parsedStep1 = parseUrlNavState({
      search: step1Href.slice(1, step1Href.indexOf('#')),
      hash: step1Href.slice(step1Href.indexOf('#')),
    });
    expect(parsedStep1).toEqual({
      projectId: 'proj-contract',
      nav: 'app-req-explore',
      itemId: 'doc-1',
      sessionId: 'sess-1',
    });

    const clearedHref = applyUrlNavState(`http://127.0.0.1:4342${step1Href}`, {
      itemId: '',
      sessionId: '',
    });
    expect(clearedHref).toBe('/?projectId=proj-contract&mode=app-req-explore#/app-req-explore');

    const clearedNavHref = applyUrlNavState(`http://127.0.0.1:4342${clearedHref}`, { nav: '' });
    expect(clearedNavHref).toBe('/?projectId=proj-contract');
    expect(parseUrlNavState({ search: '?projectId=proj-contract', hash: '' })).toEqual({
      projectId: 'proj-contract',
    });

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
    expect(readUrlNavState()).toEqual({
      projectId: 'proj-1',
      nav: 'app-assembly-dev',
      itemId: 'app-1',
    });
    expect(readHashView()).toBe('app-assembly-dev');

    // Unknown view falls back to default 'app-ontology'
    expect(readHashView({ search: '?mode=not-a-real-view', hash: '' })).toBe('app-ontology');
    expect(readHashView({ search: '', hash: '#/not-a-real-view' })).toBe('app-ontology');
  });

  it('maps every NavViewId to its specialist AgentPanelSurface and round-trips all 7 AgentSessionKinds', () => {
    expect(Object.keys(AGENT_PANEL_SURFACES).sort()).toEqual([...ALL_EXPECTED_VIEWS].sort());

    for (const viewId of ALL_EXPECTED_VIEWS) {
      const surface = agentPanelSurfaceFor(viewId);
      expect(surface).toBeDefined();
      expect(surface.title.zh.length).toBeGreaterThan(0);
      expect(surface.title.en.length).toBeGreaterThan(0);
      expect(surface.placeholder?.zh.length).toBeGreaterThan(0);
      expect(surface.placeholder?.en.length).toBeGreaterThan(0);
    }

    // Spot-check key surface attributes
    expect(agentPanelSurfaceFor('app-req-explore')).toMatchObject({
      sessionKind: 'REQUIREMENT',
      conversationPrimary: true,
    });
    expect(agentPanelSurfaceFor('app-prototype')).toMatchObject({
      sessionKind: 'PROTOTYPE_CO_DESIGN',
      usesVision: true,
    });
    expect(agentPanelSurfaceFor('app-four-layer-assets').sessionKind).toBe('ARCHITECTURE');
    expect(agentPanelSurfaceFor('app-assembly-dev').sessionKind).toBe('CODING');
    expect(agentPanelSurfaceFor('app-publish').sessionKind).toBe('CODING');
    expect(agentPanelSurfaceFor('cap-agents')).toMatchObject({
      sessionKind: 'CAPABILITY',
      conversationPrimary: true,
    });
    expect(agentPanelSurfaceFor('data-reasoning')).toMatchObject({
      sessionKind: 'REASONING',
      conversationPrimary: true,
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

    expect(
      resolveArtifactNavTarget({
        kind: 'REQUIREMENT_DOC',
        docId: 'doc-9',
        title: 'SRS',
        version: 'v1',
        status: 'CONFIRMED',
      }),
    ).toEqual({ view: 'app-req-docs', itemId: 'doc-9' });
    expect(
      resolveArtifactNavTarget({
        kind: 'PROTOTYPE_REVISION',
        prototypeId: 'proto-3',
        revisionId: 'rev-1',
        revisionNumber: 1,
        modifiedAnchors: [],
      }),
    ).toEqual({ view: 'app-prototype', itemId: 'proto-3', prototypeId: 'proto-3' });
    expect(
      resolveArtifactNavTarget({
        kind: 'ONTOLOGY_DIFF',
        title: 'Diff',
        modelCode: 'M3',
        changes: [{ id: 'RULE-01', category: 'rule', detail: 'added', action: 'ADDED' }],
      }),
    ).toEqual({ view: 'app-ontology', modelCode: 'M3', elementId: 'RULE-01' });
    expect(
      resolveArtifactNavTarget({
        kind: 'CODING_PACKAGE',
        appId: 'app-1',
        outputDir: 'out',
        files: [],
      }),
    ).toEqual({ view: 'app-assembly-dev', itemId: 'app-1' });
    expect(
      resolveArtifactNavTarget({
        kind: 'REQUIREMENT_HINTS',
        aggregates: [],
        rules: [],
        openQuestions: [],
      }),
    ).toBeNull();
  });
});
