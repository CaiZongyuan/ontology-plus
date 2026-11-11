import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BookOpen,
  Bot,
  Edit3,
  Play,
  Plus,
  Server,
  Trash2,
  Workflow,
} from 'lucide-react';
import type {
  McpResourceDefinition,
  McpToolDefinition,
} from '../../packages/package-compiler/index.js';
import type {
  CapabilityAgent,
  CrossSystemFlow,
  ExtractionJob,
  KnowledgeEntry,
  LegacySystemConfig,
  McpServerConfig,
} from '../../packages/workspace-store/index.js';
import {
  apiCallMcpTool,
  apiDeleteResource,
  apiInspectMcp,
  apiPostJson,
  triggerBrowserDownload,
  useWorkbenchStore,
} from '../api.js';
import { AgentSessionWorkbench } from '../components/agent/AgentSessionWorkbench.js';
import {
  Button,
  CodeBlock,
  ConfirmDialog,
  RegistryTable,
  type RegistryColumn,
} from '../components/beautifui/index.js';
import { TiptapMarkdownEditor } from '../components/markdown/index.js';
import { usePreferences } from '../i18n.js';

// ─── 1. Capability Center: Legacy System Registry (存量系统接入管理) ──────────

export function CapabilitySystemsView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LegacySystemConfig | null>(null);

  const [code, setCode] = useState('MES-MFG-CORE');
  const [name, setName] = useState('存量制造执行与工序追溯系统 (MES)');
  const [category, setCategory] = useState('MES / 生产制造');
  const [dbDialect, setDbDialect] = useState('PostgreSQL 16');
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:4310/api/mock-legacy/mes');
  const [dbConnectionUri, setDbConnectionUri] = useState(
    'postgres://mes_ro@10.20.2.18:5432/mes_prod',
  );
  const [linkedProjectId, setLinkedProjectId] = useState('');
  const [status, setStatus] = useState<LegacySystemConfig['status']>('CONNECTED');
  const [description, setDescription] = useState(
    '承载生产工单排程、质量批次报检与工序物料消耗的存量核心系统，待执行本体萃取与 MCP 封装。',
  );

  if (!data) return null;

  const openCreateModal = () => {
    setEditingId(null);
    setCode(`SYS-ENT-${String(data.legacySystems.length + 1).padStart(2, '0')}`);
    setName('存量采购寻源与供应商协同系统 (SRM)');
    setCategory('ERP / 业财一体');
    setDbDialect('PostgreSQL 16');
    setBaseUrl('http://127.0.0.1:4310/api/mock-legacy/srm');
    setDbConnectionUri('postgres://srm_ro@10.20.3.12:5432/srm_prod');
    setLinkedProjectId(data.activeProject.id);
    setStatus('CONNECTED');
    setDescription('管理招投标寻源、框架协议与供应商履约评分的存量业务系统。');
    setModalOpen(true);
  };

  const openEditModal = (sys: LegacySystemConfig) => {
    setEditingId(sys.id);
    setCode(sys.code);
    setName(sys.name);
    setCategory(sys.category);
    setDbDialect(sys.dbDialect);
    setBaseUrl(sys.baseUrl);
    setDbConnectionUri(sys.dbConnectionUri);
    setLinkedProjectId(sys.linkedProjectId);
    setStatus(sys.status);
    setDescription(sys.description);
    setModalOpen(true);
  };

  const handleSaveSystem = async () => {
    if (!code.trim() || !name.trim()) return;
    const payload: LegacySystemConfig = {
      id:
        editingId ??
        `sys-${code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`,
      code: code.trim(),
      name: name.trim(),
      category: category.trim(),
      baseUrl: baseUrl.trim(),
      dbDialect: dbDialect.trim(),
      dbConnectionUri: dbConnectionUri.trim(),
      status,
      linkedProjectId: linkedProjectId || data.activeProject.id,
      description: description.trim(),
    };
    const json = await apiPostJson<{ legacySystems: LegacySystemConfig[] }>(
      '/api/capability/systems',
      payload,
    );
    patchData({ legacySystems: json.legacySystems });
    setModalOpen(false);
    showToast(
      editingId
        ? t(`已更新存量系统「${payload.name}」配置`, `Updated legacy system "${payload.name}"`)
        : t(`已接入存量业务系统「${payload.name}」`, `Registered legacy system "${payload.name}"`),
    );
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const json = await apiDeleteResource<{ legacySystems: LegacySystemConfig[] }>(
        `/api/capability/systems/${deleteTarget.id}`,
      );
      patchData({ legacySystems: json.legacySystems });
      showToast(t(`已移除存量系统「${deleteTarget.name}」`, `Deleted system "${deleteTarget.name}"`));
      setDeleteTarget(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
      setDeleteTarget(null);
    }
  };

  const columns: RegistryColumn<LegacySystemConfig>[] = [
    {
      key: 'code',
      header: t('系统编码', 'Code'),
      width: '130px',
      render: (sys) => <span className="font-mono font-semibold text-ink">{sys.code}</span>,
    },
    {
      key: 'name',
      header: t('系统名称与职责范围', 'System Name & Scope'),
      render: (sys) => (
        <div>
          <div className="font-semibold text-ink">{sys.name}</div>
          <div className="text-[11.5px] text-ink-3">{sys.description}</div>
        </div>
      ),
    },
    {
      key: 'category',
      header: t('分类 / 方言', 'Category / DB'),
      render: (sys) => (
        <div className="text-[12px]">
          <div>{sys.category}</div>
          <div className="font-mono text-[11px] text-ink-3">{sys.dbDialect}</div>
        </div>
      ),
    },
    {
      key: 'project',
      header: t('关联本体工程', 'Linked Project'),
      render: (sys) => {
        const linkedProj = data.projects.find((p) => p.id === sys.linkedProjectId);
        return (
          <span className="badge badge-accent">
            {linkedProj ? linkedProj.name : sys.linkedProjectId}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: t('本体化状态', 'Status'),
      render: (sys) => (
        <span
          className={`badge ${
            sys.status === 'MCP_ACTIVE'
              ? 'badge-ok'
              : sys.status === 'EXTRACTED'
                ? 'badge-accent'
                : 'badge-warn'
          }`}
        >
          {sys.status}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('操作', 'Actions'),
      align: 'right',
      render: (sys) => (
        <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Button variant="secondary" size="xs" onClick={() => openEditModal(sys)}>
            <Edit3 size={11.5} />
            {t('编辑', 'Edit')}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setDeleteTarget(sys)}>
            <Trash2 size={11.5} className="text-red" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="form-grid-3">
        <div className="card">
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            {t('已接入存量业务系统', 'Registered Legacy Systems')}
          </div>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 600, marginTop: 4 }}>
            {data.legacySystems.length}
          </div>
        </div>
        <div className="card">
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            {t('已完成本体萃取系统', 'Ontology Extracted Systems')}
          </div>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 600, marginTop: 4 }}>
            {data.legacySystems.filter((s) => s.status !== 'CONNECTED').length}
          </div>
        </div>
        <div className="card">
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            {t('MCP 服务在线封装数', 'Active MCP Wrapped Systems')}
          </div>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 600, marginTop: 4 }}>
            {data.legacySystems.filter((s) => s.status === 'MCP_ACTIVE').length}
          </div>
        </div>
      </div>

      <RegistryTable
        title={t('存量业务系统接入注册表 (Legacy Systems Registry)', 'Connected Enterprise Systems')}
        subtitle={t(
          '接入既有 ERP、MES、MFT、OA 等存量系统，进行本体萃取与 Agent 化升级',
          'Register existing ERP, MES, MFT, and OA systems for Ontology Extraction and MCP wrapping',
        )}
        rows={data.legacySystems}
        getRowKey={(s) => s.id}
        columns={columns}
        searchPlaceholder={t('检索系统编码、名称、分类或地址…', 'Search code, name, category…')}
        matchesSearch={(s, q) =>
          s.code.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q) ||
          s.baseUrl.toLowerCase().includes(q)
        }
        statusFilters={[
          { value: 'ALL', label: t('全部', 'All') },
          { value: 'CONNECTED', label: 'CONNECTED' },
          { value: 'EXTRACTED', label: 'EXTRACTED' },
          { value: 'MCP_ACTIVE', label: 'MCP_ACTIVE' },
        ]}
        getRowStatus={(s) => s.status}
        primaryActionLabel={t('接入存量业务系统', 'Register Legacy System')}
        onPrimaryAction={openCreateModal}
        testId="legacy-systems-registry"
      />

      <ConfirmDialog
        open={modalOpen}
        title={
          editingId
            ? t('编辑存量业务系统配置', 'Edit Legacy System')
            : t('接入存量业务系统', 'Register Legacy Business System')
        }
        confirmLabel={t('保存存量系统配置', 'Save System')}
        onConfirm={() => void handleSaveSystem()}
        onClose={() => setModalOpen(false)}
      >
        <div className="form-grid-2">
          <div className="form-field">
            <label className="form-label">{t('系统编码', 'System Code')} *</label>
            <input className="input" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">{t('系统名称', 'System Name')} *</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">{t('系统分类', 'System Category')}</label>
            <select
              className="select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="ERP / 业财一体">ERP / 业财一体</option>
              <option value="MES / 生产制造">MES / 生产制造</option>
              <option value="MFT / 安全基础设施">MFT / 安全基础设施</option>
              <option value="OA / 协同办公">OA / 协同办公</option>
              <option value="SRM / 供应链采购">SRM / 供应链采购</option>
            </select>
          </div>
          <div className="form-field">
            <label className="form-label">{t('关联目标本体工程', 'Linked Ontology Project')}</label>
            <select
              className="select"
              value={linkedProjectId || data.activeProject.id}
              onChange={(e) => setLinkedProjectId(e.target.value)}
            >
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label className="form-label">{t('数据库方言', 'Database Dialect')}</label>
            <input
              className="input"
              value={dbDialect}
              onChange={(e) => setDbDialect(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label className="form-label">{t('本体化阶段状态', 'Ontology Status')}</label>
            <select
              className="select"
              value={status}
              onChange={(e) => setStatus(e.target.value as LegacySystemConfig['status'])}
            >
              <option value="CONNECTED">CONNECTED (已连通待萃取)</option>
              <option value="EXTRACTED">EXTRACTED (已完成本体萃取)</option>
              <option value="MCP_ACTIVE">MCP_ACTIVE (已发布 MCP 服务)</option>
            </select>
          </div>
          <div className="form-field">
            <label className="form-label">{t('REST / 网关地址', 'Service Base URL')}</label>
            <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">{t('只读元数据连接串', 'DB Connection URI')}</label>
            <input
              className="input"
              value={dbConnectionUri}
              onChange={(e) => setDbConnectionUri(e.target.value)}
            />
          </div>
        </div>
        <div className="form-field">
          <label className="form-label">{t('业务职责与萃取范围说明', 'System Scope & Notes')}</label>
          <textarea
            className="textarea"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t('移除存量系统配置', 'Delete Legacy System')}
        description={
          deleteTarget
            ? t(
                `确认移除存量系统「${deleteTarget.name} (${deleteTarget.code})」吗？`,
                `Delete legacy system "${deleteTarget.name} (${deleteTarget.code})"?`,
              )
            : ''
        }
        confirmLabel={t('确认移除', 'Delete')}
        danger
        onConfirm={() => void handleConfirmDelete()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ─── 2. Capability Center: Two-Round Ontology Extraction (本体萃取工作台) ─────

const EXTRACTION_PRESETS: {
  id: string;
  labelZh: string;
  labelEn: string;
  title: string;
  sourceType: 'DDL_AND_OPENAPI' | 'SOURCE_CODE' | 'LOG_AND_DOC';
  snippet: string;
}[] = [
  {
    id: 'amendment-ddl-openapi',
    labelZh: '模板 1：合同变更 DDL + OpenAPI',
    labelEn: 'Preset 1: Contract Amendment DDL + OpenAPI',
    title: '增量合同变更表与审批接口本体萃取',
    sourceType: 'DDL_AND_OPENAPI',
    snippet: `CREATE TABLE t_contract_amendment (
  id VARCHAR(36) PRIMARY KEY,
  contract_id VARCHAR(36) NOT NULL,
  amendment_no VARCHAR(32) NOT NULL,
  delta_amount DECIMAL(18,2) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  approval_status VARCHAR(24) NOT NULL
);

{
  "openapi": "3.0.3",
  "paths": {
    "/api/v1/contracts/amend": {
      "post": {
        "operationId": "submitContractAmendment",
        "summary": "提交合同补充协议变更并触发法务会签"
      }
    }
  }
}`,
  },
  {
    id: 'supplier-eval-ddl',
    labelZh: '模板 2：供应商履约评价 DDL + 接口',
    labelEn: 'Preset 2: Supplier Evaluation DDL + API',
    title: '供应商季度履约评分表与准入接口本体萃取',
    sourceType: 'DDL_AND_OPENAPI',
    snippet: `CREATE TABLE t_supplier_evaluation (
  id VARCHAR(36) PRIMARY KEY,
  counterparty_id VARCHAR(36) NOT NULL,
  eval_period VARCHAR(16) NOT NULL,
  delivery_score DECIMAL(5,2) NOT NULL,
  credit_grade VARCHAR(8) NOT NULL
);

POST /api/v1/suppliers/evaluate -> evaluateSupplierCredit`,
  },
  {
    id: 'mft-audit-source',
    labelZh: '模板 3：跨网传输审计日志与制度规范',
    labelEn: 'Preset 3: MFT Security Audit Spec',
    title: 'MFT 跨安全域审计流水与校验规则本体萃取',
    sourceType: 'LOG_AND_DOC',
    snippet: `CREATE TABLE t_mft_security_audit (
  audit_id VARCHAR(36) PRIMARY KEY,
  work_order_no VARCHAR(32) NOT NULL,
  source_zone VARCHAR(32) NOT NULL,
  target_zone VARCHAR(32) NOT NULL,
  virus_scan_status VARCHAR(16) NOT NULL
);
POST /api/v1/mft/verify-audit -> verifyTransferSecurityAudit`,
  },
];

export function CapabilityExtractionView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [systemId, setSystemId] = useState<string>('');
  const [targetProjectId, setTargetProjectId] = useState<string>('');
  const [sourceType, setSourceType] = useState<'DDL_AND_OPENAPI' | 'SOURCE_CODE' | 'LOG_AND_DOC'>(
    'DDL_AND_OPENAPI',
  );
  const [title, setTitle] = useState(EXTRACTION_PRESETS[0]!.title);
  const [ddlSnippet, setDdlSnippet] = useState(EXTRACTION_PRESETS[0]!.snippet);
  const [applyImmediately, setApplyImmediately] = useState(true);
  const [busy, setBusy] = useState(false);
  const [applyingJobId, setApplyingJobId] = useState<string | null>(null);
  const [deleteTargetJob, setDeleteTargetJob] = useState<ExtractionJob | null>(null);

  useEffect(() => {
    if (data && !systemId && data.legacySystems[0]) {
      setSystemId(data.legacySystems[0].id);
    }
  }, [data, systemId]);

  useEffect(() => {
    if (data?.activeProject.id) {
      setTargetProjectId(data.activeProject.id);
    }
  }, [data?.activeProject.id]);

  if (!data) return null;

  const effectiveSystemId = systemId || data.legacySystems[0]?.id || 'sys-erp-contract';
  const effectiveProjectId = targetProjectId || data.activeProject.id;

  const handleSelectPreset = (presetId: string) => {
    const found = EXTRACTION_PRESETS.find((p) => p.id === presetId);
    if (!found) return;
    setTitle(found.title);
    setSourceType(found.sourceType);
    setDdlSnippet(found.snippet);
  };

  const handleRunExtraction = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const json = await apiPostJson<{
        job: ExtractionJob;
        project?: typeof data.activeProject;
        extractionJobs: ExtractionJob[];
      }>('/api/capability/extraction-jobs', {
        systemId: effectiveSystemId,
        projectId: effectiveProjectId,
        title,
        sourceType,
        sourceSnippet: ddlSnippet,
        applyImmediately,
      });
      if (json.project) {
        patchData({ activeProject: json.project, extractionJobs: json.extractionJobs });
      } else {
        patchData({ extractionJobs: json.extractionJobs });
      }
      showToast(
        applyImmediately
          ? `本体萃取任务已完成并合并至工程：${json.job.summary}`
          : `本体萃取候选模型已生成（两阶段复核模式）：${json.job.summary}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const handleApplyCandidateJob = async (jobId: string) => {
    setApplyingJobId(jobId);
    try {
      const json = await apiPostJson<{
        job: ExtractionJob;
        project?: typeof data.activeProject;
        extractionJobs: ExtractionJob[];
      }>(`/api/capability/extraction-jobs/${jobId}/apply`, {});
      if (json.project) {
        patchData({ activeProject: json.project, extractionJobs: json.extractionJobs });
      } else {
        patchData({ extractionJobs: json.extractionJobs });
      }
      showToast(`已将本体萃取候选结果合并至工程：${json.job.title}`);
    } finally {
      setApplyingJobId(null);
    }
  };

  const handleDeleteJob = async () => {
    if (!deleteTargetJob) return;
    const json = await apiDeleteResource<{ extractionJobs: ExtractionJob[] }>(
      `/api/capability/extraction-jobs/${deleteTargetJob.id}`,
    );
    patchData({ extractionJobs: json.extractionJobs });
    showToast(t(`已删除本体萃取记录「${deleteTargetJob.title}」`, 'Deleted extraction job'));
    setDeleteTargetJob(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              {t(
                '存量业务系统两轮本体萃取工作台 (Two-Round Ontology Extraction)',
                'Legacy System Two-Round Ontology Extraction Workbench',
              )}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t(
                '融合存量系统数据库表结构 (DDL)、OpenAPI 接口规范与领域文档，通过结构扫描与语义对齐两轮提炼 M1~MI 领域本体模型',
                'Two-round structural scan and semantic alignment over SQL DDL, OpenAPI specs, and domain docs to extract M1-MI ontology models',
              )}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="run-extraction-btn"
            disabled={busy}
            onClick={() => void handleRunExtraction()}
          >
            {busy
              ? t('正在执行本体萃取...', 'Extracting Ontology...')
              : t('执行本体萃取任务', 'Run Ontology Extraction')}
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '8px 10px',
            marginBottom: 12,
            borderRadius: 6,
            background: 'var(--surface-2)',
            border: '1px solid var(--line)',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)' }}>
              {t('快速载入萃取样例：', 'Load Sample Input:')}
            </span>
            {EXTRACTION_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="btn btn-sm"
                onClick={() => handleSelectPreset(preset.id)}
              >
                {t(preset.labelZh, preset.labelEn)}
              </button>
            ))}
          </div>

          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            <input
              type="checkbox"
              checked={applyImmediately}
              onChange={(e) => setApplyImmediately(e.target.checked)}
            />
            <span>
              {t(
                '萃取后立即合并至目标工程（取消勾选启用两阶段候选复核）',
                'Apply immediately to project (uncheck for Two-Stage Review)',
              )}
            </span>
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.08fr 0.92fr', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="form-grid-3">
              <div className="form-field">
                <label className="form-label">{t('源存量业务系统', 'Source Legacy System')}</label>
                <select
                  className="select"
                  value={effectiveSystemId}
                  onChange={(e) => setSystemId(e.target.value)}
                >
                  {data.legacySystems.map((sys) => (
                    <option key={sys.id} value={sys.id}>
                      {sys.name} ({sys.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label className="form-label">{t('目标本体工程', 'Target Ontology Project')}</label>
                <select
                  className="select"
                  value={effectiveProjectId}
                  onChange={(e) => setTargetProjectId(e.target.value)}
                >
                  {data.projects.map((proj) => (
                    <option key={proj.id} value={proj.id}>
                      {proj.name} ({proj.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label className="form-label">{t('输入资产源类型', 'Input Source Type')}</label>
                <select
                  className="select"
                  value={sourceType}
                  onChange={(e) =>
                    setSourceType(
                      e.target.value as 'DDL_AND_OPENAPI' | 'SOURCE_CODE' | 'LOG_AND_DOC',
                    )
                  }
                >
                  <option value="DDL_AND_OPENAPI">DDL_AND_OPENAPI (库表+接口规范)</option>
                  <option value="SOURCE_CODE">SOURCE_CODE (领域服务代码)</option>
                  <option value="LOG_AND_DOC">LOG_AND_DOC (审计日志+制度文档)</option>
                </select>
              </div>
            </div>

            <div className="form-field">
              <label className="form-label">{t('本体萃取任务名称', 'Extraction Task Title')}</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div className="form-field">
              <label className="form-label">
                {t(
                  '第一轮结构扫描 & 第二轮语义对齐输入片段 (SQL DDL / OpenAPI JSON)',
                  'Source SQL DDL / OpenAPI JSON / Domain Spec Snippet',
                )}
              </label>
              <textarea
                className="textarea mono"
                style={{ minHeight: 220 }}
                value={ddlSnippet}
                onChange={(e) => setDdlSnippet(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                {t('本体萃取任务与候选复核队列', 'Ontology Extraction Jobs & Review Queue')} (
                {data.extractionJobs.length})
              </span>
              <span className="badge badge-accent">
                {applyImmediately
                  ? t('直通合并模式', 'Auto-Merge')
                  : t('两阶段复核模式', 'Two-Stage Review')}
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                maxHeight: 380,
                overflowY: 'auto',
              }}
            >
              {data.extractionJobs.map((job) => {
                const entitiesCnt =
                  job.extractedEntitiesCount ?? job.candidateSuite?.M1?.aggregates.length ?? 0;
                const tablesCnt =
                  job.extractedTablesCount ?? job.candidateSuite?.MM?.mappings.length ?? 0;
                const ifacesCnt =
                  job.extractedInterfacesCount ?? job.candidateSuite?.MI?.interfaces.length ?? 0;
                const isApplied = job.appliedToProject !== false;

                return (
                  <div
                    key={job.id}
                    style={{
                      padding: 10,
                      borderRadius: 6,
                      background: 'var(--surface-2)',
                      border: '1px solid var(--line)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: 8,
                      }}
                    >
                      <div>
                        <strong>{job.title}</strong>
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--muted)',
                            fontFamily: 'var(--mono)',
                          }}
                        >
                          {job.sourceType} · Project: {job.projectId}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
                        <span className="badge badge-ok">
                          {(job.confidenceScore * 100).toFixed(0)}%
                        </span>
                        <span className={`badge ${isApplied ? 'badge-ok' : 'badge-warn'}`}>
                          {isApplied
                            ? t('已合并至工程', 'Merged')
                            : t('待复核候选', 'Pending Review')}
                        </span>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => setDeleteTargetJob(job)}
                          title={t('删除任务记录', 'Delete job')}
                        >
                          <Trash2 size={11.5} className="text-red" />
                        </Button>
                      </div>
                    </div>

                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{job.summary}</div>

                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 6,
                        fontSize: 11.5,
                        fontFamily: 'var(--mono)',
                      }}
                    >
                      <span className="badge">M1 实体: {entitiesCnt}</span>
                      <span className="badge">MM 映射表: {tablesCnt}</span>
                      <span className="badge">MI 接口: {ifacesCnt}</span>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {job.extractedModels.map((m) => (
                          <span key={m} className="badge badge-accent">
                            {m}
                          </span>
                        ))}
                      </div>

                      {!isApplied && (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          disabled={applyingJobId === job.id}
                          onClick={() => void handleApplyCandidateJob(job.id)}
                        >
                          {applyingJobId === job.id
                            ? t('正在合并...', 'Merging...')
                            : t('合并候选本体至工程', 'Merge Candidate Ontology')}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTargetJob)}
        title={t('删除本体萃取记录', 'Delete Extraction Job')}
        description={
          deleteTargetJob
            ? t(
                `确认删除萃取任务记录「${deleteTargetJob.title}」吗？已合并入 11 模型的本体元素将保留。`,
                `Delete extraction job "${deleteTargetJob.title}"? Merged ontology elements remain intact.`,
              )
            : ''
        }
        confirmLabel={t('确认删除', 'Delete')}
        danger
        onConfirm={() => void handleDeleteJob()}
        onClose={() => setDeleteTargetJob(null)}
      />
    </div>
  );
}

// ─── 3. Capability Center: Dynamic MCP Server Hub & Registry ─────────────────

const DEFAULT_CONTRACT_TOOL_ARGS = JSON.stringify(
  {
    title: 'AI算力集群扩容采购合同',
    contractType: 'PROCUREMENT',
    counterpartyId: 'CP-001',
    totalAmount: 1650000,
    creditRating: 'AAA',
  },
  null,
  2,
);

function buildSampleArgsForMcpTool(tool: McpToolDefinition): string {
  if (tool.name === 'm2_draftContract') {
    return DEFAULT_CONTRACT_TOOL_ARGS;
  }
  const sample: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(tool.inputSchema.properties)) {
    if (key === 'modelCode') sample[key] = 'M1';
    else if (key === 'symbolId') sample[key] = 'Contract';
    else if (prop.type === 'number') sample[key] = 500000;
    else if (prop.type === 'integer') sample[key] = 10;
    else if (prop.type === 'boolean') sample[key] = true;
    else sample[key] = `${key}_sample`;
  }
  return JSON.stringify(sample, null, 2);
}

export function CapabilityMcpView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [viewMode, setViewMode] = useState<'DEBUGGER' | 'REGISTRY'>('DEBUGGER');
  const [inspectedProjectId, setInspectedProjectId] = useState<string>('');
  const [caps, setCaps] = useState<{
    tools: McpToolDefinition[];
    resources: McpResourceDefinition[];
    clientConfigJson?: string;
  } | null>(null);
  const [toolFilter, setToolFilter] = useState<'ALL' | 'M2' | 'M7' | 'MI' | 'META'>('ALL');
  const [selectedTool, setSelectedTool] = useState<string>('m2_draftContract');
  const [toolArgsJson, setToolArgsJson] = useState<string>(DEFAULT_CONTRACT_TOOL_ARGS);
  const [rpcResponse, setRpcResponse] = useState<string>('');
  const [selectedResourceUri, setSelectedResourceUri] = useState<string | null>(null);
  const [resourcePreviewText, setResourcePreviewText] = useState<string>('');

  // Registry modal / delete state
  const [createOpen, setCreateOpen] = useState(false);
  const [mcpName, setMcpName] = useState('');
  const [mcpProjectId, setMcpProjectId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{
    item: McpServerConfig;
    force?: boolean;
    conflictMsg?: string;
  } | null>(null);

  useEffect(() => {
    if (data?.activeProject.id) {
      setInspectedProjectId(data.activeProject.id);
    }
  }, [data?.activeProject.id]);

  const projectId = inspectedProjectId || data?.activeProject.id || 'proj-contract';

  useEffect(() => {
    let cancelled = false;
    apiInspectMcp(projectId).then((res) => {
      if (cancelled) return;
      setCaps(res);
      const preferred =
        res.tools.find((item) => item.name === 'm2_draftContract') ?? res.tools[0];
      if (preferred) {
        setSelectedTool((prev) => {
          if (res.tools.some((item) => item.name === prev)) return prev;
          setToolArgsJson(buildSampleArgsForMcpTool(preferred));
          return preferred.name;
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const filteredTools = useMemo(() => {
    const all = caps?.tools ?? [];
    if (toolFilter === 'ALL') return all;
    if (toolFilter === 'META') {
      return all.filter((item) => item.name.startsWith('ontology_'));
    }
    return all.filter(
      (item) => !item.name.startsWith('ontology_') && item.sourceModel === toolFilter,
    );
  }, [caps?.tools, toolFilter]);

  if (!data) return null;

  const handleSelectTool = (tool: McpToolDefinition) => {
    setSelectedTool(tool.name);
    setToolArgsJson(buildSampleArgsForMcpTool(tool));
  };

  const handleInvokeTool = async () => {
    try {
      const parsedArgs = JSON.parse(toolArgsJson) as Record<string, unknown>;
      const res = await apiCallMcpTool(projectId, selectedTool, parsedArgs);
      setRpcResponse(JSON.stringify(res, null, 2));
      showToast(`已通过 JSON-RPC 2.0 调用 MCP 工具 ${selectedTool}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  const handleReadResource = async (uri: string) => {
    setSelectedResourceUri(uri);
    const res = await fetch(`/api/mcp/${projectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'resources/read',
        params: { uri },
      }),
    });
    const json = await res.json();
    const contentText = json?.result?.contents?.[0]?.text ?? JSON.stringify(json, null, 2);
    setResourcePreviewText(contentText);
    setRpcResponse(JSON.stringify(json, null, 2));
    showToast(`已读取本体 MCP 资源 ${uri}`);
  };

  const handleCopyClientConfig = async () => {
    const configStr =
      caps?.clientConfigJson ??
      JSON.stringify(
        {
          mcpServers: {
            [`ontology-${projectId}`]: {
              transport: 'http',
              url: `http://127.0.0.1:4310/api/mcp/${projectId}`,
            },
          },
        },
        null,
        2,
      );
    try {
      await navigator.clipboard?.writeText(configStr);
      showToast(t('已复制 mcpServers 客户端配置 JSON', 'Copied mcpServers client config JSON'));
    } catch {
      triggerBrowserDownload(`mcp-client-${projectId}.json`, configStr, 'application/json');
      showToast(t('已导出 mcpServers 客户端配置 JSON', 'Downloaded mcpServers client config JSON'));
    }
  };

  const handlePublishMcpForProject = async () => {
    const targetProj = mcpProjectId || data.activeProject.id;
    const json = await apiPostJson<{ mcp: McpServerConfig; mcpServers: McpServerConfig[] }>(
      `/api/projects/${targetProj}/publish-mcp`,
      {},
    );
    if (mcpName.trim()) {
      const renamed = await apiPostJson<{ mcpServers: McpServerConfig[] }>('/api/mcp-servers', {
        ...json.mcp,
        name: mcpName.trim(),
      });
      patchData({ mcpServers: renamed.mcpServers });
    } else {
      patchData({ mcpServers: json.mcpServers });
    }
    setCreateOpen(false);
    setMcpName('');
    showToast(t('已编译并注册动态本体 MCP 服务', 'Published Ontology MCP Server'));
  };

  const handleToggleMcpStatus = async (srv: McpServerConfig) => {
    const nextStatus: McpServerConfig['status'] = srv.status === 'ONLINE' ? 'STOPPED' : 'ONLINE';
    const json = await apiPostJson<{ mcpServers: McpServerConfig[] }>('/api/mcp-servers', {
      ...srv,
      status: nextStatus,
    });
    patchData({ mcpServers: json.mcpServers });
    showToast(t(`MCP 服务已切换为 ${nextStatus}`, `MCP Server switched to ${nextStatus}`));
  };

  const handleConfirmDeleteMcp = async () => {
    if (!deleteTarget) return;
    try {
      const qs = deleteTarget.force ? '?force=1' : '';
      const json = await apiDeleteResource<{ mcpServers: McpServerConfig[] }>(
        `/api/mcp-servers/${deleteTarget.item.id}${qs}`,
      );
      patchData({ mcpServers: json.mcpServers });
      setDeleteTarget(null);
      showToast(t(`已移除 MCP 服务「${deleteTarget.item.name}」`, 'Deleted MCP server'));
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 409 && !deleteTarget.force) {
        setDeleteTarget({
          item: deleteTarget.item,
          force: true,
          conflictMsg: err instanceof Error ? err.message : String(err),
        });
      } else {
        showToast(err instanceof Error ? err.message : String(err));
        setDeleteTarget(null);
      }
    }
  };

  const registryColumns: RegistryColumn<McpServerConfig>[] = [
    {
      key: 'name',
      header: t('MCP 服务名称', 'MCP Server'),
      render: (srv) => (
        <div>
          <div className="font-semibold text-ink">{srv.name}</div>
          <div className="font-mono text-[11px] text-ink-3">{srv.endpoint}</div>
        </div>
      ),
    },
    {
      key: 'project',
      header: t('源本体工程', 'Ontology Project'),
      render: (srv) => <span className="badge badge-accent">{srv.projectId}</span>,
    },
    {
      key: 'caps',
      header: t('Tools / Resources', 'Capabilities'),
      render: (srv) => (
        <span className="font-mono text-[12px]">
          {srv.toolsCount} tools · {srv.resourcesCount} resources
        </span>
      ),
    },
    {
      key: 'status',
      header: t('运行状态', 'Status'),
      render: (srv) => (
        <span className={`badge ${srv.status === 'ONLINE' ? 'badge-ok' : 'badge-warn'}`}>
          {srv.status}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('操作', 'Actions'),
      align: 'right',
      render: (srv) => (
        <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => {
              setInspectedProjectId(srv.projectId);
              setViewMode('DEBUGGER');
            }}
          >
            <Activity size={11.5} />
            {t('调试', 'Inspect')}
          </Button>
          <Button variant="secondary" size="xs" onClick={() => void handleToggleMcpStatus(srv)}>
            {srv.status === 'ONLINE' ? t('下线', 'Disable') : t('上线', 'Enable')}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setDeleteTarget({ item: srv })}>
            <Trash2 size={11.5} className="text-red" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Top Mode Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-window border border-line bg-surface px-4 py-2.5 shadow-2xs">
        <div className="inline-flex items-center gap-1 rounded-control bg-inset p-1">
          <button
            type="button"
            onClick={() => setViewMode('DEBUGGER')}
            className={`btn btn-sm ${viewMode === 'DEBUGGER' ? 'btn-primary' : ''}`}
          >
            <Activity size={13} />
            {t('MCP JSON-RPC 在线调试台', 'JSON-RPC Inspector')}
          </button>
          <button
            type="button"
            onClick={() => setViewMode('REGISTRY')}
            className={`btn btn-sm ${viewMode === 'REGISTRY' ? 'btn-primary' : ''}`}
            data-testid="mcp-mode-registry-btn"
          >
            <Server size={13} />
            {t('MCP 服务管理注册表', 'MCP Server Registry')} ({data.mcpServers.length})
          </button>
        </div>

        <Button
          variant="accent"
          size="sm"
          onClick={() => {
            setMcpProjectId(data.activeProject.id);
            setMcpName(`${data.activeProject.name} MCP Server`);
            setCreateOpen(true);
          }}
        >
          <Plus size={13} />
          {t('发布/注册本体 MCP 服务', 'Publish MCP Server')}
        </Button>
      </div>

      {viewMode === 'REGISTRY' ? (
        <RegistryTable
          title={t('动态本体 MCP 服务注册表', 'Ontology MCP Servers Registry')}
          subtitle={t(
            '集中管理从 11 元模型自动暴露的 JSON-RPC 2.0 MCP 服务端点与在线状态',
            'Manage JSON-RPC 2.0 MCP server endpoints compiled from Ontology Suites',
          )}
          rows={data.mcpServers}
          getRowKey={(s) => s.id}
          columns={registryColumns}
          matchesSearch={(s, q) =>
            s.name.toLowerCase().includes(q) ||
            s.endpoint.toLowerCase().includes(q) ||
            s.projectId.toLowerCase().includes(q)
          }
          statusFilters={[
            { value: 'ALL', label: t('全部', 'All') },
            { value: 'ONLINE', label: 'ONLINE' },
            { value: 'STOPPED', label: 'STOPPED' },
          ]}
          getRowStatus={(s) => s.status}
          testId="mcp-servers-registry"
        />
      ) : (
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">
                {t(
                  '动态本体 MCP Server 服务中心与 JSON-RPC 调试台',
                  'Dynamic Ontology MCP Server Hub & Inspector',
                )}
              </h3>
              <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                POST /api/mcp/{projectId} · Tools: {caps?.tools.length ?? 0} · Resources:{' '}
                {caps?.resources.length ?? 0}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <select
                className="select"
                style={{ width: 220 }}
                value={projectId}
                onChange={(e) => {
                  setInspectedProjectId(e.target.value);
                  setSelectedResourceUri(null);
                  setResourcePreviewText('');
                }}
              >
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
              <span className="badge badge-ok">JSON-RPC 2.0 ONLINE</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                    gap: 6,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>
                    {t('本体自动映射 MCP 工具列表 (M2 / M7 / MI / Meta)', 'Mapped MCP Tools')}
                  </span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(['ALL', 'M2', 'M7', 'MI', 'META'] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        className={`btn btn-sm ${toolFilter === f ? 'btn-primary' : ''}`}
                        onClick={() => setToolFilter(f)}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    maxHeight: 250,
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  {filteredTools.map((tool) => (
                    <div
                      key={tool.name}
                      onClick={() => handleSelectTool(tool)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 5,
                        cursor: 'pointer',
                        background:
                          selectedTool === tool.name ? 'var(--accent-soft)' : 'var(--surface-2)',
                        border: '1px solid var(--line)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                        <strong style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
                          {tool.name}
                        </strong>
                        <span className="badge badge-accent">
                          {tool.name.startsWith('ontology_') ? 'Meta' : tool.sourceModel}
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>
                        {tool.description}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  {t(
                    '本体只读资源列表 (manifest.json + 11 元模型 YAML URIs · 点击在线读取)',
                    'MCP Resources (Click URI to preview resources/read)',
                  )}
                </div>
                <div
                  style={{
                    maxHeight: 190,
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                  }}
                >
                  {(caps?.resources ?? []).map((resItem) => (
                    <button
                      key={resItem.uri}
                      type="button"
                      onClick={() => void handleReadResource(resItem.uri)}
                      style={{
                        textAlign: 'left',
                        padding: '6px 10px',
                        borderRadius: 5,
                        cursor: 'pointer',
                        background:
                          selectedResourceUri === resItem.uri
                            ? 'var(--accent-soft)'
                            : 'var(--surface-2)',
                        border: '1px solid var(--line)',
                        color: 'var(--ink)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, fontWeight: 600 }}>
                          {resItem.uri}
                        </span>
                        <span className="badge">{resItem.mimeType}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        {resItem.name} — {resItem.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <strong style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>
                  tools/call → {selectedTool}
                </strong>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  data-testid="invoke-mcp-tool-btn"
                  onClick={() => void handleInvokeTool()}
                >
                  {t('发送 JSON-RPC 调用请求', 'Invoke MCP Tool')}
                </button>
              </div>

              <textarea
                className="textarea mono"
                style={{ minHeight: 125 }}
                value={toolArgsJson}
                onChange={(e) => setToolArgsJson(e.target.value)}
              />

              {rpcResponse && (
                <div data-testid="mcp-rpc-response">
                  <CodeBlock
                    code={rpcResponse}
                    language="json"
                    filename="JSON-RPC 2.0 Response"
                    maxHeight={190}
                  />
                </div>
              )}

              {resourcePreviewText && (
                <CodeBlock
                  code={resourcePreviewText}
                  language="yaml"
                  filename={selectedResourceUri ?? 'resources/read'}
                  maxHeight={150}
                />
              )}

              <div
                style={{
                  padding: 10,
                  background: 'var(--surface-2)',
                  borderRadius: 6,
                  border: '1px solid var(--line)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 6,
                  }}
                >
                  <strong style={{ fontSize: 12 }}>
                    {t(
                      '标准 mcpServers 客户端接入配置 (Client Config JSON)',
                      'Client mcpServers Config JSON',
                    )}
                  </strong>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void handleCopyClientConfig()}
                  >
                    {t('复制配置 JSON', 'Copy JSON')}
                  </button>
                </div>
                <CodeBlock code={caps?.clientConfigJson ?? '{}'} language="json" maxHeight={125} />
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={createOpen}
        title={t('发布并注册动态本体 MCP 服务', 'Publish Ontology MCP Server')}
        confirmLabel={t('发布 MCP 服务', 'Publish')}
        onConfirm={() => void handlePublishMcpForProject()}
        onClose={() => setCreateOpen(false)}
      >
        <div className="form-field">
          <label className="form-label">{t('源本体工程', 'Source Ontology Project')}</label>
          <select
            className="select"
            value={mcpProjectId || data.activeProject.id}
            onChange={(e) => setMcpProjectId(e.target.value)}
          >
            {data.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.code})
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label className="form-label">{t('MCP 服务显示名称', 'Display Name')}</label>
          <input className="input" value={mcpName} onChange={(e) => setMcpName(e.target.value)} />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t('移除 MCP 服务配置', 'Delete MCP Server')}
        description={
          deleteTarget?.conflictMsg
            ? `${deleteTarget.conflictMsg} — ${t('确认强制解除关联并删除吗？', 'Force detach and delete?')}`
            : deleteTarget
              ? t(`确认移除「${deleteTarget.item.name}」吗？`, `Delete "${deleteTarget.item.name}"?`)
              : ''
        }
        confirmLabel={deleteTarget?.force ? t('强制解绑并删除', 'Force Delete') : t('确认删除', 'Delete')}
        danger
        onConfirm={() => void handleConfirmDeleteMcp()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ─── 4. Capability Center: Agent Registry + Live Streaming Smart Chat ────────

export function CapabilityAgentsView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');

  // Create / Edit Agent Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CapabilityAgent | null>(null);
  const [agentName, setAgentName] = useState('采购合规与跨网归档协同智能体');
  const [agentRole, setAgentRole] = useState('业财法务风控与 MFT 安全归档专家');
  const [agentProjectId, setAgentProjectId] = useState('');
  const [selectedMcpIds, setSelectedMcpIds] = useState<string[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [agentModelId, setAgentModelId] = useState('auto/glm-5.3-flash');
  const [agentSystemPrompt, setAgentSystemPrompt] = useState('');

  useEffect(() => {
    if (data && !selectedAgentId && data.capabilityAgents[0]) {
      setSelectedAgentId(data.capabilityAgents[0].id);
    }
  }, [data, selectedAgentId]);

  const activeAgent = useMemo(() => {
    if (!data) return undefined;
    return (
      data.capabilityAgents.find((a) => a.id === selectedAgentId) ?? data.capabilityAgents[0]
    );
  }, [data, selectedAgentId]);

  if (!data) return null;

  const openNewAgentModal = () => {
    const proj = data.activeProject;
    const ruleIds = (proj.suite.M3?.rules ?? []).map((r) => r.id).join('、') || 'RULE-01';
    setEditingAgentId(null);
    setAgentProjectId(proj.id);
    setAgentName(`${proj.name}协同智能体`);
    setAgentRole(`${proj.domain}合规审查与自动化编排专家`);
    setAgentSystemPrompt(
      `你是基于「${proj.name}」11 元模型驱动的企业协同智能体。执行领域命令工具前必须核验 M3 规则红线（${ruleIds}）。`,
    );
    setSelectedMcpIds(data.mcpServers.slice(0, 1).map((m) => m.id));
    setSelectedSkillIds(data.generatedSkills.slice(0, 1).map((s) => s.id));
    setAgentModelId(
      (data.llmProviders.find((p) => p.enabled) ?? data.llmProviders[0])?.defaultModel ??
        'auto/glm-5.3-flash',
    );
    setModalOpen(true);
  };

  const openEditAgentModal = (ag: CapabilityAgent) => {
    setEditingAgentId(ag.id);
    setAgentProjectId(ag.projectId);
    setAgentName(ag.name);
    setAgentRole(ag.role);
    setAgentSystemPrompt(ag.systemPrompt);
    setSelectedMcpIds(ag.mcpIds);
    setSelectedSkillIds(ag.skillIds);
    setAgentModelId(ag.modelId);
    setModalOpen(true);
  };

  const toggleItemInList = (list: string[], id: string, setter: (next: string[]) => void) => {
    setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const handleSaveAgent = async () => {
    if (!agentName.trim()) return;
    const targetId = editingAgentId ?? `agent-${Date.now().toString(36)}`;
    const json = await apiPostJson<{ capabilityAgents: CapabilityAgent[] }>(
      '/api/capability/agents',
      {
        id: targetId,
        name: agentName.trim(),
        role: agentRole.trim(),
        projectId: agentProjectId || data.activeProject.id,
        mcpIds: selectedMcpIds.length > 0 ? selectedMcpIds : ['mcp-contract-server'],
        skillIds: selectedSkillIds.length > 0 ? selectedSkillIds : ['skill-contract-clm'],
        modelId: agentModelId,
        systemPrompt: agentSystemPrompt.trim(),
        status: 'ACTIVE',
      },
    );
    patchData({ capabilityAgents: json.capabilityAgents });
    setSelectedAgentId(targetId);
    setModalOpen(false);
    showToast(
      editingAgentId
        ? t(`已更新智能体「${agentName}」`, `Updated agent "${agentName}"`)
        : t(`已创建能力中心智能体「${agentName}」`, `Created capability agent "${agentName}"`),
    );
  };

  const handleDeleteAgent = async () => {
    if (!deleteTarget) return;
    const json = await apiDeleteResource<{ capabilityAgents: CapabilityAgent[] }>(
      `/api/capability/agents/${deleteTarget.id}`,
    );
    patchData({ capabilityAgents: json.capabilityAgents });
    if (selectedAgentId === deleteTarget.id) {
      setSelectedAgentId(json.capabilityAgents[0]?.id ?? '');
    }
    showToast(t(`已移除智能体「${deleteTarget.name}」`, 'Deleted agent'));
    setDeleteTarget(null);
  };

  const availableModelOptions = Array.from(
    new Set([
      'auto/glm-5.3-flash',
      ...data.llmProviders.flatMap((p) => [p.defaultModel, ...p.availableModels]),
    ]),
  ).filter(Boolean);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '340px minmax(0, 1fr)', gap: 14 }}>
      {/* Left Column: Configured Capability Agents */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="card-header" style={{ marginBottom: 4 }}>
          <div>
            <h3 className="card-title">{t('领域能力智能体', 'Capability Agents')}</h3>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              {t('绑定本体 MCP 服务与 SKILL.md 规则包', 'Bound with Ontology MCPs & Skills')}
            </div>
          </div>
          <Button variant="accent" size="xs" onClick={openNewAgentModal}>
            <Plus size={12} />
            {t('新建智能体', 'New Agent')}
          </Button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.capabilityAgents.map((ag) => {
            const selected = ag.id === activeAgent?.id;
            return (
              <div
                key={ag.id}
                onClick={() => setSelectedAgentId(ag.id)}
                style={{
                  padding: 10,
                  borderRadius: 6,
                  cursor: 'pointer',
                  background: selected ? 'var(--accent-soft)' : 'var(--surface-2)',
                  border: `1px solid ${selected ? 'var(--accent)' : 'var(--line)'}`,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <strong className="inline-flex items-center gap-1.5">
                    <Bot size={13} className="text-accent" />
                    {ag.name}
                  </strong>
                  <div
                    className="inline-flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button variant="ghost" size="xs" onClick={() => openEditAgentModal(ag)}>
                      <Edit3 size={11} />
                    </Button>
                    {data.capabilityAgents.length > 1 && (
                      <Button variant="ghost" size="xs" onClick={() => setDeleteTarget(ag)}>
                        <Trash2 size={11} className="text-red" />
                      </Button>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', margin: '3px 0 6px 0' }}>
                  {ag.role}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  <span className="badge">{ag.modelId}</span>
                  {ag.mcpIds.map((id) => (
                    <span key={id} className="badge badge-accent">
                      {id}
                    </span>
                  ))}
                  {ag.skillIds.map((id) => (
                    <span key={id} className="badge badge-ok">
                      {id}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Column: Unified Pi Durable Multi-Session Streaming Workbench */}
      <AgentSessionWorkbench
        agentKind="CAPABILITY"
        targetId={activeAgent?.id}
        height={580}
        title={
          activeAgent
            ? `${activeAgent.name} (${t('实时 MCP 工具流式对话', 'Live MCP Smart Chat')})`
            : t('能力中心智能对话工作台', 'Capability Smart Chat')
        }
        subtitle={
          activeAgent
            ? `${activeAgent.role} · MCP: ${activeAgent.mcpIds.join(', ')} · Skills: ${activeAgent.skillIds.join(', ')}`
            : undefined
        }
        placeholder={t(
          '输入业务问题或执行指令（例如：请查询当前合同台账并核对大额合同资信准入规则）…',
          'Ask the capability agent or trigger an Ontology MCP tool…',
        )}
        inputTestId="smart-chat-input"
        sendBtnTestId="smart-chat-send-btn"
        toolLogTestId="smart-chat-tool-log"
      />

      <ConfirmDialog
        open={modalOpen}
        title={
          editingAgentId
            ? t('编辑能力中心智能体', 'Edit Capability Agent')
            : t('新建能力中心智能体 (绑定 MCP + Skill)', 'Create Capability Agent')
        }
        confirmLabel={t('保存智能体配置', 'Save Agent')}
        onConfirm={() => void handleSaveAgent()}
        onClose={() => setModalOpen(false)}
      >
        <div className="form-grid-2">
          <div className="form-field">
            <label className="form-label">{t('智能体名称', 'Agent Name')} *</label>
            <input
              className="input"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label className="form-label">{t('专家角色定位', 'Role Title')}</label>
            <input
              className="input"
              value={agentRole}
              onChange={(e) => setAgentRole(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label className="form-label">{t('所属本体工程', 'Primary Project')}</label>
            <select
              className="select"
              value={agentProjectId || data.activeProject.id}
              onChange={(e) => setAgentProjectId(e.target.value)}
            >
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label className="form-label">{t('推理大模型', 'LLM Model')}</label>
            <select
              className="select"
              value={agentModelId}
              onChange={(e) => setAgentModelId(e.target.value)}
            >
              {availableModelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-field">
          <label className="form-label">
            {t('挂载本体 MCP 服务 (可多选)', 'Mount Ontology MCP Servers')}
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {data.mcpServers.map((mcp) => (
              <label
                key={mcp.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 10px',
                  borderRadius: 5,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--line)',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedMcpIds.includes(mcp.id)}
                  onChange={() => toggleItemInList(selectedMcpIds, mcp.id, setSelectedMcpIds)}
                />
                <span>
                  {mcp.name} ({mcp.id})
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="form-field">
          <label className="form-label">
            {t('挂载领域 SKILL.md 技能包 (可多选)', 'Mount Domain Skills')}
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {data.generatedSkills.map((sk) => (
              <label
                key={sk.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 10px',
                  borderRadius: 5,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--line)',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedSkillIds.includes(sk.id)}
                  onChange={() =>
                    toggleItemInList(selectedSkillIds, sk.id, setSelectedSkillIds)
                  }
                />
                <span>
                  {sk.name} ({sk.slug})
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="form-field">
          <label className="form-label">{t('系统提示词与 M3 规则约束', 'System Prompt')}</label>
          <textarea
            className="textarea"
            rows={3}
            value={agentSystemPrompt}
            onChange={(e) => setAgentSystemPrompt(e.target.value)}
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t('删除能力中心智能体', 'Delete Capability Agent')}
        description={
          deleteTarget
            ? t(`确认删除智能体「${deleteTarget.name}」吗？`, `Delete "${deleteTarget.name}"?`)
            : ''
        }
        confirmLabel={t('确认删除', 'Delete')}
        danger
        onConfirm={() => void handleDeleteAgent()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ─── 5. Capability Center: Cross-System Orchestration Flows ──────────────────

export function CapabilityCrossFlowsView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [createOpen, setCreateOpen] = useState(false);
  const [flowName, setFlowName] = useState('高风险合同审批 → 财务冻结 → MFT 审计归档联防流');
  const [flowTrigger, setFlowTrigger] = useState('EVT-02 ContractApprovedWithHighRisk');
  const [flowDesc, setFlowDesc] = useState(
    '跨 ERP 合同中心、财务结算系统与 MFT 跨网安全网关的异构系统 MCP 事务编排链路。',
  );
  const [deleteTarget, setDeleteTarget] = useState<CrossSystemFlow | null>(null);

  if (!data) return null;

  const handleRunFlow = async (flowId: string) => {
    const json = await apiPostJson<{ crossSystemFlows: CrossSystemFlow[] }>(
      `/api/capability/flows/${flowId}/execute`,
      {},
    );
    patchData({ crossSystemFlows: json.crossSystemFlows });
    showToast('已执行跨系统 MCP 协同工作流，全部异构系统节点执行成功');
  };

  const handleCreateFlow = async () => {
    if (!flowName.trim()) return;
    const newFlow: CrossSystemFlow = {
      id: `flow-${Date.now().toString(36)}`,
      name: flowName.trim(),
      description: flowDesc.trim(),
      triggerEvent: flowTrigger.trim(),
      involvedSystems: data.legacySystems.slice(0, 2).map((s) => s.code),
      steps: [
        {
          stepOrder: 1,
          systemName: data.legacySystems[0]?.name ?? '存量合同管理系统',
          mcpToolName: 'm2_approveContract',
          description: '校验 M3 资信准入规则并落库审批快照',
          status: 'READY',
        },
        {
          stepOrder: 2,
          systemName: data.legacySystems[1]?.name ?? 'MFT 安全文件交换网关',
          mcpToolName: 'mi_archiveSignedContract',
          description: '跨安全域加密归档签章附件并记录审计流水',
          status: 'READY',
        },
      ],
      lastRunAt: '',
      lastRunStatus: 'IDLE',
      executionLogs: [`[${new Date().toISOString()}] 已创建跨系统协同编排流，等待触发演练。`],
    };
    const json = await apiPostJson<{ crossSystemFlows: CrossSystemFlow[] }>(
      '/api/capability/flows',
      newFlow,
    );
    patchData({ crossSystemFlows: json.crossSystemFlows });
    setCreateOpen(false);
    showToast(t(`已新增跨系统协同工作流「${newFlow.name}」`, `Created flow "${newFlow.name}"`));
  };

  const handleDeleteFlow = async () => {
    if (!deleteTarget) return;
    const json = await apiDeleteResource<{ crossSystemFlows: CrossSystemFlow[] }>(
      `/api/capability/flows/${deleteTarget.id}`,
    );
    patchData({ crossSystemFlows: json.crossSystemFlows });
    setDeleteTarget(null);
    showToast(t(`已移除跨系统工作流「${deleteTarget.name}」`, 'Deleted cross-system flow'));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-window border border-line bg-surface px-4 py-2.5 shadow-2xs">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          <Workflow size={15} className="text-accent" />
          {t(
            '跨异构系统 MCP 协同编排工作流 (Cross-System MCP Orchestration)',
            'Cross-System MCP Orchestration Flows',
          )}{' '}
          <span className="badge badge-accent">{data.crossSystemFlows.length}</span>
        </div>
        <Button variant="accent" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus size={13} />
          {t('新建跨系统协同流', 'New Cross-System Flow')}
        </Button>
      </div>

      {data.crossSystemFlows.map((fl, idx) => (
        <div key={fl.id} className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">{fl.name}</h3>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{fl.description}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                <span className="badge badge-accent">Trigger: {fl.triggerEvent}</span>
                {fl.involvedSystems.map((sys) => (
                  <span key={sys} className="badge">
                    {sys}
                  </span>
                ))}
              </div>
            </div>
            <div className="inline-flex items-center gap-2">
              <button
                type="button"
                className="btn btn-primary"
                data-testid={idx === 0 ? 'execute-cross-flow-btn' : `execute-cross-flow-btn-${idx}`}
                onClick={() => void handleRunFlow(fl.id)}
              >
                <Play size={13} />
                {t('演练执行跨系统协同流', 'Execute Cross-System Flow')}
              </button>
              <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(fl)}>
                <Trash2 size={13} className="text-red" />
              </Button>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.max(1, fl.steps.length)}, minmax(0, 1fr))`,
              gap: 10,
              marginBottom: 14,
            }}
          >
            {fl.steps.map((s, stepIdx) => (
              <div
                key={s.stepOrder}
                style={{
                  padding: 10,
                  borderRadius: 6,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--line)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span className="badge badge-accent">Step #{s.stepOrder}</span>
                  <span className="badge badge-ok">{s.status}</span>
                </div>
                <div style={{ fontWeight: 600, fontSize: 12.5 }}>{s.systemName}</div>
                <div
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 11,
                    color: 'var(--accent)',
                    margin: '4px 0',
                  }}
                >
                  {s.mcpToolName}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  {s.description}
                  {stepIdx < fl.steps.length - 1 ? ' →' : ''}
                </div>
              </div>
            ))}
          </div>

          <div
            className="responsive-table-region mb-3 rounded border border-line"
            role="region"
            aria-label={fl.name}
            tabIndex={0}
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th>Step</th>
                  <th>{t('参与业务系统', 'Target System')}</th>
                  <th>{t('调用的本体 MCP 工具', 'MCP Tool')}</th>
                  <th>{t('协同说明', 'Description')}</th>
                  <th>{t('状态', 'Status')}</th>
                </tr>
              </thead>
              <tbody>
                {fl.steps.map((s) => (
                  <tr key={s.stepOrder}>
                    <td style={{ fontFamily: 'var(--mono)' }}>#{s.stepOrder}</td>
                    <td>
                      <strong>{s.systemName}</strong>
                    </td>
                    <td style={{ fontFamily: 'var(--mono)' }}>{s.mcpToolName}</td>
                    <td>{s.description}</td>
                    <td>
                      <span className="badge badge-ok">{s.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <CodeBlock
            code={fl.executionLogs.join('\n')}
            language="log"
            filename="Execution Audit Log"
            maxHeight={130}
          />
        </div>
      ))}

      <ConfirmDialog
        open={createOpen}
        title={t('新建跨系统 MCP 协同编排流', 'Create Cross-System MCP Flow')}
        confirmLabel={t('创建工作流', 'Create Flow')}
        onConfirm={() => void handleCreateFlow()}
        onClose={() => setCreateOpen(false)}
      >
        <div className="form-field">
          <label className="form-label">{t('工作流名称', 'Flow Name')} *</label>
          <input className="input" value={flowName} onChange={(e) => setFlowName(e.target.value)} />
        </div>
        <div className="form-field">
          <label className="form-label">{t('触发领域事件 (ME)', 'Trigger Event')}</label>
          <input
            className="input"
            value={flowTrigger}
            onChange={(e) => setFlowTrigger(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label className="form-label">{t('协同流程说明', 'Description')}</label>
          <textarea
            className="textarea"
            rows={3}
            value={flowDesc}
            onChange={(e) => setFlowDesc(e.target.value)}
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t('删除跨系统协同流', 'Delete Cross-System Flow')}
        description={
          deleteTarget
            ? t(`确认删除「${deleteTarget.name}」吗？`, `Delete "${deleteTarget.name}"?`)
            : ''
        }
        confirmLabel={t('确认删除', 'Delete')}
        danger
        onConfirm={() => void handleDeleteFlow()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ─── 6. Capability Center: Knowledge Center (Tiptap Bidirectional + Registry) ─

export function KnowledgeCenterView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [viewMode, setViewMode] = useState<'WORKSPACE' | 'REGISTRY'>('WORKSPACE');
  const [selectedId, setSelectedId] = useState<string>('');
  const [draftContent, setDraftContent] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<KnowledgeEntry['category']>('DOMAIN_GLOSSARY');
  const [newTags, setNewTags] = useState('领域词典, M1聚合根, 业务规范');
  const [newContent, setNewContent] = useState(
    '## 领域规范定义\n\n- **适用模型**：`M1` / `M3`\n- **核心约束**：所有金额字段统一采用两位小数精度校验。\n',
  );
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeEntry | null>(null);

  useEffect(() => {
    if (data && !selectedId && data.knowledgeEntries[0]) {
      setSelectedId(data.knowledgeEntries[0].id);
      setDraftContent(data.knowledgeEntries[0].content);
    }
  }, [data, selectedId]);

  const activeEntry = useMemo(() => {
    if (!data) return undefined;
    return (
      data.knowledgeEntries.find((k) => k.id === selectedId) ?? data.knowledgeEntries[0]
    );
  }, [data, selectedId]);

  useEffect(() => {
    if (activeEntry) {
      setDraftContent(activeEntry.content);
    }
  }, [activeEntry?.id]);

  if (!data) return null;

  const handleSaveActiveEntry = async (md: string) => {
    if (!activeEntry) return;
    setSaving(true);
    try {
      const json = await apiPostJson<{ knowledgeEntries: KnowledgeEntry[] }>('/api/knowledge', {
        ...activeEntry,
        content: md,
      });
      patchData({ knowledgeEntries: json.knowledgeEntries });
      showToast(t(`已保存知识词条「${activeEntry.title}」`, `Saved "${activeEntry.title}"`));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateKnowledge = async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    const id = `know-${Date.now().toString(36)}`;
    const json = await apiPostJson<{ knowledgeEntries: KnowledgeEntry[] }>('/api/knowledge', {
      id,
      title: newTitle.trim(),
      category: newCategory,
      tags: newTags
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      content: newContent.trim(),
      linkedProjectId: data.activeProject.id,
    });
    patchData({ knowledgeEntries: json.knowledgeEntries });
    setSelectedId(id);
    setDraftContent(newContent.trim());
    setViewMode('WORKSPACE');
    setModalOpen(false);
    setNewTitle('');
    showToast(t(`已新增领域知识词条「${newTitle}」`, `Added knowledge entry "${newTitle}"`));
  };

  const handleDeleteKnowledge = async () => {
    if (!deleteTarget) return;
    const json = await apiDeleteResource<{ knowledgeEntries: KnowledgeEntry[] }>(
      `/api/knowledge/${deleteTarget.id}`,
    );
    patchData({ knowledgeEntries: json.knowledgeEntries });
    if (selectedId === deleteTarget.id) {
      setSelectedId(json.knowledgeEntries[0]?.id ?? '');
    }
    setDeleteTarget(null);
    showToast(t(`已删除知识词条「${deleteTarget.title}」`, 'Deleted knowledge entry'));
  };

  const columns: RegistryColumn<KnowledgeEntry>[] = [
    {
      key: 'title',
      header: t('知识词条标题', 'Title'),
      render: (kn) => (
        <div>
          <div className="font-semibold text-ink">{kn.title}</div>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {kn.tags.map((tg) => (
              <span key={tg} className="badge">
                #{tg}
              </span>
            ))}
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      header: t('知识分类', 'Category'),
      render: (kn) => <span className="badge badge-accent">{kn.category}</span>,
    },
    {
      key: 'updatedAt',
      header: t('最近更新', 'Updated'),
      render: (kn) => (
        <span className="font-mono text-[11.5px] text-ink-3">
          {kn.updatedAt?.slice(0, 16) ?? '-'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('操作', 'Actions'),
      align: 'right',
      render: (kn) => (
        <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => {
              setSelectedId(kn.id);
              setViewMode('WORKSPACE');
            }}
          >
            <Edit3 size={11.5} />
            {t('打开编辑', 'Edit')}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setDeleteTarget(kn)}>
            <Trash2 size={11.5} className="text-red" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-window border border-line bg-surface px-4 py-2.5 shadow-2xs">
        <div className="inline-flex items-center gap-1 rounded-control bg-inset p-1">
          <button
            type="button"
            className={`btn btn-sm ${viewMode === 'WORKSPACE' ? 'btn-primary' : ''}`}
            onClick={() => setViewMode('WORKSPACE')}
          >
            <BookOpen size={13} />
            {t('双向 Markdown 知识编辑台', 'Knowledge Editor')}
          </button>
          <button
            type="button"
            className={`btn btn-sm ${viewMode === 'REGISTRY' ? 'btn-primary' : ''}`}
            onClick={() => setViewMode('REGISTRY')}
            data-testid="knowledge-mode-registry-btn"
          >
            {t('知识库管理列表', 'Knowledge Registry')} ({data.knowledgeEntries.length})
          </button>
        </div>

        <Button variant="accent" size="sm" onClick={() => setModalOpen(true)}>
          <Plus size={13} />
          {t('新增领域知识词条', 'New Knowledge Entry')}
        </Button>
      </div>

      {viewMode === 'REGISTRY' ? (
        <RegistryTable
          title={t('领域术语、建模规范与业务制度知识库', 'Domain Knowledge Base Registry')}
          rows={data.knowledgeEntries}
          getRowKey={(k) => k.id}
          activeRowKey={activeEntry?.id}
          columns={columns}
          matchesSearch={(k, q) =>
            k.title.toLowerCase().includes(q) ||
            k.content.toLowerCase().includes(q) ||
            k.tags.some((tg) => tg.toLowerCase().includes(q))
          }
          statusFilters={[
            { value: 'ALL', label: t('全部', 'All') },
            { value: 'DOMAIN_GLOSSARY', label: 'DOMAIN_GLOSSARY' },
            { value: 'BUSINESS_POLICY', label: 'BUSINESS_POLICY' },
            { value: 'MODELING_STANDARD', label: 'MODELING_STANDARD' },
            { value: 'EXTRACTION_GUIDE', label: 'EXTRACTION_GUIDE' },
          ]}
          getRowStatus={(k) => k.category}
          onRowClick={(k) => {
            setSelectedId(k.id);
            setViewMode('WORKSPACE');
          }}
          testId="knowledge-registry-table"
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)', gap: 14 }}>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="text-[12.5px] font-semibold text-ink">
              {t('知识词条目录', 'Knowledge Entries')} ({data.knowledgeEntries.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 540, overflowY: 'auto' }}>
              {data.knowledgeEntries.map((kn) => {
                const active = kn.id === activeEntry?.id;
                return (
                  <div
                    key={kn.id}
                    onClick={() => setSelectedId(kn.id)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      background: active ? 'var(--accent-soft)' : 'var(--surface-2)',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <strong className="text-[12.5px]">{kn.title}</strong>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(kn);
                        }}
                      >
                        <Trash2 size={11} className="text-red" />
                      </Button>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <span className="badge badge-accent">{kn.category}</span>
                      {kn.tags.slice(0, 2).map((tg) => (
                        <span key={tg} className="badge">
                          #{tg}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {activeEntry ? (
            <TiptapMarkdownEditor
              value={draftContent}
              onChange={setDraftContent}
              onSave={handleSaveActiveEntry}
              saving={saving}
              title={activeEntry.title}
              badge={<span className="badge badge-accent">{activeEntry.category}</span>}
              downloadFilename={`${activeEntry.id}.md`}
              minHeight={460}
              testId="knowledge-markdown-editor"
            />
          ) : (
            <div className="card text-ink-3">{t('暂无知识词条', 'No knowledge entries')}</div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={modalOpen}
        title={t('新增领域知识与规则词条', 'Add Domain Knowledge Entry')}
        confirmLabel={t('保存知识词条', 'Save Entry')}
        onConfirm={() => void handleCreateKnowledge()}
        onClose={() => setModalOpen(false)}
      >
        <div className="form-grid-2">
          <div className="form-field">
            <label className="form-label">{t('词条标题', 'Entry Title')} *</label>
            <input
              className="input"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={t('例如：供应商分级履约评估规范', 'e.g. Supplier Tiering Policy')}
            />
          </div>
          <div className="form-field">
            <label className="form-label">{t('知识分类', 'Category')}</label>
            <select
              className="select"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value as KnowledgeEntry['category'])}
            >
              <option value="DOMAIN_GLOSSARY">DOMAIN_GLOSSARY (领域术语词典)</option>
              <option value="BUSINESS_POLICY">BUSINESS_POLICY (业务管理制度)</option>
              <option value="MODELING_STANDARD">MODELING_STANDARD (本体建模规范)</option>
              <option value="EXTRACTION_GUIDE">EXTRACTION_GUIDE (本体萃取指南)</option>
            </select>
          </div>
        </div>
        <div className="form-field">
          <label className="form-label">{t('语义标签 (逗号分隔)', 'Tags (comma-separated)')}</label>
          <input className="input" value={newTags} onChange={(e) => setNewTags(e.target.value)} />
        </div>
        <div className="form-field">
          <label className="form-label">{t('Markdown 知识正文', 'Knowledge Content (Markdown)')} *</label>
          <textarea
            className="textarea mono"
            rows={6}
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t('删除领域知识词条', 'Delete Knowledge Entry')}
        description={
          deleteTarget
            ? t(`确认删除「${deleteTarget.title}」吗？`, `Delete "${deleteTarget.title}"?`)
            : ''
        }
        confirmLabel={t('确认删除', 'Delete')}
        danger
        onConfirm={() => void handleDeleteKnowledge()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
