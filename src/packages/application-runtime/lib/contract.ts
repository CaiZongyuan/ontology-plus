import { z } from 'zod';

/**
 * Connection contract v1 (TeaCo spec v0.3.1 §11.3): what an application built from a
 * Development Package serves so that Ontology Plus can connect to it and drive the
 * Operations Console. Every display name is bilingual; money is integer cents.
 */
export const CONNECTION_PROTOCOL = 'ontology-plus-connect/1';
export const MANIFEST_PATH = '/.well-known/ontology-plus.json';
export const ACTOR_HEADER = 'X-Ontology-Plus-Actor';

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
  keyField: z.string().min(1),
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

export const ManifestSchema = z
  .object({
    protocol: z.string(),
    application: z.object({
      name: BilingualSchema,
      version: z.string().min(1),
      description: BilingualSchema.optional(),
    }),
    model: z.object({ fingerprint: z.string().optional(), revision: z.string().optional() }).default({}),
    actors: z.array(ActorSchema).min(1),
    metrics: z.array(MetricSchema).default([]),
    objects: z.array(ObjectSchema).default([]),
    reports: z.array(ReportSchema).default([]),
    dataIssues: z.boolean().default(false),
    activity: z.boolean().default(false),
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
    for (const o of m.objects) {
      const keys = new Set(o.fields.map((f) => f.key));
      for (const k of [o.keyField, o.titleField, ...(o.statusField ? [o.statusField] : [])]) {
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
    }),
  ),
});
export type DataIssuesResponse = z.infer<typeof DataIssuesResponseSchema>;

export const ActivityResponseSchema = z.object({
  asOf: AsOf,
  events: z.array(z.object({ at: z.string(), text: BilingualSchema, kind: z.enum(['ok', 'info', 'warning']).default('info') })),
});
export type ActivityResponse = z.infer<typeof ActivityResponseSchema>;

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
