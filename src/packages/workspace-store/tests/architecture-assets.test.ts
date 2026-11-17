import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspaceStore, DEFAULT_TECHNOLOGY_PROFILE_ID } from '../index.js';

const directories: string[] = [];
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-assets-test-'));
  directories.push(directory);
  const architectureAssetsRoot = path.join(directory, 'catalog');
  const store = createWorkspaceStore({ dbPath: ':memory:', enableFileMirror: false, architectureAssetsRoot });
  return { store, architectureAssetsRoot };
}
afterEach(() => directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));

describe('workspace repository standards', () => {
  it('propagates source edits into an existing store and persists UI edits to source', () => {
    const { store, architectureAssetsRoot } = fixture();
    expect(store.listTechnologyProfiles()[0]!.id).toBe(DEFAULT_TECHNOLOGY_PROFILE_ID);
    const original = store.listFourLayerAssets().find((asset) => asset.id === 'asset-foundation-ts-edge')!;
    const filename = path.join(architectureAssetsRoot, 'assets', `${original.id}.json`);
    const source = JSON.parse(fs.readFileSync(filename, 'utf8'));
    source.summary = 'Changed in the repository after workspace startup';
    fs.writeFileSync(filename, JSON.stringify(source));
    expect(store.listFourLayerAssets().find((asset) => asset.id === original.id)!.summary).toBe(source.summary);
    const saved = store.saveFourLayerAsset({ ...original, specMarkdown: '# Updated standard\n\nA user-authored repository decision.' });
    expect(JSON.parse(fs.readFileSync(filename, 'utf8')).specMarkdown).toBe(saved.specMarkdown);
    expect(saved.technologyProfileId).toBe(DEFAULT_TECHNOLOGY_PROFILE_ID);
    expect(saved.sourceRevision).not.toBe(original.sourceRevision);
    expect(() => store.deleteFourLayerAsset(original.id)).toThrow(/referenced/);
  });

  it('saves and deletes user-owned standards without resurrecting database projections', () => {
    const { store, architectureAssetsRoot } = fixture();
    const template = store.listFourLayerAssets()[0]!;
    const saved = store.saveFourLayerAsset({ ...template, id: 'asset-user-standard', name: 'User standard' });
    expect(fs.existsSync(path.join(architectureAssetsRoot, 'assets', `${saved.id}.json`))).toBe(true);
    fs.unlinkSync(path.join(architectureAssetsRoot, 'assets', `${saved.id}.json`));
    expect(store.listFourLayerAssets().some((asset) => asset.id === saved.id)).toBe(false);
    store.saveFourLayerAsset(saved);
    store.deleteFourLayerAsset(saved.id);
    expect(store.listFourLayerAssets().some((asset) => asset.id === saved.id)).toBe(false);
  });
});
