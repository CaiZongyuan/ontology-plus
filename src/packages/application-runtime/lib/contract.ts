import { z } from 'zod';

/**
 * Connection contract v1 (TeaCo spec v0.3.1 §11.3): what an application built from a
 * Development Package serves so that Ontology Plus can connect to it and drive the
 * Operations Console. Every display name is bilingual; money is integer cents.
 */
export const CONNECTION_PROTOCOL = 'ontology-plus-connect/1';
export const MANIFEST_PATH = '/.well-known/ontology-plus.json';
export const ACTOR_HEADER = 'X-Ontology-Plus-Actor';
/** Reads a staged version of the application as a read-only preview. */
export const RELEASE_HEADER = 'X-Ontology-Plus-Release';
export const ActivateResponseSchema = z.object({ current: z.string(), previous: z.string() });
export const EventsResponseSchema = z.object({
  cursor: z.string(),
  events: z.array(z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    subject: z.string(),
    version: z.number().nullable().default(null),
    time: z.string(),
    correlationId: z.string().optional(),
    data: z.unknown(),
  })),
});
export type EventsResponse = z.infer<typeof EventsResponseSchema>;
export type RuntimeEvent = EventsResponse['events'][number];
export type ActivateResponse = z.infer<typeof ActivateResponseSchema>;

export const BilingualSchema = z.object({ zh: z.string().min(1), en: z.string().min(1) });
export type Bilingual = z.infer<typeof BilingualSchema>;

const IdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/i, 'ids use letters, digits, "-" or "_"');

export const FieldTypeSchema = z.enum(['text', 'number', 'money', 'date', 'status', 'tag']);
export type FieldType = z.infer<typeof FieldTypeSchema>;

export const FieldSchema = z.object({
  key: z.string().min(1),
  label: BilingualSchema,
  type: FieldTypeSchema.default('text'),
});
export type ConnectionField = z.infer<typeof FieldSchema>;

export const ActorSchema = z.object({
  id: IdSchema,
  name: BilingualSchema,
  role: BilingualSchema,
  scope: BilingualSchema,
});
export type ConnectionActor = z.infer<typeof ActorSchema>;

export const MetricSchema = z.object({
  id: IdSchema,
  name: BilingualSchema,
  unit: z.enum(['count', 'money', 'number']),
  hint: BilingualSchema.optional(),
  /** One-sentence summary with `{value}`, used by the overview headline. */
  headline: BilingualSchema.optional(),
});
export type ConnectionMetric = z.infer<typeof MetricSchema>;

export const ObjectFilterSchema = z.object({ id: IdSchema, label: BilingualSchema });

export const ObjectSchema = z.object({
  id: IdSchema,
  name: BilingualSchema,
  /** The confirmed Business Model object this corresponds to (aggregate name, alias or id). */
  modelObject: z.string().optional(),
  titleField: z.string().min(1),
  statusField: z.string().optional(),
  fields: z.array(FieldSchema).min(1),
  filters: z.array(ObjectFilterSchema).default([]),
});
export type ConnectionObject = z.infer<typeof ObjectSchema>;

export const ReportSchema = z.object({
  id: IdSchema,
  name: BilingualSchema,
  description: BilingualSchema.optional(),
});
export type ConnectionReport = z.infer<typeof ReportSchema>;

export const ActionParamSchema = z.object({
  key: z.string().min(1),
  label: BilingualSchema,
  type: z.enum(['number', 'text', 'object-ref', 'lines']),
  /** For object-ref and lines: the business object the value picks from. */
  objectId: z.string().optional(),
  required: z.boolean().default(true),
});
export type ConnectionActionParam = z.infer<typeof ActionParamSchema>;

/** An approved runtime change the application offers (spec §10.1); it runs only after a person approves it. */
export const ActionSchema = z.object({
  id: IdSchema,
  name: BilingualSchema,
  objectId: z.string().optional(),
  /** `record`: acts on one record of `objectId`; `none`: creates or acts without a target. */
  target: z.enum(['record', 'none']).default('record'),
  description: BilingualSchema.optional(),
  params: z.array(ActionParamSchema).default([]),
});
export type ConnectionAction = z.infer<typeof ActionSchema>;

export const ManifestSchema = z
  .object({
    protocol: z.string(),
    application: z.object({
      name: BilingualSchema,
      version: z.string().min(1),
      description: BilingualSchema.optional(),
      /** ISO 4217 currency of every money value (integer minor units). */
      currency: z.string().regex(/^[A-Z]{3}$/).default('USD'),
    }),
    model: z.object({ fingerprint: z.string().optional(), revision: z.string().optional() }).default({}),
    actors: z.array(ActorSchema).min(1),
    metrics: z.array(MetricSchema).default([]),
    objects: z.array(ObjectSchema).default([]),
    reports: z.array(ReportSchema).default([]),
    actions: z.array(ActionSchema).default([]),
    dataIssues: z.boolean().default(false),
    activity: z.boolean().default(false),
    /** Whether `GET /runtime/events` serves the application's outbox (spec §10.3). */
    events: z.boolean().default(false),
    /**
     * Versions of the application (spec §10.6). `current` is in use; any other one can be read
     * through `X-Ontology-Plus-Release` as a read-only preview and put in use by activating it.
     */
    releases: z
      .object({
        current: z.string().min(1),
        previous: z.string().min(1).nullable().default(null),
        available: z.array(z.object({ version: z.string().min(1), name: BilingualSchema, notes: z.array(BilingualSchema).default([]) })).default([]),
      })
      .optional(),
  })
  .superRefine((m, ctx) => {
    const dupes = (label: string, ids: string[]) => {
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate ${label} id "${id}"` });
        seen.add(id);
      }
    };
    dupes('actor', m.actors.map((a) => a.id));
    dupes('metric', m.metrics.map((a) => a.id));
    dupes('object', m.objects.map((a) => a.id));
    dupes('report', m.reports.map((a) => a.id));
    dupes('action', m.actions.map((a) => a.id));
    const objectIds = new Set(m.objects.map((o) => o.id));
    for (const a of m.actions) {
      if (a.objectId && !objectIds.has(a.objectId)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `action "${a.id}" names object "${a.objectId}" that the manifest does not declare` });
    }
    for (const o of m.objects) {
      const keys = new Set(o.fields.map((f) => f.key));
      for (const k of [o.titleField, ...(o.statusField ? [o.statusField] : [])]) {
        if (!keys.has(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `object "${o.id}" names field "${k}" that it does not list` });
      }
    }
  });
export type ConnectionManifest = z.infer<typeof ManifestSchema>;

const AsOf = z.string().min(1);

export const MetricsResponseSchema = z.object({
  asOf: AsOf,
  values: z.array(z.object({ id: z.string(), value: z.number().nullable(), hint: BilingualSchema.optional() })),
});
export type MetricsResponse = z.infer<typeof MetricsResponseSchema>;

const ToneSchema = z.enum(['info', 'success', 'warning', 'error']);

export const ObjectListResponseSchema = z.object({
  asOf: AsOf,
  total: z.number().int().nonnegative(),
  counts: z.array(z.object({ filter: z.string(), count: z.number().int().nonnegative() })).default([]),
  rows: z.array(
    z.object({
      key: z.string(),
      values: z.record(z.unknown()),
      flags: z.array(z.object({ tone: ToneSchema, label: BilingualSchema })).default([]),
    }),
  ),
});
export type ObjectListResponse = z.infer<typeof ObjectListResponseSchema>;

const TableSchema = z.object({
  title: BilingualSchema.optional(),
  columns: z.array(FieldSchema),
  rows: z.array(z.record(z.unknown())),
});

export const ObjectDetailResponseSchema = z.object({
  asOf: AsOf,
  key: z.string(),
  values: z.record(z.unknown()),
  flags: z.array(z.object({ tone: ToneSchema, label: BilingualSchema })).default([]),
  sections: z.array(TableSchema).default([]),
  notes: z.array(BilingualSchema).default([]),
  /** Ids of declared actions worth offering on this record for the acting identity. */
  actions: z.array(z.string()).default([]),
});
export type ObjectDetailResponse = z.infer<typeof ObjectDetailResponseSchema>;

export const ReportResponseSchema = TableSchema.extend({ asOf: AsOf, basis: BilingualSchema.optional() });
export type ReportResponse = z.infer<typeof ReportResponseSchema>;

export const DataIssueStatusSchema = z.enum(['OPEN', 'INVESTIGATING', 'PROPOSED', 'APPROVED', 'APPLIED', 'VERIFIED', 'DISMISSED']);
export type DataIssueStatus = z.infer<typeof DataIssueStatusSchema>;

export const DataIssuesResponseSchema = z.object({
  asOf: AsOf,
  issues: z.array(
    z.object({
      id: z.string(),
      title: BilingualSchema,
      detail: BilingualSchema,
      status: DataIssueStatusSchema,
      needsDecision: z.boolean().default(false),
      /** The declared action that resolves it, offered only to whoever may decide. */
      action: z.object({ actionId: z.string(), target: z.string() }).optional(),
    }),
  ),
});
export type DataIssuesResponse = z.infer<typeof DataIssuesResponseSchema>;

export const ActivityResponseSchema = z.object({
  asOf: AsOf,
  events: z.array(z.object({ at: z.string(), text: BilingualSchema, kind: z.enum(['ok', 'info', 'warning']).default('info') })),
});
export type ActivityResponse = z.infer<typeof ActivityResponseSchema>;

export const PrepareResponseSchema = z.object({
  asOf: AsOf,
  preview: z.object({
    summary: BilingualSchema,
    effects: z.array(BilingualSchema).default([]),
    target: z.object({ key: z.string().nullable(), version: z.number().int().nullable() }),
  }),
});
export type PrepareResponse = z.infer<typeof PrepareResponseSchema>;

export const ReceiptSchema = z.object({
  commandId: z.string(),
  action: z.string(),
  actor: z.string(),
  idempotencyKey: z.string(),
  target: z.string().nullable(),
  status: z.literal('COMMITTED'),
  summary: BilingualSchema,
  effects: z.array(BilingualSchema).default([]),
  after: z.object({ key: z.string().nullable(), version: z.number().int().nullable(), state: z.string().nullable() }),
  committedAt: z.string(),
});
export type ActionReceipt = z.infer<typeof ReceiptSchema>;

export const InvokeResponseSchema = z.object({ receipt: ReceiptSchema, replayed: z.boolean().default(false) });
export type InvokeResponse = z.infer<typeof InvokeResponseSchema>;
export const InvocationResponseSchema = z.object({ receipt: ReceiptSchema });

/** The body an application sends when it refuses something, in business words. */
export const AppErrorSchema = z.object({ error: z.object({ code: z.string(), message: BilingualSchema }) });

export interface ManifestProblem {
  readonly path: string;
  readonly message: string;
}

export type ManifestParseResult =
  | { readonly ok: true; readonly manifest: ConnectionManifest }
  | { readonly ok: false; readonly problems: readonly ManifestProblem[] };

/** Validates a manifest document. A protocol other than v1 is reported, not guessed at. */
export function parseConnectionManifest(input: unknown): ManifestParseResult {
  const parsed = ManifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => ({ path: issue.path.join('.') || '(manifest)', message: issue.message })),
    };
  }
  if (parsed.data.protocol !== CONNECTION_PROTOCOL) {
    return { ok: false, problems: [{ path: 'protocol', message: `unsupported protocol "${parsed.data.protocol}"; expected "${CONNECTION_PROTOCOL}"` }] };
  }
  return { ok: true, manifest: parsed.data };
}

/** Stable fingerprint of a manifest, used to notice that a connected application changed. */
export async function fingerprintManifest(manifest: ConnectionManifest): Promise<string> {
  const canonical = JSON.stringify(sortKeys(manifest));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return 'sha256:' + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}
