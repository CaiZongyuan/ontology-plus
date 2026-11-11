import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const auditColumns = {
  createdBy: text('created_by').notNull().default('system'),
  createdAt: text('created_at').notNull(),
  updatedBy: text('updated_by').notNull().default('system'),
  updatedAt: text('updated_at').notNull(),
  flag: integer('flag').notNull().default(1),
};

export const projectsTable = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  center: text('center').notNull(),
  domain: text('domain').notNull(),
  description: text('description').notNull(),
  currentStage: integer('current_stage').notNull(),
  suiteJson: text('suite_json').notNull(),
  changelog: text('changelog').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const workspaceEntitiesTable = sqliteTable(
  'workspace_entities',
  {
    collection: text('collection').notNull(),
    itemId: text('item_id').notNull(),
    projectId: text('project_id'),
    payloadJson: text('payload_json').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.collection, table.itemId] })],
);

export const agentCheckpointsTable = sqliteTable('agent_checkpoints', {
  sessionId: text('session_id').primaryKey(),
  workflow: text('workflow').notNull(),
  stateJson: text('state_json').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const eaRelationsTable = sqliteTable('ea_relations', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  sourceId: text('source_id').notNull(),
  targetId: text('target_id').notNull(),
  relation: text('relation').notNull(),
  labelZh: text('label_zh').notNull(),
  labelEn: text('label_en').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const dictTable = sqliteTable('__dict', {
  id: text('id').primaryKey(),
  dictId: text('dict_id').notNull(),
  typeCode: text('type_code').notNull(),
  typeName: text('type_name').notNull(),
  itemCode: text('item_code').notNull(),
  itemLabel: text('item_label').notNull(),
  sortOrder: integer('sort_order').notNull().default(10),
  ...auditColumns,
});

export const counterpartyTable = sqliteTable('t_counterparty', {
  id: text('id').primaryKey(),
  creditCode: text('credit_code').notNull(),
  companyName: text('company_name').notNull(),
  industry: text('industry').notNull(),
  region: text('region').notNull(),
  creditRating: text('credit_rating').notNull(),
  status: text('status').notNull(),
  ...auditColumns,
});

export const contractTable = sqliteTable('t_contract', {
  id: text('id').primaryKey(),
  contractNo: text('contract_no').notNull(),
  title: text('title').notNull(),
  contractType: text('contract_type').notNull(),
  counterpartyId: text('counterparty_id').notNull(),
  region: text('region').notNull(),
  department: text('department').notNull(),
  industry: text('industry').notNull(),
  totalAmount: real('total_amount').notNull(),
  riskLevel: text('risk_level').notNull(),
  status: text('status').notNull(),
  signPeriodJson: text('sign_period_json').notNull(),
  overdueDays: integer('overdue_days').notNull().default(0),
  ...auditColumns,
});

export const contractLineItemTable = sqliteTable('t_contract_line_item', {
  id: text('id').primaryKey(),
  contractId: text('contract_id').notNull(),
  itemName: text('item_name').notNull(),
  category: text('category').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: real('unit_price').notNull(),
  subtotalAmount: real('subtotal_amount').notNull(),
  ...auditColumns,
});

export const paymentMilestoneTable = sqliteTable('t_payment_milestone', {
  id: text('id').primaryKey(),
  contractId: text('contract_id').notNull(),
  phaseName: text('phase_name').notNull(),
  plannedRatio: real('planned_ratio').notNull(),
  plannedAmount: real('planned_amount').notNull(),
  dueDate: text('due_date').notNull(),
  milestoneStatus: text('milestone_status').notNull(),
  overdueDays: integer('overdue_days').notNull().default(0),
  ...auditColumns,
});

export const settlementOrderTable = sqliteTable('t_settlement_order', {
  id: text('id').primaryKey(),
  settlementNo: text('settlement_no').notNull(),
  contractRef: text('contract_ref').notNull(),
  milestoneId: text('milestone_id'),
  settlementAmount: real('settlement_amount').notNull(),
  settlementStatus: text('settlement_status').notNull(),
  overdueDays: integer('overdue_days').notNull().default(0),
  settledAt: text('settled_at'),
  ...auditColumns,
});

export const mftWorkOrderTable = sqliteTable('t_mft_work_order', {
  id: text('id').primaryKey(),
  workOrderNo: text('work_order_no').notNull(),
  contractRef: text('contract_ref'),
  fileName: text('file_name').notNull(),
  fileSizeMb: real('file_size_mb').notNull(),
  securityDomain: text('security_domain').notNull(),
  sha256Digest: text('sha256_digest').notNull(),
  status: text('status').notNull(),
  ...auditColumns,
});

export const BOOTSTRAP_SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  center TEXT NOT NULL,
  domain TEXT NOT NULL,
  description TEXT NOT NULL,
  current_stage INTEGER NOT NULL,
  suite_json TEXT NOT NULL,
  changelog TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_entities (
  collection TEXT NOT NULL,
  item_id TEXT NOT NULL,
  project_id TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (collection, item_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_entities_col_proj
  ON workspace_entities (collection, project_id);

CREATE TABLE IF NOT EXISTS agent_checkpoints (
  session_id TEXT PRIMARY KEY,
  workflow TEXT NOT NULL,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_workflow
  ON agent_checkpoints (workflow, updated_at);

CREATE TABLE IF NOT EXISTS ea_relations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  label_zh TEXT NOT NULL,
  label_en TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ea_relations_project
  ON ea_relations (project_id);

CREATE TABLE IF NOT EXISTS __dict (
  id TEXT PRIMARY KEY,
  dict_id TEXT NOT NULL,
  type_code TEXT NOT NULL,
  type_name TEXT NOT NULL,
  item_code TEXT NOT NULL,
  item_label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 10,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TEXT NOT NULL,
  flag INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_dict_item_code
  ON __dict (item_code, flag);

CREATE TABLE IF NOT EXISTS t_counterparty (
  id TEXT PRIMARY KEY,
  credit_code TEXT NOT NULL,
  company_name TEXT NOT NULL,
  industry TEXT NOT NULL,
  region TEXT NOT NULL,
  credit_rating TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TEXT NOT NULL,
  flag INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS t_contract (
  id TEXT PRIMARY KEY,
  contract_no TEXT NOT NULL,
  title TEXT NOT NULL,
  contract_type TEXT NOT NULL,
  counterparty_id TEXT NOT NULL,
  region TEXT NOT NULL,
  department TEXT NOT NULL,
  industry TEXT NOT NULL,
  total_amount REAL NOT NULL,
  risk_level TEXT NOT NULL,
  status TEXT NOT NULL,
  sign_period_json TEXT NOT NULL,
  overdue_days INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TEXT NOT NULL,
  flag INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_t_contract_region_risk
  ON t_contract (region, risk_level, status);

CREATE TABLE IF NOT EXISTS t_contract_line_item (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  subtotal_amount REAL NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TEXT NOT NULL,
  flag INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS t_payment_milestone (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL,
  phase_name TEXT NOT NULL,
  planned_ratio REAL NOT NULL,
  planned_amount REAL NOT NULL,
  due_date TEXT NOT NULL,
  milestone_status TEXT NOT NULL,
  overdue_days INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TEXT NOT NULL,
  flag INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS t_settlement_order (
  id TEXT PRIMARY KEY,
  settlement_no TEXT NOT NULL,
  contract_ref TEXT NOT NULL,
  milestone_id TEXT,
  settlement_amount REAL NOT NULL,
  settlement_status TEXT NOT NULL,
  overdue_days INTEGER NOT NULL DEFAULT 0,
  settled_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TEXT NOT NULL,
  flag INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_t_settlement_contract
  ON t_settlement_order (contract_ref, settlement_status);

CREATE TABLE IF NOT EXISTS t_mft_work_order (
  id TEXT PRIMARY KEY,
  work_order_no TEXT NOT NULL,
  contract_ref TEXT,
  file_name TEXT NOT NULL,
  file_size_mb REAL NOT NULL,
  security_domain TEXT NOT NULL,
  sha256_digest TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TEXT NOT NULL,
  flag INTEGER NOT NULL DEFAULT 1
);
`;
