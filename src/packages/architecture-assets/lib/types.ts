export interface ArchitectureAsset {
  id: string;
  layer: 'UI_UE' | 'TECH_FOUNDATION' | 'TECH_ARCH';
  name: string;
  version: string;
  summary: string;
  tags: string[];
  specMarkdown: string;
  updatedAt: string;
  technologyProfileId?: string;
  sourcePath?: string;
  sourceRevision?: string;
}

export interface TechnologyProfile {
  id: string;
  name: string;
  version: string;
  summary: string;
  frontend: string[];
  backend: string[];
  persistence: string[];
  deployment: string[];
  compatibleAssetIds: string[];
  defaultAssetIds: {
    uiUeAssetId: string;
    techFoundationAssetId: string;
    techArchAssetId: string;
  };
  sourcePath: string;
  sourceRevision: string;
}

export interface ArchitectureAssetCatalogOptions {
  /** Repository catalog directory containing assets/ and profiles/. */
  rootDirectory?: string;
  /** Bundled Worker catalogs are always read-only. */
  writable?: boolean;
}

export interface ArchitectureAssetCatalog {
  listAssets(): ArchitectureAsset[];
  listTechnologyProfiles(): TechnologyProfile[];
  saveAsset(asset: Omit<ArchitectureAsset, 'updatedAt'>): ArchitectureAsset;
  deleteAsset(assetId: string): void;
}
