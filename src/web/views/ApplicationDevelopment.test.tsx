import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceStore } from '../../packages/workspace-store/index.js';
import { createApiApp } from '../../server/app.js';
import { useWorkbenchStore, type BootstrapPayload } from '../api.js';
import { PreferencesProvider } from '../i18n.js';
import { AppPublishView, ApplicationAssemblyDevView, fetchSavedApplicationPackage, FourLayerAssetsView } from './ApplicationCenterViews.js';

afterEach(() => {
  vi.unstubAllGlobals();
  useWorkbenchStore.setState({ data: null, activeItemId: null });
  Object.assign(useWorkbenchStore.getInitialState(), { data: null, activeItemId: null });
});

async function fixture() {
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'onto_locale' ? 'en-US' : null, setItem: () => {}, removeItem: () => {} });
  const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false });
  const response = await createApiApp(store).request('/api/bootstrap?projectId=proj-contract');
  const data = await response.json() as BootstrapPayload & { technologyProfiles: ReturnType<typeof store.listTechnologyProfiles> };
  data.technologyProfiles = store.listTechnologyProfiles();
  useWorkbenchStore.setState({ data, activeItemId: 'app-contract-clm' });
  Object.assign(useWorkbenchStore.getInitialState(), useWorkbenchStore.getState());
  return data;
}

describe('application development handoff UI', () => {
  it('shows ordered confirmation, standards, origin, and package steps with separate generation and download', async () => {
    await fixture();
    const html = renderToStaticMarkup(<PreferencesProvider><ApplicationAssemblyDevView /></PreferencesProvider>);
    const ordered = ['development-step-confirm', 'development-step-standards', 'development-step-origins', 'development-step-generate'].map((id) => html.indexOf(`data-testid="${id}"`));
    expect(ordered.every((position, index) => position >= 0 && (index === 0 || position > ordered[index - 1]!))).toBe(true);
    expect(html).toContain('Project prototype and revision');
    expect(html).toContain('profile-react-hono-sqlite-node');
    expect(html).toContain('src/packages/architecture-assets/lib/catalog/assets/');
    expect(html).toContain('sha256:');
    expect(html).toContain('AGENTS.md');
    expect(html).toContain('data-testid="compile-dev-package-btn"');
    expect(html).toMatch(/disabled=""[^>]*>Download saved snapshot/);
    expect(html).toContain('Application Development Agent');
    expect(html).not.toContain('Generates domain repositories');
    expect(html).not.toContain('4A Gate');
  });

  it('identifies missing selections instead of substituting another library standard', async () => {
    const data = await fixture();
    data.assembledApplications[0]!.techFoundationAssetId = 'asset-missing-user-choice';
    useWorkbenchStore.setState({ data });
    const html = renderToStaticMarkup(<PreferencesProvider><ApplicationAssemblyDevView /></PreferencesProvider>);
    expect(html).toContain('Selected standard 2 is missing. Select it explicitly.');
    expect(html).toContain('Current standard is missing or incompatible');
    expect(html).toMatch(/data-testid="compile-dev-package-btn" disabled=""/);
  });

  it('surfaces explicitly recorded contradictions in review and blocks generation', async () => {
    const data = await fixture();
    Object.assign(data.assembledApplications[0]!, { developmentBlockers: ['The selected UI standard contradicts the confirmed navigation design.'] });
    const html = renderToStaticMarkup(<PreferencesProvider><ApplicationAssemblyDevView /></PreferencesProvider>);
    expect(html).toContain('data-testid="application-recorded-blockers"');
    expect(html).toContain('Resolve the recorded contradiction: The selected UI standard contradicts');
    expect(html).toMatch(/data-testid="compile-dev-package-btn" disabled=""/);
  });

  it('exposes repository origins and a distinct authoring agent, and presents delivery as a package handoff', async () => {
    await fixture();
    const library = renderToStaticMarkup(<PreferencesProvider><FourLayerAssetsView /></PreferencesProvider>);
    expect(library).toContain('Architecture Asset Agent');
    expect(library).toContain('Saving writes to repository files');
    expect(library).toContain('asset-source-asset-foundation-ts-edge');
    const delivery = renderToStaticMarkup(<PreferencesProvider><AppPublishView /></PreferencesProvider>);
    expect(delivery).toContain('Development Package handoff');
    expect(delivery).not.toContain('Publish Release');
    expect(delivery).not.toContain('4A Gate');
  });
});

describe('saved package browser consumer', () => {
  it('treats the explicit not-generated response as an empty state and keeps missing applications actionable', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: 'PACKAGE_NOT_GENERATED', compiledPackage: null, stale: false }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Application not found' }), { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchSavedApplicationPackage('app-a')).toEqual({ compiledPackage: null, stale: false });
    await expect(fetchSavedApplicationPackage('app-absent')).rejects.toThrow('Application not found');
  });

  it('retains saved snapshot content and stale status, passes cancellation and rejects a mismatched application', async () => {
    const controller = new AbortController();
    const compiledPackage = { appId: 'app-a', files: [{ relativePath: 'AGENTS.md', content: 'Saved snapshot instructions' }] };
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ compiledPackage, stale: true, inputIssue: 'Selected profile is missing.' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ compiledPackage: { ...compiledPackage, appId: 'app-b' }, stale: false })));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchSavedApplicationPackage('app-a', controller.signal)).toEqual({ compiledPackage, stale: true, inputIssue: 'Selected profile is missing.' });
    expect(fetch).toHaveBeenCalledWith('/api/applications/app-a/package', { signal: controller.signal });
    await expect(fetchSavedApplicationPackage('app-a')).rejects.toThrow('different application');
  });
});
