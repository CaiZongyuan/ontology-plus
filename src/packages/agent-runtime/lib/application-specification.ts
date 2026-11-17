import {
  DEFAULT_TECHNOLOGY_PROFILE_ID,
  type AgentSession,
  type AssembledApplication,
  type WorkspaceStore,
} from '../../workspace-store/index.js';

/** Resolve only an explicit application in the session's project. Never substitute another app. */
export function resolveSessionApplication(
  store: WorkspaceStore,
  session: AgentSession,
  explicitApplicationId?: unknown,
): { application: AssembledApplication; error?: never } | { application?: never; error: string } {
  const explicitId =
    typeof explicitApplicationId === 'string' ? explicitApplicationId.trim() : '';
  const applicationId = explicitId || session.targetId;
  if (!applicationId) {
    return { error: 'No target application is selected. Ask the user to select an application from this project.' };
  }
  if (explicitId && session.targetId && explicitId !== session.targetId) {
    return { error: `Application ${explicitId} differs from the session target ${session.targetId}. Select its application session first.` };
  }
  const application = store.listAssembledApplications().find((app) => app.id === applicationId);
  if (!application || application.projectId !== session.projectId) {
    return { error: `Application ${applicationId} does not belong to session project ${session.projectId}.` };
  }
  return { application };
}

/** Saved inputs are disclosed for inspection; missing bindings remain visible diagnostics. */
export function readApplicationSpecificationInputs(
  store: WorkspaceStore,
  session: AgentSession,
  explicitApplicationId?: unknown,
) {
  const resolved = resolveSessionApplication(store, session, explicitApplicationId);
  if (!resolved.application) {
    return {
      error: resolved.error,
      applications: store.listAssembledApplications()
        .filter((app) => app.projectId === session.projectId)
        .map(({ id, name }) => ({ id, name })),
    };
  }
  const app = resolved.application;
  const project = store.getProject(session.projectId);
  const requirementDocs = store.listRequirementDocs(session.projectId);
  const confirmedPrototype = store.getConfirmedPrototypeRevision(session.projectId);
  const assets = store.listFourLayerAssets();
  const diagnostics: string[] = [];
  const selectedStandards = [
    ['UI_UE', app.uiUeAssetId],
    ['TECH_FOUNDATION', app.techFoundationAssetId],
    ['TECH_ARCH', app.techArchAssetId],
  ].map(([layer, id]) => {
    const asset = assets.find((candidate) => candidate.id === id && candidate.layer === layer);
    if (!asset) diagnostics.push(`Missing or invalid ${layer} standard: ${id || '(unselected)'}.`);
    return { layer, selectedId: id, asset: asset ?? null };
  });
  const selectedTechnologyProfile = store.listTechnologyProfiles()
    .find((profile) => profile.id === (app.technologyProfileId ?? DEFAULT_TECHNOLOGY_PROFILE_ID));
  if (!selectedTechnologyProfile) diagnostics.push(`Technology Profile is missing or invalid: ${app.technologyProfileId ?? DEFAULT_TECHNOLOGY_PROFILE_ID}.`);
  if (selectedTechnologyProfile) {
    for (const { asset } of selectedStandards) {
      if (asset && !selectedTechnologyProfile.compatibleAssetIds.includes(asset.id)
        && asset.technologyProfileId !== selectedTechnologyProfile.id) {
        diagnostics.push(`Standard ${asset.id} is incompatible with Technology Profile ${selectedTechnologyProfile.id}.`);
      }
    }
  }
  const selectedPrototypeRevision = app.prototypeRevisionId
    ? store.listPrototypes(session.projectId).flatMap((prototype) => prototype.revisions)
      .find((revision) => revision.id === app.prototypeRevisionId)
    : confirmedPrototype?.revision;
  if (app.prototypeRevisionId && !selectedPrototypeRevision) diagnostics.push(`Selected prototype revision ${app.prototypeRevisionId} is missing from this project.`);
  if (selectedPrototypeRevision && selectedPrototypeRevision.id !== confirmedPrototype?.revisionId) {
    diagnostics.push(`Selected prototype revision ${selectedPrototypeRevision.id} must be confirmed and synchronised with MU before package generation.`);
  }
  if (!project) diagnostics.push(`Project ${session.projectId} is missing.`);
  if (!requirementDocs.some((document) => document.status === 'CONFIRMED' || document.status === 'PUBLISHED')) {
    diagnostics.push('A confirmed requirements document is missing.');
  }
  diagnostics.push(...(app.developmentBlockers ?? []).map((blocker) => `Unresolved development conflict: ${blocker}`));
  if (!confirmedPrototype) diagnostics.push('Confirmed prototype revision is missing.');
  if (!project?.validation.presentModels.length) diagnostics.push('Ontology Suite is missing.');
  if (project?.validation.errorCount) {
    diagnostics.push(`Ontology Suite has ${project.validation.errorCount} consistency errors.`);
  }
  return {
    application: app,
    requirementDocs,
    confirmedPrototype: confirmedPrototype ?? null,
    selectedPrototypeRevision: selectedPrototypeRevision ?? null,
    ontology: project ? { suite: project.suite, validation: project.validation } : null,
    selectedStandards,
    selectedTechnologyProfile: selectedTechnologyProfile ?? null,
    diagnostics,
  };
}
