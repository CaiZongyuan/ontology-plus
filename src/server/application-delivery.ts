import type { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { normalizeAgentLocale, type AgentLocale } from '../packages/agent-runtime/index.js';
import {
  buildKnowledgeGraph,
  validateOntologySuite,
} from '../packages/ontology-core/index.js';
import {
  DEFAULT_TECHNOLOGY_PROFILE_ID,
  type AssembledApplication,
  type DevelopmentPackageSnapshot,
  type FourLayerAsset,
  type ProjectDetail,
  type WorkspaceStore,
} from '../packages/workspace-store/index.js';
import {
  buildDevelopmentPackageZip,
  compileDevelopmentPackage,
  DevelopmentPackageInputError,
  fingerprintDevelopmentPackageInputs,
  type CompileDevelopmentPackageInput,
} from '../packages/package-compiler/index.js';
import {
  deriveProjectStepsForStoreProject,
  listProjectPackageSnapshots,
} from './step-confirmations.js';

class AssemblyInputError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422 = 422,
    readonly code?: string,
  ) {
    super(message);
  }
}

function resolveRequestLocale(c: {
  req: { header: (name: string) => string | undefined };
}): AgentLocale {
  return normalizeAgentLocale(c.req.header('x-onto-locale') ?? undefined) ?? 'zh-CN';
}

function buildDefaultApplicationId(store: WorkspaceStore, project: ProjectDetail): string {
  const slug = project.code
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = `app-${slug || project.id.replace(/[^a-zA-Z0-9._-]+/g, '-')}`;
  const existingIds = new Set(store.listAssembledApplications().map((item) => item.id));
  if (!existingIds.has(base)) return base;
  let suffix = 2;
  while (existingIds.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

export function ensureProjectDefaultApplication(
  store: WorkspaceStore,
  project: ProjectDetail,
  confirmedRevisionId?: string,
): AssembledApplication {
  const existing = store
    .listAssembledApplications()
    .find((item) => item.projectId === project.id);
  if (existing) {
    if (
      confirmedRevisionId &&
      existing.prototypeRevisionId &&
      existing.prototypeRevisionId !== confirmedRevisionId
    ) {
      return store.saveAssembledApplication({
        ...existing,
        prototypeRevisionId: confirmedRevisionId,
      });
    }
    return existing;
  }

  const profiles = store.listTechnologyProfiles();
  const profile =
    profiles.find((entry) => entry.id === DEFAULT_TECHNOLOGY_PROFILE_ID) ?? profiles[0];
  if (!profile) {
    throw new AssemblyInputError(
      `Technology Profile not found: ${DEFAULT_TECHNOLOGY_PROFILE_ID}. Select an available repository profile.`,
      422,
    );
  }

  return store.saveAssembledApplication({
    id: buildDefaultApplicationId(store, project),
    name: project.name,
    projectId: project.id,
    technologyProfileId: profile.id,
    ...profile.defaultAssetIds,
    ...(confirmedRevisionId ? { prototypeRevisionId: confirmedRevisionId } : {}),
    developmentInstructions: '',
    status: 'ASSEMBLED',
    agentDevLogs: [],
  });
}

function requireConfirmedUpstreamSteps(
  store: WorkspaceStore,
  projectId: string,
  locale: AgentLocale,
) {
  const confirmed = store.getConfirmedPrototypeRevision(projectId);
  if (!confirmed) {
    throw new AssemblyInputError(
      locale === 'zh-CN'
        ? '请先在「原型」步骤确认界面原型，再生成开发包。'
        : 'Confirm a prototype revision and review its UI Model changes before generating this package.',
      409,
      'PROTOTYPE_UNCONFIRMED',
    );
  }
  const stepConfirmations = store.getProjectStepConfirmations(projectId);
  const confirmedModel = stepConfirmations.businessModel;
  if (!confirmedModel) {
    throw new AssemblyInputError(
      locale === 'zh-CN'
        ? '请先在「业务模型」步骤确认业务模型，再生成开发包。'
        : 'Confirm the Business Model before generating this development package.',
      409,
      'BUSINESS_MODEL_UNCONFIRMED',
    );
  }
  const confirmedReq = stepConfirmations.requirements;
  if (!confirmedReq) {
    throw new AssemblyInputError(
      locale === 'zh-CN'
        ? '请先在「需求」步骤确认需求文档，再生成开发包。'
        : 'Confirm the project requirements before generating this package.',
      409,
      'REQUIREMENTS_UNCONFIRMED',
    );
  }
  return { confirmed, confirmedModel, confirmedReq };
}

function resolveInputs(
  store: WorkspaceStore,
  appId: string,
  locale: AgentLocale = 'en-US',
): CompileDevelopmentPackageInput {
  const application = store.listAssembledApplications().find((item) => item.id === appId);
  if (!application) throw new AssemblyInputError('Application not found.', 404, 'APPLICATION_NOT_FOUND');
  const project = store.getProject(application.projectId);
  if (!project) throw new AssemblyInputError('Application project not found.', 404, 'APPLICATION_NOT_FOUND');
  if (application.developmentBlockers?.length) {
    throw new AssemblyInputError(
      locale === 'zh-CN'
        ? `请先处理已记录的交付冲突后再生成开发包：${application.developmentBlockers.join('；')}`
        : `Resolve the application's recorded development conflicts before generation: ${application.developmentBlockers.join('; ')}`,
    );
  }
  const profileId = application.technologyProfileId ?? DEFAULT_TECHNOLOGY_PROFILE_ID;
  const technologyProfile = store.listTechnologyProfiles().find((profile) => profile.id === profileId);
  if (!technologyProfile) {
    throw new AssemblyInputError(
      `Technology Profile not found: ${profileId}. Select an available repository profile.`,
    );
  }

  const assets = store.listFourLayerAssets();
  const selectAsset = (id: string, layer: FourLayerAsset['layer']): FourLayerAsset => {
    const asset = assets.find((item) => item.id === id && item.layer === layer);
    if (!asset) {
      throw new AssemblyInputError(`Selected ${layer} standard not found: ${id}. Select its replacement explicitly.`);
    }
    if (!technologyProfile.compatibleAssetIds.includes(id) && asset.technologyProfileId !== profileId) {
      throw new AssemblyInputError(`Standard ${id} is not compatible with Technology Profile ${profileId}.`);
    }
    return asset;
  };
  const uiUeAsset = selectAsset(application.uiUeAssetId, 'UI_UE');
  const techFoundationAsset = selectAsset(application.techFoundationAssetId, 'TECH_FOUNDATION');
  const techArchAsset = selectAsset(application.techArchAssetId, 'TECH_ARCH');

  const confirmedProto = store.getConfirmedPrototypeRevision(project.id);
  if (
    confirmedProto &&
    application.prototypeRevisionId &&
    application.prototypeRevisionId !== confirmedProto.revisionId
  ) {
    throw new AssemblyInputError(
      "The selected prototype revision is not the project's Confirmed Revision. Confirm it with its UI Model changes or select the confirmed revision.",
      422,
    );
  }
  const { confirmed, confirmedModel, confirmedReq } = requireConfirmedUpstreamSteps(
    store,
    project.id,
    locale,
  );

  const confirmedSuite = structuredClone(confirmedModel.suiteSnapshot ?? confirmedModel.suite);
  const confirmedValidation = validateOntologySuite(confirmedSuite);
  const confirmedProject: ProjectDetail = {
    ...project,
    updatedAt: confirmedModel.confirmedAt,
    suite: confirmedSuite,
    validation: confirmedValidation,
    knowledgeGraph: buildKnowledgeGraph(confirmedSuite),
  };

  const requirementDoc = {
    id: confirmedReq.docId,
    projectId: project.id,
    title: confirmedReq.title,
    version: confirmedReq.version,
    status: 'CONFIRMED' as const,
    content: confirmedReq.content,
    updatedAt: confirmedReq.confirmedAt,
  };

  return {
    app: application,
    project: confirmedProject,
    technologyProfile,
    uiUeAsset,
    techFoundationAsset,
    techArchAsset,
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
    basedOnBusinessModelConfirmationId: confirmedModel.id,
    writeToDisk: false,
  };
}

function findSnapshot(store: WorkspaceStore, appId: string, snapshotId?: string): DevelopmentPackageSnapshot | undefined {
  const application = store.listAssembledApplications().find((item) => item.id === appId);
  if (!application) throw new AssemblyInputError('Application not found.', 404, 'APPLICATION_NOT_FOUND');
  const selectedId = snapshotId ?? application.latestPackageSnapshotId;
  if (!selectedId) return undefined;
  const snapshot = store.getDevelopmentPackageSnapshot(selectedId);
  if (!snapshot || snapshot.appId !== appId) {
    throw new AssemblyInputError('Development package snapshot not found for this application.', 404, 'SNAPSHOT_NOT_FOUND');
  }
  return snapshot;
}

function compileAndPersistForApp(
  store: WorkspaceStore,
  appId: string,
  locale: AgentLocale,
) {
  const compiledPackage = compileDevelopmentPackage({
    ...resolveInputs(store, appId, locale),
    snapshotId: `pkg-${randomUUID()}`,
  });
  store.saveDevelopmentPackageSnapshot(compiledPackage);
  const assembledApplications = store.listAssembledApplications();
  const application = assembledApplications.find((item) => item.id === appId)!;
  return {
    application,
    compiledPackage,
    stale: false,
    assembledApplications,
    packageSnapshots: listProjectPackageSnapshots(store, compiledPackage.projectId),
    steps: deriveProjectStepsForStoreProject(store, compiledPackage.projectId),
  };
}

function respondAssemblyError(c: { json: (body: unknown, status: 404 | 409 | 422) => Response }, error: unknown) {
  const status = error instanceof AssemblyInputError ? error.status : 422;
  const code =
    (error instanceof AssemblyInputError && error.code) ||
    (status === 404 ? 'APPLICATION_NOT_FOUND' : 'INVALID_ASSEMBLY_INPUT');
  return c.json(
    {
      code,
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof DevelopmentPackageInputError ? { diagnostics: error.diagnostics } : {}),
    },
    status,
  );
}

export function registerApplicationDeliveryRoutes(app: Hono, store: WorkspaceStore): void {
  app.post('/api/projects/:projectId/compile-package', (c) => {
    const locale = resolveRequestLocale(c);
    try {
      const projectId = c.req.param('projectId');
      const project = store.getProject(projectId);
      if (!project) {
        throw new AssemblyInputError('Project not found.', 404, 'PROJECT_NOT_FOUND');
      }
      // Validate confirmed upstream steps before auto-provisioning so rejected requests leave zero side effects.
      const { confirmed } = requireConfirmedUpstreamSteps(store, project.id, locale);
      const targetApp = ensureProjectDefaultApplication(store, project, confirmed.revisionId);
      return c.json(compileAndPersistForApp(store, targetApp.id, locale));
    } catch (error) {
      return respondAssemblyError(c, error);
    }
  });

  app.post('/api/applications/:appId/compile-package', (c) => {
    const locale = resolveRequestLocale(c);
    try {
      return c.json(compileAndPersistForApp(store, c.req.param('appId'), locale));
    } catch (error) {
      return respondAssemblyError(c, error);
    }
  });

  app.get('/api/applications/:appId/package', (c) => {
    const appId = c.req.param('appId');
    const locale = resolveRequestLocale(c);
    const snapshot = findSnapshot(store, appId, c.req.query('snapshotId'));
    if (!snapshot) {
      return c.json(
        {
          code: 'PACKAGE_NOT_GENERATED',
          error: 'Generate the development package before previewing or downloading it.',
          compiledPackage: null,
          stale: false,
        },
        409,
      );
    }
    let stale = true;
    let inputIssue: string | undefined;
    try {
      stale = fingerprintDevelopmentPackageInputs(resolveInputs(store, appId, locale)) !== snapshot.inputFingerprint;
    } catch (error) {
      inputIssue = error instanceof Error ? error.message : String(error);
    }
    return c.json({
      compiledPackage: snapshot,
      stale,
      outdated: stale,
      ...(inputIssue ? { inputIssue } : {}),
      snapshots: store.listDevelopmentPackageSnapshots(appId).map((item) => ({
        snapshotId: item.snapshotId,
        compiledAt: item.compiledAt,
        inputFingerprint: item.inputFingerprint,
        basedOnBusinessModelConfirmationId: item.basedOnBusinessModelConfirmationId ?? null,
      })),
    });
  });

  app.get('/api/applications/:appId/package.zip', (c) => {
    const snapshot = findSnapshot(store, c.req.param('appId'), c.req.query('snapshotId'));
    if (!snapshot) {
      return c.json(
        { code: 'PACKAGE_NOT_GENERATED', error: 'Generate and review the development package before downloading it.' },
        409,
      );
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
