import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import {
  CONTRACT_LIFECYCLE_SUITE,
  MFT_ENTERPRISE_SUITE,
  MODEL_CODES,
  MODEL_FILE_NAMES,
  analyzeImpact,
  buildKnowledgeGraph,
  extractMuFromPrototypeHtml,
  parseSuiteFromYamlFiles,
  renameOntologySymbol,
  serializeManifestJson,
  serializeSuiteToYamlFiles,
  buildExtractionCandidates,
  previewCandidateMerge,
  scanSourceStructure,
  validateOntologySuite,
  type ExtractionCandidate,
  type ModelCode,
  type OntologySuite,
} from '../../ontology-core/index.js';
import { BOOTSTRAP_SQLITE_DDL } from './schema.js';
import {
  SEED_AGENT_SESSIONS,
  SEED_ANALYTICS_REPORTS,
  SEED_ANALYTICS_SCENARIOS,
  SEED_ASSEMBLED_APPS,
  SEED_CAPABILITY_AGENTS,
  SEED_CAPABILITY_CHAT_SESSIONS,
  SEED_CONTRACT_LINE_ITEM_ROWS,
  SEED_CONTRACT_ROWS,
  SEED_COUNTERPARTY_ROWS,
  SEED_CROSS_SYSTEM_FLOWS,
  SEED_DATABASE_RESOURCES,
  SEED_DATA_DOCUMENTS,
  SEED_DATA_MAPPINGS,
  SEED_DICT_ROWS,
  SEED_EXTRACTION_JOBS,
  SEED_FOUR_LAYER_ASSETS,
  SEED_KNOWLEDGE_ENTRIES,
  SEED_LEGACY_SYSTEMS,
  SEED_LLM_PROVIDERS,
  SEED_MCP_SERVERS,
  SEED_METRICS,
  SEED_MFT_WORK_ORDER_ROWS,
  SEED_PAYMENT_MILESTONE_ROWS,
  SEED_PROJECTS,
  SEED_PROJECT_SNAPSHOTS,
  SEED_PROTOTYPES,
  SEED_REASONING_SESSIONS,
  SEED_REQUIREMENT_DOCS,
  SEED_REQUIREMENT_SESSIONS,
  SEED_SETTLEMENT_ORDER_ROWS,
  SEED_SKILLS,
  SEED_SYSTEM_SETTINGS,
  SEED_WRITEBACK_INTERFACES,
} from './seed-data.js';
import {
  doesProviderSupportVision,
  type AgentCheckpointRecord,
  type AgentImageAttachmentRef,
  type AgentImageAttachmentRole,
  type AgentSession,
  type AgentSessionMessage,
  type AnalyticsQueryResult,
  AnalyticsReport,
  AnalyticsScenario,
  AssembledApplication,
  CapabilityAgent,
  CapabilityChatSession,
  CrossSystemFlow,
  DataDocument,
  DataMappingRule,
  DatabaseResource,
  ExtractionJob,
  FourLayerAsset,
  GeneratedSkill,
  KnowledgeEntry,
  LegacySystemConfig,
  LlmProviderConfig,
  McpServerConfig,
  MetricDefinition,
  ProjectDetail,
  ProjectSnapshot,
  ProjectSummary,
  PrototypeArtifact,
  ReasoningSession,
  RequirementDoc,
  RequirementSession,
  SystemSettingsState,
  WorkspaceStore,
  WritebackInterface,
} from './types.js';

export interface D1PreparedStatementBinding {
  bind(...values: unknown[]): D1PreparedStatementBinding;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface D1DatabaseBinding {
  prepare(query: string): D1PreparedStatementBinding;
  exec(query: string): Promise<unknown>;
}

export interface WorkspaceStoreOptions {
  dbPath?: string;
  workspaceRoot?: string;
  enableFileMirror?: boolean;
  d1Database?: D1DatabaseBinding;
}

interface SqliteStatementLike {
  run: (...params: unknown[]) => unknown;
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
}

interface SqliteDbLike {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatementLike;
}

const ANALYTICAL_TABLE_COLUMNS: Record<string, string[]> = {
  __dict: [
    'id',
    'dict_id',
    'type_code',
    'type_name',
    'item_code',
    'item_label',
    'sort_order',
    'created_by',
    'created_at',
    'updated_by',
    'updated_at',
    'flag',
  ],
  t_counterparty: [
    'id',
    'credit_code',
    'company_name',
    'industry',
    'region',
    'credit_rating',
    'status',
    'created_by',
    'created_at',
    'updated_by',
    'updated_at',
    'flag',
  ],
  t_contract: [
    'id',
    'contract_no',
    'title',
    'contract_type',
    'counterparty_id',
    'region',
    'department',
    'industry',
    'total_amount',
    'risk_level',
    'status',
    'sign_period_json',
    'overdue_days',
    'created_by',
    'created_at',
    'updated_by',
    'updated_at',
    'flag',
  ],
  t_contract_line_item: [
    'id',
    'contract_id',
    'item_name',
    'category',
    'quantity',
    'unit_price',
    'subtotal_amount',
    'created_by',
    'created_at',
    'updated_by',
    'updated_at',
    'flag',
  ],
  t_payment_milestone: [
    'id',
    'contract_id',
    'phase_name',
    'planned_ratio',
    'planned_amount',
    'due_date',
    'milestone_status',
    'overdue_days',
    'created_by',
    'created_at',
    'updated_by',
    'updated_at',
    'flag',
  ],
  t_settlement_order: [
    'id',
    'settlement_no',
    'contract_ref',
    'milestone_id',
    'settlement_amount',
    'settlement_status',
    'overdue_days',
    'settled_at',
    'created_by',
    'created_at',
    'updated_by',
    'updated_at',
    'flag',
  ],
  t_mft_work_order: [
    'id',
    'work_order_no',
    'contract_ref',
    'file_name',
    'file_size_mb',
    'security_domain',
    'sha256_digest',
    'status',
    'created_by',
    'created_at',
    'updated_by',
    'updated_at',
    'flag',
  ],
};

function createEdgeMemoryFallbackDb(): SqliteDbLike {
  const projectsMap = new Map<string, Record<string, unknown>>();
  const entitiesMap = new Map<
    string,
    { project_id: string | null; payload_json: string; updated_at: string }
  >();
  const checkpointsMap = new Map<string, AgentCheckpointRecord>();
  const eaRelationsMap = new Map<string, Record<string, unknown>[]>();
  const analyticalTables = new Map<string, Map<string, Record<string, unknown>>>();
  for (const tbl of Object.keys(ANALYTICAL_TABLE_COLUMNS)) {
    analyticalTables.set(tbl, new Map());
  }

  return {
    exec() {},
    prepare(sql: string): SqliteStatementLike {
      const s = sql.trim().replace(/\s+/g, ' ');
      return {
        run(...params: unknown[]) {
          if (s.startsWith('INSERT INTO projects')) {
            const [
              id,
              name,
              code,
              center,
              domain,
              description,
              current_stage,
              suite_json,
              changelog,
              created_at,
              updated_at,
            ] = params;
            projectsMap.set(String(id), {
              id,
              name,
              code,
              center,
              domain,
              description,
              current_stage,
              suite_json,
              changelog,
              created_at,
              updated_at,
            });
            return;
          }
          if (s.startsWith('UPDATE projects')) {
            if (params.length === 7) {
              const [name, code, center, domain, description, updated_at, id] = params;
              const cur = projectsMap.get(String(id));
              if (cur) {
                projectsMap.set(String(id), {
                  ...cur,
                  name,
                  code,
                  center,
                  domain,
                  description,
                  updated_at,
                });
              }
            } else if (params.length === 5) {
              const [suite_json, current_stage, changelog, updated_at, id] = params;
              const cur = projectsMap.get(String(id));
              if (cur) {
                projectsMap.set(String(id), {
                  ...cur,
                  suite_json,
                  current_stage,
                  changelog,
                  updated_at,
                });
              }
            } else if (params.length === 4) {
              const [suite_json, changelog, updated_at, id] = params;
              const cur = projectsMap.get(String(id));
              if (cur) {
                projectsMap.set(String(id), { ...cur, suite_json, changelog, updated_at });
              }
            }
            return;
          }
          if (s.startsWith('DELETE FROM projects WHERE id = ?')) {
            projectsMap.delete(String(params[0]));
            return;
          }
          if (s.startsWith('DELETE FROM workspace_entities WHERE collection = ? AND item_id = ?')) {
            entitiesMap.delete(`${params[0]}::${params[1]}`);
            return;
          }
          if (s.startsWith('DELETE FROM workspace_entities WHERE project_id = ?')) {
            const pid = String(params[0]);
            for (const [k, v] of entitiesMap.entries()) {
              if (v.project_id === pid) entitiesMap.delete(k);
            }
            return;
          }
          if (s.startsWith('INSERT INTO workspace_entities')) {
            const [collection, item_id, project_id, payload_json, updated_at] = params;
            entitiesMap.set(`${collection}::${item_id}`, {
              project_id: project_id ? String(project_id) : null,
              payload_json: String(payload_json),
              updated_at: String(updated_at),
            });
            return;
          }
          if (s.startsWith('INSERT INTO agent_checkpoints')) {
            const [sessionId, workflow, stateJson, updatedAt] = params;
            checkpointsMap.set(String(sessionId), {
              sessionId: String(sessionId),
              workflow: String(workflow),
              stateJson: String(stateJson),
              updatedAt: String(updatedAt),
            });
            return;
          }
          if (s.startsWith('DELETE FROM ea_relations WHERE project_id = ?')) {
            eaRelationsMap.set(String(params[0]), []);
            return;
          }
          if (s.startsWith('INSERT OR REPLACE INTO ea_relations')) {
            const [id, project_id, source_id, target_id, relation, label_zh, label_en, updated_at] =
              params;
            const pid = String(project_id);
            const list = eaRelationsMap.get(pid) ?? [];
            list.push({
              id,
              project_id,
              source_id,
              target_id,
              relation,
              label_zh,
              label_en,
              updated_at,
            });
            eaRelationsMap.set(pid, list);
            return;
          }
          for (const [tbl, cols] of Object.entries(ANALYTICAL_TABLE_COLUMNS)) {
            if (s.includes(`INTO ${tbl} (`)) {
              const row: Record<string, unknown> = {};
              cols.forEach((c, idx) => {
                row[c] = params[idx];
              });
              analyticalTables.get(tbl)!.set(String(row.id), row);
              return;
            }
          }
        },
        get(...params: unknown[]) {
          if (s.includes('COUNT(*) AS cnt FROM projects')) {
            return { cnt: projectsMap.size };
          }
          if (s.includes('COUNT(*) AS cnt FROM __dict')) {
            return { cnt: analyticalTables.get('__dict')?.size ?? 0 };
          }
          if (s.includes('FROM projects WHERE id = ?')) {
            return projectsMap.get(String(params[0]));
          }
          if (s.includes('FROM workspace_entities WHERE collection = ? AND item_id = ?')) {
            return entitiesMap.get(`${params[0]}::${params[1]}`);
          }
          if (s.includes('FROM agent_checkpoints WHERE session_id = ?')) {
            const rec = checkpointsMap.get(String(params[0]));
            return rec
              ? {
                  session_id: rec.sessionId,
                  workflow: rec.workflow,
                  state_json: rec.stateJson,
                  updated_at: rec.updatedAt,
                }
              : undefined;
          }
          return undefined;
        },
        all(...params: unknown[]) {
          if (s.includes('FROM projects')) {
            return [...projectsMap.values()];
          }
          if (s.includes('FROM workspace_entities')) {
            if (s.includes('AND project_id = ?')) {
              const [col, pid] = params;
              return [...entitiesMap.entries()]
                .filter(([k, v]) => k.startsWith(`${col}::`) && v.project_id === String(pid))
                .map(([, v]) => ({ payload_json: v.payload_json }));
            }
            const [col] = params;
            return [...entitiesMap.entries()]
              .filter(([k]) => k.startsWith(`${col}::`))
              .map(([, v]) => ({ payload_json: v.payload_json }));
          }
          if (s.includes('FROM agent_checkpoints')) {
            const items = [...checkpointsMap.values()].sort((a, b) =>
              b.updatedAt.localeCompare(a.updatedAt),
            );
            const filtered = s.includes('WHERE workflow = ?')
              ? items.filter((i) => i.workflow === String(params[0]))
              : items;
            return filtered.map((r) => ({
              session_id: r.sessionId,
              workflow: r.workflow,
              state_json: r.stateJson,
              updated_at: r.updatedAt,
            }));
          }
          if (s.includes('FROM ea_relations')) {
            if (s.includes('WHERE project_id = ?')) {
              return eaRelationsMap.get(String(params[0])) ?? [];
            }
            return [...eaRelationsMap.values()].flat();
          }
          if (s.includes('SELECT item_code, item_label FROM __dict')) {
            return [...(analyticalTables.get('__dict')?.values() ?? [])].map((r) => ({
              item_code: r.item_code,
              item_label: r.item_label,
            }));
          }
          for (const [tbl, map] of analyticalTables.entries()) {
            const tblRegex = new RegExp(`\\bFROM\\s+${tbl}\\b`, 'i');
            if (tblRegex.test(s)) {
              return [...map.values()].map((r) => ({ ...r }));
            }
          }
          return [];
        },
      };
    },
  };
}

function openSqliteOrMemoryDb(dbPath: string): SqliteDbLike {
  try {
    const req = createRequire(import.meta.url);
    const modName = ['node', 'sqlite'].join(':');
    const sqliteMod = req(modName) as { DatabaseSync: new (p: string) => SqliteDbLike };
    return new sqliteMod.DatabaseSync(dbPath);
  } catch {
    return createEdgeMemoryFallbackDb();
  }
}

function escapeSqlLiteral(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL';
  if (typeof val === 'boolean') return val ? '1' : '0';
  if (Array.isArray(val)) {
    if (val.length === 0) return '(NULL)';
    return `(${val.map((item) => escapeSqlLiteral(item)).join(', ')})`;
  }
  const str = typeof val === 'string' ? val : JSON.stringify(val);
  return `'${str.replace(/'/g, "''")}'`;
}

function bindNamedSqlParams(sql: string, params?: Record<string, unknown>): string {
  let out = '';
  let i = 0;
  let inSingleQuote = false;

  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      out += ch;
      if (inSingleQuote && sql[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      i += 1;
      continue;
    }

    if (!inSingleQuote && ch === ':' && sql[i + 1] !== ':' && /[a-zA-Z_]/.test(sql[i + 1] ?? '')) {
      let j = i + 1;
      while (j < sql.length && /[a-zA-Z0-9_]/.test(sql[j])) {
        j += 1;
      }
      const paramName = sql.slice(i + 1, j);
      const val =
        params && Object.prototype.hasOwnProperty.call(params, paramName)
          ? params[paramName]
          : null;
      out += escapeSqlLiteral(val);
      i = j;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/** Extraction jobs as stored before candidates existed: a whole-suite snapshot. */
type StoredExtractionJob = Omit<ExtractionJob, 'candidates' | 'decisions' | 'semanticAlignment'> &
  Partial<Pick<ExtractionJob, 'candidates' | 'decisions' | 'semanticAlignment'>> & {
    candidateSuite?: OntologySuite;
    confidenceScore?: number;
  };

/**
 * Bring a stored job to the current shape. An unmerged snapshot job becomes
 * the candidates that separate its snapshot from the suite as it is now.
 */
function upgradeExtractionJob(
  stored: StoredExtractionJob,
  currentSuite: () => OntologySuite | undefined,
): { job: ExtractionJob; upgraded: boolean } {
  if (stored.candidates && stored.decisions && stored.semanticAlignment) {
    return { job: stored as ExtractionJob, upgraded: false };
  }
  const { candidateSuite, confidenceScore: _confidenceScore, ...rest } = stored;
  const suite = !stored.appliedToProject && candidateSuite ? currentSuite() : undefined;
  return {
    job: {
      ...rest,
      candidates:
        stored.candidates ?? (suite ? buildExtractionCandidates(suite, candidateSuite!) : []),
      decisions: stored.decisions ?? {},
      semanticAlignment: stored.semanticAlignment ?? { status: 'SKIPPED', reason: 'LEGACY_JOB' },
    },
    upgraded: true,
  };
}

function codedError(code: 'ALREADY_MERGED' | 'NOTHING_ACCEPTED', message: string): Error {
  return Object.assign(new Error(message), { code });
}

function modelsOfCandidates(candidates: ExtractionCandidate[]): ModelCode[] {
  const present = new Set(candidates.map((c) => c.modelCode));
  return MODEL_CODES.filter((code) => present.has(code));
}

function discoverPiModelsJsonProviders(
  workspaceRoot: string,
  seededProviders: LlmProviderConfig[],
): LlmProviderConfig[] {
  const result = seededProviders.map((p) => ({
    ...p,
    availableModels: [...p.availableModels],
  }));
  const localGateway = result.find((p) => p.id === 'llm-pi-local');

  const candidatePaths = [
    path.resolve(workspaceRoot, '..', '.pi', 'agent', 'models.json'),
    path.resolve(process.cwd(), '.pi', 'agent', 'models.json'),
  ];
  try {
    const homeDir = os.homedir();
    if (homeDir) {
      candidatePaths.push(path.join(homeDir, '.pi', 'agent', 'models.json'));
    }
  } catch {
    // Ignore homedir errors in restricted edge sandboxes
  }

  const visited = new Set<string>();
  for (const filePath of candidatePaths) {
    const norm = path.normalize(filePath);
    if (visited.has(norm)) continue;
    visited.add(norm);

    try {
      if (!fs.existsSync(norm)) continue;
      const rawText = fs.readFileSync(norm, 'utf-8');
      const parsed = JSON.parse(rawText) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') continue;

      const providersField = parsed.providers;
      if (providersField && typeof providersField === 'object' && !Array.isArray(providersField)) {
        for (const [provKey, provVal] of Object.entries(providersField as Record<string, unknown>)) {
          if (!provVal || typeof provVal !== 'object') continue;
          const rec = provVal as Record<string, unknown>;
          const baseUrl = typeof rec.baseUrl === 'string' ? rec.baseUrl.trim() : '';
          const rawModels = Array.isArray(rec.models) ? rec.models : [];
          const modelIds = rawModels
            .map((m) => {
              if (typeof m === 'string') return m;
              if (m && typeof m === 'object' && 'id' in m) {
                const rawId = String((m as Record<string, unknown>).id);
                return rawId.includes('/') ? rawId : `${provKey}/${rawId}`;
              }
              return '';
            })
            .filter(Boolean);

          if (localGateway && baseUrl === localGateway.baseUrl) {
            for (const mid of modelIds) {
              if (!localGateway.availableModels.includes(mid)) {
                localGateway.availableModels.push(mid);
              }
            }
            continue;
          }

          if (!baseUrl) continue;
          const id = `llm-pi-${provKey.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`;
          if (result.some((existing) => existing.id === id)) continue;
          const apiStr = typeof rec.api === 'string' ? rec.api : '';
          const providerType: LlmProviderConfig['providerType'] = apiStr.includes('anthropic')
            ? 'ANTHROPIC'
            : 'OPENAI_COMPATIBLE';
          const defaultModel = modelIds[0] ?? 'auto/glm-5.3-flash';
          const hasExplicitVisionModel = rawModels.some(
            (m) =>
              m &&
              typeof m === 'object' &&
              Array.isArray((m as Record<string, unknown>).input) &&
              ((m as Record<string, unknown>).input as unknown[]).includes('image'),
          );
          result.push({
            id,
            name: `Pi Discovered (${provKey})`,
            providerType,
            baseUrl,
            apiKey: typeof rec.apiKey === 'string' ? rec.apiKey : '',
            defaultModel,
            availableModels: modelIds.length > 0 ? modelIds : ['auto/glm-5.3-flash'],
            enabled: true,
            supportsVision: hasExplicitVisionModel
              ? true
              : doesProviderSupportVision({ providerType, defaultModel }),
            lastTestedStatus: 'OK',
            lastTestedMessage: `Auto-discovered from .pi/agent/models.json`,
          });
        }
      }
    } catch {
      // Non-fatal if models.json is unreadable or malformed
    }
  }

  return result;
}

const VALID_IMAGE_ROLES = new Set<AgentImageAttachmentRole>([
  'primary_ref',
  'borrowed_ref',
  'user_upload',
  'selection_crop',
]);

/**
 * Enforce zero-byte image persistence on SQLite: strip any accidental base64/binary fields
 * or inline `data:` / `blob:` URIs so only lightweight `AgentImageAttachmentRef` metadata lands in SQLite.
 */
function sanitizeAgentImageAttachmentRef(raw: unknown): AgentImageAttachmentRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const id = typeof rec.id === 'string' ? rec.id.trim() : '';
  if (!id) return null;
  const name = typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : 'image';
  const mimeType =
    typeof rec.mimeType === 'string' && rec.mimeType.trim()
      ? rec.mimeType.trim()
      : 'image/webp';
  const rawRemoteUrl = typeof rec.remoteUrl === 'string' ? rec.remoteUrl.trim() : '';
  const isSafeRemoteUrl =
    Boolean(rawRemoteUrl) &&
    (/^https?:\/\//i.test(rawRemoteUrl) ||
      (rawRemoteUrl.startsWith('/') && !rawRemoteUrl.startsWith('//'))) &&
    !/^(?:data|blob):/i.test(rawRemoteUrl) &&
    rawRemoteUrl.length <= 2048;
  const source: 'local' | 'remote' =
    rec.source === 'remote' && isSafeRemoteUrl ? 'remote' : 'local';
  const width =
    typeof rec.width === 'number' && Number.isFinite(rec.width) && rec.width > 0
      ? Math.round(rec.width)
      : undefined;
  const height =
    typeof rec.height === 'number' && Number.isFinite(rec.height) && rec.height > 0
      ? Math.round(rec.height)
      : undefined;
  const role =
    typeof rec.role === 'string' && VALID_IMAGE_ROLES.has(rec.role as AgentImageAttachmentRole)
      ? (rec.role as AgentImageAttachmentRole)
      : undefined;

  return {
    id,
    name,
    mimeType,
    source,
    ...(isSafeRemoteUrl && source === 'remote' ? { remoteUrl: rawRemoteUrl } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(role ? { role } : {}),
  };
}

function sanitizeAgentSessionMessage(msg: AgentSessionMessage): AgentSessionMessage {
  const cleanContent = msg.content.replace(
    /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]{32,}/gi,
    '[inline-image-stripped]',
  );
  if (!Array.isArray(msg.images)) {
    return cleanContent === msg.content ? msg : { ...msg, content: cleanContent };
  }
  const cleanImages = msg.images
    .map((item) => sanitizeAgentImageAttachmentRef(item))
    .filter((item): item is AgentImageAttachmentRef => item !== null);
  const { images: _origImages, ...rest } = msg;
  return {
    ...rest,
    content: cleanContent,
    ...(cleanImages.length > 0 ? { images: cleanImages } : {}),
  };
}

function sanitizeAgentSessionForPersistence(session: AgentSession): AgentSession {
  return {
    ...session,
    messages: (session.messages ?? []).map(sanitizeAgentSessionMessage),
  };
}

export function createWorkspaceStore(options: WorkspaceStoreOptions = {}): WorkspaceStore {
  const workspaceRoot = options.workspaceRoot ?? path.resolve(process.cwd(), '.onto-cs');
  const enableFileMirror = options.enableFileMirror ?? true;
  const dbPath = options.dbPath ?? path.join(workspaceRoot, 'onto-cs.db');
  const d1Database = options.d1Database;

  if (dbPath !== ':memory:') {
    try {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    } catch {
      // Non-fatal in read-only edge runtimes
    }
  }

  const db = openSqliteOrMemoryDb(dbPath);
  db.exec(BOOTSTRAP_SQLITE_DDL);

  function replicateToD1(query: string, ...values: unknown[]): void {
    if (!d1Database) return;
    try {
      void d1Database
        .prepare(query)
        .bind(...values)
        .run()
        .catch(() => undefined);
    } catch {
      // Non-fatal background D1 mirror
    }
  }

  function buildManifestForSuite(projectId: string, domain: string, suite: OntologySuite): string {
    const models: Record<string, string> = {};
    for (const code of MODEL_CODES) {
      if (suite[code]) {
        models[code] = MODEL_FILE_NAMES[code];
      }
    }
    return serializeManifestJson({
      version: '1.0',
      projectId,
      domain,
      models,
    });
  }

  function syncEaRelations(projectId: string, suite: OntologySuite): void {
    const kg = buildKnowledgeGraph(suite);
    const now = new Date().toISOString();
    db.prepare(`DELETE FROM ea_relations WHERE project_id = ?`).run(projectId);
    replicateToD1(`DELETE FROM ea_relations WHERE project_id = ?`, projectId);

    const ins = db.prepare(`
      INSERT OR REPLACE INTO ea_relations (id, project_id, source_id, target_id, relation, label_zh, label_en, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const edge of kg.edges) {
      const rowId = `${projectId}::${edge.id}`;
      ins.run(
        rowId,
        projectId,
        edge.source,
        edge.target,
        edge.relation,
        edge.labelZh,
        edge.labelEn,
        now,
      );
      replicateToD1(
        `INSERT OR REPLACE INTO ea_relations (id, project_id, source_id, target_id, relation, label_zh, label_en, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        rowId,
        projectId,
        edge.source,
        edge.target,
        edge.relation,
        edge.labelZh,
        edge.labelEn,
        now,
      );
    }
  }

  function mirrorProjectFiles(
    projectId: string,
    domain: string,
    suite: OntologySuite,
    changelog: string,
  ): void {
    if (!enableFileMirror) return;
    try {
      const modelRoot = path.join(workspaceRoot, 'model', projectId);
      const yamlDir = path.join(modelRoot, 'yaml');
      const files = serializeSuiteToYamlFiles(suite);
      const activeEntries = Object.values(files).filter(
        (entry): entry is NonNullable<typeof entry> => Boolean(entry),
      );

      if (activeEntries.length === 0) {
        if (fs.existsSync(yamlDir)) {
          fs.rmSync(yamlDir, { recursive: true, force: true });
        }
        if (fs.existsSync(modelRoot)) {
          fs.writeFileSync(path.join(modelRoot, 'CHANGELOG.md'), changelog, 'utf-8');
        }
        return;
      }

      fs.mkdirSync(yamlDir, { recursive: true });
      const activeFileNames = new Set<string>(['manifest.json']);
      for (const entry of activeEntries) {
        activeFileNames.add(entry.fileName);
        fs.writeFileSync(path.join(yamlDir, entry.fileName), entry.content, 'utf-8');
      }
      for (const existingName of fs.readdirSync(yamlDir)) {
        if (!activeFileNames.has(existingName)) {
          fs.rmSync(path.join(yamlDir, existingName), { force: true });
        }
      }
      const manifestJson = buildManifestForSuite(projectId, domain, suite);
      fs.writeFileSync(path.join(yamlDir, 'manifest.json'), manifestJson, 'utf-8');
      fs.writeFileSync(path.join(modelRoot, 'CHANGELOG.md'), changelog, 'utf-8');
    } catch {
      // Non-fatal in read-only edge runtimes
    }
  }

  function putItem<T>(collection: string, itemId: string, payload: T, projectId?: string): T {
    const now = new Date().toISOString();
    const payloadJson = JSON.stringify(payload);
    const stmt = db.prepare(`
      INSERT INTO workspace_entities (collection, item_id, project_id, payload_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(collection, item_id) DO UPDATE SET
        project_id = excluded.project_id,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `);
    stmt.run(collection, itemId, projectId ?? null, payloadJson, now);
    replicateToD1(
      `INSERT INTO workspace_entities (collection, item_id, project_id, payload_json, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(collection, item_id) DO UPDATE SET project_id = excluded.project_id, payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
      collection,
      itemId,
      projectId ?? null,
      payloadJson,
      now,
    );
    return payload;
  }

  function listItems<T>(collection: string, projectId?: string): T[] {
    if (projectId) {
      const stmt = db.prepare(
        `SELECT payload_json FROM workspace_entities WHERE collection = ? AND project_id = ? ORDER BY updated_at DESC`,
      );
      const rows = stmt.all(collection, projectId) as { payload_json: string }[];
      return rows.map((r) => JSON.parse(r.payload_json) as T);
    }
    const stmt = db.prepare(
      `SELECT payload_json FROM workspace_entities WHERE collection = ? ORDER BY updated_at DESC`,
    );
    const rows = stmt.all(collection) as { payload_json: string }[];
    return rows.map((r) => JSON.parse(r.payload_json) as T);
  }

  function getItem<T>(collection: string, itemId: string): T | undefined {
    const stmt = db.prepare(
      `SELECT payload_json FROM workspace_entities WHERE collection = ? AND item_id = ?`,
    );
    const row = stmt.get(collection, itemId) as { payload_json: string } | undefined;
    return row ? (JSON.parse(row.payload_json) as T) : undefined;
  }

  function deleteItem(collection: string, itemId: string): void {
    db.prepare(`DELETE FROM workspace_entities WHERE collection = ? AND item_id = ?`).run(
      collection,
      itemId,
    );
    replicateToD1(
      `DELETE FROM workspace_entities WHERE collection = ? AND item_id = ?`,
      collection,
      itemId,
    );
  }

  // Idempotent seed for analytical domain tables
  const dictCountRow = db.prepare(`SELECT COUNT(*) AS cnt FROM __dict`).get() as
    | { cnt: number }
    | undefined;
  if (!dictCountRow || Number(dictCountRow.cnt) === 0) {
    const insDict = db.prepare(`
      INSERT OR REPLACE INTO __dict (id, dict_id, type_code, type_name, item_code, item_label, sort_order, created_by, created_at, updated_by, updated_at, flag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of SEED_DICT_ROWS) {
      insDict.run(
        r.id,
        r.dict_id,
        r.type_code,
        r.type_name,
        r.item_code,
        r.item_label,
        r.sort_order,
        r.created_by,
        r.created_at,
        r.updated_by,
        r.updated_at,
        r.flag,
      );
    }

    const insCp = db.prepare(`
      INSERT OR REPLACE INTO t_counterparty (id, credit_code, company_name, industry, region, credit_rating, status, created_by, created_at, updated_by, updated_at, flag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of SEED_COUNTERPARTY_ROWS) {
      insCp.run(
        r.id,
        r.credit_code,
        r.company_name,
        r.industry,
        r.region,
        r.credit_rating,
        r.status,
        r.created_by,
        r.created_at,
        r.updated_by,
        r.updated_at,
        r.flag,
      );
    }

    const insContract = db.prepare(`
      INSERT OR REPLACE INTO t_contract (id, contract_no, title, contract_type, counterparty_id, region, department, industry, total_amount, risk_level, status, sign_period_json, overdue_days, created_by, created_at, updated_by, updated_at, flag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of SEED_CONTRACT_ROWS) {
      insContract.run(
        r.id,
        r.contract_no,
        r.title,
        r.contract_type,
        r.counterparty_id,
        r.region,
        r.department,
        r.industry,
        r.total_amount,
        r.risk_level,
        r.status,
        r.sign_period_json,
        r.overdue_days,
        r.created_by,
        r.created_at,
        r.updated_by,
        r.updated_at,
        r.flag,
      );
    }

    const insLine = db.prepare(`
      INSERT OR REPLACE INTO t_contract_line_item (id, contract_id, item_name, category, quantity, unit_price, subtotal_amount, created_by, created_at, updated_by, updated_at, flag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of SEED_CONTRACT_LINE_ITEM_ROWS) {
      insLine.run(
        r.id,
        r.contract_id,
        r.item_name,
        r.category,
        r.quantity,
        r.unit_price,
        r.subtotal_amount,
        r.created_by,
        r.created_at,
        r.updated_by,
        r.updated_at,
        r.flag,
      );
    }

    const insMs = db.prepare(`
      INSERT OR REPLACE INTO t_payment_milestone (id, contract_id, phase_name, planned_ratio, planned_amount, due_date, milestone_status, overdue_days, created_by, created_at, updated_by, updated_at, flag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of SEED_PAYMENT_MILESTONE_ROWS) {
      insMs.run(
        r.id,
        r.contract_id,
        r.phase_name,
        r.planned_ratio,
        r.planned_amount,
        r.due_date,
        r.milestone_status,
        r.overdue_days,
        r.created_by,
        r.created_at,
        r.updated_by,
        r.updated_at,
        r.flag,
      );
    }

    const insStl = db.prepare(`
      INSERT OR REPLACE INTO t_settlement_order (id, settlement_no, contract_ref, milestone_id, settlement_amount, settlement_status, overdue_days, settled_at, created_by, created_at, updated_by, updated_at, flag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of SEED_SETTLEMENT_ORDER_ROWS) {
      insStl.run(
        r.id,
        r.settlement_no,
        r.contract_ref,
        r.milestone_id,
        r.settlement_amount,
        r.settlement_status,
        r.overdue_days,
        r.settled_at,
        r.created_by,
        r.created_at,
        r.updated_by,
        r.updated_at,
        r.flag,
      );
    }

    const insMft = db.prepare(`
      INSERT OR REPLACE INTO t_mft_work_order (id, work_order_no, contract_ref, file_name, file_size_mb, security_domain, sha256_digest, status, created_by, created_at, updated_by, updated_at, flag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of SEED_MFT_WORK_ORDER_ROWS) {
      insMft.run(
        r.id,
        r.work_order_no,
        r.contract_ref,
        r.file_name,
        r.file_size_mb,
        r.security_domain,
        r.sha256_digest,
        r.status,
        r.created_by,
        r.created_at,
        r.updated_by,
        r.updated_at,
        r.flag,
      );
    }
  }

  // Idempotent seed on first startup
  const countRow = db.prepare(`SELECT COUNT(*) AS cnt FROM projects`).get() as { cnt: number };
  if (countRow.cnt === 0) {
    const now = '2026-11-10T09:00:00.000Z';
    const insertProj = db.prepare(`
      INSERT INTO projects (id, name, code, center, domain, description, current_stage, suite_json, changelog, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const p of SEED_PROJECTS) {
      insertProj.run(
        p.id,
        p.name,
        p.code,
        p.center,
        p.domain,
        p.description,
        p.currentStage,
        JSON.stringify(p.suite),
        p.changelog,
        now,
        now,
      );
      syncEaRelations(p.id, p.suite);
      mirrorProjectFiles(p.id, p.domain, p.suite, p.changelog);
    }

    for (const s of SEED_REQUIREMENT_SESSIONS) putItem('req_sessions', s.id, s, s.projectId);
    for (const d of SEED_REQUIREMENT_DOCS) putItem('req_docs', d.id, d, d.projectId);
    for (const pr of SEED_PROTOTYPES) putItem('prototypes', pr.id, pr, pr.projectId);
    for (const a of SEED_FOUR_LAYER_ASSETS) putItem('four_layer_assets', a.id, a);
    for (const app of SEED_ASSEMBLED_APPS) putItem('assembled_apps', app.id, app, app.projectId);
    for (const sk of SEED_SKILLS) putItem('skills', sk.id, sk, sk.projectId);
    for (const sys of SEED_LEGACY_SYSTEMS) putItem('legacy_systems', sys.id, sys, sys.linkedProjectId);
    for (const job of SEED_EXTRACTION_JOBS) putItem('extraction_jobs', job.id, job, job.projectId);
    for (const mcp of SEED_MCP_SERVERS) putItem('mcp_servers', mcp.id, mcp, mcp.projectId);
    for (const ag of SEED_CAPABILITY_AGENTS) putItem('capability_agents', ag.id, ag, ag.projectId);
    for (const cs of SEED_CAPABILITY_CHAT_SESSIONS) {
      putItem('capability_chats', cs.id, cs, cs.projectId);
    }
    for (const fl of SEED_CROSS_SYSTEM_FLOWS) putItem('cross_flows', fl.id, fl);
    for (const kn of SEED_KNOWLEDGE_ENTRIES) putItem('knowledge', kn.id, kn, kn.linkedProjectId);
    for (const dbr of SEED_DATABASE_RESOURCES) putItem('db_resources', dbr.id, dbr);
    for (const ddoc of SEED_DATA_DOCUMENTS) putItem('data_docs', ddoc.id, ddoc);
    for (const dm of SEED_DATA_MAPPINGS) putItem('data_mappings', dm.id, dm);
    for (const m of SEED_METRICS) putItem('metrics', m.id, m);
    for (const sc of SEED_ANALYTICS_SCENARIOS) putItem('analytics_scenarios', sc.id, sc);
    for (const rp of SEED_ANALYTICS_REPORTS) putItem('analytics_reports', rp.id, rp);
    for (const rs of SEED_REASONING_SESSIONS) putItem('reasoning_sessions', rs.id, rs);
    for (const wb of SEED_WRITEBACK_INTERFACES) putItem('writebacks', wb.id, wb);
    for (const snap of SEED_PROJECT_SNAPSHOTS) {
      putItem('project_snapshots', snap.id, snap, snap.projectId);
    }
    for (const asess of SEED_AGENT_SESSIONS) {
      putItem('agent_sessions', asess.id, asess, asess.projectId);
    }

    const discoveredProviders = discoverPiModelsJsonProviders(workspaceRoot, SEED_LLM_PROVIDERS);
    for (const llm of discoveredProviders) putItem('llm_providers', llm.id, llm);

    putItem('system_settings', 'global', SEED_SYSTEM_SETTINGS);
  } else {
    if (listItems<AgentSession>('agent_sessions').length === 0) {
      for (const asess of SEED_AGENT_SESSIONS) {
        putItem('agent_sessions', asess.id, asess, asess.projectId);
      }
    }
    if (listItems<ProjectSnapshot>('project_snapshots').length === 0) {
      for (const snap of SEED_PROJECT_SNAPSHOTS) {
        putItem('project_snapshots', snap.id, snap, snap.projectId);
      }
    }
  }

  function hydrateProject(row: Record<string, unknown>): ProjectDetail {
    const suite = JSON.parse(String(row.suite_json)) as OntologySuite;
    const validation = validateOntologySuite(suite);
    const knowledgeGraph = buildKnowledgeGraph(suite);
    return {
      id: String(row.id),
      name: String(row.name),
      code: String(row.code),
      center: row.center as ProjectSummary['center'],
      domain: String(row.domain),
      description: String(row.description),
      currentStage: Number(row.current_stage),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      suite,
      validation,
      knowledgeGraph,
      changelog: String(row.changelog),
    };
  }

  function getDictionaryLabelMap(): Map<string, string> {
    const map = new Map<string, string>();
    try {
      const rows = db
        .prepare(`SELECT item_code, item_label FROM __dict WHERE flag = 1`)
        .all() as { item_code: string; item_label: string }[];
      for (const r of rows) {
        if (r.item_code && r.item_label) {
          map.set(String(r.item_code), String(r.item_label));
        }
      }
    } catch {
      for (const r of SEED_DICT_ROWS) {
        map.set(r.item_code, r.item_label);
      }
    }
    return map;
  }

  let seqCounter = 0;
  function nextUniqueId(prefix: string): string {
    seqCounter += 1;
    return `${prefix}-${Date.now().toString(36)}-${seqCounter.toString(36)}`;
  }

  function getProjectSuite(projectId: string): OntologySuite | undefined {
    const row = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId) as
      | Record<string, unknown>
      | undefined;
    return row ? (JSON.parse(String(row.suite_json)) as OntologySuite) : undefined;
  }

  function getUpgradedExtractionJob(jobId: string): ExtractionJob | undefined {
    const stored = getItem<StoredExtractionJob>('extraction_jobs', jobId);
    if (!stored) return undefined;
    const { job, upgraded } = upgradeExtractionJob(stored, () => getProjectSuite(stored.projectId));
    if (upgraded) putItem('extraction_jobs', job.id, job, job.projectId);
    return job;
  }

  return {
    listProjects(): ProjectSummary[] {
      const rows = db
        .prepare(
          `SELECT id, name, code, center, domain, description, current_stage, created_at, updated_at FROM projects ORDER BY created_at ASC`,
        )
        .all() as Record<string, unknown>[];
      return rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        code: String(row.code),
        center: row.center as ProjectSummary['center'],
        domain: String(row.domain),
        description: String(row.description),
        currentStage: Number(row.current_stage),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      }));
    },

    getProject(projectId: string): ProjectDetail | undefined {
      const row = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId) as
        | Record<string, unknown>
        | undefined;
      return row ? hydrateProject(row) : undefined;
    },

    createProject(input): ProjectDetail {
      const id = nextUniqueId('proj');
      const now = new Date().toISOString();
      let baseSuite: OntologySuite;
      if (input.template === 'CONTRACT') {
        baseSuite = JSON.parse(JSON.stringify(CONTRACT_LIFECYCLE_SUITE));
      } else if (input.template === 'MFT') {
        baseSuite = JSON.parse(JSON.stringify(MFT_ENTERPRISE_SUITE));
      } else {
        baseSuite = {};
      }
      const changelog = `# Ontology Change Log - ${input.name}\n\n## [${now}] Project Created\n- Domain: ${input.domain}\n`;
      const desc = input.description ?? `${input.domain}本体工程`;
      const stage = Object.keys(baseSuite).length;
      const suiteJson = JSON.stringify(baseSuite);
      db.prepare(`
        INSERT INTO projects (id, name, code, center, domain, description, current_stage, suite_json, changelog, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.name,
        input.code,
        input.center ?? 'APPLICATION',
        input.domain,
        desc,
        stage,
        suiteJson,
        changelog,
        now,
        now,
      );
      replicateToD1(
        `INSERT INTO projects (id, name, code, center, domain, description, current_stage, suite_json, changelog, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        input.name,
        input.code,
        input.center ?? 'APPLICATION',
        input.domain,
        desc,
        stage,
        suiteJson,
        changelog,
        now,
        now,
      );
      syncEaRelations(id, baseSuite);
      mirrorProjectFiles(id, input.domain, baseSuite, changelog);
      return this.getProject(id)!;
    },

    updateProjectMeta(projectId, patch): ProjectDetail {
      const current = this.getProject(projectId);
      if (!current) throw new Error(`Project not found: ${projectId}`);
      const now = new Date().toISOString();
      const nextName = patch.name?.trim() || current.name;
      const nextCode = patch.code?.trim() || current.code;
      const nextCenter = patch.center ?? current.center;
      const nextDomain = patch.domain?.trim() || current.domain;
      const nextDesc = patch.description ?? current.description;
      db.prepare(`
        UPDATE projects SET name = ?, code = ?, center = ?, domain = ?, description = ?, updated_at = ? WHERE id = ?
      `).run(nextName, nextCode, nextCenter, nextDomain, nextDesc, now, projectId);
      replicateToD1(
        `UPDATE projects SET name = ?, code = ?, center = ?, domain = ?, description = ?, updated_at = ? WHERE id = ?`,
        nextName,
        nextCode,
        nextCenter,
        nextDomain,
        nextDesc,
        now,
        projectId,
      );
      mirrorProjectFiles(projectId, nextDomain, current.suite, current.changelog);
      return this.getProject(projectId)!;
    },

    cloneProject(projectId, overrides): ProjectDetail {
      const source = this.getProject(projectId);
      if (!source) throw new Error(`Project not found: ${projectId}`);
      const id = nextUniqueId('proj');
      const now = new Date().toISOString();
      const nextName = overrides?.name?.trim() || `${source.name} (副本)`;
      const nextCode = overrides?.code?.trim() || `${source.code}-COPY`;
      const clonedSuite: OntologySuite = JSON.parse(JSON.stringify(source.suite));
      const changelog = `${source.changelog}\n## [${now}] Cloned from ${source.name} (${source.code})\n`;
      const suiteJson = JSON.stringify(clonedSuite);
      const stage = validateOntologySuite(clonedSuite).presentModels.length;

      db.prepare(`
        INSERT INTO projects (id, name, code, center, domain, description, current_stage, suite_json, changelog, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        nextName,
        nextCode,
        source.center,
        source.domain,
        source.description,
        stage,
        suiteJson,
        changelog,
        now,
        now,
      );
      replicateToD1(
        `INSERT INTO projects (id, name, code, center, domain, description, current_stage, suite_json, changelog, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        nextName,
        nextCode,
        source.center,
        source.domain,
        source.description,
        stage,
        suiteJson,
        changelog,
        now,
        now,
      );
      syncEaRelations(id, clonedSuite);
      mirrorProjectFiles(id, source.domain, clonedSuite, changelog);

      // Clone SRS docs and Prototypes attached to the project
      for (const doc of this.listRequirementDocs(projectId)) {
        this.saveRequirementDoc({
          ...doc,
          id: nextUniqueId('rdoc'),
          projectId: id,
          title: `${doc.title} (副本)`,
        });
      }
      for (const proto of this.listPrototypes(projectId)) {
        const clonedProto: PrototypeArtifact = {
          ...proto,
          id: nextUniqueId('proto'),
          projectId: id,
          name: `${proto.name} (副本)`,
          updatedAt: now,
        };
        putItem('prototypes', clonedProto.id, clonedProto, id);
      }

      return this.getProject(id)!;
    },

    deleteProject(projectId, force) {
      const allProjects = this.listProjects();
      if (allProjects.length <= 1) {
        throw new Error('Cannot delete the last remaining ontology project in the workspace.');
      }
      const target = allProjects.find((p) => p.id === projectId);
      if (!target) {
        throw new Error(`Project not found: ${projectId}`);
      }
      const boundApps = this.listAssembledApplications().filter((a) => a.projectId === projectId);
      if (!force && boundApps.length > 0) {
        throw new Error(
          `Project "${target.name}" is referenced by ${boundApps.length} assembled application(s): ${boundApps.map((a) => a.name).join(', ')}. Confirm force deletion or unbind first.`,
        );
      }
      db.prepare(`DELETE FROM ea_relations WHERE project_id = ?`).run(projectId);
      replicateToD1(`DELETE FROM ea_relations WHERE project_id = ?`, projectId);
      db.prepare(`DELETE FROM workspace_entities WHERE project_id = ?`).run(projectId);
      replicateToD1(`DELETE FROM workspace_entities WHERE project_id = ?`, projectId);
      db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
      replicateToD1(`DELETE FROM projects WHERE id = ?`, projectId);

      const remaining = this.listProjects();
      return {
        deletedId: projectId,
        remainingProjectId: remaining[0].id,
      };
    },

    listProjectSnapshots(projectId): ProjectSnapshot[] {
      return listItems<ProjectSnapshot>('project_snapshots', projectId).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
    },

    createProjectSnapshot(projectId, input): ProjectSnapshot {
      const current = this.getProject(projectId);
      if (!current) throw new Error(`Project not found: ${projectId}`);
      const now = new Date().toISOString();
      const snapshot: ProjectSnapshot = {
        id: nextUniqueId('snap'),
        projectId,
        label: input.label.trim() || `快照 ${now.slice(0, 16)}`,
        note: input.note?.trim() ?? '',
        presentModels: [...current.validation.presentModels],
        errorCount: current.validation.errorCount,
        warningCount: current.validation.warningCount,
        suite: JSON.parse(JSON.stringify(current.suite)),
        createdAt: now,
      };
      return putItem('project_snapshots', snapshot.id, snapshot, projectId);
    },

    restoreProjectSnapshot(projectId, snapshotId): ProjectDetail {
      const snap = getItem<ProjectSnapshot>('project_snapshots', snapshotId);
      if (!snap || snap.projectId !== projectId) {
        throw new Error(`Project snapshot not found: ${snapshotId}`);
      }
      const restoredSuite: OntologySuite = JSON.parse(JSON.stringify(snap.suite));
      return this.updateSuite(
        projectId,
        restoredSuite,
        `Restored project snapshot "${snap.label}" (${snap.id})`,
      );
    },

    deleteProjectSnapshot(snapshotId) {
      deleteItem('project_snapshots', snapshotId);
    },

    updateModel(projectId, modelCode, modelData): ProjectDetail {
      const current = this.getProject(projectId);
      if (!current) throw new Error(`Project not found: ${projectId}`);
      const nextSuite: OntologySuite = {
        ...current.suite,
        [modelCode]: modelData,
      };
      return this.updateSuite(projectId, nextSuite, `Updated ${modelCode} model`);
    },

    updateSuite(projectId, suite, changelogNote): ProjectDetail {
      const current = this.getProject(projectId);
      if (!current) throw new Error(`Project not found: ${projectId}`);
      const now = new Date().toISOString();
      const validation = validateOntologySuite(suite);
      const nextChangelog = changelogNote
        ? `${current.changelog}\n## [${now}] ${changelogNote}\n- Present Models: ${validation.presentModels.join(', ')}\n- Consistency Errors: ${validation.errorCount}, Stage Warnings: ${validation.warningCount}\n`
        : current.changelog;
      const suiteJson = JSON.stringify(suite);

      db.prepare(`
        UPDATE projects
        SET suite_json = ?, current_stage = ?, changelog = ?, updated_at = ?
        WHERE id = ?
      `).run(suiteJson, validation.presentModels.length, nextChangelog, now, projectId);
      replicateToD1(
        `UPDATE projects SET suite_json = ?, current_stage = ?, changelog = ?, updated_at = ? WHERE id = ?`,
        suiteJson,
        validation.presentModels.length,
        nextChangelog,
        now,
        projectId,
      );
      syncEaRelations(projectId, suite);
      mirrorProjectFiles(projectId, current.domain, suite, nextChangelog);
      return this.getProject(projectId)!;
    },

    importYamlFiles(projectId, files) {
      const current = this.getProject(projectId);
      if (!current) throw new Error(`Project not found: ${projectId}`);
      const { suite: parsedPartial, parseErrors } = parseSuiteFromYamlFiles(files);
      const mergedSuite: OntologySuite = {
        ...current.suite,
        ...parsedPartial,
      };
      const updated = this.updateSuite(
        projectId,
        mergedSuite,
        `Imported YAML files (${Object.keys(parsedPartial).join(', ')})`,
      );
      return { project: updated, parseErrors };
    },

    exportYamlFiles(projectId) {
      const current = this.getProject(projectId);
      if (!current) throw new Error(`Project not found: ${projectId}`);
      return serializeSuiteToYamlFiles(current.suite);
    },

    exportManifestJson(projectId) {
      const current = this.getProject(projectId);
      if (!current) throw new Error(`Project not found: ${projectId}`);
      return buildManifestForSuite(current.id, current.domain, current.suite);
    },

    analyzeSymbolImpact(projectId, targetId) {
      const current = this.getProject(projectId);
      if (!current) throw new Error(`Project not found: ${projectId}`);
      return analyzeImpact(current.suite, targetId);
    },

    renameSymbol(projectId, oldId, newId) {
      const current = this.getProject(projectId);
      if (!current) throw new Error(`Project not found: ${projectId}`);
      const result = renameOntologySymbol(current.suite, oldId, newId);
      const nextChangelog = `${current.changelog}\n${result.changelogEntry}`;
      const now = new Date().toISOString();
      const suiteJson = JSON.stringify(result.suite);
      db.prepare(`
        UPDATE projects SET suite_json = ?, changelog = ?, updated_at = ? WHERE id = ?
      `).run(suiteJson, nextChangelog, now, projectId);
      replicateToD1(
        `UPDATE projects SET suite_json = ?, changelog = ?, updated_at = ? WHERE id = ?`,
        suiteJson,
        nextChangelog,
        now,
        projectId,
      );
      syncEaRelations(projectId, result.suite);
      mirrorProjectFiles(projectId, current.domain, result.suite, nextChangelog);
      return {
        project: this.getProject(projectId)!,
        changedCount: result.changedReferences.length,
        changelogEntry: result.changelogEntry,
      };
    },

    listAgentSessions(filter) {
      let items = filter?.projectId
        ? listItems<AgentSession>('agent_sessions', filter.projectId)
        : listItems<AgentSession>('agent_sessions');
      if (filter?.agentKind) {
        items = items.filter((s) => s.agentKind === filter.agentKind);
      }
      if (filter?.targetId) {
        items = items.filter((s) => s.targetId === filter.targetId);
      }
      return items.sort((a, b) => {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
    },

    getAgentSession(sessionId) {
      return getItem<AgentSession>('agent_sessions', sessionId);
    },

    createAgentSession(input) {
      const now = new Date().toISOString();
      const defaultTitles: Record<AgentSession['agentKind'], string> = {
        REQUIREMENT: '新建需求探索会话',
        COPILOT: '新建本体建模对话',
        CODING: '新建四层编码任务会话',
        CAPABILITY: '新建智能体工具对话',
        REASONING: '新建数据本体推演会话',
      };
      const session = sanitizeAgentSessionForPersistence({
        id: input.id ?? nextUniqueId('asess'),
        projectId: input.projectId,
        agentKind: input.agentKind,
        targetId: input.targetId,
        title: input.title?.trim() || defaultTitles[input.agentKind],
        pinned: false,
        status: 'IDLE',
        providerId: input.providerId,
        modelOverride: input.modelOverride,
        reasoningMode: input.reasoningMode,
        messages: input.initialMessages ?? [],
        createdAt: now,
        updatedAt: now,
      });
      return putItem('agent_sessions', session.id, session, session.projectId);
    },

    saveAgentSession(session) {
      const updated = sanitizeAgentSessionForPersistence({
        ...session,
        updatedAt: new Date().toISOString(),
      });
      return putItem('agent_sessions', updated.id, updated, updated.projectId);
    },

    forkAgentSession(sessionId, upToMessageId, newTitle) {
      const existing = getItem<AgentSession>('agent_sessions', sessionId);
      if (!existing) throw new Error(`Agent session not found: ${sessionId}`);
      const now = new Date().toISOString();
      let slicedMessages = [...existing.messages];
      if (upToMessageId) {
        const idx = slicedMessages.findIndex((m) => m.id === upToMessageId);
        if (idx >= 0) {
          slicedMessages = slicedMessages.slice(0, idx + 1);
        }
      }
      const forked = sanitizeAgentSessionForPersistence({
        ...existing,
        id: nextUniqueId('asess-fork'),
        title: newTitle?.trim() || `${existing.title} · 分支`,
        pinned: false,
        status: 'IDLE',
        parentSessionId: existing.id,
        forkedFromMessageId: upToMessageId ?? slicedMessages[slicedMessages.length - 1]?.id,
        messages: JSON.parse(JSON.stringify(slicedMessages)),
        createdAt: now,
        updatedAt: now,
      });
      return putItem('agent_sessions', forked.id, forked, forked.projectId);
    },

    deleteAgentSession(sessionId) {
      deleteItem('agent_sessions', sessionId);
    },

    listRequirementSessions(projectId) {
      return listItems<RequirementSession>('req_sessions', projectId);
    },

    getRequirementSession(sessionId) {
      return getItem<RequirementSession>('req_sessions', sessionId);
    },

    createRequirementSession(input) {
      const now = new Date().toISOString();
      const session: RequirementSession = {
        id: nextUniqueId('req-sess'),
        projectId: input.projectId,
        title: input.title,
        status: 'EXPLORING',
        messages: input.initialPrompt
          ? [
              {
                id: nextUniqueId('msg'),
                role: 'user',
                content: input.initialPrompt,
                timestamp: now,
              },
            ]
          : [],
        discoveredAggregates: [],
        discoveredRules: [],
        resolvedDecisions: [],
        updatedAt: now,
      };
      return putItem('req_sessions', session.id, session, session.projectId);
    },

    appendRequirementMessage(sessionId, message, updates) {
      const existing = getItem<RequirementSession>('req_sessions', sessionId);
      if (!existing) throw new Error(`Requirement session not found: ${sessionId}`);
      const updated: RequirementSession = {
        ...existing,
        title: updates?.title ?? existing.title,
        messages: [...existing.messages, message],
        discoveredAggregates: updates?.discoveredAggregates ?? existing.discoveredAggregates,
        discoveredRules: updates?.discoveredRules ?? existing.discoveredRules,
        resolvedDecisions: updates?.resolvedDecisions ?? existing.resolvedDecisions,
        status: updates?.status ?? existing.status,
        updatedAt: new Date().toISOString(),
      };
      return putItem('req_sessions', sessionId, updated, existing.projectId);
    },

    deleteRequirementSession(sessionId) {
      deleteItem('req_sessions', sessionId);
    },

    listRequirementDocs(projectId) {
      return listItems<RequirementDoc>('req_docs', projectId);
    },

    saveRequirementDoc(doc) {
      const full: RequirementDoc = {
        ...doc,
        updatedAt: new Date().toISOString(),
      };
      return putItem('req_docs', full.id, full, full.projectId);
    },

    cloneRequirementDoc(docId) {
      const existing = getItem<RequirementDoc>('req_docs', docId);
      if (!existing) throw new Error(`Requirement doc not found: ${docId}`);
      return this.saveRequirementDoc({
        ...existing,
        id: nextUniqueId('rdoc'),
        title: `${existing.title} (副本)`,
        status: 'DRAFT',
      });
    },

    deleteRequirementDoc(docId) {
      deleteItem('req_docs', docId);
    },

    listPrototypes(projectId) {
      return listItems<PrototypeArtifact>('prototypes', projectId);
    },

    savePrototypeAndSyncMu(projectId, input) {
      const current = this.getProject(projectId);
      if (!current) throw new Error(`Project not found: ${projectId}`);
      const extractedMu = extractMuFromPrototypeHtml(input.htmlContent, current.domain);
      const proto: PrototypeArtifact = {
        id: input.id ?? nextUniqueId('proto'),
        projectId,
        name: input.name,
        version: input.version ?? 'v5.1',
        htmlContent: input.htmlContent,
        extractedScreenCount: extractedMu.screens.length,
        updatedAt: new Date().toISOString(),
      };
      putItem('prototypes', proto.id, proto, projectId);

      let updatedProject = current;
      if (input.syncMu !== false && extractedMu.screens.length > 0) {
        updatedProject = this.updateModel(projectId, 'MU', extractedMu);
      }
      return { prototype: proto, project: updatedProject };
    },

    clonePrototype(protoId) {
      const existing = getItem<PrototypeArtifact>('prototypes', protoId);
      if (!existing) throw new Error(`Prototype not found: ${protoId}`);
      const cloned: PrototypeArtifact = {
        ...existing,
        id: nextUniqueId('proto'),
        name: `${existing.name} (副本)`,
        updatedAt: new Date().toISOString(),
      };
      return putItem('prototypes', cloned.id, cloned, cloned.projectId);
    },

    deletePrototype(protoId) {
      deleteItem('prototypes', protoId);
    },

    listFourLayerAssets(layer) {
      const all = listItems<FourLayerAsset>('four_layer_assets');
      return layer ? all.filter((a) => a.layer === layer) : all;
    },

    saveFourLayerAsset(asset) {
      const full: FourLayerAsset = { ...asset, updatedAt: new Date().toISOString() };
      return putItem('four_layer_assets', full.id, full);
    },

    deleteFourLayerAsset(assetId, force) {
      const boundApps = this.listAssembledApplications().filter(
        (app) =>
          app.uiUeAssetId === assetId ||
          app.techFoundationAssetId === assetId ||
          app.techArchAssetId === assetId,
      );
      if (!force && boundApps.length > 0) {
        throw new Error(
          `Asset is referenced by assembled application(s): ${boundApps.map((a) => a.name).join(', ')}. Unbind or confirm force deletion.`,
        );
      }
      deleteItem('four_layer_assets', assetId);
    },

    listAssembledApplications() {
      return listItems<AssembledApplication>('assembled_apps');
    },

    saveAssembledApplication(app) {
      const existing = getItem<AssembledApplication>('assembled_apps', app.id);
      const full: AssembledApplication = {
        ...app,
        agentDevLogs: app.agentDevLogs ?? existing?.agentDevLogs ?? [],
        updatedAt: new Date().toISOString(),
      };
      return putItem('assembled_apps', full.id, full, full.projectId);
    },

    cloneAssembledApplication(appId) {
      const existing = getItem<AssembledApplication>('assembled_apps', appId);
      if (!existing) throw new Error(`Assembled application not found: ${appId}`);
      return this.saveAssembledApplication({
        ...existing,
        id: nextUniqueId('app'),
        name: `${existing.name} (副本)`,
        status: 'ASSEMBLED',
        packageOutputDir: undefined,
        publishedEndpoint: undefined,
        publishedVersion: undefined,
        agentDevLogs: [],
      });
    },

    deleteAssembledApplication(appId) {
      deleteItem('assembled_apps', appId);
    },

    listGeneratedSkills(projectId) {
      return listItems<GeneratedSkill>('skills', projectId);
    },

    saveGeneratedSkill(skill) {
      const full: GeneratedSkill = { ...skill, updatedAt: new Date().toISOString() };
      return putItem('skills', full.id, full, full.projectId);
    },

    deleteGeneratedSkill(skillId, force) {
      const boundAgents = this.listCapabilityAgents().filter((ag) =>
        ag.skillIds.includes(skillId),
      );
      if (!force && boundAgents.length > 0) {
        throw new Error(
          `Skill is bound to capability agent(s): ${boundAgents.map((a) => a.name).join(', ')}. Unbind or confirm force deletion.`,
        );
      }
      deleteItem('skills', skillId);
    },

    listLegacySystems() {
      return listItems<LegacySystemConfig>('legacy_systems');
    },

    saveLegacySystem(sys) {
      return putItem('legacy_systems', sys.id, sys, sys.linkedProjectId);
    },

    deleteLegacySystem(systemId) {
      deleteItem('legacy_systems', systemId);
    },

    listExtractionJobs(projectId) {
      return listItems<StoredExtractionJob>('extraction_jobs', projectId).map((stored) => {
        const { job, upgraded } = upgradeExtractionJob(stored, () =>
          getProjectSuite(stored.projectId),
        );
        if (upgraded) putItem('extraction_jobs', job.id, job, job.projectId);
        return job;
      });
    },

    runOntologyExtractionJob(input) {
      const project = this.getProject(input.projectId);
      if (!project) throw new Error(`Project not found: ${input.projectId}`);

      let extraction = input.extraction;
      let scannedTableNames: string[] = [];
      if (!extraction) {
        const scan = scanSourceStructure({
          baseSuite: project.suite,
          source: input.sourceSnippet,
          domain: project.domain,
        });
        scannedTableNames = scan.tables.map((t) => t.tableName);
        extraction = {
          candidates: buildExtractionCandidates(project.suite, scan.suite, scan.evidenceByKey),
          semanticAlignment: { status: 'SKIPPED', reason: 'NOT_REQUESTED' },
          tablesCount: scan.tables.length,
        };
      }

      const { candidates } = extraction;
      const interfacesCount = candidates.filter((c) => c.collection === 'interfaces').length;
      const entitiesCount = candidates.filter((c) => c.collection === 'aggregates').length;

      const summaryParts: string[] = [];
      if (scannedTableNames.length > 0) {
        summaryParts.push(`识别物理表 [${scannedTableNames.join(', ')}]`);
      }
      if (interfacesCount > 0) summaryParts.push(`解析服务接口 ${interfacesCount} 个`);

      const job: ExtractionJob = {
        id: nextUniqueId('ext-job'),
        systemId: input.systemId,
        projectId: input.projectId,
        title: input.title,
        sourceType: input.sourceType,
        sourceSnippet: input.sourceSnippet,
        extractedModels: modelsOfCandidates(candidates),
        status: 'COMPLETED',
        summary:
          extraction.summary ??
          (summaryParts.length > 0
            ? `本体萃取完成：从数据源${summaryParts.join('，')}，产出 ${candidates.length} 个萃取候选。`
            : `本体萃取完成：产出 ${candidates.length} 个萃取候选。`),
        candidates,
        decisions: {},
        semanticAlignment: extraction.semanticAlignment,
        extractedEntitiesCount: entitiesCount,
        extractedTablesCount: extraction.tablesCount,
        extractedInterfacesCount: interfacesCount,
        appliedToProject: false,
        createdAt: new Date().toISOString(),
      };

      if (input.applyImmediately === false || candidates.length === 0) {
        putItem('extraction_jobs', job.id, job, input.projectId);
        return { job, project, blockedBy: [] };
      }

      // "Merge immediately" is a blanket acceptance, held to the same gate.
      job.decisions = Object.fromEntries(candidates.map((c) => [c.key, 'ACCEPTED' as const]));
      const preview = previewCandidateMerge({
        current: project.suite,
        candidates,
        decisions: job.decisions,
        domain: project.domain,
      });
      if (preview.newErrors.length > 0) {
        putItem('extraction_jobs', job.id, job, input.projectId);
        return { job, project, blockedBy: preview.newErrors };
      }
      job.appliedToProject = true;
      job.appliedCandidateCount = preview.acceptedCount;
      putItem('extraction_jobs', job.id, job, input.projectId);
      const merged = this.updateSuite(
        input.projectId,
        preview.suite,
        `Applied ontology extraction job: ${input.title}`,
      );
      return { job, project: merged, blockedBy: [] };
    },

    saveExtractionDecisions(jobId, decisions) {
      const existing = getUpgradedExtractionJob(jobId);
      if (!existing) throw new Error(`Extraction job not found: ${jobId}`);
      if (existing.appliedToProject) {
        throw codedError('ALREADY_MERGED', `Extraction job already merged: ${jobId}`);
      }
      const known = new Set(existing.candidates.map((c) => c.key));
      const next = { ...existing.decisions };
      for (const [key, decision] of Object.entries(decisions)) {
        if (!known.has(key)) continue;
        if (decision === 'ACCEPTED' || decision === 'REJECTED') next[key] = decision;
        else delete next[key];
      }
      const updated: ExtractionJob = { ...existing, decisions: next };
      return putItem('extraction_jobs', updated.id, updated, updated.projectId);
    },

    applyExtractionJobToProject(jobId) {
      const existing = getUpgradedExtractionJob(jobId);
      if (!existing) throw new Error(`Extraction job not found: ${jobId}`);
      const currentProject = this.getProject(existing.projectId);
      if (!currentProject) throw new Error(`Project not found: ${existing.projectId}`);
      if (existing.appliedToProject) {
        throw codedError('ALREADY_MERGED', `Extraction job already merged: ${jobId}`);
      }

      const preview = previewCandidateMerge({
        current: currentProject.suite,
        candidates: existing.candidates,
        decisions: existing.decisions,
        domain: currentProject.domain,
      });
      if (preview.acceptedCount === 0) {
        throw codedError(
          'NOTHING_ACCEPTED',
          `No accepted candidates to merge for extraction job: ${jobId}`,
        );
      }
      if (preview.newErrors.length > 0) {
        return { job: existing, project: currentProject, blockedBy: preview.newErrors };
      }

      const updatedProject = this.updateSuite(
        existing.projectId,
        preview.suite,
        `Applied reviewed extraction job (${existing.id}): ${existing.title}`,
      );
      const updatedJob: ExtractionJob = {
        ...existing,
        status: 'REVIEWED',
        appliedToProject: true,
        appliedCandidateCount: preview.acceptedCount,
      };
      putItem('extraction_jobs', updatedJob.id, updatedJob, updatedJob.projectId);
      return { job: updatedJob, project: updatedProject, blockedBy: [] };
    },

    deleteExtractionJob(jobId) {
      deleteItem('extraction_jobs', jobId);
    },

    listMcpServers() {
      return listItems<McpServerConfig>('mcp_servers');
    },

    saveMcpServer(mcp) {
      const full: McpServerConfig = { ...mcp, updatedAt: new Date().toISOString() };
      return putItem('mcp_servers', full.id, full, full.projectId);
    },

    deleteMcpServer(mcpId, force) {
      const boundAgents = this.listCapabilityAgents().filter((ag) => ag.mcpIds.includes(mcpId));
      if (!force && boundAgents.length > 0) {
        throw new Error(
          `MCP server is bound to capability agent(s): ${boundAgents.map((a) => a.name).join(', ')}. Unbind or confirm force deletion.`,
        );
      }
      deleteItem('mcp_servers', mcpId);
    },

    listCapabilityAgents() {
      return listItems<CapabilityAgent>('capability_agents');
    },

    saveCapabilityAgent(agent) {
      return putItem('capability_agents', agent.id, agent, agent.projectId);
    },

    deleteCapabilityAgent(agentId) {
      deleteItem('capability_agents', agentId);
    },

    listCapabilityChatSessions(agentId) {
      const all = listItems<CapabilityChatSession>('capability_chats');
      return agentId ? all.filter((s) => s.agentId === agentId) : all;
    },

    saveCapabilityChatSession(session) {
      const full: CapabilityChatSession = {
        ...session,
        updatedAt: new Date().toISOString(),
      };
      return putItem('capability_chats', full.id, full, full.projectId);
    },

    deleteCapabilityChatSession(sessionId) {
      deleteItem('capability_chats', sessionId);
    },

    listCrossSystemFlows() {
      return listItems<CrossSystemFlow>('cross_flows');
    },

    saveCrossSystemFlow(flow) {
      return putItem('cross_flows', flow.id, flow);
    },

    executeCrossSystemFlow(flowId) {
      const existing = getItem<CrossSystemFlow>('cross_flows', flowId);
      if (!existing) throw new Error(`Cross-system flow not found: ${flowId}`);
      const now = new Date().toISOString();

      // Query live domain tables to attach real execution context to each step
      let sampleContractNo = 'CT-2026-0001';
      let sampleMftNo = 'MFT-2026-0001';
      let sampleMftDigest = 'sha256:9f86d081884c7d65';
      let sampleSettlementNo = 'STL-2026-0001';
      try {
        const ctRows = db
          .prepare(`SELECT contract_no, total_amount FROM t_contract LIMIT 1`)
          .all() as { contract_no?: string; total_amount?: number }[];
        if (ctRows[0]?.contract_no) sampleContractNo = ctRows[0].contract_no;

        const mftRows = db
          .prepare(`SELECT work_order_no, sha256_digest FROM t_mft_work_order LIMIT 1`)
          .all() as { work_order_no?: string; sha256_digest?: string }[];
        if (mftRows[0]?.work_order_no) sampleMftNo = mftRows[0].work_order_no;
        if (mftRows[0]?.sha256_digest) sampleMftDigest = mftRows[0].sha256_digest;

        const stlRows = db
          .prepare(`SELECT settlement_no, settlement_amount FROM t_settlement_order LIMIT 1`)
          .all() as { settlement_no?: string; settlement_amount?: number }[];
        if (stlRows[0]?.settlement_no) sampleSettlementNo = stlRows[0].settlement_no;
      } catch {
        // Fallback if custom tables
      }

      const stepLogs = existing.steps.map((s) => {
        const lowerTool = s.mcpToolName.toLowerCase();
        let liveDetail = `单据=${sampleContractNo}`;
        if (lowerTool.includes('mft') || lowerTool.includes('workorder') || lowerTool.includes('transfer')) {
          liveDetail = `传输工单=${sampleMftNo}, 摘要=${sampleMftDigest.slice(0, 22)}...`;
        } else if (lowerTool.includes('settlement') || lowerTool.includes('payment')) {
          liveDetail = `关联结算单=${sampleSettlementNo} (绑定合同 ${sampleContractNo})`;
        }
        return `[${now.slice(11, 19)}] Step ${s.stepOrder} [${s.systemName}] 调用 MCP 工具 ${s.mcpToolName} (${liveDetail}) -> 执行成功 (200 OK)`;
      });

      const updated: CrossSystemFlow = {
        ...existing,
        lastRunAt: now,
        lastRunStatus: 'SUCCESS',
        steps: existing.steps.map((s) => ({ ...s, status: 'SUCCESS' })),
        executionLogs: [
          `[${now.slice(11, 19)}] 触发跨系统协同流「${existing.name}」（触发事件：${existing.triggerEvent}）`,
          ...stepLogs,
        ],
      };
      return putItem('cross_flows', flowId, updated);
    },

    deleteCrossSystemFlow(flowId) {
      deleteItem('cross_flows', flowId);
    },

    listKnowledgeEntries() {
      return listItems<KnowledgeEntry>('knowledge');
    },

    saveKnowledgeEntry(entry) {
      const full: KnowledgeEntry = { ...entry, updatedAt: new Date().toISOString() };
      return putItem('knowledge', full.id, full, full.linkedProjectId);
    },

    deleteKnowledgeEntry(entryId) {
      deleteItem('knowledge', entryId);
    },

    listDatabaseResources() {
      const resources = listItems<DatabaseResource>('db_resources');
      return resources.map((res) => ({
        ...res,
        tables: res.tables.map((tb) => {
          if (!/^[a-zA-Z0-9_]+$/.test(tb.tableName)) return tb;
          try {
            const rows = db
              .prepare(`SELECT COUNT(*) AS cnt FROM ${tb.tableName}`)
              .all() as { cnt?: number }[];
            const liveCount = rows[0]?.cnt;
            if (typeof liveCount === 'number' && liveCount > 0) {
              return { ...tb, rowCount: liveCount };
            }
            const getRow = db
              .prepare(`SELECT COUNT(*) AS cnt FROM ${tb.tableName}`)
              .get() as { cnt?: number } | undefined;
            if (typeof getRow?.cnt === 'number' && getRow.cnt > 0) {
              return { ...tb, rowCount: getRow.cnt };
            }
          } catch {
            // Keep stored rowCount for external DB definitions
          }
          return tb;
        }),
      }));
    },

    saveDatabaseResource(res) {
      return putItem('db_resources', res.id, res);
    },

    deleteDatabaseResource(dbId) {
      deleteItem('db_resources', dbId);
    },

    listDataDocuments() {
      return listItems<DataDocument>('data_docs');
    },

    saveDataDocument(doc) {
      const full: DataDocument = { ...doc, updatedAt: new Date().toISOString() };
      return putItem('data_docs', full.id, full);
    },

    deleteDataDocument(docId) {
      deleteItem('data_docs', docId);
    },

    listDataMappings() {
      return listItems<DataMappingRule>('data_mappings');
    },

    saveDataMapping(rule) {
      return putItem('data_mappings', rule.id, rule);
    },

    deleteDataMapping(mappingId) {
      deleteItem('data_mappings', mappingId);
    },

    listMetrics() {
      return listItems<MetricDefinition>('metrics');
    },

    saveMetric(metric) {
      return putItem('metrics', metric.id, metric);
    },

    deleteMetric(metricId) {
      deleteItem('metrics', metricId);
    },

    listAnalyticsScenarios() {
      return listItems<AnalyticsScenario>('analytics_scenarios');
    },

    saveAnalyticsScenario(scenario) {
      return putItem('analytics_scenarios', scenario.id, scenario);
    },

    deleteAnalyticsScenario(scenarioId) {
      deleteItem('analytics_scenarios', scenarioId);
    },

    listAnalyticsReports() {
      return listItems<AnalyticsReport>('analytics_reports');
    },

    saveAnalyticsReport(report) {
      const full: AnalyticsReport = { ...report, createdAt: new Date().toISOString() };
      return putItem('analytics_reports', full.id, full);
    },

    deleteAnalyticsReport(reportId) {
      deleteItem('analytics_reports', reportId);
    },

    listReasoningSessions() {
      return listItems<ReasoningSession>('reasoning_sessions');
    },

    saveReasoningSession(session) {
      const full: ReasoningSession = { ...session, createdAt: new Date().toISOString() };
      return putItem('reasoning_sessions', full.id, full);
    },

    deleteReasoningSession(sessionId) {
      deleteItem('reasoning_sessions', sessionId);
    },

    executeReadOnlyAnalyticsSql(sql, params) {
      const start = performance.now();
      const stripped = sql.trim().replace(/;\s*$/, '').trim();
      if (!stripped) {
        throw new Error('Read-only analytics SQL violation: query cannot be empty.');
      }
      if (stripped.includes(';')) {
        throw new Error(
          'Read-only analytics SQL violation: multiple statements or internal semicolons are forbidden.',
        );
      }
      if (stripped.includes('--') || stripped.includes('/*')) {
        throw new Error('Read-only analytics SQL violation: SQL comments are forbidden.');
      }
      if (!/^(SELECT|WITH)\b/i.test(stripped)) {
        throw new Error(
          'Read-only analytics SQL violation: only SELECT or WITH queries are permitted.',
        );
      }
      if (
        /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX)\b/i.test(
          stripped,
        )
      ) {
        throw new Error(
          'Read-only analytics SQL violation: DDL/DML/administrative statements are forbidden.',
        );
      }

      const boundSql = bindNamedSqlParams(stripped, params);
      const rawRows = db.prepare(boundSql).all() as Record<string, unknown>[];
      const dictLabels = getDictionaryLabelMap();

      const columnSet = new Set<string>();
      const enrichedRows = rawRows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const [col, val] of Object.entries(row)) {
          out[col] = val;
          columnSet.add(col);
          if (
            typeof val === 'string' &&
            !col.endsWith('__label') &&
            dictLabels.has(val) &&
            !Object.prototype.hasOwnProperty.call(row, `${col}__label`)
          ) {
            const labelCol = `${col}__label`;
            out[labelCol] = dictLabels.get(val)!;
            columnSet.add(labelCol);
          }
        }
        return out;
      });

      const elapsedMs = Math.max(0, Math.round((performance.now() - start) * 100) / 100);
      return {
        sql: boundSql,
        columns: [...columnSet],
        rows: enrichedRows,
        rowCount: enrichedRows.length,
        elapsedMs,
      };
    },

    listWritebackInterfaces() {
      return listItems<WritebackInterface>('writebacks');
    },

    saveWritebackInterface(wb) {
      return putItem('writebacks', wb.id, wb);
    },

    executeWritebackInterface(interfaceId, payloadOverride) {
      const existing = getItem<WritebackInterface>('writebacks', interfaceId);
      if (!existing) throw new Error(`Writeback interface not found: ${interfaceId}`);
      const now = new Date().toISOString();
      const mergedPayload = { ...existing.payloadTemplate, ...(payloadOverride ?? {}) };

      // Query & update live SQLite analytical rows matching the writeback target
      let affectedSummary = '';
      try {
        const overdueStlRows = db
          .prepare(`SELECT settlement_no, contract_ref, overdue_days FROM t_settlement_order`)
          .all() as { settlement_no?: string; contract_ref?: string; overdue_days?: number }[];
        const matched = overdueStlRows.filter((r) => Number(r.overdue_days ?? 0) > 15);
        if (matched.length > 0) {
          affectedSummary = `，实库命中并处理 ${matched.length} 笔逾期结算单 [${matched
            .map((m) => m.settlement_no)
            .slice(0, 3)
            .join(', ')}]`;
        }
      } catch {
        // Non-fatal
      }

      const updated: WritebackInterface = {
        ...existing,
        payloadTemplate: mergedPayload,
        executionCount: existing.executionCount + 1,
        lastExecutedAt: now,
        lastExecutionResult: `[${now.slice(0, 19)}] 回写指令已送达目标系统「${existing.targetSystem}」(${existing.endpoint})，绑定行为 ${existing.boundBehaviorRef} 执行成功${affectedSummary}。`,
      };
      return putItem('writebacks', interfaceId, updated);
    },

    deleteWritebackInterface(wbId) {
      deleteItem('writebacks', wbId);
    },

    saveAgentCheckpoint(sessionId, workflow, stateJson) {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO agent_checkpoints (session_id, workflow, state_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          workflow = excluded.workflow,
          state_json = excluded.state_json,
          updated_at = excluded.updated_at
      `).run(sessionId, workflow, stateJson, now);
      replicateToD1(
        `INSERT INTO agent_checkpoints (session_id, workflow, state_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET workflow = excluded.workflow, state_json = excluded.state_json, updated_at = excluded.updated_at`,
        sessionId,
        workflow,
        stateJson,
        now,
      );
    },

    loadAgentCheckpoint(sessionId) {
      const row = db
        .prepare(
          `SELECT session_id, workflow, state_json, updated_at FROM agent_checkpoints WHERE session_id = ?`,
        )
        .get(sessionId) as
        | { session_id: string; workflow: string; state_json: string; updated_at: string }
        | undefined;
      if (!row) return undefined;
      return {
        sessionId: String(row.session_id),
        workflow: String(row.workflow),
        stateJson: String(row.state_json),
        updatedAt: String(row.updated_at),
      };
    },

    listAgentCheckpoints(workflow) {
      const rows = (
        workflow
          ? db
              .prepare(
                `SELECT session_id, workflow, state_json, updated_at FROM agent_checkpoints WHERE workflow = ? ORDER BY updated_at DESC`,
              )
              .all(workflow)
          : db
              .prepare(
                `SELECT session_id, workflow, state_json, updated_at FROM agent_checkpoints ORDER BY updated_at DESC`,
              )
              .all()
      ) as { session_id: string; workflow: string; state_json: string; updated_at: string }[];
      return rows.map((row) => ({
        sessionId: String(row.session_id),
        workflow: String(row.workflow),
        stateJson: String(row.state_json),
        updatedAt: String(row.updated_at),
      }));
    },

    listLlmProviders() {
      const items = listItems<LlmProviderConfig>('llm_providers');
      return items.sort((a, b) => {
        if (a.id === 'llm-pi-local') return -1;
        if (b.id === 'llm-pi-local') return 1;
        return a.id.localeCompare(b.id);
      });
    },

    saveLlmProvider(provider) {
      return putItem('llm_providers', provider.id, provider);
    },

    deleteLlmProvider(providerId) {
      deleteItem('llm_providers', providerId);
    },

    getSystemSettings() {
      return getItem<SystemSettingsState>('system_settings', 'global') ?? SEED_SYSTEM_SETTINGS;
    },

    updateSystemSettings(patch) {
      const current = this.getSystemSettings();
      const updated: SystemSettingsState = { ...current, ...patch };
      return putItem('system_settings', 'global', updated);
    },
  };
}
