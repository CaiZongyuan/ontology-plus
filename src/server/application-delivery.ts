import type { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_TECHNOLOGY_PROFILE_ID,
  type DevelopmentPackageSnapshot,
  type FourLayerAsset,
  type WorkspaceStore,
} from '../packages/workspace-store/index.js';
import {
  buildDevelopmentPackageZip,
  compileDevelopmentPackage,
  DevelopmentPackageInputError,
  fingerprintDevelopmentPackageInputs,
  type CompileDevelopmentPackageInput,
} from '../packages/package-compiler/index.js';

class AssemblyInputError extends Error {
  constructor(message: string, readonly status: 404 | 422 = 422) {
    super(message);
  }
}

function resolveInputs(store: WorkspaceStore, appId: string): CompileDevelopmentPackageInput {
  const application = store.listAssembledApplications().find((item) => item.id === appId);
  if (!application) throw new AssemblyInputError('Application not found.', 404);
  const project = store.getProject(application.projectId);
  if (!project) throw new AssemblyInputError('Application project not found.', 404);
  if (application.developmentBlockers?.length) {
    throw new AssemblyInputError(`Resolve the application's recorded development conflicts before generation: ${application.developmentBlockers.join('; ')}`);
  }
  const profileId = application.technologyProfileId ?? DEFAULT_TECHNOLOGY_PROFILE_ID;
  const technologyProfile = store.listTechnologyProfiles().find((profile) => profile.id === profileId);
  if (!technologyProfile) throw new AssemblyInputError(`Technology Profile not found: ${profileId}. Select an available repository profile.`);

  const assets = store.listFourLayerAssets();
  const selectAsset = (id: string, layer: FourLayerAsset['layer']): FourLayerAsset => {
    const asset = assets.find((item) => item.id === id && item.layer === layer);
    if (!asset) throw new AssemblyInputError(`Selected ${layer} standard not found: ${id}. Select its replacement explicitly.`);
    if (!technologyProfile.compatibleAssetIds.includes(id) && asset.technologyProfileId !== profileId) {
      throw new AssemblyInputError(`Standard ${id} is not compatible with Technology Profile ${profileId}.`);
    }
    return asset;
  };

  const confirmed = store.getConfirmedPrototypeRevision(project.id);
  if (!confirmed) throw new AssemblyInputError('Confirm a prototype revision and review its UI Model changes before generating this package.');
  if (application.prototypeRevisionId && application.prototypeRevisionId !== confirmed.revisionId) {
    throw new AssemblyInputError('The selected prototype revision is not the project\'s Confirmed Revision. Confirm it with its UI Model changes or select the confirmed revision.');
  }
  const stepConfirmations = store.getProjectStepConfirmations(project.id);
  const confirmedReq = stepConfirmations.requirements;
  const requirementDoc = confirmedReq
    ? {
        id: confirmedReq.docId,
        projectId: project.id,
        title: confirmedReq.title,
        version: confirmedReq.version,
        status: 'CONFIRMED' as const,
        content: confirmedReq.content,
        updatedAt: confirmedReq.confirmedAt,
      }
    : store.listRequirementDocs(project.id).find((document) => document.status !== 'DRAFT');
  if (!requirementDoc) throw new AssemblyInputError('Confirm the project requirements before generating this package.');

  return {
    app: application,
    project,
    technologyProfile,
    uiUeAsset: selectAsset(application.uiUeAssetId, 'UI_UE'),
    techFoundationAsset: selectAsset(application.techFoundationAssetId, 'TECH_FOUNDATION'),
    techArchAsset: selectAsset(application.techArchAssetId, 'TECH_ARCH'),
    requirementDoc,
    prototype: {
      ...confirmed.prototype,
      currentRevisionId: confirmed.revisionId,
      htmlContent: confirmed.htmlContent,
      extractedScreenCount: confirmed.revision.extractedScreenCount,
    },
    prototypeRevision: {
      id: confirmed.revisionId,
      prototypeId: confirmed.prototypeId,
      revisionNumber: confirmed.revision.revisionNumber,
      confirmedAt: confirmed.confirmedAt,
      createdAt: confirmed.revision.createdAt,
    },
    applicationInstructions: application.developmentInstructions,
    writeToDisk: false,
  };
}

function findSnapshot(store: WorkspaceStore, appId: string, snapshotId?: string): DevelopmentPackageSnapshot | undefined {
  const application = store.listAssembledApplications().find((item) => item.id === appId);
  if (!application) throw new AssemblyInputError('Application not found.', 404);
  const selectedId = snapshotId ?? application.latestPackageSnapshotId;
  if (!selectedId) return undefined;
  const snapshot = store.getDevelopmentPackageSnapshot(selectedId);
  if (!snapshot || snapshot.appId !== appId) {
    throw new AssemblyInputError('Development package snapshot not found for this application.', 404);
  }
  return snapshot;
}

export function registerApplicationDeliveryRoutes(app: Hono, store: WorkspaceStore): void {
  app.post('/api/applications/:appId/compile-package', (c) => {
    try {
      const rawCompiled = compileDevelopmentPackage({
        ...resolveInputs(store, c.req.param('appId')),
        snapshotId: `pkg-${randomUUID()}`,
      });
      const modelConfirmationId =
        store.getProjectStepConfirmations(rawCompiled.projectId).businessModel?.id ?? null;
      const compiledPackage: DevelopmentPackageSnapshot = {
        ...rawCompiled,
        basedOnBusinessModelConfirmationId: modelConfirmationId,
      };
      store.saveDevelopmentPackageSnapshot(compiledPackage);
      return c.json({
        compiledPackage,
        stale: false,
        assembledApplications: store.listAssembledApplications(),
      });
    } catch (error) {
      const status = error instanceof AssemblyInputError ? error.status : 422;
      return c.json({
        code: status === 404 ? 'APPLICATION_NOT_FOUND' : 'INVALID_ASSEMBLY_INPUT',
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof DevelopmentPackageInputError ? { diagnostics: error.diagnostics } : {}),
      }, status);
    }
  });

  app.get('/api/applications/:appId/package', (c) => {
    const appId = c.req.param('appId');
    const snapshot = findSnapshot(store, appId, c.req.query('snapshotId'));
    if (!snapshot) {
      return c.json({
        code: 'PACKAGE_NOT_GENERATED', error: 'Generate the development package before previewing or downloading it.',
        compiledPackage: null, stale: false,
      }, 409);
    }
    let stale = true;
    let inputIssue: string | undefined;
    try {
      stale = fingerprintDevelopmentPackageInputs(resolveInputs(store, appId)) !== snapshot.inputFingerprint;
    } catch (error) {
      inputIssue = error instanceof Error ? error.message : String(error);
    }
    return c.json({
      compiledPackage: snapshot,
      stale,
      ...(inputIssue ? { inputIssue } : {}),
      snapshots: store.listDevelopmentPackageSnapshots(appId).map((item) => ({
        snapshotId: item.snapshotId, compiledAt: item.compiledAt, inputFingerprint: item.inputFingerprint,
      })),
    });
  });

  app.get('/api/applications/:appId/package.zip', (c) => {
    const snapshot = findSnapshot(store, c.req.param('appId'), c.req.query('snapshotId'));
    if (!snapshot) {
      return c.json({ code: 'PACKAGE_NOT_GENERATED', error: 'Generate and review the development package before downloading it.' }, 409);
    }
    const zip = buildDevelopmentPackageZip(snapshot);
    return new Response(zip.zipBytes, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zip.fileName}"`,
        'Content-Length': String(zip.zipBytes.byteLength),
        'Cache-Control': 'no-store',
      },
    });
  });
}
