import type { KnowledgeClaim, ProvenanceRecord } from '../../data-management/index.js';
import fs from 'node:fs';
import nodeModule from 'node:module';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { createArchitectureAssetCatalog } from '../../architecture-assets/index.js';
import {
  isReservedIdentifierPrefix,
  type ProjectStepId,
  type ProjectStepStateId,
} from '../../business-vocabulary/index.js';
import {
  CONTRACT_LIFECYCLE_SUITE,
  MFT_ENTERPRISE_SUITE,
  MODEL_CODES,
  MODEL_FILE_NAMES,
  OntologySuiteSchema,
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
  type ValidationDiagnostic,
} from '../../ontology-core/index.js';
import { BOOTSTRAP_SQLITE_DDL } from './schema.js';
import {
  deleteModelCallsByRunIds,
  deleteSessionContextSnapshots,
  getContextEvent,
  getModelCall,
  listContextEvents,
  listModelCalls,
  recordContextEvent,
  recordModelCall,
  type ContextSnapshotStorage,
} from './context-snapshots.js';
import { sanitizeInspoCacheEntry, type InspoCacheEntry } from './inspo-cache.js';
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
  SEED_STEP_CONFIRMATIONS,
  SEED_SYSTEM_SETTINGS,
  SEED_WRITEBACK_INTERFACES,
} from './seed-data.js';
import {
  BusinessModelConfirmError,
  RequirementsConfirmError,
  computeOntologySuiteHash,
  computeStepContentHash,
  isPackageSnapshotOutdatedForApp,
  listPresentModelCodes,
  normalizeBusinessModelConfirmation,
  normalizeStepMarkdown,
  resolveCurrentStepConfirmations,
} from './step-confirmations.js';
import {
  SuiteValidationRejectedError,
  doesProviderSupportVision,
  resolveCurrentProjectStep,
  type AgentCheckpointRecord,
  type AgentImageAttachmentRef,
  type AgentImageAttachmentRole,
  type AgentSession,
  type AgentSessionMessage,
  type AnalyticsQueryResult,
  AnalyticsReport,
  AnalyticsScenario,
  ArtifactHistoryEntry,
  ArtifactHistoryEntryView,
  ArtifactHistorySource,
  ArtifactHistorySurfaceKind,
  AssembledApplication,
  BusinessModelStepConfirmationRecord,
  CapabilityAgent,
  CapabilityChatSession,
  CommitSuiteOptions,
  ConfirmableProjectStepId,
  ConfirmedPrototypeRevisionRecord,
  CrossSystemFlow,
  DataDocument,
  DataMappingRule,
  DatabaseResource,
  DesignBrief,
  DevelopmentPackageSnapshot,
  ActionInvocationRecord,
  BenchmarkReportRecord,
  BuildRunRecord,
  ChangeProposalRecord,
  DataSourceRecord,
  RuntimeEventReceipt,
  RuntimeTaskRecord,
  ConnectedAppRecord,
  ExtractionJob,
  FourLayerAsset,
  GeneratedSkill,
  InteractivePrototype,
  KnowledgeEntry,
  LegacySystemConfig,
  LlmProviderConfig,
  McpServerConfig,
  MetricDefinition,
  OntologySuiteHistoryEntry,
  PersistedArtifactHistoryKind,
  ProjectDetail,
  ProjectSnapshot,
  ProjectStepConfirmations,
  ProjectSummary,
  PrototypeArtifact,
  PrototypeStepConfirmationRecord,
  ReasoningSession,
  RequirementDoc,
  RequirementDocHistoryState,
  RequirementSession,
  RequirementsDocHistoryEntry,
  RequirementsStepConfirmationRecord,
  StepConfirmationRecord,
  SuiteCommitEvent,
  SystemSettingsState,
  WorkspaceStore,
  WritebackInterface,
} from './types.js';
import {
  ArtifactHistoryConflictError,
  ArtifactHistoryNotFoundError,
  DEFAULT_MAX_ARTIFACT_HISTORY_ENTRIES,
  areOntologySuitesEqual,
  areRequirementDocStatesEqual,
  buildArtifactHistoryViews,
  buildPrototypeArtifactHistoryViews,
  captureRequirementDocState,
  isInitialGeneratedPrototypeRevision,
  isPreExistingPrototypeBaselineRevision,
} from './artifact-history.js';
import {
  PrototypeConfirmedDeleteError,
  applyPrototypeRunReason,
  applyRevisionMetadataPatch,
  buildStoredPrototypeOnAppend,
  buildStoredPrototypeOnCreate,
  buildStoredPrototypeOnRestore,
  hydrateConfirmedPrototypeRevision,
  hydrateInteractivePrototype,
  isLegacyStoredPrototype,
  upgradeLegacyPrototype,
  type AnyStoredPrototype,
  type StoredInteractivePrototype,
} from './prototype-revisions.js';

export interface D1PreparedStatementBinding {
  bind(...values: unknown[]): D1PreparedStatementBinding;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface D1DatabaseBinding {
  prepare(query: string): D1PreparedStatementBinding;
  exec(query: string): Promise<unknown>;
  batch?(statements: D1PreparedStatementBinding[]): Promise<unknown>;
}

export interface WorkspaceStoreOptions {
  dbPath?: string;
  workspaceRoot?: string;
  enableFileMirror?: boolean;
  /** Set false to initialize a clean first-use workspace with zero seeded demo projects. */
  seedProjects?: boolean;
  d1Database?: D1DatabaseBinding;
  /** Alternate source root, primarily for isolated tests. A new directory receives the bundled catalog. */
  architectureAssetsRoot?: string;
  architectureAssetsWritable?: boolean;
  /** Invoked synchronously whenever an existing project's OntologySuite is committed. */
  onSuiteCommit?: (event: SuiteCommitEvent) => void;
  /** Maximum retained linear history entries per `(projectId, artifactKind)` (defaults to 50). */
  maxHistoryEntries?: number;
  /** Model Calls per session that keep their full Context Snapshot (defaults to 200, ADR 0017). */
  maxFullModelCallsPerSession?: number;
}

interface SqliteStatementLike {
  run: (...params: unknown[]) => unknown;
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
}

interface SqliteDbLike {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatementLike;
  close?: () => void;
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
  const entitySavepoints: { name: string; entities: typeof entitiesMap }[] = [];
  const checkpointsMap = new Map<string, AgentCheckpointRecord>();
  const eaRelationsMap = new Map<string, Record<string, unknown>[]>();
  const analyticalTables = new Map<string, Map<string, Record<string, unknown>>>();
  for (const tbl of Object.keys(ANALYTICAL_TABLE_COLUMNS)) {
    analyticalTables.set(tbl, new Map());
  }

  return {
    exec(sql) {
      const normalized = sql.trim().replace(/\s+/g, ' ');
      const begin = /^SAVEPOINT (\w+)$/i.exec(normalized);
      if (begin) {
        entitySavepoints.push({ name: begin[1], entities: new Map(entitiesMap) });
        return;
      }
      const rollback = /^ROLLBACK TO SAVEPOINT (\w+)$/i.exec(normalized);
      const release = /^RELEASE SAVEPOINT (\w+)$/i.exec(normalized);
      const name = rollback?.[1] ?? release?.[1];
      if (!name) return;
      const index = entitySavepoints.findLastIndex((entry) => entry.name === name);
      if (index < 0) throw new Error(`Unknown workspace savepoint: ${name}`);
      if (rollback) {
        entitiesMap.clear();
        for (const [key, value] of entitySavepoints[index].entities) entitiesMap.set(key, value);
        entitySavepoints.splice(index + 1);
      } else {
        entitySavepoints.splice(index);
      }
    },
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
                .reverse()
                .filter(([k, v]) => k.startsWith(`${col}::`) && v.project_id === String(pid))
                .sort((a, b) => b[1].updated_at.localeCompare(a[1].updated_at))
                .map(([, v]) => ({ payload_json: v.payload_json }));
            }
            const [col] = params;
            return [...entitiesMap.entries()]
              .reverse()
              .filter(([k]) => k.startsWith(`${col}::`))
              .sort((a, b) => b[1].updated_at.localeCompare(a[1].updated_at))
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
    const req = nodeModule.createRequire(import.meta.url);
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

const CODE_STOP_WORDS = new Set([
  'A',
  'AN',
  'AND',
  'APP',
  'APPLICATION',
  'BUILD',
  'CREATE',
  'DESIGN',
  'DEVELOP',
  'FOR',
  'HELP',
  'I',
  'IN',
  'MAKE',
  'ME',
  'NEED',
  'OF',
  'ON',
  'PLEASE',
  'PORTAL',
  'SYSTEM',
  'THE',
  'TO',
  'WANT',
  'WE',
  'WITH',
]);

const CJK_CODE_PREFIX_RULES: readonly [RegExp, string][] = [
  [/合同|法务|签约/, 'CONTRACT'],
  [/供应商|采购|询价|准入/, 'SUPPLIER'],
  [/报销|费用|发票|财务|预算/, 'EXPENSE'],
  [/售后|工单|报修|客服/, 'SERVICE'],
  [/库存|仓储|出入库|盘点/, 'INVENTORY'],
  [/订单|销售|客户|线索/, 'ORDER'],
  [/员工|考勤|招聘|人事/, 'PEOPLE'],
];

function deriveProjectNameFromDescription(description: string): string {
  const collapsed = description.trim().replace(/\s+/g, ' ');
  const firstClause =
    collapsed.split(/[：:，,。；;！!？?\n]|\.\s+/)[0]?.replace(/\.+$/, '').trim() || collapsed;

  let cleaned = firstClause
    .replace(
      /^(?:我想|我要|帮我|请帮我|我们需要|我们想|想|要)?(?:做一个|做一套|做个|搭建一个|搭建一套|搭建|开发一个|开发一套|开发|设计一个|设计一套|设计|建立一个|建立)\s*/,
      '',
    )
    .replace(
      /^(?:(?:i|we)\s+(?:want|need|would\s+like)\s+to\s+|help\s+(?:me|us)\s+|please\s+)?(?:build|create|design|make|develop)\s+(?:a|an|the)\s+/i,
      '',
    )
    .trim();

  if (cleaned.length < 2) {
    cleaned = firstClause || collapsed;
  }

  if (/^[a-z]/.test(cleaned)) {
    cleaned = `${cleaned[0]!.toUpperCase()}${cleaned.slice(1)}`;
  }

  const hasCjk = /[\u4e00-\u9fff]/.test(cleaned);
  const maxLen = hasCjk ? 24 : 36;
  if (cleaned.length <= maxLen) return cleaned;
  if (!hasCjk) {
    const cut = cleaned.slice(0, maxLen);
    const lastSpace = cut.lastIndexOf(' ');
    if (lastSpace >= 12) return cut.slice(0, lastSpace).trim();
  }
  return cleaned.slice(0, maxLen).trim();
}

function deriveUniqueProjectCode(
  sourceText: string,
  existingCodes: ReadonlySet<string>,
): string {
  const asciiTokens = (sourceText.toUpperCase().match(/[A-Z0-9]{2,}/g) ?? [])
    .filter((tok) => !CODE_STOP_WORDS.has(tok) && !isReservedIdentifierPrefix(tok))
    .slice(0, 2);

  let basePrefix = asciiTokens.length > 0 ? asciiTokens.join('-').slice(0, 18) : '';
  if (!basePrefix) {
    const matched = CJK_CODE_PREFIX_RULES.find(([re]) => re.test(sourceText));
    basePrefix = matched ? matched[1] : 'PROJ';
  }
  basePrefix = basePrefix.replace(/-+$/, '') || 'PROJ';

  if (asciiTokens.length >= 2 && !existingCodes.has(basePrefix)) {
    return basePrefix;
  }

  let n = 1;
  while (n < 10_000) {
    const suffix = String(n).padStart(2, '0');
    const candidate = `${basePrefix}-${suffix}`;
    if (!existingCodes.has(candidate)) {
      return candidate;
    }
    n += 1;
  }
  return `${basePrefix}-${Date.now().toString(36).toUpperCase()}`;
}

export function createWorkspaceStore(options: WorkspaceStoreOptions = {}): WorkspaceStore {
  const envWorkspaceRoot =
    typeof process !== 'undefined' ? process.env.ONTOLOGY_WORKSPACE_ROOT?.trim() : undefined;
  const envDbPath =
    typeof process !== 'undefined' ? process.env.ONTOLOGY_DB_PATH?.trim() : undefined;
  const workspaceRoot =
    options.workspaceRoot ??
    (envWorkspaceRoot ? path.resolve(envWorkspaceRoot) : path.resolve(process.cwd(), '.onto-cs'));
  const enableFileMirror = options.enableFileMirror ?? true;
  const dbPath =
    options.dbPath ??
    (envDbPath
      ? envDbPath === ':memory:'
        ? ':memory:'
        : path.resolve(envDbPath)
      : path.join(workspaceRoot, 'onto-cs.db'));
  const d1Database = options.d1Database;
  const envArchitectureAssetsRoot = typeof process !== 'undefined'
    ? process.env.ONTOLOGY_ARCHITECTURE_ASSETS_ROOT?.trim() : undefined;
  const architectureAssetsRoot = options.architectureAssetsRoot ??
    (envArchitectureAssetsRoot ? path.resolve(envArchitectureAssetsRoot) : undefined) ??
    (dbPath === ':memory:' && options.architectureAssetsWritable !== false
      ? path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ontology-standards-')), 'catalog')
      : undefined);
  const architectureCatalog = createArchitectureAssetCatalog({
    rootDirectory: architectureAssetsRoot,
    writable: options.architectureAssetsWritable,
  });
  const bundledAssetIds = new Set([
    ...architectureCatalog.listAssets().map((asset) => asset.id),
    ...architectureCatalog.listTechnologyProfiles().flatMap((profile) => profile.compatibleAssetIds),
  ]);

  if (dbPath !== ':memory:') {
    try {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    } catch {
      // Non-fatal in read-only edge runtimes
    }
  }

  const db = openSqliteOrMemoryDb(dbPath);
  let closed = false;
  db.exec(BOOTSTRAP_SQLITE_DDL);
  let d1MutationBatch: { query: string; values: unknown[] }[] | undefined;

  function replicateToD1(query: string, ...values: unknown[]): void {
    if (!d1Database) return;
    if (d1MutationBatch) {
      d1MutationBatch.push({ query, values });
      return;
    }
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

  function replicateCommittedBatch(mutations: { query: string; values: unknown[] }[]): void {
    if (!d1Database || mutations.length === 0) return;
    if (d1MutationBatch) {
      d1MutationBatch.push(...mutations);
      return;
    }
    try {
      if (d1Database.batch) {
        void d1Database.batch(mutations.map(({ query, values }) => d1Database.prepare(query).bind(...values)))
          .catch(() => undefined);
      } else {
        for (const { query, values } of mutations) replicateToD1(query, ...values);
      }
    } catch {
      // Local persistence remains authoritative when the optional D1 mirror is unavailable.
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

  function putItem<T>(
    collection: string,
    itemId: string,
    payload: T,
    projectId?: string,
    updatedAtOverride?: string,
  ): T {
    const now = updatedAtOverride ?? new Date().toISOString();
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
        `SELECT payload_json FROM workspace_entities WHERE collection = ? AND project_id = ? ORDER BY updated_at DESC, rowid DESC`,
      );
      const rows = stmt.all(collection, projectId) as { payload_json: string }[];
      return rows.map((r) => JSON.parse(r.payload_json) as T);
    }
    const stmt = db.prepare(
      `SELECT payload_json FROM workspace_entities WHERE collection = ? ORDER BY updated_at DESC, rowid DESC`,
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

  // Idempotent seed on first startup (can be disabled via options.seedProjects=false or ONTOLOGY_SEED_PROJECTS=0)
  const envSeedProjects =
    typeof process !== 'undefined' ? process.env.ONTOLOGY_SEED_PROJECTS?.trim().toLowerCase() : undefined;
  const shouldSeedProjects =
    options.seedProjects ?? (envSeedProjects !== '0' && envSeedProjects !== 'false');
  const countRow = db.prepare(`SELECT COUNT(*) AS cnt FROM projects`).get() as { cnt: number };
  if (countRow.cnt === 0 && shouldSeedProjects) {
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
    for (const d of SEED_REQUIREMENT_DOCS) putItem('req_docs', d.id, d, d.projectId, d.updatedAt);
    for (const sc of SEED_STEP_CONFIRMATIONS) {
      putItem('step_confirmations', sc.id, sc, sc.projectId, sc.confirmedAt);
    }
    for (const pr of SEED_PROTOTYPES) {
      const storedSeed: StoredInteractivePrototype = {
        id: pr.id,
        projectId: pr.projectId,
        name: pr.name,
        version: pr.version,
        baseVersion: pr.version,
        ...(pr.designBrief ? { designBrief: pr.designBrief } : {}),
        ...(pr.coDesignSessionId ? { coDesignSessionId: pr.coDesignSessionId } : {}),
        revisions: pr.revisions,
        currentRevisionId: pr.currentRevisionId,
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
      };
      putItem('prototypes', pr.id, storedSeed, pr.projectId);
      if (pr.isConfirmed && pr.confirmedRevisionId) {
        const seedProtoStepConf = SEED_STEP_CONFIRMATIONS.find(
          (sc): sc is PrototypeStepConfirmationRecord =>
            sc.step === 'PROTOTYPE' && sc.projectId === pr.projectId,
        );
        const confirmation: ConfirmedPrototypeRevisionRecord = {
          ...(seedProtoStepConf ? { id: seedProtoStepConf.id } : {}),
          projectId: pr.projectId,
          prototypeId: pr.id,
          revisionId: pr.confirmedRevisionId,
          ...(seedProtoStepConf
            ? { basedOnConfirmationId: seedProtoStepConf.basedOnConfirmationId }
            : {}),
          confirmedAt: pr.updatedAt,
        };
        putItem('prototype_confirmations', pr.projectId, confirmation, pr.projectId, pr.updatedAt);
      }
    }
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
  } else if (countRow.cnt === 0 && !shouldSeedProjects) {
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

  interface ProjectStepContextCollections {
    reqSessionsByProject: Map<string, RequirementSession[]>;
    reqDocsByProject: Map<string, RequirementDoc[]>;
    prototypesByProject: Map<string, StoredInteractivePrototype[]>;
    confirmationsByProject: Map<string, ConfirmedPrototypeRevisionRecord>;
    stepConfirmationsByProject: Map<string, StepConfirmationRecord[]>;
    agentSessionsByProject: Map<string, AgentSession[]>;
    appsByProject: Map<string, AssembledApplication[]>;
    packageSnapshotsById: Map<string, DevelopmentPackageSnapshot>;
    skillsByProject: Map<string, GeneratedSkill[]>;
  }

  function loadProjectStepCollections(singleProjectId?: string): ProjectStepContextCollections {
    const groupByProject = <T extends { projectId: string }>(items: T[]): Map<string, T[]> => {
      const map = new Map<string, T[]>();
      for (const item of items) {
        if (!item?.projectId) continue;
        const list = map.get(item.projectId);
        if (list) list.push(item);
        else map.set(item.projectId, [item]);
      }
      return map;
    };

    const rawProtos = listItems<AnyStoredPrototype>('prototypes', singleProjectId);
    const upgradedProtos: StoredInteractivePrototype[] = rawProtos
      .filter((p): p is AnyStoredPrototype => Boolean(p?.projectId))
      .map((p) => (isLegacyStoredPrototype(p) ? upgradeLegacyPrototype(p) : p));

    const confirmations = listItems<ConfirmedPrototypeRevisionRecord>(
      'prototype_confirmations',
      singleProjectId,
    );
    const confirmationsByProject = new Map<string, ConfirmedPrototypeRevisionRecord>();
    for (const conf of confirmations) {
      if (conf?.projectId && !confirmationsByProject.has(conf.projectId)) {
        confirmationsByProject.set(conf.projectId, conf);
      }
    }

    const packageSnapshotsById = new Map<string, DevelopmentPackageSnapshot>();
    for (const snap of listItems<DevelopmentPackageSnapshot>(
      'development_package_snapshots',
    )) {
      if (snap?.snapshotId && (!singleProjectId || snap.projectId === singleProjectId)) {
        packageSnapshotsById.set(snap.snapshotId, snap);
      }
    }

    return {
      reqSessionsByProject: groupByProject(
        listItems<RequirementSession>('req_sessions', singleProjectId),
      ),
      reqDocsByProject: groupByProject(listItems<RequirementDoc>('req_docs', singleProjectId)),
      prototypesByProject: groupByProject(upgradedProtos),
      confirmationsByProject,
      stepConfirmationsByProject: groupByProject(
        listItems<StepConfirmationRecord>('step_confirmations', singleProjectId),
      ),
      agentSessionsByProject: groupByProject(
        listItems<AgentSession>('agent_sessions', singleProjectId),
      ),
      appsByProject: groupByProject(
        listItems<AssembledApplication>('assembled_apps', singleProjectId),
      ),
      packageSnapshotsById,
      skillsByProject: groupByProject(listItems<GeneratedSkill>('skills', singleProjectId)),
    };
  }

  function deriveProjectStepSummaryFromCollections(
    projectId: string,
    suite: OntologySuite,
    validation: { presentModels: readonly ModelCode[]; errorCount: number },
    collections: ProjectStepContextCollections,
  ): {
    currentStep: ProjectStepId;
    currentStepState: ProjectStepStateId;
    stepStates: Record<ProjectStepId, ProjectStepStateId>;
  } {
    const reqSessions = collections.reqSessionsByProject.get(projectId) ?? [];
    const reqDocs = collections.reqDocsByProject.get(projectId) ?? [];
    const agentSessions = collections.agentSessionsByProject.get(projectId) ?? [];
    const prototypes = collections.prototypesByProject.get(projectId) ?? [];
    const rawProtoConf = collections.confirmationsByProject.get(projectId) ?? null;
    const confirmedProto = rawProtoConf
      ? prototypes.find((p) => p.id === rawProtoConf.prototypeId)
      : undefined;
    const validProtoConf =
      confirmedProto && confirmedProto.revisions.some((rev) => rev.id === rawProtoConf!.revisionId)
        ? rawProtoConf
        : null;
    const stepConfs = resolveCurrentStepConfirmations(
      collections.stepConfirmationsByProject.get(projectId) ?? [],
      validProtoConf ?? undefined,
    );
    const reqConf = stepConfs.requirements;
    const protoConf = stepConfs.prototype;
    const modelConf = stepConfs.businessModel;

    // 1. REQUIREMENTS
    const hasReqAgentWork = agentSessions.some(
      (s) => s.agentKind === 'REQUIREMENT' && (s.messages?.length ?? 0) > 0,
    );
    const hasAnyRequirementWork = reqSessions.length > 0 || hasReqAgentWork || reqDocs.length > 0;
    let requirementsState: ProjectStepStateId;
    if (!reqConf) {
      requirementsState = hasAnyRequirementWork ? 'IN_PROGRESS' : 'NOT_STARTED';
    } else {
      const latestDoc = reqDocs[0];
      const matchedDoc = reqDocs.find((d) => d.id === reqConf.docId);
      const hasNewerDifferentDoc = Boolean(latestDoc && latestDoc.id !== reqConf.docId);
      const contentChanged =
        !matchedDoc ||
        (computeStepContentHash(matchedDoc.content) !== reqConf.contentHash &&
          normalizeStepMarkdown(matchedDoc.content) !== normalizeStepMarkdown(reqConf.content));
      requirementsState =
        hasNewerDifferentDoc || contentChanged ? 'UNCONFIRMED_CHANGES' : 'CONFIRMED';
    }

    // 2. PROTOTYPE
    let prototypeState: ProjectStepStateId;
    if (!protoConf) {
      prototypeState = prototypes.length > 0 ? 'IN_PROGRESS' : 'NOT_STARTED';
    } else if (reqConf && protoConf.basedOnConfirmationId !== reqConf.id) {
      prototypeState = 'OUTDATED';
    } else {
      const protoEntity = prototypes.find((p) => p.id === protoConf.prototypeId);
      const hasUnconfirmedProtoChanges = Boolean(
        protoEntity?.currentRevisionId && protoEntity.currentRevisionId !== protoConf.revisionId,
      );
      prototypeState = hasUnconfirmedProtoChanges ? 'UNCONFIRMED_CHANGES' : 'CONFIRMED';
    }

    // 3. BUSINESS_MODEL
    const hasOntology = validation.presentModels.length > 0;
    let businessModelState: ProjectStepStateId;
    if (!modelConf) {
      businessModelState = hasOntology ? 'IN_PROGRESS' : 'NOT_STARTED';
    } else if (protoConf && modelConf.basedOnConfirmationId !== protoConf.id) {
      businessModelState = 'OUTDATED';
    } else {
      businessModelState =
        computeOntologySuiteHash(suite) !== modelConf.suiteHash
          ? 'UNCONFIRMED_CHANGES'
          : 'CONFIRMED';
    }

    // 4. DELIVERY (#48 Decision #4)
    const projectApps = collections.appsByProject.get(projectId) ?? [];
    const appsWithSnapshot = projectApps.filter((app) => Boolean(app.latestPackageSnapshotId));
    let deliveryState: ProjectStepStateId;
    if (!modelConf) {
      deliveryState = 'NOT_STARTED';
    } else if (appsWithSnapshot.length === 0) {
      deliveryState = 'IN_PROGRESS';
    } else {
      const resolvedEntries = appsWithSnapshot
        .map((app) => {
          const snapshot = collections.packageSnapshotsById.get(app.latestPackageSnapshotId!);
          return snapshot ? { app, snapshot } : null;
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .sort((a, b) => b.snapshot.compiledAt.localeCompare(a.snapshot.compiledAt));
      const latestEntry = resolvedEntries[0];
      if (
        latestEntry &&
        isPackageSnapshotOutdatedForApp(latestEntry.snapshot, latestEntry.app, modelConf.id)
      ) {
        deliveryState = 'OUTDATED';
      } else {
        deliveryState = 'CONFIRMED';
      }
    }

    const stepStates: Record<ProjectStepId, ProjectStepStateId> = {
      REQUIREMENTS: requirementsState,
      PROTOTYPE: prototypeState,
      BUSINESS_MODEL: businessModelState,
      DELIVERY: deliveryState,
    };
    const currentStep = resolveCurrentProjectStep(stepStates);

    return {
      currentStep,
      currentStepState: stepStates[currentStep],
      stepStates,
    };
  }

  function hydrateProject(row: Record<string, unknown>): ProjectDetail {
    const id = String(row.id);
    const suite = JSON.parse(String(row.suite_json)) as OntologySuite;
    const validation = validateOntologySuite(suite);
    const knowledgeGraph = buildKnowledgeGraph(suite);
    const stepSummary = deriveProjectStepSummaryFromCollections(
      id,
      suite,
      validation,
      loadProjectStepCollections(id),
    );
    return {
      id,
      name: String(row.name),
      code: String(row.code),
      center: row.center as ProjectSummary['center'],
      domain: String(row.domain),
      description: String(row.description),
      currentStage: Number(row.current_stage),
      ...stepSummary,
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

  function ensurePrototypesMigrated(projectId?: string): void {
    const rawItems = listItems<AnyStoredPrototype>('prototypes', projectId);
    const byProject = new Map<string, AnyStoredPrototype[]>();
    for (const item of rawItems) {
      if (!item || !item.projectId) continue;
      const list = byProject.get(item.projectId) ?? [];
      list.push(item);
      byProject.set(item.projectId, list);
    }

    for (const [projId, items] of byProject.entries()) {
      const hasLegacy = items.some((item) => isLegacyStoredPrototype(item));
      if (!hasLegacy) continue;

      const migratedList: StoredInteractivePrototype[] = items.map((item) => {
        if (!isLegacyStoredPrototype(item)) {
          return item;
        }
        const upgraded = upgradeLegacyPrototype(item);
        putItem('prototypes', upgraded.id, upgraded, upgraded.projectId, upgraded.updatedAt);
        return upgraded;
      });

      const existingConfirmation = getItem<ConfirmedPrototypeRevisionRecord>(
        'prototype_confirmations',
        projId,
      );
      if (!existingConfirmation && migratedList.length > 0) {
        const sortedNewestFirst = [...migratedList].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        );
        const newest = sortedNewestFirst[0]!;
        putItem<ConfirmedPrototypeRevisionRecord>(
          'prototype_confirmations',
          projId,
          {
            projectId: projId,
            prototypeId: newest.id,
            revisionId: newest.currentRevisionId,
            confirmedAt: newest.updatedAt,
          },
          projId,
          newest.updatedAt,
        );
      }
    }
  }

  function getStoredPrototype(prototypeId: string): StoredInteractivePrototype | undefined {
    const raw = getItem<AnyStoredPrototype>('prototypes', prototypeId);
    if (!raw) return undefined;
    if (isLegacyStoredPrototype(raw)) {
      ensurePrototypesMigrated(raw.projectId);
      return getItem<StoredInteractivePrototype>('prototypes', prototypeId);
    }
    return raw;
  }

  ensurePrototypesMigrated();

  let seqCounter = 0;
  function nextUniqueId(prefix: string): string {
    seqCounter += 1;
    return `${prefix}-${Date.now().toString(36)}-${seqCounter.toString(36)}`;
  }

  const contextSnapshotStorage: ContextSnapshotStorage = {
    put(collection, itemId, payload, projectId) {
      putItem(collection, itemId, payload, projectId);
    },
    get: getItem,
    delete: deleteItem,
    listBySession<T>(collection: string, projectId: string, sessionId: string): T[] {
      const rows = db
        .prepare(
          `SELECT payload_json FROM workspace_entities WHERE collection = ? AND project_id = ? AND json_extract(payload_json, '$.sessionId') = ?`,
        )
        .all(collection, projectId, sessionId) as { payload_json: string }[];
      return rows.map((r) => JSON.parse(r.payload_json) as T);
    },
    listByProject: listItems,
    newId: nextUniqueId,
  };

  function getProjectSuite(projectId: string): OntologySuite | undefined {
    const row = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId) as
      | Record<string, unknown>
      | undefined;
    return row ? (JSON.parse(String(row.suite_json)) as OntologySuite) : undefined;
  }

  const maxHistoryEntries = Math.max(
    1,
    options.maxHistoryEntries ?? DEFAULT_MAX_ARTIFACT_HISTORY_ENTRIES,
  );

  type ActiveArtifactRunCapture =
    | {
        projectId: string;
        artifactKind: 'REQUIREMENTS_DOC';
        runId: string;
        sessionId?: string;
        beforeState: RequirementDocHistoryState;
      }
    | {
        projectId: string;
        artifactKind: 'ONTOLOGY_SUITE';
        runId: string;
        sessionId?: string;
        beforeState: OntologySuite;
      };

  const activeRunCaptures = new Map<string, ActiveArtifactRunCapture>();
  let suppressSuiteHistoryDepth = 0;

  function runCaptureKey(
    projectId: string,
    artifactKind: PersistedArtifactHistoryKind,
    runId: string,
  ): string {
    return `${projectId}::${artifactKind}::${runId}`;
  }

  function hasActiveArtifactRunCapture(
    projectId: string,
    artifactKind: PersistedArtifactHistoryKind,
  ): boolean {
    const prefix = `${projectId}::${artifactKind}::`;
    for (const key of activeRunCaptures.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  function listChronologicalArtifactHistory(
    projectId: string,
    artifactKind?: PersistedArtifactHistoryKind,
  ): ArtifactHistoryEntry[] {
    const rows = listItems<ArtifactHistoryEntry>('artifact_history', projectId);
    const filtered = artifactKind ? rows.filter((r) => r.artifactKind === artifactKind) : rows;
    return filtered.sort(
      (a, b) => a.sequence - b.sequence || a.createdAt.localeCompare(b.createdAt),
    );
  }

  function appendArtifactHistoryEntry(
    entryWithoutIdAndSeq:
      | Omit<RequirementsDocHistoryEntry, 'id' | 'sequence' | 'createdAt'>
      | Omit<OntologySuiteHistoryEntry, 'id' | 'sequence' | 'createdAt'>,
  ): ArtifactHistoryEntry {
    const existing = listChronologicalArtifactHistory(
      entryWithoutIdAndSeq.projectId,
      entryWithoutIdAndSeq.artifactKind,
    );
    const nextSequence =
      existing.length > 0 ? existing[existing.length - 1]!.sequence + 1 : 1;
    const now = new Date().toISOString();
    const id = nextUniqueId('ahist');
    const entry: ArtifactHistoryEntry =
      entryWithoutIdAndSeq.artifactKind === 'REQUIREMENTS_DOC'
        ? {
            ...entryWithoutIdAndSeq,
            id,
            sequence: nextSequence,
            createdAt: now,
          }
        : {
            ...entryWithoutIdAndSeq,
            id,
            sequence: nextSequence,
            createdAt: now,
          };

    putItem('artifact_history', entry.id, entry, entry.projectId, now);

    const nextTotal = existing.length + 1;
    if (nextTotal > maxHistoryEntries) {
      const toPrune = existing.slice(0, nextTotal - maxHistoryEntries);
      for (const oldEntry of toPrune) {
        deleteItem('artifact_history', oldEntry.id);
      }
    }

    return entry;
  }

  function applyRequirementDocHistoryState(
    projectId: string,
    state: RequirementDocHistoryState,
  ): void {
    const existingDocs = listItems<RequirementDoc>('req_docs', projectId);
    const targetIds = new Set(state.docs.map((d) => d.id));
    for (const doc of existingDocs) {
      if (!targetIds.has(doc.id)) {
        deleteItem('req_docs', doc.id);
      }
    }
    const baseMs = Date.now() - Math.max(0, state.docs.length - 1);
    const oldestFirst = [...state.docs].reverse();
    oldestFirst.forEach((snap, idx) => {
      const updatedAt = new Date(baseMs + idx).toISOString();
      const restoredDoc: RequirementDoc = {
        id: snap.id,
        projectId,
        title: snap.title,
        version: snap.version,
        status: snap.status,
        content: snap.content,
        updatedAt,
      };
      putItem('req_docs', restoredDoc.id, restoredDoc, projectId, updatedAt);
    });
  }

  function getUpgradedExtractionJob(jobId: string): ExtractionJob | undefined {
    const stored = getItem<StoredExtractionJob>('extraction_jobs', jobId);
    if (!stored) return undefined;
    const { job, upgraded } = upgradeExtractionJob(stored, () => getProjectSuite(stored.projectId));
    if (upgraded) putItem('extraction_jobs', job.id, job, job.projectId);
    return job;
  }

  return {
    close() {
      if (closed) return;
      db.close?.();
      closed = true;
    },

    listProjects(): ProjectSummary[] {
      const rows = db
        .prepare(`SELECT * FROM projects ORDER BY created_at ASC`)
        .all() as Record<string, unknown>[];
      if (rows.length === 0) return [];
      const collections = loadProjectStepCollections();
      return rows.map((row) => {
        const id = String(row.id);
        const suite = row.suite_json
          ? (JSON.parse(String(row.suite_json)) as OntologySuite)
          : ({} as OntologySuite);
        const validation = validateOntologySuite(suite);
        const stepSummary = deriveProjectStepSummaryFromCollections(
          id,
          suite,
          validation,
          collections,
        );
        return {
          id,
          name: String(row.name),
          code: String(row.code),
          center: row.center as ProjectSummary['center'],
          domain: String(row.domain),
          description: String(row.description),
          currentStage: Number(row.current_stage),
          ...stepSummary,
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
        };
      });
    },

    getProject(projectId: string): ProjectDetail | undefined {
      const row = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId) as
        | Record<string, unknown>
        | undefined;
      return row ? hydrateProject(row) : undefined;
    },

    createProject(input): ProjectDetail {
      const trimmedDesc = input.description?.trim() ?? '';
      const explicitName = input.name?.trim() ?? '';
      if (!explicitName && !trimmedDesc) {
        throw new Error('Project description or name is required.');
      }

      const derivedName = explicitName || deriveProjectNameFromDescription(trimmedDesc);
      const derivedDomain = input.domain?.trim() || derivedName;
      const existingCodes = new Set(
        (
          db.prepare(`SELECT code FROM projects`).all() as { code?: unknown }[]
        ).map((r) => String(r.code ?? '').toUpperCase()),
      );
      const derivedCode =
        input.code?.trim() ||
        deriveUniqueProjectCode(trimmedDesc || derivedName, existingCodes);

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
      const changelog = `# Ontology Change Log - ${derivedName}\n\n## [${now}] Project Created\n- Domain: ${derivedDomain}\n`;
      const desc = trimmedDesc || `${derivedDomain}项目`;
      const stage = Object.keys(baseSuite).length;
      const suiteJson = JSON.stringify(baseSuite);
      db.prepare(`
        INSERT INTO projects (id, name, code, center, domain, description, current_stage, suite_json, changelog, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        derivedName,
        derivedCode,
        input.center ?? 'APPLICATION',
        derivedDomain,
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
        derivedName,
        derivedCode,
        input.center ?? 'APPLICATION',
        derivedDomain,
        desc,
        stage,
        suiteJson,
        changelog,
        now,
        now,
      );
      syncEaRelations(id, baseSuite);
      mirrorProjectFiles(id, derivedDomain, baseSuite, changelog);
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
      const sourceStepConfirmations = this.getProjectStepConfirmations(projectId);
      const docIdMap = new Map<string, string>();
      for (const doc of this.listRequirementDocs(projectId)) {
        const newDocId = nextUniqueId('rdoc');
        docIdMap.set(doc.id, newDocId);
        putItem<RequirementDoc>(
          'req_docs',
          newDocId,
          {
            ...doc,
            id: newDocId,
            projectId: id,
            title: `${doc.title} (副本)`,
            updatedAt: now,
          },
          id,
          now,
        );
      }
      let clonedReqConfId: string | null = null;
      if (sourceStepConfirmations.requirements) {
        const srcReq = sourceStepConfirmations.requirements;
        clonedReqConfId = nextUniqueId('sconf-req');
        const clonedReqConf: RequirementsStepConfirmationRecord = {
          id: clonedReqConfId,
          projectId: id,
          step: 'REQUIREMENTS',
          docId: docIdMap.get(srcReq.docId) ?? srcReq.docId,
          title: `${srcReq.title} (副本)`,
          version: srcReq.version,
          content: srcReq.content,
          contentHash: srcReq.contentHash,
          basedOnConfirmationId: null,
          confirmedAt: now,
        };
        putItem('step_confirmations', clonedReqConf.id, clonedReqConf, id, now);
      }
      let clonedProtoConfId: string | null = null;
      for (const proto of this.listPrototypes(projectId)) {
        const newProtoId = nextUniqueId('proto');
        const revisionIdMap = new Map<string, string>();
        const clonedRevisions = proto.revisions.map((rev) => {
          const newRevId = nextUniqueId('prev');
          revisionIdMap.set(rev.id, newRevId);
          return {
            ...rev,
            id: newRevId,
            prototypeId: newProtoId,
            projectId: id,
            ...(rev.restoredFromRevisionId
              ? {
                  restoredFromRevisionId:
                    revisionIdMap.get(rev.restoredFromRevisionId) ?? rev.restoredFromRevisionId,
                }
              : {}),
          };
        });
        const newCurrentRevId =
          revisionIdMap.get(proto.currentRevisionId) ??
          clonedRevisions[clonedRevisions.length - 1]!.id;
        const clonedStored: StoredInteractivePrototype = {
          id: newProtoId,
          projectId: id,
          name: `${proto.name} (副本)`,
          version: proto.version,
          baseVersion: proto.version.replace(/-r\d+$/i, ''),
          ...(proto.designBrief ? { designBrief: structuredClone(proto.designBrief) } : {}),
          revisions: clonedRevisions,
          currentRevisionId: newCurrentRevId,
          createdAt: now,
          updatedAt: now,
        };
        putItem('prototypes', clonedStored.id, clonedStored, id);
        if (proto.isConfirmed && proto.confirmedRevisionId) {
          const mappedRevId = revisionIdMap.get(proto.confirmedRevisionId) ?? newCurrentRevId;
          clonedProtoConfId = nextUniqueId('sconf-proto');
          putItem<ConfirmedPrototypeRevisionRecord>(
            'prototype_confirmations',
            id,
            {
              id: clonedProtoConfId,
              projectId: id,
              prototypeId: newProtoId,
              revisionId: mappedRevId,
              basedOnConfirmationId: clonedReqConfId,
              confirmedAt: now,
            },
            id,
            now,
          );
          const clonedProtoStepConf: PrototypeStepConfirmationRecord = {
            id: clonedProtoConfId,
            projectId: id,
            step: 'PROTOTYPE',
            prototypeId: newProtoId,
            revisionId: mappedRevId,
            basedOnConfirmationId: clonedReqConfId,
            confirmedAt: now,
          };
          putItem('step_confirmations', clonedProtoStepConf.id, clonedProtoStepConf, id, now);
        }
      }
      if (sourceStepConfirmations.businessModel) {
        const srcModel = sourceStepConfirmations.businessModel;
        const clonedSnapshot = structuredClone(srcModel.suiteSnapshot ?? srcModel.suite);
        const clonedModelConf: BusinessModelStepConfirmationRecord = {
          id: nextUniqueId('sconf-model'),
          projectId: id,
          step: 'BUSINESS_MODEL',
          suite: clonedSnapshot,
          suiteSnapshot: structuredClone(clonedSnapshot),
          suiteHash: srcModel.suiteHash,
          presentModels: [...srcModel.presentModels],
          basedOnConfirmationId: clonedProtoConfId,
          confirmedAt: now,
        };
        putItem('step_confirmations', clonedModelConf.id, clonedModelConf, id, now);
      }

      return this.getProject(id)!;
    },

    deleteProject(projectId, force) {
      const allProjects = this.listProjects();
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
      for (const application of boundApps) this.deleteAssembledApplication(application.id);
      const survivingApplications = new Set(this.listAssembledApplications().map((application) => application.id));
      // Older snapshots used their source project as an index owner. Their immutable
      // content stays with the application even when that former source is deleted.
      for (const snapshot of listItems<DevelopmentPackageSnapshot>('development_package_snapshots', projectId)) {
        if (survivingApplications.has(snapshot.appId)) {
          putItem('development_package_snapshots', snapshot.snapshotId, snapshot, undefined, snapshot.compiledAt);
        } else {
          deleteItem('development_package_snapshots', snapshot.snapshotId);
        }
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
        remainingProjectId: remaining[0]?.id ?? '',
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
      return this.commitSuite(projectId, restoredSuite, {
        source: { kind: 'SNAPSHOT_RESTORE', snapshotId: snap.id },
        note: `Restored project snapshot "${snap.label}" (${snap.id})`,
      });
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
      return this.commitSuite(projectId, nextSuite, {
        source: { kind: 'MANUAL', modelCode },
        note: `Updated ${modelCode} model`,
      });
    },

    commitSuite(projectId, suite, commitOptions: CommitSuiteOptions): ProjectDetail {
      const current = this.getProject(projectId);
      if (!current) throw new Error(`Project not found: ${projectId}`);

      let effectiveSuite = suite;
      if (commitOptions.rejectOnNewErrors) {
        const schemaCheck = OntologySuiteSchema.safeParse(suite);
        if (!schemaCheck.success) {
          const schemaErrors: ValidationDiagnostic[] = schemaCheck.error.issues.map(
            (issue, idx) => {
              const firstSeg = String(issue.path[0] ?? 'M1');
              const model: ModelCode = MODEL_CODES.includes(firstSeg as ModelCode)
                ? (firstSeg as ModelCode)
                : 'M1';
              return {
                id: `SCHEMA-INVALID-${idx}`,
                tier: 'ERROR',
                code: 'SCHEMA_INVALID',
                model,
                path: issue.path.join('.'),
                messageZh: `模型结构不符合规范：${issue.message}`,
                messageEn: `Invalid suite structure: ${issue.message}`,
              };
            },
          );
          throw new SuiteValidationRejectedError(
            `Suite rejected: ${schemaErrors.length} schema consistency error(s).`,
            schemaErrors,
            {
              valid: false,
              errorCount: schemaErrors.length,
              warningCount: current.validation.warningCount,
              diagnostics: schemaErrors,
              presentModels: current.validation.presentModels,
              missingModels: current.validation.missingModels,
            },
          );
        }
        effectiveSuite = schemaCheck.data;

        const prevValidation = current.validation;
        const nextValidation = validateOntologySuite(effectiveSuite);
        const prevErrorIds = new Set(
          prevValidation.diagnostics.filter((d) => d.tier === 'ERROR').map((d) => d.id),
        );
        const nextErrors = nextValidation.diagnostics.filter((d) => d.tier === 'ERROR');
        const newErrors = nextErrors.filter((d) => !prevErrorIds.has(d.id));
        if (newErrors.length > 0 || nextValidation.errorCount > prevValidation.errorCount) {
          const blocking = newErrors.length > 0 ? newErrors : nextErrors;
          throw new SuiteValidationRejectedError(
            `Suite rejected: introduced ${blocking.length} new consistency error(s).`,
            blocking,
            nextValidation,
          );
        }
      }

      const now = new Date().toISOString();
      const validation = validateOntologySuite(effectiveSuite);
      let nextChangelog = current.changelog;
      if (commitOptions.changelogEntry !== undefined) {
        if (commitOptions.changelogEntry) {
          nextChangelog = `${current.changelog}\n${commitOptions.changelogEntry}`;
        }
      } else if (commitOptions.note) {
        nextChangelog = `${current.changelog}\n## [${now}] ${commitOptions.note}\n- Present Models: ${validation.presentModels.join(', ')}\n- Consistency Errors: ${validation.errorCount}, Stage Warnings: ${validation.warningCount}\n`;
      }
      const suiteJson = JSON.stringify(effectiveSuite);

      const shouldRecordHistory =
        suppressSuiteHistoryDepth === 0 &&
        !hasActiveArtifactRunCapture(projectId, 'ONTOLOGY_SUITE');
      const beforeSuiteForHistory = shouldRecordHistory
        ? structuredClone(current.suite)
        : undefined;

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
      syncEaRelations(projectId, effectiveSuite);
      mirrorProjectFiles(projectId, current.domain, effectiveSuite, nextChangelog);
      const updated = this.getProject(projectId)!;

      if (beforeSuiteForHistory && !areOntologySuitesEqual(beforeSuiteForHistory, updated.suite)) {
        const historySource: ArtifactHistorySource =
          commitOptions.source.kind === 'AGENT_RUN'
            ? {
                kind: 'AGENT_RUN',
                runId: commitOptions.source.runId,
                ...(commitOptions.source.sessionId
                  ? { sessionId: commitOptions.source.sessionId }
                  : {}),
              }
            : {
                kind: 'MANUAL',
                origin: commitOptions.source.kind,
              };
        appendArtifactHistoryEntry({
          projectId,
          artifactKind: 'ONTOLOGY_SUITE',
          targetId: projectId,
          source: historySource,
          beforeState: beforeSuiteForHistory,
          afterState: structuredClone(updated.suite),
        });
      }

      options.onSuiteCommit?.({
        projectId,
        previousSuite: current.suite,
        nextSuite: updated.suite,
        source: commitOptions.source,
        ...(commitOptions.note !== undefined ? { note: commitOptions.note } : {}),
        committedAt: now,
      });
      return updated;
    },

    updateSuite(projectId, suite, changelogNote): ProjectDetail {
      return this.commitSuite(projectId, suite, {
        source: { kind: 'MANUAL' },
        ...(changelogNote !== undefined ? { note: changelogNote } : {}),
      });
    },

    importYamlFiles(projectId, files) {
      const current = this.getProject(projectId);
      if (!current) throw new Error(`Project not found: ${projectId}`);
      const { suite: parsedPartial, parseErrors } = parseSuiteFromYamlFiles(files);
      const importedModels = Object.keys(parsedPartial) as ModelCode[];
      const mergedSuite: OntologySuite = {
        ...current.suite,
        ...parsedPartial,
      };
      const updated = this.commitSuite(projectId, mergedSuite, {
        source: { kind: 'YAML_IMPORT', models: importedModels },
        note: `Imported YAML files (${importedModels.join(', ')})`,
      });
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
      const project = this.commitSuite(projectId, result.suite, {
        source: { kind: 'SYMBOL_RENAME', oldId, newId },
        note: `Cascade Rename \`${oldId}\` -> \`${newId}\``,
        changelogEntry: result.changelogEntry,
      });
      return {
        project,
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
        PROTOTYPE_CO_DESIGN: '原型共创会话',
        COPILOT: '新建本体建模对话',
        ARCHITECTURE: '架构资产编写会话',
        CODING: '应用开发规格会话',
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
        codeMode: input.codeMode ?? true,
        multiAgentConcurrency:
          typeof input.multiAgentConcurrency === 'number' &&
          Number.isFinite(input.multiAgentConcurrency)
            ? Math.max(1, Math.min(6, Math.round(input.multiAgentConcurrency)))
            : 3,
        messages: input.initialMessages ?? [],
        createdAt: now,
        updatedAt: now,
      });
      return putItem('agent_sessions', session.id, session, session.projectId);
    },

    saveAgentSession(session) {
      const previous = getItem<AgentSession>('agent_sessions', session.id);
      const updated = sanitizeAgentSessionForPersistence({
        ...session,
        ...(previous?.cancelledSubmissionIds?.length ? {
          cancelledSubmissionIds: [...new Set([...previous.cancelledSubmissionIds, ...(session.cancelledSubmissionIds ?? [])])],
        } : {}),
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
        acceptedSubmissionIds: undefined,
        cancelledSubmissionIds: undefined,
        forkedFromMessageId: upToMessageId ?? slicedMessages[slicedMessages.length - 1]?.id,
        messages: JSON.parse(JSON.stringify(slicedMessages)),
        createdAt: now,
        updatedAt: now,
      });
      return putItem('agent_sessions', forked.id, forked, forked.projectId);
    },

    deleteAgentSession(sessionId) {
      const existing = getItem<AgentSession>('agent_sessions', sessionId);
      deleteItem('agent_sessions', sessionId);
      if (existing) {
        deleteSessionContextSnapshots(contextSnapshotStorage, existing.projectId, sessionId);
      }
    },

    recordModelCall(input) {
      return recordModelCall(contextSnapshotStorage, input, options.maxFullModelCallsPerSession);
    },

    listModelCalls(projectId, sessionId) {
      return listModelCalls(contextSnapshotStorage, projectId, sessionId);
    },

    getModelCall(projectId, callId) {
      return getModelCall(contextSnapshotStorage, projectId, callId);
    },

    deleteModelCallsByRunIds(projectId, sessionId, runIds) {
      return deleteModelCallsByRunIds(contextSnapshotStorage, projectId, sessionId, runIds);
    },

    deleteSessionContextSnapshots(projectId, sessionId) {
      deleteSessionContextSnapshots(contextSnapshotStorage, projectId, sessionId);
    },

    recordContextEvent(input) {
      return recordContextEvent(contextSnapshotStorage, input);
    },

    listContextEvents(projectId, sessionId) {
      return listContextEvents(contextSnapshotStorage, projectId, sessionId);
    },

    getContextEvent(projectId, eventId) {
      return getContextEvent(contextSnapshotStorage, projectId, eventId);
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
      const shouldRecordManual = !hasActiveArtifactRunCapture(doc.projectId, 'REQUIREMENTS_DOC');
      const beforeState = shouldRecordManual
        ? captureRequirementDocState(listItems<RequirementDoc>('req_docs', doc.projectId))
        : undefined;
      const full: RequirementDoc = {
        ...doc,
        updatedAt: new Date().toISOString(),
      };
      const saved = putItem('req_docs', full.id, full, full.projectId);
      if (beforeState) {
        const afterState = captureRequirementDocState(
          listItems<RequirementDoc>('req_docs', doc.projectId),
        );
        if (!areRequirementDocStatesEqual(beforeState, afterState)) {
          appendArtifactHistoryEntry({
            projectId: doc.projectId,
            artifactKind: 'REQUIREMENTS_DOC',
            targetId: saved.id,
            source: { kind: 'MANUAL' },
            beforeState,
            afterState,
          });
        }
      }
      return saved;
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
      const existing = getItem<RequirementDoc>('req_docs', docId);
      const shouldRecordManual = Boolean(
        existing && !hasActiveArtifactRunCapture(existing.projectId, 'REQUIREMENTS_DOC'),
      );
      const beforeState =
        shouldRecordManual && existing
          ? captureRequirementDocState(listItems<RequirementDoc>('req_docs', existing.projectId))
          : undefined;
      deleteItem('req_docs', docId);
      if (beforeState && existing) {
        const afterState = captureRequirementDocState(
          listItems<RequirementDoc>('req_docs', existing.projectId),
        );
        if (!areRequirementDocStatesEqual(beforeState, afterState)) {
          appendArtifactHistoryEntry({
            projectId: existing.projectId,
            artifactKind: 'REQUIREMENTS_DOC',
            targetId: afterState.doc?.id ?? existing.id,
            source: { kind: 'MANUAL' },
            beforeState,
            afterState,
          });
        }
      }
    },

    listPrototypes(projectId) {
      ensurePrototypesMigrated(projectId);
      const confirmation = getItem<ConfirmedPrototypeRevisionRecord>(
        'prototype_confirmations',
        projectId,
      );
      return listItems<StoredInteractivePrototype>('prototypes', projectId).map((stored) =>
        hydrateInteractivePrototype(stored, confirmation),
      );
    },

    getPrototype(prototypeId) {
      const stored = getStoredPrototype(prototypeId);
      if (!stored) return undefined;
      const confirmation = getItem<ConfirmedPrototypeRevisionRecord>(
        'prototype_confirmations',
        stored.projectId,
      );
      return hydrateInteractivePrototype(stored, confirmation);
    },

    createPrototype(projectId, input) {
      ensurePrototypesMigrated(projectId);
      const current = this.getProject(projectId);
      if (!current) throw new Error(`Project not found: ${projectId}`);
      const prototypeId = input.id ?? nextUniqueId('proto');
      const revisionId = nextUniqueId('prev');
      const now = new Date().toISOString();
      const { stored, revision } = buildStoredPrototypeOnCreate({
        projectId,
        prototypeId,
        revisionId,
        now,
        input,
      });
      putItem('prototypes', stored.id, stored, projectId);
      const confirmation = getItem<ConfirmedPrototypeRevisionRecord>(
        'prototype_confirmations',
        projectId,
      );
      return {
        prototype: hydrateInteractivePrototype(stored, confirmation),
        revision,
        project: current,
      };
    },

    appendPrototypeRevision(prototypeId, input) {
      const existing = getStoredPrototype(prototypeId);
      if (!existing) throw new Error(`Prototype not found: ${prototypeId}`);
      const current = this.getProject(existing.projectId);
      if (!current) throw new Error(`Project not found: ${existing.projectId}`);
      const revisionId = nextUniqueId('prev');
      const now = new Date().toISOString();
      const { stored, revision } = buildStoredPrototypeOnAppend({
        stored: existing,
        revisionId,
        now,
        input,
      });
      putItem('prototypes', stored.id, stored, stored.projectId);
      const confirmation = getItem<ConfirmedPrototypeRevisionRecord>(
        'prototype_confirmations',
        stored.projectId,
      );
      return {
        prototype: hydrateInteractivePrototype(stored, confirmation),
        revision,
        project: current,
      };
    },

    restorePrototypeRevision(prototypeId, revisionId, title) {
      const existing = getStoredPrototype(prototypeId);
      if (!existing) throw new Error(`Prototype not found: ${prototypeId}`);
      const newRevisionId = nextUniqueId('prev');
      const now = new Date().toISOString();
      const { stored, revision } = buildStoredPrototypeOnRestore({
        stored: existing,
        targetRevisionId: revisionId,
        newRevisionId,
        now,
        title,
      });
      putItem('prototypes', stored.id, stored, stored.projectId);
      const confirmation = getItem<ConfirmedPrototypeRevisionRecord>(
        'prototype_confirmations',
        stored.projectId,
      );
      return {
        prototype: hydrateInteractivePrototype(stored, confirmation),
        revision,
      };
    },

    updatePrototypeRevisionMeta(prototypeId, revisionId, patch) {
      const existing = getStoredPrototype(prototypeId);
      if (!existing) throw new Error(`Prototype not found: ${prototypeId}`);
      const { stored, revision } = applyRevisionMetadataPatch(existing, revisionId, patch);
      putItem('prototypes', stored.id, stored, stored.projectId, stored.updatedAt);
      const confirmation = getItem<ConfirmedPrototypeRevisionRecord>(
        'prototype_confirmations',
        stored.projectId,
      );
      return {
        prototype: hydrateInteractivePrototype(stored, confirmation),
        revision,
      };
    },

    updatePrototypeDesignBrief(prototypeId, designBrief: DesignBrief) {
      const existing = getStoredPrototype(prototypeId);
      if (!existing) throw new Error(`Prototype not found: ${prototypeId}`);
      const now = new Date().toISOString();
      const nextStored: StoredInteractivePrototype = {
        ...existing,
        designBrief: structuredClone(designBrief),
        updatedAt: now,
      };
      putItem('prototypes', nextStored.id, nextStored, nextStored.projectId);
      const confirmation = getItem<ConfirmedPrototypeRevisionRecord>(
        'prototype_confirmations',
        nextStored.projectId,
      );
      return hydrateInteractivePrototype(nextStored, confirmation);
    },

    linkPrototypeCoDesignSession(prototypeId, sessionId) {
      const existing = getStoredPrototype(prototypeId);
      if (!existing) throw new Error(`Prototype not found: ${prototypeId}`);
      const nextStored: StoredInteractivePrototype = {
        ...existing,
        coDesignSessionId: sessionId,
      };
      putItem('prototypes', nextStored.id, nextStored, nextStored.projectId, existing.updatedAt);
      const confirmation = getItem<ConfirmedPrototypeRevisionRecord>(
        'prototype_confirmations',
        nextStored.projectId,
      );
      return hydrateInteractivePrototype(nextStored, confirmation);
    },

    confirmPrototypeRevision(projectId, revisionId) {
      ensurePrototypesMigrated(projectId);
      const current = this.getProject(projectId);
      if (!current) throw new Error(`Project not found: ${projectId}`);
      const projectProtos = listItems<StoredInteractivePrototype>('prototypes', projectId);
      let matchedProto: StoredInteractivePrototype | undefined;
      let matchedRevision: StoredInteractivePrototype['revisions'][number] | undefined;
      for (const proto of projectProtos) {
        const rev = proto.revisions.find((r) => r.id === revisionId);
        if (rev) {
          matchedProto = proto;
          matchedRevision = rev;
          break;
        }
      }
      if (!matchedProto || !matchedRevision) {
        throw new Error(`Prototype revision not found in project ${projectId}: ${revisionId}`);
      }

      const extractedMu = extractMuFromPrototypeHtml(matchedRevision.htmlContent, current.domain);
      const updatedProject = this.commitSuite(
        projectId,
        {
          ...current.suite,
          MU: extractedMu,
        },
        {
          source: {
            kind: 'PROTOTYPE_CONFIRM',
            prototypeId: matchedProto.id,
            revisionId: matchedRevision.id,
          },
          note: `Confirmed prototype revision "${matchedRevision.title}" (${matchedRevision.id}) and extracted MU UI Model`,
        },
      );

      const now = new Date().toISOString();
      const confirmationId = nextUniqueId('sconf-proto');
      const currentReqConfirmation = this.getProjectStepConfirmations(projectId).requirements;
      const basedOnConfirmationId = currentReqConfirmation?.id ?? null;

      const record: ConfirmedPrototypeRevisionRecord = {
        id: confirmationId,
        projectId,
        prototypeId: matchedProto.id,
        revisionId: matchedRevision.id,
        basedOnConfirmationId,
        confirmedAt: now,
      };
      putItem('prototype_confirmations', projectId, record, projectId, now);
      const stepRecord: PrototypeStepConfirmationRecord = {
        id: confirmationId,
        projectId,
        step: 'PROTOTYPE',
        prototypeId: matchedProto.id,
        revisionId: matchedRevision.id,
        basedOnConfirmationId,
        confirmedAt: now,
      };
      putItem('step_confirmations', stepRecord.id, stepRecord, projectId, now);
      const confirmed = hydrateConfirmedPrototypeRevision(record, matchedProto)!;
      return {
        confirmed,
        prototype: confirmed.prototype,
        project: updatedProject,
      };
    },

    getConfirmedPrototypeRevision(projectId) {
      ensurePrototypesMigrated(projectId);
      const record = getItem<ConfirmedPrototypeRevisionRecord>(
        'prototype_confirmations',
        projectId,
      );
      if (!record) return undefined;
      const storedProto = getStoredPrototype(record.prototypeId);
      if (!storedProto) return undefined;
      return hydrateConfirmedPrototypeRevision(record, storedProto);
    },

    listStepConfirmations(projectId, step) {
      const all = listItems<StepConfirmationRecord>('step_confirmations', projectId).map((rec) =>
        rec.step === 'BUSINESS_MODEL' ? normalizeBusinessModelConfirmation(rec) : rec,
      );
      return step ? all.filter((rec) => rec.step === step) : all;
    },

    getProjectStepConfirmations(projectId): ProjectStepConfirmations {
      const records = listItems<StepConfirmationRecord>('step_confirmations', projectId);
      const fallbackProto = getItem<ConfirmedPrototypeRevisionRecord>(
        'prototype_confirmations',
        projectId,
      );
      return resolveCurrentStepConfirmations(records, fallbackProto);
    },

    confirmRequirementsStep(projectId, options) {
      const project = this.getProject(projectId);
      if (!project) throw new Error(`Project not found: ${projectId}`);
      const docs = this.listRequirementDocs(projectId);
      const targetDoc = options?.docId
        ? docs.find((d) => d.id === options.docId)
        : docs[0];
      if (!targetDoc) {
        throw new RequirementsConfirmError({
          code: 'NO_REQUIREMENT_DOC',
          messageZh: '当前项目还没有可确认的需求文档，请先与 AI 助手梳理并生成需求文档。',
          messageEn:
            'No requirements document exists for this project yet. Generate or write a requirements document first.',
        });
      }
      const normalizedContent = normalizeStepMarkdown(targetDoc.content);
      if (!normalizedContent) {
        throw new RequirementsConfirmError({
          code: 'EMPTY_REQUIREMENT_DOC',
          messageZh: '需求文档内容为空，无法确认。请先补充需求内容后再确认。',
          messageEn:
            'The requirements document is empty and cannot be confirmed. Add requirement content first.',
        });
      }
      const confirmedAt = new Date().toISOString();
      const updatedDoc = putItem<RequirementDoc>(
        'req_docs',
        targetDoc.id,
        {
          ...targetDoc,
          status: 'CONFIRMED',
          updatedAt: confirmedAt,
        },
        projectId,
        confirmedAt,
      );
      const confirmation: RequirementsStepConfirmationRecord = {
        id: nextUniqueId('sconf-req'),
        projectId,
        step: 'REQUIREMENTS',
        docId: updatedDoc.id,
        title: updatedDoc.title,
        version: updatedDoc.version,
        content: updatedDoc.content,
        contentHash: computeStepContentHash(updatedDoc.content),
        basedOnConfirmationId: null,
        confirmedAt,
      };
      putItem('step_confirmations', confirmation.id, confirmation, projectId, confirmedAt);
      return {
        confirmation,
        doc: updatedDoc,
        stepConfirmations: this.getProjectStepConfirmations(projectId),
      };
    },

    confirmBusinessModelStep(projectId) {
      const project = this.getProject(projectId);
      if (!project) throw new Error(`Project not found: ${projectId}`);
      const currentProtoConfirmation = this.getProjectStepConfirmations(projectId).prototype;
      if (!currentProtoConfirmation) {
        throw new BusinessModelConfirmError({
          code: 'PROTOTYPE_NOT_CONFIRMED',
          messageZh: '当前项目还没有已确认的原型，请先确认界面原型后再确认业务模型。',
          messageEn:
            'No confirmed prototype exists yet; confirm an interactive prototype first before confirming the Business Model.',
        });
      }
      if (project.validation.presentModels.length === 0) {
        throw new BusinessModelConfirmError({
          code: 'EMPTY_BUSINESS_MODEL',
          messageZh: '当前项目还没有生成任何业务模型内容，无法确认。',
          messageEn: 'The Business Model has no content yet and cannot be confirmed.',
        });
      }
      if (project.validation.errorCount > 0) {
        const count = project.validation.errorCount;
        throw new BusinessModelConfirmError({
          code: 'CONSISTENCY_ERRORS_PRESENT',
          errorCount: count,
          messageZh: `业务模型还有 ${count} 个需要修正的问题，修正后才能确认。`,
          messageEn: `The Business Model still has ${count} ${count === 1 ? 'problem to fix' : 'problems to fix'} before it can be confirmed.`,
        });
      }
      const confirmedAt = new Date().toISOString();
      const basedOnConfirmationId = currentProtoConfirmation.id;
      const suiteSnapshot = structuredClone(project.suite);
      const confirmation: BusinessModelStepConfirmationRecord = {
        id: nextUniqueId('sconf-model'),
        projectId,
        step: 'BUSINESS_MODEL',
        suite: suiteSnapshot,
        suiteSnapshot: structuredClone(suiteSnapshot),
        suiteHash: computeOntologySuiteHash(suiteSnapshot),
        presentModels: listPresentModelCodes(suiteSnapshot),
        basedOnConfirmationId,
        confirmedAt,
      };
      putItem('step_confirmations', confirmation.id, confirmation, projectId, confirmedAt);
      return {
        confirmation: normalizeBusinessModelConfirmation(confirmation),
        project,
        stepConfirmations: this.getProjectStepConfirmations(projectId),
      };
    },

    beginArtifactRunCapture(input) {
      const project = this.getProject(input.projectId);
      if (!project) return;
      const key = runCaptureKey(input.projectId, input.artifactKind, input.runId);
      if (input.artifactKind === 'REQUIREMENTS_DOC') {
        activeRunCaptures.set(key, {
          projectId: input.projectId,
          artifactKind: 'REQUIREMENTS_DOC',
          runId: input.runId,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          beforeState: captureRequirementDocState(
            listItems<RequirementDoc>('req_docs', input.projectId),
          ),
        });
      } else {
        activeRunCaptures.set(key, {
          projectId: input.projectId,
          artifactKind: 'ONTOLOGY_SUITE',
          runId: input.runId,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          beforeState: structuredClone(project.suite),
        });
      }
    },

    finishArtifactRunCapture(input) {
      const key = runCaptureKey(input.projectId, input.artifactKind, input.runId);
      const active = activeRunCaptures.get(key);
      activeRunCaptures.delete(key);
      if (!active) return null;

      const source: ArtifactHistorySource = {
        kind: 'AGENT_RUN',
        runId: input.runId,
        ...(input.sessionId || active.sessionId
          ? { sessionId: input.sessionId ?? active.sessionId! }
          : {}),
        ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
      };

      if (active.artifactKind === 'REQUIREMENTS_DOC') {
        const afterState = captureRequirementDocState(
          listItems<RequirementDoc>('req_docs', input.projectId),
        );
        if (areRequirementDocStatesEqual(active.beforeState, afterState)) {
          return null;
        }
        return appendArtifactHistoryEntry({
          projectId: input.projectId,
          artifactKind: 'REQUIREMENTS_DOC',
          targetId: afterState.doc?.id ?? active.beforeState.doc?.id ?? input.projectId,
          source,
          beforeState: active.beforeState,
          afterState,
        });
      }

      const afterSuite = structuredClone(getProjectSuite(input.projectId) ?? {});
      if (areOntologySuitesEqual(active.beforeState, afterSuite)) {
        return null;
      }
      return appendArtifactHistoryEntry({
        projectId: input.projectId,
        artifactKind: 'ONTOLOGY_SUITE',
        targetId: input.projectId,
        source,
        beforeState: active.beforeState,
        afterState: afterSuite,
      });
    },

    recordPrototypeRunReason(projectId, runId, reason) {
      ensurePrototypesMigrated(projectId);
      const storedList = listItems<StoredInteractivePrototype>('prototypes', projectId);
      for (const stored of storedList) {
        const updated = applyPrototypeRunReason(stored, runId, reason);
        if (updated) {
          putItem('prototypes', updated.id, updated, updated.projectId, updated.updatedAt);
        }
      }
    },

    listArtifactHistory(projectId, filter) {
      const chronological = listChronologicalArtifactHistory(projectId, filter?.artifactKind);
      return [...chronological].reverse();
    },

    listArtifactHistoryViews(projectId, filter) {
      const project = this.getProject(projectId);
      const domain = project?.domain;
      const locale = filter?.locale;

      if (filter?.artifactKind === 'PROTOTYPE') {
        const protos = this.listPrototypes(projectId);
        if (protos.length === 0) return [];
        if (filter.prototypeId) {
          const target = protos.find((p) => p.id === filter.prototypeId);
          return target
            ? buildPrototypeArtifactHistoryViews(target, {
                ...(domain ? { domain } : {}),
                ...(locale ? { locale } : {}),
                maxEntries: maxHistoryEntries,
              })
            : [];
        }
        const confirmed = this.getConfirmedPrototypeRevision(projectId);
        const withHistory = protos.find(
          (p) =>
            p.revisions.length >= 2 ||
            (p.revisions[0] && !isPreExistingPrototypeBaselineRevision(p.revisions[0])),
        );
        const activeProto =
          withHistory ??
          (confirmed ? protos.find((p) => p.id === confirmed.prototypeId) : undefined) ??
          protos[0]!;
        return buildPrototypeArtifactHistoryViews(activeProto, {
          ...(domain ? { domain } : {}),
          ...(locale ? { locale } : {}),
          maxEntries: maxHistoryEntries,
        });
      }

      if (
        filter?.artifactKind === 'REQUIREMENTS_DOC' ||
        filter?.artifactKind === 'ONTOLOGY_SUITE'
      ) {
        const chronological = listChronologicalArtifactHistory(projectId, filter.artifactKind);
        return buildArtifactHistoryViews(
          chronological,
          locale ? { locale } : undefined,
        );
      }

      const persistedViews = buildArtifactHistoryViews(
        listChronologicalArtifactHistory(projectId),
        locale ? { locale } : undefined,
      );
      const protos = this.listPrototypes(projectId);
      if (protos.length === 0) {
        return persistedViews;
      }
      const protoViews = protos.flatMap((proto) =>
        buildPrototypeArtifactHistoryViews(proto, {
          ...(domain ? { domain } : {}),
          ...(locale ? { locale } : {}),
          maxEntries: maxHistoryEntries,
        }),
      );
      if (protoViews.length === 0) {
        return persistedViews;
      }
      return [...persistedViews, ...protoViews].sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt) || b.sequence - a.sequence,
      );
    },

    undoLatestArtifactChange(
      projectId: string,
      artifactKind: ArtifactHistorySurfaceKind,
      undoOptions?: { expectedEntryId?: string; prototypeId?: string },
    ): never {
      const currentProject = this.getProject(projectId);
      if (!currentProject) throw new Error(`Project not found: ${projectId}`);

      if (artifactKind === 'PROTOTYPE') {
        ensurePrototypesMigrated(projectId);
        const storedList = listItems<StoredInteractivePrototype>('prototypes', projectId);
        if (storedList.length === 0) {
          throw new ArtifactHistoryConflictError({
            code: 'NOTHING_TO_UNDO',
            messageZh: '当前项目还没有可撤销的原型改动记录。',
            messageEn: 'There is no prototype change to undo yet.',
          });
        }

        const confirmedRecord = getItem<ConfirmedPrototypeRevisionRecord>(
          'prototype_confirmations',
          projectId,
        );

        let targetStored: StoredInteractivePrototype | undefined;
        if (undoOptions?.prototypeId) {
          targetStored = storedList.find((p) => p.id === undoOptions.prototypeId);
        } else if (undoOptions?.expectedEntryId) {
          targetStored = storedList.find((p) =>
            p.revisions.some((r) => r.id === undoOptions.expectedEntryId),
          );
          if (!targetStored) {
            const hasAnyHistory = storedList.some(
              (p) =>
                p.revisions.length >= 2 ||
                (p.revisions[0] && !isPreExistingPrototypeBaselineRevision(p.revisions[0])),
            );
            throw new ArtifactHistoryConflictError(
              hasAnyHistory
                ? {
                    code: 'STALE_LATEST_ENTRY',
                    messageZh:
                      '在此改动之后已有新的修改，一键撤销只适用于最近一次改动；请在历史记录中恢复到更早状态。',
                    messageEn:
                      'Newer edits exist after this change. One-click undo applies only to the latest change; open History to restore an earlier state.',
                  }
                : {
                    code: 'NOTHING_TO_UNDO',
                    messageZh: '当前项目还没有可撤销的原型改动记录。',
                    messageEn: 'There is no prototype change to undo yet.',
                  },
            );
          }
        } else {
          targetStored =
            storedList.find((p) => p.revisions.length >= 2) ??
            storedList.find(
              (p) =>
                p.revisions.length === 1 &&
                p.revisions[0] &&
                isInitialGeneratedPrototypeRevision(p.revisions[0]) &&
                confirmedRecord?.revisionId !== p.revisions[0].id,
            ) ??
            (confirmedRecord
              ? storedList.find((p) => p.id === confirmedRecord.prototypeId)
              : undefined) ??
            storedList[0];
        }

        if (!targetStored) {
          throw new ArtifactHistoryConflictError({
            code: 'NOTHING_TO_UNDO',
            messageZh: '当前项目还没有可撤销的原型改动记录。',
            messageEn: 'There is no prototype change to undo yet.',
          });
        }

        const ordered = [...targetStored.revisions].sort(
          (a, b) => a.revisionNumber - b.revisionNumber,
        );
        const latestRev = ordered[ordered.length - 1];
        if (!latestRev) {
          throw new ArtifactHistoryConflictError({
            code: 'NOTHING_TO_UNDO',
            messageZh: '当前项目还没有可撤销的原型改动记录。',
            messageEn: 'There is no prototype change to undo yet.',
          });
        }

        if (undoOptions?.expectedEntryId && latestRev.id !== undoOptions.expectedEntryId) {
          throw new ArtifactHistoryConflictError({
            code: 'STALE_LATEST_ENTRY',
            messageZh:
              '在此改动之后已有新的修改，一键撤销只适用于最近一次改动；请在历史记录中恢复到更早状态。',
            messageEn:
              'Newer edits exist after this change. One-click undo applies only to the latest change; open History to restore an earlier state.',
          });
        }

        if (ordered.length < 2) {
          const isConfirmedLatest = Boolean(
            confirmedRecord &&
              confirmedRecord.prototypeId === targetStored.id &&
              confirmedRecord.revisionId === latestRev.id,
          );
          if (!isInitialGeneratedPrototypeRevision(latestRev) || isConfirmedLatest) {
            throw new ArtifactHistoryConflictError({
              code: 'NOTHING_TO_UNDO',
              messageZh: '当前原型处于首版状态，之前没有更早的原型版本可撤销退回。',
              messageEn:
                'This prototype is on its initial version; there is no earlier prototype revision to revert to.',
            });
          }

          // Initial AI-generated R1 that has not been confirmed yet:
          // remove the unconfirmed 1-revision prototype back to the pre-R1 Briefing stage
          // while preserving its coDesignSession (unlinked) and designBrief cleanly.
          const preservedBrief = targetStored.designBrief
            ? structuredClone(targetStored.designBrief)
            : undefined;
          const projectSessions = this.listAgentSessions({ projectId });
          const linkedSessions = projectSessions.filter(
            (s) =>
              s.agentKind === 'PROTOTYPE_CO_DESIGN' &&
              (s.id === targetStored.coDesignSessionId || s.targetId === targetStored.id),
          );
          if (linkedSessions.length > 0) {
            for (const sess of linkedSessions) {
              const { targetId: _removedTargetId, ...restSess } = sess;
              this.saveAgentSession({
                ...restSess,
                ...(preservedBrief ? { designBrief: preservedBrief } : {}),
              });
            }
          } else if (preservedBrief) {
            const unbound = projectSessions.find(
              (s) => s.agentKind === 'PROTOTYPE_CO_DESIGN' && !s.targetId,
            );
            if (unbound) {
              this.saveAgentSession({
                ...unbound,
                designBrief: preservedBrief,
              });
            } else {
              const createdSess = this.createAgentSession({
                projectId,
                agentKind: 'PROTOTYPE_CO_DESIGN',
                title: '原型共创对话',
              });
              this.saveAgentSession({
                ...createdSess,
                designBrief: preservedBrief,
              });
            }
          }

          deleteItem('prototypes', targetStored.id);

          const now = new Date().toISOString();
          const undoEntryId = nextUniqueId('prev-undo');
          const entryView: ArtifactHistoryEntryView = {
            id: undoEntryId,
            projectId,
            artifactKind: 'PROTOTYPE',
            targetId: targetStored.id,
            sequence: latestRev.revisionNumber + 1,
            createdAt: now,
            source: { kind: 'UNDO', undoneEntryId: latestRev.id },
            title: {
              zh: '撤销上一次改动',
              en: 'Undid latest change',
            },
            changeSummary: {
              entryId: undoEntryId,
              artifactKind: 'PROTOTYPE',
              targetId: targetStored.id,
              items: [
                {
                  id: `${undoEntryId}-proto-r1-reverted`,
                  changeType: 'REMOVED',
                  label: {
                    zh: '撤回首版界面原型，回到生成前的设计简报阶段',
                    en: 'Reverted the initial prototype back to the pre-generation design brief stage',
                  },
                },
              ],
              canUndo: false,
            },
            canRestoreBefore: false,
          };

          return {
            entryView,
            undoneEntryId: latestRev.id,
          } as never;
        }

        const priorRev = ordered[ordered.length - 2]!;
        const undoDepthById = new Map<string, number>();
        for (const rev of ordered) {
          undoDepthById.set(
            rev.id,
            rev.undoneRevisionId ? (undoDepthById.get(rev.undoneRevisionId) ?? 0) + 1 : 0,
          );
        }
        const nextDepth = (undoDepthById.get(latestRev.id) ?? 0) + 1;
        const isRedo = nextDepth % 2 === 0;

        const appendedProto = this.appendPrototypeRevision(targetStored.id, {
          title: isRedo ? '重做上一次改动' : '撤销上一次改动',
          htmlContent: priorRev.htmlContent,
          source: 'RESTORED',
          restoredFromRevisionId: priorRev.id,
          undoneRevisionId: latestRev.id,
        });

        const views = this.listArtifactHistoryViews(projectId, {
          artifactKind: 'PROTOTYPE',
          prototypeId: targetStored.id,
        });
        const entryView = views.find((v) => v.id === appendedProto.revision.id) ?? views[0]!;
        return {
          revision: appendedProto.revision,
          prototype: appendedProto.prototype,
          entryView,
          undoneEntryId: latestRev.id,
        } as never;
      }

      const chronological = listChronologicalArtifactHistory(projectId, artifactKind);
      const latest = chronological[chronological.length - 1];
      if (!latest) {
        throw new ArtifactHistoryConflictError({
          code: 'NOTHING_TO_UNDO',
          messageZh: '当前成果还没有可撤销的改动记录。',
          messageEn: 'There is no recorded change to undo yet.',
        });
      }
      if (undoOptions?.expectedEntryId && latest.id !== undoOptions.expectedEntryId) {
        throw new ArtifactHistoryConflictError({
          code: 'STALE_LATEST_ENTRY',
          messageZh: '在此改动之后已有新的修改，一键撤销只适用于最近一次改动；请在历史记录中恢复到更早状态。',
          messageEn:
            'Newer edits exist after this change. One-click undo applies only to the latest change; open History to restore an earlier state.',
        });
      }

      let appended: ArtifactHistoryEntry;
      if (latest.artifactKind === 'REQUIREMENTS_DOC') {
        const currentState = captureRequirementDocState(
          listItems<RequirementDoc>('req_docs', projectId),
        );
        const restoredState = structuredClone(latest.beforeState);
        applyRequirementDocHistoryState(projectId, restoredState);
        appended = appendArtifactHistoryEntry({
          projectId,
          artifactKind: 'REQUIREMENTS_DOC',
          targetId: restoredState.doc?.id ?? currentState.doc?.id ?? latest.targetId,
          source: { kind: 'UNDO', undoneEntryId: latest.id },
          beforeState: currentState,
          afterState: restoredState,
        });
      } else {
        const currentSuite = structuredClone(currentProject.suite);
        const restoredSuite = structuredClone(latest.beforeState);
        suppressSuiteHistoryDepth += 1;
        try {
          this.commitSuite(projectId, restoredSuite, {
            source: { kind: 'MANUAL' },
            note: `Undid change ${latest.id}`,
          });
        } finally {
          suppressSuiteHistoryDepth -= 1;
        }
        appended = appendArtifactHistoryEntry({
          projectId,
          artifactKind: 'ONTOLOGY_SUITE',
          targetId: projectId,
          source: { kind: 'UNDO', undoneEntryId: latest.id },
          beforeState: currentSuite,
          afterState: restoredSuite,
        });
      }

      const views = this.listArtifactHistoryViews(projectId, { artifactKind });
      const entryView = views.find((v) => v.id === appended.id) ?? views[0]!;
      return {
        entry: appended,
        entryView,
        undoneEntryId: latest.id,
      } as never;
    },

    restoreArtifactBeforeEntry(
      projectId: string,
      artifactKind: ArtifactHistorySurfaceKind,
      entryId: string,
    ): never {
      const currentProject = this.getProject(projectId);
      if (!currentProject) throw new Error(`Project not found: ${projectId}`);

      if (artifactKind === 'PROTOTYPE') {
        ensurePrototypesMigrated(projectId);
        const storedList = listItems<StoredInteractivePrototype>('prototypes', projectId);
        const matchedStored = storedList.find((p) =>
          p.revisions.some((r) => r.id === entryId),
        );
        if (!matchedStored) {
          throw new ArtifactHistoryNotFoundError(entryId);
        }
        const ordered = [...matchedStored.revisions].sort(
          (a, b) => a.revisionNumber - b.revisionNumber,
        );
        const targetIdx = ordered.findIndex((r) => r.id === entryId);
        if (targetIdx < 0) {
          throw new ArtifactHistoryNotFoundError(entryId);
        }
        if (targetIdx === 0) {
          throw new ArtifactHistoryConflictError({
            code: 'NOTHING_TO_UNDO',
            messageZh: '首版原型之前没有更早的原型状态可恢复。',
            messageEn: 'There is no earlier prototype state before the initial prototype revision.',
          });
        }

        const beforeRev = ordered[targetIdx - 1]!;
        const appendedProto = this.appendPrototypeRevision(matchedStored.id, {
          title: `恢复自修订 #${beforeRev.revisionNumber}（${beforeRev.title}）`,
          htmlContent: beforeRev.htmlContent,
          source: 'RESTORED',
          restoredFromRevisionId: beforeRev.id,
          restoredBeforeRevisionId: entryId,
        });

        const views = this.listArtifactHistoryViews(projectId, {
          artifactKind: 'PROTOTYPE',
          prototypeId: matchedStored.id,
        });
        const entryView = views.find((v) => v.id === appendedProto.revision.id) ?? views[0]!;
        return {
          revision: appendedProto.revision,
          prototype: appendedProto.prototype,
          entryView,
          restoredBeforeEntryId: entryId,
        } as never;
      }

      const chronological = listChronologicalArtifactHistory(projectId, artifactKind);
      const target = chronological.find((item) => item.id === entryId);
      if (!target) {
        throw new ArtifactHistoryNotFoundError(entryId);
      }

      let appended: ArtifactHistoryEntry;
      if (target.artifactKind === 'REQUIREMENTS_DOC') {
        const currentState = captureRequirementDocState(
          listItems<RequirementDoc>('req_docs', projectId),
        );
        const restoredState = structuredClone(target.beforeState);
        applyRequirementDocHistoryState(projectId, restoredState);
        appended = appendArtifactHistoryEntry({
          projectId,
          artifactKind: 'REQUIREMENTS_DOC',
          targetId: restoredState.doc?.id ?? currentState.doc?.id ?? target.targetId,
          source: { kind: 'RESTORE', restoredFromEntryId: target.id },
          beforeState: currentState,
          afterState: restoredState,
        });
      } else {
        const currentSuite = structuredClone(currentProject.suite);
        const restoredSuite = structuredClone(target.beforeState);
        suppressSuiteHistoryDepth += 1;
        try {
          this.commitSuite(projectId, restoredSuite, {
            source: { kind: 'MANUAL' },
            note: `Restored suite to before ${target.id}`,
          });
        } finally {
          suppressSuiteHistoryDepth -= 1;
        }
        appended = appendArtifactHistoryEntry({
          projectId,
          artifactKind: 'ONTOLOGY_SUITE',
          targetId: projectId,
          source: { kind: 'RESTORE', restoredFromEntryId: target.id },
          beforeState: currentSuite,
          afterState: restoredSuite,
        });
      }

      const views = this.listArtifactHistoryViews(projectId, { artifactKind });
      const entryView = views.find((v) => v.id === appended.id) ?? views[0]!;
      return {
        entry: appended,
        entryView,
        restoredBeforeEntryId: target.id,
      } as never;
    },

    savePrototypeAndSyncMu(projectId, input) {
      ensurePrototypesMigrated(projectId);
      // Saving a prototype or appending a revision NEVER extracts or mutates suite.MU (ADR 0010).
      if (input.id) {
        const existing = getStoredPrototype(input.id);
        if (existing && existing.projectId === projectId) {
          const appended = this.appendPrototypeRevision(input.id, {
            name: input.name,
            version: input.version,
            title: input.title,
            instruction: input.instruction,
            htmlContent: input.htmlContent,
            source: input.source ?? 'MANUAL_SAVE',
          });
          return { prototype: appended.prototype, project: appended.project };
        }
      }
      const created = this.createPrototype(projectId, {
        id: input.id,
        name: input.name,
        version: input.version ?? 'v5.1',
        title: input.title,
        instruction: input.instruction,
        htmlContent: input.htmlContent,
        source: input.source ?? 'MANUAL_SAVE',
        designBrief: input.designBrief,
        coDesignSessionId: input.coDesignSessionId,
      });
      return { prototype: created.prototype, project: created.project };
    },

    clonePrototype(protoId, options) {
      const existing = getStoredPrototype(protoId);
      if (!existing) throw new Error(`Prototype not found: ${protoId}`);
      const hydrated = hydrateInteractivePrototype(existing);
      const currentRev =
        hydrated.revisions.find((r) => r.id === hydrated.currentRevisionId) ??
        hydrated.revisions[hydrated.revisions.length - 1]!;
      const nextName = options?.name?.trim() || `${existing.name} (副本)`;
      const sourceSession =
        (existing.coDesignSessionId ? this.getAgentSession(existing.coDesignSessionId) : undefined) ??
        this.listAgentSessions({
          projectId: existing.projectId,
          agentKind: 'PROTOTYPE_CO_DESIGN',
          targetId: existing.id,
        })[0] ??
        (() => {
          const createdSourceSession = this.createAgentSession({
            projectId: existing.projectId,
            agentKind: 'PROTOTYPE_CO_DESIGN',
            targetId: existing.id,
            title: existing.name,
          });
          this.linkPrototypeCoDesignSession(existing.id, createdSourceSession.id);
          return createdSourceSession;
        })();
      const forkedSession = this.forkAgentSession(
        sourceSession.id,
        undefined,
        nextName,
      );
      const created = this.createPrototype(existing.projectId, {
        name: nextName,
        version: existing.baseVersion || existing.version.replace(/-r\d+$/i, ''),
        title: `另存自「${existing.name}」(#${currentRev.revisionNumber})`,
        htmlContent: currentRev.htmlContent,
        source: 'CLONED',
        ...(existing.designBrief ? { designBrief: structuredClone(existing.designBrief) } : {}),
        coDesignSessionId: forkedSession.id,
      });
      this.saveAgentSession({
        ...forkedSession,
        targetId: created.prototype.id,
      });
      return created.prototype;
    },

    deletePrototype(protoId) {
      const existing = getStoredPrototype(protoId);
      if (existing) {
        const confirmation = getItem<ConfirmedPrototypeRevisionRecord>(
          'prototype_confirmations',
          existing.projectId,
        );
        if (confirmation && confirmation.prototypeId === existing.id) {
          const confirmedRev = existing.revisions.find((r) => r.id === confirmation.revisionId);
          throw new PrototypeConfirmedDeleteError({
            prototypeId: existing.id,
            prototypeName: existing.name,
            confirmedRevisionId: confirmation.revisionId,
            ...(confirmedRev ? { confirmedRevisionTitle: confirmedRev.title } : {}),
          });
        }
      }
      deleteItem('prototypes', protoId);
      if (existing) {
        const remainingCoDesignSessionIds = new Set(
          this.listPrototypes(existing.projectId)
            .map((p) => p.coDesignSessionId)
            .filter((sid): sid is string => Boolean(sid)),
        );
        const orphanedSessions = this.listAgentSessions({
          projectId: existing.projectId,
          agentKind: 'PROTOTYPE_CO_DESIGN',
        }).filter(
          (s) =>
            (s.id === existing.coDesignSessionId || s.targetId === existing.id) &&
            !remainingCoDesignSessionIds.has(s.id),
        );
        for (const sess of orphanedSessions) {
          this.deleteAgentSession(sess.id);
        }
      }
    },

    listFourLayerAssets(layer) {
      // Repository files win on every read, including in workspaces created before the catalog existed.
      // Keep useful custom legacy records until the user explicitly saves them into source.
      const sources = architectureCatalog.listAssets();
      const sourceIds = new Set(sources.map((asset) => asset.id));
      const legacy = listItems<FourLayerAsset>('four_layer_assets').filter(
        (asset) => !asset.sourcePath && !bundledAssetIds.has(asset.id) && !sourceIds.has(asset.id),
      );
      const all = [...sources, ...legacy];
      return layer ? all.filter((a) => a.layer === layer) : all;
    },

    listTechnologyProfiles() {
      return architectureCatalog.listTechnologyProfiles();
    },

    saveFourLayerAsset(asset) {
      const existing = this.listFourLayerAssets().find((item) => item.id === asset.id);
      const full = architectureCatalog.saveAsset({
        ...asset,
        technologyProfileId: asset.technologyProfileId ?? existing?.technologyProfileId,
      });
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
      architectureCatalog.deleteAsset(assetId);
      deleteItem('four_layer_assets', assetId);
    },

    listAssembledApplications() {
      return listItems<AssembledApplication>('assembled_apps');
    },

    saveAssembledApplication(app) {
      const existing = getItem<AssembledApplication>('assembled_apps', app.id);
      const changedProject = existing && existing.projectId !== app.projectId;
      const full: AssembledApplication = {
        ...existing,
        ...app,
        agentDevLogs: app.agentDevLogs ?? existing?.agentDevLogs ?? [],
        updatedAt: new Date().toISOString(),
        ...(changedProject ? {
          latestPackageSnapshotId: undefined,
          packageOutputDir: undefined,
          prototypeRevisionId: app.prototypeRevisionId !== existing.prototypeRevisionId
            ? app.prototypeRevisionId : undefined,
          status: 'ASSEMBLED' as const,
        } : {}),
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
        latestPackageSnapshotId: undefined,
        publishedEndpoint: undefined,
        publishedVersion: undefined,
        agentDevLogs: [],
      });
    },

    deleteAssembledApplication(appId) {
      for (const snapshot of this.listDevelopmentPackageSnapshots(appId)) {
        deleteItem('development_package_snapshots', snapshot.snapshotId);
      }
      deleteItem('assembled_apps', appId);
    },

    saveDevelopmentPackageSnapshot(snapshot) {
      const application = getItem<AssembledApplication>('assembled_apps', snapshot.appId);
      if (!application) throw new Error(`Assembled application not found: ${snapshot.appId}`);
      if (application.projectId !== snapshot.projectId) {
        throw new Error('Development package project must match its application project.');
      }
      if (!snapshot.snapshotId || !snapshot.inputFingerprint) {
        throw new Error('Development package snapshot and input revision are required.');
      }
      if (getItem<DevelopmentPackageSnapshot>('development_package_snapshots', snapshot.snapshotId)) {
        throw new Error(`Development package snapshot is immutable: ${snapshot.snapshotId}`);
      }
      const payloadJson = JSON.stringify(snapshot);
      const now = new Date().toISOString();
      db.exec('SAVEPOINT development_package_generation');
      const previousBatch = d1MutationBatch;
      const mutations: { query: string; values: unknown[] }[] = [];
      d1MutationBatch = mutations;
      try {
        db.prepare(`INSERT INTO workspace_entities (collection, item_id, project_id, payload_json, updated_at)
          VALUES (?, ?, ?, ?, ?)`).run(
          'development_package_snapshots', snapshot.snapshotId, null, payloadJson, now,
        );
        replicateToD1(
          'INSERT INTO workspace_entities (collection, item_id, project_id, payload_json, updated_at) VALUES (?, ?, ?, ?, ?)',
          'development_package_snapshots', snapshot.snapshotId, null, payloadJson, now,
        );
        this.saveAssembledApplication({
          ...application,
          latestPackageSnapshotId: snapshot.snapshotId,
          packageOutputDir: snapshot.outputDir,
          status: application.status === 'PUBLISHED' ? 'PUBLISHED' : 'PACKAGE_READY',
          agentDevLogs: [...application.agentDevLogs, {
            timestamp: snapshot.compiledAt,
            phase: 'PACKAGE_GENERATED',
            detail: `Generated implementation specification ${snapshot.snapshotId} (${snapshot.files.length} files).`,
          }],
        });
        db.exec('RELEASE SAVEPOINT development_package_generation');
      } catch (error) {
        db.exec('ROLLBACK TO SAVEPOINT development_package_generation');
        db.exec('RELEASE SAVEPOINT development_package_generation');
        throw error;
      } finally {
        d1MutationBatch = previousBatch;
      }
      replicateCommittedBatch(mutations);
      return JSON.parse(payloadJson) as DevelopmentPackageSnapshot;
    },

    getDevelopmentPackageSnapshot(snapshotId) {
      return getItem<DevelopmentPackageSnapshot>('development_package_snapshots', snapshotId);
    },

    listDevelopmentPackageSnapshots(appId) {
      return listItems<DevelopmentPackageSnapshot>('development_package_snapshots')
        .filter((snapshot) => snapshot.appId === appId);
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

    getConnectedApp(projectId) {
      return getItem<ConnectedAppRecord>('connected_apps', projectId);
    },

    listConnectedApps() {
      return listItems<ConnectedAppRecord>('connected_apps');
    },

    saveConnectedApp(record) {
      if (!getProjectSuite(record.projectId)) throw new Error(`Project ${record.projectId} not found`);
      return putItem('connected_apps', record.projectId, record, record.projectId);
    },

    getRuntimeEvent(projectId, eventId) {
      return getItem<RuntimeEventReceipt>('runtime_events', `${projectId}::${eventId}`);
    },

    saveRuntimeEvent(record) {
      return putItem('runtime_events', `${record.projectId}::${record.eventId}`, record, record.projectId);
    },

    listRuntimeTasks(projectId) {
      return listItems<RuntimeTaskRecord>('runtime_tasks', projectId).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    },

    getRuntimeTask(id) {
      return getItem<RuntimeTaskRecord>('runtime_tasks', id);
    },

    saveRuntimeTask(record) {
      return putItem('runtime_tasks', record.id, record, record.projectId);
    },

    getLatestBuildRun(projectId) {
      return listItems<BuildRunRecord>('build_runs', projectId).sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];
    },

    saveBuildRun(record) {
      return putItem('build_runs', record.id, record, record.projectId);
    },

    listBenchmarkReports() {
      return listItems<BenchmarkReportRecord>('benchmark_reports', '__platform__').sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    },

    saveBenchmarkReport(record) {
      return putItem('benchmark_reports', record.id, record, '__platform__');
    },

    listDataSources(projectId) {
      return listItems<DataSourceRecord>('data_sources', projectId).sort((x, y) => x.addedAt.localeCompare(y.addedAt));
    },

    saveDataSource(record) {
      return putItem('data_sources', record.id, record, record.projectId);
    },

    listProvenanceRecords(projectId) {
      return listItems<ProvenanceRecord>('provenance_records', projectId);
    },

    saveProvenanceRecords(records) {
      for (const r of records) putItem('provenance_records', r.id, r, r.projectId);
    },

    listKnowledgeClaims(projectId) {
      return listItems<KnowledgeClaim>('knowledge_claims', projectId).sort((x, y) => x.recordedAt.localeCompare(y.recordedAt) || x.id.localeCompare(y.id));
    },

    saveKnowledgeClaims(records) {
      for (const r of records) putItem('knowledge_claims', r.id, r, r.projectId);
    },

    listChangeProposals(projectId) {
      return listItems<ChangeProposalRecord>('change_proposals', projectId).sort((x, y) => x.targetVersion.localeCompare(y.targetVersion, undefined, { numeric: true }));
    },

    getChangeProposal(projectId, targetVersion) {
      return getItem<ChangeProposalRecord>('change_proposals', `${projectId}::${targetVersion}`);
    },

    saveChangeProposal(record) {
      return putItem('change_proposals', `${record.projectId}::${record.targetVersion}`, record, record.projectId);
    },

    listActionInvocations(projectId) {
      return listItems<ActionInvocationRecord>('action_invocations', projectId).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    },

    getActionInvocation(id) {
      return getItem<ActionInvocationRecord>('action_invocations', id);
    },

    saveActionInvocation(record) {
      return putItem('action_invocations', record.id, record, record.projectId);
    },

    deleteConnectedApp(projectId) {
      const existed = getItem<ConnectedAppRecord>('connected_apps', projectId) !== undefined;
      if (existed) deleteItem('connected_apps', projectId);
      return existed;
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
      const merged = this.commitSuite(input.projectId, preview.suite, {
        source: input.source ?? { kind: 'EXTRACTION_APPLY', jobId: job.id },
        note: `Applied ontology extraction job: ${input.title}`,
      });
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

      const updatedProject = this.commitSuite(existing.projectId, preview.suite, {
        source: { kind: 'EXTRACTION_APPLY', jobId: existing.id },
        note: `Applied reviewed extraction job (${existing.id}): ${existing.title}`,
      });
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

    getInspoCache(cacheKey) {
      const normalizedKey = String(cacheKey).trim();
      if (!normalizedKey) return undefined;
      return getItem<InspoCacheEntry>('inspo_cache', normalizedKey);
    },

    saveInspoCache(entry) {
      const sanitized = sanitizeInspoCacheEntry(entry);
      return putItem('inspo_cache', sanitized.cacheKey, sanitized);
    },
  };
}
