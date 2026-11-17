import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import url from 'node:url';
import uiAsset from './catalog/assets/asset-ui-spatial-paper.json';
import foundationAsset from './catalog/assets/asset-foundation-ts-edge.json';
import architectureAsset from './catalog/assets/asset-arch-ddd-deep-module.json';
import nodeProfile from './catalog/profiles/profile-react-hono-sqlite-node.json';
import type {
  ArchitectureAsset,
  ArchitectureAssetCatalog,
  ArchitectureAssetCatalogOptions,
  TechnologyProfile,
} from './types.js';

export const DEFAULT_TECHNOLOGY_PROFILE_ID = 'profile-react-hono-sqlite-node';
const SOURCE_ROOT = 'src/packages/architecture-assets/lib/catalog';
const BUNDLED_ASSETS = [uiAsset, foundationAsset, architectureAsset];
const BUNDLED_PROFILES = [nodeProfile];
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,119}$/;

export function isArchitectureAssetCompatible(profile: TechnologyProfile, asset: ArchitectureAsset): boolean {
  return profile.compatibleAssetIds.includes(asset.id) || asset.technologyProfileId === profile.id;
}

function assertId(id: string): void {
  if (typeof id !== 'string' || !SAFE_ID.test(id)) {
    throw new Error('Architecture asset ID must contain 1–120 lowercase letters, digits, or hyphens.');
  }
}

function revision(content: string): string {
  return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
}

function assertAsset(value: unknown): asserts value is ArchitectureAsset {
  const asset = value as Partial<ArchitectureAsset> | null;
  if (!asset || typeof asset !== 'object') throw new Error('Invalid architecture asset source.');
  assertId(asset.id!);
  if (
    !['UI_UE', 'TECH_FOUNDATION', 'TECH_ARCH'].includes(asset.layer ?? '') ||
    !asset.name?.trim() || !asset.version?.trim() || !asset.summary?.trim() ||
    !asset.specMarkdown?.trim() || !Array.isArray(asset.tags) ||
    !asset.tags.every((tag) => typeof tag === 'string')
  ) {
    throw new Error(`Architecture asset ${asset.id} requires a valid layer, name, version, summary, tags, and Markdown standard.`);
  }
}

function assertProfile(value: unknown): asserts value is TechnologyProfile {
  const profile = value as Partial<TechnologyProfile> | null;
  if (!profile || typeof profile !== 'object') throw new Error('Invalid Technology Profile source.');
  assertId(profile.id!);
  if (!profile.name?.trim() || !profile.version?.trim() || !profile.summary?.trim() ||
      ![profile.frontend, profile.backend, profile.persistence, profile.deployment, profile.compatibleAssetIds]
        .every((items) => Array.isArray(items) && items.length > 0 && items.every((item) => typeof item === 'string')) ||
      !profile.defaultAssetIds) {
    throw new Error(`Invalid Technology Profile: ${profile.id}`);
  }
  for (const id of Object.values(profile.defaultAssetIds)) {
    assertId(id);
    if (!profile.compatibleAssetIds!.includes(id)) throw new Error(`Profile ${profile.id} has an incompatible default asset: ${id}`);
  }
}

function serialize(value: object): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Node reads the repository itself; bundled deployments retain a read-only source projection. */
export function createArchitectureAssetCatalog(options: ArchitectureAssetCatalogOptions = {}): ArchitectureAssetCatalog {
  const fileRuntime = import.meta.url.startsWith('file:');
  const rootDirectory = options.rootDirectory ??
    (fileRuntime ? url.fileURLToPath(new URL('./catalog/', import.meta.url)) : undefined);
  const writable = options.writable !== false && Boolean(rootDirectory);

  // Only an explicitly supplied, new directory is initialized. A missing real source catalog is an error.
  if (options.rootDirectory && writable && !fs.existsSync(options.rootDirectory)) {
    fs.mkdirSync(path.join(options.rootDirectory, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(options.rootDirectory, 'profiles'), { recursive: true });
    for (const asset of BUNDLED_ASSETS) fs.writeFileSync(path.join(options.rootDirectory, 'assets', `${asset.id}.json`), serialize(asset));
    for (const profile of BUNDLED_PROFILES) fs.writeFileSync(path.join(options.rootDirectory, 'profiles', `${profile.id}.json`), serialize(profile));
  }

  function sourceFile(kind: 'assets' | 'profiles', id: string): string {
    assertId(id);
    if (!rootDirectory) throw new Error('Repository standards are read-only in this runtime. Edit the repository source in Node.js and redeploy.');
    const root = fs.realpathSync(rootDirectory);
    const directory = path.join(root, kind);
    if (fs.lstatSync(directory).isSymbolicLink() || fs.realpathSync(directory) !== directory) {
      throw new Error('Architecture catalog directories must not be symbolic links.');
    }
    const target = path.join(directory, `${id}.json`);
    if (fs.existsSync(target) && (fs.lstatSync(target).isSymbolicLink() || !fs.lstatSync(target).isFile())) {
      throw new Error('Architecture source files must be regular files, not symbolic links.');
    }
    return target;
  }

  function readSources(kind: 'assets' | 'profiles'): { value: unknown; content: string; sourcePath: string }[] {
    if (!rootDirectory) {
      const bundled = kind === 'assets' ? BUNDLED_ASSETS : BUNDLED_PROFILES;
      return bundled.map((value) => ({ value: structuredClone(value), content: serialize(value), sourcePath: `${SOURCE_ROOT}/${kind}/${value.id}.json` }));
    }
    const names = fs.readdirSync(path.join(rootDirectory, kind)).filter((name) => name.endsWith('.json')).sort();
    return names.map((name) => {
      const id = name.slice(0, -5);
      const content = fs.readFileSync(sourceFile(kind, id), 'utf8');
      let value: unknown;
      try { value = JSON.parse(content); } catch { throw new Error(`Invalid repository standard JSON: ${kind}/${name}`); }
      if ((value as { id?: string })?.id !== id) throw new Error(`Repository standard ID must match its filename: ${kind}/${name}`);
      return { value, content, sourcePath: `${SOURCE_ROOT}/${kind}/${name}` };
    });
  }

  function assertWritable(): void {
    if (!writable) throw new Error('Repository standards are read-only in this runtime. Edit the repository source in Node.js and redeploy.');
  }

  return {
    listAssets() {
      return readSources('assets').map(({ value, content, sourcePath }) => {
        assertAsset(value);
        return { ...value, sourcePath, sourceRevision: revision(content) };
      });
    },
    listTechnologyProfiles() {
      return readSources('profiles').map(({ value, content, sourcePath }) => {
        assertProfile(value);
        return { ...value, sourcePath, sourceRevision: revision(content) };
      });
    },
    saveAsset(asset) {
      assertWritable();
      assertAsset(asset);
      const target = sourceFile('assets', asset.id);
      const full: ArchitectureAsset = {
        id: asset.id, layer: asset.layer, name: asset.name, version: asset.version,
        summary: asset.summary, tags: [...asset.tags], specMarkdown: asset.specMarkdown,
        ...(asset.technologyProfileId ? { technologyProfileId: asset.technologyProfileId } : {}),
        updatedAt: new Date().toISOString(),
      };
      const content = serialize(full);
      const temporary = path.join(path.dirname(target), `.${asset.id}-${crypto.randomUUID()}.tmp`);
      try {
        // The directory and filename are selected by the catalog, never by caller-supplied paths.
        fs.writeFileSync(temporary, content, { flag: 'wx' });
        fs.renameSync(temporary, target);
      } catch (error) {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        throw new Error(`Cannot save repository standard ${asset.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
      return { ...full, sourcePath: `${SOURCE_ROOT}/assets/${asset.id}.json`, sourceRevision: revision(content) };
    },
    deleteAsset(assetId) {
      assertWritable();
      const target = sourceFile('assets', assetId);
      if (fs.existsSync(target)) fs.unlinkSync(target);
    },
  };
}

export function listTechnologyProfiles(): TechnologyProfile[] {
  return createArchitectureAssetCatalog({ writable: false }).listTechnologyProfiles();
}
