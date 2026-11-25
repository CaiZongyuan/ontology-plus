import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validatePackageMarkdownReferences } from './markdown-references.js';
import {
  DEFAULT_TECHNOLOGY_PROFILE_ID,
  isArchitectureAssetCompatible,
  listTechnologyProfiles,
  type TechnologyProfile,
} from '../../architecture-assets/index.js';
import {
  MODEL_CODES,
  MODEL_FILE_NAMES,
  OntologySuiteSchema,
  serializeManifestJson,
  serializeSuiteToYamlFiles,
  validateOntologySuite,
  type ModelCode,
  type OntologyManifest,
} from '../../ontology-core/index.js';
import type {
  AssembledApplication,
  DevelopmentPackageFile,
  DevelopmentPackageSnapshot,
  FourLayerAsset,
  GeneratedSkill,
  ProjectDetail,
  PrototypeArtifact,
  RequirementDoc,
} from '../../workspace-store/index.js';

export type CompiledPackageFile = DevelopmentPackageFile;
export type CompiledDevelopmentPackage = DevelopmentPackageSnapshot;

export interface DevelopmentPackagePrototypeRevision {
  id: string;
  prototypeId: string;
  revisionNumber: number;
  confirmedAt?: string;
  createdAt?: string;
}

export interface CompileDevelopmentPackageInput {
  app: AssembledApplication;
  project: ProjectDetail;
  uiUeAsset: FourLayerAsset;
  techFoundationAsset: FourLayerAsset;
  techArchAsset: FourLayerAsset;
  requirementDoc?: RequirementDoc;
  prototype?: PrototypeArtifact;
  prototypeRevision?: DevelopmentPackagePrototypeRevision;
  technologyProfile?: TechnologyProfile;
  applicationInstructions?: string;
  basedOnBusinessModelConfirmationId?: string | null;
  snapshotId?: string;
  inputFingerprint?: string;
  compiledAt?: string;
  /** @deprecated Development Packages contain implementation specifications. */
  extraSourceFiles?: { relativePath: string; content: string }[];
  workspaceRoot?: string;
  writeToDisk?: boolean;
}

export interface DevelopmentPackageInputDiagnostic {
  code: string;
  path: string;
  target?: string;
  message: string;
}

export class DevelopmentPackageInputError extends Error {
  constructor(public readonly diagnostics: DevelopmentPackageInputDiagnostic[]) {
    super(`Cannot compile Development Package:\n${diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join('\n')}`);
    this.name = 'DevelopmentPackageInputError';
  }
}

function selectedTechnologyProfile(input: CompileDevelopmentPackageInput): TechnologyProfile {
  const appProfileId = 'technologyProfileId' in input.app && typeof input.app.technologyProfileId === 'string'
    ? input.app.technologyProfileId : undefined;
  const profile = input.technologyProfile ?? listTechnologyProfiles().find((entry) => entry.id === (appProfileId ?? DEFAULT_TECHNOLOGY_PROFILE_ID));
  if (!profile) throw new Error(`Cannot compile Development Package: select an available Technology Profile (${appProfileId ?? DEFAULT_TECHNOLOGY_PROFILE_ID}).`);
  return profile;
}

function inspectDevelopmentPackageInputs(input: CompileDevelopmentPackageInput) {
  const diagnostics: DevelopmentPackageInputDiagnostic[] = [];
  const add = (code: string, path: string, message: string) => diagnostics.push({ code, path, message });
  for (const blocker of input.app.developmentBlockers ?? []) {
    add('UNRESOLVED_DEVELOPMENT_CONFLICT', 'app.developmentBlockers', blocker);
  }
  if (input.app.projectId !== input.project.id) add('PROJECT_MISMATCH', 'app.projectId', 'Select the Ontology Project owned by this application.');
  for (const [field, value] of [['app.id', input.app.id], ['snapshotId', input.snapshotId]] as const) {
    if (value !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) {
      add('INVALID_ID', field, 'Use an ID containing English letters, digits, periods, underscores, or hyphens.');
    }
  }
  if (input.compiledAt !== undefined && !Number.isFinite(Date.parse(input.compiledAt))) {
    add('INVALID_TIMESTAMP', 'compiledAt', 'Provide a valid generation timestamp.');
  }
  const requirement = input.requirementDoc;
  if (!requirement) add('REQUIREMENTS_REQUIRED', 'requirementDoc', 'Select the confirmed requirements document.');
  else {
    if (requirement.projectId !== input.project.id) add('REQUIREMENTS_PROJECT_MISMATCH', 'requirementDoc.projectId', 'Select requirements belonging to the application\'s Ontology Project.');
    if (!['CONFIRMED', 'PUBLISHED'].includes(requirement.status)) add('REQUIREMENTS_UNCONFIRMED', 'requirementDoc.status', 'Confirm the requirements document before generating a package.');
    if (!requirement.content.trim()) add('REQUIREMENTS_EMPTY', 'requirementDoc.content', 'Requirements content must be nonempty.');
  }
  const prototype = input.prototype;
  if (!prototype || !prototype.isConfirmed || !prototype.confirmedRevisionId) {
    add('CONFIRMED_PROTOTYPE_REQUIRED', 'prototype', 'Select a confirmed prototype revision and synchronize its UI Model before generating a package.');
  } else {
    if (prototype.projectId !== input.project.id) add('PROTOTYPE_PROJECT_MISMATCH', 'prototype.projectId', 'Select a confirmed prototype belonging to the application\'s Ontology Project.');
    const revision = prototype.revisions.find((entry) => entry.id === prototype.confirmedRevisionId);
    if (!revision || revision.prototypeId !== prototype.id || revision.projectId !== input.project.id) {
      add('PROTOTYPE_REVISION_MISSING', 'prototype.confirmedRevisionId', 'The saved confirmed revision must exist and belong to this prototype and project.');
    } else if (!prototype.htmlContent.trim() || prototype.htmlContent !== revision.htmlContent) {
      add('PROTOTYPE_CONTENT_MISMATCH', 'prototype.htmlContent', 'Use the confirmed revision\'s exact HTML content; confirm a changed revision before generating a package.');
    }
    if (input.prototypeRevision && (input.prototypeRevision.id !== prototype.confirmedRevisionId ||
        input.prototypeRevision.prototypeId !== prototype.id ||
        input.prototypeRevision.revisionNumber !== revision?.revisionNumber)) {
      add('PROTOTYPE_REVISION_MISMATCH', 'prototypeRevision', 'Prototype revision metadata must match the saved confirmed revision.');
    }
  }
  let profile: TechnologyProfile | undefined;
  try { profile = selectedTechnologyProfile(input); }
  catch (error) { add('PROFILE_REQUIRED', 'technologyProfile', error instanceof Error ? error.message : 'Select an available Technology Profile.'); }
  if (profile) {
    if (!profile.id?.trim() || !profile.version?.trim() ||
        ![profile.frontend, profile.backend, profile.persistence, profile.deployment, profile.compatibleAssetIds]
          .every((items) => Array.isArray(items) && items.length > 0 && items.every((item) => typeof item === 'string' && item.trim()))) {
      add('PROFILE_INVALID', 'technologyProfile', 'Select a complete Technology Profile covering frontend, backend, persistence, deployment, and compatible standards.');
    }
    if ('technologyProfileId' in input.app && input.app.technologyProfileId && input.app.technologyProfileId !== profile.id) {
      add('PROFILE_MISMATCH', 'technologyProfile.id', 'The Technology Profile must match the application\'s selection.');
    }
  }
  const selections = [
    { field: 'uiUeAsset', asset: input.uiUeAsset, id: input.app.uiUeAssetId, layer: 'UI_UE' },
    { field: 'techFoundationAsset', asset: input.techFoundationAsset, id: input.app.techFoundationAssetId, layer: 'TECH_FOUNDATION' },
    { field: 'techArchAsset', asset: input.techArchAsset, id: input.app.techArchAssetId, layer: 'TECH_ARCH' },
  ];
  for (const { field, asset, id, layer } of selections) {
    if (!asset || asset.id !== id || asset.layer !== layer) {
      add('ASSET_SELECTION_MISMATCH', field, 'Provide the explicitly selected asset for this application layer.');
      continue;
    }
    if (!asset.specMarkdown.trim()) add('STANDARD_EMPTY', `${field}.specMarkdown`, 'Selected standard content must be nonempty.');
    if (!asset.sourcePath?.trim() || !asset.sourceRevision?.trim()) add('STANDARD_SOURCE_REQUIRED', field, 'Select a repository-owned standard with its source path and revision.');
    if (profile && !isArchitectureAssetCompatible(profile, asset)) {
      add('STANDARD_PROFILE_CONFLICT', field, 'Select a standard compatible with the selected Technology Profile, or explicitly associate the repository standard with that profile.');
    }
  }
  if (input.extraSourceFiles?.length) add('SOURCE_FILES_UNSUPPORTED', 'extraSourceFiles', 'Provide application-specific implementation instructions through applicationInstructions; this package exports an implementation specification.');
  const parsedSuite = OntologySuiteSchema.safeParse(input.project.suite);
  if (!parsedSuite.success) {
    for (const issue of parsedSuite.error.issues) add('ONTOLOGY_SCHEMA_ERROR', `project.suite.${issue.path.join('.')}`, issue.message);
  }
  const validation = parsedSuite.success ? validateOntologySuite(parsedSuite.data) : undefined;
  for (const diagnostic of validation?.diagnostics ?? []) {
    if (diagnostic.tier === 'ERROR') add(diagnostic.code, diagnostic.path ?? `project.suite.${diagnostic.model}`, `Consistency Error: ${diagnostic.messageEn}`);
  }
  return { diagnostics, validation, suite: parsedSuite.success ? parsedSuite.data : input.project.suite, profile };
}

/** Blocking diagnostics only; nonblocking Stage Warnings remain in the compiled manifest. */
export function validateDevelopmentPackageInputs(input: CompileDevelopmentPackageInput): DevelopmentPackageInputDiagnostic[] {
  return inspectDevelopmentPackageInputs(input).diagnostics;
}

function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      return Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
    }
    return entry;
  });
}

/** Hash only content and source identities that can change the implementation handoff. */
export function fingerprintDevelopmentPackageInputs(input: CompileDevelopmentPackageInput): string {
  return contentHash(canonicalJson({
    compilerFormat: 'development-specification-v1',
    app: {
      id: input.app.id, name: input.app.name, projectId: input.app.projectId,
      uiUeAssetId: input.app.uiUeAssetId, techFoundationAssetId: input.app.techFoundationAssetId,
      techArchAssetId: input.app.techArchAssetId,
    },
    project: {
      id: input.project.id, name: input.project.name, code: input.project.code,
      domain: input.project.domain, updatedAt: input.project.updatedAt, suite: input.project.suite,
    },
    requirementDoc: input.requirementDoc,
    prototype: input.prototype && {
      id: input.prototype.id, projectId: input.prototype.projectId,
      htmlContent: input.prototype.htmlContent,
      confirmedRevisionId: input.prototype.confirmedRevisionId,
    },
    prototypeRevision: input.prototypeRevision,
    technologyProfile: selectedTechnologyProfile(input),
    standards: [input.uiUeAsset, input.techFoundationAsset, input.techArchAsset],
    applicationInstructions: input.applicationInstructions?.trim() ? input.applicationInstructions : undefined,
    ...(input.basedOnBusinessModelConfirmationId !== undefined
      ? { basedOnBusinessModelConfirmationId: input.basedOnBusinessModelConfirmationId }
      : {}),
  }));
}

function getPresentModelCodes(project: ProjectDetail): ModelCode[] {
  return MODEL_CODES.filter((code) => Boolean(project.suite[code]));
}

/** The existing Skill and MCP manifest keeps ontology-core's canonical filenames. */
export function buildOntologySuiteManifest(project: ProjectDetail): OntologyManifest {
  const models: Record<string, string> = {};
  for (const code of getPresentModelCodes(project)) models[code] = MODEL_FILE_NAMES[code];
  return { version: '1.0', projectId: project.id, domain: project.domain || project.name, models };
}

function modelLink(project: ProjectDetail, code: ModelCode): string {
  return project.suite[code]
    ? `[${code}](../references/ontology/${code}.yaml)`
    : `${code} (not authored; see the Stage Warnings in the package manifest)`;
}

function buildAgentInstructions(): string {
  return `# Coding agent instructions

Read [README](README.md) and [the snapshot manifest](manifest.json) to identify the fixed inputs and selected standards.

1. Read [Architecture](docs/architecture.md) before choosing module boundaries or dependencies. Completion: each selected standard and its authority are accounted for.
2. Follow [Implementation sequence](docs/implementation.md) in order. Open only the ontology files and references named by the current step. Completion: record evidence for that step before starting its dependent work.
3. Use [Acceptance criteria](docs/acceptance.md) to verify delivery. Completion: each applicable criterion has a test, command result, or reviewed UI evidence tied to its ontology IDs.
4. Implement [Connect to Ontology Plus](docs/connect.md) so the finished application can be connected without further work. Completion: the Connection Manifest validates and every listed read answers for each acting identity.

Business semantics come from the disclosed Ontology Suite; UI intent comes from the confirmed prototype. Keep original business labels and messages. Resolve a conflict in the selected inputs explicitly before implementation. Record missing late-stage models as Stage Warnings and seek the specific missing decision before implementing that area.
`;
}

function buildArchitectureGuide(input: CompileDevelopmentPackageInput): string {
  const { app, project } = input;
  const profile = selectedTechnologyProfile(input);
  return `# Architecture

Application: ${app.name} (\`${app.id}\`). Ontology Project: ${project.name} (\`${project.id}\`).

## Authority and selected standards

- Formal business semantics: [Ontology manifest](../references/ontology/manifest.json). Keep its identifiers, invariants, behavior contracts, and authorization bindings.
- UI layout, interaction, and original copy: [Confirmed prototype](../references/prototype/index.html), traced through ${modelLink(project, 'MU')}.
- Business scope and rationale: [Original requirements](../references/requirements.md).
- UI engineering conventions: [Selected UI standard](../standards/ui.md).
- Tooling, local development, and deployment: [Selected technical foundation](../standards/foundation.md).
- Module boundaries and dependencies: [Selected technical architecture](../standards/architecture.md).

Preserve the confirmed prototype's visual intent when applying generic component conventions. Resolve an explicit conflict by adjusting the selected inputs and generating a new snapshot.

## Selected Technology Profile

[${profile.name}](../standards/technology-profile.json), version \`${profile.version}\`.

| Concern | Selection |
| --- | --- |
| Frontend | ${profile.frontend.join(' + ')} |
| Backend | ${profile.backend.join(' + ')} |
| Persistence | ${profile.persistence.join(' + ')} |
| Deployment | ${profile.deployment.join(' + ')} |

## Implementation boundaries

Keep UI components and navigation separate from application use cases. Application use cases coordinate domain behavior, permissions, transactions, events, and persistence ports. Domain rules stay independent of HTTP handlers and UI components. Persistence adapters implement the declared object/table mapping; interface adapters implement the declared inbound and outbound contracts.

Implement a vertical business path through the UI, behavior, rules, and persistence before extending the remaining paths. Use ontology IDs to connect the implementation and its verification to the authoritative models. Consult [Implementation sequence](implementation.md) for dependencies and [Acceptance criteria](acceptance.md) for evidence.
`;
}

function buildImplementationGuide(input: CompileDevelopmentPackageInput): string {
  const { project } = input;
  const links = (...codes: ModelCode[]) => codes.map((code) => modelLink(project, code)).join(', ');
  const ids = (items: { id: string }[] | undefined) => items?.map((item) => `\`${item.id}\``).join(', ') || 'No elements declared in this snapshot.';
  return `# Implementation sequence

Implement the target application from this fixed specification. Keep a delivery record mapping completed work to [Acceptance criteria](acceptance.md). Source business text retains its original language.${input.applicationInstructions?.trim() ? '\n\nRead [Application-specific instructions](../references/application-instructions.md) before planning the work.' : ''}

## 1. Confirm scope and bootstrap the selected foundation

Read [Requirements](../references/requirements.md), [Architecture](architecture.md), and [Technical foundation](../standards/foundation.md). Inspect [Ontology manifest](../references/ontology/manifest.json) before opening individual models. Establish local development, build, test, and Node.js deployment commands using the selected Technology Profile.

Completion: the application starts locally, builds, runs its verification commands, and exposes a documented production startup path. Resolve required decisions missing from the inputs before implementing affected features.

## 2. Implement domain objects and persistence

Read ${links('M1', 'MM')}. Implement declared attributes, types, dictionaries, associations, value objects, lifecycle transitions, attribute rules, and aggregate invariants. Implement the declared table/column mapping with migrations and transaction boundaries. Keep repository operations behind application-facing ports.

Aggregate scope: ${ids(project.suite.M1?.aggregates)}. Mapping scope: ${ids(project.suite.MM?.mappings)}.

Completion: each mapped object round-trips through SQLite; invalid attributes, associations, invariants, and lifecycle transitions are rejected before committing changes. Track any absent mapping as a Stage Warning requiring a persistence decision.

## 3. Implement behavior, rules, and read queries

Read ${links('M2', 'M3', 'M7')}. Implement each behavior's input/output contract, preconditions, state changes, invoked rules, permissions, and emitted events. Evaluate side-effect-free rules before writes and preserve declared violation messages. Bind every QUERY behavior one-to-one with its query/report and execute its reference SQL with bound parameters.

Behavior scope: ${ids(project.suite.M2?.behaviors)}. Rule scope: ${ids(project.suite.M3?.rules)}. Query/report scope: ${ids(project.suite.M7?.query_reports)}.

Completion: each declared behavior has success and relevant rejection evidence; rejected commands roll back; each query returns the declared fields and preserves the M2/M7 binding.

## 4. Implement authorization and business collaboration

Read ${links('M5', 'ME', 'M4', 'M6')}. Enforce role and permission bindings at the application boundary. Implement event producers, payloads, ordering, subscribers, reactive scenarios, and role-bound collaboration/approval tasks from their contracts. Keep scenario reactions distinct from human workflow tasks.

Event scope: ${ids(project.suite.ME?.events)}. Scenario scope: ${ids(project.suite.M4?.event_scenarios)}. Flow scope: ${ids(project.suite.M6?.flows)}.

Completion: unauthorized calls fail, emitted facts have the declared producer and payload, subscribers execute correctly, and each declared flow reaches its valid end states through permitted routes.

## 5. Connect UI interactions and system boundaries

Read ${links('MU', 'MI')}, the [Confirmed prototype](../references/prototype/index.html), and [UI standard](../standards/ui.md). Implement each screen and its ordered UI event call chains. Retain semantic anchors (\`data-screen-id\`, \`data-element-id\`, \`data-binding\`, \`data-event-id\`) for traceability. Implement interface fields, direction, authentication, errors, and return rules as declared.

Screen scope: ${project.suite.MU?.screens.map((screen) => `\`${screen.screenId}\``).join(', ') || 'No screens declared in this snapshot.'}. Interface scope: ${project.suite.MI?.interfaces.map((contract) => `\`${contract.interfaceId}\``).join(', ') || 'No interfaces declared in this snapshot.'}.

Completion: every declared screen event reaches its modeled behavior/query/navigation target, the UI matches the confirmed design, and each declared inbound/outbound interface has contract evidence.

## 6. Verify and hand over

Run [Acceptance criteria](acceptance.md). Exercise representative UI-to-persistence paths plus rejection and authorization cases. Document configuration, local setup, migrations, production startup, and the exact commands used to verify delivery.

Completion: every applicable criterion has evidence; unresolved Stage Warnings and required decisions are explicit in the delivery record.
`;
}

/**
 * Connection contract v1 (TeaCo spec v0.3.1 §11.3): the Development Package states how the finished
 * application is connected to Ontology Plus, with a starting point derived from the Ontology Suite.
 */
function buildConnectionGuide(project: ProjectDetail): string {
  const { suite } = project;
  const objects = suite.M1?.aggregates ?? [];
  const queries = suite.M7?.query_reports ?? [];
  const roles = suite.M5?.roles ?? [];
  const commands = (suite.M2?.behaviors ?? []).filter((behavior) => behavior.behaviorType === 'COMMAND');
  const list = (items: string[], empty: string) => (items.length ? items.map((item) => `- ${item}`).join('\n') : `- ${empty}`);
  return `# Connect to Ontology Plus

The finished application is connected to Ontology Plus by its address. Ontology Plus then opens an Operations Console for this project, driven entirely by what the application declares below. There is no login, token, or credential between the two: the application serves these routes on loopback, and the user chooses the acting identity in the console.

## Routes (protocol \`ontology-plus-connect/1\`)

All responses are JSON in UTF-8. Money is integer cents. Every display name is bilingual: \`{ "zh": "…", "en": "…" }\`. Every \`/runtime/*\` request carries the header \`X-Ontology-Plus-Actor\` with one declared actor id; answer only what that identity may see, reject an unknown id with 400, and use the first actor when the header is absent.

| Route | Answer |
| --- | --- |
| \`GET /.well-known/ontology-plus.json\` | The Connection Manifest: \`protocol\`, \`application\` (\`name\`, \`version\`, optional \`description\`, ISO 4217 \`currency\` defaulting to USD), optional \`model\` (\`fingerprint\`, \`revision\`), \`actors\` (\`id\`, \`name\`, \`role\`, \`scope\`; at least one), \`metrics\` (\`id\`, \`name\`, \`unit\`: count, money or number, optional \`hint\` and \`headline\` containing \`{value}\`), \`objects\` (\`id\`, \`name\`, \`modelObject\`, \`titleField\`, optional \`statusField\`, \`fields\` with \`key\`, \`label\`, \`type\`: text, number, money, date, status or tag; optional \`filters\`), \`reports\` (\`id\`, \`name\`, optional \`description\`), \`actions\` (\`id\`, \`name\`, optional \`objectId\` and \`description\`, \`target\`: record or none, \`params\` with \`key\`, \`label\`, \`type\`: number, text, object-ref or lines, \`required\`), \`dataIssues\` and \`activity\` (booleans). |
| \`GET /runtime/metrics\` | \`{ asOf, values: [{ id, value, hint? }] }\` for the declared metrics; \`value\` is null when it cannot be computed. |
| \`GET /runtime/objects/:objectId?filter=&limit=&offset=\` | \`{ asOf, total, counts: [{ filter, count }], rows: [{ key, values, flags: [{ tone, label }] }] }\`. |
| \`GET /runtime/objects/:objectId/:key\` | \`{ asOf, key, values, flags, sections: [{ title, columns, rows }], notes, actions }\`, where \`actions\` lists the action ids this identity may start on this record now; 404 when the identity may not see it. |
| \`GET /runtime/reports/:reportId\` | \`{ asOf, title, columns, rows, basis }\`, where \`basis\` states the counting rule in one sentence. |
| \`GET /runtime/data-issues\` | \`{ asOf, issues: [{ id, title, detail, status, needsDecision, action? }] }\` with status OPEN, INVESTIGATING, PROPOSED, APPROVED, APPLIED, VERIFIED or DISMISSED; \`action: { actionId, target }\` names the action that resolves it, for the identity allowed to decide. |
| \`POST /runtime/actions/:actionId/prepare\` | Body \`{ target?, params }\`. Changes nothing; answers \`{ asOf, preview: { summary, effects, target: { key, version } } }\` in business words, or a refusal. |
| \`POST /runtime/actions/:actionId/invoke\` | Body \`{ target?, params, idempotencyKey, expectedVersion }\`. Re-checks every rule, refuses with 409 \`VERSION_CONFLICT\` when the record is no longer at \`expectedVersion\`, then commits the change, its audit record and its outbox event in one transaction and answers \`{ receipt, replayed }\`. The same identity and key with the same request replays the receipt; with a different request it is 409 \`IDEMPOTENCY_KEY_REUSED\`. |
| \`POST /runtime/releases/:version/activate\` | Optional, with \`releases\` in the manifest (\`current\`, \`previous\`, \`available\`: \`version\`, \`name\`, \`notes\`). Puts a version in use for an identity allowed to; refuses with 409 when data exists that the version cannot represent. Every read and \`prepare\` sent with the header \`X-Ontology-Plus-Release: <version>\` answers as that version without putting it in use (a preview), and \`invoke\` under that header is refused with 409 \`PREVIEW_READ_ONLY\`. |
| \`GET /runtime/invocations/:idempotencyKey\` | \`{ receipt }\` when that identity committed that key, otherwise 404. Ontology Plus reads every result back here and reconciles unanswered requests with it. |
| \`GET /runtime/activity\` | \`{ asOf, events: [{ at, text, kind }] }\`, newest first. |

Field values are strings, numbers, or bilingual objects. Use business names that people recognise; keep codes and identifiers out of labels.

A receipt is \`{ commandId, action, actor, idempotencyKey, target, status: "COMMITTED", summary, effects, after: { key, version, state }, committedAt }\`. A refusal is \`{ error: { code, message } }\` with a bilingual \`message\` a business user can act on: 403 for an identity that may not do it, 404 for a record it may not see or an action not offered, 409 for a conflict, 422 for a broken business rule.

## Starting point from the Ontology Suite

Business objects (\`objects\`, set \`modelObject\` to the aggregate name so Ontology Plus can check it against the confirmed Business Model):
${list(objects.map((aggregate) => `\`${aggregate.name}\` (${aggregate.alias})`), 'No aggregates are declared yet; declare the objects people manage.')}

Metrics and reports (\`metrics\` for single figures, \`reports\` for tables):
${list(queries.map((query) => `\`${query.id}\` ${query.alias} (${query.queryType})`), 'No queries are declared yet.')}

Acting identities (\`actors\`, one per role or per person whose scope differs):
${list(roles.map((role) => `\`${role.code}\` ${role.name}`), 'No roles are declared yet; declare at least one actor.')}

Actions for approved runtime changes (\`actions\`; every change runs only after a person approves its preview in Ontology Plus, and the business rules stay in the application):
${list(commands.map((behavior) => `\`${behavior.id}\` ${behavior.alias}`), 'No commands are declared yet.')}

## Completion

- [ ] \`GET /.well-known/ontology-plus.json\` returns a manifest that follows this guide, with every \`titleField\` and \`statusField\` listed in its object's \`fields\`.
- [ ] Each declared metric, object list, object detail, report, data issue list, and activity list answers for every declared actor, and an identity never sees records outside its scope.
- [ ] Each declared action prepares without changing anything, commits atomically once invoked, replays a repeated key, refuses a stale \`expectedVersion\`, and is found again by \`/runtime/invocations/:idempotencyKey\`.
- [ ] The runtime routes listen on loopback by default.
`;
}

function buildAcceptanceGuide(project: ProjectDetail): string {
  const { suite } = project;
  const lines = [
    '# Acceptance criteria',
    '',
    'Record a test, command result, or reviewed UI evidence for each applicable item. Ontology identifiers below refer to the linked model files; original business labels and messages remain authoritative.',
    '',
    '- [ ] Local startup, build, verification, migration, and production startup commands succeed using the selected Technology Profile in [Architecture](architecture.md).',
    '- [ ] Delivered scope matches [Requirements](../references/requirements.md), and every declared contract below is accounted for in the delivery record.',
    '- [ ] The application can be connected to Ontology Plus as described in [Connect to Ontology Plus](connect.md).',
  ];
  const group = (code: ModelCode, criteria: string[]) => {
    if (!suite[code]) return;
    lines.push('', `## ${code}`, '', `Source: ${modelLink(project, code)}.`, '', ...criteria.map((criterion) => `- [ ] ${criterion}`));
  };
  group('M1', (suite.M1?.aggregates ?? []).map((aggregate) => `\`${aggregate.id}\` (\`${aggregate.name}\`): verify declared attribute types/required fields, dictionaries, associations, lifecycle transitions, attribute rules, and aggregate invariants; invalid writes leave persisted state unchanged.`));
  group('MM', (suite.MM?.mappings ?? []).map((mapping) => `\`${mapping.id}\` (\`${mapping.objectRef}\`): verify every declared table/column mapping with migration and round-trip evidence, including nullability, keys, and declared audit fields.`));
  group('M2', (suite.M2?.behaviors ?? []).map((behavior) => `\`${behavior.id}\` (\`${behavior.name}\`, ${behavior.behaviorType}): verify input/output fields, preconditions, state changes, permissions, rules ${behavior.invokedRules.map((id) => `\`${id}\``).join(', ') || '(none declared)'}, and emitted facts. Include success and applicable rejection cases; rejected writes roll back.`));
  group('M3', (suite.M3?.rules ?? []).map((rule) => `\`${rule.id}\` (\`${rule.name}\`): verify the declared expression or decision table with accepted/rejected and boundary inputs; keep evaluation side-effect-free and preserve the declared result and violation message.`));
  group('M7', (suite.M7?.query_reports ?? []).map((query) => `\`${query.id}\` / behavior \`${query.behaviorRef}\`: verify the one-to-one QUERY binding, bound reference SQL parameters, result fields, filtering, and declared aggregation/report behavior.`));
  group('M5', [
    ...(suite.M5?.roles ?? []).map((role) => `\`${role.id}\`: verify declared role and permission bindings with permitted and denied calls.`),
    ...(suite.M5?.permissions ?? []).map((permission) => `\`${permission.id}\`: verify its declared behavior/UI targets and access constraints.`),
  ]);
  group('ME', (suite.ME?.events ?? []).map((event) => `\`${event.id}\`: verify its producer \`${event.producerBehaviorRef}\`, payload fields, delivery/ordering semantics, and declared subscribers.`));
  group('M4', (suite.M4?.event_scenarios ?? []).map((scenario) => `\`${scenario.id}\`: exercise its declared behavior/event/rule chain and verify downstream aggregate effects.`));
  group('M6', (suite.M6?.flows ?? []).map((flow) => `\`${flow.id}\` (${flow.flowType}): exercise valid start-to-end routes, role-bound tasks, rejection paths, gateway defaults, and declared sub-flow calls.`));
  group('MU', (suite.MU?.screens ?? []).flatMap((screen) => [
    `\`${screen.screenId}\`: compare layout, copy, states, permissions, and navigation with the [Confirmed prototype](../references/prototype/index.html); retain declared screen/element/binding/event anchors.`,
    ...screen.events.map((event) => `\`${screen.screenId}\` / \`${event.eventId}\` / trigger \`${event.triggerElementId}\`: verify each declared call-chain step in order, including validation failures and target behavior/query/navigation effects.`),
  ]));
  group('MI', (suite.MI?.interfaces ?? []).map((contract) => `\`${contract.interfaceId}\`: verify declared direction, input/output fields, authentication, return rules, and applicable error/timeout behavior at the system boundary.`));
  lines.push('', '## Package and modeling evidence', '',
    '- [ ] Every package-local link and model manifest entry resolves to a delivered file.',
    '- [ ] The implementation uses this snapshot\'s fixed inputs; its source identities and revisions are recorded in [Package manifest](../manifest.json).',
    '- [ ] All Consistency Errors are resolved. Each Stage Warning in the manifest has an explicit decision or documented limit before implementing the affected area.', '');
  return lines.join('\n');
}

export function compileDevelopmentPackage(input: CompileDevelopmentPackageInput): CompiledDevelopmentPackage {
  const inspected = inspectDevelopmentPackageInputs(input);
  if (inspected.diagnostics.length || !inspected.validation || !inspected.profile) throw new DevelopmentPackageInputError(inspected.diagnostics);
  const { app, uiUeAsset, techFoundationAsset, techArchAsset } = input;
  const project = { ...input.project, suite: inspected.suite, validation: inspected.validation };
  const resolvedInput = { ...input, project, technologyProfile: inspected.profile };
  const compiledAt = input.compiledAt ?? new Date().toISOString();
  const currentFingerprint = fingerprintDevelopmentPackageInputs(input);
  if (input.inputFingerprint !== undefined && input.inputFingerprint !== currentFingerprint) {
    throw new DevelopmentPackageInputError([{ code: 'INPUT_FINGERPRINT_MISMATCH', path: 'inputFingerprint', message: 'Recompute the input fingerprint from the exact inputs selected for this snapshot.' }]);
  }
  const inputFingerprint = currentFingerprint;
  const snapshotId = input.snapshotId ?? `snapshot-${contentHash(`${inputFingerprint}:${compiledAt}`).slice(0, 24)}`;
  const outputDir = path.join(input.workspaceRoot ?? path.resolve(process.cwd(), '.onto-cs'), 'packages', app.id, snapshotId);
  const files: CompiledPackageFile[] = [];
  const addFile = (relativePath: string, category: CompiledPackageFile['category'], content: string) => {
    files.push({ relativePath, category, content, sizeBytes: Buffer.byteLength(content, 'utf-8') });
  };

  addFile('README.md', 'GUIDE', `# Development Package ? ${app.name}

This package is an implementation specification for the target application. Start with [Coding agent instructions](AGENTS.md), then follow [Implementation sequence](docs/implementation.md) and record [Acceptance evidence](docs/acceptance.md).

- [Architecture and selected standards](docs/architecture.md)
- [Connect to Ontology Plus](docs/connect.md)
- [Fixed input manifest](manifest.json)
- [Original requirements](references/requirements.md)
- [Confirmed prototype](references/prototype/index.html)
- [Ontology model index](references/ontology/manifest.json)

Snapshot \`${snapshotId}\`, generated at \`${compiledAt}\`. Package readiness describes the completeness of this handoff. The target application is implemented and verified using the linked contracts and criteria.
`);
  addFile('AGENTS.md', 'GUIDE', buildAgentInstructions());
  addFile('docs/architecture.md', 'GUIDE', buildArchitectureGuide(resolvedInput));
  addFile('docs/implementation.md', 'GUIDE', buildImplementationGuide(resolvedInput));
  addFile('docs/acceptance.md', 'GUIDE', buildAcceptanceGuide(project));
  addFile('docs/connect.md', 'GUIDE', buildConnectionGuide(project));
  addFile('standards/ui.md', 'REFERENCE', uiUeAsset.specMarkdown);
  addFile('standards/foundation.md', 'FOUNDATION', techFoundationAsset.specMarkdown);
  addFile('standards/architecture.md', 'REFERENCE', techArchAsset.specMarkdown);
  const technologyProfile = structuredClone(selectedTechnologyProfile(input));
  addFile('standards/technology-profile.json', 'MANIFEST', JSON.stringify(technologyProfile, null, 2));
  addFile('references/requirements.md', 'REFERENCE', input.requirementDoc?.content ?? '');
  addFile('references/prototype/index.html', 'REFERENCE', input.prototype?.htmlContent ?? '');
  if (input.applicationInstructions?.trim()) {
    addFile('references/application-instructions.md', 'REFERENCE', input.applicationInstructions);
  }
  const suiteManifest = buildOntologySuiteManifest(project);
  suiteManifest.models = Object.fromEntries(getPresentModelCodes(project).map((code) => [code, `${code}.yaml`]));
  addFile('references/ontology/manifest.json', 'MANIFEST', serializeManifestJson(suiteManifest));
  const yamlFiles = serializeSuiteToYamlFiles(project.suite);
  for (const code of getPresentModelCodes(project)) {
    addFile(`references/ontology/${code}.yaml`, 'ONTOLOGY_YAML', yamlFiles[code]!.content);
  }
  const basedOnBusinessModelConfirmationId =
    input.basedOnBusinessModelConfirmationId ?? null;
  const manifestJson = {
    packageVersion: '1.0.0', artifactType: 'DEVELOPMENT_SPECIFICATION',
    snapshotId, inputFingerprint,
    basedOnBusinessModelConfirmationId,
    appId: app.id, appName: app.name, projectId: project.id, domain: project.domain, compiledAt,
    technologyProfile,
    sources: {
      technologyProfile: {
        id: technologyProfile.id, version: technologyProfile.version,
        sourcePath: technologyProfile.sourcePath, sourceRevision: technologyProfile.sourceRevision,
        path: 'standards/technology-profile.json',
      },
      requirements: input.requirementDoc && {
        id: input.requirementDoc.id, projectId: input.requirementDoc.projectId,
        version: input.requirementDoc.version, updatedAt: input.requirementDoc.updatedAt,
        contentHash: contentHash(input.requirementDoc.content), path: 'references/requirements.md',
      },
      prototype: input.prototype && {
        id: input.prototype.id, revisionId: input.prototypeRevision?.id ?? input.prototype.confirmedRevisionId,
        revisionNumber: input.prototypeRevision?.revisionNumber,
        confirmedAt: input.prototypeRevision?.confirmedAt, createdAt: input.prototypeRevision?.createdAt,
        contentHash: contentHash(input.prototype.htmlContent), path: 'references/prototype/index.html',
      },
      ontology: {
        projectId: project.id,
        confirmationId: basedOnBusinessModelConfirmationId,
        revision: project.updatedAt,
        contentHash: contentHash(canonicalJson(project.suite)),
        path: 'references/ontology/manifest.json', models: getPresentModelCodes(project),
      },
      standards: [
        { asset: uiUeAsset, path: 'standards/ui.md' },
        { asset: techFoundationAsset, path: 'standards/foundation.md' },
        { asset: techArchAsset, path: 'standards/architecture.md' },
      ].map(({ asset, path: filePath }) => ({
        id: asset.id, version: asset.version, updatedAt: asset.updatedAt,
        sourcePath: asset.sourcePath, sourceRevision: asset.sourceRevision,
        contentHash: contentHash(asset.specMarkdown), path: filePath,
      })),
      applicationInstructions: input.applicationInstructions?.trim() ? {
        contentHash: contentHash(input.applicationInstructions), path: 'references/application-instructions.md',
      } : undefined,
      applicationInstructionsText: input.applicationInstructions?.trim() ?? '',
    },
    layers: {
      ontology: { projectId: project.id, presentModels: getPresentModelCodes(project) },
      uiUe: { id: uiUeAsset.id, name: uiUeAsset.name, version: uiUeAsset.version },
      techFoundation: { id: techFoundationAsset.id, name: techFoundationAsset.name, version: techFoundationAsset.version },
      techArch: { id: techArchAsset.id, name: techArchAsset.name, version: techArchAsset.version },
    },
    validation: structuredClone(project.validation),
    files: [...files.map((file) => ({ path: file.relativePath, category: file.category, sizeBytes: file.sizeBytes, contentHash: contentHash(file.content) })), { path: 'manifest.json', category: 'MANIFEST' }],
  };
  addFile('manifest.json', 'MANIFEST', JSON.stringify(manifestJson, null, 2));
  const referenceDiagnostics = validatePackageMarkdownReferences(files);
  if (referenceDiagnostics.length) throw new DevelopmentPackageInputError(referenceDiagnostics);
  if (input.writeToDisk !== false) {
    for (const file of files) {
      const fullPath = path.join(outputDir, file.relativePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, file.content, 'utf-8');
    }
  }
  return {
    snapshotId,
    inputFingerprint,
    appId: app.id,
    appName: app.name,
    projectId: project.id,
    outputDir,
    compiledAt,
    ...(input.basedOnBusinessModelConfirmationId !== undefined
      ? { basedOnBusinessModelConfirmationId }
      : {}),
    files,
    manifestJson,
  };
}

export function compileOntologySkill(project: ProjectDetail): GeneratedSkill {
  const slug = `${project.code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-ontology-skill`;
  const presentCodes = getPresentModelCodes(project);

  const aggList = (project.suite.M1?.aggregates ?? [])
    .map(
      (a) =>
        `- \`${a.name}\` (${a.alias} · \`${a.id}\` · 状态机 \`[${a.lifecycle.join(' -> ')}]\`): ${a.description ?? ''}`,
    )
    .join('\n');
  const behList = (project.suite.M2?.behaviors ?? [])
    .map(
      (b) =>
        `- \`${b.name}\` (\`${b.id}\` · ${b.alias}): [${b.behaviorType}] 归属 \`${b.ownerEntity}\`，关联规则 \`[${b.invokedRules.join(', ')}]\``,
    )
    .join('\n');
  const ruleList = (project.suite.M3?.rules ?? [])
    .map((r) => `- \`${r.id}\` (${r.alias} · \`${r.ruleType}\`): \`${r.expression}\` -> ${r.violationMessage ?? ''}`)
    .join('\n');

  const modelPointerLines = [
    `- **MANIFEST**: \`.onto-cs/model/${project.id}/yaml/manifest.json\``,
    ...presentCodes.map(
      (code) => `- **${code}**: \`.onto-cs/model/${project.id}/yaml/${MODEL_FILE_NAMES[code]}\``,
    ),
  ].join('\n');

  const skillMarkdown = `---
name: ${slug}
description: ${project.name}（${project.domain}）业务本体技能包。当智能体需要查询或执行“${project.domain}”领域的对象、业务行为、合规规则或报表统计时调用。
---

# ${project.name} — 渐进式披露业务本体技能 (SKILL.md)

## 1. 渐进式执行工作流 (Progressive Disclosure Workflow)
1. **读取总控清单**：首先读取 \`.onto-cs/model/${project.id}/yaml/manifest.json\` 确认当前工程已就绪的元模型集合，禁止假设未列出的元模型文件存在。
2. **核验对象与不变量门禁**：按需查阅 \`M1\` 聚合根属性、状态机与 \`M3\` 刚性规则，在任何写操作前优先验证前置条件与业务规则门禁。
3. **映射领域行为与审批流**：按需查阅 \`M2\` 命令/查询契约、\`ME\`/\`M4\` 事件协同链及 \`M5\`/\`M6\` 权限与多级审批门禁（严格区分 \`DRAFT\` 暂存与 \`SUBMIT\` 提交审批）。
4. **绑定屏幕契约与边界持久化**：涉及界面调整、落库或外部联调时，按需查阅 \`MU\` 语义锚点（\`data-screen-id\` / \`data-binding\` / \`data-event-id\`）、\`MM\` 物理表映射（含 5 个审计列）及 \`MI\` 接口规范。

## 2. 领域聚合根索引 (M1 Object Model)
${aggList || '- 暂无聚合根'}

## 3. 领域行为与 MCP 工具契约 (M2 Behavior Model)
${behList || '- 暂无行为'}

## 4. 刚性业务规则门禁 (M3 Rule Model)
${ruleList || '- 暂无规则'}

## 5. 渐进式模型文件指针 (Progressive Disclosure Pointers)
${modelPointerLines}

## 6. 完成度核查门禁 (Checkable Completion Criteria)
- [ ] 所有引用路径与 \`.onto-cs/model/${project.id}/yaml/manifest.json\` 中的标准文件名 100% 一致
- [ ] 执行任意 \`M2\` 命令前已完成关联 \`M3\` 规则求值且 \`Consistency Error === 0\`
- [ ] 查询统计严格遵循 \`M2 <-> M7\` 1:1 读写分离契约，不绕过规则直接修改持久化状态
`;

  return {
    id: `skill-${project.id}`,
    projectId: project.id,
    name: `${project.name}业务本体技能 (${slug})`,
    slug,
    version: '5.0.0',
    description: `自动从工程「${project.name}」的 ${presentCodes.length} 个本体模型编译生成的 Agent 技能包。`,
    skillMarkdown,
    updatedAt: new Date().toISOString(),
  };
}
