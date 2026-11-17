import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceStore } from '../../packages/workspace-store/index.js';
import { createApiApp } from '../../server/app.js';
import { useWorkbenchStore, type BootstrapPayload } from '../api.js';
import { PreferencesProvider } from '../i18n.js';
import * as Barrel from './ApplicationCenterViews.js';
import { OverviewSessionsView } from './application-center/OverviewSessionsView.js';
import {
  RequirementDocsView,
  RequirementExploreView,
} from './application-center/RequirementsStepViews.js';
import {
  PrototypeStudioView,
  resolvePrototypeStudioStage,
  type PrototypeStudioStage,
  type PrototypeStudioViewProps,
} from './application-center/PrototypeStudioView.js';
import { ModelFilesView } from './application-center/ModelFilesView.js';
import {
  AppPublishView,
  ApplicationAssemblyDevView,
  fetchSavedApplicationPackage,
  FourLayerAssetsView,
  OntologySkillsView,
} from './application-center/DeliveryStepViews.js';
import { ViewModeHeader } from './application-center/ViewModeHeader.js';

afterEach(() => {
  vi.unstubAllGlobals();
  useWorkbenchStore.setState({ data: null, activeItemId: null, activeSessionId: null });
  Object.assign(useWorkbenchStore.getInitialState(), {
    data: null,
    activeItemId: null,
    activeSessionId: null,
  });
});

async function seedBootstrap(projectId = 'proj-contract') {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'onto_locale' ? 'en-US' : null),
    setItem: () => {},
    removeItem: () => {},
  });
  const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
  const response = await createApiApp(store).request(`/api/bootstrap?projectId=${projectId}`);
  const data = (await response.json()) as BootstrapPayload & {
    technologyProfiles: ReturnType<typeof store.listTechnologyProfiles>;
  };
  data.technologyProfiles = store.listTechnologyProfiles();
  useWorkbenchStore.setState({ data, activeItemId: null, activeSessionId: null });
  Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
  store.close();
  return data;
}

describe('ApplicationCenterViews step module split', () => {
  it('renders OverviewSessionsView from its dedicated module identically to the barrel', async () => {
    const data = await seedBootstrap();
    expect(OverviewSessionsView).toBe(Barrel.OverviewSessionsView);

    const noop = () => {};
    const html = renderToStaticMarkup(
      <PreferencesProvider>
        <OverviewSessionsView onNavigate={noop} />
      </PreferencesProvider>,
    );
    expect(html).toContain('data-testid="project-hub-registry"');
    expect(html).toContain(data.activeProject.code);
    expect(html).toContain('End-to-End Application Ontology Lifecycle Pipeline');
  });

  it('renders RequirementExploreView, RequirementDocsView, and shared ViewModeHeader identically to the barrel', async () => {
    const data = await seedBootstrap();
    expect(RequirementExploreView).toBe(Barrel.RequirementExploreView);
    expect(RequirementDocsView).toBe(Barrel.RequirementDocsView);

    const noop = () => {};
    const exploreHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <RequirementExploreView onNavigate={noop} />
      </PreferencesProvider>,
    );
    expect(exploreHtml).toContain('data-testid="requirement-board"');
    expect(exploreHtml).toContain('data-testid="synthesize-srs-btn"');

    const docsHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <RequirementDocsView onNavigate={noop} />
      </PreferencesProvider>,
    );
    expect(docsHtml).toContain('data-testid="srs-mode-workspace"');
    expect(docsHtml).toContain('data-testid="srs-mode-registry"');
    expect(docsHtml).toContain('data-testid="generate-prototype-btn"');
    expect(docsHtml).toContain(data.requirementDocs[0]!.status);
    expect(docsHtml).toContain('Save Draft');

    const headerHtml = renderToStaticMarkup(
      <ViewModeHeader
        mode="WORKSPACE"
        onChange={noop}
        workspaceLabel="Editor"
        registryLabel="All Versions"
        count={3}
        testIdPrefix="shared-check"
      />,
    );
    expect(headerHtml).toContain('data-testid="shared-check-mode-workspace"');
    expect(headerHtml).toContain('data-testid="shared-check-mode-registry"');
    expect(headerHtml).toContain('>3<');
  });

  it('renders PrototypeStudioView and exports stage helpers identically to the barrel', async () => {
    const data = await seedBootstrap();
    expect(PrototypeStudioView).toBe(Barrel.PrototypeStudioView);
    expect(resolvePrototypeStudioStage).toBe(Barrel.resolvePrototypeStudioStage);

    const stageWhenEmpty: PrototypeStudioStage = resolvePrototypeStudioStage(0, 'CANVAS');
    expect(stageWhenEmpty).toBe('BRIEFING');
    expect(resolvePrototypeStudioStage(2, null)).toBe('CANVAS');
    expect(resolvePrototypeStudioStage(2, 'BRIEFING')).toBe('BRIEFING');

    const props: PrototypeStudioViewProps = { defaultStageOverride: null };
    const canvasHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <PrototypeStudioView {...props} />
      </PreferencesProvider>,
    );
    expect(canvasHtml).toContain(data.prototypes[0]!.name);
  });

  it('renders ModelFilesView for both synthesized suites and pre-ontology projects identically to the barrel', async () => {
    const data = await seedBootstrap();
    expect(ModelFilesView).toBe(Barrel.ModelFilesView);

    const readyHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <ModelFilesView />
      </PreferencesProvider>,
    );
    expect(readyHtml).toContain('manifest.json');
    expect(readyHtml).toContain('m1-object-model.yaml');
    expect(readyHtml).toContain('data-testid="export-owl-btn"');
    expect(readyHtml).toContain('data-testid="generate-skill-btn"');
    expect(readyHtml).toContain('data-testid="publish-mcp-btn"');

    data.activeProject.suite = {};
    data.activeProject.validation.presentModels = [];
    useWorkbenchStore.setState({ data });
    const pendingHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <ModelFilesView />
      </PreferencesProvider>,
    );
    expect(pendingHtml).toContain('data-testid="model-files-stage-pending"');
  });

  it('renders DeliveryStepViews and preserves full runtime export parity on the ApplicationCenterViews barrel', async () => {
    const data = await seedBootstrap();
    expect(FourLayerAssetsView).toBe(Barrel.FourLayerAssetsView);
    expect(fetchSavedApplicationPackage).toBe(Barrel.fetchSavedApplicationPackage);
    expect(ApplicationAssemblyDevView).toBe(Barrel.ApplicationAssemblyDevView);
    expect(OntologySkillsView).toBe(Barrel.OntologySkillsView);
    expect(AppPublishView).toBe(Barrel.AppPublishView);

    expect(Object.keys(Barrel).sort()).toEqual([
      'AppPublishView',
      'ApplicationAssemblyDevView',
      'FourLayerAssetsView',
      'ModelFilesView',
      'OntologySkillsView',
      'OverviewSessionsView',
      'PrototypeStudioView',
      'RequirementDocsView',
      'RequirementExploreView',
      'RequirementsStepView',
      'fetchSavedApplicationPackage',
      'formatRequirementTextForBusinessView',
      'resolvePrototypeStudioStage',
    ]);

    const skillsHtml = renderToStaticMarkup(
      <PreferencesProvider>
        <OntologySkillsView />
      </PreferencesProvider>,
    );
    expect(skillsHtml).toContain('data-testid="skills-mode-workspace"');
    expect(skillsHtml).toContain('data-testid="skills-mode-registry"');
    expect(skillsHtml).toContain(data.generatedSkills[0]!.slug);
  });
});
