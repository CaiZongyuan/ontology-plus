import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createArchitectureAssetCatalog, DEFAULT_TECHNOLOGY_PROFILE_ID, isArchitectureAssetCompatible } from '../index.js';

const directories: string[] = [];
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-catalog-test-'));
  directories.push(directory);
  const rootDirectory = path.join(directory, 'catalog');
  return { rootDirectory, catalog: createArchitectureAssetCatalog({ rootDirectory }) };
}
afterEach(() => directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));

describe('repository architecture catalog', () => {
  it('provides a coherent Node profile with substantive implementation and acceptance guidance', () => {
    const { catalog } = fixture();
    const profile = catalog.listTechnologyProfiles().find((item) => item.id === DEFAULT_TECHNOLOGY_PROFILE_ID)!;
    expect(profile.frontend).toEqual(['React', 'Vite', 'TanStack Router', 'Zustand', 'shadcn/ui with Base UI']);
    expect(profile.persistence).toEqual(['Drizzle ORM', 'SQLite']);
    const assets = catalog.listAssets();
    expect(Object.values(profile.defaultAssetIds).every((id) => assets.some((asset) => asset.id === id))).toBe(true);
    expect(assets.every((asset) => asset.specMarkdown.length > 3000 && asset.sourceRevision?.startsWith('sha256:'))).toBe(true);
    expect(assets.find((asset) => asset.layer === 'UI_UE')!.specMarkdown).toContain('does not impose Ontology Plus');
    expect(assets.find((asset) => asset.layer === 'TECH_FOUNDATION')!.specMarkdown).toContain('migration');
    expect(isArchitectureAssetCompatible(profile, { ...assets[0]!, id: 'asset-team-standard' })).toBe(true);
    expect(isArchitectureAssetCompatible(profile, { ...assets[0]!, id: 'asset-foreign', technologyProfileId: 'another-profile' })).toBe(false);
  });

  it('reads changed source immediately and writes edits back to the same bounded source file', () => {
    const { rootDirectory, catalog } = fixture();
    const original = catalog.listAssets()[0]!;
    const filename = path.join(rootDirectory, 'assets', `${original.id}.json`);
    const changed = { ...JSON.parse(fs.readFileSync(filename, 'utf8')), specMarkdown: '# Revised source\n\nA new repository decision.' };
    fs.writeFileSync(filename, JSON.stringify(changed));
    const reread = catalog.listAssets().find((asset) => asset.id === original.id)!;
    expect(reread.specMarkdown).toBe(changed.specMarkdown);
    expect(reread.sourceRevision).not.toBe(original.sourceRevision);
    const saved = catalog.saveAsset({ ...reread, specMarkdown: '# User edit\n\nSaved to source.', sourcePath: '../outside.json' });
    expect(JSON.parse(fs.readFileSync(filename, 'utf8')).specMarkdown).toBe(saved.specMarkdown);
    expect(saved.sourcePath).toBe(`src/packages/architecture-assets/lib/catalog/assets/${original.id}.json`);
  });

  it('rejects path traversal, mismatched source IDs and writes in read-only runtimes', () => {
    const { rootDirectory, catalog } = fixture();
    const asset = catalog.listAssets()[0]!;
    expect(() => catalog.saveAsset({ ...asset, id: '../../escape' })).toThrow(/ID must contain/);
    expect(() => catalog.deleteAsset('C:\\escape')).toThrow(/ID must contain/);
    const readOnly = createArchitectureAssetCatalog({ rootDirectory, writable: false });
    expect(readOnly.listAssets()).toHaveLength(3);
    expect(() => readOnly.saveAsset(asset)).toThrow(/read-only.*Node.js.*redeploy/);
    expect(() => readOnly.deleteAsset(asset.id)).toThrow(/read-only/);
    fs.writeFileSync(path.join(rootDirectory, 'assets', 'wrong-id.json'), JSON.stringify(asset));
    expect(() => catalog.listAssets()).toThrow(/must match its filename/);
  });
});
