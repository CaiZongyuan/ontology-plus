import { DEFAULT_TECHNOLOGY_PROFILE_ID } from '../../architecture-assets/index.js';
import type { ModelCode, OntologySuite } from '../../ontology-core/index.js';
import type {
  AssembledApplication,
  BusinessModelStepConfirmationRecord,
  ConfirmedPrototypeRevisionRecord,
  DevelopmentPackageSnapshot,
  ProjectStepConfirmations,
  PrototypeStepConfirmationRecord,
  StepConfirmationRecord,
} from './types.js';

export function normalizeStepMarkdown(raw: string | undefined | null): string {
  return String(raw ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function cyrb64Hex(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hi = (h2 >>> 0).toString(16).padStart(8, '0');
  const lo = (h1 >>> 0).toString(16).padStart(8, '0');
  return `${hi}${lo}`;
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue);
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    out[k] = canonicalizeJsonValue(v);
  }
  return out;
}

export function computeStepContentHash(content: string): string {
  const normalized = normalizeStepMarkdown(content);
  return `req-${cyrb64Hex(normalized)}-${normalized.length.toString(36)}`;
}

export function computeOntologySuiteHash(suite: OntologySuite): string {
  const canonical = JSON.stringify(canonicalizeJsonValue(suite));
  return `suite-${cyrb64Hex(canonical)}-${canonical.length.toString(36)}`;
}

export class RequirementsConfirmError extends Error {
  readonly code: 'NO_REQUIREMENT_DOC' | 'EMPTY_REQUIREMENT_DOC';
  readonly messageZh: string;
  readonly messageEn: string;

  constructor(params: {
    code: 'NO_REQUIREMENT_DOC' | 'EMPTY_REQUIREMENT_DOC';
    messageZh: string;
    messageEn: string;
  }) {
    super(`${params.messageZh} (${params.messageEn})`);
    this.name = 'RequirementsConfirmError';
    this.code = params.code;
    this.messageZh = params.messageZh;
    this.messageEn = params.messageEn;
  }
}

export type BusinessModelConfirmErrorCode =
  | 'PROTOTYPE_NOT_CONFIRMED'
  | 'EMPTY_BUSINESS_MODEL'
  | 'CONSISTENCY_ERRORS_PRESENT';

export class BusinessModelConfirmError extends Error {
  readonly code: BusinessModelConfirmErrorCode;
  readonly errorCount: number;
  readonly messageZh: string;
  readonly messageEn: string;

  constructor(params: {
    code: BusinessModelConfirmErrorCode;
    errorCount?: number;
    messageZh: string;
    messageEn: string;
  }) {
    super(`${params.messageZh} (${params.messageEn})`);
    this.name = 'BusinessModelConfirmError';
    this.code = params.code;
    this.errorCount = params.errorCount ?? 0;
    this.messageZh = params.messageZh;
    this.messageEn = params.messageEn;
  }
}

export function normalizeBusinessModelConfirmation(
  record: BusinessModelStepConfirmationRecord,
): BusinessModelStepConfirmationRecord {
  const snapshot = structuredClone(record.suiteSnapshot ?? record.suite ?? {});
  return {
    ...record,
    suite: snapshot,
    suiteSnapshot: structuredClone(snapshot),
  };
}

export function toPrototypeStepConfirmation(
  record: ConfirmedPrototypeRevisionRecord,
): PrototypeStepConfirmationRecord {
  return {
    id: record.id ?? `sconf-proto-${record.projectId}-${record.revisionId}`,
    projectId: record.projectId,
    step: 'PROTOTYPE',
    prototypeId: record.prototypeId,
    revisionId: record.revisionId,
    basedOnConfirmationId: record.basedOnConfirmationId ?? null,
    confirmedAt: record.confirmedAt,
  };
}

export function resolveCurrentStepConfirmations(
  records: readonly StepConfirmationRecord[],
  fallbackProtoConfirmation?: ConfirmedPrototypeRevisionRecord,
): ProjectStepConfirmations {
  let requirements: ProjectStepConfirmations['requirements'] = null;
  let prototype: ProjectStepConfirmations['prototype'] = null;
  let businessModel: ProjectStepConfirmations['businessModel'] = null;

  for (const rec of records) {
    if (rec.step === 'REQUIREMENTS' && !requirements) {
      requirements = rec;
    } else if (rec.step === 'PROTOTYPE' && !prototype) {
      prototype = rec;
    } else if (rec.step === 'BUSINESS_MODEL' && !businessModel) {
      businessModel = normalizeBusinessModelConfirmation(rec);
    }
    if (requirements && prototype && businessModel) break;
  }

  if (!prototype && fallbackProtoConfirmation) {
    prototype = toPrototypeStepConfirmation(fallbackProtoConfirmation);
  }

  return {
    requirements,
    prototype,
    businessModel,
  };
}

export function listPresentModelCodes(suite: OntologySuite): ModelCode[] {
  return (Object.keys(suite) as ModelCode[]).filter((code) => Boolean(suite[code]));
}

export function isPackageSnapshotOutdatedForApp(
  snapshot: Pick<
    DevelopmentPackageSnapshot,
    'basedOnBusinessModelConfirmationId'
  > &
    Partial<Pick<DevelopmentPackageSnapshot, 'manifestJson'>>,
  application: Partial<
    Pick<
      AssembledApplication,
      | 'technologyProfileId'
      | 'uiUeAssetId'
      | 'techFoundationAssetId'
      | 'techArchAssetId'
      | 'developmentInstructions'
    >
  > | undefined,
  businessModelConfirmationId: string,
): boolean {
  if (
    snapshot.basedOnBusinessModelConfirmationId !== undefined &&
    snapshot.basedOnBusinessModelConfirmationId !== businessModelConfirmationId
  ) {
    return true;
  }
  const manifest = snapshot.manifestJson as
    | {
        technologyProfile?: { id?: string };
        layers?: {
          uiUe?: { id?: string };
          techFoundation?: { id?: string };
          techArch?: { id?: string };
        };
        sources?: {
          applicationInstructionsText?: string;
        };
      }
    | undefined;
  if (!manifest || !application) {
    return false;
  }
  const expectedProfileId =
    application.technologyProfileId ?? DEFAULT_TECHNOLOGY_PROFILE_ID;
  if (manifest.technologyProfile?.id && expectedProfileId !== manifest.technologyProfile.id) {
    return true;
  }
  if (
    application.uiUeAssetId &&
    manifest.layers?.uiUe?.id &&
    application.uiUeAssetId !== manifest.layers.uiUe.id
  ) {
    return true;
  }
  if (
    application.techFoundationAssetId &&
    manifest.layers?.techFoundation?.id &&
    application.techFoundationAssetId !== manifest.layers.techFoundation.id
  ) {
    return true;
  }
  if (
    application.techArchAssetId &&
    manifest.layers?.techArch?.id &&
    application.techArchAssetId !== manifest.layers.techArch.id
  ) {
    return true;
  }
  if (
    typeof manifest.sources?.applicationInstructionsText === 'string' &&
    (application.developmentInstructions?.trim() ?? '') !==
      manifest.sources.applicationInstructionsText
  ) {
    return true;
  }
  return false;
}
