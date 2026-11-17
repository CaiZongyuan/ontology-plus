import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { useWorkbenchStore, type BootstrapPayload } from '../api.js';
import { PreferencesProvider } from '../i18n.js';
import { NAV_ITEMS } from './index.js';
import { NAV_VIEW_REGISTRY, WorkbenchViewHost } from './viewDispatch.js';

describe('NAV_VIEW_REGISTRY and WorkbenchViewHost', () => {
  const initialSnapshot = { ...useWorkbenchStore.getInitialState() };

  function seedStore(patch: Partial<ReturnType<typeof useWorkbenchStore.getState>>) {
    useWorkbenchStore.setState(patch);
    Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
  }

  afterEach(() => {
    useWorkbenchStore.setState({
      data: initialSnapshot.data,
      loading: initialSnapshot.loading,
    });
    Object.assign(useWorkbenchStore.getInitialState(), initialSnapshot);
  });

  it('registers a view renderer for every NavViewId in NAV_ITEMS', () => {
    const registeredIds = Object.keys(NAV_VIEW_REGISTRY).sort();
    const catalogIds = NAV_ITEMS.map((item) => item.id).sort();
    expect(registeredIds).toEqual(catalogIds);

    for (const item of NAV_ITEMS) {
      expect(typeof NAV_VIEW_REGISTRY[item.id]).toBe('function');
    }
  });

  it('renders the knowledge-graph empty state with next-step guidance when ontology is absent', () => {
    seedStore({
      loading: false,
      data: {
        projects: [],
        activeProject: {
          id: 'proj-new',
          name: '冷链物流系统',
          code: 'COLD_CHAIN',
          domain: '冷链物流',
          suite: {},
          validation: {
            presentModels: [],
            errorCount: 0,
            warningCount: 0,
            issues: [],
          },
          knowledgeGraph: {
            nodes: [],
            edges: [],
          },
        },
        projectSnapshots: [],
        agentSessions: [],
        requirementSessions: [],
        requirementDocs: [],
        prototypes: [],
        confirmedPrototypeRevision: null,
        fourLayerAssets: [],
        assembledApplications: [],
        generatedSkills: [],
      } as unknown as BootstrapPayload,
    });

    const html = renderToStaticMarkup(
      <PreferencesProvider>
        <WorkbenchViewHost activeView="app-knowledge-graph" onNavigate={() => {}} />
      </PreferencesProvider>,
    );

    expect(html).toContain('「冷链物流系统」尚未生成业务本体');
    expect(html).toContain('前往第 1 步：开始需求探索');
    expect(html).toContain('进入业务本体手工建模');
  });

  it('renders the foreign demo template notice when knowledge graph shows preloaded demo data', () => {
    seedStore({
      loading: false,
      data: {
        projects: [],
        activeProject: {
          id: 'proj-new',
          name: '冷链物流系统',
          code: 'COLD_CHAIN',
          domain: '冷链物流',
          suite: {
            M1: { domain: '合同全生命周期管理系统', aggregates: [], dictionaries: [] },
          },
          validation: {
            presentModels: ['M1'],
            errorCount: 0,
            warningCount: 0,
            issues: [],
          },
          knowledgeGraph: {
            nodes: [
              {
                id: 'M1:AGG-01',
                model: 'M1',
                kind: 'AGGREGATE',
                elementId: 'AGG-01',
                label: '合同',
              },
            ],
            edges: [],
          },
        },
        projectSnapshots: [],
        agentSessions: [],
        requirementSessions: [],
        requirementDocs: [],
        prototypes: [],
        confirmedPrototypeRevision: null,
        fourLayerAssets: [],
        assembledApplications: [],
        generatedSkills: [],
      } as unknown as BootstrapPayload,
    });

    const html = renderToStaticMarkup(
      <PreferencesProvider>
        <WorkbenchViewHost activeView="app-knowledge-graph" onNavigate={() => {}} />
      </PreferencesProvider>,
    );

    expect(html).toContain('提示：当前图谱来自创建工程时的示例模板');
    expect(html).toContain('合同全生命周期管理系统 (CLM)');
    expect(html).toContain('11 元模型全域业务本体知识图谱');
  });
});
