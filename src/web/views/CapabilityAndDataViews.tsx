import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  MetricInsightResult,
  ScenarioAttributionResult,
} from '../../packages/agent-runtime/index.js';
import type {
  McpResourceDefinition,
  McpToolDefinition,
} from '../../packages/package-compiler/index.js';
import type {
  AnalyticsQueryResult,
  DataMappingRule,
  LegacySystemConfig,
} from '../../packages/workspace-store/index.js';
import {
  apiCallMcpTool,
  apiExecuteAnalyticsSql,
  apiGenerateMetricInsight,
  apiInspectMcp,
  apiRunScenarioAttribution,
  apiSendCapabilityChat,
  apiTestLlmProvider,
  triggerBrowserDownload,
  useWorkbenchStore,
} from '../api.js';
import {
  usePreferences,
  type NavViewId,
  type ThemePreference,
} from '../i18n.js';
import { KnowledgeGraphCanvas } from './KnowledgeGraphCanvas.js';

// ─── Shared Native <dialog> Modal Helper (Zero Blocking Browser Dialogs) ─────
function OntoModalDialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t } = usePreferences();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) {
        if (typeof dialog.showModal === 'function') {
          dialog.showModal();
        } else {
          dialog.setAttribute('open', '');
        }
      }
    } else if (dialog.open) {
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
    }
  }, [open]);

  // Fallback for browsers without declarative <dialog closedby="any"> support
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    if (
      typeof HTMLDialogElement !== 'undefined' &&
      !('closedBy' in HTMLDialogElement.prototype)
    ) {
      const handleBackdropClick = (event: MouseEvent) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const insideContent =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (!insideContent) {
          dialog.close();
        }
      };
      dialog.addEventListener('click', handleBackdropClick);
      return () => dialog.removeEventListener('click', handleBackdropClick);
    }
    return undefined;
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      className="onto-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
    >
      <div className="card-header" style={{ marginBottom: 14 }}>
        <h3 id={titleId} className="card-title">
          {title}
        </h3>
        <button
          type="button"
          className="btn btn-sm"
          onClick={onClose}
          aria-label={t('关闭对话框', 'Close dialog')}
        >
          ✕
        </button>
      </div>
      {children}
    </dialog>
  );
}

// ─── 1. Capability Center: Legacy System Config (系统配置) ────────────────────
export function CapabilitySystemsView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [code, setCode] = useState('MES-MFG-CORE');
  const [name, setName] = useState('存量制造执行与工序追溯系统 (MES)');
  const [category, setCategory] = useState('MES / 生产制造');
  const [dbDialect, setDbDialect] = useState('PostgreSQL 16');
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:4310/api/mock-legacy/mes');
  const [dbConnectionUri, setDbConnectionUri] = useState('postgres://mes_ro@10.20.2.18:5432/mes_prod');
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

  const handleSaveSystem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return;
    const payload: LegacySystemConfig = {
      id: editingId ?? `sys-${code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`,
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
    const res = await fetch('/api/capability/systems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    patchData({ legacySystems: json.legacySystems });
    setModalOpen(false);
    showToast(
      editingId
        ? t(`已更新存量系统「${payload.name}」配置`, `Updated legacy system "${payload.name}"`)
        : t(`已接入存量业务系统「${payload.name}」`, `Registered legacy system "${payload.name}"`),
    );
  };

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

      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              {t('存量业务系统接入配置 (Legacy Systems Registry)', 'Connected Enterprise Systems')}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t(
                '接入既有 ERP、MES、MFT、OA 等存量系统，进行本体萃取与 Agent 化升级',
                'Register existing ERP, MES, MFT, and OA systems for Ontology Extraction and MCP wrapping',
              )}
            </div>
          </div>
          <button type="button" className="btn btn-primary" onClick={openCreateModal}>
            + {t('接入存量业务系统', 'Register Legacy System')}
          </button>
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>{t('系统编码', 'Code')}</th>
              <th>{t('系统名称', 'System Name')}</th>
              <th>{t('分类', 'Category')}</th>
              <th>{t('数据库方言', 'DB Dialect')}</th>
              <th>{t('关联本体工程', 'Linked Project')}</th>
              <th>{t('服务地址', 'Base URL')}</th>
              <th>{t('本体化状态', 'Status')}</th>
              <th>{t('操作', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {data.legacySystems.map((sys) => {
              const linkedProj = data.projects.find((p) => p.id === sys.linkedProjectId);
              return (
                <tr key={sys.id}>
                  <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{sys.code}</td>
                  <td>
                    <strong>{sys.name}</strong>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{sys.description}</div>
                  </td>
                  <td>{sys.category}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                    <div>{sys.dbDialect}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 11 }}>{sys.dbConnectionUri}</div>
                  </td>
                  <td>
                    <span className="badge badge-accent">
                      {linkedProj ? linkedProj.name : sys.linkedProjectId}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>{sys.baseUrl}</td>
                  <td>
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
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => openEditModal(sys)}
                    >
                      {t('编辑', 'Edit')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <OntoModalDialog
        open={modalOpen}
        title={
          editingId
            ? t('编辑存量业务系统配置', 'Edit Legacy System')
            : t('接入存量业务系统', 'Register Legacy Business System')
        }
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSaveSystem} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-grid-2">
            <div className="form-field">
              <label className="form-label">
                {t('系统编码', 'System Code')} <span className="req-star">*</span>
              </label>
              <input
                className="input"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">
                {t('系统名称', 'System Name')} <span className="req-star">*</span>
              </label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
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
              <input
                className="input"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
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

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button type="button" className="btn" onClick={() => setModalOpen(false)}>
              {t('取消', 'Cancel')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('保存存量系统配置', 'Save System')}
            </button>
          </div>
        </form>
      </OntoModalDialog>
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
  const [title, setTitle] = useState(EXTRACTION_PRESETS[0].title);
  const [ddlSnippet, setDdlSnippet] = useState(EXTRACTION_PRESETS[0].snippet);
  const [applyImmediately, setApplyImmediately] = useState(true);
  const [busy, setBusy] = useState(false);
  const [applyingJobId, setApplyingJobId] = useState<string | null>(null);

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
      const res = await fetch('/api/capability/extraction-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemId: effectiveSystemId,
          projectId: effectiveProjectId,
          title,
          sourceType,
          sourceSnippet: ddlSnippet,
          applyImmediately,
        }),
      });
      const json = await res.json();
      if (json.project && json.project.id === data.activeProject.id) {
        patchData({ activeProject: json.project, extractionJobs: json.extractionJobs });
      } else if (json.project) {
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
      const res = await fetch(`/api/capability/extraction-jobs/${jobId}/apply`, {
        method: 'POST',
      });
      const json = await res.json();
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
            onClick={handleRunExtraction}
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
              <label className="form-label">
                {t('本体萃取任务名称', 'Extraction Task Title')}
              </label>
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
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
                maxHeight: 370,
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
                        <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                          {job.sourceType} · Project: {job.projectId}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        <span className="badge badge-ok">
                          {(job.confidenceScore * 100).toFixed(0)}%
                        </span>
                        <span className={`badge ${isApplied ? 'badge-ok' : 'badge-warn'}`}>
                          {isApplied
                            ? t('已合并至工程', 'Merged')
                            : t('待复核候选', 'Pending Review')}
                        </span>
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
                          onClick={() => handleApplyCandidateJob(job.id)}
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
    </div>
  );
}

// ─── 3. Capability Center: Dynamic MCP Server Hub (MCP 配置与在线调试) ────────
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
  const { data, showToast } = useWorkbenchStore();
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
    const contentText =
      json?.result?.contents?.[0]?.text ?? JSON.stringify(json, null, 2);
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
                    onClick={() => handleReadResource(resItem.uri)}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>
                tools/call → {selectedTool}
              </strong>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                data-testid="invoke-mcp-tool-btn"
                onClick={handleInvokeTool}
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
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
                  {t('JSON-RPC 2.0 响应报文', 'JSON-RPC 2.0 Response')}
                </div>
                <pre
                  data-testid="mcp-rpc-response"
                  style={{
                    margin: 0,
                    padding: 10,
                    background: 'var(--surface-2)',
                    borderRadius: 5,
                    border: '1px solid var(--line)',
                    fontFamily: 'var(--mono)',
                    fontSize: 11.5,
                    maxHeight: 190,
                    overflow: 'auto',
                  }}
                >
                  {rpcResponse}
                </pre>
              </div>
            )}

            {resourcePreviewText && (
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
                  resources/read → {selectedResourceUri}
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: 10,
                    background: 'var(--surface-2)',
                    borderRadius: 5,
                    border: '1px solid var(--line)',
                    fontFamily: 'var(--mono)',
                    fontSize: 11,
                    maxHeight: 150,
                    overflow: 'auto',
                  }}
                >
                  {resourcePreviewText}
                </pre>
              </div>
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
                  {t('标准 mcpServers 客户端接入配置 (Client Config JSON)', 'Client mcpServers Config JSON')}
                </strong>
                <button type="button" className="btn btn-sm" onClick={handleCopyClientConfig}>
                  {t('复制配置 JSON', 'Copy JSON')}
                </button>
              </div>
              <pre
                style={{
                  margin: 0,
                  fontFamily: 'var(--mono)',
                  fontSize: 11,
                  maxHeight: 125,
                  overflow: 'auto',
                }}
              >
                {caps?.clientConfigJson ?? '{}'}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 4. Capability Center: Agent Builder + Multi-Turn Smart Chat (智能对话) ──
export function CapabilityAgentsView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [chatInput, setChatInput] = useState('');
  const [sending, setSending] = useState(false);
  const [lastTurnCitation, setLastTurnCitation] = useState<{
    citedSkillSlug: string;
    citedRules: string[];
    providerUsed: string;
  } | null>(null);

  // Create Agent Modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [agentName, setAgentName] = useState('采购合规与跨网归档协同智能体');
  const [agentRole, setAgentRole] = useState('业财法务风控与 MFT 安全归档专家');
  const [agentProjectId, setAgentProjectId] = useState('');
  const [selectedMcpIds, setSelectedMcpIds] = useState<string[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [agentModelId, setAgentModelId] = useState('auto/glm-5.3-flash');
  const [agentSystemPrompt, setAgentSystemPrompt] = useState(
    '你是基于 11 元模型驱动的企业协同智能体。执行起草、审批与结算工具前必须核验 M3 规则红线（RULE-01、RULE-03）。',
  );

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

  const agentSessions = useMemo(() => {
    if (!data || !activeAgent) return [];
    return data.capabilityChatSessions.filter((s) => s.agentId === activeAgent.id);
  }, [data, activeAgent]);

  useEffect(() => {
    if (agentSessions.length > 0) {
      if (!selectedSessionId || !agentSessions.some((s) => s.id === selectedSessionId)) {
        setSelectedSessionId(agentSessions[0].id);
      }
    } else {
      setSelectedSessionId('');
    }
  }, [agentSessions, selectedSessionId]);

  if (!data) return null;

  const activeSession =
    selectedSessionId === '__NEW__'
      ? undefined
      : agentSessions.find((s) => s.id === selectedSessionId);

  // Collect all MCP tool invocations across active conversation messages
  const sessionToolLogs = (activeSession?.messages ?? []).flatMap((msg) =>
    (msg.toolInvocations ?? []).map((inv, idx) => ({
      key: `${msg.id}-${idx}`,
      timestamp: msg.timestamp,
      ...inv,
    })),
  );

  const openNewAgentModal = () => {
    setAgentProjectId(data.activeProject.id);
    setSelectedMcpIds(data.mcpServers.slice(0, 1).map((m) => m.id));
    setSelectedSkillIds(data.generatedSkills.slice(0, 1).map((s) => s.id));
    setAgentModelId(data.llmProviders[0]?.defaultModel ?? 'auto/glm-5.3-flash');
    setCreateOpen(true);
  };

  const toggleItemInList = (list: string[], id: string, setter: (next: string[]) => void) => {
    setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentName.trim()) return;
    const newId = `agent-${Date.now().toString(36)}`;
    const res = await fetch('/api/capability/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: newId,
        name: agentName.trim(),
        role: agentRole.trim(),
        projectId: agentProjectId || data.activeProject.id,
        mcpIds: selectedMcpIds.length > 0 ? selectedMcpIds : ['mcp-contract-server'],
        skillIds: selectedSkillIds.length > 0 ? selectedSkillIds : ['skill-contract-clm'],
        modelId: agentModelId,
        systemPrompt: agentSystemPrompt.trim(),
        status: 'ACTIVE',
      }),
    });
    const json = await res.json();
    patchData({ capabilityAgents: json.capabilityAgents });
    setSelectedAgentId(newId);
    setCreateOpen(false);
    showToast(t(`已创建能力中心智能体「${agentName}」`, `Created capability agent "${agentName}"`));
  };

  const handleSendSmartChat = async (customPrompt?: string) => {
    const promptText = (customPrompt ?? chatInput).trim();
    if (!promptText || !activeAgent || sending) return;
    setSending(true);
    try {
      const res = await apiSendCapabilityChat(activeAgent.id, {
        sessionId: activeSession?.id,
        userMessage: promptText,
      });
      patchData({ capabilityChatSessions: res.capabilityChatSessions });
      setSelectedSessionId(res.session.id);
      setLastTurnCitation({
        citedSkillSlug: res.citedSkillSlug,
        citedRules: res.citedRules,
        providerUsed: res.providerUsed,
      });
      if (!customPrompt) setChatInput('');
      showToast(
        t(
          `智能对话已完成，调用了 ${res.toolInvocations.length} 个本体 MCP 工具`,
          `Smart chat turn complete (${res.toolInvocations.length} MCP tool calls)`,
        ),
      );
    } finally {
      setSending(false);
    }
  };

  const availableModelOptions = Array.from(
    new Set([
      'auto/glm-5.3-flash',
      ...data.llmProviders.flatMap((p) => [p.defaultModel, ...p.availableModels]),
    ]),
  ).filter(Boolean);

  const defaultCitedSkill =
    lastTurnCitation?.citedSkillSlug ||
    data.generatedSkills.find((s) => activeAgent?.skillIds.includes(s.id))?.slug ||
    'contract-lifecycle-clm';

  const defaultCitedRules =
    lastTurnCitation?.citedRules && lastTurnCitation.citedRules.length > 0
      ? lastTurnCitation.citedRules
      : (data.activeProject.suite.M3?.rules ?? [])
          .slice(0, 2)
          .map((r) => `${r.id} (${r.alias})`);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '350px minmax(0, 1fr)', gap: 14 }}>
      {/* Left Column: Configured Capability Agents */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="card-header" style={{ marginBottom: 4 }}>
          <div>
            <h3 className="card-title">{t('领域能力智能体', 'Capability Agents')}</h3>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              {t('绑定本体 MCP 服务与 SKILL.md 规则包', 'Bound with Ontology MCPs & Skills')}
            </div>
          </div>
          <button type="button" className="btn btn-sm btn-primary" onClick={openNewAgentModal}>
            + {t('新建智能体', 'New Agent')}
          </button>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                  <strong>{ag.name}</strong>
                  <span className="badge badge-ok">{ag.status}</span>
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

      {/* Right Column: Multi-Turn Smart Chat (智能对话) */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="card-header" style={{ marginBottom: 0 }}>
          <div>
            <h3 className="card-title">
              {t('智能对话工作台 (Smart Chat · 实时 MCP 工具调用)', 'Smart Chat with Live MCP Tool Calling')}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {activeAgent
                ? `${activeAgent.name} · Model: ${activeAgent.modelId}`
                : t('请选择左侧智能体', 'Select an agent on the left')}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <select
              className="select"
              style={{ width: 230 }}
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
            >
              {agentSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} ({s.messages.length})
                </option>
              ))}
              <option value="__NEW__">+ {t('新建空白会话', 'New Session')}</option>
            </select>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setSelectedSessionId('__NEW__')}
            >
              + {t('新对话', 'New Chat')}
            </button>
          </div>
        </div>

        {/* Quick Ontology Prompts */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button
            type="button"
            className="btn btn-sm"
            disabled={sending}
            onClick={() =>
              handleSendSmartChat(
                '请调用合同台账 MCP 工具核查华东区高风险外包合同，并校核 RULE-01 与 RULE-03 红线。',
              )
            }
          >
            {t('示例 1：排查华东高风险逾期合同', 'Sample 1: Audit High-Risk Contracts')}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={sending}
            onClick={() =>
              handleSendSmartChat(
                '请起草一份金额 180 万元、相对方资信 AAA 的 AI 算力采购合同并验证 M3 规则门禁。',
              )
            }
          >
            {t('示例 2：起草百万级采购合同 (M2+M3)', 'Sample 2: Draft Procurement Contract')}
          </button>
        </div>

        {/* Conversation Messages */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            maxHeight: 320,
            overflowY: 'auto',
            padding: 10,
            borderRadius: 6,
            background: 'var(--surface-2)',
            border: '1px solid var(--line)',
          }}
        >
          {(activeSession?.messages ?? []).length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 12.5, padding: 12 }}>
              {t(
                '当前为新对话，输入业务指令即可驱动智能体自动调用挂载的本体 MCP 工具与 SKILL.md 规则。',
                'Send a business instruction below to invoke mounted Ontology MCP tools and SKILL.md rules.',
              )}
            </div>
          ) : (
            (activeSession?.messages ?? []).map((msg) => (
              <div
                key={msg.id}
                style={{
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'stretch',
                  maxWidth: msg.role === 'user' ? '84%' : '100%',
                  padding: '9px 12px',
                  borderRadius: 6,
                  background: msg.role === 'user' ? 'var(--accent-soft)' : 'var(--surface)',
                  border: '1px solid var(--line)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 11,
                    color: 'var(--muted)',
                    marginBottom: 4,
                  }}
                >
                  <strong>
                    {msg.role === 'user'
                      ? t('业务用户 (User)', 'User')
                      : activeAgent?.name ?? 'Capability Agent'}
                  </strong>
                  <span style={{ fontFamily: 'var(--mono)' }}>{msg.timestamp.slice(11, 19)}</span>
                </div>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, lineHeight: 1.55 }}>
                  {msg.content}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Structured MCP Tool Invocation & Cited SKILL.md Rules Log */}
        <div
          data-testid="smart-chat-tool-log"
          style={{
            padding: 10,
            borderRadius: 6,
            background: 'var(--surface-2)',
            border: '1px solid var(--line)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <strong style={{ fontSize: 12 }}>
              {t('MCP 工具调用与 SKILL.md 规则引用溯源', 'Live MCP Tool Invocations & Cited SKILL.md Rules')} (
              {sessionToolLogs.length})
            </strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              <span className="badge badge-ok">SKILL.md: {defaultCitedSkill}</span>
              {defaultCitedRules.map((rule) => (
                <span key={rule} className="badge badge-accent">
                  {rule}
                </span>
              ))}
            </div>
          </div>

          {sessionToolLogs.length === 0 ? (
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              {t('发送对话后将在此展示结构化 MCP 工具入参、JSON 输出与规则校验链路。', 'MCP tool call arguments and JSON outputs will appear here.')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 190, overflowY: 'auto' }}>
              {sessionToolLogs.map((inv) => (
                <div
                  key={inv.key}
                  style={{
                    padding: 8,
                    borderRadius: 5,
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    fontFamily: 'var(--mono)',
                    fontSize: 11.5,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <strong>tools/call → {inv.toolName}</strong>
                    <span className={`badge ${inv.isError ? 'badge-bad' : 'badge-ok'}`}>
                      {inv.isError ? 'RULE_BLOCKED' : 'MCP_OK'}
                    </span>
                  </div>
                  <div style={{ color: 'var(--muted)', marginBottom: 3 }}>
                    Args: {JSON.stringify(inv.arguments)}
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      fontSize: 11,
                      color: 'var(--ink-2)',
                    }}
                  >
                    Output: {inv.output}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Message Input Bar */}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            data-testid="smart-chat-input"
            placeholder={t(
              '输入业务问题或执行指令（例如：核查华东区高风险合同结算并校验 RULE-01）...',
              'Ask the capability agent or trigger an Ontology MCP tool...',
            )}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendSmartChat();
              }
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            data-testid="smart-chat-send-btn"
            disabled={sending || !chatInput.trim()}
            onClick={() => handleSendSmartChat()}
          >
            {sending ? t('执行中...', 'Sending...') : t('发送指令', 'Send')}
          </button>
        </div>
      </div>

      {/* Create Capability Agent Modal */}
      <OntoModalDialog
        open={createOpen}
        title={t('新建能力中心智能体 (绑定 MCP + Skill)', 'Create Capability Agent')}
        onClose={() => setCreateOpen(false)}
      >
        <form onSubmit={handleCreateAgent} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-grid-2">
            <div className="form-field">
              <label className="form-label">
                {t('智能体名称', 'Agent Name')} <span className="req-star">*</span>
              </label>
              <input
                className="input"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                autoFocus
                required
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
            <label className="form-label">{t('挂载本体 MCP 服务 (可多选)', 'Mount Ontology MCP Servers')}</label>
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
                    onChange={() =>
                      toggleItemInList(selectedMcpIds, mcp.id, setSelectedMcpIds)
                    }
                  />
                  <span>
                    {mcp.name} ({mcp.id})
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">{t('挂载领域 SKILL.md 技能包 (可多选)', 'Mount Domain Skills')}</label>
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

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn" onClick={() => setCreateOpen(false)}>
              {t('取消', 'Cancel')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('创建并激活智能体', 'Create Agent')}
            </button>
          </div>
        </form>
      </OntoModalDialog>
    </div>
  );
}

// ─── 5. Capability Center: Cross-System Flows & Knowledge Center ─────────────
export function CapabilityCrossFlowsView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  if (!data) return null;

  const handleRunFlow = async (flowId: string) => {
    const res = await fetch(`/api/capability/flows/${flowId}/execute`, {
      method: 'POST',
    });
    const json = await res.json();
    patchData({ crossSystemFlows: json.crossSystemFlows });
    showToast('已执行跨系统 MCP 协同工作流，全部异构系统节点执行成功');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
            <button
              type="button"
              className="btn btn-primary"
              data-testid={idx === 0 ? 'execute-cross-flow-btn' : `execute-cross-flow-btn-${idx}`}
              onClick={() => handleRunFlow(fl.id)}
            >
              {t('演练执行跨系统协同流', 'Execute Cross-System Flow')}
            </button>
          </div>

          {/* Visual Step Pipeline */}
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
                  position: 'relative',
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

          <table className="data-table" style={{ marginBottom: 12 }}>
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

          <div
            style={{
              padding: 10,
              background: 'var(--surface-2)',
              borderRadius: 5,
              fontFamily: 'var(--mono)',
              fontSize: 11.5,
            }}
          >
            {fl.executionLogs.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function KnowledgeCenterView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [categoryFilter, setCategoryFilter] = useState<
    'ALL' | 'DOMAIN_GLOSSARY' | 'MODELING_STANDARD' | 'BUSINESS_POLICY' | 'EXTRACTION_GUIDE'
  >('ALL');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<
    'DOMAIN_GLOSSARY' | 'MODELING_STANDARD' | 'BUSINESS_POLICY' | 'EXTRACTION_GUIDE'
  >('DOMAIN_GLOSSARY');
  const [newTags, setNewTags] = useState('领域词典, M1聚合根, 业务规范');
  const [newContent, setNewContent] = useState('');

  const entries = useMemo(() => {
    if (!data) return [];
    return data.knowledgeEntries.filter((kn) => {
      if (categoryFilter !== 'ALL' && kn.category !== categoryFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          kn.title.toLowerCase().includes(q) ||
          kn.content.toLowerCase().includes(q) ||
          kn.tags.some((tg) => tg.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [data, categoryFilter, search]);

  if (!data) return null;

  const handleCreateKnowledge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;
    const res = await fetch('/api/knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: `know-${Date.now().toString(36)}`,
        title: newTitle.trim(),
        category: newCategory,
        tags: newTags
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
        content: newContent.trim(),
        linkedProjectId: data.activeProject.id,
      }),
    });
    const json = await res.json();
    patchData({ knowledgeEntries: json.knowledgeEntries });
    setModalOpen(false);
    setNewTitle('');
    setNewContent('');
    showToast(t(`已新增领域知识词条「${newTitle}」`, `Added knowledge entry "${newTitle}"`));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card">
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(
              [
                ['ALL', '全部词条', 'All'],
                ['DOMAIN_GLOSSARY', '领域术语词典', 'Domain Glossary'],
                ['BUSINESS_POLICY', '业务管理制度', 'Business Policy'],
                ['MODELING_STANDARD', '本体建模规范', 'Modeling Standard'],
                ['EXTRACTION_GUIDE', '本体萃取指南', 'Extraction Guide'],
              ] as const
            ).map(([code, zh, en]) => (
              <button
                key={code}
                type="button"
                className={`btn btn-sm ${categoryFilter === code ? 'btn-primary' : ''}`}
                onClick={() => setCategoryFilter(code)}
              >
                {t(zh, en)}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              className="input"
              style={{ width: 220 }}
              placeholder={t('检索知识标题、标签或正文...', 'Search knowledge entries...')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setModalOpen(true)}
            >
              + {t('新增领域知识词条', 'New Knowledge Entry')}
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        {entries.map((kn) => (
          <div key={kn.id} className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">{kn.title}</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                  {kn.tags.map((tg) => (
                    <span key={tg} className="badge">
                      #{tg}
                    </span>
                  ))}
                </div>
              </div>
              <span className="badge badge-accent">{kn.category}</span>
            </div>
            <pre
              style={{
                margin: 0,
                padding: 10,
                background: 'var(--surface-2)',
                borderRadius: 5,
                fontFamily: 'var(--sans)',
                fontSize: 12.5,
                whiteSpace: 'pre-wrap',
              }}
            >
              {kn.content}
            </pre>
          </div>
        ))}
      </div>

      <OntoModalDialog
        open={modalOpen}
        title={t('新增领域知识与规则词条', 'Add Domain Knowledge Entry')}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleCreateKnowledge} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-grid-2">
            <div className="form-field">
              <label className="form-label">
                {t('词条标题', 'Entry Title')} <span className="req-star">*</span>
              </label>
              <input
                className="input"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={t('例如：供应商分级履约评估规范', 'e.g. Supplier Tiering Policy')}
                autoFocus
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t('知识分类', 'Category')}</label>
              <select
                className="select"
                value={newCategory}
                onChange={(e) =>
                  setNewCategory(
                    e.target.value as
                      | 'DOMAIN_GLOSSARY'
                      | 'MODELING_STANDARD'
                      | 'BUSINESS_POLICY'
                      | 'EXTRACTION_GUIDE',
                  )
                }
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
            <input
              className="input"
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label className="form-label">
              {t('Markdown 知识正文', 'Knowledge Content (Markdown)')} <span className="req-star">*</span>
            </label>
            <textarea
              className="textarea"
              rows={6}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              required
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn" onClick={() => setModalOpen(false)}>
              {t('取消', 'Cancel')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('保存知识词条', 'Save Entry')}
            </button>
          </div>
        </form>
      </OntoModalDialog>
    </div>
  );
}

// ─── 6. Data Analytics Center: Data Resources & Live SQL Sandbox ─────────────
const SQL_SANDBOX_PRESETS: { labelZh: string; labelEn: string; sql: string }[] = [
  {
    labelZh: '合同主表与字典标签预览',
    labelEn: 'Contracts + Dict Labels',
    sql: 'SELECT contract_no, title, contract_type, region, risk_level, status, total_amount, overdue_days FROM t_contract ORDER BY total_amount DESC LIMIT 10',
  },
  {
    labelZh: '高风险逾期结算穿透联查',
    labelEn: 'High-Risk Overdue Join',
    sql: 'SELECT c.contract_no, c.region, cp.company_name, cp.credit_rating, s.settlement_no, s.settlement_amount, s.settlement_status, s.overdue_days FROM t_settlement_order s JOIN t_contract c ON s.contract_ref = c.id JOIN t_counterparty cp ON c.counterparty_id = cp.id ORDER BY s.settlement_amount DESC LIMIT 10',
  },
  {
    labelZh: '相对方资信等级分布统计',
    labelEn: 'Counterparty Credit Breakdown',
    sql: 'SELECT credit_rating, region, COUNT(*) AS supplier_count FROM t_counterparty GROUP BY credit_rating, region ORDER BY supplier_count DESC',
  },
];

export function DataResourcesView({
  onNavigate,
}: {
  onNavigate?: (view: NavViewId) => void;
} = {}) {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [sqlText, setSqlText] = useState(SQL_SANDBOX_PRESETS[0].sql);
  const [sqlResult, setSqlResult] = useState<AnalyticsQueryResult | null>(null);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [runningSql, setRunningSql] = useState(false);
  const [extractingDataOntology, setExtractingDataOntology] = useState(false);

  // Data Document Modal
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [docTitle, setDocTitle] = useState('');
  const [docCategory, setDocCategory] = useState<
    'WAREHOUSE_SPEC' | 'METRIC_DICT' | 'GOVERNANCE_RULE'
  >('WAREHOUSE_SPEC');
  const [docContent, setDocContent] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiExecuteAnalyticsSql(SQL_SANDBOX_PRESETS[0].sql)
      .then((res) => {
        if (!cancelled) setSqlResult(res);
      })
      .catch(() => {
        // Ignore initial preview error if store is still bootstrapping
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) return null;

  const handleRunSqlPreview = async (overrideSql?: string) => {
    const query = (overrideSql ?? sqlText).trim();
    if (!query || runningSql) return;
    if (overrideSql) setSqlText(overrideSql);
    setRunningSql(true);
    setSqlError(null);
    try {
      const res = await apiExecuteAnalyticsSql(query);
      setSqlResult(res);
      showToast(
        t(
          `只读 SQL 执行完成：返回 ${res.rowCount} 行（耗时 ${res.elapsedMs}ms）`,
          `SQL executed: ${res.rowCount} rows (${res.elapsedMs}ms)`,
        ),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSqlError(message);
      showToast(message);
    } finally {
      setRunningSql(false);
    }
  };

  const handleExtractDataOntology = async () => {
    if (extractingDataOntology) return;
    setExtractingDataOntology(true);
    try {
      const primaryDb = data.databaseResources[0];
      const ddlFromTables = (primaryDb?.tables ?? [])
        .filter((tb) => tb.tableName !== '__dict')
        .map(
          (tb) =>
            `CREATE TABLE ${tb.tableName} (\n${tb.columns
              .map((c) => `  ${c.name} ${c.type}`)
              .join(',\n')}\n);`,
        )
        .join('\n\n');

      const res = await fetch('/api/capability/extraction-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemId: data.legacySystems[0]?.id ?? 'sys-erp-contract',
          projectId: data.activeProject.id,
          title: '从数仓资源萃取数据本体 (M1+MM)',
          sourceType: 'DDL_AND_OPENAPI',
          sourceSnippet:
            ddlFromTables ||
            'CREATE TABLE t_contract (id VARCHAR(36) PRIMARY KEY, total_amount DECIMAL(18,2));',
          applyImmediately: true,
        }),
      });
      const json = await res.json();
      if (json.project) {
        patchData({ activeProject: json.project, extractionJobs: json.extractionJobs });
      } else {
        patchData({ extractionJobs: json.extractionJobs });
      }
      showToast(`已从数据资源完成数据本体萃取 (M1+MM)：${json.job.summary}`);
      onNavigate?.('data-mappings');
    } finally {
      setExtractingDataOntology(false);
    }
  };

  const handleCreateDataDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docTitle.trim() || !docContent.trim()) return;
    const res = await fetch('/api/analytics/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: `ddoc-${Date.now().toString(36)}`,
        title: docTitle.trim(),
        category: docCategory,
        content: docContent.trim(),
      }),
    });
    const json = await res.json();
    patchData({ dataDocuments: json.dataDocuments });
    setDocModalOpen(false);
    setDocTitle('');
    setDocContent('');
    showToast(t(`已保存数据规范文档「${docTitle}」`, `Saved data document "${docTitle}"`));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Database Resources & Schema Explorer */}
      {data.databaseResources.map((db) => (
        <div key={db.id} className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">{db.name}</h3>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
                {db.dialect} · {db.connectionUri}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="badge badge-ok">{db.status}</span>
              <button
                type="button"
                className="btn btn-primary"
                disabled={extractingDataOntology}
                onClick={handleExtractDataOntology}
              >
                {extractingDataOntology
                  ? t('正在萃取...', 'Extracting...')
                  : t('从数据资源萃取数据本体 (M1+MM)', 'Extract Data Ontology (M1+MM)')}
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
            {db.tables.map((tb) => (
              <div
                key={tb.tableName}
                style={{
                  padding: 10,
                  background: 'var(--surface-2)',
                  borderRadius: 5,
                  border: '1px solid var(--line)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontFamily: 'var(--mono)' }}>{tb.tableName}</strong>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span className="badge badge-accent">{tb.rowCount} rows</span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() =>
                        handleRunSqlPreview(`SELECT * FROM ${tb.tableName} LIMIT 10`)
                      }
                    >
                      SQL
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', margin: '4px 0 8px 0' }}>
                  {tb.comment}
                </div>
                {tb.columns.map((c) => (
                  <div
                    key={c.name}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 11.5,
                      fontFamily: 'var(--mono)',
                      padding: '2px 0',
                    }}
                  >
                    <span>{c.name}</span>
                    <span style={{ color: 'var(--muted)' }}>{c.type}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Live Read-Only SQL Sandbox Runner */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              {t(
                '在线只读 SQL 沙箱与 M1 数据字典标签动态翻译 (Live SQLite Sandbox)',
                'Live Read-Only SQL Sandbox & M1 Dictionary Enrichment',
              )}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t(
                '仅允许执行只读 SELECT / WITH 分析查询，自动挂载 __dict 数据字典生成 <col>__label 中文语义列',
                'Executes read-only SELECT / WITH queries against live SQLite tables with automatic <col>__label dictionary enrichment',
              )}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="run-sql-preview-btn"
            disabled={runningSql}
            onClick={() => handleRunSqlPreview()}
          >
            {runningSql
              ? t('查询中...', 'Running...')
              : t('执行只读 SQL 预览', 'Run SQL Preview')}
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {SQL_SANDBOX_PRESETS.map((preset) => (
            <button
              key={preset.labelEn}
              type="button"
              className="btn btn-sm"
              onClick={() => handleRunSqlPreview(preset.sql)}
            >
              {t(preset.labelZh, preset.labelEn)}
            </button>
          ))}
        </div>

        <textarea
          className="textarea mono"
          rows={3}
          value={sqlText}
          onChange={(e) => setSqlText(e.target.value)}
        />

        {sqlError && (
          <div
            style={{
              marginTop: 8,
              padding: '8px 10px',
              borderRadius: 5,
              background: 'var(--bad-soft)',
              color: 'var(--bad)',
              fontFamily: 'var(--mono)',
              fontSize: 12,
            }}
          >
            {sqlError}
          </div>
        )}

        <div style={{ marginTop: 10, overflowX: 'auto' }}>
          {sqlResult && (
            <>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 11.5,
                  color: 'var(--muted)',
                  fontFamily: 'var(--mono)',
                  marginBottom: 6,
                }}
              >
                <span>
                  Rows: {sqlResult.rowCount} · Elapsed: {sqlResult.elapsedMs}ms
                </span>
                <span>
                  Dict Enriched Columns:{' '}
                  {sqlResult.columns.filter((c) => c.endsWith('__label')).length}
                </span>
              </div>
              <table className="data-table" data-testid="sql-preview-table">
                <thead>
                  <tr>
                    {sqlResult.columns.map((col) => (
                      <th key={col} style={{ fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
                        {col}
                        {col.endsWith('__label') && (
                          <span className="badge badge-accent" style={{ marginLeft: 4 }}>
                            Dict
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sqlResult.rows.map((row, rIdx) => (
                    <tr key={rIdx}>
                      {sqlResult.columns.map((col) => {
                        const val = row[col];
                        const isDictLabel = col.endsWith('__label');
                        return (
                          <td
                            key={col}
                            style={{
                              fontFamily: isDictLabel ? 'var(--sans)' : 'var(--mono)',
                              fontSize: 11.5,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {isDictLabel && val != null ? (
                              <span className="badge badge-accent">{String(val)}</span>
                            ) : val == null ? (
                              '-'
                            ) : (
                              String(val)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>

      {/* Data Documents Section */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">
            {t('数仓分层规范与指标口径文档 (Data Documents)', 'Data Warehouse & Metric Specifications')}
          </h3>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => setDocModalOpen(true)}
          >
            + {t('上传/新建数据文档', 'Add Data Document')}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.dataDocuments.map((doc) => (
            <div
              key={doc.id}
              style={{
                padding: 12,
                borderRadius: 6,
                background: 'var(--surface-2)',
                border: '1px solid var(--line)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <strong>{doc.title}</strong>
                <span className="badge badge-accent">{doc.category}</span>
              </div>
              <pre
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'var(--sans)',
                  fontSize: 12.5,
                }}
              >
                {doc.content}
              </pre>
            </div>
          ))}
        </div>
      </div>

      <OntoModalDialog
        open={docModalOpen}
        title={t('新建数仓口径与治理规范文档', 'Create Data Specification Document')}
        onClose={() => setDocModalOpen(false)}
      >
        <form onSubmit={handleCreateDataDoc} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-grid-2">
            <div className="form-field">
              <label className="form-label">
                {t('文档标题', 'Document Title')} <span className="req-star">*</span>
              </label>
              <input
                className="input"
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder={t('例如：履约结算事实表 DWD 清洗规范', 'e.g. Settlement Fact Table Spec')}
                autoFocus
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t('文档类别', 'Document Category')}</label>
              <select
                className="select"
                value={docCategory}
                onChange={(e) =>
                  setDocCategory(
                    e.target.value as 'WAREHOUSE_SPEC' | 'METRIC_DICT' | 'GOVERNANCE_RULE',
                  )
                }
              >
                <option value="WAREHOUSE_SPEC">WAREHOUSE_SPEC (数仓模型规范)</option>
                <option value="METRIC_DICT">METRIC_DICT (指标口径字典)</option>
                <option value="GOVERNANCE_RULE">GOVERNANCE_RULE (数据质量门禁)</option>
              </select>
            </div>
          </div>
          <div className="form-field">
            <label className="form-label">
              {t('Markdown 文档内容', 'Content (Markdown)')} <span className="req-star">*</span>
            </label>
            <textarea
              className="textarea"
              rows={6}
              value={docContent}
              onChange={(e) => setDocContent(e.target.value)}
              required
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn" onClick={() => setDocModalOpen(false)}>
              {t('取消', 'Cancel')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('保存数据文档', 'Save Document')}
            </button>
          </div>
        </form>
      </OntoModalDialog>
    </div>
  );
}

// ─── 7. Data Analytics Center: Data Ontology Graph & MM Column Mappings ─────
export function DataMappingsView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ontologyObject, setOntologyObject] = useState('Contract');
  const [ontologyAttribute, setOntologyAttribute] = useState('Contract.riskLevel');
  const [sourceDatabaseId, setSourceDatabaseId] = useState('db-clm-dw');
  const [sourceTable, setSourceTable] = useState('t_contract');
  const [sourceColumn, setSourceColumn] = useState('risk_level');
  const [transformExpr, setTransformExpr] = useState('UPPER(TRIM(risk_level))');
  const [qualityRule, setQualityRule] = useState("risk_level IN ('HIGH', 'MEDIUM', 'LOW')");

  if (!data) return null;

  const m1Count = data.activeProject.suite.M1?.aggregates.length ?? 0;
  const mmCount = data.activeProject.suite.MM?.mappings.length ?? 0;
  const m7Count = data.activeProject.suite.M7?.query_reports.length ?? 0;

  const openCreateMapping = () => {
    setEditingRuleId(null);
    setOntologyObject(data.activeProject.suite.M1?.aggregates[0]?.name ?? 'Contract');
    setOntologyAttribute('Contract.overdueDays');
    setSourceDatabaseId(data.databaseResources[0]?.id ?? 'db-clm-dw');
    setSourceTable('t_contract');
    setSourceColumn('overdue_days');
    setTransformExpr('COALESCE(overdue_days, 0)');
    setQualityRule('overdue_days >= 0');
    setModalOpen(true);
  };

  const openEditMapping = (m: DataMappingRule) => {
    setEditingRuleId(m.id);
    setOntologyObject(m.ontologyObject);
    setOntologyAttribute(m.ontologyAttribute);
    setSourceDatabaseId(m.sourceDatabaseId);
    setSourceTable(m.sourceTable);
    setSourceColumn(m.sourceColumn);
    setTransformExpr(m.transformExpr);
    setQualityRule(m.qualityRule);
    setModalOpen(true);
  };

  const handleSaveMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: DataMappingRule = {
      id: editingRuleId ?? `dmap-${Date.now().toString(36)}`,
      ontologyObject: ontologyObject.trim(),
      ontologyAttribute: ontologyAttribute.trim(),
      sourceDatabaseId,
      sourceTable: sourceTable.trim(),
      sourceColumn: sourceColumn.trim(),
      transformExpr: transformExpr.trim(),
      qualityRule: qualityRule.trim(),
    };
    const res = await fetch('/api/analytics/mappings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    patchData({ dataMappings: json.dataMappings });
    setModalOpen(false);
    showToast(
      t(
        `已保存数据本体字段映射规则：${payload.ontologyAttribute} ↔ ${payload.sourceTable}.${payload.sourceColumn}`,
        `Saved mapping rule ${payload.ontologyAttribute}`,
      ),
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              {t(
                '数据本体语义血缘图谱 (M1 业务对象 ↔ MM 物理库表映射 ↔ M7 分析视图)',
                'Data Ontology Semantic Lineage Graph (M1 ↔ MM ↔ M7)',
              )}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t(
                '可视化透视业务聚合根、物理数仓表与查询报表模型之间的跨层血缘关系',
                'Inspect semantic lineage across M1 aggregates, MM physical table mappings, and M7 analytical reports',
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <span className="badge badge-accent">M1 Objects: {m1Count}</span>
            <span className="badge badge-ok">MM Mappings: {mmCount}</span>
            <span className="badge badge-warn">M7 Reports: {m7Count}</span>
          </div>
        </div>
        <KnowledgeGraphCanvas graph={data.activeProject.knowledgeGraph} height={360} />
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">
            {t(
              '数据本体与数仓物理表字段映射规则 (MM Column Mapping Rules)',
              'Data Ontology to Physical Column Mappings',
            )}
          </h3>
          <button type="button" className="btn btn-primary" onClick={openCreateMapping}>
            + {t('新增字段映射规则', 'New Column Mapping')}
          </button>
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>{t('本体对象', 'Ontology Object')}</th>
              <th>{t('本体属性', 'Ontology Attribute')}</th>
              <th>{t('物理表.字段', 'Source Table.Column')}</th>
              <th>{t('清洗转换表达式', 'Transform Expression')}</th>
              <th>{t('数据质量门禁规则', 'Data Quality Rule')}</th>
              <th>{t('操作', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {data.dataMappings.map((m) => (
              <tr key={m.id}>
                <td>
                  <span className="badge badge-accent">{m.ontologyObject}</span>
                </td>
                <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>
                  {m.ontologyAttribute}
                </td>
                <td style={{ fontFamily: 'var(--mono)' }}>
                  {m.sourceTable}.{m.sourceColumn}
                </td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>{m.transformExpr}</td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>{m.qualityRule}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => openEditMapping(m)}
                  >
                    {t('编辑', 'Edit')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <OntoModalDialog
        open={modalOpen}
        title={
          editingRuleId
            ? t('编辑 MM 字段映射规则', 'Edit MM Column Mapping')
            : t('新增 MM 字段映射与质量门禁规则', 'Add MM Column Mapping Rule')
        }
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSaveMapping} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-grid-2">
            <div className="form-field">
              <label className="form-label">{t('本体对象 (M1 Aggregate)', 'Ontology Object')}</label>
              <input
                className="input"
                value={ontologyObject}
                onChange={(e) => setOntologyObject(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t('本体属性路径', 'Ontology Attribute')}</label>
              <input
                className="input"
                value={ontologyAttribute}
                onChange={(e) => setOntologyAttribute(e.target.value)}
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t('源数据库资源', 'Source Database')}</label>
              <select
                className="select"
                value={sourceDatabaseId}
                onChange={(e) => setSourceDatabaseId(e.target.value)}
              >
                {data.databaseResources.map((db) => (
                  <option key={db.id} value={db.id}>
                    {db.name} ({db.id})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">{t('源物理表名', 'Source Table')}</label>
              <input
                className="input"
                value={sourceTable}
                onChange={(e) => setSourceTable(e.target.value)}
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t('源物理字段名', 'Source Column')}</label>
              <input
                className="input"
                value={sourceColumn}
                onChange={(e) => setSourceColumn(e.target.value)}
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t('SQL 清洗转换表达式', 'Transform Expression')}</label>
              <input
                className="input"
                value={transformExpr}
                onChange={(e) => setTransformExpr(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="form-field">
            <label className="form-label">{t('数据质量校验门禁规则', 'Data Quality Gate Rule')}</label>
            <input
              className="input"
              value={qualityRule}
              onChange={(e) => setQualityRule(e.target.value)}
              required
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn" onClick={() => setModalOpen(false)}>
              {t('取消', 'Cancel')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('保存映射规则', 'Save Mapping')}
            </button>
          </div>
        </form>
      </OntoModalDialog>
    </div>
  );
}

// ─── 8. Data Analytics Center: Metrics, Scenario Analysis & Archived Reports ─
export function DataMetricsReportsView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [insightsByMetric, setInsightsByMetric] = useState<Record<string, MetricInsightResult>>({});
  const [loadingMetricId, setLoadingMetricId] = useState<string | null>(null);
  const [attributionsByScenario, setAttributionsByScenario] = useState<
    Record<string, ScenarioAttributionResult>
  >({});
  const [loadingScenarioId, setLoadingScenarioId] = useState<string | null>(null);

  // Add Metric Modal
  const [metricModalOpen, setMetricModalOpen] = useState(false);
  const [mCode, setMCode] = useState('MFT_ARCHIVE_TIMELINESS');
  const [mName, setMName] = useState('签章合同跨网归档及时率');
  const [mCategory, setMCategory] = useState('安全合规效能');
  const [mFormula, setMFormula] = useState('COUNT(ArchivedWithin2h) / COUNT(ApprovedContracts)');
  const [mCurrentValue, setMCurrentValue] = useState('96.2%');
  const [mYoY, setMYoY] = useState('+2.4%');
  const [mStatus, setMStatus] = useState<'NORMAL' | 'WARNING' | 'CRITICAL'>('NORMAL');
  const [mAggregate, setMAggregate] = useState('Contract');

  if (!data) return null;

  const handleMetricInsight = async (metricId: string) => {
    setLoadingMetricId(metricId);
    try {
      const res = await apiGenerateMetricInsight(metricId);
      setInsightsByMetric((prev) => ({ ...prev, [metricId]: res }));
      showToast(t(`已生成指标 ${res.metric.name} 的 AI 异动洞察`, `Generated AI insight for ${res.metric.code}`));
    } finally {
      setLoadingMetricId(null);
    }
  };

  const handleScenarioAttribution = async (scenarioId: string) => {
    setLoadingScenarioId(scenarioId);
    try {
      const res = await apiRunScenarioAttribution(scenarioId, { saveAsReport: true });
      setAttributionsByScenario((prev) => ({ ...prev, [scenarioId]: res }));
      patchData({ analyticsReports: res.analyticsReports });
      showToast(
        t(
          `已完成场景 AI 归因分析并归档新报告「${res.savedReport?.title ?? res.scenario.name}」`,
          `Completed scenario attribution and saved report`,
        ),
      );
    } finally {
      setLoadingScenarioId(null);
    }
  };

  const handleQuickWriteback = async (interfaceId: string) => {
    const res = await fetch(`/api/analytics/writebacks/${interfaceId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payloadOverride: { source: 'METRIC_INSIGHT_CLOSED_LOOP' } }),
    });
    const json = await res.json();
    patchData({ writebackInterfaces: json.writebackInterfaces });
    showToast(`已触发闭环回写接口 ${interfaceId} 执行成功`);
  };

  const handleCreateMetric = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mCode.trim() || !mName.trim()) return;
    const res = await fetch('/api/analytics/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: `MET-0${data.metrics.length + 1}-${Date.now().toString(36).slice(-3)}`,
        code: mCode.trim(),
        name: mName.trim(),
        category: mCategory.trim(),
        formula: mFormula.trim(),
        unit: '%',
        currentValue: mCurrentValue.trim(),
        yoYChange: mYoY.trim(),
        status: mStatus,
        dimensions: ['所属大区 (region)', '风险等级 (riskLevel)'],
        linkedAggregate: mAggregate.trim(),
      }),
    });
    const json = await res.json();
    patchData({ metrics: json.metrics });
    setMetricModalOpen(false);
    showToast(t(`已新增业务分析指标「${mName}」`, `Added metric "${mName}"`));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 1. Metrics Grid */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              {t('核心业务本体指标库与 AI 异动洞察 (Metrics & AI Insights)', 'Ontology Metrics & AI Anomaly Insights')}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t(
                '基于 M1 聚合根与 MM 物理表实时聚合指标，支持一键触发 AI 异动根因洞察与业务回写',
                'Metrics bound to M1 aggregates and MM tables with one-click AI anomaly driver insights',
              )}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setMetricModalOpen(true)}
          >
            + {t('新增指标', 'New Metric')}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          {data.metrics.map((m, idx) => {
            const insight = insightsByMetric[m.id];
            return (
              <div
                key={m.id}
                style={{
                  padding: 12,
                  borderRadius: 6,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--line)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="badge badge-accent">{m.code}</span>
                  <span
                    className={`badge ${
                      m.status === 'NORMAL'
                        ? 'badge-ok'
                        : m.status === 'WARNING'
                          ? 'badge-warn'
                          : 'badge-bad'
                    }`}
                  >
                    {m.status}
                  </span>
                </div>

                <div style={{ fontWeight: 600, fontSize: 14 }}>{m.name}</div>
                <div
                  style={{
                    fontFamily: 'var(--serif)',
                    fontSize: 24,
                    fontWeight: 600,
                  }}
                >
                  {m.currentValue}{' '}
                  <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
                    ({m.yoYChange})
                  </span>
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
                  {m.formula}
                </div>

                <div style={{ marginTop: 4 }}>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    data-testid={idx === 0 ? 'metric-insight-btn' : `metric-insight-btn-${m.id}`}
                    disabled={loadingMetricId === m.id}
                    onClick={() => handleMetricInsight(m.id)}
                  >
                    {loadingMetricId === m.id
                      ? t('洞察分析中...', 'Analyzing...')
                      : t('AI 异动洞察', 'AI Metric Insight')}
                  </button>
                </div>

                {insight && (
                  <div
                    style={{
                      marginTop: 6,
                      padding: 10,
                      borderRadius: 5,
                      background: 'var(--surface)',
                      border: '1px solid var(--line)',
                      fontSize: 12,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ fontWeight: 600, color: 'var(--accent)' }}>
                      {t('AI 异动驱动因子：', 'Anomaly Drivers:')}
                    </div>
                    {insight.anomalyDrivers.map((drv, dIdx) => (
                      <div key={dIdx} style={{ fontSize: 11.5 }}>
                        • {drv}
                      </div>
                    ))}
                    <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                      {insight.suggestedAction}
                    </div>
                    <div>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => handleQuickWriteback(insight.writebackInterfaceId)}
                      >
                        {t(
                          `触发闭环回写 (${insight.writebackInterfaceId})`,
                          `Trigger Write-Back (${insight.writebackInterfaceId})`,
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Analytics Scenarios (场景分析) */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              {t('业务专题场景分析与归因建模 (Scenario Analysis)', 'Domain Scenario Analysis & Attribution')}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t(
                '围绕异常预警条件组织多指标联合归因，一键生成并归档结构化分析报告',
                'Multi-metric causal attribution scenarios that synthesize and archive analytical reports',
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data.analyticsScenarios.map((sc, idx) => {
            const attrRes = attributionsByScenario[sc.id];
            return (
              <div
                key={sc.id}
                style={{
                  padding: 12,
                  borderRadius: 6,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--line)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div>
                    <strong style={{ fontSize: 14 }}>{sc.name}</strong>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                      <span className="badge badge-warn">Trigger: {sc.triggerCondition}</span>
                      {sc.relatedMetrics.map((mid) => (
                        <span key={mid} className="badge badge-accent">
                          {mid}
                        </span>
                      ))}
                      <span className="badge badge-ok">Write-Back: {sc.writebackInterfaceId}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    data-testid={
                      idx === 0 ? 'scenario-attribute-btn' : `scenario-attribute-btn-${sc.id}`
                    }
                    disabled={loadingScenarioId === sc.id}
                    onClick={() => handleScenarioAttribution(sc.id)}
                  >
                    {loadingScenarioId === sc.id
                      ? t('归因生成中...', 'Attributing...')
                      : t('AI 归因分析并生成报告', 'AI Attribution & Save Report')}
                  </button>
                </div>

                <div className="form-grid-2">
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
                      {t('预设本体归因链因子', 'Ontology Causal Factors')}
                    </div>
                    {sc.causalFactors.map((cf, i) => (
                      <div key={i} style={{ fontSize: 12, marginBottom: 3 }}>
                        • {cf}
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
                      {t('建议闭环处置策略', 'Recommended Actions')}
                    </div>
                    {sc.recommendedActions.map((act, i) => (
                      <div key={i} style={{ fontSize: 12, marginBottom: 3 }}>
                        • {act}
                      </div>
                    ))}
                  </div>
                </div>

                {attrRes && (
                  <div
                    style={{
                      padding: 10,
                      borderRadius: 5,
                      background: 'var(--surface)',
                      border: '1px solid var(--line)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <strong style={{ fontSize: 12.5 }}>
                        {t('实时归因贡献度拆解', 'Live Causal Contribution Breakdown')}
                      </strong>
                      {attrRes.savedReport && (
                        <span className="badge badge-ok">
                          {t('已归档至分析报告库', 'Archived to Reports')}: {attrRes.savedReport.id}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {attrRes.causalBreakdown.map((item, cIdx) => (
                        <div
                          key={cIdx}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 8,
                            fontSize: 12,
                            padding: '4px 6px',
                            background: 'var(--surface-2)',
                            borderRadius: 4,
                          }}
                        >
                          <span>
                            <strong>{item.factor}</strong> — {item.evidence}
                          </span>
                          <span className="badge badge-accent">{item.weight}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Archived Analytical Reports */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {data.analyticsReports.map((rp) => (
          <div key={rp.id} className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">{rp.title}</h3>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {rp.period} · {rp.author}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="badge badge-ok">{t('已归档报告', 'Published Report')}</span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    triggerBrowserDownload(
                      `${rp.id}.md`,
                      rp.markdownContent,
                      'text/markdown;charset=utf-8',
                    )
                  }
                >
                  {t('导出 Markdown', 'Export .md')}
                </button>
              </div>
            </div>
            <pre
              style={{
                margin: 0,
                padding: 12,
                background: 'var(--surface-2)',
                borderRadius: 5,
                whiteSpace: 'pre-wrap',
                fontFamily: 'var(--sans)',
                fontSize: 12.5,
              }}
            >
              {rp.markdownContent}
            </pre>
          </div>
        ))}
      </div>

      <OntoModalDialog
        open={metricModalOpen}
        title={t('新增数据本体分析指标', 'Create Ontology Metric')}
        onClose={() => setMetricModalOpen(false)}
      >
        <form onSubmit={handleCreateMetric} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-grid-2">
            <div className="form-field">
              <label className="form-label">
                {t('指标编码', 'Metric Code')} <span className="req-star">*</span>
              </label>
              <input
                className="input"
                value={mCode}
                onChange={(e) => setMCode(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">
                {t('指标名称', 'Metric Name')} <span className="req-star">*</span>
              </label>
              <input
                className="input"
                value={mName}
                onChange={(e) => setMName(e.target.value)}
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t('指标域分类', 'Category')}</label>
              <input
                className="input"
                value={mCategory}
                onChange={(e) => setMCategory(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t('关联 M1 聚合根', 'Linked M1 Aggregate')}</label>
              <input
                className="input"
                value={mAggregate}
                onChange={(e) => setMAggregate(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t('当前指标值', 'Current Value')}</label>
              <input
                className="input"
                value={mCurrentValue}
                onChange={(e) => setMCurrentValue(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t('同环比变化', 'YoY / MoM Delta')}</label>
              <input
                className="input"
                value={mYoY}
                onChange={(e) => setMYoY(e.target.value)}
              />
            </div>
          </div>
          <div className="form-grid-2">
            <div className="form-field">
              <label className="form-label">{t('本体计算公式', 'Ontology Formula')}</label>
              <input
                className="input"
                value={mFormula}
                onChange={(e) => setMFormula(e.target.value)}
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t('监控健康状态', 'Health Status')}</label>
              <select
                className="select"
                value={mStatus}
                onChange={(e) =>
                  setMStatus(e.target.value as 'NORMAL' | 'WARNING' | 'CRITICAL')
                }
              >
                <option value="NORMAL">NORMAL</option>
                <option value="WARNING">WARNING</option>
                <option value="CRITICAL">CRITICAL</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn" onClick={() => setMetricModalOpen(false)}>
              {t('取消', 'Cancel')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('保存指标定义', 'Save Metric')}
            </button>
          </div>
        </form>
      </OntoModalDialog>
    </div>
  );
}

// ─── 9. Data Ontology Reasoning (本体推理：智能问数 / 问因 / 问策) & Write-Back
export function DataReasoningView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [mode, setMode] = useState<'ASK_DATA' | 'ASK_WHY' | 'ASK_POLICY'>('ASK_POLICY');
  const [question, setQuestion] = useState(
    '为什么本季度高风险合同逾期未结算率上升到了 14.8%？应该采取什么策略并回写业务系统？',
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [liveSqlRows, setLiveSqlRows] = useState<Record<string, unknown>[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data && !selectedSessionId && data.reasoningSessions[0]) {
      setSelectedSessionId(data.reasoningSessions[0].id);
    }
  }, [data, selectedSessionId]);

  const activeSession = useMemo(() => {
    if (!data) return undefined;
    return (
      data.reasoningSessions.find((s) => s.id === selectedSessionId) ??
      data.reasoningSessions[0]
    );
  }, [data, selectedSessionId]);

  useEffect(() => {
    setLiveSqlRows(null);
    if (!activeSession) return;
    if (activeSession.queryRows && activeSession.queryRows.length > 0) return;
    if (activeSession.sqlGenerated) {
      apiExecuteAnalyticsSql(activeSession.sqlGenerated)
        .then((res) => {
          setLiveSqlRows(res.rows);
        })
        .catch(() => {
          // Keep non-blocking if generated SQL uses external view
        });
    }
  }, [activeSession]);

  if (!data) return null;

  const displayRows =
    activeSession?.queryRows && activeSession.queryRows.length > 0
      ? activeSession.queryRows
      : liveSqlRows ?? [];

  const displayColumns =
    activeSession?.queryColumns && activeSession.queryColumns.length > 0
      ? activeSession.queryColumns
      : displayRows[0]
        ? Object.keys(displayRows[0])
        : [];

  // Identify numeric column for horizontal bar visualization
  const barMetricCol = displayColumns.find((col) =>
    displayRows.some((r) => typeof r[col] === 'number'),
  );
  const barLabelCol = displayColumns.find((col) => col !== barMetricCol) ?? displayColumns[0];
  const maxBarValue = barMetricCol
    ? Math.max(1, ...displayRows.map((r) => Math.abs(Number(r[barMetricCol] ?? 0))))
    : 1;

  const handleRunReasoning = async () => {
    if (!question.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/analytics/reasoning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          mode,
          projectId: data.activeProject.id,
        }),
      });
      const json = await res.json();
      patchData({ reasoningSessions: json.reasoningSessions });
      if (json.session?.id) {
        setSelectedSessionId(json.session.id);
      }
      showToast(`已完成数据本体推理 (${mode})`);
    } finally {
      setBusy(false);
    }
  };

  const handleTriggerWriteback = async (interfaceId: string) => {
    const res = await fetch(`/api/analytics/writebacks/${interfaceId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payloadOverride: { triggeredByReasoningId: activeSession?.id },
      }),
    });
    const json = await res.json();
    patchData({ writebackInterfaces: json.writebackInterfaces });
    showToast(`已通过回写接口 ${interfaceId} 将决策指令回写至业务系统`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              {t(
                '数据本体三阶推理引擎 (智能问数 ASK_DATA → 智能问因 ASK_WHY → 智能问策 ASK_POLICY)',
                'Data Ontology 3-Stage Reasoning Engine (Ask Data → Ask Why → Ask Policy)',
              )}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t(
                '基于 M1 对象关联链、M4/ME 业务事件场景、M3 规则阈值与 MM 库表映射进行根因穿透并闭环回写',
                'Traces M1 associations, M4/ME scenarios, M3 rule thresholds, and MM column mappings with closed-loop write-back',
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className={`btn btn-sm ${mode === 'ASK_DATA' ? 'btn-primary' : ''}`}
              onClick={() => setMode('ASK_DATA')}
            >
              1. {t('智能问数', 'Ask Data')}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${mode === 'ASK_WHY' ? 'btn-primary' : ''}`}
              onClick={() => setMode('ASK_WHY')}
            >
              2. {t('智能问因', 'Ask Why')}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${mode === 'ASK_POLICY' ? 'btn-primary' : ''}`}
              onClick={() => setMode('ASK_POLICY')}
            >
              3. {t('智能问策', 'Ask Policy')}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input
            className="input"
            data-testid="reasoning-question-input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-primary"
            data-testid="run-reasoning-btn"
            disabled={busy}
            onClick={handleRunReasoning}
          >
            {busy ? '...' : t('执行本体推理', 'Run Reasoning')}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ color: 'var(--muted)', fontWeight: 600 }}>
            {t('历史推理会话记录：', 'Reasoning History:')}
          </span>
          <select
            className="select"
            style={{ maxWidth: 520 }}
            value={activeSession?.id ?? ''}
            onChange={(e) => setSelectedSessionId(e.target.value)}
          >
            {data.reasoningSessions.map((s) => (
              <option key={s.id} value={s.id}>
                [{s.mode}] {s.question.slice(0, 56)} ({s.createdAt.slice(0, 16)})
              </option>
            ))}
          </select>
        </div>
      </div>

      {activeSession && (
        <>
          {/* KPI Data Summary Strip */}
          {activeSession.dataSummary.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.min(4, Math.max(1, activeSession.dataSummary.length))}, minmax(0, 1fr))`,
                gap: 12,
              }}
            >
              {activeSession.dataSummary.map((kpi, idx) => (
                <div key={idx} className="card">
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{kpi.label}</div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      marginTop: 4,
                    }}
                  >
                    <strong style={{ fontFamily: 'var(--serif)', fontSize: 20 }}>
                      {kpi.value}
                    </strong>
                    {kpi.delta && <span className="badge badge-warn">{kpi.delta}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1.18fr 0.82fr', gap: 14 }}>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="card-header" style={{ marginBottom: 0 }}>
                <h4 className="card-title">{t('三阶推理分析结论', 'Reasoning Conclusion')}</h4>
                <span className="badge badge-accent">{activeSession.mode}</span>
              </div>

              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  background: 'var(--surface-2)',
                  borderRadius: 5,
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'var(--sans)',
                  fontSize: 12.5,
                }}
              >
                {activeSession.answerMarkdown}
              </pre>

              {/* Live SQL Result Table & Visual Bar Breakdown */}
              {displayRows.length > 0 && (
                <div
                  style={{
                    padding: 10,
                    borderRadius: 6,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--line)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: 12 }}>
                      {t('实时 SQL 查询明细与可视化分布拆解', 'Live SQL Result & Visual Breakdown')}
                    </strong>
                    <span className="badge badge-ok">{displayRows.length} rows</span>
                  </div>

                  {barMetricCol && barLabelCol && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {displayRows.slice(0, 6).map((row, rIdx) => {
                        const val = Number(row[barMetricCol] ?? 0);
                        const pct = Math.min(100, Math.max(4, Math.round((Math.abs(val) / maxBarValue) * 100)));
                        return (
                          <div key={rIdx} style={{ fontSize: 11.5 }}>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                fontFamily: 'var(--mono)',
                                marginBottom: 2,
                              }}
                            >
                              <span>{String(row[barLabelCol] ?? `#${rIdx + 1}`)}</span>
                              <strong>{val.toLocaleString()}</strong>
                            </div>
                            <div
                              style={{
                                height: 7,
                                borderRadius: 4,
                                background: 'var(--line)',
                                overflow: 'hidden',
                              }}
                            >
                              <div
                                style={{
                                  width: `${pct}%`,
                                  height: '100%',
                                  background: 'var(--accent)',
                                  borderRadius: 4,
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div style={{ overflowX: 'auto' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          {displayColumns.map((col) => (
                            <th key={col} style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {displayRows.slice(0, 8).map((row, rIdx) => (
                          <tr key={rIdx}>
                            {displayColumns.map((col) => (
                              <td
                                key={col}
                                style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}
                              >
                                {row[col] == null ? '-' : String(row[col])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                  {t('自动生成的本体映射 SQL (MM + M7)', 'Generated Ontology SQL')}
                </div>
                <div
                  style={{
                    padding: 10,
                    background: 'var(--surface-2)',
                    borderRadius: 5,
                    fontFamily: 'var(--mono)',
                    fontSize: 11.5,
                  }}
                >
                  {activeSession.sqlGenerated}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="card">
                <h4 className="card-title" style={{ marginBottom: 8 }}>
                  {t('智能问因：本体关联链归因因子 (M1/M4/ME/M3)', 'Causal Attribution Factors')}
                </h4>
                {activeSession.causalAnalysis.map((c, i) => (
                  <div
                    key={i}
                    style={{
                      padding: 8,
                      background: 'var(--surface-2)',
                      borderRadius: 4,
                      marginBottom: 6,
                      fontSize: 12,
                    }}
                  >
                    {c}
                  </div>
                ))}
              </div>

              <div className="card">
                <h4 className="card-title" style={{ marginBottom: 8 }}>
                  {t('智能问策：可执行动作与业务回写', 'Actionable Policy & Write-Back')}
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {activeSession.policyRecommendations.map((rec, i) => (
                    <div
                      key={i}
                      style={{
                        padding: 10,
                        background: 'var(--surface-2)',
                        borderRadius: 5,
                        border: '1px solid var(--line)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                        <div style={{ fontWeight: 600 }}>{rec.actionTitle}</div>
                        <span className="badge badge-accent">{rec.targetObject}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 8px 0' }}>
                        {rec.expectedImpact}
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        data-testid={
                          i === 0
                            ? 'trigger-policy-writeback-btn'
                            : `trigger-policy-writeback-btn-${i}`
                        }
                        onClick={() => handleTriggerWriteback(rec.writebackInterfaceId)}
                      >
                        {t(
                          `立即调用回写接口 (${rec.writebackInterfaceId}) 执行闭环`,
                          `Execute Write-Back (${rec.writebackInterfaceId})`,
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function DataWritebackView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [payloadDrafts, setPayloadDrafts] = useState<Record<string, string>>({});
  const [jsonErrors, setJsonErrors] = useState<Record<string, string | null>>({});

  if (!data) return null;

  const getDraftValue = (wbId: string, template: Record<string, unknown>) =>
    payloadDrafts[wbId] ?? JSON.stringify(template, null, 2);

  const handleExecute = async (id: string, template: Record<string, unknown>) => {
    const rawJson = getDraftValue(id, template);
    let parsedOverride: Record<string, unknown>;
    try {
      parsedOverride = JSON.parse(rawJson) as Record<string, unknown>;
      setJsonErrors((prev) => ({ ...prev, [id]: null }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid JSON payload';
      setJsonErrors((prev) => ({ ...prev, [id]: msg }));
      showToast(`JSON 格式校验未通过：${msg}`);
      return;
    }

    const res = await fetch(`/api/analytics/writebacks/${id}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payloadOverride: parsedOverride }),
    });
    const json = await res.json();
    patchData({ writebackInterfaces: json.writebackInterfaces });
    showToast(`回写接口 ${id} 执行成功`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {data.writebackInterfaces.map((wb) => (
        <div key={wb.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="card-header" style={{ marginBottom: 0 }}>
            <div>
              <h3 className="card-title">
                {wb.id} · {wb.name}
              </h3>
              <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                Protocol: {wb.protocol} · Target: {wb.targetSystem} ({wb.endpoint}) · Bound M2
                Behavior: {wb.boundBehaviorRef}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="badge badge-ok">
                {t('累计回写次数', 'Executions')}: {wb.executionCount}
              </span>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleExecute(wb.id, wb.payloadTemplate)}
              >
                {t('立即执行业务回写', 'Execute Write-Back')}
              </button>
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">
              {t('可编辑回写指令 JSON 载荷 (Payload Override)', 'Editable Write-Back JSON Payload')}
            </label>
            <textarea
              className="textarea mono"
              rows={5}
              value={getDraftValue(wb.id, wb.payloadTemplate)}
              onChange={(e) =>
                setPayloadDrafts((prev) => ({ ...prev, [wb.id]: e.target.value }))
              }
            />
            {jsonErrors[wb.id] && (
              <div style={{ fontSize: 11.5, color: 'var(--bad)', fontFamily: 'var(--mono)' }}>
                {jsonErrors[wb.id]}
              </div>
            )}
          </div>

          {wb.lastExecutionResult && (
            <div
              style={{
                padding: 10,
                background: 'var(--ok-soft)',
                color: 'var(--ok)',
                borderRadius: 5,
                fontFamily: 'var(--mono)',
                fontSize: 12,
              }}
            >
              {wb.lastExecutionResult}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── 10. LLM Center & System Settings (大模型中心 & 系统设置) ─────────────────
export function LlmCenterView() {
  const { t } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  const [testingId, setTestingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('Enterprise OpenAI-Compatible Gateway');
  const [providerType, setProviderType] = useState<
    'OPENAI_COMPATIBLE' | 'ANTHROPIC' | 'CLOUDFLARE_AI'
  >('OPENAI_COMPATIBLE');
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:3425/v1');
  const [apiKey, setApiKey] = useState('magpie');
  const [defaultModel, setDefaultModel] = useState('auto/glm-5.3-flash');
  const [modelsCsv, setModelsCsv] = useState('auto/glm-5.3-flash, auto/glm-5.2');

  if (!data) return null;

  const handlePing = async (providerId: string) => {
    setTestingId(providerId);
    try {
      const res = await apiTestLlmProvider(providerId);
      patchData({ llmProviders: res.llmProviders });
      showToast(
        res.ping.ok
          ? `连接成功 (${res.ping.latencyMs}ms): ${res.ping.sampleReply}`
          : `连接异常: ${res.ping.errorMessage}`,
      );
    } finally {
      setTestingId(null);
    }
  };

  const handleAddProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !baseUrl.trim()) return;
    const res = await fetch('/api/llm/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: `llm-${Date.now().toString(36)}`,
        name: name.trim(),
        providerType,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        defaultModel: defaultModel.trim(),
        availableModels: modelsCsv
          .split(/[,，]/)
          .map((m) => m.trim())
          .filter(Boolean),
        enabled: true,
      }),
    });
    const json = await res.json();
    patchData({ llmProviders: json.llmProviders });
    setModalOpen(false);
    showToast(t(`已接入模型网关「${name}」`, `Added LLM provider "${name}"`));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
          {t(
            '统一管理本地 Pi 网关与云端兼容大模型端点，支撑需求探索、本体助手、智能对话与三阶数据推理',
            'Manage local Pi gateway and OpenAI-compatible LLM endpoints across all Ontology Plus agents',
          )}
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setModalOpen(true)}>
          + {t('新增模型网关', 'Add LLM Gateway')}
        </button>
      </div>

      {data.llmProviders.map((p, idx) => (
        <div key={p.id} className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">{p.name}</h3>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
                [{p.providerType}] {p.baseUrl} · Default Model: {p.defaultModel}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className={`badge ${p.lastTestedStatus === 'OK' ? 'badge-ok' : 'badge-warn'}`}>
                {p.lastTestedStatus ?? 'READY'}
              </span>
              <button
                type="button"
                className="btn btn-primary"
                data-testid={idx === 0 ? 'ping-llm-gateway-btn' : `ping-llm-gateway-btn-${idx}`}
                disabled={testingId === p.id}
                onClick={() => handlePing(p.id)}
              >
                {testingId === p.id
                  ? t('正在探测网关...', 'Testing Gateway...')
                  : t('测试本地 Pi 网关连接 (glm-5.3-flash)', 'Test Local Pi Gateway')}
              </button>
            </div>
          </div>

          {p.lastTestedMessage && (
            <div
              data-testid={idx === 0 ? 'llm-ping-result' : `llm-ping-result-${idx}`}
              style={{
                padding: 10,
                background: 'var(--surface-2)',
                borderRadius: 5,
                fontFamily: 'var(--mono)',
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              {p.lastTestedMessage}
            </div>
          )}

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
              {t('已发现可用模型列表', 'Discovered Models')} ({p.availableModels.length})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {p.availableModels.map((m) => (
                <span
                  key={m}
                  className={`badge ${m === p.defaultModel ? 'badge-accent' : ''}`}
                >
                  {m}
                </span>
              ))}
            </div>
          </div>
        </div>
      ))}

      <OntoModalDialog
        open={modalOpen}
        title={t('新增大模型服务网关 (LLM Provider)', 'Add LLM Gateway Provider')}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleAddProvider} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-grid-2">
            <div className="form-field">
              <label className="form-label">
                {t('网关名称', 'Gateway Name')} <span className="req-star">*</span>
              </label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t('协议类型', 'Provider Type')}</label>
              <select
                className="select"
                value={providerType}
                onChange={(e) =>
                  setProviderType(
                    e.target.value as 'OPENAI_COMPATIBLE' | 'ANTHROPIC' | 'CLOUDFLARE_AI',
                  )
                }
              >
                <option value="OPENAI_COMPATIBLE">OPENAI_COMPATIBLE</option>
                <option value="ANTHROPIC">ANTHROPIC</option>
                <option value="CLOUDFLARE_AI">CLOUDFLARE_AI</option>
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">
                {t('API Base URL', 'API Base URL')} <span className="req-star">*</span>
              </label>
              <input
                className="input"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t('API Key / Bearer Token', 'API Key')}</label>
              <input
                className="input"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t('默认主模型 ID', 'Default Model ID')}</label>
              <input
                className="input"
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t('候选模型列表 (逗号分隔)', 'Available Models')}</label>
              <input
                className="input"
                value={modelsCsv}
                onChange={(e) => setModelsCsv(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn" onClick={() => setModalOpen(false)}>
              {t('取消', 'Cancel')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('保存模型网关', 'Save Gateway')}
            </button>
          </div>
        </form>
      </OntoModalDialog>
    </div>
  );
}

export function SystemSettingsView() {
  const { t, locale, setLocale, theme, themePreference, setTheme } = usePreferences();
  const { data, patchData, showToast } = useWorkbenchStore();
  if (!data) return null;

  const settings = data.systemSettings;

  const updateBackendSettings = async (patch: Record<string, unknown>, toastLabel?: string) => {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    patchData({ systemSettings: json.systemSettings });
    if (toastLabel) showToast(toastLabel);
  };

  const handleSelectTheme = (pref: ThemePreference) => {
    setTheme(pref);
    void updateBackendSettings({ defaultTheme: pref });
  };

  const handleSelectLocale = (nextLocale: 'zh-CN' | 'en-US') => {
    setLocale(nextLocale);
    void updateBackendSettings({ defaultLanguage: nextLocale });
  };

  return (
    <div className="card" style={{ maxWidth: 820 }}>
      <div className="card-header">
        <h3 className="card-title">
          {t('系统设置与工作区治理首选项', 'System Settings & Workspace Governance Preferences')}
        </h3>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 3-State Segmented Theme Control */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            paddingBottom: 14,
            borderBottom: '1px solid var(--line)',
          }}
        >
          <div>
            <strong>{t('界面外观主题 (Spatial-Sync 三态切换)', 'Appearance Theme')}</strong>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t(
                '支持跟随操作系统色温，或显式锁定暖纸亮色 (Warm Paper) / 胶片颗粒暗色 (Film Grain)',
                'Follow OS preference or pin Warm Paper Light / Film Grain Dark scheme',
              )}
            </div>
          </div>

          <div
            role="group"
            aria-label={t('界面外观主题选择', 'Appearance theme preference')}
            style={{
              display: 'inline-flex',
              padding: 3,
              borderRadius: 6,
              background: 'var(--surface-2)',
              border: '1px solid var(--line)',
              gap: 4,
            }}
          >
            <button
              type="button"
              data-testid="theme-pref-system"
              className={`btn btn-sm ${themePreference === 'system' ? 'btn-primary' : ''}`}
              onClick={() => handleSelectTheme('system')}
            >
              {t(
                `跟随系统 (${theme === 'light' ? '当前亮色' : '当前暗色'})`,
                `System (Currently ${theme})`,
              )}
            </button>
            <button
              type="button"
              data-testid="theme-pref-light"
              className={`btn btn-sm ${themePreference === 'light' ? 'btn-primary' : ''}`}
              onClick={() => handleSelectTheme('light')}
            >
              ☀ {t('亮色暖纸', 'Light')}
            </button>
            <button
              type="button"
              data-testid="theme-pref-dark"
              className={`btn btn-sm ${themePreference === 'dark' ? 'btn-primary' : ''}`}
              onClick={() => handleSelectTheme('dark')}
            >
              ☾ {t('暗色胶片', 'Dark')}
            </button>
          </div>
        </div>

        {/* Bilingual Language Toggle */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            paddingBottom: 14,
            borderBottom: '1px solid var(--line)',
          }}
        >
          <div>
            <strong>{t('界面双语切换 (Bilingual i18n)', 'Interface Language')}</strong>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t(
                '支持简体中文 (zh-CN) 与英文 (en-US) 实时无刷切换',
                'Switch between Simplified Chinese (zh-CN) and English (en-US)',
              )}
            </div>
          </div>

          <div
            style={{
              display: 'inline-flex',
              padding: 3,
              borderRadius: 6,
              background: 'var(--surface-2)',
              border: '1px solid var(--line)',
              gap: 4,
            }}
          >
            <button
              type="button"
              className={`btn btn-sm ${locale === 'zh-CN' ? 'btn-primary' : ''}`}
              onClick={() => handleSelectLocale('zh-CN')}
            >
              简体中文 (zh-CN)
            </button>
            <button
              type="button"
              className={`btn btn-sm ${locale === 'en-US' ? 'btn-primary' : ''}`}
              onClick={() => handleSelectLocale('en-US')}
            >
              English (en-US)
            </button>
          </div>
        </div>

        {/* Strict Validation Gate Switch */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            paddingBottom: 14,
            borderBottom: '1px solid var(--line)',
          }}
        >
          <div>
            <strong>
              {t('两级一致性严格校验门禁 (Tier-1 Strict Validation Gate)', 'Strict Consistency Validation Gate')}
            </strong>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t(
                '存在跨模型引用断链或类型契约冲突时，自动拦截四层应用开发包编译导出',
                'Block 4-layer development package compilation whenever Consistency Errors exist',
              )}
            </div>
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.strictValidation}
              onChange={(e) =>
                updateBackendSettings(
                  { strictValidation: e.target.checked },
                  t('已更新两级一致性严格校验门禁设置', 'Updated strict validation setting'),
                )
              }
            />
            <span className={`badge ${settings.strictValidation ? 'badge-ok' : 'badge-warn'}`}>
              {settings.strictValidation ? 'ENABLED' : 'RELAXED'}
            </span>
          </label>
        </div>

        {/* Auto Mirror YAML & Auto Sync MU Switches */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            paddingBottom: 14,
            borderBottom: '1px solid var(--line)',
          }}
        >
          <div>
            <strong>{t('本地本体文件自动镜像同步 (Auto-Mirror 11 YAML)', 'Auto-Mirror Local YAML Files')}</strong>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
              {settings.workspaceDir}/model/{data.activeProject.id}/yaml/
            </div>
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.autoMirrorYaml}
              onChange={(e) =>
                updateBackendSettings(
                  { autoMirrorYaml: e.target.checked },
                  t('已更新本地 YAML 自动镜像设置', 'Updated local YAML auto-mirror setting'),
                )
              }
            />
            <span className={`badge ${settings.autoMirrorYaml ? 'badge-ok' : 'badge-warn'}`}>
              {settings.autoMirrorYaml ? 'AUTO-MIRROR ON' : 'PAUSED'}
            </span>
          </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <strong>
              {t('界面原型保存时自动萃取同步 MU 交互模型', 'Auto-Sync MU UI Model from HTML Prototypes')}
            </strong>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t(
                '解析 HTML 原型中的 data-screen-id / data-element-id / data-event-id 锚点同步至 MU',
                'Deterministically extract semantic data-* anchors into MU on prototype save',
              )}
            </div>
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.autoSyncPrototypeMu}
              onChange={(e) =>
                updateBackendSettings(
                  { autoSyncPrototypeMu: e.target.checked },
                  t('已更新原型自动同步 MU 设置', 'Updated prototype MU auto-sync setting'),
                )
              }
            />
            <span className={`badge ${settings.autoSyncPrototypeMu ? 'badge-ok' : 'badge-warn'}`}>
              {settings.autoSyncPrototypeMu ? 'AUTO-SYNC ON' : 'MANUAL'}
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
